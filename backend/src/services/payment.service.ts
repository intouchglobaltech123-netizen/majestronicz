import { prisma } from '../db.js';
import { AppError } from '../middleware/errorHandler.js';
import { nowIso } from '../lib/stockLedger.js';
import { assertBranchAllowed } from '../lib/branchGuard.js';
import { serializableTx } from '../lib/tx.js';
import { isValidBranch } from '../lib/constants.js';
import { roleCan } from '../lib/auth.js';
import { nextPersistent } from '../lib/sequences.js';
import { creditBalanceOf, applyCreditDelta } from './customerCredit.service.js';
import { poPayCap, poBalance, unappliedOf } from '../lib/poMoney.js';

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
  // Persist a high-water mark so a receipt number is NEVER reissued after the row
  // that held it is deleted (CRM2-7): take the greater of the surviving max and
  // the stored counter, then bump and persist it.
  const next = await nextPersistent(tx, `seq:${prefix.toLowerCase()}:${like}`, max);
  return `${like}${String(next).padStart(4, '0')}`;
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

/** Sum of customer receipts (Payment 'in' rows) allocated to this invoice. */
export async function invoiceReceiptsTotal(tx: any, invoiceId: string): Promise<number> {
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
 * Cash REFUNDED to the customer against this bill (return refunds are Payment
 * 'out' rows allocated to the invoice). This is money that LEFT the drawer to the
 * customer, so it raises what they owe: a refund given against a receipt that is
 * later deleted must still count, or the restored debt is understated (the bug
 * where deleting a receipt after a refund brought back the wrong debt).
 */
export async function invoiceRefundsTotal(tx: any, invoiceId: string): Promise<number> {
  const rows = await tx.payment.findMany({ where: { type: 'out', partyType: 'customer' }, select: { allocations: true } });
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
 * The credit a customer owed AT BILLING, as an EXPLICIT stored anchor
 * (`inv.creditOriginal`). Earlier this was reconstructed from the split
 * (grand − non-credit splits), but on legacy data a receipt that lived BOTH as a
 * split AND as a Payment ledger row got subtracted twice — the bug that made a
 * ₹1,024 receipt drop a ₹3,024 debt to ₹1,000 instead of ₹2,000, and resurrected
 * already-settled debts. The anchor is captured ONCE from the current state so
 * the displayed due is preserved exactly, then only ledger receipts/returns move
 * it afterwards — no double counting, no migration needed.
 */
export async function ensureCreditOriginal(tx: any, invoiceId: string): Promise<void> {
  const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv || inv.creditOriginal != null) return;
  const storedDue = Math.max(0, Number(inv.balanceDue) || 0);
  const receipts = await invoiceReceiptsTotal(tx, invoiceId);
  const refunds = await invoiceRefundsTotal(tx, invoiceId);
  const returns = Number(inv.totalReturnedAmount) || 0;
  // Anchor so CURRENT due (= stored balanceDue) == creditOriginal − receipts − returns + refunds.
  const creditOriginal = Math.max(0, round2(storedDue + receipts + returns - refunds));
  await tx.invoice.update({ where: { id: invoiceId }, data: { creditOriginal } });
}

/** The owed-at-billing credit for an invoice, preferring the stored anchor and
 *  falling back to the split reconstruction only if it was never anchored. */
function creditOriginalOf(inv: any): number {
  if (inv.creditOriginal != null) return Math.max(0, Number(inv.creditOriginal) || 0);
  const grand = Number(inv.grandTotal) || 0;
  const collectedAtBilling = splitsOf(inv)
    .filter((s) => s.mode !== 'COD-Credit')
    .reduce((t, s) => t + (Number(s.amount) || 0), 0);
  return Math.max(0, round2(grand - collectedAtBilling));
}

/** An invoice's current outstanding: creditOriginal − receipts − returns + refunds. */
async function computeInvoiceDue(tx: any, inv: any): Promise<number> {
  const receipts = await invoiceReceiptsTotal(tx, inv.id);
  const refunds = await invoiceRefundsTotal(tx, inv.id);
  const returns = Number(inv.totalReturnedAmount) || 0;
  return Math.max(0, round2(creditOriginalOf(inv) - receipts - returns + refunds));
}

/**
 * Recompute and persist an invoice's balanceDue + partial flags from its anchored
 * credit, its receipts and its returns. Anchors creditOriginal on first touch (so
 * the current due is preserved exactly). paymentSplits are NEVER touched.
 */
export async function recomputeInvoiceBalance(tx: any, invoiceId: string): Promise<void> {
  const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv) return;
  let creditOriginal = inv.creditOriginal;
  if (creditOriginal == null) {
    const storedDue = Math.max(0, Number(inv.balanceDue) || 0);
    const receipts0 = await invoiceReceiptsTotal(tx, invoiceId);
    const refunds0 = await invoiceRefundsTotal(tx, invoiceId);
    const returns0 = Number(inv.totalReturnedAmount) || 0;
    creditOriginal = Math.max(0, round2(storedDue + receipts0 + returns0 - refunds0));
  }
  const grand = Number(inv.grandTotal) || 0;
  const returns = Number(inv.totalReturnedAmount) || 0;
  const receipts = await invoiceReceiptsTotal(tx, invoiceId);
  const refunds = await invoiceRefundsTotal(tx, invoiceId);
  const due = Math.max(0, round2(Number(creditOriginal) - receipts - returns + refunds));
  const collected = Math.max(0, round2(grand - returns - due)); // net − due
  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      creditOriginal,
      balanceDue: due,
      isPartialPayment: due > 0 && collected > 0,
      partialAmount: due > 0 && collected > 0 ? collected : null,
      updatedAt: nowIso(),
    },
  });
}

