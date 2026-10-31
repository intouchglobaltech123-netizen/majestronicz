import React, { useMemo, useState } from 'react';
import { ArrowLeft, Ban, Search } from 'lucide-react';
import { useErp } from '../../context/ErpContext';
import { formatCurrency } from '../../lib/utils';

interface Props {
  onBack: () => void;
}

interface CancelledRow {
  key: string;
  poId: string;
  poNumber: string;
  date: string;
  vendorName: string;
  itemName: string;
  itemCode: string;
  quantityOrdered: number;
  receivedQuantity: number;
  cancelledQuantity: number;
  unitPrice: number;
  value: number; // cancelled qty × unit price (what was NOT purchased — informational)
}

/**
 * F3: a dedicated list of products that were CANCELLED on a purchase order (the
 * vendor did not / will not supply them). The order line is kept for history, so
 * this view surfaces every cancelled line across all POs — it is NOT a shortfall
 * billed back to the vendor (that is "Missing"), just an order that was reduced.
 */
export const CancelledProductsView: React.FC<Props> = ({ onBack }) => {
  const { purchaseOrders, currentBranch, isAllBranches } = useErp();
  const [query, setQuery] = useState('');

  const rows = useMemo<CancelledRow[]>(() => {
    const out: CancelledRow[] = [];
    for (const po of purchaseOrders) {
      if (!isAllBranches && po.branchId !== currentBranch) continue;
      const items = (po.items as any[]) || [];
      items.forEach((l, idx) => {
        const cancelled = Number(l.cancelledQuantity) || 0;
        if (cancelled <= 0) return;
        const unitPrice = Number(l.purchasePrice) || 0;
        out.push({
          key: `${po.id}-${l.id || idx}`,
          poId: po.id,
          poNumber: po.poNumber,
          date: (po as any).date || (po.createdAt || '').slice(0, 10),
          vendorName: po.vendorName || '—',
          itemName: l.itemName || l.itemId,
          itemCode: l.itemCode || '',
          quantityOrdered: Number(l.quantityOrdered) || 0,
          receivedQuantity: Number(l.receivedQuantity) || 0,
          cancelledQuantity: cancelled,
          unitPrice,
          value: Math.round(unitPrice * cancelled * 100) / 100,
        });
      });
    }
    // Most recent PO date first.
    return out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [purchaseOrders, currentBranch, isAllBranches]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.itemName.toLowerCase().includes(q) ||
        r.itemCode.toLowerCase().includes(q) ||
        r.poNumber.toLowerCase().includes(q) ||
        r.vendorName.toLowerCase().includes(q)
    );
  }, [rows, query]);

  const totalUnits = filtered.reduce((s, r) => s + r.cancelledQuantity, 0);
  const totalValue = filtered.reduce((s, r) => s + r.value, 0);

  return (
    <div className="p-4 sm:p-6 space-y-5 w-full">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-none transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back</span>
        </button>
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center border border-slate-200">
            <Ban className="h-4.5 w-4.5" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900">Cancelled Products</h1>
            <p className="text-xs text-slate-500">Ordered items the vendor did not supply — kept for history, never billed back.</p>
          </div>
        </div>
      </div>

      {/* Summary + search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-sm">
          <span className="text-slate-600">
            <strong className="font-mono text-slate-900">{filtered.length}</strong> line{filtered.length === 1 ? '' : 's'}
          </span>
          <span className="text-slate-600">
            <strong className="font-mono text-slate-900">{totalUnits}</strong> unit{totalUnits === 1 ? '' : 's'}
          </span>
          <span className="text-slate-600">
            Value not purchased: <strong className="font-mono text-slate-900">{formatCurrency(totalValue)}</strong>
          </span>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search item, code, PO or vendor…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600 focus:bg-white"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        {filtered.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="p-3">Product</th>
                  <th className="p-3">PO</th>
                  <th className="p-3">Vendor</th>
                  <th className="p-3">Date</th>
                  <th className="p-3 text-center">Ordered</th>
                  <th className="p-3 text-center">Received</th>
                  <th className="p-3 text-center text-slate-700">Cancelled</th>
                  <th className="p-3 text-right">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                {filtered.map((r) => (
                  <tr key={r.key} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3">
                      <div className="font-semibold text-slate-900">{r.itemName}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{r.itemCode}</div>
                    </td>
                    <td className="p-3 font-mono text-slate-600">{r.poNumber}</td>
                    <td className="p-3">{r.vendorName}</td>
                    <td className="p-3 text-slate-500 font-mono">{r.date}</td>
                    <td className="p-3 text-center">{r.quantityOrdered}</td>
                    <td className="p-3 text-center text-emerald-700">{r.receivedQuantity}</td>
                    <td className="p-3 text-center font-bold text-slate-700">{r.cancelledQuantity}</td>
                    <td className="p-3 text-right font-mono">{formatCurrency(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-16 text-center space-y-2">
            <Ban className="h-10 w-10 text-slate-300 mx-auto" />
            <h3 className="text-sm font-bold text-slate-700">No cancelled products</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              When a vendor won't supply ordered units, mark them "Cancelled" while receiving the PO — they'll be listed here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
