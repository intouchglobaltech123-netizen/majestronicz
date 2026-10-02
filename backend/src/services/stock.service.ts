import { AppError } from '../middleware/errorHandler.js';
import { istToday, istTime } from '../lib/businessDate.js';
import { nowIso, rid } from '../lib/stockLedger.js';
import { branchName, branchLocation, isValidBranch } from '../lib/constants.js';
import { serializableTx } from '../lib/tx.js';
import { assertBranchAllowed } from '../lib/branchGuard.js';
import { stockQty } from '../lib/units.js';
import { archivedItemError } from '../lib/lineValidation.js';
import { nextPersistent } from '../lib/sequences.js';

/** SAL10-1: the stock history rows this write added (stamped `ts`), not the
 *  whole history table; the screens merge them (`delta`). */
const stockSnapshot = async (tx: any, ts: string) => ({
  delta: true,
  branchStocks: await tx.branchStock.findMany(),
  stockAdjustmentLogs: await tx.stockAdjustmentLog.findMany({ where: { timestamp: ts } }),
  challans: await tx.deliveryChallan.findMany(),
  stockTransfers: await tx.stockTransfer.findMany(),
});

/** A delivery challan generated for an inter-branch stock transfer. */
export const isTransferChallan = (ch: { challanNumber?: string | null }): boolean => /^DC-TRF-/i.test(String(ch?.challanNumber || ''));

// Collision-free DC-TRF-### under the unique challan constraint. The persistent
// high-water mark means a number is never reissued after the newest challan is
// deleted — two transfers shared DC-TRF-005 (INV-3).
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
  const next = await nextPersistent(tx, 'seq:dc:DC-TRF-', max);
  return `DC-TRF-${String(next).padStart(3, '0')}`;
}

