/**
 * THE unit rule on screen — mirrors backend/src/lib/units.ts exactly. Units sold
 * by weight / length / volume / area / time can carry fractional quantities (2.5
 * MTR is real); every other unit (PCS, NOS, SET, BOX, PKT, ROLL…) is counted in
 * whole units (SAL2-8, PUR5-2, INV8-4).
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
