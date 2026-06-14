import { dbService } from './db';
import { notificationService } from './notifications';

class SyncService {
  constructor() {
    this.syncing = false;
    this.networkOnline = navigator.onLine;

    // Listen to network status changes
    window.addEventListener('online', () => {
      this.networkOnline = true;
      this.triggerSync();
    });
    window.addEventListener('offline', () => {
      this.networkOnline = false;
    });
  }

  // Trigger sync if online and settings are configured
  async triggerSync() {
    if (this.syncing) return;
    if (!this.networkOnline) {
      console.log("Sync skipped: Device offline.");
      return;
    }

    const settings = await dbService.getAppSettings();
    if (!settings || !settings.supabase_url || !settings.supabase_anon_key || !settings.milkman_uuid) {
      console.log("Sync skipped: Supabase credentials not configured in AppSettings.");
      return;
    }
    // Require real auth session (not dev bypass token) for actual sync
    if (settings.auth_token === 'dev-bypass-token') {
      console.log("Sync skipped: Dev bypass mode active — real auth session required.");
      return;
    }

    this.syncing = true;
    let consecutiveFailures = 0;

    try {
      console.log("Background sync started...");
      while (true) {
        // Fetch next batch of 50 unsynced operations
        const queue = await dbService.getUnsyncedQueue(50);
        if (queue.length === 0) {
          break;
        }

        const syncIds = queue.map(q => q.sync_id);
        await dbService.markQueueProcessing(syncIds);

        for (const item of queue) {
          try {
            await this.syncEntity(item, settings);
            // Delete queue row and mark entity as synced
            await dbService.resolveQueueSynced(item.sync_id, item.entity_type, item.entity_uuid);
            consecutiveFailures = 0; // Reset on success
          } catch (err) {
            console.error(`Sync failed for item ${item.sync_id} (${item.entity_type}):`, err);
            consecutiveFailures++;

            const newRetry = item.retry_count + 1;
            const newStatus = newRetry >= 5 ? 'FAILED' : 'QUEUED';
            await dbService.failQueueRetry(item.sync_id, newRetry, newStatus);

            // After 3 consecutive failures, log a sync failure notification
            if (consecutiveFailures === 3) {
              await dbService.logNotification(
                'SYNC_FAILURE_ALERT',
                null,
                new Date().toISOString()
              );
              await notificationService.triggerSyncFailureNotification();
              // Disconnect or pause loop on persistent network failure
              throw new Error("Sync paused due to multiple consecutive failures.");
            }
          }
        }
      }

      // Update last sync timestamp in AppSettings
      await dbService.run(
        "UPDATE AppSettings SET last_sync_timestamp = CURRENT_TIMESTAMP WHERE setting_id = 1;"
      );
      console.log("Sync completed successfully.");
    } catch (err) {
      console.error("Global sync loop error:", err);
    } finally {
      this.syncing = false;
    }
  }

