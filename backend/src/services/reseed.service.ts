import { prisma } from '../db.js';
import {
  INITIAL_CATEGORIES, INITIAL_SUBCATEGORIES, INITIAL_ITEMS, INITIAL_BRANCH_STOCKS,
  INITIAL_ESTIMATES, INITIAL_CHALLANS, INITIAL_INVOICES, INITIAL_REMINDERS, INITIAL_ENQUIRIES,
  INITIAL_PENDING_ORDERS, INITIAL_DAILY_CASH_REGISTERS, INITIAL_VENDORS, INITIAL_PURCHASE_ORDERS,
  INITIAL_EMPLOYEES, INITIAL_ATTENDANCE_RECORDS, INITIAL_PAYROLL_SETTINGS, INITIAL_PAYROLL_RECORDS,
  INITIAL_STOCK_ADJUSTMENT_LOGS, INITIAL_COMBOS, INITIAL_RECURRING_EXPENSE_TEMPLATES,
  INITIAL_CUSTOMERS, INITIAL_LOYALTY_SETTINGS,
} from '../data/seedData.js';
import { IMPORTED_CATALOG } from '../data/importedCatalog.js';
import { STANDARD_UNITS, GST_RATES, PAYMENT_TERMS_OPTIONS } from '../lib/constants.js';
import { buildDefaultMatrix, hashPin, isPinHashed, setLiveMatrix } from '../lib/auth.js';
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
    prisma.recurringExpenseTemplate.deleteMany(), prisma.vendor.deleteMany(), prisma.poAttachment.deleteMany(), prisma.purchaseOrder.deleteMany(),
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
  // SEC10-4: the server's live (in-memory) rights follow the reset matrix at once.
  setLiveMatrix(buildDefaultMatrix());

  // HRM3-8: the reset wiped every employee, including the attendance profiles
  // linked to staff logins, so e.g. Billing got "No attendance profile" on
  // self check-in until the server restarted. Re-link them now (a no-op when
  // there are no logins yet, as on the very first seed).
  await provisionUserEmployees();
}

/**
 * ONE-TIME production go-live: wipe every piece of business/demo data but KEEP
 * the staff logins (the User table, which no reset ever touches), then load ONLY
 * the client's real catalog (backend/src/data/importedCatalog.ts, imported from
 * their Vyapar export) with opening stock at one branch. Config singletons
 * (categories, units, GST slabs, access matrix, settings) are rebuilt so the app
 * stays usable; categories come from the imported items.
 *
 * Destructive and irreversible — guarded behind CEO + (in production)
 * ALLOW_RESET_TO_CATALOG=true at the route. The opening-stock branch defaults to
 * 'erode-hq' and can be overridden with CATALOG_BRANCH.
 */
