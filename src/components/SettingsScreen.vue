<script setup>
import { ref, onMounted, computed } from 'vue';
import { dbService } from '../services/db';
import { syncService } from '../services/sync';
import { config } from '../config';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const emit = defineEmits(['logout']);

// State variables
const profile = ref({
  business_name: '',
  milkman_name: '',
  phone_number: '',
  upi_id: '',
  address: ''
});

const settings = ref({
  default_step_size: 0.25,
  auto_share_mode: 0,
  theme_mode: 'HIGH_CONTRAST_LIGHT',
  billing_cycle_day: 1,
  morning_cutoff_hour: 12,
  supabase_url: '',
  supabase_anon_key: '',
  milkman_uuid: '',
  last_sync_timestamp: null
});

const products = ref([]);
const customers = ref([]);

// UI Active Accordion Section: 'profile' | 'products' | 'route' | 'billing' | 'sync' | 'backup' | none
const activeSection = ref('profile');

// Forms state
const newProdName = ref('');
const newProdUnit = ref('Litre');
const productError = ref('');

const profileSuccess = ref('');
const settingsSuccess = ref('');
const syncRunning = ref(false);
const syncError = ref('');
const syncSuccess = ref('');
const backupSuccess = ref('');
const backupError = ref('');

const hasSupabaseConfig = computed(() => !!(config.supabaseUrl && config.supabaseAnonKey));

// Load all configuration data
const loadData = async () => {
  try {
    // 1. Load Profile
    const profRes = await dbService.query("SELECT * FROM BusinessProfile LIMIT 1;");
    if (profRes.values && profRes.values.length > 0) {
      profile.value = profRes.values[0];
    }

    // 2. Load Settings
    const setRes = await dbService.getAppSettings();
    if (setRes) {
      settings.value = setRes;
    }

    // 3. Load Products
    const prodRes = await dbService.query("SELECT * FROM Products ORDER BY product_id ASC;");
    products.value = prodRes.values || [];

    // 4. Load Customers (for route sequencing)
    const custRes = await dbService.query("SELECT customer_id, name, route_sequence FROM Customers WHERE deleted_at IS NULL ORDER BY route_sequence ASC;");
    customers.value = custRes.values || [];
  } catch (err) {
    console.error("Failed to load settings screen configuration:", err);
  }
};

onMounted(async () => {
  while (!dbService.initialized) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await loadData();
});

// Toggle active accordion
const toggleSection = (secName) => {
  activeSection.value = activeSection.value === secName ? '' : secName;
};

// Update Business Profile
const saveProfile = async () => {
  if (!profile.value.business_name.trim() || !profile.value.milkman_name.trim() || !profile.value.phone_number.trim() || !profile.value.upi_id.trim()) {
    alert("All profile fields except address are required.");
    return;
  }

  try {
    await dbService.run(
      `UPDATE BusinessProfile SET 
        business_name = ?, 
        milkman_name = ?, 
        phone_number = ?, 
        upi_id = ?, 
        address = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE business_id = ?;`,
      [
        profile.value.business_name.trim(),
        profile.value.milkman_name.trim(),
        profile.value.phone_number.trim(),
        profile.value.upi_id.trim(),
        profile.value.address ? profile.value.address.trim() : '',
        profile.value.business_id
      ]
    );

    profileSuccess.value = 'Profile updated successfully!';
    setTimeout(() => { profileSuccess.value = ''; }, 3000);
    await loadData();
  } catch (err) {
    alert("Failed to update profile: " + err.message);
  }
};

// Update General App & Supabase settings
const saveSettings = async () => {
  try {
    await dbService.updateAppSettings(settings.value);
    settingsSuccess.value = 'Preferences saved successfully!';
    setTimeout(() => { settingsSuccess.value = ''; }, 3000);
    await loadData();
  } catch (err) {
    alert("Failed to save settings: " + err.message);
  }
};

