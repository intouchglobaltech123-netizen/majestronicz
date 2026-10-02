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
  if (!data || typeof data !== 'object') throw new AppError('BAD_REQUEST', 'Combo details are required.', 400);
  // INV6-9 / INV3-3: a combo is validated on the server — sales take their parts
  // from the stored combo, so a stored part of −3 or of an unknown item would move
  // stock wrongly. Name required, price ≥ 0, at least one part, every part a
  // real item with a whole quantity > 0 (no item twice).
  const comboName = typeof data.comboName === 'string' ? data.comboName.trim() : '';
  if (!comboName) throw new AppError('NAME_REQUIRED', 'Combo name is required.', 400);
  const comboPrice = Number(data.comboPrice);
  if (data.comboPrice === null || data.comboPrice === '' || typeof data.comboPrice === 'boolean' || !Number.isFinite(comboPrice) || comboPrice < 0 || comboPrice > 10_000_000) {
    throw new AppError('BAD_PRICE', 'Combo price must be a number of ₹0 or more.', 400);
  }
  if (!Array.isArray(data.components) || !data.components.length) {
    throw new AppError('NO_COMPONENTS', 'A combo needs at least one component item.', 400);
  }
  const seen = new Set<string>();
  const components = data.components.map((c: any) => {
    const itemId = typeof c?.itemId === 'string' ? c.itemId : '';
    const q = Number(c?.quantity);
    if (!itemId) throw new AppError('BAD_COMPONENT', 'Every combo component needs an item.', 400);
    if (typeof c?.quantity === 'boolean' || !Number.isInteger(q) || q <= 0 || q > 10_000) {
      throw new AppError('BAD_COMPONENT_QTY', 'Each component quantity must be a whole number greater than 0.', 400);
    }
    if (seen.has(itemId)) throw new AppError('DUP_COMPONENT', 'The same item is listed twice. Combine it into one row.', 400);
    seen.add(itemId);
    return { itemId, quantity: q };
  });
  const str = (v: any) => (v === undefined ? undefined : v === null ? null : String(v));
  return withRetry(() => prisma.$transaction(async (tx: any) => {
    const ts = nowIso();
    const found = await tx.item.findMany({ where: { id: { in: components.map((c: any) => c.itemId) } }, select: { id: true } });
    if (found.length !== components.length) throw new AppError('UNKNOWN_COMPONENT', 'A combo component is not an item in the catalog.', 400);
    // Allow-listed fields only — never the raw body.
    const fields: Record<string, any> = { comboName, comboPrice, components };
    for (const k of ['category', 'subcategory', 'description', 'imageUrl'] as const) {
      if (data[k] !== undefined) fields[k] = str(data[k]);
    }
    const existing = data.id ? await tx.comboItem.findUnique({ where: { id: String(data.id) } }) : null;
    if (existing) {
      if (typeof data.comboCode === 'string' && data.comboCode.trim()) fields.comboCode = data.comboCode.trim();
      await tx.comboItem.update({ where: { id: existing.id }, data: { ...fields, updatedAt: ts } });
    } else {
      const id = data.id ? String(data.id) : `combo-${Date.now()}`;
      const comboCode = (typeof data.comboCode === 'string' && data.comboCode.trim()) || (await nextComboCode(tx));
      await tx.comboItem.create({ data: { ...fields, id, comboCode, createdAt: typeof data.createdAt === 'string' ? data.createdAt : ts, updatedAt: ts } });
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

    // CRM6-7: allow-list the master fields (an unknown field used to reach Prisma
    // and come back as a 500 quoting the query). Purchase aggregates and store
    // credit are server-maintained from bills (CRM2-10 / CRM5-6) and never taken
    // from the client. A missing address defaults to blank.
    const fields: Record<string, any> = { name: String(data.name).trim(), phone: String(data.phone).trim() };
    for (const k of ['address', 'email', 'customerType', 'notes'] as const) {
      if (data[k] === undefined) continue;
      if (data[k] !== null && typeof data[k] !== 'string') throw new AppError('BAD_REQUEST', `Invalid ${k}.`, 400);
      fields[k] = data[k];
    }
    if (data.gstin !== undefined) fields.gstin = data.gstin;
    if (fields.address === null) fields.address = '';

    const ts = nowIso();
    const existing = data.id ? await tx.customer.findUnique({ where: { id: String(data.id) } }) : null;
    if (existing) {
      await tx.customer.update({ where: { id: existing.id }, data: { ...fields, updatedAt: ts } });
    } else {
      const id = data.id ? String(data.id) : `cust-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const firstPurchaseDate = typeof data.firstPurchaseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.firstPurchaseDate)
        ? data.firstPurchaseDate : ts.split('T')[0];
      await tx.customer.create({
        data: {
          address: '', ...fields, id,
          firstPurchaseDate,
          purchaseCount: 0,
          totalSpent: 0,
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
    // Legacy bills were linked only by phone number (no customerId). Deleting the
    // customer would orphan those too, so match the customer's phone against bills
    // that carry no customerId, comparing in normalized form (handles +91 / 0 / spaces).
    const cust = await tx.customer.findUnique({ where: { id } });
    const phone = normalizePhoneDigits(cust?.phone);
    if (phone) {
      const loose = await tx.invoice.findMany({ where: { customerId: null }, select: { customerPhone: true } });
      if (loose.some((i: any) => normalizePhoneDigits(i.customerPhone) === phone)) {
        throw new AppError('CUSTOMER_IN_USE', 'This customer has older bills linked by phone number and cannot be deleted.', 409);
      }
    }
    await tx.customer.deleteMany({ where: { id } });
    return { customers: await tx.customer.findMany() };
  });
}

/** Strip a phone to comparable digits: drop non-digits, a leading 91 country
 *  code and a leading trunk 0 so "09842…", "+91 9842…" and "9842…" all match. */
function normalizePhoneDigits(raw?: string | null): string {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}
