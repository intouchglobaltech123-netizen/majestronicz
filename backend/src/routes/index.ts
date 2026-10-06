import { Router } from 'express';
import { prisma } from '../db.js';
import { crudRouter } from '../crud.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireCapability, requireAuth, requireManagerOrCEO, sessionIsLive } from '../middleware/rbac.js';
import { issueToken, verifyToken, hashPin, Capability } from '../lib/auth.js';
import { assertBranchAllowed } from '../lib/branchGuard.js';
import { AppError } from '../middleware/errorHandler.js';
import { verifyGstin, gstinProviderConfigured, GSTIN_RE, gstinChecksumValid } from '../services/gstin.service.js';
import { nowIso } from '../lib/stockLedger.js';
import { launchGuardsOn } from '../lib/businessDate.js';
import { cleanRecurringFields } from '../lib/validate.js';
import { isValidBranch } from '../lib/constants.js';
import invoiceRoutes from './invoice.routes.js';
import stockRoutes from './stock.routes.js';
import purchaseRoutes from './purchase.routes.js';
import cashRoutes from './cash.routes.js';
import hrmRoutes from './hrm.routes.js';
import enquiryRoutes from './enquiry.routes.js';
import catalogRoutes from './catalog.routes.js';
import * as system from '../services/system.service.js';
import { sseHandler, broadcastChange, closeUserStreams } from '../lib/events.js';
import { reseedDatabase, resetToCatalog } from '../services/reseed.service.js';
import { updateAccessMatrix } from '../services/access.service.js';
import { ALL_VIEWS, ALL_CAPS, ALL_FLAGS, getLiveMatrix, roleFlags, roleCan } from '../lib/auth.js';
import { askAi, getAiStatus } from '../services/ai.service.js';
import { recordPayment, listPayments, deletePayment, maskStaffPayments, recordPendingOrderAdvance, clearPendingOrderAdvance, applyVendorAdvance, releasePoOverpayment } from '../services/payment.service.js';
import { registersWithLiveOpenings } from '../services/cash.service.js';
import {
  authenticateUser, listUsers, createUser, updateUser, adminResetPin, changeOwnPin, deleteUser,
  linkLoginToEmployee, unlinkLogin,
} from '../services/user.service.js';
import { recordAudit, listAudit } from '../services/audit.service.js';
import { selfClock, getSelfToday } from '../services/hrm.service.js';
import {
  getShopInfo,
  previewOrders,
  importOrders,
  listSyncLogs,
  createDemoOnlineOrders,
  previewProducts,
  importProducts,
  handleOrderWebhook,
  previewInventory,
  pushInventoryToShopify,
  pushAllErpStockToShopify,
  fulfillShopifyOrder,
  updateOnlineOrderStatus,
  saveOrderTracking,
  setCourierStatus,
  assignOrderStaff,
  recordDeliveryProof,
  setReturnStatus,
  setRtoStatus,
  reviseOnlineOrder,
  addOrderCommunication,
  saveOrderPacking,
  addOrderIssue,
  resolveOrderIssue,
  getShopifyCustomers,
  findSimilarErpItems,
} from '../services/shopify.service.js';
import { listCouriers, saveCourier, deleteCourier } from '../services/courier.service.js';
import { getFlipkartStatus, previewFlipkartOrders } from '../services/flipkart.service.js';
import { stripAttachmentBodies } from '../services/purchase.service.js';

const actorOf = (req: any) => (req.user ? `${req.user.name} [${req.user.role}]` : 'unknown');

const router = Router();

// Every reply to a branch-locked user is scoped to their branch the same way the
// bootstrap is: write endpoints answer with a snapshot of whole tables (bills,
// stock history, payments, payroll…), and those must not carry other branches'
// rows. Only object replies are touched; known collection keys are filtered.
router.use((req, res, next) => {
  const user = (req as any).user;
  // SEC10-1: also callers with no branch lock, so payroll data is stripped for them.
  if (!user || user.role === 'CEO') return next();
  const json = res.json.bind(res);
  res.json = ((body: any) => json(system.scopePayload(body, user))) as any;
  next();
});

// ---- Auth: verify PIN → signed token (open, but brute-force protected) ----
// In-memory failed-attempt tracker per client IP: lock out after 5 wrong PINs,
// with a daily cap (M3). Login carries no user name — every guess is tried against
// every account — so brute force must be throttled at the network level.
const MAX_FAILS = 5;
const LOCK_MS = 60_000;
const DAILY_CAP = 50;      // M3: wrong PINs allowed per address per day
const DAY_MS = 86_400_000;
const loginAttempts = new Map<string, { fails: number; lockUntil: number; dayFails: number; dayStart: number }>();

router.post('/auth/login', asyncHandler(async (req, res) => {
  res.locals.broadcast = true; // SAL10-1: signing in changes no shared data — no live-update event
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const rec = loginAttempts.get(ip) ?? { fails: 0, lockUntil: 0, dayFails: 0, dayStart: now };
  if (now - rec.dayStart > DAY_MS) { rec.dayFails = 0; rec.dayStart = now; } // roll the daily window

  // M3: on the LIVE server a tripped throttle (the 1-minute lock, or the daily
  // cap) blocks EVERY attempt from this address — including a correct PIN — so a
  // script can't ride the lockout window to a lucky hit. In dev / the test suite
  // the shop-friendly rule stays (SEC3-5: a correct PIN always logs in), because
  // the whole counter shares one address and must never be locked out by typos.
  const hardThrottled = rec.lockUntil > now || rec.dayFails >= DAILY_CAP;
  if (launchGuardsOn() && hardThrottled) {
    const until = rec.lockUntil > now ? rec.lockUntil : rec.dayStart + DAY_MS;
    const secs = Math.ceil((until - now) / 1000);
    throw new AppError('LOCKED', `Too many sign-in attempts from this network. Try again in ${secs}s, or ask the CEO.`, 429);
  }

  const { pin, branchId } = req.body;
  const auth = await authenticateUser(String(pin || ''), branchId);

  // A CORRECT PIN logs in and clears the counter (in dev even during a lock).
  if (auth) {
    loginAttempts.delete(ip);
    const { user, mustResetPin } = auth;
    const token = issueToken(user);
    return res.json({
      token,
      mustResetPin,
      user: { role: user.role, name: user.name, assignedBranchId: user.assignedBranchId, userId: user.userId, employeeId: user.employeeId },
    });
  }

  // Wrong PIN. If we're already throttling this IP, reject without revealing more.
  if (rec.lockUntil > now) {
    const secs = Math.ceil((rec.lockUntil - now) / 1000);
    throw new AppError('LOCKED', `Too many wrong attempts. Try again in ${secs}s.`, 429);
  }
  rec.fails += 1;
  rec.dayFails += 1;
  const remaining = Math.max(0, MAX_FAILS - rec.fails);
  if (rec.fails >= MAX_FAILS) {
    rec.lockUntil = now + LOCK_MS;
    rec.fails = 0;
  }
  loginAttempts.set(ip, rec);
  throw new AppError('INVALID_PIN', `Incorrect PIN.${remaining > 0 ? ` ${remaining} attempt${remaining === 1 ? '' : 's'} left before a 1-minute lock.` : ' Locked for 1 minute.'}`, 401);
}));

