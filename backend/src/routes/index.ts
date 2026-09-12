import { Router } from 'express';
import { prisma } from '../db.js';
import { crudRouter } from '../crud.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireCapability } from '../middleware/rbac.js';
import { authenticatePin, issueToken, Capability } from '../lib/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import invoiceRoutes from './invoice.routes.js';
import stockRoutes from './stock.routes.js';
import purchaseRoutes from './purchase.routes.js';
import cashRoutes from './cash.routes.js';
import hrmRoutes from './hrm.routes.js';
import enquiryRoutes from './enquiry.routes.js';
import catalogRoutes from './catalog.routes.js';
import * as system from '../services/system.service.js';
import { sseHandler } from '../lib/events.js';
import { reseedDatabase } from '../services/reseed.service.js';
import { updateAccessMatrix } from '../services/access.service.js';
import { ALL_VIEWS, ALL_CAPS, ALL_FLAGS, getLiveMatrix } from '../lib/auth.js';

const router = Router();

// ---- Auth: verify PIN → signed token (open, but brute-force protected) ----
// In-memory failed-attempt tracker per client IP: lock out after 5 wrong PINs.
const MAX_FAILS = 5;
const LOCK_MS = 60_000;
const loginAttempts = new Map<string, { fails: number; lockUntil: number }>();

router.post('/auth/login', asyncHandler(async (req, res) => {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const rec = loginAttempts.get(ip) ?? { fails: 0, lockUntil: 0 };

  if (rec.lockUntil > now) {
    const secs = Math.ceil((rec.lockUntil - now) / 1000);
    throw new AppError('LOCKED', `Too many attempts. Try again in ${secs}s.`, 429);
  }

  const { pin, branchId } = req.body;
  const user = authenticatePin(String(pin || ''), branchId);
  if (!user) {
    rec.fails += 1;
    if (rec.fails >= MAX_FAILS) {
      rec.lockUntil = now + LOCK_MS;
      rec.fails = 0;
    }
    loginAttempts.set(ip, rec);
    throw new AppError('INVALID_PIN', 'Invalid PIN code', 401);
  }

  loginAttempts.delete(ip); // reset on success
  const token = issueToken(user);
  res.json({ token, user: { role: user.role, name: user.name, assignedBranchId: user.assignedBranchId } });
}));

// ---- Generic id-keyed CRUD resources (RBAC per resource on writes) ----
const resources: Record<string, { delegate: any; cap: Capability }> = {
  items: { delegate: prisma.item, cap: 'items:write' },
  combos: { delegate: prisma.comboItem, cap: 'items:write' },
  'stock-adjustments': { delegate: prisma.stockAdjustmentLog, cap: 'stock:write' },
  estimates: { delegate: prisma.estimate, cap: 'estimate:write' },
  challans: { delegate: prisma.deliveryChallan, cap: 'challan:write' },
  invoices: { delegate: prisma.invoice, cap: 'sales:write' },
  enquiries: { delegate: prisma.enquiry, cap: 'enquiry:write' },
  'pending-orders': { delegate: prisma.pendingOrder, cap: 'enquiry:write' },
  reminders: { delegate: prisma.followUpReminder, cap: 'enquiry:write' },
  'cash-registers': { delegate: prisma.dailyCashRegister, cap: 'cash:write' },
  'recurring-expenses': { delegate: prisma.recurringExpenseTemplate, cap: 'cash:write' },
  vendors: { delegate: prisma.vendor, cap: 'purchase:write' },
  'purchase-orders': { delegate: prisma.purchaseOrder, cap: 'purchase:write' },
  employees: { delegate: prisma.employee, cap: 'hrm:write' },
  'attendance-records': { delegate: prisma.attendanceRecord, cap: 'hrm:write' },
  'payroll-records': { delegate: prisma.payrollRecord, cap: 'payroll:admin' },
  customers: { delegate: prisma.customer, cap: 'customer:write' },
  'stock-transfers': { delegate: prisma.stockTransfer, cap: 'stock:write' },
};
for (const [path, { delegate, cap }] of Object.entries(resources)) {
  router.use(`/${path}`, crudRouter(delegate, prisma, cap));
}

// ---- Transactional domain endpoints (RBAC-guarded) ----
router.use('/tx', requireCapability('sales:write'), invoiceRoutes);
router.use('/stock', requireCapability('stock:write'), stockRoutes);
router.use('/purchase', requireCapability('purchase:write'), purchaseRoutes);
router.use('/cash', requireCapability('cash:write'), cashRoutes);
router.use('/hrm', requireCapability('hrm:write'), hrmRoutes); // payroll routes add payroll:admin below
router.use('/enquiry', requireCapability('enquiry:write'), enquiryRoutes);
router.use('/catalog', catalogRoutes); // per-route capabilities inside

// ---- BranchStock (composite key) ----
router.get('/branch-stock', asyncHandler(async (_req, res) => res.json(await system.listBranchStock())));
router.post('/branch-stock', requireCapability('stock:write'), asyncHandler(async (req, res) => res.json(await system.upsertBranchStock(req.body))));
router.put('/branch-stock', requireCapability('stock:write'), asyncHandler(async (req, res) => res.json(await system.replaceBranchStock(req.body))));

// ---- Config singletons ----
router.get('/config/:key', asyncHandler(async (req, res) => res.json(await system.getConfig(req.params.key))));
router.put('/config/:key', requireCapability('config:write'), asyncHandler(async (req, res) => res.json(await system.setConfig(req.params.key, req.body))));

// ---- Live updates (Server-Sent Events) ----
router.get('/events', sseHandler);

// ---- Access control matrix (view/edit; edit is CEO/admin only) ----
router.get('/access-matrix', asyncHandler(async (_req, res) =>
  res.json({ matrix: getLiveMatrix(), allViews: ALL_VIEWS, allCaps: ALL_CAPS, allFlags: ALL_FLAGS })
));
router.put('/access-matrix', requireCapability('admin'), asyncHandler(async (req, res) =>
  res.json(await updateAccessMatrix(req.body))
));

// ---- Admin: reset to demo dataset (CEO only) ----
router.post('/admin/reseed', requireCapability('admin'), asyncHandler(async (_req, res) => {
  await reseedDatabase();
  res.json(await system.getBootstrap());
}));

// ---- Bootstrap + health (open reads) ----
router.get('/bootstrap', asyncHandler(async (_req, res) => res.json(await system.getBootstrap())));
router.get('/health', asyncHandler(async (_req, res) => res.json(await system.healthCheck())));

export default router;
