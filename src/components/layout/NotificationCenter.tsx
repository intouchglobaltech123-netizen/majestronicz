import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Volume2,
  VolumeX,
  AlertTriangle,
  Clock,
  PackageCheck,
  PackageX,
  Wallet,
  Coins,
  Globe,
  Truck,
  User,
  ExternalLink,
  Check,
  CheckCircle2,
  ChevronDown,
  SlidersHorizontal,
} from 'lucide-react';
import { useErp } from '../../context/ErpContext';
import {
  BRANCHES,
  ONLINE_ORDER_PIPELINE,
  ONLINE_NEXT_ACTION,
  onlinePipelineIndex,
  purchaseOrderBalanceDue,
  OnlineOrderStatus,
} from '../../types';
import { cn, formatCurrency, getTodayDateString } from '../../lib/utils';
import { playNotify, isSoundMuted, setSoundMuted } from '../../lib/sound';
import { prefUserKey, readScoped, writeScoped } from '../../lib/userPrefs';

type Severity = 'critical' | 'warning' | 'info';
const SEV_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

interface NotifAction {
  label: string;
  onClick: () => void;
  tone?: 'primary' | 'ghost';
}
interface NotifItem {
  id: string;
  severity: Severity;
  badge?: string;
  title: string;
  subtitle?: string;
  note?: string;
  sortKey?: string; // tie-breaker within a group (e.g. due date)
  actions: NotifAction[];
}
interface NotifGroup {
  key: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  countsTowardBadge: boolean;
  items: NotifItem[];
  /** Total available (items may be capped for display). */
  total: number;
  viewAll?: NotifAction;
}

const HIDDEN_TYPES_KEY = 'majestronicz_notif_hidden_types';
const PER_GROUP_CAP = 6;

/** Severity → color classes for the left stripe, badge and card tint. */
const sevStyle = (s: Severity) =>
  s === 'critical'
    ? { stripe: 'bg-rose-500', badge: 'bg-rose-100 text-rose-700 border-rose-300', card: 'bg-rose-50/60 border-rose-200' }
    : s === 'warning'
    ? { stripe: 'bg-amber-500', badge: 'bg-amber-100 text-amber-800 border-amber-300', card: 'bg-white border-amber-200' }
    : { stripe: 'bg-slate-300', badge: 'bg-slate-100 text-slate-600 border-slate-200', card: 'bg-slate-50/60 border-slate-200' };

