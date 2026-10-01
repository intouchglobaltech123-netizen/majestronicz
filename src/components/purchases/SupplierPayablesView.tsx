import React, { useMemo, useState } from 'react';
import { useErp } from '../../context/ErpContext';
import { PurchaseOrder, purchaseOrderBalanceDue, purchaseOrderGrandOwed } from '../../types';
import { formatCurrency, cn } from '../../lib/utils';
import { ArrowLeft, Wallet, Truck, ChevronDown, ChevronRight, CheckCircle2, Search, FileText } from 'lucide-react';
import { PurchaseOrderDetailModal } from './PurchaseOrderDetailModal';

interface Props {
  onBack: () => void;
}

/** Spread `amount` across POs oldest-first (FIFO): fill each PO's balance in
 *  turn, the last one partially. Used only to PRE-FILL the per-PO inputs — the
 *  user can then adjust any PO's amount before paying. */
const fifoAllocate = (pos: { po: PurchaseOrder; balance: number }[], amount: number) => {
  let left = Math.round(Math.max(0, amount) * 100) / 100;
  const out: Record<string, number> = {};
  for (const { po, balance } of pos) {
    if (left <= 0.001 || balance <= 0.001) continue;
    const pay = Math.round(Math.min(left, balance) * 100) / 100;
    if (pay <= 0) continue;
    out[po.id] = pay;
    left = Math.round((left - pay) * 100) / 100;
  }
  return { perPo: out, leftover: Math.max(0, left) };
};

/**
 * "To Pay (Suppliers)" page — every outstanding PO grouped by vendor. Enter how
 * much to pay EACH PO (the "This payment" column is editable), or type a lump sum
 * and auto-fill it across the vendor's POs oldest-first, then adjust before
 * paying. A payment is recorded against each PO the amounts cover.
 */
