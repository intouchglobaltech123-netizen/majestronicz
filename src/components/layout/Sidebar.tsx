import React, { useState, useEffect, useCallback } from 'react';
import { useErp, ActiveNavView } from '../../context/ErpContext';
import {
  X,
  ChevronDown,
  Plus,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Building2,
  ShieldCheck,
  Lock,
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

interface NavItem {
  id: ActiveNavView;
  subTabId?: string;
  label: string;
  visible: boolean;
}

interface NavGroup {
  id: string;
  title: string;
  items: NavItem[];
}

export const Sidebar: React.FC<SidebarProps> = ({ mobileOpen = false, onClose }) => {
  const {
    currentUser,
    currentView,
    setCurrentView,
    canAccessView,
    activeSubTab,
    navigateToTab,
    logout,
  } = useErp();

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // Desktop collapse state
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  // Track mobile viewport (< lg)
  const [isMobile, setIsMobile] = useState<boolean>(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const showLabels = isMobile || !collapsed;

  // Grouped Navigation Definition (Classic Vyapar Desktop accounting modules)
  const groups: NavGroup[] = [
    {
      id: 'parties',
      title: 'Parties',
      items: [
        {
          id: 'parties',
          subTabId: 'customers',
          label: 'Customers',
          visible: canAccessView('parties') || canAccessView('customers'),
        },
        {
          id: 'parties',
          subTabId: 'suppliers',
          label: 'Suppliers',
          visible: canAccessView('parties'),
        },
      ],
    },
    {
      id: 'items',
      title: 'Items & Stock',
      items: [
        {
          id: 'items',
          subTabId: 'products',
          label: 'Item Catalog',
          visible: canAccessView('items'),
        },
        {
          id: 'inventory',
          label: 'Stock Inventory',
          visible: canAccessView('inventory'),
        },
        {
          id: 'barcodes',
          label: 'Barcode Generator',
          visible: canAccessView('barcodes'),
        },
      ],
    },
    {
      id: 'sales',
      title: 'Sales',
      items: [
        {
          id: 'invoices',
          subTabId: 'ledger',
          label: 'Sale Invoices',
          visible: canAccessView('invoices'),
        },
        {
          id: 'estimates',
          subTabId: 'estimates',
          label: 'Quotations / Estimates',
          visible: canAccessView('estimates') || canAccessView('invoices'),
        },
        {
          id: 'challans',
          subTabId: 'history',
          label: 'Delivery Challans',
          visible: canAccessView('challans'),
        },
        {
          id: 'invoices',
          subTabId: 'returns',
          label: 'Sale Returns',
          visible: canAccessView('invoices'),
        },
        {
          id: 'enquiries',
          label: 'Enquiries',
          visible: canAccessView('enquiries'),
        },
        {
          id: 'pending-orders',
          label: 'Pending Orders',
          visible: canAccessView('pending-orders'),
        },
      ],
    },
    {
      id: 'purchases',
      title: 'Purchases',
      items: [
        {
          id: 'purchases',
          subTabId: 'bills',
          label: 'Purchase Bills',
          visible: canAccessView('purchases'),
        },
        {
          id: 'purchases',
          subTabId: 'orders',
          label: 'Purchase Orders',
          visible: canAccessView('purchases'),
        },
        {
          id: 'purchases',
          subTabId: 'vendors',
          label: 'Vendors Directory',
          visible: canAccessView('purchases'),
        },
      ],
    },
    {
      id: 'cash-bank',
      title: 'Cash & Bank',
      items: [
        {
          id: 'cash-register',
          label: 'Daily Cash Register',
          visible: canAccessView('cash-register'),
        },
      ],
    },
    {
      id: 'reports',
      title: 'Reports',
      items: [
        {
          id: 'reports',
          subTabId: 'sales',
          label: 'Sales Register',
          visible: canAccessView('reports'),
        },
        {
          id: 'reports',
          subTabId: 'pnl',
          label: 'Profit & Loss Statement',
          visible: canAccessView('reports'),
        },
        {
          id: 'reports',
          subTabId: 'stock-valuation',
          label: 'Stock Valuation',
          visible: canAccessView('reports'),
        },
        {
          id: 'reports',
          subTabId: 'gst',
          label: 'GST Filing (GSTR-1 & 3B)',
          visible: canAccessView('reports'),
        },
        {
          id: 'reports',
          subTabId: 'payroll',
          label: 'Payroll Summary',
          visible: canAccessView('reports'),
        },
      ],
    },
    {
      id: 'utilities',
      title: 'Settings & More',
      items: [
        {
          id: 'hrm',
          label: 'Staff & Attendance',
          visible: canAccessView('hrm'),
        },
        {
          id: 'shopify',
          label: 'Online Store',
          visible: canAccessView('shopify'),
        },
        {
          id: 'access',
          label: 'Access Control',
          visible: canAccessView('access'),
        },
        {
          id: 'ai-assistant',
          label: 'AI Assistant',
          visible: canAccessView('ai-assistant'),
        },
      ],
    },
  ];

  // Accordion open/close state for each group
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {
      sales: true,
      parties: true,
      items: true,
      purchases: false,
      'cash-bank': false,
      reports: false,
      utilities: false,
    };
    return initial;
  });

  // Automatically keep the group of the active view open
  useEffect(() => {
    for (const grp of groups) {
      const match = grp.items.some(
        (it) => it.id === currentView || (it.id === 'parties' && currentView === 'customers')
      );
      if (match) {
        setExpandedGroups((prev) => ({ ...prev, [grp.id]: true }));
        break;
      }
    }
  }, [currentView]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  const handleItemClick = useCallback(
    (item: NavItem) => {
      if (item.subTabId) {
        if (item.subTabId === 'new-challan') {
          navigateToTab('challans', 'new');
        } else if (item.subTabId === 'history' && item.id === 'challans') {
          navigateToTab('challans', 'history');
        } else {
          navigateToTab(item.id, item.subTabId);
        }
      } else {
        setCurrentView(item.id);
      }
      onClose?.();
    },
    [navigateToTab, setCurrentView, onClose]
  );

  const RoleIcon =
    currentUser.role === 'CEO'
      ? ShieldCheck
      : currentUser.role === 'Manager'
      ? Building2
      : Lock;

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={cn(
          'fixed inset-0 bg-slate-900/50 z-30 lg:hidden transition-opacity duration-150',
          mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className={cn(
          'bg-white border-r border-slate-300 flex flex-col h-screen h-[100dvh] max-h-[100dvh] select-none shadow-none',
          // Mobile drawer
          'fixed inset-y-0 left-0 z-40 w-64 max-w-[85vw] transition-transform duration-150',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop sidebar
          'lg:static lg:z-20 lg:translate-x-0 lg:shrink-0 lg:transition-[width]',
          collapsed ? 'lg:w-16' : 'lg:w-60'
        )}
      >
        {/* Brand Header */}
        <div className="border-b border-slate-200 p-3 flex items-center justify-between shrink-0 bg-white">
          {/* Mobile close button */}
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="lg:hidden h-7 w-7 rounded-none border border-slate-300 bg-slate-50 text-slate-600 hover:text-slate-900 flex items-center justify-center cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>

          {!showLabels ? (
            <div className="flex flex-col items-center gap-2 w-full">
              <MajestroniczLogo collapsed={true} />
              <button
                onClick={() => setCollapsed(false)}
                title="Expand sidebar"
                aria-label="Expand sidebar"
                className="h-7 w-7 rounded-none border border-slate-300 bg-slate-50 text-slate-600 hover:text-red-700 flex items-center justify-center transition-colors cursor-pointer"
              >
                <PanelLeftOpen className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 w-full">
              <MajestroniczLogo size="sm" />
              <button
                onClick={() => setCollapsed(true)}
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
                className="hidden lg:flex h-7 w-7 rounded-none border border-slate-300 bg-slate-50 text-slate-600 hover:text-red-700 items-center justify-center transition-colors shrink-0 cursor-pointer"
              >
                <PanelLeftClose className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Vyapar-Style Quick Action: + Add Sale */}
        {showLabels && (
          <div className="p-2.5 border-b border-slate-200 bg-slate-50/70 shrink-0">
            <button
              type="button"
              onClick={() => {
                navigateToTab('invoices', 'new');
                onClose?.();
              }}
              className="w-full py-2 px-3 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-none flex items-center justify-center gap-1.5 transition-colors border border-red-700 cursor-pointer shadow-2xs"
              title="Create New Sale"
            >
              <Plus className="h-3.5 w-3.5 stroke-[3]" />
              <span>+ ADD SALE</span>
            </button>
            <div className="grid grid-cols-2 gap-1 mt-1.5">
              <button
                type="button"
                onClick={() => {
                  navigateToTab('invoices', 'new-quote');
                  onClose?.();
                }}
                className="py-1 px-1.5 bg-white hover:bg-slate-100 text-slate-700 font-bold text-[11px] rounded-none border border-slate-300 text-center transition-colors cursor-pointer"
                title="Create Quotation / Estimate"
              >
                + Add Quote
              </button>
              <button
                type="button"
                onClick={() => {
                  navigateToTab('challans', 'new');
                  onClose?.();
                }}
                className="py-1 px-1.5 bg-white hover:bg-slate-100 text-slate-700 font-bold text-[11px] rounded-none border border-slate-300 text-center transition-colors cursor-pointer"
                title="Create Delivery Challan"
              >
                + Challan
              </button>
            </div>
          </div>
        )}

        {/* Main Grouped Navigation (Classic Accounting Dropdown / Accordion) */}
        <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-200/80 pb-8 text-slate-800">
          {/* Dashboard link (always visible at top) */}
          {canAccessView('dashboard') && (
            <button
              type="button"
              onClick={() => {
                setCurrentView('dashboard');
                onClose?.();
              }}
              title={!showLabels ? 'Dashboard' : undefined}
              className={cn(
                'w-full text-left font-bold transition-colors flex items-center cursor-pointer',
                showLabels ? 'px-3 py-2 text-xs' : 'p-2 justify-center',
                currentView === 'dashboard'
                  ? 'bg-red-50 text-red-900 border-l-4 border-red-600 font-extrabold'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 border-l-4 border-transparent'
              )}
            >
              {showLabels ? <span>Dashboard</span> : <span className="text-xs font-black">DB</span>}
            </button>
          )}

          {/* Grouped Modules */}
          {groups.map((grp) => {
            const visibleItems = grp.items.filter((it) => it.visible);
            if (visibleItems.length === 0) return null;

            const isExpanded = expandedGroups[grp.id] ?? false;
            const isGroupActive = visibleItems.some((it) => {
              if (it.id === 'parties' && currentView === 'customers') return true;
              return it.id === currentView;
            });

            // When sidebar is collapsed on desktop, show compact group marker
            if (!showLabels) {
              return (
                <div key={grp.id} className="py-1 flex justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      setCollapsed(false);
                      setExpandedGroups((prev) => ({ ...prev, [grp.id]: true }));
                    }}
                    title={grp.title}
                    className={cn(
                      'h-8 w-8 rounded-none border text-[11px] font-bold flex items-center justify-center cursor-pointer',
                      isGroupActive
                        ? 'bg-red-600 text-white border-red-700'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    )}
                  >
                    {grp.title.substring(0, 2).toUpperCase()}
                  </button>
                </div>
              );
            }

            return (
              <div key={grp.id} className="py-0.5">
                {/* Group Accordion Header */}
                <button
                  type="button"
                  onClick={() => toggleGroup(grp.id)}
                  className={cn(
                    'w-full px-3 py-2 text-left text-xs font-bold flex items-center justify-between transition-colors cursor-pointer select-none',
                    isGroupActive
                      ? 'text-slate-900 bg-slate-100/70 border-l-4 border-red-600'
                      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 border-l-4 border-transparent'
                  )}
                >
                  <span className="uppercase tracking-wider text-[11px] font-extrabold text-slate-600">
                    {grp.title}
                  </span>
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 text-slate-400 transition-transform duration-150',
                      isExpanded ? 'rotate-180 text-red-600' : ''
                    )}
                  />
                </button>

                {/* Sub-Items List (Clean Text-First, No Icons) */}
                {isExpanded && (
                  <div className="bg-slate-50/60 py-0.5 border-l-2 border-slate-300 ml-3 my-0.5 space-y-0.5">
                    {visibleItems.map((sub) => {
                      const isSubActive =
                        (currentView === sub.id || (sub.id === 'parties' && currentView === 'customers')) &&
                        (!sub.subTabId || activeSubTab?.tab === sub.subTabId);

                      return (
                        <button
                          key={`${sub.id}-${sub.subTabId || ''}`}
                          type="button"
                          onClick={() => handleItemClick(sub)}
                          className={cn(
                            'w-full px-3 py-1.5 text-left text-xs transition-colors cursor-pointer block truncate font-medium',
                            isSubActive
                              ? 'bg-red-50 text-red-900 font-extrabold border-l-3 border-red-600 -ml-[2px]'
                              : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
                          )}
                        >
                          {sub.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* User Footer with Sign Out */}
        <div className="shrink-0 border-t border-slate-200 bg-slate-50 mt-auto sticky bottom-0 z-10 p-2.5">
          {!showLabels ? (
            <div className="flex flex-col items-center gap-2">
              <div
                className="h-8 w-8 rounded-none bg-white border border-slate-300 flex items-center justify-center text-slate-700"
                title={`${currentUser.name} (${currentUser.role})`}
              >
                <RoleIcon className="h-4 w-4" />
              </div>
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(true)}
                title="Sign out"
                aria-label="Sign out"
                className="h-8 w-8 rounded-none border border-slate-300 bg-white hover:bg-rose-50 text-slate-600 hover:text-rose-700 flex items-center justify-center transition-colors cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="h-7 w-7 rounded-none bg-white border border-slate-300 flex items-center justify-center shrink-0 text-slate-700">
                  <RoleIcon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-slate-900 truncate leading-tight">
                    {currentUser.name}
                  </p>
                  <p className="text-[10px] text-slate-500 font-semibold truncate leading-tight">
                    {currentUser.role}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowLogoutConfirm(true)}
                title="Sign out"
                aria-label="Sign out"
                className="h-7 px-2 rounded-none border border-slate-300 bg-white hover:bg-rose-50 text-slate-600 hover:text-rose-700 flex items-center gap-1 text-[11px] font-bold transition-colors cursor-pointer shrink-0"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Exit</span>
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4"
          onClick={() => setShowLogoutConfirm(false)}
        >
          <div
            className="w-full max-w-sm rounded-none bg-white border border-slate-400 shadow-lg p-5 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-extrabold text-slate-900 uppercase tracking-wide">
              Sign out of ERP?
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              You will need to enter your PIN to log back in.
            </p>
            <div className="flex items-center gap-2 mt-4">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 py-2 rounded-none border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowLogoutConfirm(false);
                  logout();
                }}
                className="flex-1 py-2 rounded-none bg-red-600 hover:bg-red-700 text-white text-xs font-bold border border-red-700 cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Sidebar;
