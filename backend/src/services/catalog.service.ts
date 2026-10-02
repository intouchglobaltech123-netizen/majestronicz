import { prisma } from '../db.js';
import { AppError } from '../middleware/errorHandler.js';
import { nowIso, cleanPhone } from '../lib/stockLedger.js';
import { nextEstimateNumber, nextChallanNumber, nextComboCode } from '../lib/sequences.js';
import { withRetry } from '../lib/retry.js';
import { calculateLineTax, calculateInvoiceTotals } from '../lib/taxCalc.js';
import { GSTIN_RE, gstinChecksumValid } from './gstin.service.js';
import { assertBranchAllowed } from '../lib/branchGuard.js';
import { archivedItemError, assertLineInputs, assertLinesAgainstCatalogue } from '../lib/lineValidation.js';
import { applySupplySplit } from '../lib/supply.js';
import { istToday, istTime } from '../lib/businessDate.js';
import { isWholeUnit } from '../lib/units.js';
import { roleCan } from '../lib/auth.js';
import { receiveStockTransfer, isTransferChallan } from './stock.service.js';

/**
 * Server-authoritative recompute of estimate line taxes + totals.
 * Mirrors the invoice recompute: honors per-line discounts, overall discount,
 * freight/shipping, and round-off so quotations keep the same money math as
 * sales (previously these adjustments were silently dropped).
 */
function recomputeEstimateMoney(est: any) {
  const withGst = !!est.withGst;
  // A quote gets the same input checks as a bill (SAL8-8).
  if (!est || typeof est !== 'object' || !Array.isArray(est.items)) {
    throw new AppError('BAD_REQUEST', 'A quotation needs its line items.', 400);
  }
  assertLineInputs(est, 'quotation');
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
  applySupplySplit(est); // inter-state quote → IGST (SAL8-5)
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
      await assertLinesAgainstCatalogue(tx, data, existing.branchId, { previousItems: (existing.items as any[]) || [] });
      if (existing.status === 'Converted' || await estimateIsConverted(tx, existing.id)) {
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
      await assertLinesAgainstCatalogue(tx, data, data.branchId);
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
    if (est.status === 'Converted' || await estimateIsConverted(tx, id)) {
      throw new AppError('QUOTE_CONVERTED', 'This quotation was converted to a sale and cannot be cancelled.', 409);
    }
    await tx.estimate.update({
      where: { id },
      data: { status: 'Cancelled', cancelReason: (reason || '').trim() || 'No reason given', cancelledAt: nowIso(), cancelledBy: actor || null },
    });
    return { estimates: await tx.estimate.findMany() };
  });
}

export function deleteEstimate(id: string, reqUser?: any) {
  // Kept for data cleanup only — a quote is normally Cancelled with a reason.
  // CEO only (enforced at the route too), checked against the STORED quote's
  // branch, and never for a converted quote — the bill's source link must not be
  // orphaned (SAL8-3).
  return prisma.$transaction(async (tx: any) => {
    if (reqUser && reqUser.role !== 'CEO') {
      throw new AppError('FORBIDDEN', 'Only the CEO can delete a quotation. Cancel it with a reason instead.', 403);
    }
    const est = await tx.estimate.findUnique({ where: { id } });
    if (!est) throw new AppError('NOT_FOUND', 'Quotation not found', 404);
    assertBranchAllowed(reqUser, est.branchId);
    if (est.status === 'Converted' || await estimateIsConverted(tx, id)) {
      throw new AppError('QUOTE_CONVERTED', 'This quotation was converted to a sale and cannot be deleted. Void the bill first.', 409);
    }
    await tx.estimate.delete({ where: { id } });
    return { estimates: await tx.estimate.findMany() };
  });
}

/** Largest quantity one manual challan line may carry (INV-13). */
const MAX_CHALLAN_LINE_QTY = 10_000;
const canManageTransferChallans = (reqUser?: any) => !reqUser || reqUser.role === 'CEO' || reqUser.role === 'Manager';

/** INV9-3: a transfer challan belongs to its transfer's two branches — a
 *  branch-locked Manager of a third branch may not edit or delete it. */
async function assertTransferChallanBranch(tx: any, ch: any, reqUser?: any): Promise<void> {
  if (!reqUser || reqUser.role === 'CEO' || !reqUser.assignedBranchId) return;
  const transfer = await tx.stockTransfer.findFirst({ where: { challanNumber: ch.challanNumber } });
  if (!transfer) return;
  if (transfer.fromBranch !== reqUser.assignedBranchId && transfer.toBranch !== reqUser.assignedBranchId) {
    throw new AppError('FORBIDDEN', 'This transfer challan belongs to other branches. Only their Manager or the CEO can change it.', 403);
  }
}

/** Validate a manual challan's lines: a name and a real quantity > 0 within the
 *  cap, whole for whole-unit catalogue items (INV-13). Returns cleaned lines. */
