/**
 * Shared rules for what a bill has already PAID BACK to its customer for returns
 * (cash refund rows and credit notes) and the one due formula, used by the dues,
 * the live return / reverse-return logic, the demo seed and the one-time
 * scripts/fix-existing-bills.ts, so they all recognise the same rows.
 */

import { collectedAtBilling } from './billingSplit.js';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Id of the cash refund the one-time script (or the demo seed) records for an
 * OLDER return that never had one. Fixed per bill + return time, so a second run
 * finds it and reverse-return can match it to its return (UPG9-10).
 */
export function legacyRefundId(invoiceId: string, returnedAt: string | null | undefined): string {
  return `pay-fix-${invoiceId}-${String(returnedAt || '').replace(/[^0-9]/g, '').slice(0, 17) || 'ret'}`.slice(0, 120);
}

/**
 * Store credit given back to the customer AGAINST this bill, net (CRM9-1 /
 * CRM9-3 / UPG9-5): credit notes from returns and the excess of an edit below
 * what was paid (refId = the bill), the one-time script's converted older
 * 'Adjust' refunds (refId 'fix-adjust:…', billId = the bill) and over-payments
 * (refId 'fix-overpay:<bill id>'), less any taken back when a return was
 * reversed (a negative entry with refId = the bill). Spending credit ('applied')
 * and receipt over-payments reference the receipt, not the bill, so they are not
 * counted. ONE rule for the due (payment.service), the return refund
 * (invoice.service) and the one-time script.
 */
export function creditBackForBill(creditHistory: unknown, inv: { id: string; invoiceNumber?: string | null }): number {
  const hist = Array.isArray(creditHistory) ? (creditHistory as any[]) : [];
  let t = 0;
  for (const h of hist) {
    if (!h) continue;
    const ref = String(h.refId || '');
    const mine = ref === inv.id || h.billId === inv.id || ref === `fix-overpay:${inv.id}` ||
      // an earlier script run that did not record billId yet
      (ref.startsWith('fix-adjust:') && !h.billId && !!inv.invoiceNumber && h.refNumber === inv.invoiceNumber);
    if (mine) t += Number(h.amount) || 0;
  }
  return round2(t);
}

/** What the bill's own-day split collected BEYOND its (edited) total — an edit
 *  below the amount paid keeps that split and gives the excess back as store
 *  credit (CRM9-3), so it counts against the due like any other payment. */
export function overCollectedOf(inv: any): number {
  return Math.max(0, round2(collectedAtBilling(inv) - (Number(inv?.grandTotal) || 0)));
}

/**
 * THE due formula, before it is floored at ₹0:
 *   owed at billing − collected beyond the total − receipts − returns + refunds + credit given back
 * A negative result is what the customer has paid beyond the (net) bill and not
 * been paid back — exactly what a return pays back (UPG9-5) and what the
 * one-time script keeps as store credit.
 */
export function billDueRaw(p: { creditOriginal: number; overCollected: number; receipts: number; returns: number; refunds: number; creditBack: number }): number {
  return round2(p.creditOriginal - p.overCollected - p.receipts - p.returns + p.refunds + p.creditBack);
}