export const SupplierPayablesView: React.FC<Props> = ({ onBack }) => {
  const { purchaseOrders, recordPurchaseOrderPayment, currentBranch, isAllBranches,
    selectedPurchaseOrderForDetail, setSelectedPurchaseOrderForDetail } = useErp();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Per-PO payment amount (keyed by po.id) — this is what gets paid.
  const [poPay, setPoPay] = useState<Record<string, string>>({});
  // Per-vendor lump-sum helper (keyed by vendor) used only to pre-fill poPay.
  const [lump, setLump] = useState<Record<string, string>>({});
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

  // Clamp a typed per-PO amount to that PO's outstanding balance.
  const setPoAmount = (poId: string, raw: string, balance: number) => {
    if (raw === '') { setPoPay((p) => ({ ...p, [poId]: '' })); return; }
    const n = Math.max(0, Math.min(balance, Number(raw) || 0));
    setPoPay((p) => ({ ...p, [poId]: String(Math.round(n * 100) / 100) }));
  };

  // Pre-fill the per-PO inputs from a lump sum, oldest-first.
  const distribute = (key: string, pos: { po: PurchaseOrder; balance: number }[]) => {
    const { perPo } = fifoAllocate(pos, Number(lump[key]) || 0);
    setPoPay((p) => {
      const next = { ...p };
      for (const { po } of pos) next[po.id] = perPo[po.id] ? String(perPo[po.id]) : '';
      return next;
    });
  };

  // Fill every PO's input with its full balance.
  const fillAll = (pos: { po: PurchaseOrder; balance: number }[]) => {
    setPoPay((p) => {
      const next = { ...p };
      for (const { po, balance } of pos) next[po.id] = String(balance);
      return next;
    });
  };

  // Total being paid to this vendor right now (sum of the per-PO inputs).
  const vendorPayTotal = (pos: { po: PurchaseOrder; balance: number }[]) =>
    Math.round(pos.reduce((s, { po }) => s + (Number(poPay[po.id]) || 0), 0) * 100) / 100;

  const pay = (key: string, pos: { po: PurchaseOrder; balance: number }[]) => {
    const mode = payMode[key] || 'Cash';
    let paidAny = false;
    for (const { po, balance } of pos) {
      const amt = Math.min(balance, Number(poPay[po.id]) || 0);
      if (amt <= 0.001) continue;
      recordPurchaseOrderPayment(po.id, Math.round(amt * 100) / 100, mode);
      paidAny = true;
    }
    if (!paidAny) return;
    // Clear this vendor's inputs.
    setPoPay((p) => {
      const next = { ...p };
      for (const { po } of pos) delete next[po.id];
      return next;
    });
    setLump((p) => ({ ...p, [key]: '' }));
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
            <p className="text-[11px] text-slate-500">Outstanding purchase orders grouped by vendor. Enter an amount per PO, or auto-fill a lump sum oldest-first and adjust.</p>
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
          const payTotal = vendorPayTotal(g.pos);
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
                  {/* PO list (oldest first) with an editable per-PO payment amount */}
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
                          // Owed-on-received grand (incl GST + charges), so Paid /
                          // Total / Balance are consistent (not the ordered value).
                          const total = purchaseOrderGrandOwed(po);
                          const val = poPay[po.id] ?? '';
                          const n = Number(val) || 0;
                          return (
                            <tr key={po.id} className="border-b border-slate-50">
                              <td className="py-1.5 pr-3">
                                <button type="button" onClick={() => setSelectedPurchaseOrderForDetail(po)}
                                  title="Open PO — attach supplier bill, see payment history"
                                  className="inline-flex items-center gap-1 font-mono font-bold text-blue-700 hover:text-blue-900 hover:underline">
                                  <FileText className="h-3 w-3 text-slate-400" /> {po.poNumber}
                                </button>
                              </td>
                              <td className="py-1.5 pr-3 text-slate-500">{po.date}</td>
                              <td className="py-1.5 pr-3 text-right font-mono text-slate-600">{formatCurrency(po.amountPaid || 0)} / {formatCurrency(total)}</td>
                              <td className="py-1.5 pr-3 text-right font-mono font-bold text-rose-700">{formatCurrency(balance)}</td>
                              <td className="py-1.5 text-right">
                                <div className="inline-flex items-center gap-1 justify-end">
                                  <div className="relative">
                                    <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">₹</span>
                                    <input
                                      type="number" min={0} max={balance} value={val}
                                      onChange={(e) => setPoAmount(po.id, e.target.value, balance)}
                                      placeholder="0"
                                      className="w-24 pl-4 pr-1.5 py-1 rounded-lg bg-white border border-slate-300 text-xs font-bold font-mono text-right focus:outline-none focus:border-emerald-600"
                                    />
                                  </div>
                                  <button type="button" onClick={() => setPoAmount(po.id, String(balance), balance)}
                                    title="Pay this PO's full balance"
                                    className="text-[10px] font-bold text-slate-400 hover:text-emerald-700 underline">full</button>
                                  {n > 0 && (
                                    <span className={cn('text-[10px] font-bold', n >= balance - 0.01 ? 'text-emerald-600' : 'text-amber-600')}>
                                      {n >= balance - 0.01 ? '✓' : 'part'}
                                    </span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Lump-sum helper (auto-fills the per-PO inputs) + pay action */}
                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
                    <span className="text-xs font-bold text-slate-600">Auto-fill lump sum:</span>
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">₹</span>
                      <input type="number" min={0} value={lump[g.vendorId] || ''} onChange={(e) => setLump((p) => ({ ...p, [g.vendorId]: e.target.value }))}
                        placeholder="0" className="w-28 pl-5 pr-2 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-bold font-mono focus:outline-none focus:border-emerald-600" />
                    </div>
                    <button type="button" onClick={() => distribute(g.vendorId, g.pos)}
                      className="text-[11px] font-bold text-slate-500 hover:text-slate-800 underline">Spread oldest-first</button>
                    <button type="button" onClick={() => fillAll(g.pos)}
                      className="text-[11px] font-bold text-slate-500 hover:text-slate-800 underline">Pay all ({formatCurrency(g.total)})</button>

                    <span className="ml-auto text-xs text-slate-500">Paying now: <span className="font-bold font-mono text-slate-900">{formatCurrency(payTotal)}</span></span>
                    <select value={payMode[g.vendorId] || 'Cash'} onChange={(e) => setPayMode((p) => ({ ...p, [g.vendorId]: e.target.value }))}
                      className="px-2 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-bold text-slate-800 focus:outline-none focus:border-emerald-600">
                      <option>Cash</option><option>GPay</option><option>HDFC</option><option>Bank Transfer</option><option>Cheque</option>
                    </select>
                    <button type="button" disabled={payTotal <= 0}
                      onClick={() => pay(g.vendorId, g.pos)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold border border-emerald-700 disabled:opacity-50">
                      <Wallet className="h-3.5 w-3.5" /> Allocate &amp; pay
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}

      {/* PO detail — supplier bill attach + payment history, opened from a PO row. */}
      <PurchaseOrderDetailModal
        isOpen={Boolean(selectedPurchaseOrderForDetail)}
        onClose={() => setSelectedPurchaseOrderForDetail(null)}
        purchaseOrder={selectedPurchaseOrderForDetail}
      />
    </div>
  );
};

export default SupplierPayablesView;
