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
import { Maximize2, Minimize2, X } from 'lucide-react';
import { getIsFullscreen, enterNativeFullscreen, exitNativeFullscreen } from './lib/utils';

const AppContent: React.FC = () => {
  const { currentView } = useErp();
  // Mobile off-canvas nav drawer
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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

  const handleToggleFullscreen = async () => {
    if (isFullscreen || getIsFullscreen()) {
      await exitNativeFullscreen();
      setIsFullscreen(false);
    } else {
      const ok = await enterNativeFullscreen();
      if (ok) {
        setIsFullscreen(true);
        setShowFsRecommend(false);
      }
    }
  };

  const handleEnterFullscreen = async () => {
    const ok = await enterNativeFullscreen();
    if (ok) {
      setIsFullscreen(true);
      setShowFsRecommend(false);
    }
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

  return (
    <div className="flex h-screen h-[100dvh] w-full max-w-full overflow-hidden bg-slate-50 text-slate-900 font-sans">
      {/* Left Navigation Shell (permanently open on desktop) */}
      <Sidebar
        isOpen={true}
        onClose={handleCloseNav}
        mobileOpen={mobileNavOpen}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-50">
        {/* Fullscreen top safety bar (protects buttons from macOS menu bar / notch click interception) */}
        {isFullscreen && (
          <div className="bg-slate-900 text-slate-200 px-4 py-1.5 flex items-center justify-between text-xs shrink-0 select-none border-b border-slate-800 z-50">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-none bg-emerald-500 animate-pulse" />
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-slate-300">
                Full Screen Workspace
              </span>
            </div>
            <button
              type="button"
              onClick={handleToggleFullscreen}
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-red-600 hover:bg-red-700 text-white font-mono text-[11px] font-bold rounded-none transition-colors cursor-pointer"
            >
              <Minimize2 className="h-3 w-3" />
              <span>Exit Full Screen (Esc)</span>
            </button>
          </div>
        )}

        {/* Global Top Bar with Location Scope Switcher */}
        <TopBar
          navOpen={true}
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
