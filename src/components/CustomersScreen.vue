<script setup>
import { ref, onMounted, computed } from 'vue';
import { dbService } from '../services/db';

const emit = defineEmits(['view-customer']);

// State
const customers = ref([]);
const searchQuery = ref('');
const products = ref([]);

// Form modes: 'list' | 'add' | 'edit'
const mode = ref('list');
const selectedCustomer = ref(null);

// Form Fields
const name = ref('');
const phone = ref('');
const address = ref('');
const routeSequence = ref(1);
const specialNotes = ref('');
const autoInvoice = ref(true);

// Subscription Fields
const morningEnabled = ref(false);
const morningProduct = ref('');
const morningQty = ref(1.0);
const morningRate = ref(65);
const morningStep = ref(0.25);

const eveningEnabled = ref(false);
const eveningProduct = ref('');
const eveningQty = ref(0.5);
const eveningRate = ref(65);
const eveningStep = ref(0.25);

const formError = ref('');

// Load active customers and products
const loadData = async () => {
  try {
    const res = await dbService.query("SELECT * FROM Customers WHERE deleted_at IS NULL ORDER BY route_sequence ASC;");
    customers.value = res.values || [];

    const prodRes = await dbService.getProducts();
    products.value = prodRes;
    
    // Set default products if available
    if (products.value.length > 0) {
      morningProduct.value = products.value[0].product_id;
      eveningProduct.value = products.value[0].product_id;
    }
  } catch (err) {
    console.error("Failed to load customer registry data:", err);
  }
};

onMounted(async () => {
  while (!dbService.initialized) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await loadData();
});

// Filtered customers list
const filteredCustomers = computed(() => {
  const q = searchQuery.value.toLowerCase().trim();
  if (!q) return customers.value;
  return customers.value.filter(c => 
    c.name.toLowerCase().includes(q) || 
    c.phone_number.includes(q) ||
    (c.address && c.address.toLowerCase().includes(q))
  );
});

// Reset form fields
const resetForm = () => {
  name.value = '';
  phone.value = '';
  address.value = '';
  routeSequence.value = customers.value.length + 1;
  specialNotes.value = '';
  autoInvoice.value = true;

  morningEnabled.value = false;
  morningQty.value = 1.0;
  morningRate.value = 65;
  morningStep.value = 0.25;

  eveningEnabled.value = false;
  eveningQty.value = 0.5;
  eveningRate.value = 65;
  eveningStep.value = 0.25;

  if (products.value.length > 0) {
    morningProduct.value = products.value[0].product_id;
    eveningProduct.value = products.value[0].product_id;
  }

  formError.value = '';
};

// Enter add mode
const startAdd = () => {
  resetForm();
  mode.value = 'add';
};

// Enter edit mode
const startEdit = async (cust) => {
  selectedCustomer.value = cust;
  name.value = cust.name;
  phone.value = cust.phone_number;
  address.value = cust.address || '';
  routeSequence.value = cust.route_sequence;
  specialNotes.value = cust.special_notes || '';
  autoInvoice.value = cust.auto_invoice_delivery === 1;

  morningEnabled.value = false;
  eveningEnabled.value = false;

  if (products.value.length > 0) {
    morningProduct.value = products.value[0].product_id;
    eveningProduct.value = products.value[0].product_id;
  } else {
    morningProduct.value = '';
    eveningProduct.value = '';
  }

  try {
    const subRes = await dbService.getSubscriptions(cust.customer_id);
    const subs = subRes || [];
    
    const morningSub = subs.find(s => s.delivery_shift === 0);
    if (morningSub && morningSub.is_active === 1) {
      morningEnabled.value = true;
      morningProduct.value = morningSub.product_id;
      morningQty.value = morningSub.default_quantity;
      morningRate.value = morningSub.custom_rate / 100; // paise to Rupees
      morningStep.value = morningSub.quantity_step || 0.25;
    }

    const eveningSub = subs.find(s => s.delivery_shift === 1);
    if (eveningSub && eveningSub.is_active === 1) {
      eveningEnabled.value = true;
      eveningProduct.value = eveningSub.product_id;
      eveningQty.value = eveningSub.default_quantity;
      eveningRate.value = eveningSub.custom_rate / 100;
      eveningStep.value = eveningSub.quantity_step || 0.25;
    }
  } catch (err) {
    console.error("Failed to load subscriptions for editing:", err);
  }

  mode.value = 'edit';
};

