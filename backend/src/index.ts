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
// SEC2-9: in production an empty allowlist lets every website call the API with
// a stolen token. Refusing to start would take the shop offline, so shout instead.
if (!allowlist.length && process.env.NODE_ENV === 'production') {
  console.warn(
    '\n' + '!'.repeat(78) +
    '\nSECURITY WARNING: CORS_ORIGINS is not set — the API accepts requests from ANY website.' +
    '\nSet CORS_ORIGINS to the shop\'s web address(es), comma-separated, and redeploy.\n' +
    '!'.repeat(78) + '\n',
  );
}
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

// Keep the raw body around (for Shopify webhook HMAC verification).
app.use(express.json({ limit: '25mb', verify: (req: any, _res, buf) => { req.rawBody = buf; } }));

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
    const { ensureUsers, migrateUserPins, migrateEmployeePins, provisionUserEmployees, resetSystemPins } = await import('./services/user.service.js');
    await ensureUsers();
    const migrated = (await migrateUserPins()) + (await migrateEmployeePins());
    const linked = await provisionUserEmployees();
    console.log(`Staff accounts ready.${migrated ? ` Secured ${migrated} legacy PIN(s).` : ''}${linked ? ` Linked ${linked} attendance profile(s).` : ''}`);
    // Recovery hatch (SEC3-4): re-hash preset PINs to the current AUTH_SECRET
    // after a secret change locks everyone out. RESET_SYSTEM_PINS=1 is safe to
    // leave set — it only fixes accounts still on their default PIN and never
    // reverts a changed one, so it becomes a no-op once recovered.
    // RESET_SYSTEM_PINS=force unconditionally restores all five defaults (total
    // lockout with no AUTH_SECRET_PREV). Remove the flag once you've logged in.
    const resetFlag = process.env.RESET_SYSTEM_PINS;
    if (resetFlag === '1' || resetFlag === 'force') {
      const reset = await resetSystemPins(resetFlag === 'force');
      console.log(`RESET_SYSTEM_PINS=${resetFlag}: re-hashed ${reset} preset account PIN(s) to the current AUTH_SECRET. Remove this env var once you've logged in.`);
    }
  } catch (e) {
    console.error('Failed during startup init (using defaults):', e);
  }
});
