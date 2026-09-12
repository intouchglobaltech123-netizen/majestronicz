import { AppError } from '../middleware/errorHandler.js';
import { nowIso, rid } from '../lib/stockLedger.js';
import { branchName, branchLocation } from '../lib/constants.js';
import { serializableTx } from '../lib/tx.js';

const stockSnapshot = async (tx: any) => ({
  branchStocks: await tx.branchStock.findMany(),
  stockAdjustmentLogs: await tx.stockAdjustmentLog.findMany(),
  challans: await tx.deliveryChallan.findMany(),
  stockTransfers: await tx.stockTransfer.findMany(),
});

// Collision-free DC-TRF-### under the unique challan constraint.
async function nextTransferChallanNo(tx: any): Promise<string> {
  const existing = await tx.deliveryChallan.findMany({
    where: { challanNumber: { startsWith: 'DC-TRF-' } },
    select: { challanNumber: true },
  });
  let max = 0;
  for (const c of existing) {
    const v = parseInt(c.challanNumber.replace('DC-TRF-', ''), 10);
    if (!isNaN(v)) max = Math.max(max, v);
  }
  return `DC-TRF-${String(max + 1).padStart(3, '0')}`;
}

/**
 * Multi-item inter-branch transfer (batch): validates every line against source
 * stock, moves all items atomically, writes paired audit logs per item, records
 * one StockTransfer batch, and optionally generates one delivery challan.
 */
export function transferStockBatch(
  itemsToTransfer: { itemId: string; quantity: number }[],
  fromBranch: string,
  toBranch: string,
  notes: string | undefined,
  autoGenerateChallan: boolean,
  actor: string
) {
  if (fromBranch === toBranch) throw new AppError('SAME_BRANCH', 'Source and destination cannot be the same');
  if (!itemsToTransfer?.length) throw new AppError('NO_ITEMS', 'At least one item must be included');

  return serializableTx(async (tx: any) => {
    const ts = nowIso();
    const validated: { item: any; quantity: number; fromPrevQty: number; toPrevQty: number }[] = [];

    for (const row of itemsToTransfer) {
      if (!row.itemId || row.quantity <= 0) throw new AppError('BAD_LINE', 'Each line needs an item and quantity > 0');
      const item = await tx.item.findUnique({ where: { id: row.itemId } });
      if (!item) throw new AppError('NOT_FOUND', `Item not found: ${row.itemId}`, 404);
      const fromRow = await tx.branchStock.findUnique({ where: { itemId_branchId: { itemId: row.itemId, branchId: fromBranch } } });
      const fromPrevQty = fromRow?.quantity ?? 0;
      if (fromPrevQty < row.quantity) {
        throw new AppError('INSUFFICIENT_STOCK', `Insufficient stock for ${item.itemName} at ${branchName(fromBranch)} (have ${fromPrevQty}, need ${row.quantity})`, 409);
      }
      const toRow = await tx.branchStock.findUnique({ where: { itemId_branchId: { itemId: row.itemId, branchId: toBranch } } });
      validated.push({ item, quantity: row.quantity, fromPrevQty, toPrevQty: toRow?.quantity ?? 0 });
    }

    // Move stock
    for (const v of validated) {
      await tx.branchStock.upsert({
        where: { itemId_branchId: { itemId: v.item.id, branchId: fromBranch } },
        create: { itemId: v.item.id, branchId: fromBranch, quantity: 0, minStockAlert: v.item.reorderThreshold ?? 10, updatedAt: ts },
        update: { quantity: Math.max(0, v.fromPrevQty - v.quantity), updatedAt: ts },
      });
      await tx.branchStock.upsert({
        where: { itemId_branchId: { itemId: v.item.id, branchId: toBranch } },
        create: { itemId: v.item.id, branchId: toBranch, quantity: v.quantity, minStockAlert: v.item.reorderThreshold ?? 10, updatedAt: ts },
        update: { quantity: v.toPrevQty + v.quantity, updatedAt: ts },
      });
    }

    const transferRef = `TRF-${Date.now().toString(36).toUpperCase()}`;
    const todayStr = ts.split('T')[0];
    const timeStr = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    let generatedChallanNo: string | undefined;

    if (autoGenerateChallan) {
      generatedChallanNo = await nextTransferChallanNo(tx);
      await tx.deliveryChallan.create({
        data: {
          id: `dc-${Date.now()}`, challanNumber: generatedChallanNo,
          recipientName: `Majestronicz ${branchName(toBranch)}`, location: branchLocation(toBranch),
          contactNo: '94433-28955', date: todayStr, time: timeStr,
          items: validated.map((v, i) => ({ id: `dci-${Date.now()}-${i + 1}`, itemId: v.item.id, itemName: v.item.itemName, itemHSN: v.item.itemHSN, quantity: v.quantity, unit: v.item.unit })),
          totalQuantity: validated.reduce((s, v) => s + v.quantity, 0),
          termsAndConditions: 'Goods dispatched for internal inter-branch transit and stock replenishment. Strictly not for commercial sale.',
          deliveredBy: { name: `${branchName(fromBranch)} Dispatch / ${actor}`, comment: `Stock transit dispatched by ${actor}`, date: todayStr },
          receivedBy: { name: `${branchName(toBranch)} Inventory Store`, comment: 'Awaiting physical transit arrival and intake verification', date: todayStr },
          createdAt: ts,
        },
      });
    }

    await tx.stockTransfer.create({
      data: {
        id: `trf-${Date.now()}`, transferNumber: transferRef, fromBranch, toBranch,
        items: validated.map((v) => ({ itemId: v.item.id, itemName: v.item.itemName, itemCode: v.item.itemCode, itemHSN: v.item.itemHSN, quantity: v.quantity, unit: v.item.unit })),
        totalQuantity: validated.reduce((s, v) => s + v.quantity, 0),
        notes: notes?.trim() || null, transferredBy: actor, timestamp: ts, challanNumber: generatedChallanNo ?? null,
      },
    });

    const logs: any[] = [];
    validated.forEach((v, i) => {
      logs.push({
        id: `${rid('adj')}-${i}-out`, itemId: v.item.id, itemName: v.item.itemName, itemCode: v.item.itemCode, branchId: fromBranch,
        previousQuantity: v.fromPrevQty, quantityChange: -v.quantity, newQuantity: v.fromPrevQty - v.quantity,
        reason: 'Inter-branch Transfer', notes: `Transferred to ${branchName(toBranch)}${notes ? ` • ${notes}` : ''}`,
        adjustedBy: actor, timestamp: ts, transferRef, linkedChallanNumber: generatedChallanNo ?? null,
      });
      logs.push({
        id: `${rid('adj')}-${i}-in`, itemId: v.item.id, itemName: v.item.itemName, itemCode: v.item.itemCode, branchId: toBranch,
        previousQuantity: v.toPrevQty, quantityChange: v.quantity, newQuantity: v.toPrevQty + v.quantity,
        reason: 'Inter-branch Transfer', notes: `Received from ${branchName(fromBranch)}${notes ? ` • ${notes}` : ''}`,
        adjustedBy: actor, timestamp: ts, transferRef, linkedChallanNumber: generatedChallanNo ?? null,
      });
    });
    await tx.stockAdjustmentLog.createMany({ data: logs });

    return { ...(await stockSnapshot(tx)), transferRef, challanNumber: generatedChallanNo };
  });
}