// Sign out (SEC-5): tokens are stateless and live 12h, so a copied token kept
// working after "Sign out". Record the moment; attachUser rejects every token
// of this account issued before it (all of this user's open sessions end).
router.post('/auth/logout', requireAuth, asyncHandler(async (req, res) => {
  res.locals.broadcast = true; // SAL10-1: nothing other screens show changed
  const actor = (req as any).user;
  await prisma.user.update({ where: { id: actor.userId }, data: { tokensValidAfter: Date.now(), updatedAt: nowIso() } });
  closeUserStreams(String(actor.userId)); // SEC9-1: open live-update streams end too
  await recordAudit({ actor: actorOf(req), action: 'auth.logout', entity: 'user', entityId: actor.userId, summary: 'Signed out' });
  res.json({ ok: true });
}));

// Rate-limit change-pin per account so it can't be used as a PIN oracle. The
// handler answers "that PIN is already in use" on a collision (a real staff need
// — they must pick a free PIN), but that same 409 lets a logged-in user probe
// 0000–9999 and learn other people's PINs (SEC6-1). A tight per-user budget
// makes brute-forcing the space infeasible without hurting a genuine reset.
const CHANGE_PIN_MAX = 8;
const CHANGE_PIN_WINDOW_MS = 15 * 60_000;
const changePinAttempts = new Map<string, { count: number; resetAt: number }>();

