import { registersWithLiveOpenings } from './cash.service.js';
import { withLiveBillCounts } from '../lib/liveCounts.js';
import { maskStaffPayments } from './payment.service.js';
import { prisma } from '../db.js';
import { AppError } from '../middleware/errorHandler.js';
import { SessionUser, roleCan } from '../lib/auth.js';
import { istToday } from '../lib/businessDate.js';
import { stripAttachmentBodies } from './purchase.service.js';

/**
 * NET units of each catalogue item sold per branch over the last 90 days
 * (today and the 89 days before it, IST; live bills only): combos count as their
 * stored parts, and returned units are taken off (INV8-7). Sent to EVERY role so
 * the low-stock threshold — average monthly sales + 10 — and the fast/slow
 * classification are the same on every screen and for every role; Purchase has
 * no bills and used to fall back to the static threshold (INV2-10). Units only.
 */
async function itemSales90d(): Promise<Record<string, Record<string, number>>> {
  const cutoff = new Date(Date.parse(`${istToday()}T00:00:00Z`) - 89 * 86400000).toISOString().slice(0, 10);
  const invs = await prisma.invoice.findMany({
    where: { date: { gte: cutoff } },
    select: { branchId: true, items: true, returns: true, isVoided: true },
  });
  const out: Record<string, Record<string, number>> = {};
  const add = (itemId: string, branchId: string, q: number) => {
    if (!itemId || !q) return;
    const row = (out[itemId] ||= {});
    row[branchId] = (row[branchId] || 0) + q;
  };
  const partsOf = (line: any): any[] => (Array.isArray(line?.comboComponents) ? line.comboComponents : []);
  for (const inv of invs) {
    if (inv.isVoided) continue;
    const lines: any[] = (inv.items as any[]) || [];
    for (const li of lines) {
      const q = Number(li?.quantity) || 0;
      if (q <= 0) continue;
      if (li.isCombo) for (const c of partsOf(li)) add(c?.itemId, inv.branchId, (Number(c?.quantity) || 0) * q);
      else if (li.itemId) add(li.itemId, inv.branchId, q);
    }
    for (const r of ((inv.returns as any[]) || [])) {
      const q = Number(r?.returnedQuantity) || 0;
      if (q <= 0) continue;
      if (r.isCombo) {
        // The parts the bill sold the combo with.
        const sold = lines.find((li) => li?.isCombo && ((r.comboId && li.comboId === r.comboId) || li.itemId === r.itemId));
        for (const c of partsOf(sold || r)) add(c?.itemId, inv.branchId, -(Number(c?.quantity) || 0) * q);
      } else if (r.itemId) {
        add(r.itemId, inv.branchId, -q);
      }
    }
  }
  for (const row of Object.values(out)) for (const b of Object.keys(row)) row[b] = Math.max(0, Math.round(row[b] * 1000) / 1000);
  return out;
}

/**
 * INV2-10: the last day each item (combo parts included) was sold, per branch —
 * so a role whose bootstrap carries no bills (Purchase) still sees real stock
 * movement instead of "Never sold" on every item.
 */
async function itemLastSale(): Promise<Record<string, Record<string, string>>> {
  const invs = await prisma.invoice.findMany({ select: { branchId: true, date: true, items: true, isVoided: true } });
  const out: Record<string, Record<string, string>> = {};
  const put = (itemId: string, branchId: string, date: string) => {
    if (!itemId || !date) return;
    const row = (out[itemId] ||= {});
    if (!row[branchId] || row[branchId] < date) row[branchId] = date;
  };
  for (const inv of invs) {
    if (inv.isVoided) continue;
    for (const li of ((inv.items as any[]) || [])) {
      if (li?.isCombo) for (const c of (Array.isArray(li.comboComponents) ? li.comboComponents : [])) put(c?.itemId, inv.branchId, inv.date);
      else put(li?.itemId, inv.branchId, inv.date);
    }
  }
  return out;
}

/**
 * Stock history and transfers a branch-locked Billing/Purchase user may read:
 * their own branch's movements, and transfers into or out of it (INV7-2 — the
 * Stock Audit Trail and Transfer History screens were empty for them).
 */