// Save customer
const saveCustomer = async () => {
  if (!name.value.trim()) {
    formError.value = 'Full Name is required.';
    return;
  }
  if (!phone.value.trim() || phone.value.trim().length < 10) {
    formError.value = 'Valid Phone Number is required.';
    return;
  }
  if (!morningEnabled.value && !eveningEnabled.value) {
    formError.value = 'At least one delivery slot subscription (Morning or Evening) must be enabled.';
    return;
  }
  if (morningEnabled.value && !morningProduct.value) {
    formError.value = 'Morning delivery shift product is required.';
    return;
  }
  if (eveningEnabled.value && !eveningProduct.value) {
    formError.value = 'Evening delivery shift product is required.';
    return;
  }

  const customerData = {
    name: name.value.trim(),
    phone_number: phone.value.trim(),
    address: address.value.trim(),
    route_sequence: routeSequence.value,
    special_notes: specialNotes.value.trim(),
    auto_invoice_delivery: autoInvoice.value ? 1 : 0,
    subscriptions: [
      {
        delivery_shift: 0,
        product_id: morningProduct.value,
        default_quantity: morningQty.value,
        custom_rate: Math.round(morningRate.value * 100), // Rupees to paise
        quantity_step: morningStep.value,
        is_deleted: !morningEnabled.value
      },
      {
        delivery_shift: 1,
        product_id: eveningProduct.value,
        default_quantity: eveningQty.value,
        custom_rate: Math.round(eveningRate.value * 100), // Rupees to paise
        quantity_step: eveningStep.value,
        is_deleted: !eveningEnabled.value
      }
    ]
  };

  try {
    if (mode.value === 'add') {
      await dbService.addCustomer(customerData);
    } else {
      await dbService.updateCustomer(selectedCustomer.value.customer_id, customerData);
    }
    await loadData();
    mode.value = 'list';
  } catch (err) {
    formError.value = err.message || 'Failed to save customer registry entry.';
  }
};

const cancelForm = () => {
  mode.value = 'list';
};

// Helpers for adjustments
const adjustSeq = (val) => {
  routeSequence.value = Math.max(1, routeSequence.value + val);
};

const adjustQty = (shift, val) => {
  if (shift === 0) {
    morningQty.value = Math.max(0.25, morningQty.value + val);
  } else {
    eveningQty.value = Math.max(0.25, eveningQty.value + val);
  }
};
</script>

