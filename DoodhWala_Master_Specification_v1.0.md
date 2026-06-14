# 🥛 DoodhWala — Master Specification Document

## Version 1.0 — Architecture Freeze | Single Source of Truth

**How to use this document:** Upload this file to Google Stitch for UI design reference. Then use it as the master context file in Cursor / Google Antigravity IDE for implementation. Every architectural decision has been finalized here. Do not modify the schema during development. If a real-user test reveals a need for change, version-bump this document first.

---

## Table of Contents

1. Executive Summary & Core Philosophy  
2. Technology Stack  
3. Architecture Decisions & Implementation Constraints  
4. Database Schema — 14 Tables (Final)  
5. Runtime Financial Ledger Engine  
6. Core Business Rules & Lifecycles  
7. Offline Sync State Machine  
8. Screen-by-Screen Specifications  
9. Invoice Specification  
10. Key SQL Queries Reference  
11. UML & System Diagrams  
12. Development Order  
13. Conflicts Resolved Between Source Documents  
14. Features Deferred to Future Versions

---

## 1\. Executive Summary & Core Philosophy

**DoodhWala** is an offline-first Android application for individual neighborhood milkmen in India. It replaces the traditional paper *Khata* (ledger notebook) with a fast, reliable, and automated digital accounting system.

### The One Rule Everything Else Derives From

The milkman is on a moving vehicle at 5:00 AM with one hand occupied. Every feature must justify itself against: *"Does this require the milkman to stop and think?"* If yes — redesign it.

### Three Non-Negotiable Principles

**Zero-Friction Utility** Optimized for rapid, one-handed operation at 5:00 AM. Touch targets must be massive. Text must be high-contrast. Keyboard typing must be completely eliminated during the delivery run.

**Single-Actor System** The application is built strictly for the milkman vendor. There is no customer-facing application, no delivery-partner app, no marketplace layer.

**Passive Customer Interface** Customer interaction happens entirely via professional PDFs transmitted through the native Android Share Intent into WhatsApp. The customer never downloads anything.

---

## 2\. Technology Stack

| Layer | Technology | Mandate |
| :---- | :---- | :---- |
| Mobile Shell | **Capacitor.js** | Wraps HTML/CSS/JS into a native Android APK with access to hardware filesystem and native share sheets |
| UI Framework | **Vue 3** | Manages reactive local state for instant UI transitions without screen stutter |
| Local Database | **@capacitor-community/sqlite** | Absolute source of truth. Relational SQLite file on device hardware storage |
| Cloud Infrastructure | **Supabase** | Phone OTP authentication, secure cloud backup, per-user data isolation |
| Remote DB Engine | **PostgreSQL** (via Supabase) | Remote mirror of local schema, guarded by Row Level Security linked to authenticated UUID |
| PDF Generation | **jsPDF** | Client-side PDF generation, no server required |
| File Storage | **@capacitor/filesystem** | Save generated PDFs to device storage |
| Sharing | **@capacitor/share** | Triggers native Android share sheet for WhatsApp delivery |
| Notifications | **@capacitor/local-notifications** | Month-end billing reminders at 8:00 AM |
| IDE Flow | Google Stitch → Cursor / Antigravity | Design first, implement second |

### Developer-Facing Architecture Diagram

MILKMAN'S ANDROID DEVICE

┌─────────────────────────────────────────────────────────┐

│                                                         │

│   Vue 3 UI (HTML/CSS/JS via Capacitor)                 │

│        │                                               │

│        ▼ reads & writes instantly                      │

│   SQLite Database (14 tables)                          │

│        │                                               │

│        ▼ on every write                                │

│   SyncQueue Table (tracks unsynced records)            │

│        │                                               │

└────────┼────────────────────────────────────────────────┘

         │ background worker, only when internet available

         ▼

SUPABASE CLOUD (YOUR server — milkman never sees this)

┌─────────────────────────────────────────────────────────┐

│   PostgreSQL mirror of local schema                     │

│   \+ milkman\_uuid column on every table                  │

│   \+ Row Level Security (each milkman sees only their    │

│     own data — isolation enforced at DB level)          │

└─────────────────────────────────────────────────────────┘

---

## **3\. Architecture Decisions & Implementation Constraints (Mandatory)**

The following decisions supersede any conflicting implementation details elsewhere in this document. AI agents **must follow these rules exactly** and must not redesign them during implementation.

---

### **3.1. Vacation Handling**

#### **Final Decision**

**Vacation days DO NOT create `DailyDelivery` records.**

A customer on vacation is identified exclusively through the `VacationSchedules` table.

#### **Consequences**

* Remove `'Vacation'` from the `DailyDelivery.status` enum.  
* The valid status values are:

CHECK(status IN ('Delivered', 'Skipped'))

* The route screen must determine vacation status by checking `VacationSchedules` for the current date.  
* If a customer is on vacation:  
  * Do not generate a `DailyDelivery` row.  
  * Do not bill the customer.  
  * Display the customer as "On Vacation" in the UI.  
* The absence of a delivery row for a vacation day is intentional and should not be treated as missing data.

---

### **3.2. Monetary Values Must Never Use Floating Point**

#### **Final Decision**

All financial values must be stored as **INTEGER values representing paise**, never as floating-point (`REAL`) numbers.

Example:

| Display Value | Stored Value |
| ----- | ----- |
| ₹65.00 | 6500 |
| ₹12.50 | 1250 |
| ₹0.75 | 75 |

The following fields should be stored as INTEGER (paise):

* `custom_rate`  
* `rate_applied`  
* `amount`  
* `amount_collected`  
* `previous_outstanding`  
* `current_month_total`  
* `payments_received`  
* `net_adjustments`  
* `grand_total`  
* `line_subtotal`

Only convert paise back into rupees when displaying values in the UI or generating PDFs.

This prevents floating-point rounding errors and guarantees accounting accuracy.

---

### **3.3. Milk Quantities**

#### **Final Decision**

Milk quantities are **not monetary values** and may remain `REAL`.

Examples:

0.25 L  
0.50 L  
1.25 L  
1.75 L

The following fields may safely use `REAL`:

* `default_quantity`  
* `quantity_delivered`

If future precision requirements increase, quantities may instead be represented as integer milliliters.

---

### **3.4. "Send All" Invoice Sharing**

#### **Final Decision**

The application **must not** automatically trigger multiple Android Share Intents using timers or delays.

The following approach is prohibited:

Share Customer A  
↓  
wait 800 ms  
↓  
Share Customer B  
↓  
wait 800 ms  
↓  
Share Customer C

Instead, invoice sharing must operate as a sequential workflow:

Share Customer A  
↓  
User completes Android Share Sheet  
↓  
Application regains focus  
↓  
Mark invoice as Shared  
↓  
Enable "Continue"  
↓  
Share Customer B

The application must wait until control returns from the native Android Share Sheet before proceeding to the next customer.

---

### **3.5. Runtime Outstanding Balance Calculation**

#### **Final Decision**

Outstanding balances are **never stored** as persistent values.

Balances must always be computed dynamically using:

Outstanding \=  
SUM(Delivered Charges)  
\+ SUM(Debit Adjustments)  
\- SUM(Credit Adjustments)  
\- SUM(Payments Received)

No `balance` column should exist in the `Customers` table.

This guarantees that edits, adjustments, and payments are reflected immediately without cache synchronization issues.

---

### **3.6. SyncQueue Lifecycle**

`SyncQueue` is an operational processing queue, **not** a historical audit table.

