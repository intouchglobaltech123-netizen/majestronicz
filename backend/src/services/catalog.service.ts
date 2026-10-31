import { prisma } from '../db.js';
import { withLiveBillCounts } from '../lib/liveCounts.js';
import { AppError } from '../middleware/errorHandler.js';
import { nowIso, cleanPhone, rid } from '../lib/stockLedger.js';
import { nextEstimateNumber, nextChallanNumber, nextComboCode } from '../lib/sequences.js';
import { withRetry } from '../lib/retry.js';
import { calculateLineTax, calculateInvoiceTotals } from '../lib/taxCalc.js';
import { GSTIN_RE, gstinChecksumValid } from './gstin.service.js';
import { assertBranchAllowed } from '../lib/branchGuard.js';
import { archivedItemError, assertLineInputs, assertLinesAgainstCatalogue } from '../lib/lineValidation.js';
import { applySupplySplit } from '../lib/supply.js';
import { istToday, istTime, assertBusinessDate } from '../lib/businessDate.js';
import { isWholeUnit } from '../lib/units.js';
import { roleCan, roleFlags } from '../lib/auth.js';
import { isValidBranch } from '../lib/constants.js';
import { receiveStockTransfer, isTransferChallan } from './stock.service.js';

/** Normalise a customer name on save/import: ALL CAPS, with underscore/hyphen/
 *  brackets/quotes turned into spaces and runs of spaces collapsed. Legitimate
 *  business punctuation (& . , /) is kept. Mirrors the frontend normalizeCustomerName. */
