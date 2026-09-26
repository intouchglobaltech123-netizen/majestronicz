/**
 * One place that answers "what GST rate applies to this item, at this branch?".
 *
 * Tax used to live only on the item, so every screen could read
 * `item.gstTaxSlab` directly. Receiving can now correct the rate for the branch
 * that received the goods (`BranchStock.gstTaxSlab`), which means a raw read of
 * the item is no longer the whole answer — and a screen that keeps doing it
 * silently charges the old rate while the receipt shows the new one.
 *
 * So: resolve through here, always. A NULL override means the branch has no
 * opinion and the catalog rate stands, which is the state of every row that
 * existed before this feature.
 */

/** GST slabs that may be entered. Anything else is a typo, not a rate. */
export const GST_SLABS = [0, 0.25, 3, 5, 12, 18, 28] as const;

export function isValidTaxPercent(value: unknown): boolean {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100;
}

/**
 * The rate to charge, in percent.
 *
 * @param itemSlab      the catalog rate (`Item.gstTaxSlab`)
 * @param branchOverride the branch's corrected rate, if any (`BranchStock.gstTaxSlab`)
 */
export function effectiveTaxSlab(
  itemSlab: number | null | undefined,
  branchOverride?: number | null,
): number {
  if (branchOverride != null && Number.isFinite(Number(branchOverride))) {
    return Number(branchOverride);
  }
  const slab = Number(itemSlab);
  return Number.isFinite(slab) ? slab : 0;
}

/** Tax on a line, rounded to paise. */
export function taxAmountFor(taxableValue: number, taxPercent: number): number {
  const base = Number(taxableValue) || 0;
  const pct = Number(taxPercent) || 0;
  return Math.round(base * (pct / 100) * 100) / 100;
}
