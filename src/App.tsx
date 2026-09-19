import React, { useState, useEffect } from 'react';
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
import { CustomersView } from './components/customers/CustomersView';
import { PartiesView } from './components/parties/PartiesView';
import { ShopifyView } from './components/shopify/ShopifyView';
import { AccessManagementView } from './components/admin/AccessManagementView';
import { AiAssistantView } from './components/ai/AiAssistantView';
import { GlobalKeyboardShortcuts } from './components/common/GlobalKeyboardShortcuts';
import { Toaster } from 'sonner';
import { Maximize2, X } from 'lucide-react';
import { getIsFullscreen, enterNativeFullscreen, exitNativeFullscreen } from './lib/utils';

const NAV_STORAGE_KEY = 'majestronicz_sidebar_open';

const AppContent: React.FC = () => {
  const { currentView } = useErp();
  // Mobile off-canvas nav drawer
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Desktop sidebar persistent open/closed state (stored in localStorage)
  const [desktopNavOpen, setDesktopNavOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(NAV_STORAGE_KEY);
      if (saved !== null) {
        return saved === 'true';
      }
      return typeof window !== 'undefined' ? window.innerWidth >= 1024 : true;
    } catch {
      return true;
    }
  });

  // Track native fullscreen status (with Mac Safari WebKit support)
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => getIsFullscreen());

  // Recommend fullscreen banner on each open if not already in fullscreen
  const [showFsRecommend, setShowFsRecommend] = useState<boolean>(() => !getIsFullscreen());

  useEffect(() => {
    const handleFsChange = () => {
      const active = getIsFullscreen();
      setIsFullscreen(active);
      if (active) {
        setShowFsRecommend(false);
      }
    };
    const events = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange', 'resize'];
    events.forEach((ev) => document.addEventListener(ev, handleFsChange));
    return () => events.forEach((ev) => document.removeEventListener(ev, handleFsChange));
  }, []);

  const handleToggleDesktopNav = () => {
    setDesktopNavOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(NAV_STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  };

  const handleCloseDesktopNav = () => {
    setDesktopNavOpen(false);
    try {
      localStorage.setItem(NAV_STORAGE_KEY, 'false');
    } catch {}
  };

  const handleUniversalToggleNav = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setMobileNavOpen((prev) => !prev);
    } else {
      handleToggleDesktopNav();
    }
  };

  const handleToggleFullscreen = () => {
    if (getIsFullscreen()) {
      exitNativeFullscreen();
    } else {
      enterNativeFullscreen();
    }
  };

  const handleEnterFullscreen = () => {
    enterNativeFullscreen().then((ok) => {
      if (ok) setShowFsRecommend(false);
    });
  };

  // Close the drawer whenever the active view changes (e.g. tapping a nav item).
  useEffect(() => {
    setMobileNavOpen(false);
  }, [currentView]);

  return (
    <div className="flex h-screen h-[100dvh] w-screen overflow-hidden bg-slate-50 text-slate-900 font-sans">
      {/* Left Navigation Shell */}
      <Sidebar
        isOpen={desktopNavOpen}
        onClose={handleCloseDesktopNav}
        onToggle={handleToggleDesktopNav}
        mobileOpen={mobileNavOpen}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-50">
        {/* Global Top Bar with Location Scope Switcher */}
        <TopBar
          navOpen={desktopNavOpen}
          onToggleNav={handleUniversalToggleNav}
          onOpenNav={() => setMobileNavOpen(true)}
          isFullscreen={isFullscreen}
          onToggleFullscreen={handleToggleFullscreen}
        />

        {/* Fullscreen Recommendation Banner (shown on open if not fullscreen) */}
        {showFsRecommend && !isFullscreen && (
          <div className="bg-gradient-to-r from-red-800 via-red-700 to-red-900 text-white px-3 sm:px-4 py-2 flex items-center justify-between gap-3 text-xs shadow-inner shrink-0 transition-all">
            <div className="flex items-center gap-2 min-w-0">
              <span className="px-1.5 py-0.5 bg-white/20 text-white font-mono text-[10px] font-bold uppercase tracking-wider shrink-0">
                Recommended
              </span>
              <span className="truncate text-red-50 text-xs">
                Run in <strong>Full Screen mode</strong> for optimal accounting workspace, billing speed, and keyboard shortcuts.
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleEnterFullscreen}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white text-red-800 hover:bg-red-50 font-bold font-mono text-[11px] rounded-none shadow-sm transition-colors cursor-pointer uppercase"
              >
                <Maximize2 className="h-3 w-3" />
                <span>Enter Full Screen</span>
              </button>
              <button
                type="button"
                onClick={() => setShowFsRecommend(false)}
                title="Dismiss recommendation"
                aria-label="Dismiss recommendation"
                className="p-1 text-red-200 hover:text-white hover:bg-white/10 rounded-none transition-colors cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Scrollable Content Body */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-slate-50/50">
          {currentView === 'dashboard' ? (
            <DashboardView />
          ) : currentView === 'customers' ? (
            <CustomersView />
          ) : currentView === 'parties' ? (
            <PartiesView />
          ) : currentView === 'inventory' ? (
            <InventoryView />
          ) : currentView === 'enquiries' ? (
            <EnquiryView />
          ) : currentView === 'pending-orders' ? (
            <PendingOrdersView />
          ) : currentView === 'estimates' ? (
            <InvoiceView initialTab="estimates" />
          ) : currentView === 'challans' ? (
            <DeliveryChallanView />
          ) : currentView === 'invoices' ? (
            <InvoiceView />
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
          ) : (
            <ItemMasterView />
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
      <AppContent />
    </ErpProvider>
  );
};

export default App;
