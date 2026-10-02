import { AppError } from '../middleware/errorHandler.js';
import { prisma } from '../db.js';
import { nowIso, rid } from '../lib/stockLedger.js';
import { assertBranchAllowed } from '../lib/branchGuard.js';
import { serializableTx } from '../lib/tx.js';
import { cashAtBilling } from '../lib/billingSplit.js';
import { assertBusinessDate, assertDayOpen } from '../lib/businessDate.js';

const snap = async (tx: any) => ({
  cashRegisters: await registersWithLiveOpenings(tx),
  recurringExpenses: await tx.recurringExpenseTemplate.findMany(),
});

const round2 = (n: number) => Math.round(n * 100) / 100;
const DEFAULT_OPENING = (branchId: string) => (branchId === 'erode-hq' ? 12000 : 8000);
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const isCashMode = (p: any) => String(p?.paymentMode || '').toLowerCase() === 'cash';
const effectiveExpense = (e: any) => e && (e.approvalStatus == null || e.approvalStatus === 'approved');

/**
 * Per-day net cash movement of a branch from everything EXCEPT register
 * expenses: cash taken on bills on their own day (the frozen at-billing split —
 * see lib/billingSplit; returns are refunded as Payment 'out' rows on the return
 * day, SAL4-12) plus cash receipts minus cash paid out in the Payment ledger.
 */
async function dailyCashFlow(tx: any, branchId: string): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  const add = (d: string, v: number) => m.set(d, (m.get(d) || 0) + v);
  const invoices = await tx.invoice.findMany({
    where: { branchId },
    select: { date: true, grandTotal: true, paymentSplits: true, paymentMode: true, isPartialPayment: true, partialAmount: true, isVoided: true },
  });
  for (const i of invoices) add(i.date, cashAtBilling(i));
  const pays = await tx.payment.findMany({ where: { branchId }, select: { date: true, type: true, amount: true, paymentMode: true } });
  for (const p of pays) {
    if (!isCashMode(p)) continue;
    add(p.date, p.type === 'in' ? Number(p.amount) || 0 : p.type === 'out' ? -(Number(p.amount) || 0) : 0);
  }
  return m;
}

/**
 * Opening balances of a branch — ONE carry-forward rule shared with the screen
 * (src/lib/cashClosing.ts effectiveOpening mirrors it):
 *   - a CLOSED day or a day whose opening was overridden keeps its stored
 *     opening (a closed day never changes);
 *   - any other day opens at the previous register day's closing plus the cash
 *     activity of the register-less days in between (CASH-1);
 *   - a branch's first register opens at the default float plus all earlier
 *     cash activity (CASH8-4).
 * Openings of open days are therefore always live: reopening an earlier day and
 * adding to it moves every later OPEN day's opening (CASH-5).
 * Returns a lookup for any date (with or without a register).
 */
async function branchOpenings(tx: any, branchId: string): Promise<(date: string) => number> {
  return (await branchCashBook(tx, branchId)).openingOf;
}

/** Opening and closing of every register day of every branch (for reports and the
 *  one-time data fix, which proves closed days keep their figures). */
export async function registerFigures(tx: any): Promise<{ branchId: string; date: string; isClosed: boolean; opening: number; closing: number }[]> {
  const regs = await tx.dailyCashRegister.findMany({ select: { branchId: true, date: true, isClosed: true } });
  const out: any[] = [];
  for (const b of [...new Set<string>(regs.map((r: any) => r.branchId))]) {
    const book = await branchCashBook(tx, b);
    for (const p of book.points) out.push({ branchId: b, ...p, isClosed: regs.some((r: any) => r.branchId === b && r.date === p.date && r.isClosed) });
  }
  return out;
}

