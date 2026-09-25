import { prisma } from '../db.js';
import { AppError } from '../middleware/errorHandler.js';
import { nowIso, rid } from '../lib/stockLedger.js';

const snap = async (tx: any) => ({
  cashRegisters: await tx.dailyCashRegister.findMany(),
  recurringExpenses: await tx.recurringExpenseTemplate.findMany(),
});

// Cash actually collected on an invoice — sum of Cash-mode payment splits when
// present, otherwise the legacy single-mode logic. Net of returns.
function invoiceCashCollected(i: any): number {
  if (i.isVoided) return 0;
  let cash = 0;
  const splits = Array.isArray(i.paymentSplits) ? i.paymentSplits : null;
  if (splits && splits.length > 0) {
    cash = splits.filter((s: any) => s.mode === 'Cash').reduce((sum: number, s: any) => sum + (Number(s.amount) || 0), 0);
  } else if (i.paymentMode === 'Cash') {
    cash = i.isPartialPayment && i.partialAmount ? i.partialAmount : i.grandTotal;
  }
  return Math.max(0, cash - (i.totalReturnedAmount || 0));
}

/** Carry-forward opening balance from the most recent closed day (else branch default). */
async function previousDayClosingBalance(tx: any, branchId: string, date: string): Promise<number> {
  const pastClosed = await tx.dailyCashRegister.findMany({
    where: { branchId, isClosed: true, date: { lt: date } },
    orderBy: { date: 'desc' },
    take: 1,
  });
  if (pastClosed.length) {
    const last = pastClosed[0];
    const dayInvoices = await tx.invoice.findMany({ where: { branchId, date: last.date } });
    const cashSales = dayInvoices.reduce((sum: number, i: any) => sum + invoiceCashCollected(i), 0);
    // Only effective expenses reduce the drawer (skip expenses still pending / rejected approval).
    const cashExpenses = (last.expenses as any[])
      .filter((e) => e.approvalStatus == null || e.approvalStatus === 'approved')
      .reduce((s, e) => s + (e.cashAmount || 0), 0);
    return last.openingAmount + cashSales - cashExpenses;
  }
  return branchId === 'erode-hq' ? 12000 : 8000;
}

async function loadRegister(tx: any, branchId: string, date: string) {
  return tx.dailyCashRegister.findUnique({ where: { id: `dcr-${branchId}-${date}` } });
}

async function ensureRegister(tx: any, branchId: string, date: string) {
  const existing = await loadRegister(tx, branchId, date);
  if (existing) return existing;
  const opening = await previousDayClosingBalance(tx, branchId, date);
  return tx.dailyCashRegister.create({
    data: { id: `dcr-${branchId}-${date}`, branchId, date, openingAmount: opening, isOpeningOverridden: false, expenses: [], isClosed: false },
  });
}

export function addExpense(branchId: string, date: string, expense: any, actor: string) {
  return prisma.$transaction(async (tx: any) => {
    const reg = await ensureRegister(tx, branchId, date);
    if (reg.isClosed) throw new AppError('DAY_CLOSED', 'Cash register for this day is closed', 409);
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
  return prisma.$transaction(async (tx: any) => {
    const reg = await loadRegister(tx, branchId, date);
    if (!reg) throw new AppError('NOT_FOUND', 'Cash register not found', 404);
    const status = decision === 'approved' ? 'approved' : 'rejected';
    const expenses = (reg.expenses as any[]).map((e) =>
      e.id === expenseId ? { ...e, approvalStatus: status, approvedBy: actor, approvedAt: nowIso() } : e
    );
    await tx.dailyCashRegister.update({ where: { id: reg.id }, data: { expenses } });
    return snap(tx);
  });
}

export function deleteExpense(branchId: string, date: string, expenseId: string) {
  return prisma.$transaction(async (tx: any) => {
    const reg = await loadRegister(tx, branchId, date);
    if (!reg) return snap(tx);
    if (reg.isClosed) throw new AppError('DAY_CLOSED', 'Register is closed', 409);
    await tx.dailyCashRegister.update({
      where: { id: reg.id }, data: { expenses: (reg.expenses as any[]).filter((e) => e.id !== expenseId) },
    });
    return snap(tx);
  });
}

export function overrideOpening(branchId: string, date: string, amount: number, reason: string) {
  return prisma.$transaction(async (tx: any) => {
    const reg = await ensureRegister(tx, branchId, date);
    if (reg.isClosed) throw new AppError('DAY_CLOSED', 'Register is closed', 409);
    await tx.dailyCashRegister.update({
      where: { id: reg.id }, data: { openingAmount: amount, isOpeningOverridden: true, overrideReason: reason },
    });
    return snap(tx);
  });
}

export function closeDay(branchId: string, date: string, notes: string | undefined, actor: string) {
  return prisma.$transaction(async (tx: any) => {
    const reg = await ensureRegister(tx, branchId, date);
    await tx.dailyCashRegister.update({
      where: { id: reg.id }, data: { isClosed: true, closedAt: nowIso(), closedBy: actor, closingNotes: notes ?? null },
    });
    return snap(tx);
  });
}

export function reopenDay(branchId: string, date: string) {
  return prisma.$transaction(async (tx: any) => {
    const reg = await loadRegister(tx, branchId, date);
    if (reg) await tx.dailyCashRegister.update({ where: { id: reg.id }, data: { isClosed: false } });
    return snap(tx);
  });
}

export function approveRecurring(templateId: string, branchId: string, date: string, amount: number, paymentMode: string, actor: string) {
  return prisma.$transaction(async (tx: any) => {
    const template = await tx.recurringExpenseTemplate.findUnique({ where: { id: templateId } });
    if (!template) throw new AppError('NOT_FOUND', 'Recurring template not found', 404);
    const reg = await ensureRegister(tx, branchId, date);
    if (reg.isClosed) throw new AppError('DAY_CLOSED', 'Register is closed', 409);

    const expenseId = rid('exp-rec');
    const newExpense = {
      id: expenseId, reason: template.name,
      cashAmount: paymentMode === 'Cash' ? amount : 0, gpayAmount: paymentMode === 'GPay' ? amount : 0,
      createdBy: actor, createdAt: nowIso(),
    };
    await tx.dailyCashRegister.update({
      where: { id: reg.id }, data: { expenses: [...(reg.expenses as any[]), newExpense] },
    });

    const monthKey = date.substring(0, 7);
    const approval = { id: `appr-${Date.now()}`, month: monthKey, date, approvedAt: nowIso(), approvedBy: actor, actualAmount: amount, paymentMode, cashExpenseId: expenseId };
    await tx.recurringExpenseTemplate.update({
      where: { id: templateId },
      data: { lastApprovedMonth: monthKey, approvalHistory: [approval, ...((template.approvalHistory as any[]) || [])] },
    });
    return snap(tx);
  });
}