// Add product to catalog
const addProduct = async () => {
  if (!newProdName.value.trim()) {
    productError.value = 'Product name is required.';
    return;
  }

  try {
    const uuid = 'prod-' + Math.random().toString(36).substring(2, 9);
    await dbService.run(
      "INSERT INTO Products (product_uuid, product_name, unit, is_active) VALUES (?, ?, ?, 1);",
      [uuid, newProdName.value.trim(), newProdUnit.value]
    );

    newProdName.value = '';
    productError.value = '';
    await loadData();
  } catch (err) {
    productError.value = err.message || 'Failed to add product.';
  }
};

// Toggle product status (active/deactive)
const toggleProductActive = async (prod) => {
  try {
    const targetStatus = prod.is_active === 1 ? 0 : 1;
    await dbService.run(
      "UPDATE Products SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE product_id = ?;",
      [targetStatus, prod.product_id]
    );
    await loadData();
  } catch (err) {
    alert("Failed to update product status: " + err.message);
  }
};

// Swap route sequence priority
const moveCustomer = async (index, direction) => {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= customers.value.length) return;

  const currentCust = customers.value[index];
  const targetCust = customers.value[targetIndex];

  try {
    await dbService.execute("BEGIN TRANSACTION;");
    
    // Swap route sequences
    const tempSeq = currentCust.route_sequence;
    currentCust.route_sequence = targetCust.route_sequence;
    targetCust.route_sequence = tempSeq;

    await dbService.run("UPDATE Customers SET route_sequence = ? WHERE customer_id = ?;", [currentCust.route_sequence, currentCust.customer_id]);
    await dbService.run("UPDATE Customers SET route_sequence = ? WHERE customer_id = ?;", [targetCust.route_sequence, targetCust.customer_id]);

    // Add Sync entries
    const cRes1 = await dbService.query("SELECT customer_uuid FROM Customers WHERE customer_id = ? LIMIT 1;", [currentCust.customer_id]);
    const cRes2 = await dbService.query("SELECT customer_uuid FROM Customers WHERE customer_id = ? LIMIT 1;", [targetCust.customer_id]);
    
    if (cRes1.values && cRes1.values.length > 0) {
      await dbService.run("INSERT INTO SyncQueue (entity_type, entity_uuid, operation) VALUES (?, ?, ?);", ['Customers', cRes1.values[0].customer_uuid, 'UPDATE']);
    }
    if (cRes2.values && cRes2.values.length > 0) {
      await dbService.run("INSERT INTO SyncQueue (entity_type, entity_uuid, operation) VALUES (?, ?, ?);", ['Customers', cRes2.values[0].customer_uuid, 'UPDATE']);
    }

    await dbService.execute("COMMIT;");
    await loadData();
  } catch (err) {
    await dbService.execute("ROLLBACK;");
    console.error("Failed to resequence customer route:", err);
  }
};

// Manual trigger sync
const runManualSync = async () => {
  if (syncRunning.value) return;

  syncRunning.value = true;
  syncError.value = '';
  syncSuccess.value = '';

  try {
    await syncService.triggerSync();
    syncSuccess.value = 'Synchronization complete!';
    await loadData();
  } catch (err) {
    syncError.value = err.message || 'Sync failed. Check connection or settings.';
  } finally {
    syncRunning.value = false;
  }
};

// Export all database tables to a text backup file
const exportJsonBackup = async () => {
  backupSuccess.value = '';
  backupError.value = '';

  try {
    const backupData = {};
    const tables = [
      'AppSettings', 'BusinessProfile', 'Products', 'Customers', 
      'Subscriptions', 'VacationSchedules', 'DailyDelivery', 
      'DeliveryAuditLog', 'PaymentLog', 'AdjustmentLog', 
      'Invoice', 'InvoiceLineItem', 'NotificationQueue'
    ];

    for (const tbl of tables) {
      const res = await dbService.query(`SELECT * FROM ${tbl};`);
      backupData[tbl] = res.values || [];
    }

    const jsonString = JSON.stringify(backupData, null, 2);
    const fileName = `DoodhWala_DB_Backup_${new Date().toISOString().split('T')[0]}.json`;

    // Save locally to Cache directory
    const writeRes = await Filesystem.writeFile({
      path: fileName,
      data: btoa(unescape(encodeURIComponent(jsonString))), // Convert unicode text to base64
      directory: Directory.Cache
    });

    // Share backup file
    await Share.share({
      title: 'DoodhWala Backup File',
      text: 'My DoodhWala relational ledger JSON database backup.',
      url: writeRes.uri,
      dialogTitle: 'Export Backup file'
    });

    backupSuccess.value = 'Database backup shared successfully!';
  } catch (err) {
    backupError.value = err.message || 'Failed to generate backup.';
  }
};

