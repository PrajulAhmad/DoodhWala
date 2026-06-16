<script setup>
import { ref, onMounted, watch } from 'vue';
import { dbService } from './services/db';
import { authService } from './services/auth';
import RouteScreen from './components/RouteScreen.vue';
import LoginScreen from './components/LoginScreen.vue';
import CustomerDetail from './components/CustomerDetail.vue';
import BillingScreen from './components/BillingScreen.vue';
import CustomersScreen from './components/CustomersScreen.vue';
import SettingsScreen from './components/SettingsScreen.vue';
import { syncService } from './services/sync';
import { notificationService } from './services/notifications';

// App state: 'loading' | 'login' | 'main'
const appState = ref('loading');

// Database connection status: 'connecting' | 'connected' | 'error'
const dbStatus = ref('connecting');
const errorMessage = ref('');

// Active tab selection: 'home' | 'customers' | 'billing' | 'payments' | 'settings' | 'customer_detail'
const currentTab = ref('home');
const previousTab = ref('home');
const selectedCustomerId = ref(null);

// Standalone Payments state
const paymentCustomers = ref([]);
const selectedPaymentCustId = ref(null);
const standpayAmount = ref(0.0);
const standpayDate = ref(new Date().toISOString().split('T')[0]);
const standpayMode = ref('Cash');
const standpayNotes = ref('');
const standpaySuccess = ref('');
const standpayError = ref('');
const recentPayments = ref([]);

// Offline simulation flag
const isOffline = ref(true);

const loadCustomersForPayments = async () => {
  while (!dbService.initialized) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  try {
    paymentCustomers.value = await dbService.getAllCustomersForPayment();
  } catch (err) {
    console.error("Failed to load active customers for payments:", err);
  }
};

const loadRecentPayments = async () => {
  try {
    recentPayments.value = await dbService.getRecentPayments(10);
  } catch (err) {
    console.error("Failed to load recent payments:", err);
  }
};

const enterMainApp = async () => {
  // Post-login initialization
  await dbService.resetStaleSyncItems();
  await notificationService.initialize();
  await syncService.triggerSync();
  appState.value = 'main';
};

const handleLoggedIn = async () => {
  await enterMainApp();
};

const handleLogout = async () => {
  await authService.logout();
  appState.value = 'login';
};

onMounted(async () => {
  try {
    await dbService.initialize();
    dbStatus.value = 'connected';

    // Check if user is already authenticated
    const loggedIn = await authService.isLoggedIn();
    if (loggedIn) {
      await enterMainApp();
    } else {
      appState.value = 'login';
    }
  } catch (err) {
    dbStatus.value = 'error';
    errorMessage.value = err.message || String(err);
    appState.value = 'login'; // Allow login even on DB error display
  }
});

watch(currentTab, async (newTab) => {
  if (newTab === 'payments') {
    await loadCustomersForPayments();
    await loadRecentPayments();
  }
});

const selectTab = (tabName) => {
  currentTab.value = tabName;
  selectedCustomerId.value = null; // Reset detail view
};

const recordStandalonePayment = async () => {
  if (!selectedPaymentCustId.value) {
    standpayError.value = 'Please select a customer.';
    return;
  }
  if (standpayAmount.value <= 0) {
    standpayError.value = 'Amount collected must be greater than zero.';
    return;
  }
  try {
    await dbService.logPayment({
      customer_id: selectedPaymentCustId.value,
      amount_collected: Math.round(standpayAmount.value * 100), // Rupees to paise
      payment_date: standpayDate.value,
      payment_mode: standpayMode.value,
      notes: standpayNotes.value.trim()
    });

    standpaySuccess.value = 'Payment logged successfully!';
    standpayError.value = '';
    
    // Clear fields
    selectedPaymentCustId.value = null;
    standpayAmount.value = 0.0;
    standpayNotes.value = '';
    
    await loadRecentPayments();
    
    setTimeout(() => { standpaySuccess.value = ''; }, 3000);
  } catch (err) {
    standpayError.value = err.message || 'Failed to log payment.';
  }
};
</script>

