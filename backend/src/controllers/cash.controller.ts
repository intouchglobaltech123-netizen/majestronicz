import { Request, Response } from 'express';
import * as cash from '../services/cash.service.js';
import { assertBranchAllowed } from '../lib/branchGuard.js';

export const addExpense = async (req: Request, res: Response) => {
  const { branchId, date, expense, actor } = req.body;
  assertBranchAllowed((req as any).user, branchId);
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
  // still guard the branch the caller claims to be operating on.
  assertBranchAllowed((req as any).user, branchId);
  res.json(await cash.approveRecurring(templateId, branchId, date, amount, paymentMode, actor));
};

// Dedicated replacements for the removed generic PUT/DELETE
// /api/recurring-expenses/:id — see cash.service.ts for why they are not a
// blind row write. Mounted under /api/cash, which already requires
// 'cash:write'; the branch guard below stops a branch-scoped user from moving
// a template into, or deleting one belonging to, a branch they cannot touch.
export const updateRecurring = async (req: Request, res: Response) => {
  const updates = (req.body ?? {}) as Record<string, any>;
  if (updates.branchId !== undefined) assertBranchAllowed((req as any).user, updates.branchId);
  res.json(await cash.updateRecurringTemplate(req.params.id, updates));
};

export const deleteRecurring = async (req: Request, res: Response) => {
  res.json(await cash.deleteRecurringTemplate(req.params.id));
};
