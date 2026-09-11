import { prisma } from '../db.js';
import { nowIso } from '../lib/stockLedger.js';
import { BRANCHES } from '../lib/constants.js';

/** Create a catalog item + initialize per-branch stock rows (atomic). */
export function addItem(itemData: any, initialStocks: Record<string, number> = {}, initialLocations: Record<string, string> = {}) {
  return prisma.$transaction(async (tx: any) => {
    const ts = nowIso();
    const id = itemData.id || `item-${Date.now()}`;
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
