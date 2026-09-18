import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  X,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { MajestroniczLogo } from '../common/MajestroniczLogo';
import { NAV_SUB_CONFIG } from './navSubItems';
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
    activeSubTab,
    navigateToTab,
  } = useErp();

  const asideRef = useRef<HTMLElement | null>(null);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Secondary nav flyout state (desktop hover)
  const [hoveredNav, setHoveredNav] = useState<ActiveNavView | null>(null);
  const [flyoutPos, setFlyoutPos] = useState<{ top: number; left: number } | null>(null);

  // Mobile accordion expanded state
  const [mobileExpandedNav, setMobileExpandedNav] = useState<ActiveNavView | null>(null);

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

  // Close flyout on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setHoveredNav(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const clearCloseTimeout = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const handleMouseEnterItem = useCallback((id: ActiveNavView, e: React.MouseEvent<HTMLElement>) => {
    if (isMobile) return;
    clearCloseTimeout();
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    const asideRect = asideRef.current?.getBoundingClientRect();
    const left = (asideRect ? asideRect.right : rect.right) + 4;

    const config = NAV_SUB_CONFIG[id];
    const optionCount = config?.subOptions.length || 3;
    const estimatedHeight = Math.min(window.innerHeight - 32, 60 + optionCount * 54 + 36);

    let top = rect.top - 8;
    if (top + estimatedHeight > window.innerHeight - 16) {
      top = Math.max(16, window.innerHeight - estimatedHeight - 16);
    }
    if (top < 16) top = 16;

    setFlyoutPos({ top, left });
    setHoveredNav(id);
  }, [clearCloseTimeout, isMobile]);

  const handleMouseLeave = useCallback(() => {
    clearCloseTimeout();
    closeTimeoutRef.current = setTimeout(() => {
      setHoveredNav(null);
    }, 180);
  }, [clearCloseTimeout]);

  const handleSubOptionClick = useCallback((navView: ActiveNavView, subOptionId: string) => {
    navigateToTab(navView, subOptionId);
    setHoveredNav(null);
    onClose?.();
  }, [navigateToTab, onClose]);

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
    { id: 'shopify', label: 'Online Store', icon: ShoppingCart, visible: canAccessView('shopify') },
    { id: 'ai-assistant', label: 'Beta AI', icon: Sparkles, visible: canAccessView('ai-assistant'), badge: 'Beta' },
    { id: 'access', label: 'Access Control', icon: ShieldCheck, visible: canAccessView('access') },
  ];

  const RoleIcon = currentUser.role === 'CEO' ? ShieldCheck : currentUser.role === 'Manager' ? Building2 : Lock;
  const hoveredConfig = hoveredNav ? NAV_SUB_CONFIG[hoveredNav] : null;

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
        ref={asideRef}
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

      {/* Main Navigation (thin scrollbar visible) */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {navItems
          .filter((item) => item.visible)
          .map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            const subConfig = NAV_SUB_CONFIG[item.id];
            const hasSubOptions = subConfig && subConfig.subOptions.length > 0;
            const isHovered = hoveredNav === item.id;

            return (
              <div key={item.id} className="w-full">
                <div className="flex items-center gap-1 w-full">
                  <button
                    onClick={() => { setCurrentView(item.id); setHoveredNav(null); onClose?.(); }}
                    onMouseEnter={(e) => handleMouseEnterItem(item.id, e)}
                    onMouseLeave={handleMouseLeave}
                    title={!showLabels ? item.label : undefined}
                    className={cn(
                      'relative flex-1 flex items-center rounded-xl text-sm font-medium transition-all group',
                      !showLabels ? 'justify-center px-0 py-2.5' : 'gap-3 px-3.5 py-2.5 text-left',
                      isActive
                        ? 'bg-blue-600 text-white shadow-xs font-semibold'
                        : isHovered
                        ? 'bg-blue-50 text-blue-800'
                        : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-4 w-4 shrink-0 transition-colors',
                        isActive
                          ? 'text-white'
                          : isHovered
                          ? 'text-blue-600'
                          : 'text-slate-500 group-hover:text-slate-700'
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

                  {/* Mobile Accordion Toggle Icon */}
                  {isMobile && hasSubOptions && (
                    <button
                      type="button"
                      onClick={() => setMobileExpandedNav(mobileExpandedNav === item.id ? null : item.id)}
                      className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
                      title="View Sub-options"
                      aria-label={`Toggle ${item.label} sub-options`}
                    >
                      <ChevronDown
                        className={cn(
                          'h-4 w-4 transition-transform duration-200',
                          mobileExpandedNav === item.id ? 'rotate-180 text-blue-600' : ''
                        )}
                      />
                    </button>
                  )}
                </div>

                {/* Mobile Sub-Options Accordion Drawer */}
                {isMobile && mobileExpandedNav === item.id && subConfig && (
                  <div className="pl-4 pr-1 py-1 space-y-0.5 mt-1 border-l-2 border-blue-200 ml-5">
                    {subConfig.subOptions.map((sub) => {
                      const SubIcon = sub.icon;
                      const isCurrentActive =
                        currentView === item.id &&
                        activeSubTab?.view === item.id &&
                        activeSubTab.tab === sub.id;
                      return (
                        <button
                          key={sub.id}
                          type="button"
                          onClick={() => handleSubOptionClick(item.id, sub.id)}
                          className={cn(
                            'w-full py-2 px-2.5 rounded-lg flex items-center gap-2.5 text-left text-xs font-medium transition-colors',
                            isCurrentActive
                              ? 'bg-blue-50 text-blue-800 font-semibold'
                              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                          )}
                        >
                          <SubIcon className={cn('h-3.5 w-3.5 shrink-0', isCurrentActive ? 'text-blue-600' : 'text-slate-400')} />
                          <span className="truncate flex-1">{sub.label}</span>
                          {sub.tag && (
                            <span className="text-[9px] px-1 py-0.2 rounded bg-slate-200/60 text-slate-500 uppercase">
                              {sub.tag}
                            </span>
                          )}
                        </button>
                      );
                    })}
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

      {/* Desktop Secondary Navigation Bar (Floating flyout panel docked right beside sidebar on hover) */}
      {hoveredConfig && hoveredConfig.subOptions.length > 0 && !isMobile && flyoutPos && (
        <div
          role="region"
          aria-label={`${hoveredConfig.title} Sub-Navigation`}
          onMouseEnter={clearCloseTimeout}
          onMouseLeave={handleMouseLeave}
          style={{
            position: 'fixed',
            top: flyoutPos.top,
            left: flyoutPos.left,
          }}
          className="w-80 max-h-[calc(100vh-32px)] bg-white border border-slate-200/90 rounded-2xl shadow-2xl z-50 overflow-hidden flex flex-col animate-in fade-in-50 zoom-in-98 duration-150 ring-1 ring-black/5 before:absolute before:-left-3 before:top-0 before:bottom-0 before:w-3"
        >
          {/* Header */}
          <div className="p-3.5 bg-gradient-to-b from-slate-50 to-white border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-9 w-9 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 flex items-center justify-center shrink-0">
                <hoveredConfig.icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-xs font-bold text-slate-900 tracking-tight truncate">
                    {hoveredConfig.title}
                  </h3>
                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                    {hoveredConfig.subOptions.length}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 truncate mt-0.5">
                  {hoveredConfig.subtitle}
                </p>
              </div>
            </div>
            <button
              onClick={() => setHoveredNav(null)}
              className="h-6 w-6 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              title="Close menu"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Sub-Options List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {hoveredConfig.subOptions.map((opt) => {
              const SubIcon = opt.icon;
              const isCurrentActive =
                currentView === hoveredConfig.id &&
                activeSubTab?.view === hoveredConfig.id &&
                activeSubTab.tab === opt.id;

              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleSubOptionClick(hoveredConfig.id, opt.id)}
                  className={cn(
                    'w-full p-2.5 rounded-xl flex items-start gap-2.5 text-left transition-all group cursor-pointer border',
                    isCurrentActive
                      ? 'bg-blue-50 border-blue-200 text-blue-900 shadow-2xs'
                      : 'border-transparent hover:bg-slate-50 hover:border-slate-200 text-slate-700'
                  )}
                >
                  <div
                    className={cn(
                      'h-7 w-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 transition-colors',
                      isCurrentActive
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 group-hover:bg-blue-100 group-hover:text-blue-700'
                    )}
                  >
                    <SubIcon className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold truncate group-hover:text-blue-700">
                        {opt.label}
                      </span>
                      {opt.tag && (
                        <span
                          className={cn(
                            'text-[9px] font-semibold px-1.5 py-0.5 rounded-md uppercase tracking-wider',
                            opt.tag === 'Action'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : opt.tag === 'Filter'
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : 'bg-slate-100 text-slate-600'
                          )}
                        >
                          {opt.tag}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 group-hover:text-slate-600 line-clamp-1 mt-0.5 leading-snug">
                      {opt.description}
                    </p>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-all self-center shrink-0" />
                </button>
              );
            })}
          </div>

          {/* Footer bar */}
          <div className="px-3.5 py-2 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400 font-medium">
            <span>Click option to open</span>
            <span className="font-mono text-[9px] bg-slate-200/80 text-slate-600 px-1.5 py-0.5 rounded">ESC</span>
          </div>
        </div>
      )}
    </>
  );
};
