import { Invoice, Payment, getInvoicePaymentSplits } from '../types';

/**
 * ONE list of payment modes (E2E5-3). Bills are collected in Cash, GPay or HDFC
 * (the shop's bank) — 'COD-Credit' is the part left owing. Customer receipts
 * also accept UPI, Card, Bank Transfer and Cheque (and Store Credit when the
 * customer holds some). Refunds go back as Cash, GPay or HDFC, or as a credit
 * note. Every screen that offers or groups modes reads this file.
 */
export const SALE_MODES = ['Cash', 'GPay', 'HDFC'] as const;
export const RECEIPT_MODES = ['Cash', 'GPay', 'HDFC', 'UPI', 'Card', 'Bank Transfer', 'Cheque'] as const;
export const REFUND_MODES = ['Cash', 'GPay', 'HDFC'] as const;
export const STORE_CREDIT_MODE = 'Store Credit';

export const PAYMENT_MODE_LABEL: Record<string, string> = {
  Cash: 'Cash',
  GPay: 'GPay',
  HDFC: 'HDFC (bank)',
  UPI: 'UPI',
  Card: 'Card',
  'Bank Transfer': 'Bank Transfer',
  Cheque: 'Cheque',
  'Store Credit': 'Store Credit',
  'COD-Credit': 'Credit (owed)',
};

/** Where the money lands: the drawer, the GPay/UPI account, or the bank. */
export type ModeGroup = 'Cash' | 'GPay / UPI' | 'Bank / Card' | 'Store Credit' | 'Other';
export const MODE_GROUPS: ModeGroup[] = ['Cash', 'GPay / UPI', 'Bank / Card', 'Store Credit', 'Other'];

export function modeGroup(mode?: string | null): ModeGroup {
  const m = String(mode || '').trim().toLowerCase();
  if (m === 'cash') return 'Cash';
  if (m === 'gpay' || m === 'upi' || m === 'google pay' || m === 'phonepe' || m === 'paytm') return 'GPay / UPI';
  if (m === 'hdfc' || m === 'card' || m === 'bank' || m === 'bank transfer' || m === 'cheque' || m === 'neft' || m === 'rtgs' || m === 'imps') return 'Bank / Card';
  if (m === 'store credit') return 'Store Credit';
  return 'Other';
}

export interface ModeTotals {
  byGroup: Record<ModeGroup, number>;
  total: number;
  /** Credit given at billing (the COD-Credit part of the period's bills). */
  creditGiven: number;
}

/**
 * Money COLLECTED in a period, by mode (CRM6-9 / SAL6-2): what each bill took on
 * its own day (its at-billing split) plus every customer receipt on the
 * RECEIPT's own date and mode. A receipt paid from store credit (an advance
 * already counted when it came in) is not new money and is left out, so a
 * pending-order advance counts once (CRM2-8). Refunds are not netted here.
 */
export function collectionsByMode(
  invoices: Invoice[],
  payments: Payment[],
  inRange: (date: string) => boolean,
  inScope: (branchId: string) => boolean,
): ModeTotals {
  const byGroup = Object.fromEntries(MODE_GROUPS.map((g) => [g, 0])) as Record<ModeGroup, number>;
  let creditGiven = 0;
  for (const inv of invoices || []) {
    if (inv.isVoided || !inRange(inv.date) || !inScope(inv.branchId)) continue;
    for (const s of getInvoicePaymentSplits(inv)) {
      const amt = Number(s.amount) || 0;
      if (s.mode === 'COD-Credit') { creditGiven += amt; continue; }
      byGroup[modeGroup(s.mode)] += amt;
    }
  }
  for (const p of payments || []) {
    if (p.type !== 'in' || p.partyType !== 'customer') continue;
    if (!inRange(p.date) || !inScope(p.branchId)) continue;
    if (modeGroup(p.paymentMode) === 'Store Credit') continue;
    byGroup[modeGroup(p.paymentMode)] += Number(p.amount) || 0;
  }
  for (const g of MODE_GROUPS) byGroup[g] = Math.round(byGroup[g] * 100) / 100;
  const total = Math.round(MODE_GROUPS.reduce((t, g) => t + byGroup[g], 0) * 100) / 100;
  return { byGroup, total, creditGiven: Math.round(creditGiven * 100) / 100 };
}
