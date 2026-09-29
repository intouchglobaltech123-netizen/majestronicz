import { prisma } from '../db.js';
import { AppError } from '../middleware/errorHandler.js';
import { nowIso } from '../lib/stockLedger.js';
import { assertBranchAllowed } from '../lib/branchGuard.js';
import { serializableTx } from '../lib/tx.js';

/**
 * Party ledger / payments service.
 *
 * A Payment is money received from a customer ("in") or paid to a vendor ("out").
 * Payments received can be allocated across specific unpaid invoices — settling
 * them by reducing their outstanding balance. This mirrors Vyapar's "Receive
 * Payment" flow and is the source of the party ledger.
 */

type Allocation = { refId: string; refNumber?: string; amount: number };

export interface RecordPaymentInput {
  type: 'in' | 'out';
  partyType: 'customer' | 'vendor';
  partyId?: string;
  partyName: string;
  branchId: string;
  date?: string;
  amount: number;
  paymentMode: string;
  reference?: string;
  notes?: string;
  allocations?: Allocation[];
}

/**
 * Sequential receipt number: RCPT-YYYYMM-#### (payment in) / PAY-... (out).
 * Uses the HIGHEST existing number + 1 (not the count), so deleting a receipt no
 * longer makes the next one collide with a surviving number (CRM2-7). Run inside
 * the caller's serializable transaction (with retry) so two receipts at the same
 * moment can't both take the same number.
 */
async function nextReceiptNumber(tx: any, type: 'in' | 'out', date: string): Promise<string> {
  const prefix = type === 'in' ? 'RCPT' : 'PAY';
  const ym = (date || nowIso()).slice(0, 7).replace('-', '');
  const like = `${prefix}-${ym}-`;
  const rows = await tx.payment.findMany({ where: { receiptNumber: { startsWith: like }, type }, select: { receiptNumber: true } });
  let max = 0;
  for (const r of rows) {
    const n = parseInt(String(r.receiptNumber).slice(like.length), 10);
    if (!Number.isNaN(n)) max = Math.max(max, n);
  }
  return `${like}${String(max + 1).padStart(4, '0')}`;
}

/** The payment splits for an invoice, synthesised for legacy single-mode / partial
 *  bills — mirrors the frontend getInvoicePaymentSplits so both agree (SAL-9). */
function splitsOf(inv: any): { mode: string; amount: number }[] {
  const grand = inv.grandTotal || 0;
  if (Array.isArray(inv.paymentSplits) && inv.paymentSplits.length) return inv.paymentSplits;
  if (inv.isPartialPayment && inv.partialAmount && inv.balanceDue) {
    return [
      { mode: inv.paymentMode === 'COD-Credit' ? 'Cash' : inv.paymentMode, amount: inv.partialAmount },
      { mode: 'COD-Credit', amount: inv.balanceDue },
    ];
  }
  return [{ mode: inv.paymentMode || 'Cash', amount: grand }];
}

/**
 * Current outstanding on an invoice — ONE formula, shared with the frontend
 * computeInvoiceFinance (SAL-9): a COD-Credit split is what's still owed, so
 * due = outstanding COD-Credit − returns. Works for a single-split COD bill too
 * (the old code only counted the COD-Credit split when there was MORE than one,
 * so a paid single-split COD bill kept showing its full amount due).
 */
function invoiceDue(inv: any): number {
  const codCredit = splitsOf(inv).filter((s) => s.mode === 'COD-Credit').reduce((t, s) => t + (Number(s.amount) || 0), 0);
  const due = codCredit - (Number(inv.totalReturnedAmount) || 0);
  return Math.max(0, Math.round(due * 100) / 100);
}

/**
 * Reduce an invoice's outstanding by `amount`. The receipt lowers the COD-Credit
 * (unpaid) portion — regardless of how many splits the bill has, so a normal
 * single-split COD bill actually settles (SAL-9). A COD-Credit split is kept in
 * the array even at ₹0 so the due calc reads 0 and never reverts to the bill's
 * original full amount. The collected cash is a SEPARATE Payment row (it reaches
 * the drawer through that row), so no Cash split is added here — that would
 * double-count it.
 */
