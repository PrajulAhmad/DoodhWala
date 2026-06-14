<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { dbService } from '../services/db';

const emit = defineEmits(['view-customer']);

// Network connectivity state for offline banner
const isOffline = ref(!navigator.onLine);
const handleOnline = () => { isOffline.value = false; };
const handleOffline = () => { isOffline.value = true; };

// Active shift: 0 = Morning, 1 = Evening
const activeShift = ref(0);

// Active filter chip: 'all' | 'high_dues' | 'pending' | 'done'
const activeFilter = ref('all');

// Search query
const searchQuery = ref('');

// Customer list loaded from SQLite
const customers = ref([]);

const formatBalanceText = (balancePaise) => {
  const amt = Math.abs(balancePaise) / 100;
  const formatted = amt.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  if (balancePaise > 20000) {
    return `🔴 ₹${formatted} Due`;
  } else if (balancePaise > 0 && balancePaise <= 20000) {
    return `🟡 ₹${formatted} Due`;
  } else if (balancePaise < 0) {
    return `🟢 ₹${formatted} Credit`;
  } else {
    return `🟢 Paid`;
  }
};

const loadCustomers = async () => {
  // Wait until db is initialized
  while (!dbService.initialized) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  try {
    const todayDateString = new Date().toISOString().split('T')[0];
    const dbRows = await dbService.getTodayRoute(todayDateString, activeShift.value);
    
    customers.value = dbRows.map(row => {
      const status = row.delivery_status 
        ? row.delivery_status 
        : (row.on_vacation ? 'Vacation' : 'Pending');
      
      let deliveredText = '';
      if (status === 'Delivered') {
        let timeStr = '';
        if (row.delivery_updated_at) {
          try {
            // SQLite datetime format is usually YYYY-MM-DD HH:MM:SS, let's parse local time
            const dt = new Date(row.delivery_updated_at.replace(' ', 'T'));
            timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          } catch (e) {
            timeStr = '';
          }
        }
        deliveredText = `✓ ${row.quantity_delivered}L Delivered` + (timeStr ? ` • ${timeStr}` : '');
      }

      return {
        id: row.customer_id,
        customer_id: row.customer_id,
        sub_id: row.sub_id,
        product_id: row.product_id,
        custom_rate: row.custom_rate,
        quantity_step: row.quantity_step || 0.25,
        seq: `#${String(row.route_sequence).padStart(2, '0')}`,
        name: row.name,
        status: status,
        dueText: formatBalanceText(row.live_balance),
        dueAmount: row.live_balance / 100,
        specialNote: row.special_notes || '',
        product: row.product_name,
        quantity: row.delivery_status ? row.quantity_delivered : row.default_quantity,
        isExpanded: status === 'Pending',
        deliveredText: deliveredText,
        vacationText: '🏖️ On Vacation',
        errorText: ''
      };
    });
  } catch (err) {
    console.error("Failed to load customers from SQLite:", err);
  }
};

const selectInitialShift = async () => {
  let cutoffHour = 12;
  try {
    while (!dbService.initialized) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const settingsResult = await dbService.query("SELECT morning_cutoff_hour FROM AppSettings LIMIT 1;");
    if (settingsResult.values && settingsResult.values.length > 0) {
      cutoffHour = settingsResult.values[0].morning_cutoff_hour;
    }
  } catch (e) {
    console.error("Failed to query AppSettings cutoff:", e);
  }

  const currentHour = new Date().getHours();
  activeShift.value = currentHour < cutoffHour ? 0 : 1;
};

onMounted(async () => {
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  await selectInitialShift();
  await loadCustomers();
});

onUnmounted(() => {
  window.removeEventListener('online', handleOnline);
  window.removeEventListener('offline', handleOffline);
});

// Computed counts for the active shift tab header
const resolvedCount = computed(() => {
  return customers.value.filter(c => c.status === 'Delivered' || c.status === 'Skipped' || c.status === 'Vacation').length;
});

const totalCount = computed(() => customers.value.length);

