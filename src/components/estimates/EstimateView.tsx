import React, { useState, useMemo } from 'react';
import { useErp } from '../../context/ErpContext';
import { Estimate, BRANCHES } from '../../types';
import { formatCurrency, cn, getTodayDateString } from '../../lib/utils';
import { EstimateForm } from './EstimateForm';
import { EstimatePdfModal } from './EstimatePdfModal';
import {
  FileText,
  Plus,
  Search,
  Printer,
  Edit2,
  Building,
  ReceiptText,
  ArrowRightLeft,
  Copy,
  Ban,
} from 'lucide-react';

type QuoteLifecycle = 'Open' | 'Converted' | 'Cancelled';

export const EstimateView: React.FC = () => {
  const {
    estimates,
    invoices,
    cancelEstimate,
    currentBranch,
    isAllBranches,
    currentBranchData,
    setCurrentView,
    setEstimateToConvert,
  } = useErp();

  const [statusFilter, setStatusFilter] = useState<'all' | QuoteLifecycle>('all');
  const [cancelTarget, setCancelTarget] = useState<Estimate | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  // A quote is "already converted" once a non-voided invoice records it as its
  // source. Used to block converting the same quote into a second invoice (SAL-18).
  const convertedEstimateMap = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const inv of invoices) {
      if (inv.sourceEstimateId && !inv.isVoided) map.set(inv.sourceEstimateId, inv.invoiceNumber);
    }
    return map;
  }, [invoices]);

  // A quote's lifecycle: Converted (a non-voided bill came from it) wins, then a
  // stored Cancelled status, else Open. Converted is derived so it's always right
  // even if the stored status lags.
  const lifecycleOf = (est: Estimate): QuoteLifecycle =>
    convertedEstimateMap.has(est.id) ? 'Converted' : est.status === 'Cancelled' ? 'Cancelled' : 'Open';

  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
  const [editingEstimate, setEditingEstimate] = useState<Estimate | null>(null);
  const [duplicateSourceEstimate, setDuplicateSourceEstimate] = useState<Estimate | null>(null);
  const [previewEstimate, setPreviewEstimate] = useState<Estimate | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Filter estimates by search and branch scope
  const filteredEstimates = useMemo(() => {
    return estimates.filter((est) => {
      const matchesBranch = isAllBranches || est.branchId === currentBranch;
      const matchesSearch =
        est.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        est.estimateNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (est.customerContact && est.customerContact.includes(searchQuery));
      const matchesStatus = statusFilter === 'all' || lifecycleOf(est) === statusFilter;

      return matchesBranch && matchesSearch && matchesStatus;
    });
  }, [estimates, isAllBranches, currentBranch, searchQuery, statusFilter, convertedEstimateMap]);

  // Lifecycle counts for the filter tabs.
  const lifecycleCounts = useMemo(() => {
    const scoped = estimates.filter((e) => isAllBranches || e.branchId === currentBranch);
    return {
      all: scoped.length,
      Open: scoped.filter((e) => lifecycleOf(e) === 'Open').length,
      Converted: scoped.filter((e) => lifecycleOf(e) === 'Converted').length,
      Cancelled: scoped.filter((e) => lifecycleOf(e) === 'Cancelled').length,
    };
  }, [estimates, isAllBranches, currentBranch, convertedEstimateMap]);

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    await cancelEstimate(cancelTarget.id, cancelReason.trim());
    setCancelTarget(null);
    setCancelReason('');
  };

  // Scoped quote metrics.
  const quoteStats = useMemo(() => {
    const scoped = estimates.filter((e) => isAllBranches || e.branchId === currentBranch);
    const month = getTodayDateString().slice(0, 7);
    const totalValue = scoped.reduce((t, e) => t + (e.grandTotal || 0), 0);
    const monthList = scoped.filter((e) => (e.date || '').startsWith(month));
    return {
      count: scoped.length,
      totalValue,
      monthCount: monthList.length,
      monthValue: monthList.reduce((t, e) => t + (e.grandTotal || 0), 0),
      avgValue: scoped.length ? Math.round(totalValue / scoped.length) : 0,
    };
  }, [estimates, isAllBranches, currentBranch]);

  const handleSaved = (savedEstimate: Estimate) => {
    setEditingEstimate(null);
    setDuplicateSourceEstimate(null);
    setActiveTab('history');
    setPreviewEstimate(savedEstimate);
  };

  const handleStartNew = () => {
    setEditingEstimate(null);
    setDuplicateSourceEstimate(null);
    setActiveTab('new');
  };

  const handleEdit = (estimate: Estimate) => {
    setEditingEstimate(estimate);
    setDuplicateSourceEstimate(null);
    setActiveTab('new');
  };

  const handleDuplicate = (estimate: Estimate) => {
    setDuplicateSourceEstimate(estimate);
    setEditingEstimate(null);
    setActiveTab('new');
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 w-full">
      {/* Top Banner & Tab Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
            Quotes
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            GST-compliant quotations and vector PDF exports.
          </p>
        </div>

        {/* Tab Switcher & Quick Add */}
        <div className="flex items-center gap-2">
          <div className="flex flex-wrap items-center bg-white p-0.5 rounded-none border border-slate-300 text-xs">
            <button
              onClick={() => {
                setDuplicateSourceEstimate(null);
                setEditingEstimate(null);
                setActiveTab('new');
              }}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-none font-bold transition-all cursor-pointer',
                activeTab === 'new'
                  ? 'bg-red-600 text-white shadow-2xs'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-950'
              )}
            >
              <Plus className="h-3.5 w-3.5" />
              <span>
                {editingEstimate
                  ? 'Edit Quote'
                  : duplicateSourceEstimate
                  ? 'Duplicate Quote'
                  : 'New Quote'}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('history')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-none font-bold transition-all cursor-pointer',
                activeTab === 'history'
                  ? 'bg-red-600 text-white shadow-2xs'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-950'
              )}
            >
              <FileText className="h-3.5 w-3.5" />
              <span>Quote History ({estimates.length})</span>
            </button>
          </div>

          {activeTab === 'history' && (
            <button
              onClick={handleStartNew}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-none bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors shadow-2xs border border-red-700 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Create New</span>
            </button>
          )}
        </div>
      </div>

      {/* Quote metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-none bg-white border border-slate-300 shadow-none">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total Quotes</span>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">{quoteStats.count}</p>
          <span className="text-[11px] text-slate-400">{isAllBranches ? 'All branches' : currentBranchData?.name}</span>
        </div>
        <div className="p-3.5 rounded-none bg-white border border-slate-300 shadow-none">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Quoted Value</span>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1 font-mono">{formatCurrency(quoteStats.totalValue)}</p>
          <span className="text-[11px] text-slate-400">Across all quotes</span>
        </div>
        <div className="p-3.5 rounded-none bg-white border border-slate-300 shadow-none">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">This Month</span>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1 font-mono">{formatCurrency(quoteStats.monthValue)}</p>
          <span className="text-[11px] text-slate-400">{quoteStats.monthCount} quote{quoteStats.monthCount === 1 ? '' : 's'}</span>
        </div>
        <div className="p-3.5 rounded-none bg-white border border-slate-300 shadow-none">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Avg Quote</span>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1 font-mono">{formatCurrency(quoteStats.avgValue)}</p>
          <span className="text-[11px] text-slate-400">Per quotation</span>
        </div>
      </div>

      {/* Main View Body */}
      {activeTab === 'new' ? (
        <EstimateForm
          initialEstimate={editingEstimate}
          duplicateSourceEstimate={duplicateSourceEstimate}
          onSaved={handleSaved}
          onPreviewPdf={(est) => setPreviewEstimate(est)}
        />
      ) : (
        /* ESTIMATE HISTORY TAB */
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="bg-white border border-slate-300 rounded-none p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-none">
            <div className="relative flex-1 max-w-md w-full">
              <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search estimate by Customer, Estimate No, or Phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-none bg-slate-50 border border-slate-300 text-slate-900 placeholder-slate-400 text-xs focus:outline-none focus:border-red-600"
              />
            </div>

            {/* Lifecycle filter: Open / Converted / Cancelled */}
            <div className="flex flex-wrap items-center bg-slate-100 p-1 rounded-none text-xs font-bold">
              {([
                ['all', `All (${lifecycleCounts.all})`],
                ['Open', `Open (${lifecycleCounts.Open})`],
                ['Converted', `Converted (${lifecycleCounts.Converted})`],
                ['Cancelled', `Cancelled (${lifecycleCounts.Cancelled})`],
              ] as const).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setStatusFilter(val)}
                  className={cn(
                    'px-2.5 py-1 rounded-none transition-all cursor-pointer',
                    statusFilter === val ? 'bg-red-600 text-white' : 'text-slate-600 hover:text-slate-900',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-600">
              <Building className="h-4 w-4 text-slate-500" />
              <span>
                Scope: <strong>{isAllBranches ? 'All Branches' : currentBranchData?.name}</strong>
              </span>
            </div>
          </div>

          {/* Estimates Table */}
          <div className="bg-white border border-slate-300 rounded-none overflow-hidden shadow-none">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-100 border-b border-slate-300 text-slate-700 font-bold uppercase text-[11px] tracking-wider">
                  <tr>
                    <th className="py-3.5 px-4">Estimate #</th>
                    <th className="py-3.5 px-4">Customer Details</th>
                    <th className="py-3.5 px-4">Date & Time</th>
                    <th className="py-3.5 px-4">Branch</th>
                    <th className="py-3.5 px-4">Tax Mode</th>
                    <th className="py-3.5 px-4 text-right">Grand Total</th>
                    <th className="py-3.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {filteredEstimates.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400">
                        <ReceiptText className="h-8 w-8 mx-auto text-slate-300 mb-2" />
                        <p className="font-bold text-sm text-slate-700">No estimates found</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Create your first quotation by clicking below.
                        </p>
                        <div className="mt-4">
                          <button
                            type="button"
                            onClick={handleStartNew}
                            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-none border border-red-700 font-bold text-xs shadow-none transition-colors cursor-pointer"
                          >
                            + Create First Estimate
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredEstimates.map((est) => (
                      <tr key={est.id} className="hover:bg-slate-50/70 transition-colors group">
                        <td className="py-3.5 px-4 font-mono">
                          <span className="font-bold text-slate-900 block">{est.estimateNumber}</span>
                          {est.sourceEnquiryNumber && (
                            <span className="text-[11px] text-red-700 font-medium block truncate mt-0.5" title={`From Enquiry #${est.sourceEnquiryNumber}`}>
                              From Enq: #{est.sourceEnquiryNumber}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-slate-900">{est.customerName}</div>
                          {est.customerContact && (
                            <div className="text-[11px] text-slate-500 font-mono">{est.customerContact}</div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600">
                          <div>{est.date}</div>
                          <div className="text-[11px] text-slate-400">{est.time}</div>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="px-2 py-0.5 rounded-none bg-slate-100 text-slate-700 border border-slate-200 font-medium text-[11px]">
                            {BRANCHES.find((b) => b.id === est.branchId)?.name || est.branchId}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={cn(
                              'px-2 py-0.5 rounded-none font-bold text-[11px] border',
                              est.withGst
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-slate-100 text-slate-600 border-slate-200'
                            )}
                          >
                            {est.withGst ? 'With GST' : 'No Tax'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <span className="font-mono font-bold text-sm text-slate-900">
                            {formatCurrency(est.grandTotal)}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          {(() => {
                            const lc = lifecycleOf(est);
                            return (
                              <div className="flex items-center justify-end gap-1.5">
                                {lc === 'Converted' ? (
                                  <span
                                    title={`Converted to invoice ${convertedEstimateMap.get(est.id)}`}
                                    className="px-2 py-1 rounded-none bg-slate-100 text-slate-500 border border-slate-200 flex items-center gap-1 text-[11px] font-bold"
                                  >
                                    <ArrowRightLeft className="h-3 w-3" />
                                    <span>Converted → {convertedEstimateMap.get(est.id)}</span>
                                  </span>
                                ) : lc === 'Cancelled' ? (
                                  <span
                                    title={est.cancelReason ? `Cancelled: ${est.cancelReason}` : 'Cancelled'}
                                    className="px-2 py-1 rounded-none bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1 text-[11px] font-bold"
                                  >
                                    <Ban className="h-3 w-3" />
                                    <span>Cancelled</span>
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => {
                                      setEstimateToConvert(est);
                                      setCurrentView('invoices');
                                    }}
                                    title="Convert this estimate into a Sales Invoice"
                                    className="px-2 py-1 rounded-none bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 transition-colors flex items-center gap-1 text-[11px] font-bold cursor-pointer"
                                  >
                                    <ArrowRightLeft className="h-3 w-3" />
                                    <span>To Invoice</span>
                                  </button>
                                )}
                                <button
                                  onClick={() => setPreviewEstimate(est)}
                                  title="Print / Save PDF"
                                  className="p-1.5 rounded-none bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 transition-colors cursor-pointer"
                                >
                                  <Printer className="h-3.5 w-3.5" />
                                </button>
                                {/* Edit only while Open — a Converted or Cancelled quote is locked. */}
                                {lc === 'Open' && (
                                  <button
                                    onClick={() => handleEdit(est)}
                                    title="Edit Quotation"
                                    className="p-1.5 rounded-none bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 transition-colors cursor-pointer"
                                  >
                                    <Edit2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleDuplicate(est)}
                                  title="Duplicate Quote (New quote with same items)"
                                  className="p-1.5 rounded-none bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 transition-colors cursor-pointer"
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                </button>
                                {/* Cancel-with-reason replaces delete; only for an Open quote. */}
                                {lc === 'Open' && (
                                  <button
                                    onClick={() => { setCancelTarget(est); setCancelReason(''); }}
                                    title="Cancel this quotation (with a reason)"
                                    className="p-1.5 rounded-none bg-white hover:bg-rose-50 hover:text-rose-600 text-slate-400 border border-slate-200 transition-colors cursor-pointer"
                                  >
                                    <Ban className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* PDF Modal Preview Component */}
      <EstimatePdfModal
        estimate={previewEstimate}
        isOpen={!!previewEstimate}
        onClose={() => setPreviewEstimate(null)}
      />

      {/* Cancel-with-reason modal (replaces delete) */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white border border-slate-300 rounded-none w-full max-w-md shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 bg-rose-50 flex items-center gap-2.5">
              <Ban className="h-5 w-5 text-rose-700" />
              <div>
                <h2 className="text-base font-bold text-slate-900">Cancel quotation {cancelTarget.estimateNumber}</h2>
                <p className="text-xs text-slate-500">A cancelled quote is kept for the record (not deleted) and can't be edited.</p>
              </div>
            </div>
            <div className="p-5 space-y-3">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600">Reason for cancellation</label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={3}
                autoFocus
                placeholder="e.g. Customer chose another supplier / price not accepted"
                className="w-full px-3 py-2 rounded-none bg-slate-50 border border-slate-300 text-sm text-slate-900 focus:outline-none focus:border-rose-600"
              />
            </div>
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
              <button
                onClick={() => { setCancelTarget(null); setCancelReason(''); }}
                className="px-4 py-2 rounded-none text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 cursor-pointer"
              >
                Keep quotation
              </button>
              <button
                onClick={confirmCancel}
                disabled={!cancelReason.trim()}
                className="px-4 py-2 rounded-none text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 border border-rose-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                Cancel quotation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
