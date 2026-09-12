import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import apiRoutes from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { attachUser } from './middleware/rbac.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' })); // base64 photos/attachments can be large

app.use(attachUser); // parse Bearer token → req.user (RBAC enforced per-route)
app.use('/api', apiRoutes);

// Central error handler (must be last).
app.use(errorHandler);

const port = Number(process.env.PORT ?? 4000);
app.listen(port, async () => {
  console.log(`Majestronicz backend listening on http://localhost:${port}`);
  // Load the dynamic access-control matrix into the RBAC cache.
  try {
    const { ensureAccessMatrix } = await import('./services/access.service.js');
    await ensureAccessMatrix();
    console.log('Access-control matrix loaded.');
  } catch (e) {
    console.error('Failed to load access matrix (using defaults):', e);
  }
});
