import React, { useState, useMemo, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import { PendingOrderStatus } from '../../types';
import { PendingOrderList } from './PendingOrderList';
import {
  Search,
  Filter,
  PackageCheck,
  AlertCircle,
  CheckCircle2,
  XCircle,
  X,
  Building,
} from 'lucide-react';

export const PendingOrdersView: React.FC = () => {
  const {
    pendingOrders,
    currentBranch,
    isAllBranches,
    currentBranchData,
    convertEnquiryToSale,
    pendingOrderFilterQuery,
    setPendingOrderFilterQuery,
    activeSubTab,
  } = useErp();

  // Search query & status filter
  const [searchQuery, setSearchQuery] = useState(pendingOrderFilterQuery || '');
  const [statusFilter, setStatusFilter] = useState<'ALL' | PendingOrderStatus>('ALL');

  // Synchronize status filter when triggered from secondary navbar flyout
  useEffect(() => {
    if (activeSubTab?.view === 'pending-orders') {
      const tab = activeSubTab.tab;
      if (tab === 'ALL' || tab === 'Draft' || tab === 'Confirmed' || tab === 'Dispatched') {
        setStatusFilter(tab as any);
      }
    }
  }, [activeSubTab]);

  // Sync when navigating from another module via navigateToPendingOrder
  useEffect(() => {
    if (pendingOrderFilterQuery) {
      setSearchQuery(pendingOrderFilterQuery);
    }
  }, [pendingOrderFilterQuery]);

  // Branch-scoped orders
  const branchScopedOrders = useMemo(() => {
    return pendingOrders.filter((po) => isAllBranches || po.branchId === currentBranch);
  }, [pendingOrders, isAllBranches, currentBranch]);

  // Filtered orders for table display
  const filteredOrders = useMemo(() => {
    return branchScopedOrders.filter((po) => {
      const matchesStatus = statusFilter === 'ALL' || po.status === statusFilter;
      const q = searchQuery.toLowerCase().trim();
      if (!q) return matchesStatus;

      const matchesSearch =
        po.orderNumber.toLowerCase().includes(q) ||
        po.enquiryNumber.toLowerCase().includes(q) ||
        po.customerName.toLowerCase().includes(q) ||
        po.itemName.toLowerCase().includes(q) ||
        (po.customerPhone && po.customerPhone.includes(q));

      return matchesStatus && matchesSearch;
    });
  }, [branchScopedOrders, statusFilter, searchQuery]);

  // Summary counts
  const waitingCount = useMemo(
    () => branchScopedOrders.filter((po) => po.status === 'Waiting').length,
    [branchScopedOrders]
  );
  const stockArrivedCount = useMemo(
    () => branchScopedOrders.filter((po) => po.status === 'Stock Arrived').length,
    [branchScopedOrders]
  );
  const fulfilledCount = useMemo(
    () => branchScopedOrders.filter((po) => po.status === 'Fulfilled').length,
    [branchScopedOrders]
  );
  const cancelledCount = useMemo(
    () => branchScopedOrders.filter((po) => po.status === 'Cancelled').length,
    [branchScopedOrders]
  );

  const handleClearFilter = () => {
    setSearchQuery('');
    setPendingOrderFilterQuery('');
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 w-full">
      {/* Top Banner & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
              Pending Orders
            </h1>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-none bg-slate-100 text-slate-800 border border-slate-300 uppercase tracking-wider">
              {branchScopedOrders.length} Total
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Customer orders awaiting stock replenishment, restock scheduling, and 1-click fulfillment.
          </p>
        </div>

        {/* Branch Scope Badge */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-none bg-white border border-slate-300 text-xs font-semibold text-slate-700 shadow-none">
            <Building className="h-3.5 w-3.5 text-slate-400" />
            <span>Scope: {isAllBranches ? 'All Branches' : currentBranchData?.name}</span>
          </div>
        </div>
      </div>

      {/* KPI Summary Cards — clean white tiles; a coloured ring marks the active filter */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {([
          { key: 'ALL', label: 'All Orders', sub: 'Total backlog', count: branchScopedOrders.length, num: 'text-slate-900', icon: null, ring: 'border-slate-400 ring-2 ring-slate-300', iconTone: '' },
          { key: 'Waiting', label: 'Awaiting Stock', sub: 'Pending restock', count: waitingCount, num: 'text-amber-700', icon: AlertCircle, ring: 'border-amber-400 ring-2 ring-amber-200', iconTone: 'text-amber-600' },
          { key: 'Stock Arrived', label: 'Stock Arrived', sub: 'Ready to fulfill', count: stockArrivedCount, num: 'text-emerald-700', icon: PackageCheck, ring: 'border-emerald-400 ring-2 ring-emerald-200', iconTone: 'text-emerald-600' },
          { key: 'Fulfilled', label: 'Fulfilled', sub: 'Converted to sale', count: fulfilledCount, num: 'text-blue-700', icon: CheckCircle2, ring: 'border-blue-400 ring-2 ring-blue-200', iconTone: 'text-blue-600' },
          { key: 'Cancelled', label: 'Cancelled', sub: 'Lost / Dropped', count: cancelledCount, num: 'text-rose-700', icon: XCircle, ring: 'border-rose-400 ring-2 ring-rose-200', iconTone: 'text-rose-600' },
        ] as const).map((c) => {
          const active = statusFilter === c.key;
          const Icon = c.icon;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setStatusFilter(c.key as typeof statusFilter)}
              className={`p-3.5 rounded-lg border bg-white text-left transition-all cursor-pointer shadow-2xs ${active ? c.ring : 'border-slate-200 hover:border-slate-300'}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{c.label}</span>
                {Icon && <Icon className={`h-3.5 w-3.5 ${c.iconTone}`} />}
              </div>
              <div className={`text-2xl font-bold font-mono mt-0.5 ${c.num}`}>{c.count}</div>
              <span className="text-[11px] text-slate-400">{c.sub}</span>
            </button>
          );
        })}
      </div>

      {/* Search & Status Filter Bar */}
      <div className="bg-white p-3.5 rounded-none border border-slate-300 shadow-none flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Search */}
        <div className="relative w-full md:w-96">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by order #, enquiry #, customer, item..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (pendingOrderFilterQuery && e.target.value !== pendingOrderFilterQuery) {
                setPendingOrderFilterQuery('');
              }
            }}
            className="w-full pl-9 pr-8 py-2 bg-white border border-slate-300 rounded-none text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={handleClearFilter}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-none text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 w-full md:w-auto justify-end">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1 mr-1">
            <Filter className="h-3 w-3" /> Filter:
          </span>
          {(['ALL', 'Waiting', 'Stock Arrived', 'Fulfilled', 'Cancelled'] as const).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`px-2.5 py-1 rounded-none text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                statusFilter === status
                  ? 'bg-red-600 text-white border border-red-700 shadow-none'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-300'
              }`}
            >
              {status === 'ALL' ? 'All' : status}
            </button>
          ))}
        </div>
      </div>

      {/* Active Filter Pill */}
      {searchQuery && (
        <div className="flex items-center gap-2 text-xs text-slate-800 bg-slate-100 px-3 py-1.5 rounded-none border border-slate-300 w-fit">
          <span>Filtering by: <strong>"{searchQuery}"</strong></span>
          <button
            type="button"
            onClick={handleClearFilter}
            className="text-slate-600 hover:text-slate-900 font-bold ml-1 hover:underline flex items-center gap-0.5 cursor-pointer"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        </div>
      )}

      {/* Main Pending Orders List */}
      <PendingOrderList
        pendingOrders={filteredOrders}
        onConvert={convertEnquiryToSale}
      />
    </div>
  );
};