export async function branchStockHistory(user: SessionUser, sinceIso: string | null = null) {
  const branch = user.role === 'CEO' ? null : user.assignedBranchId || null;
  const [stockAdjustmentLogs, stockTransfers] = await Promise.all([
    // INV10-2: newest first.
    prisma.stockAdjustmentLog.findMany({ where: { ...(branch ? { branchId: branch } : {}), ...(sinceIso ? { timestamp: { gte: sinceIso } } : {}) }, orderBy: [{ timestamp: 'desc' }, { id: 'desc' }] }),
    prisma.stockTransfer.findMany(branch ? { where: { OR: [{ fromBranch: branch }, { toBranch: branch }] } } : undefined),
  ]);
  return { stockAdjustmentLogs, stockTransfers };
}

/**
 * Restrict a payload to a non-CEO user's own branch, and strip salary/PIN from
 * employees (SEC2-1 reads + SEC2-2). CEO is cross-branch and sees everything.
 * Used for the bootstrap AND for every write reply (the snapshot each service
 * returns), so a sale, a payment or a payroll action never hands a
 * branch-locked user other branches' bills, cash, payments, staff, payroll,
 * POs or stock history. Only the collections present in `data` are touched;
 * filtering is idempotent. Stock rows (quantities) and the cross-branch masters
 * (items, combos, customers, vendors) stay whole; stock history keeps the
 * branch's own movements and transfers are the ones into or out of it.
 */
export function scopePayload(data: any, user: SessionUser | null | undefined) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !user) return data;
  // The login/kiosk PIN is NEVER sent to any client (SEC2-2) — the kiosk verifies
  // it on the server now. Strip it for every role, including CEO.
  const stripPin = (arr: any) =>
    Array.isArray(arr) ? arr.map((e: any) => { const { pin, ...rest } = e || {}; return rest; }) : arr;

  if (user.role === 'CEO') return Array.isArray(data.employees) ? { ...data, employees: stripPin(data.employees) } : data;
  const branch = user.assignedBranchId;
  const byBranch = (arr: any) =>
    branch && Array.isArray(arr) ? arr.filter((r: any) => !r?.branchId || r.branchId === branch) : arr;
  const out: any = { ...data };
  for (const key of [
    'invoices', 'estimates', 'challans', 'enquiries', 'pendingOrders', 'reminders', 'cashRegisters',
    'recurringExpenses', 'purchaseOrders', 'attendanceRecords', 'payrollRecords', 'stockAdjustmentLogs',
  ]) {
    if (key in out) out[key] = byBranch(out[key]);
  }
  if (branch && Array.isArray(out.stockTransfers)) {
    out.stockTransfers = out.stockTransfers.filter((t: any) => t?.fromBranch === branch || t?.toBranch === branch);
  }
  if (Array.isArray(out.payments)) out.payments = maskStaffPayments(byBranch(out.payments), user);
  // SEC10-1: payroll rows are payroll data — only a payroll:admin receives them.
  if (Array.isArray(out.payrollRecords) && !roleCan(user.role, 'payroll:admin')) out.payrollRecords = [];
  if (Array.isArray(out.employees)) {
    out.employees = out.employees
      .filter((e: any) => !branch || e?.branchId === branch)
      .map((e: any) => {
        // Hide salary/incentive from non-CEO, and never expose the PIN.
        const { monthlySalary, incentivePercent, pin, ...safe } = e || {};
        return safe;
      });
  }
  return out;
}
const scopeBootstrap = scopePayload;

/**
 * SAL10-1: the bootstrap carries the RECENT window of bills and stock history
 * (the last 90 days, plus every older bill that still has money owing or was
 * changed in that window); the screens load the older pages right after the
 * first paint (GET /api/history), so every report and ledger is complete within
 * seconds without a 15 MB first load. `?full=1` returns everything at once.
 */
export const HISTORY_DAYS = 90;
function historyCutoff(): { date: string; iso: string } {
  const date = new Date(Date.parse(`${istToday()}T00:00:00Z`) - HISTORY_DAYS * 86400000).toISOString().slice(0, 10);
  return { date, iso: `${date}T00:00:00.000Z` };
}
const recentInvoicesWhere = (c: { date: string; iso: string }, branchId?: string | null) => ({
  ...(branchId ? { branchId } : {}),
  // (older bills with no stored due yet are included too — their due is worked out on screen)
  OR: [{ date: { gte: c.date } }, { balanceDue: { gt: 0.009 } }, { balanceDue: null }, { updatedAt: { gte: c.iso } }],
});

