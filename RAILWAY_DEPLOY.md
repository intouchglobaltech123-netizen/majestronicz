# Deploying Majestronicz to Railway

This app deploys as **one Railway web service** (the Express backend serves both the
API and the built React frontend) plus a **Railway PostgreSQL** database.

The repo already contains everything Railway needs:
- `Dockerfile` — builds the frontend + backend into one image.
- `railway.json` — tells Railway to build with the Dockerfile.
- Backend serves the frontend and runs `prisma db push` on boot.
- On the very first boot with an empty database, a starter dataset is seeded
  automatically (categories, units, tax slabs, settings, the 5 login accounts,
  and demo records) so the app works immediately.

## Steps

1. **Push the code to GitHub** (this branch or `main`).

2. **Create the project on Railway**
   - railway.app → **New Project** → **Deploy from GitHub repo** → pick this repo.
   - Railway detects `railway.json` and builds using the `Dockerfile`.

3. **Add PostgreSQL**
   - In the project: **New** → **Database** → **PostgreSQL**.

4. **Set the service variables** (app service → **Variables**):
   - `DATABASE_URL` = reference the database: `${{Postgres.DATABASE_URL}}`
     (type `${{` and Railway will autocomplete the Postgres service).
   - `AUTH_SECRET` = a long random string (used to sign login tokens).
   - *(optional, AI)* leave unset to keep Beta AI in "not connected" mode, or set
     `AI_PROVIDER`, `OLLAMA_URL`/`OLLAMA_MODEL`, or `GROQ_API_KEY`.
   - **Do not** set `PORT` — Railway injects it automatically.
   - `VITE_API_URL` is **not** needed — the frontend calls the API on the same origin.

5. **Deploy** — Railway builds and starts the service. Watch the deploy logs for:
   - `Fresh database seeded with starter dataset.` (first deploy only)
   - `Serving frontend from …`
   - `Majestronicz backend listening on …`

6. **Get your URL** — service → **Settings** → **Networking** → **Generate Domain**.
   Open it and log in with the CEO PIN **1111** (then create staff accounts and
   change PINs from **Access Control**).

## Notes
- **Schema changes**: `prisma db push` runs on every boot and syncs the schema
  automatically. No manual migration step needed.
- **Starting empty instead of demo data**: set `SEED_ON_EMPTY=false` in Variables
  before the first deploy. You'll then need to add your own categories/units, etc.
- **Backups**: enable backups on the Railway Postgres plugin for production data.
- **Health check**: `GET /api/health` returns `{ "status": "ok" }`.
