import {
  Invoice,
  InvoiceLineItem,
  Item,
  Payment,
  PayrollRecord,
  DailyCashRegister,
  RecurringExpenseTemplate,
  isDamagedReturn,
  isInterStateSupply,
  expenseIsEffective,
  BANK_DEPOSIT_CATEGORY,
} from '../types';

/**
 * THE report arithmetic. Every money figure the reports and the dashboard show
 * for sales, GST and profit comes from here, so the Reports header, the Sales
 * register, the GST tab / GSTR-1 / 3B, the Branch P&L and the Dashboard can
 * never disagree again (RPT5-1 / RPT8-1 / RPT4-2 / E2E-8 / RPT2-4).
 *
 * Rules (the server's own):
 *   - a line's taxable value and tax are scaled by the bill-level discount
 *     ((subtotal − overall discount) / subtotal) — the server taxes the
 *     discounted base (taxCalc.calculateInvoiceTotals);
 *   - returns come off the line they were sold on, by quantity (keyed like the
 *     server keys returns: combo id, catalogue item id, or the line id of a
 *     typed line);
 *   - inter-state bills carry IGST (CGST/SGST are 0 on the stored lines);
 *   - revenue is ex-GST: taxable after discount, plus shipping, net of returns;
 *   - cost of goods is the cost captured AT THE TIME OF SALE (line.unitCost);
 *     bills made before that was stored fall back to the item's current cost;
 *   - a DAMAGED return is a write-off: its cost is a loss, not recovered;
 *   - operating expenses are approved register expenses, never bank deposits;
 *   - payroll counts when it is paid (salary Payment rows, partyType 'staff').
 */

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const num = (n: unknown) => Number(n) || 0;

type CostItem = Pick<Item, 'id' | 'itemCode' | 'itemName' | 'purchasePrice'>;
export type CostOf = (line: InvoiceLineItem) => number;

/** Cost of ONE unit of a bill line: the cost frozen at sale time, else the
 *  item's current purchase price (combos: the sum of their parts). */
export function makeCostOf(items: CostItem[]): CostOf {
  const byId = new Map(items.map((i) => [i.id, i] as const));
  const byCode = new Map(items.filter((i) => i.itemCode).map((i) => [i.itemCode as string, i] as const));
  const byName = new Map(items.map((i) => [(i.itemName || '').toLowerCase(), i] as const));
  return (li) => {
    if (li.unitCost != null && Number.isFinite(Number(li.unitCost))) return num(li.unitCost);
    if (li.isCombo && Array.isArray(li.comboComponents) && li.comboComponents.length) {
      return li.comboComponents.reduce((t, c) => t + num(c.quantity) * num(byId.get(c.itemId)?.purchasePrice), 0);
    }
    const it =
      (li.itemId ? byId.get(li.itemId) : undefined) ||
      (li.itemCode ? byCode.get(li.itemCode) : undefined) ||
      byName.get((li.itemName || '').toLowerCase());
    return num(it?.purchasePrice);
  };
}

const lineKey = (li: Pick<InvoiceLineItem, 'isCombo' | 'comboId' | 'itemId' | 'id'>) =>
  li.isCombo && li.comboId ? `c:${li.comboId}` : li.itemId || li.id;

export interface LineFigures {
  line: InvoiceLineItem;
  soldQty: number;
  returnedQty: number;       // all returned units (restocked + damaged)
  damagedQty: number;        // returned units written off as damaged
  netQty: number;            // sold − returned
  taxable: number;           // net of bill discount and returns
  tax: number;
  cgst: number;
  sgst: number;
  igst: number;
  value: number;             // taxable + tax (what the customer pays for the kept units)
  cogs: number;              // cost of the units kept (net of all returns)
  writeOff: number;          // cost of damaged returned units
}

export interface InvoiceFigures {
  lines: LineFigures[];
  taxable: number;
  tax: number;
  cgst: number;
  sgst: number;
  igst: number;
  shipping: number;
  discount: number;          // bill-level discount
  revenue: number;           // ex-GST: taxable + shipping, net of returns
  cogs: number;
  writeOff: number;
  grossProfit: number;       // revenue − cogs − write-off
}

