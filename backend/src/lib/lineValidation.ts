import { AppError } from '../middleware/errorHandler.js';
import { GST_RATES } from './constants.js';
import { effectiveTaxSlab } from './tax.js';
import { isWholeUnit } from './units.js';

/**
 * Line checks shared by bills and quotations, so a quote can never carry money
 * a bill would refuse (SAL8-8) and a bill can't be saved with a rate, price or
 * quantity the catalogue doesn't allow (SAL4-5, SAL8-9, SAL2-8).
 */

const VALID_GST_RATES = new Set(GST_RATES.map((g: any) => Number(g.rate)));


const lineRate = (li: any) => li.taxRate ?? li.gstRate ?? 0;
const lineDiscount = (li: any) => li.discountValue ?? li.discount ?? 0;

/**
 * Archived items (Item.isArchived) are kept for history only: no new sale,
 * quote, PO line, combo part or transfer may use them. Returns, voids and
 * edits of documents that already carried the item keep working.
 */
export const archivedItemError = (name: string) =>
  new AppError('ITEM_ARCHIVED', `"${String(name || 'This item').slice(0, 80)}" is archived. Restore it in the item master before using it again.`, 400);

/**
 * Plain input checks that need no database: every number is a real number,
 * prices are not negative, discounts stay within 100%, quantities are positive
 * and GST is a valid slab. Throws a 400 on the first problem.
 */
export function assertLineInputs(doc: any, what: 'bill' | 'quotation' = 'bill'): void {
  const withGst = !!doc.withGst;
  const num = (v: unknown) => (v === '' || v == null ? 0 : Number(v));
  for (const li of (doc.items || []) as any[]) {
    const name = String(li?.itemName || li?.itemCode || 'A line').slice(0, 80);
    const price = num(li.unitPrice);
    if (!Number.isFinite(price)) throw new AppError('BAD_PRICE', `"${name}": the unit price must be a number.`, 400);
    if (price < 0) throw new AppError('BAD_PRICE', 'A unit price cannot be negative.', 400);
    const qty = Number(li.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new AppError('INVALID_QTY', 'Every line must have a quantity greater than zero.', 400);
    }
    const rate = num(lineRate(li));
    if (!Number.isFinite(rate)) throw new AppError('BAD_GST', `"${name}": the GST rate must be a number.`, 400);
    if (withGst && !VALID_GST_RATES.has(rate)) {
      throw new AppError('BAD_GST', 'GST rate must be a valid slab (0, 5, 12, 18 or 28%).', 400);
    }
    const disc = num(lineDiscount(li));
    if (!Number.isFinite(disc) || disc < 0) throw new AppError('BAD_DISCOUNT', `"${name}": the discount must be a number of 0 or more.`, 400);
    if ((li.discountType || '%') === '%' && disc > 100) {
      throw new AppError('BAD_DISCOUNT', 'A line discount cannot exceed 100%.', 400);
    }
  }
  const overall = num(doc.overallDiscountValue);
  if (!Number.isFinite(overall) || overall < 0) throw new AppError('BAD_DISCOUNT', 'The overall discount must be a number of 0 or more.', 400);
  if ((doc.overallDiscountType || '%') === '%' && overall > 100) {
    throw new AppError('BAD_DISCOUNT', 'The overall discount cannot exceed 100%.', 400);
  }
  const ship = num(doc.shippingCharges);
  if (!Number.isFinite(ship) || ship < 0) throw new AppError('BAD_SHIPPING', `Shipping on a ${what} must be a number of 0 or more.`, 400);
}

/**
 * Checks against the item master (inside the caller's transaction):
 *  - a catalogue item is charged its catalogue GST rate (the branch override
 *    wins, as everywhere else). There is no "exempt line" concept, so a 0% or
 *    other rate on an 18% item is refused (SAL4-5). On an edit, the rate the
 *    stored line already carried is accepted too, so an old bill stays editable
 *    after the catalogue rate changed.
 *  - a line with no catalogue item (typed text / service) must carry a price —
 *    a ₹0 free-text line is almost always an item code typed but never picked
 *    (SAL8-9).
 *  - whole-unit items (NOS, PCS, SET…) are sold in whole numbers (SAL2-8).
 */
export async function assertLinesAgainstCatalogue(
  tx: any,
  doc: any,
  branchId: string,
  opts: { previousItems?: any[] } = {},
): Promise<void> {
  const lines: any[] = (doc.items || []) as any[];
  if (!lines.length) return;
  const ids = [...new Set(lines.map((l) => l?.itemId).filter(Boolean))] as string[];
  const items = ids.length ? await tx.item.findMany({ where: { id: { in: ids } } }) : [];
  const itemById = new Map(items.map((i: any) => [i.id, i]));
  const overrides = ids.length && branchId
    ? await tx.branchStock.findMany({ where: { branchId, itemId: { in: ids } }, select: { itemId: true, gstTaxSlab: true } })
    : [];
  const overrideById = new Map(overrides.map((o: any) => [o.itemId, o.gstTaxSlab]));
  const previousRates = new Map<string, Set<number>>();
  const previousIds = new Set<string>();
  for (const p of opts.previousItems || []) {
    if (!p?.itemId) continue;
    previousIds.add(p.itemId);
    const set = previousRates.get(p.itemId) || new Set<number>();
    set.add(Number(lineRate(p)) || 0);
    previousRates.set(p.itemId, set);
  }

  for (const li of lines) {
    const name = String(li?.itemName || li?.itemCode || 'A line').slice(0, 80);
    const qty = Number(li.quantity);
    const master: any = !li.isCombo && li.itemId ? itemById.get(li.itemId) : null;
    if (master) {
      if (master.isArchived && !previousIds.has(master.id)) throw archivedItemError(master.itemName);
      if (doc.withGst) {
        const rate = Number(lineRate(li)) || 0;
        const catalogue = effectiveTaxSlab(master.gstTaxSlab, overrideById.get(master.id) as any);
        if (rate !== catalogue && !previousRates.get(master.id)?.has(rate)) {
          throw new AppError('BAD_GST', `"${master.itemName}" is charged GST at ${catalogue}% (catalogue rate), not ${rate}%.`, 400);
        }
      }
      if (isWholeUnit(master.unit) && !Number.isInteger(qty)) {
        throw new AppError('WHOLE_UNITS', `"${master.itemName}" is sold in whole ${String(master.unit).toUpperCase()} — ${qty} is not a whole number.`, 400);
      }
    } else if (!li.isCombo) {
      if (!((Number(li.unitPrice) || 0) > 0)) {
        throw new AppError('ZERO_PRICE_LINE', `"${name}" has no catalogue item and no price. Pick the item from the list or enter its price.`, 400);
      }
      // A typed line with no unit has nothing to count by — only a named counted
      // unit (NOS, PCS…) forces whole numbers.
      if (li.unit && isWholeUnit(li.unit) && !Number.isInteger(qty)) {
        throw new AppError('WHOLE_UNITS', `"${name}" is in whole ${String(li.unit).toUpperCase()} — ${qty} is not a whole number.`, 400);
      }
    } else if (!Number.isInteger(qty)) {
      throw new AppError('WHOLE_UNITS', `"${name}" is a kit and is sold in whole sets.`, 400);
    }
  }
}