async function branchCashBook(tx: any, branchId: string) {
  const flow = await dailyCashFlow(tx, branchId);
  const flowDays = [...flow.keys()].sort();
  const regs = (await tx.dailyCashRegister.findMany({ where: { branchId } }))
    .sort((a: any, b: any) => (a.date === b.date ? String(a.id).localeCompare(String(b.id)) : a.date.localeCompare(b.date)));
  const flowBetween = (from: string | null, to: string) =>
    flowDays.filter((d) => (from == null || d >= from) && d < to).reduce((t, d) => t + (flow.get(d) || 0), 0);
  // checkpoints: [date, opening, closing] for each register day, in order
  const points: { date: string; opening: number; closing: number }[] = [];
  let bal = DEFAULT_OPENING(branchId);
  let cursor: string | null = null;
  for (const r of regs) {
    if (points.length && points[points.length - 1].date === r.date) continue; // legacy duplicate row
    bal += flowBetween(cursor, r.date);
    const opening = r.isClosed || r.isOpeningOverridden ? Number(r.openingAmount) || 0 : round2(bal);
    const expenses = ((r.expenses as any[]) || []).filter(effectiveExpense).reduce((t, e) => t + (Number(e.cashAmount) || 0), 0);
    const closing = round2(opening + (flow.get(r.date) || 0) - expenses);
    points.push({ date: r.date, opening, closing });
    bal = closing;
    cursor = nextDay(r.date);
  }
  const openingOf = (date: string) => {
    let prev: { date: string; opening: number; closing: number } | null = null;
    for (const p of points) {
      if (p.date === date) return round2(p.opening);
      if (p.date < date) prev = p;
    }
    if (!prev) return round2(DEFAULT_OPENING(branchId) + flowBetween(null, date));
    return round2(prev.closing + flowBetween(nextDay(prev.date), date));
  };
  return { points, openingOf };
}

export async function effectiveOpening(tx: any, branchId: string, date: string): Promise<number> {
  return (await branchOpenings(tx, branchId))(date);
}

/** Registers as the screens should see them: an open, non-overridden day's
 *  opening is the live carry-forward, never a stale stored figure (CASH-5). */
export async function registersWithLiveOpenings(tx: any, rows?: any[]): Promise<any[]> {
  const list = rows || (await tx.dailyCashRegister.findMany());
  const byBranch = new Map<string, (d: string) => number>();
  const out: any[] = [];
  for (const r of list) {
    if (r.isClosed || r.isOpeningOverridden) { out.push(r); continue; }
    if (!byBranch.has(r.branchId)) byBranch.set(r.branchId, await branchOpenings(tx, r.branchId));
    out.push({ ...r, openingAmount: byBranch.get(r.branchId)!(r.date) });
  }
  return out;
}

async function loadRegister(tx: any, branchId: string, date: string) {
  // Look up by (branchId, date), NOT by a constructed `dcr-${branchId}-${date}`
  // id. Seeded rows use abbreviated ids (dcr-erd-…, dcr-cbe-…) that never matched
  // the constructed id, so closing a seeded day created a hidden duplicate row
  // while the original stayed open (CASH2-1). orderBy keeps the choice
  // deterministic if a legacy duplicate already exists.
  return tx.dailyCashRegister.findFirst({
    where: { branchId, date },
    orderBy: { id: 'asc' },
  });
}

async function ensureRegister(tx: any, branchId: string, date: string) {
  const existing = await loadRegister(tx, branchId, date);
  if (existing) return existing;
  const opening = await effectiveOpening(tx, branchId, date);
  return tx.dailyCashRegister.create({
    data: { id: `dcr-${branchId}-${date}`, branchId, date, openingAmount: opening, isOpeningOverridden: false, expenses: [], isClosed: false },
  });
}

/** The register row(s) of one branch and day, as the screens see them (for audit summaries). */
export async function listRegisters(branchId: string, date: string) {
  return registersWithLiveOpenings(prisma, await prisma.dailyCashRegister.findMany({ where: { branchId, date } }));
}

export function addExpense(branchId: string, date: string, expense: any, actor: string) {
  // An expense needs a real date that is not in the future (IST) — VAL-1 / CASH6-2.
  assertBusinessDate(date, 'An expense');
  return serializableTx(async (tx: any) => {
    await assertDayOpen(tx, branchId, date, 'add an expense'); // CASH10-1: also any day before a closed one
    const reg = await ensureRegister(tx, branchId, date);
    // Amounts can't be negative, and at least one must be positive (CASH2-5/VAL-1).
    const cashAmt = Number(expense.cashAmount) || 0;
    const gpayAmt = Number(expense.gpayAmount) || 0;
    if (cashAmt < 0 || gpayAmt < 0) throw new AppError('BAD_AMOUNT', 'Expense amount cannot be negative', 400);
    if (cashAmt <= 0 && gpayAmt <= 0) throw new AppError('BAD_AMOUNT', 'Enter a Cash or GPay amount greater than zero', 400);
    if (!((expense.reason || '').trim())) throw new AppError('REASON_REQUIRED', 'Expense reason is required', 400);
    const category = (expense.category || '').trim() || undefined;
    const newExpense = {
      id: rid('exp'), reason: (expense.reason || '').trim(),
      category,
      billUrl: expense.billUrl || undefined,
      cashAmount: Number(expense.cashAmount) || 0, gpayAmount: Number(expense.gpayAmount) || 0,
      // Bank deposits require Manager/CEO approval before they reduce the drawer.
      approvalStatus: category === 'Deposit to Bank' ? 'pending' : undefined,
      createdBy: actor, createdAt: nowIso(),
    };
    await tx.dailyCashRegister.update({
      where: { id: reg.id }, data: { expenses: [...(reg.expenses as any[]), newExpense] },
    });
    return snap(tx);
  });
}

