<script setup>
import { ref, onMounted, watch } from 'vue';
import { dbService } from '../services/db';
import { pdfService } from '../services/pdf';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const emit = defineEmits(['view-customer']);

// State variables
const billingSummaryList = ref([]);
const monthsList = ref([]);
const selectedMonthIndex = ref(0);

const isGeneratingAll = ref(false);
const shareStatusMessage = ref('');

// Generate last 6 months list
const generateMonthsList = () => {
  const list = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    list.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1, // 1-indexed
      label: d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    });
  }
  monthsList.value = list;
};

// Retrieve selected period details
const getSelectedPeriod = () => {
  if (monthsList.value.length === 0) return { year: new Date().getFullYear(), month: new Date().getMonth() + 1, label: '' };
  return monthsList.value[selectedMonthIndex.value];
};

// Load billing summaries from SQLite
const loadBillingSummary = async () => {
  const period = getSelectedPeriod();
  try {
    const res = await dbService.getBillingSummary(period.year, period.month);
    billingSummaryList.value = res;
  } catch (err) {
    console.error("Failed to load billing summaries:", err);
  }
};

// Initialize
onMounted(async () => {
  generateMonthsList();
  // Wait for DB initialization
  while (!dbService.initialized) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await loadBillingSummary();
});

// Watch month selection changes
watch(selectedMonthIndex, async () => {
  await loadBillingSummary();
});

// Generate Single Invoice in DB
const generateInvoice = async (customer) => {
  const period = getSelectedPeriod();
  try {
    await dbService.generateInvoice(customer.customer_id, period.year, period.month);
    await loadBillingSummary();
  } catch (err) {
    alert(err.message || 'Failed to generate invoice.');
  }
};

// Share single Invoice (creates DB invoice first if missing)
const shareInvoice = async (customer) => {
  const period = getSelectedPeriod();
  try {
    let invoiceId = customer.invoice_id;
    let invoiceNumber = customer.invoice_number;

    if (!invoiceId) {
      const genRes = await dbService.generateInvoice(customer.customer_id, period.year, period.month);
      invoiceId = genRes.invoiceId;
      invoiceNumber = genRes.invoiceNumber;
    }

    // 1. Generate PDF base64 string
    const pdfBase64 = await pdfService.generateInvoicePDF(invoiceId);

    // 2. Save base64 string to temporary cache file
    const fileName = `DoodhWala_Invoice_${invoiceNumber}.pdf`;
    const writeRes = await Filesystem.writeFile({
      path: fileName,
      data: pdfBase64,
      directory: Directory.Cache,
      recursive: true
    });

    const fileUri = writeRes.uri;

    // 3. Open share sheet
    await Share.share({
      title: `Invoice ${invoiceNumber}`,
      text: `Milk Bill for ${customer.name} - Period: ${period.label}`,
      url: fileUri,
      dialogTitle: `Share Invoice PDF`
    });

    // 4. Mark Invoice as Shared in SQLite
    await dbService.markInvoiceShared(invoiceId);

    // 5. Reload summary row
    await loadBillingSummary();
  } catch (err) {
    console.error("Failed to share invoice:", err);
    customer.invoice_status = 'Failed'; // Set local indicator to Failed
  }
};

const viewInvoicePDF = async (customer) => {
  try {
    let invoiceId = customer.invoice_id;
    if (!invoiceId) {
      const period = getSelectedPeriod();
      const genRes = await dbService.generateInvoice(customer.customer_id, period.year, period.month);
      invoiceId = genRes.invoiceId;
    }
    
    const pdfBase64 = await pdfService.generateInvoicePDF(invoiceId);
    const byteCharacters = atob(pdfBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'application/pdf' });
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, '_blank');
    
    if (!customer.invoice_id) {
      await loadBillingSummary();
    }
  } catch (err) {
    console.error("Failed to view invoice PDF:", err);
    alert(err.message || 'Failed to view PDF preview.');
  }
};

