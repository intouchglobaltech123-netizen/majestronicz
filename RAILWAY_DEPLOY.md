# Deploying Majestronicz (UI on Vercel, Backend + DB on Railway)

Two hosts, three logical pieces:

```
   Vercel                         Railway
┌───────────────┐   HTTPS   ┌──────────────────┐     ┌──────────────┐
│  UI (Vite)     │ ────────▶ │  Backend API      │────▶│  PostgreSQL   │
│  static build  │  API      │  (Docker service) │     │  (Railway DB) │
└───────────────┘           └──────────────────┘     └──────────────┘
```

Deploy the **backend first** (so you have its URL), then the **UI**.

---

## Part A — Backend + Postgres on Railway

1. **New Project → Deploy from GitHub repo →** pick `majestronicz`.
2. Open the created service → **Settings**:
   - **Source → Branch** = `arul_backend` (or `main` after merging).
   - **Root Directory** = `backend`  ← important: builds only the backend.
   - It then uses `backend/railway.json` → `backend/Dockerfile` automatically.
3. **New → Database → PostgreSQL** (in the same project).
4. Backend service → **Variables**:
   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | type `${{` → pick **Postgres.DATABASE_URL** |
   | `AUTH_SECRET` | a long random string |
   - Do **not** set `PORT` (Railway injects it).
5. Deploy. In logs look for `Fresh database seeded…`, then `listening on…`.
6. **Settings → Networking → Generate Domain**. Copy this URL, e.g.
   `https://majestronicz-backend.up.railway.app` — you need it for Vercel.
7. Test it: open `<that URL>/api/health` → should return `{"status":"ok"}`.

## Part B — UI on Vercel

1. Vercel → **Add New → Project** → import `majestronicz`.
2. **Root Directory** = leave as repo root (`.`). Framework auto-detects **Vite**
   (config is in `vercel.json`).
3. **Environment Variables** → add:
   | Name | Value |
   |---|---|
   | `VITE_API_URL` | the Railway backend URL from A-6 (no trailing slash) |
4. **Deploy**. Open the Vercel URL and log in with CEO PIN **1111**.

---

## Notes
- **CORS**: the backend allows all origins, so the Vercel UI can call it out of the
  box. (Auth uses Bearer tokens, not cookies, so this is safe.)
- **`VITE_API_URL` is baked at build time** — if you change the backend URL later,
  redeploy the Vercel project so the new value is compiled in.
- **Schema**: `prisma db push` runs on every backend boot; no manual migrations.
- **First boot** seeds a starter dataset (lists, settings, the 5 logins, demo data).
  Set `SEED_ON_EMPTY=false` on the backend to start blank instead.
- **Beta AI** shows "not connected" unless you set an AI engine env var on the backend.
- Enable **backups** on the Railway Postgres for production data.
