import { AppError } from '../middleware/errorHandler.js';

/**
 * CRM10-3 / SAL10-6 / PUR10-7: ONE server allow-list of payment modes, the
 * same lists the screens offer (src/lib/paymentModes.ts). A mode is matched
 * case- and space-insensitively and stored in its canonical spelling, so
 * "Cash " or "cash" is the drawer's Cash (it used to escape the drawer) and
 * "Bitcoin" is refused.
 */
export const RECEIPT_MODES = ['Cash', 'GPay', 'HDFC', 'UPI', 'Card', 'Bank Transfer', 'Cheque'] as const;
export const STORE_CREDIT_MODE = 'Store Credit';
export const REFUND_MODES = ['Cash', 'GPay', 'HDFC'] as const;
export const VENDOR_PAYMENT_MODES = RECEIPT_MODES;

const canon = (list: readonly string[], mode: unknown): string | null => {
  const m = String(mode ?? '').trim().toLowerCase();
  return list.find((x) => x.toLowerCase() === m) ?? null;
};

/** The canonical mode, or a 400 naming the allowed ones. */
export function assertMode(list: readonly string[], mode: unknown, what: string): string {
  const hit = canon(list, mode);
  if (!hit) {
    throw new AppError('BAD_MODE', `"${String(mode ?? '').slice(0, 30)}" is not a payment mode for ${what}. Use ${list.join(', ')}.`, 400);
  }
  return hit;
}

/** True for the drawer's cash, however it was typed (older rows). */
export const isCashModeName = (mode: unknown): boolean => String(mode ?? '').trim().toLowerCase() === 'cash';
