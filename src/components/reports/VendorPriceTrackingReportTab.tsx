import React, { useMemo, useState } from 'react';
import { useErp } from '../../context/ErpContext';
import { BranchScope } from '../../types';
import { exportToCsv } from '../../utils/csvExport';
import { exportToExcel, exportToPdf, ExportFormat } from '../../utils/exportHelpers';
import { ReportExportButtons } from './ReportExportButtons';
import { TrendingUp, TrendingDown, Minus, Search, Package, Award } from 'lucide-react';
import { cn, formatCurrency } from '../../lib/utils';

interface Props {
  startDate: string;
  endDate: string;
  branchScope: BranchScope;
}

interface PricePoint { date: string; price: number; qty: number; source: 'received' | 'ordered'; }

// #9 Vendor Price Tracking — for each product, compare the vendors it was bought
// from (which one is cheapest), plus a price-history view. Built from actual PO
// receipts (falling back to ordered prices for POs not yet received).
export const VendorPriceTrackingReportTab: React.FC<Props> = ({ startDate, endDate, branchScope }) => {
  const { purchaseOrders, items } = useErp();
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'compare' | 'history'>('compare');

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
        lastPrice: last.price, lastDate: last.date, lastQty: last.qty, prevPrice: prev ? prev.price : null,
        change, changePct, purchases: points.length, lastSource: last.source,
      };
    }).sort((a, b) => b.lastDate.localeCompare(a.lastDate) || a.itemName.localeCompare(b.itemName));
  }, [purchaseOrders, branchScope, startDate, endDate]);

  // Product-centric comparison: for each product, each vendor's latest price,
  // sorted cheapest first, with the lowest price flagged.
  const byProduct = useMemo(() => {
    const m = new Map<string, {
      itemId: string; itemName: string; itemCode: string;
      vendors: { vendorId: string; vendorName: string; lastPrice: number; lastDate: string; lastQty: number }[];
    }>();
    for (const g of groups) {
      let p = m.get(g.itemId);
      if (!p) { p = { itemId: g.itemId, itemName: g.itemName, itemCode: g.itemCode, vendors: [] }; m.set(g.itemId, p); }
      p.vendors.push({ vendorId: g.vendorId, vendorName: g.vendorName, lastPrice: g.lastPrice, lastDate: g.lastDate, lastQty: g.lastQty });
    }
    return Array.from(m.values()).map((p) => {
      const prices = p.vendors.map((v) => v.lastPrice).filter((x) => x > 0);
      const cheapest = prices.length ? Math.min(...prices) : 0;
      const dearest = prices.length ? Math.max(...prices) : 0;
      p.vendors.sort((a, b) => a.lastPrice - b.lastPrice);
      return { ...p, cheapest, saving: Math.round((dearest - cheapest) * 100) / 100 };
    }).sort((a, b) => a.itemName.localeCompare(b.itemName));
  }, [groups]);

  const q = search.trim().toLowerCase();
  const historyRows = useMemo(() => !q ? groups : groups.filter((g) =>
    g.itemName.toLowerCase().includes(q) || g.itemCode.toLowerCase().includes(q) || g.vendorName.toLowerCase().includes(q)), [groups, q]);
  const productRows = useMemo(() => !q ? byProduct : byProduct.filter((p) =>
    p.itemName.toLowerCase().includes(q) || p.itemCode.toLowerCase().includes(q) || p.vendors.some((v) => v.vendorName.toLowerCase().includes(q))), [byProduct, q]);

  const stats = useMemo(() => ({
    products: byProduct.length,
    multiVendor: byProduct.filter((p) => p.vendors.length > 1).length,
    vendors: new Set(groups.map((g) => g.vendorId)).size,
  }), [byProduct, groups]);

  const handleExport = (format: ExportFormat = 'csv') => {
    const branchLabel = branchScope === 'all' ? 'All_Branches' : branchScope;
    if (view === 'compare') {
      if (!productRows.length) return;
      const filename = `Vendor_Price_Comparison_${branchLabel}_${startDate}_to_${endDate}.csv`;
      const headers = ['Product', 'Item Code', 'Vendor', 'Last Price (₹)', 'Qty', 'Last Date', 'Cheapest?'];
      const out: (string | number)[][] = [];
      for (const p of productRows) for (const v of p.vendors) {
        out.push([p.itemName, p.itemCode, v.vendorName, v.lastPrice, v.lastQty, v.lastDate, v.lastPrice === p.cheapest ? 'YES' : '']);
      }
      if (format === 'excel') exportToExcel(filename, headers, out);
      else if (format === 'pdf') exportToPdf(filename, headers, out, 'Vendor Price Comparison');
      else exportToCsv(filename, headers, out);
      return;
    }
    if (!historyRows.length) return;
    const filename = `Vendor_Price_History_${branchLabel}_${startDate}_to_${endDate}.csv`;
    const headers = ['Item', 'Item Code', 'Vendor', 'Last Price (₹)', 'Previous Price (₹)', 'Change (₹)', 'Change (%)', 'Last Purchase Date', 'Times Purchased', 'Current Master Cost (₹)'];
    const out = historyRows.map((r) => [
      r.itemName, r.itemCode, r.vendorName, r.lastPrice, r.prevPrice ?? '—', r.change, r.prevPrice != null ? `${r.changePct}%` : '—',
      r.lastDate, r.purchases, masterCost.get(r.itemId) ?? '—',
    ]);
    if (format === 'excel') exportToExcel(filename, headers, out);
    else if (format === 'pdf') exportToPdf(filename, headers, out, 'Vendor Price History');
    else exportToCsv(filename, headers, out);
  };

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {[
          { label: 'Products purchased', value: stats.products },
          { label: 'Bought from 2+ vendors', value: stats.multiVendor },
          { label: 'Vendors', value: stats.vendors },
        ].map((c) => (
          <div key={c.label} className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{c.label}</div>
            <div className="text-2xl font-extrabold font-mono mt-1 text-slate-900">{c.value}</div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1">
          <div className="inline-flex bg-slate-100 p-1 rounded-lg text-xs font-bold">
            <button type="button" onClick={() => setView('compare')} className={cn('px-3 py-1.5 rounded-md', view === 'compare' ? 'bg-white text-red-700 shadow-xs' : 'text-slate-600')}>Compare vendors</button>
            <button type="button" onClick={() => setView('history')} className={cn('px-3 py-1.5 rounded-md', view === 'history' ? 'bg-white text-red-700 shadow-xs' : 'text-slate-600')}>Price history</button>
          </div>
          <div className="relative max-w-xs flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search product or vendor…"
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600" />
          </div>
        </div>
        <ReportExportButtons onExport={handleExport} />
      </div>

      {/* COMPARE VENDORS — one block per product, vendors side by side, cheapest flagged */}
      {view === 'compare' && (
        <div className="space-y-3">
          {productRows.map((p) => (
            <div key={p.itemId} className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-bold text-slate-900">{p.itemName}</span>
                  <span className="ml-2 font-mono text-[11px] text-slate-500">{p.itemCode || '—'}</span>
                </div>
                {p.vendors.length > 1 && p.saving > 0 && (
                  <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                    Save up to {formatCurrency(p.saving)}/unit with the cheapest vendor
                  </span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="text-slate-500 font-bold uppercase text-[10px] tracking-wider border-b border-slate-100">
                      <th className="py-2 px-4 w-20"></th>
                      {p.vendors.map((v) => (
                        <th key={v.vendorId} className={cn('py-2 px-3 text-right', v.lastPrice === p.cheapest && 'text-emerald-700')}>
                          <div className="flex items-center justify-end gap-1">
                            {v.lastPrice === p.cheapest && p.vendors.length > 1 && <Award className="h-3 w-3" />}
                            <span className="truncate max-w-[140px]">{v.vendorName}</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-50">
                      <td className="py-2 px-4 font-bold text-slate-600">Price</td>
                      {p.vendors.map((v) => (
                        <td key={v.vendorId} className={cn('py-2 px-3 text-right font-mono font-bold', v.lastPrice === p.cheapest && p.vendors.length > 1 ? 'text-emerald-700 bg-emerald-50' : 'text-slate-900')}>
                          {formatCurrency(v.lastPrice)}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-slate-50">
                      <td className="py-2 px-4 font-bold text-slate-600">Qty</td>
                      {p.vendors.map((v) => <td key={v.vendorId} className="py-2 px-3 text-right font-mono text-slate-600">{v.lastQty || '—'}</td>)}
                    </tr>
                    <tr>
                      <td className="py-2 px-4 font-bold text-slate-600">Date</td>
                      {p.vendors.map((v) => <td key={v.vendorId} className="py-2 px-3 text-right text-slate-500">{v.lastDate}</td>)}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {!productRows.length && (
            <div className="py-12 text-center text-slate-400 text-sm flex flex-col items-center gap-2 bg-white border border-slate-200 rounded-xl">
              <Package className="h-8 w-8 text-slate-300" />
              <span>No vendor purchases in this period. Prices appear here as POs are received.</span>
            </div>
          )}
        </div>
      )}

      {/* PRICE HISTORY — the per item-vendor change-over-time table */}
      {view === 'history' && (
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
              {historyRows.map((r) => (
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
                    {r.prevPrice == null ? <span className="text-slate-400">—</span>
                      : r.change === 0 ? <span className="inline-flex items-center gap-1 text-slate-500"><Minus className="h-3 w-3" /> 0</span>
                      : r.change > 0 ? <span className="inline-flex items-center gap-1 text-rose-700 font-bold"><TrendingUp className="h-3 w-3" /> +{formatCurrency(r.change)} ({r.changePct}%)</span>
                      : <span className="inline-flex items-center gap-1 text-emerald-700 font-bold"><TrendingDown className="h-3 w-3" /> {formatCurrency(r.change)} ({r.changePct}%)</span>}
                  </td>
                  <td className="py-2.5 px-3 text-center text-slate-600">{r.lastDate}</td>
                  <td className="py-2.5 px-3 text-center font-mono text-slate-600">{r.purchases}</td>
                  <td className="py-2.5 px-3 text-right font-mono text-slate-500">{formatCurrency(masterCost.get(r.itemId) ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!historyRows.length && (
            <div className="py-12 text-center text-slate-400 text-sm flex flex-col items-center gap-2">
              <Package className="h-8 w-8 text-slate-300" />
              <span>No vendor purchases in this period.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