export async function resetToCatalog(): Promise<{ items: number; vendors: number; branchId: string }> {
  const branchId = process.env.CATALOG_BRANCH || 'erode-hq';
  const now = new Date().toISOString();

  // Preserve the official GST invoice-series start across the reset (the config
  // is wiped below with the rest of appConfig). Without this, a reset would send
  // bill numbering back to the 7307 default instead of the shop's real series.
  const seriesCfg = (await prisma.appConfig.findUnique({ where: { key: 'invoiceSeriesStart' } }))?.value as any;

  // Same wipe as the demo reset — note User is deliberately NOT in this list, so
  // every staff login survives. appConfig is cleared and rebuilt below.
  await prisma.$transaction([
    prisma.item.deleteMany(), prisma.branchStock.deleteMany(), prisma.comboItem.deleteMany(),
    prisma.stockAdjustmentLog.deleteMany(), prisma.estimate.deleteMany(), prisma.deliveryChallan.deleteMany(),
    prisma.invoice.deleteMany(), prisma.enquiry.deleteMany(), prisma.pendingOrder.deleteMany(),
    prisma.followUpReminder.deleteMany(), prisma.dailyCashRegister.deleteMany(),
    prisma.recurringExpenseTemplate.deleteMany(), prisma.vendor.deleteMany(), prisma.poAttachment.deleteMany(), prisma.purchaseOrder.deleteMany(),
    prisma.employee.deleteMany(), prisma.attendanceRecord.deleteMany(), prisma.payrollRecord.deleteMany(),
    prisma.customer.deleteMany(), prisma.stockTransfer.deleteMany(),
    prisma.payment.deleteMany(), prisma.auditLog.deleteMany(), prisma.appConfig.deleteMany(),
    prisma.shopifySyncLog.deleteMany(),
  ]);

  // Build catalog rows. The item code is unique, so derive a stable id from it.
  const idFor = (code: string) => `item-${code.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`;

  // ── Vendor master from the sheet's Primary/Secondary Vendor names ──
  // Distinct, non-blank names become Vendor records; each item is linked to its
  // suppliers (primary first) with the supplier's own product code on the primary.
  const vendorIdFor = (name: string) => `vnd-${name.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`.replace(/-+$/,'');
  const vendorNames = new Set<string>();
  for (const it of IMPORTED_CATALOG) {
    const p = (it.primaryVendor || '').trim();
    const s = (it.secondaryVendor || '').trim();
    if (p) vendorNames.add(p);
    if (s) vendorNames.add(s);
  }
  const vendorRows = [...vendorNames].sort().map((name) => ({
    id: vendorIdFor(name), vendorName: name, contactNo: '', address: '', gstin: null as string | null,
    createdAt: now, updatedAt: now,
  }));

  const items = IMPORTED_CATALOG.map((it) => {
    const p = (it.primaryVendor || '').trim();
    const s = (it.secondaryVendor || '').trim();
    const code = (it.vendorCode || '').trim();
    // vendors[] — primary first (carries the supplier product code), then secondary.
    const vendors: { vendorId: string; vendorName: string; vendorCode?: string }[] = [];
    if (p) vendors.push({ vendorId: vendorIdFor(p), vendorName: p, ...(code ? { vendorCode: code } : {}) });
    if (s) vendors.push({ vendorId: vendorIdFor(s), vendorName: s });
    return {
      id: idFor(it.itemCode),
      itemName: it.itemName,
      itemHSN: it.itemHSN || '',
      category: it.category,
      subcategory: it.subcategory || null,
      itemCode: it.itemCode,
      unit: it.unit,
      salePrice: it.salePrice,
      salePriceTaxMode: it.salePriceTaxMode,
      wholesalePrice: it.wholesalePrice,
      minWholesaleQty: it.minWholesaleQty,
      purchasePrice: it.purchasePrice,
      gstTaxSlab: it.gstTaxSlab,
      reorderThreshold: it.minStockAlert,
      // Primary supplier mirrors (used by existing PO screens) + full list.
      vendorId: vendors[0]?.vendorId ?? null,
      vendorCode: vendors[0]?.vendorCode ?? null,
      vendors: vendors.length ? (vendors as any) : null,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    };
  });
  const stocks = IMPORTED_CATALOG.map((it) => ({
    itemId: idFor(it.itemCode),
    branchId,
    quantity: it.openingStock,
    location: it.location || null,
    minStockAlert: it.minStockAlert,
    updatedAt: now,
  }));
  // Opening-stock ledger rows so the movement history reconciles to stock from
  // day one (no prior movements, so opening qty == current qty). STK-3.
  const openingLogs = buildOpeningStockRows(stocks as any[], [], items as any[], {
    idFor: (b, i) => `adj-open-${b}-${i}`,
    timestampFor: () => now,
    notes: 'Opening balance at go-live',
    adjustedBy: 'System (Catalog Import)',
  });

  if (vendorRows.length) await prisma.vendor.createMany({ data: vendorRows as any });
  await prisma.item.createMany({ data: items as any });
  await prisma.branchStock.createMany({ data: stocks as any });
  if (openingLogs.length) await prisma.stockAdjustmentLog.createMany({ data: openingLogs as any });

  // Categories come from the imported catalog; the rest are the usual config
  // singletons so dropdowns, settings and rights exist on a clean system.
  const categories = [...new Set(items.map((i) => i.category))].sort();
  // Preserve the client's Category → Subcategory taxonomy from the import.
  const subcategoriesByCategory: Record<string, string[]> = {};
  for (const i of items) {
    const sub = (i.subcategory || '').toString().trim();
    if (!sub) continue;
    (subcategoriesByCategory[i.category] ||= []);
    if (!subcategoriesByCategory[i.category].includes(sub)) subcategoriesByCategory[i.category].push(sub);
  }
  for (const c of Object.keys(subcategoriesByCategory)) subcategoriesByCategory[c].sort();
  const usesSqft = items.some((i) => i.unit === 'SQFT');
  const unitsList = usesSqft ? [...STANDARD_UNITS, { value: 'SQFT', label: 'SQFT (Square Feet)' }] : STANDARD_UNITS;
  await prisma.appConfig.createMany({
    data: [
      { key: 'categories', value: categories as any },
      { key: 'subcategoriesByCategory', value: subcategoriesByCategory as any },
      { key: 'categoryPrefixMap', value: {} },
      { key: 'subcategoryPrefixMap', value: {} },
      { key: 'unitsList', value: unitsList as any },
      { key: 'gstSlabsList', value: GST_RATES as any },
      { key: 'paymentTermsOptions', value: PAYMENT_TERMS_OPTIONS as any },
      { key: 'loyaltySettings', value: INITIAL_LOYALTY_SETTINGS as any },
      { key: 'payrollSettings', value: INITIAL_PAYROLL_SETTINGS as any },
      { key: 'inventorySettings', value: { deadStockThresholdDays: 90 } },
      { key: 'accessMatrix', value: buildDefaultMatrix() as any },
      { key: 'migration:fix-existing-bills', value: { runs: [], seededAlreadyCorrect: true } as any },
    ],
  });
  // Restore the official GST invoice-series start if one was configured, so bill
  // numbering keeps continuing from the shop's real series after a reset.
  if (seriesCfg && typeof seriesCfg.fy === 'string' && Number(seriesCfg.start) > 0) {
    await prisma.appConfig.upsert({
      where: { key: 'invoiceSeriesStart' },
      create: { key: 'invoiceSeriesStart', value: seriesCfg as any },
      update: { value: seriesCfg as any },
    });
  }
  setLiveMatrix(buildDefaultMatrix());
  // Re-link attendance profiles to the surviving staff logins (HRM3-8).
  await provisionUserEmployees();
  return { items: items.length, vendors: vendorRows.length, branchId };
}

