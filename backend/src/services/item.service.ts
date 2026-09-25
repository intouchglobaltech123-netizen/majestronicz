import { prisma } from '../db.js';
import { nowIso } from '../lib/stockLedger.js';
import { BRANCHES } from '../lib/constants.js';
import { AppError } from '../middleware/errorHandler.js';

/** Create a catalog item + initialize per-branch stock rows (atomic). */
export function addItem(itemData: any, initialStocks: Record<string, number> = {}, initialLocations: Record<string, string> = {}) {
  return prisma.$transaction(async (tx: any) => {
    const ts = nowIso();
    const id = itemData.id || `item-${Date.now()}`;

    // Server-side validation (VAL-1) — never trust the client.
    const name = (itemData.itemName || '').trim();
    if (!name) throw new AppError('NAME_REQUIRED', 'Item name is required', 400);
    const gst = Number(itemData.gstTaxSlab);
    if (!Number.isFinite(gst) || gst < 0 || gst > 100) throw new AppError('BAD_GST', 'GST rate must be between 0 and 100', 400);
    if (Number(itemData.salePrice) < 0 || Number(itemData.purchasePrice) < 0 || Number(itemData.wholesalePrice) < 0) {
      throw new AppError('BAD_PRICE', 'Prices cannot be negative', 400);
    }
    const hsn = (itemData.itemHSN || '').trim();
    if (hsn && !/^\d{4}(\d{2}(\d{2})?)?$/.test(hsn)) throw new AppError('BAD_HSN', 'HSN must be 4, 6, or 8 digits', 400);
    // Case-insensitive item-code uniqueness on the server (INV-2).
    const code = (itemData.itemCode || '').trim();
    if (code) {
      const all = await tx.item.findMany();
      if (all.some((i: any) => (i.itemCode || '').trim().toLowerCase() === code.toLowerCase())) {
        throw new AppError('DUP_CODE', `Item code "${code}" already exists`, 409);
      }
    }
    // Opening stock can't be negative.
    for (const b of BRANCHES) {
      if ((initialStocks[b.id] ?? 0) < 0) throw new AppError('BAD_STOCK', 'Opening stock cannot be negative', 400);
    }

    const item = await tx.item.create({ data: { ...itemData, id, createdAt: ts, updatedAt: ts } });
    await tx.branchStock.createMany({
      data: BRANCHES.map((b) => ({
        itemId: id, branchId: b.id, quantity: initialStocks[b.id] ?? 0,
        location: (initialLocations[b.id] || '').trim(), minStockAlert: 5, updatedAt: ts,
      })),
    });
    return { item, items: await tx.item.findMany(), branchStocks: await tx.branchStock.findMany() };
  });
}

/** Delete an item and cascade its branch stock + adjustment logs. */
export function deleteItem(itemId: string) {
  return prisma.$transaction(async (tx: any) => {
    // Block deleting an item that is still in use — deleting one with stock, in a
    // combo, or on a purchase order/invoice erased its history and created ghost
    // stock when its PO was later received (INV-5). Archive instead of delete.
    const [stocks, combos, pos, invoices] = await Promise.all([
      tx.branchStock.findMany({ where: { itemId } }),
      tx.comboItem.findMany(),
      tx.purchaseOrder.findMany(),
      tx.invoice.findMany(),
    ]);
    const hasStock = stocks.some((s: any) => (s.quantity || 0) > 0);
    const inCombo = combos.some((c: any) => Array.isArray(c.components) && c.components.some((comp: any) => comp.itemId === itemId));
    const inPo = pos.some((p: any) => p.status !== 'Cancelled' && Array.isArray(p.items) && p.items.some((li: any) => li.itemId === itemId));
    const inInvoice = invoices.some((inv: any) => Array.isArray(inv.items) && inv.items.some((li: any) => li.itemId === itemId));
    if (hasStock || inCombo || inPo || inInvoice) {
      throw new AppError('ITEM_IN_USE', 'Cannot delete: this item has stock or is used in a combo, purchase order, or sale. Archive it instead.', 409);
    }
    await tx.branchStock.deleteMany({ where: { itemId } });
    await tx.stockAdjustmentLog.deleteMany({ where: { itemId } });
    await tx.item.deleteMany({ where: { id: itemId } });
    return {
      items: await tx.item.findMany(),
      branchStocks: await tx.branchStock.findMany(),
      stockAdjustmentLogs: await tx.stockAdjustmentLog.findMany(),
    };
  });
}
