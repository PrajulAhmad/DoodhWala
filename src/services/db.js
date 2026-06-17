import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { Capacitor } from '@capacitor/core';

// For web platform, dynamically load and define jeep-sqlite custom element
if (Capacitor.getPlatform() === 'web') {
  import('jeep-sqlite/loader').then(({ defineCustomElements }) => {
    defineCustomElements(window);
  }).catch(err => {
    console.error("Failed to load jeep-sqlite custom element:", err);
  });
}

const sqliteConnection = new SQLiteConnection(CapacitorSQLite);

const generateUUID = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

class DatabaseService {
  constructor() {
    this.db = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      const platform = Capacitor.getPlatform();
      if (platform === 'web') {
        console.warn("SQLite running on web platform. For full persistence, run on Android.");
        
        // Append jeep-sqlite custom element if not present in the body
        if (!document.querySelector('jeep-sqlite')) {
          const jeepSqliteEl = document.createElement('jeep-sqlite');
          document.body.appendChild(jeepSqliteEl);
        }
        
        // Wait for custom element to be defined
        await customElements.whenDefined('jeep-sqlite');
        
        // Initialize IndexedDB web store wrapper for SQLite
        await sqliteConnection.initWebStore();
      }

      this.db = await sqliteConnection.createConnection(
        "doodhwala",
        false,
        "no-encryption",
        1,
        false
      );

      await this.db.open();

      // Enable WAL mode for better concurrent read/write on Android
      try {
        await this.db.execute("PRAGMA journal_mode=WAL;");
      } catch (_) { /* not supported on web, safe to ignore */ }

      await this.createSchema();
      await this.seedInitialData();
      
      this.initialized = true;
      console.log("Database initialized and schema verified successfully.");
    } catch (err) {
      console.error("Failed to initialize database:", err);
      throw err;
    }
  }

  async createSchema() {
    if (!this.db) throw new Error("Database connection not open.");

    const ddl = `
      CREATE TABLE IF NOT EXISTS AppSettings (
          setting_id          INTEGER PRIMARY KEY AUTOINCREMENT,
          default_step_size   REAL    DEFAULT 0.25,
          auto_share_mode     INTEGER DEFAULT 0,
          theme_mode          TEXT    DEFAULT 'HIGH_CONTRAST_LIGHT',
          billing_cycle_day   INTEGER DEFAULT 1,
          morning_cutoff_hour INTEGER DEFAULT 12
      );

      CREATE TABLE IF NOT EXISTS BusinessProfile (
          business_id     INTEGER  PRIMARY KEY AUTOINCREMENT,
          business_uuid   TEXT     NOT NULL UNIQUE,
          business_name   TEXT     NOT NULL,
          milkman_name    TEXT     NOT NULL,
          phone_number    TEXT     NOT NULL,
          upi_id          TEXT     NOT NULL,
          address         TEXT,
          logo_path       TEXT,
          gst_number      TEXT     DEFAULT NULL,
          created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS Products (
          product_id      INTEGER  PRIMARY KEY AUTOINCREMENT,
          product_uuid    TEXT     NOT NULL UNIQUE,
          product_name    TEXT     NOT NULL UNIQUE,
          unit            TEXT     DEFAULT 'Litre',
          is_active       INTEGER  DEFAULT 1,
          created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS Customers (
          customer_id             INTEGER  PRIMARY KEY AUTOINCREMENT,
          customer_uuid           TEXT     NOT NULL UNIQUE,
          name                    TEXT     NOT NULL,
          phone_number            TEXT     NOT NULL,
          address                 TEXT,
          route_sequence          INTEGER  NOT NULL,
          special_notes           TEXT,
          auto_invoice_delivery   INTEGER  DEFAULT 1,
          is_active               INTEGER  DEFAULT 1,
          deleted_at              DATETIME DEFAULT NULL,
          created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS Subscriptions (
          sub_id              INTEGER  PRIMARY KEY AUTOINCREMENT,
          sub_uuid            TEXT     NOT NULL UNIQUE,
          customer_id         INTEGER  NOT NULL,
          product_id          INTEGER  NOT NULL,
          delivery_shift      INTEGER  NOT NULL CHECK(delivery_shift IN (0, 1)),
          default_quantity    REAL     NOT NULL,
          custom_rate         INTEGER  NOT NULL,
          quantity_step       REAL     DEFAULT 0.25,
          is_active           INTEGER  DEFAULT 1,
          revision_number     INTEGER  DEFAULT 1,
          deleted_at          DATETIME DEFAULT NULL,
          updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(customer_id) REFERENCES Customers(customer_id),
          FOREIGN KEY(product_id)  REFERENCES Products(product_id),
          UNIQUE(customer_id, product_id, delivery_shift)
      );

      CREATE TABLE IF NOT EXISTS VacationSchedules (
          vacation_id     INTEGER  PRIMARY KEY AUTOINCREMENT,
          vacation_uuid   TEXT     NOT NULL UNIQUE,
          customer_id     INTEGER  NOT NULL,
          start_date      DATE     NOT NULL,
          end_date        DATE     NOT NULL,
          is_active       INTEGER  DEFAULT 1,
          deleted_at      DATETIME DEFAULT NULL,
          created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(customer_id) REFERENCES Customers(customer_id)
      );

      CREATE TABLE IF NOT EXISTS DailyDelivery (
          delivery_id         INTEGER  PRIMARY KEY AUTOINCREMENT,
          delivery_uuid       TEXT     NOT NULL UNIQUE,
          customer_id         INTEGER  NOT NULL,
          sub_id              INTEGER  NOT NULL,
          product_id          INTEGER  NOT NULL,
          delivery_date       DATE     DEFAULT CURRENT_DATE,
          delivery_shift      INTEGER  NOT NULL CHECK(delivery_shift IN (0, 1)),
          quantity_delivered  REAL     NOT NULL,
          rate_applied        INTEGER  NOT NULL,
          status              TEXT     NOT NULL CHECK(status IN ('Delivered', 'Skipped')),
          revision_number     INTEGER  DEFAULT 1,
          invoice_id          INTEGER  DEFAULT NULL,
          sync_status         INTEGER  DEFAULT 0 CHECK(sync_status IN (0,1,2,3,4)),
          deleted_at          DATETIME DEFAULT NULL,
          updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(customer_id) REFERENCES Customers(customer_id),
          FOREIGN KEY(sub_id)      REFERENCES Subscriptions(sub_id),
          FOREIGN KEY(product_id)  REFERENCES Products(product_id),
          FOREIGN KEY(invoice_id)  REFERENCES Invoice(invoice_id),
          UNIQUE(customer_id, product_id, delivery_date, delivery_shift)
      );

      CREATE TABLE IF NOT EXISTS DeliveryAuditLog (
          log_id          INTEGER  PRIMARY KEY AUTOINCREMENT,
          delivery_id     INTEGER  NOT NULL,
          revision_number INTEGER  NOT NULL,
          changed_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
          old_quantity    REAL,
          new_quantity    REAL,
          old_status      TEXT,
          new_status      TEXT,
          reason_notes    TEXT,
          FOREIGN KEY(delivery_id) REFERENCES DailyDelivery(delivery_id)
      );

      CREATE TABLE IF NOT EXISTS PaymentLog (
          pay_id          INTEGER  PRIMARY KEY AUTOINCREMENT,
          payment_uuid    TEXT     NOT NULL UNIQUE,
          customer_id     INTEGER  NOT NULL,
          amount_collected INTEGER  NOT NULL,
          payment_date    DATE     DEFAULT CURRENT_DATE,
          payment_mode    TEXT     NOT NULL CHECK(payment_mode IN ('Cash', 'UPI')),
          notes           TEXT,
          invoice_id      INTEGER  DEFAULT NULL,
          sync_status     INTEGER  DEFAULT 0 CHECK(sync_status IN (0,1,2,3,4)),
          deleted_at      DATETIME DEFAULT NULL,
          updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(customer_id) REFERENCES Customers(customer_id),
          FOREIGN KEY(invoice_id)  REFERENCES Invoice(invoice_id)
      );

      CREATE TABLE IF NOT EXISTS AdjustmentLog (
          adjustment_id           INTEGER  PRIMARY KEY AUTOINCREMENT,
          adjustment_uuid         TEXT     NOT NULL UNIQUE,
          customer_id             INTEGER  NOT NULL,
          amount                  INTEGER  NOT NULL,
          type                    TEXT     NOT NULL CHECK(type IN ('CREDIT', 'DEBIT')),
          reason                  TEXT     NOT NULL,
          reference_invoice_id    INTEGER  DEFAULT NULL,
          sync_status             INTEGER  DEFAULT 0 CHECK(sync_status IN (0,1,2,3,4)),
          deleted_at              DATETIME DEFAULT NULL,
          created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(customer_id)          REFERENCES Customers(customer_id),
          FOREIGN KEY(reference_invoice_id) REFERENCES Invoice(invoice_id)
      );

      CREATE TABLE IF NOT EXISTS Invoice (
          invoice_id              INTEGER  PRIMARY KEY AUTOINCREMENT,
          invoice_uuid            TEXT     NOT NULL UNIQUE,
          customer_id             INTEGER  NOT NULL,
          invoice_number          TEXT     NOT NULL UNIQUE,
          billing_month           INTEGER  NOT NULL,
          billing_year            INTEGER  NOT NULL,
          previous_outstanding    INTEGER  DEFAULT 0,
          current_month_total     INTEGER  DEFAULT 0,
          payments_received       INTEGER  DEFAULT 0,
          net_adjustments         INTEGER  DEFAULT 0,
          grand_total             INTEGER  DEFAULT 0,
          billing_status          TEXT     DEFAULT 'DRAFT' CHECK(billing_status IN ('DRAFT','GENERATED','SHARED','SETTLED','LOCKED')),
          pdf_local_path          TEXT,
          locked_at               DATETIME DEFAULT NULL,
          sync_status             INTEGER  DEFAULT 0 CHECK(sync_status IN (0,1,2,3,4)),
          created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(customer_id) REFERENCES Customers(customer_id)
      );

      CREATE TABLE IF NOT EXISTS InvoiceLineItem (
          line_item_id                INTEGER  PRIMARY KEY AUTOINCREMENT,
          invoice_id                  INTEGER  NOT NULL,
          delivery_id                 INTEGER  NOT NULL,
          delivery_date               DATE     NOT NULL,
          delivery_shift              INTEGER  NOT NULL CHECK(delivery_shift IN (0, 1)),
          product_id                  INTEGER  NOT NULL,
          product_display_name_snapshot TEXT   NOT NULL,
          quantity                    REAL     NOT NULL,
          rate_applied                INTEGER  NOT NULL,
          line_subtotal               INTEGER  NOT NULL,
          FOREIGN KEY(invoice_id)   REFERENCES Invoice(invoice_id),
          FOREIGN KEY(delivery_id)  REFERENCES DailyDelivery(delivery_id),
          FOREIGN KEY(product_id)   REFERENCES Products(product_id)
      );

      CREATE TABLE IF NOT EXISTS NotificationQueue (
          notification_id     INTEGER  PRIMARY KEY AUTOINCREMENT,
          notification_type   TEXT     NOT NULL CHECK(notification_type IN (
                                  'MONTH_END_BILLING',
                                  'SHARE_REMINDER',
                                  'SYNC_FAILURE_ALERT',
                                  'SHARE_FAILURE_RETRY'
                              )),
          reference_id        INTEGER  DEFAULT NULL,
          scheduled_at        DATETIME NOT NULL,
          fired_at            DATETIME DEFAULT NULL,
          status              TEXT     DEFAULT 'PENDING' CHECK(status IN ('PENDING','FIRED','DISMISSED','FAILED')),
          retry_count         INTEGER  DEFAULT 0,
          created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS SyncQueue (
          sync_id         INTEGER  PRIMARY KEY AUTOINCREMENT,
          entity_type     TEXT     NOT NULL,
          entity_uuid     TEXT     NOT NULL,
          operation       TEXT     NOT NULL CHECK(operation IN ('INSERT', 'UPDATE', 'DELETE')),
          payload_hash    TEXT,
          retry_count     INTEGER  DEFAULT 0,
          last_attempt_at DATETIME DEFAULT NULL,
          status          TEXT     DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','PROCESSING','FAILED')),
          created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_delivery_customer_date ON DailyDelivery(customer_id, delivery_date);
      CREATE INDEX IF NOT EXISTS idx_delivery_invoice ON DailyDelivery(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_payment_customer ON PaymentLog(customer_id);
      CREATE INDEX IF NOT EXISTS idx_adjustment_customer ON AdjustmentLog(customer_id);
      CREATE INDEX IF NOT EXISTS idx_invoice_customer ON Invoice(customer_id);
      CREATE INDEX IF NOT EXISTS idx_syncqueue_status ON SyncQueue(status);
      CREATE INDEX IF NOT EXISTS idx_dailydelivery_sync ON DailyDelivery(sync_status);
      CREATE INDEX IF NOT EXISTS idx_paymentlog_sync ON PaymentLog(sync_status);
      CREATE INDEX IF NOT EXISTS idx_invoice_sync ON Invoice(sync_status);
    `;

    await this.db.execute(ddl);

    // Migration: Add Supabase + Auth columns to AppSettings if they don't exist
    try {
      await this.db.run("ALTER TABLE AppSettings ADD COLUMN supabase_url TEXT DEFAULT NULL;");
    } catch (e) {}
    try {
      await this.db.run("ALTER TABLE AppSettings ADD COLUMN supabase_anon_key TEXT DEFAULT NULL;");
    } catch (e) {}
    try {
      await this.db.run("ALTER TABLE AppSettings ADD COLUMN milkman_uuid TEXT DEFAULT NULL;");
    } catch (e) {}
    try {
      await this.db.run("ALTER TABLE AppSettings ADD COLUMN last_sync_timestamp DATETIME DEFAULT NULL;");
    } catch (e) {}
    // Auth session columns (added in Login/Setup phase)
    try {
      await this.db.run("ALTER TABLE AppSettings ADD COLUMN auth_token TEXT DEFAULT NULL;");
    } catch (e) {}
    try {
      await this.db.run("ALTER TABLE AppSettings ADD COLUMN phone_number TEXT DEFAULT NULL;");
    } catch (e) {}
    try {
      await this.db.run("ALTER TABLE AppSettings ADD COLUMN updated_at DATETIME DEFAULT NULL;");
    } catch (e) {}

    const checkSettings = await this.db.query("SELECT COUNT(*) as count FROM AppSettings;");
    if (checkSettings.values && checkSettings.values.length > 0 && checkSettings.values[0].count === 0) {
      await this.db.run(
        "INSERT INTO AppSettings (default_step_size, auto_share_mode, theme_mode, billing_cycle_day, morning_cutoff_hour) VALUES (?, ?, ?, ?, ?);",
        [0.25, 0, 'HIGH_CONTRAST_LIGHT', 1, 12]
      );
    }

    const checkProfile = await this.db.query("SELECT COUNT(*) as count FROM BusinessProfile;");
    if (checkProfile.values && checkProfile.values.length > 0 && checkProfile.values[0].count === 0) {
      await this.db.run(
        `INSERT INTO BusinessProfile (business_uuid, business_name, milkman_name, phone_number, upi_id, address) 
         VALUES (?, ?, ?, ?, ?, ?);`,
        ['bus-doodh-uuid', 'Krishna Dairy', 'Ramesh Sharma', '+91 98765 43210', 'kdairy@okaxis', 'Sector 4, Dwarka, Delhi']
      );
    }
  }

  async seedInitialData() {
    if (!this.db) throw new Error("Database connection not open.");

    // Check if Products table has entries. If yes, database is already seeded.
    const checkProducts = await this.db.query("SELECT COUNT(*) as count FROM Products;");
    if (checkProducts.values && checkProducts.values.length > 0 && checkProducts.values[0].count > 0) {
      console.log("Database already seeded. Skipping initial data seed.");
      return;
    }

    console.log("Seeding initial test data into SQLite database...");

    // 1. Insert Products
    await this.db.run("INSERT OR IGNORE INTO Products (product_uuid, product_name, unit) VALUES (?, ?, ?);", ["prod-cow-uuid", "Cow Milk", "Litre"]);
    await this.db.run("INSERT OR IGNORE INTO Products (product_uuid, product_name, unit) VALUES (?, ?, ?);", ["prod-buffalo-uuid", "Buffalo Milk", "Litre"]);

    // 2. Insert Customers
    const customersSeed = [
      { id: 1, uuid: 'cust-amit-uuid', name: 'Amit Kumar', phone: '9876543210', address: 'House 42, Sector 4', seq: 1, notes: 'Leave at back door' },
      { id: 2, uuid: 'cust-rohan-uuid', name: 'Rohan Sharma', phone: '9876543211', address: 'House 11, Sector 4', seq: 2, notes: '' },
      { id: 3, uuid: 'cust-priya-uuid', name: 'Priya Devi', phone: '9876543212', address: 'House 99, Sector 2', seq: 3, notes: '' },
      { id: 4, uuid: 'cust-sunil-uuid', name: 'Sunil Gupta', phone: '9876543213', address: 'House 5, Sector 1', seq: 4, notes: '' },
      { id: 5, uuid: 'cust-vikram-uuid', name: 'Vikram Singh', phone: '9876543214', address: 'House 23, Sector 3', seq: 5, notes: '' }
    ];

    for (const c of customersSeed) {
      await this.db.run(
        "INSERT OR IGNORE INTO Customers (customer_id, customer_uuid, name, phone_number, address, route_sequence, special_notes) VALUES (?, ?, ?, ?, ?, ?, ?);",
        [c.id, c.uuid, c.name, c.phone, c.address, c.seq, c.notes]
      );
    }

    // 3. Insert Subscriptions
    await this.db.run(
      "INSERT OR IGNORE INTO Subscriptions (sub_uuid, customer_id, product_id, delivery_shift, default_quantity, custom_rate, quantity_step) VALUES (?, ?, ?, ?, ?, ?, ?);",
      ['sub-amit-uuid', 1, 1, 0, 1.5, 6500, 0.25]
    );
    await this.db.run(
      "INSERT OR IGNORE INTO Subscriptions (sub_uuid, customer_id, product_id, delivery_shift, default_quantity, custom_rate, quantity_step) VALUES (?, ?, ?, ?, ?, ?, ?);",
      ['sub-rohan-uuid', 2, 1, 0, 1.5, 6500, 0.25]
    );
    await this.db.run(
      "INSERT OR IGNORE INTO Subscriptions (sub_uuid, customer_id, product_id, delivery_shift, default_quantity, custom_rate, quantity_step) VALUES (?, ?, ?, ?, ?, ?, ?);",
      ['sub-priya-uuid', 3, 1, 0, 1.0, 6500, 0.25]
    );
    await this.db.run(
      "INSERT OR IGNORE INTO Subscriptions (sub_uuid, customer_id, product_id, delivery_shift, default_quantity, custom_rate, quantity_step) VALUES (?, ?, ?, ?, ?, ?, ?);",
      ['sub-sunil-uuid', 4, 2, 0, 2.0, 7500, 0.25]
    );
    await this.db.run(
      "INSERT OR IGNORE INTO Subscriptions (sub_uuid, customer_id, product_id, delivery_shift, default_quantity, custom_rate, quantity_step) VALUES (?, ?, ?, ?, ?, ?, ?);",
      ['sub-vikram-uuid', 5, 1, 0, 1.0, 6500, 0.25]
    );

    // 4. Seeding vacation schedule for Priya Devi (Customer 3)
    const today = new Date().toISOString().split('T')[0];
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    await this.db.run(
      "INSERT OR IGNORE INTO VacationSchedules (vacation_uuid, customer_id, start_date, end_date, is_active) VALUES (?, ?, ?, ?, ?);",
      ['vac-priya-uuid', 3, today, nextWeek, 1]
    );

    // 5. Seed financial ledger adjustments
    await this.db.run(
      "INSERT OR IGNORE INTO AdjustmentLog (adjustment_uuid, customer_id, amount, type, reason) VALUES (?, ?, ?, ?, ?);",
      ['adj-amit-dues', 1, 185000, 'DEBIT', 'Opening Balance Dues']
    );
    await this.db.run(
      "INSERT OR IGNORE INTO PaymentLog (payment_uuid, customer_id, amount_collected, payment_mode, notes) VALUES (?, ?, ?, ? ,?);",
      ['pay-sunil-credit', 4, 20000, 'Cash', 'Opening Advance Payment']
    );

    console.log("Seeding initial data completed successfully.");
  }

  // Q1 & Q2 — Today's Route List Query
  async getTodayRoute(dateString, shift) {
    if (!this.db) throw new Error("Database not initialized.");

    const queryStr = `
      SELECT 
        c.customer_id,
        c.customer_uuid,
        c.name,
        c.phone_number,
        c.address,
        c.route_sequence,
        c.special_notes,
        c.auto_invoice_delivery,
        s.sub_id,
        s.sub_uuid,
        s.product_id,
        s.default_quantity,
        s.custom_rate,
        s.quantity_step,
        p.product_name,
        p.unit,
        
        -- Vacation check
        (SELECT vs.vacation_id FROM VacationSchedules vs 
         WHERE vs.customer_id = c.customer_id 
           AND vs.is_active <> 0 
           AND vs.deleted_at IS NULL 
           AND ? BETWEEN vs.start_date AND vs.end_date LIMIT 1) IS NOT NULL AS on_vacation,
        
        -- Today's DailyDelivery status check
        d.delivery_id,
        d.delivery_uuid,
        d.quantity_delivered,
        d.rate_applied,
        d.status AS delivery_status,
        d.sync_status AS delivery_sync_status,
        d.updated_at AS delivery_updated_at,
        
        -- Q5 Live Outstanding Balance runtime computation
        (
          COALESCE((
            SELECT SUM(dd.quantity_delivered * dd.rate_applied)
            FROM DailyDelivery dd
            WHERE dd.customer_id = c.customer_id
              AND dd.status = 'Delivered'
              AND dd.deleted_at IS NULL
          ), 0)
          +
          COALESCE((
            SELECT SUM(adj.amount)
            FROM AdjustmentLog adj
            WHERE adj.customer_id = c.customer_id
              AND adj.type = 'DEBIT'
              AND adj.deleted_at IS NULL
          ), 0)
          -
          COALESCE((
            SELECT SUM(adj.amount)
            FROM AdjustmentLog adj
            WHERE adj.customer_id = c.customer_id
              AND adj.type = 'CREDIT'
              AND adj.deleted_at IS NULL
          ), 0)
          -
          COALESCE((
            SELECT SUM(pay.amount_collected)
            FROM PaymentLog pay
            WHERE pay.customer_id = c.customer_id
              AND pay.deleted_at IS NULL
          ), 0)
        ) AS live_balance

      FROM Customers c
      JOIN Subscriptions s ON c.customer_id = s.customer_id
      JOIN Products p ON s.product_id = p.product_id
      LEFT JOIN DailyDelivery d ON c.customer_id = d.customer_id 
        AND s.product_id = d.product_id
        AND d.delivery_date = ? 
        AND d.delivery_shift = ?
        AND d.deleted_at IS NULL
      WHERE c.is_active <> 0 
        AND c.deleted_at IS NULL
        AND s.is_active <> 0
        AND s.deleted_at IS NULL
        AND s.delivery_shift = ?
      ORDER BY c.route_sequence ASC;
    `;

    const result = await this.db.query(queryStr, [dateString, dateString, shift, shift]);
    return result.values || [];
  }

  // Q3 — Insert or Update Daily Delivery (with SyncQueue write)
  async logDelivery(deliveryData) {
      if (!this.db) throw new Error("Database not initialized.");

      const {
        customer_id,
        sub_id,
        product_id,
        delivery_date,
        delivery_shift,
        quantity_delivered,
        rate_applied,
        status
      } = deliveryData;

      try {

        // Check if delivery already exists for today/shift
        const checkRes = await this.db.query(
          "SELECT delivery_id, delivery_uuid FROM DailyDelivery WHERE customer_id = ? AND product_id = ? AND delivery_date = ? AND delivery_shift = ? LIMIT 1;",
          [customer_id, product_id, delivery_date, delivery_shift]
        );

        let deliveryId;
        let deliveryUuid;

        if (checkRes.values && checkRes.values.length > 0) {
          // Update existing
          deliveryId = checkRes.values[0].delivery_id;
          deliveryUuid = checkRes.values[0].delivery_uuid;

          await this.db.run(
            `UPDATE DailyDelivery 
             SET quantity_delivered = ?, rate_applied = ?, status = ?, revision_number = revision_number + 1, updated_at = CURRENT_TIMESTAMP
             WHERE delivery_id = ?;`,
            [quantity_delivered, rate_applied, status, deliveryId]
          );

          // Add update operation to SyncQueue
          await this.db.run(
            "INSERT INTO SyncQueue (entity_type, entity_uuid, operation) VALUES (?, ?, ?);",
            ['DailyDelivery', deliveryUuid, 'UPDATE']
          );
        } else {
          // Insert new
          deliveryUuid = generateUUID();
          const runResult = await this.db.run(
            `INSERT INTO DailyDelivery (delivery_uuid, customer_id, sub_id, product_id, delivery_date, delivery_shift, quantity_delivered, rate_applied, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [deliveryUuid, customer_id, sub_id || null, product_id, delivery_date, delivery_shift, quantity_delivered, rate_applied, status]
          );
          deliveryId = runResult.changes.lastId;

          // Add insert operation to SyncQueue
          await this.db.run(
            "INSERT INTO SyncQueue (entity_type, entity_uuid, operation) VALUES (?, ?, ?);",
            ['DailyDelivery', deliveryUuid, 'INSERT']
          );
        }
        return { success: true, deliveryId, deliveryUuid };
      } catch (err) {
        console.error("Failed to log delivery in transaction:", err);
        throw err;
      }
  }

  async getCustomerDetails(customerId) {
    if (!this.db) throw new Error("Database not initialized.");
    const queryStr = `
      SELECT 
        c.*,
        (
          COALESCE((SELECT SUM(dd.quantity_delivered * dd.rate_applied) FROM DailyDelivery dd WHERE dd.customer_id = c.customer_id AND dd.status = 'Delivered' AND dd.deleted_at IS NULL), 0) +
          COALESCE((SELECT SUM(adj.amount) FROM AdjustmentLog adj WHERE adj.customer_id = c.customer_id AND adj.type = 'DEBIT' AND adj.deleted_at IS NULL), 0) -
          COALESCE((SELECT SUM(adj.amount) FROM AdjustmentLog adj WHERE adj.customer_id = c.customer_id AND adj.type = 'CREDIT' AND adj.deleted_at IS NULL), 0) -
          COALESCE((SELECT SUM(pay.amount_collected) FROM PaymentLog pay WHERE pay.customer_id = c.customer_id AND pay.deleted_at IS NULL), 0)
        ) AS live_balance
      FROM Customers c
      WHERE c.customer_id = ? AND c.deleted_at IS NULL LIMIT 1;
    `;
    const result = await this.db.query(queryStr, [customerId]);
    return result.values && result.values.length > 0 ? result.values[0] : null;
  }

  async getDeliveryHistory(customerId, year, month) {
    if (!this.db) throw new Error("Database not initialized.");
    const monthStr = String(month).padStart(2, '0');
    const yearStr = String(year);

    const queryStr = `
      SELECT 
        dd.*,
        p.product_name,
        p.unit,
        -- Edit window open if difference <= 7 days
        ((julianday(date('now')) - julianday(dd.delivery_date)) <= 7) AS edit_window_open,
        inv.billing_status AS invoice_status,
        COALESCE(inv.billing_status IN ('SHARED', 'SETTLED', 'LOCKED'), 0) AS is_locked
      FROM DailyDelivery dd
      JOIN Products p ON dd.product_id = p.product_id
      LEFT JOIN Invoice inv ON dd.invoice_id = inv.invoice_id
      WHERE dd.customer_id = ?
        AND strftime('%Y', dd.delivery_date) = ?
        AND strftime('%m', dd.delivery_date) = ?
        AND dd.deleted_at IS NULL
      ORDER BY dd.delivery_date DESC, dd.delivery_shift DESC;
    `;
    const result = await this.db.query(queryStr, [customerId, yearStr, monthStr]);
    return result.values || [];
  }

  async updateDelivery(deliveryId, editData) {
      if (!this.db) throw new Error("Database not initialized.");
      const { new_quantity, new_status, reason_notes } = editData;

      try {

        const getResult = await this.db.query(
          "SELECT * FROM DailyDelivery WHERE delivery_id = ? AND deleted_at IS NULL LIMIT 1;",
          [deliveryId]
        );
        if (!getResult.values || getResult.values.length === 0) {
          throw new Error("Delivery record not found.");
        }
        const oldRow = getResult.values[0];

        // LOCK CHECK: Check if linked invoice is final
        if (oldRow.invoice_id) {
          const invRes = await this.db.query(
            "SELECT billing_status FROM Invoice WHERE invoice_id = ? LIMIT 1;",
            [oldRow.invoice_id]
          );
          if (invRes.values && invRes.values.length > 0) {
            const status = invRes.values[0].billing_status;
            if (['SHARED', 'SETTLED', 'LOCKED'].includes(status)) {
              throw new Error(`This delivery is locked under invoice status ${status} and cannot be modified.`);
            }
          }
        }

        const newRevision = (oldRow.revision_number || 1) + 1;

        await this.db.run(
          "UPDATE DailyDelivery SET quantity_delivered = ?, status = ?, revision_number = ?, sync_status = 0, updated_at = CURRENT_TIMESTAMP WHERE delivery_id = ?;",
          [new_quantity, new_status, newRevision, deliveryId]
        );

        await this.db.run(
          `INSERT INTO DeliveryAuditLog (delivery_id, revision_number, old_quantity, new_quantity, old_status, new_status, reason_notes)
           VALUES (?, ?, ?, ?, ?, ?, ?);`,
          [deliveryId, newRevision, oldRow.quantity_delivered, new_quantity, oldRow.status, new_status, reason_notes || '']
        );

        await this.db.run(
          "INSERT INTO SyncQueue (entity_type, entity_uuid, operation) VALUES (?, ?, ?);",
          ['DailyDelivery', oldRow.delivery_uuid, 'UPDATE']
        );
        return { success: true };
      } catch (err) {
        console.error("Failed to update delivery in transaction:", err);
        throw err;
      }
  }

  async getPayments(customerId) {
    if (!this.db) throw new Error("Database not initialized.");
    const queryStr = `
      SELECT * FROM PaymentLog 
      WHERE customer_id = ? AND deleted_at IS NULL
      ORDER BY payment_date DESC, pay_id DESC;
    `;
    const result = await this.db.query(queryStr, [customerId]);
    return result.values || [];
  }

  async getRecentPayments(limit = 10) {
    if (!this.db) throw new Error("Database not initialized.");
    const queryStr = `
      SELECT p.*, c.name as customer_name 
      FROM PaymentLog p
      JOIN Customers c ON p.customer_id = c.customer_id
      WHERE p.deleted_at IS NULL
      ORDER BY p.payment_date DESC, p.pay_id DESC
      LIMIT ?;
    `;
    const result = await this.db.query(queryStr, [limit]);
    return result.values || [];
  }

  async logPayment(paymentData) {
      if (!this.db) throw new Error("Database not initialized.");
      const { customer_id, amount_collected, payment_date, payment_mode, notes } = paymentData;

      try {

        const paymentUuid = generateUUID();
        const runResult = await this.db.run(
          `INSERT INTO PaymentLog (payment_uuid, customer_id, amount_collected, payment_date, payment_mode, notes, sync_status)
           VALUES (?, ?, ?, ?, ?, ?, 0);`,
          [paymentUuid, customer_id, amount_collected, payment_date, payment_mode, notes || '']
        );
        const paymentId = runResult.changes.lastId;

        await this.db.run(
          "INSERT INTO SyncQueue (entity_type, entity_uuid, operation) VALUES (?, ?, ?);",
          ['PaymentLog', paymentUuid, 'INSERT']
        );
        return { success: true, paymentId, paymentUuid };
      } catch (err) {
        console.error("Failed to log payment in transaction:", err);
        throw err;
      }
  }

  async getSubscriptions(customerId) {
    if (!this.db) throw new Error("Database not initialized.");
    const queryStr = `
      SELECT s.*, p.product_name, p.unit
      FROM Subscriptions s
      JOIN Products p ON s.product_id = p.product_id
      WHERE s.customer_id = ? AND s.deleted_at IS NULL;
    `;
    const result = await this.db.query(queryStr, [customerId]);
    return result.values || [];
  }

  async updateSubscription(subId, subData) {
      if (!this.db) throw new Error("Database not initialized.");
      const { default_quantity, custom_rate, quantity_step, is_active } = subData;

      try {

        const getResult = await this.db.query("SELECT sub_uuid, revision_number FROM Subscriptions WHERE sub_id = ? LIMIT 1;", [subId]);
        if (!getResult.values || getResult.values.length === 0) {
          throw new Error("Subscription not found.");
        }
        const row = getResult.values[0];
        const newRevision = (row.revision_number || 1) + 1;

        await this.db.run(
          `UPDATE Subscriptions 
           SET default_quantity = ?, custom_rate = ?, quantity_step = ?, is_active = ?, revision_number = ?, updated_at = CURRENT_TIMESTAMP 
           WHERE sub_id = ?;`,
          [default_quantity, custom_rate, quantity_step, is_active, newRevision, subId]
        );

        await this.db.run(
          "INSERT INTO SyncQueue (entity_type, entity_uuid, operation) VALUES (?, ?, ?);",
          ['Subscriptions', row.sub_uuid, 'UPDATE']
        );
        return { success: true };
      } catch (err) {
        console.error("Failed to update subscription in transaction:", err);
        throw err;
      }
  }

  async getVacations(customerId) {
    if (!this.db) throw new Error("Database not initialized.");
    const queryStr = `
      SELECT * FROM VacationSchedules 
      WHERE customer_id = ? AND deleted_at IS NULL AND is_active <> 0
      ORDER BY start_date DESC;
    `;
    const result = await this.db.query(queryStr, [customerId]);
    return result.values || [];
  }

  async addVacation(vacationData) {
      if (!this.db) throw new Error("Database not initialized.");
      const { customer_id, start_date, end_date } = vacationData;

      try {

        const vacationUuid = generateUUID();
        const runResult = await this.db.run(
          `INSERT INTO VacationSchedules (vacation_uuid, customer_id, start_date, end_date, is_active)
           VALUES (?, ?, ?, ?, 1);`,
          [vacationUuid, customer_id, start_date, end_date]
        );
        const vacationId = runResult.changes.lastId;

        await this.db.run(
          "INSERT INTO SyncQueue (entity_type, entity_uuid, operation) VALUES (?, ?, ?);",
          ['VacationSchedules', vacationUuid, 'INSERT']
        );
        return { success: true, vacationId, vacationUuid };
      } catch (err) {
        console.error("Failed to add vacation in transaction:", err);
        throw err;
      }
  }

  async deleteVacation(vacationId) {
      if (!this.db) throw new Error("Database not initialized.");

      try {

        const getResult = await this.db.query("SELECT vacation_uuid FROM VacationSchedules WHERE vacation_id = ? LIMIT 1;", [vacationId]);
        if (!getResult.values || getResult.values.length === 0) {
          throw new Error("Vacation schedule not found.");
        }
        const row = getResult.values[0];

        await this.db.run(
          "UPDATE VacationSchedules SET is_active = 0, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE vacation_id = ?;",
          [vacationId]
        );

        await this.db.run(
          "INSERT INTO SyncQueue (entity_type, entity_uuid, operation) VALUES (?, ?, ?);",
          ['VacationSchedules', row.vacation_uuid, 'DELETE']
        );
        return { success: true };
      } catch (err) {
        console.error("Failed to delete vacation in transaction:", err);
        throw err;
      }
  }

  async getInvoices(customerId) {
    if (!this.db) throw new Error("Database not initialized.");
    const queryStr = `
      SELECT * FROM Invoice 
      WHERE customer_id = ?
      ORDER BY billing_year DESC, billing_month DESC;
    `;
    const result = await this.db.query(queryStr, [customerId]);
    return result.values || [];
  }

  async getAllCustomersForPayment() {
    if (!this.db) throw new Error("Database not initialized.");
    const result = await this.db.query(
      "SELECT customer_id, name, is_active, route_sequence FROM Customers WHERE deleted_at IS NULL ORDER BY name ASC;"
    );
    const list = result.values || [];
    return list.filter(c => c.is_active == 1 || c.is_active === true || c.is_active === 'true' || c.is_active === '1');
  }

  async getProducts() {
    if (!this.db) throw new Error("Database not initialized.");
    const result = await this.db.query("SELECT * FROM Products;");
    const list = result.values || [];
    return list.filter(p => p.is_active == 1 || p.is_active === true || p.is_active === 'true' || p.is_active === '1');
  }

  async getBillingSummary(year, month) {
    if (!this.db) throw new Error("Database not initialized.");
    const monthStr = String(month).padStart(2, '0');
    const startDate = `${year}-${monthStr}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`;

    const queryStr = `
      SELECT 
        c.customer_id,
        c.name,
        c.route_sequence,
        -- Month delivered total (paise)
        COALESCE((
          SELECT SUM(dd.quantity_delivered * dd.rate_applied)
          FROM DailyDelivery dd
          WHERE dd.customer_id = c.customer_id
            AND dd.status = 'Delivered'
            AND dd.delivery_date BETWEEN ? AND ?
            AND dd.deleted_at IS NULL
        ), 0) AS month_delivered_total,
        
        -- Invoice details if exists for this month
        inv.invoice_id,
        inv.invoice_uuid,
        inv.invoice_number,
        inv.grand_total,
        inv.billing_status AS invoice_status,

        -- Live Balance
        (
          COALESCE((SELECT SUM(dd.quantity_delivered * dd.rate_applied) FROM DailyDelivery dd WHERE dd.customer_id = c.customer_id AND dd.status = 'Delivered' AND dd.deleted_at IS NULL), 0) +
          COALESCE((SELECT SUM(adj.amount) FROM AdjustmentLog adj WHERE adj.customer_id = c.customer_id AND adj.type = 'DEBIT' AND adj.deleted_at IS NULL), 0) -
          COALESCE((SELECT SUM(adj.amount) FROM AdjustmentLog adj WHERE adj.customer_id = c.customer_id AND adj.type = 'CREDIT' AND adj.deleted_at IS NULL), 0) -
          COALESCE((SELECT SUM(pay.amount_collected) FROM PaymentLog pay WHERE pay.customer_id = c.customer_id AND pay.deleted_at IS NULL), 0)
        ) AS live_balance

      FROM Customers c
      LEFT JOIN Invoice inv ON c.customer_id = inv.customer_id
        AND inv.billing_month = ?
        AND inv.billing_year = ?
      WHERE c.is_active <> 0 
        AND c.deleted_at IS NULL
      ORDER BY c.route_sequence ASC;
    `;
    const result = await this.db.query(queryStr, [startDate, endDate, month, year]);
    return result.values || [];
  }

  async generateInvoice(customerId, year, month) {
      if (!this.db) throw new Error("Database not initialized.");
      const monthStr = String(month).padStart(2, '0');
      const startDate = `${year}-${monthStr}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const endDate = `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`;

      try {

        // 1. Check if invoice already exists
        const checkRes = await this.db.query(
          "SELECT invoice_id, invoice_uuid, invoice_number, billing_status FROM Invoice WHERE customer_id = ? AND billing_month = ? AND billing_year = ? LIMIT 1;",
          [customerId, month, year]
        );
        
        let existingInvoice = null;
        if (checkRes.values && checkRes.values.length > 0) {
          existingInvoice = checkRes.values[0];
          if (['SHARED', 'SETTLED', 'LOCKED'].includes(existingInvoice.billing_status)) {
            throw new Error(`Invoice is locked in status ${existingInvoice.billing_status} and cannot be regenerated.`);
          }
        }

        // 2. Fetch all delivered logs for this customer in this month
        const deliveriesRes = await this.db.query(
          `SELECT dd.*, p.product_name 
           FROM DailyDelivery dd
           JOIN Products p ON dd.product_id = p.product_id
           WHERE dd.customer_id = ? 
             AND dd.delivery_date BETWEEN ? AND ? 
             AND dd.status = 'Delivered'
             AND dd.deleted_at IS NULL;`,
          [customerId, startDate, endDate]
        );
        const deliveries = deliveriesRes.values || [];

        // 3. Compute charges for the month
        let currentMonthCharges = 0;
        for (const item of deliveries) {
          currentMonthCharges += Math.round(item.quantity_delivered * item.rate_applied);
        }

        // 4. Compute payments collected in this month
        const paymentsRes = await this.db.query(
          `SELECT SUM(amount_collected) as total
           FROM PaymentLog
           WHERE customer_id = ?
             AND payment_date BETWEEN ? AND ?
             AND deleted_at IS NULL;`,
          [customerId, startDate, endDate]
        );
        const paymentsReceived = (paymentsRes.values && paymentsRes.values[0].total) || 0;

        // 5. Compute net adjustments in this month
        const adjustmentsRes = await this.db.query(
          `SELECT 
             COALESCE(SUM(CASE WHEN type = 'DEBIT' THEN amount ELSE 0 END), 0) -
             COALESCE(SUM(CASE WHEN type = 'CREDIT' THEN amount ELSE 0 END), 0) as net_adj
           FROM AdjustmentLog
           WHERE customer_id = ?
             AND created_at BETWEEN ? AND ?
             AND deleted_at IS NULL;`,
          [customerId, startDate + " 00:00:00", endDate + " 23:59:59"]
        );
        const netAdjustments = (adjustmentsRes.values && adjustmentsRes.values[0].net_adj) || 0;

        // 6. Compute previous outstanding balance
        // live balance before start of this billing period
        const prevBalRes = await this.db.query(
          `SELECT (
             -- Deliveries before startDate
             COALESCE((SELECT SUM(quantity_delivered * rate_applied) FROM DailyDelivery WHERE customer_id = ? AND status = 'Delivered' AND delivery_date < ? AND deleted_at IS NULL), 0) +
             
             -- Debits before startDate
             COALESCE((SELECT SUM(amount) FROM AdjustmentLog WHERE customer_id = ? AND type = 'DEBIT' AND created_at < ? AND deleted_at IS NULL), 0) -
             
             -- Credits before startDate
             COALESCE((SELECT SUM(amount) FROM AdjustmentLog WHERE customer_id = ? AND type = 'CREDIT' AND created_at < ? AND deleted_at IS NULL), 0) -
             
             -- Payments before startDate
             COALESCE((SELECT SUM(amount_collected) FROM PaymentLog WHERE customer_id = ? AND payment_date < ? AND deleted_at IS NULL), 0)
           ) AS prev_outstanding;`,
          [customerId, startDate, customerId, startDate + " 00:00:00", customerId, startDate + " 00:00:00", customerId, startDate]
        );
        const previousOutstanding = (prevBalRes.values && prevBalRes.values[0].prev_outstanding) || 0;

        // 7. Calculate grand total
        const grandTotal = previousOutstanding + currentMonthCharges - paymentsReceived + netAdjustments;

        let invoiceId;
        let invoiceUuid;
        let invoiceNumber;

        if (existingInvoice) {
          invoiceId = existingInvoice.invoice_id;
          invoiceUuid = existingInvoice.invoice_uuid;
          invoiceNumber = existingInvoice.invoice_number;

          // Update existing invoice record
          await this.db.run(
            `UPDATE Invoice 
             SET previous_outstanding = ?, current_month_total = ?, payments_received = ?, net_adjustments = ?, grand_total = ?, updated_at = CURRENT_TIMESTAMP
             WHERE invoice_id = ?;`,
            [previousOutstanding, currentMonthCharges, paymentsReceived, netAdjustments, grandTotal, invoiceId]
          );

          // Add update to SyncQueue
          await this.db.run(
            "INSERT INTO SyncQueue (entity_type, entity_uuid, operation) VALUES (?, ?, ?);",
            ['Invoice', invoiceUuid, 'UPDATE']
          );

          // Clean old snapshot line items and delivery links
          await this.db.run("DELETE FROM InvoiceLineItem WHERE invoice_id = ?;", [invoiceId]);
          await this.db.run("UPDATE DailyDelivery SET invoice_id = NULL WHERE invoice_id = ?;", [invoiceId]);
        } else {
          // Create new invoice
          invoiceUuid = generateUUID();
          
          // Generate unique invoice number: INV-YYYYMM-<route>-<lastId+1>
          const custRes = await this.db.query("SELECT route_sequence FROM Customers WHERE customer_id = ? LIMIT 1;", [customerId]);
          const routeSeq = (custRes.values && custRes.values[0].route_sequence) || 0;
          const routeStr = String(routeSeq).padStart(3, '0');
          const countRes = await this.db.query("SELECT COUNT(*) as count FROM Invoice;");
          const nextNum = (countRes.values && countRes.values[0].count) + 1;
          invoiceNumber = `INV-${year}${monthStr}-${routeStr}-${String(nextNum).padStart(4, '0')}`;

          const runRes = await this.db.run(
            `INSERT INTO Invoice (invoice_uuid, customer_id, invoice_number, billing_month, billing_year, previous_outstanding, current_month_total, payments_received, net_adjustments, grand_total, billing_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'GENERATED');`,
            [invoiceUuid, customerId, invoiceNumber, month, year, previousOutstanding, currentMonthCharges, paymentsReceived, netAdjustments, grandTotal]
          );
          invoiceId = runRes.changes.lastId;

          // Add insert to SyncQueue
          await this.db.run(
            "INSERT INTO SyncQueue (entity_type, entity_uuid, operation) VALUES (?, ?, ?);",
            ['Invoice', invoiceUuid, 'INSERT']
          );
        }

        // snapshot InvoiceLineItem rows and Link DailyDelivery records
        for (const item of deliveries) {
          const lineSubtotal = Math.round(item.quantity_delivered * item.rate_applied);
          await this.db.run(
            `INSERT INTO InvoiceLineItem (invoice_id, delivery_id, delivery_date, delivery_shift, product_id, product_display_name_snapshot, quantity, rate_applied, line_subtotal)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [invoiceId, item.delivery_id, item.delivery_date, item.delivery_shift, item.product_id, item.product_name, item.quantity_delivered, item.rate_applied, lineSubtotal]
          );

          await this.db.run(
            "UPDATE DailyDelivery SET invoice_id = ? WHERE delivery_id = ?;",
            [invoiceId, item.delivery_id]
          );
        }
        return { success: true, invoiceId, invoiceUuid, invoiceNumber };
      } catch (err) {
        console.error("Failed to generate/regenerate invoice:", err);
        throw err;
      }
  }

  // Reset any SyncQueue rows stuck in PROCESSING state (e.g. app crashed mid-sync)
  async resetStaleSyncItems() {
    if (!this.db) throw new Error("Database not initialized.");
    await this.db.run("UPDATE SyncQueue SET status = 'QUEUED', last_attempt_at = CURRENT_TIMESTAMP WHERE status = 'PROCESSING';");
  }

  async markInvoiceShared(invoiceId) {
      if (!this.db) throw new Error("Database not initialized.");
      try {
        const res = await this.db.query("SELECT invoice_uuid FROM Invoice WHERE invoice_id = ? LIMIT 1;", [invoiceId]);
        if (!res.values || res.values.length === 0) throw new Error("Invoice not found.");
        const uuid = res.values[0].invoice_uuid;

        await this.db.run(
          "UPDATE Invoice SET billing_status = 'SHARED', locked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE invoice_id = ?;",
          [invoiceId]
        );
        await this.db.run(
          "INSERT INTO SyncQueue (entity_type, entity_uuid, operation) VALUES (?, ?, ?);",
          ['Invoice', uuid, 'UPDATE']
        );
        return { success: true };
      } catch (err) {
        throw err;
      }
  }

  async markInvoiceSettled(invoiceId) {
      if (!this.db) throw new Error("Database not initialized.");
      try {
        const res = await this.db.query(
          "SELECT invoice_uuid, billing_status FROM Invoice WHERE invoice_id = ? LIMIT 1;",
          [invoiceId]
        );
        if (!res.values || res.values.length === 0) throw new Error("Invoice not found.");
        const { invoice_uuid: uuid, billing_status } = res.values[0];
        if (billing_status !== 'SHARED') {
          throw new Error(`Invoice cannot be settled from status '${billing_status}'. It must be in SHARED state.`);
        }
        await this.db.run(
          "UPDATE Invoice SET billing_status = 'SETTLED', updated_at = CURRENT_TIMESTAMP WHERE invoice_id = ?;",
          [invoiceId]
        );
        await this.db.run(
          "INSERT INTO SyncQueue (entity_type, entity_uuid, operation) VALUES (?, ?, ?);",
          ['Invoice', uuid, 'UPDATE']
        );
        return { success: true };
      } catch (err) {
        throw err;
      }
  }

  async markInvoiceLocked(invoiceId) {
      if (!this.db) throw new Error("Database not initialized.");
      try {
        const res = await this.db.query(
          "SELECT invoice_uuid, billing_status FROM Invoice WHERE invoice_id = ? LIMIT 1;",
          [invoiceId]
        );
        if (!res.values || res.values.length === 0) throw new Error("Invoice not found.");
        const { invoice_uuid: uuid, billing_status } = res.values[0];
        if (billing_status !== 'SETTLED') {
          throw new Error(`Invoice cannot be locked from status '${billing_status}'. It must be in SETTLED state.`);
        }
        await this.db.run(
          "UPDATE Invoice SET billing_status = 'LOCKED', updated_at = CURRENT_TIMESTAMP WHERE invoice_id = ?;",
          [invoiceId]
        );
        await this.db.run(
          "INSERT INTO SyncQueue (entity_type, entity_uuid, operation) VALUES (?, ?, ?);",
          ['Invoice', uuid, 'UPDATE']
        );
        return { success: true };
      } catch (err) {
        throw err;
      }
  }

  async logAdjustment(adjustmentData) {
      if (!this.db) throw new Error("Database not initialized.");
      const { customer_id, amount, type, reason, reference_invoice_id } = adjustmentData;
      if (!['CREDIT', 'DEBIT'].includes(type)) throw new Error('Invalid adjustment type. Must be CREDIT or DEBIT.');
      if (!amount || amount <= 0) throw new Error('Adjustment amount must be a positive number.');
      if (!reason || !reason.trim()) throw new Error('Adjustment reason is required.');

      try {
        const adjustmentUuid = generateUUID();
        const runRes = await this.db.run(
          `INSERT INTO AdjustmentLog (adjustment_uuid, customer_id, amount, type, reason, reference_invoice_id, sync_status)
           VALUES (?, ?, ?, ?, ?, ?, 0);`,
          [adjustmentUuid, customer_id, amount, type, reason.trim(), reference_invoice_id || null]
        );
        const adjustmentId = runRes.changes.lastId;
        await this.db.run(
          "INSERT INTO SyncQueue (entity_type, entity_uuid, operation) VALUES (?, ?, ?);",
          ['AdjustmentLog', adjustmentUuid, 'INSERT']
        );
        return { success: true, adjustmentId, adjustmentUuid };
      } catch (err) {
        console.error("Failed to log adjustment in transaction:", err);
        throw err;
      }
  }

  async getAdjustments(customerId) {
    if (!this.db) throw new Error("Database not initialized.");
    const queryStr = `
      SELECT a.*, inv.invoice_number AS reference_invoice_number
      FROM AdjustmentLog a
      LEFT JOIN Invoice inv ON a.reference_invoice_id = inv.invoice_id
      WHERE a.customer_id = ? AND a.deleted_at IS NULL
      ORDER BY a.created_at DESC;
    `;
    const result = await this.db.query(queryStr, [customerId]);
    return result.values || [];
  }

  async getAppSettings() {
    if (!this.db) throw new Error("Database not initialized.");
    const res = await this.db.query("SELECT * FROM AppSettings LIMIT 1;");
    return res.values && res.values.length > 0 ? res.values[0] : null;
  }

  async updateAppSettings(settings) {
    if (!this.db) throw new Error("Database not initialized.");
    await this.db.run(
      `UPDATE AppSettings SET 
        default_step_size = ?, 
        auto_share_mode = ?, 
        theme_mode = ?, 
        billing_cycle_day = ?, 
        morning_cutoff_hour = ?,
        supabase_url = ?,
        supabase_anon_key = ?,
        milkman_uuid = ?
       WHERE setting_id = 1;`,
      [
        settings.default_step_size,
        settings.auto_share_mode,
        settings.theme_mode,
        settings.billing_cycle_day,
        settings.morning_cutoff_hour,
        settings.supabase_url || null,
        settings.supabase_anon_key || null,
        settings.milkman_uuid || null
      ]
    );
    return true;
  }

  async getUnsyncedQueue(limit = 50) {
    if (!this.db) throw new Error("Database not initialized.");
    const res = await this.db.query(
      "SELECT * FROM SyncQueue WHERE status = 'QUEUED' ORDER BY created_at ASC LIMIT ?;",
      [limit]
    );
    return res.values || [];
  }

  async markQueueProcessing(syncIds) {
    if (!this.db) throw new Error("Database not initialized.");
    if (syncIds.length === 0) return;
    const placeholders = syncIds.map(() => '?').join(',');
    await this.db.run(
      `UPDATE SyncQueue SET status = 'PROCESSING', last_attempt_at = CURRENT_TIMESTAMP WHERE sync_id IN (${placeholders});`,
      syncIds
    );
  }

  async resolveQueueSynced(syncId, entityType, entityUuid) {
    // NOTE: No runExclusive here — sync runs in background and must not block user writes.
    if (!this.db) throw new Error("Database not initialized.");
    try {
      await this.db.run("DELETE FROM SyncQueue WHERE sync_id = ?;", [syncId]);
      
      let table = null;
      let uuidCol = null;
        switch (entityType) {
          case 'DailyDelivery': table = 'DailyDelivery'; uuidCol = 'delivery_uuid'; break;
          case 'PaymentLog': table = 'PaymentLog'; uuidCol = 'payment_uuid'; break;
          case 'AdjustmentLog': table = 'AdjustmentLog'; uuidCol = 'adjustment_uuid'; break;
          case 'Invoice': table = 'Invoice'; uuidCol = 'invoice_uuid'; break;
          case 'Customers': table = 'Customers'; uuidCol = 'customer_uuid'; break;
          case 'Subscriptions': table = 'Subscriptions'; uuidCol = 'sub_uuid'; break;
          case 'VacationSchedules': table = 'VacationSchedules'; uuidCol = 'vacation_uuid'; break;
        }
        
      if (table && uuidCol) {
        await this.db.run(
          `UPDATE ${table} SET sync_status = 3, updated_at = CURRENT_TIMESTAMP WHERE ${uuidCol} = ?;`,
          [entityUuid]
        );
      }
    } catch (e) {
      throw e;
    }
  }

  async failQueueRetry(syncId, newRetryCount, status = 'QUEUED') {
    if (!this.db) throw new Error("Database not initialized.");
    await this.db.run(
      "UPDATE SyncQueue SET status = ?, retry_count = ?, last_attempt_at = CURRENT_TIMESTAMP WHERE sync_id = ?;",
      [status, newRetryCount, syncId]
    );
  }

  async logNotification(type, refId, scheduledAt) {
    if (!this.db) throw new Error("Database not initialized.");
    return await this.db.run(
      "INSERT INTO NotificationQueue (notification_type, reference_id, scheduled_at, status) VALUES (?, ?, ?, 'PENDING');",
      [type, refId, scheduledAt]
    );
  }

  async addCustomer(customerData) {
      if (!this.db) throw new Error("Database not initialized.");
      try {
        
        const customerUuid = generateUUID();
        const runRes = await this.db.run(
          `INSERT INTO Customers (customer_uuid, name, phone_number, address, route_sequence, special_notes, auto_invoice_delivery, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1);`,
          [
            customerUuid,
            customerData.name,
            customerData.phone_number,
            customerData.address || '',
            customerData.route_sequence || 1,
            customerData.special_notes || '',
            customerData.auto_invoice_delivery !== undefined ? customerData.auto_invoice_delivery : 1
          ]
        );
        
        const customerId = runRes.changes.lastId;
        
        await this.db.run(
          "INSERT INTO SyncQueue (entity_type, entity_uuid, operation) VALUES (?, ?, ?);",
          ['Customers', customerUuid, 'INSERT']
        );
        
        if (customerData.subscriptions && customerData.subscriptions.length > 0) {
          for (const sub of customerData.subscriptions) {
            if (sub.is_deleted) continue;
            const subUuid = generateUUID();
            await this.db.run(
              `INSERT INTO Subscriptions (sub_uuid, customer_id, product_id, delivery_shift, default_quantity, custom_rate, quantity_step, is_active)
               VALUES (?, ?, ?, ?, ?, ?, ?, 1);`,
              [subUuid, customerId, sub.product_id, sub.delivery_shift, sub.default_quantity, sub.custom_rate, sub.quantity_step || 0.25]
            );
            
            await this.db.run(
              "INSERT INTO SyncQueue (entity_type, entity_uuid, operation) VALUES (?, ?, ?);",
              ['Subscriptions', subUuid, 'INSERT']
            );
          }
        }
        return { success: true, customerId, customerUuid };
      } catch (e) {
        throw e;
      }
  }

  async updateCustomer(customerId, customerData) {
      if (!this.db) throw new Error("Database not initialized.");
      try {
        
        const res = await this.db.query("SELECT customer_uuid FROM Customers WHERE customer_id = ? LIMIT 1;", [customerId]);
        if (!res.values || res.values.length === 0) throw new Error("Customer not found.");
        const customerUuid = res.values[0].customer_uuid;
        
        await this.db.run(
          `UPDATE Customers SET 
            name = ?, 
            phone_number = ?, 
            address = ?, 
            route_sequence = ?, 
            special_notes = ?, 
            auto_invoice_delivery = ?,
            updated_at = CURRENT_TIMESTAMP
           WHERE customer_id = ?;`,
          [
            customerData.name,
            customerData.phone_number,
            customerData.address || '',
            customerData.route_sequence || 1,
            customerData.special_notes || '',
            customerData.auto_invoice_delivery !== undefined ? customerData.auto_invoice_delivery : 1,
            customerId
          ]
        );
        
        await this.db.run(
          "INSERT INTO SyncQueue (entity_type, entity_uuid, operation) VALUES (?, ?, ?);",
          ['Customers', customerUuid, 'UPDATE']
        );
        
        if (customerData.subscriptions && customerData.subscriptions.length > 0) {
          for (const sub of customerData.subscriptions) {
            const subRes = await this.db.query(
              "SELECT sub_id, sub_uuid FROM Subscriptions WHERE customer_id = ? AND delivery_shift = ? LIMIT 1;",
              [customerId, sub.delivery_shift]
            );
            
            if (subRes.values && subRes.values.length > 0) {
              const subId = subRes.values[0].sub_id;
              const subUuid = subRes.values[0].sub_uuid;
              
              if (sub.is_deleted) {
                await this.db.run(
                  "UPDATE Subscriptions SET is_active = 0, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE sub_id = ?;",
                  [subId]
                );
                await this.db.run(
                  "INSERT INTO SyncQueue (entity_type, entity_uuid, operation) VALUES (?, ?, ?);",
                  ['Subscriptions', subUuid, 'UPDATE']
                );
              } else {
                await this.db.run(
                  `UPDATE Subscriptions SET 
                    product_id = ?, 
                    default_quantity = ?, 
                    custom_rate = ?, 
                    quantity_step = ?, 
                    is_active = 1,
                    deleted_at = NULL,
                    updated_at = CURRENT_TIMESTAMP
                   WHERE sub_id = ?;`,
                  [sub.product_id, sub.default_quantity, sub.custom_rate, sub.quantity_step || 0.25, subId]
                );
                await this.db.run(
                  "INSERT INTO SyncQueue (entity_type, entity_uuid, operation) VALUES (?, ?, ?);",
                  ['Subscriptions', subUuid, 'UPDATE']
                );
              }
            } else if (!sub.is_deleted) {
              const subUuid = generateUUID();
              await this.db.run(
                `INSERT INTO Subscriptions (sub_uuid, customer_id, product_id, delivery_shift, default_quantity, custom_rate, quantity_step, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 1);`,
                [subUuid, customerId, sub.product_id, sub.delivery_shift, sub.default_quantity, sub.custom_rate, sub.quantity_step || 0.25]
              );
              await this.db.run(
                "INSERT INTO SyncQueue (entity_type, entity_uuid, operation) VALUES (?, ?, ?);",
                ['Subscriptions', subUuid, 'INSERT']
              );
            }
          }
        }
        return { success: true };
      } catch (e) {
        throw e;
      }
  }

  // Generic query wrapper helper
  async query(statement, values = []) {
    if (!this.db) throw new Error("Database connection not initialized.");
    return await this.db.query(statement, values);
  }

  // Generic run wrapper helper
  async run(statement, values = []) {
    if (!this.db) throw new Error("Database connection not initialized.");
    return await this.db.run(statement, values);
  }

  // Generic batch execution helper
  async execute(statement) {
    if (!this.db) throw new Error("Database connection not initialized.");
    return await this.db.execute(statement);
  }
}

export const dbService = new DatabaseService();
