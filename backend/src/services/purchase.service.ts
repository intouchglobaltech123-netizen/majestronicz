import { prisma } from '../db.js';
import { istToday, isValidYmd } from '../lib/businessDate.js';
import { AppError } from '../middleware/errorHandler.js';
import { isValidTaxPercent, taxAmountFor } from '../lib/tax.js';
import { nowIso, rid } from '../lib/stockLedger.js';
import { nextPoNumber } from '../lib/sequences.js';
import { serializableTx } from '../lib/tx.js';
import { assertBranchAllowed } from '../lib/branchGuard.js';
import { isValidBranch } from '../lib/constants.js';
import { allowsFractionalQty } from '../lib/units.js';
import { archivedItemError } from '../lib/lineValidation.js';
import { nextReceiptNumber } from './payment.service.js';
import { lineSettled, lineGoodValue, poPayCap, supplierBillsOf, billNumberKey, SupplierBill } from '../lib/poMoney.js';

/**
 * PUR2-12: a PO as sent to screens — the attachment LIST only, never a file
 * body. Older POs stored each file's base64 `dataUrl` inside the row; it is
 * left in the database but dropped here (fetched on demand instead).
 */
export function stripAttachmentBodies<T = any>(po: T): T {
  const atts = (po as any)?.attachments;
  if (!Array.isArray(atts) || !atts.some((a: any) => a && 'dataUrl' in a)) return po;
  return { ...(po as any), attachments: atts.map((a: any) => { const { dataUrl, ...meta } = a || {}; return meta; }) };
}

const poSnapshot = async (tx: any) => ({
  purchaseOrders: (await tx.purchaseOrder.findMany()).map(stripAttachmentBodies),
  pendingOrders: await tx.pendingOrder.findMany(),
  branchStocks: await tx.branchStock.findMany(),
});

