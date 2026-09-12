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
  ArrowRight,
  Sparkles,
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
  } = useErp();

  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [cancellingEnquiry, setCancellingEnquiry] = useState<Enquiry | null>(null);
  const [schedulingReminderEnquiry, setSchedulingReminderEnquiry] = useState<Enquiry | null>(null);

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
    <div className="p-6 space-y-6 w-full">
      {/* Top Banner & Navigation Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700 shrink-0 shadow-2xs">
              <Boxes className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
                  Enquiries
                </h1>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                  {enquiries.length} Total
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Track buyer requirements, live branch stock, and order conversions.
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons & View Tabs */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Manager / CEO Only: View Switcher */}
          {canApproveCatalogRequests && (
            <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs">
              <button
                type="button"
                onClick={() => setActiveTab('all')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all',
                  activeTab === 'all'
                    ? 'bg-white text-blue-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                )}
              >
                <Boxes className="h-3.5 w-3.5" />
                <span>Enquiries</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('new-item-requests')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all',
                  activeTab === 'new-item-requests'
                    ? 'bg-purple-600 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                )}
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>New Item Requests</span>
                {unresolvedNewItemRequests.length > 0 && (
                  <span
                    className={cn(
                      'px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold',
                      activeTab === 'new-item-requests'
                        ? 'bg-white text-purple-700'
                        : 'bg-purple-200 text-purple-800'
                    )}
                  >
                    {unresolvedNewItemRequests.length}
                  </span>
                )}
              </button>
            </div>
          )}

          {currentUser.role !== 'Sales' && (
            <button
              type="button"
              onClick={() => setCurrentView('pending-orders')}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-bold transition-colors shadow-2xs"
            >
              <Clock className="h-3.5 w-3.5 text-purple-600" />
              <span>Pending Orders ({pendingOrders.length})</span>
              <ArrowRight className="h-3 w-3 text-slate-400" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsNewModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors shadow-xs"
          >
            <Plus className="h-4 w-4" />
            <span>New Enquiry</span>
          </button>
        </div>
      </div>

      {/* Reports Tie-In KPI Summary Card */}
      <EnquiryConversionReportWidget
        enquiries={enquiries}
        pendingOrders={pendingOrders}
      />

      {/* ENQUIRIES TABLE & FILTERS */}
      <div className="space-y-4">
        {/* Filters Bar */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-3 shadow-xs">
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
              className="w-full pl-10 pr-8 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 text-xs focus:outline-none focus:border-blue-600 transition-colors"
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

          {/* Status Filter Tabs */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2 flex items-center gap-1">
              <Filter className="h-3 w-3" />
              Status:
            </span>
            {(['ALL', 'Follow-up', 'Converted', 'Cancelled'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  'px-2.5 py-1 rounded-lg font-bold text-[11px] transition-all',
                  statusFilter === s
                    ? 'bg-white text-blue-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                )}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Branch Scope */}
          <div className="flex items-center gap-2 text-xs text-slate-500 shrink-0">
            <Building className="h-4 w-4 text-blue-600" />
            <span>
              Scope: <strong>{isAllBranches ? 'All Branches' : currentBranchData?.name}</strong>
            </span>
          </div>
        </div>

        {/* Active Filter Indicator */}
        {searchQuery && (
          <div className="flex items-center gap-2 text-xs text-blue-800 bg-blue-50 px-3 py-1.5 rounded-xl border border-blue-200 w-fit">
            <span>Filtering by: <strong>"{searchQuery}"</strong></span>
            <button
              type="button"
              onClick={handleClearFilter}
              className="text-blue-600 hover:text-blue-900 font-bold ml-1 hover:underline flex items-center gap-0.5"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          </div>
        )}

      {/* TAB CONTENT: NEW ITEM REQUESTS QUEUE vs REGULAR ENQUIRIES */}
      {activeTab === 'new-item-requests' && canApproveCatalogRequests ? (
        /* ================= NEW ITEM REQUESTS QUEUE ================= */
        <div className="space-y-4">
          <div className="bg-purple-50/60 border border-purple-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-purple-950">
                  New Item Requests Queue (Manager / CEO Review)
                </h3>
                <p className="text-xs text-purple-800">
                  Customer enquiries for items not yet in the master catalog. Review specifications and add to catalog to trigger procurement.
                </p>
              </div>
            </div>
            <div className="text-xs font-bold px-3 py-1 rounded-xl bg-purple-200/80 text-purple-900 self-start sm:self-center">
              {filteredNewItemRequests.length} Pending Review
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
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
                        <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-400 mb-2" />
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
                          className="hover:bg-purple-50/30 transition-colors cursor-pointer group"
                          title="Click to view full enquiry details"
                        >
                          {/* 1. Photo Thumbnail */}
                          <td className="py-3.5 px-4">
                            <ItemImage
                              src={enq.itemImageUrl}
                              alt={enq.itemName}
                              className="h-11 w-11 rounded-xl shadow-2xs border border-slate-200 shrink-0"
                            />
                          </td>

                          {/* 2. Requested Name & Details */}
                          <td className="py-3.5 px-4 max-w-sm">
                            <div className="font-bold text-slate-900 group-hover:text-purple-700 transition-colors">
                              {enq.itemName}
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono mt-0.5">
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
                            <span className="font-mono font-black text-sm text-purple-900">
                              {enq.quantity} {enq.unit}
                            </span>
                          </td>

                          {/* 5. Branch */}
                          <td className="py-3.5 px-4">
                            <span className="font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[11px] uppercase font-mono">
                              {enq.branchId}
                            </span>
                          </td>

                          {/* 6. Days Open */}
                          <td className="py-3.5 px-4">
                            <span
                              className={cn(
                                'font-mono font-bold text-xs',
                                daysOpen > 7
                                  ? 'text-rose-600'
                                  : daysOpen > 3
                                  ? 'text-amber-600'
                                  : 'text-slate-600'
                              )}
                            >
                              {daysOpen} {daysOpen === 1 ? 'day' : 'days'}
                            </span>
                          </td>

                          {/* 7. Status */}
                          <td className="py-3.5 px-4">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-purple-50 text-purple-700 border border-purple-200 text-[10px] font-bold">
                              <Sparkles className="h-3 w-3" />
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
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors"
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
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
          {/* ENQUIRIES DATA TABLE */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                  <th className="py-3.5 px-4">Enquiry No</th>
                  <th className="py-3.5 px-4">Customer</th>
                  <th className="py-3.5 px-4">Item</th>
                  <th className="py-3.5 px-4">Qty & Stock</th>
                  <th className="py-3.5 px-4">Branch</th>
                  <th className="py-3.5 px-4">Days Open</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
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
                            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition-colors"
                          >
                            Clear Filter
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setIsNewModalOpen(true)}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs shadow-xs transition-colors"
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
                        className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                        title="Click to view full enquiry details & PDF preview"
                      >
                        {/* 1. Enquiry Number */}
                        <td className="py-3.5 px-4">
                          <span className="font-mono font-bold text-blue-700 group-hover:underline">
                            {enq.enquiryNumber}
                          </span>
                          <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
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
                                className="h-8 w-8 rounded-lg shadow-2xs border border-slate-200 shrink-0"
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold text-slate-900 truncate">
                                {enq.itemName}
                              </div>
                              <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                {enq.isNewItemRequest && (
                                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-purple-50 text-purple-700 border border-purple-200 text-[9px] font-bold">
                                    <Sparkles className="h-2.5 w-2.5" />
                                    New Item Request
                                  </span>
                                )}
                                {enq.itemCode ? (
                                  <span className="text-[10px] text-slate-400 font-mono">
                                    {enq.itemCode}
                                  </span>
                                ) : enq.isNewItemRequest && !enq.itemId ? (
                                  <span className="text-[10px] text-amber-600 font-medium">
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
                              <span className="text-[10px] font-bold text-purple-700 bg-purple-50 px-1.5 py-0.2 rounded border border-purple-200">
                                Not in Catalog
                              </span>
                            ) : hasSufficientStock ? (
                              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                                Stock: {currentStock}
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-1.5 py-0.2 rounded border border-rose-200">
                                Shortage (Have {currentStock})
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 5. Branch */}
                        <td className="py-3.5 px-4">
                          <span className="font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[11px] uppercase font-mono">
                            {enq.branchId}
                          </span>
                        </td>

                        {/* 6. Days Open */}
                        <td className="py-3.5 px-4">
                          <span
                            className={cn(
                              'font-mono font-bold text-xs',
                              daysOpen > 7
                                ? 'text-rose-600'
                                : daysOpen > 3
                                ? 'text-amber-600'
                                : 'text-slate-600'
                            )}
                          >
                            {daysOpen} {daysOpen === 1 ? 'day' : 'days'}
                          </span>
                        </td>

                        {/* 7. Status Badge */}
                        <td className="py-3.5 px-4">
                          {enq.status === 'Converted' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                              <CheckCircle2 className="h-3 w-3" />
                              Converted
                            </span>
                          ) : enq.status === 'Cancelled' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold">
                              <XCircle className="h-3 w-3" />
                              Cancelled
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold">
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
                                className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-purple-600 hover:bg-purple-700 text-white transition-colors flex items-center gap-1 shadow-2xs"
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
                                  className="px-2 py-1 text-[11px] font-bold rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition-colors flex items-center gap-1 shadow-2xs"
                                >
                                  <FileText className="h-3 w-3" />
                                  <span className="hidden sm:inline">To Quote</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => convertEnquiryToSale(enq.id, 'invoice')}
                                  title="Convert to Sales Invoice"
                                  className="px-2 py-1 text-[11px] font-bold rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 transition-colors flex items-center gap-1 shadow-2xs"
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
                                className="p-1 rounded-lg text-slate-300 hover:text-rose-600 hover:bg-rose-50 transition-colors"
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
