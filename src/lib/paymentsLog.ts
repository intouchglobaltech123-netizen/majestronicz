import { Invoice, Payment, PurchaseOrder, PendingOrder, DailyCashRegister, getInvoicePaymentSplits, expenseIsEffective, BANK_DEPOSIT_CATEGORY } from '../types';

export type PayRow = {
  date: string;
  direction: 'IN' | 'OUT';
  type: string;
  party: string;
  mode: string;
  amount: number;
  ref: string;
  branchId: string;
};

/**
 * Payments log: every rupee in (bills' at-billing collections, receipts,
 * advances) and out (refunds, vendor payments, salaries, expenses), for a date
 * range and branch scope, newest first. Pure, so the suite can test it.
 */
export function buildPaymentsLog(args: {
  invoices: Invoice[];
  payments: Payment[];
  purchaseOrders: PurchaseOrder[];
  pendingOrders: PendingOrder[];
  cashRegisters: DailyCashRegister[];
  startDate?: string;
  endDate?: string;
  branchScope: string;
}): PayRow[] {
  const { invoices, payments, purchaseOrders, pendingOrders, cashRegisters, startDate, endDate, branchScope } = args;
  const out: PayRow[] = [];

  // POs that already have a real vendor Payment 'out' row — their payments must
  // NOT also be emitted from po.payments, or each vendor payment is counted
  // twice (recordPurchaseOrderPayment writes BOTH a Payment row and a po.payments
  // entry). CRM6-9 / "Payments Log lists each vendor payment twice".
  const vendorPaidPoIds = new Set<string>();
  payments.forEach((p: any) => {
    if (p.type !== 'out' || p.partyType !== 'vendor') return;
    (p.allocations || []).forEach((a: any) => a?.refId && vendorPaidPoIds.add(a.refId));
  });

  // Sales receipts (money IN) — what each bill took on its own day, per mode
  // (skip the COD-Credit part, which is still owed).
  invoices.forEach((inv: any) => {
    if (inv.isVoided) return;
    getInvoicePaymentSplits(inv).forEach((s) => {
      if (!s.amount || s.mode === 'COD-Credit') return;
      out.push({
        date: inv.date, direction: 'IN', type: 'Sale receipt', party: inv.customerName,
        mode: s.mode, amount: Number(s.amount) || 0, ref: inv.invoiceNumber, branchId: inv.branchId,
      });
    });
    // Refunds come ONLY from refund Payment rows (below), on the day and in the
    // mode they were paid. A return on a credit bill (it just cut the debt) or
    // one adjusted to a credit note paid nothing back, and older returns were
    // given their refund rows by the one-time data fix — so nothing is
    // synthesised from the bill's returned amount any more (RPT8-2 / RPT3-7).
  });

  // Party-ledger payments — customer receipts / refunds (type 'in'/'out' on a
  // customer) & vendor payments (type 'out' on a vendor).
  payments.forEach((p: any) => {
    const amount = Number(p.amount) || 0;
    if (!amount) return;
    // A 'Store Credit' receipt spends money already received (an advance or an
    // over-payment logged when it came in) — listing it again double-counts it.
    if (p.type === 'in' && /store\s*credit/i.test(p.paymentMode || '')) return;
    const type =
      p.type === 'in'
        ? (String(p.notes || '').startsWith('Advance on pending order') ? 'Advance' : 'Customer receipt')
        : p.partyType === 'customer' ? 'Sale refund' : p.partyType === 'staff' ? 'Salary' : 'Vendor payment';
    out.push({
      date: (p.date || p.createdAt || '').slice(0, 10),
      direction: p.type === 'in' ? 'IN' : 'OUT',
      type,
      party: p.partyName,
      mode: p.paymentMode || 'Cash',
      amount,
      ref: p.receiptNumber,
      branchId: p.branchId,
    });
  });

  // Advance payments on pending orders (money IN)
  // Only LEGACY advances (taken before advances became real receipts) — a
  // current advance is a Payment row above, and listing both double-counts it
  // (CRM2-8).
  const advanceRefs = new Set(
    payments.filter((p: any) => p.type === 'in' && String(p.notes || '').startsWith('Advance on pending order')).map((p: any) => p.reference),
  );
  pendingOrders.forEach((po: any) => {
    if (!po.advanceAmount || po.advanceAmount <= 0) return;
    if (advanceRefs.has(po.orderNumber)) return;
    out.push({
      date: (po.advancePaidAt || po.createdAt || '').slice(0, 10), direction: 'IN', type: 'Advance',
      party: po.customerName, mode: po.advanceMode || 'Cash', amount: po.advanceAmount,
      ref: po.orderNumber, branchId: po.branchId,
    });
  });

  // Vendor payments (money OUT) — only for POs WITHOUT a real Payment 'out' row
  // (legacy payments recorded before the ledger existed); the rest come from the
  // Payment rows above, so emitting both would double-count them.
  purchaseOrders.forEach((po: any) => {
    if (vendorPaidPoIds.has(po.id)) return;
    (po.payments || []).forEach((p: any) => {
      out.push({
        date: p.date, direction: 'OUT', type: 'Vendor payment', party: po.vendorName,
        mode: p.mode || 'Cash', amount: Number(p.amount) || 0, ref: po.poNumber, branchId: po.branchId,
      });
    });
  });

  // Expenses (money OUT) — cash & gpay logged separately. Only EFFECTIVE expenses
  // hit the drawer; skip pending / rejected bank deposits (they aren't money out yet).
  cashRegisters.forEach((reg: any) => {
    (reg.expenses || []).forEach((e: any) => {
      if (!expenseIsEffective(e)) return;
      // A bank deposit moves drawer cash to the bank: shown, but labelled as such.
      const type = e.category === BANK_DEPOSIT_CATEGORY ? 'Bank deposit' : 'Expense';
      if (e.cashAmount > 0) out.push({ date: reg.date, direction: 'OUT', type, party: `${e.category ? e.category + ' · ' : ''}${e.reason}`, mode: 'Cash', amount: e.cashAmount, ref: '', branchId: reg.branchId });
      if (e.gpayAmount > 0) out.push({ date: reg.date, direction: 'OUT', type, party: `${e.category ? e.category + ' · ' : ''}${e.reason}`, mode: 'GPay', amount: e.gpayAmount, ref: '', branchId: reg.branchId });
    });
  });

  return out
    .filter((r) => {
      if (startDate && r.date < startDate) return false;
      if (endDate && r.date > endDate) return false;
      if (branchScope !== 'all' && r.branchId !== branchScope) return false;
      return true;
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}
