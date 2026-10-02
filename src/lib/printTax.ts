import { GstBreakdownRow } from '../types';
import { calculateTaxBreakdown } from './taxCalculations';

/**
 * Tax lines for a printed bill or quote. Intra-state supply shows SGST + CGST
 * per rate; an inter-state supply shows one IGST line per rate with the same
 * total (SAL8-5).
 */
export function supplyTaxRows(
  items: Array<{ taxableAmount: number; gstRate?: number; taxRate?: number }>,
  overallDiscountAmount: number,
  subtotal: number,
  interState: boolean,
  billTax?: number,
): GstBreakdownRow[] {
  const rows = calculateTaxBreakdown(items, overallDiscountAmount, subtotal, false, billTax);
  if (!interState) return rows;
  const byRate = new Map<number, GstBreakdownRow>();
  for (const r of rows) {
    const full = r.rate * 2;
    const cur = byRate.get(full) || { taxType: 'IGST' as const, rate: full, taxableAmount: r.taxableAmount, taxAmount: 0 };
    cur.taxAmount = Math.round((cur.taxAmount + r.taxAmount) * 100) / 100;
    byRate.set(full, cur);
  }
  return [...byRate.values()];
}

export interface HsnRow {
  hsn: string;
  rate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
}

/**
 * HSN/SAC summary: ONE row per HSN AND rate (SAL4-8 — one HSN sold at 18% and
 * 12% used to print a single "6% / 6%" row). Each rate's tax is the same figure
 * the bill's tax lines show, shared over that rate's HSN rows (the last row takes
 * the paisa residue), so the table always adds up to the bill's tax.
 */
export function hsnRateSummary(
  items: Array<{ itemHSN?: string; taxableAmount: number; taxRate?: number; gstRate?: number }>,
  overallDiscountAmount: number,
  subtotal: number,
  interState: boolean,
  billTax?: number,
): HsnRow[] {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const rateRows = calculateTaxBreakdown(items as any, overallDiscountAmount, subtotal, false, billTax);
  const rateTax = new Map<number, number>();
  for (const r of rateRows) rateTax.set(r.rate * 2, r2((rateTax.get(r.rate * 2) || 0) + r.taxAmount));
  const base = subtotal || items.reduce((s, it) => s + (Number(it.taxableAmount) || 0), 0);
  const netRatio = overallDiscountAmount > 0 && base > 0 ? Math.max(0, (base - overallDiscountAmount) / base) : 1;

  const groups = new Map<string, { hsn: string; rate: number; taxable: number }>();
  for (const it of items) {
    const rate = Number(it.taxRate ?? it.gstRate ?? 0);
    const hsn = it.itemHSN || '—';
    const key = `${hsn}|${rate}`;
    const g = groups.get(key) || { hsn, rate, taxable: 0 };
    g.taxable += (Number(it.taxableAmount) || 0) * netRatio;
    groups.set(key, g);
  }
  const list = [...groups.values()].map((g) => ({ ...g, taxable: r2(g.taxable) }));
  const out: HsnRow[] = [];
  const rates = [...new Set(list.map((g) => g.rate))].sort((a, b) => a - b);
  for (const rate of rates) {
    const rows = list.filter((g) => g.rate === rate);
    const total = rate > 0 ? rateTax.get(rate) || 0 : 0;
    const taxableSum = rows.reduce((s, g) => s + g.taxable, 0);
    let left = total;
    rows.forEach((g, i) => {
      const tax = i === rows.length - 1 ? r2(left) : r2(taxableSum > 0 ? (total * g.taxable) / taxableSum : 0);
      left = r2(left - tax);
      const sgst = interState ? 0 : r2(tax / 2);
      const cgst = interState ? 0 : r2(tax - sgst);
      out.push({ hsn: g.hsn, rate, taxable: g.taxable, cgst, sgst, igst: interState ? tax : 0, tax });
    });
  }
  return out;
}

/** "3 PCS + 2.5 MTR": quantities are added up per unit, never across units (SAL4-15). */
export function quantityByUnit(items: Array<{ quantity: number; unit?: string }>): string {
  const m = new Map<string, number>();
  for (const it of items) {
    const u = (it.unit || 'NOS').toUpperCase();
    m.set(u, Math.round(((m.get(u) || 0) + (Number(it.quantity) || 0)) * 1000) / 1000);
  }
  return [...m.entries()].map(([u, q]) => `${q} ${u}`).join(' + ');
}

/** Terms text with "**bold**" markers turned into bold lines instead of printing the asterisks. */
export function termsLines(terms: string): { text: string; bold: boolean }[] {
  return String(terms || '')
    .split('\n')
    .map((line) => {
      const bold = /\*\*(.+?)\*\*/.test(line);
      return { text: line.replace(/\*\*(.+?)\*\*/g, '$1'), bold };
    });
}
