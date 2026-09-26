/**
 * Frontend twin of `backend/src/lib/tax.ts` — the two must agree, or a bill
 * shows one rate and the server charges another.
 *
 * Tax used to be a single field on the item. Receiving can now correct the rate
 * for the branch that took the goods in (`BranchStock.gstTaxSlab`), so reading
 * `item.gstTaxSlab` alone is no longer the whole answer anywhere a branch is
 * known. An undefined override means the branch has no opinion and the catalog
 * rate stands — the state of every row that predates this feature.
 */
import { BranchStock, Item } from '../types';

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

/** Convenience wrapper for the common "item + this branch's stock row" case. */
export function taxSlabForBranch(item: Pick<Item, 'gstTaxSlab'>, branchRow?: BranchStock | null): number {
  return effectiveTaxSlab(item?.gstTaxSlab, branchRow?.gstTaxSlab);
}

/** Tax on a value, rounded to paise. */
export function taxAmountFor(taxableValue: number, taxPercent: number): number {
  const base = Number(taxableValue) || 0;
  const pct = Number(taxPercent) || 0;
  return Math.round(base * (pct / 100) * 100) / 100;
}