/** Manual stock adjustment + immutable audit log (atomic). */
export function adjustStock(
  itemId: string,
  branchId: string,
  quantityChange: number,
  reason: string,
  notes: string | undefined,
  actor: string
) {
  return serializableTx(async (tx: any) => {
    const item = await tx.item.findUnique({ where: { id: itemId } });
    if (!item) throw new AppError('NOT_FOUND', 'Item not found', 404);

    const ts = nowIso();
    const existing = await tx.branchStock.findUnique({
      where: { itemId_branchId: { itemId, branchId } },
    });
    const prevQty = existing?.quantity ?? 0;
    const newQty = Math.max(0, prevQty + quantityChange);

    await tx.branchStock.upsert({
      where: { itemId_branchId: { itemId, branchId } },
      create: { itemId, branchId, quantity: newQty, minStockAlert: item.reorderThreshold ?? 10, updatedAt: ts },
      update: { quantity: newQty, updatedAt: ts },
    });

    await tx.stockAdjustmentLog.create({
      data: {
        id: rid('adj'), itemId, itemName: item.itemName, itemCode: item.itemCode, branchId,
        previousQuantity: prevQty, quantityChange, newQuantity: newQty, reason,
        notes: notes?.trim() || null, adjustedBy: actor, timestamp: ts,
      },
    });
    return stockSnapshot(tx);
  });
}

