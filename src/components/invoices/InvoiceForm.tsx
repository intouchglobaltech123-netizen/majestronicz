import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useErp } from '../../context/ErpContext';
import { effectiveTaxSlab } from '../../lib/tax';
import { isWholeUnit } from '../../lib/units';
import {
  Item,
  Invoice,
  InvoiceLineItem,
  TransactionType,
  PaymentMode,
  BranchId,
  BRANCHES,
  INVOICE_TERMS_PRESETS,
  DiscountType,
  Estimate,
  Enquiry,
  EstimateLineItem,
  GstBreakdownRow,
  ComboItem,
  isLoyaltyMilestoneEligible,
  spendTierDiscountPercent,
  cleanCustomerName,
  PaymentSplit,
  getInvoicePaymentSplits,
  INDIAN_STATES,
  GST_STATE_CODES,
  isInterStateSupply,
  supplyFromGstin,
  getCustomerOutstandingSummary,
} from '../../types';
import {
  calculateLineTax,
  calculateTaxBreakdown,
  calculateInvoiceTotals,
} from '../../lib/taxCalculations';
import { formatCurrency, cn, getTodayDateString } from '../../lib/utils';
import { isActiveEmployee } from '../../lib/payroll';
import {
  Plus,
  Trash2,
  Save,
  Printer,
  FileText,
  Paperclip,
  ChevronDown,
  ChevronUp,
  Share2,
  Link,
  Award,
  Copy,
  Split,
  AlertTriangle,
  CheckCircle2,
  ScanLine,
  Ban,
  ArrowLeft,
} from 'lucide-react';
import { toast } from 'sonner';
import { CameraScanModal } from '../common/CameraScanModal';
import { printThermalReceipt, isThermalAutoPrintOn } from '../../lib/thermalReceipt';
import { newClientKey } from '../../lib/saveOutbox';
import { ItemSearchDropdown } from '../common/ItemSearchDropdown';
import { UniversalDropdown } from '../common/UniversalDropdown';
import { PhoneInput } from '../common/PhoneInput';
import { SALE_MODES, PAYMENT_MODE_LABEL } from '../../lib/paymentModes';

interface Props {
  onSaved: (invoice: Invoice) => void;
  onPreviewPdf: (invoice: Invoice) => void;
  initialInvoice?: Invoice | null;
  convertedFromEstimate?: Estimate | null;
  duplicateSourceInvoice?: Invoice | null;
  initialEstimate?: Estimate | null;
  duplicateSourceEstimate?: Estimate | null;
  initialDocumentType?: 'Invoice' | 'Quotation';
  onSavedEstimate?: (estimate: Estimate) => void;
  onPreviewEstimatePdf?: (estimate: Estimate) => void;
  onCancel?: () => void;
  /** Go back to the Sales Invoice history/dashboard WITHOUT closing this bill —
   *  the in-progress tab stays open (reopen it from "Open Bills"). No saved bill
   *  is touched. */
  onBackToList?: () => void;
  /** Save the current document as a work-in-progress draft (not committed). */
  /** SAL4-13: the form's current contents (unvalidated), so the bill tabs can be
   *  restored WITH their lines after a page reload. */
  onWorkingCopy?: (doc: Invoice | Estimate) => void;
  /** A new bill's last working copy, used to re-seed the form ONCE if it ever
   *  (re)mounts mid-entry — so an in-progress bill is never shown empty. */
  restoreSeed?: Invoice | Estimate | null;
  /** True when this bill tab is the one on screen (enables the global scanner). */
  isActive?: boolean;
  /** Edit-mode only (#4): void / delete THIS saved bill from inside the screen. */
  onVoidBill?: (invoice: Invoice) => void;
  /** Whether the current user may void/delete a bill (Manager/CEO). */
  canVoidBill?: boolean;
}

