import React, { useState, useMemo, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import { PendingOrderStatus } from '../../types';
import { PendingOrderList } from './PendingOrderList';
import {
  Clock,
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
  } = useErp();

  // Search query & status filter
  const [searchQuery, setSearchQuery] = useState(pendingOrderFilterQuery || '');
  const [statusFilter, setStatusFilter] = useState<'ALL' | PendingOrderStatus>('ALL');

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
    <div className="p-6 space-y-6 w-full">
      {/* Top Banner & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-700 shrink-0 shadow-2xs">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
                  Pending Orders
                </h1>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">
                  {branchScopedOrders.length} Total
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Customer orders awaiting stock replenishment, restock scheduling, and 1-click fulfillment.
              </p>
            </div>
          </div>
        </div>

        {/* Branch Scope Badge */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 shadow-2xs">
            <Building className="h-3.5 w-3.5 text-slate-400" />
            <span>Scope: {isAllBranches ? 'All Branches' : currentBranchData?.name}</span>
          </div>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <button
          type="button"
          onClick={() => setStatusFilter('ALL')}
          className={`p-3.5 rounded-xl border text-left transition-all ${
            statusFilter === 'ALL'
              ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
              : 'bg-white border-slate-200 hover:border-slate-300 text-slate-700'
          }`}
        >
          <span className={`text-[10px] font-bold uppercase tracking-wider block ${
            statusFilter === 'ALL' ? 'text-slate-300' : 'text-slate-500'
          }`}>
            All Orders
          </span>
          <div className="text-2xl font-black font-mono mt-0.5">{branchScopedOrders.length}</div>
          <span className={`text-[10px] ${statusFilter === 'ALL' ? 'text-slate-400' : 'text-slate-400'}`}>
            Total backlog
          </span>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('Waiting')}
          className={`p-3.5 rounded-xl border text-left transition-all ${
            statusFilter === 'Waiting'
              ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
              : 'bg-amber-50/60 border-amber-200/80 hover:border-amber-300 text-amber-900'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-[10px] font-bold uppercase tracking-wider block ${
              statusFilter === 'Waiting' ? 'text-amber-100' : 'text-amber-800'
            }`}>
              Awaiting Stock
            </span>
            <AlertCircle className={`h-3.5 w-3.5 ${statusFilter === 'Waiting' ? 'text-white' : 'text-amber-600'}`} />
          </div>
          <div className="text-2xl font-black font-mono mt-0.5">{waitingCount}</div>
          <span className={`text-[10px] ${statusFilter === 'Waiting' ? 'text-amber-200' : 'text-amber-700'}`}>
            Pending restock
          </span>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('Stock Arrived')}
          className={`p-3.5 rounded-xl border text-left transition-all ${
            statusFilter === 'Stock Arrived'
              ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
              : 'bg-emerald-50/60 border-emerald-200/80 hover:border-emerald-300 text-emerald-900'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-[10px] font-bold uppercase tracking-wider block ${
              statusFilter === 'Stock Arrived' ? 'text-emerald-100' : 'text-emerald-800'
            }`}>
              Stock Arrived
            </span>
            <PackageCheck className={`h-3.5 w-3.5 ${statusFilter === 'Stock Arrived' ? 'text-white' : 'text-emerald-600'}`} />
          </div>
          <div className="text-2xl font-black font-mono mt-0.5">{stockArrivedCount}</div>
          <span className={`text-[10px] ${statusFilter === 'Stock Arrived' ? 'text-emerald-200' : 'text-emerald-700'}`}>
            Ready to fulfill
          </span>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('Fulfilled')}
          className={`p-3.5 rounded-xl border text-left transition-all ${
            statusFilter === 'Fulfilled'
              ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
              : 'bg-blue-50/60 border-blue-200/80 hover:border-blue-300 text-blue-900'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-[10px] font-bold uppercase tracking-wider block ${
              statusFilter === 'Fulfilled' ? 'text-blue-100' : 'text-blue-800'
            }`}>
              Fulfilled
            </span>
            <CheckCircle2 className={`h-3.5 w-3.5 ${statusFilter === 'Fulfilled' ? 'text-white' : 'text-blue-600'}`} />
          </div>
          <div className="text-2xl font-black font-mono mt-0.5">{fulfilledCount}</div>
          <span className={`text-[10px] ${statusFilter === 'Fulfilled' ? 'text-blue-200' : 'text-blue-700'}`}>
            Converted to sale
          </span>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('Cancelled')}
          className={`p-3.5 rounded-xl border text-left transition-all ${
            statusFilter === 'Cancelled'
              ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
              : 'bg-rose-50/60 border-rose-200/80 hover:border-rose-300 text-rose-900'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-[10px] font-bold uppercase tracking-wider block ${
              statusFilter === 'Cancelled' ? 'text-rose-100' : 'text-rose-800'
            }`}>
              Cancelled
            </span>
            <XCircle className={`h-3.5 w-3.5 ${statusFilter === 'Cancelled' ? 'text-white' : 'text-rose-600'}`} />
          </div>
          <div className="text-2xl font-black font-mono mt-0.5">{cancelledCount}</div>
          <span className={`text-[10px] ${statusFilter === 'Cancelled' ? 'text-rose-200' : 'text-rose-700'}`}>
            Lost / Dropped
          </span>
        </button>
      </div>

      {/* Search & Status Filter Bar */}
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
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
            className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-purple-600 transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={handleClearFilter}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-md text-slate-400 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 w-full md:w-auto justify-end">
          <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1 mr-1">
            <Filter className="h-3 w-3" /> Filter:
          </span>
          {(['ALL', 'Waiting', 'Stock Arrived', 'Fulfilled', 'Cancelled'] as const).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                statusFilter === status
                  ? 'bg-purple-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {status === 'ALL' ? 'All' : status}
            </button>
          ))}
        </div>
      </div>

      {/* Active Filter Pill */}
      {searchQuery && (
        <div className="flex items-center gap-2 text-xs text-purple-800 bg-purple-50 px-3 py-1.5 rounded-xl border border-purple-200 w-fit">
          <span>Filtering by: <strong>"{searchQuery}"</strong></span>
          <button
            type="button"
            onClick={handleClearFilter}
            className="text-purple-600 hover:text-purple-900 font-bold ml-1 hover:underline flex items-center gap-0.5"
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
