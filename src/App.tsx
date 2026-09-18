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

const AppContent: React.FC = () => {
  const { currentView } = useErp();
  // Mobile off-canvas nav drawer. On desktop (lg+) the sidebar is always in-flow.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Close the drawer whenever the active view changes (e.g. tapping a nav item).
  useEffect(() => {
    setMobileNavOpen(false);
  }, [currentView]);

  return (
    <div className="flex h-screen h-[100dvh] w-screen overflow-hidden bg-slate-50 text-slate-900 font-sans">
      {/* Left Navigation Shell (off-canvas drawer on mobile) */}
      <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-50">
        {/* Global Top Bar with Location Scope Switcher */}
        <TopBar onOpenNav={() => setMobileNavOpen(true)} />

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