After a successful synchronization:

* Mark the source entity as synced.  
* Physically remove the processed queue item.

Example:

DELETE FROM SyncQueue  
WHERE sync\_id \= ?;

Do not retain completed queue entries indefinitely.

---

### **3.7. Required Database Indexes**

The following indexes should exist to ensure efficient routing, billing, and synchronization:

CREATE INDEX idx\_delivery\_customer\_date  
ON DailyDelivery(customer\_id, delivery\_date);

CREATE INDEX idx\_delivery\_invoice  
ON DailyDelivery(invoice\_id);

CREATE INDEX idx\_payment\_customer  
ON PaymentLog(customer\_id);

CREATE INDEX idx\_adjustment\_customer  
ON AdjustmentLog(customer\_id);

CREATE INDEX idx\_invoice\_customer  
ON Invoice(customer\_id);

CREATE INDEX idx\_syncqueue\_status  
ON SyncQueue(status);

CREATE INDEX idx\_dailydelivery\_sync  
ON DailyDelivery(sync\_status);

CREATE INDEX idx\_paymentlog\_sync  
ON PaymentLog(sync\_status);

CREATE INDEX idx\_invoice\_sync  
ON Invoice(sync\_status);

Additional indexes may be added if performance testing identifies bottlenecks.

---

### **3.8. Cloud Ownership**

Every synchronized record stored in Supabase should include an ownership identifier such as:

owner\_uuid

or

milkman\_uuid

This enables:

* Row Level Security (RLS)  
* Per-user data isolation  
* Simpler backup and recovery  
* Future multi-user scalability

Ownership must be enforced at the database level.

---

### **3.9. Invoice Generation Must Be Atomic**

Generating an invoice is a single logical operation and must execute inside one database transaction.

The following steps must either all succeed or all fail:

1. Create the `Invoice` record.  
2. Generate all `InvoiceLineItem` snapshot rows.  
3. Link corresponding `DailyDelivery` records.  
4. Compute totals.  
5. Commit the transaction.

If any step fails, the transaction must roll back completely to avoid partial invoices.

---

### **3.10. Architecture Freeze**

These decisions are considered final.

AI agents implementing this project **must not** redesign the database schema, synchronization strategy, accounting model, or billing workflow unless the specification document itself is versioned and updated.

## 

## 4\. Database Schema — 14 Tables (Final DDL)

