import { prisma } from '../db.js';
import { AppError } from '../middleware/errorHandler.js';
import { nowIso } from '../lib/stockLedger.js';

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

/** Sequential-ish receipt number: RCPT-YYYYMM-#### (payment in) / PAY-... (out). */
async function nextReceiptNumber(type: 'in' | 'out', date: string): Promise<string> {
  const prefix = type === 'in' ? 'RCPT' : 'PAY';
  const ym = (date || nowIso()).slice(0, 7).replace('-', '');
  const like = `${prefix}-${ym}-`;
  const count = await prisma.payment.count({ where: { receiptNumber: { startsWith: like }, type } });
  return `${like}${String(count + 1).padStart(4, '0')}`;
}

/** Current outstanding on an invoice — mirrors the frontend getCustomerOutstandingSummary logic. */
function invoiceDue(inv: any): number {
  const billed = inv.grandTotal || 0;
  const splits: any[] = Array.isArray(inv.paymentSplits) ? inv.paymentSplits : [];
  const hasCodCredit = splits.some((s) => s?.mode === 'COD-Credit');
  let due = 0;
  if (splits.length > 1 && hasCodCredit) {
    due = splits.filter((s) => s.mode === 'COD-Credit').reduce((t, s) => t + (s.amount || 0), 0);
  } else if (inv.isPartialPayment) {
    due = inv.balanceDue != null ? inv.balanceDue : Math.max(0, billed - (inv.partialAmount || 0));
  } else if (inv.transactionType === 'Credit' || inv.paymentMode === 'COD-Credit') {
    due = inv.balanceDue != null ? inv.balanceDue : billed;
  } else if (inv.balanceDue && inv.balanceDue > 0) {
    due = inv.balanceDue;
  }
  if (inv.totalReturnedAmount) due = Math.max(0, due - inv.totalReturnedAmount);
  return Math.max(0, Math.round(due * 100) / 100);
}

/** Reduce an invoice's outstanding by `amount`, keeping both split- and balanceDue-driven logic consistent. */
function settleInvoiceFields(inv: any, amount: number) {
  const billed = inv.grandTotal || 0;
  const currentDue = invoiceDue(inv);
  const pay = Math.min(amount, currentDue);
  const newDue = Math.max(0, Math.round((currentDue - pay) * 100) / 100);

  let splits: any[] = Array.isArray(inv.paymentSplits) ? [...inv.paymentSplits] : [];
  const hasCodCredit = splits.some((s) => s?.mode === 'COD-Credit');
  if (splits.length > 1 && hasCodCredit) {
    // Reduce the COD-Credit (unpaid) portion; add/increase a settlement split.
    let remaining = pay;
    splits = splits.map((s) => {
      if (s.mode === 'COD-Credit' && remaining > 0) {
        const take = Math.min(remaining, s.amount || 0);
        remaining -= take;
        return { ...s, amount: Math.round(((s.amount || 0) - take) * 100) / 100 };
      }
      return s;
    }).filter((s) => (s.amount || 0) > 0.001);
  }

  return {
    balanceDue: newDue,
    isPartialPayment: newDue > 0,
    partialAmount: Math.round((billed - newDue - (inv.totalReturnedAmount || 0)) * 100) / 100,
    paymentSplits: splits.length ? splits : inv.paymentSplits ?? undefined,
    applied: pay,
  };
}

export async function recordPayment(input: RecordPaymentInput, actor?: { name?: string; id?: string }) {
  const amount = Number(input.amount);
  if (!amount || amount <= 0) throw new AppError('BAD_REQUEST', 'Payment amount must be greater than zero', 400);
  if (!input.partyName?.trim()) throw new AppError('BAD_REQUEST', 'Party name is required', 400);
  if (input.type !== 'in' && input.type !== 'out') throw new AppError('BAD_REQUEST', 'Invalid payment type', 400);

  const date = input.date || nowIso().slice(0, 10);
  const allocations = (input.allocations || []).filter((a) => a?.refId && a.amount > 0);
  const allocTotal = allocations.reduce((t, a) => t + a.amount, 0);
  if (allocTotal - amount > 0.01) {
    throw new AppError('BAD_REQUEST', 'Allocated amount exceeds the payment amount', 400);
  }

  return prisma.$transaction(async (tx) => {
    const receiptNumber = await nextReceiptNumber(input.type, date);

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
  }, { isolationLevel: 'Serializable' });
}

export async function listPayments(filter?: { partyType?: string; partyId?: string; type?: string }) {
  const where: any = {};
  if (filter?.partyType) where.partyType = filter.partyType;
  if (filter?.partyId) where.partyId = filter.partyId;
  if (filter?.type) where.type = filter.type;
  return prisma.payment.findMany({ where, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] });
}

/** Delete a payment and reverse its allocations (restore invoice balances). */
export async function deletePayment(id: string) {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id } });
    if (!payment) throw new AppError('NOT_FOUND', 'Payment not found', 404);
    const allocations: Allocation[] = Array.isArray(payment.allocations) ? (payment.allocations as any) : [];
    if (payment.type === 'in') {
      for (const a of allocations) {
        const inv = await tx.invoice.findUnique({ where: { id: a.refId } });
        if (!inv) continue;
        // Restore the outstanding by re-adding the settled amount.
        const billed = inv.grandTotal || 0;
        const restoredDue = Math.min(billed, Math.round((invoiceDue(inv) + a.amount) * 100) / 100);
        await tx.invoice.update({
          where: { id: inv.id },
          data: {
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
