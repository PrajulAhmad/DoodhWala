# DoodhWala — Supabase Setup Guide

This guide walks you through setting up the Supabase backend for DoodhWala.
The app works fully offline without this — Supabase is only needed for cloud backup and the OTP login flow.

---

## Step 1 — Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in
2. Click **New Project**
3. Choose a name (e.g. `doodhwala`), region (prefer India: `ap-south-1`), and a strong database password
4. Wait ~2 minutes for the project to provision

---

## Step 2 — Enable Phone Auth (OTP)

1. In your Supabase project, go to **Authentication → Providers**
2. Find **Phone** and toggle it ON
3. You need an SMS provider. The easiest options:
   - **Twilio** (recommended): Create a free account at [twilio.com](https://twilio.com), get an Account SID, Auth Token, and a Messaging Service SID
   - **MessageBird** (alternative)
4. Enter your Twilio credentials in the Phone provider settings
5. Save

> **Testing without real SMS:** Supabase lets you test with phone number `+15555555555` and OTP `123456` in development. Or use the app's **"Skip Login (Dev Mode)"** button which appears in development builds.

---

## Step 3 — Run the Database Migration

1. In your Supabase project, go to **SQL Editor → New Query**
2. Copy the entire contents of [`migrations/001_initial_schema.sql`](./migrations/001_initial_schema.sql)
3. Paste it into the SQL editor
4. Click **Run**
5. You should see: `Success. No rows returned.`

This creates all 13 cloud tables with Row Level Security enabled. Each milkman only ever sees their own data.

---

## Step 4 — Get Your API Credentials

1. Go to **Settings → API** in your Supabase dashboard
2. Copy two values:
   - **Project URL** (e.g. `https://abcdefgh.supabase.co`)
   - **anon public key** (the `eyJhbGci...` key — this is safe to use in the app)
3. **Do NOT use the `service_role` key** in the app — that bypasses RLS

---

## Step 5 — Configure and Build the App

As the developer, you configure the Supabase backend credentials at build-time so they are securely baked into the app:

1. In the project root directory, copy the template configuration file:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` and fill in:
   - `VITE_SUPABASE_URL`: Your project URL from Step 4
   - `VITE_SUPABASE_ANON_KEY`: Your anon public key from Step 4
3. Save the file.
4. When you build the app (`npm run build`), Vite will automatically embed these credentials.
5. The milkman can now launch the app, enter their phone number, and log in directly via SMS OTP without seeing or configuring any database URLs.


---

## Row Level Security (RLS) — How It Works

Every table has a policy like:

```sql
CREATE POLICY "milkman_owns_customers"
    ON "Customers" FOR ALL
    USING (owner_uuid = auth.uid());
```

This means:
- When the app sends data to Supabase, it uses your **JWT access token** (obtained after OTP verification)
- Supabase's `auth.uid()` extracts your user UUID from that JWT automatically
- **No milkman can ever see another milkman's data** — even if they know the table name

---

## Data Architecture

| Where | What |
|-------|------|
| **Local SQLite** | Primary source of truth. Works offline. All 14 tables. |
| **Supabase PostgreSQL** | Cloud backup/mirror. 13 tables (AppSettings is local-only). |
| **Sync direction** | **One-way: Device → Cloud** (via SyncQueue). Never overwrites device data from cloud. |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| OTP not received | Check Twilio credentials in Supabase → Authentication → Providers → Phone |
| Sync fails | Ensure Supabase URL and Anon Key are correct in Settings |
| "403 Forbidden" on sync | Your JWT may have expired. Log out and log in again via OTP |
| Tables not found | Re-run `001_initial_schema.sql` in SQL Editor |
| Can't see data in Table Editor | This is expected — RLS blocks even the dashboard unless you use the service_role key |

To view data in the dashboard as admin:
1. Go to **Table Editor**
2. Click the table name
3. In the top-right, toggle **"RLS disabled for administrators"** to temporarily bypass RLS
