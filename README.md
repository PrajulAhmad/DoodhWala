# 🥛 DoodhWala — Digital Khata for the Indian Milkman

> *Replacing the paper ledger with a fast, offline-first Android app. Built for one hand at 5 AM.*

[![Vue 3](https://img.shields.io/badge/Vue-3-4FC08D?logo=vue.js&logoColor=white)](https://vuejs.org/)
[![Capacitor](https://img.shields.io/badge/Capacitor-8-119EFF?logo=capacitor&logoColor=white)](https://capacitorjs.com/)
[![Supabase](https://img.shields.io/badge/Supabase-Cloud%20Sync-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![SQLite](https://img.shields.io/badge/SQLite-Offline%20First-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 📖 Overview

**DoodhWala** is an offline-first Android application designed for individual neighborhood milkmen in India. It digitizes the traditional paper *Khata* (ledger notebook) into a fast, reliable, and automated accounting system.

The milkman is on a moving vehicle at 5:00 AM with one hand occupied. **Every design decision in this app is evaluated against one question:**

> *"Does this require the milkman to stop and think?"* — If yes, redesign it.

### Three Non-Negotiable Principles

| Principle | Description |
|-----------|-------------|
| **Zero-Friction Utility** | Massive touch targets. High contrast. Zero keyboard input during the delivery run. |
| **Single-Actor System** | Built strictly for the milkman vendor — no customer app, no marketplace layer. |
| **Passive Customer Interface** | Customer interaction happens via professional PDFs shared through WhatsApp. The customer never downloads anything. |

---

## ✨ Features

- **📍 Route Screen** — Ordered customer list for Morning ☀️ and Evening 🌙 delivery shifts. Auto-detects shift from device clock. One-tap mark as Delivered or Skipped.
- **⚡ Quantity Adjustment** — `±0.25L / ±0.5L` buttons per subscription. No keyboard. No friction.
- **🏖️ Vacation Management** — Schedule customer vacations in advance. App automatically skips them — no manual intervention required on the day.
- **💰 Live Balance Ledger** — Outstanding balance computed in real-time from the full transaction history. No stored cache. No drift. Always accurate.
- **🧾 Invoice Generation** — Atomic, month-end PDF invoices with itemized delivery history. Supports DRAFT → GENERATED → SHARED → SETTLED → LOCKED lifecycle.
- **📤 WhatsApp Sharing** — Sequential one-by-one invoice sharing via the native Android Share Sheet. No automation delays or race conditions.
- **💳 Payment Logging** — Record Cash and UPI payments against customer accounts.
- **🔧 Adjustment Log** — Post-invoice financial corrections (CREDIT/DEBIT) without breaking historical invoice integrity.
- **☁️ Cloud Backup** — Background sync to Supabase with per-user Row Level Security. Works offline; syncs when internet is available.
- **🔔 Smart Notifications** — Month-end billing reminders at 8:00 AM. Sync failure and share retry alerts.
- **🔐 Phone OTP Auth** — Supabase-powered authentication. No passwords to remember.

---

## 🏗️ Tech Stack

| Layer | Technology | Role |
|-------|------------|------|
| **Mobile Shell** | Capacitor.js 8 | Wraps Vue app into a native Android APK |
| **UI Framework** | Vue 3 | Reactive local state, instant UI transitions |
| **Local Database** | `@capacitor-community/sqlite` | Offline-first SQLite on device hardware storage |
| **Cloud** | Supabase (PostgreSQL) | Auth, cloud backup, Row Level Security |
| **PDF Generation** | jsPDF | Client-side PDF — no server required |
| **File Storage** | `@capacitor/filesystem` | Saves PDFs to device storage |
| **Sharing** | `@capacitor/share` | Native Android Share Sheet for WhatsApp |
| **Notifications** | `@capacitor/local-notifications` | Scheduled billing reminders |
| **Build Tool** | Vite 8 | Fast development and production builds |

---

## 🏛️ Architecture

```
MILKMAN'S ANDROID DEVICE
┌──────────────────────────────────────────┐
│  Vue 3 UI (via Capacitor WebView)        │
│       │                                  │
│       ▼  reads & writes instantly        │
│  SQLite Database (14 tables)             │
│       │                                  │
│       ▼  on every write                  │
│  SyncQueue Table (tracks unsynced rows)  │
└──────────┬───────────────────────────────┘
           │  background worker, only when online
           ▼
SUPABASE CLOUD
┌──────────────────────────────────────────┐
│  PostgreSQL mirror of local schema       │
│  + milkman_uuid on every table           │
│  + Row Level Security (per-user data     │
│    isolation enforced at DB level)       │
└──────────────────────────────────────────┘
```

### Database — 14 Tables

| # | Table | Purpose |
|---|-------|---------|
| 1 | `AppSettings` | Hardware-level config (step size, theme, billing cycle day) |
| 2 | `BusinessProfile` | Milkman's business identity printed on every invoice |
| 3 | `Products` | Catalog of milk types (Cow, Buffalo, etc.) |
| 4 | `Customers` | Customer directory with route ordering |
| 5 | `Subscriptions` | Default daily delivery agreements per customer per shift |
| 6 | `VacationSchedules` | Scheduled delivery pauses |
| 7 | `DailyDelivery` | Atomic delivery log — the heart of the system |
| 8 | `DeliveryAuditLog` | Immutable history of every delivery edit |
| 9 | `PaymentLog` | Cash and UPI payments received |
| 10 | `AdjustmentLog` | Post-invoice financial corrections (CREDIT/DEBIT) |
| 11 | `Invoice` | Month-end invoice headers |
| 12 | `InvoiceLineItem` | Frozen delivery snapshots per invoice |
| 13 | `NotificationQueue` | Scheduled and retry-pending notification events |
| 14 | `SyncQueue` | Resumable cloud synchronization queue |

> **Currency Rule:** All monetary values are stored as `INTEGER` paise (e.g., ₹65.50 → `6550`). Conversion to rupees happens only in the UI and PDFs. This eliminates floating-point rounding errors in financial calculations.

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Android Studio](https://developer.android.com/studio) (for building the APK)
- [Supabase](https://supabase.com/) project (for cloud sync and auth)
- Java 17+ (for Android build toolchain)

### 1. Clone the Repository

```bash
git clone https://github.com/PrajulAhmad/DoodhWala.git
cd DoodhWala
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` with your Supabase project credentials:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key-here
```

### 4. Set Up the Supabase Database

Run the migration file in your Supabase SQL editor:

```bash
# File: supabase/migrations/001_initial_schema.sql
```

Go to your [Supabase Dashboard](https://app.supabase.com) → SQL Editor → paste and run the contents of `supabase/migrations/001_initial_schema.sql`.

### 5. Run in Browser (Development)

```bash
npm run dev
```

> Note: SQLite and native Capacitor plugins are only available in the Android build. The browser dev build uses a fallback for UI development.

### 6. Build and Run on Android

```bash
# Build the web assets
npm run build

# Sync to Android project
npx cap sync android

# Open in Android Studio
npx cap open android
```

Then use Android Studio to build the APK and run it on a device or emulator.

---

## 📁 Project Structure

```
DoodhWala/
├── src/
│   ├── components/          # Vue screen components
│   │   ├── RouteScreen.vue      # Morning/Evening delivery run
│   │   ├── CustomersScreen.vue  # Customer directory
│   │   ├── CustomerDetail.vue   # Customer profile & history
│   │   ├── BillingScreen.vue    # Invoice generation & sharing
│   │   ├── SettingsScreen.vue   # App & business settings
│   │   └── LoginScreen.vue      # Phone OTP authentication
│   ├── services/            # Business logic layer
│   │   ├── db.js                # All SQLite queries & schema
│   │   ├── auth.js              # Supabase authentication
│   │   ├── sync.js              # Offline sync state machine
│   │   ├── pdf.js               # Invoice PDF generation
│   │   └── notifications.js     # Local notification scheduling
│   ├── App.vue              # Root component & navigation
│   ├── main.js              # App entry point
│   ├── config.js            # Global configuration constants
│   └── style.css            # Design system & global styles
├── supabase/
│   ├── migrations/
│   │   └── 001_initial_schema.sql  # Full PostgreSQL schema with RLS
│   └── README.md            # Supabase setup instructions
├── android/                 # Capacitor Android project (generated)
├── public/                  # Static assets
├── capacitor.config.json    # Capacitor app configuration
├── vite.config.js           # Vite build configuration
├── .env.example             # Environment variable template
├── DESIGN.md                # Design system documentation
├── SCREENS.md               # Screen-by-screen UI specifications
└── DoodhWala_Master_Specification_v1.0.md  # Full project specification
```

---

## 🎨 Design System

The UI is engineered for **utility and resilience** — optimized for a milkman performing physical labor in variable outdoor lighting, specifically the transition from pre-dawn darkness to direct morning sunlight.

- **Color Theme:** High-contrast light mode. Primary green `#0D631B`. Near-black text on cool-gray surface `#F7FAFC`.
- **Typography:** [Inter](https://fonts.google.com/specimen/Inter) — tall x-height, minimum 14px, Medium (500) weight for outdoor legibility.
- **Touch Targets:** Strict **48px minimum** for all interactive elements. Wet hands and motion are design constraints.
- **Layout:** Critical controls (quantity pickers, action buttons) in the **lower 60% of screen** for one-handed thumb reach.

---

## 🔑 Key Design Decisions

These architectural decisions are frozen and must not be changed without versioning the specification:

1. **No Stored Balance** — Outstanding balance is always computed live from transaction history. Never cached. Never drifts.
2. **Paise-as-Integer** — All money stored as integer paise. Zero floating-point errors.
3. **Vacation = No Record** — Vacation days do not generate `DailyDelivery` rows. Absence is intentional.
4. **Sequential Invoice Sharing** — No timer-based auto-share. Each invoice waits for the user to complete the Android Share Sheet before proceeding.
5. **Atomic Invoice Generation** — Invoice creation is a single database transaction. All-or-nothing. No partial invoices.
6. **Soft Deletes** — Records are never permanently destroyed. `deleted_at` timestamp preserves complete history.
7. **Dual ID Strategy** — Every entity has a local `INTEGER` id (for fast JOIN queries) and a `TEXT` UUID (for collision-free cloud sync). Never mix the two.

---

## ☁️ Offline Sync

The app functions completely offline. Every write to SQLite is tracked in `SyncQueue`. A background worker uploads queued records to Supabase whenever internet connectivity is detected.

**Sync States:**
```
0 = LOCAL_ONLY   → Written to device, not yet queued
1 = PENDING_SYNC → Added to SyncQueue
2 = SYNCING      → Currently transmitting to Supabase
3 = SYNCED       → Confirmed by Supabase (200 OK)
4 = FAILED       → Error, awaiting retry
```

Processed queue entries are physically deleted after a successful sync (not archived). Each milkman's cloud data is isolated by `milkman_uuid` with Row Level Security enforced at the PostgreSQL level.

---

## 📄 Invoice Lifecycle

```
DRAFT → GENERATED → SHARED → SETTLED → LOCKED
```

| Status | Description |
|--------|-------------|
| `DRAFT` | Invoice computed, not yet finalized |
| `GENERATED` | PDF created and saved to device |
| `SHARED` | Share sheet opened — **hard lock applied at this moment** |
| `SETTLED` | Payment received and recorded |
| `LOCKED` | Permanent archive — no further changes possible |

Once an invoice reaches `SHARED`, all linked `DailyDelivery` rows become read-only. Any post-lock corrections must use `AdjustmentLog`.

---

## 🤝 Contributing

This project follows a specification-driven development model. Before making any changes:

1. Read `DoodhWala_Master_Specification_v1.0.md` — it is the single source of truth.
2. Do **not** modify the database schema, sync strategy, or accounting model without versioning the specification document first.
3. All monetary values in the database must remain as `INTEGER` paise.

---

## 📜 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  Built with ☕ for the milkmen of India.
</p>