function normalizeCustomerName(raw: any): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  return s.replace(/[_\-\[\]{}()"'`]+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
}
const round2 = (n: number) => Math.round(n * 100) / 100;

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
  // SAL9-5: a quote line carries ONE GST rate. The check read taxRate and the
  // maths gstRate, so a line could pass at 18% and be charged 0%.
  for (const li of est.items as any[]) {
    if (li && li.gstRate != null && li.taxRate != null && Number(li.gstRate) !== Number(li.taxRate)) {
      throw new AppError('BAD_GST', `"${String(li.itemName || 'A line').slice(0, 80)}" has two different GST rates (${li.gstRate}% / ${li.taxRate}%).`, 400);
    }
    if (li) { const r = li.gstRate ?? li.taxRate ?? 0; li.gstRate = r; li.taxRate = r; }
  }
  assertLineInputs(est, 'quotation');
  est.items = (est.items || []).map((li: any) => {
    const rate = li.gstRate ?? li.taxRate ?? 0;
    const calc = calculateLineTax(li.quantity, li.unitPrice, rate, withGst, li.discountType || '%', li.discountValue ?? li.discount ?? 0);
    return { ...li, ...calc };
  });
  const totals = calculateInvoiceTotals(
    est.items, withGst, est.overallDiscountType || '%', est.overallDiscountValue || 0,
    est.shippingCharges || 0, est.roundOffEnabled !== false,
    Number(est.shippingChargesTaxPercent) || 0 // F4: GST on delivery/packing
  );
  est.subtotal = totals.subtotal;
  est.totalTax = totals.totalTax;
  est.totalCgst = totals.totalCgst;
  est.totalSgst = totals.totalSgst;
  est.shippingChargesTax = totals.shippingChargesTax;
  est.shippingChargesTaxPercent = totals.shippingChargesTaxPercent;
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

/** SAL10-8: a quote follows the same price / discount rights as a bill. */
const billingRights = (reqUser?: any) => {
  if (!reqUser) return {};
  const flags = roleFlags(reqUser.role);
  return { canEditPrice: flags.includes('bill.editPrice'), canDiscount: flags.includes('bill.giveDiscount') };
};

/**
 * Remember a quotation's customer so the number + name suggest next time the
 * cashier types that mobile (CRM: a quote-only customer never reached the master
 * before, so JANA K 852… stayed invisible). Mirrors the invoice auto-create, but
 * a quote is NOT a sale — no purchaseCount / totalSpent bump. Sets data.customerId
 * to the linked/created master so the quote is tied to it. Needs a real name and a
 * valid 10-digit mobile; a nameless walk-in with a number creates nothing.
 */
async function linkQuotationCustomer(tx: any, data: any): Promise<void> {
  const phoneClean = cleanPhone(data.customerContact);
  const name = String(data.customerName || '').trim();

  // An explicit customerId already points at a master row — keep it, and backfill
  // any blank name/phone/address so the record is usable for future suggestions.
  if (data.customerId) {
    const cur = await tx.customer.findUnique({ where: { id: String(data.customerId) } });
    if (cur) {
      const patch: any = {};
      if (!cur.name?.trim() && name) patch.name = name;
      if (!cleanPhone(cur.phone) && phoneClean) patch.phone = data.customerContact;
      if (!cur.address?.trim() && data.customerAddress) patch.address = String(data.customerAddress).trim();
      if (Object.keys(patch).length) {
        patch.updatedAt = nowIso();
        await tx.customer.update({ where: { id: cur.id }, data: patch });
      }
      return;
    }
    data.customerId = undefined; // stale id → fall through and re-link by phone
  }

  // No real name or no real mobile → nothing worth remembering (walk-in).
  if (!name || name.toLowerCase() === 'walk-in customer') return;
  if (!/^[6-9]\d{9}$/.test(phoneClean)) return;

  const match = (await tx.customer.findMany()).find((c: any) => cleanPhone(c.phone) === phoneClean);
  if (match) {
    data.customerId = match.id;
    if (!match.name?.trim()) {
      await tx.customer.update({ where: { id: match.id }, data: { name, updatedAt: nowIso() } });
    }
    return;
  }

  const newId = rid('cust');
  data.customerId = newId;
  await tx.customer.create({
    data: {
      id: newId,
      name,
      phone: data.customerContact,
      address: String(data.customerAddress || '').trim(),
      firstPurchaseDate: data.date,
      purchaseCount: 0,
      totalSpent: 0,
      notes: 'Auto-created from Quotation',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  });
}

/** Create/edit estimate — new records get a server-assigned collision-free number. */
export function saveEstimate(data: any, reqUser?: any) {
  // SAL10-7: a quote needs lines, a real date and a real branch.
  if (!data || typeof data !== 'object' || !Array.isArray(data.items) || !data.items.length) {
    throw new AppError('NO_LINES', 'A quotation needs at least one line.', 400);
  }
  assertBusinessDate(data.date, 'A quotation');
  recomputeEstimateMoney(data); // server-authoritative totals
  return withRetry(() => prisma.$transaction(async (tx: any) => {
    // Remember the customer (name + mobile) for future number suggestions.
    await linkQuotationCustomer(tx, data);
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
      await assertLinesAgainstCatalogue(tx, data, existing.branchId, { previousItems: (existing.items as any[]) || [], ...billingRights(reqUser) });
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
      if (!isValidBranch(data.branchId)) throw new AppError('BAD_BRANCH', `Unknown branch: ${String(data.branchId).slice(0, 40)}`, 400); // SAL10-7
      await assertLinesAgainstCatalogue(tx, data, data.branchId, billingRights(reqUser));
      const id = data.id || `est-${Date.now()}`;
      const estimateNumber = await nextEstimateNumber(tx, data.branchId, data.date);
      const clean = { ...data };
      for (const k of ESTIMATE_LIFECYCLE_FIELDS) delete (clean as any)[k];
      await tx.estimate.create({ data: { ...clean, id, estimateNumber, status: 'Open', createdAt: data.createdAt || nowIso() } });
    }
    // Return customers too so a just-remembered quote customer shows in the
    // number-suggestion list immediately, without a reload.
    return {
      estimates: await tx.estimate.findMany(),
      customers: await withLiveBillCounts(tx, await tx.customer.findMany(), { all: true }),
    };
  }));
}

/** Cancel a quotation with a reason — the delete action is gone; an Open quote is
 *  either Converted (to a sale) or Cancelled (with a reason). */
export function cancelEstimate(id: string, reason: string, actor?: string, reqUser?: any) {
  // SAL9-14: a cancelled quote must say why — the screen asks, the server insists.
  const why = String(reason ?? '').trim();
  if (!why) throw new AppError('REASON_REQUIRED', 'Give a reason for cancelling this quotation.', 400);
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
      data: { status: 'Cancelled', cancelReason: why.slice(0, 500), cancelledAt: nowIso(), cancelledBy: actor || null },
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
    // Optional per-line value for external/customer challans. When a rate is
    // given, amount is always rate × quantity (server-authoritative, so a tampered
    // line amount can't disagree with the printed total).
    const rate = typeof it?.rate === 'number' ? it.rate : Number(it?.rate);
    const hasRate = typeof it?.rate !== 'boolean' && Number.isFinite(rate) && rate >= 0;
    return {
      ...it,
      itemName: name,
      quantity: q,
      rate: hasRate ? rate : undefined,
      amount: hasRate ? Math.round(rate * q * 100) / 100 : undefined,
    };
  });
}

