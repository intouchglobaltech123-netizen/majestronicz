import { prisma } from '../db.js';
import { AppError } from '../middleware/errorHandler.js';
import { nowIso, cleanPhone } from '../lib/stockLedger.js';
import { nextEstimateNumber, nextChallanNumber, nextComboCode } from '../lib/sequences.js';
import { withRetry } from '../lib/retry.js';
import { calculateLineTax, calculateInvoiceTotals } from '../lib/taxCalc.js';
import { GSTIN_RE } from './gstin.service.js';
import { assertBranchAllowed } from '../lib/branchGuard.js';

/**
 * Server-authoritative recompute of estimate line taxes + totals.
 * Mirrors the invoice recompute: honors per-line discounts, overall discount,
 * freight/shipping, and round-off so quotations keep the same money math as
 * sales (previously these adjustments were silently dropped).
 */
function recomputeEstimateMoney(est: any) {
  const withGst = !!est.withGst;
  est.items = (est.items || []).map((li: any) => {
    const rate = li.gstRate ?? li.taxRate ?? 0;
    const calc = calculateLineTax(li.quantity, li.unitPrice, rate, withGst, li.discountType || '%', li.discountValue ?? li.discount ?? 0);
    return { ...li, ...calc };
  });
  const totals = calculateInvoiceTotals(
    est.items, withGst, est.overallDiscountType || '%', est.overallDiscountValue || 0,
    est.shippingCharges || 0, est.roundOffEnabled !== false
  );
  est.subtotal = totals.subtotal;
  est.totalTax = totals.totalTax;
  est.totalCgst = totals.totalCgst;
  est.totalSgst = totals.totalSgst;
  est.overallDiscountAmount = totals.overallDiscountAmount;
  est.shippingCharges = totals.shippingCharges;
  est.roundOff = totals.roundOff;
  est.grandTotal = totals.grandTotal;
  est.amountInWords = totals.amountInWords;
  return est;
}

/** A non-voided invoice converted from this estimate marks it "Converted". */
async function estimateIsConverted(tx: any, estimateId: string): Promise<boolean> {
  const inv = await tx.invoice.findFirst({
    where: { sourceEstimateId: estimateId, OR: [{ isVoided: null }, { isVoided: false }] },
  });
  return !!inv;
}

/** Fields that describe the quotation lifecycle — server-managed, never taken
 *  from a save payload (a quote is cancelled only through cancelEstimate). */
const ESTIMATE_LIFECYCLE_FIELDS = ['status', 'cancelReason', 'cancelledAt', 'cancelledBy'];

/** Create/edit estimate — new records get a server-assigned collision-free number. */
export function saveEstimate(data: any, reqUser?: any) {
  recomputeEstimateMoney(data); // server-authoritative totals
  return withRetry(() => prisma.$transaction(async (tx: any) => {
    const existing = data.id ? await tx.estimate.findUnique({ where: { id: data.id } }) : null;
    if (existing) {
      // SEC5-2: authorize against the STORED quote's branch, and keep the branch
      // AND the quote number immutable — a branch-locked Manager must not edit,
      // renumber or move another branch's quote.
      assertBranchAllowed(reqUser, existing.branchId);
      // A quote's lifecycle is server-owned. A Cancelled quote is final, and a
      // Converted one has already become a bill — neither may be edited (the
      // client only offers Edit on Open quotes, but enforce it here too).
      if (existing.status === 'Cancelled') {
        throw new AppError('QUOTE_CANCELLED', 'This quotation was cancelled and can no longer be edited.', 409);
      }
      if (await estimateIsConverted(tx, existing.id)) {
        throw new AppError('QUOTE_CONVERTED', 'This quotation was already converted to a sale and can no longer be edited.', 409);
      }
      const { id, ...rest } = data;
      for (const k of ESTIMATE_LIFECYCLE_FIELDS) delete (rest as any)[k];
      rest.branchId = existing.branchId;          // immutable — can't move branch
      rest.estimateNumber = existing.estimateNumber; // immutable — can't renumber
      await tx.estimate.update({ where: { id }, data: rest });
    } else {
      // A branch-locked user can only create a quote for their own branch.
      assertBranchAllowed(reqUser, data.branchId);
      const id = data.id || `est-${Date.now()}`;
      const estimateNumber = await nextEstimateNumber(tx, data.branchId, data.date);
      const clean = { ...data };
      for (const k of ESTIMATE_LIFECYCLE_FIELDS) delete (clean as any)[k];
      await tx.estimate.create({ data: { ...clean, id, estimateNumber, status: 'Open', createdAt: data.createdAt || nowIso() } });
    }
    return { estimates: await tx.estimate.findMany() };
  }));
}