// Export specific table to CSV
const exportTableCsv = async (tableName) => {
  backupSuccess.value = '';
  backupError.value = '';

  try {
    const res = await dbService.query(`SELECT * FROM ${tableName};`);
    const rows = res.values || [];
    if (rows.length === 0) {
      alert(`No records found in table ${tableName} to export.`);
      return;
    }

    // Extract headers
    const headers = Object.keys(rows[0]);
    let csvContent = headers.join(',') + '\n';

    // Populate lines
    for (const r of rows) {
      const values = headers.map(h => {
        const val = r[h];
        if (val === null || val === undefined) return '';
        // Escape quotes
        const strVal = String(val).replace(/"/g, '""');
        return strVal.includes(',') || strVal.includes('\n') ? `"${strVal}"` : strVal;
      });
      csvContent += values.join(',') + '\n';
    }

    const fileName = `DoodhWala_CSV_${tableName}_${new Date().toISOString().split('T')[0]}.csv`;
    const base64Content = btoa(unescape(encodeURIComponent(csvContent)));

    const writeRes = await Filesystem.writeFile({
      path: fileName,
      data: base64Content,
      directory: Directory.Cache
    });

    await Share.share({
      title: `${tableName} Export`,
      text: `DoodhWala CSV data for ${tableName}`,
      url: writeRes.uri,
      dialogTitle: `Share ${tableName} CSV`
    });

    backupSuccess.value = `${tableName} exported to CSV!`;
  } catch (err) {
    backupError.value = err.message || 'Failed to export CSV.';
  }
};
</script>

<template>
  <div class="px-gutter py-4 space-y-4 pb-28">
    <div class="border-b border-surface-variant pb-3 mb-2 flex items-center space-x-2">
      <span class="material-symbols-outlined text-primary text-[24px]">settings</span>
      <h2 class="font-bold text-on-surface text-lg">System Configuration</h2>
    </div>

    <!-- 1. MY PROFILE SECTION -->
    <div class="border border-outline-variant rounded-xl overflow-hidden bg-surface-container-lowest shadow-sm">
      <button 
        @click="toggleSection('profile')"
        class="w-full px-4 py-3 bg-surface-container-low flex justify-between items-center text-sm font-bold text-on-surface hover:bg-surface-dim transition-colors"
      >
        <span class="flex items-center">
          <span class="material-symbols-outlined text-[18px] mr-2 text-primary">person_pin</span>
          My Profile Identity
        </span>
        <span class="material-symbols-outlined transition-transform duration-200" :class="activeSection === 'profile' ? 'rotate-180' : ''">expand_more</span>
      </button>

      <div v-if="activeSection === 'profile'" class="p-4 space-y-4 border-t border-outline-variant animate-in slide-in-from-top duration-200">
        <div>
          <label class="text-xs font-semibold block text-on-surface mb-1">Business Name</label>
          <input v-model="profile.business_name" type="text" class="w-full border border-outline-variant bg-surface rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none" />
        </div>
        <div>
          <label class="text-xs font-semibold block text-on-surface mb-1">Milkman Full Name</label>
          <input v-model="profile.milkman_name" type="text" class="w-full border border-outline-variant bg-surface rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none" />
        </div>
        <div>
          <label class="text-xs font-semibold block text-on-surface mb-1">Phone Number</label>
          <input v-model="profile.phone_number" type="tel" class="w-full border border-outline-variant bg-surface rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none" />
        </div>
        <div>
          <label class="text-xs font-semibold block text-on-surface mb-1">UPI ID for Invoice Payments</label>
          <input v-model="profile.upi_id" type="text" placeholder="e.g. kdairy@okaxis" class="w-full border border-outline-variant bg-surface rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none" />
        </div>
        <div>
          <label class="text-xs font-semibold block text-on-surface mb-1">Business Address (Optional)</label>
          <textarea v-model="profile.address" rows="2" class="w-full border border-outline-variant bg-surface rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none resize-none"></textarea>
        </div>

        <p v-if="profileSuccess" class="text-xs font-semibold text-green-700 bg-green-50 p-2 rounded border border-green-200">{{ profileSuccess }}</p>

        <button @click="saveProfile" class="w-full py-2 bg-primary text-on-primary font-bold text-xs rounded-lg hover:bg-primary/95 transition-all shadow-sm">
          Save Profile Details
        </button>
      </div>
    </div>

    <!-- 2. PRODUCTS CATALOG SECTION -->
    <div class="border border-outline-variant rounded-xl overflow-hidden bg-surface-container-lowest shadow-sm">
      <button 
        @click="toggleSection('products')"
        class="w-full px-4 py-3 bg-surface-container-low flex justify-between items-center text-sm font-bold text-on-surface hover:bg-surface-dim transition-colors"
      >
        <span class="flex items-center">
          <span class="material-symbols-outlined text-[18px] mr-2 text-primary">local_mall</span>
          Products Catalog
        </span>
        <span class="material-symbols-outlined transition-transform duration-200" :class="activeSection === 'products' ? 'rotate-180' : ''">expand_more</span>
      </button>

      <div v-if="activeSection === 'products'" class="p-4 space-y-4 border-t border-outline-variant animate-in slide-in-from-top duration-200">
        <!-- Add Product Form -->
        <div class="bg-surface p-3 rounded-lg border border-outline-variant space-y-3">
          <h4 class="text-xs font-bold text-on-surface">Add New Product</h4>
          <div>
            <label class="text-[10px] font-semibold block text-on-surface-variant mb-1">Product Name</label>
            <input v-model="newProdName" type="text" placeholder="e.g. A2 Cow Milk" class="w-full border border-outline-variant bg-surface-container-lowest rounded px-2.5 py-1.5 text-xs text-on-surface focus:outline-none" />
          </div>
          <div>
            <label class="text-[10px] font-semibold block text-on-surface-variant mb-1">Measurement Unit</label>
            <select v-model="newProdUnit" class="w-full border border-outline-variant bg-surface-container-lowest rounded px-2.5 py-1 text-xs text-on-surface focus:outline-none">
              <option value="Litre">Litre (Standard)</option>
              <option value="Kg">Kg</option>
              <option value="Packet">Packet</option>
            </select>
          </div>

          <p v-if="productError" class="text-xs text-error font-medium">{{ productError }}</p>

          <button @click="addProduct" class="w-full py-1.5 bg-primary text-on-primary font-bold text-xs rounded shadow-sm hover:bg-primary/95">
            Add to Catalog
          </button>
        </div>

        <!-- Catalog List -->
        <div class="space-y-2">
          <h4 class="text-xs font-bold text-on-surface-variant border-b border-surface-variant pb-1.5">Registered Products</h4>
          <div v-for="p in products" :key="p.product_id" class="flex justify-between items-center py-2 px-2.5 bg-surface border border-outline-variant rounded-md text-xs">
            <div>
              <p class="font-bold text-on-surface">{{ p.product_name }}</p>
              <span class="text-[10px] text-on-surface-variant bg-surface-container-low px-1.5 py-0.5 rounded font-medium">Unit: {{ p.unit }}</span>
            </div>
            <button 
              @click="toggleProductActive(p)"
              :class="['px-2.5 py-1 rounded font-bold transition-all text-[10px]', p.is_active === 1 ? 'bg-green-50 text-green-700 border border-green-200 hover:bg-green-100' : 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100']"
            >
              {{ p.is_active === 1 ? 'Active' : 'Inactive' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 3. ROUTE MANAGEMENT / SEQUENCING SECTION -->
    <div class="border border-outline-variant rounded-xl overflow-hidden bg-surface-container-lowest shadow-sm">
      <button 
        @click="toggleSection('route')"
        class="w-full px-4 py-3 bg-surface-container-low flex justify-between items-center text-sm font-bold text-on-surface hover:bg-surface-dim transition-colors"
      >
        <span class="flex items-center">
          <span class="material-symbols-outlined text-[18px] mr-2 text-primary">swap_vert</span>
          Route Sequence Priority
        </span>
        <span class="material-symbols-outlined transition-transform duration-200" :class="activeSection === 'route' ? 'rotate-180' : ''">expand_more</span>
      </button>

      <div v-if="activeSection === 'route'" class="p-4 space-y-3 border-t border-outline-variant animate-in slide-in-from-top duration-200">
        <p class="text-xs text-on-surface-variant leading-relaxed mb-1.5">
          Adjust the sequencing priority below. This orders how customers are sorted during morning and evening delivery routes.
        </p>

        <div v-if="customers.length === 0" class="text-center py-6 text-xs text-on-surface-variant bg-surface border border-dashed border-outline-variant rounded-lg">
          No registered customers to sequence.
        </div>

        <div v-else class="space-y-2">
          <div 
            v-for="(c, idx) in customers" 
            :key="c.customer_id" 
            class="flex items-center justify-between py-2 px-3 bg-surface border border-outline-variant rounded-md text-xs shadow-sm"
          >
            <div class="flex items-center space-x-2">
              <span class="h-6 w-6 rounded bg-surface-container text-primary font-bold flex items-center justify-center text-[10px]">
                #{{ idx + 1 }}
              </span>
              <span class="font-bold text-on-surface">{{ c.name }}</span>
            </div>

            <div class="flex items-center space-x-1">
              <button 
                @click="moveCustomer(idx, -1)" 
                :disabled="idx === 0"
                class="h-7 w-7 rounded bg-surface-container hover:bg-surface-dim flex items-center justify-center text-primary disabled:opacity-30"
              >
                <span class="material-symbols-outlined text-[16px]">arrow_upward</span>
              </button>
              <button 
                @click="moveCustomer(idx, 1)" 
                :disabled="idx === customers.length - 1"
                class="h-7 w-7 rounded bg-surface-container hover:bg-surface-dim flex items-center justify-center text-primary disabled:opacity-30"
              >
                <span class="material-symbols-outlined text-[16px]">arrow_downward</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 4. BILLING PREFERENCES SECTION -->
    <div class="border border-outline-variant rounded-xl overflow-hidden bg-surface-container-lowest shadow-sm">
      <button 
        @click="toggleSection('billing')"
        class="w-full px-4 py-3 bg-surface-container-low flex justify-between items-center text-sm font-bold text-on-surface hover:bg-surface-dim transition-colors"
      >
        <span class="flex items-center">
          <span class="material-symbols-outlined text-[18px] mr-2 text-primary">receipt_long</span>
          Billing Preferences
        </span>
        <span class="material-symbols-outlined transition-transform duration-200" :class="activeSection === 'billing' ? 'rotate-180' : ''">expand_more</span>
      </button>

      <div v-if="activeSection === 'billing'" class="p-4 space-y-4 border-t border-outline-variant animate-in slide-in-from-top duration-200">
        <div>
          <label class="text-xs font-semibold block text-on-surface-variant mb-1">Default Adjustment Step Size</label>
          <select v-model.number="settings.default_step_size" class="w-full border border-outline-variant bg-surface rounded px-3 py-2 text-sm text-on-surface focus:outline-none">
            <option :value="0.25">0.25 Litre (Standard)</option>
            <option :value="0.5">0.50 Litre (Bulk)</option>
          </select>
        </div>

        <div>
          <label class="text-xs font-semibold block text-on-surface-variant mb-1">Morning Shift Cutoff Hour (24h format)</label>
          <input v-model.number="settings.morning_cutoff_hour" type="number" min="0" max="23" class="w-full border border-outline-variant bg-surface rounded px-3 py-2 text-sm text-on-surface focus:outline-none" />
          <span class="text-[10px] text-on-surface-variant mt-0.5 block">Deliveries before this hour default to Morning, and after default to Evening.</span>
        </div>

        <div>
          <label class="text-xs font-semibold block text-on-surface-variant mb-1">Monthly Billing Cycle Day</label>
          <input v-model.number="settings.billing_cycle_day" type="number" min="1" max="28" class="w-full border border-outline-variant bg-surface rounded px-3 py-2 text-sm text-on-surface focus:outline-none" />
          <span class="text-[10px] text-on-surface-variant mt-0.5 block">Determines the day of the month when billing resets (default: 1).</span>
        </div>

        <div>
          <label class="text-xs font-semibold block text-on-surface-variant mb-1">Invoice Generation Theme Mode</label>
          <select v-model="settings.theme_mode" class="w-full border border-outline-variant bg-surface rounded px-3 py-2 text-sm text-on-surface focus:outline-none">
            <option value="HIGH_CONTRAST_LIGHT">High Contrast Light (Print Friendly)</option>
            <option value="EMERALD_CLEAN">Emerald Clean Accent</option>
          </select>
        </div>

        <p v-if="settingsSuccess" class="text-xs font-semibold text-green-700 bg-green-50 p-2 rounded border border-green-200">{{ settingsSuccess }}</p>

        <button @click="saveSettings" class="w-full py-2 bg-primary text-on-primary font-bold text-xs rounded-lg hover:bg-primary/95 transition-all shadow-sm">
          Save Billing Preferences
        </button>
      </div>
    </div>

    <!-- 5. CLOUD SYNC STATUS SECTION -->
    <div class="border border-outline-variant rounded-xl overflow-hidden bg-surface-container-lowest shadow-sm">
      <button 
        @click="toggleSection('sync')"
        class="w-full px-4 py-3 bg-surface-container-low flex justify-between items-center text-sm font-bold text-on-surface hover:bg-surface-dim transition-colors"
      >
        <span class="flex items-center">
          <span class="material-symbols-outlined text-[18px] mr-2 text-primary">cloud_sync</span>
          Cloud Synchronization
        </span>
        <span class="material-symbols-outlined transition-transform duration-200" :class="activeSection === 'sync' ? 'rotate-180' : ''">expand_more</span>
      </button>

      <div v-if="activeSection === 'sync'" class="p-4 space-y-4 border-t border-outline-variant animate-in slide-in-from-top duration-200">
        <!-- Connection Status -->
        <div class="flex justify-between items-center text-xs">
          <span class="text-on-surface-variant font-semibold">Service Status:</span>
          <span :class="['px-2 py-0.5 rounded-full font-bold text-[10px]', hasSupabaseConfig ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200']">
            {{ hasSupabaseConfig ? 'Cloud Sync Ready' : 'Offline Mode Only' }}
          </span>
        </div>

        <div v-if="settings.milkman_uuid" class="text-xs space-y-1">
          <span class="text-on-surface-variant font-semibold block">Milkman Account ID:</span>
          <span class="font-mono text-[11px] bg-surface-container px-2 py-1.5 rounded block text-on-surface break-all select-all">
            {{ settings.milkman_uuid }}
          </span>
        </div>

        <!-- Last Sync Info -->
        <div class="p-2.5 bg-surface border border-outline-variant rounded text-xs text-on-surface-variant">
          Last Sync Attempt: <span class="font-bold text-on-surface">{{ settings.last_sync_timestamp ? new Date(settings.last_sync_timestamp).toLocaleString('en-IN') : 'Never Synced' }}</span>
        </div>

        <p v-if="syncSuccess" class="text-xs font-semibold text-green-700 bg-green-50 p-2 rounded border border-green-200">{{ syncSuccess }}</p>
        <p v-if="syncError" class="text-xs font-semibold text-error bg-red-50 p-2 rounded border border-red-200">{{ syncError }}</p>

        <div class="pt-2">
          <button 
            @click="runManualSync" 
            :disabled="syncRunning || !hasSupabaseConfig"
            class="w-full py-2.5 bg-primary text-on-primary font-bold text-xs rounded-lg hover:bg-primary/95 flex items-center justify-center disabled:opacity-50 shadow-sm"
          >
            <span class="material-symbols-outlined text-[16px] mr-1.5" :class="syncRunning ? 'animate-spin' : ''">sync</span>
            {{ syncRunning ? 'Synchronizing...' : 'Sync Now' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 6. DATA & BACKUP SECTION -->
    <div class="border border-outline-variant rounded-xl overflow-hidden bg-surface-container-lowest shadow-sm">
      <button 
        @click="toggleSection('backup')"
        class="w-full px-4 py-3 bg-surface-container-low flex justify-between items-center text-sm font-bold text-on-surface hover:bg-surface-dim transition-colors"
      >
        <span class="flex items-center">
          <span class="material-symbols-outlined text-[18px] mr-2 text-primary">backup</span>
          Data & Database Backup
        </span>
        <span class="material-symbols-outlined transition-transform duration-200" :class="activeSection === 'backup' ? 'rotate-180' : ''">expand_more</span>
      </button>

      <div v-if="activeSection === 'backup'" class="p-4 space-y-4 border-t border-outline-variant animate-in slide-in-from-top duration-200">
        <p class="text-xs text-on-surface-variant leading-relaxed">
          Create complete backups of your relational delivery logs, ledger history, payments, and settings, or export tables separately to CSV sheets.
        </p>

        <p v-if="backupSuccess" class="text-xs font-semibold text-green-700 bg-green-50 p-2 rounded border border-green-200">{{ backupSuccess }}</p>
        <p v-if="backupError" class="text-xs font-semibold text-error bg-red-50 p-2 rounded border border-red-200">{{ backupError }}</p>

        <!-- Database Export button -->
        <button 
          @click="exportJsonBackup" 
          class="w-full py-2.5 bg-primary text-on-primary font-bold text-xs rounded-lg hover:bg-primary/95 shadow-sm flex items-center justify-center space-x-1.5"
        >
          <span class="material-symbols-outlined text-[18px]">share_windows</span>
          <span>Export SQLite Database Backup (JSON)</span>
        </button>

        <div class="border-t border-surface-variant pt-3 space-y-2">
          <h4 class="text-xs font-bold text-on-surface-variant">Export Tables to CSV Spreadsheet</h4>
          <div class="grid grid-cols-2 gap-2">
            <button @click="exportTableCsv('Customers')" class="py-1.5 border border-outline-variant bg-surface hover:bg-surface-dim text-[11px] font-semibold rounded text-on-surface">
              📊 Customers CSV
            </button>
            <button @click="exportTableCsv('DailyDelivery')" class="py-1.5 border border-outline-variant bg-surface hover:bg-surface-dim text-[11px] font-semibold rounded text-on-surface">
              🥛 Deliveries CSV
            </button>
            <button @click="exportTableCsv('PaymentLog')" class="py-1.5 border border-outline-variant bg-surface hover:bg-surface-dim text-[11px] font-semibold rounded text-on-surface">
              💰 Payments CSV
            </button>
            <button @click="exportTableCsv('Invoice')" class="py-1.5 border border-outline-variant bg-surface hover:bg-surface-dim text-[11px] font-semibold rounded text-on-surface">
              🧾 Invoices CSV
            </button>
          </div>
        </div>
      </div>
    </div>
    <!-- 7. ACCOUNT & LOGOUT SECTION -->
    <div class="border border-red-200 rounded-xl overflow-hidden bg-red-50 shadow-sm">
      <button 
        @click="toggleSection('account')"
        class="w-full px-4 py-3 bg-red-50 flex justify-between items-center text-sm font-bold text-red-700 hover:bg-red-100 transition-colors"
      >
        <span class="flex items-center">
          <span class="material-symbols-outlined text-[18px] mr-2 text-red-600">account_circle</span>
          Account
        </span>
        <span class="material-symbols-outlined transition-transform duration-200" :class="activeSection === 'account' ? 'rotate-180' : ''">expand_more</span>
      </button>

      <div v-if="activeSection === 'account'" class="p-4 space-y-3 border-t border-red-200 animate-in slide-in-from-top duration-200">
        <p class="text-xs text-red-700 leading-relaxed">
          Logging out will require you to re-verify via OTP on next launch. Your local SQLite data is <strong>not deleted</strong> — only the auth session is cleared.
        </p>
        <button 
          id="logout-btn"
          @click="emit('logout')"
          class="w-full py-3 bg-red-600 text-white font-bold text-sm rounded-lg hover:bg-red-700 transition-all shadow-sm flex items-center justify-center space-x-2"
        >
          <span class="material-symbols-outlined text-[18px]">logout</span>
          <span>Log Out</span>
        </button>
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