/** Mark a transfer's DC-TRF challan received with the IST date/time (INV8-5). */
async function markTransferChallanReceived(tx: any, transfer: any, actor: string, ts: string) {
  if (!transfer.challanNumber) return;
  const ch = await tx.deliveryChallan.findUnique({ where: { challanNumber: transfer.challanNumber } });
  if (!ch || ch.status === 'received') return;
  const prev = (ch.receivedBy as any) || {};
  await tx.deliveryChallan.update({
    where: { id: ch.id },
    data: {
      status: 'received',
      receivedAt: ts,
      receivedBy: {
        ...prev,
        name: `${branchName(transfer.toBranch)} Inventory Store / ${actor}`,
        comment: `Received at ${branchName(transfer.toBranch)} by ${actor}`,
        date: istToday(), time: istTime(),
      },
    },
  });
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
  if (!isValidBranch(fromBranch)) throw new AppError('BAD_BRANCH', `Unknown source branch: ${fromBranch}`, 400);
  if (!isValidBranch(toBranch)) throw new AppError('BAD_BRANCH', `Unknown destination branch: ${toBranch}`, 400);

  // Merge duplicate lines for the same item BEFORE validating stock. Two lines of
  // the same item were each checked against the full source stock independently, so
  // 15 + 15 from 20 in stock both passed and the destination gained 30 — creating
  // stock from nothing (INV2-2).
  const mergedMap = new Map<string, number>();
  for (const row of itemsToTransfer) {
    const q = typeof row?.quantity === 'number' ? row.quantity : Number(row?.quantity);
    if (!row?.itemId || !Number.isFinite(q) || q <= 0) throw new AppError('BAD_LINE', 'Each line needs an item and quantity > 0');
    mergedMap.set(row.itemId, (mergedMap.get(row.itemId) || 0) + q);
  }
  const mergedItems = Array.from(mergedMap.entries()).map(([itemId, quantity]) => ({ itemId, quantity }));

  return serializableTx(async (tx: any) => {
    const ts = nowIso();
    const validated: { item: any; quantity: number; fromPrevQty: number; toPrevQty: number }[] = [];

    for (const row of mergedItems) {
      if (!row.itemId || row.quantity <= 0) throw new AppError('BAD_LINE', 'Each line needs an item and quantity > 0');
      const item = await tx.item.findUnique({ where: { id: row.itemId } });
      if (!item) throw new AppError('NOT_FOUND', `Item not found: ${row.itemId}`, 404);
      if (item.isArchived) throw archivedItemError(item.itemName);
      // Whole units for whole-unit items, sane size (INV-23).
      row.quantity = stockQty(row.quantity, item.unit, `Transfer quantity for ${item.itemName}`);
      const fromRow = await tx.branchStock.findUnique({ where: { itemId_branchId: { itemId: row.itemId, branchId: fromBranch } } });
      const fromPrevQty = fromRow?.quantity ?? 0;
      if (fromPrevQty < row.quantity) {
        throw new AppError('INSUFFICIENT_STOCK', `Insufficient stock for ${item.itemName} at ${branchName(fromBranch)} (have ${fromPrevQty}, need ${row.quantity})`, 409);
      }
      const toRow = await tx.branchStock.findUnique({ where: { itemId_branchId: { itemId: row.itemId, branchId: toBranch } } });
      validated.push({ item, quantity: row.quantity, fromPrevQty, toPrevQty: toRow?.quantity ?? 0 });
    }

    // Dispatch: debit the source only. Destination stock is credited later, when
    // the receiving branch confirms intake via receiveStockTransfer (in-transit flow).
    for (const v of validated) {
      await tx.branchStock.upsert({
        where: { itemId_branchId: { itemId: v.item.id, branchId: fromBranch } },
        create: { itemId: v.item.id, branchId: fromBranch, quantity: 0, minStockAlert: v.item.reorderThreshold ?? 10, updatedAt: ts },
        update: { quantity: Math.max(0, v.fromPrevQty - v.quantity), updatedAt: ts },
      });
    }

    const transferRef = `TRF-${Date.now().toString(36).toUpperCase()}`;
    // Challan date/time in IST — the server clock is UTC (E2E8-10).
    const todayStr = istToday();
    const timeStr = istTime();
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
          status: 'pending',
          createdAt: ts,
        },
      });
    }

    const transferId = `trf-${Date.now()}`;
    await tx.stockTransfer.create({
      data: {
        id: transferId, transferNumber: transferRef, fromBranch, toBranch,
        items: validated.map((v) => ({ itemId: v.item.id, itemName: v.item.itemName, itemCode: v.item.itemCode, itemHSN: v.item.itemHSN, quantity: v.quantity, unit: v.item.unit })),
        totalQuantity: validated.reduce((s, v) => s + v.quantity, 0),
        notes: notes?.trim() || null, transferredBy: actor, timestamp: ts, challanNumber: generatedChallanNo ?? null,
        status: 'in_transit',
      },
    });

    // Only the dispatch ("out") log is written now; the receiving ("in") log is
    // created when the destination branch confirms receipt.
    const logs: any[] = [];
    validated.forEach((v, i) => {
      logs.push({
        id: `${rid('adj')}-${i}-out`, itemId: v.item.id, itemName: v.item.itemName, itemCode: v.item.itemCode, branchId: fromBranch,
        previousQuantity: v.fromPrevQty, quantityChange: -v.quantity, newQuantity: v.fromPrevQty - v.quantity,
        reason: 'Inter-branch Transfer', notes: `Dispatched to ${branchName(toBranch)} (in transit)${notes ? ` • ${notes}` : ''}`,
        adjustedBy: actor, timestamp: ts, transferRef, linkedChallanNumber: generatedChallanNo ?? null,
      });
    });
    await tx.stockAdjustmentLog.createMany({ data: logs });

    return { ...(await stockSnapshot(tx, ts)), transferRef, challanNumber: generatedChallanNo };
  });
}

/**
 * Confirm receipt of an in-transit transfer at the destination branch: credits
 * destination stock for every line, writes the paired "in" audit logs, and marks
 * the transfer received. Idempotent — a transfer already received is a no-op.
 */
