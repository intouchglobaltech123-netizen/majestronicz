import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useErp } from '../../context/ErpContext';
import { HistoryLoadingHint } from '../common/HistoryLoadingHint';
import { Invoice, Estimate, BranchId, BRANCHES, getInvoicePaymentSplits, isInvoiceFullyReturned, computeInvoiceFinance } from '../../types';
import { formatCurrency, cn, getTodayDateString } from '../../lib/utils';
import { ListExportBar } from '../common/ListExportBar';
import { SALES_EXPORT_HEADERS, salesExportRows } from '../../lib/salesExport';
import { SalesDraft, loadDrafts, upsertDraft, deleteDraft as removeDraft, newDraftId } from '../../lib/salesDrafts';
import { calculateInvoiceTotals } from '../../lib/taxCalculations';
import { periodSales } from '../../lib/reportMath';
import { InvoiceForm } from './InvoiceForm';
import { InvoicePdfModal } from './InvoicePdfModal';
import { PaymentHistoryModal, InvoiceHistoryModal, ChallanPreviewModal, EInvoiceModal } from './InvoiceInfoModals';
import { ConvertEstimateModal } from './ConvertEstimateModal';
import { SaleReturnModal } from './SaleReturnModal';
import { ImportQuotationModal } from './ImportQuotationModal';
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
  ReceiptText,
  MoreVertical,
  Share2,
  Eye,
  FileSpreadsheet,
} from 'lucide-react';
import { toast } from 'sonner';
import { createPortal } from 'react-dom';
import { printThermalReceipt } from '../../lib/thermalReceipt';
import { ThermalSettingsModal } from './ThermalSettingsModal';

// Share a bill summary on WhatsApp (same text as the in-form Share button).
const shareInvoiceOnWhatsApp = (inv: Invoice) => {
  const splits = getInvoicePaymentSplits(inv);
  const modeText = splits.length > 1
    ? splits.map((s) => `${s.mode}: ₹${s.amount.toLocaleString('en-IN')}`).join(' + ')
    : inv.paymentMode;
  const text = `*SALES INVOICE — MAJESTRONICZ*\nInvoice: ${inv.invoiceNumber}\nDate: ${inv.date}\nCustomer: ${inv.customerName || '-'}\nGrand Total: ₹${(inv.grandTotal || 0).toLocaleString('en-IN')}\nPayment: ${modeText}\nThank you for doing business with Majestronicz!`;
  window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
};

type RowMenuItem = {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
};

// A compact 3-dot (kebab) actions menu for a list row. The menu opens in a fixed
// portal so the table's horizontal scroll never clips it.
const RowActionsMenu: React.FC<{ items: RowMenuItem[] }> = ({ items }) => {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);

  const place = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const W = 210;
    const left = Math.max(8, Math.min(r.right - W, window.innerWidth - W - 8));
    const spaceBelow = window.innerHeight - r.bottom;
    const needed = Math.min(360, items.length * 38 + 12);
    if (spaceBelow < needed && r.top > spaceBelow) {
      setPos({ bottom: window.innerHeight - r.top + 4, left });
    } else {
      setPos({ top: r.bottom + 4, left });
    }
  };

  useEffect(() => {
    if (!open) return;
    place();
    const onMove = () => place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        title="More actions"
        className="p-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 transition-colors cursor-pointer"
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] w-[210px] bg-white border border-slate-200 rounded-xl shadow-2xl py-1 overflow-hidden"
          style={{ top: pos.top, bottom: pos.bottom, left: pos.left }}
        >
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              onClick={(e) => { e.stopPropagation(); setOpen(false); it.onClick(); }}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-semibold transition-colors',
                it.danger ? 'text-rose-700 hover:bg-rose-50' : 'text-slate-700 hover:bg-slate-50'
              )}
            >
              <span className={cn('shrink-0', it.danger ? 'text-rose-500' : 'text-slate-400')}>{it.icon}</span>
              <span>{it.label}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
};

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
  /** Stable draft id for this tab — the bill auto-saves to Saved Drafts under
   *  this id as it is typed (no manual "Save Draft" needed). */
  autoDraftId?: string;
  /** SAL4-13: the form's latest contents, kept so a page reload restores the tab with its lines. */
  workingCopy?: Invoice | Estimate | null;
}

interface Props {
  initialTab?: 'ledger' | 'estimates' | 'returns';
}

type QuoteLifecycle = 'Open' | 'Converted' | 'Cancelled';

/** Numeric sequence of a bill number (the trailing digits, e.g. MZERD26-27/11299 → 11299),
 *  used to order the ledger by the true bill sequence instead of save time. */
const invSeq = (n?: string): number => {
  const m = /(\d+)\s*$/.exec(String(n || ''));
  return m ? parseInt(m[1], 10) : -1;
};

