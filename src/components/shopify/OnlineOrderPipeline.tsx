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
  Package, Truck, CheckCircle2, XCircle, Clock, Search, MapPin,
  Camera, ArrowRight, History, ChevronDown, ChevronUp, Link as LinkIcon, AlertTriangle,
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
  const { invoices, updateOnlineOrderStatus, addOrderCommunication, saveOrderPacking, saveOrderTracking, setCourierStatus, assignOrderStaff, recordDeliveryProof, addOrderIssue, resolveOrderIssue, currentBranch, isAllBranches } = useErp();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'active' | 'all' | OnlineOrderStatus>('active');
  // Per-order tracking inputs (shown when shipping).
  const [tracking, setTracking] = useState<Record<string, { number: string; courier: string; url: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const online = useMemo(() => {
    return invoices
      .filter((i) => i.sourceChannel === 'shopify' && !i.isVoided)
      .filter((i) => isAllBranches || i.branchId === currentBranch)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [invoices, currentBranch, isAllBranches]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return online.filter((o) => {
      const s = statusOf(o);
      if (filter === 'active' && (s === 'Delivered' || s === 'Completed' || s === 'Cancelled')) return false;
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
    const t = tracking[inv.id];
    // Tracking details are captured when the order is dispatched (Packed → Shipped).
    const opts = optsOverride ?? (to === 'Shipped'
      ? { trackingNumber: t?.number || undefined, courierName: t?.courier || undefined, trackingUrl: t?.url || undefined }
      : undefined);
    await updateOnlineOrderStatus(inv.id, to, opts);
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
  const tiles: { key: 'active' | 'all' | OnlineOrderStatus; label: string; count: number }[] = [
    { key: 'active', label: 'Active', count: counts.active || 0 },
    ...ONLINE_ORDER_PIPELINE.map((s) => ({ key: s, label: s, count: counts[s] || 0 })),
    { key: 'Cancelled', label: 'Cancelled', count: counts.Cancelled || 0 },
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
            placeholder="Search order, customer, phone, tracking…"
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-emerald-600"
          />
        </div>
        <div className="text-[11px] text-slate-400 lg:ml-auto">Tap a stage above to filter · click an order to open its full detail page</div>
      </div>

      {/* Order cards */}
      {filtered.length === 0 ? (
        <div className="py-10 text-center text-xs text-slate-400 bg-white border border-slate-200 rounded-xl">No orders match this filter.</div>
      ) : (
        filtered.map((inv) => {
          const s = statusOf(inv);
          const idx = onlinePipelineIndex(s);
          const isCancelled = s === 'Cancelled';
          const isDone = s === 'Completed' || s === 'Delivered';
          const next = idx >= 0 && idx < ONLINE_ORDER_PIPELINE.length - 1 ? ONLINE_ORDER_PIPELINE[idx + 1] : null;
          const shipping = next === 'Shipped';
          const t = tracking[inv.id] || { number: inv.trackingNumber || '', courier: inv.courierName || '', url: inv.trackingUrl || '' };
          const setT = (patch: Partial<typeof t>) => setTracking((p) => ({ ...p, [inv.id]: { ...t, ...patch } }));
          const history = Array.isArray(inv.onlineStatusHistory) ? inv.onlineStatusHistory : [];
          const showHistory = !!historyOpen[inv.id];

          return (
            <div key={inv.id} className="bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden">
              {/* Header (click to open full detail) */}
              <button
                type="button"
                onClick={() => setSelectedId(inv.id)}
                className="w-full text-left px-4 py-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-xs font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">{inv.invoiceNumber}</span>
                  <span className="text-sm font-bold text-slate-900 truncate">{inv.customerName || 'Online customer'}</span>
                  {inv.customerPhone && <span className="text-xs text-slate-500 font-mono">· {inv.customerPhone}</span>}
                  {(() => {
                    const age = stageAge(inv);
                    if (!age || isCancelled || isDone) return null;
                    return (
                      <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded border inline-flex items-center gap-1',
                        age.overdue ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-slate-50 text-slate-500 border-slate-200')}>
                        {age.overdue && <AlertTriangle className="h-3 w-3" />}{age.label} in stage
                      </span>
                    );
                  })()}
                  {(() => {
                    const open = (Array.isArray(inv.issues) ? inv.issues : []).filter((i) => i.status !== 'resolved').length;
                    if (!open) return null;
                    return (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-rose-100 text-rose-800 border-rose-300 inline-flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />{open} issue{open > 1 ? 's' : ''}
                      </span>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold font-mono text-slate-900">{formatCurrency(inv.grandTotal || 0)}</span>
                  <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full border', STATUS_STYLE[s])}>{s}</span>
                </div>
              </button>

              {/* Current stage + NEXT ACTION */}
              {!isCancelled && (
                <div className="px-4 pt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Current stage:</span>
                  <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full border', STATUS_STYLE[s])}>{s}</span>
                  {!isDone && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-600">
                      <ArrowRight className="h-3.5 w-3.5 text-emerald-600" />
                      <span className="font-bold text-slate-700">NEXT:</span> {ONLINE_NEXT_ACTION[s]}
                    </span>
                  )}
                </div>
              )}

              {/* Stepper (scrolls horizontally — the flow has many stages) */}
              {!isCancelled && (
                <div className="px-4 py-3 overflow-x-auto">
                  <div className="flex items-center min-w-max">
                    {ONLINE_ORDER_PIPELINE.map((stage, i) => {
                      const done = i < idx;
                      const active = i === idx;
                      return (
                        <React.Fragment key={stage}>
                          <div className="flex flex-col items-center shrink-0" style={{ width: 74 }}>
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
                            <div className={cn('h-0.5 w-6 shrink-0', i < idx ? 'bg-emerald-500' : 'bg-slate-200')} />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Photos: tray (picking proof) + parcel (dispatch proof) */}
              {!isCancelled && (
                <div className="px-4 pb-2 flex flex-wrap gap-4">
                  {(['tray', 'parcel'] as const).map((kind) => {
                    const url = kind === 'tray' ? inv.trayPhotoUrl : inv.parcelPhotoUrl;
                    const label = kind === 'tray' ? 'Tray photo' : 'Parcel photo';
                    return (
                      <div key={kind} className="flex items-center gap-2">
                        {url ? (
                          <img src={url} alt={label} className="h-12 w-12 object-cover rounded border border-slate-200" />
                        ) : (
                          <div className="h-12 w-12 rounded border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center text-slate-300">
                            <Camera className="h-5 w-5" />
                          </div>
                        )}
                        <label className="text-[11px] font-bold text-slate-600 cursor-pointer hover:text-emerald-700">
                          <span className="block">{label}</span>
                          <span className="text-[10px] font-normal text-emerald-700 underline">{url ? 'Replace' : 'Upload'}</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            disabled={busy === inv.id}
                            onChange={(e) => uploadPhoto(inv, kind, e.target.files?.[0] || null)}
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Tracking + actions */}
              <div className="px-4 py-3 bg-slate-50/60 border-t border-slate-100 flex flex-wrap items-center gap-2">
                {(inv.trackingNumber || isCancelled) && (
                  <span className="text-[11px] text-slate-600 flex items-center gap-1">
                    {isCancelled ? <XCircle className="h-3.5 w-3.5 text-rose-500" /> : <Truck className="h-3.5 w-3.5 text-indigo-500" />}
                    {isCancelled ? 'Order cancelled' : <>Tracking: <span className="font-mono font-bold">{inv.trackingNumber}</span>{inv.courierName ? ` · ${inv.courierName}` : ''}</>}
                    {!isCancelled && inv.trackingUrl && (
                      <a href={inv.trackingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-blue-600 hover:text-blue-800"><LinkIcon className="h-3 w-3" />track</a>
                    )}
                  </span>
                )}

                {shipping && !isCancelled && !isDone && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input
                      value={t.number}
                      onChange={(e) => setT({ number: e.target.value })}
                      placeholder="Tracking / AWB no."
                      className="w-36 px-2 py-1 rounded-md bg-white border border-slate-200 text-xs font-mono focus:outline-none focus:border-indigo-500"
                    />
                    <input
                      value={t.courier}
                      onChange={(e) => setT({ courier: e.target.value })}
                      placeholder="Courier"
                      className="w-28 px-2 py-1 rounded-md bg-white border border-slate-200 text-xs focus:outline-none focus:border-indigo-500"
                    />
                    <input
                      value={t.url}
                      onChange={(e) => setT({ url: e.target.value })}
                      placeholder="Tracking link (URL)"
                      className="w-44 px-2 py-1 rounded-md bg-white border border-slate-200 text-xs focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                )}

                <div className="ml-auto flex items-center gap-2">
                  {history.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setHistoryOpen((p) => ({ ...p, [inv.id]: !showHistory }))}
                      className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-600 text-[11px] font-bold border border-slate-200"
                    >
                      <History className="h-3.5 w-3.5" /> History
                      {showHistory ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                  )}
                  {!isCancelled && next && s !== 'Delivered' && (
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
                  {s === 'Delivered' && (
                    <button
                      type="button"
                      disabled={busy === inv.id}
                      onClick={() => advance(inv, 'Completed')}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold border border-emerald-700 transition-colors disabled:opacity-60"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> <span>Mark Completed</span>
                    </button>
                  )}
                  {s === 'Completed' && (
                    <span className="flex items-center gap-1 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Completed</span>
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

              {/* Activity history (append-only: who did what, when) */}
              {showHistory && history.length > 0 && (
                <div className="px-4 py-2 border-t border-slate-100 bg-white">
                  <ul className="space-y-1">
                    {[...history].reverse().map((h, i) => (
                      <li key={i} className="flex items-start gap-2 text-[11px] text-slate-600">
                        <span className={cn('mt-0.5 inline-block h-2 w-2 rounded-full shrink-0', 'bg-emerald-400')} />
                        <span>
                          <span className="font-bold text-slate-800">{h.status}</span>
                          {h.note ? ` — ${h.note}` : ''} · <span className="font-medium">{h.by}</span>
                          <span className="text-slate-400"> · {new Date(h.at).toLocaleString('en-IN')}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

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