/** Every report figure of one bill (zeros for a voided bill). */
export function invoiceFigures(inv: Invoice, costOf: CostOf): InvoiceFigures {
  const empty: InvoiceFigures = {
    lines: [], taxable: 0, tax: 0, cgst: 0, sgst: 0, igst: 0, shipping: 0, discount: 0, revenue: 0, cogs: 0, writeOff: 0, grossProfit: 0,
  };
  if (!inv || inv.isVoided) return empty;
  const items = inv.items || [];
  const lineSubtotal = items.reduce((t, l) => t + num(l.taxableAmount), 0);
  const subtotal = num(inv.subtotal) || lineSubtotal;
  const discount = Math.min(subtotal, num(inv.overallDiscountAmount));
  const f = subtotal > 0 ? Math.max(0, (subtotal - discount) / subtotal) : 1;
  const inter = isInterStateSupply(inv.stateOfSupply) ||
    (num(inv.totalTax) > 0 && num(inv.totalCgst) + num(inv.totalSgst) === 0);

  // Returned units per key, split over the bill's lines of that key by quantity.
  const back = new Map<string, { qty: number; damaged: number }>();
  for (const r of inv.returns || []) {
    const k = r.isCombo && r.comboId ? `c:${r.comboId}` : r.itemId;
    const cur = back.get(k) || { qty: 0, damaged: 0 };
    cur.qty += num(r.returnedQuantity);
    if (isDamagedReturn(r)) cur.damaged += num(r.returnedQuantity);
    back.set(k, cur);
  }
  const soldByKey = new Map<string, number>();
  for (const li of items) soldByKey.set(lineKey(li), (soldByKey.get(lineKey(li)) || 0) + num(li.quantity));

  const out: InvoiceFigures = { ...empty, lines: [] };
  for (const li of items) {
    const soldQty = num(li.quantity);
    const k = lineKey(li);
    const keySold = soldByKey.get(k) || 0;
    const share = keySold > 0 ? soldQty / keySold : 0;
    const ret = back.get(k) || { qty: 0, damaged: 0 };
    const returnedQty = Math.min(soldQty, ret.qty * share);
    const damagedQty = Math.min(returnedQty, ret.damaged * share);
    const netQty = Math.max(0, soldQty - returnedQty);
    const keep = soldQty > 0 ? netQty / soldQty : 0;
    const taxable = num(li.taxableAmount) * f * keep;
    const tax = inv.withGst === false ? 0 : num(li.totalTax) * f * keep;
    const cgst = inter ? 0 : tax / 2;
    const sgst = inter ? 0 : tax / 2;
    const unit = costOf(li);
    const lf: LineFigures = {
      line: li, soldQty, returnedQty, damagedQty, netQty,
      taxable, tax, cgst, sgst, igst: inter ? tax : 0, value: taxable + tax,
      cogs: unit * netQty, writeOff: unit * damagedQty,
    };
    out.lines.push(lf);
    out.taxable += taxable; out.tax += tax; out.cgst += cgst; out.sgst += sgst; out.igst += lf.igst;
    out.cogs += lf.cogs; out.writeOff += lf.writeOff;
  }
  out.discount = discount;
  out.shipping = num(inv.shippingCharges);
  out.revenue = out.taxable + out.shipping;
  out.grossProfit = out.revenue - out.cogs - out.writeOff;
  return out;
}

export interface GstTotals { taxable: number; tax: number; cgst: number; sgst: number; igst: number; invoices: number }

/** "GST collected" for a set of bills: net of returns and bill discount, IGST
 *  included. Only GST bills count. The ONE figure every screen shows. */
export function gstCollected(invoices: Invoice[], costOf: CostOf = () => 0): GstTotals {
  const t: GstTotals = { taxable: 0, tax: 0, cgst: 0, sgst: 0, igst: 0, invoices: 0 };
  for (const inv of invoices) {
    if (inv.isVoided || !inv.withGst) continue;
    const fig = invoiceFigures(inv, costOf);
    t.taxable += fig.taxable; t.tax += fig.tax; t.cgst += fig.cgst; t.sgst += fig.sgst; t.igst += fig.igst;
    t.invoices += 1;
  }
  return { taxable: r2(t.taxable), tax: r2(t.tax), cgst: r2(t.cgst), sgst: r2(t.sgst), igst: r2(t.igst), invoices: t.invoices };
}