// Logged-in user sets a new PIN (mandatory on first login for new staff).
router.post('/auth/change-pin', asyncHandler(async (req, res) => {
  const actor = (req as any).user;
  if (!actor?.userId) throw new AppError('UNAUTHENTICATED', 'Login required', 401);
  const now = Date.now();
  const rl = changePinAttempts.get(actor.userId);
  if (!rl || rl.resetAt <= now) {
    changePinAttempts.set(actor.userId, { count: 1, resetAt: now + CHANGE_PIN_WINDOW_MS });
  } else {
    rl.count += 1;
    if (rl.count > CHANGE_PIN_MAX) {
      const secs = Math.ceil((rl.resetAt - now) / 1000);
      throw new AppError('RATE_LIMITED', `Too many PIN changes. Try again in ${secs}s.`, 429);
    }
  }
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

// ---- Audit trail (read-only; CEO + Manager) ----
// Guarded by 'audit:read', not 'admin': only the CEO holds 'admin', so putting
// the trail behind it silently took the screen away from managers, who are the
// people who actually ask "who voided this invoice / reopened this register".
// It stays read-only — nothing here mutates — and 'admin' still guards the
// endpoints that change the system.
router.get('/audit', requireCapability('audit:read'), asyncHandler(async (req, res) => {
  const { entity, entityId, action, limit } = req.query as Record<string, string | undefined>;
  // RPT3-1: a branch-locked reader (Manager) sees only their branch's events.
  const user = (req as any).user;
  // The CEO may narrow the trail to one branch with ?branch=.
  const locked = user && user.role !== 'CEO' && user.assignedBranchId ? String(user.assignedBranchId) : null;
  const asked = typeof req.query.branch === 'string' && req.query.branch && req.query.branch !== 'all' ? String(req.query.branch) : null;
  res.json(await listAudit({ entity, entityId, action, limit: limit ? Number(limit) : undefined, branchId: locked || asked }));
}));

// Employee reads must never leak the login/kiosk PIN (SEC2-2). These dedicated
// GETs strip `pin` and are declared BEFORE the generic crudRouter mount below so
// they take precedence over its all-columns response.
// SEC10-1: salary and incentive are payroll data — only a payroll:admin (CEO)
// receives them; everyone else gets the employee without those fields.
const safeEmployee = (e: any, user: any) => {
  const { pin, ...rest } = e || {};
  if (user && roleCan(user.role, 'payroll:admin')) return rest;
  const { monthlySalary, incentivePercent, ...noPay } = rest;
  return noPay;
};
router.get('/employees', requireCapability('hrm:write'), asyncHandler(async (req, res) => {
  const user = (req as any).user;
  const branch = user && user.role !== 'CEO' && user.assignedBranchId ? String(user.assignedBranchId) : null;
  const emps = await prisma.employee.findMany();
  res.json(
    emps
      .filter((e: any) => !branch || e.branchId == null || String(e.branchId) === branch) // SEC2-3
      .map((e: any) => safeEmployee(e, user))
  );
}));
router.get('/employees/:id', requireCapability('hrm:write'), asyncHandler(async (req, res) => {
  const e: any = await prisma.employee.findUnique({ where: { id: req.params.id } });
  // ERR-1: an unknown employee is a 404, not a 200 with an error body.
  if (!e) throw new AppError('NOT_FOUND', 'Employee not found', 404);
  const user = (req as any).user;
  const branch = user && user.role !== 'CEO' && user.assignedBranchId ? String(user.assignedBranchId) : null;
  if (branch && e.branchId != null && String(e.branchId) !== branch) throw new AppError('NOT_FOUND', 'Employee not found', 404); // SEC2-3
  res.json(safeEmployee(e, user));
}));

// ── Dedicated, validated create/update for the three tables the frontend creates
//    through — the generic POST upsert was removed (CRUD-1). ──
const pick = (o: any, keys: string[]) =>
  keys.reduce((a: any, k) => { if (o?.[k] !== undefined) a[k] = o[k]; return a; }, {} as any);

router.post('/vendors', requireCapability('purchase:write'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!String(b.vendorName || '').trim()) throw new AppError('NAME_REQUIRED', 'Vendor name is required', 400);
  if (b.gstin && !GSTIN_RE.test(String(b.gstin).trim().toUpperCase())) throw new AppError('BAD_GSTIN', 'Enter a valid GSTIN or leave it blank', 400);
  const id = String(b.id || `vnd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  // PUR6-5: the last character is a check digit — a mistyped GSTIN fails it. A
  // GSTIN already on the supplier (older data) is not re-judged on other edits.
  const newGstin = b.gstin ? String(b.gstin).trim().toUpperCase() : '';
  if (newGstin) {
    const stored = await prisma.vendor.findUnique({ where: { id }, select: { gstin: true } });
    if ((stored?.gstin || '').toUpperCase() !== newGstin && !gstinChecksumValid(newGstin)) {
      throw new AppError('INVALID_GSTIN', `GSTIN ${newGstin} fails its check digit — please re-check it, or leave it blank.`, 400);
    }
  }
  const data = {
    vendorName: String(b.vendorName).trim(),
    contactNo: String(b.contactNo || ''),
    address: String(b.address || ''),
    gstin: b.gstin ? String(b.gstin).trim().toUpperCase() : null,
    updatedAt: nowIso(),
  };
  // PUR6-5: the same supplier must not be registered twice — same GSTIN, or the
  // same name with the same phone number — or its POs and payables split in two.
  const digits = (p: string) => { let d = p.replace(/\D/g, ''); if (d.length > 10 && d.startsWith('91')) d = d.slice(2); return d.replace(/^0(?=\d{10}$)/, ''); };
  const others = (await prisma.vendor.findMany()).filter((v) => v.id !== id);
  const sameGstin = data.gstin ? others.find((v) => (v.gstin || '').toUpperCase() === data.gstin) : undefined;
  if (sameGstin) throw new AppError('DUPLICATE_VENDOR', `A supplier with GSTIN ${data.gstin} already exists: ${sameGstin.vendorName}.`, 409);
  const phone = digits(data.contactNo);
  const sameNamePhone = others.find((v) => v.vendorName.trim().toLowerCase() === data.vendorName.toLowerCase() && digits(v.contactNo || '') === phone);
  if (sameNamePhone) throw new AppError('DUPLICATE_VENDOR', `Supplier "${sameNamePhone.vendorName}" with this phone number already exists.`, 409);
  // PUR6-5: the same name with another phone is the same supplier too, unless
  // both carry (different) GSTINs that tell them apart.
  const nameKey = (n: string) => n.toLowerCase().replace(/[.,&\s]+/g, ' ').replace(/\b(pvt|private|ltd|limited|co|company)\b/g, '').replace(/\s+/g, ' ').trim();
  const storedRow = await prisma.vendor.findUnique({ where: { id }, select: { vendorName: true, contactNo: true } });
  // FIN-B-9: a new supplier needs a real 10-digit contact number (the PO screen
  // made bare suppliers from a typed name). Older rows stay editable as they are.
  if ((!storedRow || digits(storedRow.contactNo || '') !== phone) && !/^[6-9]\d{9}$/.test(phone)) {
    throw new AppError('BAD_PHONE', 'Enter the supplier\'s 10-digit contact number.', 400);
  }
  const nameChanged = !storedRow || nameKey(storedRow.vendorName) !== nameKey(data.vendorName); // an older duplicate stays editable
  const sameName = nameChanged && others.find((v) => nameKey(v.vendorName) === nameKey(data.vendorName) && !(data.gstin && v.gstin && v.gstin.toUpperCase() !== data.gstin));
  if (sameName) {
    throw new AppError('DUPLICATE_VENDOR', `Supplier "${sameName.vendorName}" already exists${sameName.contactNo ? ` (phone ${sameName.contactNo})` : ''}. Use it, or enter both GSTINs to tell two suppliers of that name apart.`, 409);
  }
  const vendor = await prisma.vendor.upsert({ where: { id }, create: { id, createdAt: nowIso(), ...data }, update: data });
  broadcastChange('POST /api/vendors');
  res.json({ ok: true, vendor, vendors: await prisma.vendor.findMany() });
}));

router.post('/employees', requireCapability('hrm:write'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!String(b.name || '').trim()) throw new AppError('NAME_REQUIRED', 'Employee name is required', 400);
  if (!String(b.designation || '').trim()) throw new AppError('DESIGNATION_REQUIRED', 'Designation is required', 400);
  const setPin = b.pin != null && String(b.pin) !== '';
  if (setPin && !/^\d{4}$/.test(String(b.pin))) throw new AppError('BAD_PIN', 'PIN must be exactly 4 digits', 400);
  // SEC5-1: a branch-locked user must not create or reassign an employee into
  // another branch. Authorize on the requested branch, and on edit also on the
  // stored branch so another branch's employee can't be touched.
  assertBranchAllowed((req as any).user, b.branchId);
  const id = String(b.id || `emp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const user = (req as any).user;
  const canPay = !user || roleCan(user.role, 'payroll:admin');
  const existing = await prisma.employee.findUnique({ where: { id } });
  const allowed = pick(b, ['name', 'designation', 'branchId', 'monthlySalary', 'incentivePercent', 'status', 'phone', 'email', 'joinedDate']);
  // HRM10-1: salary and incentive are set by payroll (CEO) only. A Manager's
  // form leaves them out; a value that would change them is refused.
  for (const k of ['monthlySalary', 'incentivePercent'] as const) {
    if (allowed[k] === undefined) continue;
    if (allowed[k] === null || allowed[k] === '') { delete allowed[k]; continue; }
    const v = Number(allowed[k]);
    if (!Number.isFinite(v) || v < 0 || (k === 'incentivePercent' && v > 100) || v > 10_000_000) {
      throw new AppError('BAD_SALARY', k === 'monthlySalary' ? 'Monthly salary must be a number of zero or more.' : 'Incentive must be a percentage between 0 and 100.', 400);
    }
    if (!canPay) {
      const stored = existing ? Number((existing as any)[k]) || 0 : 0;
      if (Math.abs(v - stored) > 0.001) throw new AppError('FORBIDDEN', 'Only the CEO (payroll) can set salary or incentive.', 403);
      delete allowed[k];
      continue;
    }
    allowed[k] = v;
  }
  if (!existing && allowed.monthlySalary === undefined) allowed.monthlySalary = 0;
  // FIN-B-7: the other fields are checked too — a status of "Banana" or a
  // joined date of "not-a-date" was stored as sent.
  if (allowed.status !== undefined && !['Active', 'Inactive'].includes(String(allowed.status))) {
    throw new AppError('BAD_STATUS', 'Status must be Active or Inactive.', 400);
  }
  if (!existing && allowed.status === undefined) allowed.status = 'Active';
  if (allowed.branchId !== undefined && !isValidBranch(String(allowed.branchId))) throw new AppError('BAD_BRANCH', 'Choose a real branch.', 400);
  if (!existing && allowed.branchId === undefined) throw new AppError('BAD_BRANCH', 'Choose the branch the employee works at.', 400);
  if (allowed.joinedDate !== undefined && allowed.joinedDate !== '') {
    const d = String(allowed.joinedDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`)) || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) {
      throw new AppError('BAD_DATE', 'Joined date must be a real date (YYYY-MM-DD).', 400);
    }
  }
  if (!existing && !allowed.joinedDate) allowed.joinedDate = nowIso().slice(0, 10);
  if (allowed.phone != null && String(allowed.phone).trim() !== '') {
    const ph = String(allowed.phone).trim();
    const digits = ph.replace(/\D/g, '');
    if (!/^[\d\s+()-]+$/.test(ph) || digits.length < 10 || digits.length > 13) throw new AppError('BAD_PHONE', 'Phone must be a 10-digit mobile number.', 400);
    allowed.phone = ph;
  }
  if (allowed.email != null && String(allowed.email).trim() !== '') {
    const em = String(allowed.email).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em) || em.length > 120) throw new AppError('BAD_EMAIL', 'Enter a valid email address.', 400);
    allowed.email = em;
  }
  // The kiosk PIN is stored HASHED, never in plain text (SEC6-2).
  const base = { ...allowed, updatedAt: nowIso(), ...(setPin ? { pin: hashPin(String(b.pin)) } : {}) };
  let employee;
  if (existing) {
    assertBranchAllowed(user, existing.branchId);
    employee = await prisma.employee.update({ where: { id }, data: base }); // blank PIN keeps the existing one
  } else {
    if (!setPin) throw new AppError('PIN_REQUIRED', 'A 4-digit PIN is required for a new employee', 400);
    employee = await prisma.employee.create({ data: { id, createdAt: nowIso(), ...base } });
  }
  // M2: the app login follows the employee's HR status. Marking an employee
  // Inactive disables their login at once AND ends any open session (so a
  // departed cashier can't keep billing that evening); marking them Active again
  // re-enables it. Previously the login was only touched when a new PIN was typed.
  if (allowed.status !== undefined) {
    const target = String(allowed.status) === 'Inactive' ? 'disabled' : 'active';
    const linked = await prisma.user.findFirst({ where: { employeeId: id } });
    if (linked && linked.status !== target) {
      await prisma.user.update({
        where: { id: linked.id },
        // Disabling ends every open session (tokensValidAfter = now); re-enabling
        // clears that cutoff so the account can sign in cleanly again.
        data: { status: target, tokensValidAfter: target === 'disabled' ? Date.now() : null, updatedAt: nowIso() },
      });
    }
  }
  broadcastChange('POST /api/employees');
  res.json({ ok: true, employee: safeEmployee(employee, user) });
}));

router.post('/recurring-expenses', requireManagerOrCEO, asyncHandler(async (req, res) => {
  const b = req.body || {};
  // VAL-1 / PLT6-1: typed, whitelisted fields (frequency, amount cap, branch) —
  // a wrong type used to reach Prisma and return a 500 with its error text.
  const data: any = cleanRecurringFields(b);
  // SEC5-1: recurring-expense templates are branch-scoped — a branch-locked user
  // must not create one for another branch.
  assertBranchAllowed((req as any).user, b.branchId);
  const id = String(b.id || `rec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const existingTpl = await prisma.recurringExpenseTemplate.findUnique({ where: { id } });
  if (existingTpl) assertBranchAllowed((req as any).user, existingTpl.branchId);
  // The approval ledger (lastApprovedMonth / approvalHistory) is NEVER accepted
  // from the client — that's how a forged "rent posted twice" got in.
  const tpl = await prisma.recurringExpenseTemplate.upsert({ where: { id }, create: { id, createdAt: nowIso(), ...data }, update: data });
  broadcastChange('POST /api/recurring-expenses');
  res.json({ ok: true, recurringExpense: tpl, recurringExpenses: await prisma.recurringExpenseTemplate.findMany() });
}));

// ---- Generic id-keyed CRUD resources (RBAC per resource on writes & sensitive reads) ----
// `scoped` marks a branch-owned resource whose generic GET must be filtered to
// the caller's own branch when they are branch-locked (SEC2-3 / CASH6-1). The
// cross-branch masters (items, combos, vendors, customers) stay unscoped, as do
// the inter-branch stock movement logs, which are meant to be seen from both ends.
const resources: Record<string, { delegate: any; cap: Capability; readCap?: Capability; scoped?: boolean; toClient?: (row: any) => any }> = {
  items: { delegate: prisma.item, cap: 'items:write' },
  combos: { delegate: prisma.comboItem, cap: 'items:write' },
  'stock-adjustments': { delegate: prisma.stockAdjustmentLog, cap: 'stock:write', readCap: 'stock:write' },
  estimates: { delegate: prisma.estimate, cap: 'estimate:write', readCap: 'estimate:write', scoped: true },
  challans: { delegate: prisma.deliveryChallan, cap: 'challan:write', readCap: 'challan:write', scoped: true },
  invoices: { delegate: prisma.invoice, cap: 'sales:write', readCap: 'sales:write', scoped: true },
  enquiries: { delegate: prisma.enquiry, cap: 'enquiry:write', readCap: 'enquiry:write', scoped: true },
  'pending-orders': { delegate: prisma.pendingOrder, cap: 'enquiry:write', readCap: 'enquiry:write', scoped: true },
  reminders: { delegate: prisma.followUpReminder, cap: 'enquiry:write', readCap: 'enquiry:write', scoped: true },
  'cash-registers': { delegate: prisma.dailyCashRegister, cap: 'cash:write', readCap: 'cash:write', scoped: true },
  'recurring-expenses': { delegate: prisma.recurringExpenseTemplate, cap: 'cash:write', readCap: 'cash:write', scoped: true },
  vendors: { delegate: prisma.vendor, cap: 'purchase:write', readCap: 'purchase:write' },
  // PUR2-12: the PO list carries the attachment list, never file bodies.
  'purchase-orders': { delegate: prisma.purchaseOrder, cap: 'purchase:write', readCap: 'purchase:write', scoped: true, toClient: stripAttachmentBodies },
  employees: { delegate: prisma.employee, cap: 'hrm:write', readCap: 'hrm:write', scoped: true },
  'attendance-records': { delegate: prisma.attendanceRecord, cap: 'hrm:write', readCap: 'hrm:write', scoped: true },
  'payroll-records': { delegate: prisma.payrollRecord, cap: 'payroll:admin', readCap: 'payroll:admin', scoped: true },
  customers: { delegate: prisma.customer, cap: 'customer:write', readCap: 'customer:write' },
  'stock-transfers': { delegate: prisma.stockTransfer, cap: 'stock:write', readCap: 'stock:write' },
};
// The register list carries LIVE openings for open days (one carry-forward rule
// with the screen — CASH-1 / CASH-5 / CASH8-4); closed days keep their own.
router.get('/cash-registers', requireCapability('cash:write'), asyncHandler(async (req, res) => {
  const user = (req as any).user;
  const branch = user && user.role !== 'CEO' && user.assignedBranchId ? String(user.assignedBranchId) : null;
  const rows: any[] = await registersWithLiveOpenings(prisma);
  res.json(branch ? rows.filter((r) => r.branchId == null || String(r.branchId) === branch) : rows);
}));
// INV7-2: the Stock Audit Trail and Transfer History are readable by Billing and
// Purchase too (they have the menu). Every branch-locked user (a Manager too)
// gets their own branch's movements and the transfers into or out of it, the
// same as their bootstrap; the CEO gets the full lists.
const stockHistoryRead = (key: 'stockAdjustmentLogs' | 'stockTransfers') =>
  asyncHandler(async (req, res) => {
    const user = (req as any).user;
    if (!user) throw new AppError('UNAUTHENTICATED', 'Login required', 401);
    if (!roleCan(user.role, 'stock:write') && !roleCan(user.role, 'sales:write') && !roleCan(user.role, 'purchase:write')) {
      throw new AppError('FORBIDDEN', `Role ${user.role} is not permitted to perform this action`, 403);
    }
    res.json((await system.branchStockHistory(user))[key]);
  });
router.get('/stock-adjustments', stockHistoryRead('stockAdjustmentLogs'));
router.get('/stock-transfers', stockHistoryRead('stockTransfers'));
for (const [path, { delegate, cap, readCap, scoped, toClient }] of Object.entries(resources)) {
  router.use(`/${path}`, crudRouter(delegate, prisma, cap, readCap, scoped, toClient));
}

// Dedicated delete routes for vendors & employees (the generic DELETE /:id was
// removed by CRUD-1; the frontend still needs these, with referential guards).
router.delete('/vendors/:id', requireCapability('purchase:write'), asyncHandler(async (req, res) => {
  const id = req.params.id;
  const linkedPos = await prisma.purchaseOrder.count({ where: { vendorId: id } });
  if (linkedPos > 0) throw new AppError('VENDOR_IN_USE', 'Cannot delete a supplier that has purchase orders. Archive it instead.', 409);
  // INV4-12: items still name this vendor (as their main supplier or in their
  // supplier list) — deleting it would leave them pointing at nothing.
  const items = await prisma.item.findMany({ select: { itemName: true, vendorId: true, vendors: true } });
  const linkedItems = items.filter((it: any) =>
    it.vendorId === id || (Array.isArray(it.vendors) && it.vendors.some((v: any) => v?.vendorId === id)));
  if (linkedItems.length > 0) {
    throw new AppError('VENDOR_IN_USE', `Cannot delete a supplier linked to ${linkedItems.length} item(s) (e.g. "${linkedItems[0].itemName}"). Remove it from those items first.`, 409);
  }
  await prisma.vendor.deleteMany({ where: { id } });
  broadcastChange('DELETE /api/vendors');
  res.json({ ok: true, vendors: await prisma.vendor.findMany() });
}));
router.delete('/employees/:id', requireCapability('hrm:write'), asyncHandler(async (req, res) => {
  const id = req.params.id;
  // A branch-locked Manager removes only their own branch's staff.
  const emp = await prisma.employee.findUnique({ where: { id }, select: { branchId: true } });
  assertBranchAllowed((req as any).user, emp?.branchId ?? null);
  const linkedUser = await prisma.user.findFirst({ where: { employeeId: id, status: 'active' } });
  if (linkedUser) throw new AppError('EMPLOYEE_HAS_LOGIN', 'This employee has an active app login. Remove the login first.', 409);
  await prisma.employee.deleteMany({ where: { id } });
  broadcastChange('DELETE /api/employees');
  res.json({ ok: true, employees: await prisma.employee.findMany() });
}));

// ---- Transactional domain endpoints (RBAC-guarded) ----
router.use('/tx', requireCapability('sales:write'), invoiceRoutes);
router.use('/stock', requireCapability('stock:write'), stockRoutes);
router.use('/purchase', requireCapability('purchase:write'), purchaseRoutes);
router.use('/cash', requireCapability('cash:write'), cashRoutes);
router.use('/hrm', requireCapability('hrm:write'), hrmRoutes); // payroll routes add payroll:admin below
router.use('/enquiry', requireCapability('enquiry:write'), enquiryRoutes);
router.use('/catalog', catalogRoutes); // per-route capabilities inside

// ---- BranchStock (composite key) ----
router.get('/branch-stock', requireAuth, asyncHandler(async (_req, res) => res.json(await system.listBranchStock())));
// The generic branch-stock write routes were REMOVED (CRUD-1): they let any
// stock-capable login overwrite or wipe every branch's stock rows and re-receive
// transfers to create stock. All real stock movement goes through /api/stock/*.

// ---- Config singletons ----
// Reads require login — some keys (payroll, loyalty) are sensitive settings and
// were readable anonymously (SEC2-3).
router.get('/config/:key', requireAuth, asyncHandler(async (req, res) => res.json(await system.getConfig(req.params.key))));
// Some config keys are not ordinary settings: the access matrix IS the RBAC
// rules. It has its own endpoint below that requires 'admin', but it is stored
// as a config row, so without this guard anyone holding 'config:write' — which
// includes every Manager — could rewrite the whole matrix through the generic
// route and grant themselves any capability, 'admin' included. Privilege
// escalation through the back door of a settings endpoint.
const PROTECTED_CONFIG_KEYS = new Set(['accessMatrix', 'accessMatrixMigrations']);

// Payroll settings drive everyone's pay, so they are CEO-only, not just any
// config:write holder (SEC4-1 / SEC3-1).
const CEO_ONLY_CONFIG_KEYS = new Set(['payrollSettings']);

// Allow-LIST of the real, writable settings (SEC4-1). Previously the route only
// blocked three keys, so any other key — including junk — could be written into
// the config table. Only these known setting rows may be set through the generic
// route; accessMatrix has its own admin-guarded endpoint and stays out.
const WRITABLE_CONFIG_KEYS = new Set([
  'categories', 'categoryPrefixMap', 'subcategoriesByCategory', 'subcategoryPrefixMap',
  'unitsList', 'gstSlabsList', 'paymentTermsOptions', 'inventorySettings',
  'loyaltySettings', 'payrollSettings', 'companyProfile',
]);

router.put('/config/:key', requireCapability('config:write'), asyncHandler(async (req, res) => {
  const key = req.params.key;
  if (PROTECTED_CONFIG_KEYS.has(key)) {
    throw new AppError(
      'FORBIDDEN',
      'The access matrix cannot be changed here — use PUT /api/access-matrix, which requires admin.',
      403,
    );
  }
  if (!WRITABLE_CONFIG_KEYS.has(key)) {
    throw new AppError('BAD_REQUEST', `Unknown setting "${key}".`, 400);
  }
  if (CEO_ONLY_CONFIG_KEYS.has(key) && !roleCan((req as any).user?.role, 'payroll:admin')) {
    throw new AppError('FORBIDDEN', 'Only the CEO can change payroll settings.', 403);
  }
  res.json(await system.setConfig(key, req.body));
}));

// ---- GSTIN verification (vendor/customer onboarding) ----
// Any signed-in user may check a number they are typing — it is a read of a
// public register, not a mutation. The key never reaches the browser: the
// lookup happens here, so a client cannot read it out of the bundle or spend
// our API quota directly.
router.get('/gstin/status', requireAuth, asyncHandler(async (_req, res) => {
  res.json({ configured: gstinProviderConfigured() });
}));
router.get('/gstin/:gstin', requireAuth, asyncHandler(async (req, res) => {
  res.json(await verifyGstin(req.params.gstin));
}));

// ---- Live updates (Server-Sent Events) ----
// The live-updates stream requires login (SEC2-3). EventSource can't send an
// Authorization header, so the token arrives as a query param; verify it (and
// require a userId, like every other request) before opening the stream.
router.get('/events', (req, res, next) => {
  const token = typeof req.query.token === 'string' ? req.query.token : undefined;
  const session = verifyToken(token);
  if (!session || !session.userId) throw new AppError('UNAUTHENTICATED', 'Login required', 401);
  // Same revocation as every other request (disabled / role changed / signed out).
  sessionIsLive(session).then((live) => {
    if (!live) return next(new AppError('UNAUTHENTICATED', 'Login required', 401));
    (res.locals as any).userId = session.userId; // SEC9-1: closed again on sign-out
    next();
  }, next);
}, sseHandler);

// ---- Access control matrix (view/edit; edit is CEO/admin only) ----
router.get('/access-matrix', requireAuth, asyncHandler(async (_req, res) =>
  res.json({ matrix: getLiveMatrix(), allViews: ALL_VIEWS, allCaps: ALL_CAPS, allFlags: ALL_FLAGS })
));
router.put('/access-matrix', requireCapability('admin'), asyncHandler(async (req, res) => {
  const before = getLiveMatrix();
  const updated = await updateAccessMatrix(req.body);
  await recordAudit({ actor: actorOf(req), action: 'access.update', entity: 'accessMatrix', entityId: 'accessMatrix', summary: 'Updated role access matrix', before, after: updated });
  res.json(updated);
}));

// ---- Payments / party ledger (receipts from customers, payments to vendors) ----
/** SAL10-1: the rows a customer receipt touches, for the live-update event. */
const allocIds = (p: any): string[] => (Array.isArray(p?.allocations) ? p.allocations.map((a: any) => a?.refId).filter(Boolean) : []);
async function billCustomers(p: any): Promise<string[]> {
  const ids = allocIds(p);
  const bills = ids.length ? await prisma.invoice.findMany({ where: { id: { in: ids } }, select: { customerId: true } }) : [];
  return bills.map((b) => b.customerId).filter(Boolean) as string[];
}
const paymentChanges = (p: any, customers: string[]) => ({
  invoices: allocIds(p), customers: [...new Set([p?.partyId, ...customers].filter(Boolean))], payments: [p.id], stock: [], logs: [],
  removed: { invoices: [], payments: [] },
});
router.get('/payments', requireCapability('payment:write'), asyncHandler(async (req, res) => {
  const { partyType, partyId, type } = req.query as Record<string, string | undefined>;
  // SEC2-3: a branch-locked user must not read another branch's payment ledger.
  const user = (req as any).user;
  const branch = user && user.role !== 'CEO' && user.assignedBranchId ? String(user.assignedBranchId) : null;
  let rows: any[] = await listPayments({ partyType, partyId, type });
  // PUR9-2: a role without the cash desk (Purchase) sees supplier payments only.
  if (user && !roleCan(user.role, 'cash:write')) rows = rows.filter((p) => p.type === 'out' && p.partyType === 'vendor');
  res.json(maskStaffPayments(branch ? rows.filter((p) => p.branchId == null || String(p.branchId) === branch) : rows, user));
}));
router.post('/payments', requireCapability('payment:write'), asyncHandler(async (req, res) => {
  const user = (req as any).user;
  const result: any = await recordPayment(req.body, { name: user?.name, id: user?.name }, user);
  await recordAudit({ actor: actorOf(req), action: 'payment.record', entity: 'payment', entityId: result.id,
    summary: `${result.type === 'in' ? 'Received' : 'Paid'} ₹${result.amount} · ${result.partyName} (${result.paymentMode})`, after: result, branchId: result.branchId });
  // SAL10-1: a customer receipt names the rows it changed (the receipt, its
  // bills, the customer's credit); a vendor payment also moves POs — full reload.
  if (result.partyType === 'customer') res.locals.changes = paymentChanges(result, await billCustomers(result));
  else broadcastChange('POST /api/payments');
  res.locals.broadcast = result.partyType !== 'customer';
  res.json(result);
}));
// Pending-order advances are real receipts kept as store credit (CRM2-8).
router.post('/payments/advance', requireCapability('cash:write'), asyncHandler(async (req, res) => {
  const user = (req as any).user;
  const { orderId, amount, mode } = req.body || {};
  const result: any = await recordPendingOrderAdvance(orderId, amount, mode, { name: user?.name, id: user?.name }, user);
  await recordAudit({ actor: actorOf(req), action: 'payment.advance', entity: 'pendingOrder', entityId: String(orderId),
    summary: `Advance ₹${result.payment.amount} (${result.payment.paymentMode}) · ${result.payment.receiptNumber}` });
  broadcastChange('POST /api/payments');
  res.json(result);
}));
router.post('/payments/advance/clear', requireCapability('cash:write'), asyncHandler(async (req, res) => {
  const result = await clearPendingOrderAdvance(String(req.body?.orderId || ''), (req as any).user);
  await recordAudit({ actor: actorOf(req), action: 'payment.advance.clear', entity: 'pendingOrder', entityId: String(req.body?.orderId || ''), summary: 'Advance given back' });
  broadcastChange('DELETE /api/payments');
  res.json(result);
}));
// Apply a supplier's unapplied advance to one of its purchase orders (PUR6-3).
router.post('/payments/vendor-advance/apply', requireCapability('purchase:write'), asyncHandler(async (req, res) => {
  const user = (req as any).user;
  const result = await applyVendorAdvance(req.body || {}, { name: user?.name }, user);
  await recordAudit({ actor: actorOf(req), action: 'payment.applyAdvance', entity: 'purchaseOrder', entityId: result.poId,
    summary: `Applied ₹${result.applied} vendor advance to PO` });
  broadcastChange('POST /api/payments/vendor-advance/apply');
  res.json(result);
}));
// PUR9-4: a PO's overpayment becomes the supplier's advance.
router.post('/payments/vendor-advance/release', requireCapability('purchase:write'), asyncHandler(async (req, res) => {
  const user = (req as any).user;
  const result = await releasePoOverpayment(req.body || {}, { name: user?.name }, user);
  await recordAudit({ actor: actorOf(req), action: 'payment.releaseOverpayment', entity: 'purchaseOrder', entityId: result.poId,
    summary: `Moved ₹${result.moved} overpaid on the PO to the supplier's advance` });
  broadcastChange('POST /api/payments/vendor-advance/release');
  res.json(result);
}));
router.delete('/payments/:id', requireCapability('payment:write'), asyncHandler(async (req, res) => {
  const before = await prisma.payment.findUnique({ where: { id: req.params.id } });
  const result = await deletePayment(req.params.id, (req as any).user);
  await recordAudit({ actor: actorOf(req), action: 'payment.delete', entity: 'payment', entityId: req.params.id,
    summary: before ? `Payment ${before.receiptNumber} deleted · ₹${before.amount} · ${before.partyName} (${before.paymentMode}) · ${before.date}` : 'Payment deleted / reversed',
    before: before || undefined, branchId: before?.branchId ?? null });
  if (before?.partyType === 'customer') res.locals.changes = { ...paymentChanges(before, await billCustomers(before)), payments: [], removed: { invoices: [], payments: [before.id] } };
  else { broadcastChange('DELETE /api/payments'); res.locals.broadcast = true; }
  res.json(result);
}));

// ---- Beta AI (business assistant; requires ai:use; data scoped by role flags) ----
router.get('/ai/status', asyncHandler(async (_req, res) => res.json(await getAiStatus())));
router.post('/ai/ask', requireCapability('ai:use'), asyncHandler(async (req, res) => {
  res.locals.broadcast = true; // SAL10-1: a question changes no data
  const user = (req as any).user;
  const flags = roleFlags(user.role);
  const result = await askAi(String(req.body?.question || ''), flags, user.role);
  res.json(result);
}));

// ---- Admin: reset to demo dataset (CEO only) ----
router.post('/admin/reseed', requireCapability('admin'), asyncHandler(async (req, res) => {
  // M7: reseed WIPES every table (payments, audit log, the lot). It must never be
  // reachable on the live server — one stray click would erase both counters'
  // billing. Allow it only off production, or with an explicit opt-in env flag.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_RESEED !== 'true') {
    throw new AppError('FORBIDDEN', 'Resetting to demo data is disabled in production.', 403);
  }
  await reseedDatabase();
  res.json(await system.getBootstrap((req as any).user));
}));

// ---- Admin: ONE-TIME go-live — wipe all data, keep logins, load the real
// catalog (CEO only). Same danger as reseed: gated off production unless the
// operator sets ALLOW_RESET_TO_CATALOG=true for the single run. A typed
// confirm ("RESET") in the body is required so it can't fire on a stray call. ----
router.post('/admin/reset-to-catalog', requireCapability('admin'), asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_RESET_TO_CATALOG !== 'true') {
    throw new AppError('FORBIDDEN', 'Resetting to the real catalog is disabled in production. Set ALLOW_RESET_TO_CATALOG=true for the one-time run.', 403);
  }
  if (String(req.body?.confirm || '') !== 'RESET') {
    throw new AppError('CONFIRM_REQUIRED', 'This erases all data except logins. Send { "confirm": "RESET" } to proceed.', 400);
  }
  const result = await resetToCatalog();
  res.json({ ...result, bootstrap: await system.getBootstrap((req as any).user) });
}));

