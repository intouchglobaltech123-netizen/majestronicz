/**
 * Shared rules for what a bill has already PAID BACK to its customer for returns
 * (cash refund rows and credit notes), used by the live return / reverse-return
 * logic, the demo seed and the one-time scripts/fix-existing-bills.ts, so they
 * all recognise the same rows.
 */

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
 * Store credit issued for THIS bill and still standing: credit notes from returns
 * (refId = the bill), credit the one-time script issued for it (billId = the
 * bill: converted old 'Adjust' refunds, over-payments) less any taken back when
 * a return was reversed. Spending credit ('applied') is not a take-back.
 */
export function creditNotesForBill(creditHistory: unknown, invoiceId: string): number {
  const hist = Array.isArray(creditHistory) ? (creditHistory as any[]) : [];
  let t = 0;
  for (const h of hist) {
    if (!h || (h.refId !== invoiceId && h.billId !== invoiceId)) continue;
    if (h.type === 'issued') t += Number(h.amount) || 0;
    else if (h.type === 'adjust' && (Number(h.amount) || 0) < 0) t += Number(h.amount) || 0;
  }
  return Math.max(0, round2(t));
}
