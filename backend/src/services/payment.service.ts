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

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The credit a customer owed AT BILLING, reconstructed from the immutable split:
 * grand total minus everything collected when the bill was made (every
 * non-COD-Credit split). A receipt never changes the non-credit splits, so this
 * is stable for the life of the bill — and correct for legacy already-settled
 * bills too, because the old settlement only ever reduced the COD-Credit split
 * (never a Cash/GPay one).
 */
function originalCredit(inv: any): number {
  const grand = Number(inv.grandTotal) || 0;
  const collectedAtBilling = splitsOf(inv)
    .filter((s) => s.mode !== 'COD-Credit')
    .reduce((t, s) => t + (Number(s.amount) || 0), 0);
  return Math.max(0, round2(grand - collectedAtBilling));
}

/** Sum of customer receipts (Payment 'in' rows) allocated to this invoice. */
async function invoiceReceiptsTotal(tx: any, invoiceId: string): Promise<number> {
  const rows = await tx.payment.findMany({ where: { type: 'in' }, select: { allocations: true } });
  let total = 0;
  for (const p of rows) {
    if (!Array.isArray(p.allocations)) continue;
    for (const a of p.allocations as any[]) {
      if (a?.refId === invoiceId) total += Number(a?.amount) || 0;
    }
  }
  return round2(total);
}

/**
 * An invoice's current outstanding — the ONE money formula (CRM6-1 / SAL4-4):
 *   due = originalCredit − receipts − returns
 * Receipts come from the Payment ledger, NOT from mutating the bill, so the
 * bill's original split (and the cash banked on its — possibly closed — day) is
 * never rewritten. Mirrors the frontend computeInvoiceFinance.
 */
async function computeInvoiceDue(tx: any, inv: any): Promise<number> {
  const receipts = await invoiceReceiptsTotal(tx, inv.id);
  const returns = Number(inv.totalReturnedAmount) || 0;
  return Math.max(0, round2(originalCredit(inv) - receipts - returns));
}

/**
 * Recompute and persist an invoice's balanceDue + partial flags from its
 * immutable split, its receipts and its returns. paymentSplits are NEVER touched
 * here — that is the whole point of the one-source-of-truth model: a receipt
 * lives only as a Payment row, so settling a bill can't retroactively change a
 * closed billing day or resurrect debt on an edit. balanceDue / partialAmount /
 * isPartialPayment stay as convenience caches that the screens already read.
 */
export async function recomputeInvoiceBalance(tx: any, invoiceId: string): Promise<void> {
  const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv) return;
  const grand = Number(inv.grandTotal) || 0;
  const returns = Number(inv.totalReturnedAmount) || 0;
  const due = await computeInvoiceDue(tx, inv);
  const collected = Math.max(0, round2(grand - returns - due)); // net − due
  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      balanceDue: due,
      isPartialPayment: due > 0 && collected > 0,
      partialAmount: due > 0 && collected > 0 ? collected : null,
      updatedAt: nowIso(),
    },
  });
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
    // A customer receipt must hit the drawer of the BILL's branch, not whatever
    // branch the UI was on (CRM4-3). Resolve the branch from the first allocated
    // invoice; fall back to the branch the client sent.
    let branchId = input.branchId;
    if (input.type === 'in' && allocations.length) {
      const firstInv = await tx.invoice.findUnique({ where: { id: allocations[0].refId } });
      if (firstInv?.branchId) branchId = firstInv.branchId;
    }
    // A vendor payment (type 'out') settles POs; book it to the PO's own branch
    // and, below, authorize every settled PO against the user's branch — otherwise
    // a branch-locked user could pay down another branch's payable (PUR6-1).
    if (input.type === 'out' && allocations.length) {
      const firstPo = await tx.purchaseOrder.findUnique({ where: { id: allocations[0].refId } });
      if (firstPo?.branchId) branchId = firstPo.branchId;
    }
    assertBranchAllowed(reqUser, branchId); // a branch-locked user can't bank a receipt to another branch
    // A receipt/payment dated to a day whose drawer is already closed would
    // change that reconciled day's cash total after the fact (CASH-2).
    const closed = await tx.dailyCashRegister.findFirst({ where: { branchId, date, isClosed: true } });
    if (closed) throw new AppError('DAY_CLOSED', `The cash day ${date} is closed. Reopen it before recording this payment.`, 409);

    const receiptNumber = await nextReceiptNumber(tx, input.type, date);

    // Settle allocated documents.
    const appliedAllocations: Allocation[] = [];
    if (input.type === 'in' && allocations.length) {
      // Payment received from a customer → allocate to sales invoices. Cap each
      // allocation at the bill's CURRENT outstanding (never apply more than owed).
      // The invoice is NOT mutated here — the receipt lives only as the Payment
      // row created below, and each bill's balanceDue is recomputed from the
      // ledger AFTER that row exists (so it reflects this receipt). This is the
      // one-source-of-truth model: the bill's original split is left untouched.
      for (const a of allocations) {
        const inv = await tx.invoice.findUnique({ where: { id: a.refId } });
        if (!inv) continue;
        const due = await computeInvoiceDue(tx, inv);
        const apply = Math.min(a.amount, due);
        if (apply > 0.001) appliedAllocations.push({ refId: inv.id, refNumber: inv.invoiceNumber, amount: round2(apply) });
      }
      // SAL6-7: a receipt whose allocations can't be applied to anything (every
      // selected bill is already settled) is refused, not silently banked.
      if (!appliedAllocations.length) {
        throw new AppError('NOTHING_TO_APPLY', 'This receipt could not be applied — the selected bill(s) have no outstanding balance.', 400);
      }
    } else if (input.type === 'out' && allocations.length) {
      // Payment made to a vendor → settle purchase orders (payables).
      for (const a of allocations) {
        const po = await tx.purchaseOrder.findUnique({ where: { id: a.refId } });
        if (!po) continue;
        assertBranchAllowed(reqUser, po.branchId); // PUR6-1: can't settle another branch's PO
        // Cap at the tax-INCLUSIVE payable less debit notes — the same balance
        // used by purchaseOrderBalanceDue and recordPurchaseOrderPayment. Using
        // the ex-tax goods value here silently dropped the GST portion of a
        // vendor payment, so an allocated payment didn't fully apply (PUR4-1).
        const debitTotal = ((po.debitNotes as any[]) || []).reduce((s, dn) => s + (dn.totalAmount || 0), 0);
        const grandOwed = (po.totalAmount || 0) + (Number(po.totalTax) || 0) + (Number(po.otherCharges) || 0);
        const balance = Math.max(0, Math.round((grandOwed - (po.amountPaid || 0) - debitTotal) * 100) / 100);
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
        branchId,
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
    // Now that the receipt row exists, refresh each settled bill's cached
    // balanceDue / partial flags from the ledger (paymentSplits untouched).
    if (input.type === 'in') {
      for (const a of appliedAllocations) await recomputeInvoiceBalance(tx, a.refId);
    }
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
    // Delete the receipt row FIRST, then recompute each bill's due from the
    // remaining ledger — the debt comes back automatically because the receipt is
    // gone, and paymentSplits are never touched (one-source-of-truth model).
    await tx.payment.delete({ where: { id } });
    if (payment.type === 'in') {
      for (const a of allocations) {
        await recomputeInvoiceBalance(tx, a.refId);
      }
      return { ok: true };
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
    return { ok: true };
  }, { isolationLevel: 'Serializable' });
}
