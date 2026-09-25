import { prisma } from '../db.js';
import { AppError } from '../middleware/errorHandler.js';
import { nowIso, rid } from '../lib/stockLedger.js';
import { nextPoNumber } from '../lib/sequences.js';
import { withRetry } from '../lib/retry.js';
import { serializableTx } from '../lib/tx.js';

const poSnapshot = async (tx: any) => ({
  purchaseOrders: await tx.purchaseOrder.findMany(),
  pendingOrders: await tx.pendingOrder.findMany(),
  branchStocks: await tx.branchStock.findMany(),
});

/** Branch-locked roles (non-CEO with an assigned branch) may only act on their
 * own branch's POs — server-side enforcement mirroring the billing guard. */
function assertBranchAllowed(reqUser: any, branchId: string) {
  if (reqUser && reqUser.role !== 'CEO' && reqUser.assignedBranchId && branchId !== reqUser.assignedBranchId) {
    throw new AppError('FORBIDDEN', `You are only authorized for branch ${reqUser.assignedBranchId}`, 403);
  }
}

/** Create (server-assigned PO number) or edit a purchase order; link pending order. */
export function savePurchaseOrder(poData: any, _actor: string, reqUser?: any) {
  assertBranchAllowed(reqUser, poData.branchId);
  return withRetry(() => prisma.$transaction(async (tx: any) => {
    const ts = nowIso();
    let saved: any;
    if (poData.id && (await tx.purchaseOrder.findUnique({ where: { id: poData.id } }))) {
      const { id, ...rest } = poData;
      saved = await tx.purchaseOrder.update({ where: { id }, data: { ...rest, updatedAt: ts } });
    } else {
      const id = poData.id || `po-order-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
      const poNumber = await nextPoNumber(tx, poData.branchId); // authoritative, collision-free
      saved = await tx.purchaseOrder.create({
        data: { ...poData, id, poNumber, createdAt: ts, updatedAt: ts },
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
    return { ...(await poSnapshot(tx)), saved };
  }));
}

export function deletePurchaseOrder(poId: string) {
  return prisma.$transaction(async (tx: any) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id: poId } });
    if (po && (po.status === 'Received' || po.status === 'Partially Received')) {
      throw new AppError('HAS_RECEIPTS', 'Cannot delete a PO that has received stock. Cancel it instead.', 409);
    }
    if (po) await tx.purchaseOrder.delete({ where: { id: poId } });
    return poSnapshot(tx);
  });
}

export function cancelPurchaseOrder(poId: string) {
  return prisma.$transaction(async (tx: any) => {
    await tx.purchaseOrder.updateMany({ where: { id: poId }, data: { status: 'Cancelled', updatedAt: nowIso() } });
    return poSnapshot(tx);
  });
}

/** Receive stock against a PO: update lines/status/history + increment branch stock (atomic). */
export function receivePurchaseOrderStock(
  poId: string,
  receipts: { itemId: string; quantityReceived: number; location?: string; purchasePrice?: number; damagedQuantity?: number }[],
  notes: string | undefined,
  payment: { amount?: number; mode?: string } | undefined,
  actor: string,
  reqUser?: any
) {
  return serializableTx(async (tx: any) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new AppError('NOT_FOUND', 'Purchase order not found', 404);
    assertBranchAllowed(reqUser, po.branchId);

    const valid = (receipts || []).filter((r) => r.quantityReceived > 0 || (r.damagedQuantity || 0) > 0);
    if (!valid.length) throw new AppError('NO_ITEMS', 'No items to receive', 400);

    const ts = nowIso();
    const lines = po.items as any[];
    const updatedLines = lines.map((line) => {
      const rec = valid.find((r) => r.itemId === line.itemId);
      if (!rec) return line;
      // Confirm/override the purchase price entered while receiving, and refresh the
      // line amount (price × ordered qty) so the PO total reflects the real cost.
      const nextPrice =
        rec.purchasePrice != null && rec.purchasePrice >= 0 ? rec.purchasePrice : line.purchasePrice || 0;
      return {
        ...line,
        receivedQuantity: (line.receivedQuantity || 0) + rec.quantityReceived,
        purchasePrice: nextPrice,
        amount: Math.round(nextPrice * (line.quantityOrdered || 0) * 100) / 100,
      };
    });
    const newTotalAmount = updatedLines.reduce((s: number, l: any) => s + (l.amount || 0), 0);

    const eventLines = valid.map((rec) => {
      const line = lines.find((l) => l.itemId === rec.itemId);
      const prevReceived = line?.receivedQuantity || 0;
      return {
        itemId: rec.itemId, itemName: line?.itemName || rec.itemId, itemCode: line?.itemCode || '',
        quantityOrdered: line?.quantityOrdered || 0, quantityReceivedThisEvent: rec.quantityReceived,
        damagedQuantity: rec.damagedQuantity || 0,
        totalReceivedSoFar: prevReceived + rec.quantityReceived, location: rec.location?.trim() || undefined,
      };
    });
    const receivingEvent = {
      id: `rec-evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      date: ts.split('T')[0], timestamp: ts, receivedBy: actor, notes: notes?.trim() || undefined, lines: eventLines,
    };

    // Quality check: any damaged/rejected units raise a debit note back to the vendor.
    const existingNotes = (po.debitNotes as any[]) || [];
    const damagedReceipts = valid.filter((r) => (r.damagedQuantity || 0) > 0);
    let debitNotes = existingNotes;
    if (damagedReceipts.length) {
      const dnLines = damagedReceipts.map((rec) => {
        const line = updatedLines.find((l: any) => l.itemId === rec.itemId) || lines.find((l) => l.itemId === rec.itemId);
        const unitPrice = line?.purchasePrice || 0;
        const dq = rec.damagedQuantity || 0;
        return {
          itemId: rec.itemId, itemName: line?.itemName || rec.itemId, itemCode: line?.itemCode || '',
          damagedQuantity: dq, unitPrice, amount: Math.round(unitPrice * dq * 100) / 100,
        };
      });
      const dnTotal = dnLines.reduce((s, l) => s + l.amount, 0);
      const newNote = {
        id: `dn-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        noteNumber: `${po.poNumber}-DN${existingNotes.length + 1}`,
        date: ts.split('T')[0], createdBy: actor, lines: dnLines,
        totalAmount: Math.round(dnTotal * 100) / 100, notes: notes?.trim() || undefined,
      };
      debitNotes = [newNote, ...existingNotes];
    }

    const allFull = updatedLines.every((l) => (l.receivedQuantity || 0) >= l.quantityOrdered);
    const anyReceived = updatedLines.some((l) => (l.receivedQuantity || 0) > 0);
    const status = allFull ? 'Received' : anyReceived ? 'Partially Received' : po.status;

    // Optional vendor payment recorded at the moment of receiving.
    const payNow = Math.max(0, Number(payment?.amount) || 0);
    const newAmountPaid = Math.round(((po.amountPaid || 0) + payNow) * 100) / 100;
    const payments = (po.payments as any[]) || [];
    if (payNow > 0) {
      payments.unshift({
        id: `pay-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        date: ts.split('T')[0], amount: payNow, mode: payment?.mode || 'Cash', by: actor,
      });
    }

    await tx.purchaseOrder.update({
      where: { id: poId },
      data: {
        items: updatedLines, status, totalAmount: newTotalAmount,
        amountPaid: newAmountPaid,
        receivingHistory: [receivingEvent, ...((po.receivingHistory as any[]) || [])],
        debitNotes, payments,
        updatedAt: ts,
      },
    });

    // Increment physical stock at the PO's branch
    for (const rec of valid) {
      const existing = await tx.branchStock.findUnique({
        where: { itemId_branchId: { itemId: rec.itemId, branchId: po.branchId } },
      });
      await tx.branchStock.upsert({
        where: { itemId_branchId: { itemId: rec.itemId, branchId: po.branchId } },
        create: {
          itemId: rec.itemId, branchId: po.branchId, quantity: rec.quantityReceived,
          location: rec.location?.trim() || '', minStockAlert: 5, updatedAt: ts,
        },
        update: {
          quantity: (existing?.quantity ?? 0) + rec.quantityReceived,
          ...(rec.location ? { location: rec.location.trim() } : {}),
          updatedAt: ts,
        },
      });
    }
    return poSnapshot(tx);
  });
}

export function addAttachment(poId: string, attachmentData: any, actor: string) {
  return prisma.$transaction(async (tx: any) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new AppError('NOT_FOUND', 'Purchase order not found', 404);
    const newAttachment = {
      ...attachmentData, id: rid('po-att'), uploadedAt: nowIso(), uploadedBy: actor,
    };
    await tx.purchaseOrder.update({
      where: { id: poId },
      data: { attachments: [newAttachment, ...((po.attachments as any[]) || [])], updatedAt: nowIso() },
    });
    return poSnapshot(tx);
  });
}

export function deleteAttachment(poId: string, attachmentId: string) {
  return prisma.$transaction(async (tx: any) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new AppError('NOT_FOUND', 'Purchase order not found', 404);
    await tx.purchaseOrder.update({
      where: { id: poId },
      data: {
        attachments: ((po.attachments as any[]) || []).filter((a) => a.id !== attachmentId),
        updatedAt: nowIso(),
      },
    });
    return poSnapshot(tx);
  });
}
