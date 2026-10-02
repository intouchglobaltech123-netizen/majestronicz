import { AppError } from '../middleware/errorHandler.js';

/**
 * Business dates are India Standard Time calendar days. The shop's cash day runs
 * on IST, so anything that books money "today" (refunds, vendor payments, default
 * receipt dates, challans) must use the IST date — the UTC date is still the
 * previous day between 00:00 and 05:30 IST and would land on a (possibly closed)
 * earlier cash day (CASH7-11 / E2E8-10 / PUR7-5).
 */
const IST_OFFSET_MS = 5.5 * 3600 * 1000;

/** Today's IST calendar day, YYYY-MM-DD. */
export const istToday = (): string => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** The IST calendar day of an ISO timestamp (or of now). */
export const istDateOf = (iso?: string): string => {
  const t = iso ? Date.parse(iso) : Date.now();
  return new Date((Number.isNaN(t) ? Date.now() : t) + IST_OFFSET_MS).toISOString().slice(0, 10);
};

/** Current IST wall-clock time, HH:MM. */
export const istTime = (): string => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(11, 16);

/** Strict YYYY-MM-DD that is a REAL calendar date — rejects "hello", "2099-13-45"
 *  and unpadded "2026-9-6" (which could otherwise slip onto the wrong/closed day). */
export function isValidYmd(d: unknown): d is string {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const dt = new Date(`${d}T00:00:00Z`);
  return !isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === d;
}

/**
 * The one "is this a usable business date" check for anything that moves money
 * (sales, receipts, refunds, expenses, opening overrides, recurring approvals,
 * vendor payments): a real date, not after today in IST, not absurdly old
 * (CASH8-7 / CASH6-2). Returns the date.
 */
export function assertBusinessDate(date: unknown, what = 'This entry'): string {
  if (!isValidYmd(date)) throw new AppError('BAD_DATE', `${what} needs a real date in YYYY-MM-DD format.`, 400);
  if (date > istToday()) throw new AppError('BAD_DATE', `${what} cannot be dated in the future.`, 400);
  if (date < '2010-01-01') throw new AppError('BAD_DATE', `${what} is dated too far in the past.`, 400);
  return date;
}

/**
 * A closed cash day is final: its totals are derived from the bills and payments
 * dated to it, so any write that would change them must be refused until a
 * Manager/CEO reopens the day (CASH-2 / CASH7-4).
 */
export async function assertDayOpen(tx: any, branchId: string, date: string, verb: string): Promise<void> {
  const closed = await tx.dailyCashRegister.findFirst({ where: { branchId, date, isClosed: true } });
  if (closed) {
    throw new AppError('DAY_CLOSED', `The cash day ${date} is closed. Reopen it before you ${verb}.`, 409);
  }
}
