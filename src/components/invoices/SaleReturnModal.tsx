import React, { useState, useMemo, useEffect } from 'react';
import { REFUND_MODES, PAYMENT_MODE_LABEL } from '../../lib/paymentModes';
import { Invoice, getInvoicePaymentSplits, BRANCHES } from '../../types';
import { isWholeUnit } from '../../lib/units';
import { useErp } from '../../context/ErpContext';
import { formatCurrency } from '../../lib/utils';
import {
  X,
  RotateCcw,
  PackageCheck,
  DollarSign,
  Plus,
  Minus,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  invoice: Invoice | null;
  isOpen: boolean;
  onClose: () => void;
}

const COMMON_REASONS = [
  'Customer Return / Change of Mind',
  'Defective / Damaged Goods',
  'Wrong Item Ordered',
  'Customer Exchange',
  'Order Cancellation',
  'Other',
];

export const SaleReturnModal: React.FC<Props> = ({ invoice, isOpen, onClose }) => {
  const { processSaleReturn } = useErp();

  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState(COMMON_REASONS[0]);
  const [customReason, setCustomReason] = useState('');
  const [notes, setNotes] = useState('');
  // How the refund was paid back — a Cash refund leaves the cash drawer today; GPay/Card does not.
  // CASH8-6: default to how the bill itself was paid (its first collected mode),
  // not always Cash.
  const billRefundMode = (inv: Invoice | null | undefined): string => {
    const m = inv ? getInvoicePaymentSplits(inv).find((s) => s.mode !== 'COD-Credit' && (Number(s.amount) || 0) > 0)?.mode : undefined;
    return m && (REFUND_MODES as readonly string[]).includes(m) ? m : 'Cash';
  };
  const [refundMode, setRefundMode] = useState<string>(() => billRefundMode(invoice));
  // G2: lock the submit while the return is saving so a double-click on a slow
  // connection can't book two returns / two cash refunds.
  const [submitting, setSubmitting] = useState(false);

  // Reset state when invoice changes
  useEffect(() => {
    if (invoice) {
      setReturnQuantities({});
      setReason(COMMON_REASONS[0]);
      setCustomReason('');
      setNotes('');
      setRefundMode(billRefundMode(invoice));
    }
  }, [invoice]);

  // Compute available quantities and refund calculations per line
  const linesWithReturnState = useMemo(() => {
    if (!invoice) return [];

    // Refund the customer's ACTUAL per-unit contribution: the line value after
    // its line discount (incl. GST) minus this line's proportional share of the
    // overall discount — so returns reflect discounts, not the raw list price.
    const subtotalTaxable =
      invoice.subtotal || invoice.items.reduce((s, i) => s + (i.taxableAmount || 0), 0);
    const overallDisc = invoice.overallDiscountAmount || 0;
    // E2E10-5 / RPT10-3: the server's own rule — the bill discount comes off the
    // taxable value and GST is on what is left, so a line's share is its value
    // incl. GST times the bill's net ratio.
    const netRatio = subtotalTaxable > 0 ? Math.max(0, subtotalTaxable - overallDisc) / subtotalTaxable : 1;

    // SAL-15: the boxes are keyed by LINE, not by item — the same item on two
    // lines used to share one box. What was already returned of an item is
    // shared out over its lines in order, so each line knows what is left on it.
    const returnedLeft = new Map<string, number>();
    for (const r of invoice.returns || []) {
      const k = r.isCombo && r.comboId ? `c:${r.comboId}` : r.itemId;
      returnedLeft.set(k, (returnedLeft.get(k) || 0) + (r.returnedQuantity || 0));
    }

    // SAL9-6: the server refunds an item sold on several lines at the AVERAGE
    // per-unit value of those lines — the preview does the same.
    const unitValue = (it: typeof invoice.items[number]) => {
      const lt = it.taxableAmount || 0;
      const net = it.totalAmount || lt + (it.totalTax || 0);
      return (net * netRatio) / (it.quantity || 1);
    };
    const avgByItem = new Map<string, number>();
    {
      const sums = new Map<string, { v: number; q: number }>();
      for (const it of invoice.items) {
        if (it.isCombo) continue;
        const k = it.itemId || it.id;
        const cur = sums.get(k) || { v: 0, q: 0 };
        sums.set(k, { v: cur.v + unitValue(it) * (it.quantity || 0), q: cur.q + (it.quantity || 0) });
      }
      for (const [k, { v, q }] of sums) avgByItem.set(k, q > 0 ? v / q : 0);
    }

    return invoice.items.map((item) => {
      const itemId = item.itemId || item.id;
      const key = item.isCombo && item.comboId ? `c:${item.comboId}` : itemId;
      const pool = returnedLeft.get(key) || 0;
      const alreadyReturned = Math.min(item.quantity || 0, pool);
      returnedLeft.set(key, pool - alreadyReturned);

      const maxReturnable = Math.max(0, item.quantity - alreadyReturned);
      const currentReturnQty = Math.min(maxReturnable, returnQuantities[item.id] || 0);

      const perUnitRaw = !item.isCombo && avgByItem.has(itemId) ? avgByItem.get(itemId)! : unitValue(item);
      const perUnitRefund = Math.max(0, Math.round(perUnitRaw * 100) / 100);
      // INV9-1: whole-unit items and kits come back in whole units.
      const wholeUnits = !!item.isCombo || isWholeUnit(item.unit);
      const totalRefund = Math.round(perUnitRefund * currentReturnQty * 100) / 100;

      return {
        ...item,
        lineId: item.id,
        itemId,
        alreadyReturned,
        maxReturnable,
        currentReturnQty,
        perUnitRefund,
        totalRefund,
        wholeUnits,
      };
    });
  }, [invoice, returnQuantities]);

  const round2 = (n: number) => Math.round(n * 100) / 100;

  // Amount already refunded on this invoice from prior returns
  const totalReturnedAmount = useMemo(() => {
    return (invoice?.returns || []).reduce((sum, r) => sum + (r.refundAmount || 0), 0);
  }, [invoice]);

  // Raw (uncapped) sum of the per-line refunds selected in this session
  const rawTotalRefund = useMemo(() => {
    return linesWithReturnState.reduce((sum, l) => sum + l.totalRefund, 0);
  }, [linesWithReturnState]);

  // Cap refunds to the remaining (unreturned) invoice value, then derive a
  // uniform scale so each displayed per-line refund sums exactly to the summary.
  const refundScale = useMemo(() => {
    if (!invoice) return 1;
    const ceiling = Math.max(0, invoice.grandTotal - totalReturnedAmount);
    // E2E10-5: like the server, a return that takes back everything left on the
    // bill returns the whole remaining value — its round-off included.
    const takesAll = !(Number(invoice.shippingCharges) > 0) && linesWithReturnState.length > 0
      && linesWithReturnState.every((l) => l.alreadyReturned + l.currentReturnQty >= (l.quantity || 0) - 1e-9);
    return rawTotalRefund > 0 && (rawTotalRefund > ceiling || (takesAll && Math.abs(rawTotalRefund - ceiling) < 1)) ? ceiling / rawTotalRefund : 1;
  }, [invoice, rawTotalRefund, totalReturnedAmount, linesWithReturnState]);

  // Each row's refund as the server books it: scaled and rounded per line, and
  // when the return takes back everything left, the paisa left by that
  // rounding goes on the last line (E2E9-5) — so the preview equals what is
  // booked (FIN-E-4: ₹27,499.99 shown, ₹27,500 booked).
  const rowRefund = useMemo(() => {
    const m = new Map<string, number>();
    const picked = linesWithReturnState.filter((l) => l.totalRefund > 0);
    for (const l of picked) m.set(l.lineId, round2(l.totalRefund * refundScale));
    if (invoice && refundScale !== 1 && picked.length) {
      const ceiling = Math.max(0, invoice.grandTotal - totalReturnedAmount);
      const sum = [...m.values()].reduce((t, v) => t + v, 0);
      const takesAll = linesWithReturnState.every((l) => l.alreadyReturned + l.currentReturnQty >= (l.quantity || 0) - 1e-9);
      if (takesAll && Math.abs(ceiling - sum) < 1) {
        const last = picked[picked.length - 1].lineId;
        m.set(last, round2((m.get(last) || 0) + (ceiling - sum)));
      }
    }
    return m;
  }, [linesWithReturnState, refundScale, invoice, totalReturnedAmount]);

  // Summary uses the same scale + rounding as the displayed rows so they reconcile
  const totalRefundAmount = useMemo(() => {
    return round2([...rowRefund.values()].reduce((sum, v) => sum + v, 0));
  }, [rowRefund]);

  const totalUnitsToReturn = useMemo(() => {
    return linesWithReturnState.reduce((sum, l) => sum + l.currentReturnQty, 0);
  }, [linesWithReturnState]);

  if (!isOpen || !invoice) return null;

  const handleQtyChange = (lineId: string, qty: number, max: number, whole = true) => {
    const n = Number.isFinite(qty) ? (whole ? Math.floor(qty) : qty) : 0;
    const valid = Math.max(0, Math.min(max, n));
    setReturnQuantities((prev) => ({
      ...prev,
      [lineId]: valid,
    }));
  };

  const handleSetAllMax = () => {
    const allMax: Record<string, number> = {};
    linesWithReturnState.forEach((l) => {
      allMax[l.lineId] = l.maxReturnable;
    });
    setReturnQuantities(allMax);
  };

  const handleClearAll = () => {
    setReturnQuantities({});
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return; // G2: ignore a repeat click while the first is saving
    if (totalUnitsToReturn <= 0) {
      toast.error('Please select at least 1 unit to return.');
      return;
    }

    const effectiveReason = reason === 'Other' ? (customReason.trim() || 'Other') : reason;

    const returnLinesPayload = linesWithReturnState
      .filter((l) => l.currentReturnQty > 0)
      .map((l) => ({
        itemId: l.itemId,
        itemCode: l.itemCode || '',
        itemName: l.itemName,
        returnQty: l.currentReturnQty,
        unitPrice: l.unitPrice,
        taxRate: l.taxRate || 0,
        refundAmount: l.totalRefund,
        isCombo: l.isCombo,
        comboId: l.comboId,
        comboComponents: l.comboComponents,
      }));

    // Damaged goods are written off from STOCK, but the customer is still owed
    // their money — the refund mode applies to every return (CASH7-7 / E2E8-11).
    // Close only once the server accepted it; a refused return keeps the form.
    setSubmitting(true);
    void processSaleReturn(invoice.id, returnLinesPayload, effectiveReason, notes, refundMode)
      .then((ok) => { if (ok) onClose(); })
      .finally(() => setSubmitting(false));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto">
      <div className="bg-white border border-slate-300 rounded-none w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-none bg-red-50 text-red-700 border border-red-200 flex items-center justify-center font-bold">
              <RotateCcw className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-extrabold text-slate-900">
                  Process Sales Return
                </h2>
                <span className="text-xs font-mono font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded-none border border-red-200">
                  {invoice.invoiceNumber}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {/damag/i.test(reason)
                  ? 'Line-item return • Damaged units are written off, not restocked'
                  : 'Line-item return • Undamaged units go back into branch stock'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-none hover:bg-slate-200/60 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Sale Summary Strip */}
        <div className="px-6 py-3 bg-slate-100 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-4 text-slate-700">
            <div>
              <span className="text-slate-400 block text-[11px] uppercase font-bold">Customer</span>
              <span className="font-bold text-slate-900">{invoice.customerName}</span>
            </div>
            <div className="border-l border-slate-300 pl-4">
              <span className="text-slate-400 block text-[11px] uppercase font-bold">Branch</span>
              <span className="font-bold text-slate-800">{BRANCHES.find((b) => b.id === invoice.branchId)?.name || invoice.branchId}</span>
            </div>
            <div className="border-l border-slate-300 pl-4">
              <span className="text-slate-400 block text-[11px] uppercase font-bold">Sale Date</span>
              <span className="font-medium text-slate-800">{invoice.date}</span>
            </div>
            <div className="border-l border-slate-300 pl-4">
              <span className="text-slate-400 block text-[11px] uppercase font-bold">Original Total</span>
              <span className="font-bold font-mono text-slate-900">{formatCurrency(invoice.grandTotal)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSetAllMax}
              className="text-[11px] font-bold text-red-700 hover:text-red-800 bg-red-100 hover:bg-red-200 px-2.5 py-1 rounded-none border border-red-200 transition-colors cursor-pointer"
            >
              Return All
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              className="text-[11px] font-semibold text-slate-600 hover:text-slate-800 bg-white border border-slate-200 px-2.5 py-1 rounded-none transition-colors cursor-pointer"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Table of items */}
          <div className="border border-slate-200 rounded-none overflow-hidden">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[11px] tracking-wider">
                  <th className="py-2.5 px-3">Item Details</th>
                  <th className="py-2.5 px-3 text-center">Billed Qty</th>
                  <th className="py-2.5 px-3 text-center">Prev. Returned</th>
                  <th className="py-2.5 px-3 text-center">Return Qty</th>
                  <th className="py-2.5 px-3 text-right">Price / Unit</th>
                  <th className="py-2.5 px-3 text-right">Refund Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {linesWithReturnState.map((line) => {
                  const isFullyReturned = line.maxReturnable === 0;

                  return (
                    <tr
                      key={line.id}
                      className={isFullyReturned ? 'bg-slate-50/70 text-slate-400' : 'hover:bg-slate-50/40'}
                    >
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-slate-900">{line.itemName}</span>
                          {line.isCombo && (
                            <span className="px-1.5 py-0.2 rounded-none text-[11px] font-bold bg-slate-100 text-slate-800 border border-slate-300 uppercase">
                              Combo
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                          Code: {line.itemCode || '—'} {line.itemHSN ? `• HSN: ${line.itemHSN}` : ''}
                        </div>
                      </td>

                      <td className="py-3 px-3 text-center font-mono font-semibold">
                        {line.quantity} {line.unit}
                      </td>

                      <td className="py-3 px-3 text-center font-mono">
                        {line.alreadyReturned > 0 ? (
                          <span className="text-amber-700 font-bold bg-amber-50 px-1.5 py-0.5 rounded-none border border-amber-200 text-[11px]">
                            {line.alreadyReturned} {line.unit}
                          </span>
                        ) : (
                          <span className="text-slate-400">0</span>
                        )}
                      </td>

                      <td className="py-3 px-3">
                        {isFullyReturned ? (
                          <span className="text-[11px] font-bold text-slate-400 block text-center">
                            Fully Returned
                          </span>
                        ) : (
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleQtyChange(line.lineId, line.currentReturnQty - 1, line.maxReturnable, line.wholeUnits)}
                              disabled={line.currentReturnQty <= 0}
                              className="p-1 rounded-none bg-slate-100 hover:bg-slate-200 border border-slate-300 disabled:opacity-30 transition-colors"
                            >
                              <Minus className="h-3 w-3" />
                            </button>

                            <input
                              type="number"
                              min="0"
                              step={line.wholeUnits ? 1 : 'any'}
                              max={line.maxReturnable}
                              value={line.currentReturnQty}
                              aria-label={`Quantity of ${line.itemName} to return`}
                              onChange={(e) => handleQtyChange(line.lineId, Number(e.target.value) || 0, line.maxReturnable, line.wholeUnits)}
                              className="w-14 text-center py-1 border border-slate-300 rounded-none font-mono font-bold text-slate-900 text-xs focus:outline-none focus:border-red-600"
                            />

                            <button
                              type="button"
                              onClick={() => handleQtyChange(line.lineId, line.currentReturnQty + 1, line.maxReturnable, line.wholeUnits)}
                              disabled={line.currentReturnQty >= line.maxReturnable}
                              className="p-1 rounded-none bg-slate-100 hover:bg-slate-200 border border-slate-300 disabled:opacity-30 transition-colors"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 text-right font-mono font-medium">
                        {/* FIN-E-4: the unit price as billed — after the line's own discount */}
                        {formatCurrency(round2((Number(line.taxableAmount) || (line.unitPrice || 0) * (line.quantity || 0)) / (line.quantity || 1)))}
                        {invoice.withGst && line.taxRate ? (
                          <span className="block text-[11px] text-slate-400">+{line.taxRate}% GST</span>
                        ) : null}
                        {/* E2E10-5: what one unit gives back, after its discounts and GST — rounded like the row total */}
                        <span className="block text-[11px] text-slate-500" title="Refund for one unit: after the line and bill discounts, incl. GST">
                          net {formatCurrency(line.currentReturnQty > 0 ? round2((rowRefund.get(line.lineId) || 0) / line.currentReturnQty) : round2(line.perUnitRefund * refundScale))} / unit
                        </span>
                      </td>

                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                        {formatCurrency(rowRefund.get(line.lineId) || 0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Reason and Notes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">
                Return Reason <span className="text-rose-500">*</span>
              </label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2 rounded-none bg-slate-50 border border-slate-300 text-xs font-semibold text-slate-800 focus:outline-none focus:border-red-600"
              >
                {COMMON_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>

              {reason === 'Other' && (
                <input
                  type="text"
                  placeholder="Specify other reason..."
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  required
                  className="w-full mt-2 px-3 py-1.5 rounded-none bg-white border border-slate-300 text-xs text-slate-900 focus:outline-none focus:border-red-600"
                />
              )}
              {/damag/i.test(reason) && (
                <p className="mt-2 flex items-start gap-1.5 text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-none px-2.5 py-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  Damaged goods are written off — the returned quantity will NOT be added back to stock.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">
                Internal Audit Notes (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Returned with box & accessories, verified undamaged..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 rounded-none bg-slate-50 border border-slate-300 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-red-600"
              />
            </div>

            {/* How the refund was paid back — recorded on the ledger; a Cash
                refund leaves the drawer today (SAL6-1). Shown for damaged returns
                too: the goods are written off, but the customer is refunded the
                same way (CASH7-7 / E2E8-11). */}
            {(
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700">Refund paid by</label>
                <select
                  value={refundMode}
                  onChange={(e) => setRefundMode(e.target.value)}
                  className="w-full px-3 py-2 rounded-none bg-white border border-slate-300 text-xs font-semibold text-slate-900 focus:outline-none focus:border-red-600"
                >
                  {REFUND_MODES.map((m) => (
                    <option key={m} value={m}>{m === 'Cash' ? 'Cash (leaves the drawer)' : PAYMENT_MODE_LABEL[m] || m}</option>
                  ))}
                  <option value="Adjust">Adjusted to credit note</option>
                </select>
              </div>
            )}
          </div>

          {/* Refund Total Summary Callout */}
          <div className="p-4 rounded-none bg-slate-50 border border-slate-300 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-none">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-none bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center justify-center font-bold">
                <DollarSign className="h-5 w-5" />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-800">
                  Total Return Value
                </span>
                <p className="text-[11px] text-slate-500">
                  {/damag/i.test(reason)
                    ? `${totalUnitsToReturn} unit(s) selected — damaged, written off (no stock added)`
                    : `${totalUnitsToReturn} unit(s) selected for return to ${BRANCHES.find((b) => b.id === invoice.branchId)?.name || invoice.branchId} stock`}
                </p>
                <p className="text-[11px] text-slate-500">
                  Reduces what the customer owes first; only an over-paid amount is refunded.
                </p>
              </div>
            </div>

            <div className="text-right font-mono">
              <div className="text-xl sm:text-2xl font-bold text-emerald-700">
                {formatCurrency(totalRefundAmount)}
              </div>
              <span className="text-[11px] text-slate-400">
                {invoice.withGst ? 'Including GST' : 'Non-GST'}
              </span>
            </div>
          </div>

          {/* Action Footer */}
          <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-none border border-slate-300 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={totalUnitsToReturn <= 0 || submitting}
              className="px-5 py-2.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-none border border-red-700 shadow-none transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <PackageCheck className="h-4 w-4" />
              <span>{submitting ? 'Processing…' : `Confirm Return (${totalUnitsToReturn} Units)`}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
