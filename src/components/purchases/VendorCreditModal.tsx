import React, { useMemo } from 'react';
import { X, HandCoins, FileText } from 'lucide-react';
import { useErp } from '../../context/ErpContext';
import { formatCurrency } from '../../lib/utils';
import { PurchaseOrder } from '../../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

/** Debit-note (damaged/rejected goods) total billed back to the vendor. */
const debitTotal = (po: PurchaseOrder): number =>
  (po.debitNotes || []).reduce((s, dn) => s + (dn.totalAmount || 0), 0);

/**
 * Vendor credit on a PO = money the shop has ALREADY paid beyond the value of the
 * goods it actually kept. It arises when the shop advance-pays and some units
 * arrive damaged (billed back as a debit note): credit = paid − (total − debit).
 */
export const vendorCreditOnPo = (po: PurchaseOrder): number =>
  Math.max(0, (po.amountPaid || 0) + debitTotal(po) - (po.totalAmount || 0));

export const VendorCreditModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { purchaseOrders } = useErp();

  const byVendor = useMemo(() => {
    const groups = new Map<string, { vendorName: string; pos: PurchaseOrder[]; total: number }>();
    for (const po of purchaseOrders) {
      if (po.status === 'Cancelled') continue;
      const credit = vendorCreditOnPo(po);
      if (credit <= 0.5) continue;
      const key = po.vendorId || po.vendorName || 'unknown';
      const g = groups.get(key) || { vendorName: po.vendorName || 'Unknown supplier', pos: [], total: 0 };
      g.pos.push(po);
      g.total += credit;
      groups.set(key, g);
    }
    return Array.from(groups.values()).sort((a, b) => b.total - a.total);
  }, [purchaseOrders]);

  const grandTotal = byVendor.reduce((s, g) => s + g.total, 0);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-emerald-50/60 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center border border-emerald-200">
              <HandCoins className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Vendor Credit</h2>
              <p className="text-xs text-slate-500">Money suppliers owe back (advance paid on units that arrived damaged)</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-slate-200 flex items-center justify-between bg-white shrink-0">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total credit receivable</span>
          <span className="text-2xl font-bold font-mono text-emerald-700">{formatCurrency(grandTotal)}</span>
        </div>

        <div className="overflow-y-auto p-4 space-y-4">
          {byVendor.length === 0 ? (
            <div className="text-center text-slate-500 py-10 text-sm">No vendor credits. Damaged goods on advance-paid POs will appear here.</div>
          ) : (
            byVendor.map((g) => (
              <div key={g.vendorName} className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                  <span className="font-bold text-slate-800 text-sm">{g.vendorName}</span>
                  <span className="font-mono font-bold text-emerald-700 text-sm">{formatCurrency(g.total)}</span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                      <th className="text-left font-semibold py-2 px-4">PO</th>
                      <th className="text-right font-semibold py-2 px-3">Total</th>
                      <th className="text-right font-semibold py-2 px-3">Paid</th>
                      <th className="text-right font-semibold py-2 px-3">Damaged (billed back)</th>
                      <th className="text-right font-semibold py-2 px-4">Credit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {g.pos.map((po) => (
                      <tr key={po.id}>
                        <td className="py-2 px-4">
                          <span className="font-mono font-semibold text-slate-800 flex items-center gap-1.5">
                            <FileText className="h-3.5 w-3.5 text-slate-400" />{po.poNumber}
                          </span>
                          <span className="text-[11px] text-slate-400">{po.date}</span>
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-600">{formatCurrency(po.totalAmount || 0)}</td>
                        <td className="py-2 px-3 text-right font-mono text-slate-600">{formatCurrency(po.amountPaid || 0)}</td>
                        <td className="py-2 px-3 text-right font-mono text-rose-600">{formatCurrency(debitTotal(po))}</td>
                        <td className="py-2 px-4 text-right font-mono font-bold text-emerald-700">{formatCurrency(vendorCreditOnPo(po))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
