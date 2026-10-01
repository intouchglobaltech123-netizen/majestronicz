import { prisma } from '../db.js';
import { AppError } from '../middleware/errorHandler.js';
import { isValidTaxPercent, taxAmountFor } from '../lib/tax.js';
import { nowIso, rid } from '../lib/stockLedger.js';
import { nextPoNumber } from '../lib/sequences.js';
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
  // Serializable + retry so a concurrent Edit-Prices and receive on the same PO
  // can't lose one another's write (E2E-5).
  return serializableTx(async (tx: any) => {
    const ts = nowIso();
    let saved: any;
    // These are set only by the receive / pay / cancel flows and the server — never
    // accepted from a save, or a PO could be created/edited as Received with a
    // fake paid amount and number (PUR2-6).
    // These are owned by dedicated flows (receive / pay / cancel / record-bill /
    // attachments) and the server — never taken from a general PO save. PUR5-4:
    // the supplier-bill and attachment fields are here too, so an "Edit Prices"
    // save built from a stale snapshot can't blank out the supplier's tax invoice
    // or another user's uploaded attachments (PUR2-6).
    const SERVER_MANAGED = [
      'status', 'amountPaid', 'poNumber', 'receivingHistory', 'debitNotes', 'payments',
      'supplierBillNumber', 'supplierBillDate', 'supplierBillTaxable', 'supplierBillGst', 'attachments',
      'createdAt', 'updatedAt',
    ];
    const existingPo = poData.id ? await tx.purchaseOrder.findUnique({ where: { id: poData.id } }) : null;
    if (existingPo) {
      // SEC5-2: the guard at the top ran against the request's poData.branchId.
      // On an edit, authorize against the STORED PO's branch and keep the branch
      // immutable, so a branch-locked user can't edit or move another branch's PO
      // by sending a different branchId.
      assertBranchAllowed(reqUser, existingPo.branchId);
      const { id, ...rest } = poData;
      for (const k of SERVER_MANAGED) delete (rest as any)[k];
      delete (rest as any).branchId;
      // E2E-5: an Edit-Prices payload is built from a snapshot of the PO the user
      // opened, which may predate a receipt. Take price / ordered-qty / tax from
      // the client, but keep the server's per-line received / damaged / missing
      // quantities so a stale edit can't wipe what was actually received. Totals
      // are recomputed from the merged lines.
      if (Array.isArray(rest.items) && Array.isArray(existingPo.items)) {
        const dbByItem = new Map((existingPo.items as any[]).map((l: any) => [l.itemId, l]));
        rest.items = rest.items.map((cl: any) => {
          const db = dbByItem.get(cl.itemId);
          const price = Number(cl.purchasePrice) || 0;
          const qtyOrdered = Number(cl.quantityOrdered) || (db?.quantityOrdered ?? 0);
          const taxPercent = cl.taxPercent != null ? Number(cl.taxPercent) : (db?.taxPercent ?? 0);
          const amount = Math.round(price * qtyOrdered * 100) / 100;
          const taxAmount = taxAmountFor(amount, taxPercent);
          return {
            ...(db || {}),
            ...cl,
            quantityOrdered: qtyOrdered,
            purchasePrice: price,
            taxPercent,
            amount,
            taxAmount,
            lineTotal: Math.round((amount + taxAmount) * 100) / 100,
            // Received state is authoritative from the DB, never the client.
            receivedQuantity: db?.receivedQuantity ?? 0,
            damagedQuantity: db?.damagedQuantity ?? 0,
            missingQuantity: db?.missingQuantity ?? 0,
          };
        });
        rest.totalAmount = Math.round(rest.items.reduce((s: number, l: any) => s + (l.amount || 0), 0) * 100) / 100;
        rest.totalTax = Math.round(rest.items.reduce((s: number, l: any) => s + (l.taxAmount || 0), 0) * 100) / 100;
      }
      saved = await tx.purchaseOrder.update({ where: { id }, data: { ...rest, updatedAt: ts } });
    } else {
      const id = poData.id || `po-order-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
      const poNumber = await nextPoNumber(tx, poData.branchId); // authoritative, collision-free
      const clean = { ...poData };
      for (const k of SERVER_MANAGED) delete (clean as any)[k];
      // PUR5-2: never trust the client's totals. Recompute each line's amount/tax
      // from price × ordered-qty and the tax %, then the PO totals from the lines,
      // exactly as the edit path does — a tampered or buggy client can't persist
      // an inflated payable (₹1,98,480 shown vs ₹89,048 actually owed).
      if (Array.isArray(clean.items)) {
        clean.items = clean.items.map((l: any) => {
          const price = Number(l.purchasePrice) || 0;
          const qty = Number(l.quantityOrdered) || 0;
          const taxPercent = isValidTaxPercent(l.taxPercent) ? Number(l.taxPercent) : 0;
          const amount = Math.round(price * qty * 100) / 100;
          const taxAmount = taxAmountFor(amount, taxPercent);
          return {
            ...l,
            quantityOrdered: qty,
            purchasePrice: price,
            taxPercent,
            amount,
            taxAmount,
            lineTotal: Math.round((amount + taxAmount) * 100) / 100,
          };
        });
        clean.totalAmount = Math.round(clean.items.reduce((s: number, l: any) => s + (l.amount || 0), 0) * 100) / 100;
        clean.totalTax = Math.round(clean.items.reduce((s: number, l: any) => s + (l.taxAmount || 0), 0) * 100) / 100;
      }
      saved = await tx.purchaseOrder.create({
        data: { ...clean, id, poNumber, status: 'Ordered', amountPaid: 0, createdAt: ts, updatedAt: ts },
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
  });
}

export function deletePurchaseOrder(poId: string, reqUser?: any) {
  return prisma.$transaction(async (tx: any) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id: poId } });
    if (po) assertBranchAllowed(reqUser, po.branchId); // SEC2-1
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
    // PUR3-6: a PO with vendor money already paid against it must not be silently
    // cancelled — that would strand the payment against a cancelled order. Reverse
    // the vendor payment first.
    if (po && (po.amountPaid || 0) > 0) {
      throw new AppError('PO_HAS_PAYMENTS', 'Cannot cancel a purchase order that has payments recorded against it. Reverse the vendor payment first.', 409);
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

    const valid = (receipts || []).filter((r) => r.quantityReceived > 0 || (r.damagedQuantity || 0) > 0 || (r.missingQuantity || 0) > 0);
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
      const missing = Number(rec.missingQuantity) || 0;
      if (good < 0 || dmg < 0 || missing < 0) throw new AppError('NEGATIVE_QTY', 'Received, damaged or missing quantity cannot be negative.', 400);
      if (rec.taxPercent != null && !isValidTaxPercent(rec.taxPercent)) {
        throw new AppError('BAD_TAX', `Tax % for "${line.itemName || rec.itemId}" must be between 0 and 100.`, 400);
      }
      // Remaining now nets prior good + damaged + missing, since all three settle
      // the ordered quantity (damaged & missing won't arrive as sellable stock).
      const settled = (line.receivedQuantity || 0) + (line.damagedQuantity || 0) + (line.missingQuantity || 0);
      const remaining = (line.quantityOrdered || 0) - settled;
      if (good + dmg + missing > remaining) {
        throw new AppError('OVER_RECEIPT', `Cannot settle ${good + dmg + missing} of "${line.itemName || rec.itemId}" — only ${remaining} remaining on the PO.`, 400);
      }
    }

    const updatedLines = lines.map((line) => {
      const rec = valid.find((r) => r.itemId === line.itemId);
      if (!rec) return line;
      // Confirm/override the purchase price entered while receiving, and refresh the
      // line amount (price × ordered qty) so the PO total reflects the real cost.
      const nextPrice =
        rec.purchasePrice != null && rec.purchasePrice >= 0 ? rec.purchasePrice : line.purchasePrice || 0;
      // Tax rate confirmed at receipt wins; otherwise keep whatever the line
      // already carried, falling back to 0 rather than guessing a slab.
      const nextTaxPercent =
        rec.taxPercent != null ? Number(rec.taxPercent) : (line.taxPercent ?? 0);
      const lineAmount = Math.round(nextPrice * (line.quantityOrdered || 0) * 100) / 100;
      return {
        ...line,
        receivedQuantity: (line.receivedQuantity || 0) + rec.quantityReceived,
        // Cumulative damaged & missing (short-shipped) on the line, so the line
        // can close out and both are billed back to the vendor.
        damagedQuantity: (line.damagedQuantity || 0) + (Number(rec.damagedQuantity) || 0),
        missingQuantity: (line.missingQuantity || 0) + (Number(rec.missingQuantity) || 0),
        purchasePrice: nextPrice,
        amount: lineAmount,
        taxPercent: nextTaxPercent,
        taxAmount: taxAmountFor(lineAmount, nextTaxPercent),
        lineTotal: Math.round((lineAmount + taxAmountFor(lineAmount, nextTaxPercent)) * 100) / 100,
      };
    });
    const newTotalAmount = updatedLines.reduce((s: number, l: any) => s + (l.amount || 0), 0);
    const newTotalTax = Math.round(
      updatedLines.reduce((s: number, l: any) => s + (l.taxAmount || 0), 0) * 100,
    ) / 100;

    const eventLines = valid.map((rec) => {
      const line = lines.find((l) => l.itemId === rec.itemId);
      const prevReceived = line?.receivedQuantity || 0;
      return {
        itemId: rec.itemId, itemName: line?.itemName || rec.itemId, itemCode: line?.itemCode || '',
        quantityOrdered: line?.quantityOrdered || 0, quantityReceivedThisEvent: rec.quantityReceived,
        damagedQuantity: rec.damagedQuantity || 0,
        missingQuantity: rec.missingQuantity || 0,
        totalReceivedSoFar: prevReceived + rec.quantityReceived, location: rec.location?.trim() || undefined,
        // What this receipt itself cost, so the history shows the money that
        // moved on the day rather than only the PO's running totals.
        purchasePrice: rec.purchasePrice ?? line?.purchasePrice ?? 0,
        taxPercent: rec.taxPercent ?? line?.taxPercent ?? 0,
        taxableValue: Math.round((rec.purchasePrice ?? line?.purchasePrice ?? 0) * rec.quantityReceived * 100) / 100,
        taxAmount: taxAmountFor(
          (rec.purchasePrice ?? line?.purchasePrice ?? 0) * rec.quantityReceived,
          rec.taxPercent ?? line?.taxPercent ?? 0,
        ),
      };
    });
    const receivingEvent = {
      id: `rec-evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      date: ts.split('T')[0], timestamp: ts, receivedBy: actor, notes: notes?.trim() || undefined, lines: eventLines,
    };

    // Damaged (defective) AND missing (short-shipped) units are both billed back
    // to the vendor as a debit/credit note — the shop paid for units it didn't
    // get as sellable stock.
    const existingNotes = (po.debitNotes as any[]) || [];
    const billBackReceipts = valid.filter((r) => (r.damagedQuantity || 0) > 0 || (r.missingQuantity || 0) > 0);
    let debitNotes = existingNotes;
    if (billBackReceipts.length) {
      const dnLines = billBackReceipts.map((rec) => {
        const line = updatedLines.find((l: any) => l.itemId === rec.itemId) || lines.find((l) => l.itemId === rec.itemId);
        const unitPrice = line?.purchasePrice || 0;
        const dq = Number(rec.damagedQuantity) || 0;
        const mq = Number(rec.missingQuantity) || 0;
        return {
          itemId: rec.itemId, itemName: line?.itemName || rec.itemId, itemCode: line?.itemCode || '',
          damagedQuantity: dq, missingQuantity: mq, unitPrice,
          amount: Math.round(unitPrice * (dq + mq) * 100) / 100,
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

    // A line is settled when good + damaged + missing covers the ordered qty.
    const lineSettled = (l: any) => (l.receivedQuantity || 0) + (l.damagedQuantity || 0) + (l.missingQuantity || 0);
    const allFull = updatedLines.every((l) => lineSettled(l) >= l.quantityOrdered);
    const anyReceived = updatedLines.some((l) => (l.receivedQuantity || 0) > 0 || (l.damagedQuantity || 0) > 0 || (l.missingQuantity || 0) > 0);
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

    // PUR: extra charges the vendor billed (packing/freight) entered on this
    // receipt. Accumulate onto the PO so the payable includes them.
    const extraCharge = Math.max(0, Number(otherCharges) || 0);
    const newOtherCharges = Math.round(((po.otherCharges || 0) + extraCharge) * 100) / 100;

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

export function addAttachment(poId: string, attachmentData: any, actor: string, reqUser?: any) {
  return prisma.$transaction(async (tx: any) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new AppError('NOT_FOUND', 'Purchase order not found', 404);
    assertBranchAllowed(reqUser, po.branchId); // SEC2-1
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

export function deleteAttachment(poId: string, attachmentId: string, reqUser?: any) {
  return prisma.$transaction(async (tx: any) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new AppError('NOT_FOUND', 'Purchase order not found', 404);
    assertBranchAllowed(reqUser, po.branchId); // SEC2-1
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
export function recordPurchaseBill(poId: string, bill: any, reqUser?: any) {
  return prisma.$transaction(async (tx: any) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new AppError('NOT_FOUND', 'Purchase order not found', 404);
    assertBranchAllowed(reqUser, po.branchId); // SEC2-1
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
    // Debit notes (damaged/rejected goods billed back) reduce what we owe (PUR2-19).
    const debitTotal = ((po.debitNotes as any[]) || []).reduce((s, dn) => s + (dn.totalAmount || 0), 0);
    // PUR4-1/PUR4-2: the vendor is owed the GST too, so the payable is the
    // tax-INCLUSIVE grand total. Capping at the ex-tax goods value (as before)
    // rejected the tax portion of a GST PO as "overpayment", so such a PO could
    // never be marked fully paid. Legacy POs with no tax leave this unchanged.
    const grandOwed = Math.round(((po.totalAmount || 0) + (Number(po.totalTax) || 0) + (Number(po.otherCharges) || 0)) * 100) / 100;
    const remaining = Math.round((grandOwed - (po.amountPaid || 0) - debitTotal) * 100) / 100;
    if (remaining <= 0) throw new AppError('ALREADY_PAID', 'This purchase order is already fully paid.', 400);
    if (pay > remaining) throw new AppError('OVERPAYMENT', `Payment of ₹${pay} exceeds the remaining balance of ₹${remaining.toLocaleString('en-IN')}.`, 400);
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
    // Also record a Payment-ledger 'out' row so this vendor payment reaches the
    // cash drawer / Payments Log (CASH3-5). The PO page and To Pay previously only
    // wrote the PO-embedded entry, which the drawer never sees, so vendor cash
    // paid there never left the drawer. Booked against the PO's branch.
    const like = `PAY-${ts.slice(0, 7).replace('-', '')}-`;
    const existingRows = await tx.payment.findMany({ where: { receiptNumber: { startsWith: like }, type: 'out' }, select: { receiptNumber: true } });
    let maxNo = 0;
    for (const r of existingRows) {
      const n = parseInt(String(r.receiptNumber).slice(like.length), 10);
      if (!Number.isNaN(n)) maxNo = Math.max(maxNo, n);
    }
    await tx.payment.create({
      data: {
        id: rid('pay'), receiptNumber: `${like}${String(maxNo + 1).padStart(4, '0')}`,
        type: 'out', partyType: 'vendor', partyId: po.vendorId ?? null, partyName: po.vendorName || 'Vendor',
        branchId: po.branchId, date: ts.split('T')[0], amount: pay, paymentMode: mode || 'Cash',
        reference: po.poNumber ?? null, notes: `Vendor payment on PO ${po.poNumber}`,
        allocations: [{ refId: po.id, refNumber: po.poNumber, amount: pay }] as any,
        createdById: null, createdByName: actor, createdAt: ts,
      },
    });
    return poSnapshot(tx);
  });
}
