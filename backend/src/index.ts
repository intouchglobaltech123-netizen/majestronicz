import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import apiRoutes from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { attachUser } from './middleware/rbac.js';

const app = express();

// CORS: restrict to an allowlist when CORS_ORIGINS is set (comma-separated),
// otherwise allow all (dev). Auth is Bearer-token based (no cookies), so this is
// the main cross-origin control.
const allowlist = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors(allowlist.length ? {
  origin: (origin, cb) => cb(null, !origin || allowlist.includes(origin)),
} : undefined));

// Baseline security headers.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  next();
});

app.use(express.json({ limit: '25mb' })); // base64 photos/attachments can be large

app.use(attachUser); // parse Bearer token → req.user (RBAC enforced per-route)
app.use('/api', apiRoutes);

// ---- Serve the built frontend (production single-service deploy) ----
// In production (Railway) the Vite build is served by this same server, so the
// SPA and API share one origin (no CORS, API calls are relative). Skipped in
// local dev where Vite serves the frontend on :5173.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist =
  process.env.FRONTEND_DIST || path.resolve(__dirname, '../../dist'); // repo/dist
if (fs.existsSync(path.join(frontendDist, 'index.html'))) {
  app.use(express.static(frontendDist));
  // SPA fallback for any non-API route.
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(frontendDist, 'index.html')));
  console.log(`Serving frontend from ${frontendDist}`);
}

// Central error handler (must be last).
app.use(errorHandler);

const port = Number(process.env.PORT ?? 4000);
app.listen(port, async () => {
  console.log(`Majestronicz backend listening on http://localhost:${port}`);
  // Load the dynamic access-control matrix into the RBAC cache.
  try {
    // First-boot: seed the starter dataset if the database is empty (rewrites
    // config, so this must run before the ensure* calls below).
    const { ensureSeedData } = await import('./services/reseed.service.js');
    if (await ensureSeedData()) console.log('Fresh database seeded with starter dataset.');
    const { ensureAccessMatrix, migrateAccessMatrix } = await import('./services/access.service.js');
    await ensureAccessMatrix();
    await migrateAccessMatrix();
    console.log('Access-control matrix loaded.');
    const { ensureUsers, migrateUserPins, provisionUserEmployees } = await import('./services/user.service.js');
    await ensureUsers();
    const migrated = await migrateUserPins();
    const linked = await provisionUserEmployees();
    console.log(`Staff accounts ready.${migrated ? ` Secured ${migrated} legacy PIN(s).` : ''}${linked ? ` Linked ${linked} attendance profile(s).` : ''}`);
  } catch (e) {
    console.error('Failed during startup init (using defaults):', e);
  }
});
