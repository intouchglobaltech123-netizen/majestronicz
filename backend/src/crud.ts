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

  // Replace the entire collection with the provided array (atomic). Used by the
  // frontend's per-collection sync so the DB always mirrors client state after a
  // mutation. Declared before '/:id' so "bulk" isn't treated as an id.
  router.put(
    '/bulk',
    wrap(async (req) => {
      const rows: any[] = Array.isArray(req.body) ? req.body : [];
      const ops = [delegate.deleteMany({}), delegate.createMany({ data: rows })];
      if (prismaClient?.$transaction) {
        await prismaClient.$transaction(ops);
      } else {
        await ops[0];
        await ops[1];
      }
      return delegate.findMany();
    })
  );

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

  router.put(
    '/:id',
    wrap(async (req) => {
      const data = { ...req.body };
      delete data.id;
      return delegate.update({ where: { id: req.params.id }, data });
    })
  );

  router.delete(
    '/:id',
    wrap(async (req) => {
      await delegate.delete({ where: { id: req.params.id } });
      return { ok: true };
    })
  );

  return router;
}