// Filtered customers based on filter chips, shift, and search query
const filteredCustomers = computed(() => {
  return customers.value.filter(c => {
    // 1. Search Query filter
    if (searchQuery.value.trim() !== '') {
      const query = searchQuery.value.toLowerCase();
      if (!c.name.toLowerCase().includes(query) && !c.seq.includes(query)) {
        return false;
      }
    }

    // 2. Chip filters
    if (activeFilter.value === 'high_dues') {
      return c.dueAmount && c.dueAmount >= 500 && c.status === 'Pending';
    }
    if (activeFilter.value === 'pending') {
      return c.status === 'Pending' || c.status === 'Failed';
    }
    if (activeFilter.value === 'done') {
      return c.status === 'Delivered' || c.status === 'Skipped';
    }

    return true;
  });
});

// Interactive Methods
const toggleShift = async (shiftIndex) => {
  activeShift.value = shiftIndex;
  await loadCustomers();
};

const setFilter = (filterName) => {
  activeFilter.value = filterName;
};

const toggleExpand = (customer) => {
  customer.isExpanded = !customer.isExpanded;
};

const adjustQuantity = (customer, step) => {
  const newQty = customer.quantity + step;
  if (newQty >= 0.25) {
    // Prevent float rounding errors (e.g. 1.25 + 0.25 -> 1.50)
    customer.quantity = Math.round(newQty * 100) / 100;
  }
};

const markDelivered = async (customer) => {
  const prevStatus = customer.status;
  const prevDeliveredText = customer.deliveredText;
  const prevIsExpanded = customer.isExpanded;
  const prevErrorText = customer.errorText;

  // Optimistic UI update
  customer.status = 'Delivered';
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  customer.deliveredText = `✓ ${customer.quantity.toFixed(2)}L Delivered • ${timeStr}`;
  customer.isExpanded = false;
  customer.errorText = '';

  try {
    const todayDateString = new Date().toISOString().split('T')[0];
    await dbService.logDelivery({
      customer_id: customer.customer_id,
      sub_id: customer.sub_id,
      product_id: customer.product_id,
      delivery_date: todayDateString,
      delivery_shift: activeShift.value,
      quantity_delivered: customer.quantity,
      rate_applied: customer.custom_rate,
      status: 'Delivered'
    });

    // Refresh live balance for this customer
    const balanceResult = await dbService.query(`
      SELECT (
        COALESCE((SELECT SUM(dd.quantity_delivered * dd.rate_applied) FROM DailyDelivery dd WHERE dd.customer_id = ? AND dd.status = 'Delivered' AND dd.deleted_at IS NULL), 0) +
        COALESCE((SELECT SUM(adj.amount) FROM AdjustmentLog adj WHERE adj.customer_id = ? AND adj.type = 'DEBIT' AND adj.deleted_at IS NULL), 0) -
        COALESCE((SELECT SUM(adj.amount) FROM AdjustmentLog adj WHERE adj.customer_id = ? AND adj.type = 'CREDIT' AND adj.deleted_at IS NULL), 0) -
        COALESCE((SELECT SUM(pay.amount_collected) FROM PaymentLog pay WHERE pay.customer_id = ? AND pay.deleted_at IS NULL), 0)
      ) AS live_balance
    `, [customer.customer_id, customer.customer_id, customer.customer_id, customer.customer_id]);
    
    if (balanceResult.values && balanceResult.values.length > 0) {
      const liveBalance = balanceResult.values[0].live_balance;
      customer.dueAmount = liveBalance / 100;
      customer.dueText = formatBalanceText(liveBalance);
    }
  } catch (err) {
    console.error("Failed to log delivery:", err);
    customer.status = 'Failed';
    customer.errorText = 'Write Failed. Sync Error.';
    customer.isExpanded = true;
    customer.rollbackState = {
      status: prevStatus,
      deliveredText: prevDeliveredText,
      isExpanded: prevIsExpanded,
      errorText: prevErrorText
    };
  }
};