async function cleanChallanItems(tx: any, items: any): Promise<any[]> {
  if (!Array.isArray(items) || !items.length) throw new AppError('NO_ITEMS', 'A challan needs at least one item.', 400);
  if (items.length > 200) throw new AppError('TOO_MANY_ITEMS', 'A challan can carry at most 200 lines.', 400);
  const ids = items.map((it: any) => it?.itemId).filter((x: any) => typeof x === 'string' && x);
  const known = ids.length ? await tx.item.findMany({ where: { id: { in: ids } }, select: { id: true, unit: true } }) : [];
  const unitOf = new Map<string, string>(known.map((i: any) => [i.id, i.unit]));
  return items.map((it: any) => {
    const name = typeof it?.itemName === 'string' ? it.itemName.trim() : '';
    if (!name) throw new AppError('BAD_LINE', 'Every challan line needs an item name.', 400);
    const q = typeof it?.quantity === 'number' ? it.quantity : Number(it?.quantity);
    if (typeof it?.quantity === 'boolean' || !Number.isFinite(q) || q <= 0) throw new AppError('BAD_QTY', `Quantity for "${name.slice(0, 60)}" must be greater than 0.`, 400);
    if (q > MAX_CHALLAN_LINE_QTY) throw new AppError('BAD_QTY', `Quantity for "${name.slice(0, 60)}" is too large (at most ${MAX_CHALLAN_LINE_QTY}).`, 400);
    const unit = (it.itemId && unitOf.get(it.itemId)) || it.unit;
    if (isWholeUnit(unit) && !Number.isInteger(q)) throw new AppError('BAD_QTY', `Quantity for "${name.slice(0, 60)}" must be a whole number.`, 400);
    return { ...it, itemName: name, quantity: q };
  });
}

export function saveChallan(data: any, reqUser?: any) {
  if (!data || typeof data !== 'object') throw new AppError('BAD_REQUEST', 'Challan details are required.', 400);
  return withRetry(() => prisma.$transaction(async (tx: any) => {
    const existing = data.id ? await tx.deliveryChallan.findUnique({ where: { id: String(data.id) } }) : null;
    // The number, status, received fields and creation time are server-managed —
    // never taken from a save/edit (INV-12: a typed number is not a number).
    const { id: _id, challanNumber: _n, status: _s, receivedAt: _r, createdAt: _c, ...rest } = data;
    if (existing) {
      // INV-13: a received challan is a signed record, and a transfer challan
      // mirrors its stock transfer — Billing can't rewrite either.
      if (existing.status === 'received') throw new AppError('CHALLAN_RECEIVED', 'This challan was already received and can no longer be edited.', 409);
      if (isTransferChallan(existing)) {
        if (!canManageTransferChallans(reqUser)) throw new AppError('FORBIDDEN', 'Only a Manager or CEO can edit a stock-transfer challan.', 403);
        await assertTransferChallanBranch(tx, existing, reqUser);
        // Its lines are the transfer's lines — only the paperwork fields change.
        delete (rest as any).items;
        delete (rest as any).totalQuantity;
        delete (rest as any).receivedBy;
      } else {
        rest.items = await cleanChallanItems(tx, rest.items ?? existing.items);
        rest.totalQuantity = rest.items.reduce((t: number, it: any) => t + it.quantity, 0);
      }
      await tx.deliveryChallan.update({ where: { id: existing.id }, data: rest });
      return { challans: await tx.deliveryChallan.findMany(), savedChallan: await tx.deliveryChallan.findUnique({ where: { id: existing.id } }) };
    }
    if (!String(rest.recipientName || '').trim()) throw new AppError('NAME_REQUIRED', 'Recipient name is required.', 400);
    rest.items = await cleanChallanItems(tx, rest.items);
    rest.totalQuantity = rest.items.reduce((t: number, it: any) => t + it.quantity, 0);
    const id = data.id ? String(data.id) : `dc-${Date.now()}`;
    // Persistent sequence: a number is never reissued after a delete (INV-3).
    const challanNumber = await nextChallanNumber(tx);
    // A new challan starts 'pending' until the recipient acknowledges it.
    await tx.deliveryChallan.create({ data: { ...rest, id, challanNumber, status: 'pending', createdAt: nowIso() } });
    return { challans: await tx.deliveryChallan.findMany(), savedChallan: await tx.deliveryChallan.findUnique({ where: { id } }) };
  }));
}

/**
 * Mark a delivery challan received (pending → received) with the IST date/time.
 * Refused when already received (INV8-6). A stock-transfer challan is received
 * through its transfer — the destination branch (or CEO) receives the goods, the
 * stock is credited and the challan follows (INV8-5).
 */