/** Create (server-assigned PO number) or edit a purchase order; link pending order. */
export function savePurchaseOrder(poData: any, _actor: string, reqUser?: any) {
  if (!poData || typeof poData !== 'object') throw new AppError('BAD_REQUEST', 'Purchase order details are missing.', 400);
  assertBranchAllowed(reqUser, poData.branchId);
  if (!isValidBranch(poData.branchId)) throw new AppError('BAD_BRANCH', `Unknown branch: ${poData.branchId}`, 400);
  // PUR5-2: a PO needs a real supplier id (a missing one used to reach the
  // database as NULL and fail with a 500) and real dates ("hello" was stored).
  if (!String(poData.vendorId || '').trim()) throw new AppError('VENDOR_REQUIRED', 'Choose a supplier for this purchase order.', 400);
  if (!isValidYmd(poData.date)) throw new AppError('BAD_DATE', 'PO date must be a real date (YYYY-MM-DD).', 400);
  if (poData.expectedDeliveryDate != null && poData.expectedDeliveryDate !== '' && !isValidYmd(poData.expectedDeliveryDate)) {
    throw new AppError('BAD_DATE', 'Expected delivery date must be a real date (YYYY-MM-DD).', 400);
  }
  // Serializable + retry so a concurrent Edit-Prices and receive on the same PO
  // can't lose one another's write (E2E-5).
  return serializableTx(async (tx: any) => {
    const ts = nowIso();
    // Reject bad line input (PUR2-*): a line must reference a real item, with a
    // positive ordered quantity, a non-negative price and a 0–100% tax rate.
    const lineItems = Array.isArray(poData.items) ? poData.items : [];
    if (!lineItems.length) throw new AppError('NO_ITEMS', 'A purchase order needs at least one line item.', 400);
    const itemIds = lineItems.map((l: any) => l?.itemId).filter(Boolean);
    const knownItems = new Map<string, any>(
      (await tx.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, unit: true, itemName: true, isArchived: true } })).map((i: any) => [i.id, i]),
    );
    for (const l of lineItems) {
      if (!l?.itemId || !knownItems.has(l.itemId)) throw new AppError('BAD_ITEM', 'A line references an item that does not exist.', 400);
      const qty = Number(l.quantityOrdered);
      if (!Number.isFinite(qty) || !(qty > 0)) throw new AppError('BAD_QTY', 'Ordered quantity must be greater than zero.', 400);
      // PUR5-2 / PUR-10: 2.5 of a piece-counted item silently became 2 on screen.
      const item = knownItems.get(l.itemId);
      if (!Number.isInteger(qty) && !allowsFractionalQty(item?.unit || l.unit)) {
        throw new AppError('BAD_QTY', `"${item?.itemName || l.itemName || 'Item'}" is counted in whole ${item?.unit || l.unit || 'units'} — enter a whole quantity, not ${qty}.`, 400);
      }
      if (!Number.isFinite(Number(l.purchasePrice ?? 0)) || Number(l.purchasePrice) < 0) throw new AppError('BAD_PRICE', 'Purchase price cannot be negative.', 400);
      if (l.taxPercent != null && !isValidTaxPercent(l.taxPercent)) throw new AppError('BAD_TAX', 'Tax % must be between 0 and 100.', 400);
    }
    // The vendor must exist.
    const vendor = await tx.vendor.findUnique({ where: { id: poData.vendorId }, select: { id: true, vendorName: true } });
    if (!vendor) throw new AppError('BAD_VENDOR', 'The selected supplier does not exist.', 400);
    let saved: any;
    // These are owned by dedicated flows (receive / pay / cancel / record-bill /
    // attachments) and the server — never taken from a general PO save, or a PO
    // could be created/edited as Received with a fake paid amount and number
    // (PUR2-6). PUR5-4: the supplier-bill and attachment fields are here too, so
    // an "Edit Prices" save built from a stale snapshot can't blank out the
    // supplier's tax invoice or another user's attachments. PUR8-2: other charges
    // are added by receipts only, and totals are always recomputed from lines.
    const SERVER_MANAGED = [
      'status', 'amountPaid', 'poNumber', 'receivingHistory', 'debitNotes', 'payments',
      'supplierBillNumber', 'supplierBillDate', 'supplierBillTaxable', 'supplierBillGst', 'supplierBills', 'attachments',
      'otherCharges', 'totalAmount', 'totalTax', 'createdAt', 'updatedAt',
    ];
    // Price × ordered qty and the tax on it, recomputed from the line itself.
    const priced = (l: any, price: number, qty: number, taxPercent: number) => {
      const amount = Math.round(price * qty * 100) / 100;
      const taxAmount = taxAmountFor(amount, taxPercent);
      return { ...l, quantityOrdered: qty, purchasePrice: price, taxPercent, amount, taxAmount, lineTotal: Math.round((amount + taxAmount) * 100) / 100 };
    };
    const lineId = () => `pol-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const existingPo = poData.id ? await tx.purchaseOrder.findUnique({ where: { id: poData.id } }) : null;
    // An archived item can't be ordered again; a line it already had stays editable.
    const prevItemIds = new Set(((existingPo?.items as any[]) || []).map((l: any) => l?.itemId));
    for (const l of lineItems) {
      const it = knownItems.get(l.itemId);
      if (it?.isArchived && !prevItemIds.has(l.itemId)) throw archivedItemError(it.itemName);
    }
    if (existingPo) {
      // SEC5-2: the guard at the top ran against the request's poData.branchId.
      // On an edit, authorize against the STORED PO's branch and keep the branch
      // immutable, so a branch-locked user can't edit or move another branch's PO
      // by sending a different branchId.
      assertBranchAllowed(reqUser, existingPo.branchId);
      if (existingPo.status === 'Cancelled') throw new AppError('PO_CANCELLED', 'A cancelled purchase order cannot be edited.', 409);
      const { id, ...rest } = poData;
      for (const k of SERVER_MANAGED) delete (rest as any)[k];
      delete (rest as any).branchId;
      const dbLines: any[] = Array.isArray(existingPo.items) ? (existingPo.items as any[]) : [];
      const anySettled = dbLines.some((l) => lineSettled(l) > 0) || ((existingPo.receivingHistory as any[]) || []).length > 0;
      // PUR8-3: once anything is received the supplier is fixed — the receipts,
      // debit notes and payments all belong to that supplier.
      if (anySettled && rest.vendorId !== existingPo.vendorId) {
        throw new AppError('VENDOR_LOCKED', 'The supplier cannot be changed after stock has been received on this PO.', 409);
      }
      // E2E-5 / PUR8-5: an Edit-Prices payload is built from a snapshot of the PO
      // the user opened, which may predate a receipt. Match each client line to
      // the stored line by LINE id (the same item may sit on two lines), take
      // price / ordered-qty / tax from the client, and keep the server's received
      // / damaged / missing quantities so a stale edit can't wipe what was
      // actually received. Lines stored before ids existed match by item.
      const used = new Set<number>();
      const findDb = (cl: any): number => {
        if (cl.id) {
          const i = dbLines.findIndex((d, k) => !used.has(k) && d.id && d.id === cl.id);
          if (i >= 0) return i;
        }
        return dbLines.findIndex((d, k) => !used.has(k) && !d.id && d.itemId === cl.itemId);
      };
      rest.items = lineItems.map((cl: any) => {
        const k = findDb(cl);
        const db = k >= 0 ? dbLines[k] : null;
        if (k >= 0) used.add(k);
        const settled = db ? lineSettled(db) : 0;
        // PUR8-3: a line with receipts keeps its item, and can't be cut below
        // what has already been received / billed back.
        if (db && settled > 0 && db.itemId !== cl.itemId) {
          throw new AppError('LINE_LOCKED', `"${db.itemName || db.itemId}" has stock received against it and cannot be replaced.`, 409);
        }
        const qty = Number(cl.quantityOrdered);
        if (db && qty < settled) {
          throw new AppError('QTY_BELOW_RECEIVED', `"${db.itemName || db.itemId}" already has ${settled} received/settled — the ordered quantity cannot go below that.`, 400);
        }
        const price = Number(cl.purchasePrice) || 0;
        const taxPercent = cl.taxPercent != null ? Number(cl.taxPercent) : (db?.taxPercent ?? 0);
        const line: any = priced({ ...(db || {}), ...cl, id: db?.id || cl.id || lineId() }, price, qty, taxPercent);
        // Received state is authoritative from the DB, never the client.
        line.receivedQuantity = db?.receivedQuantity ?? 0;
        line.damagedQuantity = db?.damagedQuantity ?? 0;
        line.missingQuantity = db?.missingQuantity ?? 0;
        delete line.receivedTaxable;
        delete line.receivedTax;
        if (db && (db.receivedQuantity || 0) > 0) {
          // A price/rate correction re-values the units already received at the
          // corrected price; otherwise each receipt keeps its own value (E2E8-5).
          const changed = Number(db.purchasePrice || 0) !== price || Number(db.taxPercent || 0) !== taxPercent;
          const v = changed ? lineGoodValue({ receivedQuantity: db.receivedQuantity, purchasePrice: price, taxPercent }) : lineGoodValue(db);
          line.receivedTaxable = v.taxable;
          line.receivedTax = v.tax;
        }
        return line;
      });
      // PUR8-3: removing a line that already has receipts would erase goods (and
      // the money owed for them) that are physically in stock.
      dbLines.forEach((d, k) => {
        if (!used.has(k) && lineSettled(d) > 0) {
          throw new AppError('LINE_LOCKED', `"${d.itemName || d.itemId}" has stock received against it and cannot be removed from the PO.`, 409);
        }
      });
      rest.totalAmount = Math.round(rest.items.reduce((s: number, l: any) => s + (l.amount || 0), 0) * 100) / 100;
      rest.totalTax = Math.round(rest.items.reduce((s: number, l: any) => s + (l.taxAmount || 0), 0) * 100) / 100;
      if (anySettled) {
        const allFull = rest.items.every((l: any) => lineSettled(l) >= (l.quantityOrdered || 0));
        rest.status = allFull ? 'Received' : 'Partially Received';
      }
      if (!rest.vendorName) rest.vendorName = vendor.vendorName;
      saved = await tx.purchaseOrder.update({ where: { id }, data: { ...rest, updatedAt: ts } });
    } else {
      const id = poData.id || `po-order-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
      const poNumber = await nextPoNumber(tx, poData.branchId); // authoritative, collision-free
      const clean = { ...poData };
      for (const k of SERVER_MANAGED) delete (clean as any)[k];
      // PUR5-2: never trust the client's totals. Recompute each line's amount/tax
      // from price × ordered-qty and the tax %, then the PO totals from the lines,
      // exactly as the edit path does — a tampered or buggy client can't persist
      // an inflated payable (₹1,98,480 shown vs ₹89,048 actually owed). A new PO
      // has nothing received, whatever the client sent.
      clean.items = lineItems.map((l: any) => {
        const line: any = priced({ ...l, id: l.id || lineId() }, Number(l.purchasePrice) || 0, Number(l.quantityOrdered), isValidTaxPercent(l.taxPercent) ? Number(l.taxPercent) : 0);
        line.receivedQuantity = 0;
        line.damagedQuantity = 0;
        line.missingQuantity = 0;
        delete line.receivedTaxable;
        delete line.receivedTax;
        return line;
      });
      // Two lines may not share an id (receipts and edits match lines by id).
      const seen = new Set<string>();
      for (const l of clean.items) { if (seen.has(l.id)) l.id = lineId(); seen.add(l.id); }
      clean.totalAmount = Math.round(clean.items.reduce((s: number, l: any) => s + (l.amount || 0), 0) * 100) / 100;
      clean.totalTax = Math.round(clean.items.reduce((s: number, l: any) => s + (l.taxAmount || 0), 0) * 100) / 100;
      if (!clean.vendorName) clean.vendorName = vendor.vendorName;
      if (!clean.expectedDeliveryDate) clean.expectedDeliveryDate = clean.date;
      saved = await tx.purchaseOrder.create({
        data: { ...clean, id, poNumber, status: 'Ordered', amountPaid: 0, otherCharges: 0, createdAt: ts, updatedAt: ts },
      });
    }

    if (saved.pendingOrderId) {
      await tx.pendingOrder.updateMany({
        where: { id: saved.pendingOrderId },
        data: {
          linkedPurchaseOrderId: saved.id,
          purchaseOrderId: saved.id,
          purchaseOrderNumber: saved.poNumber,
          updatedAt: ts,
        },
      });
    }
    return { ...(await poSnapshot(tx)), saved: stripAttachmentBodies(saved) };
  });
}

