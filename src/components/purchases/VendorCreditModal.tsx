import React, { useMemo } from 'react';
import { X, HandCoins, FileText } from 'lucide-react';
import { useErp } from '../../context/ErpContext';
import { formatCurrency } from '../../lib/utils';
import { PurchaseOrder, Payment, purchaseOrderAdvance, purchaseOrderGrandOwed, paymentUnapplied } from '../../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Vendor advance on a PO = paid beyond the goods received in good condition
 * (incl. GST) — e.g. prepaid before delivery, or paid for units that then came
 * damaged / short. Same formula as every payable screen (purchaseOrderAdvance).
 */
export const vendorCreditOnPo = (po: PurchaseOrder): number => purchaseOrderAdvance(po);

/** Advances suppliers hold for us: paid ahead on POs + payments not applied to any PO (PUR6-3). */
export const VendorCreditModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { purchaseOrders, payments, currentBranch, isAllBranches } = useErp();

  const byVendor = useMemo(() => {
    const inScope = (b: string) => isAllBranches || b === currentBranch;
    const groups = new Map<string, { vendorName: string; pos: PurchaseOrder[]; unapplied: Payment[]; total: number }>();
    const group = (key: string, name: string) => {
      const g = groups.get(key) || { vendorName: name || 'Unknown supplier', pos: [], unapplied: [], total: 0 };
      groups.set(key, g);
      return g;
    };
    for (const po of purchaseOrders) {
      if (!inScope(po.branchId)) continue;
      const credit = vendorCreditOnPo(po);
      if (credit <= 0.5) continue;
      const g = group(po.vendorId || po.vendorName, po.vendorName);
      g.pos.push(po);
      g.total += credit;
    }
    for (const p of payments) {
      if (p.type !== 'out' || p.partyType !== 'vendor' || !inScope(p.branchId)) continue;
      const u = paymentUnapplied(p);
      if (u <= 0.5) continue;
      const g = group(p.partyId || p.partyName, p.partyName);
      g.unapplied.push(p);
      g.total += u;
    }
    return Array.from(groups.values()).sort((a, b) => b.total - a.total);
  }, [purchaseOrders, payments, currentBranch, isAllBranches]);

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
              <h2 className="text-base font-bold text-slate-900">Vendor Advances</h2>
              <p className="text-xs text-slate-500">Money suppliers hold for us — paid ahead of the goods received, or not yet applied to a PO</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-slate-200 flex items-center justify-between bg-white shrink-0">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total advances</span>
          <span className="text-2xl font-bold font-mono text-emerald-700">{formatCurrency(grandTotal)}</span>
        </div>

        <div className="overflow-y-auto p-4 space-y-4">
          {byVendor.length === 0 ? (
            <div className="text-center text-slate-500 py-10 text-sm">No vendor advances. Payments made ahead of delivery will appear here.</div>
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
                      <th className="text-left font-semibold py-2 px-4">PO / Payment</th>
                      <th className="text-right font-semibold py-2 px-3">Owed (received)</th>
                      <th className="text-right font-semibold py-2 px-3">Paid</th>
                      <th className="text-right font-semibold py-2 px-4">Advance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {g.pos.map((po) => (
                      <tr key={po.id}>
                        <td className="py-2 px-4">
                          <span className="font-mono font-semibold text-slate-800 flex items-center gap-1.5">
                            <FileText className="h-3.5 w-3.5 text-slate-400" />{po.poNumber}
                          </span>
                          <span className="text-[11px] text-slate-400">{po.date} · {po.status}</span>
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-600">{formatCurrency(purchaseOrderGrandOwed(po))}</td>
                        <td className="py-2 px-3 text-right font-mono text-slate-600">{formatCurrency(po.amountPaid || 0)}</td>
                        <td className="py-2 px-4 text-right font-mono font-bold text-emerald-700">{formatCurrency(vendorCreditOnPo(po))}</td>
                      </tr>
                    ))}
                    {g.unapplied.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2 px-4">
                          <span className="font-mono font-semibold text-slate-800">{p.receiptNumber}</span>
                          <span className="text-[11px] text-slate-400 block">{p.date} · supplier advance (not yet applied to a PO) — apply it from the supplier statement</span>
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-400">—</td>
                        <td className="py-2 px-3 text-right font-mono text-slate-600">{formatCurrency(p.amount)}</td>
                        <td className="py-2 px-4 text-right font-mono font-bold text-emerald-700">{formatCurrency(paymentUnapplied(p))}</td>
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
