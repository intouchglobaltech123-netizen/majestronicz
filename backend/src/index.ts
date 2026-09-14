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
app.use(cors());
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
    const { ensureAccessMatrix } = await import('./services/access.service.js');
    await ensureAccessMatrix();
    console.log('Access-control matrix loaded.');
    const { ensureUsers, migrateUserPins } = await import('./services/user.service.js');
    await ensureUsers();
    const migrated = await migrateUserPins();
    console.log(`Staff accounts ready.${migrated ? ` Secured ${migrated} legacy PIN(s).` : ''}`);
  } catch (e) {
    console.error('Failed during startup init (using defaults):', e);
  }
});