export function deletePurchaseOrder(poId: string, reqUser?: any) {
  return prisma.$transaction(async (tx: any) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id: poId } });
    if (po) assertBranchAllowed(reqUser, po.branchId); // SEC2-1
    // A PO that ever received stock OR had a vendor payment keeps a financial
    // history (stock receipts, debit notes, payments) — deleting it (even after a
    // cancel) would orphan that history. Block it. PUR3-6 / E2E-4.
    if (po && (po.status === 'Received' || po.status === 'Partially Received' || ((po.receivingHistory as any[]) || []).length > 0)) {
      throw new AppError('HAS_RECEIPTS', 'Cannot delete a PO that has received stock — it has receipt history. Cancel it instead.', 409);
    }
    if (po && ((po.amountPaid || 0) > 0 || ((po.payments as any[]) || []).length > 0)) {
      throw new AppError('HAS_PAYMENTS', 'Cannot delete a PO that has vendor payments recorded. Reverse the payment first.', 409);
    }
    if (po) await tx.purchaseOrder.delete({ where: { id: poId } });
    return poSnapshot(tx);
  });
}

export function cancelPurchaseOrder(poId: string, reqUser?: any) {
  return prisma.$transaction(async (tx: any) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id: poId } });
    if (po) assertBranchAllowed(reqUser, po.branchId); // SEC2-1
    // PUR3-6: a PO with vendor money already paid against it must not be silently
    // cancelled — that would strand the payment against a cancelled order. Reverse
    // the vendor payment first.
    if (po && (po.amountPaid || 0) > 0) {
      throw new AppError('PO_HAS_PAYMENTS', 'Cannot cancel a purchase order that has payments recorded against it. Reverse the vendor payment first.', 409);
    }
    // A PO that has received stock can't be cancelled either — the receipts and
    // their stock already happened (PUR3-6). Reverse/return the stock first.
    if (po && (po.status === 'Received' || po.status === 'Partially Received' || ((po.receivingHistory as any[]) || []).length > 0)) {
      throw new AppError('PO_HAS_RECEIPTS', 'Cannot cancel a purchase order that has received stock.', 409);
    }
    const ts = nowIso();
    await tx.purchaseOrder.updateMany({ where: { id: poId }, data: { status: 'Cancelled', updatedAt: ts } });
    // PUR-5: unlink any pending order that pointed at this PO so it is no longer
    // stuck waiting on a cancelled order — clearing the link makes the pending
    // order offer a fresh "Create PO" action again.
    const orClauses: any[] = [{ linkedPurchaseOrderId: poId }, { purchaseOrderId: poId }];
    if (po?.pendingOrderId) orClauses.push({ id: po.pendingOrderId });
    await tx.pendingOrder.updateMany({
      where: { OR: orClauses },
      data: { linkedPurchaseOrderId: null, purchaseOrderId: null, purchaseOrderNumber: null, updatedAt: ts },
    });
    return poSnapshot(tx);
  });
}