export const NotificationCenter: React.FC = () => {
  const {
    currentBranch,
    isAllBranches,
    switchBranch,
    currentUser,
    canAccessView,
    reminders,
    pendingOrders,
    enquiries,
    recurringExpenses,
    completeFollowUpReminder,
    items,
    branchStocks,
    invoices,
    getReorderThreshold,
    customers,
    purchaseOrders,
    setSelectedEnquiryForDetail,
    setSelectedPendingOrderForDetail,
    setSelectedPurchaseOrderForDetail,
    setSelectedCustomerForDetail,
    setCurrentView,
  } = useErp();

  const [isOpen, setIsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [managing, setManaging] = useState(false);
  const [soundMuted, setSoundMutedState] = useState<boolean>(() => isSoundMuted());
  const userKey = prefUserKey({ userId: currentUser.userId, name: currentUser.name });
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(() => readHidden(userKey));
  const panelRef = useRef<HTMLDivElement>(null);
  const todayStr = useMemo(() => getTodayDateString(), []);

  // Reload the user's hidden-type preference when the logged-in user changes
  // (login / logout / switch on a shared device) — see userPrefs.
  const lastUserKeyRef = useRef(userKey);
  useEffect(() => {
    if (lastUserKeyRef.current === userKey) return;
    lastUserKeyRef.current = userKey;
    setHiddenTypes(readHidden(userKey));
  }, [userKey]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    if (isOpen) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [isOpen]);

  const inScope = (branchId?: string) => isAllBranches || branchId === currentBranch;
  const stockInScope = (itemId: string): number => {
    if (isAllBranches) return branchStocks.filter((s) => s.itemId === itemId).reduce((t, s) => t + (s.quantity || 0), 0);
    const row = branchStocks.find((s) => s.itemId === itemId && s.branchId === currentBranch);
    return row?.quantity ?? 0;
  };

  const go = (view: Parameters<typeof canAccessView>[0]) => {
    setCurrentView(view);
    setIsOpen(false);
  };

  // ---- Build every notification group (only those the role can access) ----
  const groups = useMemo<NotifGroup[]>(() => {
    const out: NotifGroup[] = [];

    // Recurring overhead due / overdue
    if (canAccessView('cash-register')) {
      const monthKey = todayStr.substring(0, 7);
      const [y, m, day] = todayStr.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const due = recurringExpenses.filter((t) => {
        if (!inScope(t.branchId)) return false;
        const approved = t.lastApprovedMonth === monthKey || t.approvalHistory?.some((a) => a.month === monthKey);
        if (approved) return false;
        return day >= Math.min(t.dueDay, lastDay);
      });
      if (due.length) {
        out.push(group('recurring', 'Recurring Overhead Due', Wallet, true, due.map((t) => {
          const overdue = day > t.dueDay;
          const branch = BRANCHES.find((b) => b.id === t.branchId)?.name || t.branchId;
          return item(`rec-${t.id}`, overdue ? 'critical' : 'warning', overdue ? 'Overdue' : 'Due Today',
            `${t.name} — ${formatCurrency(t.defaultAmount)}`, `${branch} • due ${t.dueDay}th`, undefined, String(t.dueDay).padStart(2, '0'),
            [{ label: 'Register', onClick: () => { if (!isAllBranches && currentBranch !== t.branchId) switchBranch(t.branchId as any); go('cash-register'); } }]);
        }), 'cash-register'));
      }
    }

    // Vendor payments due
    if (canAccessView('purchases')) {
      const owing = purchaseOrders
        .filter((po) => inScope(po.branchId) && po.status !== 'Cancelled' && purchaseOrderBalanceDue(po) > 0.5)
        .map((po) => ({ po, bal: purchaseOrderBalanceDue(po) }))
        .sort((a, b) => b.bal - a.bal);
      if (owing.length) {
        out.push(group('vendor', 'Vendor Payments Due', Truck, true, owing.map(({ po, bal }) =>
          item(`po-${po.id}`, 'warning', 'To Pay', `${po.vendorName || 'Supplier'} — ${formatCurrency(bal)}`,
            `${po.poNumber}${po.status ? ` • ${po.status}` : ''}`, undefined, String(1e12 - bal),
            [{ label: 'Open PO', onClick: () => { setSelectedPurchaseOrderForDetail(po); go('purchases'); } }])),
          'purchases', owing.length));
      }
    }

    // Customer dues (overdue first)
    if (canAccessView('customers') || canAccessView('invoices')) {
      const dues = invoices
        .filter((i) => !i.isVoided && inScope(i.branchId) && (i.balanceDue ?? 0) > 0.5)
        .map((i) => ({ i, overdue: !!i.dueDate && i.dueDate < todayStr }))
        .sort((a, b) => (a.overdue === b.overdue ? (b.i.balanceDue || 0) - (a.i.balanceDue || 0) : a.overdue ? -1 : 1));
      if (dues.length) {
        out.push(group('dues', 'Customer Dues', Coins, true, dues.map(({ i, overdue }) =>
          item(`due-${i.id}`, overdue ? 'critical' : 'warning', overdue ? 'Overdue' : 'Outstanding',
            `${i.customerName || 'Customer'} — ${formatCurrency(i.balanceDue || 0)}`,
            `${i.invoiceNumber}${i.dueDate ? ` • due ${i.dueDate}` : ''}`, undefined, (overdue ? '0' : '1') + String(i.dueDate || ''),
            [{ label: 'View', onClick: () => { const c = customers.find((c) => c.id === i.customerId); if (c) setSelectedCustomerForDetail(c); go(canAccessView('customers') ? 'customers' : 'invoices'); } }])),
          canAccessView('customers') ? 'customers' : 'invoices', dues.length));
      }
    }

    // Online orders needing in-store action (New … Packed)
    if (canAccessView('shopify')) {
      const shipIdx = ONLINE_ORDER_PIPELINE.indexOf('Shipped');
      const active = invoices.filter((i) => {
        if (!i.onlineStatus || i.onlineStatus === 'Cancelled' || !inScope(i.branchId)) return false;
        const idx = onlinePipelineIndex(i.onlineStatus);
        return idx >= 0 && idx < shipIdx;
      });
      if (active.length) {
        out.push(group('online', 'Online Orders To Fulfil', Globe, true, active.map((i) =>
          item(`on-${i.id}`, i.onlineStatus === 'New' ? 'critical' : 'warning', i.onlineStatus,
            `${i.customerName || 'Online customer'} — ${formatCurrency(i.grandTotal || 0)}`,
            i.invoiceNumber, ONLINE_NEXT_ACTION[i.onlineStatus as OnlineOrderStatus], String(onlinePipelineIndex(i.onlineStatus)).padStart(2, '0'),
            [{ label: 'Open', onClick: () => go('shopify') }])),
          'shopify', active.length));
      }
    }

    // Low / out of stock
    if (canAccessView('inventory')) {
      const low = items
        .map((it) => {
          const qty = stockInScope(it.id);
          const threshold = getReorderThreshold(it, isAllBranches ? 'all' : currentBranch);
          return { it, qty, threshold };
        })
        .filter(({ qty, threshold }) => qty <= threshold)
        .sort((a, b) => a.qty - b.qty);
      if (low.length) {
        out.push(group('lowstock', 'Low / Out of Stock', PackageX, true, low.map(({ it, qty, threshold }) =>
          item(`low-${it.id}`, qty <= 0 ? 'critical' : 'warning', qty <= 0 ? 'Out of stock' : 'Low',
            it.itemName, `${qty} ${it.unit || 'pcs'} on hand • reorder at ${threshold}`, undefined, String(qty).padStart(6, '0'),
            [{ label: 'Inventory', onClick: () => go('inventory') }])),
          'inventory', low.length));
      }
    }

    // Restock arrived (pending orders)
    if (canAccessView('pending-orders')) {
      const arrived = pendingOrders.filter((po) => po.status === 'Stock Arrived' && inScope(po.branchId));
      if (arrived.length) {
        out.push(group('restock', 'Restock Arrived', PackageCheck, true, arrived.map((po) =>
          item(`pw-${po.id}`, 'warning', 'Ready', po.itemName,
            `${po.quantityNeeded} ${po.unit} for ${po.customerName}`, undefined, po.orderNumber,
            [{ label: 'Bill / Convert', onClick: () => { setSelectedPendingOrderForDetail(po); go('pending-orders'); } }])),
          'pending-orders'));
      }
    }

    // Follow-up reminders (due/overdue) + upcoming
    if (canAccessView('enquiries')) {
      const active = reminders.filter((r) => !r.isCompleted && inScope(r.branchId));
      const due = active.filter((r) => r.dueDate <= todayStr);
      const upcoming = active.filter((r) => r.dueDate > todayStr);
      const openEnq = (enquiryId: string) => { const e = enquiries.find((x) => x.id === enquiryId); if (e) setSelectedEnquiryForDetail(e); go('enquiries'); };
      if (due.length) {
        out.push(group('due', 'Follow-ups Due / Overdue', AlertTriangle, true, due.map((r) => {
          const overdue = r.dueDate < todayStr;
          return item(`rem-${r.id}`, overdue ? 'critical' : 'warning', `${overdue ? 'Overdue' : 'Due Today'} • ${r.dueTime}`,
            r.customerName, `${r.enquiryNumber} • ${r.itemName}`, r.notes || undefined, (overdue ? '0' : '1') + r.dueDate + r.dueTime,
            [
              { label: 'View', onClick: () => openEnq(r.enquiryId) },
              { label: 'Mark Done', tone: 'ghost', onClick: () => completeFollowUpReminder(r.id) },
            ]);
        })));
      }
      if (upcoming.length) {
        out.push(group('upcoming', 'Upcoming Follow-ups', Clock, false, upcoming
          .slice()
          .sort((a, b) => (a.dueDate + a.dueTime).localeCompare(b.dueDate + b.dueTime))
          .map((r) => item(`up-${r.id}`, 'info', r.dueDate, `${r.customerName} — ${r.itemName}`, `${r.enquiryNumber} at ${r.dueTime}`, undefined, r.dueDate + r.dueTime,
            [{ label: 'Open', tone: 'ghost', onClick: () => openEnq(r.enquiryId) }])),
          'enquiries', upcoming.length));
      }
    }

    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recurringExpenses, purchaseOrders, invoices, items, branchStocks, pendingOrders, reminders, enquiries, customers, currentBranch, isAllBranches, todayStr]);

  // Visible = accessible + not muted by the user. Each group's items sorted by severity.
  const visibleGroups = useMemo(() => {
    return groups
      .filter((g) => !hiddenTypes.has(g.key))
      .map((g) => ({
        ...g,
        items: g.items.slice().sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || (a.sortKey || '').localeCompare(b.sortKey || '')),
      }))
      .map((g) => ({ ...g, severity: g.items[0]?.severity ?? ('info' as Severity) }))
      .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  }, [groups, hiddenTypes]);

  const badgeCount = useMemo(
    () => visibleGroups.filter((g) => g.countsTowardBadge).reduce((t, g) => t + g.total, 0),
    [visibleGroups]
  );
  const hasCritical = useMemo(
    () => visibleGroups.some((g) => g.countsTowardBadge && g.items.some((i) => i.severity === 'critical')),
    [visibleGroups]
  );

  // Chime once when the actionable count RISES — never on first render, never on
  // the initial data load (TopBar mounts after the bootstrap splash) and never
  // when items are only cleared.
  const prevCountRef = useRef(badgeCount);
  useEffect(() => {
    if (badgeCount > prevCountRef.current) playNotify();
    prevCountRef.current = badgeCount;
  }, [badgeCount]);

  const toggleSound = () => setSoundMutedState((p) => { const n = !p; setSoundMuted(n); if (!n) playNotify(); return n; });
  const toggleCollapse = (key: string) => setCollapsed((p) => ({ ...p, [key]: !p[key] }));
  const toggleHidden = (key: string) =>
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      writeScoped(HIDDEN_TYPES_KEY, JSON.stringify([...next]), userKey);
      return next;
    });

  // Default-collapse the info ("upcoming") group so the actionable items lead.
  const isCollapsed = (g: NotifGroup) => collapsed[g.key] ?? !g.countsTowardBadge;

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setIsOpen((p) => !p)}
        aria-label="Notification alerts"
        title={badgeCount > 0 ? `${badgeCount} item(s) need attention` : 'No new notifications'}
        className={cn(
          'relative h-8 w-8 rounded-none border flex items-center justify-center transition-all cursor-pointer',
          badgeCount > 0
            ? hasCritical
              ? 'bg-rose-50 border-rose-400 text-rose-700'
              : 'bg-amber-50 border-amber-400 text-amber-800'
            : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
        )}
      >
        <Bell className="h-3.5 w-3.5" />
        {badgeCount > 0 && (
          <span className={cn(
            'absolute -top-1 -right-1 h-4 min-w-[16px] px-1 text-white font-mono font-bold text-[10px] rounded-none flex items-center justify-center',
            hasCritical ? 'bg-rose-600' : 'bg-amber-600'
          )}>
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="fixed left-3 right-3 top-14 w-auto sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-1 sm:w-[26rem] sm:max-w-[calc(100vw-2rem)] bg-white border border-slate-300 rounded-none shadow-xl z-50 overflow-hidden">
          {/* Header */}
          <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-300 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={cn('h-6 w-6 rounded-none flex items-center justify-center', hasCritical ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800')}>
                <Bell className="h-3.5 w-3.5" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-slate-900">Notifications</h3>
                <p className="text-[11px] text-slate-500">{badgeCount > 0 ? `${badgeCount} need attention` : 'All clear for now'}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setManaging((m) => !m)}
                title="Choose which alerts to show"
                aria-label="Manage alert types"
                className={cn('h-6 w-6 rounded-none border flex items-center justify-center transition-colors cursor-pointer',
                  managing ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-100')}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={toggleSound}
                title={soundMuted ? 'Sound off — click to enable' : 'Sound on — click to mute'}
                aria-label={soundMuted ? 'Turn notification sound on' : 'Mute notification sound'}
                className={cn('h-6 w-6 rounded-none border flex items-center justify-center transition-colors cursor-pointer',
                  soundMuted ? 'bg-white border-slate-300 text-slate-400 hover:text-slate-600' : 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100')}
              >
                {soundMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {/* Manage alert types */}
          {managing && (
            <div className="p-2.5 bg-slate-50/80 border-b border-slate-200">
              <p className="px-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Show these alerts</p>
              <div className="grid grid-cols-1 gap-1">
                {groups.length === 0 && <p className="px-1 text-[11px] text-slate-400">No alert types available for your role.</p>}
                {groups.map((g) => {
                  const shown = !hiddenTypes.has(g.key);
                  return (
                    <button
                      key={g.key}
                      type="button"
                      onClick={() => toggleHidden(g.key)}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-none border border-slate-200 bg-white hover:bg-slate-50 text-left cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
                        <g.Icon className="h-3.5 w-3.5 text-slate-500" />
                        {g.label} <span className="text-slate-400 font-mono">({g.total})</span>
                      </span>
                      <span className={cn('h-4 w-7 rounded-full relative transition-colors shrink-0', shown ? 'bg-emerald-500' : 'bg-slate-300')}>
                        <span className={cn('absolute top-0.5 h-3 w-3 bg-white rounded-full transition-all', shown ? 'left-3.5' : 'left-0.5')} />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* List */}
          <div className="max-h-[70vh] overflow-y-auto divide-y divide-slate-100">
            {visibleGroups.length === 0 ? (
              <div className="p-8 text-center text-slate-400">
                <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-500 mb-2 opacity-80" />
                <p className="text-xs font-bold text-slate-700">All caught up!</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {hiddenTypes.size > 0 ? 'Some alert types are hidden — use the sliders above.' : 'Nothing needs your attention right now.'}
                </p>
              </div>
            ) : (
              visibleGroups.map((g) => {
                const style = sevStyle(g.severity as Severity);
                const shown = isCollapsed(g) ? [] : g.items.slice(0, PER_GROUP_CAP);
                const moreInGroup = g.items.length - shown.length;
                const notShownTotal = g.total - shown.length;
                return (
                  <div key={g.key} className="p-2">
                    <button
                      type="button"
                      onClick={() => toggleCollapse(g.key)}
                      className="w-full flex items-center justify-between px-2 py-1 cursor-pointer group"
                    >
                      <span className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-600">
                        <g.Icon className="h-3 w-3" />
                        {g.label}
                        <span className={cn('px-1 rounded-none border text-[10px]', style.badge)}>{g.total}</span>
                      </span>
                      <ChevronDown className={cn('h-3.5 w-3.5 text-slate-400 transition-transform', isCollapsed(g) && '-rotate-90')} />
                    </button>

                    {shown.map((it) => {
                      const is = sevStyle(it.severity);
                      return (
                        <div key={it.id} className={cn('mt-1 flex rounded-none border shadow-2xs', is.card)}>
                          <div className={cn('w-1 shrink-0', is.stripe)} />
                          <div className="flex-1 min-w-0 p-2.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {it.badge && <span className={cn('text-[10px] font-bold px-1.5 py-0.2 rounded-none uppercase border', is.badge)}>{it.badge}</span>}
                            </div>
                            <p className="text-xs font-bold text-slate-900 mt-0.5 truncate flex items-center gap-1">
                              {(g.key === 'dues' || g.key === 'due') && <User className="h-3 w-3 text-slate-400 shrink-0" />}
                              <span className="truncate">{it.title}</span>
                            </p>
                            {it.subtitle && <p className="text-[11px] text-slate-500 truncate">{it.subtitle}</p>}
                            {it.note && <p className="text-[11px] text-slate-500 italic bg-white/70 p-1 mt-1 rounded-none border border-slate-200 truncate">"{it.note}"</p>}
                            <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                              {it.actions.map((a, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={a.onClick}
                                  className={cn('px-2 py-0.5 rounded-none text-[11px] font-bold transition-colors flex items-center gap-1 cursor-pointer border',
                                    a.tone === 'ghost'
                                      ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                                      : 'bg-slate-800 border-slate-700 text-white hover:bg-slate-900')}
                                >
                                  {a.tone === 'ghost' && a.label === 'Mark Done' && <Check className="h-3 w-3 text-emerald-600" />}
                                  <span>{a.label}</span>
                                  {a.tone !== 'ghost' && <ExternalLink className="h-2.5 w-2.5" />}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {!isCollapsed(g) && notShownTotal > 0 && g.viewAll && (
                      <button
                        type="button"
                        onClick={g.viewAll.onClick}
                        className="mt-1 w-full px-2 py-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-none border border-dashed border-slate-300 cursor-pointer"
                      >
                        +{notShownTotal} more — open {g.viewAll.label}
                      </button>
                    )}
                    {!isCollapsed(g) && notShownTotal > 0 && !g.viewAll && moreInGroup > 0 && (
                      <p className="mt-1 px-2 text-[11px] text-slate-400">+{moreInGroup} more…</p>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );

  // --- small builders (kept at the bottom for readability) ---
  function item(
    id: string, severity: Severity, badge: string | undefined, title: string,
    subtitle?: string, note?: string, sortKey?: string, actions: NotifAction[] = []
  ): NotifItem {
    return { id, severity, badge, title, subtitle, note, sortKey, actions };
  }
  function group(
    key: string, label: string, Icon: NotifGroup['Icon'], countsTowardBadge: boolean,
    builtItems: NotifItem[], viewAllView?: Parameters<typeof canAccessView>[0], total?: number
  ): NotifGroup {
    return {
      key, label, Icon, countsTowardBadge, items: builtItems, total: total ?? builtItems.length,
      viewAll: viewAllView ? { label: labelOfView(viewAllView), onClick: () => go(viewAllView) } : undefined,
    };
  }
};

function readHidden(userKey: string): Set<string> {
  try {
    const raw = readScoped(HIDDEN_TYPES_KEY, userKey);
    if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return new Set(arr.map(String)); }
  } catch { /* ignore */ }
  return new Set();
}

function labelOfView(v: string): string {
  const map: Record<string, string> = {
    'cash-register': 'Cash Register', purchases: 'Purchases', customers: 'Customers', invoices: 'Sales',
    shopify: 'Online Orders', inventory: 'Inventory', 'pending-orders': 'Pending Orders', enquiries: 'Enquiries',
  };
  return map[v] || v;
}
