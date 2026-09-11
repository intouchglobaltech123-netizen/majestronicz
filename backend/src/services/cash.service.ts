import { prisma } from '../db.js';
import { AppError } from '../middleware/errorHandler.js';
import { nowIso, rid } from '../lib/stockLedger.js';

const snap = async (tx: any) => ({
  cashRegisters: await tx.dailyCashRegister.findMany(),
  recurringExpenses: await tx.recurringExpenseTemplate.findMany(),
});

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
    const cashSales = dayInvoices
      .filter((i: any) => !i.isVoided && i.paymentMode === 'Cash')
      .reduce((sum: number, i: any) => {
        const amount = i.isPartialPayment && i.partialAmount ? i.partialAmount : i.grandTotal;
        return sum + Math.max(0, amount - (i.totalReturnedAmount || 0));
      }, 0);
    const cashExpenses = (last.expenses as any[]).reduce((s, e) => s + (e.cashAmount || 0), 0);
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
    const newExpense = {
      id: rid('exp'), reason: (expense.reason || '').trim(),
      cashAmount: Number(expense.cashAmount) || 0, gpayAmount: Number(expense.gpayAmount) || 0,
      createdBy: actor, createdAt: nowIso(),
    };
    await tx.dailyCashRegister.update({
      where: { id: reg.id }, data: { expenses: [...(reg.expenses as any[]), newExpense] },
    });
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
