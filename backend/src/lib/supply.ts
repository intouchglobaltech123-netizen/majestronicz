/**
 * Place of supply. The shop is in Tamil Nadu (GST state code 33): a supply to
 * any other state is inter-state and taxed as IGST instead of CGST + SGST.
 */
export const HOME_STATE_CODE = '33';

const STATE_CODES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '25': 'Daman & Diu', '26': 'Dadra & Nagar Haveli', '27': 'Maharashtra', '29': 'Karnataka',
  '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman & Nicobar', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
const CODE_BY_NAME = new Map(Object.entries(STATE_CODES).map(([code, name]) => [norm(name), code]));

/**
 * The 2-digit state code of a place-of-supply value: "29-Karnataka" → 29,
 * "Karnataka" → 29, "Tamil Nadu" → 33. Empty or unrecognised text counts as the
 * home state (SAL8-5: "Tamil Nadu" without a code used to count as inter-state).
 */
export function supplyStateCode(stateOfSupply: unknown): string {
  const raw = String(stateOfSupply ?? '').trim();
  if (!raw) return HOME_STATE_CODE;
  const m = raw.match(/^(\d{1,2})\b/);
  if (m) return m[1].padStart(2, '0');
  return CODE_BY_NAME.get(norm(raw)) || HOME_STATE_CODE;
}

export const isInterState = (stateOfSupply: unknown): boolean => supplyStateCode(stateOfSupply) !== HOME_STATE_CODE;

/** IGST view of the lines/totals for an inter-state supply; unchanged otherwise. */
export function applySupplySplit(doc: any): void {
  if (!isInterState(doc.stateOfSupply)) return;
  doc.totalCgst = 0;
  doc.totalSgst = 0;
  doc.items = (doc.items || []).map((li: any) => ({ ...li, cgstAmount: 0, sgstAmount: 0, igstAmount: li.totalTax }));
}
