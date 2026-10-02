import { prisma } from '../db.js';
import { withLiveBillCounts } from '../lib/liveCounts.js';
import { nowIso, rid } from '../lib/stockLedger.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Customer store credit.
 *
 * A customer can hold a credit balance they spend on future bills. It is raised
 * by a credit-note return (the over-paid portion is banked as credit instead of
 * cash) or a manual adjustment, and lowered when applied to a bill as a
 * 'Store Credit' receipt. `creditBalance` is the live balance; `creditHistory`
 * is the append-only audit of every movement.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CreditEntryInput {
  type: 'issued' | 'applied' | 'adjust';
  reason?: string;
  refId?: string;
  refNumber?: string;
  by?: string;
}

/**
 * Move a customer's credit by `delta` (positive = add, negative = spend) inside
 * the caller's transaction, clamping the balance at zero, and append an audit
 * entry. Returns the amount actually moved (a spend is capped at the balance).
 */
export async function applyCreditDelta(tx: any, customerId: string, delta: number, entry: CreditEntryInput): Promise<number> {
  if (!customerId || !Number.isFinite(delta) || delta === 0) return 0;
  const cust = await tx.customer.findUnique({ where: { id: customerId } });
  if (!cust) return 0;
  const current = Number(cust.creditBalance) || 0;
  // A spend can never take more than the balance holds.
  const moved = delta < 0 ? -Math.min(current, -delta) : delta;
  const balanceAfter = round2(Math.max(0, current + moved));
  const history = Array.isArray(cust.creditHistory) ? (cust.creditHistory as any[]) : [];
  history.push({
    id: rid('cr'),
    date: nowIso(),
    type: entry.type,
    amount: round2(moved),
    balanceAfter,
    reason: entry.reason || null,
    refId: entry.refId || null,
    refNumber: entry.refNumber || null,
    by: entry.by || 'System',
  });
  await tx.customer.update({ where: { id: customerId }, data: { creditBalance: balanceAfter, creditHistory: history as any } });
  return round2(moved);
}

/** Add store credit (e.g. a credit-note return's over-paid portion). */
export async function addCustomerCredit(tx: any, customerId: string, amount: number, entry: CreditEntryInput): Promise<number> {
  if (amount <= 0) return 0;
  return applyCreditDelta(tx, customerId, Math.abs(amount), entry);
}

/** The customer's current store-credit balance. */
export async function creditBalanceOf(tx: any, customerId: string): Promise<number> {
  const cust = await tx.customer.findUnique({ where: { id: customerId } });
  return round2(Math.max(0, Number(cust?.creditBalance) || 0));
}

/**
 * Manually adjust a customer's credit (grant or correct). CEO/Manager only —
 * enforced at the route. A positive amount grants credit, a negative one removes
 * it (clamped at zero).
 */
/** CRM9-11: one manual adjustment can't move more than this. */
export const MAX_CREDIT_ADJUST = 1_000_000;

export function adjustCustomerCredit(customerId: string, amount: number, reason: string, by?: string, reqUser?: any) {
  return prisma.$transaction(async (tx: any) => {
    const cust = await tx.customer.findUnique({ where: { id: customerId } });
    if (!cust) throw new AppError('NOT_FOUND', 'Customer not found', 404);
    const amt = round2(Number(amount));
    if (!Number.isFinite(amt) || amt === 0) throw new AppError('BAD_AMOUNT', 'Enter a non-zero credit amount.', 400);
    if (Math.abs(amt) > MAX_CREDIT_ADJUST) {
      throw new AppError('BAD_AMOUNT', `A single store-credit adjustment can be at most ₹${MAX_CREDIT_ADJUST.toLocaleString('en-IN')}.`, 400);
    }
    if (!String(reason || '').trim()) throw new AppError('REASON_REQUIRED', 'A reason is required to adjust store credit.', 400);
    // CRM9-11: removing more than the customer holds is refused, not clamped silently.
    const balance = round2(Math.max(0, Number(cust.creditBalance) || 0));
    if (amt < 0 && -amt > balance + 0.005) {
      throw new AppError('INSUFFICIENT_CREDIT', `The customer only holds ₹${balance.toFixed(2)} of store credit.`, 400);
    }
    // CRM9-11: a branch Manager adjusts credit only for customers who deal with
    // their branch (a bill or a receipt there), or who have no history yet.
    if (reqUser && reqUser.role !== 'CEO' && reqUser.assignedBranchId) {
      const bills = await tx.invoice.findMany({ where: { customerId }, select: { branchId: true } });
      const pays = await tx.payment.findMany({ where: { partyType: 'customer', partyId: customerId }, select: { branchId: true } });
      const branches = new Set([...bills, ...pays].map((r: any) => r.branchId));
      if (branches.size && !branches.has(reqUser.assignedBranchId)) {
        throw new AppError('FORBIDDEN', "This customer deals with another branch — ask that branch's Manager or the CEO to adjust their credit.", 403);
      }
    }
    await applyCreditDelta(tx, customerId, amt, { type: 'adjust', reason: String(reason).trim().slice(0, 200), by });
    return { customers: await withLiveBillCounts(tx, await tx.customer.findMany(), { all: true }) }; // FIN-A-5
  });
}