/** Cancel a quotation with a reason — the delete action is gone; an Open quote is
 *  either Converted (to a sale) or Cancelled (with a reason). */
export function cancelEstimate(id: string, reason: string, actor?: string, reqUser?: any) {
  return prisma.$transaction(async (tx: any) => {
    const est = await tx.estimate.findUnique({ where: { id } });
    if (!est) throw new AppError('NOT_FOUND', 'Quotation not found', 404);
    assertBranchAllowed(reqUser, est.branchId); // SEC5-2: can't cancel another branch's quote
    if (est.status === 'Cancelled') throw new AppError('ALREADY_CANCELLED', 'This quotation is already cancelled.', 409);
    if (await estimateIsConverted(tx, id)) {
      throw new AppError('QUOTE_CONVERTED', 'This quotation was converted to a sale and cannot be cancelled.', 409);
    }
    await tx.estimate.update({
      where: { id },
      data: { status: 'Cancelled', cancelReason: (reason || '').trim() || 'No reason given', cancelledAt: nowIso(), cancelledBy: actor || null },
    });
    return { estimates: await tx.estimate.findMany() };
  });
}

export function deleteEstimate(id: string) {
  // Kept for data cleanup only — the UI no longer exposes delete (quotes are
  // Cancelled with a reason instead). Refuse to delete a converted quote so the
  // bill's source link is never orphaned.
  return prisma.$transaction(async (tx: any) => {
    if (await estimateIsConverted(tx, id)) {
      throw new AppError('QUOTE_CONVERTED', 'This quotation was converted to a sale and cannot be deleted. Void the bill first.', 409);
    }
    await tx.estimate.deleteMany({ where: { id } });
    return { estimates: await tx.estimate.findMany() };
  });
}

export function saveChallan(data: any) {
  return withRetry(() => prisma.$transaction(async (tx: any) => {
    const existing = data.id ? await tx.deliveryChallan.findUnique({ where: { id: data.id } }) : null;
    if (existing) {
      // The received-status fields are server-managed (set via markChallanReceived),
      // never taken from a plain save/edit.
      const { id, status, receivedAt, ...rest } = data;
      await tx.deliveryChallan.update({ where: { id }, data: rest });
    } else {
      const id = data.id || `dc-${Date.now()}`;
      const challanNumber = await nextChallanNumber(tx);
      const { status, receivedAt, ...rest } = data;
      // A new challan starts 'pending' until the recipient acknowledges it.
      await tx.deliveryChallan.create({ data: { ...rest, id, challanNumber, status: 'pending', createdAt: data.createdAt || nowIso() } });
    }
    return { challans: await tx.deliveryChallan.findMany() };
  }));
}

/** Mark a delivery challan received (pending → received) with the time. */
export function markChallanReceived(id: string, receiverName?: string) {
  return prisma.$transaction(async (tx: any) => {
    const ch = await tx.deliveryChallan.findUnique({ where: { id } });
    if (!ch) throw new AppError('NOT_FOUND', 'Delivery challan not found', 404);
    const ts = nowIso();
    const prevReceivedBy = (ch.receivedBy as any) || {};
    await tx.deliveryChallan.update({
      where: { id },
      data: {
        status: 'received',
        receivedAt: ts,
        receivedBy: { ...prevReceivedBy, name: receiverName || prevReceivedBy.name || ch.recipientName, date: ts.slice(0, 10) },
      },
    });
    return { challans: await tx.deliveryChallan.findMany() };
  });
}

export function deleteChallan(id: string) {
  return prisma.$transaction(async (tx: any) => {
    await tx.deliveryChallan.deleteMany({ where: { id } });
    return { challans: await tx.deliveryChallan.findMany() };
  });
}

