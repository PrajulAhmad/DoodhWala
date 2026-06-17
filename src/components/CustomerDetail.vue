<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { Capacitor } from '@capacitor/core';
import { FileOpener } from '@capacitor-community/file-opener';
import { dbService } from '../services/db';
import { pdfService } from '../services/pdf';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const props = defineProps({
  customerId: {
    type: Number,
    required: true
  }
});

const emit = defineEmits(['back']);

// State variables
const customer = ref(null);
const activeTab = ref('history'); // 'history' | 'payments' | 'subscriptions' | 'invoices'

const deliveryHistory = ref([]);
const payments = ref([]);
const subscriptions = ref([]);
const vacations = ref([]);
const invoices = ref([]);
const adjustments = ref([]);
const products = ref([]);

// Month selector state
const monthsList = ref([]);
const selectedMonthIndex = ref(0);

// Delivery Editing state
const editingDeliveryId = ref(null);
const editQty = ref(0.0);
const editStatus = ref('Delivered');
const editReason = ref('');
const editError = ref('');

// Subscription Editing state
const editingSubId = ref(null);
const editSubQty = ref(0.0);
const editSubRate = ref(0.0); // Show in Rupees
const editSubStep = ref(0.25);
const editSubError = ref('');

// Payment Logging state
const showPaymentModal = ref(false);
const payAmount = ref(0.0); // Show/input in Rupees
const payDate = ref(new Date().toISOString().split('T')[0]);
const payMode = ref('Cash'); // 'Cash' | 'UPI'
const payNotes = ref('');
const payError = ref('');

