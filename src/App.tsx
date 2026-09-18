import React, { useState, useEffect } from 'react';
import { ErpProvider, useErp, WorkspaceTab } from './context/ErpContext';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { WorkspaceTabBar } from './components/layout/WorkspaceTabBar';
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
import { cn } from './lib/utils';

/**
 * Renders the underlying component corresponding to a workspace tab.
 */
const renderTabContent = (tab: WorkspaceTab) => {
  switch (tab.view) {
    case 'dashboard':
      return <DashboardView />;
    case 'customers':
      return <CustomersView />;
    case 'parties':
      return <PartiesView />;
    case 'inventory':
      return <InventoryView />;
    case 'enquiries':
      return <EnquiryView />;
    case 'pending-orders':
      return <PendingOrdersView />;
    case 'estimates':
      return <InvoiceView initialTab="estimates" />;
    case 'challans':
      return <DeliveryChallanView />;
    case 'invoices':
      return <InvoiceView initialTab={(tab.subTab as any) || 'ledger'} />;
    case 'barcodes':
      return <BarcodeView />;
    case 'cash-register':
      return <DailyCashRegisterView />;
    case 'purchases':
      return <PurchaseManagementView />;
    case 'hrm':
      return <HrmView />;
    case 'reports':
      return <ReportsView />;
    case 'shopify':
      return <ShopifyView />;
    case 'ai-assistant':
      return <AiAssistantView />;
    case 'access':
      return <AccessManagementView />;
    case 'items':
    default:
      return <ItemMasterView />;
  }
};

const AppContent: React.FC = () => {
  const { currentView, tabs, activeTabId } = useErp();
  // Mobile off-canvas nav drawer. On desktop (lg+) the sidebar is always in-flow.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Close the drawer whenever the active view changes (e.g. tapping a nav item).
  useEffect(() => {
    setMobileNavOpen(false);
  }, [currentView]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 text-slate-900 font-sans">
      {/* Left Navigation Shell (off-canvas drawer on mobile) */}
      <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-50">
        {/* Global Top Bar with Location Scope Switcher */}
        <TopBar onOpenNav={() => setMobileNavOpen(true)} />

        {/* Chrome-Style Workspace Tab Bar */}
        <WorkspaceTabBar />

        {/* Multi-Tab Workspace Body: Inactive tabs stay mounted (display: none) preserving 100% of user state */}
        <main className="relative flex-1 min-h-0 overflow-hidden bg-slate-50/50">
          {tabs.length === 0 ? (
            <div className="h-full w-full overflow-y-auto overflow-x-hidden">
              <DashboardView />
            </div>
          ) : (
            tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  id={`tab-panel-${tab.id}`}
                  role="tabpanel"
                  aria-hidden={!isActive}
                  className={cn(
                    'h-full w-full overflow-y-auto overflow-x-hidden',
                    isActive ? 'block' : 'hidden'
                  )}
                >
                  {renderTabContent(tab)}
                </div>
              );
            })
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
