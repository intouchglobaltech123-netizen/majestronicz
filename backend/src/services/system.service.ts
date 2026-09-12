import { prisma } from '../db.js';

/** Full ERP state in one payload (matches the frontend's expected state shape). */
export async function getBootstrap() {
  const [
    items, branchStocks, combos, stockAdjustmentLogs, estimates, challans, invoices,
    enquiries, pendingOrders, reminders, cashRegisters, recurringExpenses, vendors,
    purchaseOrders, employees, attendanceRecords, payrollRecords, customers, stockTransfers, configRows,
  ] = await Promise.all([
    prisma.item.findMany(), prisma.branchStock.findMany(), prisma.comboItem.findMany(),
    prisma.stockAdjustmentLog.findMany(), prisma.estimate.findMany(), prisma.deliveryChallan.findMany(),
    prisma.invoice.findMany(), prisma.enquiry.findMany(), prisma.pendingOrder.findMany(),
    prisma.followUpReminder.findMany(), prisma.dailyCashRegister.findMany(),
    prisma.recurringExpenseTemplate.findMany(), prisma.vendor.findMany(), prisma.purchaseOrder.findMany(),
    prisma.employee.findMany(), prisma.attendanceRecord.findMany(), prisma.payrollRecord.findMany(),
    prisma.customer.findMany(), prisma.stockTransfer.findMany(), prisma.appConfig.findMany(),
  ]);
  const config: Record<string, unknown> = {};
  for (const row of configRows) config[row.key] = row.value;
  return {
    items, branchStocks, combos, stockAdjustmentLogs, estimates, challans, invoices,
    enquiries, pendingOrders, reminders, cashRegisters, recurringExpenses, vendors,
    purchaseOrders, employees, attendanceRecords, payrollRecords, customers, stockTransfers, ...config,
  };
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
