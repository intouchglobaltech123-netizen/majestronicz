import React, { useState, useEffect } from 'react';
import { useErp, ActiveNavView } from '../../context/ErpContext';
import {
  LayoutDashboard,
  Boxes,
  Layers,
  Barcode,
  ShoppingBag,
  BarChart3,
  ShieldCheck,
  UserCheck,
  Contact,
  ShoppingCart,
  Building2,
  Lock,
  Truck,
  Receipt,
  ClipboardList,
  WalletCards,
  Users,
  Clock,
  Sparkles,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  X,
} from 'lucide-react';
import { MajestroniczLogo } from '../common/MajestroniczLogo';
import { cn } from '../../lib/utils';

const COLLAPSE_KEY = 'majestronicz_sidebar_collapsed';

interface SidebarProps {
  /** Whether the off-canvas drawer is open on mobile (< lg). */
  mobileOpen?: boolean;
  /** Close the mobile drawer. */
  onClose?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ mobileOpen = false, onClose }) => {
  const {
    currentUser,
    currentView,
    setCurrentView,
    canAccessView,
  } = useErp();

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [collapsed]);

  // Track whether we're on a mobile viewport (< lg). The desktop-only "collapse"
  // preference must NOT hide labels in the mobile drawer.
  const [isMobile, setIsMobile] = useState<boolean>(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // On mobile the drawer always shows full labels; collapse only applies on desktop.
  const showLabels = isMobile || !collapsed;

  type IconType = React.ComponentType<{ className?: string }>;
  type NavLeaf = { id: ActiveNavView; label: string; icon: IconType; badge?: string };

  // Vyapar-style grouped navigation. A section with one accessible child renders
  // as a plain link; a section with several renders as an expandable group
  // (click to expand in the full sidebar, hover flyout when collapsed to icons).
  const rawSections: { id: string; label: string; icon: IconType; children: NavLeaf[] }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, children: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    ] },
    { id: 'sales', label: 'Sales', icon: Receipt, children: [
      { id: 'invoices', label: 'Sales & Quotations', icon: Receipt },
      { id: 'enquiries', label: 'Enquiries', icon: ClipboardList },
      { id: 'pending-orders', label: 'Pending Orders', icon: Clock },
      { id: 'challans', label: 'Delivery Challan', icon: Truck },
      { id: 'shopify', label: 'Online Store', icon: ShoppingCart },
    ] },
    { id: 'purchases', label: 'Purchases', icon: ShoppingBag, children: [
      { id: 'purchases', label: 'Purchases', icon: ShoppingBag },
    ] },
    { id: 'catalog', label: 'Items & Stock', icon: Boxes, children: [
      { id: 'items', label: 'Items', icon: Boxes },
      { id: 'inventory', label: 'Inventory', icon: Layers },
      { id: 'barcodes', label: 'Barcode', icon: Barcode },
    ] },
    { id: 'parties', label: 'Parties', icon: Contact, children: [
      { id: 'customers', label: 'Customers', icon: UserCheck },
      { id: 'parties', label: 'Suppliers & Parties', icon: Contact },
    ] },
    { id: 'finance', label: 'Cash & Reports', icon: WalletCards, children: [
      { id: 'cash-register', label: 'Cash Register', icon: WalletCards },
      { id: 'reports', label: 'Reports', icon: BarChart3 },
    ] },
    { id: 'team', label: 'Attendance', icon: Users, children: [
      { id: 'hrm', label: 'Attendance', icon: Users },
    ] },
    { id: 'assistant', label: 'Beta AI', icon: Sparkles, children: [
      { id: 'ai-assistant', label: 'Beta AI', icon: Sparkles, badge: 'Beta' },
    ] },
    { id: 'admin', label: 'Access Control', icon: ShieldCheck, children: [
      { id: 'access', label: 'Access Control', icon: ShieldCheck },
    ] },
  ];

  // Keep only accessible children; drop empty sections.
  const sections = rawSections
    .map((s) => ({ ...s, children: s.children.filter((c) => canAccessView(c.id)) }))
    .filter((s) => s.children.length > 0);

  // Which multi-child groups are expanded. The group holding the active view
  // starts open; users can toggle any group.
  const activeGroupId = sections.find((s) => s.children.some((c) => c.id === currentView))?.id;
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(activeGroupId ? [activeGroupId] : [])
  );
  useEffect(() => {
    if (activeGroupId) setExpandedGroups((prev) => (prev.has(activeGroupId) ? prev : new Set(prev).add(activeGroupId)));
  }, [activeGroupId]);

  const toggleGroup = (id: string) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const RoleIcon = currentUser.role === 'CEO' ? ShieldCheck : currentUser.role === 'Manager' ? Building2 : Lock;

  // A single leaf link (used for standalone sections and inside groups/flyouts).
  const LeafButton: React.FC<{ leaf: NavLeaf; nested?: boolean; onPick?: () => void }> = ({ leaf, nested, onPick }) => {
    const Icon = leaf.icon;
    const isActive = currentView === leaf.id;
    return (
      <button
        onClick={() => { setCurrentView(leaf.id); onPick?.(); onClose?.(); }}
        className={cn(
          'relative w-full flex items-center gap-3 rounded-lg text-sm transition-all group text-left',
          nested ? 'pl-9 pr-3 py-2 font-medium' : 'px-3.5 py-2.5 font-medium',
          isActive
            ? 'bg-blue-600 text-white shadow-xs font-semibold'
            : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
        )}
      >
        <Icon className={cn('h-4 w-4 shrink-0 transition-colors', isActive ? 'text-white' : 'text-slate-500 group-hover:text-slate-700')} />
        <span className="truncate">{leaf.label}</span>
        {leaf.badge && (
          <span className={cn(
            'ml-auto text-[11px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide border',
            isActive ? 'bg-white/20 text-white border-white/30' : 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200'
          )}>
            {leaf.badge}
          </span>
        )}
      </button>
    );
  };

  return (
    <>
      {/* Mobile backdrop (only when the drawer is open on < lg) */}
      <div
        className={cn(
          'fixed inset-0 bg-slate-900/40 z-30 lg:hidden transition-opacity duration-200',
          mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className={cn(
          'bg-white border-r border-slate-200 flex flex-col h-screen select-none shadow-xs',
          // Mobile: fixed off-canvas drawer that slides in/out.
          'fixed inset-y-0 left-0 z-40 w-72 transition-transform duration-200',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop: static in-flow column; width follows the collapse pref.
          'lg:static lg:z-20 lg:translate-x-0 lg:shrink-0 lg:transition-[width]',
          collapsed ? 'lg:w-20' : 'lg:w-68'
        )}
      >
      {/* Brand Header + collapse toggle (kept inside the sidebar, always aligned) */}
      <div className={cn('border-b border-slate-200', showLabels ? 'p-5' : 'p-3')}>
        {/* Mobile close button */}
        <button
          onClick={onClose}
          aria-label="Close menu"
          className="lg:hidden absolute top-3 right-3 h-8 w-8 rounded-lg border border-slate-200 bg-slate-50 text-slate-500 hover:text-slate-800 flex items-center justify-center"
        >
          <X className="h-4 w-4" />
        </button>
        {!showLabels ? (
          <div className="flex flex-col items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-sm">M</div>
            <button
              onClick={() => setCollapsed(false)}
              title="Expand sidebar"
              aria-label="Expand sidebar"
              className="h-8 w-8 rounded-lg border border-slate-200 bg-slate-50 text-slate-500 hover:text-blue-600 hover:border-blue-300 flex items-center justify-center transition-colors"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <MajestroniczLogo />
            <button
              onClick={() => setCollapsed(true)}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
              className="hidden lg:flex h-8 w-8 rounded-lg border border-slate-200 bg-slate-50 text-slate-500 hover:text-blue-600 hover:border-blue-300 items-center justify-center transition-colors shrink-0"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>
        )}

      </div>

      {/* Main Navigation — Vyapar-style grouped sections */}
      <div className={cn('flex-1 px-3 py-4 space-y-1', showLabels ? 'overflow-y-auto' : 'overflow-visible')}>
        {sections.map((section) => {
          const single = section.children.length === 1;
          const groupActive = section.children.some((c) => c.id === currentView);

          // --- Single-child section → plain link -----------------------------
          if (single) {
            const leaf = section.children[0];
            const Icon = leaf.icon;
            const isActive = currentView === leaf.id;
            if (!showLabels) {
              return (
                <button
                  key={section.id}
                  onClick={() => { setCurrentView(leaf.id); onClose?.(); }}
                  title={leaf.label}
                  className={cn(
                    'relative w-full flex items-center justify-center rounded-xl py-2.5 transition-all group',
                    isActive ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-700 hover:bg-slate-100'
                  )}
                >
                  <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-white' : 'text-slate-500 group-hover:text-slate-700')} />
                  {leaf.badge && <span className="absolute top-1.5 right-3 h-2 w-2 rounded-full bg-fuchsia-500 border border-white" />}
                </button>
              );
            }
            return <LeafButton key={section.id} leaf={leaf} />;
          }

          const GroupIcon = section.icon;

          // --- Collapsed (icon-only) → hover flyout with sub-items -----------
          if (!showLabels) {
            return (
              <div key={section.id} className="relative group/fly">
                <button
                  title={section.label}
                  className={cn(
                    'relative w-full flex items-center justify-center rounded-xl py-2.5 transition-all',
                    groupActive ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'text-slate-700 hover:bg-slate-100'
                  )}
                >
                  <GroupIcon className={cn('h-4 w-4 shrink-0', groupActive ? 'text-blue-700' : 'text-slate-500')} />
                </button>
                {/* Flyout appears on hover, to the right of the rail */}
                <div className="absolute left-full top-0 ml-2 hidden group-hover/fly:block z-50 w-56">
                  <div className="rounded-xl border border-slate-200 bg-white shadow-lg p-1.5">
                    <p className="px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">{section.label}</p>
                    {section.children.map((leaf) => (
                      <LeafButton key={leaf.id} leaf={leaf} />
                    ))}
                  </div>
                </div>
              </div>
            );
          }

          // --- Expanded → accordion group ------------------------------------
          const isOpen = expandedGroups.has(section.id);
          return (
            <div key={section.id}>
              <button
                onClick={() => toggleGroup(section.id)}
                className={cn(
                  'w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all group',
                  groupActive && !isOpen ? 'text-blue-700' : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
                )}
              >
                <GroupIcon className={cn('h-4 w-4 shrink-0', groupActive ? 'text-blue-600' : 'text-slate-500 group-hover:text-slate-700')} />
                <span className="truncate">{section.label}</span>
                {groupActive && !isOpen && <span className="h-1.5 w-1.5 rounded-full bg-blue-500 ml-1" />}
                <ChevronDown className={cn('h-4 w-4 ml-auto shrink-0 text-slate-400 transition-transform', isOpen && 'rotate-180')} />
              </button>
              {isOpen && (
                <div className="mt-0.5 space-y-0.5">
                  {section.children.map((leaf) => (
                    <LeafButton key={leaf.id} leaf={leaf} nested />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Compact user footer — name + role icon only (clean, professional) */}
      <div className={cn('border-t border-slate-200', showLabels ? 'px-3 py-3' : 'p-2')}>
        {!showLabels ? (
          <div className="h-9 w-9 mx-auto rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center" title={`${currentUser.name} · ${currentUser.role}`}>
            <RoleIcon className={cn('h-4 w-4', currentUser.role === 'CEO' ? 'text-amber-600' : currentUser.role === 'Manager' ? 'text-blue-600' : 'text-slate-600')} />
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
              <RoleIcon className={cn('h-4 w-4', currentUser.role === 'CEO' ? 'text-amber-600' : currentUser.role === 'Manager' ? 'text-blue-600' : 'text-slate-600')} />
            </div>
            <p className="text-xs font-bold text-slate-800 truncate min-w-0 flex-1">{currentUser.name}</p>
          </div>
        )}
      </div>
      </aside>
    </>
  );
};