export function receiveStockTransfer(transferId: string, actor: string, reqUser?: any) {
  return serializableTx(async (tx: any) => {
    const transfer = await tx.stockTransfer.findUnique({ where: { id: transferId } });
    if (!transfer) throw new AppError('NOT_FOUND', 'Transfer not found', 404);
    // Only the destination branch's staff (or CEO) may receive a transfer (SEC2-1).
    assertBranchAllowed(reqUser, transfer.toBranch);
    if (transfer.status === 'received') {
      // Older builds left the challan Pending after the receive — bring it in line.
      await markTransferChallanReceived(tx, transfer, transfer.receivedBy || actor, transfer.receivedAt || nowIso());
      return { ...(await stockSnapshot(tx, nowIso())), alreadyReceived: true };
    }

    const ts = nowIso();
    const lines: any[] = Array.isArray(transfer.items) ? transfer.items : [];
    const transferRef = transfer.transferNumber;
    const logs: any[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const item = await tx.item.findUnique({ where: { id: line.itemId } });
      // INV9-2: restore an archived item before its stock is taken in.
      if (item?.isArchived) throw archivedItemError(item.itemName);
      const toRow = await tx.branchStock.findUnique({ where: { itemId_branchId: { itemId: line.itemId, branchId: transfer.toBranch } } });
      const toPrevQty = toRow?.quantity ?? 0;
      await tx.branchStock.upsert({
        where: { itemId_branchId: { itemId: line.itemId, branchId: transfer.toBranch } },
        create: { itemId: line.itemId, branchId: transfer.toBranch, quantity: line.quantity, minStockAlert: item?.reorderThreshold ?? 10, updatedAt: ts },
        update: { quantity: toPrevQty + line.quantity, updatedAt: ts },
      });
      logs.push({
        id: `${rid('adj')}-${i}-in`, itemId: line.itemId, itemName: line.itemName, itemCode: line.itemCode, branchId: transfer.toBranch,
        previousQuantity: toPrevQty, quantityChange: line.quantity, newQuantity: toPrevQty + line.quantity,
        reason: 'Inter-branch Transfer', notes: `Received from ${branchName(transfer.fromBranch)}`,
        adjustedBy: actor, timestamp: ts, transferRef, linkedChallanNumber: transfer.challanNumber ?? null,
      });
    }
    if (logs.length) await tx.stockAdjustmentLog.createMany({ data: logs });

    await tx.stockTransfer.update({
      where: { id: transferId },
      data: { status: 'received', receivedAt: ts, receivedBy: actor },
    });
    await markTransferChallanReceived(tx, transfer, actor, ts);

    return { ...(await stockSnapshot(tx, ts)), received: true };
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
  if (!isValidBranch(branchId)) throw new AppError('BAD_BRANCH', `Unknown branch: ${branchId}`, 400);
  // The request body is untyped JSON, so quantityChange can arrive as the string
  // "5" — then `prevQty + "5"` concatenated (20 → "205") and quietly became 205
  // units of phantom stock. Coerce to a real number and reject anything else (INV8-4).
  // It must also be non-zero, whole for whole-unit items, within a sane bound,
  // and carry a reason (INV8-4 / INV-23).
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (!why) throw new AppError('REASON_REQUIRED', 'Choose a reason for the adjustment.', 400);
  if (why.length > 120) throw new AppError('BAD_REASON', 'The reason is too long.', 400);
  if (notes != null && typeof notes !== 'string') throw new AppError('BAD_NOTES', 'Notes must be text.', 400);
  return serializableTx(async (tx: any) => {
    const item = await tx.item.findUnique({ where: { id: itemId } });
    if (!item) throw new AppError('NOT_FOUND', 'Item not found', 404);
    // INV9-2: an archived item takes no new stock (it would vanish from screens).
    if (item.isArchived) throw archivedItemError(item.itemName);
    const change = stockQty(quantityChange, item.unit, 'Adjustment quantity');
    if (change === 0) throw new AppError('BAD_QTY', 'Adjustment quantity cannot be zero.', 400);

    const ts = nowIso();
    const existing = await tx.branchStock.findUnique({
      where: { itemId_branchId: { itemId, branchId } },
    });
    const prevQty = existing?.quantity ?? 0;
    const newQty = Math.max(0, prevQty + change);
    // Stock clamps at 0, so the change that REALLY happened is newQty − prevQty
    // (e.g. a −1000 request on 45 units actually moves −45). Log the real change,
    // not the requested one, or the ledger can't reconcile to actual stock (INV2-4).
    const appliedChange = Math.round((newQty - prevQty) * 100) / 100;

    await tx.branchStock.upsert({
      where: { itemId_branchId: { itemId, branchId } },
      create: { itemId, branchId, quantity: newQty, minStockAlert: item.reorderThreshold ?? 10, updatedAt: ts },
      update: { quantity: newQty, updatedAt: ts },
    });

    await tx.stockAdjustmentLog.create({
      data: {
        id: rid('adj'), itemId, itemName: item.itemName, itemCode: item.itemCode, branchId,
        previousQuantity: prevQty, quantityChange: appliedChange, newQuantity: newQty, reason: why,
        notes: notes?.trim() || null, adjustedBy: actor, timestamp: ts,
      },
    });
    return stockSnapshot(tx, ts);
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
  // Reject transfers to/from an unknown branch — otherwise the units leave the
  // source and land nowhere real, vanishing from the books (STK-6).
  if (!isValidBranch(fromBranch)) throw new AppError('BAD_BRANCH', `Unknown source branch: ${fromBranch}`, 400);
  if (!isValidBranch(toBranch)) throw new AppError('BAD_BRANCH', `Unknown destination branch: ${toBranch}`, 400);

  return serializableTx(async (tx: any) => {
    const item = await tx.item.findUnique({ where: { id: itemId } });
    if (!item) throw new AppError('NOT_FOUND', 'Item not found', 404);
    if (item.isArchived) throw archivedItemError(item.itemName);
    // A real number, whole for whole-unit items (INV-23).
    quantity = stockQty(quantity, item.unit, 'Transfer quantity');
    if (quantity <= 0) throw new AppError('BAD_QTY', 'Transfer quantity must be greater than 0', 400);

    const fromRow = await tx.branchStock.findUnique({ where: { itemId_branchId: { itemId, branchId: fromBranch } } });
    const fromPrevQty = fromRow?.quantity ?? 0;
    if (fromPrevQty < quantity) throw new AppError('INSUFFICIENT_STOCK', `Insufficient stock in ${branchName(fromBranch)}`, 409);

    const ts = nowIso();
    const transferRef = `TRF-${Date.now().toString(36).toUpperCase()}`;

    // Dispatch: debit source only. Destination is credited on Receive (in-transit flow).
    await tx.branchStock.upsert({
      where: { itemId_branchId: { itemId, branchId: fromBranch } },
      create: { itemId, branchId: fromBranch, quantity: 0, minStockAlert: item.reorderThreshold ?? 10, updatedAt: ts },
      update: { quantity: Math.max(0, fromPrevQty - quantity), updatedAt: ts },
    });

    // Challan date/time in IST — the server clock is UTC (E2E8-10).
    const todayStr = istToday();
    const timeStr = istTime();
    let generatedChallanNo: string | undefined;

    if (autoGenerateChallan) {
      generatedChallanNo = await nextTransferChallanNo(tx);
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
          status: 'pending',
          createdAt: ts,
        },
      });
    }

    // Record the in-transit transfer so it appears in history and can be received.
    await tx.stockTransfer.create({
      data: {
        id: `trf-${Date.now()}`, transferNumber: transferRef, fromBranch, toBranch,
        items: [{ itemId: item.id, itemName: item.itemName, itemCode: item.itemCode, itemHSN: item.itemHSN, quantity, unit: item.unit }],
        totalQuantity: quantity,
        notes: notes?.trim() || null, transferredBy: actor, timestamp: ts, challanNumber: generatedChallanNo ?? null,
        status: 'in_transit',
      },
    });

    // Only the dispatch ("out") log is written now; the "in" log lands on receipt.
    await tx.stockAdjustmentLog.create({
      data: {
        id: rid('adj') + '-out', itemId, itemName: item.itemName, itemCode: item.itemCode, branchId: fromBranch,
        previousQuantity: fromPrevQty, quantityChange: -quantity, newQuantity: fromPrevQty - quantity,
        reason: 'Inter-branch Transfer', notes: `Dispatched to ${branchName(toBranch)} (in transit)${notes ? ` • ${notes}` : ''}`,
        adjustedBy: actor, timestamp: ts, transferRef, linkedChallanNumber: generatedChallanNo ?? null,
      },
    });

    return { ...(await stockSnapshot(tx, ts)), transferRef, challanNumber: generatedChallanNo };
  });
}

// updateBranchStock() was REMOVED: it set a branch's stock to any value with no
// history row or quantity validation (−5, 2.5, …). It now validates the branch and
// quantity AND writes a stock-history row, so the ledger still reconciles (INV2-4).

/** Set a branch's stock to an exact quantity (Item Master / stock modal), with
 *  validation and a history row for the delta. */
export function updateBranchStock(itemId: string, branchId: string, quantity: number, minStockAlert?: number, location?: string, actor = 'System') {
  if (!isValidBranch(branchId)) throw new AppError('BAD_BRANCH', `Unknown branch: ${branchId}`, 400);
  // INV7-1: the low-stock threshold is a whole number of 0 or more.
  if (minStockAlert !== undefined && minStockAlert !== null) {
    const m = typeof minStockAlert === 'number' ? minStockAlert : Number(minStockAlert);
    if (typeof minStockAlert === 'boolean' || !Number.isInteger(m) || m < 0 || m > 1_000_000) {
      throw new AppError('BAD_MIN_STOCK', 'The low-stock alert level must be a whole number of 0 or more.', 400);
    }
    minStockAlert = m;
  } else {
    minStockAlert = undefined;
  }
  if (location !== undefined && location !== null && typeof location !== 'string') throw new AppError('BAD_LOCATION', 'Location must be text.', 400);
  return serializableTx(async (tx: any) => {
    const item = await tx.item.findUnique({ where: { id: itemId } });
    if (!item) throw new AppError('NOT_FOUND', 'Item not found', 404);
    // A real number ("7" and 2.5 NOS were accepted), whole for whole-unit items,
    // zero or more, within a sane bound (INV7-1).
    const qty = stockQty(quantity, item.unit, 'Stock quantity');
    if (qty < 0) throw new AppError('BAD_QTY', 'Stock quantity must be zero or more.', 400);
    const ts = nowIso();
    const existing = await tx.branchStock.findUnique({ where: { itemId_branchId: { itemId, branchId } } });
    const prevQty = existing?.quantity ?? 0;
    // INV9-2: an archived item's stock can't be set (its alert level/location can).
    if (item.isArchived && qty !== prevQty) throw archivedItemError(item.itemName);
    await tx.branchStock.upsert({
      where: { itemId_branchId: { itemId, branchId } },
      create: { itemId, branchId, quantity: qty, minStockAlert: minStockAlert ?? 5, location: location?.trim() ?? '', updatedAt: ts },
      update: {
        quantity: qty,
        ...(minStockAlert !== undefined ? { minStockAlert } : {}),
        ...(location !== undefined ? { location: location.trim() } : {}),
        updatedAt: ts,
      },
    });
    const change = Math.round((qty - prevQty) * 100) / 100;
    if (change !== 0) {
      await tx.stockAdjustmentLog.create({
        data: {
          id: rid('adj'), itemId, itemName: item.itemName, itemCode: item.itemCode, branchId,
          previousQuantity: prevQty, quantityChange: change, newQuantity: qty,
          reason: 'Stock Set', notes: 'Direct stock set', adjustedBy: actor || 'System', timestamp: ts,
        },
      });
    }
    return { branchStocks: await tx.branchStock.findMany() };
  });
}

export function updateBranchStockLocation(itemId: string, branchId: string, location?: string) {
  if (!isValidBranch(branchId)) throw new AppError('BAD_BRANCH', `Unknown branch: ${branchId}`, 400);
  return serializableTx(async (tx: any) => {
    // INV9-7: no stock row for an item that doesn't exist.
    if (!(await tx.item.findUnique({ where: { id: String(itemId || '') }, select: { id: true } }))) {
      throw new AppError('NOT_FOUND', 'Item not found', 404);
    }
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