  // Sync a single record using Supabase PostgREST API
  async syncEntity(item, settings) {
    const { supabase_url, supabase_anon_key, auth_token, milkman_uuid } = settings;
    const { entity_type, entity_uuid, operation } = item;

    // Use JWT auth_token for Authorization if available (enables RLS),
    // otherwise fall back to anon key (for manual/dev setup).
    const bearerToken = (auth_token && auth_token !== 'dev-bypass-token')
      ? auth_token
      : supabase_anon_key;

    // 1. Prepare Request Parameters
    const endpoint = `${supabase_url.replace(/\/$/, '')}/rest/v1/${entity_type}`;
    const headers = {
      'apikey': supabase_anon_key,
      'Authorization': `Bearer ${bearerToken}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    };

    // Handle DELETE operations
    if (operation === 'DELETE') {
      const deleteUrl = `${endpoint}?entity_uuid=eq.${entity_uuid}&owner_uuid=eq.${milkman_uuid}`;
      const response = await fetch(deleteUrl, {
        method: 'DELETE',
        headers
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`DELETE request failed: status ${response.status} - ${errText}`);
      }
      return;
    }

    // 2. Fetch local entity details and construct payload
    const payload = await this.buildPayload(entity_type, entity_uuid, milkman_uuid);
    if (!payload) {
      console.warn(`Local entity not found for sync: ${entity_type} / ${entity_uuid}. Skipping.`);
      return;
    }

    // 3. Perform POST (UPSERT)
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`UPSERT request failed: status ${response.status} - ${errText}`);
    }

    // 4. Special Handling: Sync Invoices Line Items nested
    if (entity_type === 'Invoice') {
      await this.syncInvoiceLineItems(entity_uuid, milkman_uuid, settings);
    }
  }

  // Construct payload from local table rows, replacing auto-increment IDs with UUIDs
  async buildPayload(type, uuid, ownerUuid) {
    if (type === 'Customers') {
      const res = await dbService.query("SELECT * FROM Customers WHERE customer_uuid = ? LIMIT 1;", [uuid]);
      if (!res.values || res.values.length === 0) return null;
      const c = res.values[0];
      return {
        customer_uuid: c.customer_uuid,
        name: c.name,
        phone_number: c.phone_number,
        address: c.address,
        route_sequence: c.route_sequence,
        special_notes: c.special_notes,
        auto_invoice_delivery: c.auto_invoice_delivery,
        is_active: c.is_active,
        owner_uuid: ownerUuid,
        created_at: c.created_at,
        updated_at: c.updated_at
      };
    }

    if (type === 'Subscriptions') {
      const res = await dbService.query(
        `SELECT s.*, c.customer_uuid, p.product_uuid 
         FROM Subscriptions s
         JOIN Customers c ON s.customer_id = c.customer_id
         JOIN Products p ON s.product_id = p.product_id
         WHERE s.sub_uuid = ? LIMIT 1;`,
        [uuid]
      );
      if (!res.values || res.values.length === 0) return null;
      const s = res.values[0];
      return {
        sub_uuid: s.sub_uuid,
        customer_uuid: s.customer_uuid,
        product_uuid: s.product_uuid,
        delivery_shift: s.delivery_shift,
        default_quantity: s.default_quantity,
        custom_rate: s.custom_rate,
        quantity_step: s.quantity_step,
        is_active: s.is_active,
        owner_uuid: ownerUuid,
        updated_at: s.updated_at
      };
    }

    if (type === 'VacationSchedules') {
      const res = await dbService.query(
        `SELECT v.*, c.customer_uuid 
         FROM VacationSchedules v
         JOIN Customers c ON v.customer_id = c.customer_id
         WHERE v.vacation_uuid = ? LIMIT 1;`,
        [uuid]
      );
      if (!res.values || res.values.length === 0) return null;
      const v = res.values[0];
      return {
        vacation_uuid: v.vacation_uuid,
        customer_uuid: v.customer_uuid,
        start_date: v.start_date,
        end_date: v.end_date,
        is_active: v.is_active,
        owner_uuid: ownerUuid,
        created_at: v.created_at
      };
    }

    if (type === 'DailyDelivery') {
      const res = await dbService.query(
        `SELECT d.*, c.customer_uuid, p.product_uuid, s.sub_uuid, i.invoice_uuid
         FROM DailyDelivery d
         JOIN Customers c ON d.customer_id = c.customer_id
         JOIN Products p ON d.product_id = p.product_id
         LEFT JOIN Subscriptions s ON d.sub_id = s.sub_id
         LEFT JOIN Invoice i ON d.invoice_id = i.invoice_id
         WHERE d.delivery_uuid = ? LIMIT 1;`,
        [uuid]
      );
      if (!res.values || res.values.length === 0) return null;
      const d = res.values[0];
      return {
        delivery_uuid: d.delivery_uuid,
        customer_uuid: d.customer_uuid,
        sub_uuid: d.sub_uuid,
        product_uuid: d.product_uuid,
        delivery_date: d.delivery_date,
        delivery_shift: d.delivery_shift,
        quantity_delivered: d.quantity_delivered,
        rate_applied: d.rate_applied,
        status: d.status,
        revision_number: d.revision_number,
        invoice_uuid: d.invoice_uuid,
        owner_uuid: ownerUuid,
        created_at: d.created_at,
        updated_at: d.updated_at
      };
    }

    if (type === 'PaymentLog') {
      const res = await dbService.query(
        `SELECT p.*, c.customer_uuid 
         FROM PaymentLog p
         JOIN Customers c ON p.customer_id = c.customer_id
         WHERE p.payment_uuid = ? LIMIT 1;`,
        [uuid]
      );
      if (!res.values || res.values.length === 0) return null;
      const p = res.values[0];
      return {
        payment_uuid: p.payment_uuid,
        customer_uuid: p.customer_uuid,
        amount_collected: p.amount_collected,
        payment_date: p.payment_date,
        payment_mode: p.payment_mode,
        notes: p.notes,
        owner_uuid: ownerUuid,
        created_at: p.created_at
      };
    }

    if (type === 'AdjustmentLog') {
      const res = await dbService.query(
        `SELECT a.*, c.customer_uuid 
         FROM AdjustmentLog a
         JOIN Customers c ON a.customer_id = c.customer_id
         WHERE a.adjustment_uuid = ? LIMIT 1;`,
        [uuid]
      );
      if (!res.values || res.values.length === 0) return null;
      const a = res.values[0];
      return {
        adjustment_uuid: a.adjustment_uuid,
        customer_uuid: a.customer_uuid,
        amount: a.amount,
        type: a.type,
        reason: a.reason,
        owner_uuid: ownerUuid,
        created_at: a.created_at
      };
    }

    if (type === 'Invoice') {
      const res = await dbService.query(
        `SELECT i.*, c.customer_uuid 
         FROM Invoice i
         JOIN Customers c ON i.customer_id = c.customer_id
         WHERE i.invoice_uuid = ? LIMIT 1;`,
        [uuid]
      );
      if (!res.values || res.values.length === 0) return null;
      const i = res.values[0];
      return {
        invoice_uuid: i.invoice_uuid,
        customer_uuid: i.customer_uuid,
        invoice_number: i.invoice_number,
        billing_month: i.billing_month,
        billing_year: i.billing_year,
        previous_outstanding: i.previous_outstanding,
        current_month_total: i.current_month_total,
        payments_received: i.payments_received,
        net_adjustments: i.net_adjustments,
        grand_total: i.grand_total,
        billing_status: i.billing_status,
        locked_at: i.locked_at,
        owner_uuid: ownerUuid,
        created_at: i.created_at,
        updated_at: i.updated_at
      };
    }

    return null;
  }

  // Sync nested InvoiceLineItem entries associated with an Invoice
  async syncInvoiceLineItems(invoiceUuid, ownerUuid, settings) {
    const { supabase_url, supabase_anon_key } = settings;

    // Get parent invoice ID
    const invRes = await dbService.query("SELECT invoice_id FROM Invoice WHERE invoice_uuid = ? LIMIT 1;", [invoiceUuid]);
    if (!invRes.values || invRes.values.length === 0) return;
    const parentId = invRes.values[0].invoice_id;

    // Select all associated lines and resolve relationship UUIDs
    const linesRes = await dbService.query(
      `SELECT l.*, d.delivery_uuid, p.product_uuid
       FROM InvoiceLineItem l
       JOIN DailyDelivery d ON l.delivery_id = d.delivery_id
       JOIN Products p ON l.product_id = p.product_id
       WHERE l.invoice_id = ?;`,
      [parentId]
    );

    const lineItems = linesRes.values || [];
    if (lineItems.length === 0) return;

    // Build remote payload rows
    const payload = lineItems.map(item => ({
      invoice_uuid: invoiceUuid,
      delivery_uuid: item.delivery_uuid,
      delivery_date: item.delivery_date,
      delivery_shift: item.delivery_shift,
      product_uuid: item.product_uuid,
      product_display_name_snapshot: item.product_display_name_snapshot,
      quantity: item.quantity,
      rate_applied: item.rate_applied,
      line_subtotal: item.line_subtotal,
      owner_uuid: ownerUuid
    }));

    const endpoint = `${supabase_url.replace(/\/$/, '')}/rest/v1/InvoiceLineItem`;
    const headers = {
      'apikey': supabase_anon_key,
      'Authorization': `Bearer ${supabase_anon_key}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    };

    // Trigger upload
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`InvoiceLineItem sync failed: status ${response.status} - ${errText}`);
    }
  }
}

export const syncService = new SyncService();