/** One page of the bills / stock history older than the bootstrap window. */
export async function getHistoryPage(user: SessionUser | null | undefined, q: Record<string, unknown>) {
  if (!user) throw new AppError('UNAUTHENTICATED', 'Login required', 401);
  const kind = String(q.kind || '');
  const page = Math.max(0, Math.floor(Number(q.page) || 0));
  const size = Math.min(2000, Math.max(100, Math.floor(Number(q.size) || 1000)));
  const c = historyCutoff();
  const branch = user.role === 'CEO' ? null : user.assignedBranchId || null;
  if (kind === 'invoices') {
    if (user.role === 'Sales' || user.role === 'Purchase') return { kind, invoices: [], nextPage: null };
    const rows = await prisma.invoice.findMany({
      where: { ...(branch ? { branchId: branch } : {}), date: { lt: c.date } },
      orderBy: [{ date: 'desc' }, { id: 'asc' }], skip: page * size, take: size,
    });
    return { kind, invoices: rows, nextPage: rows.length === size ? page + 1 : null };
  }
  if (kind === 'stockAdjustmentLogs') {
    if (user.role === 'Sales') return { kind, stockAdjustmentLogs: [], nextPage: null };
    const rows = await prisma.stockAdjustmentLog.findMany({
      where: { ...(branch ? { branchId: branch } : {}), timestamp: { lt: c.iso } },
      orderBy: [{ timestamp: 'desc' }, { id: 'asc' }], skip: page * size, take: size,
    });
    return { kind, stockAdjustmentLogs: rows, nextPage: rows.length === size ? page + 1 : null };
  }
  throw new AppError('BAD_REQUEST', "kind must be 'invoices' or 'stockAdjustmentLogs'", 400);
}

/** The per-item sales figures every role's low-stock rule uses (refreshed after sales). */
export async function itemStats() {
  const [itemSales90dV, itemLastSaleV] = await Promise.all([itemSales90d(), itemLastSale()]);
  return { itemSales90d: itemSales90dV, itemLastSale: itemLastSaleV };
}

