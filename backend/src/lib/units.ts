import { AppError } from '../middleware/errorHandler.js';

/**
 * Units measured by weight / length / volume can carry fractional quantities;
 * every other unit (pieces, boxes, numbers, sets, packets, rolls) is counted in
 * whole units. Same list as the stock screens (AdjustStockModal / TransferStockModal).
 */
const DECIMAL_UNITS = new Set([
  'KG', 'KGS', 'GM', 'GMS', 'GRAM', 'GRAMS',
  'MTR', 'MTRS', 'MTS', 'CM', 'FT', 'INCH',
  'LTR', 'LTRS', 'LITRE', 'LITRES', 'ML',
]);

/** True when the unit is counted in whole numbers (2.5 NOS is not a thing). */
export const isWholeUnit = (unit?: string | null): boolean => !DECIMAL_UNITS.has(String(unit || '').trim().toUpperCase());

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