/** Receive stock against a PO: update lines/status/history + increment branch stock (atomic). */
export function receivePurchaseOrderStock(
  poId: string,
  receipts: { itemId: string; quantityReceived: number; location?: string; purchasePrice?: number; damagedQuantity?: number; missingQuantity?: number; taxPercent?: number }[],
  notes: string | undefined,
  payment: { amount?: number; mode?: string } | undefined,
  actor: string,
  otherCharges: number | undefined,
  reqUser?: any
) {
  return serializableTx(async (tx: any) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new AppError('NOT_FOUND', 'Purchase order not found', 404);
    assertBranchAllowed(reqUser, po.branchId);

    // A cancelled or already fully-received PO must not accept more stock — doing
    // so let a cancelled order flip to Received and create stock (PUR-1).
    if (po.status === 'Cancelled') throw new AppError('PO_CANCELLED', 'Cannot receive stock against a cancelled purchase order.', 400);
    if (po.status === 'Received') throw new AppError('PO_COMPLETE', 'This purchase order is already fully received.', 400);

    const n = (v: unknown) => Number(v) || 0;
    for (const r of receipts || []) {
      for (const v of [r?.quantityReceived, r?.damagedQuantity, r?.missingQuantity]) {
        if (v != null && (v as any) !== '' && !Number.isFinite(Number(v))) throw new AppError('BAD_QTY', 'Quantities must be numbers.', 400);
      }
    }
    // PUR4-3: a receipt of 0 good + N missing (nothing arrived) is a real event.
    const rawValid = (receipts || []).filter((r) => n(r.quantityReceived) > 0 || n(r.damagedQuantity) > 0 || n(r.missingQuantity) > 0);
    if (!rawValid.length) throw new AppError('NO_ITEMS', 'No items to receive', 400);
    // Aggregate multiple receipt entries for the SAME item into one, so sending the
    // item twice in one receipt can't double the stock (PUR3-1).
    const aggByItem = new Map<string, any>();
    for (const r of rawValid) {
      const cur = aggByItem.get(r.itemId) || { itemId: r.itemId, quantityReceived: 0, damagedQuantity: 0, missingQuantity: 0 };
      cur.quantityReceived += n(r.quantityReceived);
      cur.damagedQuantity += n(r.damagedQuantity);
      cur.missingQuantity += n(r.missingQuantity);
      if (r.location) cur.location = r.location;
      if (r.purchasePrice != null) cur.purchasePrice = Number(r.purchasePrice);
      if (r.taxPercent != null) cur.taxPercent = r.taxPercent;
      aggByItem.set(r.itemId, cur);
    }
    const valid = [...aggByItem.values()];

    const ts = nowIso();
    const lines = po.items as any[];

    // Validate each item's receipt (exists on PO, non-negative, whole for counted
    // units, valid tax). The unit comes from the item master (the PO line's copy
    // as a fallback), the same rule as the PO save and every stock move.
    const masters = await tx.item.findMany({ where: { id: { in: valid.map((r) => r.itemId) } }, select: { id: true, unit: true, itemName: true, isArchived: true } });
    const masterUnits = new Map<string, string | null>(masters.map((i: any) => [i.id, i.unit]));
    // INV9-2: an archived item takes no new stock — restore it first.
    const archived = masters.find((i: any) => i.isArchived && n(valid.find((r) => r.itemId === i.id)?.quantityReceived) > 0);
    if (archived) throw archivedItemError(archived.itemName);
    for (const rec of valid) {
      const line = lines.find((l) => l.itemId === rec.itemId);
      if (!line) throw new AppError('ITEM_NOT_ON_PO', `An item being received is not on this purchase order.`, 400);
      const good = n(rec.quantityReceived);
      const dmg = n(rec.damagedQuantity);
      const missing = n(rec.missingQuantity);
      if (good < 0 || dmg < 0 || missing < 0) throw new AppError('NEGATIVE_QTY', 'Received, damaged or missing quantity cannot be negative.', 400);
      const unit = masterUnits.get(rec.itemId) || line.unit;
      if (!allowsFractionalQty(unit) && [good, dmg, missing].some((q) => !Number.isInteger(q))) {
        throw new AppError('BAD_QTY', `"${line.itemName || rec.itemId}" is counted in whole ${String(unit || 'units').toUpperCase()} — enter whole quantities.`, 400);
      }
      if (rec.taxPercent != null && !isValidTaxPercent(rec.taxPercent)) {
        throw new AppError('BAD_TAX', `Tax % for "${line.itemName || rec.itemId}" must be between 0 and 100.`, 400);
      }
      if (rec.purchasePrice != null && !(Number.isFinite(rec.purchasePrice) && rec.purchasePrice >= 0)) {
        throw new AppError('BAD_PRICE', `Price for "${line.itemName || rec.itemId}" cannot be negative.`, 400);
      }
    }
    const extraRaw = otherCharges == null || (otherCharges as any) === '' ? 0 : Number(otherCharges);
    if (!Number.isFinite(extraRaw) || extraRaw < 0) throw new AppError('BAD_CHARGES', 'Packing / other charges cannot be negative.', 400);

    // DISTRIBUTE each item's receipt across ITS lines (PO order), filling each
    // line's remaining capacity. Previously the full receipt was added to EVERY
    // line sharing the item, so the same item on two lines doubled the received
    // quantity (and, now, the received-value payable). Reject anything that can't
    // fit across the item's combined remaining (over-receipt). Keyed by line
    // index, so legacy lines without an id can't collide.
    const lineAlloc = new Map<number, { good: number; dmg: number; missing: number }>();
    for (const rec of valid) {
      let g = n(rec.quantityReceived);
      let d = n(rec.damagedQuantity);
      let m = n(rec.missingQuantity);
      lines.forEach((line, idx) => {
        if (line.itemId !== rec.itemId) return;
        let cap = Math.max(0, (line.quantityOrdered || 0) - lineSettled(line));
        const ag = Math.min(g, cap); cap -= ag; g -= ag;
        const ad = Math.min(d, cap); cap -= ad; d -= ad;
        const am = Math.min(m, cap); cap -= am; m -= am;
        lineAlloc.set(idx, { good: ag, dmg: ad, missing: am });
      });
      if (g + d + m > 0.0001) {
        const first = lines.find((l) => l.itemId === rec.itemId);
        throw new AppError('OVER_RECEIPT', `Cannot settle more of "${first?.itemName || rec.itemId}" than remains on the PO.`, 400);
      }
    }

    const recByItem = new Map(valid.map((r) => [r.itemId, r]));
    // Debit-note lines for this receipt, one per PO line billed back.
    const dnLines: any[] = [];
    const updatedLines = lines.map((line, idx) => {
      const alloc = lineAlloc.get(idx);
      if (!alloc || (alloc.good <= 0 && alloc.dmg <= 0 && alloc.missing <= 0)) return line;
      const rec = recByItem.get(line.itemId)!;
      const nextPrice =
        rec.purchasePrice != null && rec.purchasePrice > 0 ? rec.purchasePrice : line.purchasePrice || 0;
      const nextTaxPercent =
        rec.taxPercent != null ? Number(rec.taxPercent) : (line.taxPercent ?? 0);
      const lineAmount = Math.round(nextPrice * (line.quantityOrdered || 0) * 100) / 100;
      // E2E8-5: what this receipt's GOOD units are worth, at THIS receipt's price
      // and GST — added to the line's running received value, so a later receipt
      // at a different rate never re-taxes units already received.
      const before = lineGoodValue(line);
      const addTaxable = Math.round(nextPrice * alloc.good * 100) / 100;
      const addTax = taxAmountFor(addTaxable, nextTaxPercent);
      // E2E-4: damaged and missing units are billed back WITH their GST (the
      // input tax on them is reversed), at the price/rate of this receipt.
      if (alloc.dmg > 0 || alloc.missing > 0) {
        const dnTaxable = Math.round(nextPrice * (alloc.dmg + alloc.missing) * 100) / 100;
        const dnTax = taxAmountFor(dnTaxable, nextTaxPercent);
        dnLines.push({
          itemId: line.itemId, itemName: line.itemName || line.itemId, itemCode: line.itemCode || '',
          damagedQuantity: alloc.dmg, missingQuantity: alloc.missing, unitPrice: nextPrice,
          taxPercent: nextTaxPercent, taxableValue: dnTaxable, taxAmount: dnTax,
          amount: Math.round((dnTaxable + dnTax) * 100) / 100,
        });
      }
      return {
        ...line,
        receivedQuantity: (line.receivedQuantity || 0) + alloc.good,
        damagedQuantity: (line.damagedQuantity || 0) + alloc.dmg,
        missingQuantity: (line.missingQuantity || 0) + alloc.missing,
        receivedTaxable: Math.round((before.taxable + addTaxable) * 100) / 100,
        receivedTax: Math.round((before.tax + addTax) * 100) / 100,
        purchasePrice: nextPrice,
        amount: lineAmount,
        taxPercent: nextTaxPercent,
        taxAmount: taxAmountFor(lineAmount, nextTaxPercent),
        lineTotal: Math.round((lineAmount + taxAmountFor(lineAmount, nextTaxPercent)) * 100) / 100,
      };
    });
    const newTotalAmount = Math.round(updatedLines.reduce((s: number, l: any) => s + (l.amount || 0), 0) * 100) / 100;
    const newTotalTax = Math.round(
      updatedLines.reduce((s: number, l: any) => s + (l.taxAmount || 0), 0) * 100,
    ) / 100;

    // PUR8-2: extra charges the vendor billed (packing/freight) on THIS receipt,
    // added to the PO exactly once and recorded on the receipt itself.
    const extraCharge = Math.round(extraRaw * 100) / 100;
    const newOtherCharges = Math.round(((po.otherCharges || 0) + extraCharge) * 100) / 100;

    const eventLines = valid.map((rec) => {
      const line = lines.find((l) => l.itemId === rec.itemId);
      const prevReceived = lines.filter((l) => l.itemId === rec.itemId).reduce((s, l) => s + (l.receivedQuantity || 0), 0);
      const price = rec.purchasePrice != null && rec.purchasePrice > 0 ? rec.purchasePrice : line?.purchasePrice ?? 0;
      const rate = rec.taxPercent ?? line?.taxPercent ?? 0;
      const taxableValue = Math.round(price * rec.quantityReceived * 100) / 100;
      return {
        itemId: rec.itemId, itemName: line?.itemName || rec.itemId, itemCode: line?.itemCode || '',
        quantityOrdered: lines.filter((l) => l.itemId === rec.itemId).reduce((s, l) => s + (l.quantityOrdered || 0), 0),
        quantityReceivedThisEvent: rec.quantityReceived,
        damagedQuantity: rec.damagedQuantity || 0,
        missingQuantity: rec.missingQuantity || 0,
        totalReceivedSoFar: prevReceived + rec.quantityReceived, location: rec.location?.trim() || undefined,
        // What this receipt itself cost, so the history shows the money that
        // moved on the day rather than only the PO's running totals.
        purchasePrice: price,
        taxPercent: rate,
        taxableValue,
        taxAmount: taxAmountFor(taxableValue, rate),
      };
    });
    const receivingEvent = {
      id: `rec-evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      date: istToday(), timestamp: ts, receivedBy: actor, notes: notes?.trim() || undefined, lines: eventLines,
      ...(extraCharge > 0 ? { otherCharges: extraCharge } : {}),
    };

    // Damaged (defective) AND missing (short-shipped) units are both listed on a
    // debit note to the vendor, with GST. The amount owed is worked out from the
    // GOOD units only (lib/poMoney.ts), so the note is the document for the
    // supplier — it is not subtracted from the payable a second time (PUR8-1).
    const existingNotes = (po.debitNotes as any[]) || [];
    let debitNotes = existingNotes;
    if (dnLines.length) {
      const r2 = (x: number) => Math.round(x * 100) / 100;
      const newNote = {
        id: `dn-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        noteNumber: `${po.poNumber}-DN${existingNotes.length + 1}`,
        date: istToday(), createdBy: actor, lines: dnLines,
        totalTaxable: r2(dnLines.reduce((s, l) => s + l.taxableValue, 0)),
        totalTax: r2(dnLines.reduce((s, l) => s + l.taxAmount, 0)),
        totalAmount: r2(dnLines.reduce((s, l) => s + l.amount, 0)),
        notes: notes?.trim() || undefined,
      };
      debitNotes = [newNote, ...existingNotes];
    }

    // A line is settled when good + damaged + missing covers the ordered qty.
    const allFull = updatedLines.every((l) => lineSettled(l) >= l.quantityOrdered);
    const anyReceived = updatedLines.some((l) => lineSettled(l) > 0);
    const status = allFull ? 'Received' : anyReceived ? 'Partially Received' : po.status;

    // Optional vendor payment recorded at the moment of receiving — capped by the
    // same formula as every other vendor payment (PUR2-9 / PUR8-1): refused, not
    // silently trimmed, so the drawer and the PO never disagree.
    const today = istToday(); // the IST cash day, not the UTC date (CASH7-11 / PUR7-5)
    const payNow = Math.round(Math.max(0, n(payment?.amount)) * 100) / 100;
    if (payNow > 0) {
      const cap = poPayCap({ ...po, items: updatedLines, otherCharges: newOtherCharges, status });
      if (payNow > cap + 0.005) {
        throw new AppError('OVERPAYMENT', `Payment of ₹${payNow} exceeds the ₹${cap.toLocaleString('en-IN')} that can still be paid on this PO.`, 400);
      }
    }
    const newAmountPaid = Math.round(((po.amountPaid || 0) + payNow) * 100) / 100;
    const payments = (po.payments as any[]) || [];
    let ledgerId: string | null = null;
    if (payNow > 0) {
      // A vendor payment at receiving hits the drawer today — refuse it on a closed day (CASH-2).
      const closed = await tx.dailyCashRegister.findFirst({ where: { branchId: po.branchId, date: today, isClosed: true } });
      if (closed) throw new AppError('DAY_CLOSED', `The cash day ${today} is closed. Reopen it before paying this vendor.`, 409);
      ledgerId = rid('pay');
      payments.unshift({ id: rid('pay'), date: today, amount: payNow, mode: payment?.mode || 'Cash', by: actor, ledgerPaymentId: ledgerId });
    }

    await tx.purchaseOrder.update({
      where: { id: poId },
      data: {
        items: updatedLines, status, totalAmount: newTotalAmount, totalTax: newTotalTax,
        otherCharges: newOtherCharges,
        amountPaid: newAmountPaid,
        receivingHistory: [receivingEvent, ...((po.receivingHistory as any[]) || [])],
        debitNotes, payments,
        updatedAt: ts,
      },
    });

    // A vendor payment made while receiving must also hit the cash drawer / Payments
    // Log via a Payment 'out' ledger row (CASH3-5) — not only the PO-embedded entry.
    if (payNow > 0 && ledgerId) {
      // CASH9-4: the same persistent PAY- sequence as every other voucher, so a
      // deleted voucher's number is never reissued.
      const receiptNumber = await nextReceiptNumber(tx, 'out', today);
      await tx.payment.create({
        data: {
          id: ledgerId, receiptNumber,
          type: 'out', partyType: 'vendor', partyId: po.vendorId ?? null, partyName: po.vendorName || 'Vendor',
          branchId: po.branchId, date: today, amount: payNow, paymentMode: payment?.mode || 'Cash',
          reference: po.poNumber ?? null, notes: `Vendor payment on PO ${po.poNumber} (at receiving)`,
          allocations: [{ refId: po.id, refNumber: po.poNumber, amount: payNow }] as any,
          createdById: null, createdByName: actor, createdAt: ts,
        },
      });
    }

    // Reflect the confirmed per-unit purchase price back onto the item master, and
    // re-price its sale price from the margin band (A +35% / B +25% / C +15%).
    const marginMult: Record<string, number> = { A: 1.35, B: 1.25, C: 1.15 };
    for (const rec of valid) {
      // PUR2-8: only reprice the item master from a real, positive cost that was
      // actually paid for GOOD stock. A price of 0/blank, or a receipt that was
      // entirely damaged (no good units in), must never overwrite the item's cost.
      const goodQty = Number(rec.quantityReceived) || 0;
      if (rec.purchasePrice == null || rec.purchasePrice <= 0) continue;
      if (goodQty <= 0) continue;
      const item = await tx.item.findUnique({ where: { id: rec.itemId } });
      if (!item) continue;
      const data: any = { purchasePrice: rec.purchasePrice, updatedAt: ts };
      const mult = item.marginCategory ? marginMult[item.marginCategory] : undefined;
      if (mult) data.salePrice = Math.round(rec.purchasePrice * mult * 100) / 100;
      await tx.item.update({ where: { id: rec.itemId }, data });
    }

    // Increment physical stock at the PO's branch, and record a stock-history
    // entry for the receipt so the item's movement log reflects PO receipts
    // (previously receipts wrote no history, so the log never matched actual
    // stock — STK-3).
    const receiptLogs: any[] = [];
    for (const rec of valid) {
      const good = Number(rec.quantityReceived) || 0;
      if (good <= 0) continue;
      const existing = await tx.branchStock.findUnique({
        where: { itemId_branchId: { itemId: rec.itemId, branchId: po.branchId } },
      });
      const prevQty = existing?.quantity ?? 0;
      const line = (po.items as any[]).find((l) => l.itemId === rec.itemId);
      await tx.branchStock.upsert({
        where: { itemId_branchId: { itemId: rec.itemId, branchId: po.branchId } },
        create: {
          itemId: rec.itemId, branchId: po.branchId, quantity: good,
          location: rec.location?.trim() || '', minStockAlert: 5, updatedAt: ts,
          // The rate confirmed on the supplier's bill becomes this branch's
          // rate for the item (the receiver corrected it for a reason).
          ...(rec.taxPercent != null ? { gstTaxSlab: Number(rec.taxPercent) } : {}),
        },
        update: {
          quantity: prevQty + good,
          ...(rec.location ? { location: rec.location.trim() } : {}),
          ...(rec.taxPercent != null ? { gstTaxSlab: Number(rec.taxPercent) } : {}),
          updatedAt: ts,
        },
      });
      receiptLogs.push({
        id: rid('adj'), itemId: rec.itemId, itemName: line?.itemName || rec.itemId, itemCode: line?.itemCode || '',
        branchId: po.branchId, previousQuantity: prevQty, quantityChange: good, newQuantity: prevQty + good,
        reason: 'Purchase Receipt', notes: `Received on PO ${po.poNumber}`, adjustedBy: actor, timestamp: ts,
      });
    }
    if (receiptLogs.length) await tx.stockAdjustmentLog.createMany({ data: receiptLogs });
    return poSnapshot(tx);
  });
}

