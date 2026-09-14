import { Router } from 'express';
import { prisma } from '../db.js';
import { crudRouter } from '../crud.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireCapability } from '../middleware/rbac.js';
import { issueToken, Capability } from '../lib/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import invoiceRoutes from './invoice.routes.js';
import stockRoutes from './stock.routes.js';
import purchaseRoutes from './purchase.routes.js';
import cashRoutes from './cash.routes.js';
import hrmRoutes from './hrm.routes.js';
import enquiryRoutes from './enquiry.routes.js';
import catalogRoutes from './catalog.routes.js';
import * as system from '../services/system.service.js';
import { sseHandler, broadcastChange } from '../lib/events.js';
import { reseedDatabase } from '../services/reseed.service.js';
import { updateAccessMatrix } from '../services/access.service.js';
import { ALL_VIEWS, ALL_CAPS, ALL_FLAGS, getLiveMatrix, roleFlags } from '../lib/auth.js';
import { askAi, getAiStatus } from '../services/ai.service.js';
import { recordPayment, listPayments, deletePayment } from '../services/payment.service.js';
import {
  authenticateUser, listUsers, createUser, updateUser, adminResetPin, changeOwnPin, deleteUser,
  linkLoginToEmployee, unlinkLogin,
} from '../services/user.service.js';
import { recordAudit, listAudit } from '../services/audit.service.js';

const actorOf = (req: any) => (req.user ? `${req.user.name} [${req.user.role}]` : 'unknown');

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
  const auth = await authenticateUser(String(pin || ''), branchId);
  if (!auth) {
    rec.fails += 1;
    const remaining = Math.max(0, MAX_FAILS - rec.fails);
    if (rec.fails >= MAX_FAILS) {
      rec.lockUntil = now + LOCK_MS;
      rec.fails = 0;
    }
    loginAttempts.set(ip, rec);
    throw new AppError('INVALID_PIN', `Incorrect PIN.${remaining > 0 ? ` ${remaining} attempt${remaining === 1 ? '' : 's'} left before a 1-minute lock.` : ' Account locked for 1 minute.'}`, 401);
  }

  loginAttempts.delete(ip); // reset on success
  const { user, mustResetPin } = auth;
  const token = issueToken(user);
  res.json({
    token,
    mustResetPin,
    user: { role: user.role, name: user.name, assignedBranchId: user.assignedBranchId, userId: user.userId },
  });
}));

// Logged-in user sets a new PIN (mandatory on first login for new staff).
router.post('/auth/change-pin', asyncHandler(async (req, res) => {
  const actor = (req as any).user;
  if (!actor?.userId) throw new AppError('UNAUTHENTICATED', 'Login required', 401);
  await changeOwnPin(actor.userId, String(req.body?.newPin || ''));
  await recordAudit({ actor: actorOf(req), action: 'auth.change-pin', entity: 'user', entityId: actor.userId, summary: 'Staff set their own new PIN' });
  broadcastChange('POST /api/auth/change-pin');
  res.json({ ok: true });
}));

