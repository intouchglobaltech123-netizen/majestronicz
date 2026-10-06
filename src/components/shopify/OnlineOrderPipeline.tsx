import React, { useMemo, useState } from 'react';
import { useErp } from '../../context/ErpContext';
import {
  Invoice,
  OnlineOrderStatus,
  ONLINE_ORDER_PIPELINE,
  ONLINE_NEXT_ACTION,
  onlinePipelineIndex,
} from '../../types';
import { formatCurrency, cn } from '../../lib/utils';
import { resizeAndCompressImage } from '../../lib/imageUtils';
import { toast } from 'sonner';
import { OnlineOrderDetail } from './OnlineOrderDetail';
import {
  Package, Truck, CheckCircle2, Clock, Search,
  ArrowRight, AlertTriangle,
} from 'lucide-react';

/** How long an order has sat in its current stage, and whether it's overdue. */
const stageAge = (inv: Invoice): { label: string; overdue: boolean } | null => {
  const since = inv.onlineStatusUpdatedAt || inv.createdAt;
  if (!since) return null;
  const ms = Date.now() - new Date(since).getTime();
  if (ms < 0 || Number.isNaN(ms)) return null;
  const h = Math.floor(ms / 3_600_000);
  const d = Math.floor(h / 24);
  return { label: d > 0 ? `${d}d ${h % 24}h` : `${h}h`, overdue: h >= 48 };
};

/** Colour per pipeline stage. */
const STATUS_STYLE: Record<OnlineOrderStatus, string> = {
  New: 'bg-slate-100 text-slate-700 border-slate-300',
  Picking: 'bg-sky-50 text-sky-700 border-sky-200',
  'Tray Photo': 'bg-cyan-50 text-cyan-700 border-cyan-200',
  Confirmed: 'bg-blue-50 text-blue-700 border-blue-200',
  Billed: 'bg-teal-50 text-teal-700 border-teal-200',
  Packed: 'bg-amber-50 text-amber-700 border-amber-200',
  Shipped: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  'In Transit': 'bg-violet-50 text-violet-700 border-violet-200',
  'Out for Delivery': 'bg-violet-50 text-violet-700 border-violet-200',
  Delivered: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Completed: 'bg-emerald-600 text-white border-emerald-700',
  Cancelled: 'bg-rose-50 text-rose-700 border-rose-200',
};

const statusOf = (inv: Invoice): OnlineOrderStatus => (inv.onlineStatus as OnlineOrderStatus) || 'New';

