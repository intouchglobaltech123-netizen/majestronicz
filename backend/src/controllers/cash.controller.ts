import { Request, Response } from 'express';
import * as cash from '../services/cash.service.js';
import { assertBranchAllowed } from '../lib/branchGuard.js';
import { cleanRecurringFields, MAX_AMOUNT } from '../lib/validate.js';
import { AppError } from '../middleware/errorHandler.js';
import { recordAudit } from '../services/audit.service.js';

// CASH-12: who did it comes from the login token, never the request body (a
// client could close a day "as CEO"), and every cash event is on the audit trail.
const actorName = (req: Request): string => ((req as any).user?.name as string | undefined)?.trim() || 'unknown';
const auditActor = (req: Request): string => {
  const u = (req as any).user;
  return u ? `${u.name} [${u.role}]` : 'unknown';
};
const audit = (req: Request, action: string, branchId: string, date: string, summary: string, extra: { before?: unknown; after?: unknown } = {}) =>
  recordAudit({ actor: auditActor(req), action, entity: 'cashRegister', entityId: `${branchId}:${date}`, summary, branchId, ...extra });
const rupees = (n: unknown) => `₹${(Number(n) || 0).toLocaleString('en-IN')}`;
const registerOf = (snap: any, branchId: string, date: string) =>
  (snap?.cashRegisters || []).find((r: any) => r.branchId === branchId && r.date === date);

export const addExpense = async (req: Request, res: Response) => {
  const { branchId, date, expense } = req.body;
  assertBranchAllowed((req as any).user, branchId);
  // VAL-1: an upper bound on a single expense (₹1e15 used to be accepted).
  if ((Number(expense?.cashAmount) || 0) > MAX_AMOUNT || (Number(expense?.gpayAmount) || 0) > MAX_AMOUNT) {
    throw new AppError('BAD_AMOUNT', 'Expense amount is too large', 400);
  }
  const result = await cash.addExpense(branchId, date, expense, actorName(req));
  await audit(req, 'cash.expense.add', branchId, date,
    `Expense ${expense?.category ? `${expense.category} · ` : ''}${String(expense?.reason || '').trim()} · cash ${rupees(expense?.cashAmount)} · GPay ${rupees(expense?.gpayAmount)}`);
  res.json(result);
};
export const deleteExpense = async (req: Request, res: Response) => {
  const { branchId, date, expenseId } = req.body;
  assertBranchAllowed((req as any).user, branchId);
  const gone = (registerOf({ cashRegisters: await cash.listRegisters(branchId, date) }, branchId, date)?.expenses || [])
    .find((e: any) => e.id === expenseId);
  const result = await cash.deleteExpense(branchId, date, expenseId);
  await audit(req, 'cash.expense.delete', branchId, date,
    gone ? `Deleted expense ${gone.reason} · cash ${rupees(gone.cashAmount)} · GPay ${rupees(gone.gpayAmount)}` : `Deleted expense ${expenseId}`,
    { before: gone || undefined });
  res.json(result);
};
export const approveExpense = async (req: Request, res: Response) => {
  const { branchId, date, expenseId, decision } = req.body;
  assertBranchAllowed((req as any).user, branchId);
  const result = await cash.approveExpense(branchId, date, expenseId, decision, actorName(req));
  const e = (registerOf(result, branchId, date)?.expenses || []).find((x: any) => x.id === expenseId);
  await audit(req, `cash.expense.${decision === 'approved' ? 'approve' : 'reject'}`, branchId, date,
    `${decision === 'approved' ? 'Approved' : 'Rejected'} ${e?.category || 'expense'} ${e?.reason || ''} · ${rupees((Number(e?.cashAmount) || 0) + (Number(e?.gpayAmount) || 0))}`);
  res.json(result);
};
export const overrideOpening = async (req: Request, res: Response) => {
  const { branchId, date, amount, reason } = req.body;
  assertBranchAllowed((req as any).user, branchId);
  const before = registerOf({ cashRegisters: await cash.listRegisters(branchId, date) }, branchId, date);
  const result = await cash.overrideOpening(branchId, date, amount, reason);
  await audit(req, 'cash.override', branchId, date,
    `Opening overridden ${before ? `from ${rupees(before.openingAmount)} ` : ''}to ${rupees(amount)} — ${String(reason || '').trim()}`);
  res.json(result);
};
export const closeDay = async (req: Request, res: Response) => {
  const { branchId, date, notes } = req.body;
  assertBranchAllowed((req as any).user, branchId);
  const result = await cash.closeDay(branchId, date, notes, actorName(req));
  const reg = registerOf(result, branchId, date);
  await audit(req, 'cash.close', branchId, date, `Closed the cash day · opening ${rupees(reg?.openingAmount)}${notes ? ` · ${notes}` : ''}`);
  res.json(result);
};
export const reopenDay = async (req: Request, res: Response) => {
  const { branchId, date } = req.body;
  assertBranchAllowed((req as any).user, branchId);
  const result = await cash.reopenDay(branchId, date);
  await audit(req, 'cash.reopen', branchId, date, 'Reopened the cash day');
  res.json(result);
};
export const approveRecurring = async (req: Request, res: Response) => {
  const { templateId, branchId, date, amount, paymentMode } = req.body;
  // The recurring approval posts to the template's own branch (see service);
  // still guard the branch the caller claims to be operating on. The service
  // re-guards against the TEMPLATE's branch so a cross-branch template can't be
  // approved into another branch's drawer.
  assertBranchAllowed((req as any).user, branchId);
  const result: any = await cash.approveRecurring(templateId, branchId, date, amount, paymentMode, actorName(req), (req as any).user);
  const t = (result.recurringExpenses || []).find((x: any) => x.id === templateId);
  await audit(req, 'cash.recurring.approve', t?.branchId || branchId, date, `Approved recurring ${t?.name || templateId} · ${rupees(amount)} (${paymentMode})`);
  res.json(result);
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