export const InvoiceView: React.FC<Props> = ({ initialTab = 'ledger' }) => {
  const {
    invoices,
    estimates,
    deleteEstimate,
    cancelEstimate,
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
    payments,
    companyProfile,
    openingGpayByBranch,
    employees,
    historyLoading,
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
          // SAL4-13: a tab comes back with what was typed into it — its last
          // working copy reopens like a parked draft.
          const openBills = (p.openBills as BillTab[]).map((t) => {
            const base = t.workingCopy
              ? {
                  ...t,
                  editingInvoice: t.documentType === 'Invoice' ? (t.workingCopy as Invoice) : null,
                  editingEstimate: t.documentType === 'Quotation' ? (t.workingCopy as Estimate) : null,
                  convertedEstimate: null, duplicateSourceInvoice: null, duplicateSourceEstimate: null,
                }
              : t;
            // Every restored tab keeps (or gets) a draft id so auto-draft continues.
            return { ...base, autoDraftId: t.autoDraftId ?? t.resumedDraftId ?? newDraftId() } as BillTab;
          });
          return { openBills, activeBillId: p.activeBillId ?? null, activeTab: p.activeTab ?? null };
        }
      }
    } catch { /* ignore */ }
    return { openBills: [], activeBillId: null, activeTab: null };
  };

  const [activeTab, setActiveTab] = useState<'ledger' | 'estimates' | 'returns' | 'new' | 'draft-sales' | 'draft-quotes' | 'challans'>(() => {
    const p = readPersistedBills();
    // If any bill tab is open, ALWAYS come up on the billing form — never drop
    // to the ledger on a (re)mount (e.g. an error-boundary recovery under heavy
    // load). This stops the "billing screen suddenly jumps to Sales Invoices".
    return p.openBills.length > 0 ? 'new' : initialTab;
  });
  // Which challan sub-tab to show when the embedded Delivery Challans tab is open.
  const [challanTab, setChallanTab] = useState<'new' | 'history'>('history');
  const [showPrintSettings, setShowPrintSettings] = useState(false);
  const [showImportQuote, setShowImportQuote] = useState(false);

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
  const tabStripRef = useRef<HTMLDivElement>(null);

  // Auto horizontal-scroll the tab strip so the active bill tab is always in view
  // (e.g. after clicking "New Sale", which appends and activates a new tab).
  useEffect(() => {
    if (!activeBillId) return;
    const strip = tabStripRef.current;
    if (!strip) return;
    requestAnimationFrame(() => {
      const el = strip.querySelector<HTMLElement>(`[data-bill-id="${activeBillId}"]`);
      el?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    });
  }, [activeBillId, openBills.length]);

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
  // Row 3-dot menu modals: Payment History, Bill History (audit), Delivery
  // Challan preview, and Generate e-Invoice (NIC JSON).
  const [paymentHistoryInvoice, setPaymentHistoryInvoice] = useState<Invoice | null>(null);
  const [historyInvoice, setHistoryInvoice] = useState<Invoice | null>(null);
  const [challanInvoice, setChallanInvoice] = useState<Invoice | null>(null);
  const [eInvoiceInvoice, setEInvoiceInvoice] = useState<Invoice | null>(null);
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
      // Resumed drafts keep their id; a fresh bill gets a new one so it starts
      // auto-saving to Saved Drafts the moment it has content.
      autoDraftId: seed.resumedDraftId ?? newDraftId(),
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
        // Deep link from global search → filter the list straight to that record.
        if (activeSubTab.search) setSearchQuery(activeSubTab.search);
      } else if (tab === 'new') {
        openBillTab({ documentType: 'Invoice' });
      } else if (tab === 'open-bills') {
        // SAL4-13: a reload on the billing screen returns to the restored tabs.
        if (openBills.length) setActiveTab('new');
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

  // ---- Auto-draft: a bill saves itself to Saved Drafts as it is typed -------
  // No manual "Save Draft" button. The moment a bill has a customer or a product
  // line it is parked (debounced) under its tab's draft id, so nothing in
  // progress is ever lost. The draft is removed when the bill is committed, or
  // when the staff explicitly close/cancel the tab (that is "discard").
  const autoDraftTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const autoSaveDraft = (tab: BillTab, doc: Invoice | Estimate) => {
    const id = tab.autoDraftId || tab.resumedDraftId;
    if (!id) return;
    const hasContent = !!(
      (doc.customerName || '').trim() ||
      ((doc as Invoice).customerPhone || '').trim() ||
      (doc.items || []).some((it) => (it.itemName || '').trim())
    );
    if (autoDraftTimers.current[tab.id]) clearTimeout(autoDraftTimers.current[tab.id]);
    autoDraftTimers.current[tab.id] = setTimeout(() => {
      if (!hasContent) return;
      const isInvoice = tab.documentType === 'Invoice';
      const draft: SalesDraft = {
        draftId: id,
        kind: tab.documentType,
        savedAt: new Date().toISOString(),
        customerName: doc.customerName || 'Unnamed',
        number: isInvoice ? (doc as Invoice).invoiceNumber : (doc as Estimate).estimateNumber,
        grandTotal: doc.grandTotal || 0,
        branchId: doc.branchId,
        data: doc,
      };
      setDrafts(upsertDraft(draftUserKey, draft));
    }, 1200);
  };
  const dropAutoDraft = (tab: BillTab) => {
    if (autoDraftTimers.current[tab.id]) { clearTimeout(autoDraftTimers.current[tab.id]); delete autoDraftTimers.current[tab.id]; }
    const id = tab.autoDraftId || tab.resumedDraftId;
    if (id) setDrafts(removeDraft(draftUserKey, id));
  };

  // Close a tab. The in-progress bill STAYS parked in Saved Drafts (auto-draft),
  // so closing a tab never loses it — reopen it from Saved Drafts, or delete it
  // there to discard. Only committing the bill clears its draft.
  const closeBillTab = (id: string, fallbackTab: 'ledger' | 'estimates' = 'ledger') => {
    const closing = openBills.find((t) => t.id === id);
    // Stop any pending debounced write, but keep whatever is already drafted.
    if (closing && autoDraftTimers.current[closing.id]) { clearTimeout(autoDraftTimers.current[closing.id]); delete autoDraftTimers.current[closing.id]; }
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
  // SAL4-13: compare with the previous value (not "first run"), so React's
  // development double-run of effects doesn't switch a restored billing screen
  // back to the list.
  const prevInitialTabRef = useRef(initialTab);
  useEffect(() => {
    if (prevInitialTabRef.current === initialTab) return;
    prevInitialTabRef.current = initialTab;
    // Don't yank an active biller to the ledger: if a bill is open and the user
    // is on the form, a prop flip (e.g. a deferred re-render under heavy load)
    // must not switch the screen to the list.
    if (initialTab === 'ledger' && openBills.length > 0 && activeTab === 'new') return;
    if (initialTab) {
      setActiveTab(initialTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  // Void confirmation modal state
  const [voidModalInvoice, setVoidModalInvoice] = useState<Invoice | null>(null);
  const [voidReason, setVoidReason] = useState('Customer cancellation / Order return');

  // If redirected with an estimate to convert, open a new Sale tab for it.
  useEffect(() => {
    if (estimateToConvert) {
      // An enquiry conversion carries the enquiry number (already "ENQ-…") — label it as such (E2E6-8).
      const fromEnquiry = estimateToConvert.id.startsWith('est-conv-') && estimateToConvert.sourceEnquiryNumber
        && !estimates.some((e) => e.id === estimateToConvert.id);
      openBillTab({ documentType: 'Invoice', convertedEstimate: estimateToConvert, label: fromEnquiry ? `Bill ${estimateToConvert.sourceEnquiryNumber}` : `Convert ${estimateToConvert.estimateNumber}` });
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
  // SAL4-10: with thousands of bills, filter on a debounced copy of the search
  // and render one page of rows at a time — the whole ledger re-rendered on
  // every keystroke (55 s to open with 5,000 bills, minutes to search).
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 250);
    return () => clearTimeout(t);
  }, [searchQuery]);
  const LEDGER_PAGE = 100;
  const [ledgerPage, setLedgerPage] = useState(0);
  // Date filter for the sales ledger: defaults to TODAY only, so the list opens
  // showing just today's bills. Pick any single date (From = To) or a range to
  // see that day's / period's bills. Empty = unbounded on that side.
  const [ledgerFrom, setLedgerFrom] = useState<string>(() => getTodayDateString());
  const [ledgerTo, setLedgerTo] = useState<string>(() => getTodayDateString());
  // Ledger quick filters: payment mode ('ALL' or a mode like Cash/HDFC) and
  // status ('ALL' | Paid | Partial | Credit | Cancelled).
  const [paymentModeFilter, setPaymentModeFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'Paid' | 'Partial' | 'Credit' | 'Cancelled'>('ALL');
  // The ledger keeps a quick search; branch follows the global top-bar toggle.
  const [branchFilter, setBranchFilter] = useState<'ALL' | BranchId>(() =>
    isAllBranches ? 'ALL' : (currentBranch as BranchId)
  );

  // Sales channel scope: a branch's own counter bills are kept SEPARATE from
  // online (Shopify) orders so their counts, sales and profit never mix. Default
  // 'store' = this branch's own bills only; 'online' = Shopify only; 'all' = both.
  const [channelScope, setChannelScope] = useState<'store' | 'online' | 'all'>('store');
  const inChannel = (inv: Invoice) => {
    // Any online-origin bill (shopify, shopify-demo, …) counts as ONLINE, so an
    // online order can never leak into the counter "Store bills" sales totals.
    const isOnline = String(inv.sourceChannel || '').startsWith('shopify');
    return channelScope === 'all' ? true : channelScope === 'online' ? isOnline : !isOnline;
  };

  // Keep branchFilter in sync when user toggles branch in global top bar
  useEffect(() => {
    if (!isAllBranches) {
      setBranchFilter(currentBranch as BranchId);
    }
  }, [currentBranch, isAllBranches]);

  // Helper for computing sale status — uses the single finance-truth (nets returns).
  const getSaleStatus = (inv: Invoice): { label: string; color: string } => {
    if (inv.isVoided) {
      return { label: 'Cancelled', color: 'bg-rose-50 text-rose-700 border-rose-200' };
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

      // Channel filter — keep store (counter) bills separate from online orders.
      if (!inChannel(inv)) return false;

      // Date filter — show only bills within the chosen range (defaults to today).
      // Slice to the date part (YYYY-MM-DD) so a bill whose date ever carries a
      // time component is still counted on its day — the end date stays INCLUSIVE.
      const d = (inv.date || '').slice(0, 10);
      if (ledgerFrom && d < ledgerFrom) return false;
      if (ledgerTo && d > ledgerTo) return false;

      // Search filter (Invoice No, Customer, Phone, Items)
      if (debouncedSearch.trim()) {
        const q = debouncedSearch.toLowerCase().trim();
        const matchesCustomer = (inv.customerName || '').toLowerCase().includes(q);
        const matchesNumber = inv.invoiceNumber.toLowerCase().includes(q);
        const matchesPhone = inv.customerPhone && inv.customerPhone.includes(q);
        const matchesItem = inv.items.some(
          (it) => (it.itemName || '').toLowerCase().includes(q) || (it.itemCode && it.itemCode.toLowerCase().includes(q))
        );
        if (!matchesCustomer && !matchesNumber && !matchesPhone && !matchesItem) {
          return false;
        }
      }

      // Payment-mode filter — matches a bill if ANY of its payment splits use the
      // chosen mode (so a split bill paying part in Cash shows under "Cash" too).
      if (paymentModeFilter !== 'ALL') {
        const want = paymentModeFilter.toLowerCase();
        const modes = getInvoicePaymentSplits(inv).map((s) => (s.mode || '').toLowerCase());
        if (!modes.includes(want) && (inv.paymentMode || '').toLowerCase() !== want) return false;
      }

      // Status filter — Paid / Partial / Credit / Cancelled (same label the row shows).
      if (statusFilter !== 'ALL' && getSaleStatus(inv).label !== statusFilter) return false;

      return true;
    }).sort((a, b) => {
      // Order by DATE (newest first), then strictly by invoice NUMBER (highest
      // first) so the ledger never shuffles within a day — the number is the true
      // sequence; a bill's createdAt can differ from its number (the server
      // assigns the number at save, so saves/retries don't always match creation
      // order). createdAt is only a final tie-break if two share a number.
      const d = (b.date || '').localeCompare(a.date || '');
      if (d !== 0) return d;
      const s = invSeq(b.invoiceNumber) - invSeq(a.invoiceNumber);
      if (s !== 0) return s;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  }, [invoices, branchFilter, isAllBranches, currentBranch, debouncedSearch, channelScope, ledgerFrom, ledgerTo, paymentModeFilter, statusFilter]);
  // Back to the first page whenever the list itself changes shape.
  useEffect(() => { setLedgerPage(0); }, [branchFilter, currentBranch, isAllBranches, debouncedSearch, channelScope, ledgerFrom, ledgerTo, paymentModeFilter, statusFilter]);
  const ledgerPages = Math.max(1, Math.ceil(filteredInvoices.length / LEDGER_PAGE));
  const safeLedgerPage = Math.min(ledgerPage, ledgerPages - 1);
  const pagedInvoices = useMemo(
    () => filteredInvoices.slice(safeLedgerPage * LEDGER_PAGE, (safeLedgerPage + 1) * LEDGER_PAGE),
    [filteredInvoices, safeLedgerPage],
  );

  // Distinct payment modes actually present (for the ledger's Payment Mode
  // filter dropdown) — scoped to branch + channel so the options match the list.
  const paymentModeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const inv of invoices) {
      if (!(branchFilter === 'ALL' ? isAllBranches || inv.branchId === currentBranch : inv.branchId === branchFilter)) continue;
      if (!inChannel(inv)) continue;
      for (const s of getInvoicePaymentSplits(inv)) if (s.mode) set.add(s.mode);
      if (inv.paymentMode) set.add(inv.paymentMode);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, branchFilter, isAllBranches, currentBranch, channelScope]);

  // ---- Quotation lifecycle (SAL8-3): Open → Converted (a live bill was made
  // from it) or Cancelled (with a reason). Converted is stored by the server and
  // also derived from the bills, so it is right even for older quotes.
  const convertedEstimateMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const inv of invoices) {
      if (inv.sourceEstimateId && !inv.isVoided) map.set(inv.sourceEstimateId, inv.invoiceNumber);
    }
    return map;
  }, [invoices]);
  const lifecycleOf = (est: Estimate): QuoteLifecycle =>
    convertedEstimateMap.has(est.id) ? 'Converted' : est.status === 'Cancelled' ? 'Cancelled' : 'Open';
  const [quoteStatusFilter, setQuoteStatusFilter] = useState<'all' | QuoteLifecycle>('all');
  const [cancelTarget, setCancelTarget] = useState<Estimate | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [deletingQuoteId, setDeletingQuoteId] = useState<string | null>(null);
  const isCeo = currentUser.role === 'CEO';
  const confirmCancelQuote = async () => {
    if (!cancelTarget || !cancelReason.trim()) return;
    await cancelEstimate(cancelTarget.id, cancelReason.trim());
    setCancelTarget(null);
    setCancelReason('');
  };

  // Filter estimates by search, branch scope and lifecycle
  const branchScopedEstimates = useMemo(
    () => estimates.filter((est) =>
      branchFilter === 'ALL' ? isAllBranches || est.branchId === currentBranch : est.branchId === branchFilter),
    [estimates, branchFilter, isAllBranches, currentBranch],
  );
  const quoteCounts = useMemo(() => {
    const c = { all: branchScopedEstimates.length, Open: 0, Converted: 0, Cancelled: 0 };
    for (const e of branchScopedEstimates) c[lifecycleOf(e)] += 1;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchScopedEstimates, convertedEstimateMap]);
  const filteredEstimates = useMemo(() => {
    return branchScopedEstimates.filter((est) => {
      if (quoteStatusFilter !== 'all' && lifecycleOf(est) !== quoteStatusFilter) return false;

      const q = estimateSearchQuery.trim().toLowerCase();
      if (!q) return true;

      return (
        est.customerName.toLowerCase().includes(q) ||
        est.estimateNumber.toLowerCase().includes(q) ||
        (est.customerContact && est.customerContact.includes(q))
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchScopedEstimates, estimateSearchQuery, quoteStatusFilter, convertedEstimateMap]);

  // Once a resumed draft is finalized (committed), remove it from the draft store.
  const handleSaved = (_tab: BillTab, _savedInvoice: Invoice) => {
    // Billing person's ask: after saving a bill, go STRAIGHT to the next bill —
    // no preview window to close each time. The 80mm thermal still auto-prints
    // when that device setting is on; any bill can be reprinted/previewed from
    // the list (thermal reprint button, or double-click to open).
    dropAutoDraft(_tab); // the bill is committed — its auto-draft is no longer needed
    // Keep the cashier IN billing after a new counter sale: move to the next
    // open tab, or open a fresh blank bill if none remain — never drop onto the
    // Invoice History list (that interrupted rapid billing after every bill).
    // Editing an existing bill is different: there we go back to the list.
    const wasEdit = !!_tab.editingInvoice;
    const remaining = openBills.filter((t) => t.id !== _tab.id);
    setOpenBills(remaining);
    if (remaining.length > 0) {
      if (activeBillId === _tab.id) {
        setActiveBillId(remaining[remaining.length - 1].id);
        setActiveTab('new');
      }
    } else if (wasEdit) {
      setActiveBillId(null);
      setActiveTab('ledger');
    } else {
      openBillTab({ documentType: _tab.documentType });
    }
  };

  const handleSavedEstimate = (tab: BillTab, savedEstimate: Estimate) => {
    dropAutoDraft(tab); // committed — clear its auto-draft
    setPreviewEstimate(savedEstimate);
    closeBillTab(tab.id, 'estimates');
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

  // SEC-6: voiding a bill is a Manager/CEO action.
  const canVoid = currentUser.role === 'CEO' || currentUser.role === 'Manager';
  // RPT10-4 / FIN-A-3: a bill of a month that has ended can't be voided or edited
  // (its sales and GST are reported) — a return / credit note is used instead.
  // Same rule as the server.
  const thisMonthIST = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 7);
  const monthEnded = (inv: Invoice) => String(inv.date || '').slice(0, 7) < thisMonthIST;

  const handleEdit = (invoice: Invoice) => {
    if (invoice.isVoided) {
      toast.error('Cannot edit a voided sale.');
      return;
    }
    if ((invoice.returns || []).some((r) => (r.returnedQuantity || 0) > 0)) {
      toast.error('This bill has returns and cannot be edited.', { description: 'Reverse the return(s) first (Manager/CEO).' });
      return;
    }
    if (monthEnded(invoice)) {
      toast.error("This bill's month has ended — it can't be edited.", { description: 'Use a return / credit note instead.' }); // FIN-A-3
      return;
    }
    // If this invoice is already open in a tab, focus it instead of duplicating.
    const existing = openBills.find((t) => t.editingInvoice?.id === invoice.id);
    if (existing) { setActiveBillId(existing.id); setActiveTab('new'); return; }
    openBillTab({ documentType: 'Invoice', editingInvoice: invoice, label: invoice.invoiceNumber });
  };

  // Double-clicking a bill row opens it in the editable billing screen (#4).
  // A bill that can't be edited (voided / has returns / past month) opens its
  // PDF instead, so the row is never a dead end.
  const openBillRow = (invoice: Invoice) => {
    const editable = !invoice.isVoided
      && !((invoice.returns || []).some((r) => (r.returnedQuantity || 0) > 0))
      && !monthEnded(invoice);
    if (editable) handleEdit(invoice);
    else { setPreviewInvoice(invoice); toast.info("This bill can't be edited (voided / returned / past month) — opening the PDF."); }
  };

  const handleEditEstimate = (estimate: Estimate) => {
    // Only an Open quote can be edited (the server refuses the others too).
    if (lifecycleOf(estimate) !== 'Open') {
      toast.error(`Quotation ${estimate.estimateNumber} is ${lifecycleOf(estimate).toLowerCase()} and can't be edited.`);
      return;
    }
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
    if (lifecycleOf(est) !== 'Open') {
      toast.error(`Quotation ${est.estimateNumber} is ${lifecycleOf(est).toLowerCase()} and can't be billed.`);
      return;
    }
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
  // SAL10-9: the money cards are what came in TODAY by mode — bills' own
  // split, plus receipts taken today, less refunds paid today — and "Sales" is
  // today's sales on the report rule (returns on the day they happen).
  const todayStats = useMemo(() => {
    const todayStr = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const inScope = (b: string) => isAllBranches || b === currentBranch;
    const scoped = invoices.filter((i) => !i.isVoided && i.date === todayStr && inScope(i.branchId) && inChannel(i));
    // Normalise a payment mode to a display bucket. Cash & GPay have synonyms;
    // every OTHER mode (HDFC, IOB, Card, Online, …) keeps its own name so NO mode
    // is ever dropped. A custom bank mode like IOB used to vanish from the money
    // tiles entirely because only cash/gpay/hdfc were recognised (owner, Oct 2026).
    const norm = (m: string) => {
      const x = String(m || '').trim().toLowerCase();
      if (x === 'cash') return 'Cash';
      if (x === 'gpay' || x === 'upi' || x === 'google pay' || x === 'googlepay') return 'GPay';
      return String(m || '').trim() || 'Other';
    };
    const isStoreCredit = (m: string) => { const x = String(m || '').trim().toLowerCase(); return x === 'cod-credit' || x === 'store credit' || x === 'store-credit' || x === 'credit'; };
    const by: Record<string, number> = {};
    let credit = 0;
    for (const inv of scoped) {
      for (const s of getInvoicePaymentSplits(inv)) {
        if (s.mode === 'COD-Credit') credit += Number(s.amount) || 0;
        else { const k = norm(s.mode); by[k] = (by[k] || 0) + (Number(s.amount) || 0); }
      }
    }
    // AUDIT SEPARATION: a customer receipt belongs to the channel of the bill it
    // was collected against. A receipt fully allocated to online (Shopify) orders
    // is ONLINE money; everything else (counter bills, advances, on-account) is
    // STORE money. So the Store metrics never include a paisa of Shopify receipts,
    // and the Online view shows only Shopify — clean for daily audit.
    const onlineInvoiceIds = new Set(
      invoices.filter((i) => String(i.sourceChannel || '').startsWith('shopify')).map((i) => i.id),
    );
    const paymentIsOnline = (p: any) =>
      Array.isArray(p.allocations) && p.allocations.length > 0 &&
      p.allocations.every((a: any) => a && onlineInvoiceIds.has(a.refId));
    const paymentInChannel = (p: any) =>
      channelScope === 'all' ? true : channelScope === 'online' ? paymentIsOnline(p) : !paymentIsOnline(p);
    for (const p of payments) {
      if (p.partyType !== 'customer' || p.date !== todayStr || !inScope(p.branchId) || !paymentInChannel(p)) continue;
      if (isStoreCredit(p.paymentMode)) continue; // store credit moves no real money
      const k = norm(p.paymentMode);
      by[k] = (by[k] || 0) + (p.type === 'in' ? Number(p.amount) || 0 : -(Number(p.amount) || 0));
    }
    const amount = periodSales(invoices.filter((i) => inScope(i.branchId) && inChannel(i)), (d) => d === todayStr).net;
    // One money tile per mode actually in use — Cash/GPay/HDFC always shown (the
    // staples), then any other configured mode (IOB, …) with money. Nothing drops.
    const PREFERRED = ['Cash', 'GPay', 'HDFC'];
    const others = Object.keys(by).filter((m) => !PREFERRED.includes(m)).sort((a, b) => (by[b] || 0) - (by[a] || 0));
    const modes = [...PREFERRED, ...others]
      .filter((m) => PREFERRED.includes(m) || Math.abs(by[m] || 0) > 0.004)
      .map((m) => ({ mode: m, amount: by[m] || 0 }));
    return { count: scoped.length, amount, modes, credit };
  }, [invoices, payments, isAllBranches, currentBranch, channelScope]);

  // Running GPay/UPI balance: the go-live opening balance per branch (set by the
  // owner) PLUS every GPay rupee in and minus every GPay rupee out on/after its
  // start date — like a bank account that carries forward, unlike the per-day
  // GPay tile. Shown only when an opening balance has been configured.
  const gpayBalance = useMemo(() => {
    const cfg = openingGpayByBranch || {};
    const branchIds = isAllBranches ? Object.keys(cfg) : [String(currentBranch)];
    const isGpay = (m: string) => { const x = String(m || '').trim().toLowerCase(); return x === 'gpay' || x === 'upi'; };
    let configured = false;
    let bal = 0;
    for (const b of branchIds) {
      const open = cfg[b];
      if (!open) continue;
      configured = true;
      bal += Number(open.amount) || 0;
      const since = String(open.date || '');
      for (const inv of invoices) {
        if (inv.isVoided || inv.branchId !== b || String(inv.date || '') < since) continue;
        for (const s of getInvoicePaymentSplits(inv)) if (isGpay(s.mode)) bal += Number(s.amount) || 0;
      }
      for (const p of payments) {
        if (p.branchId !== b || String(p.date || '') < since || !isGpay(p.paymentMode)) continue;
        bal += p.type === 'in' ? (Number(p.amount) || 0) : -(Number(p.amount) || 0);
      }
    }
    return { configured, amount: Math.round(bal * 100) / 100 };
  }, [openingGpayByBranch, invoices, payments, isAllBranches, currentBranch]);

  return (
    <div className="p-4 sm:p-6 space-y-6 w-full">
      {/* Top Banner & Module Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="shrink-0">
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
                  : 'All tax invoices, newest first — search any bill, or use Reports for a date range'}
                {activeTab !== 'new' && <HistoryLoadingHint />}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowPrintSettings(true)}
              title="Thermal printer settings (paper width, auto-print)"
              className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-[11px] font-bold hover:bg-slate-50"
            >
              <ReceiptText className="h-3.5 w-3.5" /> Printer settings
            </button>
        </div>

        {/* Multi-tab bill strip — inline on the RIGHT of the heading, horizontal scroll */}
        {activeTab === 'new' && (
          <div ref={tabStripRef} className="flex-1 min-w-0 flex items-center gap-2.5 overflow-x-auto no-scrollbar py-1">
            {openBills.map((tab) => {
              const isActive = tab.id === activeBillId;
              const isQuote = tab.documentType === 'Quotation';
              // Show the CUSTOMER NAME on the tab once it's entered (from the
              // live working copy / the bill being edited) so staff can tell
              // whose bill is which when many tabs are open; else "Sale N".
              const custName = (
                (tab.workingCopy as { customerName?: string } | undefined)?.customerName
                || tab.editingInvoice?.customerName
                || tab.editingEstimate?.customerName
                || ''
              ).trim();
              const tabLabel = custName && custName.toLowerCase() !== 'walk-in customer' ? custName : tab.label;
              return (
                <div
                  key={tab.id}
                  data-bill-id={tab.id}
                  onClick={() => setActiveBillId(tab.id)}
                  className={cn(
                    // Bigger chips + a clear gap so staff don't mis-tap a neighbour.
                    'group flex items-center gap-2 pl-3.5 pr-1.5 py-2 rounded-lg border text-[12.5px] font-bold cursor-pointer whitespace-nowrap transition-colors shrink-0',
                    isActive
                      ? isQuote
                        ? 'bg-slate-800 text-white border-slate-900'
                        : 'bg-red-600 text-white border-red-700'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  )}
                >
                  {isQuote ? <FileText className="h-4 w-4 shrink-0" /> : <Receipt className="h-4 w-4 shrink-0" />}
                  <span className="max-w-[160px] truncate" title={tabLabel}>{tabLabel}</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); closeBillTab(tab.id, isQuote ? 'estimates' : 'ledger'); }}
                    // The ✕ only shows on the ACTIVE or hovered tab, so tapping a
                    // neighbour to switch can't accidentally close it.
                    className={cn(
                      'ml-0.5 p-1 rounded transition-opacity',
                      isActive ? 'opacity-100 text-white/80 hover:bg-white/20' : 'opacity-0 group-hover:opacity-100 text-slate-400 hover:bg-slate-100',
                    )}
                    title="Close this bill"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => handleStartBlank('Invoice')}
              className="flex items-center gap-1 px-2.5 py-1 rounded-none bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold whitespace-nowrap shrink-0 transition-colors border border-red-700"
              title="Start a new sale bill in another tab"
            >
              <Plus className="h-3 w-3" /> New Sale
            </button>
          </div>
        )}

        {/* Action Buttons specific to current sub-view */}
        <div className="flex items-center gap-2 gap-y-2 flex-wrap justify-end min-w-0">

          {activeTab !== 'new' && (
            <>
              <button
                type="button"
                onClick={() => handleStartBlank('Invoice')}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-none bg-red-600 hover:bg-red-700 text-white text-xs font-bold border border-red-700 transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Sale</span>
              </button>
              <button
                type="button"
                onClick={() => handleStartBlank('Quotation')}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-none bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold border border-slate-900 transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Quote</span>
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
      {/* MULTI-TAB BILLING — the billing forms stay MOUNTED while any bill is
          open, so switching to the ledger / returns / drafts and back never
          empties an in-progress bill. The block is HIDDEN (not unmounted) when
          the active tab isn't the billing form. Within it, only the active bill
          tab is shown so each open bill keeps its own state. */}
      {openBills.length > 0 && (
        <div className={cn('space-y-3', activeTab !== 'new' && 'hidden')}>
          {openBills.map((tab) => (
            <div key={tab.id} className={tab.id === activeBillId ? '' : 'hidden'}>
              <InvoiceForm
                isActive={tab.id === activeBillId}
                initialInvoice={tab.editingInvoice}
                initialEstimate={tab.editingEstimate}
                restoreSeed={tab.editingInvoice || tab.editingEstimate ? null : (tab.workingCopy ?? null)}
                convertedFromEstimate={tab.convertedEstimate}
                duplicateSourceInvoice={tab.duplicateSourceInvoice}
                duplicateSourceEstimate={tab.duplicateSourceEstimate}
                initialDocumentType={tab.documentType}
                onSaved={(inv) => handleSaved(tab, inv)}
                onSavedEstimate={(est) => handleSavedEstimate(tab, est)}
                onWorkingCopy={(doc) => {
                  setOpenBills((prev) => prev.map((t) => (t.id === tab.id ? { ...t, workingCopy: doc } : t)));
                  autoSaveDraft(tab, doc); // auto-draft as the bill is typed (no Save Draft button)
                }}
                onPreviewPdf={(inv) => setPreviewInvoice(inv)}
                onPreviewEstimatePdf={(est) => setPreviewEstimate(est)}
                onCancel={() => closeBillTab(tab.id, tab.documentType === 'Quotation' ? 'estimates' : 'ledger')}
                onBackToList={() => setActiveTab(tab.documentType === 'Quotation' ? 'estimates' : 'ledger')}
                canVoidBill={canVoid}
                onVoidBill={(inv) => { setVoidModalInvoice(inv); setVoidReason('Customer cancellation / Order return'); }}
              />
            </div>
          ))}
        </div>
      )}
      {activeTab === 'new' ? null : activeTab === 'draft-sales' ? (
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
          {/* Lifecycle filter: Open / Converted / Cancelled (SAL8-3) */}
          <div className="flex items-center gap-1.5 flex-wrap" role="tablist" aria-label="Quotation status">
            {(['all', 'Open', 'Converted', 'Cancelled'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={quoteStatusFilter === k}
                onClick={() => setQuoteStatusFilter(k)}
                className={cn(
                  'px-3 py-1.5 text-[11px] font-bold border rounded-none transition-colors cursor-pointer',
                  quoteStatusFilter === k ? 'bg-slate-800 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                )}
              >
                {k === 'all' ? 'All' : k} ({quoteCounts[k]})
              </button>
            ))}
            {/* Build a quotation from an uploaded Excel/CSV list of items. */}
            <button
              type="button"
              onClick={() => setShowImportQuote(true)}
              className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold border rounded-none bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700 transition-colors cursor-pointer"
              title="Upload an Excel/CSV list of items and turn it into a quotation"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>Import Excel/CSV → Quote</span>
            </button>
          </div>

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

            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Building className="h-4 w-4 text-blue-600" />
                <span>
                  Scope: <strong>{branchFilter === 'ALL' ? (isAllBranches ? 'All Branches' : currentBranchData?.name) : BRANCHES.find(b => b.id === branchFilter)?.name}</strong>
                </span>
              </div>
              <ListExportBar
                build={(from, to) => ({
                  headers: ['Date', 'Quote No', 'Customer', 'Phone', 'Branch', 'Grand Total (₹)', 'Status'],
                  rows: estimates
                    .filter((e) => (isAllBranches || e.branchId === currentBranch) && (!from || (e.date || '') >= from) && (!to || (e.date || '') <= to))
                    .sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : -1))
                    .map((e) => [e.date, e.estimateNumber, e.customerName, e.customerContact || '', BRANCHES.find((b) => b.id === e.branchId)?.shortCode || e.branchId, (e.grandTotal || 0).toFixed(2), lifecycleOf(e)]),
                  title: 'Quotations', filename: `quotations-${from || 'all'}_to_${to || 'all'}`,
                })}
              />
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
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {filteredEstimates.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
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
                        <td className="py-3.5 px-4">
                          {(() => {
                            const lc = lifecycleOf(est);
                            return (
                              <span
                                data-testid="quote-status"
                                title={lc === 'Cancelled' && est.cancelReason ? `Cancelled: ${est.cancelReason}` : lc === 'Converted' ? `Converted to ${convertedEstimateMap.get(est.id) || 'a bill'}` : 'Open'}
                                className={cn(
                                  'text-[11px] font-bold px-2 py-0.5 rounded border whitespace-nowrap',
                                  lc === 'Open' ? 'bg-blue-50 text-blue-700 border-blue-200'
                                    : lc === 'Converted' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : 'bg-rose-50 text-rose-700 border-rose-200'
                                )}
                              >
                                {lc}
                              </span>
                            );
                          })()}
                          {lifecycleOf(est) === 'Cancelled' && est.cancelReason && (
                            <div className="text-[11px] text-rose-500 truncate max-w-[140px] mt-0.5" title={est.cancelReason}>{est.cancelReason}</div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {(() => {
                              // A quote can become only ONE live invoice (SAL3-1); a
                              // Cancelled quote can't be billed at all (SAL8-2).
                              const lc = lifecycleOf(est);
                              if (lc === 'Converted') {
                                const num = convertedEstimateMap.get(est.id);
                                return (
                                  <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 border border-slate-200 flex items-center gap-1 text-[11px] font-bold" title={`Already converted to ${num || 'a bill'}`}>
                                    <ArrowRightLeft className="h-3 w-3" /> Converted{num ? ` → ${num}` : ''}
                                  </span>
                                );
                              }
                              if (lc === 'Cancelled') return null;
                              return (
                                <button
                                  type="button"
                                  onClick={() => handleSelectEstimateToConvert(est)}
                                  title="Convert this quotation into a Sales Invoice"
                                  className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 transition-colors flex items-center gap-1 text-[11px] font-bold cursor-pointer"
                                >
                                  <ArrowRightLeft className="h-3 w-3" />
                                  <span>To Invoice</span>
                                </button>
                              );
                            })()}
                            <button
                              type="button"
                              onClick={() => setPreviewEstimate(est)}
                              title="Print / Save PDF"
                              className="p-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition-colors cursor-pointer"
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </button>
                            {/* Edit only while Open — a Converted or Cancelled quote is locked. */}
                            {lifecycleOf(est) === 'Open' && (
                              <button
                                type="button"
                                onClick={() => handleEditEstimate(est)}
                                title="Edit Quotation"
                                className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-colors cursor-pointer"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDuplicateEstimate(est)}
                              title="Duplicate Quote (New quote with same items)"
                              className="p-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 transition-colors cursor-pointer"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                            {/* Cancel-with-reason replaces delete; only for an Open quote. */}
                            {lifecycleOf(est) === 'Open' && (
                              <button
                                type="button"
                                onClick={() => { setCancelTarget(est); setCancelReason(''); }}
                                title="Cancel this quotation (with a reason)"
                                className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-500 border border-slate-200 transition-colors cursor-pointer"
                              >
                                <Ban className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {/* Permanent delete is a CEO clean-up only, never for a converted quote. */}
                            {isCeo && lifecycleOf(est) !== 'Converted' && (
                              <button
                                type="button"
                                disabled={deletingQuoteId === est.id}
                                onClick={async () => {
                                  if (!confirm(`Permanently delete quotation ${est.estimateNumber}? (Cancelling keeps it on record.)`)) return;
                                  setDeletingQuoteId(est.id);
                                  await deleteEstimate(est.id);
                                  setDeletingQuoteId(null);
                                }}
                                title="Delete Quotation (CEO)"
                                className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-400 border border-slate-200 transition-colors cursor-pointer disabled:opacity-40"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
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
          {/* Channel scope — keep this branch's own counter bills separate from
              online (Shopify) orders so counts, sales & profit never mix. */}
          {activeTab === 'ledger' && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Show</span>
              {([
                { key: 'store', label: 'Store bills' },
                { key: 'online', label: 'Online (Shopify)' },
                { key: 'all', label: 'All' },
              ] as const).map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setChannelScope(opt.key)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors',
                    channelScope === opt.key
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
                  )}
                >{opt.label}</button>
              ))}
              <span className="text-[11px] text-slate-400">
                {channelScope === 'store' ? 'Counter sales only — online orders are counted separately.'
                  : channelScope === 'online' ? 'Online store orders only.'
                  : 'Counter + online combined.'}
              </span>
            </div>
          )}

          {/* Today's KPI tiles — same clean white-card style as the other sections */}
          {activeTab === 'ledger' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {[
                { label: 'Bills Today', value: String(todayStats.count), tone: 'text-slate-900', sub: 'Counter bills today' },
                { label: 'Sales', value: formatCurrency(todayStats.amount), tone: 'text-slate-900', sub: 'Goods billed today (incl. credit)' },
                // One tile per payment mode actually in use (Cash, GPay, HDFC, IOB,
                // …) so EVERY rupee collected shows — no mode is ever dropped.
                ...todayStats.modes.map((m) => ({
                  label: m.mode,
                  value: formatCurrency(m.amount),
                  tone: m.mode === 'Cash' ? 'text-emerald-700'
                    : m.mode === 'GPay' ? 'text-blue-700'
                    : m.mode === 'HDFC' ? 'text-indigo-700'
                    : m.mode === 'Online' ? 'text-slate-700'
                    : 'text-teal-700',
                  sub: m.mode === 'Cash'
                    ? 'Cash collected (bills + old dues, less refunds). Drawer balance — after vendor payouts & expenses — is in the Cash Register.'
                    : `${m.mode} in today · incl. old-dues receipts, less refunds`,
                })),
                // Credit tile so the money cards reconcile with Sales: a sale can
                // be paid (any mode) or left on credit — this is today's unpaid
                // portion. (Owner asked why Sales ≠ sum of the mode tiles, Oct 2026.)
                { label: 'Credit (due)', value: formatCurrency(todayStats.credit), tone: 'text-purple-700', sub: "Billed today, not yet paid" },
                ...(gpayBalance.configured
                  ? [{ label: 'GPay Balance', value: formatCurrency(gpayBalance.amount), tone: 'text-blue-800', sub: 'Running · opening + GPay in − out' }]
                  : []),
              ].map((m) => (
                <div key={m.label} className="p-3.5 rounded-lg border border-slate-200 bg-white shadow-2xs">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{m.label}</span>
                  <div className={`text-2xl font-bold font-mono mt-0.5 ${m.tone}`}>{m.value}</div>
                  <span className="text-[11px] text-slate-400">{m.sub}</span>
                </div>
              ))}
            </div>
          )}

          {/* Slim toolbar: quick search + at-a-glance totals + date-range, payment
              mode & status filters (CSV/Excel/PDF export also lives here). */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="relative w-full lg:max-w-md">
              <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search sale by Customer, Invoice No, Phone, or Item..."
                aria-label="Search sales"
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
                  {voidedCount} Cancelled
                </span>
              )}
              {historyLoading && (
                <span className="text-[11px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded font-bold border border-amber-200 inline-flex items-center gap-1" role="status">
                  <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                  Loading older bills… older dates may be incomplete for a moment
                </span>
              )}
            </div>

            {/* Date filter — the list shows only bills in this range (defaults to
                today). Set From = To for a single day. "Today" resets to today. */}
            <div className="flex items-center gap-1.5 text-xs">
              <Calendar className="h-3.5 w-3.5 text-slate-400" />
              <input
                type="date" value={ledgerFrom} max={ledgerTo || undefined} aria-label="From date"
                onChange={(e) => setLedgerFrom(e.target.value)}
                className="px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-800 font-semibold focus:outline-none focus:border-blue-600"
              />
              <span className="text-slate-400">to</span>
              <input
                type="date" value={ledgerTo} min={ledgerFrom || undefined} aria-label="To date"
                onChange={(e) => setLedgerTo(e.target.value)}
                className="px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-800 font-semibold focus:outline-none focus:border-blue-600"
              />
              <button
                type="button"
                onClick={() => { const t = getTodayDateString(); setLedgerFrom(t); setLedgerTo(t); }}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-50 cursor-pointer"
                title="Show today's bills"
              >Today</button>
              <button
                type="button"
                onClick={() => { setLedgerFrom(''); setLedgerTo(''); }}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-50 cursor-pointer"
                title="Show all dates"
              >All</button>
            </div>

            {/* Payment-mode & status quick filters */}
            <div className="flex items-center gap-2 text-xs">
              <select
                value={paymentModeFilter}
                onChange={(e) => setPaymentModeFilter(e.target.value)}
                aria-label="Filter by payment mode"
                title="Filter by payment mode"
                className="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-800 font-semibold focus:outline-none focus:border-blue-600 cursor-pointer"
              >
                <option value="ALL">All modes</option>
                {paymentModeOptions.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                aria-label="Filter by status"
                title="Filter by status"
                className="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-800 font-semibold focus:outline-none focus:border-blue-600 cursor-pointer"
              >
                <option value="ALL">All status</option>
                <option value="Paid">Paid</option>
                <option value="Partial">Partial</option>
                <option value="Credit">Credit</option>
                <option value="Cancelled">Cancelled</option>
              </select>
              {(paymentModeFilter !== 'ALL' || statusFilter !== 'ALL') && (
                <button
                  type="button"
                  onClick={() => { setPaymentModeFilter('ALL'); setStatusFilter('ALL'); }}
                  className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-600 font-bold hover:bg-slate-50 cursor-pointer"
                  title="Clear payment & status filters"
                >Clear</button>
              )}
            </div>

            {/* Export the bills currently shown (same date range) → PDF / Excel / CSV */}
            <ListExportBar
              withDateRange={false}
              build={() => ({
                // SAL6-9: status for every bill, all payment modes, returns, net,
                // received, due and a totals row (voided bills listed, not totalled).
                headers: SALES_EXPORT_HEADERS,
                rows: salesExportRows(
                  invoices
                    .filter((inv) => (isAllBranches || inv.branchId === currentBranch) && (!ledgerFrom || (inv.date || '') >= ledgerFrom) && (!ledgerTo || (inv.date || '') <= ledgerTo))
                    .sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : -1)),
                ),
                title: 'Sales Invoices', filename: `sales-invoices-${ledgerFrom || 'all'}_to_${ledgerTo || 'all'}`,
              })}
            />
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
                    pagedInvoices.map((inv) => {
                      const status = getSaleStatus(inv);
                      const isVoided = !!inv.isVoided;
                      const hasReturns = (inv.returns && inv.returns.length > 0) || (inv.totalReturnedAmount || 0) > 0;

                      return (
                        <tr
                          key={inv.id}
                          onDoubleClick={() => openBillRow(inv)}
                          className={cn(
                            'transition-colors cursor-pointer group',
                            isVoided
                              ? 'bg-rose-50/20 hover:bg-rose-50/40 text-slate-500'
                              : 'hover:bg-slate-50/80'
                          )}
                          title="Double-click to open this bill in the billing screen"
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

                          {/* Action Buttons — Print (A4) · Share · ⋮ (more).
                              Everything else lives in the 3-dot menu (client 2026-10-27). */}
                          <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1.5">
                              {/* Print the A4 invoice (opens the A4 preview; print from there to an A4 printer) */}
                              <button
                                type="button"
                                onClick={() => setPreviewInvoice(inv)}
                                title="Print A4 bill (A4 sheet / A4 printer)"
                                className="p-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 transition-colors cursor-pointer"
                              >
                                <Printer className="h-3.5 w-3.5" />
                              </button>

                              {/* Share on WhatsApp */}
                              <button
                                type="button"
                                onClick={() => shareInvoiceOnWhatsApp(inv)}
                                title="Share bill on WhatsApp"
                                className="p-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 transition-colors cursor-pointer"
                              >
                                <Share2 className="h-3.5 w-3.5" />
                              </button>

                              {/* Everything else */}
                              <RowActionsMenu
                                items={[
                                  { key: 'view', label: 'View / Edit', icon: <Edit2 className="h-3.5 w-3.5" />, onClick: () => openBillRow(inv) },
                                  { key: 'einvoice', label: 'Generate e-Invoice', icon: <FileText className="h-3.5 w-3.5" />, onClick: () => setEInvoiceInvoice(inv) },
                                  ...(!isVoided && !isInvoiceFullyReturned(inv)
                                    ? [{ key: 'return', label: 'Convert To Return', icon: <RotateCcw className="h-3.5 w-3.5" />, onClick: () => setReturnInvoice(inv) }]
                                    : []),
                                  { key: 'challan', label: 'Preview Delivery Challan', icon: <Printer className="h-3.5 w-3.5" />, onClick: () => setChallanInvoice(inv) },
                                  { key: 'payhist', label: 'Payment History', icon: <Eye className="h-3.5 w-3.5" />, onClick: () => setPaymentHistoryInvoice(inv) },
                                  ...(!isVoided
                                    ? [{ key: 'dup', label: 'Duplicate', icon: <Copy className="h-3.5 w-3.5" />, onClick: () => handleDuplicate(inv) }]
                                    : []),
                                  { key: 'open-pdf', label: 'Open PDF / Preview', icon: <Eye className="h-3.5 w-3.5" />, onClick: () => setPreviewInvoice(inv) },
                                  { key: 'print-a4', label: 'Print (A4)', icon: <Printer className="h-3.5 w-3.5" />, onClick: () => setPreviewInvoice(inv) },
                                  { key: 'thermal', label: 'Thermal Reprint (80mm)', icon: <ReceiptText className="h-3.5 w-3.5" />, onClick: () => printThermalReceipt(inv, companyProfile) },
                                  { key: 'history', label: 'View History', icon: <Clock className="h-3.5 w-3.5" />, onClick: () => setHistoryInvoice(inv) },
                                  ...(canVoid && !isVoided
                                    ? [{ key: 'void', label: 'Cancel Invoice (Void)', icon: <Ban className="h-3.5 w-3.5" />, danger: true, onClick: () => { setVoidModalInvoice(inv); setVoidReason('Customer cancellation / Order return'); } }]
                                    : []),
                                  // Permanent Delete removed per owner request — a bill is cancelled
                                  // via Void (reversible, keeps the record), never hard-deleted.
                                ]}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              {ledgerPages > 1 && (
                <nav aria-label="Sales ledger pages" className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-slate-200 bg-slate-50 text-xs">
                  <span className="text-slate-600 font-mono">
                    {safeLedgerPage * LEDGER_PAGE + 1}–{Math.min(filteredInvoices.length, (safeLedgerPage + 1) * LEDGER_PAGE)} of {filteredInvoices.length}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button type="button" disabled={safeLedgerPage === 0} onClick={() => setLedgerPage(safeLedgerPage - 1)}
                      className="px-3 py-1 border border-slate-300 bg-white font-bold text-slate-700 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed">Previous</button>
                    <span className="text-slate-600 font-mono">Page {safeLedgerPage + 1} / {ledgerPages}</span>
                    <button type="button" disabled={safeLedgerPage >= ledgerPages - 1} onClick={() => setLedgerPage(safeLedgerPage + 1)}
                      className="px-3 py-1 border border-slate-300 bg-white font-bold text-slate-700 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed">Next</button>
                  </div>
                </nav>
              )}
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

      {/* Row 3-dot menu modals */}
      {paymentHistoryInvoice && (
        <PaymentHistoryModal invoice={paymentHistoryInvoice} payments={payments} onClose={() => setPaymentHistoryInvoice(null)} />
      )}
      {historyInvoice && (
        <InvoiceHistoryModal invoice={historyInvoice} employees={employees} onClose={() => setHistoryInvoice(null)} />
      )}
      {challanInvoice && (
        <ChallanPreviewModal invoice={challanInvoice} company={companyProfile} onClose={() => setChallanInvoice(null)} />
      )}
      {eInvoiceInvoice && (
        <EInvoiceModal invoice={eInvoiceInvoice} company={companyProfile} onClose={() => setEInvoiceInvoice(null)} />
      )}

      {/* Thermal printer settings (paper width + auto-print + test) */}
      <ThermalSettingsModal
        open={showPrintSettings}
        onClose={() => setShowPrintSettings(false)}
        company={companyProfile}
        sampleInvoice={invoices[0] || null}
      />

      {/* Line-Item Return Modal */}
      <ImportQuotationModal isOpen={showImportQuote} onClose={() => setShowImportQuote(false)} />

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
        // SAL3-1: a quote already turned into a (non-voided) invoice must not be
        // offered for a second conversion — the server rejects it, but the picker
        // should not tempt the user into it either.
        // SAL8-2: only Open quotes can be billed — Converted ones already have a
        // bill and Cancelled ones are final (the server refuses both).
        estimates={estimates.filter((est) => lifecycleOf(est) === 'Open')}
        onSelectEstimate={handleSelectEstimateToConvert}
      />

      {/* Cancel-with-reason modal for a quotation (replaces delete) */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white border border-slate-300 rounded-none w-full max-w-md shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 bg-rose-50 flex items-center gap-2.5">
              <Ban className="h-5 w-5 text-rose-700" />
              <div>
                <h2 className="text-base font-bold text-slate-900">Cancel quotation {cancelTarget.estimateNumber}</h2>
                <p className="text-xs text-slate-500">A cancelled quote is kept for the record (not deleted) and can't be edited or billed.</p>
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
                type="button"
                onClick={() => { setCancelTarget(null); setCancelReason(''); }}
                className="px-4 py-2 rounded-none text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 cursor-pointer"
              >
                Keep quotation
              </button>
              <button
                type="button"
                onClick={confirmCancelQuote}
                disabled={!cancelReason.trim()}
                className="px-4 py-2 rounded-none text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 border border-rose-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                Cancel quotation
              </button>
            </div>
          </div>
        </div>
      )}

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