// ---- Bootstrap + health (bootstrap is scoped by authenticated role) ----
// ---- Self-attendance: any authenticated user can check in/out as THEMSELVES
// (their own linked employee only) — no hrm:write needed. ----
router.get('/attendance/self-today', asyncHandler(async (req, res) => {
  const u = (req as any).user;
  if (!u) throw new AppError('UNAUTHENTICATED', 'Login required', 401);
  if (!u.employeeId) { res.json({ linked: false, record: null }); return; }
  res.json({ linked: true, ...(await getSelfToday(u.employeeId)) });
}));
router.post('/attendance/self-clock', asyncHandler(async (req, res) => {
  const u = (req as any).user;
  if (!u) throw new AppError('UNAUTHENTICATED', 'Login required', 401);
  if (!u.employeeId) throw new AppError('NO_PROFILE', 'No attendance profile is linked to your account.', 400);
  const { photo, location } = req.body;
  const result = await selfClock(u.employeeId, photo, location);
  broadcastChange('attendance');
  res.json(result);
}));
// M6: a check-in/out selfie is fetched only when someone opens it — it is NOT in
// the bootstrap payload. Branch-scoped so a Manager only sees their branch's.
router.get('/attendance/:id/photo', requireCapability('hrm:write'), asyncHandler(async (req, res) => {
  const rec = await prisma.attendanceRecord.findUnique({
    where: { id: String(req.params.id) },
    select: { branchId: true, checkInPhoto: true, checkOutPhoto: true },
  });
  if (!rec) throw new AppError('NOT_FOUND', 'Attendance record not found', 404);
  assertBranchAllowed((req as any).user, rec.branchId);
  res.json({ checkInPhoto: rec.checkInPhoto || null, checkOutPhoto: rec.checkOutPhoto || null });
}));