// Loops through all pending invoices and triggers share sheets sequentially
const sendAllInvoices = async () => {
  if (isGeneratingAll.value) return;
  
  isGeneratingAll.value = true;
  shareStatusMessage.value = 'Preparing bulk sending...';

  const toSend = billingSummaryList.value.filter(
    c => !c.invoice_status || c.invoice_status === 'GENERATED' || c.invoice_status === 'Failed'
  );

  if (toSend.length === 0) {
    shareStatusMessage.value = 'No pending bills to send!';
    setTimeout(() => {
      shareStatusMessage.value = '';
      isGeneratingAll.value = false;
    }, 2000);
    return;
  }

  for (let i = 0; i < toSend.length; i++) {
    const cust = toSend[i];
    shareStatusMessage.value = `Sharing with ${cust.name} (${i + 1}/${toSend.length})...`;
    
    try {
      await shareInvoice(cust);
    } catch (e) {
      console.error(`Error sharing invoice for ${cust.name}:`, e);
    }

    // Delay to let native sharing resources reset
    await new Promise(r => setTimeout(r, 600));
  }

  isGeneratingAll.value = false;
  shareStatusMessage.value = '';
  await loadBillingSummary();
};

const getInvoiceBadgeColor = (status) => {
  switch (status) {
    case 'GENERATED': return 'bg-blue-50 text-blue-700 border border-blue-200';
    case 'SHARED': return 'bg-amber-50 text-amber-700 border border-amber-200';
    case 'SETTLED': return 'bg-green-50 text-green-700 border border-green-200';
    case 'LOCKED': return 'bg-purple-50 text-purple-700 border border-purple-200';
    case 'Failed': return 'bg-red-50 text-red-700 border border-red-200';
    default: return 'bg-gray-50 text-gray-500 border border-gray-200';
  }
};

const getInvoiceBadgeLabel = (status) => {
  switch (status) {
    case 'GENERATED': return 'Not Sent';
    case 'SHARED': return 'Sent';
    case 'SETTLED': return 'Settled';
    case 'LOCKED': return 'Locked';
    case 'Failed': return 'Failed';
    default: return 'Not Generated';
  }
};

</script>