**(NOTE: \> \#\#\# Currency Storage Rule**  
**\> All monetary values in the database are stored as \*\*INTEGER values representing paise\*\* (e.g., ₹65.50 is stored as \`6550\`). Conversion to rupees should occur only in the presentation layer (UI, PDFs, reports, and exports). This avoids floating-point precision errors in financial calculations.)**  
**UUID Strategy:** Every important entity carries both a local integer ID (for fast on-device JOIN queries) and a UUID (for collision-free cloud synchronization). Never use integer IDs for cloud sync. Never use UUIDs for local SQL JOINs.

**Soft Deletes:** Records are never permanently destroyed. Use `deleted_at = timestamp` to preserve complete historical integrity. Filter with `WHERE deleted_at IS NULL` in queries.

**Audit Fields:** Every major table includes `created_at` and `updated_at`. Editable tables also include `revision_number`.

---

### Table 1 — AppSettings

Hardware-level application configuration. One row. Never more than one.

CREATE TABLE AppSettings (

    setting\_id          INTEGER PRIMARY KEY AUTOINCREMENT,

    default\_step\_size   REAL    DEFAULT 0.25,       \-- Default ± button increment (0.25 or 0.5)

    auto\_share\_mode     INTEGER DEFAULT 0,           \-- 0 \= Manual review, 1 \= Sequential auto-stage

    theme\_mode          TEXT    DEFAULT 'HIGH\_CONTRAST\_LIGHT',

    billing\_cycle\_day   INTEGER DEFAULT 1,           \-- Day of month billing resets (almost always 1\)

    morning\_cutoff\_hour INTEGER DEFAULT 12           \-- Hour before which shift \= MORNING (0), after \= EVENING (1)

);

---

### Table 2 — BusinessProfile

The milkman's business identity. Printed on every invoice header. One row per app installation.

CREATE TABLE BusinessProfile (

    business\_id     INTEGER  PRIMARY KEY AUTOINCREMENT,

    business\_uuid   TEXT     NOT NULL UNIQUE,

    business\_name   TEXT     NOT NULL,           \-- e.g., "Krishna Dairy Supplies"

    milkman\_name    TEXT     NOT NULL,           \-- e.g., "Ramesh Sharma"

    phone\_number    TEXT     NOT NULL,

    upi\_id          TEXT     NOT NULL,           \-- e.g., "kdairy@okaxis"

    address         TEXT,

    logo\_path       TEXT,                        \-- Local device file path to logo image

    gst\_number      TEXT     DEFAULT NULL,       \-- Optional, for future GST support

    created\_at      DATETIME DEFAULT CURRENT\_TIMESTAMP,

    updated\_at      DATETIME DEFAULT CURRENT\_TIMESTAMP

);

---

### Table 3 — Products

Catalog of all product types the milkman sells.

CREATE TABLE Products (

    product\_id      INTEGER  PRIMARY KEY AUTOINCREMENT,

    product\_uuid    TEXT     NOT NULL UNIQUE,

    product\_name    TEXT     NOT NULL UNIQUE,    \-- e.g., "Cow Milk", "Buffalo Milk"

    unit            TEXT     DEFAULT 'Litre',

    is\_active       INTEGER  DEFAULT 1,

    created\_at      DATETIME DEFAULT CURRENT\_TIMESTAMP,

    updated\_at      DATETIME DEFAULT CURRENT\_TIMESTAMP

);

---

### Table 4 — Customers

Central customer directory. One row per customer. No balance column — balance is always computed at runtime (see Section 4).

CREATE TABLE Customers (

    customer\_id             INTEGER  PRIMARY KEY AUTOINCREMENT,

    customer\_uuid           TEXT     NOT NULL UNIQUE,

    name                    TEXT     NOT NULL,

    phone\_number            TEXT     NOT NULL,

    address                 TEXT,

    route\_sequence          INTEGER  NOT NULL,   \-- Controls physical delivery order for BOTH shifts

    special\_notes           TEXT,                \-- ALWAYS visible on route screen row, never hidden

    auto\_invoice\_delivery   INTEGER  DEFAULT 1,  \-- 0 \= Manual approval hold, 1 \= Stage in share flow

    is\_active               INTEGER  DEFAULT 1,

    deleted\_at              DATETIME DEFAULT NULL,

    created\_at              DATETIME DEFAULT CURRENT\_TIMESTAMP,

    updated\_at              DATETIME DEFAULT CURRENT\_TIMESTAMP

);

**Note on route\_sequence:** A single sequence number controls order for both Morning and Evening shifts. The milkman follows the same physical street route both times.

---

### Table 5 — Subscriptions

Default daily delivery agreements. One row per customer per product per shift. A customer receiving Cow Milk in the morning and Buffalo Milk in the evening has exactly 2 rows.

CREATE TABLE Subscriptions (

    sub\_id              INTEGER  PRIMARY KEY AUTOINCREMENT,

    sub\_uuid            TEXT     NOT NULL UNIQUE,

    customer\_id         INTEGER  NOT NULL,

    product\_id          INTEGER  NOT NULL,

    delivery\_shift      INTEGER  NOT NULL CHECK(delivery\_shift IN (0, 1)),  \-- 0 \= MORNING, 1 \= EVENING

    default\_quantity    REAL     NOT NULL,        \-- e.g., 1.5 for 1.5 Litres

    custom\_rate         INTEGER     NOT NULL,        \-- Per-customer price per unit

    quantity\_step       REAL     DEFAULT 0.25,    \-- Step size for ± buttons: 0.25 or 0.5

    is\_active           INTEGER  DEFAULT 1,

    revision\_number     INTEGER  DEFAULT 1,

    deleted\_at          DATETIME DEFAULT NULL,

    updated\_at          DATETIME DEFAULT CURRENT\_TIMESTAMP,

    FOREIGN KEY(customer\_id) REFERENCES Customers(customer\_id),

    FOREIGN KEY(product\_id)  REFERENCES Products(product\_id),

    UNIQUE(customer\_id, product\_id, delivery\_shift)  \-- Prevents duplicate slot subscriptions

);

**quantity\_step:** Determines whether the ± buttons jump by 0.25L or 0.5L for this customer's subscription. Some customers (e.g., large families) adjust in 0.5L steps. Others (e.g., single-person households) prefer 0.25L precision.

---

### Table 6 — VacationSchedules

Scheduled delivery pauses. When a vacation is active, the customer is automatically skipped for ALL shifts. No manual skip needed.

CREATE TABLE VacationSchedules (

    vacation\_id     INTEGER  PRIMARY KEY AUTOINCREMENT,

    vacation\_uuid   TEXT     NOT NULL UNIQUE,

    customer\_id     INTEGER  NOT NULL,

    start\_date      DATE     NOT NULL,

    end\_date        DATE     NOT NULL,

    is\_active       INTEGER  DEFAULT 1,

    deleted\_at      DATETIME DEFAULT NULL,

    created\_at      DATETIME DEFAULT CURRENT\_TIMESTAMP,

    updated\_at      DATETIME DEFAULT CURRENT\_TIMESTAMP,

    FOREIGN KEY(customer\_id) REFERENCES Customers(customer\_id)

);

---

### Table 7 — DailyDelivery

The atomic daily delivery log. The heart of the entire system. One row per customer per product per shift per date.

CREATE TABLE DailyDelivery (

    delivery\_id         INTEGER  PRIMARY KEY AUTOINCREMENT,

    delivery\_uuid       TEXT     NOT NULL UNIQUE,

    customer\_id         INTEGER  NOT NULL,

    sub\_id              INTEGER  NOT NULL,        \-- Links to the subscription that triggered this delivery

    product\_id          INTEGER  NOT NULL,

    delivery\_date       DATE     DEFAULT CURRENT\_DATE,

    delivery\_shift      INTEGER  NOT NULL CHECK(delivery\_shift IN (0, 1)),  \-- 0 \= MORNING, 1 \= EVENING

    quantity\_delivered  REAL     NOT NULL,        \-- Actual quantity (may differ from subscription default)

    rate\_applied        INTEGER     NOT NULL,        \-- Rate FROZEN at point of delivery. Never editable after logging.

    status              TEXT     NOT NULL CHECK(status IN ('Delivered', 'Skipped')),

    revision\_number     INTEGER  DEFAULT 1,

    invoice\_id          INTEGER  DEFAULT NULL,    \-- Set when this row is included in a generated invoice

    sync\_status         INTEGER  DEFAULT 0 CHECK(sync\_status IN (0,1,2,3,4)),

    deleted\_at          DATETIME DEFAULT NULL,

    updated\_at          DATETIME DEFAULT CURRENT\_TIMESTAMP,

    FOREIGN KEY(customer\_id) REFERENCES Customers(customer\_id),

    FOREIGN KEY(sub\_id)      REFERENCES Subscriptions(sub\_id),

    FOREIGN KEY(product\_id)  REFERENCES Products(product\_id),

    FOREIGN KEY(invoice\_id)  REFERENCES Invoice(invoice\_id),

    UNIQUE(customer\_id, product\_id, delivery\_date, delivery\_shift)  \-- One entry per slot per day

);

**sync\_status values:**

- `0` \= LOCAL\_ONLY (written to device, not yet queued)  
- `1` \= PENDING\_SYNC (added to SyncQueue)  
- `2` \= SYNCING (currently being transmitted)  
- `3` \= SYNCED (confirmed by Supabase 200 OK)  
- `4` \= FAILED (transmission error, awaiting retry)

**Editable fields (within 7 days):** `quantity_delivered`, `status` **Permanently locked fields:** `product_id`, `rate_applied`, `customer_id`, `delivery_date`, `delivery_shift`

---

### Table 8 — DeliveryAuditLog

Immutable record of every modification made to a DailyDelivery row. Every single edit appends a row here. History is never lost.

CREATE TABLE DeliveryAuditLog (

    log\_id          INTEGER  PRIMARY KEY AUTOINCREMENT,

    delivery\_id     INTEGER  NOT NULL,

    revision\_number INTEGER  NOT NULL,            \-- Matches the new revision\_number on the parent row

    changed\_at      DATETIME DEFAULT CURRENT\_TIMESTAMP,

    old\_quantity    REAL,

    new\_quantity    REAL,

    old\_status      TEXT,

    new\_status      TEXT,

    reason\_notes    TEXT,                         \-- Optional reason the milkman enters for the change

    FOREIGN KEY(delivery\_id) REFERENCES DailyDelivery(delivery\_id)

);

---

### Table 9 — PaymentLog

Every cash or UPI payment received from a customer. Used exclusively for real money received — never for accounting adjustments.

CREATE TABLE PaymentLog (

    pay\_id          INTEGER  PRIMARY KEY AUTOINCREMENT,

    payment\_uuid    TEXT     NOT NULL UNIQUE,

    customer\_id     INTEGER  NOT NULL,

    amount\_collected INTEGER    NOT NULL,

    payment\_date    DATE     DEFAULT CURRENT\_DATE,

    payment\_mode    TEXT     NOT NULL CHECK(payment\_mode IN ('Cash', 'UPI')),

    notes           TEXT,

    invoice\_id      INTEGER  DEFAULT NULL,        \-- Links payment to invoice if collected at billing time

    sync\_status     INTEGER  DEFAULT 0 CHECK(sync\_status IN (0,1,2,3,4)),

    deleted\_at      DATETIME DEFAULT NULL,

    updated\_at      DATETIME DEFAULT CURRENT\_TIMESTAMP,

    FOREIGN KEY(customer\_id) REFERENCES Customers(customer\_id),

    FOREIGN KEY(invoice\_id)  REFERENCES Invoice(invoice\_id)

);

---

### Table 10 — AdjustmentLog

For financial corrections that arise AFTER an invoice has been locked. Never use PaymentLog for adjustments — they are semantically different.

CREATE TABLE AdjustmentLog (

    adjustment\_id           INTEGER  PRIMARY KEY AUTOINCREMENT,

    adjustment\_uuid         TEXT     NOT NULL UNIQUE,

    customer\_id             INTEGER  NOT NULL,

    amount                  INTEGER     NOT NULL,    \-- Stored in paisa

    type                    TEXT     NOT NULL CHECK(type IN ('CREDIT', 'DEBIT')),

    \-- CREDIT \= reduces outstanding balance (e.g., goodwill discount, overcharge correction)

    \-- DEBIT  \= increases outstanding balance (e.g., extra item charged after lock)

    reason                  TEXT     NOT NULL,    \-- Mandatory description

    reference\_invoice\_id    INTEGER  DEFAULT NULL,

    sync\_status             INTEGER  DEFAULT 0 CHECK(sync\_status IN (0,1,2,3,4)),

    deleted\_at              DATETIME DEFAULT NULL,

    created\_at              DATETIME DEFAULT CURRENT\_TIMESTAMP,

    FOREIGN KEY(customer\_id)          REFERENCES Customers(customer\_id),

    FOREIGN KEY(reference\_invoice\_id) REFERENCES Invoice(invoice\_id)

);

---

### Table 11 — Invoice

Master invoice header. One row per customer per billing month.

CREATE TABLE Invoice (

    invoice\_id              INTEGER  PRIMARY KEY AUTOINCREMENT,

    invoice\_uuid            TEXT     NOT NULL UNIQUE,

    customer\_id             INTEGER  NOT NULL,

    invoice\_number          TEXT     NOT NULL UNIQUE,  \-- Format: INV-YYYYMM-CUSTOMERID-SEQUENCE

    billing\_month           INTEGER  NOT NULL,          \-- 1–12

    billing\_year            INTEGER  NOT NULL,

    previous\_outstanding    INTEGER     DEFAULT 0,       \-- Snapshot of balance BEFORE this month's charges

    current\_month\_total     INTEGER     DEFAULT 0,       \-- SUM of this month's DailyDelivery rows

    payments\_received       INTEGER     DEFAULT 0,       \-- SUM of this month's PaymentLog rows

    net\_adjustments         INTEGER     DEFAULT 0,       \-- Net of AdjustmentLog (CREDIT minus DEBIT)

    grand\_total             INTEGER     DEFAULT 0,       \-- The final amount the customer owes

    billing\_status          TEXT     DEFAULT 'DRAFT'

                            CHECK(billing\_status IN ('DRAFT','GENERATED','SHARED','SETTLED','LOCKED')),

    pdf\_local\_path          TEXT,                       \-- Device file path to generated PDF

    locked\_at               DATETIME DEFAULT NULL,      \-- Set when status moves to SHARED or beyond

    sync\_status             INTEGER  DEFAULT 0 CHECK(sync\_status IN (0,1,2,3,4)),

    created\_at              DATETIME DEFAULT CURRENT\_TIMESTAMP,

    updated\_at              DATETIME DEFAULT CURRENT\_TIMESTAMP,

    FOREIGN KEY(customer\_id) REFERENCES Customers(customer\_id)

);

**Invoice Lifecycle:** `DRAFT` → `GENERATED` → `SHARED` → `SETTLED` → `LOCKED`

- **DRAFT / GENERATED:** Invoice can be regenerated. Backdated edits within 7 days clear and recalculate line items.  
- **SHARED and beyond:** Hard lock applied. `locked_at` is set. No DailyDelivery rows linked to this invoice can be modified. All future corrections must go through AdjustmentLog.

---

### Table 12 — InvoiceLineItem

Snapshot of each delivery entry at the time the invoice was generated. Ensures historical invoices remain exactly reproducible even if product names or rates change later.

CREATE TABLE InvoiceLineItem (

    line\_item\_id                INTEGER  PRIMARY KEY AUTOINCREMENT,

    invoice\_id                  INTEGER  NOT NULL,

    delivery\_id                 INTEGER  NOT NULL,      \-- Reference to original DailyDelivery row

    delivery\_date               DATE     NOT NULL,

    delivery\_shift              INTEGER  NOT NULL CHECK(delivery\_shift IN (0, 1)),

    product\_id                  INTEGER  NOT NULL,

    product\_display\_name\_snapshot TEXT   NOT NULL,     \-- Frozen product name at time of billing

    quantity                    REAL     NOT NULL,

    rate\_applied                INTEGER     NOT NULL, –stored in paisa

    line\_subtotal               INTEGER     NOT NULL,

    FOREIGN KEY(invoice\_id)   REFERENCES Invoice(invoice\_id),

    FOREIGN KEY(delivery\_id)  REFERENCES DailyDelivery(delivery\_id),

    FOREIGN KEY(product\_id)   REFERENCES Products(product\_id)

);

---

### Table 13 — NotificationQueue

Manages scheduled and retry-pending notification events. Prevents duplicate notifications and tracks delivery failures.

CREATE TABLE NotificationQueue (

    notification\_id     INTEGER  PRIMARY KEY AUTOINCREMENT,

    notification\_type   TEXT     NOT NULL CHECK(notification\_type IN (

                            'MONTH\_END\_BILLING',    \-- Last day of month reminder

                            'SHARE\_REMINDER',       \-- Specific customer invoice not yet sent

                            'SYNC\_FAILURE\_ALERT',   \-- Background sync repeatedly failing

                            'SHARE\_FAILURE\_RETRY'   \-- WhatsApp share failed, retry prompt

                        )),

    reference\_id        INTEGER  DEFAULT NULL,       \-- customer\_id or invoice\_id depending on type

    scheduled\_at        DATETIME NOT NULL,

    fired\_at            DATETIME DEFAULT NULL,       \-- NULL \= not yet delivered

    status              TEXT     DEFAULT 'PENDING' CHECK(status IN ('PENDING','FIRED','DISMISSED','FAILED')),

    retry\_count         INTEGER  DEFAULT 0,

    created\_at          DATETIME DEFAULT CURRENT\_TIMESTAMP

);

---

### Table 14 — SyncQueue

First-class, resumable synchronization queue. Every local write that needs to reach Supabase passes through this table. The background sync worker reads from here exclusively.

CREATE TABLE SyncQueue (

    sync\_id         INTEGER  PRIMARY KEY AUTOINCREMENT,

    entity\_type     TEXT     NOT NULL,    \-- 'DailyDelivery' | 'PaymentLog' | 'AdjustmentLog'

                                          \-- | 'Invoice' | 'InvoiceLineItem' | 'Customers'

                                          \-- | 'Subscriptions' | 'VacationSchedules'

    entity\_uuid     TEXT     NOT NULL,

    operation       TEXT     NOT NULL CHECK(operation IN ('INSERT', 'UPDATE', 'DELETE')),

    payload\_hash    TEXT,                 \-- MD5/SHA of payload to detect duplicate queue entries

    retry\_count     INTEGER  DEFAULT 0,

    last\_attempt\_at DATETIME DEFAULT NULL,

    status          TEXT     DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','PROCESSING','FAILED')),

    created\_at      DATETIME DEFAULT CURRENT\_TIMESTAMP

);

---

## 4\. Runtime Financial Ledger Engine

### Critical Architectural Decision: No Stored Balance Column

The `Customers` table has **no** `balance_amount` column. The outstanding balance is **never stored as a static value** — it is always computed fresh by aggregating atomic historical records.

**Why this is correct:**

- Eliminates the entire class of bugs where the stored balance drifts out of sync with transactions  
- Makes the edit system trivially safe (edit a quantity → balance automatically reflects it next query)  
- Makes the audit log the single source of truth — no reconciliation needed

**The Trade-off to Acknowledge:** Running this computation for 40–100 customers simultaneously on the route screen requires careful query optimization (see Section 9). For the scale of this application (≤100 customers per milkman), performance is not a concern.

### The Master Ledger Formula

Outstanding Balance \=

  SUM(All 'Delivered' DailyDelivery rows × rate\_applied)

  \+ SUM(All DEBIT AdjustmentLog entries)

  \- SUM(All CREDIT AdjustmentLog entries)

  \- SUM(All PaymentLog entries)

### Optimized Runtime Balance Query

\-- Use :cust\_id as the parameter for the target customer

SELECT (

    COALESCE((

        SELECT SUM(quantity\_delivered \* rate\_applied)

        FROM DailyDelivery

        WHERE customer\_id \= :cust\_id

          AND status \= 'Delivered'

          AND deleted\_at IS NULL

    ), 0\)

    \+

    COALESCE((

        SELECT SUM(amount)

        FROM AdjustmentLog

        WHERE customer\_id \= :cust\_id

          AND type \= 'DEBIT'

          AND deleted\_at IS NULL

    ), 0\)

    \-

    COALESCE((

        SELECT SUM(amount)

        FROM AdjustmentLog

        WHERE customer\_id \= :cust\_id

          AND type \= 'CREDIT'

          AND deleted\_at IS NULL

    ), 0\)

    \-

    COALESCE((

        SELECT SUM(amount\_collected)

        FROM PaymentLog

        WHERE customer\_id \= :cust\_id

          AND deleted\_at IS NULL

    ), 0\)

) AS live\_outstanding\_balance;

### Payment Badge Logic (JavaScript)

balance \> 0   → 🔴 Outstanding  → show exact amount e.g. "₹1,850 Due"

balance \= 0   → 🟢 Paid

balance \< 0   → 🟢 Advance     → show credit e.g. "₹200 Credit"

0 \< balance ≤ 200 → 🟡 Partial  → tune threshold per milkman's preference

---

## 5\. Core Business Rules & Lifecycles

### 5.1 Twice-Daily Delivery

| Shift Enum | Value | Label | Auto-detection |
| :---- | :---- | :---- | :---- |
| MORNING | `0` | ☀️ Morning | Device clock hour \< `morning_cutoff_hour` (default 12\) |
| EVENING | `1` | 🌙 Evening | Device clock hour ≥ `morning_cutoff_hour` |

- Each customer can subscribe to Morning, Evening, or both  
- A customer on vacation is skipped for ALL shifts automatically  
- Morning and Evening are independent delivery events — each generates its own DailyDelivery row  
- A customer's `route_sequence` controls order in BOTH shift views

### 5.2 Quantity Adjustment Steps

Four buttons per subscription row. No manual keyboard input:

\[ \-0.50L \]  \[ \-0.25L \]  |  1.50 L  |  \[ \+0.25L \]  \[ \+0.50L \]

- Step sizes are controlled by the `quantity_step` column in Subscriptions (0.25 or 0.5)  
- Minimum deliverable quantity: 0.25L (cannot go below)  
- Float precision fix required in JavaScript: `Math.round((qty + step) * 100) / 100`  
- Adjusted quantity applies to that single delivery only — does not change the default

### 5.3 The 7-Day Edit Window

| Field | Editable within 7 days | Editable after 7 days |
| :---- | :---- | :---- |
| `quantity_delivered` | ✅ Yes | ❌ Locked forever |
| `status` | ✅ Yes | ❌ Locked forever |
| `rate_applied` | ❌ Never editable | ❌ Never editable |
| `product_id` | ❌ Never editable | ❌ Never editable |
| `customer_id` | ❌ Never editable | ❌ Never editable |

**Edit Protocol:**

1. Validate: `delivery_date >= DATE('now', '-7 days')` — if not, reject silently with toast  
2. Append row to `DeliveryAuditLog` with old values and timestamp  
3. Increment `revision_number` on the `DailyDelivery` row  
4. Update `quantity_delivered` and/or `status`  
5. Set `sync_status = 0` (needs re-sync)  
6. Live balance recalculates automatically on next query (no balance update step needed)

**Billing Lock Override:** If the `DailyDelivery` row has `invoice_id` set AND that invoice's `billing_status` is `SHARED`, `SETTLED`, or `LOCKED` — the edit is blocked at the application layer. User must use AdjustmentLog instead.

### 5.4 Invoice Lifecycle

DRAFT

  ↓ (milkman opens billing screen, data is computed)

GENERATED

  ↓ (PDF is created and saved to device)

SHARED

  ↓ (share sheet opened — locked\_at is set HERE, immediately)

SETTLED

  ↓ (milkman marks payment received for this invoice)

LOCKED

    (permanent archive — no further changes possible)

**Regeneration Rule:** While status is `DRAFT` or `GENERATED`, the milkman can tap "Regenerate" at any time. This clears all `InvoiceLineItem` rows for this invoice and recomputes from the live `DailyDelivery` data.

**Hard Lock Rule:** The moment status moves to `SHARED` (share sheet opened), `locked_at` is timestamped. Any `DailyDelivery` row with this `invoice_id` becomes read-only. Future corrections must enter `AdjustmentLog`.

### 5.5 Vacation Logic

- Vacation affects ALL shifts for the affected customer.  
- Vacation status is determined exclusively from the \`VacationSchedules\` table.  
- Customers on vacation appear dimmed and labeled \*\*"On Vacation"\*\* on the route screen.  
- \*\*No \`DailyDelivery\` record is created automatically for vacation days.\*\*  
- Therefore, \`DailyDelivery.status\` only supports \`Delivered\` and \`Skipped\`.  
- If the milkman intentionally delivers during a scheduled vacation, the app may allow a manual override, which creates a normal \`DailyDelivery\` record with status \`Delivered\`.  
- Vacations can be created, edited, or removed from the Customer Detail screen or Settings.  
    
- 

### 5.6 Carry-Forward Outstanding

Because the balance is always computed from the full transaction history with no date filter, carry-forward is automatic and requires zero additional logic. A customer who owed ₹450 at end of May will show that ₹450 as part of their live balance in June — always.

When generating a June invoice, `previous_outstanding` is calculated as:

previous\_outstanding \= live\_balance \- SUM(June DailyDelivery charges)

---

## 6\. Offline Sync State Machine

### State Flow

\[ Record written to SQLite \]

             │

             ▼

     ┌───────────────┐

     │  0: LOCAL     │  Written to device. Not yet queued.

     └───────┬───────┘

             │ Background worker picks it up

             ▼

     ┌───────────────┐

     │  1: PENDING   │  Added to SyncQueue table.

     └───────┬───────┘

             │ Worker locks the row and starts transmission

             ▼

     ┌───────────────┐

     │  2: SYNCING   │  Payload in transit to Supabase.

     └───────┬───────┘

             │

     ┌───────┴────────────────────────┐

     │                                │

     ▼ (Supabase 200 OK)              ▼ (Network timeout / error)

┌──────────────┐               ┌──────────────┐

│  3: SYNCED   │               │  4: FAILED   │

└──────┬───────┘               └──────┬───────┘

       │                              │

       ▼                              ▼

\[Delete SyncQueue row\](Physically DELETE the processed SyncQueue row after successful synchronization.  
Do not soft-delete or archive completed queue entries.  
)    \[Exponential backoff retry\]

                          \[retry\_count++ in SyncQueue\]

                          \[Alert via NotificationQueue

                           after 3 consecutive failures\]

### Conflict Resolution Strategy

This is a **single-device, single-actor** application. Multi-device write conflicts are architecturally impossible in v1.

Resolution rule: **"Local Phone State Always Wins."**

The sync engine pushes device snapshots to Supabase using `UPSERT` operations targeting the record's `entity_uuid`. If a match exists on the server, it is overwritten by the incoming device payload.

### Sync Worker Trigger Conditions

- Device reconnects to WiFi or mobile data  
- App comes to foreground after being backgrounded  
- Manual "Sync Now" tap in Settings  
- Every 15 minutes via a background Capacitor timer (if network available)

---

## 7\. Screen-by-Screen Specifications

### Screen 1 — Login / First-Time Setup

**Flow:**

Enter phone number

     ↓

Receive SMS OTP (via Supabase Auth)

     ↓

Verify OTP

     ↓

\[First login only\] → BusinessProfile setup form

   • Business name (required)

   • Milkman name (required)

   • Phone number (auto-filled from OTP)

   • UPI ID (required — used in invoices)

   • Logo (optional — can skip and add later)

   • Address (optional)

     ↓

Today's Route screen

---

### Screen 2 — Today's Route (Primary / Home Screen)

This is the screen the milkman sees 365 days a year. Every design decision here must be ruthlessly optimized for speed.

**Top Bar:**

\[ ☀️ MORNING (22/35) \]    \[ 🌙 EVENING \]    \[ 🔍 \]

- Active shift auto-selected based on device clock  
- Progress count shown on active tab (delivered / total)  
- Search icon for quickly finding a specific customer mid-route

**Filter Bar (below tabs):**

\[ All \]  \[ 🔴 High Dues \]  \[ ⏳ Pending \]  \[ ✅ Done \]

**Customer Row Layout:**

┌────────────────────────────────────────────────────────┐

│  01  AMIT KUMAR                          🔴 ₹1,850 Due │

│      "Leave at back door"                               │

│  ─────────────────────────────────────────────────────  │

│  🐄 Cow Milk:                                           │

│  \[ \-0.50 \] \[ \-0.25 \]  ← 1.50 L →  \[ \+0.25 \] \[ \+0.50 \]│

│                                                         │

│  \[ ❌  SKIP SHIFT \]    \[ ✓  MARK DELIVERED  \]          │

└────────────────────────────────────────────────────────┘

**Row Visual States:**

| State | Visual Treatment |
| :---- | :---- |
| Pending | White background, full interactive |
| On Vacation | Light gray, auto-collapsed, "🏖 On Vacation" label, no buttons |
| Delivered | Green tint, collapsed, shows "✓ 1.5L delivered" |
| Skipped | Gray, collapsed, shows "❌ Skipped" |

**Interaction Rules:**

- Tapping MARK DELIVERED: Row collapses immediately (≤100ms). DB write happens in background. No spinner shown.  
- DB write fails: Row snaps back to active state with red pulse animation and "Retry" prompt  
- Long-press on a customer row: Opens quick panel for adding non-subscription items (paneer, curd, special orders)  
- Tap customer name: Navigates to Customer Detail screen

**Crash Recovery:** On app reopen during an active delivery run, the route screen reloads and pre-marks all rows that already exist in today's DailyDelivery as Delivered or Skipped — restoring exactly where the milkman left off.

---

### Screen 3 — End-of-Day Summary

Auto-displayed when all rows in the active shift are resolved (delivered or skipped). Also accessible manually from navigation.

┌────────────────────────────────────────────────────────┐

│            📊 END OF DAY SUMMARY                       │

├────────────────────────────────────────────────────────┤

│  ☀️ MORNING                    🌙 EVENING              │

│  Cow Milk: 42.5 / 45.0 L      Cow Milk:  12.0 L       │

│  Buffalo:  28.0 / 28.0 L      Buffalo:   31.5 L       │

│  Skips: 4 households           Skips: 1 household      │

├────────────────────────────────────────────────────────┤

│  💰 FINANCIAL SNAPSHOT                                  │

│  Cash collected:   ₹1,200  (3 receipts)                │

│  UPI cleared:      ₹3,450  (5 receipts)                │

│  Added to balances: \+₹4,890                            │

└────────────────────────────────────────────────────────┘

---

### Screen 4 — Customer Detail

**Header:**

← Amit Kumar                                   \[ ✏️ Edit \]

   📞 9876543210

   House 42, Sector 4

   🔴 ₹1,850 Outstanding

   \[ \+ Add Payment \]  \[ 📄 Generate Invoice \]

**Tab 1 — Delivery History:**

- Month selector at top (defaults to current month)  
- Rows: Date | Shift icon | Product | Quantity | Rate | Amount | Edit icon (if within 7 days, else lock icon)  
- Rows from locked invoices show a lock icon even if within 7 days  
- Edit opens an inline editor: shows original value alongside new input field

**Tab 2 — Payments:**

- All payments sorted newest first: Date | Mode | Amount  
- "Log Payment" button inline at top

**Tab 3 — Subscriptions:**

- Active subscriptions: Morning and Evening slots  
- Edit button per subscription (changes default, rate, step size)  
- Toggle to enable/disable a slot without deleting it  
- "Add Vacation" date range picker

**Tab 4 — Invoices:**

- All generated invoices with status badges  
- Tap to view/regenerate/share

---

### Screen 5 — Add / Edit Customer

**Fields:**

- Name (required)  
- Phone Number (required)  
- Address  
- Route Sequence (required — position in delivery order)  
- Special Notes (shown on every route row)  
- Auto-invoice delivery toggle

**Subscriptions section:**

- Morning: Product selector | Quantity | Rate | Step size (0.25 / 0.5)  
- Evening: Product selector | Quantity | Rate | Step size (0.25 / 0.5)  
- Either slot can be left empty if customer only receives one delivery

**Vacation section:**

- Add vacation range: Start date → End date  
- View and delete existing scheduled vacations

---

### Screen 6 — Month-End Billing

**Entry points:**

- Notification tap on last day of month (8:00 AM)  
- Manual navigation from bottom nav anytime

**Customer Billing List:**

┌────────────────────────────────────────────────────────┐

│  🧾 JUNE 2026 BILLING                    \[ Send All \] │

├────────────────────────────────────────────────────────┤

│  01  Amit Kumar         ₹4,060 Due       \[ ⏳ Send \] │

│  02  Rohan Sharma       ₹0 (Settled)     \[ ✅ Sent \]  │

│  03  Priya Devi         ₹1,200 Due       \[ ❌ Retry \] │

└────────────────────────────────────────────────────────┘

**Send All behavior:**

- Loops through all customers with status ≠ Sent  
- For each: generates PDF → saves to device → opens Android share sheet  
- Milkman taps WhatsApp contact in the share sheet  
- After share sheet closes: status moves to SHARED, logged in Invoice table  
- Invoice sharing is sequential. The application waits for the user to return from the Android Share Sheet before enabling the next share action. Timer-based automation must not be used.

**Invoice status badges:**

- `⏳ Not Sent` — invoice generated, PDF ready  
- `✅ Sent` — share sheet was opened (SHARED status)  
- `❌ Failed` — error during PDF generation or share, retry available  
- `🔒 Locked` — fully settled and archived

---

### Screen 7 — Payment Collection

**Access:** From Customer Detail header OR standalone Payments screen

**Fields:**

- Customer selector (searchable)  
- Amount (numeric input)  
- Mode: \[ Cash \] \[ UPI \] — large toggle buttons  
- Notes (optional)  
- Date (defaults to today, can be changed for backdated receipt logging)

**On confirm:**

- INSERT into PaymentLog  
- Live balance recalculates on next screen load automatically  
- SyncQueue entry created

---

### Screen 8 — Settings

| Section | Contents |
| :---- | :---- |
| My Profile | Business name, milkman name, UPI ID, address, logo upload |
| Products | Add / edit / deactivate products |
| Route Management | Reorder customers via drag-and-drop (updates route\_sequence) |
| Billing | Billing cycle day, default step size, auto-share preference |
| Sync | Last sync timestamp, manual Sync Now button, sync failure log |
| Data & Backup | Export SQLite file, export CSV per table, export ZIP archive of all PDFs |
| About | App version, support contact |

---

## 8\. Invoice Specification

### Invoice Number Format

INV-YYYYMM-\[CUSTOMERID\]-\[SEQUENCE\]

Example: INV-202606-0042-001

### PDF Layout

┌─────────────────────────────────────────────────────────┐

│                                                         │

│  \[ LOGO \]    KRISHNA DAIRY SUPPLIES                     │

│              Statement of Account                       │

│                                                         │

│  Ramesh Sharma              Invoice: INV-202606-0042-01 │

│  📞 \+91 98765 43210         Date: 30 June 2026          │

│  UPI: kdairy@okaxis         Period: 01–30 June 2026     │

│                             Status: 🔴 UNPAID           │

│                                                         │

│  Bill To:                                               │

│  Amit Kumar                                             │

│  House 42, Sector 4                                     │

│                                                         │

├─────────────────────────────────────────────────────────┤

│  Date     Shift    Product       Qty   Rate      Total  │

├─────────────────────────────────────────────────────────┤

│  01 Jun   Morning  Cow Milk    1.50L  ₹65.00   ₹97.50  │

│  01 Jun   Evening  Buffalo     0.50L  ₹80.00   ₹40.00  │

│  02 Jun   Morning  Cow Milk    1.50L  ₹65.00   ₹97.50  │

│  ...                                                    │

├─────────────────────────────────────────────────────────┤

│  Previous Outstanding:               ₹  450.00          │

│  Current Month Charges:              ₹3,860.00          │

│  Payments Received:                  ₹ \-200.00          │

│  Net Adjustments:                    ₹  \-50.00          │

│  ─────────────────────────────────────────────          │

│  TOTAL AMOUNT DUE:                   ₹4,060.00          │

├─────────────────────────────────────────────────────────┤

│  Pay instantly via UPI:                                 │

│  \[ QR CODE \]   kdairy@okaxis                           │

│  upi://pay?pa=kdairy@okaxis\&am=4060\&tn=Milk+Bill+Jun26  │

│                                                         │

│  Thank you for your continued trust. — DoodhWala        │

└─────────────────────────────────────────────────────────┘

### WhatsApp Delivery Protocol

1. jsPDF generates the PDF binary in-memory  
2. Capacitor Filesystem writes the binary to device Documents folder  
3. Capacitor Share triggers the native Android share sheet with the PDF file attached  
4. Milkman taps the customer's WhatsApp contact in the share sheet  
5. WhatsApp opens with the PDF pre-attached  
6. On share sheet close → app marks Invoice status as SHARED → logs timestamp

⚠️ Silent/automated WhatsApp PDF sending is NOT supported by the WhatsApp platform. The milkman must always complete the final tap in the native Android share sheet. This is intentional and correct behavior — it gives the milkman review control.

---

## 9\. Key SQL Queries Reference

All 14 operations the app needs. No implementation code — pure SQL logic for the IDE phase.

**Q1 — Today's Morning Route (with vacation check and crash recovery):** Join Customers \+ Subscriptions (shift=0) \+ LEFT JOIN VacationSchedules (BETWEEN today) \+ LEFT JOIN DailyDelivery (today, shift=0). Filter `is_active=1, deleted_at IS NULL`. Order by `route_sequence ASC`.

**Q2 — Today's Evening Route:** Same as Q1 but `delivery_shift = 1` throughout.

**Q3 — Insert a delivery:** INSERT into DailyDelivery with customer\_id, sub\_id, product\_id, today's date, shift, quantity, rate (frozen from subscription), status='Delivered'. Add row to SyncQueue.

**Q4 — Live outstanding balance for one customer:** Runtime computation query from Section 4\. No join to Customers needed.

**Q5 — Live outstanding balance for ALL customers (route screen batch load):** Same formula as Q4 but wrapped in a subquery or CTE with GROUP BY customer\_id to compute all balances in one pass. Avoid running Q4 individually per customer in a loop.

**Q6 — Customer delivery history (current month):** Join DailyDelivery \+ Products WHERE customer\_id=? AND delivery\_date BETWEEN first-of-month AND today. Include `CASE WHEN delivery_date >= DATE('now','-7 days') THEN 1 ELSE 0 END AS is_editable` and check invoice lock status. Order by delivery\_date DESC.

**Q7 — Edit a delivery record (7-day window):** Step 1: INSERT row into DeliveryAuditLog (old values). Step 2: UPDATE DailyDelivery SET quantity\_delivered=new, revision\_number=revision\_number+1, sync\_status=0, updated\_at=NOW WHERE ledger\_id=? AND delivery\_date \>= DATE('now','-7 days') AND invoice lock check passes.

**Q8 — Month-end billing screen summary:** Join Customers \+ SUM of current-month DailyDelivery grouped by customer\_id \+ LEFT JOIN Invoice (current month) for send\_status. Compute live\_balance per customer via subquery. Order by route\_sequence.

**Q9 — Full itemized invoice data for one customer:** Join DailyDelivery \+ Products WHERE customer\_id=? AND delivery\_month=? AND status='Delivered'. Also fetch PaymentLog for same month. Also fetch AdjustmentLog for same month.

**Q10 — Insert invoice and snapshot line items:** Step 1: INSERT Invoice header row. Step 2: For each DailyDelivery row in the month, INSERT InvoiceLineItem with a snapshot of product\_display\_name (denormalized). Step 3: UPDATE DailyDelivery SET invoice\_id \= new invoice\_id for all affected rows.

**Q11 — Log a payment:** INSERT PaymentLog. Add to SyncQueue. Balance recalculates automatically on next Q4/Q5 run.

**Q12 — All unsynced records (sync worker input):** SELECT from SyncQueue WHERE status='QUEUED' ORDER BY created\_at ASC LIMIT 50 (batch size).

**Q13 — Mark records as synced:** UPDATE SyncQueue SET status='QUEUED' → 'PROCESSING' before transmit. After 200 OK: DELETE FROM SyncQueue WHERE sync\_id=?. UPDATE corresponding entity table SET sync\_status=3.

**Q14 — Customer full ledger (history tab):** All DailyDelivery rows \+ PaymentLog rows \+ AdjustmentLog rows \+ Invoice headers for the customer. Sorted by date descending.

---

## 10\. UML & System Diagrams

### Entity Relationship Summary

BusinessProfile (1)

     │ (used for invoice header generation)

Products (many)

     │

     ├──────────────────────────────────┐

     │                                  │

Customers (many)                        │

     │                                  │

     ├── Subscriptions (many) ←─────────┘

     │       delivery\_shift: 0=Morning / 1=Evening

     │       default\_quantity, custom\_rate, quantity\_step

     │

     ├── VacationSchedules (many)

     │       start\_date to end\_date

     │

     ├── DailyDelivery (many) ←───── Products, Subscriptions, Invoice

     │       delivery\_shift: 0 or 1

     │       One row per customer per product per shift per day

     │       → DeliveryAuditLog (every edit appended here)

     │

     ├── PaymentLog (many)

     │       Cash or UPI, amount, date

     │       Optional link to Invoice

     │

     ├── AdjustmentLog (many)

     │       CREDIT or DEBIT, reason mandatory

     │       Used only after invoice is locked

     │

     └── Invoice (many)

             One per customer per billing month

             → InvoiceLineItem (snapshot of each delivery)

AppSettings (1)            — global config

NotificationQueue (many)   — scheduled alerts

SyncQueue (many)           — pending cloud sync operations

### Delivery Sequence Diagram (Optimistic UI)

Milkman          Vue 3 UI Layer         SQLite           SyncQueue

   │                    │                  │                  │

   │  Taps Delivered    │                  │                  │

   ├───────────────────►│                  │                  │

   │                    │ Optimistic update│                  │

   │                    │ (row collapses   │                  │

   │                    │  instantly \~16ms)│                  │

   │                    ├──────────────────►                  │

   │                    │ INSERT DailyDelivery                │

   │                    │                  │ INSERT SyncQueue │

   │                    │                  ├─────────────────►│

   │                    │ DB Confirmed     │                  │

   │                    │◄─────────────────┤                  │

   │                    │                  │                  │

   │         \[DB FAIL PATH\]                │                  │

   │                    │ Rollback optimistic state           │

   │                    │ Show red toast                      │

   │◄───────────────────┤                  │                  │

### Invoice Billing State Diagram

┌─────────┐   milkman opens    ┌───────────┐   PDF saved    ┌──────────┐

│  DRAFT  │──────────────────► │ GENERATED │──────────────► │  SHARED  │◄── locked\_at set

└─────────┘   billing screen   └───────────┘  to device     └────┬─────┘

                                                                  │

                                                            payment logged

                                                                  │

                                                                  ▼

                                                           ┌──────────┐   archived   ┌────────┐

                                                           │ SETTLED  │─────────────►│ LOCKED │

                                                           └──────────┘              └────────┘

### Daily Shift Activity Diagram

\[ App opens \]

      │

      ▼

\[ Read device clock \]

      │

      ├─ Hour \< morning\_cutoff\_hour (12) ──► shift \= 0 (MORNING)

      └─ Hour ≥ morning\_cutoff\_hour       ──► shift \= 1 (EVENING)

      │

      ▼

\[ Query: Customers \+ Subscriptions(shift) \+ Vacations \+ Today's DailyDelivery \]

      │

      ▼

\[ For each customer row: \]

      │

      ├─ vacation matched? ──► Show dimmed "On Vacation" row (no buttons)

      │

      ├─ no active subscription for this shift? ──► Hide row entirely

      │

      └─ active subscription exists:

              │

              ▼

         \[ Render row with default quantity \]

              │

         \[ Milkman adjusts? \] ──NO──► Keep default

              │ YES

              ▼

         \[ Redraw quantity via ±0.25 / ±0.5 buttons \]

              │

              ▼

         \[ MARK DELIVERED tapped \]

              │

              ▼

         \[ Optimistic UI collapse \+ Background SQLite write \+ SyncQueue \]

              │

      ├─ More customers? ──► Next row

      └─ All resolved? ──► Show End-of-Day Summary

---

## 11\. Development Order

Follow this sequence strictly. Do not begin the next phase until the current phase is fully tested offline.

| Phase | Task | Key Deliverable |
| :---- | :---- | :---- |
| **1** | Design all screens in Google Stitch | Complete UI mockup with all states |
| **2** | Initialize Capacitor project \+ SQLite plugin | Project scaffold runs on Android emulator |
| **3** | Run all 14 CREATE TABLE statements | Database file created on device |
| **4** | Build Today's Route screen (read-only, dummy data) | Route list renders correctly |
| **5** | Implement Mark Delivered (optimistic UI \+ SQLite write) | Core delivery logging works |
| **6** | Implement Skip and Vacation detection | All row states work |
| **7** | Implement quantity ± buttons | Step adjustment works |
| **8** | Build Customer Detail screen (history \+ edit) | 7-day edit window with audit log |
| **9** | Build Payment logging | Payments enter PaymentLog, balance recalculates |
| **10** | Implement runtime balance computation | 🔴🟡🟢 badges correct on route screen |
| **11** | Build Month-End Billing screen | Customer list with computed totals |
| **12** | Implement PDF generation (jsPDF) | Invoice PDF renders correctly |
| **13** | Implement WhatsApp share flow | PDF attaches and opens share sheet |
| **14** | Implement Invoice lifecycle \+ locking | Status transitions work, locked rows uneditable |
| **15** | Build SyncQueue \+ Supabase integration | Background sync works, milkman unaware |
| **16** | Add local notifications | Month-end reminder fires on last day |
| **17** | Add Settings screen (profile, products, backup) | Configuration and export work |
| **18** | Offline stress test | App survives full delivery run with airplane mode on |
| **19** | Billing edge case test | Carry-forward, adjustments, locked invoice corrections |
| **20** | Play Store submission | Production APK |

---

## 12\. Conflicts Resolved Between Source Documents

The following decisions were in conflict between the two source documents. The resolution and rationale are documented here for clarity.

| Topic | Document 1 | Document 2 | Resolution | Rationale |
| :---- | :---- | :---- | :---- | :---- |
| Balance storage | Stored `balance_amount` column on Customers | No stored balance — computed at runtime | **Runtime computed** | Eliminates balance drift bugs. Trivially correct. Acceptable perf at this scale. |
| Quantity step | Not mentioned | Not mentioned | **Added `quantity_step` to Subscriptions** | Required for the ±0.25 / ±0.5 button behavior to be per-customer |
| Shift representation | Integer enum (0/1) preferred | TEXT ('Morning'/'Evening') in some places | **Integer enum 0/1** | Avoids typo bugs, uses less storage, consistent |
| NotificationQueue | Not present | Present | **Included** | Needed for month-end reminders and sync failure alerts |
| AdjustmentLog | Present — correct usage defined | Present — correct usage defined | **Kept as-is** | Both documents agree. Never use PaymentLog for adjustments. |
| Table count | 13 tables | 13+ tables (with NotificationQueue) | **14 tables final** | NotificationQueue added, AppSettings updated with new columns |
| Invoice number format | INV-YYYYMM-CUSTOMERID-SEQUENCE | Same | **Kept** | Clean, unique, human-readable |

---

## 13\. Features Deferred to Future Versions

These features were discussed and deliberately excluded from v1. Do not implement them until real-user testing validates the need.

| Feature | Reason Deferred |
| :---- | :---- |
| Customer-facing mobile app | Out of scope for v1. Single-actor system by design. |
| GPS route tracking | Adds hardware complexity, not needed for accounting |
| AI demand forecasting | No historical data until v1 runs for several months |
| Employee/delivery-boy sub-accounts | Family business complexity — v2 |
| Multi-device sync editing | Single-device architecture by design in v1 |
| Inventory management | Beyond scope of a Khata replacement |
| GST report generation | `gst_number` column reserved in BusinessProfile for future use |
| Marketplace / customer ordering | Fundamentally different product, not this app |
| Silent background WhatsApp sending | Not supported by WhatsApp platform — will never be v1 |
| Customer balance enquiry bot | WhatsApp Business API required — significant complexity |

---

*Document Version: 1.0 — Architecture Freeze* *Source documents synthesized: Blueprint & Specification Document \+ Final Project Specification v1.0* *Status: Ready for Google Stitch UI Design → Cursor / Google Antigravity Implementation* *Last updated: June 2026*  
