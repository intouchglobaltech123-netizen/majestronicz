import React, { useState, useRef, useEffect } from 'react';
import { useErp, ActiveNavView } from '../../context/ErpContext';
import {
  LayoutDashboard,
  Boxes,
  Barcode,
  BarChart3,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Receipt,
  ClipboardList,
  Wallet,
  Users,
  Clock,
  Sparkles,
  Package,
  CalendarCheck,
  Store,
  Plus,
  X,
  ChevronLeft,
  ChevronRight,
  Layers,
} from 'lucide-react';
import { cn } from '../../lib/utils';

// Mapping of view to its semantic icon
const VIEW_ICONS: Record<ActiveNavView, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  items: Package,
  customers: Users,
  parties: Users,
  enquiries: ClipboardList,
  'pending-orders': Clock,
  estimates: ClipboardList,
  challans: Truck,
  invoices: Receipt,
  barcodes: Barcode,
  'cash-register': Wallet,
  purchases: ShoppingCart,
  hrm: CalendarCheck,
  inventory: Boxes,
  reports: BarChart3,
  shopify: Store,
  'ai-assistant': Sparkles,
  access: ShieldCheck,
};

interface AvailableNavOption {
  id: ActiveNavView;
  title: string;
  category: 'Operations' | 'Sales & Orders' | 'Inventory & Stock' | 'Finance & Admin';
  icon: React.ComponentType<{ className?: string }>;
}

const AVAILABLE_OPTIONS: AvailableNavOption[] = [
  { id: 'dashboard', title: 'Dashboard', category: 'Operations', icon: LayoutDashboard },
  { id: 'invoices', title: 'Sales & Invoices', category: 'Sales & Orders', icon: Receipt },
  { id: 'parties', title: 'Parties & Customers', category: 'Sales & Orders', icon: Users },
  { id: 'enquiries', title: 'Customer Enquiries', category: 'Sales & Orders', icon: ClipboardList },
  { id: 'pending-orders', title: 'Pending Orders', category: 'Sales & Orders', icon: Clock },
  { id: 'estimates', title: 'Estimates & Quotes', category: 'Sales & Orders', icon: ClipboardList },
  { id: 'challans', title: 'Delivery Challans', category: 'Sales & Orders', icon: Truck },
  { id: 'items', title: 'Item Master', category: 'Inventory & Stock', icon: Package },
  { id: 'inventory', title: 'Inventory & Stock', category: 'Inventory & Stock', icon: Boxes },
  { id: 'barcodes', title: 'Barcode Generator', category: 'Inventory & Stock', icon: Barcode },
  { id: 'purchases', title: 'Purchase Orders', category: 'Operations', icon: ShoppingCart },
  { id: 'cash-register', title: 'Cash Register (POS)', category: 'Finance & Admin', icon: Wallet },
  { id: 'hrm', title: 'Attendance & HR', category: 'Finance & Admin', icon: CalendarCheck },
  { id: 'reports', title: 'Reports & Analytics', category: 'Finance & Admin', icon: BarChart3 },
  { id: 'shopify', title: 'Online Store', category: 'Operations', icon: Store },
  { id: 'ai-assistant', title: 'Beta AI Assistant', category: 'Operations', icon: Sparkles },
  { id: 'access', title: 'Access Control', category: 'Finance & Admin', icon: ShieldCheck },
];