/** Manager/CEO decision on a pending expense (e.g. bank deposit). */
export function approveExpense(branchId: string, date: string, expenseId: string, decision: string, actor: string) {
  return serializableTx(async (tx: any) => {
    const reg = await loadRegister(tx, branchId, date);
    if (!reg) throw new AppError('NOT_FOUND', 'Cash register not found', 404);
    // A closed day's totals are final — no approving/rejecting into it (CASH2-5).
    await assertDayOpen(tx, branchId, date, 'approve or reject an expense'); // CASH10-1
    if (decision !== 'approved' && decision !== 'rejected') {
      throw new AppError('BAD_REQUEST', "Decision must be 'approved' or 'rejected'", 400);
    }
    const target = (reg.expenses as any[]).find((e) => e.id === expenseId);
    if (!target) throw new AppError('NOT_FOUND', 'Expense not found', 404);
    // Only a still-pending item can be decided — blocks re-approving an already
    // decided one, or "approving" an entry that never needed approval (CASH2-5).
    if (target.approvalStatus !== 'pending') {
      throw new AppError('NOT_PENDING', 'This expense is not awaiting approval', 409);
    }
    const status = decision;
    const expenses = (reg.expenses as any[]).map((e) =>
      e.id === expenseId ? { ...e, approvalStatus: status, approvedBy: actor, approvedAt: nowIso() } : e
    );
    await tx.dailyCashRegister.update({ where: { id: reg.id }, data: { expenses } });
    return snap(tx);
  });
}

export function deleteExpense(branchId: string, date: string, expenseId: string) {
  return serializableTx(async (tx: any) => {
    const reg = await loadRegister(tx, branchId, date);
    if (!reg) return snap(tx);
    await assertDayOpen(tx, branchId, date, 'delete an expense'); // CASH10-1
    await tx.dailyCashRegister.update({
      where: { id: reg.id }, data: { expenses: (reg.expenses as any[]).filter((e) => e.id !== expenseId) },
    });

    // If this expense came from a recurring template's approval, clear that
    // approval too — otherwise the template stays "Approved" for the month with no
    // matching expense in the drawer (CASH-7).
    const templates = await tx.recurringExpenseTemplate.findMany();
    for (const t of templates) {
      const hist = (t.approvalHistory as any[]) || [];
      if (!hist.some((a) => a.cashExpenseId === expenseId)) continue;
      const newHist = hist.filter((a) => a.cashExpenseId !== expenseId);
      const months = newHist.map((a) => a.month).filter(Boolean).sort();
      await tx.recurringExpenseTemplate.update({
        where: { id: t.id },
        data: { approvalHistory: newHist, lastApprovedMonth: months.length ? months[months.length - 1] : null },
      });
      break;
    }
    return snap(tx);
  });
}

export function overrideOpening(branchId: string, date: string, amount: unknown, reason: unknown) {
  // CASH8-3: a real, non-negative amount, a reason, and a day that is not in the
  // future — a bad value is a 400, never a 500 or a stray future register.
  assertBusinessDate(date, 'An opening-balance override');
  const amt = typeof amount === 'string' && amount.trim() !== '' ? Number(amount) : typeof amount === 'number' ? amount : NaN;
  if (!Number.isFinite(amt) || amt < 0) throw new AppError('BAD_AMOUNT', 'The opening balance must be a number of zero or more.', 400);
  const why = String(reason ?? '').trim();
  if (!why) throw new AppError('REASON_REQUIRED', 'A reason is required to override the opening balance.', 400);
  return serializableTx(async (tx: any) => {
    await assertDayOpen(tx, branchId, date, 'override the opening balance'); // CASH10-1
    const reg = await ensureRegister(tx, branchId, date);
    await tx.dailyCashRegister.update({
      where: { id: reg.id }, data: { openingAmount: round2(amt), isOpeningOverridden: true, overrideReason: why },
    });
    return snap(tx);
  });
}

