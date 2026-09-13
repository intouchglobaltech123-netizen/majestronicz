import { prisma } from '../db.js';
import { AppError } from '../middleware/errorHandler.js';
import { StockLedger, nowIso, cleanPhone, rid } from '../lib/stockLedger.js';
import { nextInvoiceNumber } from '../lib/sequences.js';
import { serializableTx } from '../lib/tx.js';
import { calculateLineTax, calculateInvoiceTotals } from '../lib/taxCalc.js';

/**
 * Recompute every line's tax and the invoice totals from raw inputs, overriding
 * whatever the client sent. Makes stored money values server-authoritative so a
 * tampered or buggy client can never persist incorrect amounts.
 */
function recomputeInvoiceMoney(inv: any) {
  const withGst = !!inv.withGst;
  inv.items = (inv.items || []).map((li: any) => {
    const calc = calculateLineTax(li.quantity, li.unitPrice, li.taxRate, withGst, li.discountType || '%', li.discountValue || 0);
    return { ...li, ...calc };
  });
  const totals = calculateInvoiceTotals(
    inv.items, withGst, inv.overallDiscountType || '%', inv.overallDiscountValue || 0,
    inv.shippingCharges || 0, !!inv.roundOffEnabled
  );
  inv.subtotal = totals.subtotal;
  inv.totalTax = totals.totalTax;
  inv.totalCgst = totals.totalCgst;
  inv.totalSgst = totals.totalSgst;
  inv.overallDiscountAmount = totals.overallDiscountAmount;
  inv.shippingCharges = totals.shippingCharges;
  inv.roundOff = totals.roundOff;
  inv.grandTotal = totals.grandTotal;
  inv.amountInWords = totals.amountInWords;
  return inv;
}

/** Affected collections returned so the frontend can sync in-memory state. */
async function snapshot(tx: any) {
  const [invoices, customers, branchStocks, stockAdjustmentLogs] = await Promise.all([
    tx.invoice.findMany(),
    tx.customer.findMany(),
    tx.branchStock.findMany(),
    tx.stockAdjustmentLog.findMany(),
  ]);
  return { invoices, customers, branchStocks, stockAdjustmentLogs };
}

/** Create or edit an invoice: customer link/update + stock decrement, atomic.
 * New sales get a server-authoritative, collision-free invoice number. */
export function createSale(inv: any) {
  recomputeInvoiceMoney(inv); // server-authoritative totals
  return serializableTx(async (tx: any) => {
    const reg = await tx.dailyCashRegister.findFirst({
      where: { branchId: inv.branchId, date: inv.date, isClosed: true },
    });
    if (reg) throw new AppError('DAY_CLOSED', 'Cash register for this day is closed', 409);

    const existing = await tx.invoice.findUnique({ where: { id: inv.id } });
    const isNewSale = !existing;
    const oldInvoice = existing;
    if (isNewSale) inv.invoiceNumber = await nextInvoiceNumber(tx, inv.branchId, inv.date);
    const phoneClean = cleanPhone(inv.customerPhone);
    const ts = nowIso();

    // Customer link / update
    const customers = await tx.customer.findMany();
    const cust =
      (inv.customerId && customers.find((c: any) => c.id === inv.customerId)) ||
      (phoneClean && customers.find((c: any) => cleanPhone(c.phone) === phoneClean)) ||
      (inv.customerName?.trim() &&
        customers.find(
          (c: any) => c.name.trim().toLowerCase() === inv.customerName.trim().toLowerCase()
        )) ||
      null;

    if (cust) {
      inv.customerId = cust.id;
      const oldSpent = oldInvoice ? oldInvoice.grandTotal : 0;
      const newCount = isNewSale ? (cust.purchaseCount || 0) + 1 : cust.purchaseCount;
      const newSpent = Math.max(0, (cust.totalSpent || 0) - oldSpent + inv.grandTotal);
      await tx.customer.update({
        where: { id: cust.id },
        data: {
          name: inv.customerName || cust.name,
          phone: inv.customerPhone || cust.phone,
          address: inv.customerAddress || cust.address,
          purchaseCount: newCount,
          totalSpent: newSpent,
          firstPurchaseDate: cust.firstPurchaseDate || inv.date,
          lastRewardRedeemedPurchaseCount: inv.isLoyaltyRewardApplied
            ? newCount
            : cust.lastRewardRedeemedPurchaseCount,
          updatedAt: ts,
        },
      });
    } else if (inv.customerName?.trim()) {
      const newCustId = rid('cust');
      inv.customerId = newCustId;
      await tx.customer.create({
        data: {
          id: newCustId,
          name: inv.customerName.trim(),
          phone: inv.customerPhone || '',
          address: inv.customerAddress || '',
          firstPurchaseDate: inv.date,
          purchaseCount: 1,
          totalSpent: inv.grandTotal,
          lastRewardRedeemedPurchaseCount: inv.isLoyaltyRewardApplied ? 1 : null,
          notes: 'Auto-created from Sale',
          createdAt: ts,
          updatedAt: ts,
        },
      });
    }

    // Branch stock: restore old invoice qty (edit), then decrement new items
    const allStocks = await tx.branchStock.findMany();
    const ledger = new StockLedger(allStocks, inv.branchId);
    if (oldInvoice) {
      for (const oldItem of oldInvoice.items as any[]) {
        if (oldItem.isCombo && oldItem.comboComponents?.length) {
          for (const comp of oldItem.comboComponents)
            ledger.apply(comp.itemId, comp.quantity * (oldItem.quantity || 0));
        } else if (oldItem.itemId) {
          ledger.apply(oldItem.itemId, oldItem.quantity || 0);
        }
      }
    }
    for (const newItem of inv.items as any[]) {
      if (newItem.isCombo && newItem.comboComponents?.length) {
        for (const comp of newItem.comboComponents)
          ledger.apply(comp.itemId, -(comp.quantity * (newItem.quantity || 0)), true);
      } else if (newItem.itemId) {
        ledger.apply(newItem.itemId, -(newItem.quantity || 0), true);
      }
    }
    await ledger.flush(tx);

    const { id, ...rest } = inv;
    await tx.invoice.upsert({ where: { id }, create: inv, update: rest });
    return snapshot(tx);
  });
}