export const InvoiceForm: React.FC<Props> = ({
  onSaved,
  onPreviewPdf,
  isActive = true,
  initialInvoice,
  convertedFromEstimate,
  duplicateSourceInvoice,
  initialEstimate,
  duplicateSourceEstimate,
  initialDocumentType,
  onSavedEstimate,
  onPreviewEstimatePdf,
  onCancel,
  onBackToList,
  onWorkingCopy,
  restoreSeed,
  onVoidBill,
  canVoidBill,
}) => {
  const {
    currentBranch,
    isAllBranches,
    getNextInvoiceNumber,
    saveInvoice,
    companyProfile,
    getNextEstimateNumber,
    saveEstimate,
    markEnquiryConverted,
    saveEnquiry,
    estimates,
    branchStocks,
    getComboAvailability,
    paymentTermsOptions,
    customers,
    saveCustomer,
    loyaltySettings,
    hasFlag,
    items,
    combos,
    employees,
    pendingOrders,
    payments,
    invoices,
    getCustomerOutstandingBalance,
    recordPayment,
    saleModesList,
    addSaleMode,
  } = useErp();

  // Payment-mode dropdown options: built-ins + the shop's custom modes, with
  // COD-Credit (owed) kept last. Custom modes flow through the same cash-register
  // grouping, so they never break reconciliation (#1).
  const saleSplitOptions = useMemo(() => {
    const base = SALE_MODES.map((m) => ({ value: m as string, label: PAYMENT_MODE_LABEL[m] || m }));
    const custom = (saleModesList || []).map((m) => ({ value: m, label: m }));
    return [...base, ...custom, { value: 'COD-Credit', label: PAYMENT_MODE_LABEL['COD-Credit'] || 'COD-Credit (owed)' }];
  }, [saleModesList]);
  const addPaymentType = () => {
    const name = window.prompt('New payment type name (e.g. Paytm, Card, PhonePe):');
    if (name && name.trim()) addSaleMode(name.trim());
  };
  // Same payment options, plus an "Add payment type" row INSIDE the dropdown so
  // staff can add a new method without hunting for a separate button.
  const ADD_PAY_SENTINEL = '__add_payment_type__';
  const saleSplitOptionsWithAdd = useMemo(
    () => [...saleSplitOptions, { value: ADD_PAY_SENTINEL, label: '➕ Add payment type…' }],
    [saleSplitOptions],
  );
  // A bill that is really saved (not a parked draft or a restored tab copy):
  // only then do "already paid" and the ended-month date limit apply.
  const isSavedBill = !!initialInvoice && invoices.some((i) => i.id === initialInvoice.id);

  // Document Type Mode: 'Invoice' (Sales Invoice) vs 'Quotation' (Quotation / Estimate)
  const [documentType, setDocumentType] = useState<'Invoice' | 'Quotation'>(() => {
    if (initialEstimate || duplicateSourceEstimate) return 'Quotation';
    if (initialDocumentType) return initialDocumentType;
    return 'Invoice';
  });

  // Branch Selection
  const [selectedBranch, setSelectedBranch] = useState<BranchId>(() => {
    if (initialInvoice) return initialInvoice.branchId;
    if (initialEstimate) return initialEstimate.branchId;
    if (duplicateSourceEstimate) return duplicateSourceEstimate.branchId;
    if (convertedFromEstimate) return convertedFromEstimate.branchId;
    if (!isAllBranches && currentBranch !== 'all') return currentBranch as BranchId;
    return 'erode-hq';
  });

  // Bill Type dropdown (Cash Sale / Credit Bill) - default to Cash Sale (for Invoices)
  const [transactionType, setTransactionType] = useState<TransactionType>(() => {
    return initialInvoice ? initialInvoice.transactionType : 'Cash';
  });

  // Stable idempotency key for THIS open bill — minted once per form (per open
  // tab) and reused on every Save, manual re-save and auto-retry. This is what
  // guarantees that pressing Save twice during an outage, or an auto-retry of a
  // save whose reply was lost, can never create a duplicate bill: the backend
  // dedupes by this key. An edit keeps the stored bill's key.
  const billKeyRef = useRef<string>('');
  if (!billKeyRef.current) billKeyRef.current = initialInvoice?.clientKey || newClientKey();
  // STABLE id for this open bill, minted once with randomness (not `inv-${Date.now()}`
  // re-generated per assemble). Two bills saved in the same millisecond used to get
  // the same `inv-<ms>` id; now each tab has its own. (The server also re-mints a
  // UUID for every new sale and dedupes retries by clientKey — this just keeps the
  // client's optimistic id unique and stable before the server replies.)
  const billIdRef = useRef<string>('');
  if (!billIdRef.current) billIdRef.current = initialInvoice?.id || `inv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Duplicate-bill guard: when the staff re-type a bill that was already saved
  // (same customer + same items + same total, within the last few minutes) we
  // pause and confirm before making a SECOND bill (which would hit stock twice).
  const [dupWarn, setDupWarn] = useState<{ number: string; minsAgo: number; amount: number; opts?: { previewAfter?: boolean } } | null>(null);

  // Invoice / Quotation Number
  const [invoiceNumber, setInvoiceNumber] = useState(() => {
    if (initialInvoice) return initialInvoice.invoiceNumber;
    if (initialEstimate) return initialEstimate.estimateNumber;
    const branch = (!isAllBranches && currentBranch !== 'all') ? (currentBranch as BranchId) : 'erode-hq';
    if (duplicateSourceEstimate) return getNextEstimateNumber(duplicateSourceEstimate.branchId, getTodayDateString());
    if (duplicateSourceInvoice) return getNextInvoiceNumber(duplicateSourceInvoice.branchId, getTodayDateString());
    if (convertedFromEstimate) return getNextInvoiceNumber(convertedFromEstimate.branchId, getTodayDateString());
    if (initialDocumentType === 'Quotation') return getNextEstimateNumber(branch, getTodayDateString());
    return getNextInvoiceNumber(branch, getTodayDateString());
  });

  // Date & Time
  const [date, setDate] = useState(() => initialInvoice?.date || initialEstimate?.date || getTodayDateString());
  const [time, setTime] = useState(() => {
    if (initialInvoice?.time) return initialInvoice.time;
    if (initialEstimate?.time) return initialEstimate.time;
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });

  // Customer & Loyalty Details
  const [customerId, setCustomerId] = useState<string | undefined>(
    initialInvoice?.customerId || initialEstimate?.customerId || convertedFromEstimate?.customerId
  );
  const [customerName, setCustomerName] = useState(
    () => initialInvoice?.customerName || initialEstimate?.customerName || convertedFromEstimate?.customerName || ''
  );
  const [customerPhone, setCustomerPhone] = useState(
    () => initialInvoice?.customerPhone || initialEstimate?.customerContact || convertedFromEstimate?.customerContact || ''
  );
  const [customerAddress, setCustomerAddress] = useState(
    () => initialInvoice?.customerAddress || initialEstimate?.customerAddress || convertedFromEstimate?.customerAddress || ''
  );
  const [isLoyaltyRewardApplied, setIsLoyaltyRewardApplied] = useState<boolean>(
    initialInvoice?.isLoyaltyRewardApplied || false
  );

  // Match customer from master to check loyalty eligibility
  const selectedCustomerObj = useMemo(() => {
    if (customerId) return customers.find((c) => c.id === customerId);
    if (customerPhone) {
      const clean = customerPhone.replace(/\D/g, '');
      if (clean) return customers.find((c) => c.phone.replace(/\D/g, '') === clean);
    }
    if (customerName) {
      return customers.find(
        (c) => c.name.trim().toLowerCase() === customerName.trim().toLowerCase()
      );
    }
    return null;
  }, [customers, customerId, customerPhone, customerName]);

  // SAL4-14 / E2E6-8: a line copied from ANOTHER document (duplicate, or a quote
  // converted to a bill) is charged today's catalogue GST rate at the bill's
  // branch, and gets its item code from the item master when the old document
  // stored none. Only an edit of the same document keeps its stored rate.
  const refreshCopiedLine = (li: { itemId?: string; itemCode?: string; isCombo?: boolean; comboId?: string }, rate: number, branchId: string) => {
    const master = li.itemId && !li.isCombo ? items.find((i) => i.id === li.itemId) : undefined;
    const combo = li.isCombo ? combos.find((c) => c.id === (li.comboId || li.itemId)) : undefined;
    const itemCode = li.itemCode || master?.itemCode || combo?.comboCode || '';
    const currentRate = master
      ? effectiveTaxSlab(master.gstTaxSlab, branchStocks.find((bs) => bs.itemId === master.id && bs.branchId === branchId)?.gstTaxSlab)
      : li.isCombo ? 18 : rate;
    return { itemCode, rate: currentRate };
  };

  // A new/unknown 10-digit mobile prompts a small "add customer" card.
  const [showNewCustomerPrompt, setShowNewCustomerPrompt] = useState(false);
  // "Skip" on that card bills the number as a walk-in: no customer is created (E2E8-12).
  const [skipCustomerSave, setSkipCustomerSave] = useState(false);
  useEffect(() => { setSkipCustomerSave(false); }, [customerPhone]);

  // Every mobile the shop has ever seen — the customer master PLUS numbers used
  // on past bills and quotations — deduped by 10-digit number. This makes an
  // old quote-only customer (e.g. JANA K 852…, never billed) suggest and
  // auto-fill even though it isn't in the master yet (CRM 2026-10-26). Master
  // rows win (they carry the real id + cleaned name); history fills the gaps.
  const knownContacts = useMemo(() => {
    const byPhone = new Map<string, { id?: string; phone: string; name: string; address: string }>();
    const put = (phoneRaw: string | undefined, name: string | undefined, address: string | undefined, id?: string) => {
      const clean = (phoneRaw || '').replace(/\D/g, '');
      if (clean.length !== 10) return;
      const nm = (name || '').trim();
      if (!nm || nm.toLowerCase() === 'walk-in customer') return; // nothing worth suggesting
      const existing = byPhone.get(clean);
      // A master row (has id) always wins; otherwise keep the first history name.
      if (!existing || (id && !existing.id)) {
        byPhone.set(clean, { id, phone: clean, name: nm, address: address || '' });
      }
    };
    // History first (lower priority), master last so it overrides.
    invoices.forEach((i) => put(i.customerPhone, i.customerName, i.customerAddress));
    estimates.forEach((e) => put(e.customerContact, e.customerName, e.customerAddress));
    customers.forEach((c) => put(c.phone, cleanCustomerName(c.name, c.notes), c.address, c.id));
    return Array.from(byPhone.values());
  }, [customers, estimates, invoices]);

  // Phone-first entry: typing a full 10-digit mobile auto-fills the matching
  // customer's name + address; an unknown number offers a quick add.
  useEffect(() => {
    const clean = customerPhone.replace(/\D/g, '');

    // If a customer is already selected but the typed number no longer matches
    // that customer, drop the stale selection so a NEW number can resolve fresh.
    if (customerId) {
      const cur = customers.find((c) => c.id === customerId);
      const curPhone = (cur?.phone || '').replace(/\D/g, '');
      if (cur && curPhone === clean) { setShowNewCustomerPrompt(false); return; }
      // Number diverged from the locked customer → clear it and re-evaluate below.
      setCustomerId(undefined);
      setCustomerName('');
      setCustomerAddress('');
    }

    if (clean.length !== 10) { setShowNewCustomerPrompt(false); return; }
    const match = knownContacts.find((c) => c.phone === clean);
    if (match) {
      if (match.id) setCustomerId(match.id);
      setCustomerName(match.name);
      setCustomerAddress(match.address || '');
      setShowNewCustomerPrompt(false);
    } else {
      setShowNewCustomerPrompt(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerPhone, knownContacts]);

  // Customer suggestions as the mobile number is typed: show every known
  // contact whose number STARTS WITH the digits entered (e.g. "9942" → all
  // 9942… contacts) so staff pick the old customer and auto-fill number, name
  // and address instead of needing the full 10 digits.
  const [phoneFocused, setPhoneFocused] = useState(false);
  const phoneSuggestions = useMemo(() => {
    if (customerId) return []; // a customer is already locked in
    const clean = customerPhone.replace(/\D/g, '');
    if (clean.length < 2) return []; // from just "99" — no need to type the full number
    return knownContacts
      .filter((c) => c.phone.startsWith(clean))
      .slice(0, 8);
  }, [knownContacts, customerPhone, customerId]);
  const pickCustomer = (c: { id?: string; phone: string; name: string; address: string; notes?: string }) => {
    // A saved customer's master record is authoritative — use its phone/address
    // so picking by NAME always fills the number (not just the one in the row).
    const master = c.id ? customers.find((cc) => cc.id === c.id) : undefined;
    setCustomerId(c.id);
    setCustomerPhone((master?.phone || c.phone || '').replace(/\D/g, ''));
    setCustomerName(cleanCustomerName(master?.name ?? c.name, master?.notes ?? c.notes));
    setCustomerAddress(master?.address || c.address || '');
    setShowNewCustomerPrompt(false);
    setPhoneFocused(false);
    setNameFocused(false);
  };

  // Name-first entry: suggest existing customers as the NAME is typed — the same
  // way the mobile field suggests by number prefix. A phone is NOT required here,
  // so a name-only customer (billed without a number) still shows up.
  const [nameFocused, setNameFocused] = useState(false);
  const [nameHighlight, setNameHighlight] = useState(0);
  const nameContacts = useMemo(() => {
    const byKey = new Map<string, { id?: string; phone: string; name: string; address: string; notes?: string }>();
    const put = (phoneRaw?: string, name?: string, address?: string, id?: string, notes?: string) => {
      const nm = (name || '').trim();
      if (!nm || nm.toLowerCase() === 'walk-in customer') return;
      const clean = (phoneRaw || '').replace(/\D/g, '');
      // Keep whatever number digits exist so picking the name still fills the
      // phone; dedupe by a 10-digit number when there is one, else by name.
      const phone = clean;
      const key = id || (clean.length === 10 ? `p:${clean}` : `n:${nm.toLowerCase()}`);
      const existing = byKey.get(key);
      if (!existing || (id && !existing.id)) byKey.set(key, { id, phone, name: nm, address: address || '', notes });
    };
    invoices.forEach((i) => put(i.customerPhone, i.customerName, i.customerAddress));
    estimates.forEach((e) => put(e.customerContact, e.customerName, e.customerAddress));
    customers.forEach((c) => put(c.phone, cleanCustomerName(c.name, c.notes), c.address, c.id, c.notes));
    return Array.from(byKey.values());
  }, [customers, estimates, invoices]);
  const nameSuggestions = useMemo(() => {
    if (customerId) return [];
    const q = customerName.trim().toLowerCase();
    if (q.length < 2) return [];
    return nameContacts
      .filter((c) => c.name.toLowerCase().includes(q))
      .sort((a, b) => (a.name.toLowerCase().startsWith(q) ? 0 : 1) - (b.name.toLowerCase().startsWith(q) ? 0 : 1))
      .slice(0, 8);
  }, [nameContacts, customerName, customerId]);

  // Save the typed mobile + name/address as a new customer master record.
  const handleQuickAddCustomer = async () => {
    if (!customerName.trim()) { toast.error('Enter a name for the new customer'); return; }
    const res = await saveCustomer({
      id: '',
      name: customerName.trim(),
      phone: customerPhone,
      address: customerAddress.trim(),
      customerType: 'Retail',
      firstPurchaseDate: getTodayDateString(),
      purchaseCount: 0,
      totalSpent: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any);
    if (res.success && res.customer) {
      setCustomerId(res.customer.id);
      setShowNewCustomerPrompt(false);
    } else {
      toast.error('Could not save the customer', { description: res.error });
    }
  };

  const isEligibleForLoyalty = useMemo(() => {
    if (!selectedCustomerObj) return false;
    if (selectedCustomerObj.customerType === 'Organization') return false;
    return isLoyaltyMilestoneEligible(selectedCustomerObj, loyaltySettings, true);
  }, [selectedCustomerObj, loyaltySettings]);

  const handleApplyLoyaltyReward = () => {
    if (!loyaltySettings.isActive || !selectedCustomerObj) return;
    setOverallDiscountType(loyaltySettings.discountType === 'percentage' ? '%' : 'amount');
    setOverallDiscountValue(loyaltySettings.discountValue);
    setIsLoyaltyRewardApplied(true);
    toast.success('Loyalty milestone discount applied!', {
      description: `${loyaltySettings.discountValue}${loyaltySettings.discountType === 'percentage' ? '%' : '₹'} off for ${selectedCustomerObj.name}`,
    });
  };

  const handleRemoveLoyaltyReward = () => {
    setOverallDiscountValue(0);
    setIsLoyaltyRewardApplied(false);
    toast.info('Loyalty discount removed');
  };

  // Payment Terms & Due Date
  const [paymentTerms, setPaymentTerms] = useState('Due on Receipt');
  const [dueDate, setDueDate] = useState(() => initialInvoice?.dueDate || getTodayDateString());

  // State of Supply
  const [stateOfSupply, setStateOfSupply] = useState('33-Tamil Nadu');
  const isInterState = isInterStateSupply(stateOfSupply);
  // Salesperson incentive — manually assigned per bill.
  const [salespersonId, setSalespersonId] = useState<string>(initialInvoice?.salespersonId || '');

  // GST Toggle
  // New bills start with GST OFF — the counter turns it ON only when the customer
  // needs a GST invoice. Editing/duplicating a saved bill still keeps that bill's
  // own GST setting (the effects below override this initial value).
  const [withGst, setWithGst] = useState(false);

  // Bulk-tax shortcut removed from the sales page; keep neutral constants so the
  // per-line default tax logic below still reads cleanly (always uses item/GST default).
  const isBulkTaxOpen = false;
  const bulkTaxRate = 18;

  // Line Items
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([]);
  // Auto-scroll the item editor to the newest row when a line is added.
  const itemScrollRef = useRef<HTMLDivElement>(null);
  const prevLineCountRef = useRef(0);
  useEffect(() => {
    if (lineItems.length > prevLineCountRef.current) {
      const el = itemScrollRef.current;
      if (el) requestAnimationFrame(() => {
        const rows = el.querySelectorAll<HTMLElement>('[data-line-row]');
        const row = rows[rows.length - 1];
        // Keep the newest row centred within the item editor…
        if (row) {
          const cRect = el.getBoundingClientRect();
          const rRect = row.getBoundingClientRect();
          const delta = (rRect.top - cRect.top) - el.clientHeight / 2 + row.offsetHeight / 2;
          el.scrollTop += delta;
          // …and scroll the PAGE so the new row is visible even when the editor
          // itself doesn't overflow (this is the auto-scroll the counter wants).
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          el.scrollTop = el.scrollHeight;
        }
      });
    }
    prevLineCountRef.current = lineItems.length;
  }, [lineItems.length]);

  // Payment Splits (Connected to Daily Cash Register)
  const [paymentSplits, setPaymentSplits] = useState<PaymentSplit[]>(() => {
    if (initialInvoice) {
      return getInvoicePaymentSplits(initialInvoice);
    }
    return [{ mode: 'Cash', amount: 0 }];
  });
  const [isPartialPayment, setIsPartialPayment] = useState(false);
  const [partialAmount, setPartialAmount] = useState<number>(0);
  // Mandatory "payment received" confirmation (owner): staff must tick this
  // before a bill can be saved, so they consciously confirm the money came in
  // and the payment mode is right — instead of leaving the default Cash by
  // accident when it was actually GPay. Pre-ticked when editing a saved bill.
  const [paymentReceived, setPaymentReceived] = useState<boolean>(() => isSavedBill);

  // Overall Discount & Shipping
  const [overallDiscountType, setOverallDiscountType] = useState<DiscountType>('%');
  const [overallDiscountValue, setOverallDiscountValue] = useState<number>(0);
  const [shippingCharges, setShippingCharges] = useState<number>(0);
  const [roundOffEnabled, setRoundOffEnabled] = useState(true);
  // Cash tendered by a walk-in customer — a counter helper only, to work out the
  // change to hand back (bill ₹550, customer gives ₹600 → return ₹50). It is NOT
  // a payment split and is never saved on the bill; the recorded payment stays at
  // the grand total.
  const [cashTendered, setCashTendered] = useState<number | ''>('');
  // Loyalty spend-tier auto discount (#8): the % we auto-filled into the overall
  // discount (0 = none). spendAutoRef tracks it so we only ever overwrite our own
  // auto value, never a discount the user (or the milestone reward) typed.
  const [spendDiscountAutoApplied, setSpendDiscountAutoApplied] = useState(0);
  const spendAutoRef = useRef(0);

  // Terms and conditions
  const [termsPresetId, setTermsPresetId] = useState('sale-invoice-default');
  const [terms, setTerms] = useState(INVOICE_TERMS_PRESETS[0].terms);

  // Additional fields accordion
  const [isExtraOpen, setIsExtraOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState<{ name: string; size?: string }[]>([]);
  const [attachmentInput, setAttachmentInput] = useState('');

  // Track if converted from an estimate or enquiry. An enquiry conversion opens
  // the form with a pre-filled stand-in quote (id "est-conv-…") that was never
  // saved — it is not a source estimate, so the bill must not claim "Created
  // from Estimate ENQ-…" or link a quote that does not exist (CRM-2 / E2E6-8).
  // (A quote that was saved from an enquiry keeps that id, but it is then in the
  // saved list, so it still counts as a real source estimate.)
  const isEnquiryPrefill = (e?: Estimate | null): boolean =>
    !!e && e.id.startsWith('est-conv-') && !!e.sourceEnquiryId && !estimates.some((x) => x.id === e.id);
  const fromEnquiryPrefill = isEnquiryPrefill(convertedFromEstimate) || isEnquiryPrefill(initialEstimate);
  const realSourceEstimate = isEnquiryPrefill(convertedFromEstimate) ? undefined : convertedFromEstimate;
  const [sourceEstimateId, setSourceEstimateId] = useState<string | undefined>(
    initialInvoice?.sourceEstimateId || realSourceEstimate?.id
  );
  const [sourceEstimateNumber, setSourceEstimateNumber] = useState<string | undefined>(
    initialInvoice?.sourceEstimateNumber || realSourceEstimate?.estimateNumber
  );
  const [sourceEnquiryId, setSourceEnquiryId] = useState<string | undefined>(
    initialInvoice?.sourceEnquiryId || convertedFromEstimate?.sourceEnquiryId
  );
  const [sourceEnquiryNumber, setSourceEnquiryNumber] = useState<string | undefined>(
    initialInvoice?.sourceEnquiryNumber || convertedFromEstimate?.sourceEnquiryNumber
  );

  // Keep the due date sensible from payment terms + invoice date (E2E-20: the
  // terms are chosen on a bill with an amount owed).
  useEffect(() => {
    const matched = paymentTermsOptions.find((t) => t.value === paymentTerms);
    if (matched && matched.days > 0) {
      const parts = date.split('-').map(Number);
      const d = new Date(parts[0], parts[1] - 1, parts[2]);
      d.setDate(d.getDate() + matched.days);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      setDueDate(`${y}-${m}-${day}`);
    } else if (paymentTerms !== 'Custom') {
      setDueDate(date);
    }
  }, [date, paymentTerms, paymentTermsOptions]);

  // Sync document mode when initialDocumentType prop changes (if not editing an existing document)
  useEffect(() => {
    if (initialDocumentType && !initialInvoice && !initialEstimate && !duplicateSourceInvoice && !duplicateSourceEstimate && !convertedFromEstimate) {
      setDocumentType(initialDocumentType);
    }
  }, [initialDocumentType, initialInvoice, initialEstimate, duplicateSourceInvoice, duplicateSourceEstimate, convertedFromEstimate]);

  // Initialize from props (editing existing invoice or converting from estimate)
  useEffect(() => {
    if (initialInvoice) {
      setInvoiceNumber(initialInvoice.invoiceNumber);
      setSelectedBranch(initialInvoice.branchId);
      setTransactionType(initialInvoice.transactionType || 'Cash');
      setDate(initialInvoice.date);
      setTime(initialInvoice.time);
      setCustomerName(initialInvoice.customerName);
      setCustomerPhone(initialInvoice.customerPhone || '');
      setCustomerAddress(initialInvoice.customerAddress || '');
      setPaymentTerms(initialInvoice.paymentTerms || 'Due on Receipt');
      setDueDate(initialInvoice.dueDate || initialInvoice.date);
      setStateOfSupply(initialInvoice.stateOfSupply || '33-Tamil Nadu');
      setWithGst(initialInvoice.withGst);
      setLineItems(initialInvoice.items);
      setPaymentSplits(getInvoicePaymentSplits(initialInvoice));
      setIsPartialPayment(!!initialInvoice.isPartialPayment);
      setPartialAmount(initialInvoice.partialAmount || 0);
      setOverallDiscountType(initialInvoice.overallDiscountType || '%');
      setOverallDiscountValue(initialInvoice.overallDiscountValue || 0);
      setShippingCharges(initialInvoice.shippingCharges || 0);
      setRoundOffEnabled(initialInvoice.roundOffEnabled ?? true);
      setTerms(initialInvoice.termsAndConditions || INVOICE_TERMS_PRESETS[0].terms);
      setDescription(initialInvoice.description || '');
      setAttachments(initialInvoice.attachments || []);
      setSourceEstimateId(initialInvoice.sourceEstimateId);
      setSourceEstimateNumber(initialInvoice.sourceEstimateNumber);
      setSourceEnquiryId(initialInvoice.sourceEnquiryId);
      setSourceEnquiryNumber(initialInvoice.sourceEnquiryNumber);
    } else if (convertedFromEstimate) {
      // Pre-fill from Estimate
      setSelectedBranch(convertedFromEstimate.branchId);
      setCustomerName(convertedFromEstimate.customerName);
      setCustomerPhone(convertedFromEstimate.customerContact || '');
      setCustomerAddress(convertedFromEstimate.customerAddress || '');
      setWithGst(convertedFromEstimate.withGst);
      setStateOfSupply(convertedFromEstimate.stateOfSupply || '33-Tamil Nadu');
      setTerms(convertedFromEstimate.termsAndConditions);
      setSourceEstimateId(isEnquiryPrefill(convertedFromEstimate) ? undefined : convertedFromEstimate.id);
      setSourceEstimateNumber(isEnquiryPrefill(convertedFromEstimate) ? undefined : convertedFromEstimate.estimateNumber);
      setSourceEnquiryId(convertedFromEstimate.sourceEnquiryId);
      setSourceEnquiryNumber(convertedFromEstimate.sourceEnquiryNumber);
      // Carry document-level adjustments (overall discount / freight / round-off)
      // over to the invoice so conversion preserves quotation pricing.
      setOverallDiscountType(convertedFromEstimate.overallDiscountType || '%');
      setOverallDiscountValue(convertedFromEstimate.overallDiscountValue || 0);
      setShippingCharges(convertedFromEstimate.shippingCharges || 0);
      setRoundOffEnabled(convertedFromEstimate.roundOffEnabled ?? true);

      // Map Estimate line items to Invoice line items (preserve per-line discounts)
      const convertedItems: InvoiceLineItem[] = convertedFromEstimate.items.map((estItem) => {
        let discType = estItem.discountType || '%';
        let discVal = estItem.discount || estItem.discountValue || 0;
        // E2E-14: a line with no discount of its own (an order prefill, or a
        // quote line left at 0) gets the item's standard discount, as when the
        // item is picked on the form.
        const stdMaster = !discVal && estItem.itemId && !estItem.isCombo ? items.find((i) => i.id === estItem.itemId) : undefined;
        const std = stdMaster ? standardDiscountFor(stdMaster, Number(estItem.quantity) || 1) : null;
        if (std && std.discountValue > 0) { discType = std.discountType; discVal = std.discountValue; }
        const fresh = refreshCopiedLine(estItem, estItem.gstRate ?? estItem.taxRate ?? 0, convertedFromEstimate.branchId);
        const rate = fresh.rate;
        const lineTax = calculateLineTax(
          estItem.quantity,
          estItem.unitPrice,
          rate,
          convertedFromEstimate.withGst,
          discType,
          discVal
        );
        return {
          id: `li-conv-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          stdDiscountPerUnit: std?.stdDiscountPerUnit ?? null,
          itemId: estItem.itemId,
          itemName: estItem.itemName,
          itemHSN: estItem.itemHSN,
          itemCode: fresh.itemCode,
          unit: estItem.unit,
          quantity: estItem.quantity,
          unitPrice: estItem.unitPrice,
          discountType: discType,
          discountValue: discVal,
          discountAmount: (estItem.quantity * estItem.unitPrice) - lineTax.taxableAmount,
          taxRate: rate,
          taxableAmount: lineTax.taxableAmount,
          cgstAmount: lineTax.cgstAmount,
          sgstAmount: lineTax.sgstAmount,
          totalTax: lineTax.totalTax,
          totalAmount: lineTax.totalAmount,
          isCombo: estItem.isCombo,
          comboId: estItem.comboId,
          comboComponents: estItem.comboComponents,
        };
      });
      setLineItems(convertedItems);

      // Generate invoice number for this branch
      const generated = getNextInvoiceNumber(convertedFromEstimate.branchId);
      setInvoiceNumber(generated);
      toast.info(isEnquiryPrefill(convertedFromEstimate) ? `Pre-filled from Enquiry ${convertedFromEstimate.sourceEnquiryNumber}` : `Pre-filled from Estimate ${convertedFromEstimate.estimateNumber}`, {
        description: 'All customer details, items, and pricing loaded. Review and save.',
        id: `prefill-${convertedFromEstimate.id}`, // one toast even if the effect runs twice (TOAST-1)
      });
    } else if (initialEstimate) {
      // Pre-fill from existing Estimate (editing a quotation)
      setDocumentType('Quotation');
      setSelectedBranch(initialEstimate.branchId);
      setInvoiceNumber(initialEstimate.estimateNumber);
      setDate(initialEstimate.date);
      setTime(initialEstimate.time);
      setCustomerId(initialEstimate.customerId);
      setCustomerName(initialEstimate.customerName);
      setCustomerPhone(initialEstimate.customerContact || '');
      setCustomerAddress(initialEstimate.customerAddress || '');
      setWithGst(initialEstimate.withGst);
      setStateOfSupply(initialEstimate.stateOfSupply || '33-Tamil Nadu');
      setTerms(initialEstimate.termsAndConditions || INVOICE_TERMS_PRESETS[0].terms);
      setSourceEnquiryId(initialEstimate.sourceEnquiryId);
      setSourceEnquiryNumber(initialEstimate.sourceEnquiryNumber);
      setOverallDiscountType(initialEstimate.overallDiscountType || '%');
      setOverallDiscountValue(initialEstimate.overallDiscountValue || 0);
      setShippingCharges(initialEstimate.shippingCharges || 0);
      setRoundOffEnabled(initialEstimate.roundOffEnabled ?? true);

      const quoteItems: InvoiceLineItem[] = initialEstimate.items.map((estItem) => {
        const discType = estItem.discountType || '%';
        const discVal = estItem.discount || estItem.discountValue || 0;
        const rate = estItem.gstRate ?? estItem.taxRate ?? 0;
        const lineTax = calculateLineTax(
          estItem.quantity,
          estItem.unitPrice,
          rate,
          initialEstimate.withGst,
          discType,
          discVal
        );
        return {
          id: estItem.id || `li-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          itemId: estItem.itemId,
          itemName: estItem.itemName,
          itemHSN: estItem.itemHSN,
          itemCode: refreshCopiedLine(estItem, rate, initialEstimate.branchId).itemCode,
          unit: estItem.unit,
          quantity: estItem.quantity,
          unitPrice: estItem.unitPrice,
          discountType: discType,
          discountValue: discVal,
          discountAmount: (estItem.quantity * estItem.unitPrice) - lineTax.taxableAmount,
          taxRate: rate,
          taxableAmount: lineTax.taxableAmount,
          cgstAmount: lineTax.cgstAmount,
          sgstAmount: lineTax.sgstAmount,
          totalTax: lineTax.totalTax,
          totalAmount: lineTax.totalAmount,
          isCombo: estItem.isCombo,
          comboId: estItem.comboId,
          comboComponents: estItem.comboComponents,
          leadDays: estItem.leadDays,
        };
      });
      setLineItems(quoteItems);
    } else if (duplicateSourceEstimate) {
      // Duplicate an existing quotation: copy items, rates, terms, but clear customer and get fresh EST sequence
      setDocumentType('Quotation');
      setSelectedBranch(duplicateSourceEstimate.branchId);
      setDate(getTodayDateString());
      const d = new Date();
      setTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
      setCustomerName('');
      setCustomerPhone('');
      setCustomerAddress('');
      setCustomerId(undefined);
      setIsLoyaltyRewardApplied(false);
      setWithGst(duplicateSourceEstimate.withGst);
      setStateOfSupply(duplicateSourceEstimate.stateOfSupply || '33-Tamil Nadu');
      setTerms(duplicateSourceEstimate.termsAndConditions || INVOICE_TERMS_PRESETS[0].terms);
      setOverallDiscountType(duplicateSourceEstimate.overallDiscountType || '%');
      setOverallDiscountValue(duplicateSourceEstimate.overallDiscountValue || 0);
      setShippingCharges(duplicateSourceEstimate.shippingCharges || 0);
      setRoundOffEnabled(duplicateSourceEstimate.roundOffEnabled ?? true);

      const dupQuoteItems: InvoiceLineItem[] = duplicateSourceEstimate.items.map((estItem) => {
        const discType = estItem.discountType || '%';
        const discVal = estItem.discount || estItem.discountValue || 0;
        const fresh = refreshCopiedLine(estItem, estItem.gstRate ?? estItem.taxRate ?? 0, duplicateSourceEstimate.branchId);
        const rate = fresh.rate;
        const lineTax = calculateLineTax(
          estItem.quantity,
          estItem.unitPrice,
          rate,
          duplicateSourceEstimate.withGst,
          discType,
          discVal
        );
        return {
          id: `li-dup-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          itemId: estItem.itemId,
          itemName: estItem.itemName,
          itemHSN: estItem.itemHSN,
          itemCode: fresh.itemCode,
          unit: estItem.unit,
          quantity: estItem.quantity,
          unitPrice: estItem.unitPrice,
          discountType: discType,
          discountValue: discVal,
          discountAmount: (estItem.quantity * estItem.unitPrice) - lineTax.taxableAmount,
          taxRate: rate,
          taxableAmount: lineTax.taxableAmount,
          cgstAmount: lineTax.cgstAmount,
          sgstAmount: lineTax.sgstAmount,
          totalTax: lineTax.totalTax,
          totalAmount: lineTax.totalAmount,
          isCombo: estItem.isCombo,
          comboId: estItem.comboId,
          comboComponents: estItem.comboComponents,
          leadDays: estItem.leadDays,
        };
      });
      setLineItems(dupQuoteItems);

      const generated = getNextEstimateNumber(duplicateSourceEstimate.branchId, getTodayDateString());
      setInvoiceNumber(generated);
      toast.info(`Duplicated from Quotation #${duplicateSourceEstimate.estimateNumber}`, {
        id: `dup-est-${duplicateSourceEstimate.id}`, // SAL9-15
        description: 'All items and pricing copied. Please search or enter a customer to proceed.',
      });
    } else if (duplicateSourceInvoice) {
      // Duplicate an existing invoice: copy items, rates, taxes, terms, but CLEAR customer and get fresh invoice number
      setSelectedBranch(duplicateSourceInvoice.branchId);
      setTransactionType(duplicateSourceInvoice.transactionType || 'Cash');
      setDate(getTodayDateString());
      const d = new Date();
      setTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
      setCustomerName('');
      setCustomerPhone('');
      setCustomerAddress('');
      setCustomerId(undefined);
      setIsLoyaltyRewardApplied(false);
      setPaymentTerms(duplicateSourceInvoice.paymentTerms || 'Due on Receipt');
      setDueDate(getTodayDateString());
      setStateOfSupply(duplicateSourceInvoice.stateOfSupply || '33-Tamil Nadu');
      setWithGst(duplicateSourceInvoice.withGst);
      setPaymentSplits(getInvoicePaymentSplits(duplicateSourceInvoice));
      setIsPartialPayment(false);
      setPartialAmount(0);
      setOverallDiscountType(duplicateSourceInvoice.overallDiscountType || '%');
      setOverallDiscountValue(duplicateSourceInvoice.overallDiscountValue || 0);
      setShippingCharges(duplicateSourceInvoice.shippingCharges || 0);
      setRoundOffEnabled(duplicateSourceInvoice.roundOffEnabled ?? true);
      setTerms(duplicateSourceInvoice.termsAndConditions || INVOICE_TERMS_PRESETS[0].terms);
      setDescription(duplicateSourceInvoice.description || '');
      setAttachments(duplicateSourceInvoice.attachments ? [...duplicateSourceInvoice.attachments] : []);
      setSourceEstimateId(undefined);
      setSourceEstimateNumber(undefined);
      setSourceEnquiryId(undefined);
      setSourceEnquiryNumber(undefined);

      // Clone line items with fresh unique IDs
      const duplicatedItems: InvoiceLineItem[] = duplicateSourceInvoice.items.map((item) => {
        const fresh = refreshCopiedLine(item, item.taxRate ?? 0, duplicateSourceInvoice.branchId);
        const calc = calculateLineTax(item.quantity, item.unitPrice, fresh.rate, duplicateSourceInvoice.withGst, item.discountType || '%', item.discountValue || 0);
        return {
          ...item,
          ...calc,
          itemCode: fresh.itemCode,
          taxRate: fresh.rate,
          id: `li-dup-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        };
      });
      setLineItems(duplicatedItems);

      const generated = getNextInvoiceNumber(duplicateSourceInvoice.branchId);
      setInvoiceNumber(generated);
      toast.info(`Duplicated from Invoice #${duplicateSourceInvoice.invoiceNumber}`, {
        id: `dup-inv-${duplicateSourceInvoice.id}`, // SAL9-15: shown once, even if the form re-runs this
        description: 'All items and pricing copied. Please search or enter a customer to proceed.',
      });
    } else {
      // Fresh new document
      if (documentType === 'Quotation') {
        const generated = getNextEstimateNumber(selectedBranch, date);
        setInvoiceNumber(generated);
      } else {
        const generated = getNextInvoiceNumber(selectedBranch, date);
        setInvoiceNumber(generated);
        setTransactionType('Cash');
        setPaymentSplits([{ mode: 'Cash', amount: totals.grandTotal }]);
      }
    }
    // Seed the form ONCE per source document. Keyed on the source identity only
    // — NOT on selectedBranch/date (which this effect itself sets) or the context
    // getter refs (which change on every live-sync re-bootstrap). Including those
    // caused the effect to re-run and wipe in-progress edits / re-fire the
    // "Pre-filled from Estimate" toast repeatedly. The form is remounted via a
    // `key` when a new source is chosen, so this is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialInvoice?.id, initialEstimate?.id, convertedFromEstimate?.id, duplicateSourceInvoice?.id, duplicateSourceEstimate?.id]);

  // One-time restore: if this NEW bill tab was handed its last working copy (it
  // may have just (re)mounted mid-entry) and there is no explicit edit source,
  // seed the form from it ONCE on mount so an in-progress bill is never shown
  // empty. Mount-only (empty deps) so it never re-seeds / fights live typing.
  const didRestoreRef = useRef(false);
  useEffect(() => {
    if (didRestoreRef.current) return;
    didRestoreRef.current = true;
    const seed = restoreSeed as Invoice | undefined;
    if (!seed || initialInvoice || initialEstimate || convertedFromEstimate || duplicateSourceInvoice || duplicateSourceEstimate) return;
    if (!(seed.items && seed.items.length)) return;
    // Keep the original bill identity so a re-save still dedupes correctly.
    if (seed.clientKey) billKeyRef.current = seed.clientKey;
    if (seed.id) billIdRef.current = seed.id;
    setLineItems(seed.items);
    if (seed.customerName) setCustomerName(seed.customerName);
    if (seed.customerPhone) setCustomerPhone(seed.customerPhone);
    if (seed.customerAddress) setCustomerAddress(seed.customerAddress);
    if (seed.date) setDate(seed.date);
    if (typeof seed.withGst === 'boolean') setWithGst(seed.withGst);
    if (seed.paymentSplits && seed.paymentSplits.length) setPaymentSplits(seed.paymentSplits);
    if (seed.overallDiscountType) setOverallDiscountType(seed.overallDiscountType);
    if (seed.overallDiscountValue != null) setOverallDiscountValue(seed.overallDiscountValue);
    if (seed.shippingCharges != null) setShippingCharges(seed.shippingCharges);
    if (seed.invoiceNumber) setInvoiceNumber(seed.invoiceNumber);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep document number in sync with financial year and mode when date or branch changes
  useEffect(() => {
    if (!initialInvoice && !initialEstimate) {
      if (documentType === 'Quotation') {
        const generated = getNextEstimateNumber(selectedBranch, date);
        setInvoiceNumber(generated);
      } else {
        const generated = getNextInvoiceNumber(selectedBranch, date);
        setInvoiceNumber(generated);
      }
    }
  }, [selectedBranch, date, documentType, initialInvoice, initialEstimate, getNextInvoiceNumber, getNextEstimateNumber]);

  // Mode switcher handler
  // Ensure at least one row exists
  useEffect(() => {
    if (
      lineItems.length === 0 &&
      !initialInvoice &&
      !initialEstimate &&
      !convertedFromEstimate &&
      !duplicateSourceInvoice &&
      !duplicateSourceEstimate
    ) {
      addNewRow();
    }
  }, [lineItems.length, initialInvoice, initialEstimate, convertedFromEstimate, duplicateSourceInvoice, duplicateSourceEstimate]);

  // #9 Organization customers are billed at wholesale rates. When the selected
  // customer is an Organization and the item has a wholesale price, use it as
  // the base price; otherwise fall back to the normal sale price. The item's
  // tax mode (incl./excl.) is applied consistently to whichever price is used.
  const isWholesaleCustomer = selectedCustomerObj?.customerType === 'Organization';

  // SAL8-5 / E2E8-7: the place of supply follows the buyer's GSTIN state code
  // (its first 2 digits) when the customer has one; it stays editable below.
  // SAL9-3: when the CUSTOMER changes, the place of supply follows the new
  // customer — their GSTIN state, or Tamil Nadu when they have none — instead
  // of keeping the previous customer's state. The first customer seen when an
  // existing bill/quote opens keeps the stored place of supply.
  const lastGstinRef = useRef<string | undefined>(undefined);
  const lastCustomerKeyRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const key = selectedCustomerObj?.id ?? null;
    const gstin = selectedCustomerObj?.gstin || undefined;
    const first = lastCustomerKeyRef.current === undefined;
    const customerChanged = !first && key !== lastCustomerKeyRef.current;
    lastCustomerKeyRef.current = key;
    if (gstin && gstin !== lastGstinRef.current) {
      lastGstinRef.current = gstin;
      const pos = supplyFromGstin(gstin);
      if (pos) setStateOfSupply(pos);
      return;
    }
    lastGstinRef.current = gstin;
    if (customerChanged && !gstin) setStateOfSupply('33-Tamil Nadu');
  }, [selectedCustomerObj?.id, selectedCustomerObj?.gstin]);
  const supplyOptions = useMemo(() => {
    const list = [...INDIAN_STATES];
    for (const [code, name] of Object.entries(GST_STATE_CODES)) {
      const opt = `${code}-${name}`;
      if (!list.includes(opt)) list.push(opt);
    }
    if (stateOfSupply && !list.includes(stateOfSupply)) list.unshift(stateOfSupply);
    return list;
  }, [stateOfSupply]);

  // The GST rate to charge for an item at the branch this bill belongs to.
  // A branch that corrected the rate while receiving stock (BranchStock.
  // gstTaxSlab) charges that rate; everywhere else the catalog slab stands.
  // Reading item.gstTaxSlab directly here would quietly bill the old rate.
  const taxSlabFor = (item: Item): number =>
    effectiveTaxSlab(
      item.gstTaxSlab,
      branchStocks.find((bs) => bs.itemId === item.id && bs.branchId === selectedBranch)?.gstTaxSlab,
    );
  // SAL-21: the wholesale price applies from the item's minimum wholesale quantity.
  const wholesaleApplies = (item: Item, qty: number): boolean =>
    isWholesaleCustomer && item.wholesalePrice > 0 && qty >= (Number(item.minWholesaleQty) || 1);
  const getItemPreTaxPrice = (item: Item, qty = 1, forceBase?: 'sale' | 'wholesale'): number => {
    const useWholesale = forceBase ? forceBase === 'wholesale' : wholesaleApplies(item, qty);
    const base = useWholesale && item.wholesalePrice > 0 ? item.wholesalePrice : item.salePrice;
    const factor = 1 + taxSlabFor(item) / 100;
    // GST-ON representation of the unit price (pre-tax portion), unchanged from before.
    const preOn = item.salePriceTaxMode === 'with' ? base / factor : base;
    // GST is DISPLAY-ONLY: the amount charged must be identical whether GST is on or off.
    // GST on → store the pre-tax portion (tax is shown on top, total = charged price).
    // GST off → store the full charged price (no tax line, same total).
    const value = withGst ? preOn : preOn * factor;
    // SAL-12: an ex-tax price worked back from a tax-INCLUSIVE price keeps its
    // full precision (₹28,500 incl. 18% → 24,152.542373), so the bill comes back
    // to exactly ₹28,500.00 at any quantity — rounding it to the paisa first
    // lost money on larger quantities.
    if (withGst && item.salePriceTaxMode === 'with') return Math.round(value * 1e6) / 1e6;
    return Math.round(value * 100) / 100;
  };

  // E2E-14: the item's standard (catalogue) discount is the line's default
  // discount. A %-off stays a % of the line. E2E9-1: a ₹-off stays an AMOUNT —
  // per unit, in the same tax basis as the line's price — and follows the
  // quantity (it was a 4-decimal % that never came out to the round rupee).
  const standardDiscountFor = (item: Item, qty = 1): { discountType: DiscountType; discountValue: number; stdDiscountPerUnit: number | null } => {
    const d = Number(item.discountOnSalePrice) || 0;
    if (d <= 0) return { discountType: '%', discountValue: 0, stdDiscountPerUnit: null };
    if ((item.discountType || '%') === '%') return { discountType: '%', discountValue: Math.min(100, d), stdDiscountPerUnit: null };
    const factor = 1 + taxSlabFor(item) / 100;
    const inclusive = item.salePriceTaxMode === 'with';
    const perUnit = Math.round((withGst ? (inclusive ? d / factor : d) : (inclusive ? d : d * factor)) * 100) / 100;
    return { discountType: 'amount', discountValue: Math.round(perUnit * qty * 100) / 100, stdDiscountPerUnit: perUnit };
  };

  // SAL2-8: a catalogue item's own unit decides whether fractions are allowed;
  // a kit is always whole sets.
  const lineIsWholeUnit = (li: InvoiceLineItem): boolean => {
    if (li.isCombo) return true;
    const master = li.itemId ? items.find((i) => i.id === li.itemId) : undefined;
    if (master) return isWholeUnit(master.unit);
    // A typed line counts whole only when it names a counted unit (as the server).
    return !!li.unit && isWholeUnit(li.unit);
  };
  // SAL8-9: a line typed but never picked from the catalogue, with no price.
  const isZeroFreeTextLine = (li: InvoiceLineItem): boolean =>
    !li.isCombo && !li.itemId && !!li.itemName.trim() && !((Number(li.unitPrice) || 0) > 0);

  // The freshly-added blank row whose item search should auto-focus (POS-style).
  const [focusRowId, setFocusRowId] = useState<string | null>(null);
  // Salesperson selector is OPEN by default so the counter can pick who made the
  // sale while billing, without first clicking "+ Add Salesperson" (client 2026-10-27).
  const [showSalesperson, setShowSalesperson] = useState(true);
  // Dispatch / courier details (counter sale) — printed on the GST bill (#5).
  const [dispatchCourier, setDispatchCourier] = useState(initialInvoice?.dispatchCourier || '');
  const [dispatchDate, setDispatchDate] = useState(initialInvoice?.dispatchDate || '');
  const [dispatchDocket, setDispatchDocket] = useState(initialInvoice?.dispatchDocket || '');
  const [showDispatch, setShowDispatch] = useState(
    !!(initialInvoice?.dispatchCourier || initialInvoice?.dispatchDocket || initialInvoice?.dispatchDate)
  );
  // Bulk add by SKU (#4c) — paste the customer's list (SKU or "SKU qty").
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  // Phone-camera barcode scanning → add straight to the bill (same path as the
  // USB scanner wedge). Opens the rear camera; each read calls handleScanSubmit.
  const [scanOpen, setScanOpen] = useState(false);

  const addNewRow = (selectedItem?: Item) => {
    const newId = `li-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    let newRow: InvoiceLineItem;

    if (selectedItem) {
      const roundedPrice = getItemPreTaxPrice(selectedItem);
      const std = standardDiscountFor(selectedItem);
      const calculated = calculateLineTax(1, roundedPrice, taxSlabFor(selectedItem), withGst, std.discountType, std.discountValue);

      newRow = {
        id: newId,
        itemId: selectedItem.id,
        itemCode: selectedItem.itemCode,
        itemName: selectedItem.itemName,
        itemHSN: selectedItem.itemHSN,
        quantity: 1,
        unit: selectedItem.unit,
        unitPrice: roundedPrice,
        discountType: std.discountType,
        discountValue: std.discountValue,
        stdDiscountPerUnit: std.stdDiscountPerUnit,
        discountAmount: calculated.discountAmount,
        taxRate: taxSlabFor(selectedItem),
        taxableAmount: calculated.taxableAmount,
        cgstAmount: calculated.cgstAmount,
        sgstAmount: calculated.sgstAmount,
        totalTax: calculated.totalTax,
        totalAmount: calculated.totalAmount,
      };
    } else {
      newRow = {
        id: newId,
        itemName: '',
        itemHSN: '',
        quantity: 1,
        unit: 'PCS',
        unitPrice: 0,
        discountType: '%',
        discountValue: 0,
        discountAmount: 0,
        taxRate: isBulkTaxOpen ? bulkTaxRate : 18,
        taxableAmount: 0,
        cgstAmount: 0,
        sgstAmount: 0,
        totalTax: 0,
        totalAmount: 0,
      };
    }

    setLineItems((prev) => [...prev, newRow]);
    // Only auto-focus a blank row (typed entry); scanned rows already have an item.
    if (!selectedItem) setFocusRowId(newId);
  };

  // Build a complete line item from a catalog item + quantity (mirrors addNewRow).
  const buildLineFromItem = (item: Item, qty: number): InvoiceLineItem => {
    const price = getItemPreTaxPrice(item, qty);
    const std = standardDiscountFor(item);
    const rate = taxSlabFor(item);
    const calc = calculateLineTax(qty, price, rate, withGst, std.discountType, std.discountValue);
    return {
      id: `li-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      itemId: item.id, itemCode: item.itemCode, itemName: item.itemName, itemHSN: item.itemHSN,
      quantity: qty, unit: item.unit, unitPrice: price,
      discountType: std.discountType, discountValue: std.discountValue, stdDiscountPerUnit: std.stdDiscountPerUnit,
      discountAmount: calc.discountAmount, taxRate: rate,
      taxableAmount: calc.taxableAmount, cgstAmount: calc.cgstAmount, sgstAmount: calc.sgstAmount,
      totalTax: calc.totalTax, totalAmount: calc.totalAmount,
    };
  };

  // Out-of-catalog quote lines → Enquiries "New items" (#4d), so products the
  // customer asked for that we don't stock get logged and can flow to a PO.
  const outOfCatalogLines = lineItems.filter((l) => !l.itemId && !l.isCombo && l.itemName.trim());
  const handleSendNewItemsToEnquiries = () => {
    if (!outOfCatalogLines.length) return;
    const now = new Date().toISOString();
    outOfCatalogLines.forEach((l, i) => {
      const enq: Enquiry = {
        id: `enq-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
        enquiryNumber: 'DRAFT', // server assigns a collision-free number
        customerName: customerName.trim() ? cleanCustomerName(customerName) : 'Walk-in Customer',
        customerPhone: customerPhone.trim() || undefined,
        itemId: undefined,
        itemName: l.itemName.trim(),
        itemCode: l.itemCode || undefined,
        unit: l.unit || 'Units',
        quantity: l.quantity || 1,
        branchId: selectedBranch,
        date,
        time,
        notes: `New item requested on quotation${invoiceNumber ? ` ${invoiceNumber}` : ''}${l.leadDays ? ` · lead ${l.leadDays}d` : ''}`,
        status: 'Follow-up',
        isNewItemRequest: true,
        createdAt: now,
        updatedAt: now,
      };
      saveEnquiry(enq);
    });
    toast.success(`${outOfCatalogLines.length} new item(s) sent to Enquiries`, {
      description: 'Logged as "New item" requests — follow up and raise a PO from Enquiries.',
    });
  };

  // Bulk add by SKU (#4c): paste the customer's list, one item per line as
  // "SKU" or "SKU qty" / "SKU,qty" / "SKU<tab>qty". Known codes become catalog
  // lines; unknown codes become editable free-text lines (fill price/name).
  const handleBulkAdd = () => {
    const text = bulkText.trim();
    if (!text) return;
    const codeMap = new Map(items.map((i) => [String(i.itemCode || '').trim().toUpperCase(), i]));
    // Start from the current non-empty lines and MERGE into them (no duplicates).
    const working: InvoiceLineItem[] = lineItems.filter((l) => l.itemName.trim() || l.itemId).map((l) => ({ ...l }));
    const setQty = (line: InvoiceLineItem, qty: number): InvoiceLineItem => {
      const q = Math.min(qty, getLineMaxQty(line));
      const calc = calculateLineTax(q, line.unitPrice, line.taxRate, withGst, line.discountType || '%', line.discountValue || 0);
      return { ...line, quantity: q, discountAmount: calc.discountAmount, taxableAmount: calc.taxableAmount, cgstAmount: calc.cgstAmount, sgstAmount: calc.sgstAmount, totalTax: calc.totalTax, totalAmount: calc.totalAmount };
    };
    let matched = 0, unknown = 0, outOfStock = 0, merged = 0;
    for (const raw of text.split(/\r?\n/)) {
      const lineStr = raw.trim();
      if (!lineStr) continue;
      const parts = lineStr.split(/[,\t]|\s{2,}|\s+/).map((s) => s.trim()).filter(Boolean);
      const code = parts[0];
      const qty = Math.max(1, Math.round(Number(parts[1]) || 1));
      if (!code) continue;
      const item = codeMap.get(code.toUpperCase());
      if (item) {
        if (documentType === 'Invoice') {
          const stockRow = branchStocks.find((s) => s.itemId === item.id && s.branchId === selectedBranch);
          if ((stockRow?.quantity ?? 0) <= 0) { outOfStock++; continue; }
        }
        const ix = working.findIndex((l) => l.itemId === item.id && !l.isCombo);
        if (ix >= 0) { working[ix] = setQty(working[ix], working[ix].quantity + qty); merged++; }
        else { working.push(buildLineFromItem(item, qty)); matched++; }
      } else {
        const ix = working.findIndex((l) => !l.itemId && String(l.itemCode || '').toUpperCase() === code.toUpperCase());
        if (ix >= 0) { working[ix] = setQty(working[ix], working[ix].quantity + qty); merged++; }
        else {
          working.push({
            id: `li-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            itemCode: code, itemName: code, itemHSN: '', quantity: qty, unit: 'PCS', unitPrice: 0,
            discountType: '%', discountValue: 0, discountAmount: 0, taxRate: 18,
            taxableAmount: 0, cgstAmount: 0, sgstAmount: 0, totalTax: 0, totalAmount: 0,
          });
          unknown++;
        }
      }
    }
    if (!matched && !unknown && !merged) { toast.error('No SKUs found to add'); return; }
    setLineItems(working);
    setBulkOpen(false);
    setBulkText('');
    toast.success(`Bulk add done`, {
      description: [matched && `${matched} new`, merged && `${merged} merged`, unknown && `${unknown} not in catalog (fill price)`, outOfStock && `${outOfStock} skipped (out of stock)`].filter(Boolean).join(' · '),
    });
  };

  // #3 Max sellable quantity for a line at the selected branch.
  // Combos are limited by how many kits their component stock allows;
  // plain items by their branch stock. Quotations don't deduct stock, so
  // they are not clamped. Returns Infinity when no limit applies.
  const getLineMaxQty = (line: InvoiceLineItem): number => {
    if (documentType !== 'Invoice') return Infinity;
    if (line.isCombo && line.comboId) {
      const combo = combos.find((c) => c.id === line.comboId);
      return combo ? getComboAvailability(combo, selectedBranch) : Infinity;
    }
    if (line.itemId) {
      const stockRow = branchStocks.find(
        (s) => s.itemId === line.itemId && s.branchId === selectedBranch
      );
      return stockRow?.quantity ?? Infinity;
    }
    return Infinity;
  };

  const updateLineItem = (id: string, updates: Partial<InvoiceLineItem>) => {
    setLineItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;

        const merged = { ...item, ...updates };
        // E2E9-1: a hand-set discount replaces the standard one.
        if ((updates.discountValue !== undefined || updates.discountType !== undefined) && updates.stdDiscountPerUnit === undefined) {
          merged.stdDiscountPerUnit = null;
        }
        let qty = Number(merged.quantity) || 0;

        // Clamp quantity to available stock so a bill can never be raised for
        // more than exists (e.g. a 5-kit combo can't be billed for 6). #3
        if (updates.quantity !== undefined) {
          const maxQty = getLineMaxQty(merged as InvoiceLineItem);
          if (Number.isFinite(maxQty) && qty > maxQty) {
            qty = maxQty;
            merged.quantity = maxQty;
            toast.warning('Reached available stock limit', {
              description: `Only ${maxQty} ${merged.isCombo ? 'kit(s)' : 'unit(s)'} of "${merged.itemName}" available at ${BRANCHES.find((b) => b.id === selectedBranch)?.name || 'this branch'}.`,
            });
          }
        }
        const price = Number(merged.unitPrice) || 0;
        const rate = Number(merged.taxRate) || 0;
        const dType = merged.discountType || '%';
        let dVal = Number(merged.discountValue) || 0;
        // E2E9-1: the standard ₹-off follows the quantity.
        if (dType === 'amount' && merged.stdDiscountPerUnit != null && (updates.quantity !== undefined || updates.stdDiscountPerUnit !== undefined)) {
          dVal = Math.round(Number(merged.stdDiscountPerUnit) * qty * 100) / 100;
        }

        const calculated = calculateLineTax(qty, price, rate, withGst, dType, dVal);

        return {
          ...merged,
          quantity: qty,
          unitPrice: price,
          taxRate: rate,
          discountType: dType,
          discountValue: dVal,
          discountAmount: calculated.discountAmount,
          taxableAmount: calculated.taxableAmount,
          cgstAmount: calculated.cgstAmount,
          sgstAmount: calculated.sgstAmount,
          totalTax: calculated.totalTax,
          totalAmount: calculated.totalAmount,
        };
      })
    );
  };

  // SAL-21: a catalogue line follows the wholesale rule as its quantity or the
  // customer changes (an Organization buyer at or above the item's minimum
  // wholesale quantity pays the wholesale price) — unless the price was typed
  // by hand (then it is neither of the two catalogue prices and is left alone).
  const wholesaleKey = lineItems.map((l) => `${l.id}:${l.itemId || ''}:${l.quantity}`).join('|');
  // Only a change made here re-prices: a line seen for the first time (picked
  // just now, or loaded from a stored bill/quote) keeps its price.
  const wholesaleSeenRef = useRef<{ lines: Map<string, { itemId: string; qty: number }>; customer: boolean | null }>({ lines: new Map(), customer: null });
  useEffect(() => {
    const seen = wholesaleSeenRef.current;
    const customerChanged = seen.customer !== null && seen.customer !== isWholesaleCustomer && !isSavedBill;
    seen.customer = isWholesaleCustomer;
    const next = new Map<string, { itemId: string; qty: number }>();
    for (const li of lineItems) {
      const qty = Number(li.quantity) || 0;
      const prev = seen.lines.get(li.id);
      next.set(li.id, { itemId: li.itemId || '', qty });
      if (!li.itemId || li.isCombo || !prev || prev.itemId !== li.itemId) continue;
      if (!customerChanged && prev.qty === qty) continue;
      const master = items.find((i) => i.id === li.itemId);
      if (!master || !(master.wholesalePrice > 0)) continue;
      const retail = getItemPreTaxPrice(master, 1, 'sale');
      const wholesale = getItemPreTaxPrice(master, 1, 'wholesale');
      const want = wholesaleApplies(master, qty) ? wholesale : retail;
      const cur = Number(li.unitPrice) || 0;
      const isCatalogue = Math.abs(cur - retail) < 0.000001 || Math.abs(cur - wholesale) < 0.000001;
      if (isCatalogue && Math.abs(cur - want) > 0.000001) updateLineItem(li.id, { unitPrice: want });
    }
    seen.lines = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wholesaleKey, isWholesaleCustomer]);

  const selectMasterItemForRow = (rowId: string, item: Item) => {
    const stockRow = branchStocks.find((s) => s.itemId === item.id && s.branchId === selectedBranch);
    const availableQty = stockRow?.quantity ?? 0;
    // Quotations don't deduct stock, so they may quote out-of-stock items.
    if (documentType === 'Invoice' && availableQty <= 0) {
      toast.error('Out of stock at this branch', {
        description: `"${item.itemName}" has 0 available stock at ${BRANCHES.find((b) => b.id === selectedBranch)?.name || 'this branch'}.`,
      });
      return;
    }

    // Same product already on another line → merge quantities instead of adding
    // a duplicate row (same behaviour as the barcode scanner).
    const existingLine = lineItems.find((li) => li.id !== rowId && li.itemId === item.id && !li.isCombo);
    if (existingLine) {
      const addQty = Number(lineItems.find((l) => l.id === rowId)?.quantity) || 1;
      const nextQty = Math.min(existingLine.quantity + addQty, getLineMaxQty(existingLine));
      updateLineItem(existingLine.id, { quantity: nextQty });
      updateLineItem(rowId, { itemName: '', itemId: undefined, itemCode: '', itemHSN: '', unitPrice: 0, isCombo: false, comboId: undefined, comboComponents: undefined });
      setFocusRowId(existingLine.id);
      toast.info(`"${item.itemName}" is already added — quantity updated to ${nextQty}.`);
      return;
    }

    const roundedPrice = getItemPreTaxPrice(item, Number(lineItems.find((l) => l.id === rowId)?.quantity) || 1);

    updateLineItem(rowId, {
      itemId: item.id,
      itemCode: item.itemCode,
      itemName: item.itemName,
      itemHSN: item.itemHSN,
      unit: item.unit,
      unitPrice: roundedPrice,
      taxRate: isBulkTaxOpen ? bulkTaxRate : taxSlabFor(item),
      ...standardDiscountFor(item),
      isCombo: false,
      comboId: undefined,
      comboComponents: undefined,
    });
    // Picking a product on the last row instantly readies the next entry row
    // and focuses it — type → pick → type → pick, hands-free billing.
    if (lineItems.length > 0 && lineItems[lineItems.length - 1].id === rowId) {
      addNewRow();
    }
  };

  const selectComboForRow = (rowId: string, combo: ComboItem) => {
    const availQty = getComboAvailability(combo, selectedBranch);
    if (documentType === 'Invoice' && availQty <= 0) {
      toast.error('Combo out of stock at this branch', {
        description: `"${combo.comboName}" currently has 0 available kits at ${BRANCHES.find((b) => b.id === selectedBranch)?.name || 'this branch'} due to component stock.`,
      });
      return;
    }

    // Same combo already on another line → merge quantities.
    const existingCombo = lineItems.find((li) => li.id !== rowId && li.comboId === combo.id && li.isCombo);
    if (existingCombo) {
      const addQty = Number(lineItems.find((l) => l.id === rowId)?.quantity) || 1;
      const nextQty = Math.min(existingCombo.quantity + addQty, getLineMaxQty(existingCombo));
      updateLineItem(existingCombo.id, { quantity: nextQty });
      updateLineItem(rowId, { itemName: '', itemId: undefined, itemCode: '', itemHSN: '', unitPrice: 0, isCombo: false, comboId: undefined, comboComponents: undefined });
      setFocusRowId(existingCombo.id);
      toast.info(`"${combo.comboName}" is already added — quantity updated to ${nextQty}.`);
      return;
    }

    const comboRate = isBulkTaxOpen ? bulkTaxRate : 18;
    const comboUnit = withGst
      ? combo.comboPrice
      : Math.round(combo.comboPrice * (1 + comboRate / 100) * 100) / 100;
    updateLineItem(rowId, {
      itemId: combo.id,
      itemCode: combo.comboCode,
      itemName: combo.comboName,
      itemHSN: '85371000',
      unit: 'SET',
      unitPrice: comboUnit,
      taxRate: comboRate,
      isCombo: true,
      comboId: combo.id,
      comboComponents: combo.components,
    });
    if (lineItems.length > 0 && lineItems[lineItems.length - 1].id === rowId) {
      addNewRow();
    }
  };

  // ---- Barcode / item-code scan → add straight to the bill (counter speed) ----
  // No visible scan box: a USB scanner is captured by the global wedge below.
  const branchLabel = BRANCHES.find((b) => b.id === selectedBranch)?.name || 'this branch';

  const appendComboRow = (combo: ComboItem) => {
    const newId = `li-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    const rate = isBulkTaxOpen ? bulkTaxRate : 18;
    const comboUnit = withGst
      ? combo.comboPrice
      : Math.round(combo.comboPrice * (1 + rate / 100) * 100) / 100;
    const calc = calculateLineTax(1, comboUnit, rate, withGst);
    setLineItems((prev) => [
      ...prev,
      {
        id: newId, itemId: combo.id, itemCode: combo.comboCode, itemName: combo.comboName,
        itemHSN: '85371000', quantity: 1, unit: 'SET', unitPrice: comboUnit,
        discountType: '%', discountValue: 0, discountAmount: 0, taxRate: rate,
        taxableAmount: calc.taxableAmount, cgstAmount: calc.cgstAmount, sgstAmount: calc.sgstAmount,
        totalTax: calc.totalTax, totalAmount: calc.totalAmount,
        isCombo: true, comboId: combo.id, comboComponents: combo.components,
      },
    ]);
  };

  const handleScanSubmit = (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const norm = code.toLowerCase();
    const matchedItem = items.find((it) => it.itemCode.toLowerCase() === norm);
    const matchedCombo = matchedItem ? undefined : combos.find((c) => c.comboCode.toLowerCase() === norm);

    if (!matchedItem && !matchedCombo) {
      toast.error('No item found for scanned code', { description: `"${code}" doesn't match any item or combo code.` });
      return;
    }

    if (matchedItem) {
      const availableQty = branchStocks.find((s) => s.itemId === matchedItem.id && s.branchId === selectedBranch)?.quantity ?? 0;
      if (documentType === 'Invoice' && availableQty <= 0) {
        toast.error('Out of stock at this branch', { description: `"${matchedItem.itemName}" has 0 available at ${branchLabel}.` });
      } else {
        const existing = lineItems.find((li) => li.itemId === matchedItem.id && !li.isCombo);
        if (existing) {
          if (documentType === 'Invoice' && existing.quantity + 1 > availableQty) {
            toast.warning('Reached available stock limit', { description: `Only ${availableQty} unit(s) of "${matchedItem.itemName}" at ${branchLabel}.` });
          } else {
            updateLineItem(existing.id, { quantity: existing.quantity + 1 });
            toast.success(`+1 ${matchedItem.itemName}`, { description: `Qty now ${existing.quantity + 1} • ${matchedItem.itemCode}` });
          }
        } else {
          const emptyRow = lineItems.find((li) => !li.itemName.trim() && !li.itemId);
          if (emptyRow) selectMasterItemForRow(emptyRow.id, matchedItem);
          else addNewRow(matchedItem);
          toast.success(`Added ${matchedItem.itemName}`, { description: matchedItem.itemCode });
        }
      }
    } else if (matchedCombo) {
      const availQty = getComboAvailability(matchedCombo, selectedBranch);
      if (documentType === 'Invoice' && availQty <= 0) {
        toast.error('Combo out of stock at this branch', { description: `"${matchedCombo.comboName}" has 0 available kits at ${branchLabel}.` });
      } else {
        const existing = lineItems.find((li) => li.comboId === matchedCombo.id && li.isCombo);
        if (existing) {
          if (documentType === 'Invoice' && existing.quantity + 1 > availQty) {
            toast.warning('Reached available combo limit', { description: `Only ${availQty} kit(s) of "${matchedCombo.comboName}" at ${branchLabel}.` });
          } else {
            updateLineItem(existing.id, { quantity: existing.quantity + 1 });
            toast.success(`+1 ${matchedCombo.comboName}`, { description: `Qty now ${existing.quantity + 1} • ${matchedCombo.comboCode}` });
          }
        } else {
          const emptyRow = lineItems.find((li) => !li.itemName.trim() && !li.itemId);
          if (emptyRow) selectComboForRow(emptyRow.id, matchedCombo);
          else appendComboRow(matchedCombo);
          toast.success(`Added ${matchedCombo.comboName}`, { description: matchedCombo.comboCode });
        }
      }
    }
  };

  // Global barcode-scanner "wedge": a USB scanner types the code as fast keystrokes
  // ending in Enter. We capture those anywhere on the active bill (no need to click
  // the scan box first) and add the item. Human typing (slower) is left untouched.
  const scanHandlerRef = useRef(handleScanSubmit);
  scanHandlerRef.current = handleScanSubmit;
  useEffect(() => {
    if (!isActive) return;
    let buffer = '';
    let lastTime = 0;
    const GAP = 35; // ms between chars — scanners are far faster than a person
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const now = Date.now();
      if (e.key === 'Enter') {
        if (buffer.length >= 3 && now - lastTime < 200) {
          e.preventDefault();
          e.stopPropagation();
          const code = buffer;
          buffer = '';
          scanHandlerRef.current(code);
        } else {
          buffer = '';
        }
        return;
      }
      if (e.key.length === 1) {
        const rapid = now - lastTime < GAP;
        if (!rapid) buffer = ''; // gap too big → treat as human/new input
        buffer += e.key;
        lastTime = now;
        // While a rapid burst is in progress, keep the scanned chars out of any
        // focused field so a scan never pollutes the customer/search inputs.
        if (rapid) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [isActive]);

  const removeLineItem = (id: string) => {
    if (lineItems.length === 1) {
      toast.info('Invoice must contain at least one line item');
      return;
    }
    setLineItems((prev) => prev.filter((i) => i.id !== id));
  };

  // Re-calculate all line items when GST mode is toggled
  const handleToggleGst = (newWithGst: boolean) => {
    // GST is display-only: toggling must NOT change any line total. Convert each
    // line's unit price between its "pre-tax" (GST-on) and "full price" (GST-off)
    // form so the charged amount stays identical; only the GST breakdown appears/hides.
    setWithGst(newWithGst);
    // FIN-A-2: an overall ₹ discount is in the same tax basis too — with GST on it
    // comes off the taxable value (so the bill drops by it plus its GST), with GST
    // off it comes off the full price. Convert it with the bill's own mix of rates.
    if (newWithGst !== withGst && overallDiscountType === 'amount' && Number(overallDiscountValue) > 0) {
      let full = 0;
      let pre = 0;
      for (const it of lineItems) {
        const f = 1 + (Number(it.taxRate) || 0) / 100;
        const taxable = Number(it.taxableAmount) || 0;
        if (withGst) { pre += taxable; full += taxable * f; } else { full += taxable; pre += taxable / f; }
      }
      if (pre > 0 && full > 0) {
        const factor = full / pre;
        const v = Number(overallDiscountValue);
        setOverallDiscountValue(Math.round((newWithGst ? v / factor : v * factor) * 100) / 100);
      }
    }
    setLineItems((prev) =>
      prev.map((item) => {
        const rate = item.taxRate || 0;
        const factor = 1 + rate / 100;
        let unitPrice = item.unitPrice;
        let discountValue = item.discountValue;
        let stdDiscountPerUnit = item.stdDiscountPerUnit;
        const convert = (v: number) => (newWithGst ? Math.round((v / factor) * 100) / 100 : Math.round(v * factor * 100) / 100);
        if (rate > 0 && newWithGst !== withGst) {
          // off → on: drop to pre-tax; on → off: back to full price
          unitPrice = convert(item.unitPrice);
          // SAL10-3: a ₹-off discount is in the same tax basis as the price, so it
          // converts with it — otherwise the bill's total rose when GST was hidden.
          if (item.discountType === 'amount' && Number(item.discountValue) > 0) discountValue = convert(Number(item.discountValue));
          if (stdDiscountPerUnit != null) stdDiscountPerUnit = convert(Number(stdDiscountPerUnit));
        }
        const calculated = calculateLineTax(
          item.quantity,
          unitPrice,
          rate,
          newWithGst,
          item.discountType,
          discountValue
        );
        return {
          ...item,
          unitPrice,
          discountValue,
          stdDiscountPerUnit,
          discountAmount: calculated.discountAmount,
          taxableAmount: calculated.taxableAmount,
          cgstAmount: calculated.cgstAmount,
          sgstAmount: calculated.sgstAmount,
          totalTax: calculated.totalTax,
          totalAmount: calculated.totalAmount,
        };
      })
    );
  };

  // Calculate aggregated invoice totals
  const totals = useMemo(() => {
    // Only rows with a product/description count toward the bill — a blank row
    // (no name) can never add its stray qty×price to the total, even if some
    // amount lingered on it. Save already filters the same way.
    const billableLines = lineItems.filter((l) => l.itemName && l.itemName.trim());
    return calculateInvoiceTotals(
      billableLines,
      withGst,
      overallDiscountType,
      overallDiscountValue,
      shippingCharges,
      roundOffEnabled
    );
  }, [
    lineItems,
    withGst,
    overallDiscountType,
    overallDiscountValue,
    shippingCharges,
    roundOffEnabled,
  ]);

  // Loyalty spend-tier auto discount (#8): when a NEW bill's taxable subtotal
  // reaches a configured tier (e.g. ≥ ₹5000 → 5%), auto-fill that % into the
  // overall discount. We only ever overwrite an empty field or our own previous
  // auto value (spendAutoRef), so a discount the biller typed — or the milestone
  // reward — is never clobbered. Skipped when editing a saved bill.
  useEffect(() => {
    if (documentType === 'Quotation' || isSavedBill) return;
    const pct = spendTierDiscountPercent(loyaltySettings, totals.subtotal);
    const fieldIsOurs = overallDiscountType === '%' && (overallDiscountValue === spendAutoRef.current || overallDiscountValue === 0);
    if (pct > 0) {
      if (!fieldIsOurs) return; // the biller/milestone set a discount — leave it
      if (overallDiscountType !== '%' || overallDiscountValue !== pct) {
        setOverallDiscountType('%');
        setOverallDiscountValue(pct);
      }
      spendAutoRef.current = pct;
      if (spendDiscountAutoApplied !== pct) setSpendDiscountAutoApplied(pct);
    } else {
      // No tier qualifies now — clear only if the field still holds our auto value.
      if (spendAutoRef.current > 0 && overallDiscountType === '%' && overallDiscountValue === spendAutoRef.current) {
        setOverallDiscountValue(0);
      }
      spendAutoRef.current = 0;
      if (spendDiscountAutoApplied) setSpendDiscountAutoApplied(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totals.subtotal, loyaltySettings, documentType, isSavedBill]);

  // GST rate breakdown
  const gstBreakdown = useMemo((): GstBreakdownRow[] => {
    if (!withGst) return [];
    return calculateTaxBreakdown(lineItems, totals.overallDiscountAmount, totals.subtotal, isInterState, totals.totalTax);
  }, [lineItems, withGst, totals.overallDiscountAmount, totals.subtotal, isInterState]);

  // Remaining balance due calculation for Partial Payment
  const balanceDue = useMemo(() => {
    if (!isPartialPayment) return 0;
    const pAmt = Number(partialAmount) || 0;
    return Math.max(0, totals.grandTotal - pAmt);
  }, [isPartialPayment, partialAmount, totals.grandTotal]);

  // The amount the customer is taking ON CREDIT on this bill (the COD-Credit /
  // unpaid portion) — mirrors invoiceBalanceDue in handleSave so the summary can
  // show the credit amount instead of hiding it inside the payment card (bug #4).
  const creditOnBill = useMemo(() => {
    const splits = paymentSplits.length > 1
      ? paymentSplits
      : [{ mode: paymentSplits[0]?.mode || 'Cash', amount: totals.grandTotal }];
    const cod = splits.find((s) => s.mode === 'COD-Credit');
    if (splits.length > 1) return cod && cod.amount > 0 ? Math.round(cod.amount * 100) / 100 : 0;
    if (splits[0].mode === 'COD-Credit') {
      return isPartialPayment
        ? Math.max(0, Math.round((totals.grandTotal - (Number(partialAmount) || 0)) * 100) / 100)
        : totals.grandTotal;
    }
    return 0;
  }, [paymentSplits, totals.grandTotal, isPartialPayment, partialAmount]);
  const paidNow = Math.max(0, Math.round((totals.grandTotal - creditOnBill) * 100) / 100);

  // The customer's remaining balance from EARLIER bills (their running dues —
  // same figure as the Customers Directory "Balance Due"), shown in the summary
  // so the biller sees what this customer already owes (Oct-16 note).
  const customerOutstanding = useMemo(() => {
    if (!selectedCustomerObj) return 0;
    let bal = getCustomerOutstandingBalance(selectedCustomerObj);
    if (initialInvoice) bal -= Math.max(0, Number(initialInvoice.balanceDue) || 0); // exclude the bill being edited
    return Math.max(0, Math.round(bal * 100) / 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomerObj, invoices, initialInvoice]);

  // Toggle: collect the customer's previous dues together with THIS bill.
  // When on, the summary shows a combined "to collect now" and, once the bill
  // is saved, the old unpaid bills are settled (a receipt is recorded against
  // them) so the customer's running balance doesn't double-count (Oct-16 note).
  const [settlePrevDues, setSettlePrevDues] = useState(false);
  // Never leave it on for a customer who owes nothing (e.g. after switching).
  useEffect(() => {
    if (customerOutstanding <= 0.009 && settlePrevDues) setSettlePrevDues(false);
  }, [customerOutstanding, settlePrevDues]);
  // What the customer actually hands over at the counter: this bill + (when the
  // toggle is on) their previous dues. The invoice's own Grand Total stays the
  // bill amount — the dues are collected as a separate receipt on save.
  const collectNowTotal = useMemo(
    () => Math.round((totals.grandTotal + (settlePrevDues ? customerOutstanding : 0)) * 100) / 100,
    [totals.grandTotal, settlePrevDues, customerOutstanding]
  );

  // H2: a finalized GST bill's buyer and place of supply are part of the filed
  // tax record — lock them on edit (the backend also refuses to change them).
  const lockBuyer = isSavedBill && withGst && documentType === 'Invoice';

  const handleTermsPresetChange = (presetId: string) => {
    setTermsPresetId(presetId);
    const preset = INVOICE_TERMS_PRESETS.find((p) => p.id === presetId);
    if (preset) {
      setTerms(preset.terms);
    }
  };

  const handleAddAttachment = () => {
    if (!attachmentInput.trim()) return;
    setAttachments((prev) => [
      ...prev,
      { name: attachmentInput.trim(), size: 'File attachment' },
    ]);
    setAttachmentInput('');
    toast.success('Attachment note added');
  };

  const handleRemoveAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  // Auto-sync single split mode amount with grandTotal
  useEffect(() => {
    setPaymentSplits((prev) => {
      if (prev.length === 1 && prev[0].amount !== totals.grandTotal) {
        return [{ mode: prev[0].mode, amount: totals.grandTotal }];
      }
      return prev;
    });
  }, [totals.grandTotal]);

  // CRM2-8: an advance already received on this enquiry's pending order. It is
  // settled automatically against the bill's unpaid (COD-Credit) part on save, so
  // the cashier collects only the balance now.
  const pendingAdvance = useMemo(() => {
    if (!sourceEnquiryId || documentType !== 'Invoice' || initialInvoice) return 0;
    const numbers = new Set(pendingOrders.filter((o) => o.enquiryId === sourceEnquiryId).map((o) => o.orderNumber));
    let taken = 0;
    let applied = 0;
    for (const p of payments) {
      if (p.type !== 'in' || !p.reference || !numbers.has(p.reference)) continue;
      const n = String(p.notes || '');
      if (n.startsWith('Advance on pending order')) taken += Number(p.amount) || 0;
      else if (n.startsWith('Advance applied from pending order')) applied += Number(p.amount) || 0;
    }
    return Math.max(0, Math.round((taken - applied) * 100) / 100);
  }, [sourceEnquiryId, documentType, initialInvoice, pendingOrders, payments]);
  const applyPendingAdvanceToSplits = () => {
    const grand = totals.grandTotal;
    const adv = Math.min(pendingAdvance, grand);
    const rest = Math.round((grand - adv) * 100) / 100;
    setPaymentSplits(rest > 0 ? [{ mode: 'Cash', amount: rest }, { mode: 'COD-Credit', amount: adv }] : [{ mode: 'COD-Credit', amount: adv }]);
  };

  // CRM2-8: a bill made from an order that has an advance opens with that
  // advance as the part settled from store credit (COD-Credit) and only the
  // balance to collect — not the full amount as Cash. It follows the total
  // until the cashier changes the split by hand.
  const advanceSplitRef = useRef<'auto' | 'on' | 'off'>('auto');
  useEffect(() => {
    if (pendingAdvance <= 0 || totals.grandTotal <= 0 || advanceSplitRef.current === 'off') return;
    const auto = paymentSplits.length === 1
      || (advanceSplitRef.current === 'on' && paymentSplits.length === 2 && paymentSplits[1]?.mode === 'COD-Credit');
    if (!auto) { advanceSplitRef.current = 'off'; return; }
    applyPendingAdvanceToSplits();
    advanceSplitRef.current = 'on';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAdvance, totals.grandTotal]);

  // Total allocated across payment splits
  const totalAllocated = useMemo(() => {
    if (paymentSplits.length === 1) {
      return totals.grandTotal;
    }
    return paymentSplits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  }, [paymentSplits, totals.grandTotal]);

  // Live remaining amount (positive = under-allocated, negative = over-allocated)
  const remainingBalance = useMemo(() => {
    return Math.round((totals.grandTotal - totalAllocated) * 100) / 100;
  }, [totals.grandTotal, totalAllocated]);

  // E2E10-4: editing a bill below what the customer has already paid — the
  // server keeps what was collected and gives the difference back as store
  // credit (a walk-in bill has no account for it), so a split that is "over"
  // the new total is expected here, not an error.
  const alreadyPaid = useMemo(() => {
    if (!initialInvoice || !isSavedBill) return 0;
    return Math.max(0, Math.round(((Number(initialInvoice.grandTotal) || 0) - (Number(initialInvoice.balanceDue) || 0) - (Number(initialInvoice.totalReturnedAmount) || 0)) * 100) / 100);
  }, [initialInvoice, isSavedBill]);
  const paidOverNewTotal = documentType === 'Invoice' && initialInvoice && isSavedBill
    ? Math.max(0, Math.round((alreadyPaid - totals.grandTotal) * 100) / 100) : 0;
  // FIN-A-1: store credit given back on THIS bill by an earlier edit below what
  // was paid (same rule as the server's creditBackForBill). Editing the bill back
  // up keeps what was collected as it is; that credit is applied back to the new
  // total and anything left is a due to collect — never "cash" nobody took.
  const billCreditBack = useMemo(() => {
    if (!initialInvoice || !isSavedBill || !selectedCustomerObj) return 0;
    const id = initialInvoice.id;
    const t = (selectedCustomerObj.creditHistory || []).reduce((sum, h: any) => {
      const ref = String(h?.refId || '');
      return ref === id || h?.billId === id || ref === `fix-overpay:${id}` ? sum + (Number(h.amount) || 0) : sum;
    }, 0);
    return Math.max(0, Math.round(t * 100) / 100);
  }, [initialInvoice, isSavedBill, selectedCustomerObj]);
  const collectedOnBill = useMemo(
    () => (documentType === 'Invoice' && initialInvoice
      ? getInvoicePaymentSplits(initialInvoice).filter((s) => s.mode !== 'COD-Credit' && (Number(s.amount) || 0) > 0)
      : []),
    [documentType, initialInvoice],
  );
  const owingAfterEdit = Math.max(0, Math.round((totals.grandTotal - alreadyPaid) * 100) / 100);
  const creditAppliedBack = documentType === 'Invoice' && initialInvoice && billCreditBack > 0.009 && paidOverNewTotal <= 0.009
    ? Math.round(Math.min(billCreditBack, Math.max(0, Number(selectedCustomerObj?.creditBalance) || 0), owingAfterEdit) * 100) / 100 : 0;
  const leftToCollect = billCreditBack > 0.009 && paidOverNewTotal <= 0.009 ? Math.round((owingAfterEdit - creditAppliedBack) * 100) / 100 : 0;
  // FIN-E-2: in both cases the server keeps the bill's collected split exactly as
  // it is, so the form shows that split (read-only) instead of an editable one.
  const keepsCollectedSplit = documentType === 'Invoice' && isSavedBill && (paidOverNewTotal > 0.009 || billCreditBack > 0.009);

  // Is payment reconciled exactly to 0 remaining?
  const isPaymentReconciled = useMemo(() => {
    if (documentType !== 'Invoice') return true;
    if (paymentSplits.length <= 1) return true;
    // E2E10-4: an edit below what was already paid keeps the bill's collected
    // split as it is on the server (the difference becomes store credit), so
    // the split on screen does not have to match the new total.
    if (paidOverNewTotal > 0 || keepsCollectedSplit) return true;
    return Math.abs(remainingBalance) < 0.01;
  }, [documentType, paymentSplits.length, remainingBalance, paidOverNewTotal, keepsCollectedSplit]);

  // Split management handlers
  const handleAddSplit = () => {
    setPaymentSplits((prev) => {
      const usedModes = new Set(prev.map((s) => s.mode));
      // The shared list (src/lib/paymentModes.ts): Cash, GPay, HDFC, then credit.
      const allModes = saleSplitOptions.map((o) => o.value) as PaymentMode[];
      const nextMode = allModes.find((m) => !usedModes.has(m)) || 'GPay';

      // Allocate remainder to the new split if available
      const currentSum = prev.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
      const remaining = Math.max(0, totals.grandTotal - currentSum);

      return [...prev, { mode: nextMode, amount: remaining }];
    });
  };

  const handleUpdateSplitMode = (index: number, mode: PaymentMode) => {
    setPaymentSplits((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], mode };
      return next;
    });
  };

  const handleUpdateSplitAmount = (index: number, amount: number) => {
    setPaymentSplits((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], amount: Math.max(0, amount) };
      return next;
    });
  };

  const handleRemoveSplit = (index: number) => {
    setPaymentSplits((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 1) {
        return [{ mode: next[0].mode, amount: totals.grandTotal }];
      }
      return next;
    });
  };

  const handleResetToSingleMode = () => {
    setPaymentSplits((prev) => [{ mode: prev[0]?.mode || 'Cash', amount: totals.grandTotal }]);
  };

  // Build the complete invoice object
  const assembleInvoiceObject = (quiet = false): Invoice | null => {
    // Customer name is optional — a phone-only walk-in bill is fine.
    const validItems = lineItems.filter((i) => i.itemName.trim() && i.quantity > 0);
    if (validItems.length === 0) {
      if (!quiet) toast.error('At least one valid item is required', {
        description: 'Please enter a product description and quantity > 0.',
      });
      return null;
    }

    // Validate split payment reconciliation
    if (documentType === 'Invoice' && paymentSplits.length > 1 && !isPaymentReconciled && !quiet) {
      toast.error('Payment split not reconciled', {
        description:
          remainingBalance > 0
            ? `Please allocate the remaining ₹${remainingBalance.toLocaleString('en-IN')} before saving.`
            : `Split amounts exceed grand total by ₹${Math.abs(remainingBalance).toLocaleString('en-IN')}.`,
      });
      return null;
    }

    // Determine final splits
    const finalSplits: PaymentSplit[] =
      paymentSplits.length > 1
        ? paymentSplits
        : [{ mode: paymentSplits[0]?.mode || 'Cash', amount: totals.grandTotal }];

    // Handle COD-Credit portion & partial payment tracking
    const codSplit = finalSplits.find((s) => s.mode === 'COD-Credit');
    let invoiceBalanceDue: number | undefined = undefined;
    let invoiceIsPartialPayment = false;
    let invoicePartialAmount: number | undefined = undefined;

    if (finalSplits.length > 1) {
      if (codSplit && codSplit.amount > 0) {
        invoiceBalanceDue = codSplit.amount;
        invoiceIsPartialPayment = codSplit.amount < totals.grandTotal;
        invoicePartialAmount = totals.grandTotal - codSplit.amount;
      }
    } else {
      if (finalSplits[0].mode === 'COD-Credit') {
        if (isPartialPayment) {
          invoiceIsPartialPayment = true;
          invoicePartialAmount = partialAmount;
          invoiceBalanceDue = Math.max(0, totals.grandTotal - partialAmount);
        } else {
          invoiceBalanceDue = totals.grandTotal;
        }
      }
    }

    const primaryMode = finalSplits[0]?.mode || 'Cash';

    const newInvoice: Invoice = {
      id: initialInvoice ? initialInvoice.id : billIdRef.current,
      clientKey: billKeyRef.current, // stable per open bill → retries never duplicate
      invoiceNumber,
      branchId: selectedBranch,
      transactionType,
      customerId: customerId || selectedCustomerObj?.id,
      customerName: customerName.trim() ? cleanCustomerName(customerName) : 'Walk-in Customer',
      customerPhone: customerPhone.trim() || undefined,
      customerAddress: customerAddress.trim() || undefined,
      ...(skipCustomerSave && !(customerId || selectedCustomerObj?.id) ? { skipCustomerSave: true } : {}),
      date,
      time,
      paymentTerms,
      dueDate,
      stateOfSupply,
      withGst,
      items: validItems,
      subtotal: totals.subtotal,
      totalTax: totals.totalTax,
      totalCgst: totals.totalCgst,
      totalSgst: totals.totalSgst,
      overallDiscountType,
      overallDiscountValue,
      overallDiscountAmount: totals.overallDiscountAmount,
      isLoyaltyRewardApplied,
      loyaltyRewardDiscountAmount: isLoyaltyRewardApplied ? totals.overallDiscountAmount : undefined,
      shippingCharges,
      roundOff: totals.roundOff,
      roundOffEnabled,
      grandTotal: totals.grandTotal,
      amountInWords: totals.amountInWords,
      // Salesperson incentive — rate is the CEO-set % from the Staff Directory.
      salespersonId: salespersonId || undefined,
      salespersonName: salespersonId ? employees.find((e) => e.id === salespersonId)?.name : undefined,
      ...(() => {
        const emp = salespersonId ? employees.find((e) => e.id === salespersonId) : undefined;
        const pct = emp?.incentivePercent || 0;
        return salespersonId && pct > 0
          ? { incentivePercent: pct, incentiveAmount: Math.round(totals.grandTotal * pct) / 100 }
          : { incentivePercent: undefined, incentiveAmount: undefined };
      })(),
      termsAndConditions: terms,
      // Dispatch / courier details (#5) — only when filled.
      dispatchCourier: dispatchCourier.trim() || undefined,
      dispatchDocket: dispatchDocket.trim() || undefined,
      dispatchDate: dispatchDate || undefined,
      description: description.trim() || undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
      paymentMode: primaryMode,
      paymentSplits: finalSplits,
      isPartialPayment: invoiceIsPartialPayment,
      partialAmount: invoicePartialAmount,
      balanceDue: invoiceBalanceDue,
      sourceEstimateId,
      sourceEstimateNumber,
      sourceEnquiryId,
      sourceEnquiryNumber,
      createdById: 'usr-active',
      createdAt: initialInvoice ? initialInvoice.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return newInvoice;
  };

  // Build the complete quotation/estimate object
  const assembleEstimateObject = (quiet = false): Estimate | null => {
    // Customer name optional here too (phone-first entry).

    const validItems = lineItems.filter((i) => i.itemName.trim() && i.quantity > 0);
    if (validItems.length === 0) {
      if (!quiet) toast.error('At least one valid item is required', {
        description: 'Please enter a product description and quantity > 0.',
      });
      return null;
    }

    const estimateItems: EstimateLineItem[] = validItems.map((item) => ({
      id: item.id,
      itemId: item.itemId,
      itemName: item.itemName,
      itemHSN: item.itemHSN,
      itemCode: item.itemCode || '',
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      gstRate: item.taxRate,
      taxRate: item.taxRate,
      discount: item.discountValue || 0,
      discountValue: item.discountValue || 0,
      discountType: item.discountType || '%',
      taxableAmount: item.taxableAmount,
      cgstAmount: item.cgstAmount,
      sgstAmount: item.sgstAmount,
      totalTax: item.totalTax,
      totalAmount: item.totalAmount,
      isCombo: item.isCombo,
      comboId: item.comboId,
      comboComponents: item.comboComponents,
      leadDays: item.leadDays,
    }));

    const finalEstimateNumber = invoiceNumber.trim() || getNextEstimateNumber(selectedBranch, date);

    const newEstimate: Estimate = {
      id: initialEstimate ? initialEstimate.id : `est-${Date.now()}`,
      estimateNumber: finalEstimateNumber,
      branchId: selectedBranch,
      customerId: customerId || selectedCustomerObj?.id,
      customerName: customerName.trim() ? cleanCustomerName(customerName) : 'Walk-in Customer',
      customerContact: customerPhone.trim() || undefined,
      customerAddress: customerAddress.trim() || undefined,
      date,
      time,
      withGst,
      items: estimateItems,
      subtotal: totals.subtotal,
      totalCgst: totals.totalCgst,
      totalSgst: totals.totalSgst,
      totalTax: totals.totalTax,
      overallDiscountType,
      overallDiscountValue,
      overallDiscountAmount: totals.overallDiscountAmount,
      shippingCharges,
      roundOff: totals.roundOff,
      roundOffEnabled,
      grandTotal: totals.grandTotal,
      amountInWords: totals.amountInWords,
      termsAndConditions: terms,
      sourceEnquiryId,
      sourceEnquiryNumber,
      stateOfSupply,
      createdAt: initialEstimate ? initialEstimate.createdAt : new Date().toISOString(),
    };

    return newEstimate;
  };

  const savingRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async (opts?: { previewAfter?: boolean; skipDupCheck?: boolean }) => {
    // M1: a second click (or Ctrl+Enter) while the first save is still in flight
    // must not create a second bill with its own number and a second stock hit.
    if (savingRef.current) return;
    // Guard against negative prices / shipping and impossible discounts (SAL-17).
    if (lineItems.some((li) => (li.unitPrice || 0) < 0)) {
      toast.error('Item price cannot be negative');
      return;
    }
    const filled = lineItems.filter((li) => li.itemName.trim() && li.quantity > 0);
    // SAL8-9: a typed code that was never picked from the list bills ₹0.
    const zeroLine = filled.find(isZeroFreeTextLine);
    if (zeroLine) {
      toast.error(`"${zeroLine.itemName}" has no price`, {
        description: 'It is not a catalogue item. Pick it from the item list, or enter its price.',
      });
      return;
    }
    // SAL2-8: whole-unit items (PCS, NOS, SET…) can't be sold in fractions.
    const fractional = filled.find((li) => lineIsWholeUnit(li) && !Number.isInteger(Number(li.quantity)));
    if (fractional) {
      toast.error(`"${fractional.itemName}": ${fractional.quantity} ${(fractional.unit || '').toUpperCase()} is not a whole number`, {
        description: 'This item is counted in whole units.',
      });
      return;
    }
    if ((shippingCharges || 0) < 0) {
      toast.error('Shipping / freight cannot be negative');
      return;
    }
    if (overallDiscountType === '%' && overallDiscountValue > 100) {
      toast.error('Overall discount cannot exceed 100%');
      return;
    }
    // Owner rule (Oct 2026): a sales bill must carry the customer's name AND a
    // valid 10-digit mobile — no anonymous walk-in bills. (Quotations are exempt.)
    if (documentType === 'Invoice') {
      // Owner rule (updated): a sales bill needs a customer NAME. The mobile is
      // OPTIONAL — some customers don't give one, so a name-only bill is allowed.
      // But if a number IS typed, it must be a valid 10-digit mobile (no half numbers).
      if (!customerName.trim()) {
        toast.error('Customer name is required', { description: 'Enter the customer name before saving the bill.' });
        return;
      }
      const digits = (customerPhone || '').replace(/\D/g, '');
      if (digits.length > 0 && digits.length !== 10) {
        toast.error('Enter a full 10-digit mobile number, or leave it blank', { description: 'A half-typed number is not allowed — clear it to bill with the name only.' });
        return;
      }
      // Mandatory "Received" confirmation — forces the cashier to check the
      // payment mode before saving (so it isn't left on the default Cash).
      if (!paymentReceived) {
        toast.error('Tick "Received" to confirm the payment', { description: 'Check the payment mode above is correct, then tick Received to save the bill.' });
        return;
      }
    }

    // Duplicate-bill guard (NEW sales only): if the same customer + the exact
    // same items + the same total was saved in the last 10 minutes, this is
    // almost certainly a re-typed bill. Pause and confirm so staff don't make a
    // second bill and hit stock twice. (Edits and quotations are exempt; a
    // genuine repeat sale just clicks "Save anyway".)
    if (documentType === 'Invoice' && !isSavedBill && !opts?.skipDupCheck) {
      const phone = (customerPhone || '').replace(/\D/g, '');
      const gt = Math.round((totals.grandTotal || 0) * 100) / 100;
      const sig = JSON.stringify(
        lineItems.filter((l) => l.itemName.trim() && (Number(l.quantity) || 0) > 0)
          .map((l) => [l.itemId || l.itemName.trim().toLowerCase(), Number(l.quantity) || 0])
          .sort(),
      );
      const now = Date.now();
      const dup = invoices.find((iv) => {
        if (iv.isVoided || iv.clientKey === billKeyRef.current) return false;
        if (String(iv.sourceChannel || '').startsWith('shopify')) return false;
        if ((iv.customerPhone || '').replace(/\D/g, '') !== phone || !phone) return false;
        if (Math.round((iv.grandTotal || 0) * 100) / 100 !== gt) return false;
        const t = Date.parse(iv.createdAt || iv.date || '') || 0;
        if (!t || now - t > 10 * 60 * 1000 || now - t < 0) return false;
        const ivSig = JSON.stringify(
          (iv.items || []).map((it) => [it.itemId || (it.itemName || '').trim().toLowerCase(), Number(it.quantity) || 0]).sort(),
        );
        return ivSig === sig;
      });
      if (dup) {
        const t = Date.parse(dup.createdAt || dup.date || '') || now;
        setDupWarn({ number: dup.invoiceNumber, minsAgo: Math.max(0, Math.round((now - t) / 60000)), amount: gt, opts });
        return;
      }
    }

    savingRef.current = true;
    setIsSaving(true);
    try {
    if (documentType === 'Quotation') {
      const est = assembleEstimateObject();
      if (!est) return;
      // Use the server-saved estimate (authoritative number) for the preview,
      // not the provisional one — saveEstimate emits its own success toast.
      const saved = await saveEstimate(est);
      // SAL8-4: a refused save (error toast already shown) keeps this tab and its
      // draft open — no printable quote for a quotation that was never saved.
      if (!saved) return;
      // The enquiry is closed only now that the quotation really exists (CRM-2).
      if (fromEnquiryPrefill && saved.sourceEnquiryId) {
        await markEnquiryConverted(saved.sourceEnquiryId, 'estimate', saved.id, saved.estimateNumber);
      }
      if (onSavedEstimate) {
        onSavedEstimate(saved);
      }
    } else {
      const inv = assembleInvoiceObject();
      if (!inv) return;
      // Preview/print the server-saved bill (authoritative number, id and
      // reconciled payment split), not the provisional client object (SAL4-1).
      const saved = await saveInvoice(inv);
      if (saved && paidOverNewTotal > 0.009 && saved.customerId) {
        toast.info(`${formatCurrency(paidOverNewTotal)} paid over the new total is kept as ${saved.customerName || 'the customer'}'s store credit`); // E2E10-4
      } else if (saved && creditAppliedBack > 0.009) {
        toast.info(`${formatCurrency(creditAppliedBack)} store credit applied back to the bill`, { // FIN-A-1
          description: leftToCollect > 0.009 ? `${formatCurrency(leftToCollect)} is left to collect — it stays due on the bill.` : undefined,
        });
      }
      // If the server REFUSED the save, saveInvoice shows the error toast and
      // returns undefined — do NOT open a printable bill off the provisional
      // object, or the user prints a "DRAFT"/wrong number for a sale that was
      // never recorded (SAL2-5).
      if (!saved) return;
      // "Collect previous dues with this bill": settle the customer's older
      // unpaid bills now, so the running balance isn't counted twice. We record
      // a real receipt (oldest bills first), exactly like the Record Payment
      // screen — never a taxable line, which would corrupt GST and the ledger.
      if (settlePrevDues && saved.customerId && selectedCustomerObj) {
        const unpaid = getCustomerOutstandingSummary(selectedCustomerObj, invoices)
          .unpaidInvoices
          .filter((u) => u.invoice.id !== saved.id) // never the bill just made
          .sort((a, b) => (a.invoice.date || '').localeCompare(b.invoice.date || '')); // oldest first
        let left = customerOutstanding;
        const allocations = [] as { refId: string; refNumber?: string; amount: number }[];
        for (const u of unpaid) {
          if (left <= 0.009) break;
          const take = Math.min(left, u.balanceDue);
          if (take > 0.009) {
            allocations.push({ refId: u.invoice.id, refNumber: u.invoice.invoiceNumber, amount: Math.round(take * 100) / 100 });
            left = Math.round((left - take) * 100) / 100;
          }
        }
        const settledAmount = Math.round(allocations.reduce((t, a) => t + a.amount, 0) * 100) / 100;
        if (settledAmount > 0.009) {
          const duesMode = ['Cash', 'HDFC', 'GPay'].includes(saved.paymentMode || '') ? (saved.paymentMode as string) : 'Cash';
          await recordPayment({
            type: 'in',
            partyType: 'customer',
            partyId: saved.customerId,
            partyName: saved.customerName || 'Customer',
            branchId: saved.branchId,
            date: saved.date,
            amount: settledAmount,
            paymentMode: duesMode,
            notes: `Previous dues collected with ${saved.invoiceNumber}`,
            allocations,
          });
        }
      }
      // The enquiry / pending order is closed only now that a real bill exists —
      // "+ Bill" without saving no longer fulfils the order (CRM-2).
      if (fromEnquiryPrefill && !initialInvoice && saved.sourceEnquiryId) {
        await markEnquiryConverted(saved.sourceEnquiryId, 'invoice', saved.id, saved.invoiceNumber);
      }
      // Auto-print the 80mm thermal bill (department-store style) on save.
      if (isThermalAutoPrintOn()) printThermalReceipt(saved, companyProfile);
      // If "Save & Print" was used, open the A4 of the SAVED bill (real server
      // number) — never a provisional, unsaved copy whose number a later bill
      // could reuse, leaving the printed bill lost from history.
      if (opts?.previewAfter) onPreviewPdf(saved);
      onSaved(saved);
    }
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  // Keyboard: Ctrl/Cmd+Enter saves the current bill (skips when payment isn't
  // reconciled). Kept off plain Enter so it never fires accidentally while typing.
  const saveShortcutRef = useRef<() => void>(() => {});
  saveShortcutRef.current = () => {
    if (documentType === 'Invoice' && !isPaymentReconciled) {
      toast.warning('Reconcile the payment before saving');
      return;
    }
    handleSave();
  };
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        saveShortcutRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isActive]);

  // SAL4-13: hand the tab bar the form's current contents (quietly — no
  // validation toasts) a moment after each change, so a reload restores them.
  const workingCopyRef = useRef(onWorkingCopy);
  workingCopyRef.current = onWorkingCopy;
  useEffect(() => {
    if (!workingCopyRef.current || isSavedBill) return;
    const t = setTimeout(() => {
      const doc = documentType === 'Quotation' ? assembleEstimateObject(true) : assembleInvoiceObject(true);
      if (doc) workingCopyRef.current?.(doc);
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineItems, customerName, customerPhone, customerAddress, customerId, date, paymentSplits, overallDiscountType, overallDiscountValue, shippingCharges, roundOffEnabled, withGst, documentType, salespersonId, terms]);

  // AUTOSAVE SAFETY NET: the 700ms autosave above can miss the last changes when
  // the page suddenly reloads (a deploy, a session timeout that bounces to the
  // login page, closing the tab). So flush the working copy IMMEDIATELY on
  // beforeunload / pagehide / tab-hide, and also on a steady 5s heartbeat — so an
  // in-progress bill or quotation is restored after re-login instead of lost.
  // Uses a ref (like the save shortcut) so the listeners bind once but always
  // run against the latest form state.
  const flushWorkingCopyRef = useRef<() => void>(() => {});
  flushWorkingCopyRef.current = () => {
    if (!workingCopyRef.current || isSavedBill) return;
    try {
      const doc = documentType === 'Quotation' ? assembleEstimateObject(true) : assembleInvoiceObject(true);
      if (doc) workingCopyRef.current(doc);
    } catch { /* never let autosave throw */ }
  };
  useEffect(() => {
    const flush = () => flushWorkingCopyRef.current();
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    const heartbeat = window.setInterval(flush, 5000);
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(heartbeat);
    };
  }, []);

  const handlePreview = () => {
    if (documentType === 'Quotation') {
      const est = assembleEstimateObject();
      if (!est) return;
      if (onPreviewEstimatePdf) {
        onPreviewEstimatePdf(est);
      } else {
        toast.info(`Previewing Quotation #${est.estimateNumber}`);
      }
    } else {
      // A SAVED bill reprints its real PDF directly. A NEW bill must be SAVED
      // first so the printed A4 carries the real server invoice number and the
      // bill always exists in history. Printing a provisional, unsaved bill is
      // exactly how bills got printed-but-lost with a number a later bill reused.
      if (!isSavedBill) { void handleSave({ previewAfter: true }); return; }
      const inv = assembleInvoiceObject();
      if (!inv) return;
      onPreviewPdf(inv);
    }
  };

  const handleShare = () => {
    if (documentType === 'Quotation') {
      const est = assembleEstimateObject();
      if (!est) return;
      const text = `*QUOTATION — MAJESTRONICZ*\nQuote: ${est.estimateNumber}\nDate: ${est.date}\nCustomer: ${est.customerName}\nGrand Total: ₹${est.grandTotal.toLocaleString('en-IN')}\nThank you for choosing Majestronicz!`;
      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
    } else {
      const inv = assembleInvoiceObject();
      if (!inv) return;
      const splits = inv.paymentSplits && inv.paymentSplits.length > 1
        ? inv.paymentSplits.map((s) => `${s.mode}: ₹${s.amount.toLocaleString('en-IN')}`).join(' + ')
        : `${inv.paymentMode}`;
      const text = `*SALES INVOICE — MAJESTRONICZ*\nInvoice: ${inv.invoiceNumber}\nDate: ${inv.date}\nCustomer: ${inv.customerName}\nGrand Total: ₹${inv.grandTotal.toLocaleString('en-IN')}\nPayment: ${splits} (${inv.transactionType})\nThank you for doing business with Majestronicz!`;
      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-150">
      {/* Duplicate-bill confirmation — a re-typed bill would hit stock twice. */}
      {dupWarn && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md bg-white border-2 border-amber-400 rounded-xl shadow-2xl p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-6 w-6 text-amber-600 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <h3 className="text-base font-extrabold text-slate-900">This looks like a duplicate bill</h3>
                <p className="text-sm text-slate-700 mt-1 leading-snug">
                  An identical bill for <strong>{customerName.trim() || 'this customer'}</strong> — same items, <strong>{formatCurrency(dupWarn.amount)}</strong> — was already saved as{' '}
                  <strong>{dupWarn.number}</strong> {dupWarn.minsAgo <= 0 ? 'just now' : `about ${dupWarn.minsAgo} min ago`}.
                </p>
                <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2 font-semibold">
                  Saving again makes a <u>second</u> bill and reduces stock a second time. Only continue if this is a genuinely separate sale.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setDupWarn(null)}
                className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-300 text-sm font-bold text-slate-800 cursor-pointer"
              >
                Cancel — it's the same bill
              </button>
              <button
                type="button"
                onClick={() => { const o = dupWarn.opts; setDupWarn(null); void handleSave({ ...o, skipDupCheck: true }); }}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-bold cursor-pointer"
              >
                Save anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate Notice Banner */}
      {duplicateSourceInvoice && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-indigo-950">
          <div className="flex items-center gap-2 flex-wrap">
            <Copy className="h-4 w-4 text-indigo-600 shrink-0" />
            <span className="font-bold">Duplicate Sale:</span>
            <span className="bg-white px-2 py-0.5 rounded border border-indigo-200 font-mono font-bold text-indigo-700">
              Copied from #{duplicateSourceInvoice.invoiceNumber}
            </span>
            <span className="text-slate-600">
              (Customer cleared — select or enter customer before saving)
            </span>
          </div>
          <span className="text-[11px] text-indigo-600 font-semibold">
            Fresh sequence #{invoiceNumber}
          </span>
        </div>
      )}

      {/* Duplicate Quote Notice Banner */}
      {duplicateSourceEstimate && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-purple-950">
          <div className="flex items-center gap-2 flex-wrap">
            <Copy className="h-4 w-4 text-purple-600 shrink-0" />
            <span className="font-bold">Duplicate Quote:</span>
            <span className="bg-white px-2 py-0.5 rounded border border-purple-200 font-mono font-bold text-purple-700">
              Copied from #{duplicateSourceEstimate.estimateNumber}
            </span>
            <span className="text-slate-600">
              (Customer cleared — select or enter customer before saving)
            </span>
          </div>
          <span className="text-[11px] text-purple-600 font-semibold">
            Fresh sequence #{invoiceNumber}
          </span>
        </div>
      )}

      {paidOverNewTotal > 0.009 && (
        <div className="bg-amber-50 border border-amber-300 px-4 py-2.5 text-xs text-amber-950" data-testid="paid-over-banner">
          {/* E2E10-4 */}
          <span className="font-bold">{formatCurrency(alreadyPaid)} paid</span> is <span className="font-bold">{formatCurrency(paidOverNewTotal)} more</span> than the new total.{' '}
          {customerId || customerPhone
            ? "The bill keeps what was collected and the difference is kept as the customer's store credit when you save."
            : 'A walk-in bill has no account to keep it on — add the customer, or record a return (refund) instead.'}
        </div>
      )}

      {keepsCollectedSplit && paidOverNewTotal <= 0.009 && (
        <div className="bg-sky-50 border border-sky-300 px-4 py-2.5 text-xs text-sky-950" data-testid="credit-back-banner">
          {/* FIN-A-1 */}
          <span className="font-bold">{formatCurrency(billCreditBack)} store credit</span> was given back on this bill when it was edited below what was paid.
          {' '}What was collected stays as it is
          {creditAppliedBack > 0.009 ? <>; <span className="font-bold">{formatCurrency(creditAppliedBack)}</span> of that credit is applied back to the new total</> : null}
          {leftToCollect > 0.009
            ? <>; <span className="font-bold">{formatCurrency(leftToCollect)} is left to collect</span> — it stays due on the bill (take it with Record Payment after saving).</>
            : '.'}
        </div>
      )}

      {pendingAdvance > 0 && (
        <div className="bg-emerald-50 border border-emerald-300 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-950" data-testid="pending-advance-banner">
          <span>
            {/* CRM10-7: plainer wording */}
            <span className="font-bold">Advance ₹{pendingAdvance.toLocaleString('en-IN')} already received</span> on this order. Leave that
            amount as "Credit (owed)" in the payment split — the advance pays it when you save — and collect only the rest now.
          </span>
          <button type="button" onClick={applyPendingAdvanceToSplits} className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold border border-emerald-700 cursor-pointer">
            Use advance
          </button>
        </div>
      )}

      {/* Source Reference Banner */}
      {(sourceEstimateNumber || sourceEnquiryNumber) && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-blue-950">
          <div className="flex items-center gap-2 flex-wrap">
            <Link className="h-4 w-4 text-blue-600 shrink-0" />
            <span className="font-bold">Linked Records:</span>
            {sourceEstimateNumber && (
              <span className="bg-white px-2 py-0.5 rounded border border-blue-200 font-mono font-bold text-blue-700">
                Created from Estimate {sourceEstimateNumber}
              </span>
            )}
            {sourceEnquiryNumber && (
              <span className="bg-white px-2 py-0.5 rounded border border-purple-200 font-mono font-bold text-purple-700">
                From Enquiry #{sourceEnquiryNumber}
              </span>
            )}
          </div>
          <span className="text-[11px] text-blue-600 font-medium">
            Cross-referenced in Majestronicz register
          </span>
        </div>
      )}

      {/* Top Banner with Document Mode Switcher & Action Buttons */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Left: Bill Type (the document-type label now sits in the sticky total bar) */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* If Invoice: show Bill Type (Cash Sale / Credit Bill) */}
          {documentType === 'Invoice' && (
            <div className="w-40 sm:w-44">
              <UniversalDropdown
                options={[
                  { value: 'Cash', label: 'Cash Sale' },
                  { value: 'Credit', label: 'Credit Bill' },
                ]}
                value={transactionType}
                onChange={(val) => {
                  const t = val as TransactionType;
                  setTransactionType(t);
                  // A Credit Bill is money NOT collected yet, so default its
                  // single payment split to COD-Credit — otherwise it stayed
                  // 'Cash' and the drawer counted cash that was never received.
                  // Switching back to Cash Sale defaults it to Cash.
                  setPaymentSplits((prev) =>
                    prev.length <= 1
                      ? [{ mode: t === 'Credit' ? 'COD-Credit' : 'Cash', amount: totals.grandTotal }]
                      : prev
                  );
                }}
              />
            </div>
          )}

          {/* E2E-20: a bill with an amount owed carries payment terms; the due
              date follows the bill date + the terms' days. */}
          {documentType === 'Invoice' && (transactionType === 'Credit' || paymentSplits.some((sp) => sp.mode === 'COD-Credit')) && paymentTermsOptions.length > 0 && (
            <div className="flex items-center gap-1.5" data-testid="payment-terms">
              <div className="w-36 sm:w-40">
                <UniversalDropdown
                  options={paymentTermsOptions.filter((t) => t.value !== 'Custom').map((t) => ({ value: t.value, label: t.label }))}
                  value={paymentTermsOptions.some((t) => t.value === paymentTerms) ? paymentTerms : paymentTermsOptions[0].value}
                  onChange={(val) => setPaymentTerms(String(val))}
                />
              </div>
              <span className="text-[11px] font-semibold text-slate-600 whitespace-nowrap">Due {dueDate.split('-').reverse().join('/')}</span>
            </div>
          )}

          {sourceEstimateId && (
            <span className="text-[11px] font-semibold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              <span>Converted from Estimate</span>
            </span>
          )}

          {duplicateSourceInvoice && (
            <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-200 flex items-center gap-1.5">
              <Copy className="h-3.5 w-3.5" />
              <span>Duplicate of #{duplicateSourceInvoice.invoiceNumber}</span>
            </span>
          )}

          {duplicateSourceEstimate && (
            <span className="text-[11px] font-semibold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-lg border border-purple-200 flex items-center gap-1.5">
              <Copy className="h-3.5 w-3.5" />
              <span>Duplicate of #{duplicateSourceEstimate.estimateNumber}</span>
            </span>
          )}
        </div>

        {/* Middle: compact meta — branch · number · date · time (fills the heading gap) */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <label className="flex items-center gap-1.5">
            <span className="uppercase font-bold text-slate-400">Branch</span>
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value as BranchId)}
              disabled={(!isAllBranches && currentBranch !== 'all') || !!initialInvoice || !!initialEstimate}
              title={initialInvoice || initialEstimate ? "An existing document's branch can't be changed" : undefined}
              className="bg-slate-50 border border-slate-200 rounded-none px-2 py-1 text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-600 disabled:opacity-70 cursor-pointer"
            >
              {BRANCHES.map((b) => (
                <option key={b.id} value={b.id}>{b.shortCode}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="uppercase font-bold text-slate-400">{documentType === 'Quotation' ? 'Quote No' : 'Inv No'}</span>
            {/* The AUTO tag sits beside the number, never over it (E2E6-10). */}
            <span className="inline-flex items-stretch">
              <input
                type="text"
                value={invoiceNumber}
                readOnly
                size={Math.max(12, invoiceNumber.length + 1)}
                aria-label={documentType === 'Quotation' ? 'Quotation number' : 'Invoice number'}
                title="Auto-generated number (kept unique per branch & financial year)"
                className={cn(
                  'w-auto px-2 py-1 rounded-none text-xs font-mono font-bold focus:outline-none cursor-default',
                  documentType === 'Quotation'
                    ? 'bg-purple-50/60 border border-purple-200 text-purple-800 focus:border-purple-600'
                    : 'bg-blue-50/60 border border-blue-200 text-blue-800 focus:border-blue-600'
                )}
              />
              <span className={cn(
                'flex items-center text-[10px] font-bold uppercase px-1.5 border border-l-0',
                documentType === 'Quotation' ? 'text-purple-700 bg-purple-100/70 border-purple-200' : 'text-blue-700 bg-blue-100/70 border-blue-200'
              )}>Auto</span>
            </span>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="uppercase font-bold text-slate-400">Date</span>
            <input
              type="date"
              value={date}
              // FIN-A-3: an edited bill stays in the current month (an ended month is reported).
              min={isSavedBill && documentType === 'Invoice' ? `${getTodayDateString().slice(0, 7)}-01` : undefined}
              onChange={(e) => setDate(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-none px-2 py-1 text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-600"
            />
          </label>
          <input
            type="text"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            title="Time"
            className="w-16 bg-slate-50 border border-slate-200 rounded-none px-2 py-1 text-xs font-mono font-semibold text-slate-800 focus:outline-none focus:border-blue-600"
          />
        </div>

        {/* Right: Quick Actions */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap justify-start md:justify-end w-full md:w-auto">
          {onBackToList && (
            <button
              type="button"
              onClick={onBackToList}
              title="Go to the Sales Invoice history (this bill stays open under Open Bills)"
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-none transition-colors cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5 text-slate-500" />
              <span>Invoices</span>
            </button>
          )}
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 border border-slate-300 rounded-none transition-colors cursor-pointer"
            >
              Cancel
            </button>
          )}

          <button
            type="button"
            onClick={handleShare}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-none transition-colors shadow-none cursor-pointer"
          >
            <Share2 className="h-3.5 w-3.5 text-slate-500" />
            <span>Share</span>
          </button>

          <button
            type="button"
            onClick={handlePreview}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-none transition-colors shadow-none cursor-pointer"
            title={documentType === 'Invoice' && !isSavedBill ? 'Saves the bill first, then opens the A4 to print — a printed bill is always recorded' : 'Open the A4 PDF to print'}
          >
            <Printer className="h-3.5 w-3.5 text-slate-500" />
            <span>{documentType === 'Invoice' && !isSavedBill ? 'Save & Print A4' : 'Reprint PDF'}</span>
          </button>

          {/* #4: edit-mode actions moved off the list and into the open bill. */}
          {isSavedBill && documentType === 'Invoice' && initialInvoice && canVoidBill && !initialInvoice.isVoided && onVoidBill && (
            <button
              type="button"
              onClick={() => onVoidBill(initialInvoice)}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-none transition-colors cursor-pointer"
              title="Void this bill (reverses the sale, keeps the record)"
            >
              <Ban className="h-3.5 w-3.5 text-amber-600" />
              <span>Void</span>
            </button>
          )}
          {/* Permanent Delete removed per owner request — use Void to cancel a
              bill (reversible, keeps the record). */}

          {/* "Save Draft" button removed — the bill auto-drafts to Saved Drafts
              as it is typed, so nothing in progress is ever lost. */}

          <button
            type="button"
            onClick={() => handleSave()}
            disabled={isSaving || (documentType === 'Invoice' && (!isPaymentReconciled || !paymentReceived))}
            className={cn(
              "flex items-center gap-2 px-5 py-2 text-xs font-bold text-white rounded-none border transition-colors shadow-none cursor-pointer",
              documentType === 'Invoice' && (!isPaymentReconciled || !paymentReceived)
                ? "bg-slate-400 border-slate-500 cursor-not-allowed opacity-60"
                : documentType === 'Quotation'
                ? "bg-slate-800 hover:bg-slate-900 border-slate-900"
                : "bg-red-600 hover:bg-red-700 border-red-700"
            )}
            title={
              documentType === 'Invoice' && !isPaymentReconciled
                ? `Reconcile payment splits: ${remainingBalance > 0 ? `₹${remainingBalance} remaining` : `₹${Math.abs(remainingBalance)} over`}`
                : documentType === 'Invoice' && !paymentReceived
                ? 'Tick "Received" (below the payment mode) to confirm the payment before saving'
                : undefined
            }
          >
            <Save className="h-3.5 w-3.5" />
            <span>{documentType === 'Quotation' ? 'Save Quotation' : 'Save Invoice & Update Inventory'}</span>
          </button>
        </div>
      </div>

      {/* Main Invoice Form Header Details Card */}
      <div className="bg-white border border-slate-200 rounded-none p-3 shadow-none space-y-2.5">
        {/* Mobile-first customer line: type the mobile → name + address show small */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-56 shrink-0 relative">
            <PhoneInput
              placeholder="Customer mobile no."
              value={customerPhone}
              onChange={setCustomerPhone}
              size="md"
              disabled={lockBuyer}
              inputClassName="text-base font-bold tracking-wide"
              onFocus={() => setPhoneFocused(true)}
              onBlur={() => setTimeout(() => setPhoneFocused(false), 150)}
            />
            {/* Old-customer suggestions by number prefix (#6) */}
            {phoneFocused && !selectedCustomerObj && phoneSuggestions.length > 0 && (
              <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-300 rounded-lg shadow-lg max-h-64 overflow-auto">
                {phoneSuggestions.map((c) => (
                  <button
                    key={c.phone}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); pickCustomer(c); }}
                    className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-slate-100 last:border-0"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-slate-900 text-sm truncate">{c.name || 'Customer'}</span>
                      <span className="font-mono text-xs text-slate-600 shrink-0">{c.phone}</span>
                    </div>
                    {c.address && <div className="text-[11px] text-slate-400 truncate">{c.address}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Name — type to search existing customers by name (suggestions), or
              auto-filled & locked when the number matches a saved customer. The
              mobile is optional, so a bill can be saved with just the name. */}
          <div className="w-56 shrink-0 relative">
            <input
              type="text"
              value={selectedCustomerObj ? selectedCustomerObj.name : customerName}
              onChange={(e) => { setCustomerName(e.target.value); setNameHighlight(0); }}
              readOnly={!!selectedCustomerObj || lockBuyer}
              onFocus={() => setNameFocused(true)}
              onBlur={() => setTimeout(() => setNameFocused(false), 150)}
              onKeyDown={(e) => {
                // Keyboard pick: ↑/↓ to move, ENTER to select the highlighted
                // suggestion (fills name + phone + address), ESC to close.
                if (!nameFocused || nameSuggestions.length === 0) return;
                if (e.key === 'ArrowDown') { e.preventDefault(); setNameHighlight((h) => Math.min(h + 1, nameSuggestions.length - 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setNameHighlight((h) => Math.max(h - 1, 0)); }
                else if (e.key === 'Enter') { e.preventDefault(); const pick = nameSuggestions[nameHighlight] || nameSuggestions[0]; if (pick) pickCustomer(pick); }
                else if (e.key === 'Escape') { setNameFocused(false); }
              }}
              placeholder={documentType === 'Quotation' ? 'Name (optional)' : 'Customer name *'}
              className={cn(
                'w-full px-2.5 py-1.5 rounded-lg border text-base font-bold text-slate-900 placeholder-slate-400 placeholder:text-sm placeholder:font-semibold focus:outline-none',
                selectedCustomerObj
                  ? 'bg-slate-100 border-slate-200 cursor-default'
                  : 'bg-slate-50 border-slate-200 focus:border-blue-600'
              )}
            />
            {/* Old-customer suggestions by NAME (mirrors the number-prefix search) */}
            {nameFocused && !selectedCustomerObj && nameSuggestions.length > 0 && (
              <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-300 rounded-lg shadow-lg max-h-64 overflow-auto">
                {nameSuggestions.map((c, i) => (
                  <button
                    key={(c.id || c.phone || c.name) + i}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); pickCustomer(c); }}
                    onMouseEnter={() => setNameHighlight(i)}
                    className={cn('w-full text-left px-3 py-2 border-b border-slate-100 last:border-0', i === nameHighlight ? 'bg-blue-50' : 'hover:bg-blue-50')}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-slate-900 text-sm truncate">{c.name || 'Customer'}</span>
                      {c.phone && <span className="font-mono text-xs text-slate-600 shrink-0">{c.phone}</span>}
                    </div>
                    {c.address && <div className="text-[11px] text-slate-400 truncate">{c.address}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Address — auto-filled & locked when a saved customer is matched */}
          {selectedCustomerObj && (
            <input
              type="text"
              value={customerAddress || selectedCustomerObj.address || ''}
              readOnly
              placeholder="Address"
              className="w-64 px-2.5 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-xs font-medium text-slate-700 cursor-default focus:outline-none"
            />
          )}
          {selectedCustomerObj && !lockBuyer && (
            <button
              type="button"
              onClick={() => { setCustomerId(undefined); setCustomerName(''); setCustomerPhone(''); setCustomerAddress(''); setShowNewCustomerPrompt(false); }}
              className="shrink-0 text-[10px] font-bold text-slate-500 hover:text-red-600 cursor-pointer"
              title="Change customer"
            >
              Change
            </button>
          )}

          {/* Place of supply (SAL8-5): another state's code bills IGST instead of CGST + SGST */}
          <label className="ml-auto flex items-center gap-1.5 shrink-0" title="Place of supply — taken from the buyer's GSTIN when known">
            <span className="text-[11px] font-bold uppercase text-slate-400">Place of supply</span>
            <select
              data-testid="place-of-supply"
              value={stateOfSupply}
              onChange={(e) => setStateOfSupply(e.target.value)}
              disabled={lockBuyer}
              className={cn(
                'px-2 py-1 rounded-lg border text-xs font-semibold focus:outline-none focus:border-blue-600 disabled:opacity-60 disabled:cursor-not-allowed',
                isInterState ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-slate-50 border-slate-200 text-slate-800'
              )}
            >
              {supplyOptions.map((st) => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
            {isInterState && withGst && <span className="text-[10px] font-bold text-amber-700">IGST</span>}
          </label>

          {/* GST toggle */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[11px] font-bold uppercase text-slate-400">GST</span>
            <button
              type="button"
              onClick={() => handleToggleGst(!withGst)}
              className={cn(
                'px-2.5 py-1 rounded-lg text-xs font-bold transition-all',
                withGst ? 'bg-emerald-600 text-white shadow-2xs' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
              )}
            >
              {withGst ? 'On' : 'Off'}
            </button>
          </div>
        </div>

        {/* New/unknown number → small quick-add customer card */}
        {showNewCustomerPrompt && documentType !== 'Quotation' && (
          <div className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-blue-50/60 border border-blue-200">
            <span className="text-[11px] font-bold text-blue-800 flex items-center gap-1 shrink-0">
              <Plus className="h-3.5 w-3.5" /> New number — add customer?
            </span>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Customer name *"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleQuickAddCustomer(); } }}
              className="w-44 px-2.5 py-1.5 rounded-md bg-white border border-blue-200 text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-500"
            />
            <input
              type="text"
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
              placeholder="Address (optional)"
              className="w-52 px-2.5 py-1.5 rounded-md bg-white border border-blue-200 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={handleQuickAddCustomer}
              className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold border border-blue-700 transition-colors"
            >
              Save customer
            </button>
            <button
              type="button"
              onClick={() => { setShowNewCustomerPrompt(false); setSkipCustomerSave(true); }}
              className="px-2.5 py-1.5 rounded-md bg-white hover:bg-slate-100 text-slate-600 text-xs font-semibold border border-slate-300 transition-colors"
              title="Bill without saving (walk-in)"
            >
              Skip
            </button>
          </div>
        )}

      </div>

      {/* LINE ITEMS TABLE CARD */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <p className="sm:hidden px-3 pt-2 text-[11px] text-slate-500">Swipe the lines sideways for discount, tax and amount.</p>
        {/* Line Items Table */}
        {/* Resizable item editor — drag the bottom edge to grow/shrink (the product
            search opens in a portal, so it is never clipped by this scroll area). */}
        <div ref={itemScrollRef} className="overflow-auto resize-y min-h-[280px] max-h-[75vh] pb-4">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-600 font-bold uppercase text-[11px] tracking-wider">
                <th className="py-3 px-3 w-10 text-center">#</th>
                {/* 390 px (V8): a narrower item column and no rack column, so Qty and
                    Price are on screen; the rest scrolls inside this card. */}
                <th className="py-3 px-2 sm:px-3 min-w-[150px] sm:min-w-[240px]">Item Description / Search Catalog</th>
                <th className="py-3 px-3 w-20 min-w-[68px]">Qty</th>
                <th className="py-3 px-3 w-20 min-w-[68px]">Unit</th>
                <th className="py-3 px-3 w-28 text-right">Price/Unit (₹)</th>
                <th className="py-3 px-3 w-28 text-right">Discount</th>
                {withGst && (
                  <>
                    <th className="py-3 px-3 w-20 text-right">Tax Rate</th>
                    <th className="py-3 px-3 w-24 text-right">Tax (₹)</th>
                  </>
                )}
                <th className="py-3 px-3 w-28 text-right">Amount (₹)</th>
                {documentType === 'Quotation' && (
                  <th className="py-3 px-3 w-24 text-center" title="Delivery lead time for items not in stock">Lead Time</th>
                )}
                <th className="py-3 px-3 w-10 text-center"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {lineItems.map((item, idx) => {
                // A row with no product picked/typed is just the blank "add item"
                // row — quantity, price and discount stay locked there so a
                // nameless line can never carry an amount into the bill total.
                const hasProduct = !!(item.itemName && item.itemName.trim());
                return (
                  <tr
                    key={item.id}
                    data-line-row
                    style={{ position: 'relative', zIndex: lineItems.length - idx + 10 }}
                    className="hover:bg-slate-50/50 transition-colors"
                  >
                    <td className="py-2.5 px-3 text-center text-slate-400 font-mono font-medium">
                      {idx + 1}
                    </td>

                    {/* Item Description + Autocomplete Picker */}
                    <td className="py-2.5 px-2 sm:px-3 relative" style={{ zIndex: lineItems.length - idx + 20 }}>
                      <ItemSearchDropdown
                        value={item.itemName}
                        autoFocus={focusRowId === item.id}
                        onChange={(val) =>
                          // Clearing the name must also clear the linked product,
                          // otherwise its rack location & price would linger on the row.
                          val.trim()
                            ? updateLineItem(item.id, { itemName: val })
                            : updateLineItem(item.id, {
                                itemName: '', itemId: undefined, itemCode: '', itemHSN: '',
                                unitPrice: 0, isCombo: false, comboId: undefined, comboComponents: undefined,
                              })
                        }
                        onClear={() => updateLineItem(item.id, {
                          itemName: '', itemId: undefined, itemCode: '', itemHSN: '',
                          unitPrice: 0, isCombo: false, comboId: undefined, comboComponents: undefined,
                        })}
                        onSelectItem={(masterItem) => selectMasterItemForRow(item.id, masterItem)}
                        onSelectCombo={(combo) => selectComboForRow(item.id, combo)}
                        includeCombos={true}
                        selectedBranchId={selectedBranch}
                        lockOutOfStock={documentType === 'Invoice'}
                        placeholder="Type or search product or combo..."
                        dropdownWidth="w-[520px] max-w-[calc(100vw-2rem)]"
                        inputClassName="w-full px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600"
                      />
                      {item.isCombo && (
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="px-1.5 py-0.2 rounded text-[11px] font-bold bg-purple-100 text-purple-700 border border-purple-200 uppercase">
                            Combo Bundle
                          </span>
                          <span className="text-[11px] text-purple-700 font-mono font-bold">
                            {item.itemCode}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Quantity */}
                    <td className="py-2.5 px-3">
                      <input
                        type="number"
                        min={lineIsWholeUnit(item) ? '1' : '0.01'}
                        step={lineIsWholeUnit(item) ? '1' : '0.01'}
                        value={item.quantity}
                        data-testid="line-qty"
                        aria-label={`Quantity, line ${idx + 1}`}
                        aria-invalid={lineIsWholeUnit(item) && !Number.isInteger(Number(item.quantity))}
                        disabled={!hasProduct}
                        title={!hasProduct ? 'Pick a product first' : (lineIsWholeUnit(item) && !Number.isInteger(Number(item.quantity)) ? `${(item.unit || '').toUpperCase()} is counted in whole numbers` : undefined)}
                        onChange={(e) => updateLineItem(item.id, { quantity: Number(e.target.value) })}
                        onKeyDown={(e) => {
                          // Real-billing shortcut: Enter on the last row's qty adds a fresh item row.
                          if (e.key === 'Enter' && item.itemName.trim() && idx === lineItems.length - 1) {
                            e.preventDefault();
                            addNewRow();
                          }
                        }}
                        className={cn("w-full px-2 py-1.5 rounded-lg bg-slate-50 border text-xs font-bold text-slate-900 text-right focus:outline-none focus:border-blue-600 font-mono disabled:bg-slate-100 disabled:text-slate-300 disabled:cursor-not-allowed", lineIsWholeUnit(item) && !Number.isInteger(Number(item.quantity)) ? "border-rose-500 bg-rose-50" : "border-slate-200")}
                      />
                    </td>

                    {/* Unit */}
                    <td className="py-2.5 px-3">
                      <input
                        type="text"
                        value={item.unit}
                        onChange={(e) => updateLineItem(item.id, { unit: e.target.value.toUpperCase() })}
                        aria-label={`Unit, line ${idx + 1}`}
                        className="w-full px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 uppercase focus:outline-none focus:border-blue-600 font-mono"
                      />
                    </td>

                    {/* Price/Unit (Pre-tax, Editable Override) */}
                    <td className="py-2.5 px-3">
                      <input
                        aria-label={`Price per unit, line ${idx + 1}`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unitPrice}
                        onChange={(e) => updateLineItem(item.id, { unitPrice: Number(e.target.value) })}
                        readOnly={!hasFlag('bill.editPrice')}
                        disabled={!hasProduct}
                        className={`w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-900 text-right focus:outline-none focus:border-blue-600 font-mono disabled:bg-slate-100 disabled:text-slate-300 disabled:cursor-not-allowed ${hasFlag('bill.editPrice') ? 'bg-slate-50' : 'bg-slate-100 cursor-not-allowed'}`}
                        title={!hasProduct ? 'Pick a product first' : (hasFlag('bill.editPrice') ? 'Override price for this invoice. Never mutates catalog.' : 'Price editing is not permitted for your role.')}
                      />
                      {isZeroFreeTextLine(item) && (
                        <p className="mt-0.5 text-[10px] font-bold text-rose-600" data-testid="zero-price-warning">
                          Not a catalogue item — pick it from the list or enter a price
                        </p>
                      )}
                    </td>

                    {/* Discount (% or Amount) */}
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1">
                        <input
                          aria-label={`Discount, line ${idx + 1}`}
                          type="number"
                          min="0"
                          step="0.1"
                          placeholder="0"
                          value={item.discountValue || ''}
                          onChange={(e) =>
                            updateLineItem(item.id, { discountValue: Number(e.target.value) })
                          }
                          disabled={!hasFlag('bill.giveDiscount') || !hasProduct}
                          title={!hasProduct ? 'Pick a product first' : (hasFlag('bill.giveDiscount') ? undefined : 'Discounts are not permitted for your role.')}
                          className={`w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-mono text-right focus:outline-none focus:border-blue-600 disabled:bg-slate-100 disabled:text-slate-300 disabled:cursor-not-allowed ${hasFlag('bill.giveDiscount') ? 'bg-slate-50' : 'bg-slate-100 cursor-not-allowed'}`}
                        />
                        <button
                          type="button"
                          disabled={!hasFlag('bill.giveDiscount') || !hasProduct}
                          onClick={() =>
                            updateLineItem(item.id, {
                              discountType: item.discountType === '%' ? 'amount' : '%',
                            })
                          }
                          className="px-1.5 py-1 text-[11px] font-bold rounded bg-slate-100 hover:bg-slate-200 text-slate-600 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Toggle % or ₹"
                        >
                          {item.discountType === '%' ? '%' : '₹'}
                        </button>
                      </div>
                    </td>

                    {/* Tax Rate & Amount (With GST only) */}
                    {withGst && (
                      <>
                        {/* GST rate is sourced from the catalog item's tax slab and is
                            NOT editable on the sales screen — it only ever reflects the
                            product's configured rate (set when the item is selected). */}
                        <td className="py-2.5 px-3 text-right">
                          <span
                            className="inline-block w-full px-2 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-xs font-mono font-semibold text-slate-600 text-right cursor-default"
                            title={item.itemId ? 'GST rate is fixed by the product catalog and cannot be changed here.' : 'Default GST rate for this line.'}
                          >
                            {Number(item.taxRate) || 0}%
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                          {item.totalTax.toFixed(2)}
                        </td>
                      </>
                    )}

                    {/* Row Total Amount */}
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                      {item.totalAmount.toFixed(2)}
                    </td>

                    {/* Lead Time (Quotation only) — fill for items not in stock.
                        We flag out-of-stock lines so staff know to give a lead
                        time (no new branch needed — quote it from this branch). */}
                    {documentType === 'Quotation' && (() => {
                      const availQty = item.itemId
                        ? (branchStocks.find((s) => s.itemId === item.itemId && s.branchId === selectedBranch)?.quantity ?? 0)
                        : null;
                      const outOfStock = availQty !== null && availQty <= 0;
                      return (
                        <td className="py-2.5 px-3">
                          <div className="flex flex-col items-center gap-1">
                            {item.itemId && (
                              outOfStock ? (
                                <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-600 border border-rose-200 whitespace-nowrap">Out of stock</span>
                              ) : (
                                <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 whitespace-nowrap">In stock · {availQty}</span>
                              )
                            )}
                            <div className="flex items-center gap-1 justify-center">
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={item.leadDays ?? ''}
                                onChange={(e) => updateLineItem(item.id, { leadDays: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })}
                                placeholder={outOfStock ? 'days?' : '—'}
                                title="Delivery lead time in days (leave blank if in stock)"
                                className={cn(
                                  'w-12 px-1.5 py-1 rounded-lg text-xs font-mono text-center focus:outline-none focus:border-blue-600 border',
                                  outOfStock && (item.leadDays == null)
                                    ? 'bg-rose-50 border-rose-300 placeholder:text-rose-400'
                                    : 'bg-slate-50 border-slate-200',
                                )}
                              />
                              <span className="text-[10px] text-slate-400">days</span>
                            </div>
                          </div>
                        </td>
                      );
                    })()}

                    {/* Delete Row */}
                    <td className="py-2.5 px-3 text-center">
                      <button
                        aria-label={`Delete line ${idx + 1}`}
                        type="button"
                        onClick={() => removeLineItem(item.id)}
                        className="p-1 rounded-lg text-slate-300 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                        title="Delete line"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Add Row Button Strip */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => addNewRow()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-blue-700 text-xs font-bold border border-slate-200 shadow-2xs transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Row</span>
            </button>
            <button
              type="button"
              onClick={() => setBulkOpen(true)}
              title="Paste the customer's SKU list to add many items at once"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-emerald-700 text-xs font-bold border border-slate-200 shadow-2xs transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Bulk add (SKU)</span>
            </button>
            <button
              type="button"
              onClick={() => setScanOpen(true)}
              title="Scan a product barcode with the phone/laptop camera to add it to the bill"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-indigo-700 text-xs font-bold border border-slate-200 shadow-2xs transition-colors"
            >
              <ScanLine className="h-3.5 w-3.5" />
              <span>Scan with camera</span>
            </button>
            {documentType === 'Quotation' && outOfCatalogLines.length > 0 && (
              <button
                type="button"
                onClick={handleSendNewItemsToEnquiries}
                title="Log the products not in your catalog as New-item enquiries so you can raise a PO"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-violet-700 text-xs font-bold border border-slate-200 shadow-2xs transition-colors"
              >
                <FileText className="h-3.5 w-3.5" />
                <span>Send {outOfCatalogLines.length} new item{outOfCatalogLines.length === 1 ? '' : 's'} to Enquiries</span>
              </button>
            )}
          </div>
          <span className="text-xs text-slate-500">
            {lineItems.length} item{lineItems.length === 1 ? '' : 's'} in invoice
          </span>
        </div>
      </div>

      {/* Phone/laptop camera barcode scan → straight onto the bill */}
      <CameraScanModal
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onScan={(code) => scanHandlerRef.current(code)}
        title={documentType === 'Quotation' ? 'Scan item for quotation' : 'Scan item for bill'}
      />

      {/* Bulk add by SKU (#4c) */}
      {bulkOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50" onClick={() => setBulkOpen(false)}>
          <div className="bg-white border border-slate-300 rounded-xl w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Bulk add by SKU</h3>
              <button type="button" onClick={() => setBulkOpen(false)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-slate-600">
                Paste the customer's list — one item per line, as <span className="font-mono bg-slate-100 px-1">SKU</span> or
                {' '}<span className="font-mono bg-slate-100 px-1">SKU qty</span> (you can paste two columns straight from Excel).
                Codes you have are added from the catalog; codes you don't become editable rows to fill in.
              </p>
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                rows={8}
                placeholder={'MC-AR-ARDU  5\nDP-ED-13NC  10\nUNKNOWN-SKU  2'}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-300 text-xs font-mono text-slate-900 focus:outline-none focus:border-blue-600"
                autoFocus
              />
              <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={() => setBulkOpen(false)} className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-300">Cancel</button>
                <button type="button" onClick={handleBulkAdd} className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg border border-emerald-700">Add items</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FOOTER & SUMMARY SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (Span 7): Payment Mode + Terms + Notes */}
        <div className="lg:col-span-7 space-y-5">
          {/* PAYMENT MODE & SPLIT PAYMENT (Daily Cash Register Connected) */}
          {documentType === 'Invoice' ? (
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                    <span>Payment Allocation (Daily Cash Register)</span>
                    <span className="text-rose-500">*</span>
                    {paymentSplits.length > 1 && (
                      <span className="text-[11px] font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-200 flex items-center gap-1">
                        <Split className="h-2.5 w-2.5" />
                        <span>Split Payment ({paymentSplits.length} modes)</span>
                      </span>
                    )}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Settlement modes automatically populate matching columns in the Daily Cash sheet.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {paymentSplits.length > 1 && (
                    <button
                      type="button"
                      onClick={handleResetToSingleMode}
                      className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 underline cursor-pointer"
                    >
                      Reset to Single Mode
                    </button>
                  )}
                  <span className="text-[11px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                    Auto-Reconciles
                  </span>
                </div>
              </div>

              {keepsCollectedSplit ? (
                /* FIN-A-1 / FIN-E-2: the bill keeps what was collected on it */
                <div className="space-y-2 text-xs" data-testid="kept-split-panel">
                  <p className="text-[11px] text-slate-500">Collected on this bill — kept as it is when you save:</p>
                  {collectedOnBill.length ? collectedOnBill.map((sp, i) => (
                    <div key={i} className="flex items-center justify-between bg-slate-50 border border-slate-200 px-3 py-2">
                      <span className="font-bold text-slate-700">{sp.mode}</span>
                      <span className="font-mono font-bold text-slate-900">{formatCurrency(Number(sp.amount) || 0)}</span>
                    </div>
                  )) : <div className="bg-slate-50 border border-slate-200 px-3 py-2 text-slate-500">Nothing was collected at billing.</div>}
                  {paidOverNewTotal > 0.009 && (
                    <div className="flex items-center justify-between bg-amber-50 border border-amber-200 px-3 py-2 text-amber-900">
                      <span className="font-bold">Paid over the new total → store credit</span>
                      <span className="font-mono font-bold">{formatCurrency(paidOverNewTotal)}</span>
                    </div>
                  )}
                  {creditAppliedBack > 0.009 && (
                    <div className="flex items-center justify-between bg-sky-50 border border-sky-200 px-3 py-2 text-sky-900">
                      <span className="font-bold">Store credit applied back</span>
                      <span className="font-mono font-bold">{formatCurrency(creditAppliedBack)}</span>
                    </div>
                  )}
                  {leftToCollect > 0.009 && (
                    <div className="flex items-center justify-between bg-rose-50 border border-rose-200 px-3 py-2 text-rose-900" data-testid="left-to-collect">
                      <span className="font-bold">Left to collect (stays due)</span>
                      <span className="font-mono font-bold">{formatCurrency(leftToCollect)}</span>
                    </div>
                  )}
                </div>
              ) : paymentSplits.length <= 1 ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <UniversalDropdown
                        options={saleSplitOptionsWithAdd}
                        value={paymentSplits[0]?.mode || 'Cash'}
                        onChange={(val) => {
                          if (val === ADD_PAY_SENTINEL) { addPaymentType(); return; }
                          setPaymentSplits([{ mode: val as PaymentMode, amount: totals.grandTotal }]);
                        }}
                      />
                      <button
                        type="button"
                        onClick={addPaymentType}
                        className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-800"
                        title="Add a custom payment type (e.g. Paytm, Card)"
                      >
                        <Plus className="h-3 w-3" /> Add payment type
                      </button>
                    </div>
                    <div className="w-36 text-right px-3 py-2 bg-slate-50 rounded-xl border border-slate-200">
                      <span className="text-[11px] text-slate-400 font-semibold block uppercase">Amount (this bill)</span>
                      <span className="font-mono font-bold text-slate-800 text-xs">
                        {formatCurrency(totals.grandTotal)}
                      </span>
                    </div>
                  </div>

                  {/* When collecting previous dues, the bill's own cash is still
                      its grand total; the dues are settled as a separate receipt
                      on save. Show the combined cash so the counter total is clear. */}
                  {settlePrevDues && customerOutstanding > 0.009 && (
                    <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-xs">
                      <span className="font-bold text-rose-800">+ Previous dues (settled on save)</span>
                      <span className="font-mono font-bold text-rose-700">{formatCurrency(customerOutstanding)}</span>
                    </div>
                  )}
                  {settlePrevDues && customerOutstanding > 0.009 && (
                    <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-rose-100/70 border border-rose-300 text-xs">
                      <span className="font-extrabold text-rose-900">Total cash to collect</span>
                      <span className="font-mono font-extrabold text-rose-800">{formatCurrency(collectNowTotal)}</span>
                    </div>
                  )}

                  {/* Partial Payment Toggle for COD-Credit */}
                  {paymentSplits[0]?.mode === 'COD-Credit' && (
                    <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 space-y-3 mt-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-amber-900">
                            Partial Payment (PP) Received?
                          </span>
                          <span className="text-[11px] bg-amber-200 text-amber-800 px-1.5 py-0.2 rounded font-mono font-bold">
                            "PP" Register Column
                          </span>
                        </div>
                        <input
                          type="checkbox"
                          id="partial-pay-toggle"
                          checked={isPartialPayment}
                          onChange={(e) => setIsPartialPayment(e.target.checked)}
                          className="h-4 w-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
                        />
                      </div>

                      {isPartialPayment && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-amber-200">
                          <div>
                            <label className="block text-[11px] font-bold text-amber-900 mb-1">
                              Advance / Partial Amount Collected (₹)
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              placeholder="Enter collected partial amount..."
                              value={partialAmount || ''}
                              onChange={(e) => setPartialAmount(Number(e.target.value))}
                              className="w-full px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:border-blue-600"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-amber-900 mb-1">
                              Remaining Balance Due
                            </label>
                            <div className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-xs font-mono font-bold text-rose-700">
                              {formatCurrency(balanceDue)}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Button to add payment split */}
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={handleAddSplit}
                      className="flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-800 bg-blue-50/70 hover:bg-blue-100/70 px-3 py-2 rounded-xl border border-blue-200/80 transition-all cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Add Payment Split (e.g. Cash + GPay)</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* MULTI-SPLIT PAYMENT VIEW */
                <div className="space-y-3">
                  <div className="space-y-2.5">
                    {paymentSplits.map((split, index) => (
                      <div
                        key={index}
                        className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3 bg-slate-50/80 p-2.5 rounded-xl border border-slate-200 transition-all"
                      >
                        <span className="text-[11px] font-bold text-slate-500 w-16 shrink-0">
                          Split #{index + 1}
                        </span>

                        {/* Payment Mode Selector */}
                        <div className="w-44 sm:w-56 shrink-0">
                          <UniversalDropdown
                            options={saleSplitOptionsWithAdd}
                            value={split.mode}
                            onChange={(val) => {
                              if (val === ADD_PAY_SENTINEL) { addPaymentType(); return; }
                              handleUpdateSplitMode(index, val as PaymentMode);
                            }}
                          />
                        </div>

                        {/* Split Amount Input */}
                        <div className="flex-1 relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-slate-400 text-xs font-bold">
                            ₹
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={split.amount === 0 ? '' : split.amount}
                            onChange={(e) => handleUpdateSplitAmount(index, Number(e.target.value))}
                            placeholder="0.00"
                            className="w-full pl-6 pr-3 py-1.5 bg-white rounded-lg border border-slate-300 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:border-blue-600"
                          />
                        </div>

                        {/* Quick fill button if remaining */}
                        {remainingBalance > 0 && index === paymentSplits.length - 1 && (
                          <button
                            type="button"
                            onClick={() => handleUpdateSplitAmount(index, split.amount + remainingBalance)}
                            title={`Fill remaining ₹${remainingBalance}`}
                            className="hidden sm:inline-flex text-[11px] font-bold text-blue-700 bg-blue-100/70 hover:bg-blue-200 px-2 py-1 rounded transition-colors whitespace-nowrap cursor-pointer"
                          >
                            + Fill Remainder
                          </button>
                        )}

                        {/* Remove Split Button */}
                        <button
                          type="button"
                          onClick={() => handleRemoveSplit(index)}
                          title="Remove this payment split"
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer shrink-0"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Add split row button */}
                  <div className="flex items-center justify-between pt-1 flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleAddSplit}
                      disabled={paymentSplits.length >= 4}
                      className={cn(
                        "flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl border transition-all cursor-pointer",
                        paymentSplits.length >= 4
                          ? "text-slate-400 bg-slate-100 border-slate-200 cursor-not-allowed"
                          : "text-blue-600 hover:text-blue-800 bg-blue-50/70 hover:bg-blue-100/70 border-blue-200"
                      )}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Add Another Split</span>
                    </button>

                    <span className="text-[11px] text-slate-500 font-medium">
                      Total Allocated: <span className="font-mono font-bold text-slate-800">{formatCurrency(totalAllocated)}</span> / <span className="font-mono">{formatCurrency(totals.grandTotal)}</span>
                    </span>
                  </div>

                  {/* LIVE RECONCILIATION BALANCE STATUS */}
                  <div className="pt-1">
                    {Math.abs(remainingBalance) < 0.01 ? (
                      <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between text-xs text-emerald-900 font-bold">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                          <span>Payment Fully Allocated & Reconciled (₹0 remaining)</span>
                        </div>
                        <span className="text-[11px] font-mono bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded border border-emerald-300">
                          Ready to Save
                        </span>
                      </div>
                    ) : remainingBalance > 0 ? (
                      <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 flex items-center justify-between text-xs text-amber-900 font-bold">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                          <span>₹{remainingBalance.toLocaleString('en-IN')} remaining to allocate</span>
                        </div>
                        <span className="text-[11px] font-medium text-amber-700">
                          Must equal ₹{totals.grandTotal.toLocaleString('en-IN')} before saving
                        </span>
                      </div>
                    ) : (
                      <div className="p-3 rounded-xl bg-rose-50 border border-rose-300 flex items-center justify-between text-xs text-rose-900 font-bold">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
                          <span>₹{Math.abs(remainingBalance).toLocaleString('en-IN')} over-allocated</span>
                        </div>
                        <span className="text-[11px] font-medium text-rose-700">
                          Exceeds grand total by ₹{Math.abs(remainingBalance).toLocaleString('en-IN')}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* COD-Credit split notice */}
                  {paymentSplits.some((s) => s.mode === 'COD-Credit' && s.amount > 0) && (
                    <div className="p-2.5 rounded-xl bg-indigo-50/80 border border-indigo-200 text-xs text-indigo-900 space-y-0.5">
                      <span className="font-bold block">Credit Portion Note:</span>
                      <p className="text-[11px] text-indigo-700 leading-relaxed">
                        ₹{paymentSplits.find((s) => s.mode === 'COD-Credit')?.amount.toLocaleString('en-IN')} allocated to COD-Credit will be logged as outstanding balance due for this customer. Paid portions will reconcile to their respective drawer/bank sheets immediately.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Mandatory "Received" confirmation — the bill can't be saved
                  until the cashier ticks it, so the payment mode is never left
                  on the default Cash by mistake. */}
              <label
                className={cn(
                  'mt-3 flex items-center gap-2.5 px-3 py-2.5 rounded-xl border-2 cursor-pointer select-none transition-colors',
                  paymentReceived
                    ? 'bg-emerald-50 border-emerald-400'
                    : 'bg-amber-50 border-amber-400 animate-pulse'
                )}
              >
                <input
                  type="checkbox"
                  checked={paymentReceived}
                  onChange={(e) => setPaymentReceived(e.target.checked)}
                  className="h-5 w-5 accent-emerald-600 cursor-pointer shrink-0"
                />
                <span className="text-sm font-extrabold text-slate-900">Received</span>
                <span className="text-[11px] font-semibold text-slate-500">
                  {paymentReceived
                    ? '— payment confirmed by the mode above'
                    : '— tick after confirming the payment & mode (required to save)'}
                </span>
              </label>
            </div>
          ) : (
            <div className="bg-purple-50/60 border border-purple-200 rounded-xl p-5 shadow-xs space-y-2">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-purple-600 shrink-0" />
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-purple-950">
                  Quotation Terms & Workflow Notice
                </h3>
              </div>
              <p className="text-xs text-purple-800 leading-relaxed">
                This document is a commercial price quotation. Physical inventory is not decremented and no cash ledger entry is made until converted into a finalized Sales Invoice.
              </p>
            </div>
          )}

          {/* Cash Tendered → Change to Return (counter helper, Invoice only).
              Display-only: does not change the recorded payment or create credit. */}
          {documentType === 'Invoice' && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <label className="text-xs font-extrabold uppercase tracking-wider text-slate-700 shrink-0">
                  Cash Given by Customer
                </label>
                <div className="relative w-40">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-sm">₹</span>
                  <input
                    type="number"
                    min={0}
                    inputMode="decimal"
                    value={cashTendered}
                    onChange={(e) => setCashTendered(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                    placeholder="0"
                    className="w-full pl-7 pr-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm font-mono font-bold text-slate-900 text-right focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>
              {settlePrevDues && customerOutstanding > 0.009 && (
                <p className="mt-1.5 text-[11px] text-rose-700 font-semibold text-right">
                  Collecting {formatCurrency(collectNowTotal)} (bill {formatCurrency(totals.grandTotal)} + previous dues {formatCurrency(customerOutstanding)})
                </p>
              )}
              {cashTendered !== '' && Number(cashTendered) > 0 && (
                (() => {
                  // Change is against what the customer actually pays at the counter —
                  // the bill plus previous dues when that toggle is on (H3), not just
                  // the bill total (which returned ₹dues too much change).
                  const change = Math.round((Number(cashTendered) - collectNowTotal) * 100) / 100;
                  if (change > 0.009) {
                    return (
                      <div className="mt-2.5 flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-300 text-sm">
                        <span className="font-bold text-emerald-800">Change to return</span>
                        <span className="font-mono font-extrabold text-emerald-700 text-base">{formatCurrency(change)}</span>
                      </div>
                    );
                  }
                  if (change < -0.009) {
                    return (
                      <div className="mt-2.5 flex items-center justify-between px-3 py-2 rounded-lg bg-amber-50 border border-amber-300 text-sm">
                        <span className="font-bold text-amber-800">Short by</span>
                        <span className="font-mono font-extrabold text-amber-700 text-base">{formatCurrency(Math.abs(change))}</span>
                      </div>
                    );
                  }
                  return (
                    <div className="mt-2.5 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-600 text-center">
                      Exact amount — no change to return
                    </div>
                  );
                })()
              )}
            </div>
          )}

          {/* Terms and Conditions Preset Selector */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-700">
                Terms & Conditions Template
              </label>
              <div className="w-52">
                <UniversalDropdown
                  value={termsPresetId}
                  onChange={(v) => handleTermsPresetChange(String(v))}
                  options={INVOICE_TERMS_PRESETS.map((preset) => ({ value: preset.id, label: preset.name }))}
                />
              </div>
            </div>
            <textarea
              rows={3}
              aria-label="Terms and conditions"
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-800 focus:outline-none focus:border-blue-600 font-mono"
            />
          </div>

          {/* Extra Notes & Attachments Accordion */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
            <button
              type="button"
              onClick={() => setIsExtraOpen(!isExtraOpen)}
              className="w-full p-4 flex items-center justify-between text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Paperclip className="h-4 w-4 text-slate-500" />
                <span>Add Description & Attachments</span>
                {attachments.length > 0 && (
                  <span className="text-[11px] bg-blue-100 text-blue-700 px-1.5 py-0.2 rounded font-bold">
                    {attachments.length} attached
                  </span>
                )}
              </div>
              {isExtraOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>

            {isExtraOpen && (
              <div className="p-4 border-t border-slate-100 space-y-4">
                {/* Description */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                    Invoice Remarks / Project Notes
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Optional project notes, purchase order references, etc..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-blue-600"
                  />
                </div>

                {/* Attachments */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                    Add Document / Image Reference
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="e.g. Delivery Challan DC-001.pdf or PO-4501.jpg"
                      value={attachmentInput}
                      onChange={(e) => setAttachmentInput(e.target.value)}
                      className="flex-1 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-blue-600"
                    />
                    <button
                      type="button"
                      onClick={handleAddAttachment}
                      className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
                    >
                      Attach
                    </button>
                  </div>

                  {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {attachments.map((att, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-xs text-slate-700 border border-slate-200"
                        >
                          <Paperclip className="h-3 w-3 text-slate-400" />
                          <span>{att.name}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveAttachment(i)}
                            className="text-slate-400 hover:text-rose-600 ml-1"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column (Span 5): Calculations & Grand Total Panel */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 border-b border-slate-100 pb-2">
            Invoice Summary
          </h3>

          {/* Subtotal */}
          <div className="flex justify-between items-center text-xs text-slate-600">
            <span>Taxable Subtotal:</span>
            <span className="font-mono font-bold text-slate-900 text-sm">
              {formatCurrency(totals.subtotal)}
            </span>
          </div>

          {/* Overall Discount (% or ₹) */}
          <div className="space-y-2 pt-1 border-t border-slate-100">
            {/* Loyalty Milestone Banner if customer is eligible */}
            {selectedCustomerObj && isEligibleForLoyalty && (
              <div className="p-3 rounded-xl bg-linear-to-r from-amber-50 to-orange-50 border border-amber-300 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="p-1 rounded-md bg-amber-500 text-white shrink-0">
                      <Award className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-amber-950 block">
                        Loyalty Milestone Reached!
                      </span>
                      <span className="text-[11px] text-amber-800">
                        Eligible for {loyaltySettings.discountValue}{loyaltySettings.discountType === 'percentage' ? '%' : '₹'} off
                      </span>
                    </div>
                  </div>
                </div>

                {!isLoyaltyRewardApplied ? (
                  <button
                    type="button"
                    onClick={handleApplyLoyaltyReward}
                    className="w-full py-1.5 px-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-1.5"
                  >
                    <Award className="h-3.5 w-3.5" />
                    <span>Apply Loyalty Discount ({loyaltySettings.discountValue}{loyaltySettings.discountType === 'percentage' ? '%' : '₹'})</span>
                  </button>
                ) : (
                  <div className="flex items-center justify-between text-[11px] bg-amber-100/70 text-amber-900 px-2.5 py-1 rounded-md">
                    <span className="font-semibold">Reward applied to discount field</span>
                    <button
                      type="button"
                      onClick={handleRemoveLoyaltyReward}
                      className="text-rose-600 hover:underline font-bold"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>Overall Discount:</span>
              <div className="flex items-center gap-1 w-36">
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder="0"
                  value={overallDiscountValue || ''}
                  onChange={(e) => {
                    setOverallDiscountValue(Number(e.target.value));
                    if (isLoyaltyRewardApplied && Number(e.target.value) === 0) {
                      setIsLoyaltyRewardApplied(false);
                    }
                  }}
                  className="w-full px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono text-right focus:outline-none focus:border-blue-600"
                />
                <button
                  type="button"
                  onClick={() =>
                    setOverallDiscountType(overallDiscountType === '%' ? 'amount' : '%')
                  }
                  className="px-2 py-1 rounded-lg bg-slate-100 text-xs font-bold text-slate-700"
                >
                  {overallDiscountType === '%' ? '%' : '₹'}
                </button>
              </div>
            </div>
            {totals.overallDiscountAmount > 0 && (
              <div className="flex justify-between text-[11px] text-emerald-700 font-semibold">
                <span>Discount Applied:</span>
                <span className="font-mono">- {formatCurrency(totals.overallDiscountAmount)}</span>
              </div>
            )}
            {spendDiscountAutoApplied > 0 && overallDiscountType === '%' && overallDiscountValue === spendDiscountAutoApplied && (
              <div className="flex items-center gap-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 px-2 py-1 rounded-md">
                <Award className="h-3 w-3 shrink-0" />
                <span>Loyalty spend discount {spendDiscountAutoApplied}% auto-applied for this bill amount. Edit the field above to override.</span>
              </div>
            )}
          </div>

          {/* Shipping Charges */}
          <div className="flex items-center justify-between text-xs text-slate-600 pt-1 border-t border-slate-100">
            <span>Shipping / Freight (₹):</span>
            <input
              type="number"
              min="0"
              step="10"
              placeholder="0"
              value={shippingCharges || ''}
              onChange={(e) => setShippingCharges(Number(e.target.value))}
              className="w-36 px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono text-right focus:outline-none focus:border-blue-600"
            />
          </div>

          {/* GST Taxes (If With GST) */}
          {withGst && (
            <div className="space-y-1.5 pt-1 border-t border-slate-100 text-xs text-slate-600">
              {isInterState ? (
                <div className="flex justify-between">
                  <span>IGST Total ({stateOfSupply}):</span>
                  <span className="font-mono font-semibold text-slate-800">
                    {formatCurrency(totals.totalTax)}
                  </span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span>SGST Total:</span>
                    <span className="font-mono font-semibold text-slate-800">
                      {formatCurrency(totals.totalSgst)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>CGST Total:</span>
                    <span className="font-mono font-semibold text-slate-800">
                      {formatCurrency(totals.totalCgst)}
                    </span>
                  </div>
                </>
              )}
              <div className="flex justify-between font-bold text-blue-700">
                <span>Total Tax:</span>
                <span className="font-mono">{formatCurrency(totals.totalTax)}</span>
              </div>

              {/* Tax Slab Breakdown Tags */}
              {gstBreakdown.length > 0 && (
                <div className="bg-slate-50 p-2 rounded-lg border border-slate-200 mt-1 space-y-1 text-[11px]">
                  <span className="font-bold text-slate-500 uppercase tracking-wider block">
                    Tax Breakdown
                  </span>
                  {gstBreakdown.map((row, i) => (
                    <div key={i} className="flex justify-between font-mono text-slate-700">
                      <span>{row.taxType} @ {row.rate}%:</span>
                      <span>{formatCurrency(row.taxAmount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Round Off Toggle */}
          <div className="flex items-center justify-between text-xs text-slate-600 pt-1 border-t border-slate-100">
            <label htmlFor="round-off-toggle" className="cursor-pointer font-medium">
              Round Off Total
            </label>
            <div className="flex items-center gap-2">
              <span className="font-mono text-slate-500 text-[11px]">
                {totals.roundOff > 0 ? `+₹${totals.roundOff}` : `₹${totals.roundOff}`}
              </span>
              <input
                type="checkbox"
                id="round-off-toggle"
                checked={roundOffEnabled}
                onChange={(e) => setRoundOffEnabled(e.target.checked)}
                className="h-4 w-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
              />
            </div>
          </div>

          {/* Grand Total Box (Vyapar Red / Slate for Quotation) */}
          <div className={cn(
            "p-4 rounded-none text-white shadow-none space-y-1 border",
            documentType === 'Quotation' ? "bg-slate-800 border-slate-900" : "bg-red-600 border-red-700"
          )}>
            <div className="flex justify-between items-baseline">
              <span className={cn(
                "text-xs uppercase font-bold tracking-wider",
                documentType === 'Quotation' ? "text-slate-200" : "text-red-100"
              )}>
                Grand Total
              </span>
              <span className="text-xl sm:text-2xl font-bold font-mono">
                {formatCurrency(totals.grandTotal)}
              </span>
            </div>
            <p className={cn(
              "text-[11px]",
              documentType === 'Quotation' ? "text-slate-300" : "text-red-200"
            )}>
              {withGst ? 'All GST taxes included' : 'Net document total (non-tax)'}
            </p>
          </div>

          {/* Customer's remaining balance from earlier bills (Oct-16 note):
              shows what this customer already owes, same as Customers Directory. */}
          {documentType !== 'Quotation' && customerOutstanding > 0.009 && (
            <div className="rounded-none bg-rose-50 border border-rose-300 text-xs divide-y divide-rose-200">
              <div className="flex justify-between items-center px-3 py-2">
                <span className="font-bold text-rose-800">Previous Balance Due (earlier bills)</span>
                <span className="font-mono font-extrabold text-rose-700 text-sm">{formatCurrency(customerOutstanding)}</span>
              </div>
              {/* Toggle: add these old dues to what the customer pays on THIS bill.
                  On save the old bills are settled so the dues aren't counted twice. */}
              <label className="flex items-center justify-between gap-2 px-3 py-2 cursor-pointer select-none">
                <span className="font-semibold text-rose-900">
                  Collect these dues with this bill
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settlePrevDues}
                  onClick={() => setSettlePrevDues((v) => !v)}
                  className={cn(
                    'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
                    settlePrevDues ? 'bg-rose-600' : 'bg-slate-300'
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                      settlePrevDues ? 'translate-x-4' : 'translate-x-0.5'
                    )}
                  />
                </button>
              </label>
            </div>
          )}

          {/* Prominent "collect now" figure when dues are being added — the bill's
              Grand Total above stays the tax-invoice amount; this is the amount
              the customer actually pays at the counter (bill + previous dues). */}
          {documentType !== 'Quotation' && settlePrevDues && customerOutstanding > 0.009 && (
            <div className="p-4 rounded-none bg-rose-700 text-white border border-rose-800 space-y-1">
              <div className="flex justify-between items-baseline">
                <span className="text-xs uppercase font-bold tracking-wider text-rose-100">
                  Total to Collect Now
                </span>
                <span className="text-xl sm:text-2xl font-bold font-mono">
                  {formatCurrency(collectNowTotal)}
                </span>
              </div>
              <p className="text-[11px] text-rose-100">
                This bill {formatCurrency(totals.grandTotal)} + previous dues {formatCurrency(customerOutstanding)}
              </p>
            </div>
          )}

          {/* On-credit breakdown (bug #4): when the customer takes this bill on
              credit (COD-Credit / partial), show how much is paid now and how
              much stays on credit, right in the summary. */}
          {documentType !== 'Quotation' && creditOnBill > 0.009 && (
            <div className="rounded-none border border-amber-300 bg-amber-50 text-xs divide-y divide-amber-200">
              <div className="flex justify-between items-center px-3 py-2">
                <span className="font-bold text-slate-700">Paid now</span>
                <span className="font-mono font-bold text-slate-800">{formatCurrency(paidNow)}</span>
              </div>
              <div className="flex justify-between items-center px-3 py-2">
                <span className="font-bold text-amber-800">On Credit (Balance Due)</span>
                <span className="font-mono font-extrabold text-amber-700 text-sm">{formatCurrency(creditOnBill)}</span>
              </div>
            </div>
          )}

          {/* Customer store credit (#5): shows the credit this customer can spend,
              so the biller can collect it against this bill. */}
          {documentType !== 'Quotation' && selectedCustomerObj && (Number(selectedCustomerObj.creditBalance) || 0) > 0 && (
            <div className="flex justify-between items-center px-3 py-2 rounded-none bg-emerald-50 border border-emerald-300 text-xs">
              <span className="font-bold text-emerald-800">Customer Store Credit available</span>
              <span className="font-mono font-extrabold text-emerald-700 text-sm">
                {formatCurrency(Number(selectedCustomerObj.creditBalance) || 0)}
              </span>
            </div>
          )}

          {/* Amount In Words */}
          <div className="p-3 rounded-none bg-slate-50 border border-slate-300 text-xs">
            <span className="text-[11px] uppercase font-bold text-slate-500 block mb-0.5">
              Amount in Words
            </span>
            <p className="font-bold text-slate-900 italic leading-relaxed">
              {totals.amountInWords}
            </p>
          </div>

          {/* Primary Save Action Button (Vyapar Crimson Red) */}
          <button
            type="button"
            onClick={() => handleSave()}
            disabled={isSaving || (documentType === 'Invoice' && (!isPaymentReconciled || !paymentReceived))}
            className={cn(
              "w-full py-3 rounded-none text-white font-bold text-xs shadow-none border transition-colors flex items-center justify-center gap-2 cursor-pointer",
              documentType === 'Invoice' && !isPaymentReconciled
                ? "bg-slate-400 border-slate-400 cursor-not-allowed opacity-60"
                : documentType === 'Quotation'
                ? "bg-slate-800 hover:bg-slate-900 border-slate-900"
                : "bg-red-600 hover:bg-red-700 border-red-700"
            )}
            title={
              documentType === 'Invoice' && !isPaymentReconciled
                ? `Reconcile payment splits: ${remainingBalance > 0 ? `₹${remainingBalance} remaining` : `₹${Math.abs(remainingBalance)} over`}`
                : undefined
            }
          >
            <Save className="h-4 w-4" />
            <span>{documentType === 'Quotation' ? 'Save Quotation' : 'Save Invoice & Update Inventory'}</span>
          </button>
        </div>
      </div>

      {/* Salesperson — placed at the END of the bill (incentive % is set in Staff Directory) */}
      {documentType !== 'Quotation' && (
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 shadow-xs">
          {!showSalesperson ? (
            <button
              type="button"
              onClick={() => setShowSalesperson(true)}
              className="text-[11px] font-bold text-violet-700 hover:text-violet-900 cursor-pointer"
            >
              + Add Salesperson
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-violet-700 shrink-0">Salesperson</span>
              <div className="w-52">
                <UniversalDropdown
                  value={salespersonId}
                  onChange={(v) => setSalespersonId(String(v))}
                  options={[
                    { value: '', label: 'No salesperson' },
                    // FIN-B-1: the server takes only an active employee of the bill's branch.
                    ...employees.filter((e) => (isActiveEmployee(e) && e.branchId === selectedBranch) || e.id === initialInvoice?.salespersonId)
                      .map((e) => ({ value: e.id, label: e.name, sublabel: e.designation })),
                  ]}
                  placeholder="Select employee…"
                  searchable
                  searchPlaceholder="Type salesperson name…"
                  buttonClassName="w-full px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-900"
                />
              </div>
              <span className="text-[10px] text-slate-400">Incentive % is set in Staff Directory</span>
              {salespersonId && (
                <button
                  type="button"
                  onClick={() => setSalespersonId('')}
                  className="text-[11px] text-slate-400 hover:text-slate-600 ml-1 cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Dispatch / Courier (counter sale) — prints on the GST bill (#5) */}
      {documentType !== 'Quotation' && (
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 shadow-xs">
          {!showDispatch ? (
            <button
              type="button"
              onClick={() => setShowDispatch(true)}
              className="text-[11px] font-bold text-blue-700 hover:text-blue-900 cursor-pointer"
            >
              + Add Dispatch / Courier details
            </button>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700 w-full">Dispatch / Courier</span>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">Courier / Transport</label>
                <input
                  type="text" value={dispatchCourier} onChange={(e) => setDispatchCourier(e.target.value)}
                  placeholder="e.g. DTDC, Professional"
                  className="w-44 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">LR / Docket No.</label>
                <input
                  type="text" value={dispatchDocket} onChange={(e) => setDispatchDocket(e.target.value)}
                  placeholder="Consignment no."
                  className="w-40 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-mono text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">Dispatch Date</label>
                <input
                  type="date" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)}
                  className="w-36 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>
              <button
                type="button"
                onClick={() => { setShowDispatch(false); setDispatchCourier(''); setDispatchDocket(''); setDispatchDate(''); }}
                className="text-[11px] text-slate-400 hover:text-slate-600 pb-1.5 cursor-pointer"
              >
                Remove
              </button>
            </div>
          )}
        </div>
      )}

      {/* Sticky billing total bar — always visible while scrolling (POS feel) */}
      <div className="sticky bottom-0 z-30 bg-white border-t-2 border-slate-300 shadow-[0_-4px_14px_rgba(0,0,0,0.07)] -mx-4 sm:-mx-6 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          <span className={cn(
            'text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-none border shrink-0',
            documentType === 'Quotation' ? 'bg-slate-100 text-slate-700 border-slate-300' : 'bg-red-50 text-red-700 border-red-200'
          )}>
            {documentType === 'Quotation' ? 'Quotation' : 'Tax Invoice'}
          </span>
          <span className="text-xs text-slate-500 font-semibold shrink-0">
            {lineItems.filter((i) => i.itemName.trim()).length} item{lineItems.filter((i) => i.itemName.trim()).length === 1 ? '' : 's'}
          </span>
          <span className="text-slate-300 shrink-0">·</span>
          <span className="text-[11px] uppercase font-bold tracking-wider text-slate-400 shrink-0">
            {documentType !== 'Quotation' && settlePrevDues && customerOutstanding > 0.009 ? 'To Collect' : 'Total Payable'}
          </span>
          <span className="text-xl sm:text-2xl font-bold font-mono text-slate-900 truncate">
            {formatCurrency(documentType !== 'Quotation' && settlePrevDues ? collectNowTotal : totals.grandTotal)}
          </span>
          {documentType !== 'Quotation' && settlePrevDues && customerOutstanding > 0.009 && (
            <span className="text-[11px] text-slate-400 font-semibold shrink-0">
              (bill {formatCurrency(totals.grandTotal)} + dues {formatCurrency(customerOutstanding)})
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => handleSave()}
          disabled={isSaving || (documentType === 'Invoice' && (!isPaymentReconciled || !paymentReceived))}
          className={cn(
            'flex items-center gap-2 px-5 py-2.5 rounded-none text-white font-bold text-xs border transition-colors shrink-0 cursor-pointer',
            documentType === 'Invoice' && !isPaymentReconciled
              ? 'bg-slate-400 border-slate-400 cursor-not-allowed opacity-60'
              : documentType === 'Quotation'
              ? 'bg-slate-800 hover:bg-slate-900 border-slate-900'
              : 'bg-red-600 hover:bg-red-700 border-red-700'
          )}
          title={
            documentType === 'Invoice' && !isPaymentReconciled
              ? `Reconcile payment splits: ${remainingBalance > 0 ? `₹${remainingBalance} remaining` : `₹${Math.abs(remainingBalance)} over`}`
              : undefined
          }
        >
          <Save className="h-4 w-4" />
          <span>{documentType === 'Quotation' ? 'Save Quotation' : 'Save Invoice & Update Inventory'}</span>
        </button>
      </div>
    </div>
  );
};
