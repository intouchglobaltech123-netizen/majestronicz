import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useErp, ActiveNavView } from '../../context/ErpContext';
import {
  LayoutDashboard,
  Boxes,
  Barcode,
  BarChart3,
  ShieldCheck,
  Contact,
  ShoppingCart,
  Building2,
  Lock,
  Truck,
  Receipt,
  ClipboardList,
  Wallet,
  Users,
  Clock,
  Sparkles,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  ChevronDown,
  Plus,
  Package,
  CalendarCheck,
  Store,
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

  // Hover & Choose Flyout state for desktop
  const [hoveredNavView, setHoveredNavView] = useState<ActiveNavView | null>(null);
  const [flyoutPos, setFlyoutPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mobile accordion expanded state
  const [mobileExpandedNav, setMobileExpandedNav] = useState<ActiveNavView | null>(null);

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [collapsed]);

  // Clean up hover timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

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

  const handleSubOptionClick = useCallback((navView: ActiveNavView, subOptionId: string) => {
    setHoveredNavView(null);
    navigateToTab(navView, subOptionId);
    onClose?.();
  }, [navigateToTab, onClose]);

  const handleNavClick = useCallback((id: ActiveNavView) => {
    setHoveredNavView(null);
    setCurrentView(id);
    onClose?.();
  }, [setCurrentView, onClose]);

  const handleItemMouseEnter = (id: ActiveNavView, e: React.MouseEvent<HTMLElement>) => {
    if (isMobile) return;
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    const subConfig = NAV_SUB_CONFIG[id];
    const hasContent = subConfig && (subConfig.primaryAction || subConfig.subOptions.length > 0);
    if (!hasContent) {
      setHoveredNavView(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const numOptions = subConfig.subOptions.length + (subConfig.primaryAction ? 1 : 0);
    const approxHeight = 80 + numOptions * 46;
    const maxTop = Math.max(16, window.innerHeight - approxHeight - 20);
    const clampedTop = Math.max(16, Math.min(rect.top - 6, maxTop));

    setFlyoutPos({ top: clampedTop, left: rect.right + 8 });
    setHoveredNavView(id);
  };

  const handleItemMouseLeave = () => {
    if (isMobile) return;
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredNavView(null);
    }, 180);
  };

  const handleFlyoutMouseEnter = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  };

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
    { id: 'items', label: 'Items', icon: Package, visible: canAccessView('items') },
    { id: 'customers', label: 'Customers', icon: Users, visible: canAccessView('customers') },
    { id: 'parties', label: 'Parties', icon: Contact, visible: canAccessView('parties') },
    { id: 'enquiries', label: 'Enquiries', icon: ClipboardList, visible: canAccessView('enquiries') },
    { id: 'pending-orders', label: 'Pending Orders', icon: Clock, visible: canAccessView('pending-orders') },
    { id: 'challans', label: 'Delivery Challan', icon: Truck, visible: canAccessView('challans') },
    { id: 'inventory', label: 'Inventory', icon: Boxes, visible: canAccessView('inventory') },
    { id: 'invoices', label: 'Sales', icon: Receipt, visible: canAccessView('invoices') },
    { id: 'barcodes', label: 'Barcode', icon: Barcode, visible: canAccessView('barcodes') },
    { id: 'cash-register', label: 'Cash Register', icon: Wallet, visible: canAccessView('cash-register') },
    { id: 'purchases', label: 'Purchases', icon: ShoppingCart, visible: canAccessView('purchases') },
    { id: 'hrm', label: 'Attendance', icon: CalendarCheck, visible: canAccessView('hrm') },
    { id: 'reports', label: 'Reports', icon: BarChart3, visible: canAccessView('reports') },
    { id: 'shopify', label: 'Online Store', icon: Store, visible: canAccessView('shopify') },
    { id: 'ai-assistant', label: 'Beta AI', icon: Sparkles, visible: canAccessView('ai-assistant'), badge: 'Beta' },
    { id: 'access', label: 'Access Control', icon: ShieldCheck, visible: canAccessView('access') },
  ];

  const RoleIcon = currentUser.role === 'CEO' ? ShieldCheck : currentUser.role === 'Manager' ? Building2 : Lock;
  const activeFlyoutConfig = hoveredNavView ? NAV_SUB_CONFIG[hoveredNavView] : null;

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
                className="h-8 w-8 rounded-lg border border-slate-200 bg-slate-50 text-slate-500 hover:text-blue-600 hover:border-blue-300 flex items-center justify-center transition-colors cursor-pointer"
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
                className="hidden lg:flex h-8 w-8 rounded-lg border border-slate-200 bg-slate-50 text-slate-500 hover:text-blue-600 hover:border-blue-300 items-center justify-center transition-colors shrink-0 cursor-pointer"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {/* Main Navigation (thin scrollbar visible) */}
        <div
          className="flex-1 overflow-y-auto px-3 py-4 space-y-1"
          onScroll={() => setHoveredNavView(null)}
        >
          {navItems
            .filter((item) => item.visible)
            .map((item) => {
              const Icon = item.icon;
              const isActive = currentView === item.id;
              const subConfig = NAV_SUB_CONFIG[item.id];
              const hasSubOptions = subConfig && subConfig.subOptions.length > 0;

              return (
                <div
                  key={item.id}
                  className="w-full relative"
                  onMouseEnter={(e) => handleItemMouseEnter(item.id, e)}
                  onMouseLeave={handleItemMouseLeave}
                >
                  <div className="flex items-center gap-1 w-full">
                    <button
                      onClick={() => handleNavClick(item.id)}
                      title={!showLabels ? item.label : undefined}
                      className={cn(
                        'relative flex-1 flex items-center rounded-xl text-sm font-medium transition-all group cursor-pointer',
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
                      {subConfig.primaryAction && (
                        <button
                          type="button"
                          onClick={() => handleSubOptionClick(item.id, subConfig.primaryAction!.id)}
                          className="w-full py-2 px-2.5 rounded-lg flex items-center gap-2 text-left text-xs font-bold text-blue-700 bg-blue-50/80 mb-1 cursor-pointer"
                        >
                          <Plus className="h-3.5 w-3.5 text-blue-600" />
                          <span>{subConfig.primaryAction.label}</span>
                        </button>
                      )}
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
                              'w-full py-2 px-2.5 rounded-lg flex items-center gap-2.5 text-left text-xs font-medium transition-colors cursor-pointer',
                              isCurrentActive
                                ? 'bg-blue-50 text-blue-800 font-semibold'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                            )}
                          >
                            <SubIcon className={cn('h-3.5 w-3.5 shrink-0', isCurrentActive ? 'text-blue-600' : 'text-slate-400')} />
                            <span className="truncate flex-1">{sub.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
        </div>

        {/* Compact user footer — name + role icon only */}
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

      {/* Sleek Desktop Floating Hover-and-Choose Flyout Popover */}
      {!isMobile && activeFlyoutConfig && (activeFlyoutConfig.primaryAction || activeFlyoutConfig.subOptions.length > 0) && (
        <div
          onMouseEnter={handleFlyoutMouseEnter}
          onMouseLeave={handleItemMouseLeave}
          style={{
            top: `${flyoutPos.top}px`,
            left: `${flyoutPos.left}px`,
            maxHeight: 'calc(100vh - 32px)',
          }}
          className={cn(
            'fixed z-50 w-72 bg-white/98 backdrop-blur-md rounded-2xl border border-slate-200/90 shadow-2xl p-3 select-none text-slate-800 flex flex-col',
            'animate-in fade-in-50 zoom-in-95 duration-150',
            "before:absolute before:-left-3 before:top-0 before:bottom-0 before:w-3 before:content-['']"
          )}
        >
          {/* Flyout Header */}
          <div className="flex items-center gap-2.5 pb-2.5 mb-2.5 border-b border-slate-100 shrink-0">
            <div className="h-7 w-7 rounded-lg bg-blue-50 border border-blue-200/60 text-blue-600 flex items-center justify-center shrink-0">
              <activeFlyoutConfig.icon className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <h4 className="text-xs font-bold text-slate-900 tracking-tight truncate">
                {activeFlyoutConfig.title}
              </h4>
              <p className="text-[10px] text-slate-500 truncate">
                {activeFlyoutConfig.subtitle}
              </p>
            </div>
          </div>

          {/* Primary Action Button (Vyapar-style e.g. + Add Sale, + Add Product) */}
          {activeFlyoutConfig.primaryAction && (
            <div className="mb-2 shrink-0">
              <button
                type="button"
                onClick={() => handleSubOptionClick(activeFlyoutConfig.id, activeFlyoutConfig.primaryAction!.id)}
                className="w-full py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
                <span>{activeFlyoutConfig.primaryAction.label}</span>
              </button>
            </div>
          )}

          {/* Operations List */}
          {activeFlyoutConfig.subOptions.length > 0 && (
            <div className="flex-1 overflow-y-auto space-y-1 pr-0.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2 py-0.5">
                Operations
              </div>
              {activeFlyoutConfig.subOptions.map((opt) => {
                const SubIcon = opt.icon;
                const isCurrentActive =
                  currentView === activeFlyoutConfig.id &&
                  activeSubTab?.view === activeFlyoutConfig.id &&
                  activeSubTab.tab === opt.id;

                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleSubOptionClick(activeFlyoutConfig.id, opt.id)}
                    className={cn(
                      'w-full px-2.5 py-2 rounded-xl text-xs font-medium flex items-center gap-2.5 transition-all text-left cursor-pointer border',
                      isCurrentActive
                        ? 'bg-blue-50/90 border-blue-200 text-blue-800 font-bold shadow-2xs'
                        : 'border-transparent text-slate-700 hover:text-slate-900 hover:bg-slate-50 hover:border-slate-200/60'
                    )}
                  >
                    <SubIcon
                      className={cn(
                        'h-4 w-4 shrink-0 transition-colors',
                        isCurrentActive ? 'text-blue-600' : 'text-slate-500'
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-semibold">{opt.label}</div>
                      {opt.description && (
                        <div className="text-[10px] text-slate-500 truncate font-normal leading-tight">
                          {opt.description}
                        </div>
                      )}
                    </div>
                    {opt.badge && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200/60 shrink-0">
                        {opt.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );
};