/** Void an invoice: restore remaining stock, log, mark voided, decrement customer. */
export function voidInvoice(invoiceId: string, reason: string, actor: string) {
  return serializableTx(async (tx: any) => {
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new AppError('NOT_FOUND', 'Sale not found', 404);
    if (inv.isVoided) throw new AppError('ALREADY_VOIDED', 'Sale already voided', 409);

    const ts = nowIso();
    const items = await tx.item.findMany();
    const itemById = new Map(items.map((i: any) => [i.id, i]));
    const ledger = new StockLedger(await tx.branchStock.findMany(), inv.branchId);
    const newLogs: any[] = [];
    const returns = (inv.returns as any[]) || [];

    for (const item of inv.items as any[]) {
      if (item.isCombo && item.comboComponents?.length) {
        const alreadyReturned = returns
          .filter((r) => r.id === item.id || (item.comboId && r.comboId === item.comboId))
          .reduce((s, r) => s + (r.returnedQuantity || 0), 0);
        const comboQtyToRestore = Math.max(0, item.quantity - alreadyReturned);
        if (comboQtyToRestore <= 0) continue;
        for (const comp of item.comboComponents) {
          const qtyToRestore = comp.quantity * comboQtyToRestore;
          if (qtyToRestore <= 0) continue;
          const { prevQty, newQty } = ledger.apply(comp.itemId, qtyToRestore);
          const ci: any = itemById.get(comp.itemId);
          newLogs.push({
            id: rid('adj'), itemId: comp.itemId, itemName: ci?.itemName || 'Component Item',
            itemCode: ci?.itemCode || '', branchId: inv.branchId, previousQuantity: prevQty,
            quantityChange: qtyToRestore, newQuantity: newQty, reason: 'Voided Sale',
            notes: `Voided Sale #${inv.invoiceNumber} (Component of Combo: ${item.itemName}) - Reason: ${reason || 'Cancellation'}`,
            adjustedBy: actor, timestamp: ts,
          });
        }
      } else if (item.itemId) {
        const alreadyReturned = returns
          .filter((r) => r.itemId === item.itemId)
          .reduce((s, r) => s + (r.returnedQuantity || 0), 0);
        const qtyToRestore = Math.max(0, item.quantity - alreadyReturned);
        if (qtyToRestore <= 0) continue;
        const { prevQty, newQty } = ledger.apply(item.itemId, qtyToRestore);
        newLogs.push({
          id: rid('adj'), itemId: item.itemId, itemName: item.itemName, itemCode: item.itemCode || '',
          branchId: inv.branchId, previousQuantity: prevQty, quantityChange: qtyToRestore,
          newQuantity: newQty, reason: 'Voided Sale',
          notes: `Voided Sale #${inv.invoiceNumber} - Reason: ${reason || 'Cancellation'}`,
          adjustedBy: actor, timestamp: ts,
        });
      }
    }
    await ledger.flush(tx);
    if (newLogs.length) await tx.stockAdjustmentLog.createMany({ data: newLogs });

    await tx.invoice.update({
      where: { id: invoiceId },
      data: { isVoided: true, voidReason: reason || 'Cancelled / Voided', voidedAt: ts, voidedBy: actor, updatedAt: ts },
    });

    const phoneClean = cleanPhone(inv.customerPhone);
    if (inv.customerId || phoneClean) {
      const custs = await tx.customer.findMany();
      for (const c of custs) {
        if (c.id === inv.customerId || (phoneClean && cleanPhone(c.phone) === phoneClean)) {
          await tx.customer.update({
            where: { id: c.id },
            data: {
              purchaseCount: Math.max(0, (c.purchaseCount || 1) - 1),
              totalSpent: Math.max(0, (c.totalSpent || 0) - inv.grandTotal),
              updatedAt: ts,
            },
          });
        }
      }
    }
    return snapshot(tx);
  });
}

