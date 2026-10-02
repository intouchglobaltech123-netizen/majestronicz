/**
 * The payment split of a bill AS IT WAS AT BILLING — what was collected in each
 * mode on the bill's own day, plus the 'COD-Credit' part left owing. This is the
 * ONE rule the cash drawer (cash.service), the dues (payment.service) and the
 * screens (src/types getInvoicePaymentSplits, which mirrors this exactly) read.
 *
 * Receipts, receipt deletes and returns never change it: they live as Payment
 * rows on their own dates. Older builds did rewrite `partialAmount` (and the
 * COD-Credit split) on every receipt, which moved cash onto the bill's original,
 * possibly closed, day (UPG8-1 / CASH7-1); the one-time script
 * scripts/fix-existing-bills.ts restores the original split on such bills.
 *
 * Legacy shape: a bill with no stored split that was part-paid keeps what was
 * collected at billing in `partialAmount`; on a 'COD-Credit' bill that
 * part-payment was taken in cash (E2E8-6 — the screen counted it, the server
 * did not).
 *
 * A stored split is always taken as it is. (The old billing form stored a
 * part-paid credit bill as a single 'COD-Credit' split with the part-payment
 * only in `partialAmount`, but older receipts ALSO wrote their running total
 * into `partialAmount` on such bills, so the row alone can't tell them apart —
 * the one-time script resolves those from the audit trail.)
 */
export type Split = { mode: string; amount: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

export function billingSplitsOf(inv: any): Split[] {
  const grand = Number(inv?.grandTotal) || 0;
  const partial = Math.min(grand, Math.max(0, Number(inv?.partialAmount) || 0));
  const stored: Split[] = Array.isArray(inv?.paymentSplits) ? inv.paymentSplits : [];
  const legacyPartialSplit = (): Split[] => [
    { mode: !inv.paymentMode || inv.paymentMode === 'COD-Credit' ? 'Cash' : inv.paymentMode, amount: partial },
    { mode: 'COD-Credit', amount: round2(grand - partial) },
  ];
  if (stored.length) return stored;
  if (inv?.isPartialPayment && partial > 0) return legacyPartialSplit();
  return [{ mode: inv?.paymentMode || 'Cash', amount: grand }];
}

/** Money collected on the bill's own day, all modes (everything but COD-Credit). */
export function collectedAtBilling(inv: any): number {
  return round2(
    billingSplitsOf(inv)
      .filter((s) => s.mode !== 'COD-Credit')
      .reduce((t, s) => t + (Number(s.amount) || 0), 0),
  );
}

/** Cash taken on the bill's own day (0 for a voided bill). */
export function cashAtBilling(inv: any): number {
  if (inv?.isVoided) return 0;
  return Math.max(
    0,
    round2(billingSplitsOf(inv).filter((s) => s.mode === 'Cash').reduce((t, s) => t + (Number(s.amount) || 0), 0)),
  );
}
