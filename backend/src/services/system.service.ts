import { registersWithLiveOpenings } from './cash.service.js';
import { maskStaffPayments } from './payment.service.js';
import { prisma } from '../db.js';
import { AppError } from '../middleware/errorHandler.js';
import { SessionUser, roleCan } from '../lib/auth.js';
import { istToday } from '../lib/businessDate.js';

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
 * Stock history and transfers a branch-locked Billing/Purchase user may read:
 * their own branch's movements, and transfers into or out of it (INV7-2 — the
 * Stock Audit Trail and Transfer History screens were empty for them).
 */
export async function branchStockHistory(user: SessionUser) {
  const branch = user.assignedBranchId || null;
  const [stockAdjustmentLogs, stockTransfers] = await Promise.all([
    prisma.stockAdjustmentLog.findMany(branch ? { where: { branchId: branch } } : undefined),
    prisma.stockTransfer.findMany(branch ? { where: { OR: [{ fromBranch: branch }, { toBranch: branch }] } } : undefined),
  ]);
  return { stockAdjustmentLogs, stockTransfers };
}

/**
 * Restrict a bootstrap payload to a non-CEO user's own branch, and strip
 * salary/PIN from employees (SEC2-1 reads + SEC2-2). CEO is cross-branch and
 * sees everything. Stock rows/transfers are left unfiltered so branch transfers
 * still work; the sensitive leaks (other branches' invoices/cash/payments and
 * every employee's salary & PIN) are closed.
 */
function scopeBootstrap(data: any, user: SessionUser) {
  // The login/kiosk PIN is NEVER sent to any client (SEC2-2) — the kiosk verifies
  // it on the server now. Strip it for every role, including CEO.
  const stripPin = (arr: any) =>
    Array.isArray(arr) ? arr.map((e: any) => { const { pin, ...rest } = e; return rest; }) : arr;

  if (user.role === 'CEO') return { ...data, employees: stripPin(data.employees) };
  const branch = user.assignedBranchId;
  const byBranch = (arr: any) =>
    branch && Array.isArray(arr) ? arr.filter((r: any) => !r?.branchId || r.branchId === branch) : arr;
  const employees = Array.isArray(data.employees)
    ? data.employees
        .filter((e: any) => !branch || e.branchId === branch)
        .map((e: any) => {
          // Hide salary/incentive from non-CEO, and never expose the PIN.
          const { monthlySalary, incentivePercent, pin, ...safe } = e;
          return safe;
        })
    : data.employees;
  return {
    ...data,
    invoices: byBranch(data.invoices),
    estimates: byBranch(data.estimates),
    challans: byBranch(data.challans),
    enquiries: byBranch(data.enquiries),
    pendingOrders: byBranch(data.pendingOrders),
    reminders: byBranch(data.reminders),
    cashRegisters: byBranch(data.cashRegisters),
    recurringExpenses: byBranch(data.recurringExpenses),
    purchaseOrders: byBranch(data.purchaseOrders),
    payments: Array.isArray(data.payments) ? maskStaffPayments(byBranch(data.payments), user) : data.payments,
    employees,
  };
}

/** Scoped ERP state payload matching role authorization. */
export async function getBootstrap(user?: SessionUser | null) {
  if (!user) {
    throw new AppError('UNAUTHENTICATED', 'Login required to load ERP state', 401);
  }

  const role = user.role;
  const configRows = await prisma.appConfig.findMany();
  const config: Record<string, unknown> = {};
  for (const row of configRows) config[row.key] = row.value;

  // Base catalog accessible to all authenticated roles
  const [items, branchStocks, combos, salesByItem] = await Promise.all([
    prisma.item.findMany(),
    prisma.branchStock.findMany(),
    prisma.comboItem.findMany(),
    itemSales90d(),
  ]);
  config.itemSales90d = salesByItem;

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
    const [vendors, purchaseOrders, enquiries, pendingOrders, history] = await Promise.all([
      prisma.vendor.findMany(),
      prisma.purchaseOrder.findMany({ where: branchScope }),
      prisma.enquiry.findMany({ where: branchScope }),
      prisma.pendingOrder.findMany({ where: branchScope }),
      branchStockHistory(user),
    ]);
    return {
      items, branchStocks, combos, stockAdjustmentLogs: history.stockAdjustmentLogs, estimates: [], challans: [], invoices: [],
      enquiries, pendingOrders, reminders: [], cashRegisters: [], recurringExpenses: [], vendors,
      purchaseOrders, employees: [], attendanceRecords: [], payrollRecords: [], customers: [],
      stockTransfers: history.stockTransfers, payments: [], ...config,
    };
  }

  // Billing role: Sales, Invoices, Customers, Cash Register, Estimates, Challans, Enquiries
  if (role === 'Billing') {
    const [
      estimates, challans, invoices, enquiries, pendingOrders, reminders,
      cashRegisters, customers, payments, history,
    ] = await Promise.all([
      prisma.estimate.findMany(), prisma.deliveryChallan.findMany(), prisma.invoice.findMany(),
      prisma.enquiry.findMany(), prisma.pendingOrder.findMany(), prisma.followUpReminder.findMany(),
      prisma.dailyCashRegister.findMany(), prisma.customer.findMany(), prisma.payment.findMany(),
      branchStockHistory(user),
    ]);
    return scopeBootstrap({
      items, branchStocks, combos, stockAdjustmentLogs: history.stockAdjustmentLogs, estimates, challans, invoices,
      enquiries, pendingOrders, reminders, cashRegisters: await registersWithLiveOpenings(prisma, cashRegisters), recurringExpenses: [], vendors: [],
      purchaseOrders: [], employees: [], attendanceRecords: [], payrollRecords: [], customers,
      stockTransfers: history.stockTransfers, payments, ...config,
    }, user);
  }

  // Manager & CEO: full operational data. Payroll is restricted to payroll:admin (CEO).
  const canPayroll = roleCan(role, 'payroll:admin');
  const [
    stockAdjustmentLogs, estimates, challans, invoices, enquiries, pendingOrders, reminders,
    cashRegisters, recurringExpenses, vendors, purchaseOrders, employees, attendanceRecords,
    payrollRecords, customers, stockTransfers, payments,
  ] = await Promise.all([
    prisma.stockAdjustmentLog.findMany(), prisma.estimate.findMany(), prisma.deliveryChallan.findMany(),
    prisma.invoice.findMany(), prisma.enquiry.findMany(), prisma.pendingOrder.findMany(),
    prisma.followUpReminder.findMany(), prisma.dailyCashRegister.findMany(),
    prisma.recurringExpenseTemplate.findMany(), prisma.vendor.findMany(), prisma.purchaseOrder.findMany(),
    prisma.employee.findMany(), prisma.attendanceRecord.findMany(),
    canPayroll ? prisma.payrollRecord.findMany() : Promise.resolve([]),
    prisma.customer.findMany(), prisma.stockTransfer.findMany(), prisma.payment.findMany(),
  ]);

  return scopeBootstrap({
    items, branchStocks, combos, stockAdjustmentLogs, estimates, challans, invoices,
    enquiries, pendingOrders, reminders, cashRegisters: await registersWithLiveOpenings(prisma, cashRegisters), recurringExpenses, vendors,
    purchaseOrders, employees, attendanceRecords, payrollRecords, customers, stockTransfers, payments, ...config,
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
