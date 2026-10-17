import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useErp } from '../../context/ErpContext';
import {
  Invoice,
  OnlineOrderStatus,
  BRANCHES,
} from '../../types';
import { ShopifyOrder } from '../../types/shopify';
import { formatCurrency, cn } from '../../lib/utils';
import { resizeAndCompressImage } from '../../lib/imageUtils';
import { ItemSearchDropdown } from '../common/ItemSearchDropdown';
import { toast } from 'sonner';
import {
  Package, Truck, CheckCircle2, Search, ArrowLeft, ArrowRight, User,
  Phone, MapPin, Pencil, Save, Printer, Copy, Camera, Send, Scale,
  Boxes, IndianRupee, Clock, XCircle, MessageCircle, Bell, ListChecks,
  RefreshCw, DownloadCloud, RotateCcw, Undo2, Zap, AlertTriangle,
} from 'lucide-react';

/* ────────────────────────────────────────────────────────────────────────────
 *  A SIMPLE, Flipkart-Seller-Hub-style board for online (Shopify) orders.
 *  The full ERP pipeline (OnlineOrderPipeline / OnlineOrderDetail) still exists
 *  under "Advanced view"; this board collapses it into Flipkart's few stages and
 *  one-tap Next / Back, with the day-to-day tools staff actually use: paste the
 *  customer + address, pick with live stock, send WhatsApp updates, print a box
 *  label, record tracking, and collect any extra payment.
 * ──────────────────────────────────────────────────────────────────────────── */

const SHOP_NAME = 'MAJESTRONICZ';

// The order-processing flow (Change 08). Six steps, each marked completed
// manually by staff; the stored onlineStatus is the order's current step.
// Stage → stored status:  To Accept=New, Photo Sent=Tray Photo, Packing=Packed,
// Courier Handover=Shipped, Tracking ID Sent=In Transit, Completed=Completed.
const MILESTONES: OnlineOrderStatus[] = ['New', 'Tray Photo', 'Packed', 'Shipped', 'In Transit', 'Completed'];
/** The step labels shown to staff (index-aligned with MILESTONES). */
const STEP_LABELS = ['To Accept', 'Photo Sent', 'Packing', 'Courier Handover', 'Tracking ID Sent', 'Completed'];
const FORWARD_LABEL: Record<string, string> = {
  New: 'Mark photo sent',
  'Tray Photo': 'Mark packed',
  Packed: 'Mark handed to courier',
  Shipped: 'Mark tracking sent',
  'In Transit': 'Mark completed',
};

/** Board buckets = the six processing steps (the top status tiles). */
type Bucket = 'to_accept' | 'photo_sent' | 'packing' | 'courier_handover' | 'tracking_sent' | 'completed' | 'cancelled';
const BUCKET_LABEL: Record<Bucket, string> = {
  to_accept: 'To Accept',
  photo_sent: 'Photo Sent',
  packing: 'Packing',
  courier_handover: 'Courier Handover',
  tracking_sent: 'Tracking ID Sent',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
const BUCKET_STYLE: Record<Bucket, string> = {
  to_accept: 'bg-amber-50 text-amber-700 border-amber-200',
  photo_sent: 'bg-sky-50 text-sky-700 border-sky-200',
  packing: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  courier_handover: 'bg-violet-50 text-violet-700 border-violet-200',
  tracking_sent: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled: 'bg-rose-50 text-rose-700 border-rose-200',
};

/** Map any stored ERP status (incl. legacy) to a step index 0..5. */
const milestoneIndex = (s?: OnlineOrderStatus): number => {
  switch (s) {
    case 'New': case undefined: return 0;
    case 'Picking': case 'Tray Photo': case 'Confirmed': return 1;
    case 'Billed': case 'Packed': return 2;
    case 'Shipped': return 3;
    case 'In Transit': case 'Out for Delivery': return 4;
    case 'Delivered': case 'Completed': return 5;
    default: return 0;
  }
};
const BUCKET_BY_INDEX: Bucket[] = ['to_accept', 'photo_sent', 'packing', 'courier_handover', 'tracking_sent', 'completed'];
const bucketOf = (inv: Invoice): Bucket => {
  const s = (inv.onlineStatus as OnlineOrderStatus) || 'New';
  if (s === 'Cancelled') return 'cancelled';
  return BUCKET_BY_INDEX[milestoneIndex(s)];
};

// ── Change 06: 24-hour packing alert ──────────────────────────────────────
/** Hours elapsed since an ISO timestamp (0 if unknown). */
const hoursSince = (iso?: string): number => {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (Date.now() - t) / 3_600_000);
};
/** An order is "unpacked" until it reaches the Packing step (index 2). */
const isUnpacked = (inv: Invoice) =>
  (inv.onlineStatus as OnlineOrderStatus) !== 'Cancelled' && milestoneIndex(inv.onlineStatus as OnlineOrderStatus) < 2;
/** Packing is overdue when an unpacked order has waited > 24h from order time. */
const packingOverdue = (inv: Invoice) => isUnpacked(inv) && hoursSince(inv.externalCreatedAt || inv.createdAt) > 24;
const hoursPending = (inv: Invoice) => Math.floor(hoursSince(inv.externalCreatedAt || inv.createdAt));
/** Auto-complete window: an order in "Tracking ID Sent" closes after 7 days. */
const AUTO_COMPLETE_DAYS = 7;

/** wa.me deep link with a prefilled message (India numbers default to +91). */
const waLink = (phone: string | undefined, text: string): string | null => {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const intl = digits.length === 10 ? `91${digits}` : digits.replace(/^0+/, '');
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
};

/** The order received time that drives the cut-off (Shopify time, else import). */
const orderTimeOf = (inv: Invoice) => inv.externalCreatedAt || inv.createdAt;
/** Shopify order name "#6807" when known, else the ERP bill number (never the
 *  long numeric Shopify id). */
const orderNoOf = (inv: Invoice) => inv.externalOrderName || inv.invoiceNumber;
const balanceOf = (inv: Invoice) => Math.max(0, Number(inv.balanceDue) || 0);

