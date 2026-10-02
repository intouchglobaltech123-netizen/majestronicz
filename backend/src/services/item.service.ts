import { prisma } from '../db.js';
import { nowIso, rid } from '../lib/stockLedger.js';
import { BRANCHES } from '../lib/constants.js';
import { AppError } from '../middleware/errorHandler.js';
import { assertBranchAllowed } from '../lib/branchGuard.js';
import { stockQty } from '../lib/units.js';
import { serializableTx } from '../lib/tx.js';

/** Item names compare case- and space-insensitively ("Omron  relay" = "omron relay"). */
const nameKey = (n: unknown) => String(n || '').trim().replace(/\s+/g, ' ').toLowerCase();
const HSN_RE = /^\d{4}(\d{2}(\d{2})?)?$/;
/** Server-managed archive fields — never taken from an add/edit payload. */
const ARCHIVE_FIELDS = ['isArchived', 'archivedAt', 'archivedBy'];

/**
 * INV4-6: field checks shared by add and edit (only the fields present are
 * checked on an edit): a real name (not just digits), a unit, thresholds and
 * wholesale quantity of 0 or more, a discount within 100% / the sale price,
 * and a supplier that exists. Text fields are trimmed.
 */
async function assertItemFields(tx: any, d: any, isAdd: boolean): Promise<void> {
  const has = (k: string) => isAdd || d[k] !== undefined;
  if (has('itemName')) {
    d.itemName = String(d.itemName ?? '').trim().replace(/\s+/g, ' ');
    if (!d.itemName) throw new AppError('NAME_REQUIRED', 'Item name is required', 400);
    if (/^[\d\s.,-]+$/.test(d.itemName)) throw new AppError('BAD_NAME', 'An item name needs letters, not just numbers.', 400);
    if (d.itemName.length > 200) throw new AppError('BAD_NAME', 'The item name is too long.', 400);
  }
  if (typeof d.itemCode === 'string') d.itemCode = d.itemCode.trim();
  if (has('unit')) {
    d.unit = String(d.unit ?? '').trim();
    if (!d.unit) throw new AppError('UNIT_REQUIRED', 'Choose the unit the item is counted in.', 400);
  }
  for (const [k, label] of [['reorderThreshold', 'The low-stock threshold'], ['minWholesaleQty', 'The minimum wholesale quantity']] as const) {
    if (d[k] === undefined || d[k] === null || d[k] === '') continue;
    const n = Number(d[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw new AppError('BAD_NUMBER', `${label} must be a number of 0 or more.`, 400);
    d[k] = n;
  }
  if (d.discountOnSalePrice !== undefined && d.discountOnSalePrice !== null && d.discountOnSalePrice !== '') {
    const n = Number(d.discountOnSalePrice);
    if (!Number.isFinite(n) || n < 0) throw new AppError('BAD_DISCOUNT', 'The standard discount must be 0 or more.', 400);
    const type = d.discountType ?? null;
    if ((type || '%') === '%' && n > 100) throw new AppError('BAD_DISCOUNT', 'A % discount cannot exceed 100%.', 400);
    const sale = Number(d.salePrice);
    if ((type || '%') !== '%' && Number.isFinite(sale) && n > sale) throw new AppError('BAD_DISCOUNT', 'The ₹ discount cannot exceed the sale price.', 400);
    d.discountOnSalePrice = n;
  }
  const vendorIds = [d.vendorId, ...(Array.isArray(d.vendors) ? d.vendors.map((v: any) => v?.vendorId) : [])].filter((v) => typeof v === 'string' && v);
  if (vendorIds.length) {
    const found = await tx.vendor.findMany({ where: { id: { in: vendorIds } }, select: { id: true } });
    const known = new Set(found.map((v: any) => v.id));
    const missing = vendorIds.find((v: string) => !known.has(v));
    if (missing) throw new AppError('BAD_VENDOR', 'A supplier on this item does not exist.', 400);
  }
}

/** Create a catalog item + initialize per-branch stock rows (atomic). */
export function addItem(itemData: any, initialStocks: Record<string, number> = {}, initialLocations: Record<string, string> = {}, reqUser?: any) {
  // A branch-locked user can only set opening stock for their own branch (INV4-5).
  for (const b of BRANCHES) {
    if ((initialStocks[b.id] ?? 0) > 0) assertBranchAllowed(reqUser, b.id);
  }
  // INV9-5: serializable + retry, so two adds of the same name at once can't
  // both pass the uniqueness check.
  return serializableTx(async (tx: any) => {
    const ts = nowIso();
    const id = itemData.id || `item-${Date.now()}`;

    // Server-side validation (VAL-1) — never trust the client.
    await assertItemFields(tx, itemData, true);
    const name = (itemData.itemName || '').trim();
    if (!name) throw new AppError('NAME_REQUIRED', 'Item name is required', 400);
    const gst = Number(itemData.gstTaxSlab);
    if (!Number.isFinite(gst) || gst < 0 || gst > 100) throw new AppError('BAD_GST', 'GST rate must be between 0 and 100', 400);
    if (Number(itemData.salePrice) < 0 || Number(itemData.purchasePrice) < 0 || Number(itemData.wholesalePrice) < 0) {
      throw new AppError('BAD_PRICE', 'Prices cannot be negative', 400);
    }
    // INV-10: HSN is required (a blank one was silently stored as 85371000).
    const hsn = String(itemData.itemHSN ?? '').trim();
    if (!hsn) throw new AppError('HSN_REQUIRED', 'HSN code is required (4, 6 or 8 digits).', 400);
    if (!HSN_RE.test(hsn)) throw new AppError('BAD_HSN', 'HSN must be 4, 6, or 8 digits', 400);
    itemData.itemHSN = hsn;
    // Case-insensitive item-code uniqueness on the server (INV-2).
    const code = (itemData.itemCode || '').trim();
    if (code) {
      const all = await tx.item.findMany();
      if (all.some((i: any) => (i.itemCode || '').trim().toLowerCase() === code.toLowerCase())) {
        throw new AppError('DUP_CODE', `Item code "${code}" already exists`, 409);
      }
    }
    // INV-2: item names are unique too (case- and space-insensitive).
    const sameName = await tx.item.findMany({ select: { id: true, itemName: true } });
    if (sameName.some((i: any) => nameKey(i.itemName) === nameKey(name))) {
      throw new AppError('DUP_NAME', `An item named "${name}" already exists`, 409);
    }
    for (const k of ARCHIVE_FIELDS) delete itemData[k];
    // Opening stock: a real number of 0 or more, whole for whole-unit items (INV-23).
    for (const b of BRANCHES) {
      if (initialStocks[b.id] === undefined || initialStocks[b.id] === null) continue;
      const q = stockQty(initialStocks[b.id], itemData.unit, `Opening stock at ${b.name}`);
      if (q < 0) throw new AppError('BAD_STOCK', 'Opening stock cannot be negative', 400);
      initialStocks[b.id] = q;
    }

    const item = await tx.item.create({ data: { ...itemData, id, createdAt: ts, updatedAt: ts } });
    await tx.branchStock.createMany({
      data: BRANCHES.map((b) => ({
        itemId: id, branchId: b.id, quantity: initialStocks[b.id] ?? 0,
        location: (initialLocations[b.id] || '').trim(), minStockAlert: 5, updatedAt: ts,
      })),
    });
    // Opening stock must appear in the movement ledger, or the stock history can
    // never reconcile to actual stock (INV2-4 / STK-3).
    const openingLogs = BRANCHES
      .filter((b) => (initialStocks[b.id] ?? 0) > 0)
      .map((b) => ({
        id: rid('adj'), itemId: id, itemName: name, itemCode: code, branchId: b.id,
        previousQuantity: 0, quantityChange: initialStocks[b.id], newQuantity: initialStocks[b.id],
        reason: 'Opening Stock', notes: 'Opening balance on item creation',
        adjustedBy: (reqUser?.name) || 'System', timestamp: ts,
      }));
    if (openingLogs.length) await tx.stockAdjustmentLog.createMany({ data: openingLogs });
    return { item, items: await tx.item.findMany(), branchStocks: await tx.branchStock.findMany() };
  });
}

/**
 * Update a catalog item's master fields. A dedicated route (not the generic
 * PUT /:id that CRUD-1 removed): it validates the same rules as add and only
 * lets master fields change. Fixes the Edit Item regression from CRUD-1.
 */
export function updateItem(itemId: string, updates: any) {
  return serializableTx(async (tx: any) => {
    const existing = await tx.item.findUnique({ where: { id: itemId } });
    if (!existing) throw new AppError('NOT_FOUND', 'Item not found', 404);
    await assertItemFields(tx, { salePrice: existing.salePrice, discountType: existing.discountType, ...updates }, false);
    // INV4-6: the cleaned (trimmed) values are what is saved.
    if (typeof updates.itemName === 'string') updates.itemName = updates.itemName.trim().replace(/\s+/g, ' ');
    if (typeof updates.unit === 'string') updates.unit = updates.unit.trim();
    if (typeof updates.itemCode === 'string') updates.itemCode = updates.itemCode.trim();

    // Validate only the fields actually being changed (VAL-1 parity with add).
    if (updates.itemName != null && !String(updates.itemName).trim()) {
      throw new AppError('NAME_REQUIRED', 'Item name is required', 400);
    }
    if (updates.gstTaxSlab != null) {
      const gst = Number(updates.gstTaxSlab);
      if (!Number.isFinite(gst) || gst < 0 || gst > 100) throw new AppError('BAD_GST', 'GST rate must be between 0 and 100', 400);
    }
    for (const f of ['salePrice', 'purchasePrice', 'wholesalePrice'] as const) {
      if (updates[f] != null && Number(updates[f]) < 0) throw new AppError('BAD_PRICE', 'Prices cannot be negative', 400);
    }
    if (updates.itemHSN !== undefined) {
      // INV-10: HSN can be corrected but never blanked.
      const hsn = String(updates.itemHSN ?? '').trim();
      if (!hsn) throw new AppError('HSN_REQUIRED', 'HSN code is required (4, 6 or 8 digits).', 400);
      if (!HSN_RE.test(hsn)) throw new AppError('BAD_HSN', 'HSN must be 4, 6, or 8 digits', 400);
      updates.itemHSN = hsn;
    }
    if (updates.itemName != null) {
      const all = await tx.item.findMany({ select: { id: true, itemName: true } });
      if (all.some((i: any) => i.id !== itemId && nameKey(i.itemName) === nameKey(updates.itemName))) {
        throw new AppError('DUP_NAME', `An item named "${String(updates.itemName).trim()}" already exists`, 409);
      }
    }
    if (updates.itemCode != null) {
      const code = String(updates.itemCode).trim();
      if (!code) throw new AppError('CODE_REQUIRED', 'Item code is required', 400);
      const all = await tx.item.findMany();
      if (all.some((i: any) => i.id !== itemId && (i.itemCode || '').trim().toLowerCase() === code.toLowerCase())) {
        throw new AppError('DUP_CODE', `Item code "${code}" already exists`, 409);
      }
    }

    // Never let id/createdAt (or the archive state) be overwritten from the client.
    const { id: _id, createdAt: _c, ...data } = updates;
    for (const k of ARCHIVE_FIELDS) delete (data as any)[k];
    await tx.item.update({ where: { id: itemId }, data: { ...data, updatedAt: nowIso() } });
    return { items: await tx.item.findMany(), branchStocks: await tx.branchStock.findMany() };
  });
}

/** Delete an item that was never used. An item with any stock history is kept
 *  (archive it instead) so its ledger is never erased (INV5-7). */
export function deleteItem(itemId: string) {
  return prisma.$transaction(async (tx: any) => {
    // Block deleting an item that is still in use — deleting one with stock, in a
    // combo, or on a purchase order/invoice erased its history and created ghost
    // stock when its PO was later received (INV-5). Archive instead of delete.
    const [stocks, combos, pos, invoices, transfers] = await Promise.all([
      tx.branchStock.findMany({ where: { itemId } }),
      tx.comboItem.findMany(),
      tx.purchaseOrder.findMany(),
      tx.invoice.findMany(),
      tx.stockTransfer.findMany(),
    ]);
    const hasStock = stocks.some((s: any) => (s.quantity || 0) > 0);
    const inCombo = combos.some((c: any) => Array.isArray(c.components) && c.components.some((comp: any) => comp.itemId === itemId));
    const inPo = pos.some((p: any) => p.status !== 'Cancelled' && Array.isArray(p.items) && p.items.some((li: any) => li.itemId === itemId));
    const inInvoice = invoices.some((inv: any) => Array.isArray(inv.items) && inv.items.some((li: any) => li.itemId === itemId));
    // Units dispatched on a transfer but not yet received are "in transit" (the
    // item is inside the transfer's `items` JSON) — must not be deleted (INV-5).
    const inTransit = transfers.some(
      (t: any) =>
        String(t.status || '').toLowerCase() !== 'received' &&
        Array.isArray(t.items) && t.items.some((li: any) => li.itemId === itemId),
    );
    // INV5-7: deleting used to erase the item's stock history with it. Any
    // history row means the item was used — keep it and archive instead.
    const historyRows = await tx.stockAdjustmentLog.count({ where: { itemId } });
    if (hasStock || inCombo || inPo || inInvoice || inTransit || historyRows > 0) {
      throw new AppError('ITEM_IN_USE', 'Cannot delete: this item has stock history or is used in a combo, purchase order, or sale. Archive it instead.', 409);
    }
    await tx.branchStock.deleteMany({ where: { itemId } });
    await tx.item.deleteMany({ where: { id: itemId } });
    return {
      items: await tx.item.findMany(),
      branchStocks: await tx.branchStock.findMany(),
      stockAdjustmentLogs: await tx.stockAdjustmentLog.findMany(),
    };
  });
}

/**
 * Archive (or restore) an item — the alternative to deleting a used item
 * (INV5-7 / INV-5). An archived item keeps its stock history and old bills, but
 * is hidden from the sale and purchase pickers and the default item lists. It
 * must hold no stock (none on hand, none in transit) and sit on no open PO or
 * combo, or those would keep moving stock of an item nobody can see.
 */
export function archiveItem(itemId: string, archive: boolean, actor: string) {
  return prisma.$transaction(async (tx: any) => {
    const item = await tx.item.findUnique({ where: { id: itemId } });
    if (!item) throw new AppError('NOT_FOUND', 'Item not found', 404);
    if (archive) {
      const [stocks, transfers, pos, combos] = await Promise.all([
        tx.branchStock.findMany({ where: { itemId } }),
        tx.stockTransfer.findMany({ where: { status: 'in_transit' } }),
        tx.purchaseOrder.findMany({ where: { status: { notIn: ['Received', 'Cancelled'] } } }),
        tx.comboItem.findMany(),
      ]);
      if (stocks.some((s: any) => (s.quantity || 0) > 0)) {
        throw new AppError('ITEM_HAS_STOCK', 'This item still has stock. Sell, transfer or adjust it to zero before archiving.', 409);
      }
      if (transfers.some((t: any) => Array.isArray(t.items) && t.items.some((li: any) => li.itemId === itemId))) {
        throw new AppError('ITEM_IN_TRANSIT', 'This item is on a transfer that has not been received yet.', 409);
      }
      if (pos.some((p: any) => Array.isArray(p.items) && p.items.some((li: any) => li.itemId === itemId))) {
        throw new AppError('ITEM_ON_OPEN_PO', 'This item is on an open purchase order. Receive or cancel it first.', 409);
      }
      const combo = combos.find((c: any) => Array.isArray(c.components) && c.components.some((comp: any) => comp.itemId === itemId));
      if (combo) throw new AppError('ITEM_IN_COMBO', `This item is part of the combo "${combo.comboName}". Remove it from the combo first.`, 409);
    }
    await tx.item.update({
      where: { id: itemId },
      data: archive
        ? { isArchived: true, archivedAt: nowIso(), archivedBy: actor, updatedAt: nowIso() }
        : { isArchived: null, archivedAt: null, archivedBy: null, updatedAt: nowIso() },
    });
    return { items: await tx.item.findMany(), branchStocks: await tx.branchStock.findMany() };
  });
}
