import { AppError } from '../middleware/errorHandler.js';

/**
 * THE unit rule for every quantity on the server — stock moves, opening stock,
 * challans, bills, quotes and purchase orders/receipts all use it. Units sold by
 * weight / length / volume / area / time can carry fractional quantities (2.5
 * MTR is real); every other unit (PCS, NOS, SET, BOX, PKT, ROLL…) is counted in
 * whole units (PUR5-2, SAL2-8, INV8-4). Mirrored on screen by src/lib/units.ts.
 */
const MEASURED_UNITS = new Set([
  'KG', 'KGS', 'G', 'GM', 'GMS', 'GRAM', 'GRAMS',
  'M', 'MTR', 'MTRS', 'MTS', 'METER', 'METERS', 'METRE', 'METRES', 'CM', 'MM', 'FT', 'FEET', 'INCH',
  'SQFT', 'SQM',
  'L', 'LTR', 'LTRS', 'LITRE', 'LITRES', 'ML',
  'HR', 'HRS', 'HOUR', 'HOURS',
]);

/** True when the unit is measured, so a fractional quantity is allowed. */
export const allowsFractionalQty = (unit?: string | null): boolean => MEASURED_UNITS.has(String(unit || '').trim().toUpperCase());

/** True when the unit is counted in whole numbers (2.5 NOS is not a thing). */
export const isWholeUnit = (unit?: string | null): boolean => !allowsFractionalQty(unit);

/** Largest single stock movement accepted from a screen or the API. */
export const MAX_STOCK_QTY = 1_000_000;

/**
 * Parse a stock quantity from an untyped request body: a real finite number
 * (a numeric string like "5" is read as 5, anything else is refused), whole for
 * whole-unit items, and within a sane bound (INV8-4 / INV7-1 / INV-23).
 */
export function stockQty(raw: unknown, unit: string | null | undefined, what = 'Quantity'): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isFinite(n)) throw new AppError('BAD_QTY', `${what} must be a number.`, 400);
  if (Math.abs(n) > MAX_STOCK_QTY) throw new AppError('BAD_QTY', `${what} is too large.`, 400);
  if (isWholeUnit(unit) && !Number.isInteger(n)) {
    throw new AppError('BAD_QTY', `${what} must be a whole number for items counted in ${String(unit || 'NOS').toUpperCase()}.`, 400);
  }
  return Math.round(n * 1000) / 1000;
}
