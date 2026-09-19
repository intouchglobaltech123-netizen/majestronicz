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
import { CustomersView } from './components/customers/CustomersView';
import { PartiesView } from './components/parties/PartiesView';
import { ShopifyView } from './components/shopify/ShopifyView';
import { AccessManagementView } from './components/admin/AccessManagementView';
import { AiAssistantView } from './components/ai/AiAssistantView';
import { GlobalKeyboardShortcuts } from './components/common/GlobalKeyboardShortcuts';
import { Toaster } from 'sonner';
import { Minimize2 } from 'lucide-react';
import { getIsFullscreen, enterNativeFullscreen, exitNativeFullscreen } from './lib/utils';

const AppContent: React.FC = () => {
  const { currentView } = useErp();
  // Mobile off-canvas nav drawer
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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

  // Attempt to enter native full screen automatically when opening the site
  useEffect(() => {
    enterNativeFullscreen().catch(() => {});
  }, []);

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
          navOpen={true}
          onOpenNav={() => setMobileNavOpen(true)}
          isFullscreen={isFullscreen}
          onToggleFullscreen={handleToggleFullscreen}
        />

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