/** A register expense that is a real operating expense (approved, not a bank deposit). */
export const isOperatingExpense = (e: DailyCashRegister['expenses'][number]): boolean =>
  expenseIsEffective(e) && e.category !== BANK_DEPOSIT_CATEGORY;

/**
 * The category an expense reports under. Expenses posted from a recurring
 * template before the template's category was carried onto the expense (e.g.
 * rent) take it from the template that posted them, so only truly
 * uncategorised entries show as "Uncategorised" (RPT2-4).
 */
export function makeExpenseCategoryOf(templates: RecurringExpenseTemplate[] = []) {
  const byExpense = new Map<string, string>();
  for (const t of templates || []) {
    if (!t.category) continue;
    for (const a of t.approvalHistory || []) if (a?.cashExpenseId) byExpense.set(a.cashExpenseId, t.category);
  }
  return (e: DailyCashRegister['expenses'][number]): string =>
    (e.category || '').trim() || byExpense.get(e.id) || 'Uncategorised';
}

/** Salary payments in a period as expense-report rows (partyType 'staff' rows,
 *  plus Paid payroll rows from older builds that never wrote one). */
export function payrollPaymentRows(
  payments: Payment[],
  payrollRecords: PayrollRecord[],
  inRange: (date: string) => boolean,
  inScope: (branchId: string) => boolean,
): { date: string; branchId: string; name: string; month: string; mode: string; amount: number }[] {
  const out: { date: string; branchId: string; name: string; month: string; mode: string; amount: number }[] = [];
  const covered = new Set<string>();
  for (const p of payments || []) {
    if (p.type !== 'out' || p.partyType !== 'staff') continue;
    for (const a of p.allocations || []) if (a?.refId) covered.add(a.refId);
    if (!inRange(p.date) || !inScope(p.branchId)) continue;
    out.push({ date: p.date, branchId: p.branchId, name: p.partyName, month: p.allocations?.[0]?.refNumber || '', mode: p.paymentMode, amount: num(p.amount) });
  }
  for (const pr of payrollRecords || []) {
    if (pr.status !== 'Paid' || !pr.paidAt || covered.has(pr.id)) continue;
    const day = new Date(Date.parse(pr.paidAt) + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    if (!inRange(day) || !inScope(pr.branchId)) continue;
    out.push({ date: day, branchId: pr.branchId, name: pr.employeeName, month: pr.month, mode: pr.paymentMode || 'Cash', amount: num(pr.finalPayable) });
  }
  return out;
}

/** Payroll paid in a period, by branch: salary Payment rows (partyType 'staff'),
 *  plus payroll rows marked Paid by older builds that never wrote such a row
 *  (dated on their paidAt IST day). */
export function payrollPaid(
  payments: Payment[],
  payrollRecords: PayrollRecord[],
  inRange: (date: string) => boolean,
  inScope: (branchId: string) => boolean,
): { total: number; byBranch: Record<string, number> } {
  const byBranch: Record<string, number> = {};
  for (const r of payrollPaymentRows(payments, payrollRecords, inRange, inScope)) {
    byBranch[r.branchId] = (byBranch[r.branchId] || 0) + r.amount;
  }
  const total = Object.values(byBranch).reduce((t, v) => t + v, 0);
  return { total: r2(total), byBranch };
}

export interface ProfitLine {
  revenue: number;
  cogs: number;
  writeOff: number;
  grossProfit: number;
  expenses: number;
  payroll: number;
  netProfit: number;
  invoiceCount: number;
  expenseCount: number;
  categoryExpenses: Record<string, number>;
}

const emptyLine = (): ProfitLine => ({
  revenue: 0, cogs: 0, writeOff: 0, grossProfit: 0, expenses: 0, payroll: 0, netProfit: 0, invoiceCount: 0, expenseCount: 0, categoryExpenses: {},
});

/**
 * Profit & loss for a period, per branch and in total. Used by the Branch P&L
 * and the Dashboard "Profit (month)" card so both show the same gross and net.
 */
export function computeProfit(args: {
  invoices: Invoice[];
  items: CostItem[];
  registers: DailyCashRegister[];
  payments: Payment[];
  payrollRecords: PayrollRecord[];
  recurringTemplates?: RecurringExpenseTemplate[];
  startDate?: string;
  endDate?: string;
  inScope: (branchId: string) => boolean;
}): { total: ProfitLine; byBranch: Record<string, ProfitLine> } {
  const { startDate, endDate, inScope } = args;
  const categoryOf = makeExpenseCategoryOf(args.recurringTemplates);
  const inRange = (d: string) => !!d && (!startDate || d >= startDate) && (!endDate || d <= endDate);
  const costOf = makeCostOf(args.items || []);
  const byBranch: Record<string, ProfitLine> = {};
  const of = (b: string) => (byBranch[b] = byBranch[b] || emptyLine());

  for (const inv of args.invoices || []) {
    if (inv.isVoided || !inRange(inv.date) || !inScope(inv.branchId)) continue;
    const fig = invoiceFigures(inv, costOf);
    const s = of(inv.branchId);
    s.revenue += fig.revenue; s.cogs += fig.cogs; s.writeOff += fig.writeOff; s.invoiceCount += 1;
  }
  for (const reg of args.registers || []) {
    if (!inRange(reg.date) || !inScope(reg.branchId)) continue;
    for (const e of reg.expenses || []) {
      if (!isOperatingExpense(e)) continue;
      const amt = num(e.cashAmount) + num(e.gpayAmount);
      const s = of(reg.branchId);
      s.expenses += amt; s.expenseCount += 1;
      const cat = categoryOf(e);
      s.categoryExpenses[cat] = (s.categoryExpenses[cat] || 0) + amt;
    }
  }
  const pay = payrollPaid(args.payments, args.payrollRecords, inRange, inScope);
  for (const [b, v] of Object.entries(pay.byBranch)) of(b).payroll += v;

  const total = emptyLine();
  for (const s of Object.values(byBranch)) {
    s.grossProfit = s.revenue - s.cogs - s.writeOff;
    s.netProfit = s.grossProfit - s.expenses - s.payroll;
    for (const k of ['revenue', 'cogs', 'writeOff', 'grossProfit', 'expenses', 'payroll', 'netProfit', 'invoiceCount', 'expenseCount'] as const) {
      total[k] += s[k];
    }
    for (const [c, v] of Object.entries(s.categoryExpenses)) total.categoryExpenses[c] = (total.categoryExpenses[c] || 0) + v;
  }
  return { total, byBranch };
}

/** Units sold and revenue per product, net of returns and of the bill-level
 *  discount (RPT-1 / RPT5-3). Revenue is what the customer paid incl. GST. */
export function productSales(invoices: Invoice[]): {
  key: string; itemId?: string; itemName: string; itemCode: string; isCombo: boolean; quantity: number; revenue: number;
}[] {
  const map = new Map<string, { key: string; itemId?: string; itemName: string; itemCode: string; isCombo: boolean; quantity: number; revenue: number }>();
  const costOf = () => 0;
  for (const inv of invoices) {
    if (inv.isVoided) continue;
    for (const lf of invoiceFigures(inv, costOf).lines) {
      const li = lf.line;
      const isCombo = Boolean(li.isCombo || li.comboId);
      const key = li.itemId || li.comboId || li.itemName;
      const cur = map.get(key) || { key, itemId: li.itemId || li.comboId, itemName: li.itemName, itemCode: li.itemCode || '—', isCombo, quantity: 0, revenue: 0 };
      cur.quantity += lf.netQty;
      cur.revenue += lf.value;
      if (isCombo) cur.isCombo = true;
      map.set(key, cur);
    }
  }
  return [...map.values()].map((p) => ({ ...p, quantity: Math.round(p.quantity * 1000) / 1000, revenue: r2(p.revenue) }));
}
