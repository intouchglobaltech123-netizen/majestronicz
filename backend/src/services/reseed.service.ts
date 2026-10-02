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
import { buildDefaultMatrix, hashPin, isPinHashed } from '../lib/auth.js';
import { buildOpeningStockRows } from '../lib/openingStock.js';
import { provisionUserEmployees } from './user.service.js';
import { cleanPhone } from '../lib/stockLedger.js';
import { istDateOf } from '../lib/businessDate.js';
import { legacyRefundId } from '../lib/returnRefunds.js';

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
  const openingLogs = buildOpeningStockRows(
    INITIAL_BRANCH_STOCKS as any[],
    INITIAL_STOCK_ADJUSTMENT_LOGS as any[],
    INITIAL_ITEMS as any[],
    {
      idFor: (branchId, itemId) => `adj-open-${branchId}-${itemId}`,
      // Dated before the demo movement events so a chronological replay starts here.
      timestampFor: () => '2025-04-01T00:00:00.000Z',
      notes: 'Opening balance at go-live',
      adjustedBy: 'System (Opening Balance)',
    },
  );

  // INV8-9: the demo movement rows carried hand-written before/after figures
  // ("12 → 14") that contradicted the opening rows above (item-001 opens at 43
  // and ends at 45). Replay each item/branch from its opening balance in time
  // order and restate every row's before/after, so the history reads as one
  // continuous balance that ends on the seeded stock.
  const running = new Map<string, number>();
  for (const o of openingLogs) running.set(`${o.itemId}|${o.branchId}`, Number(o.quantityChange) || 0);
  const demoLogs = [...(INITIAL_STOCK_ADJUSTMENT_LOGS as any[])]
    .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')))
    .map((log) => {
      const k = `${log.itemId}|${log.branchId}`;
      const prev = running.get(k) || 0;
      const next = Math.round((prev + (Number(log.quantityChange) || 0)) * 100) / 100;
      running.set(k, next);
      return { ...log, previousQuantity: prev, newQuantity: next };
    });

  await prisma.stockAdjustmentLog.createMany({ data: demoLogs as any });
  if (openingLogs.length) await prisma.stockAdjustmentLog.createMany({ data: openingLogs as any });
  // Quotations carry their lifecycle status (SAL9-14): none of the demo ones became a bill.
  await prisma.estimate.createMany({ data: (INITIAL_ESTIMATES as any[]).map((e) => ({ status: 'Open', ...e })) as any });
  await prisma.deliveryChallan.createMany({ data: INITIAL_CHALLANS as any });
  const seeded = seedLedger();
  await prisma.invoice.createMany({ data: seeded.invoices as any });
  if (seeded.payments.length) await prisma.payment.createMany({ data: seeded.payments as any });
  await prisma.enquiry.createMany({ data: INITIAL_ENQUIRIES as any });
  await prisma.pendingOrder.createMany({ data: INITIAL_PENDING_ORDERS as any });
  await prisma.followUpReminder.createMany({ data: INITIAL_REMINDERS as any });
  await prisma.dailyCashRegister.createMany({ data: INITIAL_DAILY_CASH_REGISTERS as any });
  await prisma.recurringExpenseTemplate.createMany({ data: INITIAL_RECURRING_EXPENSE_TEMPLATES as any });
  await prisma.vendor.createMany({ data: INITIAL_VENDORS as any });
  await prisma.purchaseOrder.createMany({ data: INITIAL_PURCHASE_ORDERS as any });
  // SEC10-2: demo kiosk PINs are stored hashed, never as plain text.
  await prisma.employee.createMany({ data: (INITIAL_EMPLOYEES as any[]).map((e) => ({ ...e, pin: e.pin && !isPinHashed(e.pin) ? hashPin(e.pin) : e.pin })) });
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
      // The demo data below is already in the shape the one-time data fix
      // produces, so a fresh seed needs no fix (UPG9-11 / SAL9-8).
      { key: 'migration:fix-existing-bills', value: { runs: [], seededAlreadyCorrect: true } as any },
    ],
  });

  // HRM3-8: the reset wiped every employee, including the attendance profiles
  // linked to staff logins, so e.g. Billing got "No attendance profile" on
  // self check-in until the server restarted. Re-link them now (a no-op when
  // there are no logins yet, as on the very first seed).
  await provisionUserEmployees();
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

/**
 * The demo bills as this release records them (UPG9-11), so a fresh seed /
 * Reset Demo Data needs no run of scripts/fix-existing-bills.ts:
 *   - each bill is linked to its customer by phone (as a sale save would);
 *   - the payment split is frozen as collected at billing, with creditOriginal
 *     and the due worked out from it;
 *   - each line carries its cost at sale time (`unitCost`, E2E5-5);
 *   - the older return on 7311 has the cash refund of its over-paid part
 *     (₹5,000 paid, ₹4,012 returned on ₹8,024 → ₹988 back), under the same id
 *     the one-time script would give it;
 *   - each salary marked Paid has its Payment 'out' row.
 */
