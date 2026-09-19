import React, { useState, useMemo, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import { Enquiry, EnquiryStatus } from '../../types';
import { cn } from '../../lib/utils';
import { EnquiryConversionReportWidget } from './EnquiryConversionReportWidget';
import { EnquiryFormModal } from './EnquiryFormModal';
import { EnquiryDetailModal } from './EnquiryDetailModal';
import { FollowUpReminderModal } from './FollowUpReminderModal';
import { CancelReasonModal } from './CancelReasonModal';
import {
  Boxes,
  Plus,
  Search,
  Clock,
  Building,
  User,
  CheckCircle2,
  XCircle,
  FileText,
  Receipt,
  Filter,
  X,
  PackagePlus,
} from 'lucide-react';
import { ItemImage } from '../common/ItemImage';
import { AddItemModal } from '../items/AddItemModal';

export const EnquiryView: React.FC = () => {
  const {
    enquiries,
    pendingOrders,
    currentBranch,
    isAllBranches,
    currentBranchData,
    canCancelEnquiry,
    canConvertEnquiry,
    canApproveCatalogRequests,
    currentUser,
    linkItemToEnquiry,
    cancelEnquiry,
    convertEnquiryToSale,
    getBranchStock,
    setCurrentView,
    enquiryFilterQuery,
    setEnquiryFilterQuery,
    selectedEnquiryForDetail,
    setSelectedEnquiryForDetail,
    addFollowUpReminder,
    enquiryActiveTab: activeTab,
    setEnquiryActiveTab: setActiveTab,
    activeSubTab,
  } = useErp();

  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [cancellingEnquiry, setCancellingEnquiry] = useState<Enquiry | null>(null);
  const [schedulingReminderEnquiry, setSchedulingReminderEnquiry] = useState<Enquiry | null>(null);

  // Synchronize view tab and actions when triggered from secondary navbar flyout
  useEffect(() => {
    if (activeSubTab?.view === 'enquiries') {
      const tab = activeSubTab.tab;
      if (tab === 'all' || tab === 'new-item-requests') {
        setActiveTab(tab);
      } else if (tab === 'new') {
        setIsNewModalOpen(true);
      }
    }
  }, [activeSubTab, setActiveTab]);

  // Add Item to Catalog Modal state
  const [catalogEnquiry, setCatalogEnquiry] = useState<Enquiry | null>(null);
  const [isAddCatalogModalOpen, setIsAddCatalogModalOpen] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState(enquiryFilterQuery || '');
  const [statusFilter, setStatusFilter] = useState<'ALL' | EnquiryStatus>('ALL');

  // Sync when navigating from another module via navigateToEnquiry
  useEffect(() => {
    if (enquiryFilterQuery) {
      setSearchQuery(enquiryFilterQuery);
    }
  }, [enquiryFilterQuery]);

  // Days open calculation
  const calculateDaysOpen = (createdAt: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const created = new Date(createdAt);
    created.setHours(0, 0, 0, 0);
    const diffMs = today.getTime() - created.getTime();
    return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  };

  // Unresolved New Item Requests (isNewItemRequest=true and not yet in catalog)
  const unresolvedNewItemRequests = useMemo(() => {
    return enquiries.filter((e) => e.isNewItemRequest && !e.itemId && e.status !== 'Cancelled');
  }, [enquiries]);

  // Filtered New Item Requests for Queue tab
  const filteredNewItemRequests = useMemo(() => {
    return unresolvedNewItemRequests.filter((enq) => {
      const matchesBranch = isAllBranches || enq.branchId === currentBranch;
      const q = searchQuery.toLowerCase().trim();
      if (!q) return matchesBranch;

      return (
        matchesBranch &&
        (enq.customerName.toLowerCase().includes(q) ||
          enq.itemName.toLowerCase().includes(q) ||
          enq.enquiryNumber.toLowerCase().includes(q) ||
          (enq.customerPhone && enq.customerPhone.includes(q)))
      );
    });
  }, [unresolvedNewItemRequests, isAllBranches, currentBranch, searchQuery]);

  // Filter enquiries
  const filteredEnquiries = useMemo(() => {
    return enquiries.filter((enq) => {
      const matchesBranch = isAllBranches || enq.branchId === currentBranch;
      const matchesStatus = statusFilter === 'ALL' || enq.status === statusFilter;
      const q = searchQuery.toLowerCase().trim();
      if (!q) return matchesBranch && matchesStatus;

      const matchesSearch =
        enq.customerName.toLowerCase().includes(q) ||
        enq.itemName.toLowerCase().includes(q) ||
        enq.enquiryNumber.toLowerCase().includes(q) ||
        (enq.customerPhone && enq.customerPhone.includes(q));

      return matchesBranch && matchesStatus && matchesSearch;
    });
  }, [enquiries, isAllBranches, currentBranch, statusFilter, searchQuery]);

  const handleClearFilter = () => {
    setSearchQuery('');
    setEnquiryFilterQuery('');
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 w-full">
      {/* Top Banner & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
              {activeTab === 'new-item-requests' ? 'New Item Catalog Requests' : 'Customer Enquiries'}
            </h1>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-none bg-red-50 text-red-700 border border-red-200">
              {activeTab === 'new-item-requests' ? `${unresolvedNewItemRequests.length} Pending` : `${enquiries.length} Total`}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {activeTab === 'new-item-requests'
              ? 'Customer requests for products not yet in the master catalog.'
              : 'Track buyer requirements, live branch stock, and order conversions.'}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">

          {currentUser.role !== 'Sales' && (
            <button
              type="button"
              onClick={() => setCurrentView('pending-orders')}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-none bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-xs font-bold uppercase tracking-wider transition-colors shadow-none cursor-pointer"
            >
              <Clock className="h-3.5 w-3.5 text-slate-700" />
              <span>Pending Orders ({pendingOrders.length})</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsNewModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-none bg-red-600 hover:bg-red-700 text-white text-xs font-bold uppercase tracking-wider transition-colors shadow-none border border-red-700 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New Enquiry</span>
          </button>
        </div>
      </div>

      {/* Segmented View Tabs — mobile only (desktop uses the secondary sidebar) */}
      <div className="lg:hidden flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
        <button
          type="button"
          onClick={() => setActiveTab('all')}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-none text-xs font-bold uppercase tracking-wider whitespace-nowrap transition-all cursor-pointer shrink-0 border',
            activeTab === 'all'
              ? 'bg-red-600 text-white border-red-700 shadow-none'
              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
          )}
        >
          <Boxes className="h-3.5 w-3.5" />
          <span>All Enquiries</span>
          <span className={cn(
            'px-1.5 py-0.2 rounded-none text-[10px] font-mono',
            activeTab === 'all' ? 'bg-red-800 text-white font-bold' : 'bg-slate-100 text-slate-700 border border-slate-200'
          )}>
            {enquiries.length}
          </span>
        </button>

        {canApproveCatalogRequests && (
          <button
            type="button"
            onClick={() => setActiveTab('new-item-requests')}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-none text-xs font-bold uppercase tracking-wider whitespace-nowrap transition-all cursor-pointer shrink-0 border',
              activeTab === 'new-item-requests'
                ? 'bg-slate-800 text-white border-slate-900 shadow-none'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            )}
          >
            <PackagePlus className="h-3.5 w-3.5" />
            <span>New Item Requests</span>
            {unresolvedNewItemRequests.length > 0 && (
              <span className={cn(
                'px-1.5 py-0.2 rounded-none text-[10px] font-bold font-mono',
                activeTab === 'new-item-requests' ? 'bg-slate-950 text-white' : 'bg-slate-200 text-slate-800'
              )}>
                {unresolvedNewItemRequests.length}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Reports Tie-In KPI Summary Card */}
      <EnquiryConversionReportWidget
        enquiries={enquiries}
        pendingOrders={pendingOrders}
      />

      {/* ENQUIRIES TABLE & FILTERS */}
      <div className="space-y-4">
        {/* Filters Bar */}
        <div className="bg-white border border-slate-300 rounded-none p-4 flex flex-col md:flex-row items-center justify-between gap-3 shadow-none">
          {/* Search Input */}
          <div className="relative flex-1 max-w-md w-full">
            <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search enquiry by customer, item, enquiry #, or phone..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (enquiryFilterQuery && e.target.value !== enquiryFilterQuery) {
                  setEnquiryFilterQuery('');
                }
              }}
              className="w-full pl-10 pr-8 py-2 rounded-none bg-white border border-slate-300 text-slate-900 placeholder-slate-400 text-xs focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 transition-colors"
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

          {/* Status Filter Tabs */}
          <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-none border border-slate-300 text-xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 px-2 flex items-center gap-1">
              <Filter className="h-3 w-3" />
              Status:
            </span>
            {(['ALL', 'Follow-up', 'Converted', 'Cancelled'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  'px-2.5 py-1 rounded-none font-bold text-[11px] uppercase tracking-wider transition-all cursor-pointer',
                  statusFilter === s
                    ? 'bg-red-600 text-white shadow-none'
                    : 'text-slate-700 hover:text-slate-900 hover:bg-slate-200'
                )}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Branch Scope */}
          <div className="flex items-center gap-2 text-xs text-slate-500 shrink-0">
            <Building className="h-4 w-4 text-slate-700" />
            <span>
              Scope: <strong>{isAllBranches ? 'All Branches' : currentBranchData?.name}</strong>
            </span>
          </div>
        </div>

        {/* Active Filter Indicator */}
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

      {/* TAB CONTENT: NEW ITEM REQUESTS QUEUE vs REGULAR ENQUIRIES */}
      {activeTab === 'new-item-requests' && canApproveCatalogRequests ? (
        /* ================= NEW ITEM REQUESTS QUEUE ================= */
        <div className="space-y-4">
          <div className="bg-slate-50 border border-slate-300 rounded-none p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-none bg-red-50 text-red-700 border border-red-200 flex items-center justify-center shrink-0">
                <PackagePlus className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  New Item Requests Queue (Manager / CEO Review)
                </h3>
                <p className="text-xs text-slate-600">
                  Customer enquiries for items not yet in the master catalog. Review specifications and add to catalog to trigger procurement.
                </p>
              </div>
            </div>
            <div className="text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-none bg-slate-200 text-slate-800 self-start sm:self-center border border-slate-300">
              {filteredNewItemRequests.length} Pending Review
            </div>
          </div>

          <div className="bg-white border border-slate-300 rounded-none overflow-hidden shadow-none">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold uppercase text-[11px] tracking-wider">
                    <th className="py-3.5 px-4 w-16">Photo</th>
                    <th className="py-3.5 px-4">Requested Item Name / Details</th>
                    <th className="py-3.5 px-4">Customer</th>
                    <th className="py-3.5 px-4">Qty Needed</th>
                    <th className="py-3.5 px-4">Branch</th>
                    <th className="py-3.5 px-4">Days Open</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {filteredNewItemRequests.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
                        <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-500 mb-2" />
                        <p className="font-bold text-sm text-slate-700">All New Item Requests Resolved</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          There are currently no new items awaiting master catalog addition.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filteredNewItemRequests.map((enq) => {
                      const daysOpen = calculateDaysOpen(enq.date);
                      return (
                        <tr
                          key={enq.id}
                          onClick={() => setSelectedEnquiryForDetail(enq)}
                          className="hover:bg-slate-50 transition-colors cursor-pointer group"
                          title="Click to view full enquiry details"
                        >
                          {/* 1. Photo Thumbnail */}
                          <td className="py-3.5 px-4">
                            <ItemImage
                              src={enq.itemImageUrl}
                              alt={enq.itemName}
                              className="h-11 w-11 rounded-none shadow-none border border-slate-300 shrink-0"
                            />
                          </td>

                          {/* 2. Requested Name & Details */}
                          <td className="py-3.5 px-4 max-w-sm">
                            <div className="font-bold text-slate-900 group-hover:text-red-700 transition-colors">
                              {enq.itemName}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                              {enq.enquiryNumber} • {enq.date} {enq.time}
                            </div>
                            {enq.notes && (
                              <p className="text-[11px] text-slate-600 italic truncate mt-1">
                                "{enq.notes}"
                              </p>
                            )}
                          </td>

                          {/* 3. Customer */}
                          <td className="py-3.5 px-4">
                            <div className="font-bold text-slate-900 flex items-center gap-1.5">
                              <User className="h-3 w-3 text-slate-400 shrink-0" />
                              <span>{enq.customerName}</span>
                            </div>
                            {enq.customerPhone && (
                              <div className="text-[11px] text-slate-500 font-mono pl-4.5">
                                {enq.customerPhone}
                              </div>
                            )}
                          </td>

                          {/* 4. Qty Needed */}
                          <td className="py-3.5 px-4">
                            <span className="font-mono font-bold text-sm text-slate-900">
                              {enq.quantity} {enq.unit}
                            </span>
                          </td>

                          {/* 5. Branch */}
                          <td className="py-3.5 px-4">
                            <span className="font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-none text-[11px] uppercase font-mono border border-slate-200">
                              {enq.branchId}
                            </span>
                          </td>

                          {/* 6. Days Open */}
                          <td className="py-3.5 px-4">
                            <span
                              className={cn(
                                'font-mono font-bold text-xs',
                                daysOpen > 7
                                  ? 'text-red-700'
                                  : daysOpen > 3
                                  ? 'text-amber-700'
                                  : 'text-slate-700'
                              )}
                            >
                              {daysOpen} {daysOpen === 1 ? 'day' : 'days'}
                            </span>
                          </td>

                          {/* 7. Status */}
                          <td className="py-3.5 px-4">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-none bg-slate-100 text-slate-800 border border-slate-300 text-[11px] font-bold uppercase tracking-wider">
                              <PackagePlus className="h-3 w-3 text-slate-700" />
                              Awaiting Catalog
                            </span>
                          </td>

                          {/* 8. Action: Add to Catalog */}
                          <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => {
                                setCatalogEnquiry(enq);
                                setIsAddCatalogModalOpen(true);
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-xs font-bold uppercase tracking-wider rounded-none shadow-none border border-red-700 transition-colors cursor-pointer"
                              title="Add item to master catalog with pre-filled details"
                            >
                              <PackagePlus className="h-3.5 w-3.5" />
                              <span>Add to Catalog</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* ================= ALL ENQUIRIES VIEW ================= */
        <div className="bg-white border border-slate-300 rounded-none overflow-hidden shadow-none">
          {/* ENQUIRIES DATA TABLE */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold uppercase text-[11px] tracking-wider">
                  <th className="py-3 px-3">Enquiry No</th>
                  <th className="py-3 px-3">Customer</th>
                  <th className="py-3 px-3">Item</th>
                  <th className="py-3 px-3">Qty & Stock</th>
                  <th className="py-3 px-3">Branch</th>
                  <th className="py-3 px-3">Days Open</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {filteredEnquiries.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-400">
                      <Boxes className="h-8 w-8 mx-auto text-slate-300 mb-2" />
                      <p className="font-bold text-sm text-slate-700">No customer enquiries found</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {searchQuery ? 'Try clearing your search query' : 'Click below to log a new customer requirement.'}
                      </p>
                      <div className="mt-4">
                        {searchQuery ? (
                          <button
                            type="button"
                            onClick={handleClearFilter}
                            className="px-3.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 rounded-none border border-slate-300 font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer"
                          >
                            Clear Filter
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setIsNewModalOpen(true)}
                            className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-none border border-red-700 font-bold text-xs uppercase tracking-wider shadow-none transition-colors cursor-pointer"
                          >
                            + Log First Customer Enquiry
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredEnquiries.map((enq) => {
                    const daysOpen = calculateDaysOpen(enq.date);
                    const currentStock = enq.itemId ? (getBranchStock(enq.itemId, enq.branchId)?.quantity ?? 0) : 0;
                    const hasSufficientStock = enq.itemId ? currentStock >= enq.quantity : false;

                    return (
                      <tr
                        key={enq.id}
                        onClick={() => setSelectedEnquiryForDetail(enq)}
                        className="hover:bg-slate-50 transition-colors cursor-pointer group"
                        title="Click to view full enquiry details & PDF preview"
                      >
                        {/* 1. Enquiry Number */}
                        <td className="py-3.5 px-4">
                          <span className="font-mono font-bold text-red-700 group-hover:underline">
                            {enq.enquiryNumber}
                          </span>
                          <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
                            {enq.date} {enq.time}
                          </div>
                        </td>

                        {/* 2. Customer */}
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-slate-900 flex items-center gap-1.5">
                            <User className="h-3 w-3 text-slate-400 shrink-0" />
                            <span>{enq.customerName}</span>
                          </div>
                          {enq.customerPhone && (
                            <div className="text-[11px] text-slate-500 font-mono pl-4.5">
                              {enq.customerPhone}
                            </div>
                          )}
                        </td>

                        {/* 3. Item */}
                        <td className="py-3.5 px-4 max-w-xs">
                          <div className="flex items-center gap-2">
                            {enq.itemImageUrl && (
                              <ItemImage
                                src={enq.itemImageUrl}
                                alt={enq.itemName}
                                className="h-8 w-8 rounded-none shadow-none border border-slate-300 shrink-0"
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold text-slate-900 truncate">
                                {enq.itemName}
                              </div>
                              <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                {enq.isNewItemRequest && (
                                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-none bg-slate-100 text-slate-800 border border-slate-300 text-[11px] font-bold uppercase">
                                    <PackagePlus className="h-2.5 w-2.5" />
                                    New Item Request
                                  </span>
                                )}
                                {enq.itemCode ? (
                                  <span className="text-[11px] text-slate-500 font-mono font-bold">
                                    {enq.itemCode}
                                  </span>
                                ) : enq.isNewItemRequest && !enq.itemId ? (
                                  <span className="text-[11px] text-amber-700 font-medium">
                                    (Pending Catalog)
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* 4. Qty & Stock */}
                        <td className="py-3.5 px-4">
                          <div className="font-mono font-bold text-slate-900">
                            {enq.quantity} {enq.unit}
                          </div>
                          <div className="mt-0.5">
                            {enq.isNewItemRequest && !enq.itemId ? (
                              <span className="text-[11px] font-bold text-slate-700 bg-slate-100 px-1.5 py-0.2 rounded-none border border-slate-300 uppercase">
                                Not in Catalog
                              </span>
                            ) : hasSufficientStock ? (
                              <span className="text-[11px] font-bold text-emerald-800 bg-emerald-50 px-1.5 py-0.2 rounded-none border border-emerald-300 uppercase">
                                Stock: {currentStock}
                              </span>
                            ) : (
                              <span className="text-[11px] font-bold text-red-800 bg-red-50 px-1.5 py-0.2 rounded-none border border-red-300 uppercase">
                                Shortage (Have {currentStock})
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 5. Branch */}
                        <td className="py-3.5 px-4">
                          <span className="font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-none text-[11px] uppercase font-mono border border-slate-200">
                            {enq.branchId}
                          </span>
                        </td>

                        {/* 6. Days Open */}
                        <td className="py-3.5 px-4">
                          <span
                            className={cn(
                              'font-mono font-bold text-xs',
                              daysOpen > 7
                                ? 'text-red-700'
                                : daysOpen > 3
                                ? 'text-amber-700'
                                : 'text-slate-700'
                            )}
                          >
                            {daysOpen} {daysOpen === 1 ? 'day' : 'days'}
                          </span>
                        </td>

                        {/* 7. Status Badge */}
                        <td className="py-3.5 px-4">
                          {enq.status === 'Converted' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-none bg-emerald-50 text-emerald-800 border border-emerald-300 text-[11px] font-bold uppercase tracking-wider">
                              <CheckCircle2 className="h-3 w-3" />
                              Converted
                            </span>
                          ) : enq.status === 'Cancelled' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-none bg-red-50 text-red-800 border border-red-300 text-[11px] font-bold uppercase tracking-wider">
                              <XCircle className="h-3 w-3" />
                              Cancelled
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-none bg-amber-50 text-amber-900 border border-amber-300 text-[11px] font-bold uppercase tracking-wider">
                              <Clock className="h-3 w-3" />
                              Follow-up
                            </span>
                          )}
                        </td>

                        {/* 8. Actions */}
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                            {/* If New Item Request and not in catalog yet, show Add to Catalog button for Manager/CEO */}
                            {enq.isNewItemRequest && !enq.itemId && canApproveCatalogRequests && (
                              <button
                                type="button"
                                onClick={() => {
                                  setCatalogEnquiry(enq);
                                  setIsAddCatalogModalOpen(true);
                                }}
                                title="Add to Master Catalog"
                                className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider rounded-none bg-red-600 hover:bg-red-700 active:bg-red-800 text-white border border-red-700 transition-colors flex items-center gap-1 shadow-none cursor-pointer"
                              >
                                <PackagePlus className="h-3 w-3" />
                                <span>Add to Catalog</span>
                              </button>
                            )}

                            {/* 1-Click Convert Buttons if not already converted/cancelled and item exists (CEO, Manager, Billing only) */}
                            {canConvertEnquiry && enq.itemId && enq.status !== 'Converted' && enq.status !== 'Cancelled' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => convertEnquiryToSale(enq.id, 'estimate')}
                                  title="Convert to Quotation / Estimate"
                                  className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider rounded-none bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 transition-colors flex items-center gap-1 shadow-none cursor-pointer"
                                >
                                  <FileText className="h-3 w-3 text-slate-500" />
                                  <span className="hidden sm:inline">To Quote</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => convertEnquiryToSale(enq.id, 'invoice')}
                                  title="Convert to Sales Invoice"
                                  className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider rounded-none bg-red-600 hover:bg-red-700 active:bg-red-800 text-white border border-red-700 transition-colors flex items-center gap-1 shadow-none cursor-pointer"
                                >
                                  <Receipt className="h-3 w-3" />
                                  <span className="hidden sm:inline">To Invoice</span>
                                </button>
                              </>
                            )}

                            {/* Cancel Enquiry (CEO/Manager only) */}
                            {canCancelEnquiry && enq.status !== 'Converted' && enq.status !== 'Cancelled' && (
                              <button
                                type="button"
                                onClick={() => setCancellingEnquiry(enq)}
                                title="Mark as Cancelled / Lost"
                                className="p-1 rounded-none text-slate-400 hover:text-red-700 hover:bg-red-50 border border-transparent hover:border-red-200 transition-colors cursor-pointer"
                              >
                                <XCircle className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>

      {/* New Enquiry Modal */}
      <EnquiryFormModal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        onSavedAndConvert={(enqId, targetType) => convertEnquiryToSale(enqId, targetType)}
      />

      {/* Enquiry Detail Modal (Full preview matching Sales pattern) */}
      <EnquiryDetailModal
        isOpen={!!selectedEnquiryForDetail}
        enquiry={selectedEnquiryForDetail}
        onClose={() => setSelectedEnquiryForDetail(null)}
        onConvertToQuote={(enqId) => convertEnquiryToSale(enqId, 'estimate')}
        onConvertToInvoice={(enqId) => convertEnquiryToSale(enqId, 'invoice')}
        onCancelEnquiry={(enq) => setCancellingEnquiry(enq)}
        onOpenScheduleReminder={(enq) => setSchedulingReminderEnquiry(enq)}
        onAddToCatalog={(enq) => {
          setCatalogEnquiry(enq);
          setIsAddCatalogModalOpen(true);
        }}
      />

      {/* Add Item to Catalog Modal (Pre-filled from New Item Enquiry Request) */}
      {isAddCatalogModalOpen && catalogEnquiry && (
        <AddItemModal
          isOpen={isAddCatalogModalOpen}
          onClose={() => {
            setIsAddCatalogModalOpen(false);
            setCatalogEnquiry(null);
          }}
          initialValues={{
            itemName: catalogEnquiry.itemName,
            imageUrl: catalogEnquiry.itemImageUrl,
          }}
          onItemAdded={(newItem) => {
            linkItemToEnquiry(catalogEnquiry.id, newItem);
            setIsAddCatalogModalOpen(false);
            setCatalogEnquiry(null);
          }}
        />
      )}

      {/* Follow-up Reminder Modal Prompt */}
      {schedulingReminderEnquiry && (
        <FollowUpReminderModal
          isOpen={!!schedulingReminderEnquiry}
          enquiry={schedulingReminderEnquiry}
          onClose={() => setSchedulingReminderEnquiry(null)}
          onConfirm={(dueDate, dueTime, notes) => {
            addFollowUpReminder(schedulingReminderEnquiry.id, dueDate, dueTime, notes);
          }}
        />
      )}

      {/* Cancel Reason Modal */}
      {cancellingEnquiry && (
        <CancelReasonModal
          isOpen={!!cancellingEnquiry}
          onClose={() => setCancellingEnquiry(null)}
          title={`Cancel Enquiry ${cancellingEnquiry.enquiryNumber}`}
          targetName={`${cancellingEnquiry.itemName} for ${cancellingEnquiry.customerName}`}
          onConfirm={(reason) => {
            cancelEnquiry(cancellingEnquiry.id, reason);
          }}
        />
      )}
    </div>
  );
};