/** Partial line-item return: restore stock, log, append return records. */
export function processReturn(
  invoiceId: string,
  returnLines: any[],
  reason: string,
  notes: string | undefined,
  actor: string
) {
  return serializableTx(async (tx: any) => {
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new AppError('NOT_FOUND', 'Sale not found', 404);
    if (inv.isVoided) throw new AppError('VOIDED', 'Cannot return on a voided sale', 409);
    const validLines = (returnLines || []).filter((l: any) => l.returnQty > 0);
    if (!validLines.length) throw new AppError('NO_LINES', 'No return quantity specified', 400);

    const ts = nowIso();
    // Business rule: damaged goods are written off, NOT added back to stock.
    const isDamaged = /damag/i.test(reason || '');
    const stockReason = isDamaged ? 'Sales Return (Damaged - Written Off)' : 'Sales Return';
    const items = await tx.item.findMany();
    const itemById = new Map(items.map((i: any) => [i.id, i]));
    const ledger = new StockLedger(await tx.branchStock.findMany(), inv.branchId);
    const newLogs: any[] = [];
    const returnRecords: any[] = [];

    for (const line of validLines) {
      if (line.isCombo && line.comboComponents?.length) {
        for (const comp of line.comboComponents) {
          // Damaged returns restore 0 units (write-off); others restock normally.
          const qtyToRestore = isDamaged ? 0 : comp.quantity * line.returnQty;
          const { prevQty, newQty } = ledger.apply(comp.itemId, qtyToRestore);
          const ci: any = itemById.get(comp.itemId);
          newLogs.push({
            id: rid('adj'), itemId: comp.itemId, itemName: ci?.itemName || 'Component Item',
            itemCode: ci?.itemCode || '', branchId: inv.branchId, previousQuantity: prevQty,
            quantityChange: qtyToRestore, newQuantity: newQty, reason: stockReason,
            notes: `Sales Return on #${inv.invoiceNumber} (Component of Combo: ${line.itemName}) - ${reason}${notes ? ` (${notes})` : ''}${isDamaged ? ' [damaged — not restocked]' : ''}`,
            adjustedBy: actor, timestamp: ts,
          });
        }
        returnRecords.push({
          id: rid('ret'), itemId: line.itemId, itemCode: line.itemCode, itemName: line.itemName,
          returnedQuantity: line.returnQty, unitPrice: line.unitPrice, taxRate: line.taxRate,
          refundAmount: line.refundAmount, returnedAt: ts, reason, notes, processedBy: actor,
          isCombo: true, comboId: line.comboId, comboComponents: line.comboComponents,
        });
      } else {
        const qtyToRestore = isDamaged ? 0 : line.returnQty;
        const { prevQty, newQty } = ledger.apply(line.itemId, qtyToRestore);
        newLogs.push({
          id: rid('adj'), itemId: line.itemId, itemName: line.itemName, itemCode: line.itemCode,
          branchId: inv.branchId, previousQuantity: prevQty, quantityChange: qtyToRestore,
          newQuantity: newQty, reason: stockReason,
          notes: `Sales Return on #${inv.invoiceNumber} - ${reason}${notes ? ` (${notes})` : ''}${isDamaged ? ' [damaged — not restocked]' : ''}`,
          adjustedBy: actor, timestamp: ts,
        });
        returnRecords.push({
          id: rid('ret'), itemId: line.itemId, itemCode: line.itemCode, itemName: line.itemName,
          returnedQuantity: line.returnQty, unitPrice: line.unitPrice, taxRate: line.taxRate,
          refundAmount: line.refundAmount, returnedAt: ts, reason, notes, processedBy: actor,
        });
      }
    }
    await ledger.flush(tx);
    if (newLogs.length) await tx.stockAdjustmentLog.createMany({ data: newLogs });

    const totalRefund = returnRecords.reduce((s, r) => s + r.refundAmount, 0);
    const existingReturns = (inv.returns as any[]) || [];
    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        returns: [...existingReturns, ...returnRecords],
        totalReturnedAmount: (inv.totalReturnedAmount || 0) + totalRefund,
        updatedAt: ts,
      },
    });
    return snapshot(tx);
  });
}

/** Hard delete + restore stock. */
export function deleteInvoice(invoiceId: string) {
  return serializableTx(async (tx: any) => {
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (inv) {
      const ledger = new StockLedger(await tx.branchStock.findMany(), inv.branchId);
      for (const item of inv.items as any[]) {
        if (item.isCombo && item.comboComponents?.length) {
          for (const comp of item.comboComponents)
            ledger.apply(comp.itemId, comp.quantity * (item.quantity || 0));
        } else if (item.itemId) {
          ledger.apply(item.itemId, item.quantity || 0);
        }
      }
      await ledger.flush(tx);
      await tx.invoice.delete({ where: { id: invoiceId } });
    }
    return snapshot(tx);
  });
}