function seedLedger(): { invoices: any[]; payments: any[] } {
  const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
  const byPhone = new Map((INITIAL_CUSTOMERS as any[]).map((c) => [cleanPhone(c.phone), c]));
  const cost = new Map((INITIAL_ITEMS as any[]).map((i) => [i.id, Number(i.purchasePrice) || 0]));
  const payments: any[] = [];
  let payNo = 0;
  const nextPay = (date: string) => `PAY-${date.slice(0, 7).replace('-', '')}-${String(++payNo).padStart(4, '0')}`;
  const invoices = (INITIAL_INVOICES as any[]).map((src) => {
    const inv: any = JSON.parse(JSON.stringify(src));
    const G = r2(inv.grandTotal);
    const cust: any = inv.customerId ? null : byPhone.get(cleanPhone(inv.customerPhone));
    if (cust) inv.customerId = cust.id;
    inv.items = (inv.items || []).map((li: any) => ({
      ...li,
      unitCost: li.unitCost ?? (li.isCombo
        ? r2(((li.comboComponents as any[]) || []).reduce((t, c) => t + (Number(c.quantity) || 0) * (cost.get(c.itemId) || 0), 0))
        : cost.get(li.itemId) ?? 0),
    }));
    if (!Array.isArray(inv.paymentSplits) || !inv.paymentSplits.length) {
      const partial = Number(inv.partialAmount) || 0;
      const c0 = inv.isPartialPayment && partial > 0 ? Math.min(G, partial) : inv.paymentMode === 'COD-Credit' ? 0 : G;
      const owed = r2(G - c0);
      inv.paymentSplits = [
        ...(c0 > 0 ? [{ mode: !inv.paymentMode || inv.paymentMode === 'COD-Credit' ? 'Cash' : inv.paymentMode, amount: c0 }] : []),
        ...(owed > 0 ? [{ mode: 'COD-Credit', amount: owed }] : []),
      ];
      inv.partialAmount = owed > 0 ? c0 : null;
      inv.isPartialPayment = owed > 0 && c0 > 0;
      inv.creditOriginal = owed;
    }
    const c0 = r2(G - (Number(inv.creditOriginal) || 0));
    // Returns made before refunds were recorded were paid back in cash: the
    // over-paid part of each, on the return day.
    let returned = 0;
    let refunded = 0;
    for (const r of (inv.returns as any[]) || []) {
      returned = r2(returned + (Number(r.refundAmount) || 0));
      const back = Math.max(0, r2(c0 - refunded - (G - returned)));
      if (back <= 0) continue;
      const date = istDateOf(r.returnedAt);
      payments.push({
        id: legacyRefundId(inv.id, r.returnedAt), receiptNumber: nextPay(date), type: 'out', partyType: 'customer',
        partyId: inv.customerId ?? null, partyName: inv.customerName || 'Customer', branchId: inv.branchId, date, amount: back,
        paymentMode: 'Cash', reference: inv.invoiceNumber, notes: `Refund on sale #${inv.invoiceNumber} — ${r.reason || 'return'}`,
        allocations: [{ refId: inv.id, refNumber: inv.invoiceNumber, amount: back }], createdById: null,
        createdByName: r.processedBy || 'System', createdAt: r.returnedAt,
      });
      refunded = r2(refunded + back);
    }
    inv.balanceDue = Math.max(0, r2((Number(inv.creditOriginal) || 0) - returned + refunded));
    return inv;
  });
  for (const row of INITIAL_PAYROLL_RECORDS as any[]) {
    if (row.status !== 'Paid' || !(Number(row.finalPayable) > 0)) continue;
    const emp: any = (INITIAL_EMPLOYEES as any[]).find((e) => e.id === row.employeeId);
    const date = istDateOf(row.paidAt || row.updatedAt);
    const amount = r2(row.finalPayable);
    payments.push({
      id: `pay-seed-salary-${row.id}`, receiptNumber: nextPay(date), type: 'out', partyType: 'staff', partyId: row.employeeId,
      partyName: row.employeeName || emp?.name || 'Staff', branchId: emp?.branchId || row.branchId, date, amount,
      paymentMode: /cash/i.test(String(row.paymentMode || 'Cash')) ? 'Cash' : String(row.paymentMode), reference: row.paymentReference ?? null,
      notes: `Salary for ${row.month}`, allocations: [{ refId: row.id, refNumber: row.month, amount }], createdById: null,
      createdByName: 'System', createdAt: row.paidAt || row.updatedAt,
    });
  }
  return { invoices, payments };
}
