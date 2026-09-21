import React, { useMemo, useState } from 'react';
import { useErp } from '../../context/ErpContext';
import { Invoice, OnlineOrderStatus, ONLINE_ORDER_PIPELINE } from '../../types';
import { formatCurrency, cn } from '../../lib/utils';
import { Package, Truck, CheckCircle2, XCircle, Clock, Search, MapPin } from 'lucide-react';

/** Colour per pipeline stage. */
const STATUS_STYLE: Record<OnlineOrderStatus, string> = {
  New: 'bg-slate-100 text-slate-700 border-slate-300',
  Confirmed: 'bg-blue-50 text-blue-700 border-blue-200',
  Packed: 'bg-amber-50 text-amber-700 border-amber-200',
  Shipped: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  'Out for Delivery': 'bg-violet-50 text-violet-700 border-violet-200',
  Delivered: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Cancelled: 'bg-rose-50 text-rose-700 border-rose-200',
};

const statusOf = (inv: Invoice): OnlineOrderStatus => (inv.onlineStatus as OnlineOrderStatus) || 'New';

export const OnlineOrderPipeline: React.FC = () => {
  const { invoices, updateOnlineOrderStatus, currentBranch, isAllBranches } = useErp();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'active' | 'all' | OnlineOrderStatus>('active');
  // Per-order tracking inputs (shown when shipping).
  const [tracking, setTracking] = useState<Record<string, { number: string; courier: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const online = useMemo(() => {
    const list = invoices
      .filter((i) => i.sourceChannel === 'shopify' && !i.isVoided)
      .filter((i) => isAllBranches || i.branchId === currentBranch)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return list;
  }, [invoices, currentBranch, isAllBranches]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return online.filter((o) => {
      const s = statusOf(o);
      if (filter === 'active' && (s === 'Delivered' || s === 'Cancelled')) return false;
      if (filter !== 'active' && filter !== 'all' && s !== filter) return false;
      if (!q) return true;
      return (
        o.invoiceNumber.toLowerCase().includes(q) ||
        (o.customerName || '').toLowerCase().includes(q) ||
        (o.customerPhone || '').includes(q) ||
        (o.trackingNumber || '').toLowerCase().includes(q)
      );
    });
  }, [online, filter, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { active: 0 };
    for (const o of online) {
      const s = statusOf(o);
      c[s] = (c[s] || 0) + 1;
      if (s !== 'Delivered' && s !== 'Cancelled') c.active += 1;
    }
    return c;
  }, [online]);

  const advance = async (inv: Invoice, to: OnlineOrderStatus) => {
    setBusy(inv.id);
    const t = tracking[inv.id];
    await updateOnlineOrderStatus(inv.id, to, to === 'Shipped' ? { trackingNumber: t?.number || undefined, courierName: t?.courier || undefined } : undefined);
    setBusy(null);
  };

  if (online.length === 0) {
    return (
      <div className="py-12 text-center text-slate-500 bg-white border border-slate-200 rounded-xl">
        <Package className="h-10 w-10 mx-auto text-slate-300 mb-2" />
        <p className="text-sm font-bold text-slate-700">No online orders yet</p>
        <p className="text-xs text-slate-400 mt-0.5">Import paid Shopify orders to start tracking their fulfillment here.</p>
      </div>
    );
  }

  const chips: { key: 'active' | 'all' | OnlineOrderStatus; label: string }[] = [
    { key: 'active', label: `Active (${counts.active || 0})` },
    ...ONLINE_ORDER_PIPELINE.map((s) => ({ key: s, label: `${s} (${counts[s] || 0})` })),
    { key: 'Cancelled', label: `Cancelled (${counts.Cancelled || 0})` },
    { key: 'all', label: `All (${online.length})` },
  ];

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="relative w-full lg:max-w-xs">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order, customer, phone, tracking…"
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-emerald-600"
          />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {chips.map((c) => (
            <button
              key={c.key}
              onClick={() => setFilter(c.key)}
              className={cn(
                'px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap border transition-colors shrink-0',
                filter === c.key ? 'bg-emerald-600 text-white border-emerald-700' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Order cards */}
      {filtered.length === 0 ? (
        <div className="py-10 text-center text-xs text-slate-400 bg-white border border-slate-200 rounded-xl">No orders match this filter.</div>
      ) : (
        filtered.map((inv) => {
          const s = statusOf(inv);
          const idx = ONLINE_ORDER_PIPELINE.indexOf(s);
          const isCancelled = s === 'Cancelled';
          const isDone = s === 'Delivered';
          const next = idx >= 0 && idx < ONLINE_ORDER_PIPELINE.length - 1 ? ONLINE_ORDER_PIPELINE[idx + 1] : null;
          const shipping = next === 'Shipped';
          const t = tracking[inv.id] || { number: inv.trackingNumber || '', courier: inv.courierName || '' };

          return (
            <div key={inv.id} className="bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden">
              {/* Header */}
              <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-xs font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">{inv.invoiceNumber}</span>
                  <span className="text-sm font-bold text-slate-900 truncate">{inv.customerName || 'Online customer'}</span>
                  {inv.customerPhone && <span className="text-xs text-slate-500 font-mono">· {inv.customerPhone}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold font-mono text-slate-900">{formatCurrency(inv.grandTotal || 0)}</span>
                  <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full border', STATUS_STYLE[s])}>{s}</span>
                </div>
              </div>

              {/* Stepper */}
              {!isCancelled && (
                <div className="px-4 py-3">
                  <div className="flex items-center">
                    {ONLINE_ORDER_PIPELINE.map((stage, i) => {
                      const done = i < idx;
                      const active = i === idx;
                      return (
                        <React.Fragment key={stage}>
                          <div className="flex flex-col items-center shrink-0" style={{ width: 82 }}>
                            <div className={cn(
                              'h-6 w-6 rounded-full flex items-center justify-center border text-[11px] font-bold',
                              done ? 'bg-emerald-600 text-white border-emerald-700'
                                : active ? 'bg-blue-600 text-white border-blue-700'
                                : 'bg-white text-slate-400 border-slate-300'
                            )}>
                              {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                            </div>
                            <span className={cn('mt-1 text-[9px] font-bold uppercase tracking-wide text-center leading-tight', active ? 'text-blue-700' : done ? 'text-emerald-700' : 'text-slate-400')}>{stage}</span>
                          </div>
                          {i < ONLINE_ORDER_PIPELINE.length - 1 && (
                            <div className={cn('h-0.5 flex-1', i < idx ? 'bg-emerald-500' : 'bg-slate-200')} />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Tracking + actions */}
              <div className="px-4 py-3 bg-slate-50/60 border-t border-slate-100 flex flex-wrap items-center gap-2">
                {(inv.trackingNumber || isCancelled) && (
                  <span className="text-[11px] text-slate-600 flex items-center gap-1">
                    {isCancelled ? <XCircle className="h-3.5 w-3.5 text-rose-500" /> : <Truck className="h-3.5 w-3.5 text-indigo-500" />}
                    {isCancelled ? 'Order cancelled' : <>Tracking: <span className="font-mono font-bold">{inv.trackingNumber}</span>{inv.courierName ? ` · ${inv.courierName}` : ''}</>}
                  </span>
                )}

                {shipping && !isCancelled && !isDone && (
                  <div className="flex items-center gap-1.5">
                    <input
                      value={t.number}
                      onChange={(e) => setTracking((p) => ({ ...p, [inv.id]: { ...t, number: e.target.value } }))}
                      placeholder="Tracking no."
                      className="w-32 px-2 py-1 rounded-md bg-white border border-slate-200 text-xs font-mono focus:outline-none focus:border-indigo-500"
                    />
                    <input
                      value={t.courier}
                      onChange={(e) => setTracking((p) => ({ ...p, [inv.id]: { ...t, courier: e.target.value } }))}
                      placeholder="Courier"
                      className="w-28 px-2 py-1 rounded-md bg-white border border-slate-200 text-xs focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                )}

                <div className="ml-auto flex items-center gap-2">
                  {!isCancelled && !isDone && next && (
                    <button
                      type="button"
                      disabled={busy === inv.id}
                      onClick={() => advance(inv, next)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold border border-emerald-700 transition-colors disabled:opacity-60"
                    >
                      {next === 'Shipped' ? <Truck className="h-3.5 w-3.5" /> : next === 'Delivered' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                      <span>Mark {next}</span>
                    </button>
                  )}
                  {isDone && (
                    <span className="flex items-center gap-1 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Delivered</span>
                  )}
                  {!isCancelled && !isDone && (
                    <button
                      type="button"
                      disabled={busy === inv.id}
                      onClick={() => advance(inv, 'Cancelled')}
                      className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-rose-50 text-rose-600 text-xs font-bold border border-rose-200 transition-colors disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>

              {/* Delivery address (if present) */}
              {inv.customerAddress && (
                <div className="px-4 py-2 border-t border-slate-100 text-[11px] text-slate-500 flex items-start gap-1.5">
                  <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-400" />
                  <span className="truncate">{inv.customerAddress}</span>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};

export default OnlineOrderPipeline;