/** Largest supplier-bill attachment accepted (decoded bytes). */
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
/** PUR2-12: all files on one PO together. */
const MAX_PO_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** PUR-12: what the file really is, from its first bytes — the browser's
 *  claimed type is not trusted (an .exe sent as "application/pdf"). */
function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString('latin1'))) return 'image/gif';
  return null;
}

/** Decoded size of the files already on a PO (new table + older in-row files). */
async function poAttachmentBytes(tx: any, po: any): Promise<number> {
  const rows = await tx.poAttachment.findMany({ where: { poId: po.id }, select: { bytes: true } });
  let total = rows.reduce((t: number, r: any) => t + (Number(r.bytes) || 0), 0);
  for (const a of (po.attachments as any[]) || []) {
    const b64 = String(a?.dataUrl || '').split(',')[1] || '';
    total += Math.floor((b64.replace(/\s/g, '').length * 3) / 4);
  }
  return total;
}

export function addAttachment(poId: string, attachmentData: any, actor: string, reqUser?: any) {
  // PUR2-12: only an image or a PDF, as a base64 data URL, up to 5 MB — a 15 MB
  // .exe used to be stored inside the PO row and sent with every response.
  const dataUrl = String(attachmentData?.dataUrl || '').trim();
  const m = /^data:(image\/(?:png|jpe?g|webp|gif)|application\/pdf);base64,([A-Za-z0-9+/=\s]*)$/i.exec(dataUrl);
  if (!m) throw new AppError('BAD_ATTACHMENT', 'Only an image (JPG, PNG, WEBP, GIF) or a PDF can be attached.', 400);
  const body = Buffer.from(m[2].replace(/\s/g, ''), 'base64');
  const bytes = body.length;
  if (bytes > MAX_ATTACHMENT_BYTES) throw new AppError('ATTACHMENT_TOO_LARGE', 'The file is larger than 5 MB.', 413);
  if (bytes === 0) throw new AppError('BAD_ATTACHMENT', 'The file is empty.', 400);
  // PUR-12: the bytes must really be the claimed kind of file.
  const claimed = m[1].toLowerCase().replace('image/jpg', 'image/jpeg');
  const actual = sniffMime(body);
  if (!actual || actual !== claimed) {
    throw new AppError('BAD_ATTACHMENT', `This file is not a real ${claimed === 'application/pdf' ? 'PDF' : claimed.replace('image/', '').toUpperCase() + ' image'}. Only PDF, PNG, JPEG, WEBP or GIF files can be attached.`, 400);
  }
  const fileType = actual === 'application/pdf' ? 'pdf' : 'image';
  return prisma.$transaction(async (tx: any) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new AppError('NOT_FOUND', 'Purchase order not found', 404);
    assertBranchAllowed(reqUser, po.branchId); // SEC2-1
    if ((await poAttachmentBytes(tx, po)) + bytes > MAX_PO_ATTACHMENT_BYTES) {
      throw new AppError('ATTACHMENT_TOO_LARGE', 'This purchase order already holds close to 10 MB of files. Remove a file before adding another.', 413);
    }
    const name = String(attachmentData?.name || (fileType === 'pdf' ? 'bill.pdf' : 'bill.jpg')).trim().slice(0, 200);
    const id = rid('po-att');
    const uploadedAt = nowIso();
    await tx.poAttachment.create({ data: { id, poId: po.id, name, mimeType: actual, bytes, dataUrl: `data:${actual};base64,${body.toString('base64')}`, uploadedAt, uploadedBy: actor || null } });
    // The PO row keeps only the list entry (no file body).
    const meta = { id, name, fileType, mimeType: actual, fileSize: `${Math.max(1, Math.round(bytes / 1024))} KB`, uploadedAt, uploadedBy: actor };
    await tx.purchaseOrder.update({
      where: { id: poId },
      data: { attachments: [meta, ...((po.attachments as any[]) || [])], updatedAt: uploadedAt },
    });
    return poSnapshot(tx);
  }, { timeout: 20_000 });
}

