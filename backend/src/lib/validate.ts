import { AppError } from '../middleware/errorHandler.js';
import { isValidBranch } from './constants.js';

/** Recurring-expense frequencies the screen offers (ExpenseFrequency). */
export const RECURRING_FREQUENCIES = ['Monthly', 'Quarterly', 'Half-Yearly', 'Yearly'];
/** Largest single amount a recurring template / expense may carry (VAL-1). */
export const MAX_AMOUNT = 10_000_000; // ₹1 crore

/**
 * Validate and normalise recurring-template fields (VAL-1 / PLT6-1). Wrong types
 * used to reach Prisma and come back as a 500 carrying its validation text.
 * `partial` checks only the fields present (edit); otherwise the required ones
 * must all be there (create). Returns the cleaned values.
 */
export function cleanRecurringFields(b: Record<string, any>, partial = false): Record<string, any> {
  const out: Record<string, any> = {};
  const has = (k: string) => b[k] !== undefined;
  const need = (k: string) => !partial || has(k);

  if (need('name')) {
    if (typeof b.name !== 'string' || !b.name.trim()) throw new AppError('NAME_REQUIRED', 'Expense name is required', 400);
    out.name = b.name.trim();
  }
  if (need('defaultAmount')) {
    const amount = typeof b.defaultAmount === 'string' && b.defaultAmount.trim() !== '' ? Number(b.defaultAmount) : b.defaultAmount;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) throw new AppError('BAD_AMOUNT', 'Amount must be greater than zero', 400);
    if (amount > MAX_AMOUNT) throw new AppError('BAD_AMOUNT', 'Amount is too large', 400);
    out.defaultAmount = amount;
  }
  if (need('branchId')) {
    if (typeof b.branchId !== 'string' || !isValidBranch(b.branchId)) throw new AppError('BAD_BRANCH', 'Choose a valid branch', 400);
    out.branchId = b.branchId;
  }
  if (need('frequency')) {
    if (!RECURRING_FREQUENCIES.includes(b.frequency)) throw new AppError('BAD_FREQUENCY', `Frequency must be one of ${RECURRING_FREQUENCIES.join(', ')}`, 400);
    out.frequency = b.frequency;
  }
  if (has('startMonth')) {
    if (b.startMonth === null || b.startMonth === '') out.startMonth = null;
    else {
      const m = Number(b.startMonth);
      if (typeof b.startMonth === 'boolean' || !Number.isInteger(m) || m < 1 || m > 12) throw new AppError('BAD_START_MONTH', 'Start month must be 1-12', 400);
      out.startMonth = m;
    }
  }
  if (need('dueDay')) {
    const due = Number(b.dueDay);
    if (typeof b.dueDay === 'boolean' || !Number.isInteger(due) || due < 1 || due > 31) throw new AppError('BAD_DUE', 'Due day must be 1–31', 400);
    out.dueDay = due;
  }
  if (need('paymentMode')) {
    if (b.paymentMode !== 'Cash' && b.paymentMode !== 'GPay') throw new AppError('BAD_MODE', "Payment mode must be 'Cash' or 'GPay'", 400);
    out.paymentMode = b.paymentMode;
  }
  if (has('category')) {
    if (b.category !== null && typeof b.category !== 'string') throw new AppError('BAD_CATEGORY', 'Category must be text', 400);
    out.category = b.category;
  }
  return out;
}
