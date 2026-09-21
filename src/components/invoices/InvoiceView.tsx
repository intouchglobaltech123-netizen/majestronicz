import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useErp } from '../../context/ErpContext';
import { Invoice, Estimate, BranchId, BRANCHES, getInvoicePaymentSplits, isInvoiceFullyReturned, computeInvoiceFinance } from '../../types';
import { formatCurrency, cn } from '../../lib/utils';
import { SalesDraft, loadDrafts, upsertDraft, deleteDraft as removeDraft, newDraftId } from '../../lib/salesDrafts';
import { calculateInvoiceTotals } from '../../lib/taxCalculations';
import { InvoiceForm } from './InvoiceForm';
import { InvoicePdfModal } from './InvoicePdfModal';
import { ConvertEstimateModal } from './ConvertEstimateModal';
import { SaleReturnModal } from './SaleReturnModal';
import { ReturnsListView } from './ReturnsListView';
import { SaleReturnDetailModal } from './SaleReturnDetailModal';
import { EstimatePdfModal } from '../estimates/EstimatePdfModal';
import { DeliveryChallanView } from '../challans/DeliveryChallanView';
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
  Save,
  PlayCircle,
  Clock,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

// One open billing draft in the multi-tab bar (Vyapar-style). Each tab keeps its
// own live InvoiceForm mounted so switching never loses in-progress work.
interface BillTab {
  id: string;
  label: string;
  documentType: 'Invoice' | 'Quotation';
  editingInvoice: Invoice | null;
  editingEstimate: Estimate | null;
  convertedEstimate: Estimate | null;
  duplicateSourceInvoice: Invoice | null;
  duplicateSourceEstimate: Estimate | null;
  resumedDraftId: string | null;
}

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
    quoteToPrefill,
    setQuoteToPrefill,
    voidInvoice,
    currentUser,
    activeSubTab,
  } = useErp();

  // Active view: 'ledger' (Sales Ledger list), 'estimates' (Quotation History),
  // 'returns' (Returns), 'new' (Form), 'draft-sales'/'draft-quotes' (saved drafts)
  // Stable per-user key for scoping local drafts.
  const draftUserKey = currentUser.userId || currentUser.name || currentUser.role;

  // Open bill tabs are persisted per-user so they survive a full page refresh.
  const OPEN_BILLS_KEY = `majestronicz_openbills_${draftUserKey}`;
  const readPersistedBills = (): { openBills: BillTab[]; activeBillId: string | null; activeTab: string | null } => {
    try {
      const raw = localStorage.getItem(OPEN_BILLS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (Array.isArray(p.openBills)) {
          return { openBills: p.openBills, activeBillId: p.activeBillId ?? null, activeTab: p.activeTab ?? null };
        }
      }
    } catch { /* ignore */ }
    return { openBills: [], activeBillId: null, activeTab: null };
  };

  const [activeTab, setActiveTab] = useState<'ledger' | 'estimates' | 'returns' | 'new' | 'draft-sales' | 'draft-quotes' | 'challans'>(() => {
    const p = readPersistedBills();
    return p.openBills.length > 0 && p.activeTab === 'new' ? 'new' : initialTab;
  });
  // Which challan sub-tab to show when the embedded Delivery Challans tab is open.
  const [challanTab, setChallanTab] = useState<'new' | 'history'>('history');

  // Work-in-progress drafts (per-user, browser-local)
  const [drafts, setDrafts] = useState<SalesDraft[]>(() => loadDrafts(draftUserKey));

  useEffect(() => {
    setDrafts(loadDrafts(draftUserKey));
  }, [draftUserKey]);

  const draftSales = useMemo(() => drafts.filter((d) => d.kind === 'Invoice'), [drafts]);
  const draftQuotes = useMemo(() => drafts.filter((d) => d.kind === 'Quotation'), [drafts]);
  // Multi-tab billing: several sale/quotation drafts open concurrently (restored on refresh).
  const [openBills, setOpenBills] = useState<BillTab[]>(() => readPersistedBills().openBills);
  const [activeBillId, setActiveBillId] = useState<string | null>(() => readPersistedBills().activeBillId);
  const billSeqRef = useRef(readPersistedBills().openBills.length);

  // Persist open tabs + active selection so a refresh restores them.
  useEffect(() => {
    try {
      localStorage.setItem(OPEN_BILLS_KEY, JSON.stringify({ openBills, activeBillId, activeTab }));
    } catch { /* ignore */ }
  }, [openBills, activeBillId, activeTab, OPEN_BILLS_KEY]);
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);
  const [previewEstimate, setPreviewEstimate] = useState<Estimate | null>(null);
  const [returnInvoice, setReturnInvoice] = useState<Invoice | null>(null);
  const [selectedReturnInvoice, setSelectedReturnInvoice] = useState<Invoice | null>(null);
  const [isConvertModalOpen, setIsConvertModalOpen] = useState(false);
  const [estimateSearchQuery, setEstimateSearchQuery] = useState('');

  // Automatically collapse sidebar navigation by default when Add Sale / Billing screen is active
  useEffect(() => {
    if (activeTab === 'new') {
      window.dispatchEvent(new CustomEvent('majestronicz:collapse-sidebar'));
    }
  }, [activeTab]);

  // ---- Multi-tab billing helpers -------------------------------------------
  const makeBillId = () => `bill-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // Open a new billing tab from a seed and focus it.
  const openBillTab = (seed: Partial<BillTab> & { documentType: 'Invoice' | 'Quotation'; label?: string }) => {
    const id = makeBillId();
    const isNew = !seed.editingInvoice && !seed.editingEstimate && !seed.convertedEstimate &&
      !seed.duplicateSourceInvoice && !seed.duplicateSourceEstimate && !seed.resumedDraftId;
    let label = seed.label;
    if (!label) {
      if (isNew) {
        billSeqRef.current += 1;
        label = `${seed.documentType === 'Quotation' ? 'Quote' : 'Sale'} ${billSeqRef.current}`;
      } else {
        label = seed.documentType === 'Quotation' ? 'Quotation' : 'Sale';
      }
    }
    const tab: BillTab = {
      id, label, documentType: seed.documentType,
      editingInvoice: seed.editingInvoice ?? null,
      editingEstimate: seed.editingEstimate ?? null,
      convertedEstimate: seed.convertedEstimate ?? null,
      duplicateSourceInvoice: seed.duplicateSourceInvoice ?? null,
      duplicateSourceEstimate: seed.duplicateSourceEstimate ?? null,
      resumedDraftId: seed.resumedDraftId ?? null,
    };
    setOpenBills((prev) => [...prev, tab]);
    setActiveBillId(id);
    setActiveTab('new');
    return id;
  };

  // Synchronize view tab when triggered from secondary navbar flyout
  useEffect(() => {
    if (activeSubTab?.view === 'invoices') {
      const tab = activeSubTab.tab;
      if (tab === 'ledger' || tab === 'estimates' || tab === 'returns' || tab === 'draft-sales' || tab === 'draft-quotes') {
        setActiveTab(tab);
      } else if (tab === 'new') {
        openBillTab({ documentType: 'Invoice' });
      } else if (tab === 'new-quote') {
        openBillTab({ documentType: 'Quotation' });
      } else if (tab === 'challans') {
        setChallanTab('history');
        setActiveTab('challans');
      } else if (tab === 'new-challan') {
        setChallanTab('new');
        setActiveTab('challans');
      }
    }
  }, [activeSubTab]);

  // Close a tab; fall back to the ledger when nothing is left open.
  const closeBillTab = (id: string, fallbackTab: 'ledger' | 'estimates' = 'ledger') => {
    const next = openBills.filter((t) => t.id !== id);
    setOpenBills(next);
    if (next.length === 0) {
      setActiveBillId(null);
      setActiveTab(fallbackTab);
    } else if (activeBillId === id) {
      setActiveBillId(next[next.length - 1].id);
    }
  };

  // Sync with initialTab prop when changed by router. Skip the very first run so
  // a refresh that restored open bill tabs (activeTab='new') is not overridden.
  const initialTabMountRef = useRef(true);
  useEffect(() => {
    if (initialTabMountRef.current) {
      initialTabMountRef.current = false;
      return;
    }
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Void confirmation modal state
  const [voidModalInvoice, setVoidModalInvoice] = useState<Invoice | null>(null);
  const [voidReason, setVoidReason] = useState('Customer cancellation / Order return');

  // If redirected with an estimate to convert, open a new Sale tab for it.
  useEffect(() => {
    if (estimateToConvert) {
      openBillTab({ documentType: 'Invoice', convertedEstimate: estimateToConvert, label: `Convert ${estimateToConvert.estimateNumber}` });
      setEstimateToConvert(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateToConvert, setEstimateToConvert]);

  // If handed a pre-filled quotation (e.g. from an enquiry), open a new Quote tab.
  useEffect(() => {
    if (quoteToPrefill) {
      openBillTab({ documentType: 'Quotation', editingEstimate: quoteToPrefill, label: 'Quotation' });
      setQuoteToPrefill(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteToPrefill, setQuoteToPrefill]);

  // Filters State
  const [searchQuery, setSearchQuery] = useState('');
  // Date-range / mode / status filtering now lives in the Reports section.
  // The ledger keeps only a quick search; branch follows the global top-bar toggle.
  const [branchFilter, setBranchFilter] = useState<'ALL' | BranchId>(() =>
    isAllBranches ? 'ALL' : (currentBranch as BranchId)
  );

  // Keep branchFilter in sync when user toggles branch in global top bar
  useEffect(() => {
    if (!isAllBranches) {
      setBranchFilter(currentBranch as BranchId);
    }
  }, [currentBranch, isAllBranches]);

  // Helper for computing sale status — uses the single finance-truth (nets returns).
  const getSaleStatus = (inv: Invoice): { label: string; color: string } => {
    if (inv.isVoided) {
      return { label: 'Voided', color: 'bg-rose-50 text-rose-700 border-rose-200' };
    }
    const fin = computeInvoiceFinance(inv);
    if (fin.due > 0) {
      return fin.received > 0
        ? { label: 'Partial', color: 'bg-amber-50 text-amber-700 border-amber-200' }
        : { label: 'Credit', color: 'bg-purple-50 text-purple-700 border-purple-200' };
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
  }, [invoices, branchFilter, isAllBranches, currentBranch, searchQuery]);

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

  // Once a resumed draft is finalized (committed), remove it from the draft store.
  const handleSaved = (tab: BillTab, savedInvoice: Invoice) => {
    if (tab.resumedDraftId) setDrafts(removeDraft(draftUserKey, tab.resumedDraftId));
    setPreviewInvoice(savedInvoice);
    closeBillTab(tab.id, 'ledger');
  };

  const handleSavedEstimate = (tab: BillTab, savedEstimate: Estimate) => {
    if (tab.resumedDraftId) setDrafts(removeDraft(draftUserKey, tab.resumedDraftId));
    setPreviewEstimate(savedEstimate);
    closeBillTab(tab.id, 'estimates');
  };

  // Save the current in-form document as a draft (parked, not committed).
  const handleSaveDraft = (tab: BillTab, doc: Invoice | Estimate, kind: 'Invoice' | 'Quotation') => {
    const draftId = tab.resumedDraftId || newDraftId();
    const draft: SalesDraft = {
      draftId,
      kind,
      savedAt: new Date().toISOString(),
      customerName: doc.customerName || 'Unnamed',
      number: kind === 'Quotation' ? (doc as Estimate).estimateNumber : (doc as Invoice).invoiceNumber,
      grandTotal: doc.grandTotal || 0,
      branchId: doc.branchId,
      data: doc,
    };
    setDrafts(upsertDraft(draftUserKey, draft));
    closeBillTab(tab.id, kind === 'Quotation' ? 'estimates' : 'ledger');
  };

  // Reopen a saved draft into a new billing tab to finish/finalize it.
  const handleResumeDraft = (draft: SalesDraft) => {
    if (draft.kind === 'Quotation') {
      openBillTab({ documentType: 'Quotation', editingEstimate: draft.data as Estimate, resumedDraftId: draft.draftId, label: draft.customerName || 'Quotation' });
    } else {
      openBillTab({ documentType: 'Invoice', editingInvoice: draft.data as Invoice, resumedDraftId: draft.draftId, label: draft.customerName || 'Sale' });
    }
  };

  const handleDeleteDraft = (draftId: string) => {
    setDrafts(removeDraft(draftUserKey, draftId));
    toast.success('Draft deleted');
  };

  const handleStartBlank = (docType: 'Invoice' | 'Quotation' = 'Invoice') => {
    openBillTab({ documentType: docType });
  };

  const handleEdit = (invoice: Invoice) => {
    if (invoice.isVoided) {
      toast.error('Cannot edit a voided sale.');
      return;
    }
    // If this invoice is already open in a tab, focus it instead of duplicating.
    const existing = openBills.find((t) => t.editingInvoice?.id === invoice.id);
    if (existing) { setActiveBillId(existing.id); setActiveTab('new'); return; }
    openBillTab({ documentType: 'Invoice', editingInvoice: invoice, label: invoice.invoiceNumber });
  };

  const handleEditEstimate = (estimate: Estimate) => {
    const existing = openBills.find((t) => t.editingEstimate?.id === estimate.id);
    if (existing) { setActiveBillId(existing.id); setActiveTab('new'); return; }
    openBillTab({ documentType: 'Quotation', editingEstimate: estimate, label: estimate.estimateNumber });
  };

  const handleDuplicate = (invoice: Invoice) => {
    if (invoice.isVoided) {
      toast.error('Cannot duplicate a voided sale.');
      return;
    }
    openBillTab({ documentType: 'Invoice', duplicateSourceInvoice: invoice, label: `Copy of ${invoice.invoiceNumber}` });
  };

  const handleDuplicateEstimate = (estimate: Estimate) => {
    openBillTab({ documentType: 'Quotation', duplicateSourceEstimate: estimate, label: `Copy of ${estimate.estimateNumber}` });
  };

  const handleSelectEstimateToConvert = (est: Estimate) => {
    openBillTab({ documentType: 'Invoice', convertedEstimate: est, label: `Convert ${est.estimateNumber}` });
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

  // Today's at-a-glance metrics for the billing header (branch-scoped).
  const todayStats = useMemo(() => {
    const t = new Date();
    const todayStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    const scoped = invoices.filter(
      (i) => !i.isVoided && (i.date || '').startsWith(todayStr) && (isAllBranches || i.branchId === currentBranch)
    );
    let amount = 0, cash = 0, gpay = 0, hdfc = 0, credit = 0;
    for (const inv of scoped) {
      amount += Math.max(0, (inv.grandTotal || 0) - (inv.totalReturnedAmount || 0));
      for (const s of getInvoicePaymentSplits(inv)) {
        if (s.mode === 'Cash') cash += s.amount;
        else if (s.mode === 'GPay') gpay += s.amount;
        else if (s.mode === 'HDFC') hdfc += s.amount;
        else if (s.mode === 'COD-Credit') credit += s.amount;
      }
    }
    return { count: scoped.length, amount, cash, gpay, hdfc, credit };
  }, [invoices, isAllBranches, currentBranch]);

  return (
    <div className="p-4 sm:p-6 space-y-6 w-full">
      {/* Top Banner & Module Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div>
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
                {activeTab === 'new'
                  ? 'New Sale / Billing POS'
                  : activeTab === 'estimates'
                  ? 'Quotations & Estimates'
                  : activeTab === 'returns'
                  ? 'Sales Returns & Credit Notes'
                  : activeTab === 'draft-sales'
                  ? 'Saved Sale Drafts'
                  : activeTab === 'draft-quotes'
                  ? 'Saved Quotation Drafts'
                  : 'Sales Invoices'}
              </h1>
              <p className="text-xs text-slate-500">
                {activeTab === 'new'
                  ? 'Multi-tab billing, GST invoice calculation & item lookup'
                  : activeTab === 'estimates'
                  ? 'Manage customer quotations, download PDFs & convert to sales'
                  : activeTab === 'returns'
                  ? 'Processed sales returns, credit note history & returned inventory'
                  : activeTab === 'draft-sales' || activeTab === 'draft-quotes'
                  ? 'In-progress drafts saved in this browser'
                  : 'Live tax invoices, payments tracking, collections & customer dues'}
              </p>
            </div>
        </div>

        {/* Action Buttons specific to current sub-view */}
        <div className="flex items-center gap-2 gap-y-2 flex-wrap justify-end">
          {/* Neat today's metrics — segmented mini-card (billing + sales ledger) */}
          {(activeTab === 'new' || activeTab === 'ledger') && (
            <div className="hidden sm:flex items-stretch rounded-lg border border-slate-200 bg-white overflow-hidden divide-x divide-slate-200 shadow-2xs">
              {[
                { label: 'Bills', value: String(todayStats.count), tone: 'text-slate-900' },
                { label: 'Sales', value: formatCurrency(todayStats.amount), tone: 'text-slate-900' },
                { label: 'Cash', value: formatCurrency(todayStats.cash), tone: 'text-emerald-700' },
                { label: 'GPay', value: formatCurrency(todayStats.gpay), tone: 'text-blue-700' },
                { label: 'HDFC', value: formatCurrency(todayStats.hdfc), tone: 'text-indigo-700' },
              ].map((m) => (
                <div key={m.label} className="px-3 py-1.5 text-right leading-tight">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{m.label}</div>
                  <div className={cn('text-xs font-bold font-mono', m.tone)}>{m.value}</div>
                </div>
              ))}
              <div className="px-2 py-1.5 flex items-center bg-slate-50/60">
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Today</span>
              </div>
            </div>
          )}

          {activeTab !== 'new' && (
            <>
              <button
                type="button"
                onClick={() => handleStartBlank('Invoice')}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-none bg-red-600 hover:bg-red-700 text-white text-xs font-bold border border-red-700 transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>+ Add Sale</span>
              </button>
              <button
                type="button"
                onClick={() => handleStartBlank('Quotation')}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-none bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold border border-slate-900 transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>+ Add Quote</span>
              </button>
            </>
          )}

          {(activeTab === 'ledger' || activeTab === 'estimates') && (
            <button
              type="button"
              onClick={() => setIsConvertModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-none bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold border border-slate-300 shadow-none transition-colors cursor-pointer"
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
              <span>Convert Quote</span>
            </button>
          )}

          {/* Return to in-progress bills (kept — this is document state, not sub-nav) */}
          {activeTab !== 'new' && openBills.length > 0 && (
            <button
              type="button"
              onClick={() => setActiveTab('new')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-none bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 text-xs font-bold transition-colors cursor-pointer"
            >
              <Receipt className="h-3.5 w-3.5" />
              <span>Open Bills ({openBills.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* VIEW CONTENT */}
      {activeTab === 'new' ? (
        /* MULTI-TAB BILLING — several sale/quotation drafts open at once */
        <div className="space-y-3">
          {/* Vyapar-style bill tab strip — tabs scroll; the New Sale action stays pinned */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 flex-1 min-w-0">
            {openBills.map((tab) => {
              const isActive = tab.id === activeBillId;
              const isQuote = tab.documentType === 'Quotation';
              return (
                <div
                  key={tab.id}
                  onClick={() => setActiveBillId(tab.id)}
                  className={cn(
                    'group flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-none border text-xs font-bold cursor-pointer whitespace-nowrap transition-colors shrink-0',
                    isActive
                      ? isQuote
                        ? 'bg-slate-800 text-white border-slate-900 shadow-none'
                        : 'bg-red-600 text-white border-red-700 shadow-none'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  )}
                >
                  {isQuote ? <FileText className="h-3.5 w-3.5 shrink-0" /> : <Receipt className="h-3.5 w-3.5 shrink-0" />}
                  <span className="max-w-[150px] truncate">{tab.label}</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); closeBillTab(tab.id, isQuote ? 'estimates' : 'ledger'); }}
                    className={cn(
                      'p-0.5 rounded-md transition-colors',
                      isActive ? 'text-white/80 hover:bg-white/20' : 'text-slate-400 hover:bg-slate-100'
                    )}
                    title="Close this bill"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
            </div>
            <button
              type="button"
              onClick={() => handleStartBlank('Invoice')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold whitespace-nowrap shrink-0 transition-colors border border-red-700"
              title="Start a new sale bill in another tab"
            >
              <Plus className="h-3.5 w-3.5" /> New Sale
            </button>
          </div>

          {/* Every open form stays mounted; only the active tab is shown so each
              in-progress bill keeps its state when you switch between them. */}
          {openBills.map((tab) => (
            <div key={tab.id} className={tab.id === activeBillId ? '' : 'hidden'}>
              <InvoiceForm
                initialInvoice={tab.editingInvoice}
                initialEstimate={tab.editingEstimate}
                convertedFromEstimate={tab.convertedEstimate}
                duplicateSourceInvoice={tab.duplicateSourceInvoice}
                duplicateSourceEstimate={tab.duplicateSourceEstimate}
                initialDocumentType={tab.documentType}
                onSaved={(inv) => handleSaved(tab, inv)}
                onSavedEstimate={(est) => handleSavedEstimate(tab, est)}
                onSaveDraft={(doc, kind) => handleSaveDraft(tab, doc, kind)}
                onPreviewPdf={(inv) => setPreviewInvoice(inv)}
                onPreviewEstimatePdf={(est) => setPreviewEstimate(est)}
                onCancel={() => closeBillTab(tab.id, tab.documentType === 'Quotation' ? 'estimates' : 'ledger')}
              />
            </div>
          ))}
        </div>
      ) : activeTab === 'draft-sales' ? (
        <DraftList
          kind="Invoice"
          drafts={draftSales}
          onResume={handleResumeDraft}
          onDelete={handleDeleteDraft}
          onCreate={() => handleStartBlank('Invoice')}
        />
      ) : activeTab === 'draft-quotes' ? (
        <DraftList
          kind="Quotation"
          drafts={draftQuotes}
          onResume={handleResumeDraft}
          onDelete={handleDeleteDraft}
          onCreate={() => handleStartBlank('Quotation')}
        />
      ) : activeTab === 'challans' ? (
        /* DELIVERY CHALLANS — embedded inside Sales (not a separate section) */
        <DeliveryChallanView key={challanTab} initialTab={challanTab} />
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
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
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
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[11px] tracking-wider">
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
                            className="px-4 py-1.5 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white rounded-none border border-red-700 font-bold text-xs uppercase tracking-wider shadow-none transition-colors cursor-pointer"
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
                          <span className="font-bold text-slate-900 block">{est.estimateNumber}</span>
                          {est.sourceEnquiryNumber && (
                            <span
                              className="text-[11px] text-red-700 font-medium block truncate mt-0.5"
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
                          <span className="text-[11px] text-slate-400 pl-4">{est.time}</span>
                        </td>
                        <td className="py-3.5 px-4 uppercase font-mono text-[11px] text-slate-600">
                          {BRANCHES.find((b) => b.id === est.branchId)?.shortCode || est.branchId}
                        </td>
                        <td className="py-3.5 px-4">
                          {est.withGst ? (
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                              With GST
                            </span>
                          ) : (
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                              Without Tax
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-sm text-slate-900">
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
          {/* Slim toolbar: quick search + at-a-glance totals. Date-range, payment
              mode & status filtering (and CSV export) live in the Reports section. */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="relative w-full lg:max-w-md">
              <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search sale by Customer, Invoice No, Phone, or Item..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 text-xs focus:outline-none focus:border-blue-600"
              />
            </div>

            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="text-slate-500">
                Showing <strong>{filteredInvoices.length}</strong> sales
              </span>
              <span className="text-slate-300">•</span>
              <span className="font-bold text-slate-900">
                Net Active: <span className="text-emerald-700 font-bold font-mono">{formatCurrency(totalGrossRevenue)}</span>
              </span>
              {voidedCount > 0 && (
                <span className="text-[11px] text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded font-bold border border-rose-200">
                  {voidedCount} Voided
                </span>
              )}
            </div>
          </div>

          {/* SALES LEDGER TABLE */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[11px] tracking-wider">
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
                          {searchQuery
                            ? 'Try clearing your search query.'
                            : 'Start by clicking "+ New Sale" to issue your first invoice.'}
                        </p>
                        <div className="mt-4 flex justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleStartBlank('Invoice')}
                            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-none border border-red-700 font-bold text-xs shadow-none cursor-pointer"
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
                              <span className="text-[11px] text-slate-400 block truncate mt-0.5">
                                From Quote #{inv.sourceEstimateNumber}
                              </span>
                            )}
                            {inv.sourceEnquiryNumber && (
                              <span className="text-[11px] text-red-700 font-medium block truncate mt-0.5">
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
                            <span className="text-[11px] text-slate-400 pl-4">{inv.time}</span>
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
                                      className="inline-flex items-center gap-1 font-mono font-bold text-slate-800 bg-slate-100 border border-slate-300 px-2 py-0.5 rounded-none text-[11px] cursor-help uppercase tracking-wider"
                                    >
                                      <Split className="h-2.5 w-2.5 text-slate-600" />
                                      <span>Split ({splits.length})</span>
                                    </span>
                                    <div className="text-[11px] text-slate-500 font-mono flex flex-wrap gap-1">
                                      {splits.map((s, idx) => (
                                        <span key={idx} className="bg-slate-50 px-1 py-0.2 rounded-none border border-slate-200">
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
                            {(() => {
                              // Consistent, return-aware paid/balance (single finance-truth).
                              const fin = computeInvoiceFinance(inv);
                              if (fin.due <= 0 && fin.customerCredit <= 0) return null;
                              return (
                                <div className={`text-[11px] font-bold mt-0.5 ${fin.due > 0 ? 'text-amber-700' : 'text-blue-700'}`}>
                                  {fin.due > 0
                                    ? `Paid: ₹${fin.received.toLocaleString('en-IN')} (Bal: ₹${fin.due.toLocaleString('en-IN')})`
                                    : `Credit due to customer: ₹${fin.customerCredit.toLocaleString('en-IN')}`}
                                </div>
                              );
                            })()}
                          </td>

                          {/* Total (Clean, unmodified original amount) */}
                          <td className="py-3.5 px-4 text-right font-mono">
                            <span
                              className={cn(
                                'font-bold text-sm block',
                                isVoided ? 'line-through text-slate-400' : 'text-slate-900'
                              )}
                            >
                              {formatCurrency(inv.grandTotal)}
                            </span>
                          </td>

                          {/* Status & Clean Return Badge */}
                          <td className="py-3.5 px-4 text-center">
                            <div className="flex items-center justify-center gap-1.5 flex-wrap">
                              <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full border', status.color)}>
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
                                    'inline-flex items-center gap-1 text-[11px] font-extrabold uppercase px-2 py-0.5 rounded-full border shadow-2xs transition-all hover:scale-105 cursor-pointer',
                                    isInvoiceFullyReturned(inv)
                                      ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                                      : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                                  )}
                                  title="Click to view Return Voucher details"
                                >
                                  <RotateCcw className="h-2.5 w-2.5" />
                                  <span>
                                    {isInvoiceFullyReturned(inv)
                                      ? 'Fully Returned'
                                      : 'Partial Return'}
                                  </span>
                                </button>
                              )}
                            </div>
                            {isVoided && inv.voidReason && (
                              <span className="block text-[11px] text-rose-500 truncate max-w-[120px] mx-auto mt-0.5" title={inv.voidReason}>
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
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md shadow-2xl overflow-hidden p-4 sm:p-6 space-y-4">
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
<strong>Audit Rule:</strong> This sale will be excluded from the Daily Cash Register and Reports, but will remain visible in the Sales Ledger flagged as Voided.
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

// ---- Saved Drafts list (work-in-progress sales / quotes) ----

interface DraftListProps {
  kind: 'Invoice' | 'Quotation';
  drafts: SalesDraft[];
  onResume: (draft: SalesDraft) => void;
  onDelete: (draftId: string) => void;
  onCreate: () => void;
}

const DraftList: React.FC<DraftListProps> = ({ kind, drafts, onResume, onDelete, onCreate }) => {
  const isQuote = kind === 'Quotation';
  const label = isQuote ? 'Quote' : 'Sale';

  return (
    <div className="bg-white border border-slate-300 rounded-none overflow-hidden shadow-none">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Save className="h-4 w-4 text-slate-700" />
          <h3 className="text-sm font-bold text-slate-800">
            Saved {isQuote ? 'Quotes' : 'Sales'} (Drafts)
          </h3>
        </div>
        <p className="text-[11px] text-slate-400">
          {isQuote
            ? 'Parked, not yet finalized. Resume to review and issue the quotation (no stock impact).'
            : 'Parked, not yet finalized. Resume to commit stock & issue a final invoice number.'}
        </p>
      </div>

      {drafts.length === 0 ? (
        <div className="py-12 text-center text-slate-400">
          <Save className="h-8 w-8 mx-auto text-slate-300 mb-2" />
          <p className="font-bold text-sm text-slate-700">No saved {isQuote ? 'quotes' : 'sales'} yet</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Use <strong>Save Draft</strong> inside a New {label} to park work here.
          </p>
          <div className="mt-4">
            <button
              type="button"
              onClick={onCreate}
              className={cn(
                'px-4 py-2 rounded-none font-bold text-xs uppercase tracking-wider shadow-none text-white transition-colors cursor-pointer border',
                isQuote ? 'bg-slate-800 hover:bg-slate-900 border-slate-900' : 'bg-red-600 hover:bg-red-700 border-red-700'
              )}
            >
              + New {label}
            </button>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold uppercase text-[11px] tracking-wider">
                <th className="py-3 px-4">{label} No (Provisional)</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Branch</th>
                <th className="py-3 px-4">Saved</th>
                <th className="py-3 px-4 text-right">Amount</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {drafts.map((d) => {
                // Recompute the card total with CURRENT tax logic so it always
                // matches what Resume will show (avoids a stale stored total
                // when the money rules changed after the draft was saved).
                const doc = d.data as any;
                const recomputedTotal = doc?.items
                  ? calculateInvoiceTotals(
                      doc.items,
                      !!doc.withGst,
                      doc.overallDiscountType || '%',
                      doc.overallDiscountValue || 0,
                      doc.shippingCharges || 0,
                      doc.roundOffEnabled ?? true
                    ).grandTotal
                  : d.grandTotal;
                return (
                <tr key={d.draftId} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-3 px-4 font-mono font-bold text-slate-700">{d.number || '—'}</td>
                  <td className="py-3 px-4 font-bold text-slate-900">{d.customerName}</td>
                  <td className="py-3 px-4 uppercase font-mono text-[11px] text-slate-600">
                    {BRANCHES.find((b) => b.id === d.branchId)?.shortCode || d.branchId}
                  </td>
                  <td className="py-3 px-4 text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3 text-slate-400" />
                      {new Date(d.savedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                    {formatCurrency(recomputedTotal)}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => onResume(d)}
                        title={`Resume this ${label.toLowerCase()} draft`}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-none border border-slate-300 text-[11px] font-bold uppercase tracking-wider bg-white hover:bg-slate-100 text-slate-800 transition-colors cursor-pointer"
                      >
                        <PlayCircle className="h-3.5 w-3.5 text-slate-600" />
                        <span>Resume</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Delete this saved ${label.toLowerCase()} draft?`)) onDelete(d.draftId);
                        }}
                        title="Delete draft"
                        className="p-1 rounded-none bg-white hover:bg-red-50 hover:text-red-700 text-slate-400 border border-slate-300 transition-colors cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