export function closeDay(branchId: string, date: string, notes: string | undefined, actor: string) {
  return serializableTx(async (tx: any) => {
    // Never close a day in the future — it has no transactions yet and locking it
    // corrupts the opening-balance chain (CASH-9). Compare against the IST date.
    const todayIST = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    if (date > todayIST) throw new AppError('FUTURE_DAY', 'Cannot close a future day.', 400);
    const reg = await ensureRegister(tx, branchId, date);
    // CASH6-3: a day can't be closed while a deposit (or any expense) still waits
    // for approval — once closed it could never be decided, yet it would sit in
    // the day's reports. Approve or reject it first.
    const pending = ((reg.expenses as any[]) || []).filter((e) => e?.approvalStatus === 'pending');
    if (pending.length) {
      throw new AppError('PENDING_APPROVALS', `Approve or reject the ${pending.length} pending item(s) (e.g. "${pending[0].reason}") before closing this day.`, 409);
    }
    // Freeze the live opening into the row as the day closes: from now on this
    // day's figures never move, whatever happens to earlier open days.
    const opening = reg.isClosed || reg.isOpeningOverridden ? reg.openingAmount : await effectiveOpening(tx, branchId, date);
    await tx.dailyCashRegister.update({
      where: { id: reg.id }, data: { openingAmount: opening, isClosed: true, closedAt: nowIso(), closedBy: actor, closingNotes: notes ?? null },
    });
    return snap(tx);
  });
}

export function reopenDay(branchId: string, date: string) {
  return serializableTx(async (tx: any) => {
    const reg = await loadRegister(tx, branchId, date);
    if (reg) await tx.dailyCashRegister.update({ where: { id: reg.id }, data: { isClosed: false } });
    return snap(tx);
  });
}

export function approveRecurring(templateId: string, branchId: string, date: string, amount: number, paymentMode: string, actor: string, reqUser?: any) {
  return serializableTx(async (tx: any) => {
    const template = await tx.recurringExpenseTemplate.findUnique({ where: { id: templateId } });
    if (!template) throw new AppError('NOT_FOUND', 'Recurring template not found', 404);
    // A branch-locked user must not approve an expense into another branch's drawer
    // — the expense posts to the TEMPLATE's branch, so authorize against that.
    assertBranchAllowed(reqUser, template.branchId || branchId);

    assertBusinessDate(date, 'A recurring-expense approval'); // CASH8-7: no future-dated approvals
    // Validate the money and mode (CASH2-5): no negative/zero amounts, and only
    // real payment modes — not "Bitcoin".
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new AppError('BAD_AMOUNT', 'Approved amount must be greater than zero', 400);
    }
    if (paymentMode !== 'Cash' && paymentMode !== 'GPay') {
      throw new AppError('BAD_MODE', "Payment mode must be 'Cash' or 'GPay'", 400);
    }

    // Block a second approval for the same month — otherwise e.g. rent posts
    // twice (₹25,000 × 2) (CASH2-5).
    const monthKey = date.substring(0, 7);
    const alreadyApproved =
      template.lastApprovedMonth === monthKey ||
      ((template.approvalHistory as any[]) || []).some((a) => a.month === monthKey);
    if (alreadyApproved) {
      throw new AppError('ALREADY_APPROVED', `This recurring expense is already approved for ${monthKey}`, 409);
    }

    // Post the approved expense to the TEMPLATE's own branch, not whichever drawer
    // the approver happens to be viewing — otherwise e.g. Coimbatore rent lands in
    // the Erode register (CASH-6).
    const targetBranch = template.branchId || branchId;
    await assertDayOpen(tx, targetBranch, date, 'approve this recurring expense'); // CASH10-1
    const reg = await ensureRegister(tx, targetBranch, date);

    const expenseId = rid('exp-rec');
    const newExpense = {
      id: expenseId, reason: template.name,
      // Carry the template's category so the posted expense groups under it in the
      // P&L / Expense reports instead of "Uncategorised".
      category: template.category || undefined,
      cashAmount: paymentMode === 'Cash' ? amount : 0, gpayAmount: paymentMode === 'GPay' ? amount : 0,
      createdBy: actor, createdAt: nowIso(),
    };
    await tx.dailyCashRegister.update({
      where: { id: reg.id }, data: { expenses: [...(reg.expenses as any[]), newExpense] },
    });

    const approval = { id: `appr-${Date.now()}`, month: monthKey, date, approvedAt: nowIso(), approvedBy: actor, actualAmount: amount, paymentMode, cashExpenseId: expenseId };
    await tx.recurringExpenseTemplate.update({
      where: { id: templateId },
      data: { lastApprovedMonth: monthKey, approvalHistory: [approval, ...((template.approvalHistory as any[]) || [])] },
    });
    return snap(tx);
  });
}