<template>
  <div class="bg-surface text-on-surface font-body-md antialiased md:max-w-md md:mx-auto md:border-x md:border-outline-variant md:min-h-[884px] relative overflow-x-hidden min-h-screen pb-24">

    <!-- ── LOADING STATE ─────────────────────────────────────── -->
    <div v-if="appState === 'loading'" class="min-h-screen flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-blue-50 to-green-50">
      <div class="w-16 h-16 rounded-full bg-gradient-to-br from-blue-700 to-blue-400 flex items-center justify-center shadow-lg">
        <span style="font-size:32px">🥛</span>
      </div>
      <p class="text-base font-bold text-blue-800">DoodhWala</p>
      <span class="material-symbols-outlined animate-spin text-blue-600">sync</span>
    </div>

    <!-- ── LOGIN STATE ───────────────────────────────────────── -->
    <LoginScreen
      v-else-if="appState === 'login'"
      @logged-in="handleLoggedIn"
    />

    <!-- ── MAIN APP ──────────────────────────────────────────── -->
    <template v-else>
    <!-- Offline Banner (Simulated sync queue status) -->
    <div 
      v-if="isOffline" 
      class="bg-[#FFB95F] text-[#2A1700] px-gutter py-2 flex items-center justify-center space-x-2 sticky top-0 z-[60] text-label-sm font-label-sm shadow-sm"
    >
      <span class="material-symbols-outlined text-[18px]">wifi_off</span>
      <span>Offline Mode - Syncing Paused</span>
    </div>

    <!-- Top AppBar -->
    <header class="sticky top-0 z-50 flex items-center justify-between px-gutter w-full h-touch-target-min bg-surface dark:bg-background border-b border-surface-container">
      <!-- Left Icon: Database Status Indicator -->
      <div class="flex items-center gap-2">
        <button 
          aria-label="Database Status" 
          class="w-touch-target-min h-touch-target-min flex items-center justify-center rounded-full scale-95 transition-transform duration-100"
          :class="{
            'text-amber-500': dbStatus === 'connecting',
            'text-primary': dbStatus === 'connected',
            'text-error': dbStatus === 'error'
          }"
          :title="dbStatus === 'connected' ? 'SQLite Database Connected' : dbStatus === 'error' ? `DB Error: ${errorMessage}` : 'Connecting to DB...'"
        >
          <span class="material-symbols-outlined">
            {{ dbStatus === 'connected' ? 'database' : dbStatus === 'error' ? 'database_off' : 'sync' }}
          </span>
        </button>
      </div>

      <!-- App Title -->
      <h1 class="font-display-title text-display-title text-primary dark:text-primary-fixed-dim">
        DoodhWala
      </h1>

      <!-- Right Action: Simulated Search/Actions -->
      <button 
        aria-label="App Info" 
        @click="isOffline = !isOffline"
        class="w-touch-target-min h-touch-target-min flex items-center justify-center text-primary dark:text-primary-fixed-dim hover:bg-primary/8 rounded-full scale-95 transition-transform duration-100"
        :title="isOffline ? 'Go Online' : 'Go Offline'"
      >
        <span class="material-symbols-outlined">
          {{ isOffline ? 'cloud_off' : 'cloud_done' }}
        </span>
      </button>
    </header>

    <!-- Main Screens Container -->
    <div class="content-container">
      
      <!-- Home/Route Tab -->
      <RouteScreen 
        v-if="currentTab === 'home'" 
        @view-customer="(id) => { previousTab = 'home'; selectedCustomerId = id; currentTab = 'customer_detail'; }"
      />

      <!-- Customers Tab -->
      <CustomersScreen
        v-else-if="currentTab === 'customers'"
        @view-customer="(id) => { previousTab = 'customers'; selectedCustomerId = id; currentTab = 'customer_detail'; }"
      />

      <!-- Billing Tab -->
      <BillingScreen
        v-else-if="currentTab === 'billing'"
        @view-customer="(id) => { previousTab = 'billing'; selectedCustomerId = id; currentTab = 'customer_detail'; }"
      />

      <!-- Standalone Payments Tab (Screen 7 — Payment Collection) -->
      <div v-else-if="currentTab === 'payments'" class="p-gutter space-y-4">
        <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm space-y-4">
          <div class="flex items-center space-x-2 border-b border-surface-variant pb-3 mb-2">
            <span class="material-symbols-outlined text-primary text-[24px]">payments</span>
            <h2 class="font-bold text-on-surface text-lg">Record Payment Receipt</h2>
          </div>

          <!-- Customer Selector -->
          <div>
            <label class="text-xs font-semibold block text-on-surface mb-1">Select Customer</label>
            <select 
              v-model="selectedPaymentCustId"
              class="w-full border border-outline-variant bg-surface rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary"
            >
              <option :value="null" disabled>-- Select a customer --</option>
              <option v-for="c in paymentCustomers" :key="c.customer_id" :value="c.customer_id">
                {{ c.name }} (Seq #{{ c.route_sequence }})
              </option>
            </select>
          </div>

          <!-- Amount -->
          <div>
            <label class="text-xs font-semibold block text-on-surface mb-1">Amount Collected (Rupees)</label>
            <input 
              v-model.number="standpayAmount" 
              type="number" 
              step="1"
              placeholder="Enter amount (e.g. 500)"
              class="w-full border border-outline-variant bg-surface rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
            />
          </div>

          <!-- Receipt Date -->
          <div>
            <label class="text-xs font-semibold block text-on-surface mb-1">Receipt Date</label>
            <input 
              v-model="standpayDate" 
              type="date" 
              class="w-full border border-outline-variant bg-surface rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
            />
          </div>

          <!-- Mode -->
          <div>
            <label class="text-xs font-semibold block text-on-surface mb-1">Payment Mode</label>
            <div class="flex bg-surface-variant rounded-lg p-1.5">
              <button 
                @click="standpayMode = 'Cash'" 
                :class="['flex-1 py-3 text-center text-sm font-semibold rounded-md transition-all active:scale-95', standpayMode === 'Cash' ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:bg-surface-dim']"
              >
                💵 Cash
              </button>
              <button 
                @click="standpayMode = 'UPI'" 
                :class="['flex-1 py-3 text-center text-sm font-semibold rounded-md transition-all active:scale-95', standpayMode === 'UPI' ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:bg-surface-dim']"
              >
                📱 UPI
              </button>
            </div>
          </div>

          <!-- Notes -->
          <div>
            <label class="text-xs font-semibold block text-on-surface mb-1">Notes (Optional)</label>
            <input 
              v-model="standpayNotes" 
              type="text" 
              placeholder="e.g. Cleared pending dues"
              class="w-full border border-outline-variant bg-surface rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
            />
          </div>

          <p v-if="standpaySuccess" class="text-xs text-green-700 font-semibold bg-green-50 p-2 rounded border border-green-200">{{ standpaySuccess }}</p>
          <p v-if="standpayError" class="text-xs text-error font-semibold bg-red-50 p-2 rounded border border-red-200">{{ standpayError }}</p>

          <button 
            @click="recordStandalonePayment"
            class="w-full py-3 bg-primary text-on-primary rounded-lg font-button-text text-sm hover:bg-primary/95 shadow-md transition-all active:scale-[0.98]"
          >
            Confirm & Log Payment
          </button>
        </div>

        <!-- Recent Payments Panel -->
        <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm space-y-4">
          <div class="flex items-center space-x-2 border-b border-surface-variant pb-3 mb-2">
            <span class="material-symbols-outlined text-primary text-[24px]">history</span>
            <h2 class="font-bold text-on-surface text-lg">Recent Payment Receipts</h2>
          </div>

          <div v-if="recentPayments.length === 0" class="py-8 text-center text-xs text-on-surface-variant">
            No payments logged recently.
          </div>

          <div v-else class="space-y-3">
            <div 
              v-for="pay in recentPayments" 
              :key="pay.pay_id" 
              class="flex items-center justify-between p-3 rounded-lg border border-outline-variant bg-surface-container-low shadow-sm"
            >
              <div class="flex items-center space-x-3">
                <div class="w-8 h-8 rounded-full bg-green-50 text-green-700 flex items-center justify-center font-bold text-xs">
                  {{ pay.payment_mode === 'Cash' ? '💵' : '📱' }}
                </div>
                <div>
                  <h4 class="font-bold text-on-surface text-sm">{{ pay.customer_name }}</h4>
                  <p class="text-xs text-on-surface-variant mt-0.5">
                    {{ new Date(pay.payment_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) }} 
                    <span class="text-outline">•</span> {{ pay.payment_mode }} 
                    <span v-if="pay.notes" class="text-outline">•</span> {{ pay.notes }}
                  </p>
                </div>
              </div>
              <div class="text-right">
                <span class="font-bold text-green-700 text-sm">
                  ₹{{ (pay.amount_collected / 100).toFixed(2) }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Settings Tab -->
      <SettingsScreen
        v-else-if="currentTab === 'settings'"
        @logout="handleLogout"
      />

      <!-- Customer Detail Dashboard Screen -->
      <CustomerDetail 
        v-else-if="currentTab === 'customer_detail'" 
        :customerId="selectedCustomerId" 
        @back="currentTab = previousTab" 
      />

    </div>

    <!-- Bottom Navigation -->
    <nav class="fixed bottom-0 w-full z-50 flex justify-around items-center px-base py-stack-sm bg-surface dark:bg-background border-t border-outline-variant dark:border-outline md:max-w-md md:mx-auto md:left-0 md:right-0 shadow-lg">
      
      <!-- Home Tab -->
      <button 
        @click="selectTab('home')"
        :class="[
          'flex flex-col items-center justify-center w-[64px] active:scale-90 transition-all',
          currentTab === 'home' ? 'text-primary' : 'text-on-secondary-container hover:bg-secondary-container/50 rounded-lg'
        ]"
      >
        <div :class="['rounded-full px-4 py-1 mb-1 flex items-center justify-center', currentTab === 'home' ? 'bg-secondary-container text-primary font-bold' : '']">
          <span class="material-symbols-outlined">route</span>
        </div>
        <span class="font-label-sm text-[12px] leading-tight">Home</span>
      </button>

      <!-- Customers Tab -->
      <button 
        @click="selectTab('customers')"
        :class="[
          'flex flex-col items-center justify-center w-[64px] active:scale-90 transition-all',
          currentTab === 'customers' ? 'text-primary' : 'text-on-secondary-container hover:bg-secondary-container/50 rounded-lg'
        ]"
      >
        <div :class="['rounded-full px-4 py-1 mb-1 flex items-center justify-center', currentTab === 'customers' ? 'bg-secondary-container text-primary font-bold' : '']">
          <span class="material-symbols-outlined">groups</span>
        </div>
        <span class="font-label-sm text-[12px] leading-tight">Customers</span>
      </button>

      <!-- Billing Tab -->
      <button 
        @click="selectTab('billing')"
        :class="[
          'flex flex-col items-center justify-center w-[64px] active:scale-90 transition-all',
          currentTab === 'billing' ? 'text-primary' : 'text-on-secondary-container hover:bg-secondary-container/50 rounded-lg'
        ]"
      >
        <div :class="['rounded-full px-4 py-1 mb-1 flex items-center justify-center', currentTab === 'billing' ? 'bg-secondary-container text-primary font-bold' : '']">
          <span class="material-symbols-outlined">receipt_long</span>
        </div>
        <span class="font-label-sm text-[12px] leading-tight">Billing</span>
      </button>

      <!-- Payments Tab -->
      <button 
        @click="selectTab('payments')"
        :class="[
          'flex flex-col items-center justify-center w-[64px] active:scale-90 transition-all',
          currentTab === 'payments' ? 'text-primary' : 'text-on-secondary-container hover:bg-secondary-container/50 rounded-lg'
        ]"
      >
        <div :class="['rounded-full px-4 py-1 mb-1 flex items-center justify-center', currentTab === 'payments' ? 'bg-secondary-container text-primary font-bold' : '']">
          <span class="material-symbols-outlined">payments</span>
        </div>
        <span class="font-label-sm text-[12px] leading-tight">Payments</span>
      </button>

      <!-- Settings Tab -->
      <button 
        @click="selectTab('settings')"
        :class="[
          'flex flex-col items-center justify-center w-[64px] active:scale-90 transition-all',
          currentTab === 'settings' ? 'text-primary' : 'text-on-secondary-container hover:bg-secondary-container/50 rounded-lg'
        ]"
      >
        <div :class="['rounded-full px-4 py-1 mb-1 flex items-center justify-center', currentTab === 'settings' ? 'bg-secondary-container text-primary font-bold' : '']">
          <span class="material-symbols-outlined">settings</span>
        </div>
        <span class="font-label-sm text-[12px] leading-tight">Settings</span>
      </button>

    </nav>
    </template><!-- end v-else main app -->
  </div>
</template>

<style scoped>
.px-gutter {
  padding-left: var(--spacing-gutter);
  padding-right: var(--spacing-gutter);
}

.h-touch-target-min {
  height: var(--spacing-touch-target-min);
}

.bg-surface {
  background-color: var(--surface);
}

.text-on-surface {
  color: var(--on-surface);
}

.text-on-surface-variant {
  color: var(--on-surface-variant);
}

.text-primary {
  color: var(--primary);
}

.border-outline-variant {
  border-color: var(--outline-variant);
}

.border-surface-container {
  border-color: var(--surface-container);
}
</style>