export async function markChallanReceived(id: string, receiverName?: string, reqUser?: any) {
  const ch = await prisma.deliveryChallan.findUnique({ where: { id } });
  if (!ch) throw new AppError('NOT_FOUND', 'Delivery challan not found', 404);
  if (ch.status === 'received') throw new AppError('ALREADY_RECEIVED', `Challan ${ch.challanNumber} is already marked received.`, 409);
  const actor = (reqUser?.name as string | undefined)?.trim() || receiverName || 'System';
  if (isTransferChallan(ch)) {
    // Receiving a transfer moves stock — the same right as /stock/transfer-receive.
    if (reqUser && !roleCan(reqUser.role, 'stock:write')) {
      throw new AppError('FORBIDDEN', 'Receiving a stock transfer needs stock rights (a Manager or CEO at the destination branch).', 403);
    }
    const transfer = await prisma.stockTransfer.findFirst({ where: { challanNumber: ch.challanNumber } });
    if (transfer) {
      const snap: any = await receiveStockTransfer(transfer.id, actor, reqUser);
      return snap;
    }
    // A transfer challan without its transfer can only be closed by a Manager/CEO.
    if (!canManageTransferChallans(reqUser)) throw new AppError('FORBIDDEN', 'Only a Manager or CEO can close this transfer challan.', 403);
  }
  return prisma.$transaction(async (tx: any) => {
    const cur = await tx.deliveryChallan.findUnique({ where: { id } });
    if (!cur) throw new AppError('NOT_FOUND', 'Delivery challan not found', 404);
    if (cur.status === 'received') throw new AppError('ALREADY_RECEIVED', `Challan ${cur.challanNumber} is already marked received.`, 409);
    const prevReceivedBy = (cur.receivedBy as any) || {};
    await tx.deliveryChallan.update({
      where: { id },
      data: {
        status: 'received',
        receivedAt: nowIso(),
        receivedBy: {
          ...prevReceivedBy,
          name: (receiverName || '').trim().slice(0, 120) || prevReceivedBy.name || cur.recipientName,
          comment: `Received · marked by ${actor}`,
          date: istToday(), time: istTime(),
        },
      },
    });
    return { challans: await tx.deliveryChallan.findMany() };
  });
}

/** Delete a challan. A stock-transfer challan is the transfer's paperwork: only a
 *  Manager/CEO may remove it, and never once received (INV-13). */
export function deleteChallan(id: string, reqUser?: any) {
  return prisma.$transaction(async (tx: any) => {
    const ch = await tx.deliveryChallan.findUnique({ where: { id } });
    if (ch && isTransferChallan(ch)) {
      if (!canManageTransferChallans(reqUser)) throw new AppError('FORBIDDEN', 'Only a Manager or CEO can delete a stock-transfer challan.', 403);
      await assertTransferChallanBranch(tx, ch, reqUser);
      if (ch.status === 'received') throw new AppError('CHALLAN_RECEIVED', 'A received transfer challan cannot be deleted.', 409);
    } else if (ch && ch.status === 'received' && reqUser && !canManageTransferChallans(reqUser)) {
      // INV9-4: a received challan is the recipient's signed acknowledgement.
      throw new AppError('CHALLAN_RECEIVED', 'This challan was received. Only a Manager or CEO can delete it.', 403);
    }
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
    const found = await tx.item.findMany({ where: { id: { in: components.map((c: any) => c.itemId) } }, select: { id: true, itemName: true, isArchived: true } });
    if (found.length !== components.length) throw new AppError('UNKNOWN_COMPONENT', 'A combo component is not an item in the catalog.', 400);
    // An archived item can't be put in a combo (archiving needs it out of every combo).
    const archived = found.find((f: any) => f.isArchived);
    if (archived) throw archivedItemError(archived.itemName);
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
    // CRM-7: a real Indian mobile (starts 6-9) — "0000000000" is not a number. A
    // number already on the record (older data) is not re-judged on other edits.
    const prevRow = data.id ? await tx.customer.findUnique({ where: { id: String(data.id) } }) : null;
    if (!/^[6-9]\d{9}$/.test(phone) && cleanPhone(prevRow?.phone) !== phone) {
      throw new AppError('INVALID_PHONE', 'Enter a valid 10-digit mobile number (starting with 6, 7, 8 or 9).', 400);
    }

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
    // CRM5-7: the last character is a check digit — a mistyped GSTIN fails it.
    // A GSTIN already on the record (older data) is not re-judged on other edits.
    if (fields.gstin && fields.gstin !== existing?.gstin && !gstinChecksumValid(fields.gstin)) {
      throw new AppError('INVALID_GSTIN', `GSTIN ${fields.gstin} fails its check digit — please re-check it, or leave it blank.`, 400);
    }
    if (existing) {
      await tx.customer.update({ where: { id: existing.id }, data: { ...fields, updatedAt: ts } });
    } else {
      const id = data.id ? String(data.id) : `cust-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const firstPurchaseDate = typeof data.firstPurchaseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.firstPurchaseDate)
        ? data.firstPurchaseDate : istToday();
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
    // CRM9-11: store credit is money the shop owes the customer — deleting the
    // customer would silently wipe it.
    const holder = await tx.customer.findUnique({ where: { id }, select: { creditBalance: true } });
    if ((Number(holder?.creditBalance) || 0) > 0.005) {
      throw new AppError('CUSTOMER_HAS_CREDIT', `This customer holds ₹${Number(holder!.creditBalance).toFixed(2)} of store credit and cannot be deleted.`, 409);
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