function settleInvoiceFields(inv: any, amount: number) {
  const billed = inv.grandTotal || 0;
  const currentDue = invoiceDue(inv);
  const pay = Math.min(amount, currentDue);
  const newDue = Math.max(0, Math.round((currentDue - pay) * 100) / 100);

  // Start from the (possibly synthesised) splits so a legacy single-mode COD bill
  // has a real COD-Credit split to reduce.
  let splits: any[] = splitsOf(inv).map((s) => ({ ...s }));
  const hasCodCredit = splits.some((s) => s?.mode === 'COD-Credit');
  if (hasCodCredit) {
    let remaining = pay;
    splits = splits.map((s) => {
      if (s.mode === 'COD-Credit' && remaining > 0) {
        const take = Math.min(remaining, s.amount || 0);
        remaining = Math.round((remaining - take) * 100) / 100;
        return { ...s, amount: Math.round(((s.amount || 0) - take) * 100) / 100 };
      }
      return s;
    });
    // Drop zero non-credit splits but ALWAYS keep the COD-Credit split (even at 0)
    // so the due calc sees codCredit=0 rather than falling back to the full bill.
    splits = splits.filter((s) => s.mode === 'COD-Credit' || (s.amount || 0) > 0.001);
  }

  return {
    balanceDue: newDue,
    isPartialPayment: newDue > 0,
    partialAmount: Math.round((billed - newDue - (inv.totalReturnedAmount || 0)) * 100) / 100,
    paymentSplits: splits,
    applied: pay,
  };
}

export async function recordPayment(input: RecordPaymentInput, actor?: { name?: string; id?: string }, reqUser?: any) {
  const amount = Number(input.amount);
  if (!amount || amount <= 0) throw new AppError('BAD_REQUEST', 'Payment amount must be greater than zero', 400);
  if (!input.partyName?.trim()) throw new AppError('BAD_REQUEST', 'Party name is required', 400);
  if (input.type !== 'in' && input.type !== 'out') throw new AppError('BAD_REQUEST', 'Invalid payment type', 400);
  assertBranchAllowed(reqUser, input.branchId); // SEC2-1: a receipt is booked against a branch's ledger/drawer

  const date = input.date || nowIso().slice(0, 10);
  const allocations = (input.allocations || []).filter((a) => a?.refId && a.amount > 0);
  const allocTotal = allocations.reduce((t, a) => t + a.amount, 0);
  if (allocTotal - amount > 0.01) {
    throw new AppError('BAD_REQUEST', 'Allocated amount exceeds the payment amount', 400);
  }

  // Serializable + retry so simultaneous receipts don't collide on the number
  // or lose one another (CRM2-7 / CASH2-2 Parties receipts).
  return serializableTx(async (tx) => {
    // A receipt/payment dated to a day whose drawer is already closed would
    // change that reconciled day's cash total after the fact (CASH-2).
    const closed = await tx.dailyCashRegister.findFirst({ where: { branchId: input.branchId, date, isClosed: true } });
    if (closed) throw new AppError('DAY_CLOSED', `The cash day ${date} is closed. Reopen it before recording this payment.`, 409);

    const receiptNumber = await nextReceiptNumber(tx, input.type, date);

    // Settle allocated documents.
    const appliedAllocations: Allocation[] = [];
    if (input.type === 'in' && allocations.length) {
      // Payment received from a customer → settle sales invoices.
      for (const a of allocations) {
        const inv = await tx.invoice.findUnique({ where: { id: a.refId } });
        if (!inv) continue;
        const upd = settleInvoiceFields(inv, a.amount);
        await tx.invoice.update({
          where: { id: inv.id },
          data: {
            balanceDue: upd.balanceDue,
            isPartialPayment: upd.isPartialPayment,
            partialAmount: upd.partialAmount,
            paymentSplits: upd.paymentSplits as any,
            updatedAt: nowIso(),
          },
        });
        appliedAllocations.push({ refId: inv.id, refNumber: inv.invoiceNumber, amount: upd.applied });
      }
    } else if (input.type === 'out' && allocations.length) {
      // Payment made to a vendor → settle purchase orders (payables).
      for (const a of allocations) {
        const po = await tx.purchaseOrder.findUnique({ where: { id: a.refId } });
        if (!po) continue;
        const balance = Math.max(0, (po.totalAmount || 0) - (po.amountPaid || 0));
        const pay = Math.min(a.amount, balance);
        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { amountPaid: Math.round(((po.amountPaid || 0) + pay) * 100) / 100, updatedAt: nowIso() },
        });
        appliedAllocations.push({ refId: po.id, refNumber: po.poNumber, amount: pay });
      }
    } else {
      appliedAllocations.push(...allocations);
    }

    const payment = await tx.payment.create({
      data: {
        id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        receiptNumber,
        type: input.type,
        partyType: input.partyType,
        partyId: input.partyId ?? null,
        partyName: input.partyName.trim(),
        branchId: input.branchId,
        date,
        amount,
        paymentMode: input.paymentMode || 'Cash',
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        allocations: appliedAllocations.length ? (appliedAllocations as any) : undefined,
        createdById: actor?.id ?? null,
        createdByName: actor?.name ?? null,
        createdAt: nowIso(),
      },
    });
    return payment;
  });
}

