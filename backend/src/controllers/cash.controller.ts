import { Request, Response } from 'express';
import * as cash from '../services/cash.service.js';
import { assertBranchAllowed } from '../lib/branchGuard.js';
import { cleanRecurringFields, MAX_AMOUNT } from '../lib/validate.js';
import { AppError } from '../middleware/errorHandler.js';

export const addExpense = async (req: Request, res: Response) => {
  const { branchId, date, expense, actor } = req.body;
  assertBranchAllowed((req as any).user, branchId);
  // VAL-1: an upper bound on a single expense (₹1e15 used to be accepted).
  if ((Number(expense?.cashAmount) || 0) > MAX_AMOUNT || (Number(expense?.gpayAmount) || 0) > MAX_AMOUNT) {
    throw new AppError('BAD_AMOUNT', 'Expense amount is too large', 400);
  }
  res.json(await cash.addExpense(branchId, date, expense, actor));
};
export const deleteExpense = async (req: Request, res: Response) => {
  const { branchId, date, expenseId } = req.body;
  assertBranchAllowed((req as any).user, branchId);
  res.json(await cash.deleteExpense(branchId, date, expenseId));
};
export const approveExpense = async (req: Request, res: Response) => {
  const { branchId, date, expenseId, decision, actor } = req.body;
  assertBranchAllowed((req as any).user, branchId);
  res.json(await cash.approveExpense(branchId, date, expenseId, decision, actor));
};
export const overrideOpening = async (req: Request, res: Response) => {
  const { branchId, date, amount, reason } = req.body;
  assertBranchAllowed((req as any).user, branchId);
  res.json(await cash.overrideOpening(branchId, date, amount, reason));
};
export const closeDay = async (req: Request, res: Response) => {
  const { branchId, date, notes, actor } = req.body;
  assertBranchAllowed((req as any).user, branchId);
  res.json(await cash.closeDay(branchId, date, notes, actor));
};
export const reopenDay = async (req: Request, res: Response) => {
  const { branchId, date } = req.body;
  assertBranchAllowed((req as any).user, branchId);
  res.json(await cash.reopenDay(branchId, date));
};
export const approveRecurring = async (req: Request, res: Response) => {
  const { templateId, branchId, date, amount, paymentMode, actor } = req.body;
  // The recurring approval posts to the template's own branch (see service);
  // still guard the branch the caller claims to be operating on. The service
  // re-guards against the TEMPLATE's branch so a cross-branch template can't be
  // approved into another branch's drawer.
  assertBranchAllowed((req as any).user, branchId);
  res.json(await cash.approveRecurring(templateId, branchId, date, amount, paymentMode, actor, (req as any).user));
};

// Dedicated replacements for the removed generic PUT/DELETE
// /api/recurring-expenses/:id — see cash.service.ts for why they are not a
// blind row write. Mounted under /api/cash, which already requires
// 'cash:write'; the branch guard below stops a branch-scoped user from moving
// a template into, or deleting one belonging to, a branch they cannot touch.
export const updateRecurring = async (req: Request, res: Response) => {
  // VAL-1 / PLT6-1: validate types and whitelist frequency/branch before the
  // service sees them (it keeps its own field allow-list and template-branch check).
  const updates = cleanRecurringFields((req.body ?? {}) as Record<string, any>, true);
  // Guard the destination branch here; the service also guards the template's
  // current branch so an out-of-branch template can't be edited at all (SEC2-1).
  if (updates.branchId !== undefined) assertBranchAllowed((req as any).user, updates.branchId);
  res.json(await cash.updateRecurringTemplate(req.params.id, updates, (req as any).user));
};

export const deleteRecurring = async (req: Request, res: Response) => {
  res.json(await cash.deleteRecurringTemplate(req.params.id, (req as any).user));
};