/** Total value of a priced challan: sum of line amounts, or null when no line
 *  carries a rate (a value-free goods-movement note). */
function challanTotalAmount(items: any[]): number | null {
  const priced = items.some((it) => Number.isFinite(it?.amount));
  if (!priced) return null;
  return Math.round(items.reduce((t, it) => t + (Number(it?.amount) || 0), 0) * 100) / 100;
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
        rest.totalAmount = challanTotalAmount(rest.items);
      }
      await tx.deliveryChallan.update({ where: { id: existing.id }, data: rest });
      return { challans: await tx.deliveryChallan.findMany(), savedChallan: await tx.deliveryChallan.findUnique({ where: { id: existing.id } }) };
    }
    if (!String(rest.recipientName || '').trim()) throw new AppError('NAME_REQUIRED', 'Recipient name is required.', 400);
    rest.items = await cleanChallanItems(tx, rest.items);
    rest.totalQuantity = rest.items.reduce((t: number, it: any) => t + it.quantity, 0);
    rest.totalAmount = challanTotalAmount(rest.items);
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
    const fields: Record<string, any> = { name: normalizeCustomerName(data.name), phone: String(data.phone).trim() };
    for (const k of ['address', 'email', 'customerType', 'notes'] as const) {
      if (data[k] === undefined) continue;
      if (data[k] !== null && typeof data[k] !== 'string') throw new AppError('BAD_REQUEST', `Invalid ${k}.`, 400);
      fields[k] = data[k];
    }
    if (data.gstin !== undefined) fields.gstin = data.gstin;
    if (fields.address === null) fields.address = '';
    // Opening balance (migrated due) — a positive number, or 0/blank clears it.
    if (data.openingBalanceDue !== undefined) {
      const v = Number(data.openingBalanceDue);
      fields.openingBalanceDue = Number.isFinite(v) && v > 0 ? round2(v) : null;
    }

    const ts = nowIso();
    const existing = data.id ? await tx.customer.findUnique({ where: { id: String(data.id) } }) : null;
    // CRM5-7: the last character is a check digit — a mistyped GSTIN fails it.
    // A GSTIN already on the record (older data) is not re-judged on other edits.
    if (fields.gstin && fields.gstin !== existing?.gstin && !gstinChecksumValid(fields.gstin)) {
      throw new AppError('INVALID_GSTIN', `GSTIN ${fields.gstin} fails its check digit — please re-check it, or leave it blank.`, 400);
    }
    if (existing) {
      const oldName = existing.name;
      const oldPhone = cleanPhone(existing.phone);
      const oldAddr = existing.address ?? '';
      await tx.customer.update({ where: { id: existing.id }, data: { ...fields, updatedAt: ts } });

      // Keep linked bills in step with the master. When the party's name (or
      // phone / address) is corrected, the copy denormalised onto their bills
      // and quotations is refreshed too, so history shows the CURRENT details —
      // the owner expects a rename to flow through to every linked bill.
      // GST tax invoices that carry a buyer GSTIN stay frozen: the buyer name
      // there is tied to that GSTIN and must not change once the invoice is
      // issued.
      const nameChanged = oldName !== fields.name;
      const phoneChanged = oldPhone !== cleanPhone(fields.phone);
      const addrChanged = fields.address !== undefined && oldAddr !== fields.address;
      if (nameChanged || phoneChanged || addrChanged) {
        const invData: Record<string, any> = { updatedAt: ts };
        const estData: Record<string, any> = {};
        if (nameChanged) { invData.customerName = fields.name; estData.customerName = fields.name; }
        if (phoneChanged) { invData.customerPhone = String(fields.phone); estData.customerContact = String(fields.phone); }
        if (addrChanged) { invData.customerAddress = fields.address; estData.customerAddress = fields.address; }
        await tx.invoice.updateMany({
          where: { customerId: existing.id, OR: [{ withGst: false }, { buyerGstin: null }, { buyerGstin: '' }] },
          data: invData,
        });
        await tx.estimate.updateMany({ where: { customerId: existing.id }, data: estData });
        return {
          delta: true,
          customers: await withLiveBillCounts(tx, await tx.customer.findMany(), { all: true }), // FIN-A-5
          invoices: await tx.invoice.findMany({ where: { customerId: existing.id } }),
          estimates: await tx.estimate.findMany(),
        };
      }
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
    return { customers: await withLiveBillCounts(tx, await tx.customer.findMany(), { all: true }) }; // FIN-A-5
  });
}