/** "14-10-2026, 3:45 PM" from an ISO/date string. */
const fmtDateTime = (iso?: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const date = d.toLocaleDateString('en-GB').replace(/\//g, '-'); // DD-MM-YYYY
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${date}, ${time}`;
};

/** Whether an un-imported Shopify order can be fulfilled from current ERP stock. */
const stockStatusOf = (o: ShopifyOrder): { label: string; tone: 'ok' | 'short' | 'check' } => {
  const lines = o.lines || [];
  const matched = lines.filter((l) => l.matched);
  const anyShort = matched.some((l) => (l.erpStockOnHand ?? 0) < (l.qty || 0));
  const anyUnmatched = lines.some((l) => !l.matched);
  if (anyShort) return { label: 'Low stock', tone: 'short' };
  if (anyUnmatched) return { label: 'Check items', tone: 'check' };
  return { label: 'In stock', tone: 'ok' };
};
const STOCK_TONE: Record<'ok' | 'short' | 'check', string> = {
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  short: 'bg-rose-50 text-rose-700 border-rose-200',
  check: 'bg-amber-50 text-amber-700 border-amber-200',
};

/* ───────────────────────────── Board (list view) ──────────────────────────── */

interface BoardProps {
  /** Live Shopify store orders (source list) — un-imported paid ones show in "To Accept". */
  shopifyOrders?: ShopifyOrder[];
  importing?: boolean;
  syncing?: boolean;
  onImportAll?: () => void;
  /** Accept just ONE order by its Shopify order id; resolves true on success. */
  onAcceptOne?: (externalOrderId: string) => Promise<boolean>;
  onRefresh?: () => void;
  onOpenShopifyOrder?: (o: ShopifyOrder) => void;
}

export const FlipkartBoard: React.FC<BoardProps> = ({ shopifyOrders = [], importing, syncing, onImportAll, onRefresh, onOpenShopifyOrder }) => {
  const { invoices, currentUser, resetOnlineProcessing, restoreOnlineProcessing, updateOnlineOrderStatus } = useErp();
  // Reset-for-testing wipes every online order's processing back to the start —
  // a testing-only tool, so it's CEO-only and never sits on a branch manager's
  // live board (H6).
  const canReset = currentUser.role === 'CEO';
  const [resetting, setResetting] = useState(false);
  const doReset = async () => {
    if (!window.confirm('Reset ALL online orders back to the start (To Accept) for testing?\n\nThis only resets the ERP processing steps — Shopify orders, customers, items and payments are NOT touched, and the current state is backed up so it can be restored.')) return;
    setResetting(true);
    try { if (await resetOnlineProcessing()) setView('to_accept'); } finally { setResetting(false); }
  };
  const doRestore = async () => {
    if (!window.confirm('Restore all online orders to the processing state saved by the last reset?')) return;
    setResetting(true);
    try { await restoreOnlineProcessing(); } finally { setResetting(false); }
  };
  const [view, setView] = useState<'all_orders' | Bucket | 'packing_overdue'>('all_orders');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedPending, setExpandedPending] = useState<string | null>(null);
  // Re-render every minute so "pending hours" and the 24h / 7-day thresholds
  // stay live while the board is open.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Auto-accept: new paid Shopify orders are pulled into the ERP automatically
  // so they land in "To Accept" — there is no manual Accept step (Change 07).
  // Persisted per-browser; default ON.
  const [autoAccept, setAutoAccept] = useState<boolean>(() => {
    try { return localStorage.getItem('shopifyAutoAccept') !== 'off'; } catch { return true; }
  });
  const toggleAutoAccept = () => setAutoAccept((v) => {
    const next = !v;
    try { localStorage.setItem('shopifyAutoAccept', next ? 'on' : 'off'); } catch { /* ignore */ }
    return next;
  });

  // Shopify order name ("#6807") for already-imported orders that predate the
  // stored name — looked up from the live store list by Shopify order id.
  const nameByExtId = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of shopifyOrders) if (o.externalOrderId && o.orderName) m.set(o.externalOrderId, o.orderName);
    return m;
  }, [shopifyOrders]);
  const displayNo = (inv: Invoice) => inv.externalOrderName || (inv.externalOrderId ? nameByExtId.get(inv.externalOrderId) : undefined) || inv.invoiceNumber;

  // Paid Shopify orders not yet pulled into the ERP. With auto-accept on they
  // are imported automatically; until then they show at the top of To Accept.
  const pending = useMemo(
    () => shopifyOrders.filter((o) => !o.alreadyImported && o.financialStatus === 'paid'),
    [shopifyOrders],
  );

  // Auto-accept new paid orders as soon as they appear (once per distinct set,
  // so a failed import isn't retried in a loop). Imported orders land at "New"
  // in To Accept, ready to process.
  const autoAcceptedSig = useRef<string>('');
  useEffect(() => {
    if (!autoAccept || !onImportAll || importing) return;
    const sig = pending.map((o) => o.externalOrderId).sort().join(',');
    if (!sig) { autoAcceptedSig.current = ''; return; }
    if (sig === autoAcceptedSig.current) return;
    autoAcceptedSig.current = sig;
    onImportAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAccept, pending, importing]);

  // All online orders already in the ERP — NOT filtered by the selected branch
  // (online orders belong to the store, not one counter), so they never vanish.
  const online = useMemo(
    () =>
      invoices
        .filter((i) => i.sourceChannel === 'shopify' && !i.isVoided)
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [invoices],
  );

  const matchesView = (inv: Invoice, v: typeof view): boolean => {
    if (v === 'all_orders') return true; // All Orders shows the complete list
    if (v === 'packing_overdue') return packingOverdue(inv);
    return bucketOf(inv) === v;
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { all_orders: 0, to_accept: 0, photo_sent: 0, packing: 0, courier_handover: 0, tracking_sent: 0, completed: 0, cancelled: 0, packing_overdue: 0 };
    for (const o of online) {
      c[bucketOf(o)] += 1;
      if (packingOverdue(o)) c.packing_overdue += 1;
    }
    // Un-imported Shopify orders are new → they belong in To Accept (and the
    // all-orders total), until auto-accept pulls them in.
    c.to_accept += pending.length;
    c.all_orders = online.length + pending.length;
    return c;
  }, [online, pending]);

  // Change 08: auto-close an order 7 days after its tracking ID was sent (it sits
  // in "Tracking ID Sent" / In Transit until then). Runs while the board is open;
  // guarded so each order is only pushed to Completed once.
  const autoCompletedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!updateOnlineOrderStatus) return;
    for (const o of online) {
      if (bucketOf(o) !== 'tracking_sent') continue;
      if (autoCompletedRef.current.has(o.id)) continue;
      if (hoursSince(o.updatedAt) > AUTO_COMPLETE_DAYS * 24) {
        autoCompletedRef.current.add(o.id);
        void updateOnlineOrderStatus(o.id, 'Completed', { note: `Auto-completed ${AUTO_COMPLETE_DAYS} days after tracking sent` });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  // Un-imported Shopify orders shown for the current view (To Accept / All Orders).
  const pendingForView = useMemo(() => {
    const base = view === 'to_accept' || view === 'all_orders' ? pending : [];
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter((o) =>
      o.orderName.toLowerCase().includes(q) ||
      (o.customerName || '').toLowerCase().includes(q) ||
      (o.customerPhone || '').includes(q),
    );
  }, [view, pending, search]);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return online.filter((o) => {
      if (!matchesView(o, view)) return false;
      if (!q) return true;
      const itemHit = Array.isArray(o.items) && o.items.some((li: any) => (li.itemName || '').toLowerCase().includes(q));
      return (
        orderNoOf(o).toLowerCase().includes(q) ||
        (o.customerName || '').toLowerCase().includes(q) ||
        (o.customerPhone || '').includes(q) ||
        itemHit
      );
    });
  }, [online, view, search]);

  const selected = selectedId ? online.find((o) => o.id === selectedId) : null;
  if (selected) return <FlipkartOrderPanel inv={selected} onBack={() => setSelectedId(null)} />;

  const PRIMARY: { key: 'all_orders' | Bucket; label: string; icon: React.ReactNode }[] = [
    { key: 'all_orders', label: 'All Orders', icon: <ListChecks className="h-4 w-4" /> },
    { key: 'to_accept', label: BUCKET_LABEL.to_accept, icon: <Clock className="h-4 w-4" /> },
    { key: 'photo_sent', label: BUCKET_LABEL.photo_sent, icon: <Camera className="h-4 w-4" /> },
    { key: 'packing', label: BUCKET_LABEL.packing, icon: <Package className="h-4 w-4" /> },
    { key: 'courier_handover', label: BUCKET_LABEL.courier_handover, icon: <Truck className="h-4 w-4" /> },
    { key: 'tracking_sent', label: BUCKET_LABEL.tracking_sent, icon: <Send className="h-4 w-4" /> },
    { key: 'completed', label: BUCKET_LABEL.completed, icon: <CheckCircle2 className="h-4 w-4" /> },
    { key: 'cancelled', label: BUCKET_LABEL.cancelled, icon: <XCircle className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-3">
      {/* Heading row */}
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-sm font-extrabold text-slate-800">Forward Orders</h3>
        <span className="text-[11px] text-slate-400">· New orders arrive straight into To Accept</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={toggleAutoAccept}
            title={autoAccept ? 'Auto-accept is ON — new paid orders are pulled in automatically. Click to turn off.' : 'Auto-accept is OFF — click to pull new paid orders in automatically.'}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-bold transition-colors',
              autoAccept ? 'bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700' : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50',
            )}
          >
            <Zap className={cn('h-3.5 w-3.5', autoAccept && 'fill-current')} /> Auto-accept {autoAccept ? 'ON' : 'OFF'}
          </button>
          {canReset && (
            <>
              <button onClick={doReset} disabled={resetting} title="Reset all online orders to the start for testing (backed up first)" className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-700 text-[11px] font-bold hover:bg-amber-50 disabled:opacity-50">
                <RotateCcw className={cn('h-3.5 w-3.5', resetting && 'animate-spin')} /> Reset for testing
              </button>
              <button onClick={doRestore} disabled={resetting} title="Restore the processing state from the last reset backup" className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-500 text-[11px] font-bold hover:bg-slate-50 disabled:opacity-50">
                <Undo2 className="h-3.5 w-3.5" /> Restore
              </button>
            </>
          )}
          {onRefresh && (
            <button onClick={onRefresh} disabled={syncing} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-600 text-[11px] font-bold hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} /> Refresh from Shopify
            </button>
          )}
          {onImportAll && pending.length > 0 && (
            <button onClick={onImportAll} disabled={importing} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700 disabled:opacity-50">
              <DownloadCloud className={cn('h-3.5 w-3.5', importing && 'animate-pulse')} /> Import {pending.length} new order{pending.length === 1 ? '' : 's'}
            </button>
          )}
        </div>
      </div>

      {/* Primary stage tiles (All Orders + the 6 processing steps + Cancelled) */}
      <div className="grid grid-cols-3 lg:grid-cols-8 gap-2">
        {PRIMARY.map((t) => (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            className={cn(
              'text-left px-3 py-2.5 rounded-xl border transition-colors',
              view === t.key ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50',
            )}
          >
            <div className="text-2xl font-extrabold font-mono leading-none">{counts[t.key]}</div>
            <div className={cn('text-[10px] font-bold uppercase tracking-wide mt-1.5 inline-flex items-center gap-1', view === t.key ? 'text-slate-200' : 'text-slate-500')}>
              {t.icon} {t.label}
            </div>
          </button>
        ))}
      </div>

      {/* Packing Overdue counter (Change 06): orders unpacked for over 24 hours. */}
      {counts.packing_overdue > 0 && (
        <button
          onClick={() => setView('packing_overdue')}
          className={cn(
            'w-full text-left px-3 py-2.5 rounded-xl border transition-colors inline-flex items-center gap-2',
            view === 'packing_overdue' ? 'bg-rose-600 text-white border-rose-700' : 'bg-rose-50 text-rose-700 border-rose-300 hover:bg-rose-100',
          )}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="text-lg font-extrabold font-mono">{counts.packing_overdue}</span>
          <span className="text-[11px] font-bold uppercase tracking-wide">Packing Overdue · unpacked over 24 hours</span>
        </button>
      )}

      {/* Search */}
      <div className="relative w-full lg:max-w-sm">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search order id, customer, phone, item…"
          className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-slate-400"
        />
      </div>

      {/* Un-imported Shopify orders for this view (To Accept = due, All Orders = upcoming). */}
      {pendingForView.length > 0 && (
        <div className="bg-amber-50/60 border border-amber-200 rounded-xl overflow-hidden">
          <div className="px-3 sm:px-4 py-2 flex items-center justify-between gap-2 bg-amber-100/70 border-b border-amber-200">
            <span className="text-[11px] font-extrabold uppercase tracking-wide text-amber-800 inline-flex items-center gap-1.5">
              <DownloadCloud className={cn('h-3.5 w-3.5', importing && 'animate-pulse')} /> New from Shopify — importing automatically…
            </span>
          </div>
          <div className="divide-y divide-amber-100">
            {pendingForView.map((o) => {
              const st = stockStatusOf(o);
              const open = expandedPending === o.externalOrderId;
              return (
                <div key={o.externalOrderId} onDoubleClick={() => onOpenShopifyOrder?.(o)}>
                  <div className="flex items-center gap-3 px-3 sm:px-4 py-2.5">
                    <button onClick={() => setExpandedPending(open ? null : o.externalOrderId)} className="flex-1 min-w-0 text-left">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-[11px] font-bold text-amber-900 bg-amber-100 px-1.5 py-0.5 rounded border border-amber-200">{o.orderName}</span>
                        <span className="text-sm font-bold text-slate-900 truncate max-w-[10rem]">{o.customerName || 'Online customer'}</span>
                        <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full border inline-flex items-center gap-1', STOCK_TONE[st.tone])}>
                          <Boxes className="h-3 w-3" />{st.label}
                        </span>
                      </div>
                      <div className="text-[11px] text-amber-700/80 mt-0.5">{o.lines?.length || 0} line{(o.lines?.length || 0) === 1 ? '' : 's'} · {fmtDateTime(o.createdAt || o.date)} · tap for stock, double-tap to open</div>
                    </button>
                    <div className="text-sm font-bold font-mono text-slate-900 shrink-0">{formatCurrency(o.total || 0)}</div>
                    {onOpenShopifyOrder && (
                      <button onClick={() => onOpenShopifyOrder(o)} className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700 text-[11px] font-bold hover:bg-slate-50">
                        Open <ArrowRight className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  {open && (
                    <div className="px-3 sm:px-4 pb-3 -mt-1">
                      <div className="rounded-lg border border-amber-200 bg-white divide-y divide-slate-100">
                        {(o.lines || []).map((l, i) => {
                          const need = l.qty || 0;
                          const have = l.erpStockOnHand ?? 0;
                          const enough = l.matched && have >= need;
                          return (
                            <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                              <div className="min-w-0">
                                <div className="font-bold text-slate-800 truncate">{l.itemName || l.title}</div>
                                <div className="text-[10px] text-slate-400 font-mono">{l.sku || 'no SKU'}</div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="font-mono font-bold text-slate-900">need ×{need}</div>
                                {!l.matched
                                  ? <div className="text-[10px] font-bold text-amber-600">not matched to ERP item</div>
                                  : <div className={cn('text-[10px] font-bold', enough ? 'text-emerald-600' : 'text-rose-600')}>{have} in stock {enough ? '✓' : '⚠ short'}</div>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {onOpenShopifyOrder && (
                        <div className="flex items-center gap-2 mt-2">
                          <button onClick={() => onOpenShopifyOrder(o)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-600 text-[11px] font-bold hover:bg-slate-50">
                            View full order
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Order list (orders already in the ERP) */}
      {list.length === 0 && pendingForView.length === 0 ? (
        <div className="py-12 text-center bg-white border border-slate-200 rounded-xl">
          <Package className="h-10 w-10 mx-auto text-slate-300 mb-2" />
          <p className="text-sm font-bold text-slate-700">No orders here</p>
          <p className="text-xs text-slate-400 mt-0.5">Paid Shopify orders you import show up here, stage by stage.</p>
        </div>
      ) : list.length === 0 ? null : (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
          {list.map((inv) => {
            const bal = balanceOf(inv);
            const itemCount = Array.isArray(inv.items) ? inv.items.reduce((n: number, l: any) => n + (Number(l.quantity) || 0), 0) : 0;
            const overdue = packingOverdue(inv); // Change 06
            return (
              <button
                key={inv.id}
                onClick={() => setSelectedId(inv.id)}
                className={cn('w-full text-left flex items-center gap-3 px-3 sm:px-4 py-3 transition-colors', overdue ? 'bg-rose-50 hover:bg-rose-100' : 'hover:bg-slate-50')}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[11px] font-bold text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">{displayNo(inv)}</span>
                    <span className="text-sm font-bold text-slate-900 truncate max-w-[10rem]">{inv.customerName || 'Online customer'}</span>
                    {inv.customerPhone && <span className="hidden sm:inline text-[11px] text-slate-400 font-mono">· {inv.customerPhone}</span>}
                    {overdue && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border bg-rose-100 text-rose-700 border-rose-300 inline-flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> Packing Pending – Over 24 Hours · Pending for {hoursPending(inv)} Hours
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{itemCount} item{itemCount === 1 ? '' : 's'} · {fmtDateTime(orderTimeOf(inv))}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold font-mono text-slate-900">{formatCurrency(inv.grandTotal || 0)}</div>
                  {bal > 0
                    ? <div className="text-[10px] font-bold text-amber-600">COD · {formatCurrency(bal)} due</div>
                    : <div className="text-[10px] font-bold text-emerald-600">Paid</div>}
                </div>
                <ArrowRight className="h-4 w-4 text-slate-300 shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

/* ───────────────────────────── Order panel (detail) ───────────────────────── */

const Card: React.FC<{ title: string; icon?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }> = ({ title, icon, children, right }) => (
  <div className="bg-white border border-slate-200 rounded-xl p-3.5">
    <div className="flex items-center justify-between mb-2.5">
      <h4 className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500 inline-flex items-center gap-1.5">{icon}{title}</h4>
      {right}
    </div>
    {children}
  </div>
);

const FlipkartOrderPanel: React.FC<{ inv: Invoice; onBack: () => void }> = ({ inv, onBack }) => {
  const {
    updateOnlineOrderStatus, updateOnlineOrderContact, saveOrderPacking,
    saveOrderTracking, reviseOnlineOrder, addOrderCommunication, getBranchStock,
    recordPayment,
  } = useErp();

  const [busy, setBusy] = useState(false);
  const [payMode, setPayMode] = useState('Cash');
  const [payingExtra, setPayingExtra] = useState(false);
  const bucket = bucketOf(inv);
  const mi = milestoneIndex(inv.onlineStatus as OnlineOrderStatus);
  const isCancelled = bucket === 'cancelled';
  const forwardTo = !isCancelled && mi < MILESTONES.length - 1 ? MILESTONES[mi + 1] : null;
  const backTo = !isCancelled && mi > 0 ? MILESTONES[mi - 1] : null;
  const forwardLabel = FORWARD_LABEL[MILESTONES[mi]] || 'Next';

  const bal = balanceOf(inv);
  const orderNo = orderNoOf(inv);

  // ── Customer / address editing (manual paste from Shopify) ──
  const [editC, setEditC] = useState(false);
  const [cForm, setCForm] = useState({
    customerName: inv.customerName || '',
    customerPhone: inv.customerPhone || '',
    customerAddress: inv.customerAddress || '',
    stateOfSupply: inv.stateOfSupply || '',
  });
  const saveContact = async () => {
    setBusy(true);
    await updateOnlineOrderContact(inv.id, cForm);
    setBusy(false);
    setEditC(false);
  };

  // ── Weight + extra shipping ──
  const [weight, setWeight] = useState<string>(inv.parcelWeightKg != null ? String(inv.parcelWeightKg) : '');
  const [extraShip, setExtraShip] = useState<string>(inv.extraShippingAmount != null ? String(inv.extraShippingAmount) : '');
  const savePacking = async () => {
    setBusy(true);
    await saveOrderPacking(inv.id, {
      parcelWeightKg: weight === '' ? undefined : Number(weight),
      extraShippingAmount: extraShip === '' ? 0 : Number(extraShip),
    });
    setBusy(false);
  };

  // ── Tracking ──
  const [courier, setCourier] = useState(inv.courierName || '');
  const [awb, setAwb] = useState(inv.trackingNumber || '');
  const [trackUrl, setTrackUrl] = useState(inv.trackingUrl || '');
  const saveTracking = async () => {
    setBusy(true);
    await saveOrderTracking(inv.id, { courierName: courier, trackingNumber: awb, trackingUrl: trackUrl });
    setBusy(false);
  };

  // ── Photo ──
  const photoInput = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<string | null>(inv.parcelPhotoUrl || inv.trayPhotoUrl || null);
  const onPhoto = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    try {
      const { dataUrl } = await resizeAndCompressImage(file, 1000);
      setPhoto(dataUrl);
      await updateOnlineOrderStatus(inv.id, (inv.onlineStatus as OnlineOrderStatus) || 'New', { parcelPhotoUrl: dataUrl, note: 'Product photo uploaded' });
    } catch { toast.error('Could not process that image'); }
    finally { setBusy(false); }
  };

  // ── Order revision (extra pay) ──
  const [editItems, setEditItems] = useState(false);
  const [revLines, setRevLines] = useState<{ itemId: string; itemName: string; quantity: number; unitPrice: number }[]>(
    () => (inv.items || []).map((l: any) => ({ itemId: l.itemId, itemName: l.itemName, quantity: Number(l.quantity) || 1, unitPrice: Number(l.unitPrice) || 0 })),
  );
  const [addSearch, setAddSearch] = useState('');
  const origTotal = inv.originalGrandTotal != null ? inv.originalGrandTotal : (Number(inv.grandTotal) || 0);
  const revisedTotal = revLines.reduce((s, l) => s + l.quantity * l.unitPrice, 0) + (Number(inv.shippingCharges) || 0);
  const revDelta = revisedTotal - origTotal;
  const saveRevision = async () => {
    const items = revLines.filter((l) => l.itemId && l.quantity > 0).map((l) => ({ itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice }));
    if (!items.length) return;
    setBusy(true);
    await reviseOnlineOrder(inv.id, items, 'Customer changed the order');
    setBusy(false);
    setEditItems(false);
  };

  // ── Stage movement ──
  const advance = async (to: OnlineOrderStatus) => {
    if (to === 'Shipped' && !awb.trim()) {
      toast.info('Tip: enter the tracking / AWB number below before dispatching.');
    }
    setBusy(true);
    await updateOnlineOrderStatus(inv.id, to);
    setBusy(false);
  };

  // ── WhatsApp templates ──
  const photoMsg = `Hi ${inv.customerName || 'there'}, this is ${SHOP_NAME}. Your order ${orderNo} is packed and ready. Please check the photo of your items and reply to confirm. Thank you!`;
  const trackingMsg = `Hi ${inv.customerName || 'there'}, your order ${orderNo} has been shipped${courier ? ` via ${courier}` : ''}.${awb ? ` Tracking no: ${awb}.` : ''}${trackUrl ? ` Track here: ${trackUrl}` : ''} Thank you for shopping with ${SHOP_NAME}!`;
  const reminderMsg = `Hi ${inv.customerName || 'there'}, a quick update on your ${SHOP_NAME} order ${orderNo}: it is on the way and should reach you soon. We'll let you know once it's delivered.`;
  const deliveredMsg = `Hi ${inv.customerName || 'there'}, your ${SHOP_NAME} order ${orderNo} has been delivered. We hope you love it! Please reply with your feedback or a photo. Thank you!`;

  const copyText = async (t: string) => {
    try { await navigator.clipboard.writeText(t); toast.success('Message copied'); }
    catch { toast.error('Could not copy'); }
  };
  const copyAddress = async () => {
    const t = [inv.customerName, inv.customerPhone, inv.customerAddress, inv.stateOfSupply].filter(Boolean).join('\n');
    try { await navigator.clipboard.writeText(t); toast.success('Address copied'); }
    catch { toast.error('Could not copy'); }
  };
  const saveImage = () => {
    if (!photo) return;
    const a = document.createElement('a');
    a.href = photo; a.download = `${orderNo}-photo.jpg`; a.click();
  };

  // Change 09: actually ATTACH the photo when sending on WhatsApp. On phones the
  // Web Share API opens WhatsApp with the image + message attached; on desktop
  // (no file sharing) it falls back to opening the chat with the text and saving
  // the image so staff can attach it (true auto-attach needs the paid WA API).
  const [sharingPhoto, setSharingPhoto] = useState(false);
  const sharePhotoOnWhatsApp = async () => {
    if (!photo) { toast.error('Add a product/parcel photo first.'); return; }
    setSharingPhoto(true);
    try {
      const blob = await (await fetch(photo)).blob();
      const file = new File([blob], `${orderNo}-photo.jpg`, { type: blob.type || 'image/jpeg' });
      const nav = navigator as any;
      if (nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], text: photoMsg, title: `Order ${orderNo}` });
        addOrderCommunication(inv.id, 'photo_sent');
        return;
      }
      // Desktop fallback: save the image + open the chat with the message ready.
      saveImage();
      try { await navigator.clipboard.writeText(photoMsg); } catch { /* ignore */ }
      if (photoWa) window.open(photoWa, '_blank');
      addOrderCommunication(inv.id, 'photo_sent');
      toast.info('Photo saved & message copied — attach the saved photo in the WhatsApp chat.', {
        description: 'On a phone it attaches automatically; desktop WhatsApp can’t auto-attach an image.',
      });
    } catch {
      toast.error('Could not share the photo. Save it and attach it in the chat.');
    } finally {
      setSharingPhoto(false);
    }
  };

  // ── Print box / address label ──
  const printLabel = () => {
    const branch = BRANCHES.find((b) => b.id === inv.branchId);
    const pay = bal > 0 ? `COD — COLLECT ${formatCurrency(bal)}` : 'PREPAID';
    const wt = inv.parcelWeightKg ? `${inv.parcelWeightKg} kg` : '—';
    const esc = (s: string) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Label ${esc(orderNo)}</title>
      <style>
        *{box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}
        body{margin:0;padding:16px}
        .lbl{border:2px solid #000;border-radius:8px;padding:16px;max-width:520px}
        .row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
        .cap{font-size:10px;letter-spacing:1px;color:#555;text-transform:uppercase;margin:0 0 2px}
        .big{font-size:20px;font-weight:800;margin:0 0 2px}
        .to{font-size:18px;font-weight:700;line-height:1.35;white-space:pre-wrap}
        .meta{margin-top:14px;border-top:1px dashed #000;padding-top:10px;font-size:14px;font-weight:700}
        .pay{display:inline-block;border:2px solid #000;border-radius:6px;padding:4px 10px;font-size:16px;font-weight:800;margin-top:6px}
      </style></head><body>
      <div class="lbl">
        <div class="row"><div><p class="cap">From</p><p class="big">${SHOP_NAME}</p><div style="font-size:13px">${esc(branch?.location || '')}</div></div>
        <div style="text-align:right"><p class="cap">Order</p><p class="big">${esc(orderNo)}</p></div></div>
        <div style="margin-top:14px"><p class="cap">Deliver To</p>
          <div class="to">${esc(inv.customerName || 'Customer')}
${esc(inv.customerAddress || '(address not entered)')}
${esc(inv.stateOfSupply || '')}</div>
          <div style="margin-top:6px;font-size:16px;font-weight:700">Phone: ${esc(inv.customerPhone || '—')}</div>
        </div>
        <div class="meta"><div class="row"><div>Weight: ${esc(wt)}</div><div>Items: ${(inv.items || []).reduce((n: number, l: any) => n + (Number(l.quantity) || 0), 0)}</div></div>
        <div class="pay">${esc(pay)}</div></div>
      </div>
      <script>window.onload=function(){window.print()}</script>
      </body></html>`;
    const w = window.open('', '_blank', 'width=640,height=720');
    if (!w) { toast.error('Allow pop-ups to print the label'); return; }
    w.document.write(html); w.document.close();
  };

  const photoWa = waLink(inv.customerPhone, photoMsg);
  const trackingWa = waLink(inv.customerPhone, trackingMsg);
  const reminderWa = waLink(inv.customerPhone, mi >= 4 ? deliveredMsg : reminderMsg);

  const lowStock = (itemId?: string, qty = 0) => {
    if (!itemId) return false;
    const have = getBranchStock(itemId, inv.branchId)?.quantity ?? 0;
    return have < qty;
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={onBack} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <span className="font-mono text-xs font-bold text-slate-800 bg-slate-100 px-2 py-1 rounded border border-slate-200">{orderNo}</span>
        <span className={cn('text-[11px] font-bold px-2 py-1 rounded-full border', BUCKET_STYLE[bucket])}>{BUCKET_LABEL[bucket]}</span>
        {bal > 0
          ? <span className="text-[11px] font-bold px-2 py-1 rounded-full border bg-amber-50 text-amber-700 border-amber-200">COD · {formatCurrency(bal)} to collect</span>
          : <span className="text-[11px] font-bold px-2 py-1 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">Paid</span>}
        <span className="text-[11px] text-slate-400 ml-auto">{new Date(inv.createdAt).toLocaleString('en-IN')}</span>
      </div>

      {/* Stage tracker — a clear left-to-right progress bar so staff see at a
          glance which stage the order is in and what's next. */}
      {isCancelled ? (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-center text-sm font-bold text-rose-700 inline-flex items-center justify-center gap-1.5 w-full">
          <XCircle className="h-4 w-4" /> This order was cancelled
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-3 overflow-x-auto">
          <div className="flex items-center min-w-[560px]">
            {STEP_LABELS.map((label, i, arr) => {
              const done = i < mi;
              const current = i === mi;
              return (
                <React.Fragment key={label}>
                  <div className="flex flex-col items-center shrink-0 w-16">
                    <div className={cn(
                      'h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-extrabold border-2',
                      current ? 'bg-slate-900 text-white border-slate-900'
                        : done ? 'bg-emerald-500 text-white border-emerald-500'
                        : 'bg-white text-slate-400 border-slate-300',
                    )}>
                      {done ? '✓' : i + 1}
                    </div>
                    <span className={cn(
                      'text-[9px] font-bold mt-1 uppercase tracking-wide text-center leading-tight',
                      current ? 'text-slate-900' : done ? 'text-emerald-600' : 'text-slate-400',
                    )}>{label}</span>
                    {current && <span className="text-[8px] font-bold text-slate-500 mt-0.5">▲ now</span>}
                  </div>
                  {i < arr.length - 1 && (
                    <div className={cn('h-0.5 flex-1 -mt-4', i < mi ? 'bg-emerald-500' : 'bg-slate-200')} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {/* Change 06: packing-overdue banner on the order details page. */}
      {packingOverdue(inv) && (
        <div className="bg-rose-50 border border-rose-300 rounded-xl p-3 text-sm font-bold text-rose-700 inline-flex items-center gap-2 w-full">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Packing Pending – Over 24 Hours · Pending for {hoursPending(inv)} Hours. Pack this order as soon as possible.
        </div>
      )}

      {/* Big stage actions */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-2 flex-wrap">
        {backTo && (
          <button disabled={busy} onClick={() => advance(backTo)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-600 text-xs font-bold hover:bg-slate-50 disabled:opacity-50">
            <ArrowLeft className="h-4 w-4" /> Back to {STEP_LABELS[mi - 1]}
          </button>
        )}
        {forwardTo ? (
          <button disabled={busy} onClick={() => advance(forwardTo)} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-extrabold border border-slate-900 hover:bg-slate-800 disabled:opacity-50">
            {forwardLabel} <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-bold text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> {isCancelled ? 'Order cancelled' : 'Order completed'}
          </span>
        )}
        {forwardTo === 'Shipped' && <span className="text-[11px] text-slate-400">Enter tracking below before dispatch</span>}
      </div>

      <div className="grid lg:grid-cols-3 gap-3">
        {/* ── Left: workflow actions ── */}
        <div className="lg:col-span-2 space-y-3">
          {/* Customer & address */}
          <Card
            title="Customer & delivery address"
            icon={<User className="h-3.5 w-3.5" />}
            right={!editC && (
              <button onClick={() => setEditC(true)} className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-slate-800">
                <Pencil className="h-3.5 w-3.5" /> Edit / paste
              </button>
            )}
          >
            {!editC ? (
              <div className="space-y-1.5 text-sm">
                <div className="font-bold text-slate-900 flex items-center gap-1.5"><User className="h-3.5 w-3.5 text-slate-400" />{inv.customerName || 'Online customer'}</div>
                <div className="text-slate-600 flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-slate-400" />{inv.customerPhone || '— no phone —'}</div>
                <div className="text-slate-600 flex items-start gap-1.5"><MapPin className="h-3.5 w-3.5 text-slate-400 mt-0.5" /><span className="whitespace-pre-wrap">{inv.customerAddress ? `${inv.customerAddress}${inv.stateOfSupply ? `, ${inv.stateOfSupply}` : ''}` : '— paste the address from Shopify —'}</span></div>
                <div className="flex items-center gap-2 pt-1.5">
                  <button onClick={printLabel} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[11px] font-bold hover:bg-slate-800"><Printer className="h-3.5 w-3.5" /> Print box label</button>
                  <button onClick={copyAddress} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-600 text-[11px] font-bold hover:bg-slate-50"><Copy className="h-3.5 w-3.5" /> Copy</button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] text-slate-400">Copy the name, phone and full address from the Shopify order and paste them here.</p>
                <input value={cForm.customerName} onChange={(e) => setCForm({ ...cForm, customerName: e.target.value })} placeholder="Customer name" className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm" />
                <input value={cForm.customerPhone} onChange={(e) => setCForm({ ...cForm, customerPhone: e.target.value })} placeholder="Phone (e.g. 98xxxxxxxx)" className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm font-mono" />
                <textarea value={cForm.customerAddress} onChange={(e) => setCForm({ ...cForm, customerAddress: e.target.value })} placeholder="Full address — door no, street, city, PIN" rows={3} className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm" />
                <input value={cForm.stateOfSupply} onChange={(e) => setCForm({ ...cForm, stateOfSupply: e.target.value })} placeholder="State (e.g. 33-Tamil Nadu)" className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm" />
                <div className="flex items-center gap-2">
                  <button disabled={busy} onClick={saveContact} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50"><Save className="h-3.5 w-3.5" /> Save</button>
                  <button onClick={() => { setEditC(false); setCForm({ customerName: inv.customerName || '', customerPhone: inv.customerPhone || '', customerAddress: inv.customerAddress || '', stateOfSupply: inv.stateOfSupply || '' }); }} className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-600 text-xs font-bold hover:bg-slate-50">Cancel</button>
                </div>
              </div>
            )}
          </Card>

          {/* Order items / revision */}
          <Card
            title="Items & order changes"
            icon={<ListChecks className="h-3.5 w-3.5" />}
            right={!editItems && mi < 3 && (
              <button onClick={() => setEditItems(true)} className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-slate-800">
                <Pencil className="h-3.5 w-3.5" /> Edit order
              </button>
            )}
          >
            {!editItems ? (
              <div className="space-y-1">
                {(inv.items || []).map((li: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700 truncate pr-2">{li.itemName}</span>
                    <span className="text-slate-500 font-mono shrink-0">{li.quantity} × {formatCurrency(li.unitPrice || 0)}</span>
                  </div>
                ))}
                {(inv.revisions || []).length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
                    Order was edited {inv.revisions!.length} time{inv.revisions!.length === 1 ? '' : 's'}.
                    {inv.originalGrandTotal != null && <> Original {formatCurrency(inv.originalGrandTotal)} → now {formatCurrency(inv.grandTotal || 0)}.</>}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-1.5">
                <p className="text-[11px] text-slate-400">Customer asked to add / remove / change quantity. The original order is kept; any extra is shown to collect.</p>
                {revLines.map((l, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className="flex-1 text-xs truncate">{l.itemName}</span>
                    <input type="number" min={0} value={l.quantity} onChange={(e) => setRevLines((ls) => ls.map((x, k) => (k === i ? { ...x, quantity: Number(e.target.value) } : x)))} className="w-16 px-2 py-1 rounded-md border border-slate-200 text-xs font-mono" />
                    <span className="text-[11px] text-slate-500 font-mono w-20 text-right">× {formatCurrency(l.unitPrice)}</span>
                    <button onClick={() => setRevLines((ls) => ls.filter((_, k) => k !== i))} className="text-rose-500 hover:text-rose-700 text-[11px] font-bold">Remove</button>
                  </div>
                ))}
                <ItemSearchDropdown
                  value={addSearch}
                  onChange={setAddSearch}
                  onSelectItem={(it: any) => { setRevLines((ls) => [...ls, { itemId: it.id, itemName: it.itemName, quantity: 1, unitPrice: Number(it.salePrice) || 0 }]); setAddSearch(''); }}
                  placeholder="Add an item…"
                />
                <div className="flex items-center justify-between pt-1 text-xs">
                  <span>New total <b className="font-mono">{formatCurrency(revisedTotal)}</b></span>
                  <span className={cn('font-bold', revDelta > 0 ? 'text-amber-600' : revDelta < 0 ? 'text-emerald-600' : 'text-slate-400')}>
                    {revDelta > 0 ? `Extra to collect ${formatCurrency(revDelta)}` : revDelta < 0 ? `Refund ${formatCurrency(-revDelta)}` : 'No change'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button disabled={busy || revLines.filter((l) => l.itemId && l.quantity > 0).length === 0} onClick={saveRevision} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-50">Save changes</button>
                  <button onClick={() => setEditItems(false)} className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-600 text-xs font-bold hover:bg-slate-50">Cancel</button>
                </div>
              </div>
            )}
          </Card>

          {/* Photo + WhatsApp */}
          <Card title="Product photo & WhatsApp" icon={<Camera className="h-3.5 w-3.5" />}>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="shrink-0">
                {photo ? (
                  <img src={photo} alt="product" className="h-28 w-28 object-cover rounded-lg border border-slate-200" />
                ) : (
                  <button onClick={() => photoInput.current?.click()} className="h-28 w-28 rounded-lg border-2 border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 hover:bg-slate-50">
                    <Camera className="h-6 w-6 mb-1" /><span className="text-[10px] font-bold">Add photo</span>
                  </button>
                )}
                <input ref={photoInput} type="file" accept="image/*" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0] || null)} />
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => photoInput.current?.click()} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-600 text-[11px] font-bold hover:bg-slate-50"><Camera className="h-3.5 w-3.5" /> {photo ? 'Change' : 'Upload'}</button>
                  {photo && <button onClick={saveImage} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-600 text-[11px] font-bold hover:bg-slate-50"><Copy className="h-3.5 w-3.5" /> Save image</button>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={sharePhotoOnWhatsApp}
                    disabled={!photo || sharingPhoto}
                    className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border',
                      photo ? 'bg-[#25D366]/10 text-[#128C7E] border-[#25D366]/40 hover:bg-[#25D366]/20' : 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed')}
                  ><MessageCircle className="h-3.5 w-3.5" /> {sharingPhoto ? 'Sharing…' : 'Send photo on WhatsApp'}</button>
                  <button onClick={() => copyText(photoMsg)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-600 text-[11px] font-bold hover:bg-slate-50"><Copy className="h-3.5 w-3.5" /> Copy message</button>
                </div>
                <p className="text-[10px] text-slate-400">On a phone this attaches the photo to WhatsApp directly. On desktop the photo is saved and the chat opens with the message — attach the saved photo (true auto-send needs the paid WhatsApp Business API).</p>
              </div>
            </div>
          </Card>

          {/* Tracking */}
          <Card title="Courier & tracking" icon={<Truck className="h-3.5 w-3.5" />}>
            <div className="grid sm:grid-cols-3 gap-2">
              <input value={courier} onChange={(e) => setCourier(e.target.value)} placeholder="Courier (e.g. DTDC)" className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm" />
              <input value={awb} onChange={(e) => setAwb(e.target.value)} placeholder="Tracking / AWB no." className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm font-mono" />
              <input value={trackUrl} onChange={(e) => setTrackUrl(e.target.value)} placeholder="Tracking URL" className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm" />
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <button disabled={busy} onClick={saveTracking} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-[11px] font-bold hover:bg-slate-800 disabled:opacity-50"><Save className="h-3.5 w-3.5" /> Save tracking</button>
              <a
                href={trackingWa || undefined} target="_blank" rel="noreferrer"
                onClick={() => { if (trackingWa) addOrderCommunication(inv.id, 'tracking_sent'); }}
                className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border',
                  trackingWa ? 'bg-[#25D366]/10 text-[#128C7E] border-[#25D366]/40 hover:bg-[#25D366]/20' : 'bg-slate-50 text-slate-400 border-slate-200 pointer-events-none')}
              ><Send className="h-3.5 w-3.5" /> Send tracking on WhatsApp</a>
              <button onClick={() => copyText(trackingMsg)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-600 text-[11px] font-bold hover:bg-slate-50"><Copy className="h-3.5 w-3.5" /> Copy</button>
            </div>
          </Card>

          {/* Weight + extra shipping + delivery reminder */}
          <Card title="Weight, shipping & reminders" icon={<Scale className="h-3.5 w-3.5" />}>
            <div className="grid sm:grid-cols-2 gap-2">
              <label className="text-xs text-slate-500 font-bold">Parcel weight (kg)
                <input type="number" min={0} step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm font-mono" />
              </label>
              <label className="text-xs text-slate-500 font-bold">Extra shipping to collect (₹)
                <input type="number" min={0} value={extraShip} onChange={(e) => setExtraShip(e.target.value)} className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm font-mono" />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <button disabled={busy} onClick={savePacking} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-[11px] font-bold hover:bg-slate-800 disabled:opacity-50"><Save className="h-3.5 w-3.5" /> Save</button>
              <a
                href={reminderWa || undefined} target="_blank" rel="noreferrer"
                className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border',
                  reminderWa ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' : 'bg-slate-50 text-slate-400 border-slate-200 pointer-events-none')}
              ><Bell className="h-3.5 w-3.5" /> {mi >= 4 ? 'Send delivery confirmation' : 'Send delivery reminder'}</a>
            </div>
            {Number(extraShip) > 0 && <p className="text-[11px] text-amber-600 font-bold mt-1.5 inline-flex items-center gap-1"><IndianRupee className="h-3 w-3" />Extra {formatCurrency(Number(extraShip))} to collect for shipping.</p>}
          </Card>
        </div>

        {/* ── Right: products to pick (live stock) + payment ── */}
        <div className="space-y-3">
          <Card title="Payment" icon={<IndianRupee className="h-3.5 w-3.5" />}>
            {(() => {
              const grand = Number(inv.grandTotal) || 0;
              const extraShip = Number(inv.extraShippingAmount) || 0;
              const origPaid = inv.originalGrandTotal != null ? inv.originalGrandTotal : Math.max(0, grand - bal);
              const extraToCollect = bal + extraShip;
              const currentTotal = grand + extraShip;
              const markExtraPaid = async () => {
                if (bal <= 0) return;
                setPayingExtra(true);
                try {
                  await recordPayment({
                    type: 'in', partyType: 'customer', partyId: inv.customerId,
                    partyName: inv.customerName || 'Online customer', branchId: inv.branchId,
                    amount: bal, paymentMode: payMode, reference: orderNo,
                    notes: `Extra payment on online order ${orderNo}`,
                    allocations: [{ refId: inv.id, amount: bal }],
                  });
                } finally { setPayingExtra(false); }
              };
              return (
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-slate-500">Already paid online</span><span className="font-mono font-bold text-emerald-700">{formatCurrency(origPaid)}</span></div>
                  {extraShip > 0 && <div className="flex justify-between"><span className="text-slate-500">Extra shipping</span><span className="font-mono">{formatCurrency(extraShip)}</span></div>}
                  <div className="flex justify-between pt-1 border-t border-slate-100"><span className="text-slate-500">Updated order total</span><span className="font-mono font-bold">{formatCurrency(currentTotal)}</span></div>
                  {extraToCollect > 0 ? (
                    <>
                      <div className="flex justify-between"><span className="text-amber-700 font-bold">Extra to collect</span><span className="font-mono font-bold text-amber-700">{formatCurrency(extraToCollect)}</span></div>
                      {bal > 0 && (
                        <div className="flex items-center gap-1.5 pt-1.5">
                          <select value={payMode} onChange={(e) => setPayMode(e.target.value)} className="flex-1 px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-bold">
                            <option value="Cash">Cash</option>
                            <option value="GPay">GPay / UPI</option>
                            <option value="HDFC">Card / HDFC</option>
                          </select>
                          <button onClick={markExtraPaid} disabled={payingExtra} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700 disabled:opacity-50">
                            {payingExtra ? 'Saving…' : 'Mark extra paid'}
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex justify-between pt-1"><span className="text-slate-500">Status</span><span className="font-bold text-emerald-600">Fully paid</span></div>
                  )}
                </div>
              );
            })()}
          </Card>

          <Card title="Products to pick" icon={<Boxes className="h-3.5 w-3.5" />}>
            <div className="space-y-2">
              {(inv.items || []).map((li: any, i: number) => {
                const have = li.itemId ? (getBranchStock(li.itemId, inv.branchId)?.quantity ?? 0) : null;
                const low = lowStock(li.itemId, Number(li.quantity) || 0);
                return (
                  <div key={i} className="flex items-start justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-bold text-slate-800 truncate">{li.itemName}</div>
                      {li.itemCode && <div className="text-[10px] text-slate-400 font-mono">{li.itemCode}</div>}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono font-bold text-slate-900">×{li.quantity}</div>
                      {have != null && (
                        <div className={cn('text-[10px] font-bold', low ? 'text-rose-600' : 'text-slate-400')}>
                          {have} in stock{low ? ' ⚠' : ''}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default FlipkartBoard;
