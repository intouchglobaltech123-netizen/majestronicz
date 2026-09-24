import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useErp } from '../../context/ErpContext';
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
  EstimateLineItem,
  GstBreakdownRow,
  ComboItem,
  isLoyaltyMilestoneEligible,
  cleanCustomerName,
  PaymentSplit,
  getInvoicePaymentSplits,
} from '../../types';
import {
  calculateLineTax,
  calculateTaxBreakdown,
  calculateInvoiceTotals,
} from '../../lib/taxCalculations';
import { formatCurrency, cn, getTodayDateString } from '../../lib/utils';
import {
  Plus,
  Trash2,
  Save,
  Printer,
  MapPin,
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
} from 'lucide-react';
import { toast } from 'sonner';
import { ItemSearchDropdown } from '../common/ItemSearchDropdown';
import { UniversalDropdown } from '../common/UniversalDropdown';
import { PhoneInput } from '../common/PhoneInput';

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
  /** Save the current document as a work-in-progress draft (not committed). */
  onSaveDraft?: (doc: Invoice | Estimate, kind: 'Invoice' | 'Quotation') => void;
  /** True when this bill tab is the one on screen (enables the global scanner). */
  isActive?: boolean;
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
  onSaveDraft,
}) => {
  const {
    currentBranch,
    isAllBranches,
    getNextInvoiceNumber,
    saveInvoice,
    getNextEstimateNumber,
    saveEstimate,
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
  } = useErp();

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

  // A new/unknown 10-digit mobile prompts a small "add customer" card.
  const [showNewCustomerPrompt, setShowNewCustomerPrompt] = useState(false);

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
    const match = customers.find((c) => (c.phone || '').replace(/\D/g, '') === clean);
    if (match) {
      setCustomerId(match.id);
      setCustomerName(cleanCustomerName(match.name, match.notes));
      setCustomerAddress(match.address || '');
      setShowNewCustomerPrompt(false);
    } else {
      setShowNewCustomerPrompt(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerPhone, customers]);

  // Save the typed mobile + name/address as a new customer master record.
  const handleQuickAddCustomer = () => {
    if (!customerName.trim()) { toast.error('Enter a name for the new customer'); return; }
    const res = saveCustomer({
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
  // Salesperson incentive — manually assigned per bill.
  const [salespersonId, setSalespersonId] = useState<string>(initialInvoice?.salespersonId || '');
  const [incentivePercent, setIncentivePercent] = useState<number>(initialInvoice?.incentivePercent || 0);

  // GST Toggle
  const [withGst, setWithGst] = useState(true);

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
        // Centre the newly added row in the editor viewport (not pinned to the bottom edge).
        const rows = el.querySelectorAll<HTMLElement>('[data-line-row]');
        const row = rows[rows.length - 1];
        if (row) {
          const cRect = el.getBoundingClientRect();
          const rRect = row.getBoundingClientRect();
          const delta = (rRect.top - cRect.top) - el.clientHeight / 2 + row.offsetHeight / 2;
          el.scrollTop += delta;
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

  // Overall Discount & Shipping
  const [overallDiscountType, setOverallDiscountType] = useState<DiscountType>('%');
  const [overallDiscountValue, setOverallDiscountValue] = useState<number>(0);
  const [shippingCharges, setShippingCharges] = useState<number>(0);
  const [roundOffEnabled, setRoundOffEnabled] = useState(true);

  // Terms and conditions
  const [termsPresetId, setTermsPresetId] = useState('sale-invoice-default');
  const [terms, setTerms] = useState(INVOICE_TERMS_PRESETS[0].terms);

  // Additional fields accordion
  const [isExtraOpen, setIsExtraOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState<{ name: string; size?: string }[]>([]);
  const [attachmentInput, setAttachmentInput] = useState('');

  // Track if converted from an estimate or enquiry
  const [sourceEstimateId, setSourceEstimateId] = useState<string | undefined>(
    initialInvoice?.sourceEstimateId || convertedFromEstimate?.id
  );
  const [sourceEstimateNumber, setSourceEstimateNumber] = useState<string | undefined>(
    initialInvoice?.sourceEstimateNumber || convertedFromEstimate?.estimateNumber
  );
  const [sourceEnquiryId, setSourceEnquiryId] = useState<string | undefined>(
    initialInvoice?.sourceEnquiryId || convertedFromEstimate?.sourceEnquiryId
  );
  const [sourceEnquiryNumber, setSourceEnquiryNumber] = useState<string | undefined>(
    initialInvoice?.sourceEnquiryNumber || convertedFromEstimate?.sourceEnquiryNumber
  );

  // Keep the (now-hidden) due date sensible from payment terms + invoice date.
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
      setTerms(convertedFromEstimate.termsAndConditions);
      setSourceEstimateId(convertedFromEstimate.id);
      setSourceEstimateNumber(convertedFromEstimate.estimateNumber);
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
        const discType = estItem.discountType || '%';
        const discVal = estItem.discount || estItem.discountValue || 0;
        const rate = estItem.gstRate ?? estItem.taxRate ?? 0;
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
          itemId: estItem.itemId,
          itemName: estItem.itemName,
          itemHSN: estItem.itemHSN,
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
      toast.info(`Pre-filled from Estimate ${convertedFromEstimate.estimateNumber}`, {
        description: 'All customer details, items, and pricing loaded. Review and save.',
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
          itemCode: estItem.itemCode || '',
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
      setTerms(duplicateSourceEstimate.termsAndConditions || INVOICE_TERMS_PRESETS[0].terms);
      setOverallDiscountType(duplicateSourceEstimate.overallDiscountType || '%');
      setOverallDiscountValue(duplicateSourceEstimate.overallDiscountValue || 0);
      setShippingCharges(duplicateSourceEstimate.shippingCharges || 0);
      setRoundOffEnabled(duplicateSourceEstimate.roundOffEnabled ?? true);

      const dupQuoteItems: InvoiceLineItem[] = duplicateSourceEstimate.items.map((estItem) => {
        const discType = estItem.discountType || '%';
        const discVal = estItem.discount || estItem.discountValue || 0;
        const rate = estItem.gstRate ?? estItem.taxRate ?? 0;
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
          itemCode: estItem.itemCode || '',
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
      setLineItems(dupQuoteItems);

      const generated = getNextEstimateNumber(duplicateSourceEstimate.branchId, getTodayDateString());
      setInvoiceNumber(generated);
      toast.info(`Duplicated from Quotation #${duplicateSourceEstimate.estimateNumber}`, {
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
      const duplicatedItems: InvoiceLineItem[] = duplicateSourceInvoice.items.map((item) => ({
        ...item,
        id: `li-dup-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      }));
      setLineItems(duplicatedItems);

      const generated = getNextInvoiceNumber(duplicateSourceInvoice.branchId);
      setInvoiceNumber(generated);
      toast.info(`Duplicated from Invoice #${duplicateSourceInvoice.invoiceNumber}`, {
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
  const getItemPreTaxPrice = (item: Item): number => {
    const base =
      isWholesaleCustomer && item.wholesalePrice > 0 ? item.wholesalePrice : item.salePrice;
    const pre =
      item.salePriceTaxMode === 'with' ? base / (1 + item.gstTaxSlab / 100) : base;
    return Math.round(pre * 100) / 100;
  };

  // The freshly-added blank row whose item search should auto-focus (POS-style).
  const [focusRowId, setFocusRowId] = useState<string | null>(null);
  // Salesperson/incentive is hidden by default to keep the billing header minimal.
  const [showSalesperson, setShowSalesperson] = useState(false);

  const addNewRow = (selectedItem?: Item) => {
    const newId = `li-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    let newRow: InvoiceLineItem;

    if (selectedItem) {
      const roundedPrice = getItemPreTaxPrice(selectedItem);
      const calculated = calculateLineTax(1, roundedPrice, selectedItem.gstTaxSlab, withGst);

      newRow = {
        id: newId,
        itemId: selectedItem.id,
        itemCode: selectedItem.itemCode,
        itemName: selectedItem.itemName,
        itemHSN: selectedItem.itemHSN,
        quantity: 1,
        unit: selectedItem.unit,
        unitPrice: roundedPrice,
        discountType: '%',
        discountValue: 0,
        discountAmount: 0,
        taxRate: selectedItem.gstTaxSlab,
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
        const dVal = Number(merged.discountValue) || 0;

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

    const roundedPrice = getItemPreTaxPrice(item);

    updateLineItem(rowId, {
      itemId: item.id,
      itemCode: item.itemCode,
      itemName: item.itemName,
      itemHSN: item.itemHSN,
      unit: item.unit,
      unitPrice: roundedPrice,
      taxRate: isBulkTaxOpen ? bulkTaxRate : item.gstTaxSlab,
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

    updateLineItem(rowId, {
      itemId: combo.id,
      itemCode: combo.comboCode,
      itemName: combo.comboName,
      itemHSN: '85371000',
      unit: 'SET',
      unitPrice: combo.comboPrice,
      taxRate: isBulkTaxOpen ? bulkTaxRate : 18,
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
    const calc = calculateLineTax(1, combo.comboPrice, rate, withGst);
    setLineItems((prev) => [
      ...prev,
      {
        id: newId, itemId: combo.id, itemCode: combo.comboCode, itemName: combo.comboName,
        itemHSN: '85371000', quantity: 1, unit: 'SET', unitPrice: combo.comboPrice,
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
    setWithGst(newWithGst);
    setLineItems((prev) =>
      prev.map((item) => {
        const calculated = calculateLineTax(
          item.quantity,
          item.unitPrice,
          item.taxRate,
          newWithGst,
          item.discountType,
          item.discountValue
        );
        return {
          ...item,
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
    return calculateInvoiceTotals(
      lineItems,
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

  // GST rate breakdown
  const gstBreakdown = useMemo((): GstBreakdownRow[] => {
    if (!withGst) return [];
    return calculateTaxBreakdown(lineItems, totals.overallDiscountAmount, totals.subtotal);
  }, [lineItems, withGst, totals.overallDiscountAmount, totals.subtotal]);

  // Remaining balance due calculation for Partial Payment
  const balanceDue = useMemo(() => {
    if (!isPartialPayment) return 0;
    const pAmt = Number(partialAmount) || 0;
    return Math.max(0, totals.grandTotal - pAmt);
  }, [isPartialPayment, partialAmount, totals.grandTotal]);

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

  // Is payment reconciled exactly to 0 remaining?
  const isPaymentReconciled = useMemo(() => {
    if (documentType !== 'Invoice') return true;
    if (paymentSplits.length <= 1) return true;
    return Math.abs(remainingBalance) < 0.01;
  }, [documentType, paymentSplits.length, remainingBalance]);

  // Split management handlers
  const handleAddSplit = () => {
    setPaymentSplits((prev) => {
      const usedModes = new Set(prev.map((s) => s.mode));
      const allModes: PaymentMode[] = ['Cash', 'GPay', 'HDFC', 'COD-Credit'];
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
  const assembleInvoiceObject = (): Invoice | null => {
    // Customer name is optional — a phone-only walk-in bill is fine.
    const validItems = lineItems.filter((i) => i.itemName.trim() && i.quantity > 0);
    if (validItems.length === 0) {
      toast.error('At least one valid item is required', {
        description: 'Please enter a product description and quantity > 0.',
      });
      return null;
    }

    // Validate split payment reconciliation
    if (documentType === 'Invoice' && paymentSplits.length > 1 && !isPaymentReconciled) {
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
      id: initialInvoice ? initialInvoice.id : `inv-${Date.now()}`,
      invoiceNumber,
      branchId: selectedBranch,
      transactionType,
      customerId: customerId || selectedCustomerObj?.id,
      customerName: customerName.trim() ? cleanCustomerName(customerName) : 'Walk-in Customer',
      customerPhone: customerPhone.trim() || undefined,
      customerAddress: customerAddress.trim() || undefined,
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
      // Salesperson incentive (₹ computed & stored at save time).
      salespersonId: salespersonId || undefined,
      salespersonName: salespersonId ? employees.find((e) => e.id === salespersonId)?.name : undefined,
      incentivePercent: salespersonId && incentivePercent > 0 ? incentivePercent : undefined,
      incentiveAmount: salespersonId && incentivePercent > 0 ? Math.round(totals.grandTotal * incentivePercent) / 100 : undefined,
      termsAndConditions: terms,
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
  const assembleEstimateObject = (): Estimate | null => {
    // Customer name optional here too (phone-first entry).

    const validItems = lineItems.filter((i) => i.itemName.trim() && i.quantity > 0);
    if (validItems.length === 0) {
      toast.error('At least one valid item is required', {
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
      createdAt: initialEstimate ? initialEstimate.createdAt : new Date().toISOString(),
    };

    return newEstimate;
  };

  const handleSave = async () => {
    if (documentType === 'Quotation') {
      const est = assembleEstimateObject();
      if (!est) return;
      // Use the server-saved estimate (authoritative number) for the preview,
      // not the provisional one — saveEstimate emits its own success toast.
      const saved = await saveEstimate(est);
      if (onSavedEstimate) {
        onSavedEstimate(saved);
      }
    } else {
      const inv = assembleInvoiceObject();
      if (!inv) return;
      saveInvoice(inv);
      onSaved(inv);
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

  const handleSaveDraft = () => {
    if (!onSaveDraft) return;
    if (documentType === 'Quotation') {
      const est = assembleEstimateObject();
      if (!est) return;
      onSaveDraft(est, 'Quotation');
      toast.success('Quotation saved to drafts', {
        description: 'Find it under "Saved Quotes" to resume or finalize later.',
      });
    } else {
      const inv = assembleInvoiceObject();
      if (!inv) return;
      onSaveDraft(inv, 'Invoice');
      toast.success('Sale saved to drafts', {
        description: 'Find it under "Saved Sales" to resume or finalize later.',
      });
    }
  };

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
                onChange={(val) => setTransactionType(val as TransactionType)}
              />
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
              disabled={!isAllBranches && currentBranch !== 'all'}
              className="bg-slate-50 border border-slate-200 rounded-none px-2 py-1 text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-600 disabled:opacity-70 cursor-pointer"
            >
              {BRANCHES.map((b) => (
                <option key={b.id} value={b.id}>{b.shortCode}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="uppercase font-bold text-slate-400">{documentType === 'Quotation' ? 'Quote No' : 'Inv No'}</span>
            <span className="relative">
              <input
                type="text"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                className={cn(
                  'w-36 pr-9 pl-2 py-1 rounded-none text-xs font-mono font-bold focus:outline-none',
                  documentType === 'Quotation'
                    ? 'bg-purple-50/60 border border-purple-200 text-purple-800 focus:border-purple-600'
                    : 'bg-blue-50/60 border border-blue-200 text-blue-800 focus:border-blue-600'
                )}
              />
              <span className={cn(
                'absolute right-1 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase px-1 rounded',
                documentType === 'Quotation' ? 'text-purple-600 bg-purple-100/70' : 'text-blue-600 bg-blue-100/70'
              )}>Auto</span>
            </span>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="uppercase font-bold text-slate-400">Date</span>
            <input
              type="date"
              value={date}
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
          >
            <Printer className="h-3.5 w-3.5 text-slate-500" />
            <span>Preview PDF</span>
          </button>

          {onSaveDraft && (
            <button
              type="button"
              onClick={handleSaveDraft}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-none transition-colors shadow-none cursor-pointer"
              title="Park this as a draft to finish later (does not commit stock or a final number)"
            >
              <Save className="h-3.5 w-3.5 text-amber-600" />
              <span>Save Draft</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={documentType === 'Invoice' && !isPaymentReconciled}
            className={cn(
              "flex items-center gap-2 px-5 py-2 text-xs font-bold text-white rounded-none border transition-colors shadow-none cursor-pointer",
              documentType === 'Invoice' && !isPaymentReconciled
                ? "bg-slate-400 border-slate-500 cursor-not-allowed opacity-60"
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
            <Save className="h-3.5 w-3.5" />
            <span>{documentType === 'Quotation' ? 'Save Quotation' : 'Save Invoice & Update Inventory'}</span>
          </button>
        </div>
      </div>

      {/* Main Invoice Form Header Details Card */}
      <div className="bg-white border border-slate-200 rounded-none p-3 shadow-none space-y-2.5">
        {/* Mobile-first customer line: type the mobile → name + address show small */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-52 shrink-0">
            <PhoneInput
              placeholder="Customer mobile no."
              value={customerPhone}
              onChange={setCustomerPhone}
              size="sm"
            />
          </div>
          {/* Name — auto-filled & locked when the number matches a saved customer */}
          <input
            type="text"
            value={selectedCustomerObj ? selectedCustomerObj.name : customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            readOnly={!!selectedCustomerObj}
            placeholder="Name (optional)"
            className={cn(
              'w-48 px-2.5 py-1.5 rounded-lg border text-xs font-semibold text-slate-900 placeholder-slate-400 focus:outline-none',
              selectedCustomerObj
                ? 'bg-slate-100 border-slate-200 cursor-default'
                : 'bg-slate-50 border-slate-200 focus:border-blue-600'
            )}
          />
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
          {selectedCustomerObj && (
            <button
              type="button"
              onClick={() => { setCustomerId(undefined); setCustomerName(''); setCustomerPhone(''); setCustomerAddress(''); setShowNewCustomerPrompt(false); }}
              className="shrink-0 text-[10px] font-bold text-slate-500 hover:text-red-600 cursor-pointer"
              title="Change customer"
            >
              Change
            </button>
          )}

          {/* GST toggle */}
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
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
              onClick={() => setShowNewCustomerPrompt(false)}
              className="px-2.5 py-1.5 rounded-md bg-white hover:bg-slate-100 text-slate-600 text-xs font-semibold border border-slate-300 transition-colors"
              title="Bill without saving (walk-in)"
            >
              Skip
            </button>
          </div>
        )}

        {/* Salesperson & incentive — collapsible, off by default (minimal header) */}
        {documentType !== 'Quotation' && (
          !showSalesperson ? (
            <button
              type="button"
              onClick={() => setShowSalesperson(true)}
              className="text-[11px] font-bold text-violet-700 hover:text-violet-900 cursor-pointer"
            >
              + Salesperson &amp; incentive
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
                    ...employees.filter((e) => e.status === 'Active').map((e) => ({ value: e.id, label: e.name, sublabel: e.designation })),
                  ]}
                  placeholder="Select employee…"
                  buttonClassName="w-full px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-900"
                />
              </div>
              {salespersonId && (
                <>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-violet-700 ml-1">Incentive</span>
                  <div className="relative w-20">
                    <input
                      type="number" min={0} max={100} step={0.5}
                      value={incentivePercent || ''}
                      onChange={(e) => setIncentivePercent(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                      placeholder="0"
                      className="w-full pr-6 pl-2 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-bold font-mono text-slate-900 focus:outline-none focus:border-violet-500"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">%</span>
                  </div>
                  <span className="text-xs font-bold font-mono text-violet-800">
                    = {formatCurrency(incentivePercent > 0 ? Math.round(totals.grandTotal * incentivePercent) / 100 : 0)}
                  </span>
                </>
              )}
              <button
                type="button"
                onClick={() => { setShowSalesperson(false); setSalespersonId(''); setIncentivePercent(0); }}
                className="text-[11px] text-slate-400 hover:text-slate-600 ml-1 cursor-pointer"
              >
                Remove
              </button>
            </div>
          )
        )}
      </div>

      {/* LINE ITEMS TABLE CARD */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        {/* Line Items Table */}
        {/* Resizable item editor — drag the bottom edge to grow/shrink (the product
            search opens in a portal, so it is never clipped by this scroll area). */}
        <div ref={itemScrollRef} className="overflow-auto resize-y min-h-[280px] max-h-[75vh] pb-4">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-600 font-bold uppercase text-[11px] tracking-wider">
                <th className="py-3 px-3 w-10 text-center">#</th>
                <th className="py-3 px-3 min-w-[240px]">Item Description / Search Catalog</th>
                <th className="py-3 px-3 w-28">Location</th>
                <th className="py-3 px-3 w-20">Qty</th>
                <th className="py-3 px-3 w-20">Unit</th>
                <th className="py-3 px-3 w-28 text-right">Price/Unit (₹)</th>
                <th className="py-3 px-3 w-28 text-right">Discount</th>
                {withGst && (
                  <>
                    <th className="py-3 px-3 w-20 text-right">Tax Rate</th>
                    <th className="py-3 px-3 w-24 text-right">Tax (₹)</th>
                  </>
                )}
                <th className="py-3 px-3 w-28 text-right">Amount (₹)</th>
                <th className="py-3 px-3 w-10 text-center"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {lineItems.map((item, idx) => {
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
                    <td className="py-2.5 px-3 relative" style={{ zIndex: lineItems.length - idx + 20 }}>
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
                        lockOutOfStock={true}
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

                    {/* Branch Rack Location */}
                    <td className="py-2.5 px-3">
                      {(() => {
                        const stock = branchStocks.find(
                          (s) => s.itemId === item.itemId && s.branchId === selectedBranch
                        );
                        const loc = stock?.location?.trim();
                        return (
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border max-w-[130px] truncate',
                              loc
                                ? 'bg-amber-50 text-amber-800 border-amber-200 font-mono'
                                : 'bg-slate-50 text-slate-400 border-slate-200'
                            )}
                            title={loc ? `Shelf/Rack Location: ${loc}` : 'No rack assigned'}
                          >
                            <MapPin className="h-3 w-3 shrink-0 text-amber-600/70" />
                            <span className="truncate">{loc || '—'}</span>
                          </span>
                        );
                      })()}
                    </td>

                    {/* Quantity */}
                    <td className="py-2.5 px-3">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={item.quantity}
                        onChange={(e) => updateLineItem(item.id, { quantity: Number(e.target.value) })}
                        onKeyDown={(e) => {
                          // Real-billing shortcut: Enter on the last row's qty adds a fresh item row.
                          if (e.key === 'Enter' && item.itemName.trim() && idx === lineItems.length - 1) {
                            e.preventDefault();
                            addNewRow();
                          }
                        }}
                        className="w-full px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-bold text-slate-900 text-right focus:outline-none focus:border-blue-600 font-mono"
                      />
                    </td>

                    {/* Unit */}
                    <td className="py-2.5 px-3">
                      <input
                        type="text"
                        value={item.unit}
                        onChange={(e) => updateLineItem(item.id, { unit: e.target.value.toUpperCase() })}
                        className="w-full px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 uppercase focus:outline-none focus:border-blue-600 font-mono"
                      />
                    </td>

                    {/* Price/Unit (Pre-tax, Editable Override) */}
                    <td className="py-2.5 px-3">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unitPrice}
                        onChange={(e) => updateLineItem(item.id, { unitPrice: Number(e.target.value) })}
                        readOnly={!hasFlag('bill.editPrice')}
                        className={`w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-900 text-right focus:outline-none focus:border-blue-600 font-mono ${hasFlag('bill.editPrice') ? 'bg-slate-50' : 'bg-slate-100 cursor-not-allowed'}`}
                        title={hasFlag('bill.editPrice') ? 'Override price for this invoice. Never mutates catalog.' : 'Price editing is not permitted for your role.'}
                      />
                    </td>

                    {/* Discount (% or Amount) */}
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          placeholder="0"
                          value={item.discountValue || ''}
                          onChange={(e) =>
                            updateLineItem(item.id, { discountValue: Number(e.target.value) })
                          }
                          disabled={!hasFlag('bill.giveDiscount')}
                          title={hasFlag('bill.giveDiscount') ? undefined : 'Discounts are not permitted for your role.'}
                          className={`w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-mono text-right focus:outline-none focus:border-blue-600 ${hasFlag('bill.giveDiscount') ? 'bg-slate-50' : 'bg-slate-100 cursor-not-allowed'}`}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            updateLineItem(item.id, {
                              discountType: item.discountType === '%' ? 'amount' : '%',
                            })
                          }
                          className="px-1.5 py-1 text-[11px] font-bold rounded bg-slate-100 hover:bg-slate-200 text-slate-600 shrink-0"
                          title="Toggle % or ₹"
                        >
                          {item.discountType === '%' ? '%' : '₹'}
                        </button>
                      </div>
                    </td>

                    {/* Tax Rate & Amount (With GST only) */}
                    {withGst && (
                      <>
                        <td className="py-2.5 px-3">
                          <select
                            value={item.taxRate}
                            onChange={(e) => updateLineItem(item.id, { taxRate: Number(e.target.value) })}
                            className="w-full px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono text-right focus:outline-none focus:border-blue-600"
                          >
                            <option value="0">0%</option>
                            <option value="5">5%</option>
                            <option value="12">12%</option>
                            <option value="18">18%</option>
                            <option value="28">28%</option>
                          </select>
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

                    {/* Delete Row */}
                    <td className="py-2.5 px-3 text-center">
                      <button
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
          <button
            type="button"
            onClick={() => addNewRow()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-blue-700 text-xs font-bold border border-slate-200 shadow-2xs transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Row</span>
          </button>
          <span className="text-xs text-slate-500">
            {lineItems.length} item{lineItems.length === 1 ? '' : 's'} in invoice
          </span>
        </div>
      </div>

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

              {/* SINGLE MODE VIEW (Default / Common Case) */}
              {paymentSplits.length <= 1 ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <UniversalDropdown
                        options={[
                          { value: 'Cash', label: 'Cash' },
                          { value: 'HDFC', label: 'HDFC (Bank Transfer)' },
                          { value: 'GPay', label: 'GPay (UPI/QR)' },
                          { value: 'COD-Credit', label: 'COD-Credit (Pay on Delivery)' },
                        ]}
                        value={paymentSplits[0]?.mode || 'Cash'}
                        onChange={(val) =>
                          setPaymentSplits([{ mode: val as PaymentMode, amount: totals.grandTotal }])
                        }
                      />
                    </div>
                    <div className="w-36 text-right px-3 py-2 bg-slate-50 rounded-xl border border-slate-200">
                      <span className="text-[11px] text-slate-400 font-semibold block uppercase">Amount</span>
                      <span className="font-mono font-bold text-slate-800 text-xs">
                        {formatCurrency(totals.grandTotal)}
                      </span>
                    </div>
                  </div>

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
                            options={[
                              { value: 'Cash', label: 'Cash' },
                              { value: 'HDFC', label: 'HDFC (Bank Transfer)' },
                              { value: 'GPay', label: 'GPay (UPI/QR)' },
                              { value: 'COD-Credit', label: 'COD-Credit' },
                            ]}
                            value={split.mode}
                            onChange={(val) => handleUpdateSplitMode(index, val as PaymentMode)}
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
                      <span>₹{row.taxAmount.toFixed(2)}</span>
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
            onClick={handleSave}
            disabled={documentType === 'Invoice' && !isPaymentReconciled}
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
          <span className="text-[11px] uppercase font-bold tracking-wider text-slate-400 shrink-0">Total Payable</span>
          <span className="text-xl sm:text-2xl font-bold font-mono text-slate-900 truncate">
            {formatCurrency(totals.grandTotal)}
          </span>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={documentType === 'Invoice' && !isPaymentReconciled}
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