export const OnlineOrderPipeline: React.FC = () => {
  const { invoices, updateOnlineOrderStatus, addOrderCommunication, saveOrderPacking, saveOrderTracking, setCourierStatus, assignOrderStaff, recordDeliveryProof, setReturnStatus, setRtoStatus, reviseOnlineOrder, addOrderIssue, resolveOrderIssue, currentBranch, isAllBranches } = useErp();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'active' | 'all' | 'issues' | 'returns' | 'tracking-pending' | OnlineOrderStatus>('active');
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const online = useMemo(() => {
    // Real Shopify online orders. (Demo/test orders use 'shopify-demo' and are
    // never shown on the live fulfillment board.)
    return invoices
      .filter((i) => i.sourceChannel === 'shopify' && !i.isVoided)
      .filter((i) => isAllBranches || i.branchId === currentBranch)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [invoices, currentBranch, isAllBranches]);

  const hasOpenIssue = (o: Invoice) => Array.isArray(o.issues) && o.issues.some((x: any) => x?.status !== 'resolved');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return online.filter((o) => {
      const s = statusOf(o);
      // Quick filters.
      if (filter === 'active' && (s === 'Delivered' || s === 'Completed' || s === 'Cancelled')) return false;
      if (filter === 'issues' && !hasOpenIssue(o)) return false;
      if (filter === 'returns' && !o.returnStatus && !o.rtoStatus) return false;
      if (filter === 'tracking-pending' && !(onlinePipelineIndex(s) >= onlinePipelineIndex('Shipped' as OnlineOrderStatus) && !o.trackingNumber)) return false;
      if (filter !== 'active' && filter !== 'all' && filter !== 'issues' && filter !== 'returns' && filter !== 'tracking-pending' && s !== filter) return false;
      if (!q) return true;
      // Spec search: order no / Shopify id / customer / phone / email / item name
      // or SKU / tracking / courier / courier reference.
      const itemHit = Array.isArray(o.items) && o.items.some((li: any) =>
        (li.itemName || '').toLowerCase().includes(q) || (li.itemCode || '').toLowerCase().includes(q));
      return (
        o.invoiceNumber.toLowerCase().includes(q) ||
        (o.externalOrderId || '').toLowerCase().includes(q) ||
        (o.customerName || '').toLowerCase().includes(q) ||
        (o.customerPhone || '').includes(q) ||
        (o.trackingNumber || '').toLowerCase().includes(q) ||
        (o.trackingReference || '').toLowerCase().includes(q) ||
        (o.courierName || '').toLowerCase().includes(q) ||
        itemHit
      );
    });
  }, [online, filter, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { active: 0 };
    for (const o of online) {
      const s = statusOf(o);
      c[s] = (c[s] || 0) + 1;
      if (s !== 'Delivered' && s !== 'Completed' && s !== 'Cancelled') c.active += 1;
    }
    return c;
  }, [online]);

  const advance = async (
    inv: Invoice,
    to: OnlineOrderStatus,
    optsOverride?: { trackingNumber?: string; courierName?: string; trackingUrl?: string },
  ) => {
    setBusy(inv.id);
    // The quick "Mark" buttons just advance the stage; tracking, photos and the
    // rest are captured on the order's full detail page (click a row to open it).
    await updateOnlineOrderStatus(inv.id, to, optsOverride);
    setBusy(null);
  };

  // Upload a stage photo (tray / parcel) and save it against the order, logging it.
  const uploadPhoto = async (inv: Invoice, kind: 'tray' | 'parcel', file: File | null) => {
    if (!file) return;
    setBusy(inv.id);
    try {
      const { dataUrl } = await resizeAndCompressImage(file, 900);
      const field = kind === 'tray' ? 'trayPhotoUrl' : 'parcelPhotoUrl';
      await updateOnlineOrderStatus(inv.id, statusOf(inv), {
        [field]: dataUrl,
        note: kind === 'tray' ? 'Tray photo uploaded' : 'Parcel photo uploaded',
      });
    } catch {
      toast.error('Could not process that image');
    } finally {
      setBusy(null);
    }
  };

  // Full-page detail for a selected order (opens in place, with a Back button).
  const selected = selectedId ? online.find((o) => o.id === selectedId) : null;
  if (selected) {
    return (
      <OnlineOrderDetail
        inv={selected}
        busy={busy === selected.id}
        onBack={() => setSelectedId(null)}
        onAdvance={(to, opts) => advance(selected, to, opts)}
        onUploadPhoto={(kind, file) => uploadPhoto(selected, kind, file)}
        onComm={(type, note) => addOrderCommunication(selected.id, type, note)}
        onSaveTracking={(patch) => saveOrderTracking(selected.id, patch)}
        onSetCourierStatus={(status) => setCourierStatus(selected.id, status)}
        onAssignStaff={(stage, staffName) => assignOrderStaff(selected.id, stage, staffName)}
        onRecordPod={(patch) => recordDeliveryProof(selected.id, patch)}
        onSetReturnStatus={(status, note) => setReturnStatus(selected.id, status, note)}
        onSetRtoStatus={(status, note) => setRtoStatus(selected.id, status, note)}
        onRevise={(items, note) => reviseOnlineOrder(selected.id, items, note)}
        onSavePacking={(patch) => saveOrderPacking(selected.id, patch)}
        onAddIssue={(type, description) => addOrderIssue(selected.id, type, description)}
        onResolveIssue={(issueId, resolution) => resolveOrderIssue(selected.id, issueId, resolution)}
      />
    );
  }

  if (online.length === 0) {
    return (
      <div className="py-12 text-center text-slate-500 bg-white border border-slate-200 rounded-xl">
        <Package className="h-10 w-10 mx-auto text-slate-300 mb-2" />
        <p className="text-sm font-bold text-slate-700">No online orders yet</p>
        <p className="text-xs text-slate-400 mt-0.5">Import paid Shopify orders to start tracking their fulfillment here.</p>
      </div>
    );
  }

  // Stage dashboard tiles (click to filter). Overdue = active orders sitting
  // 48h+ in their current stage.
  const overdueCount = online.filter((o) => {
    const s = statusOf(o);
    if (s === 'Delivered' || s === 'Completed' || s === 'Cancelled') return false;
    return stageAge(o)?.overdue;
  }).length;
  const openIssuesCount = online.filter((o) => (Array.isArray(o.issues) ? o.issues : []).some((i) => i.status !== 'resolved')).length;
  const trackingPendingCount = online.filter((o) => onlinePipelineIndex(statusOf(o)) >= onlinePipelineIndex('Shipped' as OnlineOrderStatus) && !o.trackingNumber).length;
  const returnsCount = online.filter((o) => o.returnStatus || o.rtoStatus).length;
  const tiles: { key: 'active' | 'all' | 'issues' | 'returns' | 'tracking-pending' | OnlineOrderStatus; label: string; count: number }[] = [
    { key: 'active', label: 'Active', count: counts.active || 0 },
    ...ONLINE_ORDER_PIPELINE.map((s) => ({ key: s as OnlineOrderStatus, label: s, count: counts[s] || 0 })),
    { key: 'Cancelled', label: 'Cancelled', count: counts.Cancelled || 0 },
    { key: 'issues', label: 'Has issue', count: openIssuesCount },
    { key: 'returns', label: 'Returns/RTO', count: returnsCount },
    { key: 'tracking-pending', label: 'Tracking pending', count: trackingPendingCount },
    { key: 'all', label: 'All', count: online.length },
  ];

  return (
    <div className="space-y-3">
      {/* Stage dashboard */}
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        {tiles.map((tile) => (
          <button
            key={tile.key}
            onClick={() => setFilter(tile.key)}
            className={cn(
              'text-left px-3 py-2 rounded-lg border transition-colors',
              filter === tile.key ? 'bg-emerald-600 text-white border-emerald-700' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            )}
          >
            <div className="text-lg font-extrabold font-mono leading-none">{tile.count}</div>
            <div className={cn('text-[10px] font-bold uppercase tracking-wide mt-1', filter === tile.key ? 'text-emerald-50' : 'text-slate-500')}>{tile.label}</div>
          </button>
        ))}
        {overdueCount > 0 && (
          <div className="px-3 py-2 rounded-lg border border-rose-200 bg-rose-50 text-rose-700">
            <div className="text-lg font-extrabold font-mono leading-none flex items-center gap-1"><AlertTriangle className="h-4 w-4" />{overdueCount}</div>
            <div className="text-[10px] font-bold uppercase tracking-wide mt-1">Overdue (48h+)</div>
          </div>
        )}
        {openIssuesCount > 0 && (
          <div className="px-3 py-2 rounded-lg border border-rose-300 bg-rose-100 text-rose-800">
            <div className="text-lg font-extrabold font-mono leading-none flex items-center gap-1"><AlertTriangle className="h-4 w-4" />{openIssuesCount}</div>
            <div className="text-[10px] font-bold uppercase tracking-wide mt-1">Open issues</div>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="relative w-full lg:max-w-xs">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order, Shopify id, customer, phone, item/SKU, tracking, courier…"
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-emerald-600"
          />
        </div>
        <div className="text-[11px] text-slate-400 lg:ml-auto">Tap a stage above to filter · click an order to open its full detail page</div>
      </div>

      {/* Order cards */}
      {filtered.length === 0 ? (
        <div className="py-10 text-center text-xs text-slate-400 bg-white border border-slate-200 rounded-xl">No orders match this filter.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl shadow-2xs divide-y divide-slate-100 overflow-hidden">
          {filtered.map((inv) => {
            const s = statusOf(inv);
            const idx = onlinePipelineIndex(s);
            const isCancelled = s === 'Cancelled';
            const isDone = s === 'Completed' || s === 'Delivered';
            const next = idx >= 0 && idx < ONLINE_ORDER_PIPELINE.length - 1 ? ONLINE_ORDER_PIPELINE[idx + 1] : null;
            const age = stageAge(inv);
            const openIssues = (Array.isArray(inv.issues) ? inv.issues : []).filter((i) => i.status !== 'resolved').length;
            const itemCount = Array.isArray(inv.items) ? inv.items.reduce((n: number, l: any) => n + (Number(l.quantity) || 0), 0) : 0;

            // One compact row per order; the full stepper, photos, tracking,
            // returns, revisions and history open on its detail page.
            return (
              <div key={inv.id} className="flex items-center gap-3 px-3 sm:px-4 py-2.5 hover:bg-slate-50 transition-colors">
                <button type="button" onClick={() => setSelectedId(inv.id)} className="flex-1 min-w-0 text-left flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[11px] font-bold text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 shrink-0">{inv.invoiceNumber}</span>
                  <span className="text-sm font-bold text-slate-900 truncate max-w-[9rem] sm:max-w-none">{inv.customerName || 'Online customer'}</span>
                  {inv.customerPhone && <span className="hidden sm:inline text-[11px] text-slate-400 font-mono">· {inv.customerPhone}</span>}
                  <span className="hidden md:inline text-[11px] text-slate-400">· {itemCount} item{itemCount === 1 ? '' : 's'}</span>
                  {!isCancelled && !isDone && age && (
                    <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded border inline-flex items-center gap-1',
                      age.overdue ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-slate-50 text-slate-500 border-slate-200')}>
                      {age.overdue && <AlertTriangle className="h-3 w-3" />}{age.label}
                    </span>
                  )}
                  {openIssues > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-rose-100 text-rose-800 border-rose-300 inline-flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />{openIssues}
                    </span>
                  )}
                </button>

                {/* Compact progress + total + status */}
                <span className="hidden lg:inline text-[10px] font-mono text-slate-400 shrink-0">{idx >= 0 ? `${idx + 1}/${ONLINE_ORDER_PIPELINE.length}` : ''}</span>
                <span className="text-sm font-bold font-mono text-slate-900 shrink-0 w-20 text-right hidden sm:block">{formatCurrency(inv.grandTotal || 0)}</span>
                <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full border shrink-0', STATUS_STYLE[s])}>{s}</span>

                {/* Quick advance + open */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {!isCancelled && next && s !== 'Delivered' && (
                    <button type="button" disabled={busy === inv.id} onClick={() => advance(inv, next)} title={ONLINE_NEXT_ACTION[s]}
                      className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold border border-emerald-700 disabled:opacity-60">
                      {next === 'Shipped' ? <Truck className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                      <span>Mark {next}</span>
                    </button>
                  )}
                  {s === 'Delivered' && (
                    <button type="button" disabled={busy === inv.id} onClick={() => advance(inv, 'Completed')}
                      className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold border border-emerald-700 disabled:opacity-60">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Complete
                    </button>
                  )}
                  <button type="button" onClick={() => setSelectedId(inv.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 text-[11px] font-bold border border-slate-300">
                    Open <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default OnlineOrderPipeline;