/** Scoped ERP state payload matching role authorization. */
export async function getBootstrap(user?: SessionUser | null, q: Record<string, unknown> = {}) {
  const full = String(q?.full || '') === '1';
  const cut = historyCutoff();
  const historyFrom = full ? null : cut.date;
  if (!user) {
    throw new AppError('UNAUTHENTICATED', 'Login required to load ERP state', 401);
  }

  const role = user.role;
  const configRows = await prisma.appConfig.findMany();
  const config: Record<string, unknown> = {};
  for (const row of configRows) config[row.key] = row.value;

  // Base catalog accessible to all authenticated roles
  const [items, branchStocks, combos, salesByItem, lastSale] = await Promise.all([
    prisma.item.findMany(),
    prisma.branchStock.findMany(),
    prisma.comboItem.findMany(),
    itemSales90d(),
    itemLastSale(),
  ]);
  config.itemSales90d = salesByItem;
  config.itemLastSale = lastSale;

  // Sales role: Items and Enquiries only
  if (role === 'Sales') {
    const [enquiries, pendingOrders, reminders] = await Promise.all([
      prisma.enquiry.findMany(),
      prisma.pendingOrder.findMany(),
      prisma.followUpReminder.findMany(),
    ]);
    return {
      items, branchStocks, combos, stockAdjustmentLogs: [], estimates: [], challans: [], invoices: [],
      enquiries, pendingOrders, reminders, cashRegisters: [], recurringExpenses: [], vendors: [],
      purchaseOrders: [], employees: [], attendanceRecords: [], payrollRecords: [], customers: [],
      stockTransfers: [], payments: [], ...config,
    };
  }

  // Purchase role: Items, Inventory, Vendors, Purchase Orders, Enquiries.
  // Branch-locked: only the user's assigned branch's POs / pending orders are
  // delivered (server-side enforcement, not just UI — see R03-01).
  if (role === 'Purchase') {
    const branchScope = user.assignedBranchId ? { branchId: user.assignedBranchId } : {};
    const [vendors, purchaseOrders, enquiries, pendingOrders, history, vendorPayments] = await Promise.all([
      prisma.vendor.findMany(),
      prisma.purchaseOrder.findMany({ where: branchScope }).then((rows) => rows.map(stripAttachmentBodies)),
      prisma.enquiry.findMany({ where: branchScope }),
      prisma.pendingOrder.findMany({ where: branchScope }),
      branchStockHistory(user, full ? null : cut.iso),
      // PUR9-2: the supplier payments of the user's branch, so payables, supplier
      // advances and vendor statements are right for the Purchase role. Never
      // customer or salary rows.
      prisma.payment.findMany({ where: { type: 'out', partyType: 'vendor', ...branchScope } }),
    ]);
    return {
      items, branchStocks, combos, stockAdjustmentLogs: history.stockAdjustmentLogs, estimates: [], challans: [], invoices: [],
      enquiries, pendingOrders, reminders: [], cashRegisters: [], recurringExpenses: [], vendors,
      purchaseOrders, employees: [], attendanceRecords: [], payrollRecords: [], customers: [],
      stockTransfers: history.stockTransfers, payments: vendorPayments, ...config, historyFrom,
    };
  }

  // Billing role: Sales, Invoices, Customers, Cash Register, Estimates, Challans, Enquiries
  if (role === 'Billing') {
    const [
      estimates, challans, invoices, enquiries, pendingOrders, reminders,
      cashRegisters, customers, payments, history,
    ] = await Promise.all([
      prisma.estimate.findMany(), prisma.deliveryChallan.findMany(),
      prisma.invoice.findMany(full ? undefined : { where: recentInvoicesWhere(cut, user.assignedBranchId || null) }),
      prisma.enquiry.findMany(), prisma.pendingOrder.findMany(), prisma.followUpReminder.findMany(),
      prisma.dailyCashRegister.findMany(), prisma.customer.findMany(), prisma.payment.findMany(),
      branchStockHistory(user, full ? null : cut.iso),
    ]);
    return scopeBootstrap({
      items, branchStocks, combos, stockAdjustmentLogs: history.stockAdjustmentLogs, estimates, challans, invoices,
      enquiries, pendingOrders, reminders, cashRegisters: await registersWithLiveOpenings(prisma, cashRegisters), recurringExpenses: [], vendors: [],
      purchaseOrders: [], employees: [], attendanceRecords: [], payrollRecords: [], customers: await withLiveBillCounts(prisma, customers, { all: true }),
      stockTransfers: history.stockTransfers, payments, ...config, historyFrom,
    }, user);
  }

  // Manager & CEO: full operational data. Payroll is restricted to payroll:admin (CEO).
  const canPayroll = roleCan(role, 'payroll:admin');
  const lockBranch = role === 'CEO' ? null : user.assignedBranchId || null;
  const [
    stockAdjustmentLogs, estimates, challans, invoices, enquiries, pendingOrders, reminders,
    cashRegisters, recurringExpenses, vendors, purchaseOrders, employees, attendanceRecords,
    payrollRecords, customers, stockTransfers, payments,
  ] = await Promise.all([
    prisma.stockAdjustmentLog.findMany(full ? undefined : { where: { ...(lockBranch ? { branchId: lockBranch } : {}), timestamp: { gte: cut.iso } } }),
    prisma.estimate.findMany(), prisma.deliveryChallan.findMany(),
    prisma.invoice.findMany(full ? undefined : { where: recentInvoicesWhere(cut, lockBranch) }), prisma.enquiry.findMany(), prisma.pendingOrder.findMany(),
    prisma.followUpReminder.findMany(), prisma.dailyCashRegister.findMany(),
    prisma.recurringExpenseTemplate.findMany(), prisma.vendor.findMany(), prisma.purchaseOrder.findMany().then((rows) => rows.map(stripAttachmentBodies)),
    // M6: the selfie JPEGs (base64) are left OUT of the start-up payload — they
    // were hundreds of MB over time and loaded on every page open. The times and
    // locations still come through; a photo is fetched only when someone opens it
    // (GET /api/attendance/:id/photo).
    prisma.employee.findMany(), prisma.attendanceRecord.findMany({
      select: {
        id: true, employeeId: true, employeeName: true, branchId: true, date: true,
        checkInTime: true, checkInLocation: true, checkOutTime: true, checkOutLocation: true,
        hoursWorked: true, status: true, notes: true, createdAt: true, updatedAt: true,
        // checkInPhoto / checkOutPhoto are intentionally excluded (fetched on demand).
      },
    }),
    canPayroll ? prisma.payrollRecord.findMany() : Promise.resolve([]),
    prisma.customer.findMany(), prisma.stockTransfer.findMany(), prisma.payment.findMany(),
  ]);

  return scopeBootstrap({
    items, branchStocks, combos, stockAdjustmentLogs, estimates, challans, invoices,
    enquiries, pendingOrders, reminders, cashRegisters: await registersWithLiveOpenings(prisma, cashRegisters), recurringExpenses, vendors,
    purchaseOrders, employees, attendanceRecords, payrollRecords, customers: await withLiveBillCounts(prisma, customers, { all: true }), stockTransfers, payments, ...config, historyFrom,
  }, user);
}

