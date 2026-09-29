import React, { useMemo, useState } from 'react';
import { useErp } from '../../context/ErpContext';
import { PurchaseOrder, purchaseOrderBalanceDue } from '../../types';
import { formatCurrency, cn } from '../../lib/utils';
import { ArrowLeft, Wallet, Truck, ChevronDown, ChevronRight, CheckCircle2, Search } from 'lucide-react';

interface Props {
  onBack: () => void;
}

/** Allocate `amount` across POs oldest-first (FIFO): fill each PO's balance in
 *  turn, the last one partially. Returns the per-PO allocation. */
const fifoAllocate = (pos: { po: PurchaseOrder; balance: number }[], amount: number) => {
  let left = Math.round(Math.max(0, amount) * 100) / 100;
  const out: { po: PurchaseOrder; pay: number; balance: number; full: boolean }[] = [];
  for (const { po, balance } of pos) {
    if (left <= 0.001 || balance <= 0.001) continue;
    const pay = Math.round(Math.min(left, balance) * 100) / 100;
    if (pay <= 0) continue;
    out.push({ po, pay, balance, full: pay >= balance - 0.01 });
    left = Math.round((left - pay) * 100) / 100;
  }
  return { allocations: out, leftover: Math.max(0, left) };
};

/**
 * "To Pay (Suppliers)" page — every outstanding PO grouped by vendor. Pay a
 * lump sum to a vendor and it is split across that vendor's unpaid POs
 * oldest-first: earlier POs are settled in full, the last one partially.
 */
