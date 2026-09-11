# Running Majestronicz ERP (Full-Stack)

Two processes: **backend** (Express + Prisma + PostgreSQL, port 4000) and **frontend** (Vite + React, port 5173).

## One-time setup
```bash
# 1. PostgreSQL (already installed via Homebrew). Ensure it's running:
brew services start postgresql@16
#    Database "majestronicz" already exists. To create fresh:  createdb majestronicz

# 2. Backend deps + schema + seed
cd backend
npm install
npx prisma generate
npx prisma db push        # creates tables (or: npx prisma migrate dev)
npm run seed              # loads demo data into Postgres

# 3. Frontend deps
cd ..
npm install
```

## Start the app (two terminals)
```bash
# Terminal 1 — backend API
cd backend && npm run dev            # http://localhost:4000

# Terminal 2 — frontend
npm run dev                          # http://localhost:5173
```
Open **http://localhost:5173**. Data loads live from Postgres; changes by any logged-in
user propagate to all other open sessions within ~0.5s (Server-Sent Events).

## Roles / PIN login
Click **"Switch Role / Enter PIN"** (sidebar). PINs are verified server-side; the
issued token authorizes actions — a role cannot perform a blocked action even via a
direct API call.

| Role | PIN | Can access |
|------|-----|-----------|
| CEO | 1111 | Everything (incl. payroll disbursement, demo reset) |
| Manager | 2222 | Everything for their branch except CEO-only payroll/reset |
| Billing | 3333 | Sales, Quotes, Challans, Customers, Cash Register, Enquiries, Inventory, Barcode (Item Master read-only) |
| Purchase | 4444 | Purchases + Items/Inventory view + Enquiries/Pending Orders *(default scope — adjust in `backend/src/lib/auth.ts` → `ROLE_CAPS.Purchase` + `ROLE_VIEWS.Purchase`)* |
| Sales | 5555 | Items (view) + Enquiries only |

## Useful
- **Reset demo data** (CEO only): sidebar "Reset Demo Data" → `POST /api/admin/reseed`, or `cd backend && npm run seed`.
- **Inspect DB**: pgAdmin → connect `localhost:5432`, db `majestronicz`, user `postgres` (no password). Or `cd backend && npx prisma studio`.
- **Production build**: `npm run build` (frontend), `cd backend && npm run build && npm start`.

## Config
- `backend/.env` — `DATABASE_URL`, `PORT`, `AUTH_SECRET` (change in production).
- `.env` (frontend) — `VITE_API_URL` (defaults to `http://localhost:4000`).