// ---- Staff account management (CEO/admin only) ----
router.get('/users', requireCapability('admin'), asyncHandler(async (_req, res) => res.json(await listUsers())));
router.post('/users', requireCapability('admin'), asyncHandler(async (req, res) => {
  const created: any = await createUser(req.body);
  await recordAudit({ actor: actorOf(req), action: 'user.create', entity: 'user', entityId: created.id, summary: `Created ${created.role} account for ${created.name}`, after: created });
  broadcastChange('POST /api/users');
  res.json(created);
}));
router.put('/users/:id', requireCapability('admin'), asyncHandler(async (req, res) => {
  const updated: any = await updateUser(req.params.id, req.body);
  await recordAudit({ actor: actorOf(req), action: 'user.update', entity: 'user', entityId: req.params.id, summary: `Updated ${updated.name}`, after: updated });
  broadcastChange('PUT /api/users');
  res.json(updated);
}));
router.post('/users/:id/reset-pin', requireCapability('admin'), asyncHandler(async (req, res) => {
  const result = await adminResetPin(req.params.id, String(req.body?.newPin || ''));
  await recordAudit({ actor: actorOf(req), action: 'user.reset-pin', entity: 'user', entityId: req.params.id, summary: 'Reset staff PIN (must reset on next login)' });
  broadcastChange('POST /api/users/reset-pin');
  res.json(result);
}));
router.delete('/users/:id', requireCapability('admin'), asyncHandler(async (req, res) => {
  const result = await deleteUser(req.params.id);
  await recordAudit({ actor: actorOf(req), action: 'user.delete', entity: 'user', entityId: req.params.id, summary: 'Removed staff login account' });
  broadcastChange('DELETE /api/users');
  res.json(result);
}));
// Attach / detach a login for an existing employee (unified enroll form).
router.post('/staff/login', requireCapability('admin'), asyncHandler(async (req, res) => {
  const result: any = await linkLoginToEmployee(req.body);
  await recordAudit({ actor: actorOf(req), action: 'user.link-login', entity: 'user', entityId: result.id, summary: `Enabled ${result.role} login for ${result.name}`, after: result });
  broadcastChange('POST /api/staff/login');
  res.json(result);
}));
router.delete('/staff/login/:employeeId', requireCapability('admin'), asyncHandler(async (req, res) => {
  const result = await unlinkLogin(req.params.employeeId);
  await recordAudit({ actor: actorOf(req), action: 'user.unlink-login', entity: 'employee', entityId: req.params.employeeId, summary: 'Removed app login from employee' });
  broadcastChange('DELETE /api/staff/login');
  res.json(result);
}));

// ---- Audit trail (read-only; CEO/admin) ----
router.get('/audit', requireCapability('admin'), asyncHandler(async (req, res) => {
  const { entity, entityId, action, limit } = req.query as Record<string, string | undefined>;
  res.json(await listAudit({ entity, entityId, action, limit: limit ? Number(limit) : undefined }));
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
router.put('/access-matrix', requireCapability('admin'), asyncHandler(async (req, res) => {
  const before = getLiveMatrix();
  const updated = await updateAccessMatrix(req.body);
  await recordAudit({ actor: actorOf(req), action: 'access.update', entity: 'accessMatrix', entityId: 'accessMatrix', summary: 'Updated role access matrix', before, after: updated });
  res.json(updated);
}));

// ---- Payments / party ledger (receipts from customers, payments to vendors) ----
router.get('/payments', asyncHandler(async (req, res) => {
  const { partyType, partyId, type } = req.query as Record<string, string | undefined>;
  res.json(await listPayments({ partyType, partyId, type }));
}));
router.post('/payments', requireCapability('payment:write'), asyncHandler(async (req, res) => {
  const user = (req as any).user;
  const result: any = await recordPayment(req.body, { name: user?.name, id: user?.name });
  await recordAudit({ actor: actorOf(req), action: 'payment.record', entity: 'payment', entityId: result.id,
    summary: `${result.type === 'in' ? 'Received' : 'Paid'} ₹${result.amount} · ${result.partyName} (${result.paymentMode})`, after: result });
  broadcastChange('POST /api/payments');
  res.json(result);
}));
router.delete('/payments/:id', requireCapability('payment:write'), asyncHandler(async (req, res) => {
  const result = await deletePayment(req.params.id);
  await recordAudit({ actor: actorOf(req), action: 'payment.delete', entity: 'payment', entityId: req.params.id, summary: 'Payment deleted / reversed' });
  broadcastChange('DELETE /api/payments');
  res.json(result);
}));

// ---- Beta AI (business assistant; requires ai:use; data scoped by role flags) ----
router.get('/ai/status', asyncHandler(async (_req, res) => res.json(await getAiStatus())));
router.post('/ai/ask', requireCapability('ai:use'), asyncHandler(async (req, res) => {
  const user = (req as any).user;
  const flags = roleFlags(user.role);
  const result = await askAi(String(req.body?.question || ''), flags, user.role);
  res.json(result);
}));

// ---- Admin: reset to demo dataset (CEO only) ----
router.post('/admin/reseed', requireCapability('admin'), asyncHandler(async (_req, res) => {
  await reseedDatabase();
  res.json(await system.getBootstrap());
}));

// ---- Bootstrap + health (open reads) ----
router.get('/bootstrap', asyncHandler(async (_req, res) => res.json(await system.getBootstrap())));
router.get('/health', asyncHandler(async (_req, res) => res.json(await system.healthCheck())));

export default router;
