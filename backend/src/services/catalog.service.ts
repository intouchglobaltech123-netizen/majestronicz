import { prisma } from '../db.js';
import { AppError } from '../middleware/errorHandler.js';
import { nowIso, cleanPhone } from '../lib/stockLedger.js';
import { nextEstimateNumber, nextChallanNumber, nextComboCode } from '../lib/sequences.js';
import { withRetry } from '../lib/retry.js';
import { calculateLineTax, calculateInvoiceTotals } from '../lib/taxCalc.js';

/**
 * Server-authoritative recompute of estimate line taxes + totals.
 * Mirrors the invoice recompute: honors per-line discounts, overall discount,
 * freight/shipping, and round-off so quotations keep the same money math as
 * sales (previously these adjustments were silently dropped).
 */
function recomputeEstimateMoney(est: any) {
  const withGst = !!est.withGst;
  est.items = (est.items || []).map((li: any) => {
    const rate = li.gstRate ?? li.taxRate ?? 0;
    const calc = calculateLineTax(li.quantity, li.unitPrice, rate, withGst, li.discountType || '%', li.discountValue ?? li.discount ?? 0);
    return { ...li, ...calc };
  });
  const totals = calculateInvoiceTotals(
    est.items, withGst, est.overallDiscountType || '%', est.overallDiscountValue || 0,
    est.shippingCharges || 0, est.roundOffEnabled !== false
  );
  est.subtotal = totals.subtotal;
  est.totalTax = totals.totalTax;
  est.totalCgst = totals.totalCgst;
  est.totalSgst = totals.totalSgst;
  est.overallDiscountAmount = totals.overallDiscountAmount;
  est.shippingCharges = totals.shippingCharges;
  est.roundOff = totals.roundOff;
  est.grandTotal = totals.grandTotal;
  est.amountInWords = totals.amountInWords;
  return est;
}

/** Create/edit estimate — new records get a server-assigned collision-free number. */
export function saveEstimate(data: any) {
  recomputeEstimateMoney(data); // server-authoritative totals
  return withRetry(() => prisma.$transaction(async (tx: any) => {
    const existing = data.id ? await tx.estimate.findUnique({ where: { id: data.id } }) : null;
    if (existing) {
      const { id, ...rest } = data;
      await tx.estimate.update({ where: { id }, data: rest });
    } else {
      const id = data.id || `est-${Date.now()}`;
      const estimateNumber = await nextEstimateNumber(tx, data.branchId, data.date);
      await tx.estimate.create({ data: { ...data, id, estimateNumber, createdAt: data.createdAt || nowIso() } });
    }
    return { estimates: await tx.estimate.findMany() };
  }));
}

export function deleteEstimate(id: string) {
  return prisma.$transaction(async (tx: any) => {
    await tx.estimate.deleteMany({ where: { id } });
    return { estimates: await tx.estimate.findMany() };
  });
}

export function saveChallan(data: any) {
  return withRetry(() => prisma.$transaction(async (tx: any) => {
    const existing = data.id ? await tx.deliveryChallan.findUnique({ where: { id: data.id } }) : null;
    if (existing) {
      const { id, ...rest } = data;
      await tx.deliveryChallan.update({ where: { id }, data: rest });
    } else {
      const id = data.id || `dc-${Date.now()}`;
      const challanNumber = await nextChallanNumber(tx);
      await tx.deliveryChallan.create({ data: { ...data, id, challanNumber, createdAt: data.createdAt || nowIso() } });
    }
    return { challans: await tx.deliveryChallan.findMany() };
  }));
}

export function deleteChallan(id: string) {
  return prisma.$transaction(async (tx: any) => {
    await tx.deliveryChallan.deleteMany({ where: { id } });
    return { challans: await tx.deliveryChallan.findMany() };
  });
}

export function saveCombo(data: any) {
  return withRetry(() => prisma.$transaction(async (tx: any) => {
    const ts = nowIso();
    const existing = data.id ? await tx.comboItem.findUnique({ where: { id: data.id } }) : null;
    if (existing) {
      const { id, ...rest } = data;
      await tx.comboItem.update({ where: { id }, data: { ...rest, updatedAt: ts } });
    } else {
      const id = data.id || `combo-${Date.now()}`;
      const comboCode = data.comboCode || (await nextComboCode(tx));
      await tx.comboItem.create({ data: { ...data, id, comboCode, createdAt: data.createdAt || ts, updatedAt: ts } });
    }
    return { combos: await tx.comboItem.findMany() };
  }));
}

export function deleteCombo(id: string) {
  return prisma.$transaction(async (tx: any) => {
    await tx.comboItem.deleteMany({ where: { id } });
    return { combos: await tx.comboItem.findMany() };
  });
}

/** Save customer with server-enforced phone uniqueness. */
export function saveCustomer(data: any) {
  return prisma.$transaction(async (tx: any) => {
    const phone = cleanPhone(data.phone);
    if (!phone) throw new AppError('PHONE_REQUIRED', 'Phone number is required', 400);
    if (!data.name?.trim()) throw new AppError('NAME_REQUIRED', 'Customer name is required', 400);

    const all = await tx.customer.findMany();
    const duplicate = all.find((c: any) => c.id !== data.id && cleanPhone(c.phone) === phone);
    if (duplicate) throw new AppError('DUPLICATE_PHONE', `A customer with phone ${data.phone} already exists (${duplicate.name})`, 409);

    const ts = nowIso();
    const existing = data.id ? await tx.customer.findUnique({ where: { id: data.id } }) : null;
    if (existing) {
      const { id, ...rest } = data;
      await tx.customer.update({ where: { id }, data: { ...rest, updatedAt: ts } });
    } else {
      const id = data.id || `cust-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      await tx.customer.create({
        data: {
          ...data, id,
          firstPurchaseDate: data.firstPurchaseDate || ts.split('T')[0],
          purchaseCount: data.purchaseCount ?? 0,
          totalSpent: data.totalSpent ?? 0,
          createdAt: ts, updatedAt: ts,
        },
      });
    }
    return { customers: await tx.customer.findMany() };
  });
}

export function deleteCustomer(id: string) {
  return prisma.$transaction(async (tx: any) => {
    await tx.customer.deleteMany({ where: { id } });
    return { customers: await tx.customer.findMany() };
  });
}
