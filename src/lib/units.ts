/**
 * Units that are counted, never measured — selling half of one is a typo
 * (SAL2-8). Mirrors backend/src/lib/lineValidation.ts; MTR, KGS and other
 * measured units still allow fractions.
 */
const WHOLE_UNITS = new Set([
  'NOS', 'NO', 'NUMBERS', 'PCS', 'PC', 'PIECE', 'PIECES', 'SET', 'SETS', 'BOX', 'BOXES', 'PKT', 'PACK', 'PACKET',
  'PAIR', 'PAIRS', 'UNIT', 'UNITS', 'EA', 'EACH', 'ROLL', 'ROLLS', 'KIT', 'BTL', 'BOTTLE', 'CAN', 'DOZ',
]);

export const isWholeUnit = (unit?: string): boolean => WHOLE_UNITS.has(String(unit || '').trim().toUpperCase());