<template>
  <div>
    <!-- Sub-header Controls -->
    <div class="px-gutter pb-stack-md bg-surface z-40 sticky top-[48px] border-b border-surface-variant">
      
      <!-- Period Selector Header -->
      <div class="flex justify-between items-center bg-surface-container-low p-3 rounded-lg border border-outline-variant mt-2 mb-3">
        <label class="text-sm font-semibold text-on-surface">Billing Period:</label>
        <select 
          v-model="selectedMonthIndex" 
          :disabled="isGeneratingAll"
          class="bg-surface-container-lowest border border-outline-variant rounded px-2 py-1 text-sm text-on-surface focus:outline-none"
        >
          <option v-for="(m, idx) in monthsList" :key="idx" :value="idx">
            {{ m.label }}
          </option>
        </select>
      </div>

      <!-- Send All Controls -->
      <div class="bg-surface-container-lowest border border-outline-variant rounded-lg p-3 flex items-center justify-between shadow-sm">
        <div>
          <h3 class="font-bold text-on-surface text-sm">Monthly Batch Sharing</h3>
          <p class="text-xs text-on-surface-variant mt-0.5">Send all generated bills sequentially</p>
        </div>
        <button 
          @click="sendAllInvoices"
          :disabled="isGeneratingAll"
          class="py-2 px-4 rounded-lg bg-primary text-on-primary font-button-text text-xs hover:bg-primary/95 shadow-sm transition-all active:scale-95 disabled:bg-gray-100 disabled:text-gray-400"
        >
          <span class="flex items-center">
            <span class="material-symbols-outlined text-[16px] mr-1">send_and_archive</span>
            Send All
          </span>
        </button>
      </div>

      <!-- Bulk Progress Indicator -->
      <div v-if="shareStatusMessage" class="mt-3 bg-primary-container/20 border border-primary/20 rounded-md p-2.5 flex items-center space-x-2 text-xs font-medium text-primary">
        <span class="material-symbols-outlined animate-spin text-[18px]">sync</span>
        <span>{{ shareStatusMessage }}</span>
      </div>

    </div>

    <!-- Main List Container -->
    <main class="p-gutter space-y-stack-md pb-24">
      
      <!-- Empty State -->
      <div v-if="billingSummaryList.length === 0" class="flex flex-col items-center justify-center py-12 text-center bg-surface-container-lowest rounded-lg border border-outline-variant p-6">
        <span class="material-symbols-outlined text-[48px] text-on-surface-variant mb-2">inbox</span>
        <h3 class="font-customer-name text-on-surface mb-1">No Active Route Found</h3>
        <p class="font-body-md text-on-surface-variant text-sm">Create customers or configure subscriptions to populate routes.</p>
      </div>

      <!-- Customer Billing Rows -->
      <div v-else class="space-y-3">
        <div 
          v-for="c in billingSummaryList" 
          :key="c.customer_id"
          class="bg-surface-container-lowest border border-outline-variant rounded-lg p-3 flex items-center justify-between shadow-sm"
        >
          <div class="flex items-center space-x-3">
            <div class="h-8 w-8 rounded-full bg-surface-container text-on-surface-variant flex items-center justify-center text-xs font-semibold">
              #{{ String(c.route_sequence).padStart(2, '0') }}
            </div>
            <div>
              <!-- Click name to view customer detail -->
              <h2 
                @click="emit('view-customer', c.customer_id)"
                class="font-customer-name text-on-surface text-sm font-bold cursor-pointer hover:underline hover:text-primary transition-all"
              >
                {{ c.name }}
              </h2>
              <p class="text-[11px] text-on-surface-variant mt-0.5">
                Delivered: <span class="font-medium text-on-surface">₹{{ (c.month_delivered_total / 100).toFixed(2) }}</span>
                <span class="mx-1 text-outline">•</span>
                Balance: <span class="font-semibold" :class="c.live_balance > 0 ? 'text-error' : 'text-green-700'">₹{{ (c.live_balance / 100).toFixed(2) }}</span>
              </p>
              
              <!-- Invoice status tag -->
              <span :class="['mt-1.5 inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase', getInvoiceBadgeColor(c.invoice_status)]">
                {{ getInvoiceBadgeLabel(c.invoice_status) }}
              </span>
            </div>
          </div>

          <div class="flex items-center space-x-2">
            <!-- View PDF button -->
            <button 
              @click="viewInvoicePDF(c)"
              :disabled="isGeneratingAll"
              class="py-1.5 px-2.5 border border-outline-variant bg-surface-container hover:bg-surface-dim text-xs font-semibold rounded-md transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center"
              title="Preview Invoice PDF"
            >
              <span class="material-symbols-outlined text-[16px]">visibility</span>
            </button>

            <!-- Generate Invoice button if not generated yet -->
            <button 
              v-if="!c.invoice_status"
              @click="generateInvoice(c)"
              :disabled="isGeneratingAll"
              class="py-1.5 px-3 border border-outline-variant bg-surface-container hover:bg-surface-dim text-xs font-semibold rounded-md transition-all active:scale-95 disabled:opacity-50"
              title="Atomically compile invoice summary"
            >
              Compile
            </button>

            <!-- Send button -->
            <button 
              v-else
              @click="shareInvoice(c)"
              :disabled="isGeneratingAll || c.invoice_status === 'SETTLED' || c.invoice_status === 'LOCKED'"
              :class="[
                'py-1.5 px-3 text-xs font-semibold rounded-md transition-all active:scale-95 disabled:opacity-50',
                c.invoice_status === 'Failed' 
                  ? 'bg-error text-on-error hover:bg-error/95' 
                  : 'border border-outline-variant bg-surface-container hover:bg-surface-dim text-primary'
              ]"
            >
              {{ c.invoice_status === 'Failed' ? 'Retry' : (c.invoice_status === 'SHARED' ? 'Resend' : 'Send') }}
            </button>
          </div>

        </div>
      </div>

    </main>
  </div>
</template>

<style scoped>
.px-gutter {
  padding-left: var(--spacing-gutter);
  padding-right: var(--spacing-gutter);
}

.pb-stack-md {
  padding-bottom: var(--spacing-stack-md);
}

.p-gutter {
  padding: var(--spacing-gutter);
}

.space-y-stack-md > :not([hidden]) ~ :not([hidden]) {
  margin-top: var(--spacing-stack-md);
}
</style>
