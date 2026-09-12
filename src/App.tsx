import React from 'react';
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
import { PinAuthModal } from './components/auth/PinAuthModal';
import { Toaster } from 'sonner';
import { ShieldAlert } from 'lucide-react';

const AppContent: React.FC = () => {
  const { currentView, currentUser, setCurrentView } = useErp();
  const isSalesRestrictedView = currentUser.role === 'Sales' && currentView !== 'items' && currentView !== 'enquiries';

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 text-slate-900 font-sans">
      {/* Left Navigation Shell */}
      <Sidebar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-50">
        {/* Global Top Bar with Location Scope Switcher */}
        <TopBar />

        {/* Scrollable Content Body */}
        <main className="flex-1 overflow-y-auto bg-slate-50/50">
          {isSalesRestrictedView ? (
            <div className="flex flex-col items-center justify-center min-h-[70vh] p-6 text-center">
              <div className="h-16 w-16 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mb-4 shadow-2xs">
                <ShieldAlert className="h-8 w-8" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-1">Access Restricted</h2>
              <p className="text-sm text-slate-500 max-w-md mb-6">
                Your role (<span className="font-semibold text-emerald-700">Sales</span>) is restricted to <strong>Items Master</strong> and <strong>Enquiries</strong> only. Direct route access to this module is blocked.
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setCurrentView('enquiries')}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
                >
                  Go to Enquiries
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentView('items')}
                  className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
                >
                  Go to Items Master
                </button>
              </div>
            </div>
          ) : currentView === 'dashboard' ? (
            <DashboardView />
          ) : currentView === 'customers' ? (
            <CustomersView />
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
          ) : (
            <ItemMasterView />
          )}
        </main>
      </div>

      {/* Role Authentication PIN Keypad Modal */}
      <PinAuthModal />

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
