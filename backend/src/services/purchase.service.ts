import { prisma } from '../db.js';
import { AppError } from '../middleware/errorHandler.js';
import { nowIso, rid } from '../lib/stockLedger.js';
import { nextPoNumber } from '../lib/sequences.js';
import { withRetry } from '../lib/retry.js';
import { serializableTx } from '../lib/tx.js';
import { assertBranchAllowed } from '../lib/branchGuard.js';

const poSnapshot = async (tx: any) => ({
  purchaseOrders: await tx.purchaseOrder.findMany(),
  pendingOrders: await tx.pendingOrder.findMany(),
  branchStocks: await tx.branchStock.findMany(),
});

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

export function cancelPurchaseOrder(poId: string, reqUser?: any) {
  return prisma.$transaction(async (tx: any) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id: poId } });
    if (po) assertBranchAllowed(reqUser, po.branchId); // SEC2-1
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

    // A cancelled or already fully-received PO must not accept more stock — doing
    // so let a cancelled order flip to Received and create stock (PUR-1).
    if (po.status === 'Cancelled') throw new AppError('PO_CANCELLED', 'Cannot receive stock against a cancelled purchase order.', 400);
    if (po.status === 'Received') throw new AppError('PO_COMPLETE', 'This purchase order is already fully received.', 400);

    const valid = (receipts || []).filter((r) => r.quantityReceived > 0 || (r.damagedQuantity || 0) > 0);
    if (!valid.length) throw new AppError('NO_ITEMS', 'No items to receive', 400);

    const ts = nowIso();
    const lines = po.items as any[];

    // Per-line receiving limits (PUR2-2): the item must be on the PO, quantities
    // can't be negative, and good + damaged this receipt can't exceed what's still
    // outstanding on the line — otherwise stock is created from nothing.
    for (const rec of valid) {
      const line = lines.find((l) => l.itemId === rec.itemId);
      if (!line) throw new AppError('ITEM_NOT_ON_PO', `An item being received is not on this purchase order.`, 400);
      const good = Number(rec.quantityReceived) || 0;
      const dmg = Number(rec.damagedQuantity) || 0;
      if (good < 0 || dmg < 0) throw new AppError('NEGATIVE_QTY', 'Received or damaged quantity cannot be negative.', 400);
      const remaining = (line.quantityOrdered || 0) - (line.receivedQuantity || 0);
      if (good + dmg > remaining) {
        throw new AppError('OVER_RECEIPT', `Cannot receive ${good + dmg} of "${line.itemName || rec.itemId}" — only ${remaining} remaining on the PO.`, 400);
      }
    }

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

    // Reflect the confirmed per-unit purchase price back onto the item master, and
    // re-price its sale price from the margin band (A +35% / B +25% / C +15%).
    const marginMult: Record<string, number> = { A: 1.35, B: 1.25, C: 1.15 };
    for (const rec of valid) {
      if (rec.purchasePrice == null || rec.purchasePrice < 0) continue;
      const item = await tx.item.findUnique({ where: { id: rec.itemId } });
      if (!item) continue;
      const data: any = { purchasePrice: rec.purchasePrice, updatedAt: ts };
      const mult = item.marginCategory ? marginMult[item.marginCategory] : undefined;
      if (mult) data.salePrice = Math.round(rec.purchasePrice * mult * 100) / 100;
      await tx.item.update({ where: { id: rec.itemId }, data });
    }

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

/** Save the supplier's tax invoice (bill) details on a PO — enables Input Tax Credit. */
export function recordPurchaseBill(poId: string, bill: any) {
  return prisma.$transaction(async (tx: any) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new AppError('NOT_FOUND', 'Purchase order not found', 404);
    await tx.purchaseOrder.update({
      where: { id: poId },
      data: {
        supplierBillNumber: (bill?.number || '').trim() || null,
        supplierBillDate: (bill?.date || '').trim() || null,
        supplierBillTaxable: Number(bill?.taxable) || 0,
        supplierBillGst: Number(bill?.gst) || 0,
        updatedAt: nowIso(),
      },
    });
    return poSnapshot(tx);
  });
}

/** Record a payment made to the vendor against a PO (increments Paid, logs history). */
export function recordPurchaseOrderPayment(poId: string, amount: number, mode: string, actor: string, reqUser?: any) {
  return prisma.$transaction(async (tx: any) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new AppError('NOT_FOUND', 'Purchase order not found', 404);
    assertBranchAllowed(reqUser, po.branchId); // SEC2-1
    const pay = Math.max(0, Number(amount) || 0);
    if (pay <= 0) throw new AppError('INVALID', 'Payment amount must be greater than 0', 400);
    const ts = nowIso();
    const entry = { id: rid('pay'), date: ts.split('T')[0], amount: pay, mode: mode || 'Cash', by: actor };
    await tx.purchaseOrder.update({
      where: { id: poId },
      data: {
        amountPaid: Math.round(((po.amountPaid || 0) + pay) * 100) / 100,
        payments: [entry, ...((po.payments as any[]) || [])],
        updatedAt: ts,
      },
    });
    return poSnapshot(tx);
  });
}