/**
 * Bulk-import parties (one-time migration from another system). Each row:
 * { name, phone, gstin?, address?, openingBalanceDue? }. Phones are the unique
 * key: invalid phones and any already on file (or repeated within the batch) are
 * SKIPPED, not failed, so a big import never aborts on one bad row. Names are
 * normalised (ALL CAPS, punctuation stripped); a bad GSTIN is dropped rather than
 * rejected. Inserts in one transaction and reports the counts. Call it in chunks
 * (≤5000) for a large file — each chunk dedupes against everything already saved.
 */
export function importCustomers(parties: any[]) {
  if (!Array.isArray(parties) || !parties.length) {
    throw new AppError('NO_PARTIES', 'No parties to import.', 400);
  }
  if (parties.length > 5000) {
    throw new AppError('TOO_MANY', 'Import at most 5000 parties per request.', 400);
  }
  return withRetry(() => prisma.$transaction(async (tx: any) => {
    const existing = await tx.customer.findMany({ select: { phone: true } });
    const seen = new Set<string>(existing.map((c: any) => cleanPhone(c.phone)));
    const ts = nowIso();
    const today = istToday();
    const stamp = ts.replace(/\D/g, '').slice(-10);
    const toCreate: any[] = [];
    let skippedDup = 0, skippedInvalid = 0, withBalance = 0;
    parties.forEach((p: any, i: number) => {
      const phone = cleanPhone(p?.phone);
      if (!phone || phone.length !== 10 || !/^[6-9]\d{9}$/.test(phone)) { skippedInvalid++; return; }
      if (seen.has(phone)) { skippedDup++; return; }
      seen.add(phone);
      const name = normalizeCustomerName(p?.name) || 'UNNAMED';
      let gstin = String(p?.gstin ?? '').trim().toUpperCase();
      if (gstin && !GSTIN_RE.test(gstin)) gstin = '';
      const bal = Number(p?.openingBalanceDue) || 0;
      if (bal > 0) withBalance++;
      toCreate.push({
        id: `cust-imp-${stamp}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        name, phone,
        address: String(p?.address ?? '').trim(),
        gstin: gstin || null,
        customerType: gstin ? 'Organization' : 'Retail',
        firstPurchaseDate: today,
        purchaseCount: 0,
        totalSpent: 0,
        openingBalanceDue: bal > 0 ? round2(bal) : null,
        createdAt: ts,
        updatedAt: ts,
      });
    });
    if (toCreate.length) await tx.customer.createMany({ data: toCreate, skipDuplicates: true });
    return {
      created: toCreate.length,
      skippedDup,
      skippedInvalid,
      withBalance,
      totalCustomers: await tx.customer.count(),
    };
  }));
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
    return { customers: await withLiveBillCounts(tx, await tx.customer.findMany(), { all: true }) }; // FIN-A-5
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
