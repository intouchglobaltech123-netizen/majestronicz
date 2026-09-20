import React, { useState, useEffect, useRef } from 'react';
import { ErpProvider, useErp } from './context/ErpContext';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { DashboardView } from './components/dashboard/DashboardView';
import { ItemMasterView } from './components/items/ItemMasterView';
import { DeliveryChallanView } from './components/challans/DeliveryChallanView';
import { InvoiceView } from './components/invoices/InvoiceView';
import { EnquiryView } from './components/enquiries/EnquiryView';
import { PendingOrdersView } from './components/enquiries/PendingOrdersView';
import { BarcodeView } from './components/barcodes/BarcodeView';
import { DailyCashRegisterView } from './components/cashRegister/DailyCashRegisterView';
import { PurchaseManagementView } from './components/purchases/PurchaseManagementView';
import { HrmView } from './components/hrm/HrmView';
import { InventoryView } from './components/inventory/InventoryView';
import { ReportsView } from './components/reports/ReportsView';
import { PartiesView } from './components/parties/PartiesView';
import { ShopifyView } from './components/shopify/ShopifyView';
import { AccessManagementView } from './components/admin/AccessManagementView';
import { AiAssistantView } from './components/ai/AiAssistantView';
import { AppSettingsView } from './components/settings/AppSettingsView';
import { ThemeSettingsProvider } from './context/ThemeSettingsContext';
import { GlobalKeyboardShortcuts } from './components/common/GlobalKeyboardShortcuts';
import { Toaster } from 'sonner';
import { Minimize2, Plus } from 'lucide-react';
import { getIsFullscreen, enterNativeFullscreen, exitNativeFullscreen } from './lib/utils';