// ---- Shopify integration ----
// ---- Flipkart (marketplace; same shape as the Shopify endpoints above) ----
router.get('/flipkart/status', requireCapability('sales:write'), asyncHandler(async (_req, res) => res.json(await getFlipkartStatus())));
router.get('/flipkart/orders', requireCapability('sales:write'), asyncHandler(async (req, res) => res.json(await previewFlipkartOrders(Number(req.query.limit) || 50))));

router.get('/shopify/status', requireCapability('sales:write'), asyncHandler(async (_req, res) => res.json(await getShopInfo())));
router.get('/shopify/orders', requireCapability('sales:write'), asyncHandler(async (req, res) => res.json(await previewOrders(Number(req.query.limit) || 50))));
router.post('/shopify/orders/:id/fulfill', requireCapability('sales:write'), asyncHandler(async (req, res) => {
  const result = await fulfillShopifyOrder(req.params.id, req.body?.trackingNumber, req.body?.carrier);
  broadcastChange('shopify-fulfillment');
  res.json(result);
}));
router.post('/shopify/order-status', requireCapability('sales:write'), asyncHandler(async (req, res) => {
  const { invoiceId, status, trackingNumber, courierName, trackingUrl, trayPhotoUrl, parcelPhotoUrl, note } = req.body;
  const result = await updateOnlineOrderStatus(invoiceId, status, { trackingNumber, courierName, trackingUrl, trayPhotoUrl, parcelPhotoUrl, note, actor: actorOf(req) });
  broadcastChange('shopify-order-status');
  res.json(result);
}));
router.post('/shopify/order-tracking', requireCapability('sales:write'), asyncHandler(async (req, res) => {
  const { invoiceId, courierName, trackingNumber, trackingUrl, trackingReference, trackingSlipUrl } = req.body;
  const result = await saveOrderTracking(invoiceId, { courierName, trackingNumber, trackingUrl, trackingReference, trackingSlipUrl, actor: actorOf(req) });
  broadcastChange('shopify-order-tracking');
  res.json(result);
}));
router.post('/shopify/order-courier-status', requireCapability('sales:write'), asyncHandler(async (req, res) => {
  const result = await setCourierStatus(req.body?.invoiceId, req.body?.status, actorOf(req));
  broadcastChange('shopify-courier-status');
  res.json(result);
}));
router.post('/shopify/order-assign', requireCapability('sales:write'), asyncHandler(async (req, res) => {
  const result = await assignOrderStaff(req.body?.invoiceId, req.body?.stage, req.body?.staffName, actorOf(req));
  broadcastChange('shopify-order-assign');
  res.json(result);
}));
router.post('/shopify/order-pod', requireCapability('sales:write'), asyncHandler(async (req, res) => {
  const result = await recordDeliveryProof(req.body?.invoiceId, { receiverName: req.body?.receiverName, note: req.body?.note, receivedAt: req.body?.receivedAt, actor: actorOf(req) });
  broadcastChange('shopify-order-pod');
  res.json(result);
}));
router.post('/shopify/order-return-status', requireCapability('sales:write'), asyncHandler(async (req, res) => {
  const result = await setReturnStatus(req.body?.invoiceId, req.body?.status, req.body?.note, actorOf(req));
  broadcastChange('shopify-order-return');
  res.json(result);
}));
router.post('/shopify/order-rto-status', requireCapability('sales:write'), asyncHandler(async (req, res) => {
  const result = await setRtoStatus(req.body?.invoiceId, req.body?.status, req.body?.note, actorOf(req));
  broadcastChange('shopify-order-rto');
  res.json(result);
}));
router.post('/shopify/order-revise', requireCapability('sales:write'), asyncHandler(async (req, res) => {
  const result = await reviseOnlineOrder(req.body?.invoiceId, { items: req.body?.items, note: req.body?.note }, actorOf(req));
  broadcastChange('shopify-order-revise');
  res.json(result);
}));
router.post('/shopify/order-comm', requireCapability('sales:write'), asyncHandler(async (req, res) => {
  const { invoiceId, type, note } = req.body;
  const result = await addOrderCommunication(invoiceId, type, note, actorOf(req));
  broadcastChange('shopify-order-comm');
  res.json(result);
}));
router.post('/shopify/order-packing', requireCapability('sales:write'), asyncHandler(async (req, res) => {
  const { invoiceId, parcelWeightKg, boxCount, addressLabelDone, invoiceIncluded } = req.body;
  const result = await saveOrderPacking(invoiceId, { parcelWeightKg, boxCount, addressLabelDone, invoiceIncluded }, actorOf(req));
  broadcastChange('shopify-order-packing');
  res.json(result);
}));