/** PUR2-12: one attached file's body, fetched on demand by the viewer. */
export async function getAttachment(poId: string, attachmentId: string, reqUser?: any) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: String(poId || '') } });
  if (!po) throw new AppError('NOT_FOUND', 'Purchase order not found', 404);
  assertBranchAllowed(reqUser, po.branchId);
  const meta = ((po.attachments as any[]) || []).find((a: any) => a?.id === attachmentId);
  if (!meta) throw new AppError('NOT_FOUND', 'That file is not on this purchase order.', 404);
  const row = await prisma.poAttachment.findFirst({ where: { id: String(attachmentId), poId: po.id } });
  const dataUrl = row?.dataUrl || meta.dataUrl;
  if (!dataUrl) throw new AppError('NOT_FOUND', 'The file could not be found.', 404);
  return { id: meta.id, name: meta.name, fileType: meta.fileType, mimeType: row?.mimeType || meta.mimeType || null, dataUrl };
}

export function deleteAttachment(poId: string, attachmentId: string, reqUser?: any) {
  return prisma.$transaction(async (tx: any) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new AppError('NOT_FOUND', 'Purchase order not found', 404);
    assertBranchAllowed(reqUser, po.branchId); // SEC2-1
    await tx.poAttachment.deleteMany({ where: { id: String(attachmentId || ''), poId: po.id } });
    await tx.purchaseOrder.update({
      where: { id: poId },
      data: {
        attachments: ((po.attachments as any[]) || []).filter((a) => a.id !== attachmentId),
        // A supplier bill that pointed at this file keeps its figures, not the link.
        ...(Array.isArray(po.supplierBills)
          ? { supplierBills: (po.supplierBills as any[]).map((b) => (b?.attachmentId === attachmentId ? { ...b, attachmentId: null } : b)) }
          : {}),
        updatedAt: nowIso(),
      },
    });
    return poSnapshot(tx);
  });
}

