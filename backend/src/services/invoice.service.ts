import { prisma } from '../db.js';
import { AppError } from '../middleware/errorHandler.js';
import { StockLedger, nowIso, cleanPhone, rid } from '../lib/stockLedger.js';
import { nextInvoiceNumber } from '../lib/sequences.js';
import { serializableTx } from '../lib/tx.js';
import { calculateLineTax, calculateInvoiceTotals } from '../lib/taxCalc.js';
import { assertBranchAllowed } from '../lib/branchGuard.js';

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
export function createSale(inv: any, reqUser?: any) {
  if (reqUser && reqUser.role !== 'CEO' && reqUser.assignedBranchId && inv.branchId !== reqUser.assignedBranchId) {
    throw new AppError('FORBIDDEN', `You are only authorized to bill for branch ${reqUser.assignedBranchId}`, 403);
  }
  recomputeInvoiceMoney(inv); // server-authoritative totals
  // Salesperson incentive: store the ₹ computed from the authoritative grand total.
  if (inv.salespersonId && Number(inv.incentivePercent) > 0) {
    inv.incentiveAmount = Math.round((inv.grandTotal || 0) * Number(inv.incentivePercent)) / 100;
  } else {
    inv.salespersonId = inv.salespersonId || null;
    inv.salespersonName = inv.salespersonName || null;
    inv.incentivePercent = inv.incentivePercent ?? null;
    inv.incentiveAmount = inv.incentiveAmount ?? null;
  }
  return serializableTx(async (tx: any) => {
    const reg = await tx.dailyCashRegister.findFirst({
      where: { branchId: inv.branchId, date: inv.date, isClosed: true },
    });
    if (reg) throw new AppError('DAY_CLOSED', 'Cash register for this day is closed', 409);

    // Reject nonsensical line quantities: a zero or negative quantity produced a
    // ₹0 bill and, worse, a negative quantity *added* stock instead of selling it
    // (SAL2-8).
    for (const li of (inv.items as any[]) || []) {
      const q = Number(li.quantity);
      if (!Number.isFinite(q) || q <= 0) {
        throw new AppError('INVALID_QTY', 'Every line must have a quantity greater than zero.', 400);
      }
    }

    const existing = await tx.invoice.findUnique({ where: { id: inv.id } });
    const isNewSale = !existing;
    const oldInvoice = existing;
    if (existing) {
      // A voided bill is final — it must not be edited back into a live sale that
      // adds phantom stock (SAL2-7).
      if (existing.isVoided) throw new AppError('VOIDED', 'A voided bill cannot be edited.', 400);
      // Branch and invoice number are immutable on edit: changing the branch
      // orphans the original branch's stock, and changing the number breaks the
      // sequence (SAL2-6).
      inv.branchId = existing.branchId;
      inv.invoiceNumber = existing.invoiceNumber;
    }
    if (isNewSale) inv.invoiceNumber = await nextInvoiceNumber(tx, inv.branchId, inv.date);
    const phoneClean = cleanPhone(inv.customerPhone);
    const ts = nowIso();

    // Customer link / update (never match by name alone to prevent merging distinct customers)
    const customers = await tx.customer.findMany();
    const cust =
      (inv.customerId && customers.find((c: any) => c.id === inv.customerId)) ||
      (phoneClean && customers.find((c: any) => cleanPhone(c.phone) === phoneClean)) ||
      null;

    // Customer this bill was previously linked to (edit path). If the edit moves
    // the bill to a different customer, the old one's totals must be reversed
    // (CRM2-12) — handled after the new link is applied below.
    const oldCustomerId = oldInvoice ? (oldInvoice.customerId || null) : null;

    if (cust) {
      inv.customerId = cust.id;
      // A reassigned edit is a fresh purchase for the newly-linked customer: don't
      // back out an old spend they never had, and do bump their purchase count.
      const movedFromAnother = !!oldInvoice && oldCustomerId !== cust.id;
      const oldSpent = oldInvoice && !movedFromAnother ? oldInvoice.grandTotal : 0;
      const newCount = isNewSale || movedFromAnother ? (cust.purchaseCount || 0) + 1 : cust.purchaseCount;
      const newSpent = Math.max(0, (cust.totalSpent || 0) - oldSpent + inv.grandTotal);
      await tx.customer.update({
        where: { id: cust.id },
        data: {
          // Do not silently overwrite customer master details with invoice inputs
          name: cust.name || inv.customerName || '',
          phone: cust.phone || inv.customerPhone || '',
          address: cust.address || inv.customerAddress || '',
          purchaseCount: newCount,
          totalSpent: newSpent,
          firstPurchaseDate: cust.firstPurchaseDate || inv.date,
          lastRewardRedeemedPurchaseCount: inv.isLoyaltyRewardApplied
            ? newCount
            : cust.lastRewardRedeemedPurchaseCount,
          updatedAt: ts,
        },
      });
    } else if (phoneClean || inv.customerId) {
      // Only create/link a customer master when there is a real phone or an explicit
      // customerId. A walk-in with no phone must NOT create a phone:'' record — the
      // phone column is unique, so the second such walk-in would 409 (SAL2-2). The
      // invoice still keeps customerName for display.
      const newCustId = inv.customerId || rid('cust');
      inv.customerId = newCustId;
      await tx.customer.create({
        data: {
          id: newCustId,
          name: (inv.customerName || 'Customer').trim(),
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
    } else {
      // Walk-in with no phone / no customerId: no customer master, display-only name.
      inv.customerId = null;
    }

    // Editing a bill onto a different customer: back the old invoice's contribution
    // off the previously-linked customer so its totals don't stay inflated (CRM2-12).
    if (oldCustomerId && oldCustomerId !== inv.customerId) {
      const oldCust = customers.find((c: any) => c.id === oldCustomerId);
      if (oldCust) {
        await tx.customer.update({
          where: { id: oldCustomerId },
          data: {
            purchaseCount: Math.max(0, (oldCust.purchaseCount || 1) - 1),
            totalSpent: Math.max(0, (oldCust.totalSpent || 0) - (oldInvoice.grandTotal || 0)),
            updatedAt: ts,
          },
        });
      }
    }

    // Branch stock: restore old invoice qty (edit), then validate and decrement new items
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

    // Authoritative stock shortage validation across standalone items and combo components
    const demand = new Map<string, { qty: number; name: string }>();
    for (const newItem of inv.items as any[]) {
      if (newItem.isCombo && newItem.comboComponents?.length) {
        for (const comp of newItem.comboComponents) {
          const needed = (comp.quantity || 0) * (newItem.quantity || 0);
          const cur = demand.get(comp.itemId) || { qty: 0, name: comp.itemName || 'Combo component' };
          demand.set(comp.itemId, { qty: cur.qty + needed, name: cur.name });
        }
      } else if (newItem.itemId) {
        const needed = newItem.quantity || 0;
        const cur = demand.get(newItem.itemId) || { qty: 0, name: newItem.itemName || 'Item' };
        demand.set(newItem.itemId, { qty: cur.qty + needed, name: cur.name });
      }
    }

    for (const [itemId, req] of demand.entries()) {
      const available = ledger.qty(itemId);
      if (available < req.qty) {
        throw new AppError(
          'INSUFFICIENT_STOCK',
          `Insufficient stock for "${req.name}" at this branch. Available: ${available}, Requested: ${req.qty}`,
          400
        );
      }
    }

    for (const [itemId, req] of demand.entries()) {
      ledger.apply(itemId, -req.qty, false);
    }
    await ledger.flush(tx);

    const { id, ...rest } = inv;
    await tx.invoice.upsert({ where: { id }, create: inv, update: rest });
    return snapshot(tx);
  });
}

/** Void an invoice: restore remaining stock, log, mark voided, decrement customer. */
export function voidInvoice(invoiceId: string, reason: string, actor: string, reqUser?: any) {
  return serializableTx(async (tx: any) => {
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new AppError('NOT_FOUND', 'Sale not found', 404);
    assertBranchAllowed(reqUser, inv.branchId); // SEC2-1
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

    // Reverse the customer's totals for exactly the bill's own linked customer.
    // Matching by phone/name could hit a different customer who happens to share a
    // phone and wrongly shrink their totals (CRM2-11), so key strictly on customerId.
    if (inv.customerId) {
      const cust = await tx.customer.findUnique({ where: { id: inv.customerId } });
      if (cust) {
        await tx.customer.update({
          where: { id: cust.id },
          data: {
            purchaseCount: Math.max(0, (cust.purchaseCount || 1) - 1),
            totalSpent: Math.max(0, (cust.totalSpent || 0) - inv.grandTotal),
            updatedAt: ts,
          },
        });
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
  actor: string,
  reqUser?: any
) {
  return serializableTx(async (tx: any) => {
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new AppError('NOT_FOUND', 'Sale not found', 404);
    assertBranchAllowed(reqUser, inv.branchId); // SEC2-1
    if (inv.isVoided) throw new AppError('VOIDED', 'Cannot return on a voided sale', 409);
    const validLines = (returnLines || []).filter((l: any) => l.returnQty > 0);
    if (!validLines.length) throw new AppError('NO_LINES', 'No return quantity specified', 400);

    // Cap each return to what was actually sold and not already returned, keyed by
    // item (or combo). Without this, returning more than sold — or an item never on
    // the bill — created stock from nothing (SAL2-4).
    const keyOf = (x: any) => (x.isCombo && x.comboId ? `combo:${x.comboId}` : (x.itemId || x.id));
    const soldByKey = new Map<string, number>();
    for (const it of (inv.items as any[]) || []) {
      soldByKey.set(keyOf(it), (soldByKey.get(keyOf(it)) || 0) + (Number(it.quantity) || 0));
    }
    const returnedByKey = new Map<string, number>();
    for (const r of (inv.returns as any[]) || []) {
      returnedByKey.set(keyOf(r), (returnedByKey.get(keyOf(r)) || 0) + (Number(r.returnedQuantity) || 0));
    }
    const batchByKey = new Map<string, number>();
    for (const line of validLines) {
      const key = keyOf(line);
      const sold = soldByKey.get(key) || 0;
      const already = returnedByKey.get(key) || 0;
      const batch = batchByKey.get(key) || 0;
      const want = Number(line.returnQty) || 0;
      if (sold <= 0) {
        throw new AppError('NOT_ON_BILL', `"${line.itemName || key}" was not sold on this bill and cannot be returned.`, 400);
      }
      if (already + batch + want > sold) {
        const remaining = Math.max(0, sold - already - batch);
        throw new AppError('OVER_RETURN', `Cannot return ${want} of "${line.itemName}" — only ${remaining} remaining to return.`, 400);
      }
      batchByKey.set(key, batch + want);
    }

    const ts = nowIso();
    // Business rule: damaged goods are written off, NOT added back to stock.
    const isDamaged = /damag/i.test(reason || '');
    const stockReason = isDamaged ? 'Sales Return (Damaged - Written Off)' : 'Sales Return';
    const items = await tx.item.findMany();
    const itemById = new Map(items.map((i: any) => [i.id, i]));
    const ledger = new StockLedger(await tx.branchStock.findMany(), inv.branchId);
    const newLogs: any[] = [];
    const returnRecords: any[] = [];

    // Server-authoritative refund per unit = the customer's actual per-unit
    // contribution to the bill: line value (after LINE discount, incl. tax)
    // minus this line's proportional share of the OVERALL discount. This makes
    // returns reflect discounts instead of refunding the raw undiscounted price.
    const invItems: any[] = (inv.items as any[]) || [];
    const subtotalTaxable =
      Number(inv.subtotal) || invItems.reduce((s, i) => s + (Number(i.taxableAmount) || 0), 0);
    const overallDisc = Number(inv.overallDiscountAmount) || 0;
    const perUnitRefund = (itemId: string, taxRate: number, fallbackUnitPrice: number): number => {
      const li = invItems.find((i) => (i.itemId || i.id) === itemId);
      if (!li) {
        // No stored line — fall back to unit price + tax (legacy behavior).
        return Math.round(fallbackUnitPrice * (1 + (Number(taxRate) || 0) / 100) * 100) / 100;
      }
      const q = Number(li.quantity) || 1;
      const lineTaxable = Number(li.taxableAmount) || 0;
      const lineNetWithTax =
        Number(li.totalAmount) || lineTaxable + (Number(li.totalTax) || 0);
      const overallShare = subtotalTaxable > 0 ? overallDisc * (lineTaxable / subtotalTaxable) : 0;
      const perUnit = (lineNetWithTax - overallShare) / q;
      return Math.max(0, Math.round(perUnit * 100) / 100);
    };
    const rawRefundFor = (line: any): number =>
      Math.round(perUnitRefund(line.itemId, line.taxRate, line.unitPrice) * line.returnQty * 100) / 100;

    // Ceiling: total refunds across ALL returns can never exceed the invoice's
    // grand total. If historical returns used a different (looser) calc, cap the
    // remaining refund and scale this batch's lines proportionally to fit.
    const refundCeiling = Math.max(0, (Number(inv.grandTotal) || 0) - (Number(inv.totalReturnedAmount) || 0));
    const rawBatchTotal = validLines.reduce((s: number, l: any) => s + rawRefundFor(l), 0);
    const refundScale = rawBatchTotal > refundCeiling && rawBatchTotal > 0 ? refundCeiling / rawBatchTotal : 1;
    const refundFor = (line: any): number => Math.round(rawRefundFor(line) * refundScale * 100) / 100;

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
          refundAmount: refundFor(line), returnedAt: ts, reason, notes, processedBy: actor,
          isCombo: true, comboId: line.comboId, comboComponents: line.comboComponents,
        });
      } else {
        // Only restore stock for real catalogue items. A typed service line (e.g.
        // "Installation Service Charge") has no catalogue item, so restocking it would
        // create phantom stock and a bogus log entry (SAL-14) — skip it.
        const isCatalogItem = itemById.has(line.itemId);
        const qtyToRestore = isDamaged || !isCatalogItem ? 0 : line.returnQty;
        if (isCatalogItem) {
          const { prevQty, newQty } = ledger.apply(line.itemId, qtyToRestore);
          newLogs.push({
            id: rid('adj'), itemId: line.itemId, itemName: line.itemName, itemCode: line.itemCode,
            branchId: inv.branchId, previousQuantity: prevQty, quantityChange: qtyToRestore,
            newQuantity: newQty, reason: stockReason,
            notes: `Sales Return on #${inv.invoiceNumber} - ${reason}${notes ? ` (${notes})` : ''}${isDamaged ? ' [damaged — not restocked]' : ''}`,
            adjustedBy: actor, timestamp: ts,
          });
        }
        returnRecords.push({
          id: rid('ret'), itemId: line.itemId, itemCode: line.itemCode, itemName: line.itemName,
          returnedQuantity: line.returnQty, unitPrice: line.unitPrice, taxRate: line.taxRate,
          refundAmount: refundFor(line), returnedAt: ts, reason, notes, processedBy: actor,
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
export function deleteInvoice(invoiceId: string, reqUser?: any) {
  return serializableTx(async (tx: any) => {
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (inv) {
      assertBranchAllowed(reqUser, inv.branchId); // SEC2-1
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