const skipShift = async (customer) => {
  const prevStatus = customer.status;
  const prevDeliveredText = customer.deliveredText;
  const prevIsExpanded = customer.isExpanded;
  const prevErrorText = customer.errorText;

  // Optimistic UI update
  customer.status = 'Skipped';
  customer.isExpanded = false;
  customer.errorText = '';

  try {
    const todayDateString = new Date().toISOString().split('T')[0];
    await dbService.logDelivery({
      customer_id: customer.customer_id,
      sub_id: customer.sub_id,
      product_id: customer.product_id,
      delivery_date: todayDateString,
      delivery_shift: activeShift.value,
      quantity_delivered: 0,
      rate_applied: customer.custom_rate,
      status: 'Skipped'
    });

    // Refresh live balance for this customer
    const balanceResult = await dbService.query(`
      SELECT (
        COALESCE((SELECT SUM(dd.quantity_delivered * dd.rate_applied) FROM DailyDelivery dd WHERE dd.customer_id = ? AND dd.status = 'Delivered' AND dd.deleted_at IS NULL), 0) +
        COALESCE((SELECT SUM(adj.amount) FROM AdjustmentLog adj WHERE adj.customer_id = ? AND adj.type = 'DEBIT' AND adj.deleted_at IS NULL), 0) -
        COALESCE((SELECT SUM(adj.amount) FROM AdjustmentLog adj WHERE adj.customer_id = ? AND adj.type = 'CREDIT' AND adj.deleted_at IS NULL), 0) -
        COALESCE((SELECT SUM(pay.amount_collected) FROM PaymentLog pay WHERE pay.deleted_at IS NULL), 0)
      ) AS live_balance
    `, [customer.customer_id, customer.customer_id, customer.customer_id, customer.customer_id]);
    
    if (balanceResult.values && balanceResult.values.length > 0) {
      const liveBalance = balanceResult.values[0].live_balance;
      customer.dueAmount = liveBalance / 100;
      customer.dueText = formatBalanceText(liveBalance);
    }
  } catch (err) {
    console.error("Failed to log skipped delivery:", err);
    customer.status = 'Failed';
    customer.errorText = 'Write Failed. Sync Error.';
    customer.isExpanded = true;
    customer.rollbackState = {
      status: prevStatus,
      deliveredText: prevDeliveredText,
      isExpanded: prevIsExpanded,
      errorText: prevErrorText
    };
  }
};

const retrySync = (customer) => {
  if (customer.rollbackState) {
    customer.status = customer.rollbackState.status;
    customer.deliveredText = customer.rollbackState.deliveredText;
    customer.isExpanded = customer.rollbackState.isExpanded;
    customer.errorText = customer.rollbackState.errorText;
  } else {
    customer.status = 'Pending';
    customer.isExpanded = true;
  }
};
</script>