// ── Recurring expense templates: edit + delete ──────────────────────────────
//
// These exist because the generic `PUT/DELETE /api/recurring-expenses/:id`
// routes were removed from `crud.ts` (rightly — a blind full-row write let any
// holder of the resource's write capability rewrite whole tables), but the
// Recurring Expenses screen still called them. Every edit and delete has been
// returning 404 since, while the UI reported success. Same regression class as
// Edit Item, vendor delete and employee delete.
//
// A dedicated route instead of restoring the generic one, so the rules that a
// blind update cannot express are enforced here:
//   * only the template's own descriptive fields are writable,
//   * the approval ledger (`lastApprovedMonth`, `approvalHistory`) is NOT —
//     it is the record of money already posted to a register, and a client
//     that could rewrite it could forge or erase an approved payment, or
//     re-approve a month that was already paid,
//   * the same amount/mode/day validation `approveRecurring` already applies.

/** Fields a client may change on a template. Everything else is server-owned. */
const RECURRING_EDITABLE = [
  'name', 'defaultAmount', 'branchId', 'frequency', 'startMonth', 'dueDay', 'paymentMode', 'category',
] as const;

export function updateRecurringTemplate(id: string, updates: Record<string, any>, reqUser?: any) {
  return serializableTx(async (tx: any) => {
    const template = await tx.recurringExpenseTemplate.findUnique({ where: { id } });
    if (!template) throw new AppError('NOT_FOUND', 'Recurring template not found', 404);
    // SEC2-1: a branch-locked user can only touch a template that belongs to
    // their branch — not just avoid moving it into someone else's.
    assertBranchAllowed(reqUser, template.branchId);

    const data: Record<string, any> = {};
    for (const key of RECURRING_EDITABLE) {
      if (updates[key] !== undefined) data[key] = updates[key];
    }

    if (data.name !== undefined) {
      const name = String(data.name).trim();
      if (!name) throw new AppError('BAD_NAME', 'Name cannot be empty', 400);
      data.name = name;
    }
    if (data.defaultAmount !== undefined) {
      const amount = Number(data.defaultAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new AppError('BAD_AMOUNT', 'Default amount must be greater than zero', 400);
      }
      data.defaultAmount = amount;
    }
    if (data.dueDay !== undefined) {
      const day = Number(data.dueDay);
      if (!Number.isInteger(day) || day < 1 || day > 31) {
        throw new AppError('BAD_DUE_DAY', 'Due day must be a day of the month (1-31)', 400);
      }
      data.dueDay = day;
    }
    if (data.paymentMode !== undefined && data.paymentMode !== 'Cash' && data.paymentMode !== 'GPay') {
      throw new AppError('BAD_MODE', "Payment mode must be 'Cash' or 'GPay'", 400);
    }
    if (data.branchId !== undefined && !String(data.branchId).trim()) {
      throw new AppError('BAD_BRANCH', 'Branch is required', 400);
    }
    if (Object.keys(data).length === 0) {
      throw new AppError('NO_FIELDS', 'Nothing to update', 400);
    }

    await tx.recurringExpenseTemplate.update({ where: { id }, data });
    return snap(tx);
  });
}

export function deleteRecurringTemplate(id: string, reqUser?: any) {
  return serializableTx(async (tx: any) => {
    const template = await tx.recurringExpenseTemplate.findUnique({ where: { id } });
    if (!template) throw new AppError('NOT_FOUND', 'Recurring template not found', 404);
    assertBranchAllowed(reqUser, template.branchId); // SEC2-1

    // Deleting the template stops future approvals; it does not touch expenses
    // already posted to a register, which stay in the day's cash book where the
    // money actually moved. So this is safe to allow even for a template with
    // approval history — no accounting record is lost.
    await tx.recurringExpenseTemplate.delete({ where: { id } });
    return snap(tx);
  });
}
