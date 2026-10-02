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
/** SAL9-9: the largest unit price and quantity one line may carry. */
export const MAX_LINE_PRICE = 10_000_000; // ₹1 crore
export const MAX_LINE_QTY = 100_000;

export function assertLineInputs(doc: any, what: 'bill' | 'quotation' = 'bill'): void {
  const withGst = !!doc.withGst;
  const num = (v: unknown) => (v === '' || v == null ? 0 : Number(v));
  let netSum = 0;
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
    if (price > MAX_LINE_PRICE) throw new AppError('BAD_PRICE', `"${name}": a unit price above ₹1 crore is not accepted.`, 400);
    if (qty > MAX_LINE_QTY) throw new AppError('INVALID_QTY', `"${name}": a quantity above ${MAX_LINE_QTY.toLocaleString('en-IN')} is not accepted.`, 400);
    // SAL9-10: a ₹-off larger than the line's value was silently clamped to ₹0.
    const gross = Math.round(qty * price * 100) / 100;
    if ((li.discountType || '%') !== '%' && disc > gross + 0.005) {
      throw new AppError('BAD_DISCOUNT', `"${name}": the discount ₹${disc} is more than the line's value ₹${gross}.`, 400);
    }
    netSum += Math.max(0, gross - ((li.discountType || '%') === '%' ? (gross * Math.min(100, disc)) / 100 : disc));
  }
  const overall = num(doc.overallDiscountValue);
  if (!Number.isFinite(overall) || overall < 0) throw new AppError('BAD_DISCOUNT', 'The overall discount must be a number of 0 or more.', 400);
  if ((doc.overallDiscountType || '%') === '%' && overall > 100) {
    throw new AppError('BAD_DISCOUNT', 'The overall discount cannot exceed 100%.', 400);
  }
  if ((doc.overallDiscountType || '%') !== '%' && overall > Math.round(netSum * 100) / 100 + 0.01) {
    throw new AppError('BAD_DISCOUNT', `The overall discount ₹${overall} is more than the ${what}'s value ₹${Math.round(netSum * 100) / 100}.`, 400);
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
/** SAL4-5: a kit (combo) line is charged GST at this rate — the rate the sale
 *  form puts on every combo line. */
export const COMBO_GST_RATE = 18;

export async function assertLinesAgainstCatalogue(
  tx: any,
  doc: any,
  branchId: string,
  opts: { previousItems?: any[]; canEditPrice?: boolean; canDiscount?: boolean } = {},
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

  // SAL4-5: the role's billing rights (the access matrix, read the same way as
  // the sale form) — a role without 'Edit item price' can't bill below the
  // catalogue price, and one without 'Give discounts' can't add a discount
  // beyond the item's own standard discount. A line already on the stored bill
  // (edit) keeps its price and discount.
  const prevLine = new Map<string, any>();
  for (const p of opts.previousItems || []) if (p?.id) prevLine.set(String(p.id), p);
  const comboIds = lines.filter((l) => l?.isCombo && l?.comboId).map((l) => String(l.comboId));
  const combos = comboIds.length && (opts.canEditPrice === false || doc.withGst)
    ? await tx.comboItem.findMany({ where: { id: { in: comboIds } } }) : [];
  const comboById = new Map(combos.map((c: any) => [c.id, c]));
  const prevComboRates = new Set<number>((opts.previousItems || []).filter((p: any) => p?.isCombo).map((p: any) => Number(lineRate(p)) || 0));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const keptFromBill = (li: any, field: 'unitPrice' | 'discount') => {
    const old = prevLine.get(String(li?.id || ''));
    if (!old || (old.itemId || '') !== (li.itemId || '')) return false;
    return field === 'unitPrice'
      ? Math.abs((Number(old.unitPrice) || 0) - (Number(li.unitPrice) || 0)) < 0.005
      : (old.discountType || '%') === (li.discountType || '%') && Math.abs((Number(lineDiscount(old)) || 0) - (Number(lineDiscount(li)) || 0)) < 0.0001;
  };
  if (opts.canDiscount === false && (Number(doc.overallDiscountValue) || 0) > 0) {
    throw new AppError('NO_DISCOUNT_RIGHT', 'Your role is not permitted to give discounts on a bill.', 403);
  }

  for (const li of lines) {
    const name = String(li?.itemName || li?.itemCode || 'A line').slice(0, 80);
    const qty = Number(li.quantity);
    const master: any = !li.isCombo && li.itemId ? itemById.get(li.itemId) : null;
    if (li.isCombo && doc.withGst) {
      const rate = Number(lineRate(li)) || 0;
      if (rate !== COMBO_GST_RATE && !prevComboRates.has(rate)) {
        throw new AppError('BAD_GST', `The kit "${name}" is charged GST at ${COMBO_GST_RATE}%, not ${rate}%.`, 400);
      }
    }
    // SAL10-5: prices are converted with the CATALOGUE rate (the branch override
    // wins), never the rate the request carries — a "0%" line on a GST-off bill
    // must not lower the floor.
    const catalogueRate = master ? effectiveTaxSlab(master.gstTaxSlab, overrideById.get(master.id) as any)
      : li.isCombo ? COMBO_GST_RATE : Number(lineRate(li)) || 0;
    if (opts.canDiscount === false && (Number(lineDiscount(li)) || 0) > 0 && !keptFromBill(li, 'discount')) {
      // The item's own standard discount (applied by the form) is allowed.
      // SAL10-4: compared in RUPEES PER UNIT, in the line's own price basis (the
      // form converts a ₹ standard discount the same way), to the paisa — a %
      // comparison against the catalogue price refused the form's own discount.
      const std = master ? Number(master.discountOnSalePrice) || 0 : 0;
      const unitPrice = Number(li.unitPrice) || 0;
      const factor = 1 + catalogueRate / 100;
      const inclusive = master?.salePriceTaxMode === 'with';
      const stdPerUnit = !master || std <= 0 ? 0
        : (master.discountType || '%') === '%' ? (unitPrice * Math.min(100, std)) / 100
          : r2(doc.withGst ? (inclusive ? std / factor : std) : (inclusive ? std : std * factor));
      const disc = Number(lineDiscount(li)) || 0;
      const perUnit = (li.discountType || '%') === '%' ? (unitPrice * Math.min(100, disc)) / 100 : (qty > 0 ? disc / qty : disc);
      if (perUnit > stdPerUnit + 0.01) throw new AppError('NO_DISCOUNT_RIGHT', `Your role is not permitted to give a discount on "${name}".`, 403);
    }
    if (opts.canEditPrice === false && !keptFromBill(li, 'unitPrice')) {
      const rate = catalogueRate;
      let floor: number | null = null;
      if (master) {
        const sale = Number(master.salePrice) || 0;
        const wholesale = Number(master.wholesalePrice) || 0;
        const base = wholesale > 0 ? Math.min(sale, wholesale) : sale;
        const preOn = master.salePriceTaxMode === 'with' ? base / (1 + rate / 100) : base;
        floor = doc.withGst ? preOn : preOn * (1 + rate / 100);
      } else if (li.isCombo && comboById.has(String(li.comboId))) {
        const cp = Number((comboById.get(String(li.comboId)) as any).comboPrice) || 0;
        floor = doc.withGst ? cp : cp * (1 + rate / 100);
      }
      if (floor != null && (Number(li.unitPrice) || 0) < r2(floor) - 0.01) {
        throw new AppError('NO_PRICE_RIGHT', `Your role is not permitted to bill "${name}" below its catalogue price (₹${r2(floor)}).`, 403);
      }
    }
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
