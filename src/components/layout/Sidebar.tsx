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
    currentBranchData,
    isAllBranches,
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

  const navItems: {
    id: ActiveNavView;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    visible: boolean;
    badge?: string;
  }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, visible: canAccessView('dashboard') },
    { id: 'items', label: 'Items', icon: Boxes, visible: canAccessView('items') },
    { id: 'customers', label: 'Customers', icon: UserCheck, visible: canAccessView('customers') },
    { id: 'parties', label: 'Parties', icon: Contact, visible: canAccessView('parties') },
    { id: 'enquiries', label: 'Enquiries', icon: ClipboardList, visible: canAccessView('enquiries') },
    { id: 'pending-orders', label: 'Pending Orders', icon: Clock, visible: canAccessView('pending-orders') },
    { id: 'challans', label: 'Delivery Challan', icon: Truck, visible: canAccessView('challans') },
    { id: 'inventory', label: 'Inventory', icon: Layers, visible: canAccessView('inventory') },
    { id: 'invoices', label: 'Sales', icon: Receipt, visible: canAccessView('invoices') },
    { id: 'barcodes', label: 'Barcode', icon: Barcode, visible: canAccessView('barcodes') },
    { id: 'cash-register', label: 'Cash Register', icon: WalletCards, visible: canAccessView('cash-register') },
    { id: 'purchases', label: 'Purchases', icon: ShoppingBag, visible: canAccessView('purchases') },
    { id: 'hrm', label: 'Attendance', icon: Users, visible: canAccessView('hrm') },
    { id: 'reports', label: 'Reports', icon: BarChart3, visible: canAccessView('reports') },
    { id: 'ai-assistant', label: 'Beta AI', icon: Sparkles, visible: canAccessView('ai-assistant'), badge: 'Beta' },
    { id: 'access', label: 'Access Control', icon: ShieldCheck, visible: canAccessView('access') },
  ];

  const RoleIcon = currentUser.role === 'CEO' ? ShieldCheck : currentUser.role === 'Manager' ? Building2 : Lock;

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
            <div className="h-9 w-9 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black text-sm">M</div>
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

        {/* Current branch indicator (hidden when collapsed on desktop) */}
        {showLabels && (
          <div className="mt-4 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center gap-2.5">
            <div className="h-2 w-2 rounded-full bg-blue-600 animate-pulse" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold text-slate-900 truncate">
                  {isAllBranches ? 'All Branches' : currentBranchData?.name}
                </p>
                <span className="text-[11px] uppercase font-semibold text-blue-700 bg-blue-50 px-1 rounded border border-blue-200">
                  {isAllBranches ? 'All Branches' : 'Branch'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 truncate">
                {isAllBranches ? 'Erode • Coimbatore • Chennai' : currentBranchData?.location}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Main Navigation (scrollbar hidden) */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {navItems
          .filter((item) => item.visible)
          .map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { setCurrentView(item.id); onClose?.(); }}
                title={!showLabels ? item.label : undefined}
                className={cn(
                  'relative w-full flex items-center rounded-xl text-sm font-medium transition-all group',
                  !showLabels ? 'justify-center px-0 py-2.5' : 'gap-3 px-3.5 py-2.5 text-left',
                  isActive
                    ? 'bg-blue-600 text-white shadow-xs font-semibold'
                    : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
                )}
              >
                <Icon
                  className={cn(
                    'h-4 w-4 shrink-0 transition-colors',
                    isActive ? 'text-white' : 'text-slate-500 group-hover:text-slate-700'
                  )}
                />
                {showLabels && <span className="truncate">{item.label}</span>}
                {showLabels && item.badge && (
                  <span
                    className={cn(
                      'ml-auto text-[11px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide border',
                      isActive
                        ? 'bg-white/20 text-white border-white/30'
                        : 'bg-gradient-to-r from-violet-50 to-fuchsia-50 text-fuchsia-700 border-fuchsia-200'
                    )}
                  >
                    {item.badge}
                  </span>
                )}
                {/* Beta dot indicator when collapsed (desktop) */}
                {!showLabels && item.badge && (
                  <span className="absolute top-1.5 right-3 h-2 w-2 rounded-full bg-fuchsia-500 border border-white" />
                )}
              </button>
            );
          })}
      </div>

      {/* User Session / Role Card (logout moved to the top bar) */}
      <div className={cn('border-t border-slate-200 bg-slate-50/70', showLabels ? 'p-3' : 'p-2')}>
        {!showLabels ? (
          <div className="h-9 w-9 mx-auto rounded-lg bg-white border border-slate-200 flex items-center justify-center" title={`${currentUser.name} · ${currentUser.role}`}>
            <RoleIcon className={cn('h-4 w-4', currentUser.role === 'CEO' ? 'text-amber-600' : currentUser.role === 'Manager' ? 'text-blue-600' : 'text-slate-600')} />
          </div>
        ) : (
          <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
              <RoleIcon className={cn('h-4 w-4', currentUser.role === 'CEO' ? 'text-amber-600' : currentUser.role === 'Manager' ? 'text-blue-600' : 'text-slate-600')} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-slate-900 truncate">{currentUser.name}</p>
              <p className="text-[11px] text-slate-500 truncate">
                {currentUser.role === 'CEO'
                  ? 'CEO • All Branches'
                  : currentUser.role === 'Manager'
                  ? `Manager • ${currentUser.assignedBranchId || 'Coimbatore'}`
                  : currentUser.role === 'Billing'
                  ? 'Billing Staff'
                  : currentUser.role === 'Purchase'
                  ? 'Purchase Desk'
                  : 'Sales Executive'}
              </p>
            </div>
          </div>
        )}
        {showLabels && (
          <p className="hidden lg:block text-center text-[11px] text-slate-400 pt-2">
            Press <kbd className="px-1 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-slate-600">?</kbd> for shortcuts
          </p>
        )}
      </div>
      </aside>
    </>
  );
};