<template>
  <div>
    <!-- LIST MODE -->
    <div v-if="mode === 'list'" class="space-y-4">
      <!-- Search & Add Row -->
      <div class="px-gutter pt-3 flex items-center space-x-2">
        <div class="relative flex-1">
          <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px]">search</span>
          <input 
            v-model="searchQuery"
            type="text" 
            placeholder="Search customers..." 
            class="w-full h-10 pl-10 pr-4 border border-outline-variant bg-surface-container-lowest rounded-lg text-sm focus:outline-none focus:border-primary"
          />
          <button 
            v-if="searchQuery"
            @click="searchQuery = ''"
            class="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
          >
            <span class="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>

        <button 
          @click="startAdd"
          class="h-10 px-4 rounded-lg bg-primary text-on-primary font-bold text-xs flex items-center shadow active:scale-95 transition-all"
        >
          <span class="material-symbols-outlined mr-1 text-[16px]">person_add</span>
          Add New
        </button>
      </div>

      <!-- Customers List -->
      <main class="p-gutter space-y-3 pb-24">
        <div v-if="filteredCustomers.length === 0" class="py-12 text-center bg-surface-container-lowest rounded-lg border border-outline-variant p-6">
          <span class="material-symbols-outlined text-[48px] text-on-surface-variant mb-2">face_nodegroup</span>
          <h3 class="font-customer-name text-on-surface mb-1">No Customers Found</h3>
          <p class="font-body-md text-on-surface-variant text-sm">Create customers to populate your delivery registry.</p>
        </div>

        <div v-else class="space-y-2.5">
          <div 
            v-for="c in filteredCustomers" 
            :key="c.customer_id" 
            class="bg-surface-container-lowest border border-outline-variant rounded-xl p-3.5 flex items-center justify-between shadow-sm hover:border-primary transition-all"
          >
            <div class="flex items-center space-x-3.5">
              <!-- Route priority sequence tag -->
              <div class="h-9 w-9 rounded-full bg-surface-container text-primary flex items-center justify-center text-xs font-bold shadow-inner">
                #{{ String(c.route_sequence).padStart(2, '0') }}
              </div>
              <div>
                <h3 
                  @click="emit('view-customer', c.customer_id)"
                  class="font-customer-name text-on-surface text-base font-bold cursor-pointer hover:underline hover:text-primary transition-all"
                >
                  {{ c.name }}
                </h3>
                <p class="text-xs text-on-surface-variant mt-0.5">
                  📞 {{ c.phone_number }}
                </p>
                <p v-if="c.address" class="text-[11px] text-on-surface-variant/80 mt-1 max-w-[200px] truncate">
                  📍 {{ c.address }}
                </p>
              </div>
            </div>

            <button 
              @click="startEdit(c)"
              class="h-9 w-9 bg-surface-container hover:bg-surface-dim rounded-full flex items-center justify-center text-primary transition-all active:scale-90"
              title="Edit Profile & Subscriptions"
            >
              <span class="material-symbols-outlined text-[20px]">edit</span>
            </button>
          </div>
        </div>
      </main>
    </div>

    <!-- ADD/EDIT FORM MODE -->
    <div v-else class="pb-24">
      <!-- Sub-header -->
      <header class="bg-surface-container-low px-gutter py-4 border-b border-outline-variant sticky top-[48px] z-30 flex items-center justify-between">
        <div class="flex items-center space-x-3">
          <button 
            @click="cancelForm" 
            class="h-10 w-10 flex items-center justify-center rounded-full bg-surface-container hover:bg-surface-dim text-on-surface transition-colors"
          >
            <span class="material-symbols-outlined">arrow_back</span>
          </button>
          <h1 class="font-customer-name text-display-title text-on-surface leading-tight">
            {{ mode === 'add' ? 'Add New Customer' : 'Edit Customer Profile' }}
          </h1>
        </div>
        <button 
          @click="saveCustomer" 
          class="py-2 px-4 rounded-lg bg-primary text-on-primary font-button-text text-sm hover:bg-primary/95 shadow-md transition-all active:scale-95"
        >
          Save
        </button>
      </header>

      <!-- Main Fields Container -->
      <main class="p-gutter space-y-5">
        <!-- Error Banner -->
        <p v-if="formError" class="text-xs text-error font-semibold bg-red-50 p-2.5 rounded border border-red-200 shadow-sm">{{ formError }}</p>

        <!-- Basic Details Card -->
        <section class="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant shadow-sm space-y-4">
          <h2 class="text-xs font-bold text-on-surface-variant uppercase tracking-wider border-b border-surface-variant pb-2">Basic Details</h2>
          
          <!-- Name -->
          <div>
            <label class="text-xs font-semibold block text-on-surface mb-1">Full Name *</label>
            <input 
              v-model="name" 
              type="text" 
              placeholder="e.g. Amit Kumar"
              class="w-full border border-outline-variant bg-surface rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary"
            />
          </div>

          <!-- Phone -->
          <div>
            <label class="text-xs font-semibold block text-on-surface mb-1">Phone Number *</label>
            <input 
              v-model="phone" 
              type="tel" 
              placeholder="10-digit mobile number"
              class="w-full border border-outline-variant bg-surface rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary"
            />
          </div>

          <!-- Address -->
          <div>
            <label class="text-xs font-semibold block text-on-surface mb-1">Address</label>
            <textarea 
              v-model="address" 
              placeholder="House no, Street, Landmark"
              rows="2"
              class="w-full border border-outline-variant bg-surface rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none"
            ></textarea>
          </div>

          <!-- Route Sequence -->
          <div class="flex items-center justify-between pt-3 border-t border-outline-variant">
            <div>
              <label class="text-xs font-semibold block text-on-surface">Route Sequence Number</label>
              <span class="text-[10px] text-on-surface-variant block">Delivery order priority</span>
            </div>
            <div class="flex items-center bg-surface border border-outline-variant rounded-lg p-1">
              <button 
                @click="adjustSeq(-1)" 
                class="w-8 h-8 flex items-center justify-center rounded bg-surface-container hover:bg-surface-dim text-primary"
              >
                <span class="material-symbols-outlined text-[18px]">remove</span>
              </button>
              <input 
                v-model.number="routeSequence"
                type="number" 
                class="w-12 text-center bg-transparent border-none font-bold text-sm focus:ring-0 p-0 text-on-surface"
              />
              <button 
                @click="adjustSeq(1)" 
                class="w-8 h-8 flex items-center justify-center rounded bg-surface-container hover:bg-surface-dim text-primary"
              >
                <span class="material-symbols-outlined text-[18px]">add</span>
              </button>
            </div>
          </div>
        </section>

        <!-- Invoice preference toggle -->
        <section class="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant shadow-sm flex items-center justify-between">
          <div>
            <label class="text-sm font-semibold text-on-surface block">Auto-include in monthly invoices</label>
            <span class="text-xs text-on-surface-variant block">Generate bill automatically on 1st day</span>
          </div>
          <!-- Custom Toggle -->
          <label class="relative inline-flex items-center cursor-pointer flex-shrink-0 justify-end h-8">
            <input type="checkbox" v-model="autoInvoice" class="sr-only peer" />
            <div class="w-11 h-6 bg-surface-variant peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
          </label>
        </section>

        <!-- Daily Subscriptions Section -->
        <section class="space-y-4">
          <h2 class="text-xs font-bold text-on-surface-variant uppercase tracking-wider pl-1">Daily Subscriptions</h2>

          <!-- Morning Slot Card -->
          <div class="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden">
            <!-- Header with shift toggle -->
            <div class="bg-tertiary-fixed/15 px-4 py-2 border-b border-outline-variant flex items-center justify-between">
              <span class="font-bold text-sm text-tertiary-container flex items-center">
                <span class="material-symbols-outlined text-[18px] mr-1.5" style="font-variation-settings: 'FILL' 1;">light_mode</span>
                Morning Delivery Shift
              </span>
              <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" v-model="morningEnabled" class="sr-only peer" />
                <div class="w-9 h-5 bg-surface-variant peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-tertiary-container"></div>
              </label>
            </div>

            <!-- Fields shown only if enabled -->
            <div v-if="morningEnabled" class="p-4 space-y-4 animate-in slide-in-from-top duration-200">
              <!-- Product -->
              <div>
                <label class="text-xs font-semibold block text-on-surface-variant mb-1">Select Product</label>
                <select 
                  v-model="morningProduct"
                  class="w-full border border-outline-variant bg-surface rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary"
                >
                  <option value="" disabled>-- Select a Product --</option>
                  <option v-for="p in products" :key="p.product_id" :value="p.product_id" class="text-on-surface bg-surface">
                    {{ p.product_name }} ({{ p.unit }})
                  </option>
                </select>
              </div>

              <div class="grid grid-cols-2 gap-4">
                <!-- Qty -->
                <div>
                  <label class="text-xs font-semibold block text-on-surface-variant mb-1">Quantity (Litre)</label>
                  <div class="flex items-center bg-surface border border-outline-variant rounded-lg p-1">
                    <button 
                      @click="adjustQty(0, -morningStep)" 
                      class="w-8 h-8 flex items-center justify-center rounded bg-surface-container hover:bg-surface-dim text-primary"
                    >
                      <span class="material-symbols-outlined text-[18px]">remove</span>
                    </button>
                    <input 
                      v-model.number="morningQty"
                      type="text" 
                      class="w-full text-center bg-transparent border-none font-bold text-sm focus:ring-0 p-0 text-on-surface"
                      readonly
                    />
                    <button 
                      @click="adjustQty(0, morningStep)" 
                      class="w-8 h-8 flex items-center justify-center rounded bg-surface-container hover:bg-surface-dim text-primary"
                    >
                      <span class="material-symbols-outlined text-[18px]">add</span>
                    </button>
                  </div>
                </div>

                <!-- Rate -->
                <div>
                  <label class="text-xs font-semibold block text-on-surface-variant mb-1">Rate (₹/Litre)</label>
                  <div class="relative border border-outline-variant bg-surface rounded-lg h-10 flex items-center px-3 focus-within:border-primary">
                    <span class="text-on-surface-variant font-semibold text-xs mr-1">₹</span>
                    <input 
                      v-model.number="morningRate"
                      type="number" 
                      step="0.5"
                      class="w-full h-full bg-transparent border-none text-sm font-semibold focus:ring-0 text-right p-0"
                    />
                  </div>
                </div>
              </div>

              <!-- Quantity Step Size preference -->
              <div>
                <label class="text-xs font-semibold block text-on-surface-variant mb-1">Stepping Quantity Adjustments</label>
                <select 
                  v-model.number="morningStep"
                  class="w-full border border-outline-variant bg-surface rounded-lg px-3 py-1.5 text-xs text-on-surface focus:outline-none"
                >
                  <option :value="0.25">0.25 L Steps (Standard)</option>
                  <option :value="0.5">0.50 L Steps (Bulk)</option>
                </select>
              </div>
            </div>
            <!-- Disabled notice -->
            <div v-else class="p-4 text-center text-xs text-on-surface-variant/80 bg-gray-50 border-t border-dashed border-outline-variant">
              Morning delivery subscription is disabled for this customer.
            </div>
          </div>

          <!-- Evening Slot Card -->
          <div class="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden">
            <!-- Header with shift toggle -->
            <div class="bg-secondary-container/15 px-4 py-2 border-b border-outline-variant flex items-center justify-between">
              <span class="font-bold text-sm text-on-secondary-container flex items-center">
                <span class="material-symbols-outlined text-[18px] mr-1.5" style="font-variation-settings: 'FILL' 1;">dark_mode</span>
                Evening Delivery Shift
              </span>
              <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" v-model="eveningEnabled" class="sr-only peer" />
                <div class="w-9 h-5 bg-surface-variant peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-secondary"></div>
              </label>
            </div>

            <!-- Fields shown only if enabled -->
            <div v-if="eveningEnabled" class="p-4 space-y-4 animate-in slide-in-from-top duration-200">
              <!-- Product -->
              <div>
                <label class="text-xs font-semibold block text-on-surface-variant mb-1">Select Product</label>
                <select 
                  v-model="eveningProduct"
                  class="w-full border border-outline-variant bg-surface rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary"
                >
                  <option value="" disabled>-- Select a Product --</option>
                  <option v-for="p in products" :key="p.product_id" :value="p.product_id" class="text-on-surface bg-surface">
                    {{ p.product_name }} ({{ p.unit }})
                  </option>
                </select>
              </div>

              <div class="grid grid-cols-2 gap-4">
                <!-- Qty -->
                <div>
                  <label class="text-xs font-semibold block text-on-surface-variant mb-1">Quantity (Litre)</label>
                  <div class="flex items-center bg-surface border border-outline-variant rounded-lg p-1">
                    <button 
                      @click="adjustQty(1, -eveningStep)" 
                      class="w-8 h-8 flex items-center justify-center rounded bg-surface-container hover:bg-surface-dim text-primary"
                    >
                      <span class="material-symbols-outlined text-[18px]">remove</span>
                    </button>
                    <input 
                      v-model.number="eveningQty"
                      type="text" 
                      class="w-full text-center bg-transparent border-none font-bold text-sm focus:ring-0 p-0 text-on-surface"
                      readonly
                    />
                    <button 
                      @click="adjustQty(1, eveningStep)" 
                      class="w-8 h-8 flex items-center justify-center rounded bg-surface-container hover:bg-surface-dim text-primary"
                    >
                      <span class="material-symbols-outlined text-[18px]">add</span>
                    </button>
                  </div>
                </div>

                <!-- Rate -->
                <div>
                  <label class="text-xs font-semibold block text-on-surface-variant mb-1">Rate (₹/Litre)</label>
                  <div class="relative border border-outline-variant bg-surface rounded-lg h-10 flex items-center px-3 focus-within:border-primary">
                    <span class="text-on-surface-variant font-semibold text-xs mr-1">₹</span>
                    <input 
                      v-model.number="eveningRate"
                      type="number" 
                      step="0.5"
                      class="w-full h-full bg-transparent border-none text-sm font-semibold focus:ring-0 text-right p-0"
                    />
                  </div>
                </div>
              </div>

              <!-- Quantity Step Size preference -->
              <div>
                <label class="text-xs font-semibold block text-on-surface-variant mb-1">Stepping Quantity Adjustments</label>
                <select 
                  v-model.number="eveningStep"
                  class="w-full border border-outline-variant bg-surface rounded-lg px-3 py-1.5 text-xs text-on-surface focus:outline-none"
                >
                  <option :value="0.25">0.25 L Steps (Standard)</option>
                  <option :value="0.5">0.50 L Steps (Bulk)</option>
                </select>
              </div>
            </div>
            <!-- Disabled notice -->
            <div v-else class="p-4 text-center text-xs text-on-surface-variant/80 bg-gray-50 border-t border-dashed border-outline-variant">
              Evening delivery subscription is disabled for this customer.
            </div>
          </div>
        </section>

        <!-- Special Notes -->
        <section class="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant shadow-sm">
          <label class="text-xs font-semibold block text-on-surface-variant mb-1">Special Notes (Delivery Instructions)</label>
          <textarea 
            v-model="specialNotes"
            placeholder="e.g. Ring doorbell twice, leave bag on door handle."
            rows="3"
            class="w-full border border-outline-variant bg-surface rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none"
          ></textarea>
        </section>

        <!-- Form save button -->
        <button 
          @click="saveCustomer"
          class="w-full py-3 bg-primary text-on-primary font-bold text-sm rounded-lg hover:bg-primary/95 transition-all shadow-md active:scale-95 flex items-center justify-center space-x-2"
        >
          <span class="material-symbols-outlined text-[20px]">save</span>
          <span>{{ mode === 'add' ? 'Save & Add Customer' : 'Save Customer Changes' }}</span>
        </button>

      </main>
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
