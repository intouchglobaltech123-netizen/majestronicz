import React, { useState, useMemo, useEffect } from 'react';
import { Invoice } from '../../types';
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

  // Reset state when invoice changes
  useEffect(() => {
    if (invoice) {
      setReturnQuantities({});
      setReason(COMMON_REASONS[0]);
      setCustomReason('');
      setNotes('');
    }
  }, [invoice]);

  // Compute available quantities and refund calculations per line
  const linesWithReturnState = useMemo(() => {
    if (!invoice) return [];

    return invoice.items.map((item) => {
      const itemId = item.itemId || item.id;
      const alreadyReturned = (invoice.returns || [])
        .filter((r) => r.itemId === itemId)
        .reduce((sum, r) => sum + r.returnedQuantity, 0);

      const maxReturnable = Math.max(0, item.quantity - alreadyReturned);
      const currentReturnQty = Math.min(maxReturnable, returnQuantities[itemId] || 0);

      // Refund calculation including GST if applicable
      const baseRefund = currentReturnQty * item.unitPrice;
      const taxRefund = invoice.withGst ? (baseRefund * (item.taxRate || 0)) / 100 : 0;
      const totalRefund = baseRefund + taxRefund;

      return {
        ...item,
        itemId,
        alreadyReturned,
        maxReturnable,
        currentReturnQty,
        totalRefund,
      };
    });
  }, [invoice, returnQuantities]);

  const totalRefundAmount = useMemo(() => {
    return linesWithReturnState.reduce((sum, l) => sum + l.totalRefund, 0);
  }, [linesWithReturnState]);

  const totalUnitsToReturn = useMemo(() => {
    return linesWithReturnState.reduce((sum, l) => sum + l.currentReturnQty, 0);
  }, [linesWithReturnState]);

  if (!isOpen || !invoice) return null;

  const handleQtyChange = (itemId: string, qty: number, max: number) => {
    const valid = Math.max(0, Math.min(max, qty));
    setReturnQuantities((prev) => ({
      ...prev,
      [itemId]: valid,
    }));
  };

  const handleSetAllMax = () => {
    const allMax: Record<string, number> = {};
    linesWithReturnState.forEach((l) => {
      allMax[l.itemId] = l.maxReturnable;
    });
    setReturnQuantities(allMax);
  };

  const handleClearAll = () => {
    setReturnQuantities({});
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
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

    processSaleReturn(invoice.id, returnLinesPayload, effectiveReason, notes);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
              <RotateCcw className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-extrabold text-slate-900">
                  Process Sales Return
                </h2>
                <span className="text-xs font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                  {invoice.invoiceNumber}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Line-item stock reversal • Physical units will be restored to warehouse
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/60 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Sale Summary Strip */}
        <div className="px-6 py-3 bg-blue-50/60 border-b border-blue-100 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-4 text-slate-700">
            <div>
              <span className="text-slate-400 block text-[11px] uppercase font-bold">Customer</span>
              <span className="font-bold text-slate-900">{invoice.customerName}</span>
            </div>
            <div className="border-l border-blue-200 pl-4">
              <span className="text-slate-400 block text-[11px] uppercase font-bold">Branch</span>
              <span className="font-bold uppercase font-mono text-blue-800">{invoice.branchId}</span>
            </div>
            <div className="border-l border-blue-200 pl-4">
              <span className="text-slate-400 block text-[11px] uppercase font-bold">Sale Date</span>
              <span className="font-medium text-slate-800">{invoice.date}</span>
            </div>
            <div className="border-l border-blue-200 pl-4">
              <span className="text-slate-400 block text-[11px] uppercase font-bold">Original Total</span>
              <span className="font-bold font-mono text-slate-900">{formatCurrency(invoice.grandTotal)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSetAllMax}
              className="text-[11px] font-bold text-blue-700 hover:text-blue-800 bg-blue-100 hover:bg-blue-200 px-2.5 py-1 rounded-lg transition-colors"
            >
              Return All
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              className="text-[11px] font-semibold text-slate-600 hover:text-slate-800 bg-white border border-slate-200 px-2.5 py-1 rounded-lg transition-colors"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Table of items */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
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
                            <span className="px-1.5 py-0.2 rounded text-[11px] font-bold bg-purple-100 text-purple-700 border border-purple-200 uppercase">
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
                          <span className="text-amber-700 font-bold bg-amber-50 px-1.5 py-0.5 rounded text-[11px]">
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
                              onClick={() => handleQtyChange(line.itemId, line.currentReturnQty - 1, line.maxReturnable)}
                              disabled={line.currentReturnQty <= 0}
                              className="p-1 rounded-md bg-slate-100 hover:bg-slate-200 disabled:opacity-30 transition-colors"
                            >
                              <Minus className="h-3 w-3" />
                            </button>

                            <input
                              type="number"
                              min="0"
                              max={line.maxReturnable}
                              value={line.currentReturnQty}
                              onChange={(e) => handleQtyChange(line.itemId, parseInt(e.target.value) || 0, line.maxReturnable)}
                              className="w-14 text-center py-1 border border-slate-300 rounded-md font-mono font-bold text-slate-900 text-xs focus:outline-none focus:border-blue-600"
                            />

                            <button
                              type="button"
                              onClick={() => handleQtyChange(line.itemId, line.currentReturnQty + 1, line.maxReturnable)}
                              disabled={line.currentReturnQty >= line.maxReturnable}
                              className="p-1 rounded-md bg-slate-100 hover:bg-slate-200 disabled:opacity-30 transition-colors"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 text-right font-mono font-medium">
                        {formatCurrency(line.unitPrice)}
                        {invoice.withGst && line.taxRate ? (
                          <span className="block text-[11px] text-slate-400">+{line.taxRate}% GST</span>
                        ) : null}
                      </td>

                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                        {formatCurrency(line.totalRefund)}
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
                className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-600"
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
                  className="w-full mt-2 px-3 py-1.5 rounded-xl bg-white border border-slate-300 text-xs text-slate-900 focus:outline-none focus:border-blue-600"
                />
              )}
              {/damag/i.test(reason) && (
                <p className="mt-2 flex items-start gap-1.5 text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">
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
                className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>

          {/* Refund Total Summary Callout */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                <DollarSign className="h-5 w-5" />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-800">
                  Total Refund & Reversal Value
                </span>
                <p className="text-[11px] text-slate-500">
                  {totalUnitsToReturn} unit(s) selected for return to {invoice.branchId} stock
                </p>
              </div>
            </div>

            <div className="text-right font-mono">
              <div className="text-2xl font-black text-emerald-700">
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
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={totalUnitsToReturn <= 0}
              className="px-5 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl shadow-xs transition-colors flex items-center gap-1.5"
            >
              <PackageCheck className="h-4 w-4" />
              <span>Confirm Return ({totalUnitsToReturn} Units)</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