/**
 * ADDITIVE catalog import — does NOT wipe anything. For each product in
 * IMPORTED_CATALOG: if an item with that SKU (itemCode) already exists, update
 * its catalog fields in place (name, category, prices, GST, HSN, unit) but LEAVE
 * its stock untouched; otherwise create a brand-new item with its opening stock
 * at the default branch (plus an opening-stock ledger row so movement history
 * reconciles). Categories/subcategories from the sheet are MERGED into the config
 * (never removed). Logins, sales, purchases and every other record are preserved.
 *
 * Use this when the client wants the product list loaded WITHOUT losing the
 * existing data. Safe to re-run (idempotent on the catalog fields). Returns how
 * many rows were created vs updated.
 */
export async function importCatalogAdditive(): Promise<{ created: number; updated: number; branchId: string; total: number }> {
  const branchId = process.env.CATALOG_BRANCH || 'erode-hq';
  const now = new Date().toISOString();
  const idFor = (code: string) => `item-${code.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`;

  const existing = await prisma.item.findMany({ select: { itemCode: true } });
  const existingCodes = new Set(existing.map((i) => i.itemCode));

  const toCreate: any[] = [];
  const updates: { itemCode: string; data: any }[] = [];
  for (const it of IMPORTED_CATALOG) {
    // Fields we (re)write from the sheet. Stock is handled separately and only
    // for brand-new items, so a re-run never clobbers live quantities.
    const fields = {
      itemName: it.itemName,
      itemHSN: it.itemHSN || '',
      category: it.category,
      subcategory: it.subcategory || null,
      unit: it.unit,
      salePrice: it.salePrice,
      salePriceTaxMode: it.salePriceTaxMode,
      wholesalePrice: it.wholesalePrice,
      minWholesaleQty: it.minWholesaleQty,
      purchasePrice: it.purchasePrice,
      gstTaxSlab: it.gstTaxSlab,
      reorderThreshold: it.minStockAlert,
      updatedAt: now,
    };
    if (existingCodes.has(it.itemCode)) {
      updates.push({ itemCode: it.itemCode, data: fields });
    } else {
      toCreate.push({ id: idFor(it.itemCode), itemCode: it.itemCode, isArchived: false, createdAt: now, ...fields });
    }
  }

  if (toCreate.length) await prisma.item.createMany({ data: toCreate as any, skipDuplicates: true });
  // Per-row updates (each has different field values); itemCode is unique.
  for (const u of updates) {
    await prisma.item.update({ where: { itemCode: u.itemCode }, data: u.data });
  }

  // Opening stock + ledger ONLY for the newly created items.
  const newStocks = toCreate.map((it) => {
    const src = IMPORTED_CATALOG.find((c) => c.itemCode === it.itemCode)!;
    return {
      itemId: it.id,
      branchId,
      quantity: src.openingStock,
      location: src.location || null,
      minStockAlert: src.minStockAlert,
      updatedAt: now,
    };
  });
  if (newStocks.length) {
    await prisma.branchStock.createMany({ data: newStocks as any, skipDuplicates: true });
    const openingLogs = buildOpeningStockRows(newStocks as any[], [], toCreate as any[], {
      idFor: (b, i) => `adj-open-${b}-${i}`,
      timestampFor: () => now,
      notes: 'Opening balance at catalog import',
      adjustedBy: 'System (Catalog Import)',
    });
    if (openingLogs.length) await prisma.stockAdjustmentLog.createMany({ data: openingLogs as any, skipDuplicates: true });
  }

  // MERGE categories + subcategories into the existing config (never remove).
  const catRow = await prisma.appConfig.findUnique({ where: { key: 'categories' } });
  const subRow = await prisma.appConfig.findUnique({ where: { key: 'subcategoriesByCategory' } });
  const categories = new Set<string>(Array.isArray(catRow?.value) ? (catRow!.value as any[]).map(String) : []);
  const subs: Record<string, string[]> = (subRow?.value && typeof subRow.value === 'object' && !Array.isArray(subRow.value))
    ? JSON.parse(JSON.stringify(subRow.value)) : {};
  for (const it of IMPORTED_CATALOG) {
    categories.add(it.category);
    const sub = (it.subcategory || '').toString().trim();
    if (!sub) continue;
    (subs[it.category] ||= []);
    if (!subs[it.category].includes(sub)) subs[it.category].push(sub);
  }
  for (const c of Object.keys(subs)) subs[c].sort();
  await prisma.appConfig.upsert({
    where: { key: 'categories' }, create: { key: 'categories', value: [...categories].sort() as any }, update: { value: [...categories].sort() as any },
  });
  await prisma.appConfig.upsert({
    where: { key: 'subcategoriesByCategory' }, create: { key: 'subcategoriesByCategory', value: subs as any }, update: { value: subs as any },
  });

  return { created: toCreate.length, updated: updates.length, branchId, total: IMPORTED_CATALOG.length };
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
