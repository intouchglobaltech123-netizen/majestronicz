import React, { useState, useEffect } from 'react';
import {
  ShoppingBag,
  Building2,
  Plus,
  AlertTriangle,
  PackageCheck,
  Wallet,
  IndianRupee,
  HandCoins,
} from 'lucide-react';
import { useErp } from '../../context/ErpContext';
import { Vendor } from '../../types';
import { PurchaseOrderList } from './PurchaseOrderList';
import { PurchaseOrderFormModal } from './PurchaseOrderFormModal';
import { VendorMasterModal } from './VendorMasterModal';
import { VendorCreditModal, vendorCreditOnPo } from './VendorCreditModal';
import { formatCurrency, getTodayDateString } from '../../lib/utils';

export const PurchaseManagementView: React.FC = () => {
  const { purchaseOrders, vendors, canManagePurchases, activeSubTab } = useErp();

  const [isPoFormOpen, setIsPoFormOpen] = useState(false);
  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
  const [isVendorCreditOpen, setIsVendorCreditOpen] = useState(false);
  const [selectedVendorForPo, setSelectedVendorForPo] = useState<Vendor | null>(null);

  // Synchronize actions when triggered from secondary navbar flyout.
  // The supplier directory now lives in Parties → Suppliers, so 'vendors' here
  // just opens Parties; PO actions are handled below.
  useEffect(() => {
    if (activeSubTab?.view === 'purchases') {
      const tab = activeSubTab.tab;
      if (tab === 'issue-po') {
        setSelectedVendorForPo(null);
        setIsPoFormOpen(true);
      } else if (tab === 'add-vendor') {
        setIsVendorModalOpen(true);
      }
    }
  }, [activeSubTab]);

  const todayStr = getTodayDateString();

  // KPI Calculations
  const activeOrders = purchaseOrders.filter(
    (p) => p.status === 'Ordered' || p.status === 'Partially Received'
  );
  const activeOrdersValue = activeOrders.reduce((sum, p) => sum + p.totalAmount, 0);

  const overdueOrders = activeOrders.filter((p) => p.expectedDeliveryDate < todayStr);

  const pendingUnitsInward = activeOrders.reduce((sum, p) => {
    const totalOrdered = p.items.reduce((s, it) => s + it.quantityOrdered, 0);
    const totalReceived = p.items.reduce((s, it) => s + (it.receivedQuantity || 0), 0);
    return sum + Math.max(0, totalOrdered - totalReceived);
  }, 0);

  // Money owed to suppliers, and this month's purchase spend.
  // Remaining owed on a PO = total − paid − debit notes billed back to the vendor.
  const poRemaining = (p: (typeof purchaseOrders)[number]): number => {
    const debit = (p.debitNotes || []).reduce((s, dn) => s + (dn.totalAmount || 0), 0);
    return Math.max(0, (p.totalAmount || 0) - (p.amountPaid || 0) - debit);
  };
  const duePos = purchaseOrders.filter((p) => p.status !== 'Cancelled' && poRemaining(p) > 0.5);
  const totalPayable = duePos.reduce((sum, p) => sum + poRemaining(p), 0);

  // Vendor credit = amount the shop advance-paid for units that arrived damaged
  // (billed back to the vendor), i.e. paid beyond the value of goods kept. The
  // vendor owes this back.
  const creditPos = purchaseOrders.filter((p) => p.status !== 'Cancelled' && vendorCreditOnPo(p) > 0.5);
  const totalVendorCredit = creditPos.reduce((sum, p) => sum + vendorCreditOnPo(p), 0);
  const thisMonth = todayStr.slice(0, 7);
  const monthSpend = purchaseOrders
    .filter((p) => p.status !== 'Cancelled' && (p.date || '').startsWith(thisMonth))
    .reduce((sum, p) => sum + (p.totalAmount || 0), 0);

  const handleOpenGeneralPo = () => {
    setSelectedVendorForPo(null);
    setIsPoFormOpen(true);
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 w-full">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              Purchase Orders
            </h1>
            <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              Inward Supply
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Issue Purchase Orders to suppliers, inward physical inventory into warehouses, and manage suppliers.
          </p>
        </div>

        {/* Action CTAs */}
        {canManagePurchases && (
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setIsVendorModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-none shadow-none transition-colors cursor-pointer"
            >
              <Building2 className="h-4 w-4 text-slate-500" />
              <span>+ Add Supplier</span>
            </button>
            <button
              onClick={handleOpenGeneralPo}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-none border border-red-700 shadow-none transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Issue Purchase Order</span>
            </button>
          </div>
        )}
      </div>

      {/* KPI Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* To Pay (payables) */}
        <div className={`p-4 rounded-xl border shadow-2xs flex items-center gap-3.5 ${totalPayable > 0 ? 'bg-rose-50/50 border-rose-200' : 'bg-white border-slate-200'}`}>
          <div className="h-11 w-11 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-200/60">
            <Wallet className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">To Pay (Suppliers)</p>
            <p className="text-lg sm:text-2xl lg:text-3xl font-bold truncate font-mono mt-0.5 text-rose-700">{formatCurrency(totalPayable)}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {duePos.length > 0
                ? `Outstanding across ${duePos.length} PO${duePos.length === 1 ? '' : 's'} — see "Due Payment"`
                : 'Outstanding supplier dues'}
            </p>
          </div>
        </div>

        {/* Vendor Credit (money suppliers owe back from damaged advance-paid goods) */}
        <button
          type="button"
          onClick={() => setIsVendorCreditOpen(true)}
          title="View which suppliers owe credit and against which POs"
          className={`text-left p-4 rounded-xl border shadow-2xs flex items-center gap-3.5 transition-colors cursor-pointer ${totalVendorCredit > 0 ? 'bg-emerald-50/60 border-emerald-200 hover:bg-emerald-50' : 'bg-white border-slate-200 hover:bg-slate-50'}`}
        >
          <div className="h-11 w-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-200/60">
            <HandCoins className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Vendor Credit</p>
            <p className="text-lg sm:text-2xl lg:text-3xl font-bold truncate font-mono mt-0.5 text-emerald-700">{formatCurrency(totalVendorCredit)}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {creditPos.length > 0
                ? `Owed back across ${creditPos.length} PO${creditPos.length === 1 ? '' : 's'} — tap for detail`
                : 'From damaged goods on advance-paid POs'}
            </p>
          </div>
        </button>

        {/* This month spend */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex items-center gap-3.5">
          <div className="h-11 w-11 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 border border-indigo-200/60">
            <IndianRupee className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Purchases This Month</p>
            <p className="text-lg sm:text-2xl lg:text-3xl font-bold text-slate-900 truncate font-mono mt-0.5">{formatCurrency(monthSpend)}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Ordered value this month</p>
          </div>
        </div>

        {/* Active POs */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex items-center gap-3.5">
          <div className="h-11 w-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-200/60">
            <ShoppingBag className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Open Purchase Orders
            </p>
            <p className="text-lg sm:text-2xl lg:text-3xl font-bold text-slate-900 truncate font-mono mt-0.5">
              {pendingUnitsInward.toLocaleString('en-IN')} <span className="text-sm font-bold text-slate-500">units</span>
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {activeOrders.length} active order{activeOrders.length === 1 ? '' : 's'} · {formatCurrency(activeOrdersValue)}
            </p>
          </div>
        </div>

        {/* Overdue Shipments */}
        <div className={`p-4 rounded-xl border shadow-2xs flex items-center gap-3.5 ${
          overdueOrders.length > 0
            ? 'bg-rose-50/60 border-rose-200'
            : 'bg-white border-slate-200'
        }`}>
          <div className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 border ${
            overdueOrders.length > 0
              ? 'bg-rose-100 text-rose-600 border-rose-300'
              : 'bg-slate-50 text-slate-500 border-slate-200'
          }`}>
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Overdue Shipments
            </p>
            <p className={`text-lg sm:text-2xl lg:text-3xl font-bold truncate font-mono mt-0.5 ${
              overdueOrders.length > 0 ? 'text-rose-700' : 'text-slate-900'
            }`}>
              {overdueOrders.length}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {overdueOrders.length > 0 ? 'Exceeded expected delivery' : 'All shipments on schedule'}
            </p>
          </div>
        </div>

        {/* Inward Units Pending */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex items-center gap-3.5">
          <div className="h-11 w-11 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 border border-amber-200/60">
            <PackageCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Units Inward Pending
            </p>
            <p className="text-lg sm:text-2xl lg:text-3xl font-bold text-slate-900 truncate font-mono mt-0.5">
              {pendingUnitsInward} units
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Awaiting physical delivery & check
            </p>
          </div>
        </div>

        {/* Registered Suppliers */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex items-center gap-3.5">
          <div className="h-11 w-11 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0 border border-purple-200/60">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Suppliers
            </p>
            <p className="text-lg sm:text-2xl lg:text-3xl font-bold text-slate-900 truncate font-mono mt-0.5">
              {vendors.length} Suppliers
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Approved procurement partners
            </p>
          </div>
        </div>
      </div>

      {/* Purchase orders list */}
      <PurchaseOrderList onCreateNewPo={handleOpenGeneralPo} />

      {/* Create Purchase Order Modal */}
      <PurchaseOrderFormModal
        isOpen={isPoFormOpen}
        onClose={() => setIsPoFormOpen(false)}
        preSelectedVendor={selectedVendorForPo}
      />

      {/* Vendor Credit detail */}
      <VendorCreditModal isOpen={isVendorCreditOpen} onClose={() => setIsVendorCreditOpen(false)} />

      {/* Vendor Master Modal */}
      <VendorMasterModal
        isOpen={isVendorModalOpen}
        onClose={() => setIsVendorModalOpen(false)}
      />
    </div>
  );
};
