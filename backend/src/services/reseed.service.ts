import { prisma } from '../db.js';
import {
  INITIAL_CATEGORIES, INITIAL_SUBCATEGORIES, INITIAL_ITEMS, INITIAL_BRANCH_STOCKS,
  INITIAL_ESTIMATES, INITIAL_CHALLANS, INITIAL_INVOICES, INITIAL_REMINDERS, INITIAL_ENQUIRIES,
  INITIAL_PENDING_ORDERS, INITIAL_DAILY_CASH_REGISTERS, INITIAL_VENDORS, INITIAL_PURCHASE_ORDERS,
  INITIAL_EMPLOYEES, INITIAL_ATTENDANCE_RECORDS, INITIAL_PAYROLL_SETTINGS, INITIAL_PAYROLL_RECORDS,
  INITIAL_STOCK_ADJUSTMENT_LOGS, INITIAL_COMBOS, INITIAL_RECURRING_EXPENSE_TEMPLATES,
  INITIAL_CUSTOMERS, INITIAL_LOYALTY_SETTINGS,
} from '../data/seedData.js';
import { STANDARD_UNITS, GST_RATES, PAYMENT_TERMS_OPTIONS } from '../lib/constants.js';
import { buildDefaultMatrix } from '../lib/auth.js';

/**
 * Resets the database to the demo dataset. Shared by the CLI seed script and
 * the "Reset Demo Data" admin endpoint — the seed data lives on the backend,
 * never shipped as runtime data in the frontend bundle.
 */
export async function reseedDatabase() {
  await prisma.$transaction([
    prisma.item.deleteMany(), prisma.branchStock.deleteMany(), prisma.comboItem.deleteMany(),
    prisma.stockAdjustmentLog.deleteMany(), prisma.estimate.deleteMany(), prisma.deliveryChallan.deleteMany(),
    prisma.invoice.deleteMany(), prisma.enquiry.deleteMany(), prisma.pendingOrder.deleteMany(),
    prisma.followUpReminder.deleteMany(), prisma.dailyCashRegister.deleteMany(),
    prisma.recurringExpenseTemplate.deleteMany(), prisma.vendor.deleteMany(), prisma.purchaseOrder.deleteMany(),
    prisma.employee.deleteMany(), prisma.attendanceRecord.deleteMany(), prisma.payrollRecord.deleteMany(),
    prisma.customer.deleteMany(), prisma.stockTransfer.deleteMany(), prisma.appConfig.deleteMany(),
  ]);

  await prisma.item.createMany({ data: INITIAL_ITEMS as any });
  await prisma.branchStock.createMany({ data: INITIAL_BRANCH_STOCKS as any });
  await prisma.comboItem.createMany({ data: INITIAL_COMBOS as any });
  await prisma.stockAdjustmentLog.createMany({ data: INITIAL_STOCK_ADJUSTMENT_LOGS as any });
  await prisma.estimate.createMany({ data: INITIAL_ESTIMATES as any });
  await prisma.deliveryChallan.createMany({ data: INITIAL_CHALLANS as any });
  await prisma.invoice.createMany({ data: INITIAL_INVOICES as any });
  await prisma.enquiry.createMany({ data: INITIAL_ENQUIRIES as any });
  await prisma.pendingOrder.createMany({ data: INITIAL_PENDING_ORDERS as any });
  await prisma.followUpReminder.createMany({ data: INITIAL_REMINDERS as any });
  await prisma.dailyCashRegister.createMany({ data: INITIAL_DAILY_CASH_REGISTERS as any });
  await prisma.recurringExpenseTemplate.createMany({ data: INITIAL_RECURRING_EXPENSE_TEMPLATES as any });
  await prisma.vendor.createMany({ data: INITIAL_VENDORS as any });
  await prisma.purchaseOrder.createMany({ data: INITIAL_PURCHASE_ORDERS as any });
  await prisma.employee.createMany({ data: INITIAL_EMPLOYEES as any });
  await prisma.attendanceRecord.createMany({ data: INITIAL_ATTENDANCE_RECORDS as any });
  await prisma.payrollRecord.createMany({ data: INITIAL_PAYROLL_RECORDS as any });
  await prisma.customer.createMany({ data: INITIAL_CUSTOMERS as any });

  await prisma.appConfig.createMany({
    data: [
      { key: 'categories', value: INITIAL_CATEGORIES as any },
      { key: 'subcategoriesByCategory', value: INITIAL_SUBCATEGORIES as any },
      { key: 'categoryPrefixMap', value: {} },
      { key: 'subcategoryPrefixMap', value: {} },
      { key: 'unitsList', value: STANDARD_UNITS as any },
      { key: 'gstSlabsList', value: GST_RATES as any },
      { key: 'paymentTermsOptions', value: PAYMENT_TERMS_OPTIONS as any },
      { key: 'loyaltySettings', value: INITIAL_LOYALTY_SETTINGS as any },
      { key: 'payrollSettings', value: INITIAL_PAYROLL_SETTINGS as any },
      { key: 'inventorySettings', value: { deadStockThresholdDays: 90 } },
      { key: 'accessMatrix', value: buildDefaultMatrix() as any },
    ],
  });
}