/**
 * Add or edit one supplier tax invoice (bill) on a PO — enables Input Tax
 * Credit. A PO can carry several bills, one per delivery (E2E5-11): a bill with
 * an `id` already on the PO is edited, otherwise it is added. The same bill
 * number can't be recorded twice for one supplier (on this or another PO).
 */
export function recordPurchaseBill(poId: string, bill: any, reqUser?: any) {
  return prisma.$transaction(async (tx: any) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new AppError('NOT_FOUND', 'Purchase order not found', 404);
    assertBranchAllowed(reqUser, po.branchId); // SEC2-1
    // PUR3-8: the bill feeds the ITC register and GSTR-3B, so it must be a real
    // bill: a number, a real past date, a non-negative taxable value and GST that
    // is not negative nor more than the highest slab (28%) on that taxable value.
    const number = String(bill?.number ?? '').trim();
    const date = String(bill?.date ?? '').trim();
    const taxable = Number(bill?.taxable ?? 0);
    const gst = Number(bill?.gst ?? 0);
    if (!number) throw new AppError('BILL_NUMBER_REQUIRED', 'Enter the supplier bill number.', 400);
    if (number.length > 60) throw new AppError('BAD_BILL', 'Bill number is too long.', 400);
    if (!isValidYmd(date)) throw new AppError('BAD_DATE', 'Bill date must be a real date (YYYY-MM-DD).', 400);
    if (date > istToday()) throw new AppError('BAD_DATE', 'A supplier bill cannot be dated in the future.', 400);
    if (!Number.isFinite(taxable) || taxable < 0) throw new AppError('BAD_BILL', 'Taxable value cannot be negative.', 400);
    if (!Number.isFinite(gst) || gst < 0) throw new AppError('BAD_BILL', 'GST cannot be negative.', 400);
    if (gst > Math.round(taxable * 0.28 * 100) / 100 + 1) {
      throw new AppError('BAD_BILL', `GST of ₹${gst} is more than 28% of the taxable value ₹${taxable}.`, 400);
    }
    const attachmentId = bill?.attachmentId ? String(bill.attachmentId) : null;
    if (attachmentId && !((po.attachments as any[]) || []).some((a: any) => a?.id === attachmentId)) {
      throw new AppError('BAD_ATTACHMENT', 'The attached file is not on this purchase order.', 400);
    }
    const bills = supplierBillsOf(po).map((b) => ({ ...b }));
    const editId = bill?.id ? String(bill.id) : '';
    const at = editId ? bills.findIndex((b) => b.id === editId) : -1;
    if (editId && at < 0) throw new AppError('NOT_FOUND', 'That supplier bill is not on this purchase order.', 404);
    // The same supplier bill can't be claimed twice (double ITC).
    const key = billNumberKey(number);
    const others = await tx.purchaseOrder.findMany({ where: { vendorId: po.vendorId, NOT: { status: 'Cancelled' } } });
    for (const other of others) {
      for (const b of supplierBillsOf(other)) {
        if (other.id === po.id && b.id === editId) continue;
        if (billNumberKey(b.number) === key) {
          throw new AppError('DUPLICATE_SUPPLIER_BILL', `Bill ${b.number} from this supplier is already recorded on ${other.poNumber || 'another PO'}.`, 409);
        }
      }
    }
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const entry = {
      ...(at >= 0 ? bills[at] : {}),
      id: at >= 0 ? bills[at].id : rid('sbill'),
      number, date, taxable: r2(taxable), gst: r2(gst), attachmentId,
      recordedAt: nowIso(), recordedBy: reqUser?.name ?? null,
    };
    if (at >= 0) bills[at] = entry; else bills.push(entry);
    await tx.purchaseOrder.update({ where: { id: poId }, data: { ...billFields(bills), updatedAt: nowIso() } });
    return poSnapshot(tx);
  });
}

