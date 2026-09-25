import { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { broadcastChange } from './lib/events.js';
import { requireCapability } from './middleware/rbac.js';
import { Capability } from './lib/auth.js';

import { AppError } from './middleware/errorHandler.js';

/**
 * Generic REST CRUD router for a Prisma model keyed on a single string `id`.
 * Exposes:
 *   GET    /            list all
 *   GET    /:id         fetch one
 *   POST   /            create (id auto-generated if absent) or upsert if id exists
 *   PUT    /:id         update
 *   DELETE /:id         delete
 */
export function crudRouter(delegate: any, prismaClient?: any, writeCap?: Capability, readCap?: Capability): Router {
  const router = Router();

  // Enforce RBAC on both read and mutating requests
  router.use((req, res, next) => {
    if (req.method === 'GET') {
      if (readCap) {
        return requireCapability(readCap)(req, res, next);
      }
      const user = (req as any).user;
      if (!user) throw new AppError('UNAUTHENTICATED', 'Login required', 401);
      return next();
    }
    if (writeCap) {
      return requireCapability(writeCap)(req, res, next);
    }
    next();
  });

  const wrap =
    (fn: (req: Request, res: Response) => Promise<unknown>) =>
    async (req: Request, res: Response) => {
      try {
        const result = await fn(req, res);
        if (!res.headersSent) res.json(result);
        if (req.method !== 'GET') broadcastChange(`${req.method} ${req.baseUrl}`);
      } catch (err: any) {
        console.error(err);
        res.status(500).json({ error: err?.message ?? 'Internal error' });
      }
    };

  router.get(
    '/',
    wrap(async () => delegate.findMany())
  );

  // NOTE: the generic bulk-replace (PUT /bulk), blind full-row update (PUT /:id)
  // and delete (DELETE /:id) routes were REMOVED. They let any login with the
  // resource's write capability wipe or rewrite whole tables, forge stock-history
  // rows, re-receive transfers, or delete in-use vendors/customers with no state
  // or referential checks (CRUD-1, PUR2-16, CRM-21). The frontend never called
  // them — every real update/delete goes through a domain service (/catalog,
  // /tx, /stock, /purchase, /cash, /hrm, /enquiry) that enforces those rules.

  router.get(
    '/:id',
    wrap(async (req) => {
      const row = await delegate.findUnique({ where: { id: req.params.id } });
      if (!row) return { error: 'Not found' };
      return row;
    })
  );

  router.post(
    '/',
    wrap(async (req) => {
      const data = { ...req.body };
      if (!data.id) data.id = randomUUID();
      // Upsert so the frontend can safely re-send an existing record.
      return delegate.upsert({
        where: { id: data.id },
        create: data,
        update: data,
      });
    })
  );

  return router;
}