/** Atomic inter-branch transfer with paired audit logs + optional delivery challan. */
export function transferStock(
  itemId: string,
  fromBranch: string,
  toBranch: string,
  quantity: number,
  notes: string | undefined,
  autoGenerateChallan: boolean,
  actor: string
) {
  if (fromBranch === toBranch) throw new AppError('SAME_BRANCH', 'Source and destination cannot be the same');
  if (quantity <= 0) throw new AppError('BAD_QTY', 'Transfer quantity must be greater than 0');

  return serializableTx(async (tx: any) => {
    const item = await tx.item.findUnique({ where: { id: itemId } });
    if (!item) throw new AppError('NOT_FOUND', 'Item not found', 404);

    const fromRow = await tx.branchStock.findUnique({ where: { itemId_branchId: { itemId, branchId: fromBranch } } });
    const fromPrevQty = fromRow?.quantity ?? 0;
    if (fromPrevQty < quantity) throw new AppError('INSUFFICIENT_STOCK', `Insufficient stock in ${branchName(fromBranch)}`, 409);

    const toRow = await tx.branchStock.findUnique({ where: { itemId_branchId: { itemId, branchId: toBranch } } });
    const toPrevQty = toRow?.quantity ?? 0;
    const ts = nowIso();
    const transferRef = `TRF-${Date.now().toString(36).toUpperCase()}`;

    await tx.branchStock.upsert({
      where: { itemId_branchId: { itemId, branchId: fromBranch } },
      create: { itemId, branchId: fromBranch, quantity: 0, minStockAlert: item.reorderThreshold ?? 10, updatedAt: ts },
      update: { quantity: Math.max(0, fromPrevQty - quantity), updatedAt: ts },
    });
    await tx.branchStock.upsert({
      where: { itemId_branchId: { itemId, branchId: toBranch } },
      create: { itemId, branchId: toBranch, quantity, minStockAlert: item.reorderThreshold ?? 10, updatedAt: ts },
      update: { quantity: toPrevQty + quantity, updatedAt: ts },
    });

    const todayStr = ts.split('T')[0];
    const timeStr = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    let generatedChallanNo: string | undefined;

    if (autoGenerateChallan) {
      // Collision-free DC-TRF-### under the unique constraint.
      const existing = await tx.deliveryChallan.findMany({
        where: { challanNumber: { startsWith: 'DC-TRF-' } },
        select: { challanNumber: true },
      });
      let max = 0;
      for (const c of existing) {
        const v = parseInt(c.challanNumber.replace('DC-TRF-', ''), 10);
        if (!isNaN(v)) max = Math.max(max, v);
      }
      generatedChallanNo = `DC-TRF-${String(max + 1).padStart(3, '0')}`;
      await tx.deliveryChallan.create({
        data: {
          id: `dc-${Date.now()}`, challanNumber: generatedChallanNo,
          recipientName: `Majestronicz ${branchName(toBranch)}`, location: branchLocation(toBranch),
          contactNo: '94433-28955', date: todayStr, time: timeStr,
          items: [{ id: `dci-${Date.now()}-1`, itemId: item.id, itemName: item.itemName, itemHSN: item.itemHSN, quantity, unit: item.unit }],
          totalQuantity: quantity,
          termsAndConditions: 'Goods dispatched for internal inter-branch transit and stock replenishment. Strictly not for commercial sale.',
          deliveredBy: { name: `${branchName(fromBranch)} Dispatch / ${actor}`, comment: `Stock transit dispatched by ${actor}`, date: todayStr },
          receivedBy: { name: `${branchName(toBranch)} Inventory Store`, comment: 'Awaiting physical transit arrival and intake verification', date: todayStr },
          createdAt: ts,
        },
      });
    }

    await tx.stockAdjustmentLog.createMany({
      data: [
        {
          id: rid('adj') + '-out', itemId, itemName: item.itemName, itemCode: item.itemCode, branchId: fromBranch,
          previousQuantity: fromPrevQty, quantityChange: -quantity, newQuantity: fromPrevQty - quantity,
          reason: 'Inter-branch Transfer', notes: `Transferred to ${branchName(toBranch)}${notes ? ` • ${notes}` : ''}`,
          adjustedBy: actor, timestamp: ts, transferRef, linkedChallanNumber: generatedChallanNo ?? null,
        },
        {
          id: rid('adj') + '-in', itemId, itemName: item.itemName, itemCode: item.itemCode, branchId: toBranch,
          previousQuantity: toPrevQty, quantityChange: quantity, newQuantity: toPrevQty + quantity,
          reason: 'Inter-branch Transfer', notes: `Received from ${branchName(fromBranch)}${notes ? ` • ${notes}` : ''}`,
          adjustedBy: actor, timestamp: ts, transferRef, linkedChallanNumber: generatedChallanNo ?? null,
        },
      ],
    });

    return { ...(await stockSnapshot(tx)), transferRef, challanNumber: generatedChallanNo };
  });
}

/** Direct stock set (Item Master / stock modal). */
export function updateBranchStock(itemId: string, branchId: string, quantity: number, minStockAlert?: number, location?: string) {
  return serializableTx(async (tx: any) => {
    const ts = nowIso();
    await tx.branchStock.upsert({
      where: { itemId_branchId: { itemId, branchId } },
      create: { itemId, branchId, quantity, minStockAlert: minStockAlert ?? 5, location: location?.trim() ?? '', updatedAt: ts },
      update: {
        quantity,
        ...(minStockAlert !== undefined ? { minStockAlert } : {}),
        ...(location !== undefined ? { location: location.trim() } : {}),
        updatedAt: ts,
      },
    });
    return { branchStocks: await tx.branchStock.findMany() };
  });
}

export function updateBranchStockLocation(itemId: string, branchId: string, location?: string) {
  return serializableTx(async (tx: any) => {
    const ts = nowIso();
    const trimmed = location?.trim() || null;
    await tx.branchStock.upsert({
      where: { itemId_branchId: { itemId, branchId } },
      create: { itemId, branchId, quantity: 0, minStockAlert: 5, location: trimmed, updatedAt: ts },
      update: { location: trimmed, updatedAt: ts },
    });
    return { branchStocks: await tx.branchStock.findMany() };
  });
}
