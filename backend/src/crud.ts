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
// A branch-locked user (a non-CEO account tied to one branch) must not read
// other branches' rows through a generic list/fetch (SEC2-3 / CASH6-1). We
// filter by the row's own branchId in JS — rows with no branchId (cross-branch
// masters like items/vendors/customers) are always kept, so this is safe to
// apply generically and needs no per-model schema knowledge.
const branchLock = (user: any): string | null =>
  user && user.role !== 'CEO' && user.assignedBranchId ? String(user.assignedBranchId) : null;

const inBranch = (row: any, branch: string | null): boolean =>
  !branch || row == null || row.branchId == null || String(row.branchId) === branch;

export function crudRouter(delegate: any, prismaClient?: any, writeCap?: Capability, readCap?: Capability, branchScoped?: boolean): Router {
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
        // Map common failures to proper status codes and NEVER leak raw Prisma
        // messages / source paths to the client (ERR-1).
        if (err instanceof AppError) {
          return res.status(err.status).json({ error: err.code, message: err.message });
        }
        if (err?.code === 'P2025') return res.status(404).json({ error: 'NOT_FOUND', message: 'Record not found.' });
        if (err?.code === 'P2002') return res.status(409).json({ error: 'UNIQUE_CONFLICT', message: 'A record with that unique value already exists.' });
        if (err?.code === 'P2003') return res.status(409).json({ error: 'RELATION_CONFLICT', message: 'This record is referenced by other data.' });
        console.error(err);
        const message = process.env.NODE_ENV === 'production' ? 'Something went wrong. Please try again.' : (err?.message ?? 'Internal error');
        res.status(500).json({ error: 'INTERNAL', message });
      }
    };

  router.get(
    '/',
    wrap(async (req) => {
      const rows = await delegate.findMany();
      if (!branchScoped) return rows;
      const branch = branchLock((req as any).user);
      return branch ? (rows as any[]).filter((r) => inBranch(r, branch)) : rows;
    })
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
      // Don't leak another branch's record by direct id either (SEC2-3).
      if (branchScoped && !inBranch(row, branchLock((req as any).user))) return { error: 'Not found' };
      return row;
    })
  );

  // NOTE: the generic POST upsert was REMOVED (CRUD-1). It accepted arbitrary
  // fields on any table, so a write-capable login could rewrite a bill's total,
  // a closed cash day, a Received PO, customers, enquiries, etc. The three tables
  // the frontend actually creates through it (vendors, employees, recurring
  // expenses) now have dedicated, validated routes in routes/index.ts.

  return router;
}
