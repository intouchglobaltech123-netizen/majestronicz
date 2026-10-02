/**
 * What a purchase order is worth to the vendor — the ONE formula (PUR8-1).
 *
 * The vendor is owed for the units that arrived in GOOD condition, with the GST
 * that was confirmed on the receipt that brought them in, plus any packing /
 * other charges billed on those receipts:
 *
 *   owed    = Σ good units × price × (1 + GST at that receipt) + other charges
 *   balance = max(0, owed − paid)
 *   advance = max(0, paid − owed)   (money the vendor holds for goods not yet in)
 *
 * Damaged units are billed back on a debit note that carries their GST (the ITC
 * is reversed), and missing units are never charged at all — so neither is
 * subtracted again here (the old "ordered value − debit notes" formula deducted
 * missing units twice and never reversed damaged-unit GST).
 *
 * Each line keeps a running `receivedTaxable` / `receivedTax` that every receipt
 * adds to at ITS price and rate, so receiving the rest of a PO at a different GST
 * rate never re-taxes the units received earlier (E2E8-5). Lines received before
 * those fields existed fall back to good units × the line's price and rate.
 *
 * Mirrored exactly by purchaseOrderGrandOwed / purchaseOrderBalanceDue in
 * src/types/index.ts — change both together.
 */
import { taxAmountFor } from './tax.js';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v: unknown) => Number(v) || 0;

/** Units on a line that are settled (good + damaged + missing). */
export const lineSettled = (l: any): number =>
  num(l?.receivedQuantity) + num(l?.damagedQuantity) + num(l?.missingQuantity);

/** Taxable value and GST of the GOOD units received on a line. */
export function lineGoodValue(l: any): { taxable: number; tax: number } {
  const good = num(l?.receivedQuantity);
  if (good <= 0) return { taxable: 0, tax: 0 };
  if (l?.receivedTaxable != null && Number.isFinite(Number(l.receivedTaxable))) {
    return { taxable: r2(num(l.receivedTaxable)), tax: r2(num(l.receivedTax)) };
  }
  const taxable = r2(num(l?.purchasePrice) * good);
  return { taxable, tax: taxAmountFor(taxable, num(l?.taxPercent)) };
}

/** What the vendor is owed on this PO (tax-inclusive, received-goods basis). */
export function poOwed(po: any): number {
  if (!po) return 0;
  let total = 0;
  for (const l of (po.items as any[]) || []) {
    const v = lineGoodValue(l);
    total += v.taxable + v.tax;
  }
  return r2(total + num(po.otherCharges));
}

/** Value (incl. GST at the line's current rate) of units not yet settled. */
export function poOpenValue(po: any): number {
  let total = 0;
  for (const l of (po?.items as any[]) || []) {
    const open = Math.max(0, num(l.quantityOrdered) - lineSettled(l));
    if (open <= 0) continue;
    const taxable = r2(num(l.purchasePrice) * open);
    total += taxable + taxAmountFor(taxable, num(l.taxPercent));
  }
  return r2(total);
}

/** Still owed on this PO (never negative). A cancelled PO owes nothing. */
export function poBalance(po: any): number {
  if (!po || po.status === 'Cancelled') return 0;
  return Math.max(0, r2(poOwed(po) - num(po.amountPaid)));
}

/** Paid beyond what has been delivered — an advance the vendor holds. */
export function poAdvance(po: any): number {
  if (!po) return 0;
  const owed = po.status === 'Cancelled' ? 0 : poOwed(po);
  return Math.max(0, r2(num(po.amountPaid) - owed));
}

/**
 * The most that may still be paid against this PO: what is owed now plus the
 * value of units still expected (a prepayment for those is an advance). Once
 * every unit is settled this equals the balance, so a short-shipped PO can never
 * be over-paid (PUR8-1).
 */
export function poPayCap(po: any): number {
  if (!po || po.status === 'Cancelled') return 0;
  return Math.max(0, r2(poOwed(po) + poOpenValue(po) - num(po.amountPaid)));
}

/** Allocated part of a payment row. */
export const allocatedOf = (p: any): number =>
  r2(((Array.isArray(p?.allocations) ? p.allocations : []) as any[]).reduce((s, a) => s + num(a?.amount), 0));

/** Part of a vendor payment not applied to any PO — a vendor advance. */
export const unappliedOf = (p: any): number => Math.max(0, r2(num(p?.amount) - allocatedOf(p)));

/** One supplier tax invoice (bill) recorded on a PO (E2E5-11). */
export interface SupplierBill {
  id: string;
  number: string;
  date: string;
  taxable: number;
  gst: number;
  attachmentId?: string | null;
  recordedAt?: string;
  recordedBy?: string | null;
}

/**
 * The supplier bills on a PO: its list, or — on a PO saved before several bills
 * were allowed — its single bill from the old supplierBill* fields.
 * Mirrored by supplierBillsOf in src/types/index.ts.
 */
export function supplierBillsOf(po: any): SupplierBill[] {
  if (Array.isArray(po?.supplierBills)) return po.supplierBills as SupplierBill[];
  if (!po?.supplierBillNumber && !(num(po?.supplierBillGst) > 0)) return [];
  return [{
    id: 'bill-legacy', number: String(po.supplierBillNumber || ''), date: String(po.supplierBillDate || po.date || ''),
    taxable: num(po.supplierBillTaxable), gst: num(po.supplierBillGst),
  }];
}

/** A bill number compared the way people retype it: case, spaces and dashes ignored. */
export const billNumberKey = (n: unknown) => String(n ?? '').toUpperCase().replace(/[\s\-_/.]+/g, '');