<template>
  <div>
    <!-- Offline Banner -->
    <transition
      enter-active-class="transition-all duration-300 ease-out"
      enter-from-class="opacity-0 -translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition-all duration-200 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 -translate-y-2"
    >
      <div
        v-if="isOffline"
        class="sticky top-[48px] z-50 w-full bg-amber-500 text-white text-xs font-semibold flex items-center justify-center gap-2 py-2 px-4 shadow-md"
        role="status"
        aria-live="polite"
      >
        <span class="material-symbols-outlined text-[16px]">flight</span>
        <span>Offline — deliveries save locally and sync on reconnect.</span>
      </div>
    </transition>

    <!-- Sub-header Controls -->
    <div class="px-gutter pb-stack-md bg-surface z-40 sticky top-[48px] border-b border-surface-variant">
      
      <!-- Segmented Shift Control -->
      <div class="flex bg-surface-variant rounded-lg p-1 mb-stack-md">
        <button 
          @click="toggleShift(0)"
          :class="[
            'flex-1 py-2 text-center rounded-md font-button-text text-button-text transition-all',
            activeShift === 0 ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:bg-surface-dim'
          ]"
        >
          Morning <span v-if="activeShift === 0">({{ resolvedCount }}/{{ totalCount }})</span>
        </button>
        <button 
          @click="toggleShift(1)"
          :class="[
            'flex-1 py-2 text-center rounded-md font-button-text text-button-text transition-all',
            activeShift === 1 ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:bg-surface-dim'
          ]"
        >
          Evening <span v-if="activeShift === 1">({{ resolvedCount }}/{{ totalCount }})</span>
        </button>
      </div>

      <!-- Search Input -->
      <div class="relative mb-3">
        <span class="material-symbols-outlined absolute left-3 top-2.5 text-on-surface-variant text-[20px]">search</span>
        <input 
          v-model="searchQuery"
          type="text" 
          placeholder="Search customer by name or sequence..."
          class="w-full pl-10 pr-4 py-2 bg-surface-container rounded-lg border border-outline-variant text-on-surface placeholder:text-on-surface-variant text-sm focus:outline-none focus:border-primary"
        />
        <span 
          v-if="searchQuery" 
          @click="searchQuery = ''" 
          class="material-symbols-outlined absolute right-3 top-2.5 text-on-surface-variant text-[20px] cursor-pointer hover:text-on-surface"
        >
          close
        </span>
      </div>

      <!-- Filter Chips -->
      <div class="flex overflow-x-auto hide-scrollbar space-x-2 pb-1">
        <button 
          @click="setFilter('all')"
          :class="[
            'whitespace-nowrap px-4 py-1.5 rounded-full font-label-sm text-label-sm border transition-colors',
            activeFilter === 'all' 
              ? 'bg-primary-container text-on-primary-container border-primary-container' 
              : 'bg-transparent text-on-surface-variant border-outline-variant hover:bg-surface-dim'
          ]"
        >
          All
        </button>
        <button 
          @click="setFilter('high_dues')"
          :class="[
            'whitespace-nowrap px-4 py-1.5 rounded-full font-label-sm text-label-sm border transition-colors',
            activeFilter === 'high_dues' 
              ? 'bg-primary-container text-on-primary-container border-primary-container' 
              : 'bg-transparent text-on-surface-variant border-outline-variant hover:bg-surface-dim'
          ]"
        >
          High Dues
        </button>
        <button 
          @click="setFilter('pending')"
          :class="[
            'whitespace-nowrap px-4 py-1.5 rounded-full font-label-sm text-label-sm border transition-colors',
            activeFilter === 'pending' 
              ? 'bg-primary-container text-on-primary-container border-primary-container' 
              : 'bg-transparent text-on-surface-variant border-outline-variant hover:bg-surface-dim'
          ]"
        >
          Pending
        </button>
        <button 
          @click="setFilter('done')"
          :class="[
            'whitespace-nowrap px-4 py-1.5 rounded-full font-label-sm text-label-sm border transition-colors',
            activeFilter === 'done' 
              ? 'bg-primary-container text-on-primary-container border-primary-container' 
              : 'bg-transparent text-on-surface-variant border-outline-variant hover:bg-surface-dim'
          ]"
        >
          Done
        </button>
      </div>
    </div>

    <!-- Main Content List -->
    <main class="p-gutter space-y-stack-md pb-24">
      
      <!-- Empty State -->
      <div v-if="filteredCustomers.length === 0" class="flex flex-col items-center justify-center py-12 text-center bg-surface-container-lowest rounded-lg border border-outline-variant p-6">
        <span class="material-symbols-outlined text-[48px] text-on-surface-variant mb-2">inbox</span>
        <h3 class="font-customer-name text-on-surface mb-1">No Customers Found</h3>
        <p class="font-body-md text-on-surface-variant">Try adjusting your search query or filter chip selection.</p>
      </div>

      <!-- Customer List Rows -->
      <div v-for="c in filteredCustomers" :key="c.id">
        
        <!-- PENDING STATE (EXPANDED) -->
        <div 
          v-if="c.status === 'Pending' && c.isExpanded" 
          class="bg-surface-container-lowest rounded-lg border border-outline-variant overflow-hidden shadow-sm transition-all duration-200"
          :class="c.dueAmount > 0 ? 'border-l-4 border-l-error' : 'border-l-4 border-l-primary'"
        >
          <div class="p-4 border-b border-surface-variant">
            <div class="flex justify-between items-start mb-2">
              <div>
                <span 
                  class="text-xs font-semibold mb-1 block"
                  :class="c.dueAmount > 0 ? 'text-error' : 'text-primary'"
                >
                  {{ c.dueText }}
                </span>
                <h2 @click="emit('view-customer', c.customer_id)" class="font-customer-name text-customer-name text-on-surface flex items-center cursor-pointer hover:underline hover:text-primary transition-all">
                  <span class="text-on-surface-variant text-sm mr-2 font-normal">{{ c.seq }}</span>
                  {{ c.name }}
                </h2>
              </div>
              <button 
                @click="toggleExpand(c)"
                class="h-10 w-10 flex items-center justify-center rounded-full bg-surface-container hover:bg-surface-dim text-on-surface transition-colors"
              >
                <span class="material-symbols-outlined">expand_less</span>
              </button>
            </div>
            
            <div v-if="c.specialNote" class="flex items-center text-tertiary bg-on-tertiary-container text-sm px-2 py-1 rounded w-fit mt-1">
              <span class="material-symbols-outlined text-[16px] mr-1">warning</span>
              <span class="font-medium">{{ c.specialNote }}</span>
            </div>
          </div>

          <div class="p-4 bg-surface-container-low">
            <div class="flex flex-col items-center mb-6">
              <span class="text-on-surface-variant mb-2 text-sm font-medium">{{ c.product }}</span>
              <div class="flex items-center justify-between w-full max-w-[280px] bg-surface-container-lowest rounded-xl border border-outline-variant p-2">
                <button 
                  @click="adjustQuantity(c, -2 * c.quantity_step)"
                  class="w-12 h-12 flex items-center justify-center rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-dim transition-colors active:scale-95"
                >
                  <span class="font-bold">-{{ (2 * c.quantity_step).toFixed(2) }}</span>
                </button>
                <button 
                  @click="adjustQuantity(c, -1 * c.quantity_step)"
                  class="w-12 h-12 flex items-center justify-center rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-dim transition-colors active:scale-95"
                >
                  <span class="font-bold">-{{ c.quantity_step.toFixed(2) }}</span>
                </button>
                <div class="flex-1 text-center font-display-title text-display-title text-primary px-2">
                  {{ c.quantity.toFixed(2) }}L
                </div>
                <button 
                  @click="adjustQuantity(c, c.quantity_step)"
                  class="w-12 h-12 flex items-center justify-center rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-dim transition-colors active:scale-95"
                >
                  <span class="font-bold">+{{ c.quantity_step.toFixed(2) }}</span>
                </button>
                <button 
                  @click="adjustQuantity(c, 2 * c.quantity_step)"
                  class="w-12 h-12 flex items-center justify-center rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-dim transition-colors active:scale-95"
                >
                  <span class="font-bold">+{{ (2 * c.quantity_step).toFixed(2) }}</span>
                </button>
              </div>
            </div>
            <div class="flex space-x-4">
              <button 
                @click="skipShift(c)"
                class="flex-1 py-3 px-4 rounded-lg border border-outline-variant text-on-surface font-button-text text-button-text flex items-center justify-center hover:bg-surface-dim transition-all active:scale-95"
              >
                Skip
              </button>
              <button 
                @click="markDelivered(c)"
                class="flex-[2] py-3 px-4 rounded-lg bg-primary text-on-primary font-button-text text-button-text flex items-center justify-center hover:bg-primary/90 shadow-sm transition-all active:scale-95"
              >
                <span class="material-symbols-outlined mr-2">check_circle</span>
                Mark Delivered
              </button>
            </div>
          </div>
        </div>

        <!-- PENDING STATE (COLLAPSED) -->
        <div 
          v-else-if="c.status === 'Pending' && !c.isExpanded"
          class="bg-surface-container-lowest rounded-lg border border-outline-variant p-4 flex items-center justify-between shadow-sm transition-all duration-200"
          :class="c.dueAmount > 0 ? 'border-l-4 border-l-error' : 'border-l-4 border-l-primary'"
        >
          <div>
            <h2 @click="emit('view-customer', c.customer_id)" class="font-customer-name text-on-surface text-[18px] leading-tight flex items-center cursor-pointer hover:underline hover:text-primary transition-all">
              <span class="text-on-surface-variant text-sm mr-2 font-normal">{{ c.seq }}</span>
              {{ c.name }}
            </h2>
            <span class="text-xs font-semibold block mt-1" :class="c.dueAmount > 0 ? 'text-error' : 'text-primary'">
              {{ c.dueText }}
            </span>
          </div>
          <button 
            @click="toggleExpand(c)"
            class="h-10 w-10 flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-dim transition-colors"
          >
            <span class="material-symbols-outlined">expand_more</span>
          </button>
        </div>

        <!-- DELIVERED STATE (COLLAPSED) -->
        <div 
          v-else-if="c.status === 'Delivered'" 
          class="bg-[#E8F5E9] rounded-lg border border-[#A5D6A7] p-4 flex items-center justify-between shadow-sm transition-all duration-200"
        >
          <div class="flex items-center">
            <div class="w-10 h-10 rounded-full bg-[#C8E6C9] text-primary flex items-center justify-center mr-3">
              <span class="material-symbols-outlined font-bold">check</span>
            </div>
            <div>
              <h2 @click="emit('view-customer', c.customer_id)" class="font-customer-name text-on-surface text-[18px] leading-tight flex items-center cursor-pointer hover:underline hover:text-primary transition-all">
                <span class="text-on-surface-variant text-sm mr-2 font-normal">{{ c.seq }}</span>
                {{ c.name }}
              </h2>
              <p class="text-primary font-medium text-sm mt-0.5">{{ c.deliveredText }}</p>
            </div>
          </div>
          <button 
            @click="toggleExpand(c)"
            class="h-10 w-10 flex items-center justify-center rounded-full text-on-surface-variant hover:bg-[#C8E6C9] transition-colors"
          >
            <span class="material-symbols-outlined">expand_more</span>
          </button>
        </div>

        <!-- SKIPPED STATE (COLLAPSED) -->
        <div 
          v-else-if="c.status === 'Skipped'" 
          class="bg-surface-container rounded-lg border border-outline-variant p-4 flex items-center justify-between opacity-80 transition-all duration-200"
        >
          <div class="flex items-center">
            <div class="w-10 h-10 rounded-full bg-surface-dim text-on-surface-variant flex items-center justify-center mr-3">
              <span class="material-symbols-outlined">close</span>
            </div>
            <div>
              <h2 @click="emit('view-customer', c.customer_id)" class="font-customer-name text-on-surface text-[18px] leading-tight flex items-center cursor-pointer hover:underline hover:text-primary transition-all">
                <span class="text-on-surface-variant text-sm mr-2 font-normal">{{ c.seq }}</span>
                {{ c.name }}
              </h2>
              <p class="text-on-surface-variant font-medium text-sm mt-0.5">❌ Skipped Shift</p>
            </div>
          </div>
          <button 
            @click="toggleExpand(c)"
            class="h-10 w-10 flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-dim transition-colors"
          >
            <span class="material-symbols-outlined">expand_more</span>
          </button>
        </div>

        <!-- VACATION STATE (COLLAPSED) -->
        <div 
          v-else-if="c.status === 'Vacation' && !c.isExpanded" 
          class="bg-surface-container rounded-lg border border-outline-variant p-4 flex items-center justify-between opacity-80 transition-all duration-200"
        >
          <div class="flex items-center">
            <div class="w-10 h-10 rounded-full bg-surface-dim text-on-surface-variant flex items-center justify-center mr-3">
              <span class="material-symbols-outlined">flight_takeoff</span>
            </div>
            <div>
              <h2 @click="emit('view-customer', c.customer_id)" class="font-customer-name text-on-surface text-[18px] leading-tight flex items-center line-through decoration-on-surface-variant cursor-pointer hover:underline hover:text-primary transition-all">
                <span class="text-on-surface-variant text-sm mr-2 font-normal no-underline">{{ c.seq }}</span>
                {{ c.name }}
              </h2>
              <p class="text-on-surface-variant font-medium text-sm mt-0.5">{{ c.vacationText }}</p>
            </div>
          </div>
          <button 
            @click="toggleExpand(c)"
            class="h-10 w-10 flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-dim transition-colors"
          >
            <span class="material-symbols-outlined">expand_more</span>
          </button>
        </div>

        <!-- VACATION STATE (EXPANDED) -->
        <div 
          v-else-if="c.status === 'Vacation' && c.isExpanded" 
          class="bg-surface-container rounded-lg border border-outline-variant overflow-hidden shadow-sm transition-all duration-200"
        >
          <div class="p-4 border-b border-surface-variant">
            <div class="flex justify-between items-start mb-2">
              <div>
                <h2 @click="emit('view-customer', c.customer_id)" class="font-customer-name text-customer-name text-on-surface flex items-center cursor-pointer hover:underline hover:text-primary transition-all">
                  <span class="text-on-surface-variant text-sm mr-2 font-normal">{{ c.seq }}</span>
                  {{ c.name }}
                </h2>
              </div>
              <button 
                @click="toggleExpand(c)"
                class="h-10 w-10 flex items-center justify-center rounded-full bg-surface-container hover:bg-surface-dim text-on-surface transition-colors"
              >
                <span class="material-symbols-outlined">expand_less</span>
              </button>
            </div>
            
            <div class="flex items-center text-[#9A6B00] bg-[#FFF2E0] text-sm px-3 py-2 rounded-md mt-2">
              <span class="material-symbols-outlined text-[18px] mr-1.5">info</span>
              <span class="font-medium">On Vacation: Auto-skipped. Deliver to override.</span>
            </div>
          </div>

          <div class="p-4 bg-surface-container-low">
            <div class="flex flex-col items-center mb-6">
              <span class="text-on-surface-variant mb-2 text-sm font-medium">{{ c.product }}</span>
              <div class="flex items-center justify-between w-full max-w-[280px] bg-surface-container-lowest rounded-xl border border-outline-variant p-2">
                <button 
                  @click="adjustQuantity(c, -2 * c.quantity_step)"
                  class="w-12 h-12 flex items-center justify-center rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-dim transition-colors active:scale-95"
                >
                  <span class="font-bold">-{{ (2 * c.quantity_step).toFixed(2) }}</span>
                </button>
                <button 
                  @click="adjustQuantity(c, -1 * c.quantity_step)"
                  class="w-12 h-12 flex items-center justify-center rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-dim transition-colors active:scale-95"
                >
                  <span class="font-bold">-{{ c.quantity_step.toFixed(2) }}</span>
                </button>
                <div class="flex-1 text-center font-display-title text-display-title text-primary px-2">
                  {{ c.quantity.toFixed(2) }}L
                </div>
                <button 
                  @click="adjustQuantity(c, c.quantity_step)"
                  class="w-12 h-12 flex items-center justify-center rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-dim transition-colors active:scale-95"
                >
                  <span class="font-bold">+{{ c.quantity_step.toFixed(2) }}</span>
                </button>
                <button 
                  @click="adjustQuantity(c, 2 * c.quantity_step)"
                  class="w-12 h-12 flex items-center justify-center rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-dim transition-colors active:scale-95"
                >
                  <span class="font-bold">+{{ (2 * c.quantity_step).toFixed(2) }}</span>
                </button>
              </div>
            </div>
            <div class="flex">
              <button 
                @click="markDelivered(c)"
                class="w-full py-3 px-4 rounded-lg bg-primary text-on-primary font-button-text text-button-text flex items-center justify-center hover:bg-primary/90 shadow-sm transition-all active:scale-95"
              >
                <span class="material-symbols-outlined mr-2">check_circle</span>
                Deliver Override
              </button>
            </div>
          </div>
        </div>

        <!-- SYNC FAIL / ALERT STATE -->
        <div 
          v-else-if="c.status === 'Failed'" 
          class="bg-[#FEE2E2] rounded-lg border border-error p-4 shadow-sm transition-all duration-200"
        >
          <div class="flex justify-between items-center mb-3">
            <div>
              <h2 @click="emit('view-customer', c.customer_id)" class="font-customer-name text-error text-[18px] leading-tight flex items-center cursor-pointer hover:underline transition-all">
                <span class="text-error text-sm mr-2 font-normal">{{ c.seq }}</span>
                {{ c.name }}
              </h2>
              <p class="text-error font-medium text-sm mt-0.5 flex items-center">
                <span class="material-symbols-outlined text-[16px] mr-1">error</span>
                {{ c.errorText }}
              </p>
            </div>
          </div>
          <button 
            @click="retrySync(c)"
            class="w-full py-2 px-4 rounded-md bg-error text-on-error font-button-text text-sm flex items-center justify-center hover:bg-error/90 shadow-sm transition-all active:scale-95"
          >
            <span class="material-symbols-outlined mr-2 text-[18px]">refresh</span>
            Retry Action
          </button>
        </div>

      </div>
    </main>
  </div>
</template>

<style scoped>
/* Custom styling overrides if needed, Tailwind handles almost all of it */
.px-gutter {
  padding-left: var(--spacing-gutter);
  padding-right: var(--spacing-gutter);
}

.pb-stack-md {
  padding-bottom: var(--spacing-stack-md);
}

.mb-stack-md {
  margin-bottom: var(--spacing-stack-md);
}

.p-gutter {
  padding: var(--spacing-gutter);
}

.space-y-stack-md > :not([hidden]) ~ :not([hidden]) {
  margin-top: var(--spacing-stack-md);
}

.hide-scrollbar::-webkit-scrollbar {
  display: none;
}
.hide-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
