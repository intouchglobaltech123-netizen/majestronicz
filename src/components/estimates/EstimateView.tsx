import React, { useState, useMemo } from 'react';
import { useErp } from '../../context/ErpContext';
import { Estimate } from '../../types';
import { formatCurrency, cn } from '../../lib/utils';
import { EstimateForm } from './EstimateForm';
import { EstimatePdfModal } from './EstimatePdfModal';
import {
  FileText,
  Plus,
  Search,
  Printer,
  Trash2,
  Edit2,
  Calendar,
  Building,
  ReceiptText,
  ArrowRightLeft,
  Copy,
} from 'lucide-react';

export const EstimateView: React.FC = () => {
  const {
    estimates,
    deleteEstimate,
    currentBranch,
    isAllBranches,
    currentBranchData,
    setCurrentView,
    setEstimateToConvert,
  } = useErp();

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

      return matchesBranch && matchesSearch;
    });
  }, [estimates, isAllBranches, currentBranch, searchQuery]);

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
    <div className="p-6 space-y-6 w-full">
      {/* Top Banner & Tab Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700 shrink-0">
              <ReceiptText className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
                Quotes
              </h1>
              <p className="text-xs text-slate-500">
                GST-compliant quotations and vector PDF exports.
              </p>
            </div>
          </div>
        </div>

        {/* Tab Switcher & Quick Add */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs">
            <button
              onClick={() => {
                setDuplicateSourceEstimate(null);
                setEditingEstimate(null);
                setActiveTab('new');
              }}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all',
                activeTab === 'new'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
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
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all',
                activeTab === 'history'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              <FileText className="h-3.5 w-3.5" />
              <span>Quote History ({estimates.length})</span>
            </button>
          </div>

          {activeTab === 'history' && (
            <button
              onClick={handleStartNew}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors shadow-xs"
            >
              <Plus className="h-4 w-4" />
              <span>Create New</span>
            </button>
          )}
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
          <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
            <div className="relative flex-1 max-w-md w-full">
              <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search estimate by Customer, Estimate No, or Phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 text-xs focus:outline-none focus:border-blue-600"
              />
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Building className="h-4 w-4 text-blue-600" />
              <span>
                Scope: <strong>{isAllBranches ? 'All Branches' : currentBranchData?.name}</strong>
              </span>
            </div>
          </div>

          {/* Estimates Table */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                    <th className="py-3.5 px-4">Estimate No</th>
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
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs shadow-xs transition-colors"
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
                          <span className="font-bold text-blue-700 block">{est.estimateNumber}</span>
                          {est.sourceEnquiryNumber && (
                            <span className="text-[10px] text-purple-700 font-medium block truncate mt-0.5" title={`From Enquiry #${est.sourceEnquiryNumber}`}>
                              From Enq: #{est.sourceEnquiryNumber}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-slate-900">{est.customerName}</div>
                          {est.customerContact && (
                            <div className="text-[11px] text-slate-500">{est.customerContact}</div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600">
                          <div className="flex items-center gap-1 font-medium">
                            <Calendar className="h-3.5 w-3.5 text-slate-400" />
                            <span>{est.date}</span>
                          </div>
                          <span className="text-[10px] text-slate-400 pl-4">{est.time}</span>
                        </td>
                        <td className="py-3.5 px-4 uppercase font-mono text-[11px] text-slate-600">
                          {est.branchId}
                        </td>
                        <td className="py-3.5 px-4">
                          {est.withGst ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                              With GST
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                              Without GST
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-black text-sm text-slate-900">
                          {formatCurrency(est.grandTotal)}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => {
                                setEstimateToConvert(est);
                                setCurrentView('invoices');
                              }}
                              title="Convert this estimate into a Sales Invoice"
                              className="px-2 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 transition-colors flex items-center gap-1 text-[11px] font-bold"
                            >
                              <ArrowRightLeft className="h-3 w-3" />
                              <span>To Invoice</span>
                            </button>
                            <button
                              onClick={() => setPreviewEstimate(est)}
                              title="Print / Save PDF"
                              className="p-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition-colors"
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handleEdit(est)}
                              title="Edit Estimate"
                              className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-colors"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDuplicate(est)}
                              title="Duplicate Quote (New quote with same items)"
                              className="p-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 transition-colors"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                if (confirm(`Delete estimate ${est.estimateNumber}?`)) {
                                  deleteEstimate(est.id);
                                }
                              }}
                              title="Delete Estimate"
                              className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-400 border border-slate-200 transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
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
    </div>
  );
};