export const SupplierPayablesView: React.FC<Props> = ({ onBack }) => {
  const { purchaseOrders, recordPurchaseOrderPayment, currentBranch, isAllBranches } = useErp();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [payAmt, setPayAmt] = useState<Record<string, string>>({});
  const [payMode, setPayMode] = useState<Record<string, string>>({});

  // Group outstanding POs by vendor (branch-scoped, non-cancelled, balance > 0).
  const groups = useMemo(() => {
    const byVendor = new Map<string, { vendorId: string; vendorName: string; pos: { po: PurchaseOrder; balance: number }[]; total: number }>();
    for (const po of purchaseOrders) {
      if (po.status === 'Cancelled') continue;
      if (!(isAllBranches || po.branchId === currentBranch)) continue;
      const balance = purchaseOrderBalanceDue(po);
      if (balance <= 0.5) continue;
      const key = po.vendorId || po.vendorName || 'unknown';
      const g = byVendor.get(key) || { vendorId: key, vendorName: po.vendorName || 'Unknown supplier', pos: [], total: 0 };
      g.pos.push({ po, balance });
      g.total = Math.round((g.total + balance) * 100) / 100;
      byVendor.set(key, g);
    }
    const list = [...byVendor.values()];
    // Oldest PO first within each vendor (FIFO order).
    list.forEach((g) => g.pos.sort((a, b) => (a.po.date < b.po.date ? -1 : a.po.date > b.po.date ? 1 : 0)));
    // Biggest outstanding vendor first.
    list.sort((a, b) => b.total - a.total);
    const q = search.trim().toLowerCase();
    return q ? list.filter((g) => g.vendorName.toLowerCase().includes(q)) : list;
  }, [purchaseOrders, currentBranch, isAllBranches, search]);

  const grandTotal = groups.reduce((s, g) => s + g.total, 0);

  const pay = (key: string, pos: { po: PurchaseOrder; balance: number }[]) => {
    const amt = Number(payAmt[key]) || 0;
    if (amt <= 0) return;
    const { allocations } = fifoAllocate(pos, amt);
    if (allocations.length === 0) return;
    const mode = payMode[key] || 'Cash';
    // Record a payment against each PO the lump sum covers (oldest first).
    allocations.forEach((a) => recordPurchaseOrderPayment(a.po.id, a.pay, mode));
    setPayAmt((p) => ({ ...p, [key]: '' }));
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 w-full">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-lg">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          <div className="h-10 w-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center border border-rose-200/60"><Wallet className="h-5 w-5" /></div>
          <div>
            <h2 className="text-base font-extrabold text-slate-900">To Pay — Suppliers</h2>
            <p className="text-[11px] text-slate-500">Outstanding purchase orders grouped by vendor. A lump-sum payment settles a vendor's oldest POs first.</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Total outstanding</p>
          <p className="text-2xl font-extrabold font-mono text-rose-700">{formatCurrency(grandTotal)}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search supplier…"
          className="w-full pl-9 pr-3 py-2 rounded-lg bg-white border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-rose-500" />
      </div>

      {groups.length === 0 ? (
        <div className="py-12 text-center bg-white border border-slate-200 rounded-xl">
          <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-400 mb-2" />
          <p className="text-sm font-bold text-slate-700">No outstanding supplier dues</p>
          <p className="text-xs text-slate-400 mt-0.5">Every purchase order in scope is fully paid.</p>
        </div>
      ) : (
        groups.map((g) => {
          const isOpen = open[g.vendorId] !== false; // default expanded
          const amt = Number(payAmt[g.vendorId]) || 0;
          const preview = amt > 0 ? fifoAllocate(g.pos, amt) : null;
          return (
            <div key={g.vendorId} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              {/* Vendor header */}
              <button type="button" onClick={() => setOpen((p) => ({ ...p, [g.vendorId]: !isOpen }))}
                className="w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 border-b border-slate-100">
                <div className="flex items-center gap-2 min-w-0">
                  {isOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                  <Truck className="h-4 w-4 text-slate-400" />
                  <span className="text-sm font-bold text-slate-900 truncate">{g.vendorName}</span>
                  <span className="text-[11px] text-slate-400">· {g.pos.length} PO{g.pos.length > 1 ? 's' : ''}</span>
                </div>
                <span className="text-sm font-bold font-mono text-rose-700 shrink-0">{formatCurrency(g.total)}</span>
              </button>

              {isOpen && (
                <div className="p-4 space-y-3">
                  {/* PO list (oldest first) with live allocation preview */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                          <th className="text-left py-1.5 pr-3">PO</th>
                          <th className="text-left py-1.5 pr-3">Date</th>
                          <th className="text-right py-1.5 pr-3">Paid / Total</th>
                          <th className="text-right py-1.5 pr-3">Balance</th>
                          <th className="text-right py-1.5">This payment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.pos.map(({ po, balance }) => {
                          const alloc = preview?.allocations.find((a) => a.po.id === po.id);
                          const total = (po.totalAmount || 0) + (po.totalTax || 0);
                          return (
                            <tr key={po.id} className="border-b border-slate-50">
                              <td className="py-1.5 pr-3 font-mono font-bold text-blue-700">{po.poNumber}</td>
                              <td className="py-1.5 pr-3 text-slate-500">{po.date}</td>
                              <td className="py-1.5 pr-3 text-right font-mono text-slate-600">{formatCurrency(po.amountPaid || 0)} / {formatCurrency(total)}</td>
                              <td className="py-1.5 pr-3 text-right font-mono font-bold text-rose-700">{formatCurrency(balance)}</td>
                              <td className="py-1.5 text-right font-mono">
                                {alloc ? (
                                  <span className={cn('font-bold', alloc.full ? 'text-emerald-700' : 'text-amber-700')}>
                                    {formatCurrency(alloc.pay)} {alloc.full ? '· full' : '· partial'}
                                  </span>
                                ) : <span className="text-slate-300">—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Pay a lump sum */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span className="text-xs font-bold text-slate-600">Pay lump sum:</span>
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">₹</span>
                      <input type="number" min={0} value={payAmt[g.vendorId] || ''} onChange={(e) => setPayAmt((p) => ({ ...p, [g.vendorId]: e.target.value }))}
                        placeholder="0" className="w-32 pl-5 pr-2 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-bold font-mono focus:outline-none focus:border-emerald-600" />
                    </div>
                    <button type="button" onClick={() => setPayAmt((p) => ({ ...p, [g.vendorId]: String(g.total) }))}
                      className="text-[11px] font-bold text-slate-500 hover:text-slate-800 underline">Pay all ({formatCurrency(g.total)})</button>
                    <select value={payMode[g.vendorId] || 'Cash'} onChange={(e) => setPayMode((p) => ({ ...p, [g.vendorId]: e.target.value }))}
                      className="px-2 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-bold text-slate-800 focus:outline-none focus:border-emerald-600">
                      <option>Cash</option><option>GPay</option><option>HDFC</option><option>Bank Transfer</option><option>Cheque</option>
                    </select>
                    <button type="button" disabled={amt <= 0}
                      onClick={() => pay(g.vendorId, g.pos)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold border border-emerald-700 disabled:opacity-50">
                      <Wallet className="h-3.5 w-3.5" /> Allocate &amp; pay
                    </button>
                    {preview && preview.leftover > 0.5 && (
                      <span className="text-[11px] font-bold text-amber-600">{formatCurrency(preview.leftover)} more than owed — will pay only {formatCurrency(g.total)}.</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};

export default SupplierPayablesView;