// Vacation adding state
const vacationStart = ref(new Date().toISOString().split('T')[0]);
const vacationEnd = ref(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
const vacationError = ref('');

// Adjustment form state
const showAdjustmentModal = ref(false);
const adjType = ref('CREDIT'); // 'CREDIT' | 'DEBIT'
const adjAmount = ref(0.0); // Input in Rupees
const adjReason = ref('');
const adjRefInvoiceId = ref(null);
const adjError = ref('');

// On-demand Invoice generation state
const selectedInvoiceMonthIndex = ref(0);
const genInvoiceError = ref('');

// Generate list of last 6 months for dropdown selector
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

// Outstanding Balance Badge Formatting
const formattedBalanceText = computed(() => {
  if (!customer.value) return '';
  const bal = customer.value.live_balance;
  const amt = Math.abs(bal) / 100;
  const formatted = amt.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  if (bal > 20000) {
    return `🔴 ₹${formatted} Due`;
  } else if (bal > 0 && bal <= 20000) {
    return `🟡 ₹${formatted} Due`;
  } else if (bal < 0) {
    return `🟢 ₹${formatted} Credit`;
  } else {
    return `🟢 Paid`;
  }
});

// Load Customer Profile
const loadProfile = async () => {
  try {
    const res = await dbService.getCustomerDetails(props.customerId);
    customer.value = res;
  } catch (err) {
    console.error("Failed to load customer profile:", err);
  }
};

// Load Delivery History for selected month
const loadDeliveryHistory = async () => {
  if (monthsList.value.length === 0) return;
  const sel = monthsList.value[selectedMonthIndex.value];
  try {
    const res = await dbService.getDeliveryHistory(props.customerId, sel.year, sel.month);
    deliveryHistory.value = res;
  } catch (err) {
    console.error("Failed to load delivery history:", err);
  }
};

// Load Payments
const loadPayments = async () => {
  try {
    const res = await dbService.getPayments(props.customerId);
    payments.value = res;
  } catch (err) {
    console.error("Failed to load payments:", err);
  }
};

// Load Subscriptions & Vacations
const loadSubscriptionsAndVacations = async () => {
  try {
    const subs = await dbService.getSubscriptions(props.customerId);
    subscriptions.value = subs;

    const vacs = await dbService.getVacations(props.customerId);
    vacations.value = vacs;

    const prods = await dbService.getProducts();
    products.value = prods;
  } catch (err) {
    console.error("Failed to load subscriptions/vacations:", err);
  }
};

// Load Invoices
const loadInvoices = async () => {
  try {
    const res = await dbService.getInvoices(props.customerId);
    invoices.value = res;
  } catch (err) {
    console.error("Failed to load invoices:", err);
  }
};

// Load Adjustments
const loadAdjustments = async () => {
  try {
    const res = await dbService.getAdjustments(props.customerId);
    adjustments.value = res;
  } catch (err) {
    console.error("Failed to load adjustments:", err);
  }
};

// Trigger reload on tab change
watch(activeTab, async (newTab) => {
  if (newTab === 'history') {
    await loadDeliveryHistory();
  } else if (newTab === 'payments') {
    await loadPayments();
  } else if (newTab === 'subscriptions') {
    await loadSubscriptionsAndVacations();
  } else if (newTab === 'invoices') {
    await loadInvoices();
    await loadAdjustments();
  }
});

// Trigger reload on month selection change
watch(selectedMonthIndex, async () => {
  await loadDeliveryHistory();
});

// Initialize component
onMounted(async () => {
  generateMonthsList();
  await loadProfile();
  await loadDeliveryHistory();
});

// Delivery Editing Methods
const startEditDelivery = (row) => {
  editingDeliveryId.value = row.delivery_id;
  editQty.value = row.quantity_delivered;
  editStatus.value = row.status;
  editReason.value = '';
  editError.value = '';
};

const cancelEditDelivery = () => {
  editingDeliveryId.value = null;
};

const saveEditDelivery = async () => {
  if (!editReason.value.trim()) {
    editError.value = 'Reason for correction is required.';
    return;
  }
  if (editQty.value < 0) {
    editError.value = 'Quantity cannot be negative.';
    return;
  }

  try {
    await dbService.updateDelivery(editingDeliveryId.value, {
      new_quantity: editQty.value,
      new_status: editStatus.value,
      reason_notes: editReason.value.trim()
    });

    editingDeliveryId.value = null;
    await loadProfile();
    await loadDeliveryHistory();
  } catch (err) {
    editError.value = err.message || 'Failed to update record.';
  }
};

// Subscription Toggle
const toggleSubscriptionActive = async (sub) => {
  try {
    await dbService.updateSubscription(sub.sub_id, {
      default_quantity: sub.default_quantity,
      custom_rate: sub.custom_rate,
      quantity_step: sub.quantity_step,
      is_active: sub.is_active ? 1 : 0
    });
    await loadSubscriptionsAndVacations();
  } catch (err) {
    console.error("Failed to toggle subscription:", err);
    sub.is_active = !sub.is_active; // Revert locally
  }
};

const startEditSubscription = (sub) => {
  editingSubId.value = sub.sub_id;
  editSubQty.value = sub.default_quantity;
  editSubRate.value = sub.custom_rate / 100; // paise to Rupees
  editSubStep.value = sub.quantity_step || 0.25;
  editSubError.value = '';
};

const saveEditSubscription = async (sub) => {
  if (editSubQty.value < 0) {
    editSubError.value = 'Quantity cannot be negative.';
    return;
  }
  if (editSubRate.value <= 0) {
    editSubError.value = 'Rate must be greater than 0.';
    return;
  }

  try {
    await dbService.updateSubscription(sub.sub_id, {
      default_quantity: editSubQty.value,
      custom_rate: Math.round(editSubRate.value * 100), // Rupees to paise
      quantity_step: editSubStep.value,
      is_active: sub.is_active ? 1 : 0
    });
    editingSubId.value = null;
    await loadSubscriptionsAndVacations();
  } catch (err) {
    editSubError.value = err.message || 'Failed to update subscription.';
  }
};

// Payment Logging Methods
const openPaymentModal = () => {
  payAmount.value = 0.0;
  payDate.value = new Date().toISOString().split('T')[0];
  payMode.value = 'Cash';
  payNotes.value = '';
  payError.value = '';
  showPaymentModal.value = true;
};

const savePayment = async () => {
  if (payAmount.value <= 0) {
    payError.value = 'Amount collected must be greater than zero.';
    return;
  }

  try {
    await dbService.logPayment({
      customer_id: props.customerId,
      amount_collected: Math.round(payAmount.value * 100), // Rupees to paise
      payment_date: payDate.value,
      payment_mode: payMode.value,
      notes: payNotes.value.trim()
    });

    showPaymentModal.value = false;
    await loadProfile();
    if (activeTab.value === 'payments') {
      await loadPayments();
    }
  } catch (err) {
    payError.value = err.message || 'Failed to log payment.';
  }
};

// Vacation Methods
const addVacation = async () => {
  if (!vacationStart.value || !vacationEnd.value) {
    vacationError.value = 'Start and end dates are required.';
    return;
  }
  if (new Date(vacationStart.value) > new Date(vacationEnd.value)) {
    vacationError.value = 'Start date cannot be after end date.';
    return;
  }

  try {
    await dbService.addVacation({
      customer_id: props.customerId,
      start_date: vacationStart.value,
      end_date: vacationEnd.value
    });

    vacationStart.value = new Date().toISOString().split('T')[0];
    vacationEnd.value = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    vacationError.value = '';
    await loadSubscriptionsAndVacations();
  } catch (err) {
    vacationError.value = err.message || 'Failed to add vacation.';
  }
};

const deleteVacation = async (vacationId) => {
  if (!confirm("Are you sure you want to cancel this scheduled vacation?")) return;
  try {
    await dbService.deleteVacation(vacationId);
    await loadSubscriptionsAndVacations();
  } catch (err) {
    console.error("Failed to delete vacation:", err);
  }
};

const formatInvoiceStatus = (status) => {
  switch (status) {
    case 'DRAFT': return 'bg-gray-100 text-gray-800';
    case 'GENERATED': return 'bg-blue-100 text-blue-800';
    case 'SHARED': return 'bg-amber-100 text-amber-800';
    case 'SETTLED': return 'bg-green-100 text-green-800';
    case 'LOCKED': return 'bg-purple-100 text-purple-800 border border-purple-200';
    default: return 'bg-gray-100 text-gray-800';
  }
};

const invoiceStatusLabel = (status) => {
  switch (status) {
    case 'DRAFT': return '📝 Draft';
    case 'GENERATED': return '📄 Generated';
    case 'SHARED': return '📤 Sent';
    case 'SETTLED': return '✅ Settled';
    case 'LOCKED': return '🔒 Archived';
    default: return status;
  }
};

const markInvoiceSettled = async (inv) => {
  if (!confirm(`Mark invoice ${inv.invoice_number} as SETTLED? This confirms the customer has paid.`)) return;
  try {
    await dbService.markInvoiceSettled(inv.invoice_id);
    await loadInvoices();
    await loadProfile();
  } catch (err) {
    alert(err.message || 'Failed to mark invoice as settled.');
  }
};

const markInvoiceLocked = async (inv) => {
  if (!confirm(`Archive invoice ${inv.invoice_number} permanently? This action cannot be undone.`)) return;
  try {
    await dbService.markInvoiceLocked(inv.invoice_id);
    await loadInvoices();
    await loadProfile();
  } catch (err) {
    alert(err.message || 'Failed to lock invoice.');
  }
};

const generateOnDemandInvoice = async () => {
  genInvoiceError.value = '';
  if (monthsList.value.length === 0) return;
  const sel = monthsList.value[selectedInvoiceMonthIndex.value];
  try {
    await dbService.generateInvoice(props.customerId, sel.year, sel.month);
    await loadInvoices();
    await loadProfile();
  } catch (err) {
    genInvoiceError.value = err.message || 'Failed to generate invoice.';
  }
};

const viewInvoicePDF = async (inv) => {
  try {
    const pdfBase64 = await pdfService.generateInvoicePDF(inv.invoice_id);
    
    if (Capacitor.getPlatform() === 'web') {
      const byteCharacters = atob(pdfBase64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');
    } else {
      const fileName = `DoodhWala_Invoice_${inv.invoice_number}.pdf`;
      const writeRes = await Filesystem.writeFile({
        path: fileName,
        data: pdfBase64,
        directory: Directory.Cache,
        recursive: true
      });
      await FileOpener.open({
        filePath: writeRes.uri,
        contentType: 'application/pdf',
        openWithDefault: true
      });
    }
  } catch (err) {
    console.error("Failed to view invoice PDF:", err);
    alert(err.message || 'Failed to generate PDF preview.');
  }
};

const openAdjustmentModal = () => {
  adjType.value = 'CREDIT';
  adjAmount.value = 0.0;
  adjReason.value = '';
  adjRefInvoiceId.value = null;
  adjError.value = '';
  showAdjustmentModal.value = true;
};

const saveAdjustment = async () => {
  if (adjAmount.value <= 0) {
    adjError.value = 'Amount must be greater than zero.';
    return;
  }
  if (!adjReason.value.trim()) {
    adjError.value = 'A reason is required for audit trail.';
    return;
  }
  try {
    await dbService.logAdjustment({
      customer_id: props.customerId,
      amount: Math.round(adjAmount.value * 100), // Rupees to paise
      type: adjType.value,
      reason: adjReason.value.trim(),
      reference_invoice_id: adjRefInvoiceId.value || null
    });
    showAdjustmentModal.value = false;
    await loadAdjustments();
    await loadProfile(); // Refresh live balance badge
  } catch (err) {
    adjError.value = err.message || 'Failed to save adjustment.';
  }
};

const shareInvoice = async (inv) => {
  try {
    const pdfBase64 = await pdfService.generateInvoicePDF(inv.invoice_id);
    const fileName = `DoodhWala_Invoice_${inv.invoice_number}.pdf`;
    const writeRes = await Filesystem.writeFile({
      path: fileName,
      data: pdfBase64,
      directory: Directory.Cache,
      recursive: true
    });
    await Share.share({
      title: `Invoice ${inv.invoice_number}`,
      text: `Milk Bill for ${customer.value.name} - Period: ${inv.billing_month}/${inv.billing_year}`,
      url: writeRes.uri,
      dialogTitle: `Share Invoice PDF`
    });
    await dbService.markInvoiceShared(inv.invoice_id);
    await loadInvoices();
    await loadProfile();
  } catch (err) {
    console.error("Failed to share invoice:", err);
    alert(err.message || 'Failed to share invoice.');
  }
};

</script>

<template>
  <div v-if="customer" class="pb-24">
    <!-- Header Area -->
    <header class="bg-surface-container-low px-gutter py-4 border-b border-outline-variant sticky top-[48px] z-30">
      <div class="flex items-start justify-between mb-3">
        <div class="flex items-center space-x-3">
          <button 
            @click="emit('back')" 
            class="h-10 w-10 flex items-center justify-center rounded-full bg-surface-container hover:bg-surface-dim text-on-surface transition-colors"
          >
            <span class="material-symbols-outlined">arrow_back</span>
          </button>
          <div>
            <h1 class="font-customer-name text-display-title text-on-surface leading-tight">
              {{ customer.name }}
            </h1>
            <p class="font-body-md text-on-surface-variant text-sm mt-0.5">
              📞 {{ customer.phone_number }}
            </p>
          </div>
        </div>
        <div>
          <!-- Dynamic balance badge -->
          <div class="px-3 py-1.5 rounded-full text-sm font-semibold shadow-sm border border-outline-variant bg-surface-container-lowest">
            {{ formattedBalanceText }}
          </div>
        </div>
      </div>

      <div class="flex items-center space-x-2 text-xs text-on-surface-variant mb-4">
        <span class="material-symbols-outlined text-[16px]">location_on</span>
        <span>{{ customer.address || 'No address specified' }}</span>
        <span class="text-outline">•</span>
        <span>Seq #{{ customer.route_sequence }}</span>
      </div>

      <!-- Quick Action Buttons -->
      <div class="flex space-x-3">
        <button 
          @click="openPaymentModal" 
          class="flex-1 py-2.5 px-4 rounded-lg bg-primary text-on-primary font-button-text text-sm flex items-center justify-center hover:bg-primary/95 shadow-sm transition-all active:scale-95"
        >
          <span class="material-symbols-outlined mr-2 text-[18px]">add_card</span>
          Record Payment
        </button>
        <button 
          @click="activeTab = 'invoices'" 
          class="flex-1 py-2.5 px-4 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface font-button-text text-sm flex items-center justify-center hover:bg-surface-dim transition-all active:scale-95"
        >
          <span class="material-symbols-outlined mr-2 text-[18px]">receipt_long</span>
          Billing Panel
        </button>
      </div>
    </header>

    <!-- Tab Bar -->
    <div class="flex border-b border-outline-variant sticky top-[215px] z-30 bg-surface">
      <button 
        @click="activeTab = 'history'" 
        :class="['flex-1 py-3 text-center text-sm font-medium border-b-2 transition-all', activeTab === 'history' ? 'border-primary text-primary font-bold' : 'border-transparent text-on-surface-variant hover:bg-surface-dim']"
      >
        History
      </button>
      <button 
        @click="activeTab = 'payments'" 
        :class="['flex-1 py-3 text-center text-sm font-medium border-b-2 transition-all', activeTab === 'payments' ? 'border-primary text-primary font-bold' : 'border-transparent text-on-surface-variant hover:bg-surface-dim']"
      >
        Payments
      </button>
      <button 
        @click="activeTab = 'subscriptions'" 
        :class="['flex-1 py-3 text-center text-sm font-medium border-b-2 transition-all', activeTab === 'subscriptions' ? 'border-primary text-primary font-bold' : 'border-transparent text-on-surface-variant hover:bg-surface-dim']"
      >
        Sub & Vac
      </button>
      <button 
        @click="activeTab = 'invoices'" 
        :class="['flex-1 py-3 text-center text-sm font-medium border-b-2 transition-all', activeTab === 'invoices' ? 'border-primary text-primary font-bold' : 'border-transparent text-on-surface-variant hover:bg-surface-dim']"
      >
        Invoices
      </button>
    </div>

    <!-- Main Content Container -->
    <main class="p-gutter space-y-6">

      <!-- TAB 1: DELIVERY HISTORY -->
      <div v-if="activeTab === 'history'" class="space-y-4">
        <!-- Month Selector -->
        <div class="flex justify-between items-center bg-surface-container-low p-3 rounded-lg border border-outline-variant">
          <label class="text-sm font-medium text-on-surface">View Period:</label>
          <select 
            v-model="selectedMonthIndex" 
            class="bg-surface-container-lowest border border-outline-variant rounded px-2 py-1 text-sm text-on-surface focus:outline-none"
          >
            <option v-for="(m, idx) in monthsList" :key="idx" :value="idx">
              {{ m.label }}
            </option>
          </select>
        </div>

        <!-- Empty History -->
        <div v-if="deliveryHistory.length === 0" class="py-12 text-center bg-surface-container-lowest rounded-lg border border-outline-variant p-6">
          <span class="material-symbols-outlined text-[48px] text-on-surface-variant mb-2">history</span>
          <h3 class="font-customer-name text-on-surface mb-1">No Deliveries Logged</h3>
          <p class="font-body-md text-on-surface-variant text-sm">No transactions were recorded during this period.</p>
        </div>

        <!-- History Table List -->
        <div v-else class="space-y-3">
          <div v-for="row in deliveryHistory" :key="row.delivery_id" class="bg-surface-container-lowest rounded-lg border border-outline-variant p-3 shadow-sm">
            
            <!-- Default View Mode -->
            <div v-if="editingDeliveryId !== row.delivery_id" class="flex items-center justify-between">
              <div class="flex items-start space-x-3">
                <div class="mt-1 flex items-center justify-center w-8 h-8 rounded-full" :class="row.status === 'Delivered' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'">
                  <span class="material-symbols-outlined text-[20px]">{{ row.delivery_shift === 0 ? 'light_mode' : 'dark_mode' }}</span>
                </div>
                <div>
                  <h4 class="font-semibold text-on-surface text-sm flex items-center">
                    {{ new Date(row.delivery_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', weekday: 'short' }) }}
                    <span class="text-xs font-normal text-on-surface-variant ml-2">({{ row.delivery_shift === 0 ? 'Morning' : 'Evening' }})</span>
                  </h4>
                  <p class="text-xs text-on-surface-variant mt-0.5">
                    {{ row.product_name }}: {{ row.quantity_delivered.toFixed(2) }}L @ ₹{{ (row.rate_applied / 100).toFixed(2) }}/L
                  </p>
                  <div class="mt-1 flex items-center gap-1.5">
                    <span :class="['px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase', row.status === 'Delivered' ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700']">
                      {{ row.status }}
                    </span>
                    <span v-if="row.revision_number > 1" class="text-[10px] text-primary bg-primary-container/20 px-1.5 py-0.5 rounded">
                      Rev {{ row.revision_number }}
                    </span>
                  </div>
                </div>
              </div>
              
              <div class="flex items-center space-x-2">
                <div class="text-right mr-2">
                  <p class="font-bold text-on-surface text-sm">
                    ₹{{ ((row.quantity_delivered * row.rate_applied) / 100).toFixed(2) }}
                  </p>
                </div>
                
                <!-- Edit Action -->
                <!-- Enabled if within 7 days and NOT locked invoice -->
                <button 
                  v-if="row.edit_window_open === 1 && row.is_locked === 0" 
                  @click="startEditDelivery(row)"
                  class="h-9 w-9 rounded-full bg-surface-container hover:bg-surface-dim text-primary flex items-center justify-center transition-all active:scale-95"
                  title="Correct delivery entry"
                >
                  <span class="material-symbols-outlined text-[18px]">edit</span>
                </button>
                <div 
                  v-else 
                  class="h-9 w-9 rounded-full text-on-surface-variant flex items-center justify-center bg-gray-50 border border-gray-100"
                  :title="row.is_locked === 1 ? 'Locked: Invoice finalized.' : 'Locked: Passed 7-day correction window.'"
                >
                  <span class="material-symbols-outlined text-[18px]">lock</span>
                </div>
              </div>
            </div>

            <!-- Inline Editor Mode -->
            <div v-else class="space-y-3 p-1">
              <div class="flex justify-between items-center border-b border-surface-variant pb-2">
                <span class="text-xs font-bold text-primary">Correct Entry (Date: {{ row.delivery_date }})</span>
                <span class="text-[11px] text-on-surface-variant">Original: {{ row.quantity_delivered }}L ({{ row.status }})</span>
              </div>
              
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="text-[11px] block font-semibold text-on-surface mb-1">New Quantity (Litre)</label>
                  <input 
                    v-model.number="editQty" 
                    type="number" 
                    step="0.25" 
                    class="w-full border border-outline-variant bg-surface rounded px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label class="text-[11px] block font-semibold text-on-surface mb-1">New Status</label>
                  <select 
                    v-model="editStatus" 
                    class="w-full border border-outline-variant bg-surface rounded px-2.5 py-1.5 text-sm"
                  >
                    <option value="Delivered">Delivered</option>
                    <option value="Skipped">Skipped</option>
                  </select>
                </div>
              </div>

              <div>
                <label class="text-[11px] block font-semibold text-on-surface mb-1">Reason for correction (Required for Audit Log)</label>
                <input 
                  v-model="editReason" 
                  type="text" 
                  placeholder="e.g. Spilled milk, incorrect entry, customer requested skip"
                  class="w-full border border-outline-variant bg-surface rounded px-2.5 py-1.5 text-sm placeholder:text-on-surface-variant/70"
                />
              </div>

              <p v-if="editError" class="text-xs text-error font-medium">{{ editError }}</p>

              <div class="flex space-x-3 pt-1">
                <button 
                  @click="cancelEditDelivery" 
                  class="flex-1 py-1.5 rounded border border-outline-variant text-on-surface text-xs bg-transparent hover:bg-surface-dim"
                >
                  Cancel
                </button>
                <button 
                  @click="saveEditDelivery" 
                  class="flex-1 py-1.5 rounded bg-primary text-on-primary text-xs hover:bg-primary/95 font-semibold"
                >
                  Save Correction
                </button>
              </div>
            </div>

          </div>
        </div>
      </div>

      <!-- TAB 2: PAYMENTS LEDGER -->
      <div v-if="activeTab === 'payments'" class="space-y-4">
        
        <!-- Inline Payments header -->
        <div class="flex justify-between items-center">
          <h3 class="font-bold text-on-surface text-base">Payment Receipts</h3>
          <button 
            @click="openPaymentModal" 
            class="py-1 px-3 bg-primary-container text-on-primary-container border border-primary-container rounded-full text-xs font-semibold hover:bg-primary-container/80 flex items-center"
          >
            <span class="material-symbols-outlined text-[16px] mr-1">add</span>
            Add Receipt
          </button>
        </div>

        <!-- Empty Payments -->
        <div v-if="payments.length === 0" class="py-12 text-center bg-surface-container-lowest rounded-lg border border-outline-variant p-6">
          <span class="material-symbols-outlined text-[48px] text-on-surface-variant mb-2">payments</span>
          <h3 class="font-customer-name text-on-surface mb-1">No Payments Logged</h3>
          <p class="font-body-md text-on-surface-variant text-sm">No transactions were recorded during this period.</p>
        </div>

        <!-- Payments list -->
        <div v-else class="space-y-3">
          <div v-for="pay in payments" :key="pay.pay_id" class="bg-surface-container-lowest rounded-lg border border-outline-variant p-3 flex items-center justify-between shadow-sm">
            <div class="flex items-center space-x-3">
              <div class="w-8 h-8 rounded-full bg-green-50 text-green-700 flex items-center justify-center font-bold text-xs">
                {{ pay.payment_mode === 'Cash' ? '💵' : '📱' }}
              </div>
              <div>
                <h4 class="font-semibold text-on-surface text-sm">
                  {{ new Date(pay.payment_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) }}
                </h4>
                <p class="text-xs text-on-surface-variant mt-0.5">
                  Mode: {{ pay.payment_mode }} <span v-if="pay.notes" class="text-outline">•</span> {{ pay.notes }}
                </p>
              </div>
            </div>
            <div class="text-right">
              <span class="font-bold text-green-700 text-sm">
                -₹{{ (pay.amount_collected / 100).toFixed(2) }}
              </span>
            </div>
          </div>
        </div>

      </div>

      <!-- TAB 3: SUBSCRIPTIONS & VACATIONS -->
      <div v-if="activeTab === 'subscriptions'" class="space-y-6">
        
        <!-- Active Subscriptions -->
        <div class="space-y-3">
          <h3 class="font-bold text-on-surface text-base">Active Subscription Slots</h3>
          
          <div v-for="slot in [0, 1]" :key="slot" class="bg-surface-container-lowest rounded-lg border border-outline-variant overflow-hidden shadow-sm">
            
            <!-- Check if slot has subscription -->
            <!-- We will query array for delivery_shift matching slot -->
            <template v-with="sub = subscriptions.find(s => s.delivery_shift === slot)">
              <div v-if="sub" class="p-4">
                
                <!-- Display Mode -->
                <div v-if="editingSubId !== sub.sub_id" class="flex justify-between items-start">
                  <div>
                    <h4 class="font-semibold text-on-surface text-sm flex items-center">
                      <span class="material-symbols-outlined text-[18px] mr-1.5 text-primary">
                        {{ slot === 0 ? 'light_mode' : 'dark_mode' }}
                      </span>
                      {{ slot === 0 ? 'Morning Delivery' : 'Evening Delivery' }}
                    </h4>
                    
                    <p class="text-xs text-on-surface-variant mt-2">
                      Product: <span class="font-medium text-on-surface">{{ sub.product_name }}</span>
                    </p>
                    <p class="text-xs text-on-surface-variant mt-1">
                      Qty: <span class="font-medium text-on-surface">{{ sub.default_quantity.toFixed(2) }} L</span>
                    </p>
                    <p class="text-xs text-on-surface-variant mt-1">
                      Rate: <span class="font-medium text-on-surface">₹{{ (sub.custom_rate / 100).toFixed(2) }} per Litre</span>
                    </p>
                    <p class="text-xs text-on-surface-variant mt-1">
                      Step Size: <span class="font-medium text-on-surface">±{{ sub.quantity_step || 0.25 }} L</span>
                    </p>
                  </div>

                  <div class="flex flex-col items-end space-y-4">
                    <!-- Toggle active -->
                    <label class="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        v-model="sub.is_active" 
                        :true-value="1"
                        :false-value="0"
                        @change="toggleSubscriptionActive(sub)"
                        class="sr-only peer"
                      />
                      <div class="w-11 h-6 bg-surface-variant peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                    </label>

                    <button 
                      @click="startEditSubscription(sub)"
                      class="py-1 px-3 border border-outline-variant bg-surface-container rounded-md text-xs text-primary font-semibold hover:bg-surface-dim transition-all"
                    >
                      Configure
                    </button>
                  </div>
                </div>

                <!-- Editing Mode -->
                <div v-else class="space-y-3">
                  <div class="flex justify-between items-center border-b border-surface-variant pb-2">
                    <span class="text-xs font-bold text-primary">Configure Subscription</span>
                  </div>

                  <div class="grid grid-cols-2 gap-3">
                    <div>
                      <label class="text-[11px] block font-semibold text-on-surface mb-1">Default Quantity</label>
                      <input 
                        v-model.number="editSubQty" 
                        type="number" 
                        step="0.25" 
                        class="w-full border border-outline-variant bg-surface rounded px-2.5 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label class="text-[11px] block font-semibold text-on-surface mb-1">Custom Rate (₹/L)</label>
                      <input 
                        v-model.number="editSubRate" 
                        type="number" 
                        step="0.5" 
                        class="w-full border border-outline-variant bg-surface rounded px-2.5 py-1.5 text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label class="text-[11px] block font-semibold text-on-surface mb-1">Adjust Quantity Step Size</label>
                    <select 
                      v-model.number="editSubStep" 
                      class="w-full border border-outline-variant bg-surface rounded px-2.5 py-1.5 text-sm"
                    >
                      <option :value="0.25">0.25 Litre Steps (Standard)</option>
                      <option :value="0.5">0.50 Litre Steps (Bulk)</option>
                    </select>
                  </div>

                  <p v-if="editSubError" class="text-xs text-error font-medium">{{ editSubError }}</p>

                  <div class="flex space-x-3 pt-1">
                    <button 
                      @click="editingSubId = null" 
                      class="flex-1 py-1.5 rounded border border-outline-variant text-on-surface text-xs bg-transparent hover:bg-surface-dim"
                    >
                      Cancel
                    </button>
                    <button 
                      @click="saveEditSubscription(sub)" 
                      class="flex-1 py-1.5 rounded bg-primary text-on-primary text-xs hover:bg-primary/95 font-semibold"
                    >
                      Save Configuration
                    </button>
                  </div>
                </div>

              </div>

              <!-- Slot Empty State -->
              <div v-else class="p-4 flex flex-col items-center justify-center py-6 text-center text-xs text-on-surface-variant">
                <span class="material-symbols-outlined text-[32px] mb-1 text-on-surface-variant">add_circle_outline</span>
                <p class="font-medium">No active subscription for {{ slot === 0 ? 'Morning' : 'Evening' }}.</p>
                <span class="text-[10px] mt-0.5">To add a slot, use Add/Edit Customer (Phase 8).</span>
              </div>
            </template>
          </div>
        </div>

        <!-- Vacation Schedules -->
        <div class="space-y-4 pt-2 border-t border-outline-variant">
          <h3 class="font-bold text-on-surface text-base">Vacation Planner</h3>

          <!-- Add Vacation Form -->
          <div class="bg-surface-container-low rounded-lg border border-outline-variant p-4 space-y-3">
            <h4 class="text-xs font-bold text-on-surface flex items-center">
              <span class="material-symbols-outlined text-[16px] mr-1">calendar_today</span>
              Schedule Vacation Date Range
            </h4>
            
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-[10px] block font-semibold text-on-surface mb-1">Start Date</label>
                <input 
                  v-model="vacationStart" 
                  type="date" 
                  class="w-full border border-outline-variant bg-surface rounded px-2.5 py-1.5 text-xs text-on-surface focus:outline-none"
                />
              </div>
              <div>
                <label class="text-[10px] block font-semibold text-on-surface mb-1">End Date</label>
                <input 
                  v-model="vacationEnd" 
                  type="date" 
                  class="w-full border border-outline-variant bg-surface rounded px-2.5 py-1.5 text-xs text-on-surface focus:outline-none"
                />
              </div>
            </div>

            <p v-if="vacationError" class="text-xs text-error font-medium">{{ vacationError }}</p>

            <button 
              @click="addVacation"
              class="w-full py-2 bg-primary text-on-primary rounded font-button-text text-xs hover:bg-primary/95 shadow-sm transition-all"
            >
              Add Scheduled Pause
            </button>
          </div>

          <!-- Active Vacation List -->
          <div class="space-y-2">
            <h4 class="text-xs font-bold text-on-surface-variant">Scheduled Pauses</h4>
            
            <div v-if="vacations.length === 0" class="text-center py-4 bg-surface-container-lowest border border-dashed border-outline-variant rounded-lg text-xs text-on-surface-variant">
              No vacations scheduled. Delivery runs will occur normally.
            </div>
            
            <div v-else class="space-y-2">
              <div v-for="vac in vacations" :key="vac.vacation_id" class="bg-surface-container-lowest rounded-lg border border-outline-variant p-3 flex items-center justify-between text-xs">
                <div class="flex items-center space-x-2">
                  <span class="material-symbols-outlined text-[18px] text-amber-500">flight_takeoff</span>
                  <div>
                    <p class="font-bold text-on-surface">
                      {{ new Date(vac.start_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) }}
                      →
                      {{ new Date(vac.end_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) }}
                    </p>
                    <span class="text-[10px] text-green-700 bg-green-50 px-1 rounded font-semibold mt-0.5 inline-block">Active Schedule</span>
                  </div>
                </div>
                <button 
                  @click="deleteVacation(vac.vacation_id)"
                  class="h-8 w-8 rounded bg-gray-50 border border-gray-200 text-error flex items-center justify-center hover:bg-error/5 transition-all active:scale-95"
                  title="Remove vacation schedule"
                >
                  <span class="material-symbols-outlined text-[16px]">delete</span>
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>

      <!-- TAB 4: INVOICES PANEL -->
      <div v-if="activeTab === 'invoices'" class="space-y-4">
        <div class="flex justify-between items-center">
          <h3 class="font-bold text-on-surface text-base">Invoices Ledger</h3>
          <span class="text-[10px] text-on-surface-variant bg-surface-container-low px-2 py-0.5 rounded">
            Integrated in Phase 11
          </span>
        </div>

        <!-- Generate On-Demand Invoice Card -->
        <div class="bg-surface-container-low rounded-xl border border-outline-variant p-4 space-y-3 shadow-sm">
          <div class="flex items-center space-x-2">
            <span class="material-symbols-outlined text-primary text-[20px]">magic_button</span>
            <h4 class="text-sm font-bold text-on-surface">Generate On-Demand Invoice</h4>
          </div>
          <p class="text-xs text-on-surface-variant leading-relaxed">
            Compile deliveries, payments, and adjustments for any period to create or update an invoice immediately.
          </p>
          <div class="flex items-center space-x-3">
            <div class="flex-1">
              <select 
                v-model="selectedInvoiceMonthIndex" 
                class="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-xs text-on-surface focus:outline-none focus:border-primary"
              >
                <option v-for="(m, idx) in monthsList" :key="idx" :value="idx">
                  {{ m.label }}
                </option>
              </select>
            </div>
            <button 
              @click="generateOnDemandInvoice"
              class="py-2 px-4 rounded-lg bg-primary text-on-primary font-semibold text-xs hover:bg-primary/95 shadow-sm transition-all active:scale-95 flex items-center"
            >
              <span class="material-symbols-outlined text-[14px] mr-1">receipt_long</span>
              Generate
            </button>
          </div>
          <p v-if="genInvoiceError" class="text-xs text-error font-medium mt-1">{{ genInvoiceError }}</p>
        </div>

        <!-- List or Placeholder -->
        <div v-if="invoices.length === 0" class="py-12 text-center bg-surface-container-lowest rounded-lg border border-outline-variant p-6">
          <span class="material-symbols-outlined text-[48px] text-on-surface-variant mb-2">receipt_long</span>
          <h3 class="font-customer-name text-on-surface mb-1">No Invoices Finalized</h3>
          <p class="font-body-md text-on-surface-variant text-sm mb-1">Billing summaries compile at month-end.</p>
          <p class="text-xs text-on-surface-variant">Use the card above to generate a new invoice on demand.</p>
        </div>

        <div v-else class="space-y-3">
          <div v-for="inv in invoices" :key="inv.invoice_id" class="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
            <!-- Invoice Summary Row -->
            <div class="p-3 flex items-start justify-between">
              <div>
                <h4 class="font-semibold text-on-surface text-sm">{{ inv.invoice_number }}</h4>
                <p class="text-xs text-on-surface-variant mt-0.5">
                  Period: {{ inv.billing_month }}/{{ inv.billing_year }}
                </p>
                <div class="flex items-center gap-2 mt-1.5">
                  <span :class="['inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold', formatInvoiceStatus(inv.billing_status)]">
                    {{ invoiceStatusLabel(inv.billing_status) }}
                  </span>
                </div>
              </div>
              <div class="text-right">
                <p class="font-bold text-on-surface text-base">₹{{ (inv.grand_total / 100).toFixed(2) }}</p>
                <p class="text-[10px] text-on-surface-variant mt-0.5">Grand Total</p>
              </div>
            </div>

            <!-- Invoice Financial Breakdown -->
            <div class="bg-surface-container-low px-3 py-2 text-[11px] text-on-surface-variant grid grid-cols-2 gap-1 border-t border-outline-variant">
              <span>Prev Outstanding</span>
              <span class="text-right font-medium text-on-surface">₹{{ (inv.previous_outstanding / 100).toFixed(2) }}</span>
              <span>This Month Charges</span>
              <span class="text-right font-medium text-on-surface">₹{{ (inv.current_month_total / 100).toFixed(2) }}</span>
              <span>Payments Received</span>
              <span class="text-right font-medium text-green-700">-₹{{ (inv.payments_received / 100).toFixed(2) }}</span>
              <span v-if="inv.net_adjustments !== 0">Net Adjustments</span>
              <span v-if="inv.net_adjustments !== 0" :class="['text-right font-medium', inv.net_adjustments > 0 ? 'text-error' : 'text-green-700']">
                {{ inv.net_adjustments > 0 ? '+' : '' }}₹{{ (inv.net_adjustments / 100).toFixed(2) }}
              </span>
            </div>

            <!-- Invoice Action Buttons -->
            <div class="px-3 py-2 flex gap-2 border-t border-outline-variant">
              <!-- View PDF -->
              <button
                @click="viewInvoicePDF(inv)"
                class="flex-1 py-1.5 text-xs font-semibold rounded-lg border border-outline-variant bg-surface-container hover:bg-surface-dim text-on-surface flex items-center justify-center gap-1 transition-all active:scale-95"
              >
                <span class="material-symbols-outlined text-[14px]">visibility</span>
                View PDF
              </button>

              <!-- Share — available when GENERATED or SHARED (resend) -->
              <button
                v-if="inv.billing_status === 'GENERATED' || inv.billing_status === 'SHARED'"
                @click="shareInvoice(inv)"
                class="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-primary text-on-primary hover:bg-primary/90 flex items-center justify-center gap-1 transition-all active:scale-95"
              >
                <span class="material-symbols-outlined text-[14px]">share</span>
                {{ inv.billing_status === 'SHARED' ? 'Resend PDF' : 'Share PDF' }}
              </button>

              <!-- Mark Settled — available when SHARED -->
              <button
                v-if="inv.billing_status === 'SHARED'"
                @click="markInvoiceSettled(inv)"
                class="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700 flex items-center justify-center gap-1 transition-all active:scale-95"
              >
                <span class="material-symbols-outlined text-[14px]">check_circle</span>
                Mark Settled
              </button>

              <!-- Archive — available when SETTLED -->
              <button
                v-if="inv.billing_status === 'SETTLED'"
                @click="markInvoiceLocked(inv)"
                class="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-purple-600 text-white hover:bg-purple-700 flex items-center justify-center gap-1 transition-all active:scale-95"
              >
                <span class="material-symbols-outlined text-[14px]">lock</span>
                Archive Permanently
              </button>

              <!-- Locked badge -->
              <div
                v-if="inv.billing_status === 'LOCKED'"
                class="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 text-gray-400 flex items-center justify-center gap-1"
              >
                <span class="material-symbols-outlined text-[14px]">lock</span>
                Archived — Read Only
              </div>
            </div>
          </div>
        </div>

        <!-- Adjustments Section -->
        <div class="mt-6 space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="font-bold text-on-surface text-sm">Adjustments &amp; Corrections</h3>
            <button
              @click="openAdjustmentModal"
              class="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-secondary/90 shadow-sm transition-all active:scale-95"
            >
              <span class="material-symbols-outlined text-[14px]">tune</span>
              Add Adjustment
            </button>
          </div>

          <p class="text-[11px] text-on-surface-variant">
            Use adjustments to record credits (reduces balance) or debits (increases balance) against locked invoices or for corrections that cannot be undone via delivery edits.
          </p>

          <div v-if="adjustments.length === 0" class="py-6 text-center bg-surface-container-lowest border border-dashed border-outline-variant rounded-lg text-xs text-on-surface-variant">
            No adjustments recorded for this customer.
          </div>

          <div v-else class="space-y-2">
            <div v-for="adj in adjustments" :key="adj.adjustment_id" class="flex items-start justify-between bg-surface-container-lowest border border-outline-variant rounded-lg p-3 text-xs">
              <div>
                <span :class="['inline-block px-1.5 py-0.5 rounded font-bold text-[10px] mr-1', adj.type === 'CREDIT' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800']">
                  {{ adj.type }}
                </span>
                <span class="font-medium text-on-surface">{{ adj.reason }}</span>
                <p v-if="adj.reference_invoice_number" class="text-[10px] text-on-surface-variant mt-0.5">
                  Ref: {{ adj.reference_invoice_number }}
                </p>
                <p class="text-[10px] text-on-surface-variant mt-0.5">
                  {{ new Date(adj.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) }}
                </p>
              </div>
              <span :class="['font-bold text-sm ml-2', adj.type === 'CREDIT' ? 'text-green-700' : 'text-error']">
                {{ adj.type === 'CREDIT' ? '-' : '+' }}₹{{ (adj.amount / 100).toFixed(2) }}
              </span>
            </div>
          </div>
        </div>

      </div>

    </main>

    <!-- Payment Logging Modal (Dialog overlay) -->
    <div v-if="showPaymentModal" class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/55 backdrop-blur-sm transition-opacity">
      <div class="bg-surface border border-outline-variant rounded-xl max-w-sm w-full overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        
        <div class="bg-surface-container-low px-5 py-4 border-b border-outline-variant flex justify-between items-center">
          <h3 class="font-bold text-on-surface text-sm flex items-center">
            <span class="material-symbols-outlined mr-1.5 text-primary text-[20px]">add_card</span>
            Log Payment Receipt
          </h3>
          <button @click="showPaymentModal = false" class="h-8 w-8 text-on-surface-variant hover:bg-surface-dim rounded-full flex items-center justify-center">
            <span class="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div class="p-5 space-y-4">
          <div>
            <label class="text-[11px] block font-semibold text-on-surface mb-1">Amount Collected (Rupees)</label>
            <input 
              v-model.number="payAmount" 
              type="number" 
              step="1"
              placeholder="e.g. 500"
              class="w-full border border-outline-variant bg-surface rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
            />
          </div>

          <div>
            <label class="text-[11px] block font-semibold text-on-surface mb-1">Receipt Date</label>
            <input 
              v-model="payDate" 
              type="date" 
              class="w-full border border-outline-variant bg-surface rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
            />
          </div>

          <div>
            <label class="text-[11px] block font-semibold text-on-surface mb-1">Payment Mode</label>
            <div class="flex bg-surface-variant rounded-lg p-1">
              <button 
                @click="payMode = 'Cash'" 
                :class="['flex-1 py-1.5 text-center text-xs font-semibold rounded-md transition-all', payMode === 'Cash' ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:bg-surface-dim']"
              >
                💵 Cash
              </button>
              <button 
                @click="payMode = 'UPI'" 
                :class="['flex-1 py-1.5 text-center text-xs font-semibold rounded-md transition-all', payMode === 'UPI' ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:bg-surface-dim']"
              >
                📱 UPI
              </button>
            </div>
          </div>

          <div>
            <label class="text-[11px] block font-semibold text-on-surface mb-1">Notes (Optional)</label>
            <input 
              v-model="payNotes" 
              type="text" 
              placeholder="e.g. Advance pay, invoice settled"
              class="w-full border border-outline-variant bg-surface rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
            />
          </div>

          <p v-if="payError" class="text-xs text-error font-medium">{{ payError }}</p>
        </div>

        <div class="px-5 py-4 bg-surface-container-low border-t border-outline-variant flex space-x-3">
          <button 
            @click="showPaymentModal = false" 
            class="flex-1 py-2 rounded-lg border border-outline-variant text-on-surface font-semibold text-xs bg-transparent hover:bg-surface-dim"
          >
            Cancel
          </button>
          <button 
            @click="savePayment" 
            class="flex-1 py-2 rounded-lg bg-primary text-on-primary font-semibold text-xs hover:bg-primary/95 shadow-sm"
          >
            Record Receipt
          </button>
        </div>

      </div>
    </div>

    <!-- Adjustment Modal -->
    <div v-if="showAdjustmentModal" class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/55 backdrop-blur-sm">
      <div class="bg-surface border border-outline-variant rounded-xl max-w-sm w-full overflow-hidden shadow-2xl">

        <div class="bg-surface-container-low px-5 py-4 border-b border-outline-variant flex justify-between items-center">
          <h3 class="font-bold text-on-surface text-sm flex items-center">
            <span class="material-symbols-outlined mr-1.5 text-secondary text-[20px]">tune</span>
            Add Balance Adjustment
          </h3>
          <button @click="showAdjustmentModal = false" class="h-8 w-8 text-on-surface-variant hover:bg-surface-dim rounded-full flex items-center justify-center">
            <span class="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div class="p-5 space-y-4">
          <!-- Type Toggle -->
          <div>
            <label class="text-[11px] block font-semibold text-on-surface mb-1">Adjustment Type</label>
            <div class="flex bg-surface-variant rounded-lg p-1">
              <button
                @click="adjType = 'CREDIT'"
                :class="['flex-1 py-1.5 text-center text-xs font-semibold rounded-md transition-all', adjType === 'CREDIT' ? 'bg-green-600 text-white shadow-sm' : 'text-on-surface-variant hover:bg-surface-dim']"
              >
                ✅ CREDIT (Reduces Balance)
              </button>
              <button
                @click="adjType = 'DEBIT'"
                :class="['flex-1 py-1.5 text-center text-xs font-semibold rounded-md transition-all', adjType === 'DEBIT' ? 'bg-red-600 text-white shadow-sm' : 'text-on-surface-variant hover:bg-surface-dim']"
              >
                ➕ DEBIT (Increases Balance)
              </button>
            </div>
            <p class="text-[10px] text-on-surface-variant mt-1">
              <span v-if="adjType === 'CREDIT'">CREDIT: Use for overcharge corrections, goodwill discounts, or advance payments that weren't captured as PaymentLog entries.</span>
              <span v-else>DEBIT: Use for late fees, damage charges, or extra services not covered in the regular delivery log.</span>
            </p>
          </div>

          <div>
            <label class="text-[11px] block font-semibold text-on-surface mb-1">Amount (Rupees)</label>
            <input
              v-model.number="adjAmount"
              type="number"
              step="1"
              min="1"
              placeholder="e.g. 50"
              class="w-full border border-outline-variant bg-surface rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
            />
          </div>

          <div>
            <label class="text-[11px] block font-semibold text-on-surface mb-1">Reason (Required for Audit)</label>
            <input
              v-model="adjReason"
              type="text"
              placeholder="e.g. Overcharge correction for June invoice"
              class="w-full border border-outline-variant bg-surface rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
            />
          </div>

          <!-- Reference Invoice (optional) -->
          <div v-if="invoices.length > 0">
            <label class="text-[11px] block font-semibold text-on-surface mb-1">Reference Invoice (Optional)</label>
            <select
              v-model="adjRefInvoiceId"
              class="w-full border border-outline-variant bg-surface rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
            >
              <option :value="null">None</option>
              <option v-for="inv in invoices" :key="inv.invoice_id" :value="inv.invoice_id">
                {{ inv.invoice_number }} ({{ inv.billing_month }}/{{ inv.billing_year }})
              </option>
            </select>
          </div>

          <p v-if="adjError" class="text-xs text-error font-medium">{{ adjError }}</p>
        </div>

        <div class="px-5 py-4 bg-surface-container-low border-t border-outline-variant flex space-x-3">
          <button
            @click="showAdjustmentModal = false"
            class="flex-1 py-2 rounded-lg border border-outline-variant text-on-surface font-semibold text-xs bg-transparent hover:bg-surface-dim"
          >
            Cancel
          </button>
          <button
            @click="saveAdjustment"
            :class="['flex-1 py-2 rounded-lg font-semibold text-xs text-white shadow-sm', adjType === 'CREDIT' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700']"
          >
            Save {{ adjType }} Adjustment
          </button>
        </div>

      </div>
    </div>

  </div>
</template>

<style scoped>
.px-gutter {
  padding-left: var(--spacing-gutter);
  padding-right: var(--spacing-gutter);
}

.p-gutter {
  padding: var(--spacing-gutter);
}
</style>
