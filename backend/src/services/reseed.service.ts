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
    prisma.customer.deleteMany(), prisma.stockTransfer.deleteMany(),
    // Clear payments + audit trail too, otherwise old receipts survive a reset and
    // their receipt numbers collide with a freshly reseeded sequence (CRM2-15).
    prisma.payment.deleteMany(), prisma.auditLog.deleteMany(), prisma.appConfig.deleteMany(),
  ]);

  await prisma.item.createMany({ data: INITIAL_ITEMS as any });
  await prisma.branchStock.createMany({ data: INITIAL_BRANCH_STOCKS as any });
  await prisma.comboItem.createMany({ data: INITIAL_COMBOS as any });

  // STK-3: every seeded opening balance needs a matching 'Opening Stock' history
  // row, so the stock-movement ledger reconciles to actual stock from day one
  // (sales and PO receipts already write history). The opening quantity is the
  // current seeded stock MINUS the net of the other seeded movements for that
  // item/branch — so replaying (opening + movements) lands back on the seeded
  // quantity instead of double-counting those demo events.
  const itemMetaById = new Map((INITIAL_ITEMS as any[]).map((i) => [i.id, i]));
  const netSeedMovement = new Map<string, number>();
  for (const log of INITIAL_STOCK_ADJUSTMENT_LOGS as any[]) {
    const k = `${log.itemId}|${log.branchId}`;
    netSeedMovement.set(k, (netSeedMovement.get(k) || 0) + (Number(log.quantityChange) || 0));
  }
  const openingLogs = (INITIAL_BRANCH_STOCKS as any[])
    .map((s) => {
      const openingQty = Math.round(((Number(s.quantity) || 0) - (netSeedMovement.get(`${s.itemId}|${s.branchId}`) || 0)) * 100) / 100;
      const meta = itemMetaById.get(s.itemId);
      return { s, openingQty, meta };
    })
    .filter((x) => x.openingQty !== 0)
    .map(({ s, openingQty, meta }) => ({
      id: `adj-open-${s.branchId}-${s.itemId}`,
      itemId: s.itemId,
      itemName: meta?.itemName || 'Item',
      itemCode: meta?.itemCode || '',
      branchId: s.branchId,
      previousQuantity: 0,
      quantityChange: openingQty,
      newQuantity: openingQty,
      reason: 'Opening Stock',
      notes: 'Opening balance at go-live',
      adjustedBy: 'System (Opening Balance)',
      // Dated before the demo movement events so a chronological replay starts here.
      timestamp: '2025-04-01T00:00:00.000Z',
    }));

  await prisma.stockAdjustmentLog.createMany({ data: INITIAL_STOCK_ADJUSTMENT_LOGS as any });
  if (openingLogs.length) await prisma.stockAdjustmentLog.createMany({ data: openingLogs as any });
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

/**
 * First-boot seeding for a fresh deploy: if the database is completely empty
 * (no items and no config), load the starter dataset so dropdowns, settings and
 * the access matrix exist and the app is usable immediately. Idempotent — does
 * nothing once any data exists. Disable with SEED_ON_EMPTY=false.
 */
export async function ensureSeedData(): Promise<boolean> {
  if (process.env.SEED_ON_EMPTY === 'false') return false;
  const [itemCount, configCount] = await Promise.all([
    prisma.item.count(),
    prisma.appConfig.count(),
  ]);
  if (itemCount === 0 && configCount === 0) {
    await reseedDatabase();
    return true;
  }
  return false;
}