const AppContent: React.FC = () => {
  const { currentView, navigateToTab } = useErp();
  // Sales & Quotations share one always-mounted billing view (keeps open tabs alive).
  const isBilling = currentView === 'invoices' || currentView === 'estimates';
  // Mobile off-canvas nav drawer
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Desktop sidebar collapsed state (persisted in localStorage)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('majestronicz_sidebar_collapsed');
      return saved === 'true';
    } catch {
      return false;
    }
  });

  const handleToggleNav = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setMobileNavOpen((prev) => !prev);
    } else {
      setIsSidebarCollapsed((prev) => {
        const next = !prev;
        try {
          localStorage.setItem('majestronicz_sidebar_collapsed', String(next));
        } catch {}
        return next;
      });
    }
  };

  const handleCollapseSidebar = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setMobileNavOpen(false);
    } else {
      setIsSidebarCollapsed(true);
      try {
        localStorage.setItem('majestronicz_sidebar_collapsed', 'true');
      } catch {}
    }
  };

  // Support custom event for toggling sidebar from shortcuts (Ctrl+B)
  useEffect(() => {
    const handleToggleEvent = () => {
      handleToggleNav();
    };
    window.addEventListener('majestronicz:toggle-sidebar', handleToggleEvent);
    return () => window.removeEventListener('majestronicz:toggle-sidebar', handleToggleEvent);
  }, []);

  // Automatically collapse sidebar navigation by default when Add Sale / Billing screen is opened
  useEffect(() => {
    const handleCollapseEvent = () => {
      setIsSidebarCollapsed(true);
      setMobileNavOpen(false);
    };
    window.addEventListener('majestronicz:collapse-sidebar', handleCollapseEvent);
    return () => window.removeEventListener('majestronicz:collapse-sidebar', handleCollapseEvent);
  }, []);

  const handleOpenAddSale = () => {
    setIsSidebarCollapsed(true);
    setMobileNavOpen(false);
    navigateToTab('invoices', 'new');
  };

  // Track native fullscreen status
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => getIsFullscreen());

  // Track whether user explicitly opted out / exited fullscreen during this active session.
  // Resets on page refresh, allowing the app to automatically open in full screen every time!
  const userOptedOutFullscreenRef = useRef<boolean>(false);

  useEffect(() => {
    const handleFsChange = () => {
      const active = getIsFullscreen();
      setIsFullscreen(active);
      // If user exited natively (e.g. Esc key or browser UI), record that they chose to exit
      if (!active) {
        userOptedOutFullscreenRef.current = true;
      }
    };
    const events = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];
    events.forEach((ev) => document.addEventListener(ev, handleFsChange));
    return () => events.forEach((ev) => document.removeEventListener(ev, handleFsChange));
  }, []);

  const handleToggleFullscreen = async () => {
    if (isFullscreen || getIsFullscreen()) {
      userOptedOutFullscreenRef.current = true;
      await exitNativeFullscreen();
      setIsFullscreen(false);
    } else {
      userOptedOutFullscreenRef.current = false;
      const ok = await enterNativeFullscreen();
      if (ok) {
        setIsFullscreen(true);
      }
    }
  };

  const handleExitFullscreen = async () => {
    userOptedOutFullscreenRef.current = true;
    await exitNativeFullscreen();
    setIsFullscreen(false);
  };

  const handleCloseNav = () => {
    setMobileNavOpen(false);
  };

  // Support F11 keyboard shortcut to toggle full screen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault();
        handleToggleFullscreen();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  // Close the drawer whenever the active view changes (e.g. tapping a nav item).
  useEffect(() => {
    setMobileNavOpen(false);
  }, [currentView]);

  // Live clock for ERP status bar
  const [currentTime, setCurrentTime] = useState<Date>(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Attempt fullscreen on initial load if permitted (e.g. installed PWA/standalone), otherwise user-controlled
  useEffect(() => {
    enterNativeFullscreen().catch(() => {});
  }, []);

  return (
    <div className="flex h-screen h-[100dvh] w-full max-w-full overflow-hidden bg-slate-50 text-slate-900 font-sans">
      {/* Left Navigation Shell */}
      <Sidebar
        isOpen={!isSidebarCollapsed}
        isCollapsed={isSidebarCollapsed}
        onClose={handleCloseNav}
        onToggleCollapse={handleCollapseSidebar}
        mobileOpen={mobileNavOpen}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-50">
        {/* Fullscreen top safety bar with live temporal clock & exit action */}
        {isFullscreen && (
          <div className="bg-slate-900 text-slate-200 px-3.5 py-1.5 flex items-center justify-between text-xs shrink-0 select-none border-b border-slate-800 z-50 shadow-sm">
            <div className="flex items-center gap-2.5 font-mono text-[11px] min-w-0">
              <span className="flex items-center gap-1.5 text-emerald-400 font-bold uppercase tracking-wider shrink-0">
                <span className="h-2 w-2 rounded-none bg-emerald-500 animate-pulse" />
                LIVE
              </span>
              <span className="text-slate-600">|</span>
              <span className="text-slate-200 font-bold truncate">
                {currentTime.toLocaleDateString('en-IN', { weekday: 'long' })},{' '}
                {currentTime.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              </span>
              <span className="text-slate-600">|</span>
              <span className="text-amber-400 font-mono font-bold tracking-wider shrink-0">
                {currentTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
              </span>
            </div>
            <button
              type="button"
              onClick={handleExitFullscreen}
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-red-600 hover:bg-red-700 text-white font-mono text-[11px] font-bold rounded-none transition-colors cursor-pointer shrink-0 ml-2"
              title="Exit Full Screen (Esc)"
            >
              <Minimize2 className="h-3 w-3" />
              <span>Exit Full Screen (Esc)</span>
            </button>
          </div>
        )}

        {/* Global Top Bar with Location Scope Switcher & Full Screen button */}
        <TopBar
          navOpen={!isSidebarCollapsed}
          onOpenNav={handleToggleNav}
          onToggleNav={handleToggleNav}
          isNavCollapsed={isSidebarCollapsed}
          isFullscreen={isFullscreen}
          onToggleFullscreen={handleToggleFullscreen}
        />

        {/* Quick Action: + Add Sale (anchored below notification icon without taking any block-level height/width) */}
        <div className="relative z-30 w-full h-0 pointer-events-none select-none">
          <div className="absolute top-1.5 right-3 sm:right-4 pointer-events-auto">
            <button
              type="button"
              onClick={handleOpenAddSale}
              title="Create New Sale Invoice (Alt+S)"
              className="inline-flex items-center gap-1.5 h-8 px-3.5 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-extrabold text-xs uppercase tracking-wider border border-red-700 shadow-md transition-colors cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5 stroke-[3]" />
              <span>+ Add Sale</span>
            </button>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-slate-50/50">
          {/* Billing (Sales / Quotations) stays MOUNTED even when you switch to
              another section, so any open bill tabs and their in-progress work are
              still there when you come back. It is just hidden while off-screen. */}
          <div className={isBilling ? undefined : 'hidden'}>
            <InvoiceView initialTab={currentView === 'estimates' ? 'estimates' : 'ledger'} />
          </div>

          {!isBilling && (
            currentView === 'dashboard' ? (
              <DashboardView />
            ) : currentView === 'parties' ? (
              <PartiesView />
            ) : currentView === 'inventory' ? (
              <InventoryView />
            ) : currentView === 'enquiries' ? (
              <EnquiryView />
            ) : currentView === 'pending-orders' ? (
              <PendingOrdersView />
            ) : currentView === 'challans' ? (
              <DeliveryChallanView />
            ) : currentView === 'barcodes' ? (
              <BarcodeView />
            ) : currentView === 'cash-register' ? (
              <DailyCashRegisterView />
            ) : currentView === 'purchases' ? (
              <PurchaseManagementView />
            ) : currentView === 'hrm' ? (
              <HrmView />
            ) : currentView === 'reports' ? (
              <ReportsView />
            ) : currentView === 'shopify' ? (
              <ShopifyView />
            ) : currentView === 'ai-assistant' ? (
              <AiAssistantView />
            ) : currentView === 'access' ? (
              <AccessManagementView />
            ) : currentView === 'settings' ? (
              <AppSettingsView />
            ) : (
              <ItemMasterView />
            )
          )}
        </main>
      </div>

      {/* App-wide keyboard navigation (press ? for help) */}
      <GlobalKeyboardShortcuts />

      {/* Sonner Toast Notifications */}
      <Toaster
        position="bottom-right"
        theme="light"
        toastOptions={{
          style: {
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            color: '#0f172a',
            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
          },
        }}
      />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ErpProvider>
      <ThemeSettingsProvider>
        <AppContent />
      </ThemeSettingsProvider>
    </ErpProvider>
  );
};

export default App;