/** Strict YYYY-MM-DD that is a REAL calendar date — rejects "hello", "2099-13-45"
 *  and unpadded "2026-9-6" (which could otherwise slip onto the wrong/closed day). */
function isValidYmd(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const dt = new Date(`${d}T00:00:00Z`);
  return !isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === d;
}

export async function recordPayment(input: RecordPaymentInput, actor?: { name?: string; id?: string }, reqUser?: any) {
  const amount = Number(input.amount);
  if (!amount || amount <= 0) throw new AppError('BAD_REQUEST', 'Payment amount must be greater than zero', 400);
  if (!input.partyName?.trim()) throw new AppError('BAD_REQUEST', 'Party name is required', 400);
  if (input.type !== 'in' && input.type !== 'out') throw new AppError('BAD_REQUEST', 'Invalid payment type', 400);
  // Paying a vendor (type 'out') is a purchase action — it must not be done by a
  // role without purchase rights (e.g. Billing) through the Parties screen (PUR6-1).
  if (input.type === 'out' && reqUser && !roleCan(reqUser.role, 'purchase:write')) {
    throw new AppError('FORBIDDEN', `Role ${reqUser.role} is not permitted to pay vendors.`, 403);
  }
  // Recording a customer receipt (type 'in') is a cash-desk action. The Purchase
  // role carries payment:write only to PAY vendors — it must not take or hold
  // customer money. Gate customer receipts on cash:write (Billing/Manager/CEO).
  if (input.type === 'in' && reqUser && !roleCan(reqUser.role, 'cash:write')) {
    throw new AppError('FORBIDDEN', `Role ${reqUser.role} is not permitted to record customer receipts.`, 403);
  }
  assertBranchAllowed(reqUser, input.branchId); // SEC2-1: a receipt is booked against a branch's ledger/drawer

  const date = input.date || nowIso().slice(0, 10);
  if (!isValidYmd(date)) throw new AppError('BAD_DATE', 'Payment date must be a real date in YYYY-MM-DD format', 400);
  // Reject impossible dates: nothing in the future, and nothing absurdly old
  // (a mistyped 2099 or 1990 would otherwise land a receipt on a nonexistent day).
  const istToday = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10); // IST calendar day
  if (date > istToday) throw new AppError('BAD_DATE', 'A payment cannot be dated in the future.', 400);
  if (date < '2010-01-01') throw new AppError('BAD_DATE', 'That payment date is too far in the past.', 400);
  const isVendorOut = input.type === 'out' && input.partyType === 'vendor';
  // PUR8-8: a vendor allocation of ₹0 / a negative amount is a mistake, not a no-op.
  if (isVendorOut && (input.allocations || []).some((a) => a?.refId && !(Number(a.amount) > 0))) {
    throw new AppError('NOTHING_TO_APPLY', 'Each purchase order in a payment needs an amount greater than ₹0.', 400);
  }
  const allocations = (input.allocations || [])
    .map((a) => (isVendorOut && a ? { ...a, amount: Number(a.amount) } : a))
    .filter((a) => a?.refId && a.amount > 0);
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
      // All allocated bills must be in ONE branch — a single receipt is banked to
      // one drawer, so a lump sum spanning branches (e.g. Chennai + Coimbatore)
      // would all land in one branch's cash. Require a separate receipt per branch.
      const invs = await tx.invoice.findMany({ where: { id: { in: allocations.map((a) => a.refId) } } });
      const branches = new Set(invs.map((i: any) => i.branchId));
      if (branches.size > 1) {
        throw new AppError('CROSS_BRANCH', 'A single receipt can only cover bills from one branch. Record a separate receipt per branch.', 400);
      }
      if (invs[0]?.branchId) branchId = invs[0].branchId;
    }
    // An on-account receipt (no bill) needs a specific branch — it can't be banked
    // to "All Branches" (which silently fell back to Erode).
    if (input.type === 'in' && !allocations.length && !isValidBranch(branchId)) {
      throw new AppError('BAD_BRANCH', 'Choose a specific branch for an on-account receipt.', 400);
    }
    // A vendor payment (type 'out') settles POs; book it to the PO's own branch
    // and, below, authorize every settled PO against the user's branch — otherwise
    // a branch-locked user could pay down another branch's payable (PUR6-1).
    let vendorPartyId: string | null = null;
    if (isVendorOut) {
      const pos: any[] = [];
      for (const a of allocations) {
        const po = await tx.purchaseOrder.findUnique({ where: { id: a.refId } });
        // PUR8-8: an allocation to a PO that doesn't exist is refused, not booked as ₹0.
        if (!po) throw new AppError('NOTHING_TO_APPLY', `Purchase order ${a.refNumber || a.refId} was not found.`, 400);
        pos.push(po);
      }
      // CASH8-5 / PUR3-5: one payment voucher is one supplier and one drawer.
      if (new Set(pos.map((po) => po.vendorId)).size > 1) {
        throw new AppError('MIXED_VENDORS', 'One payment can only settle purchase orders of one supplier.', 400);
      }
      if (input.partyId && pos.some((po) => po.vendorId !== input.partyId)) {
        throw new AppError('WRONG_VENDOR', "This payment's supplier does not match the purchase order's supplier.", 400);
      }
      if (new Set(pos.map((po) => po.branchId)).size > 1) {
        throw new AppError('CROSS_BRANCH', 'One payment can only cover purchase orders of one branch. Record a separate payment per branch.', 400);
      }
      if (pos[0]?.branchId) branchId = pos[0].branchId;
      vendorPartyId = input.partyId || pos[0]?.vendorId || null;
      // The unapplied part of a vendor payment is kept as that supplier's advance,
      // so the supplier must be known and the drawer must be a real branch.
      if (!vendorPartyId) throw new AppError('VENDOR_REQUIRED', 'Choose the supplier this payment is for.', 400);
      const vendor = await tx.vendor.findUnique({ where: { id: vendorPartyId }, select: { id: true } });
      if (!vendor) throw new AppError('BAD_VENDOR', 'The selected supplier does not exist.', 400);
      if (!isValidBranch(branchId)) throw new AppError('BAD_BRANCH', 'Choose a specific branch for this payment.', 400);
    }
    assertBranchAllowed(reqUser, branchId); // a branch-locked user can't bank a receipt to another branch
    // A receipt/payment dated to a day whose drawer is already closed would
    // change that reconciled day's cash total after the fact (CASH-2).
    const closed = await tx.dailyCashRegister.findFirst({ where: { branchId, date, isClosed: true } });
    if (closed) throw new AppError('DAY_CLOSED', `The cash day ${date} is closed. Reopen it before recording this payment.`, 409);

    const receiptNumber = await nextReceiptNumber(tx, input.type, date);
    const paymentId = `pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

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
        if (inv.isVoided) continue; // never apply a receipt to a voided bill
        // A receipt for one customer must not settle another customer's bill.
        if (input.partyId && inv.customerId && inv.customerId !== input.partyId) continue;
        // Anchor the bill's owed-at-billing credit BEFORE this receipt exists, so
        // the receipt isn't double-counted on legacy data.
        await ensureCreditOriginal(tx, inv.id);
        const fresh = await tx.invoice.findUnique({ where: { id: inv.id } });
        const due = await computeInvoiceDue(tx, fresh);
        const apply = Math.min(a.amount, due);
        if (apply > 0.001) appliedAllocations.push({ refId: inv.id, refNumber: inv.invoiceNumber, amount: round2(apply) });
      }
      // SAL6-7: a receipt whose allocations can't be applied to anything (every
      // selected bill is already settled) is refused, not silently banked.
      if (!appliedAllocations.length) {
        throw new AppError('NOTHING_TO_APPLY', 'This receipt could not be applied — the selected bill(s) have no outstanding balance.', 400);
      }
    } else if (isVendorOut && allocations.length) {
      // Payment made to a vendor → settle purchase orders (payables). Each PO
      // takes at most what can still be paid on it, by the one PO formula
      // (lib/poMoney.ts, PUR8-1); whatever is left over stays on this payment as
      // the supplier's advance (PUR8-4) instead of being dropped.
      for (const a of allocations) {
        const po = await tx.purchaseOrder.findUnique({ where: { id: a.refId } });
        if (!po) throw new AppError('NOTHING_TO_APPLY', `Purchase order ${a.refNumber || a.refId} was not found.`, 400);
        assertBranchAllowed(reqUser, po.branchId); // PUR6-1: can't settle another branch's PO
        if (po.status === 'Cancelled') {
          throw new AppError('PO_CANCELLED', 'Cannot pay a cancelled purchase order.', 400);
        }
        const pay = round2(Math.min(a.amount, poPayCap(po)));
        // PUR8-8: never write a ₹0 allocation against a fully paid PO.
        if (pay <= 0.001) {
          throw new AppError('NOTHING_TO_APPLY', `Purchase order ${po.poNumber} has nothing left to pay.`, 400);
        }
        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: {
            amountPaid: round2((po.amountPaid || 0) + pay),
            // Shown in the PO's payment history; removed with the ledger row.
            payments: [
              { id: `${paymentId}-${po.id}`.slice(0, 80), date, amount: pay, mode: input.paymentMode || 'Cash', by: actor?.name || 'System', ledgerPaymentId: paymentId, receiptNumber },
              ...((po.payments as any[]) || []),
            ],
            updatedAt: nowIso(),
          },
        });
        appliedAllocations.push({ refId: po.id, refNumber: po.poNumber, amount: pay });
      }
    } else if (input.type === 'out' && !isVendorOut && allocations.length) {
      // Legacy non-vendor 'out' allocations (unchanged).
      for (const a of allocations) {
        const po = await tx.purchaseOrder.findUnique({ where: { id: a.refId } });
        if (!po) continue;
        assertBranchAllowed(reqUser, po.branchId);
        if (po.status === 'Cancelled') throw new AppError('PO_CANCELLED', 'Cannot pay a cancelled purchase order.', 400);
        const pay = Math.min(a.amount, poBalance(po));
        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { amountPaid: round2((po.amountPaid || 0) + pay), updatedAt: nowIso() },
        });
        appliedAllocations.push({ refId: po.id, refNumber: po.poNumber, amount: pay });
      }
    } else {
      appliedAllocations.push(...allocations);
    }

    // For an ALLOCATED receipt, bank only what was actually applied to bills — an
    // over-payment beyond the due is not stored as untracked cash (CRM4-4). A
    // store-credit ledger for genuine advances is a separate feature.
    const appliedTotal = Math.round(appliedAllocations.reduce((t, a) => t + (Number(a.amount) || 0), 0) * 100) / 100;
    // A vendor payment always keeps its FULL amount — the cash really left the
    // drawer — and any part not applied to a PO is that supplier's advance
    // (PUR8-4 / PUR6-3), shown and netted on the payables screens.
    const recordedAmount = isVendorOut ? round2(amount) : allocations.length ? appliedTotal : amount;

    // A 'Store Credit' receipt is funded by the customer's credit balance, not the
    // cash drawer — the bill is settled by spending credit they already hold. It
    // must name the customer and can't draw more than their balance.
    const isStoreCredit = input.type === 'in' && /store\s*credit/i.test(input.paymentMode || '');
    if (isStoreCredit) {
      if (!input.partyId) throw new AppError('BAD_REQUEST', 'Choose the customer whose store credit is being applied.', 400);
      const balance = await creditBalanceOf(tx, input.partyId);
      if (recordedAmount > balance + 0.01) {
        throw new AppError('INSUFFICIENT_CREDIT', `Not enough store credit: balance is ₹${balance.toFixed(2)}, tried to apply ₹${recordedAmount.toFixed(2)}.`, 400);
      }
    }

    const payment = await tx.payment.create({
      data: {
        id: paymentId,
        receiptNumber,
        type: input.type,
        partyType: input.partyType,
        partyId: (isVendorOut ? vendorPartyId : input.partyId) ?? null,
        partyName: input.partyName.trim(),
        branchId,
        date,
        amount: recordedAmount,
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
    // Spend the store credit that funded this receipt (after the bills are settled).
    if (isStoreCredit && input.partyId && recordedAmount > 0.001) {
      await applyCreditDelta(tx, input.partyId, -recordedAmount, {
        type: 'applied',
        reason: `Applied to ${appliedAllocations.map((a) => a.refNumber).filter(Boolean).join(', ') || 'bill'}`,
        by: actor?.name,
      });
    }
    return payment;
  });
}

/**
 * Apply a supplier's unapplied advance (the part of earlier vendor payments not
 * allocated to any PO) to one of that supplier's purchase orders (PUR6-3). No
 * cash moves — the money already left the drawer when it was paid — so the
 * earlier payment rows simply gain an allocation to this PO, oldest first, and
 * deleting such a payment later reverses these allocations too.
 */
export async function applyVendorAdvance(
  input: { vendorId?: string; poId?: string; amount?: number },
  actor?: { name?: string },
  reqUser?: any,
) {
  if (reqUser && !roleCan(reqUser.role, 'purchase:write')) {
    throw new AppError('FORBIDDEN', `Role ${reqUser.role} is not permitted to pay vendors.`, 403);
  }
  const want = input.amount == null || (input.amount as any) === '' ? null : Number(input.amount);
  if (want != null && !(Number.isFinite(want) && want > 0)) throw new AppError('BAD_REQUEST', 'Amount must be greater than zero.', 400);
  return serializableTx(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id: String(input.poId || '') } });
    if (!po) throw new AppError('NOT_FOUND', 'Purchase order not found', 404);
    assertBranchAllowed(reqUser, po.branchId);
    if (po.status === 'Cancelled') throw new AppError('PO_CANCELLED', 'Cannot pay a cancelled purchase order.', 400);
    const vendorId = String(input.vendorId || po.vendorId);
    if (po.vendorId !== vendorId) throw new AppError('WRONG_VENDOR', "That advance belongs to a different supplier than this purchase order.", 400);
    const cap = poPayCap(po);
    if (cap <= 0.001) throw new AppError('NOTHING_TO_APPLY', `Purchase order ${po.poNumber} has nothing left to pay.`, 400);
    // Advances are held per branch drawer, like the payments they came from.
    const rows = await tx.payment.findMany({
      where: { type: 'out', partyType: 'vendor', partyId: vendorId, branchId: po.branchId },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });
    const available = round2(rows.reduce((s: number, p: any) => s + unappliedOf(p), 0));
    if (available <= 0.001) throw new AppError('NO_ADVANCE', 'This supplier has no unapplied advance at this branch.', 400);
    if (want != null && want > available + 0.005) {
      throw new AppError('INSUFFICIENT_ADVANCE', `Only ₹${available.toLocaleString('en-IN')} of advance is available.`, 400);
    }
    if (want != null && want > cap + 0.005) {
      throw new AppError('OVERPAYMENT', `₹${want} exceeds the ₹${cap.toLocaleString('en-IN')} that can still be paid on this PO.`, 400);
    }
    let left = round2(Math.min(want ?? Infinity, available, cap));
    const total = left;
    const ts = nowIso();
    const entries: any[] = [];
    for (const p of rows) {
      if (left <= 0.001) break;
      const take = round2(Math.min(unappliedOf(p), left));
      if (take <= 0.001) continue;
      const allocs = Array.isArray(p.allocations) ? (p.allocations as any[]) : [];
      await tx.payment.update({
        where: { id: p.id },
        data: { allocations: [...allocs, { refId: po.id, refNumber: po.poNumber, amount: take, appliedFromAdvance: true, appliedOn: ts.slice(0, 10) }] as any, updatedAt: ts },
      });
      entries.push({ id: `${p.id}-adv-${Date.now().toString(36)}`, date: ts.slice(0, 10), amount: take, mode: `Advance (${p.receiptNumber})`, by: actor?.name || 'System', ledgerPaymentId: p.id });
      left = round2(left - take);
    }
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { amountPaid: round2((po.amountPaid || 0) + total), payments: [...entries, ...((po.payments as any[]) || [])], updatedAt: ts },
    });
    return { ok: true, applied: total, poId: po.id };
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
    // Same gate as recording: a customer receipt is cash-desk only (not Purchase),
    // a vendor payment is purchase only.
    if (payment.type === 'in' && reqUser && !roleCan(reqUser.role, 'cash:write')) {
      throw new AppError('FORBIDDEN', `Role ${reqUser.role} is not permitted to delete customer receipts.`, 403);
    }
    if (payment.type === 'out' && reqUser && !roleCan(reqUser.role, 'purchase:write')) {
      throw new AppError('FORBIDDEN', `Role ${reqUser.role} is not permitted to delete vendor payments.`, 403);
    }
    // Deleting a payment dated to a closed day would change that day's cash (CASH-2).
    const closed = await tx.dailyCashRegister.findFirst({ where: { branchId: payment.branchId, date: payment.date, isClosed: true } });
    if (closed) throw new AppError('DAY_CLOSED', `The cash day ${payment.date} is closed. Reopen it before deleting this payment.`, 409);
    const allocations: Allocation[] = Array.isArray(payment.allocations) ? (payment.allocations as any) : [];
    // Anchor each bill's owed-at-billing credit from the state BEFORE the receipt
    // is removed, so deleting it brings the right debt back (and never double-
    // counts on legacy data).
    if (payment.type === 'in') {
      for (const a of allocations) await ensureCreditOriginal(tx, a.refId);
    }
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
        // Remove the PO-embedded payment entry that mirrors this ledger row, so a
        // deleted vendor payment doesn't linger in the PO's payment history.
        const remaining = ((po.payments as any[]) || []).filter((e) => e?.ledgerPaymentId !== id);
        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: {
            amountPaid: Math.max(0, Math.round(((po.amountPaid || 0) - a.amount) * 100) / 100),
            payments: remaining,
            updatedAt: nowIso(),
          },
        });
      }
    }
    return { ok: true };
  }, { isolationLevel: 'Serializable' });
}
