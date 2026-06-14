-- ============================================================
-- DoodhWala — Supabase PostgreSQL Migration
-- File: 001_initial_schema.sql
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================
-- All tables mirror the local SQLite schema.
-- Key differences from SQLite:
--   • UUID primary keys (TEXT → UUID)
--   • owner_uuid UUID NOT NULL — links every row to auth.users.id
--   • Row Level Security (RLS) enforced on all tables
--   • Timestamps use TIMESTAMPTZ (timezone-aware)
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. BusinessProfile
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "BusinessProfile" (
    business_uuid       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_uuid          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    business_name       TEXT        NOT NULL,
    milkman_name        TEXT        NOT NULL,
    phone_number        TEXT        NOT NULL,
    upi_id              TEXT        NOT NULL,
    address             TEXT,
    logo_path           TEXT,
    gst_number          TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE "BusinessProfile" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "milkman_owns_business_profile"
    ON "BusinessProfile" FOR ALL
    USING (owner_uuid = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- 2. Products
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Products" (
    product_uuid        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_uuid          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    product_name        TEXT        NOT NULL,
    unit                TEXT        DEFAULT 'Litre',
    is_active           BOOLEAN     DEFAULT TRUE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(owner_uuid, product_name)
);

ALTER TABLE "Products" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "milkman_owns_products"
    ON "Products" FOR ALL
    USING (owner_uuid = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- 3. Customers
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Customers" (
    customer_uuid           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_uuid              UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name                    TEXT        NOT NULL,
    phone_number            TEXT        NOT NULL,
    address                 TEXT,
    route_sequence          INTEGER     NOT NULL,
    special_notes           TEXT,
    auto_invoice_delivery   BOOLEAN     DEFAULT TRUE,
    is_active               BOOLEAN     DEFAULT TRUE,
    deleted_at              TIMESTAMPTZ DEFAULT NULL,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE "Customers" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "milkman_owns_customers"
    ON "Customers" FOR ALL
    USING (owner_uuid = auth.uid());

CREATE INDEX IF NOT EXISTS idx_customers_owner ON "Customers"(owner_uuid);
CREATE INDEX IF NOT EXISTS idx_customers_active ON "Customers"(owner_uuid, is_active);

-- ─────────────────────────────────────────────────────────────
-- 4. Subscriptions
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Subscriptions" (
    sub_uuid            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_uuid          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    customer_uuid       UUID        NOT NULL REFERENCES "Customers"(customer_uuid) ON DELETE CASCADE,
    product_uuid        UUID        NOT NULL REFERENCES "Products"(product_uuid),
    delivery_shift      SMALLINT    NOT NULL CHECK(delivery_shift IN (0, 1)),
    default_quantity    NUMERIC(6,3) NOT NULL,
    custom_rate         INTEGER     NOT NULL,   -- stored in paise
    quantity_step       NUMERIC(4,3) DEFAULT 0.25,
    is_active           BOOLEAN     DEFAULT TRUE,
    revision_number     INTEGER     DEFAULT 1,
    deleted_at          TIMESTAMPTZ DEFAULT NULL,
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(customer_uuid, product_uuid, delivery_shift)
);

ALTER TABLE "Subscriptions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "milkman_owns_subscriptions"
    ON "Subscriptions" FOR ALL
    USING (owner_uuid = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- 5. VacationSchedules
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "VacationSchedules" (
    vacation_uuid       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_uuid          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    customer_uuid       UUID        NOT NULL REFERENCES "Customers"(customer_uuid) ON DELETE CASCADE,
    start_date          DATE        NOT NULL,
    end_date            DATE        NOT NULL,
    is_active           BOOLEAN     DEFAULT TRUE,
    deleted_at          TIMESTAMPTZ DEFAULT NULL,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE "VacationSchedules" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "milkman_owns_vacations"
    ON "VacationSchedules" FOR ALL
    USING (owner_uuid = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- 6. DailyDelivery
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "DailyDelivery" (
    delivery_uuid           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_uuid              UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    customer_uuid           UUID        NOT NULL REFERENCES "Customers"(customer_uuid),
    sub_uuid                UUID        REFERENCES "Subscriptions"(sub_uuid),
    product_uuid            UUID        NOT NULL REFERENCES "Products"(product_uuid),
    delivery_date           DATE        NOT NULL,
    delivery_shift          SMALLINT    NOT NULL CHECK(delivery_shift IN (0, 1)),
    quantity_delivered      NUMERIC(6,3) NOT NULL,
    rate_applied            INTEGER     NOT NULL,   -- stored in paise
    status                  TEXT        NOT NULL CHECK(status IN ('Delivered', 'Skipped')),
    revision_number         INTEGER     DEFAULT 1,
    invoice_uuid            UUID        DEFAULT NULL,  -- FK set after Invoice table created
    deleted_at              TIMESTAMPTZ DEFAULT NULL,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(customer_uuid, product_uuid, delivery_date, delivery_shift)
);

ALTER TABLE "DailyDelivery" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "milkman_owns_deliveries"
    ON "DailyDelivery" FOR ALL
    USING (owner_uuid = auth.uid());

CREATE INDEX IF NOT EXISTS idx_delivery_customer_date ON "DailyDelivery"(customer_uuid, delivery_date);
CREATE INDEX IF NOT EXISTS idx_delivery_owner_date ON "DailyDelivery"(owner_uuid, delivery_date);

-- ─────────────────────────────────────────────────────────────
-- 7. DeliveryAuditLog
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "DeliveryAuditLog" (
    log_id              BIGSERIAL   PRIMARY KEY,
    owner_uuid          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    delivery_uuid       UUID        NOT NULL REFERENCES "DailyDelivery"(delivery_uuid),
    revision_number     INTEGER     NOT NULL,
    changed_at          TIMESTAMPTZ DEFAULT NOW(),
    old_quantity        NUMERIC(6,3),
    new_quantity        NUMERIC(6,3),
    old_status          TEXT,
    new_status          TEXT,
    reason_notes        TEXT
);

ALTER TABLE "DeliveryAuditLog" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "milkman_owns_audit_logs"
    ON "DeliveryAuditLog" FOR ALL
    USING (owner_uuid = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- 8. PaymentLog
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PaymentLog" (
    payment_uuid        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_uuid          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    customer_uuid       UUID        NOT NULL REFERENCES "Customers"(customer_uuid),
    amount_collected    INTEGER     NOT NULL,   -- stored in paise
    payment_date        DATE        DEFAULT CURRENT_DATE,
    payment_mode        TEXT        NOT NULL CHECK(payment_mode IN ('Cash', 'UPI')),
    notes               TEXT,
    invoice_uuid        UUID        DEFAULT NULL,
    deleted_at          TIMESTAMPTZ DEFAULT NULL,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE "PaymentLog" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "milkman_owns_payments"
    ON "PaymentLog" FOR ALL
    USING (owner_uuid = auth.uid());

CREATE INDEX IF NOT EXISTS idx_payment_customer ON "PaymentLog"(customer_uuid);
CREATE INDEX IF NOT EXISTS idx_payment_owner ON "PaymentLog"(owner_uuid);

-- ─────────────────────────────────────────────────────────────
-- 9. AdjustmentLog
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AdjustmentLog" (
    adjustment_uuid         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_uuid              UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    customer_uuid           UUID        NOT NULL REFERENCES "Customers"(customer_uuid),
    amount                  INTEGER     NOT NULL,   -- stored in paise
    type                    TEXT        NOT NULL CHECK(type IN ('CREDIT', 'DEBIT')),
    reason                  TEXT        NOT NULL,
    reference_invoice_uuid  UUID        DEFAULT NULL,
    deleted_at              TIMESTAMPTZ DEFAULT NULL,
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE "AdjustmentLog" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "milkman_owns_adjustments"
    ON "AdjustmentLog" FOR ALL
    USING (owner_uuid = auth.uid());

CREATE INDEX IF NOT EXISTS idx_adjustment_customer ON "AdjustmentLog"(customer_uuid);

-- ─────────────────────────────────────────────────────────────
-- 10. Invoice
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Invoice" (
    invoice_uuid            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_uuid              UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    customer_uuid           UUID        NOT NULL REFERENCES "Customers"(customer_uuid),
    invoice_number          TEXT        NOT NULL,
    billing_month           SMALLINT    NOT NULL CHECK(billing_month BETWEEN 1 AND 12),
    billing_year            INTEGER     NOT NULL,
    previous_outstanding    INTEGER     DEFAULT 0,   -- paise
    current_month_total     INTEGER     DEFAULT 0,   -- paise
    payments_received       INTEGER     DEFAULT 0,   -- paise
    net_adjustments         INTEGER     DEFAULT 0,   -- paise (CREDIT minus DEBIT)
    grand_total             INTEGER     DEFAULT 0,   -- paise
    billing_status          TEXT        DEFAULT 'DRAFT'
                                        CHECK(billing_status IN ('DRAFT','GENERATED','SHARED','SETTLED','LOCKED')),
    pdf_local_path          TEXT,
    locked_at               TIMESTAMPTZ DEFAULT NULL,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(owner_uuid, invoice_number)
);

ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "milkman_owns_invoices"
    ON "Invoice" FOR ALL
    USING (owner_uuid = auth.uid());

CREATE INDEX IF NOT EXISTS idx_invoice_customer ON "Invoice"(customer_uuid);
CREATE INDEX IF NOT EXISTS idx_invoice_owner_month ON "Invoice"(owner_uuid, billing_year, billing_month);

-- Now add FK from DailyDelivery to Invoice (cross-table FK added after both tables exist)
ALTER TABLE "DailyDelivery"
    ADD CONSTRAINT fk_delivery_invoice
    FOREIGN KEY (invoice_uuid) REFERENCES "Invoice"(invoice_uuid);

-- ─────────────────────────────────────────────────────────────
-- 11. InvoiceLineItem
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "InvoiceLineItem" (
    line_item_id                BIGSERIAL   PRIMARY KEY,
    owner_uuid                  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    invoice_uuid                UUID        NOT NULL REFERENCES "Invoice"(invoice_uuid) ON DELETE CASCADE,
    delivery_uuid               UUID        NOT NULL REFERENCES "DailyDelivery"(delivery_uuid),
    delivery_date               DATE        NOT NULL,
    delivery_shift              SMALLINT    NOT NULL CHECK(delivery_shift IN (0, 1)),
    product_uuid                UUID        NOT NULL REFERENCES "Products"(product_uuid),
    product_display_name_snapshot TEXT      NOT NULL,
    quantity                    NUMERIC(6,3) NOT NULL,
    rate_applied                INTEGER     NOT NULL,   -- paise
    line_subtotal               INTEGER     NOT NULL    -- paise
);

ALTER TABLE "InvoiceLineItem" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "milkman_owns_line_items"
    ON "InvoiceLineItem" FOR ALL
    USING (owner_uuid = auth.uid());

CREATE INDEX IF NOT EXISTS idx_lineitem_invoice ON "InvoiceLineItem"(invoice_uuid);

-- ─────────────────────────────────────────────────────────────
-- 12. NotificationQueue  (cloud mirror — optional)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "NotificationQueue" (
    notification_id     BIGSERIAL   PRIMARY KEY,
    owner_uuid          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    notification_type   TEXT        NOT NULL CHECK(notification_type IN (
                            'MONTH_END_BILLING',
                            'SHARE_REMINDER',
                            'SYNC_FAILURE_ALERT',
                            'SHARE_FAILURE_RETRY'
                        )),
    reference_uuid      UUID        DEFAULT NULL,
    scheduled_at        TIMESTAMPTZ NOT NULL,
    fired_at            TIMESTAMPTZ DEFAULT NULL,
    status              TEXT        DEFAULT 'PENDING'
                                    CHECK(status IN ('PENDING','FIRED','DISMISSED','FAILED')),
    retry_count         INTEGER     DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE "NotificationQueue" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "milkman_owns_notifications"
    ON "NotificationQueue" FOR ALL
    USING (owner_uuid = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- 13. SyncQueue  (cloud mirror — used for diagnostics only)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "SyncQueue" (
    sync_id             BIGSERIAL   PRIMARY KEY,
    owner_uuid          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    entity_type         TEXT        NOT NULL,
    entity_uuid         UUID        NOT NULL,
    operation           TEXT        NOT NULL CHECK(operation IN ('INSERT', 'UPDATE', 'DELETE')),
    payload_hash        TEXT,
    retry_count         INTEGER     DEFAULT 0,
    last_attempt_at     TIMESTAMPTZ DEFAULT NULL,
    status              TEXT        DEFAULT 'QUEUED'
                                    CHECK(status IN ('QUEUED','PROCESSING','FAILED')),
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE "SyncQueue" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "milkman_owns_syncqueue"
    ON "SyncQueue" FOR ALL
    USING (owner_uuid = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- Updated_at trigger (auto-update timestamps on any UPDATE)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to tables that have updated_at
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        '"BusinessProfile"', '"Products"', '"Customers"',
        '"Subscriptions"', '"VacationSchedules"',
        '"DailyDelivery"', '"PaymentLog"', '"Invoice"'
    ] LOOP
        EXECUTE format(
            'CREATE TRIGGER trigger_updated_at_%s
             BEFORE UPDATE ON %s
             FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();',
            regexp_replace(t, '[^a-zA-Z0-9]', '', 'g'), t
        );
    END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- Done! All 13 cloud tables created with RLS.
-- AppSettings is local-only (SQLite) and has no cloud table.
-- ─────────────────────────────────────────────────────────────
