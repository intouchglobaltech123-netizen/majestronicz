import React, { useState, useMemo, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import { Invoice, Estimate, PaymentMode, BranchId, BRANCHES, getInvoicePaymentSplits } from '../../types';
import { formatCurrency, cn } from '../../lib/utils';
import { InvoiceForm } from './InvoiceForm';
import { InvoicePdfModal } from './InvoicePdfModal';
import { ConvertEstimateModal } from './ConvertEstimateModal';
import { SaleReturnModal } from './SaleReturnModal';
import { ReturnsListView } from './ReturnsListView';
import { SaleReturnDetailModal } from './SaleReturnDetailModal';
import { EstimatePdfModal } from '../estimates/EstimatePdfModal';
import {
  FileText,
  Plus,
  Search,
  Printer,
  Edit2,
  Calendar,
  Building,
  Receipt,
  ArrowRightLeft,
  RotateCcw,
  Ban,
  AlertTriangle,
  Copy,
  Trash2,
  Split,
} from 'lucide-react';
import { toast } from 'sonner';

type SaleStatusType = 'ALL' | 'Paid' | 'Partial' | 'Credit' | 'Voided';

interface Props {
  initialTab?: 'ledger' | 'estimates' | 'returns';
}

export const InvoiceView: React.FC<Props> = ({ initialTab = 'ledger' }) => {
  const {
    invoices,
    estimates,
    deleteEstimate,
    currentBranch,
    isAllBranches,
    currentBranchData,
    estimateToConvert,
    setEstimateToConvert,
    voidInvoice,
  } = useErp();

  // Active view: 'ledger' (Sales Ledger list), 'estimates' (Quotation History), 'returns' (Returns), 'new' (Form)
  const [activeTab, setActiveTab] = useState<'ledger' | 'estimates' | 'returns' | 'new'>(initialTab);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [editingEstimate, setEditingEstimate] = useState<Estimate | null>(null);
  const [convertedEstimate, setConvertedEstimate] = useState<Estimate | null>(null);
  const [duplicateSourceInvoice, setDuplicateSourceInvoice] = useState<Invoice | null>(null);
  const [duplicateSourceEstimate, setDuplicateSourceEstimate] = useState<Estimate | null>(null);
  const [initialDocumentType, setInitialDocumentType] = useState<'Invoice' | 'Quotation'>('Invoice');
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);
  const [previewEstimate, setPreviewEstimate] = useState<Estimate | null>(null);
  const [returnInvoice, setReturnInvoice] = useState<Invoice | null>(null);
  const [selectedReturnInvoice, setSelectedReturnInvoice] = useState<Invoice | null>(null);
  const [isConvertModalOpen, setIsConvertModalOpen] = useState(false);
  const [estimateSearchQuery, setEstimateSearchQuery] = useState('');
  const [formInstanceId, setFormInstanceId] = useState(0);

  // Sync with initialTab prop when changed by router
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Void confirmation modal state
  const [voidModalInvoice, setVoidModalInvoice] = useState<Invoice | null>(null);
  const [voidReason, setVoidReason] = useState('Customer cancellation / Order return');

  // If redirected with an estimate to convert, automatically switch to New Sale tab
  useEffect(() => {
    if (estimateToConvert) {
      setConvertedEstimate(estimateToConvert);
      setEditingInvoice(null);
      setEditingEstimate(null);
      setDuplicateSourceInvoice(null);
      setDuplicateSourceEstimate(null);
      setInitialDocumentType('Invoice');
      setFormInstanceId((prev) => prev + 1);
      setActiveTab('new');
      setEstimateToConvert(null);
    }
  }, [estimateToConvert, setEstimateToConvert]);

  // Filters State
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [branchFilter, setBranchFilter] = useState<'ALL' | BranchId>(() =>
    isAllBranches ? 'ALL' : (currentBranch as BranchId)
  );
  const [modeFilter, setModeFilter] = useState<'ALL' | PaymentMode>('ALL');
  const [statusFilter, setStatusFilter] = useState<SaleStatusType>('ALL');

  // Keep branchFilter in sync when user toggles branch in global top bar
  useEffect(() => {
    if (!isAllBranches) {
      setBranchFilter(currentBranch as BranchId);
    }
  }, [currentBranch, isAllBranches]);

  // Helper for computing sale status
  const getSaleStatus = (inv: Invoice): { label: string; color: string } => {
    if (inv.isVoided) {
      return { label: 'Voided', color: 'bg-rose-50 text-rose-700 border-rose-200' };
    }
    if (inv.isPartialPayment) {
      return { label: 'Partial', color: 'bg-amber-50 text-amber-700 border-amber-200' };
    }
    if (inv.transactionType === 'Credit' || inv.paymentMode === 'COD-Credit') {
      return { label: 'Credit', color: 'bg-purple-50 text-purple-700 border-purple-200' };
    }
    return { label: 'Paid', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  };

  // Filter invoices by search, date range, branch, payment mode, and status
  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      // Branch filter
      const matchesBranch =
        branchFilter === 'ALL'
          ? isAllBranches || inv.branchId === currentBranch
          : inv.branchId === branchFilter;

      if (!matchesBranch) return false;

      // Date range filter
      if (startDate && inv.date < startDate) return false;
      if (endDate && inv.date > endDate) return false;

      // Payment mode filter (matches if any split mode equals modeFilter)
      if (modeFilter !== 'ALL') {
        const splits = getInvoicePaymentSplits(inv);
        if (!splits.some((s) => s.mode === modeFilter)) return false;
      }

      // Status filter
      if (statusFilter !== 'ALL') {
        const s = getSaleStatus(inv);
        if (s.label !== statusFilter) return false;
      }

      // Search filter (Invoice No, Customer, Phone, Items)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesCustomer = inv.customerName.toLowerCase().includes(q);
        const matchesNumber = inv.invoiceNumber.toLowerCase().includes(q);
        const matchesPhone = inv.customerPhone && inv.customerPhone.includes(q);
        const matchesItem = inv.items.some(
          (it) => it.itemName.toLowerCase().includes(q) || (it.itemCode && it.itemCode.toLowerCase().includes(q))
        );
        if (!matchesCustomer && !matchesNumber && !matchesPhone && !matchesItem) {
          return false;
        }
      }

      return true;
    });
  }, [invoices, branchFilter, isAllBranches, currentBranch, startDate, endDate, modeFilter, statusFilter, searchQuery]);

  // Quick Date Range Presets
  const applyDatePreset = (preset: 'all' | 'today' | 'month') => {
    const today = new Date().toISOString().split('T')[0];
    if (preset === 'today') {
      setStartDate(today);
      setEndDate(today);
    } else if (preset === 'month') {
      setStartDate('2026-09-01');
      setEndDate('2026-09-30');
    } else {
      setStartDate('');
      setEndDate('');
    }
  };

  // Filter estimates by search and branch scope
  const filteredEstimates = useMemo(() => {
    return estimates.filter((est) => {
      const matchesBranch =
        branchFilter === 'ALL'
          ? isAllBranches || est.branchId === currentBranch
          : est.branchId === branchFilter;

      if (!matchesBranch) return false;

      const q = estimateSearchQuery.trim().toLowerCase();
      if (!q) return true;

      return (
        est.customerName.toLowerCase().includes(q) ||
        est.estimateNumber.toLowerCase().includes(q) ||
        (est.customerContact && est.customerContact.includes(q))
      );
    });
  }, [estimates, branchFilter, isAllBranches, currentBranch, estimateSearchQuery]);

  const handleSaved = (savedInvoice: Invoice) => {
    setEditingInvoice(null);
    setEditingEstimate(null);
    setConvertedEstimate(null);
    setDuplicateSourceInvoice(null);
    setDuplicateSourceEstimate(null);
    setActiveTab('ledger');
    setPreviewInvoice(savedInvoice);
  };

  const handleSavedEstimate = (savedEstimate: Estimate) => {
    setEditingInvoice(null);
    setEditingEstimate(null);
    setConvertedEstimate(null);
    setDuplicateSourceInvoice(null);
    setDuplicateSourceEstimate(null);
    setActiveTab('estimates');
    setPreviewEstimate(savedEstimate);
  };

  const handleStartBlank = (docType: 'Invoice' | 'Quotation' = 'Invoice') => {
    setEditingInvoice(null);
    setEditingEstimate(null);
    setConvertedEstimate(null);
    setDuplicateSourceInvoice(null);
    setDuplicateSourceEstimate(null);
    setInitialDocumentType(docType);
    setFormInstanceId((prev) => prev + 1);
    setActiveTab('new');
  };

  const handleEdit = (invoice: Invoice) => {
    if (invoice.isVoided) {
      toast.error('Cannot edit a voided sale.');
      return;
    }
    setEditingInvoice(invoice);
    setEditingEstimate(null);
    setConvertedEstimate(null);
    setDuplicateSourceInvoice(null);
    setDuplicateSourceEstimate(null);
    setInitialDocumentType('Invoice');
    setFormInstanceId((prev) => prev + 1);
    setActiveTab('new');
  };

  const handleEditEstimate = (estimate: Estimate) => {
    setEditingEstimate(estimate);
    setEditingInvoice(null);
    setConvertedEstimate(null);
    setDuplicateSourceInvoice(null);
    setDuplicateSourceEstimate(null);
    setInitialDocumentType('Quotation');
    setFormInstanceId((prev) => prev + 1);
    setActiveTab('new');
  };

  const handleDuplicate = (invoice: Invoice) => {
    if (invoice.isVoided) {
      toast.error('Cannot duplicate a voided sale.');
      return;
    }
    setDuplicateSourceInvoice(invoice);
    setDuplicateSourceEstimate(null);
    setEditingInvoice(null);
    setEditingEstimate(null);
    setConvertedEstimate(null);
    setInitialDocumentType('Invoice');
    setFormInstanceId((prev) => prev + 1);
    setActiveTab('new');
  };

  const handleDuplicateEstimate = (estimate: Estimate) => {
    setDuplicateSourceEstimate(estimate);
    setDuplicateSourceInvoice(null);
    setEditingInvoice(null);
    setEditingEstimate(null);
    setConvertedEstimate(null);
    setInitialDocumentType('Quotation');
    setFormInstanceId((prev) => prev + 1);
    setActiveTab('new');
  };

  const handleSelectEstimateToConvert = (est: Estimate) => {
    setEditingInvoice(null);
    setEditingEstimate(null);
    setConvertedEstimate(est);
    setDuplicateSourceInvoice(null);
    setDuplicateSourceEstimate(null);
    setInitialDocumentType('Invoice');
    setFormInstanceId((prev) => prev + 1);
    setActiveTab('new');
    setIsConvertModalOpen(false);
  };

  const handleConfirmVoid = () => {
    if (!voidModalInvoice) return;
    voidInvoice(voidModalInvoice.id, voidReason);
    setVoidModalInvoice(null);
    setVoidReason('Customer cancellation / Order return');
  };

  // Summary figures across currently filtered records (excluding voided sales)
  const activeSales = filteredInvoices.filter((i) => !i.isVoided);
  const totalGrossRevenue = activeSales.reduce(
    (sum, i) => sum + Math.max(0, i.grandTotal - (i.totalReturnedAmount || 0)),
    0
  );
  const voidedCount = filteredInvoices.filter((i) => i.isVoided).length;
  const returnedInvoicesCount = invoices.filter(
    (i) => (i.returns && i.returns.length > 0) || (i.totalReturnedAmount || 0) > 0
  ).length;

  return (
    <div className="p-6 space-y-6 w-full">
      {/* Top Banner & Module Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700 shrink-0 shadow-2xs">
              <Receipt className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
                Sales
              </h1>
              <p className="text-xs text-slate-500">
                Sales Ledger, GST tax invoicing, payment tracking, and return processing.
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons & Tab Switcher */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={() => setIsConvertModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-slate-50 text-blue-700 text-xs font-bold border border-blue-200 shadow-2xs transition-colors cursor-pointer"
          >
            <ArrowRightLeft className="h-3.5 w-3.5" />
            <span>Convert from Quote</span>
          </button>

          {/* Primary View Switcher (Tabs Only) */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('ledger')}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer',
                activeTab === 'ledger'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              <Receipt className="h-3.5 w-3.5" />
              <span>Sales Ledger ({invoices.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('estimates')}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer',
                activeTab === 'estimates'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              <FileText className="h-3.5 w-3.5" />
              <span>Quotation History ({estimates.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('returns')}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer',
                activeTab === 'returns'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Returns ({returnedInvoicesCount})</span>
            </button>
          </div>

          {/* Persistent Creation Buttons: ALWAYS visible from ALL tabs */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleStartBlank('Invoice')}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer',
                activeTab === 'new' && initialDocumentType === 'Invoice' && !editingInvoice && !convertedEstimate && !duplicateSourceInvoice
                  ? 'bg-blue-700 ring-2 ring-blue-300 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              )}
              title="Create a new Sales Invoice (Tax Invoice or Cash/Credit Bill)"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New Sale</span>
            </button>

            <button
              type="button"
              onClick={() => handleStartBlank('Quotation')}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer',
                activeTab === 'new' && initialDocumentType === 'Quotation' && !editingEstimate && !duplicateSourceEstimate
                  ? 'bg-purple-700 ring-2 ring-purple-300 text-white'
                  : 'bg-purple-600 hover:bg-purple-700 text-white'
              )}
              title="Create a new Commercial Quotation / Proforma"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New Quote</span>
            </button>
          </div>
        </div>
      </div>

      {/* VIEW CONTENT */}
      {activeTab === 'new' ? (
        /* CREATION / EDITING FORM */
        <InvoiceForm
          key={`invoice-form-${formInstanceId}-${initialDocumentType}`}
          initialInvoice={editingInvoice}
          initialEstimate={editingEstimate}
          convertedFromEstimate={convertedEstimate}
          duplicateSourceInvoice={duplicateSourceInvoice}
          duplicateSourceEstimate={duplicateSourceEstimate}
          initialDocumentType={initialDocumentType}
          onSaved={handleSaved}
          onSavedEstimate={handleSavedEstimate}
          onPreviewPdf={(inv) => setPreviewInvoice(inv)}
          onPreviewEstimatePdf={(est) => setPreviewEstimate(est)}
          onCancel={() => {
            setDuplicateSourceInvoice(null);
            setDuplicateSourceEstimate(null);
            setEditingInvoice(null);
            setEditingEstimate(null);
            if (initialDocumentType === 'Quotation' || editingEstimate || duplicateSourceEstimate) {
              setActiveTab('estimates');
            } else {
              setActiveTab('ledger');
            }
          }}
        />
      ) : activeTab === 'returns' ? (
        /* DEDICATED RETURNS TAB VIEW */
        <ReturnsListView
          onSelectReturn={(inv) => setSelectedReturnInvoice(inv)}
          onViewOriginalSale={(inv) => setPreviewInvoice(inv)}
        />
      ) : activeTab === 'estimates' ? (
        /* QUOTATION HISTORY TAB VIEW */
        <div className="space-y-4">
          {/* Quick Filter Bar */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
            <div className="relative flex-1 max-w-md w-full">
              <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search quotation by Customer, Quote No, or Phone..."
                value={estimateSearchQuery}
                onChange={(e) => setEstimateSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 text-xs focus:outline-none focus:border-blue-600"
              />
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Building className="h-4 w-4 text-blue-600" />
                <span>
                  Scope: <strong>{branchFilter === 'ALL' ? (isAllBranches ? 'All Branches' : currentBranchData?.name) : BRANCHES.find(b => b.id === branchFilter)?.name}</strong>
                </span>
              </div>
            </div>
          </div>

          {/* Quotations Table */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                    <th className="py-3.5 px-4">Quote No</th>
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
                        <FileText className="h-8 w-8 mx-auto text-slate-300 mb-2" />
                        <p className="font-bold text-sm text-slate-700">No quotations found</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Create a commercial quotation by clicking below.
                        </p>
                        <div className="mt-4">
                          <button
                            type="button"
                            onClick={() => handleStartBlank('Quotation')}
                            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold text-xs shadow-xs transition-colors cursor-pointer"
                          >
                            + Create First Quotation
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredEstimates.map((est) => (
                      <tr key={est.id} className="hover:bg-slate-50/70 transition-colors group">
                        <td className="py-3.5 px-4 font-mono">
                          <span className="font-bold text-purple-700 block">{est.estimateNumber}</span>
                          {est.sourceEnquiryNumber && (
                            <span
                              className="text-[10px] text-blue-700 font-medium block truncate mt-0.5"
                              title={`From Enquiry #${est.sourceEnquiryNumber}`}
                            >
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
                          {BRANCHES.find((b) => b.id === est.branchId)?.shortCode || est.branchId}
                        </td>
                        <td className="py-3.5 px-4">
                          {est.withGst ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                              With GST
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                              Without Tax
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-black text-sm text-slate-900">
                          {formatCurrency(est.grandTotal)}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleSelectEstimateToConvert(est)}
                              title="Convert this quotation into a Sales Invoice"
                              className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 transition-colors flex items-center gap-1 text-[11px] font-bold cursor-pointer"
                            >
                              <ArrowRightLeft className="h-3 w-3" />
                              <span>To Invoice</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setPreviewEstimate(est)}
                              title="Print / Save PDF"
                              className="p-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition-colors cursor-pointer"
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleEditEstimate(est)}
                              title="Edit Quotation"
                              className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-colors cursor-pointer"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDuplicateEstimate(est)}
                              title="Duplicate Quote (New quote with same items)"
                              className="p-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 transition-colors cursor-pointer"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm(`Delete quotation ${est.estimateNumber}?`)) {
                                  deleteEstimate(est.id);
                                  toast.success(`Quotation ${est.estimateNumber} deleted`);
                                }
                              }}
                              title="Delete Quotation"
                              className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-400 border border-slate-200 transition-colors cursor-pointer"
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
      ) : (
        /* DEFAULT VIEW: SALES LEDGER LIST */
        <div className="space-y-4">
          {/* Quick Filter Bar */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              {/* Search Box */}
              <div className="relative flex-1 max-w-md w-full">
                <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search sale by Customer, Invoice No, Phone, or Item..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 text-xs focus:outline-none focus:border-blue-600"
                />
              </div>

              {/* Date Range Filters */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-xl">
                  <Calendar className="h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="bg-transparent text-slate-700 text-xs focus:outline-none"
                    title="Start Date"
                  />
                  <span className="text-slate-400 font-semibold">to</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="bg-transparent text-slate-700 text-xs focus:outline-none"
                    title="End Date"
                  />
                </div>

                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-[11px] font-semibold text-slate-600">
                  <button
                    onClick={() => applyDatePreset('month')}
                    className="px-2 py-0.5 rounded hover:bg-white transition-colors"
                  >
                    This Month
                  </button>
                  <button
                    onClick={() => applyDatePreset('today')}
                    className="px-2 py-0.5 rounded hover:bg-white transition-colors"
                  >
                    Today
                  </button>
                  <button
                    onClick={() => applyDatePreset('all')}
                    className="px-2 py-0.5 rounded hover:bg-white transition-colors"
                  >
                    Clear Dates
                  </button>
                </div>
              </div>
            </div>

            {/* Sub-Filters: Branch, Payment Mode, Status */}
            <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                {/* Branch Filter Selector */}
                {isAllBranches ? (
                  <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-xl text-xs">
                    <Building className="h-3.5 w-3.5 text-blue-600" />
                    <select
                      value={branchFilter}
                      onChange={(e) => setBranchFilter(e.target.value as 'ALL' | BranchId)}
                      className="bg-transparent font-bold text-slate-800 focus:outline-none"
                    >
                      <option value="ALL">All Branches</option>
                      {BRANCHES.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-xl text-xs font-bold text-slate-700">
                    <Building className="h-3.5 w-3.5 text-blue-600" />
                    <span>{currentBranchData?.name}</span>
                  </div>
                )}

                {/* Payment Mode Pills */}
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-[11px]">
                  <span className="text-[10px] font-bold uppercase text-slate-400 px-1.5">Mode:</span>
                  {(['ALL', 'Cash', 'HDFC', 'GPay', 'COD-Credit'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setModeFilter(m)}
                      className={cn(
                        'px-2 py-0.5 rounded font-bold transition-all',
                        modeFilter === m
                          ? 'bg-white text-blue-700 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>

                {/* Status Pills */}
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-[11px]">
                  <span className="text-[10px] font-bold uppercase text-slate-400 px-1.5">Status:</span>
                  {(['ALL', 'Paid', 'Partial', 'Credit', 'Voided'] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatusFilter(s)}
                      className={cn(
                        'px-2 py-0.5 rounded font-bold transition-all',
                        statusFilter === s
                          ? 'bg-white text-blue-700 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Total Active Net Revenue Callout */}
              <div className="flex items-center gap-3 text-xs font-mono">
                <span className="text-slate-500">
                  Showing <strong>{filteredInvoices.length}</strong> sales
                </span>
                <span className="text-slate-300">•</span>
                <span className="font-bold text-slate-900">
                  Net Active: <span className="text-emerald-700 font-black font-mono">{formatCurrency(totalGrossRevenue)}</span>
                </span>
                {voidedCount > 0 && (
                  <span className="text-[11px] text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded font-bold border border-rose-200">
                    {voidedCount} Voided
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* SALES LEDGER TABLE */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                    <th className="py-3.5 px-4">Sale / Invoice No</th>
                    <th className="py-3.5 px-4">Date & Time</th>
                    <th className="py-3.5 px-4">Customer</th>
                    <th className="py-3.5 px-4">Branch</th>
                    <th className="py-3.5 px-4">Payment Mode</th>
                    <th className="py-3.5 px-4 text-right">Total</th>
                    <th className="py-3.5 px-4 text-center">Status</th>
                    <th className="py-3.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {filteredInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
                        <Receipt className="h-8 w-8 mx-auto text-slate-300 mb-2" />
                        <p className="font-bold text-sm text-slate-700">No sales records found</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {searchQuery || modeFilter !== 'ALL' || statusFilter !== 'ALL' || startDate
                            ? 'Try clearing your search query or active filters.'
                            : 'Start by clicking "+ New Sale" to issue your first invoice.'}
                        </p>
                        <div className="mt-4 flex justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleStartBlank('Invoice')}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs shadow-xs cursor-pointer"
                          >
                            + New Sale
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredInvoices.map((inv) => {
                      const status = getSaleStatus(inv);
                      const isVoided = !!inv.isVoided;
                      const hasReturns = (inv.returns && inv.returns.length > 0) || (inv.totalReturnedAmount || 0) > 0;

                      return (
                        <tr
                          key={inv.id}
                          onClick={() => setPreviewInvoice(inv)}
                          className={cn(
                            'transition-colors cursor-pointer group',
                            isVoided
                              ? 'bg-rose-50/20 hover:bg-rose-50/40 text-slate-500'
                              : 'hover:bg-slate-50/80'
                          )}
                          title="Click to view full sale detail & PDF preview"
                        >
                          {/* Sale No */}
                          <td className="py-3.5 px-4 font-mono">
                            <span
                              className={cn(
                                'font-bold block',
                                isVoided ? 'line-through text-slate-400' : 'text-blue-700 group-hover:underline'
                              )}
                            >
                              {inv.invoiceNumber}
                            </span>
                            {inv.sourceEstimateNumber && (
                              <span className="text-[10px] text-slate-400 block truncate mt-0.5">
                                From Quote #{inv.sourceEstimateNumber}
                              </span>
                            )}
                            {inv.sourceEnquiryNumber && (
                              <span className="text-[10px] text-purple-700 block truncate mt-0.5">
                                From Enq #{inv.sourceEnquiryNumber}
                              </span>
                            )}
                          </td>

                          {/* Date & Time */}
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-1 font-medium text-slate-700">
                              <Calendar className="h-3.5 w-3.5 text-slate-400" />
                              <span>{inv.date}</span>
                            </div>
                            <span className="text-[10px] text-slate-400 pl-4">{inv.time}</span>
                          </td>

                          {/* Customer */}
                          <td className="py-3.5 px-4">
                            <div className={cn('font-bold', isVoided ? 'text-slate-600' : 'text-slate-900')}>
                              {inv.customerName}
                            </div>
                            {inv.customerPhone && (
                              <div className="text-[11px] text-slate-500 font-mono">
                                {inv.customerPhone}
                              </div>
                            )}
                          </td>

                          {/* Branch */}
                          <td className="py-3.5 px-4 uppercase font-mono text-[11px] text-slate-600">
                            {inv.branchId}
                          </td>

                          {/* Payment Mode */}
                          <td className="py-3.5 px-4">
                            {(() => {
                              const splits = getInvoicePaymentSplits(inv);
                              if (splits.length > 1) {
                                return (
                                  <div className="space-y-1">
                                    <span
                                      title={splits.map((s) => `${s.mode}: ₹${s.amount.toLocaleString('en-IN')}`).join(' + ')}
                                      className="inline-flex items-center gap-1 font-mono font-bold text-purple-800 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded text-[11px] cursor-help"
                                    >
                                      <Split className="h-2.5 w-2.5" />
                                      <span>Split ({splits.length})</span>
                                    </span>
                                    <div className="text-[10px] text-slate-500 font-mono flex flex-wrap gap-1">
                                      {splits.map((s, idx) => (
                                        <span key={idx} className="bg-slate-50 px-1 py-0.2 rounded border border-slate-200">
                                          {s.mode}: ₹{s.amount.toLocaleString('en-IN')}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                );
                              }
                              return (
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                                    {inv.paymentMode}
                                  </span>
                                </div>
                              );
                            })()}
                            {inv.isPartialPayment && (
                              <div className="text-[10px] font-bold text-amber-700 mt-0.5">
                                Paid: ₹{inv.partialAmount?.toLocaleString('en-IN')} (Bal: ₹{inv.balanceDue?.toLocaleString('en-IN')})
                              </div>
                            )}
                          </td>

                          {/* Total (Clean, unmodified original amount) */}
                          <td className="py-3.5 px-4 text-right font-mono">
                            <span
                              className={cn(
                                'font-black text-sm block',
                                isVoided ? 'line-through text-slate-400' : 'text-slate-900'
                              )}
                            >
                              {formatCurrency(inv.grandTotal)}
                            </span>
                          </td>

                          {/* Status & Clean Return Badge */}
                          <td className="py-3.5 px-4 text-center">
                            <div className="flex items-center justify-center gap-1.5 flex-wrap">
                              <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border', status.color)}>
                                {status.label}
                              </span>
                              {hasReturns && !isVoided && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedReturnInvoice(inv);
                                  }}
                                  className={cn(
                                    'inline-flex items-center gap-1 text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full border shadow-2xs transition-all hover:scale-105 cursor-pointer',
                                    (inv.totalReturnedAmount || 0) >= inv.grandTotal
                                      ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                                      : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                                  )}
                                  title="Click to view Return Voucher details"
                                >
                                  <RotateCcw className="h-2.5 w-2.5" />
                                  <span>
                                    {(inv.totalReturnedAmount || 0) >= inv.grandTotal
                                      ? 'Returned'
                                      : 'Partial Return'}
                                  </span>
                                </button>
                              )}
                            </div>
                            {isVoided && inv.voidReason && (
                              <span className="block text-[9px] text-rose-500 truncate max-w-[120px] mx-auto mt-0.5" title={inv.voidReason}>
                                {inv.voidReason}
                              </span>
                            )}
                          </td>

                          {/* Action Buttons */}
                          <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1.5">
                              {/* PDF Preview */}
                              <button
                                type="button"
                                onClick={() => setPreviewInvoice(inv)}
                                title="Print / PDF Preview"
                                className="p-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition-colors"
                              >
                                <Printer className="h-3.5 w-3.5" />
                              </button>

                              {/* Process Return Action */}
                              <button
                                type="button"
                                onClick={() => setReturnInvoice(inv)}
                                disabled={isVoided}
                                title={isVoided ? 'Cannot return voided sale' : 'Process Line-Item Return'}
                                className={cn(
                                  'p-1.5 rounded-lg border transition-colors',
                                  isVoided
                                    ? 'opacity-30 cursor-not-allowed bg-slate-50 text-slate-400 border-slate-200'
                                    : 'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200'
                                )}
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </button>

                              {/* Edit Action */}
                              <button
                                type="button"
                                onClick={() => handleEdit(inv)}
                                disabled={isVoided}
                                title={isVoided ? 'Cannot edit voided sale' : 'Edit Sale'}
                                className={cn(
                                  'p-1.5 rounded-lg border transition-colors',
                                  isVoided
                                    ? 'opacity-30 cursor-not-allowed bg-slate-50 text-slate-400 border-slate-200'
                                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                                )}
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>

                              {/* Duplicate Action */}
                              <button
                                type="button"
                                onClick={() => handleDuplicate(inv)}
                                disabled={isVoided}
                                title={isVoided ? 'Cannot duplicate voided sale' : 'Duplicate Sale (New invoice with same items)'}
                                className={cn(
                                  'p-1.5 rounded-lg border transition-colors',
                                  isVoided
                                    ? 'opacity-30 cursor-not-allowed bg-slate-50 text-slate-400 border-slate-200'
                                    : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
                                )}
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </button>

                              {/* Void Action */}
                              <button
                                type="button"
                                onClick={() => {
                                  setVoidModalInvoice(inv);
                                  setVoidReason('Customer cancellation / Order return');
                                }}
                                disabled={isVoided}
                                title={isVoided ? 'Already voided' : 'Void Sale & Restore Stock'}
                                className={cn(
                                  'p-1.5 rounded-lg border transition-colors',
                                  isVoided
                                    ? 'opacity-30 cursor-not-allowed bg-slate-50 text-slate-400 border-slate-200'
                                    : 'bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-600 border-slate-200'
                                )}
                              >
                                <Ban className="h-3.5 w-3.5" />
                              </button>
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
        </div>
      )}

      {/* PDF / Detail View Modal */}
      <InvoicePdfModal
        invoice={previewInvoice}
        isOpen={!!previewInvoice}
        onClose={() => setPreviewInvoice(null)}
        onCreateNew={() => handleStartBlank('Invoice')}
      />

      {/* Quotation PDF Preview Modal */}
      <EstimatePdfModal
        estimate={previewEstimate}
        isOpen={!!previewEstimate}
        onClose={() => setPreviewEstimate(null)}
      />

      {/* Line-Item Return Modal */}
      <SaleReturnModal
        invoice={returnInvoice}
        isOpen={!!returnInvoice}
        onClose={() => setReturnInvoice(null)}
      />

      {/* Return Detail Modal */}
      {selectedReturnInvoice && (
        <SaleReturnDetailModal
          isOpen={!!selectedReturnInvoice}
          invoice={selectedReturnInvoice}
          onClose={() => setSelectedReturnInvoice(null)}
          onViewOriginalSale={(inv) => {
            setSelectedReturnInvoice(null);
            setPreviewInvoice(inv);
          }}
        />
      )}

      {/* Convert from Quote Picker Modal */}
      <ConvertEstimateModal
        isOpen={isConvertModalOpen}
        onClose={() => setIsConvertModalOpen(false)}
        estimates={estimates}
        onSelectEstimate={handleSelectEstimateToConvert}
      />

      {/* Void Confirmation Modal */}
      {voidModalInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center font-bold shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Void Sale #{voidModalInvoice.invoiceNumber}?
                </h3>
                <p className="text-xs text-slate-500">
                  Stock will be reversed to warehouse • Sale remains in audit log
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">Customer:</span>
                <span className="font-bold text-slate-800">{voidModalInvoice.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Amount:</span>
                <span className="font-bold font-mono text-slate-900">{formatCurrency(voidModalInvoice.grandTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Branch:</span>
                <span className="font-mono uppercase font-bold text-blue-700">{voidModalInvoice.branchId}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">
                Reason for Voiding <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="e.g. Customer cancelled order, duplicate invoice..."
                className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-rose-500"
              />
            </div>

            <p className="text-[11px] text-rose-600 bg-rose-50 p-2.5 rounded-lg border border-rose-200">
              ⚠️ <strong>Audit Rule:</strong> This sale will be excluded from the Daily Cash Register and Reports, but will remain visible in the Sales Ledger flagged as Voided.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setVoidModalInvoice(null)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmVoid}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-xs transition-colors flex items-center gap-1.5"
              >
                <Ban className="h-3.5 w-3.5" />
                <span>Confirm Void</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