router.post('/shopify/order-issue', requireCapability('sales:write'), asyncHandler(async (req, res) => {
  const { invoiceId, type, description } = req.body;
  const result = await addOrderIssue(invoiceId, type, description, actorOf(req));
  broadcastChange('shopify-order-issue');
  res.json(result);
}));
router.post('/shopify/order-issue-resolve', requireCapability('sales:write'), asyncHandler(async (req, res) => {
  const { invoiceId, issueId, resolution } = req.body;
  const result = await resolveOrderIssue(invoiceId, issueId, resolution, actorOf(req));
  broadcastChange('shopify-order-issue');
  res.json(result);
}));

// ---- Courier partners (delivery partner master + recommendation source) ----
router.get('/couriers', requireAuth, asyncHandler(async (_req, res) => res.json(await listCouriers())));
router.post('/couriers', requireCapability('sales:write'), asyncHandler(async (req, res) => {
  const result = await saveCourier(req.body);
  broadcastChange('couriers');
  res.json(result);
}));
router.delete('/couriers/:id', requireCapability('sales:write'), asyncHandler(async (req, res) => {
  const result = await deleteCourier(req.params.id);
  broadcastChange('couriers');
  res.json(result);
}));
router.post('/shopify/import', requireCapability('sales:write'), asyncHandler(async (req, res) => {
  const result = await importOrders(Number(req.body?.limit) || 50, actorOf(req));
  broadcastChange('shopify-import');
  res.json(result);
}));
router.get('/shopify/sync-logs', requireCapability('sales:write'), asyncHandler(async (req, res) => {
  res.json(await listSyncLogs(Number(req.query?.limit) || 50));
}));
// Load demo online orders to exercise the fulfillment flow without a live store
// (CEO/Manager; refused on production unless ALLOW_DEMO_ORDERS=true).
router.post('/shopify/demo-orders', requireManagerOrCEO, asyncHandler(async (req, res) => {
  const result = await createDemoOnlineOrders(Number(req.body?.count) || 100, (req as any).user);
  broadcastChange('shopify-demo');
  res.json(result);
}));
router.get('/shopify/inventory', requireCapability('sales:write'), asyncHandler(async (req, res) => res.json(await previewInventory(Number(req.query.limit) || 100))));
router.post('/shopify/inventory/sync', requireCapability('sales:write'), asyncHandler(async (req, res) => {
  const result = await pushInventoryToShopify(req.body?.inventoryItemId, Number(req.body?.quantity) || 0);
  broadcastChange('shopify-inventory');
  res.json(result);
}));
router.post('/shopify/inventory/sync-all', requireCapability('sales:write'), asyncHandler(async (_req, res) => {
  const result = await pushAllErpStockToShopify();
  broadcastChange('shopify-inventory');
  res.json(result);
}));
router.get('/shopify/products', requireCapability('sales:write'), asyncHandler(async (req, res) => res.json(await previewProducts(Number(req.query.limit) || 100))));
router.post('/shopify/import-products', requireCapability('sales:write'), asyncHandler(async (req, res) => {
  const result = await importProducts(Number(req.body?.limit) || 100);
  broadcastChange('shopify-products');
  res.json(result);
}));
router.get('/shopify/customers', requireCapability('sales:write'), asyncHandler(async (req, res) => res.json(await getShopifyCustomers(Number(req.query.limit) || 100))));
router.get('/shopify/similar-items', requireCapability('sales:write'), asyncHandler(async (req, res) => res.json(await findSimilarErpItems(String(req.query.query || ''), String(req.query.category || '')))));
// Auto-sync webhook (Shopify orders/paid). PUBLIC — verified by HMAC, not RBAC.
router.post('/shopify/webhook/orders', asyncHandler(async (req, res) => {
  const result = await handleOrderWebhook((req as any).rawBody, req.header('X-Shopify-Hmac-Sha256'), req.body);
  if (!result.ok) { res.status(401).json({ error: 'invalid hmac' }); return; }
  if (result.status === 'imported') broadcastChange('shopify-webhook');
  res.status(200).json({ ok: true });
}));

router.get('/bootstrap', asyncHandler(async (req, res) => res.json(await system.getBootstrap((req as any).user, req.query as any))));
// SAL10-1: just the rows a live-update event named (see lib/events), and the
// older bills / stock history the bootstrap leaves out, page by page.
router.get('/sync', asyncHandler(async (req, res) => res.json(await system.getSync((req as any).user, req.query as any))));
router.get('/history', asyncHandler(async (req, res) => res.json(await system.getHistoryPage((req as any).user, req.query as any))));
router.get('/item-stats', asyncHandler(async (req, res) => {
  if (!(req as any).user) throw new AppError('UNAUTHENTICATED', 'Login required', 401);
  res.json(await system.itemStats());
}));
router.get('/health', asyncHandler(async (_req, res) => res.json(await system.healthCheck())));

// ERR-1: an unknown /api route answers with JSON, not Express's HTML "Cannot PUT" page.
router.use((req, res) => {
  res.status(404).json({ error: 'NOT_FOUND', message: `No such API route: ${req.method} ${req.baseUrl}${req.path}` });
});

export default router;