export async function healthCheck() {
  await prisma.$queryRaw`SELECT 1`;
  return { status: 'ok', db: 'connected' };
}

export const getConfig = async (key: string) =>
  (await prisma.appConfig.findUnique({ where: { key } }))?.value ?? null;

export const setConfig = async (key: string, value: any) =>
  (await prisma.appConfig.upsert({ where: { key }, create: { key, value }, update: { value } })).value;

export const listBranchStock = () => prisma.branchStock.findMany();

export const upsertBranchStock = (row: any) =>
  prisma.branchStock.upsert({
    where: { itemId_branchId: { itemId: row.itemId, branchId: row.branchId } },
    create: row,
    update: row,
  });

export async function replaceBranchStock(rows: any[]) {
  await prisma.$transaction([
    prisma.branchStock.deleteMany({}),
    prisma.branchStock.createMany({ data: rows }),
  ]);
  return prisma.branchStock.findMany();
}

/**
 * SAL10-1: the rows a live-update event named, so a screen refreshes just those
 * instead of re-downloading the whole bootstrap. Each role gets only what its
 * bootstrap carries (and the router scopes the reply to the user's branch).
 */
export async function getSync(user: SessionUser | null | undefined, q: Record<string, unknown>) {
  if (!user) throw new AppError('UNAUTHENTICATED', 'Login required', 401);
  const list = (k: string, max = 500): string[] =>
    String(q[k] || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, max);
  const role = user.role;
  const seesSales = role !== 'Sales' && role !== 'Purchase';
  const stockKeys = list('stock').map((k) => { const i = k.lastIndexOf('@'); return { itemId: k.slice(0, i), branchId: k.slice(i + 1) }; }).filter((k) => k.itemId && k.branchId);
  const [invoices, customers, branchStocks, stockAdjustmentLogs, payments] = await Promise.all([
    seesSales && list('invoices').length ? prisma.invoice.findMany({ where: { id: { in: list('invoices') } } }) : Promise.resolve([]),
    seesSales && list('customers').length ? prisma.customer.findMany({ where: { id: { in: list('customers') } } }) : Promise.resolve([]),
    stockKeys.length ? prisma.branchStock.findMany({ where: { OR: stockKeys } }) : Promise.resolve([]),
    role !== 'Sales' && list('logs').length ? prisma.stockAdjustmentLog.findMany({ where: { id: { in: list('logs') } } }) : Promise.resolve([]),
    role !== 'Sales' && list('payments').length ? prisma.payment.findMany({ where: { id: { in: list('payments') } } }) : Promise.resolve([]),
  ]);
  return {
    delta: true, invoices, customers: await withLiveBillCounts(prisma, customers), branchStocks, stockAdjustmentLogs, // FIN-A-5
    payments: seesSales ? payments : payments.filter((p: any) => p.type === 'out' && p.partyType === 'vendor'),
  };
}
