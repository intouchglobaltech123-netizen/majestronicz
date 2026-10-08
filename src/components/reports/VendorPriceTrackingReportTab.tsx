import React, { useMemo, useState } from 'react';
import { useErp } from '../../context/ErpContext';
import { BranchScope } from '../../types';
import { exportToCsv } from '../../utils/csvExport';
import { exportToExcel, exportToPdf, ExportFormat } from '../../utils/exportHelpers';
import { ReportExportButtons } from './ReportExportButtons';
import { TrendingUp, TrendingDown, Minus, Search, Package } from 'lucide-react';
import { cn, formatCurrency } from '../../lib/utils';

interface Props {
  startDate: string;
  endDate: string;
  branchScope: BranchScope;
}

interface PricePoint { date: string; price: number; qty: number; source: 'received' | 'ordered'; }

// #9 Vendor Price Tracking — how each supplier's price for an item has moved
// over time, from actual PO receipts (falling back to ordered prices when a PO
// was never received). Standard columns; adjustable when the client's exact
// headings arrive.
export const VendorPriceTrackingReportTab: React.FC<Props> = ({ startDate, endDate, branchScope }) => {
  const { purchaseOrders, items } = useErp();
  const [search, setSearch] = useState('');

  const masterCost = useMemo(() => new Map(items.map((i) => [i.id, Number(i.purchasePrice) || 0])), [items]);

  // Build price points per (item, vendor).
  const groups = useMemo(() => {
    const inRange = (d: string) => (!startDate || d >= startDate) && (!endDate || d <= endDate);
    const map = new Map<string, {
      itemId: string; itemName: string; itemCode: string; vendorId: string; vendorName: string; points: PricePoint[];
    }>();
    const add = (itemId: string, itemName: string, itemCode: string, vendorId: string, vendorName: string, p: PricePoint) => {
      const key = `${itemId}||${vendorId}`;
      let g = map.get(key);
      if (!g) { g = { itemId, itemName, itemCode, vendorId, vendorName, points: [] }; map.set(key, g); }
      g.points.push(p);
    };
    for (const po of purchaseOrders) {
      if (branchScope !== 'all' && po.branchId !== branchScope) continue;
      const vendorId = po.vendorId || po.vendorName || 'unknown';
      const vendorName = po.vendorName || 'Unknown vendor';
      const history = Array.isArray(po.receivingHistory) ? po.receivingHistory : [];
      if (history.length) {
        for (const ev of history) {
          const d = (ev as any).date || po.date;
          if (!inRange(d)) continue;
          for (const ln of ((ev as any).lines || [])) {
            const price = Number(ln.purchasePrice) || 0;
            if (price <= 0) continue;
            add(ln.itemId, ln.itemName || ln.itemId, ln.itemCode || '', vendorId, vendorName,
              { date: d, price, qty: Number(ln.quantityReceivedThisEvent) || 0, source: 'received' });
          }
        }
      } else if (inRange(po.date)) {
        // No receipts yet — use the ordered prices so the PO still shows.
        for (const ln of (po.items || [])) {
          const price = Number(ln.purchasePrice) || 0;
          if (price <= 0) continue;
          add(ln.itemId, ln.itemName || ln.itemId, ln.itemCode || '', vendorId, vendorName,
            { date: po.date, price, qty: Number(ln.quantityOrdered) || 0, source: 'ordered' });
        }
      }
    }
    return Array.from(map.values()).map((g) => {
      const points = [...g.points].sort((a, b) => a.date.localeCompare(b.date));
      const last = points[points.length - 1];
      const prev = points.length > 1 ? points[points.length - 2] : null;
      const change = prev ? Math.round((last.price - prev.price) * 100) / 100 : 0;
      const changePct = prev && prev.price > 0 ? Math.round((change / prev.price) * 1000) / 10 : 0;
      return {
        ...g, points,
        lastPrice: last.price, lastDate: last.date, prevPrice: prev ? prev.price : null,
        change, changePct, purchases: points.length, lastSource: last.source,
      };
    }).sort((a, b) => b.lastDate.localeCompare(a.lastDate) || a.itemName.localeCompare(b.itemName));
  }, [purchaseOrders, branchScope, startDate, endDate]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) =>
      g.itemName.toLowerCase().includes(q) || g.itemCode.toLowerCase().includes(q) || g.vendorName.toLowerCase().includes(q));
  }, [groups, search]);

  const stats = useMemo(() => ({
    rows: rows.length,
    vendors: new Set(rows.map((r) => r.vendorId)).size,
    increased: rows.filter((r) => r.change > 0).length,
    decreased: rows.filter((r) => r.change < 0).length,
  }), [rows]);

  const handleExport = (format: ExportFormat = 'csv') => {
    if (!rows.length) return;
    const branchLabel = branchScope === 'all' ? 'All_Branches' : branchScope;
    const filename = `Vendor_Price_Tracking_${branchLabel}_${startDate}_to_${endDate}.csv`;
    const headers = ['Item', 'Item Code', 'Vendor', 'Last Price (₹)', 'Previous Price (₹)', 'Change (₹)', 'Change (%)', 'Last Purchase Date', 'Times Purchased', 'Current Master Cost (₹)'];
    const out = rows.map((r) => [
      r.itemName, r.itemCode, r.vendorName, r.lastPrice, r.prevPrice ?? '—', r.change, r.prevPrice != null ? `${r.changePct}%` : '—',
      r.lastDate, r.purchases, masterCost.get(r.itemId) ?? '—',
    ]);
    if (format === 'excel') exportToExcel(filename, headers, out);
    else if (format === 'pdf') exportToPdf(filename, headers, out, 'Vendor Price Tracking');
    else exportToCsv(filename, headers, out);
  };

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Item–vendor prices', value: stats.rows, cls: 'text-slate-900' },
          { label: 'Vendors', value: stats.vendors, cls: 'text-slate-900' },
          { label: 'Price increases', value: stats.increased, cls: 'text-rose-700' },
          { label: 'Price drops', value: stats.decreased, cls: 'text-emerald-700' },
        ].map((c) => (
          <div key={c.label} className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{c.label}</div>
            <div className={cn('text-2xl font-extrabold font-mono mt-1', c.cls)}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search item, code or vendor…"
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
          />
        </div>
        <ReportExportButtons onExport={handleExport} />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-600 font-bold uppercase text-[11px] tracking-wider">
              <th className="py-3 px-4">Item</th>
              <th className="py-3 px-3">Vendor</th>
              <th className="py-3 px-3 text-right">Last Price</th>
              <th className="py-3 px-3 text-right">Previous</th>
              <th className="py-3 px-3 text-right">Change</th>
              <th className="py-3 px-3 text-center">Last Purchase</th>
              <th className="py-3 px-3 text-center">Times</th>
              <th className="py-3 px-3 text-right">Master Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {rows.map((r) => (
              <tr key={`${r.itemId}||${r.vendorId}`} className="hover:bg-slate-50/50">
                <td className="py-2.5 px-4">
                  <div className="font-bold text-slate-900">{r.itemName}</div>
                  <div className="font-mono text-[11px] text-slate-500">{r.itemCode || '—'}</div>
                </td>
                <td className="py-2.5 px-3 text-slate-700">{r.vendorName}</td>
                <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                  {formatCurrency(r.lastPrice)}
                  {r.lastSource === 'ordered' && <span className="ml-1 text-[9px] text-slate-400 uppercase">(ordered)</span>}
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-slate-500">{r.prevPrice != null ? formatCurrency(r.prevPrice) : '—'}</td>
                <td className="py-2.5 px-3 text-right font-mono">
                  {r.prevPrice == null ? (
                    <span className="text-slate-400">—</span>
                  ) : r.change === 0 ? (
                    <span className="inline-flex items-center gap-1 text-slate-500"><Minus className="h-3 w-3" /> 0</span>
                  ) : r.change > 0 ? (
                    <span className="inline-flex items-center gap-1 text-rose-700 font-bold"><TrendingUp className="h-3 w-3" /> +{formatCurrency(r.change)} ({r.changePct}%)</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-emerald-700 font-bold"><TrendingDown className="h-3 w-3" /> {formatCurrency(r.change)} ({r.changePct}%)</span>
                  )}
                </td>
                <td className="py-2.5 px-3 text-center text-slate-600">{r.lastDate}</td>
                <td className="py-2.5 px-3 text-center font-mono text-slate-600">{r.purchases}</td>
                <td className="py-2.5 px-3 text-right font-mono text-slate-500">{formatCurrency(masterCost.get(r.itemId) ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="py-12 text-center text-slate-400 text-sm flex flex-col items-center gap-2">
            <Package className="h-8 w-8 text-slate-300" />
            <span>No vendor purchases in this period. Prices appear here as POs are received.</span>
          </div>
        )}
      </div>
    </div>
  );
};