/** Remove one supplier bill from a PO (a wrong entry). */
export function deletePurchaseBill(poId: string, billId: string, reqUser?: any) {
  return prisma.$transaction(async (tx: any) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new AppError('NOT_FOUND', 'Purchase order not found', 404);
    assertBranchAllowed(reqUser, po.branchId);
    const bills = supplierBillsOf(po);
    if (!bills.some((b) => b.id === billId)) throw new AppError('NOT_FOUND', 'That supplier bill is not on this purchase order.', 404);
    await tx.purchaseOrder.update({ where: { id: poId }, data: { ...billFields(bills.filter((b) => b.id !== billId)), updatedAt: nowIso() } });
    return poSnapshot(tx);
  });
}

/** The bill list plus the old single-bill fields kept as its totals (older screens read those). */
function billFields(bills: SupplierBill[]) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    supplierBills: bills as any,
    supplierBillNumber: bills.length ? bills.map((b) => b.number).join(', ').slice(0, 250) : null,
    supplierBillDate: bills.length ? bills.map((b) => b.date).sort().pop() : null,
    supplierBillTaxable: bills.length ? r2(bills.reduce((t, b) => t + (Number(b.taxable) || 0), 0)) : null,
    supplierBillGst: bills.length ? r2(bills.reduce((t, b) => t + (Number(b.gst) || 0), 0)) : null,
  };
}

/** Record a payment made to the vendor against a PO (increments Paid, logs history). */
export function recordPurchaseOrderPayment(poId: string, amount: number, mode: string, actor: string, reqUser?: any) {
  // Serializable + retry so several vendor payments on the same PO at once each
  // apply, instead of a plain transaction where concurrent reads all saw the
  // same amountPaid and only one write survived (CASH2-2).
  return serializableTx(async (tx: any) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new AppError('NOT_FOUND', 'Purchase order not found', 404);
    assertBranchAllowed(reqUser, po.branchId); // SEC2-1
    // PUR2-9: never record a payment against a cancelled PO, and never let the
    // paid amount exceed the PO value (silent overpayment that hides the excess).
    if (po.status === 'Cancelled') throw new AppError('PO_CANCELLED', 'Cannot record a payment against a cancelled purchase order.', 400);
    const pay = Math.max(0, Number(amount) || 0);
    if (pay <= 0) throw new AppError('INVALID', 'Payment amount must be greater than 0', 400);
    // PUR8-1: one formula (lib/poMoney.ts) — owed for the good units received
    // incl. GST and charges, plus what is still expected on the PO (a prepayment
    // for that is an advance). Once every unit is settled this is exactly the
    // balance, so a short-shipped PO can't be over-paid.
    const cap = poPayCap(po);
    if (cap <= 0) throw new AppError('ALREADY_PAID', 'This purchase order is already fully paid.', 400);
    if (pay > cap + 0.005) throw new AppError('OVERPAYMENT', `Payment of ₹${pay} exceeds the remaining balance of ₹${cap.toLocaleString('en-IN')}.`, 400);
    const ts = nowIso();
    const today = istToday(); // the IST cash day, not the UTC date (CASH7-11 / PUR7-5)
    // A vendor payment hits the drawer of the PO's branch today — if that day is
    // already closed, it would change a reconciled day (the Parties screen already
    // refuses this; the PO page must too). (CASH-2)
    const closed = await tx.dailyCashRegister.findFirst({ where: { branchId: po.branchId, date: today, isClosed: true } });
    if (closed) throw new AppError('DAY_CLOSED', `The cash day ${today} is closed. Reopen it before paying this vendor.`, 409);
    // Link the PO-embedded entry to its ledger row so deleting the payment can
    // remove BOTH (otherwise the deleted payment lingered in the PO history).
    const ledgerId = rid('pay');
    const entry = { id: rid('pay'), date: today, amount: pay, mode: mode || 'Cash', by: actor, ledgerPaymentId: ledgerId };
    await tx.purchaseOrder.update({
      where: { id: poId },
      data: {
        amountPaid: Math.round(((po.amountPaid || 0) + pay) * 100) / 100,
        payments: [entry, ...((po.payments as any[]) || [])],
        updatedAt: ts,
      },
    });
    // Also record a Payment-ledger 'out' row so this vendor payment reaches the
    // cash drawer / Payments Log (CASH3-5). The PO page and To Pay previously only
    // wrote the PO-embedded entry, which the drawer never sees, so vendor cash
    // paid there never left the drawer. Booked against the PO's branch.
    const receiptNumber = await nextReceiptNumber(tx, 'out', today); // CASH9-4
    await tx.payment.create({
      data: {
        id: ledgerId, receiptNumber,
        type: 'out', partyType: 'vendor', partyId: po.vendorId ?? null, partyName: po.vendorName || 'Vendor',
        branchId: po.branchId, date: today, amount: pay, paymentMode: mode || 'Cash',
        reference: po.poNumber ?? null, notes: `Vendor payment on PO ${po.poNumber}`,
        allocations: [{ refId: po.id, refNumber: po.poNumber, amount: pay }] as any,
        createdById: null, createdByName: actor, createdAt: ts,
      },
    });
    return poSnapshot(tx);
  });
}
