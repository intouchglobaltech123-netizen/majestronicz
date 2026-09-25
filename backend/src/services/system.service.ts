import { prisma } from '../db.js';
import { AppError } from '../middleware/errorHandler.js';
import { SessionUser, roleCan } from '../lib/auth.js';

/**
 * Restrict a bootstrap payload to a non-CEO user's own branch, and strip
 * salary/PIN from employees (SEC2-1 reads + SEC2-2). CEO is cross-branch and
 * sees everything. Stock rows/transfers are left unfiltered so branch transfers
 * still work; the sensitive leaks (other branches' invoices/cash/payments and
 * every employee's salary & PIN) are closed.
 */
function scopeBootstrap(data: any, user: SessionUser) {
  if (user.role === 'CEO') return data;
  const branch = user.assignedBranchId;
  const byBranch = (arr: any) =>
    branch && Array.isArray(arr) ? arr.filter((r: any) => !r?.branchId || r.branchId === branch) : arr;
  const employees = Array.isArray(data.employees)
    ? data.employees
        .filter((e: any) => !branch || e.branchId === branch)
        .map((e: any) => {
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
    payments: byBranch(data.payments),
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
  const [items, branchStocks, combos] = await Promise.all([
    prisma.item.findMany(),
    prisma.branchStock.findMany(),
    prisma.comboItem.findMany(),
  ]);

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
    const [vendors, purchaseOrders, enquiries, pendingOrders] = await Promise.all([
      prisma.vendor.findMany(),
      prisma.purchaseOrder.findMany({ where: branchScope }),
      prisma.enquiry.findMany({ where: branchScope }),
      prisma.pendingOrder.findMany({ where: branchScope }),
    ]);
    return {
      items, branchStocks, combos, stockAdjustmentLogs: [], estimates: [], challans: [], invoices: [],
      enquiries, pendingOrders, reminders: [], cashRegisters: [], recurringExpenses: [], vendors,
      purchaseOrders, employees: [], attendanceRecords: [], payrollRecords: [], customers: [],
      stockTransfers: [], payments: [], ...config,
    };
  }

  // Billing role: Sales, Invoices, Customers, Cash Register, Estimates, Challans, Enquiries
  if (role === 'Billing') {
    const [
      estimates, challans, invoices, enquiries, pendingOrders, reminders,
      cashRegisters, customers, payments,
    ] = await Promise.all([
      prisma.estimate.findMany(), prisma.deliveryChallan.findMany(), prisma.invoice.findMany(),
      prisma.enquiry.findMany(), prisma.pendingOrder.findMany(), prisma.followUpReminder.findMany(),
      prisma.dailyCashRegister.findMany(), prisma.customer.findMany(), prisma.payment.findMany(),
    ]);
    return scopeBootstrap({
      items, branchStocks, combos, stockAdjustmentLogs: [], estimates, challans, invoices,
      enquiries, pendingOrders, reminders, cashRegisters, recurringExpenses: [], vendors: [],
      purchaseOrders: [], employees: [], attendanceRecords: [], payrollRecords: [], customers,
      stockTransfers: [], payments, ...config,
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
    enquiries, pendingOrders, reminders, cashRegisters, recurringExpenses, vendors,
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
