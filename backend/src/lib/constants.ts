export interface Branch {
  id: string;
  name: string;
  shortCode: string;
  location: string;
  isHq: boolean;
}

export const BRANCHES: Branch[] = [
  { id: 'erode-hq', name: 'Erode HQ', shortCode: 'ERD-HQ', location: 'Perundurai Road, Erode', isHq: true },
  { id: 'coimbatore', name: 'Coimbatore', shortCode: 'CBE', location: 'Gandhipuram, Coimbatore', isHq: false },
  { id: 'chennai', name: 'Chennai', shortCode: 'CHE', location: 'Ambattur Industrial Estate, Chennai', isHq: false },
];

export const branchName = (id: string) => BRANCHES.find((b) => b.id === id)?.name || id;
export const branchLocation = (id: string) => BRANCHES.find((b) => b.id === id)?.location || id;
/** True only for a real, known branch id — stock must never move to an unknown branch. */
export const isValidBranch = (id: string): boolean => BRANCHES.some((b) => b.id === id);

/** Units sold by measure, where a fractional quantity (2.5 MTR) is real. Every
 *  other unit (PCS, NOS, SET, BOX…) counts whole pieces (PUR5-2 / PUR-10). */
const MEASURED_UNITS = new Set(['MTR', 'M', 'METER', 'METERS', 'METRE', 'KG', 'KGS', 'G', 'GM', 'GMS', 'LTR', 'L', 'ML', 'FT', 'FEET', 'SQFT', 'SQM', 'CM', 'MM']);
export const allowsFractionalQty = (unit?: string | null): boolean =>
  MEASURED_UNITS.has(String(unit || '').trim().toUpperCase());

// The business-date helpers live in lib/businessDate.ts (IST days); re-exported
// here so older imports keep working with ONE implementation.
export { isValidYmd, istToday } from './businessDate.js';

// Reference config seeded into AppConfig on reseed.
export const STANDARD_UNITS = [
  { value: 'PCS', label: 'PCS (Pieces)' },
  { value: 'BOX', label: 'BOX (Box)' },
  { value: 'NOS', label: 'NOS (Numbers)' },
  { value: 'SET', label: 'SET (Set)' },
  { value: 'MTR', label: 'MTR (Meters)' },
  { value: 'KGS', label: 'KGS (Kilograms)' },
  { value: 'PKT', label: 'PKT (Packets)' },
  { value: 'ROLL', label: 'ROLL (Rolls)' },
];

export const GST_RATES = [
  { rate: 0, label: 'GST @ 0% (Exempt)' },
  { rate: 5, label: 'GST @ 5%' },
  { rate: 12, label: 'GST @ 12%' },
  { rate: 18, label: 'GST @ 18% (Standard)' },
  { rate: 28, label: 'GST @ 28% (High Tax)' },
];

export const PAYMENT_TERMS_OPTIONS = [
  { value: 'Due on Receipt', label: 'Due on Receipt', days: 0 },
  { value: 'Immediate', label: 'Immediate / Spot Cash', days: 0 },
  { value: 'Net 7', label: 'Net 7 Days', days: 7 },
  { value: 'Net 15', label: 'Net 15 Days', days: 15 },
  { value: 'Net 30', label: 'Net 30 Days', days: 30 },
  { value: 'Custom', label: 'Custom Due Date', days: 0 },
];