export function saveCombo(data: any) {
  return withRetry(() => prisma.$transaction(async (tx: any) => {
    const ts = nowIso();
    const existing = data.id ? await tx.comboItem.findUnique({ where: { id: data.id } }) : null;
    if (existing) {
      const { id, ...rest } = data;
      await tx.comboItem.update({ where: { id }, data: { ...rest, updatedAt: ts } });
    } else {
      const id = data.id || `combo-${Date.now()}`;
      const comboCode = data.comboCode || (await nextComboCode(tx));
      await tx.comboItem.create({ data: { ...data, id, comboCode, createdAt: data.createdAt || ts, updatedAt: ts } });
    }
    return { combos: await tx.comboItem.findMany() };
  }));
}

export function deleteCombo(id: string) {
  return prisma.$transaction(async (tx: any) => {
    await tx.comboItem.deleteMany({ where: { id } });
    return { combos: await tx.comboItem.findMany() };
  });
}

/** Save customer with server-enforced phone uniqueness. */
export function saveCustomer(data: any) {
  return prisma.$transaction(async (tx: any) => {
    const phone = cleanPhone(data.phone);
    if (!phone) throw new AppError('PHONE_REQUIRED', 'Phone number is required', 400);
    if (phone.length !== 10) throw new AppError('INVALID_PHONE', 'Enter a valid 10-digit phone number', 400);
    if (!data.name?.trim()) throw new AppError('NAME_REQUIRED', 'Customer name is required', 400);

    // Normalise/validate the optional GSTIN. Blank is fine; a non-empty value
    // must match the 15-char GSTIN format (CRM-7).
    if (data.gstin != null) {
      const g = String(data.gstin).trim().toUpperCase();
      if (g && !GSTIN_RE.test(g)) {
        throw new AppError('INVALID_GSTIN', 'Enter a valid 15-character GSTIN, or leave it blank.', 400);
      }
      data.gstin = g || null;
    }

    const all = await tx.customer.findMany();
    const duplicate = all.find((c: any) => c.id !== data.id && cleanPhone(c.phone) === phone);
    if (duplicate) throw new AppError('DUPLICATE_PHONE', `A customer with phone ${data.phone} already exists (${duplicate.name})`, 409);

    const ts = nowIso();
    const existing = data.id ? await tx.customer.findUnique({ where: { id: data.id } }) : null;
    if (existing) {
      // Never let a customer edit (often from a stale form) overwrite the
      // server-maintained purchase aggregates — only master details are editable
      // here. Strip the calculated fields so the DB keeps its own values (CRM2-10).
      const {
        id, purchaseCount, totalSpent, firstPurchaseDate,
        lastRewardRedeemedPurchaseCount, ...rest
      } = data;
      await tx.customer.update({ where: { id }, data: { ...rest, updatedAt: ts } });
    } else {
      const id = data.id || `cust-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      await tx.customer.create({
        data: {
          ...data, id,
          firstPurchaseDate: data.firstPurchaseDate || ts.split('T')[0],
          purchaseCount: data.purchaseCount ?? 0,
          totalSpent: data.totalSpent ?? 0,
          createdAt: ts, updatedAt: ts,
        },
      });
    }
    return { customers: await tx.customer.findMany() };
  });
}

export function deleteCustomer(id: string) {
  return prisma.$transaction(async (tx: any) => {
    // A customer with bills (or receipts) can't be deleted — doing so orphans
    // their invoices and the party ledger. Archive instead.
    const billCount = await tx.invoice.count({ where: { customerId: id } });
    if (billCount > 0) {
      throw new AppError('CUSTOMER_IN_USE', 'This customer has bills on record and cannot be deleted.', 409);
    }
    const receiptCount = await tx.payment.count({ where: { partyType: 'customer', partyId: id } });
    if (receiptCount > 0) {
      throw new AppError('CUSTOMER_IN_USE', 'This customer has payments on record and cannot be deleted.', 409);
    }
    await tx.customer.deleteMany({ where: { id } });
    return { customers: await tx.customer.findMany() };
  });
}