export const WorkspaceTabBar: React.FC = () => {
  const {
    tabs,
    activeTabId,
    openTab,
    switchTab,
    closeTab,
    closeOtherTabs,
    canAccessView,
  } = useErp();

  const [isNewTabMenuOpen, setIsNewTabMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    tabId: string;
  } | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Filter available options by user permissions
  const accessibleOptions = AVAILABLE_OPTIONS.filter((opt) => canAccessView(opt.id));

  // Scroll active tab into view when activeTabId changes
  useEffect(() => {
    if (activeTabRef.current && scrollContainerRef.current) {
      activeTabRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    }
  }, [activeTabId]);

  // Close context menu & new tab popover on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsNewTabMenuOpen(false);
      }
      if (contextMenu?.visible) {
        setContextMenu(null);
      }
    };
    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [contextMenu]);

  // Handle horizontal scrolling buttons
  const handleScroll = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      const scrollAmount = direction === 'left' ? -220 : 220;
      scrollContainerRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  // Open context menu on right click
  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      tabId,
    });
  };

  const handleOpenFromMenu = (view: ActiveNavView) => {
    openTab(view);
    setIsNewTabMenuOpen(false);
  };

  return (
    <div className="relative flex items-center h-10 bg-slate-200/80 border-b border-slate-300/90 select-none px-2.5 z-20">
      {/* Scroll Left Button (if overflow) */}
      <button
        type="button"
        onClick={() => handleScroll('left')}
        className="hidden md:flex items-center justify-center h-7 w-5 text-slate-500 hover:text-slate-800 hover:bg-slate-300/60 rounded transition-colors mr-0.5"
        title="Scroll tabs left"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>

      {/* Tab Strip */}
      <div
        ref={scrollContainerRef}
        className="flex items-center gap-1 overflow-x-auto no-scrollbar h-full pt-1.5 flex-1 min-w-0"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const Icon = VIEW_ICONS[tab.view] || Layers;

          return (
            <div
              key={tab.id}
              ref={isActive ? (el) => { activeTabRef.current = el as any; } : undefined}
              onClick={() => switchTab(tab.id)}
              onContextMenu={(e) => handleContextMenu(e, tab.id)}
              className={cn(
                'group relative flex items-center h-full max-w-[200px] min-w-[110px] sm:min-w-[140px] px-3 rounded-t-lg transition-all text-xs font-medium cursor-pointer border-t border-x select-none flex-shrink-0',
                isActive
                  ? 'bg-white text-slate-900 border-slate-300/90 border-b-transparent shadow-[0_-1px_3px_rgba(0,0,0,0.05)] z-10 font-semibold'
                  : 'bg-slate-200/50 text-slate-600 hover:bg-slate-100 hover:text-slate-900 border-transparent hover:border-slate-300/40'
              )}
              title={tab.title}
            >
              {/* Active Tab Accent Top Line */}
              {isActive && (
                <span className="absolute top-0 left-0 right-0 h-[2.5px] bg-blue-600 rounded-t-lg" />
              )}

              {/* Module Icon */}
              <Icon
                className={cn(
                  'w-3.5 h-3.5 flex-shrink-0 mr-2 transition-colors',
                  isActive ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-600'
                )}
              />

              {/* Tab Title */}
              <span className="truncate flex-1 text-[12px] tracking-tight">{tab.title}</span>

              {/* Close Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className={cn(
                  'ml-1.5 p-0.5 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors flex-shrink-0',
                  isActive ? 'opacity-90 hover:opacity-100' : 'opacity-0 group-hover:opacity-100'
                )}
                title="Close tab"
                aria-label={`Close ${tab.title} tab`}
              >
                <X className="w-3.5 h-3.5" />
              </button>

              {/* Inactive Tab Divider */}
              {!isActive && (
                <span className="absolute right-0 top-2 bottom-2 w-[1px] bg-slate-300/60 pointer-events-none group-hover:hidden" />
              )}
            </div>
          );
        })}

        {/* Plus (+) New Tab Button */}
        <div className="relative flex-shrink-0 ml-1 mb-0.5" ref={menuRef}>
          <button
            type="button"
            onClick={() => setIsNewTabMenuOpen((prev) => !prev)}
            className="flex items-center justify-center w-7 h-7 rounded-full hover:bg-slate-300/80 text-slate-600 hover:text-slate-900 transition-colors"
            title="Open new tab"
            aria-label="Open new workspace tab"
          >
            <Plus className="w-4 h-4" />
          </button>

          {/* Quick-Open Popover Dropdown */}
          {isNewTabMenuOpen && (
            <div className="absolute left-0 top-full mt-1.5 w-64 max-h-[380px] overflow-y-auto bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-50 animate-in fade-in-50 zoom-in-95">
              <div className="px-3 py-1.5 border-b border-slate-100 mb-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Open New Workspace Tab
                </p>
              </div>

              <div className="py-1">
                {accessibleOptions.map((opt) => {
                  const OptIcon = opt.icon;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleOpenFromMenu(opt.id)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                    >
                      <OptIcon className="w-4 h-4 text-slate-400 group-hover:text-blue-600" />
                      <span className="truncate">{opt.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Scroll Right Button */}
      <button
        type="button"
        onClick={() => handleScroll('right')}
        className="hidden md:flex items-center justify-center h-7 w-5 text-slate-500 hover:text-slate-800 hover:bg-slate-300/60 rounded transition-colors ml-0.5"
        title="Scroll tabs right"
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </button>

      {/* Tab Context Menu (Right Click) */}
      {contextMenu?.visible && (
        <div
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed bg-white border border-slate-200 rounded-lg shadow-xl py-1.5 min-w-[170px] z-50 text-xs text-slate-700"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 hover:bg-slate-100 text-slate-700 font-medium"
            onClick={() => {
              closeTab(contextMenu.tabId);
              setContextMenu(null);
            }}
          >
            Close Tab
          </button>
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 hover:bg-slate-100 text-slate-700 font-medium"
            onClick={() => {
              closeOtherTabs(contextMenu.tabId);
              setContextMenu(null);
            }}
          >
            Close Other Tabs
          </button>
        </div>
      )}
    </div>
  );
};