export async function listPayments(filter?: { partyType?: string; partyId?: string; type?: string }) {
  const where: any = {};
  if (filter?.partyType) where.partyType = filter.partyType;
  if (filter?.partyId) where.partyId = filter.partyId;
  if (filter?.type) where.type = filter.type;
  return prisma.payment.findMany({ where, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] });
}

/** Delete a payment and reverse its allocations (restore invoice balances). */
export async function deletePayment(id: string, reqUser?: any) {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id } });
    if (!payment) throw new AppError('NOT_FOUND', 'Payment not found', 404);
    assertBranchAllowed(reqUser, payment.branchId); // SEC2-1
    // Deleting a payment dated to a closed day would change that day's cash (CASH-2).
    const closed = await tx.dailyCashRegister.findFirst({ where: { branchId: payment.branchId, date: payment.date, isClosed: true } });
    if (closed) throw new AppError('DAY_CLOSED', `The cash day ${payment.date} is closed. Reopen it before deleting this payment.`, 409);
    const allocations: Allocation[] = Array.isArray(payment.allocations) ? (payment.allocations as any) : [];
    if (payment.type === 'in') {
      for (const a of allocations) {
        const inv = await tx.invoice.findUnique({ where: { id: a.refId } });
        if (!inv) continue;
        // Put the debt back by RE-ADDING to the COD-Credit split — due is read
        // from that split now, so only bumping balanceDue would leave the bill
        // still showing as paid (CRM4-4).
        const billed = inv.grandTotal || 0;
        const cur = splitsOf(inv).map((s) => ({ ...s }));
        const nonCredit = cur.filter((s) => s.mode !== 'COD-Credit');
        const curCod = cur.filter((s) => s.mode === 'COD-Credit').reduce((t, s) => t + (Number(s.amount) || 0), 0);
        const nonCreditTotal = nonCredit.reduce((t, s) => t + (Number(s.amount) || 0), 0);
        const newCod = Math.max(0, Math.min(billed - nonCreditTotal, Math.round((curCod + a.amount) * 100) / 100));
        const splits = [...nonCredit, { mode: 'COD-Credit', amount: newCod }];
        const restoredDue = Math.max(0, Math.round((newCod - (inv.totalReturnedAmount || 0)) * 100) / 100);
        await tx.invoice.update({
          where: { id: inv.id },
          data: {
            paymentSplits: splits as any,
            balanceDue: restoredDue,
            isPartialPayment: restoredDue > 0 && restoredDue < billed,
            partialAmount: Math.round((billed - restoredDue - (inv.totalReturnedAmount || 0)) * 100) / 100,
            updatedAt: nowIso(),
          },
        });
      }
    } else if (payment.type === 'out') {
      for (const a of allocations) {
        const po = await tx.purchaseOrder.findUnique({ where: { id: a.refId } });
        if (!po) continue;
        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { amountPaid: Math.max(0, Math.round(((po.amountPaid || 0) - a.amount) * 100) / 100), updatedAt: nowIso() },
        });
      }
    }
    await tx.payment.delete({ where: { id } });
    return { ok: true };
  }, { isolationLevel: 'Serializable' });
}
