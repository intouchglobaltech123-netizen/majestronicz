import React, { useState, useEffect, useMemo } from 'react';
import { useErp } from '../../context/ErpContext';
import {
  Item,
  Invoice,
  InvoiceLineItem,
  TransactionType,
  PaymentMode,
  BranchId,
  BRANCHES,
  INDIAN_STATES,
  INVOICE_TERMS_PRESETS,
  DiscountType,
  Estimate,
  GstBreakdownRow,
  ComboItem,
  isLoyaltyMilestoneEligible,
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
  Calendar,
  Clock,
  Phone,
  MapPin,
  FileText,
  Paperclip,
  ChevronDown,
  ChevronUp,
  Share2,
  Link,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { ItemSearchDropdown } from '../common/ItemSearchDropdown';
import { UniversalDropdown } from '../common/UniversalDropdown';
import { CustomerSearchSelect } from '../common/CustomerSearchSelect';

interface Props {
  onSaved: (invoice: Invoice) => void;
  onPreviewPdf: (invoice: Invoice) => void;
  initialInvoice?: Invoice | null;
  convertedFromEstimate?: Estimate | null;
  onCancel?: () => void;
}

export const InvoiceForm: React.FC<Props> = ({
  onSaved,
  onPreviewPdf,
  initialInvoice,
  convertedFromEstimate,
  onCancel,
}) => {
  const {
    currentBranch,
    isAllBranches,
    getNextInvoiceNumber,
    saveInvoice,
    branchStocks,
    getComboAvailability,
    paymentTermsOptions,
    addPaymentTerm,
    customers,
    loyaltySettings,
  } = useErp();

  // Branch Selection
  const [selectedBranch, setSelectedBranch] = useState<BranchId>(() => {
    if (initialInvoice) return initialInvoice.branchId;
    if (convertedFromEstimate) return convertedFromEstimate.branchId;
    if (!isAllBranches && currentBranch !== 'all') return currentBranch as BranchId;
    return 'erode-hq';
  });

  // Bill Type dropdown (Cash Sale / Credit Bill) - default to Cash Sale
  const [transactionType, setTransactionType] = useState<TransactionType>(() => {
    return initialInvoice ? initialInvoice.transactionType : 'Cash';
  });

  // Invoice Number
  const [invoiceNumber, setInvoiceNumber] = useState('');

  // Date & Time
  const [date, setDate] = useState(() => initialInvoice?.date || getTodayDateString());
  const [time, setTime] = useState(() => {
    if (initialInvoice?.time) return initialInvoice.time;
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });

  // Customer & Loyalty Details
  const [customerId, setCustomerId] = useState<string | undefined>(
    initialInvoice?.customerId || convertedFromEstimate?.customerId
  );
  const [customerName, setCustomerName] = useState(() => initialInvoice?.customerName || convertedFromEstimate?.customerName || '');
  const [customerPhone, setCustomerPhone] = useState(() => initialInvoice?.customerPhone || convertedFromEstimate?.customerContact || '');
  const [customerAddress, setCustomerAddress] = useState(() => initialInvoice?.customerAddress || convertedFromEstimate?.customerAddress || '');
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

  const isEligibleForLoyalty = useMemo(() => {
    if (!selectedCustomerObj) return false;
    return isLoyaltyMilestoneEligible(selectedCustomerObj, loyaltySettings, true);
  }, [selectedCustomerObj, loyaltySettings]);

  const handleApplyLoyaltyReward = () => {
    if (!loyaltySettings.isActive || !selectedCustomerObj) return;
    setOverallDiscountType(loyaltySettings.discountType === 'percentage' ? '%' : 'amount');
    setOverallDiscountValue(loyaltySettings.discountValue);
    setIsLoyaltyRewardApplied(true);
    toast.success('🎉 Loyalty milestone discount applied!', {
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

  // GST Toggle
  const [withGst, setWithGst] = useState(true);

  // Line Items
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([]);

  // Payment Mode (Connected to Daily Cash Register) - default to Cash
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(() => {
    return initialInvoice?.paymentMode || 'Cash';
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

  // Update Due Date when Payment Terms or Invoice Date changes
  const handlePaymentTermsChange = (newTerms: string) => {
    setPaymentTerms(newTerms);
    const matched = paymentTermsOptions.find((t) => t.value === newTerms);
    if (matched && matched.days > 0) {
      const parts = date.split('-').map(Number);
      const d = new Date(parts[0], parts[1] - 1, parts[2]);
      d.setDate(d.getDate() + matched.days);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      setDueDate(`${y}-${m}-${day}`);
    } else if (newTerms !== 'Custom') {
      setDueDate(date);
    }
  };

  // Sync date changes with due date if not custom
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
      setPaymentMode(initialInvoice.paymentMode || 'Cash');
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

      // Map Estimate line items to Invoice line items
      const convertedItems: InvoiceLineItem[] = convertedFromEstimate.items.map((estItem) => {
        const lineTax = calculateLineTax(
          estItem.quantity,
          estItem.unitPrice,
          estItem.gstRate,
          convertedFromEstimate.withGst
        );
        return {
          id: `li-conv-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          itemId: estItem.itemId,
          itemName: estItem.itemName,
          itemHSN: estItem.itemHSN,
          unit: estItem.unit,
          quantity: estItem.quantity,
          unitPrice: estItem.unitPrice,
          discountType: '%',
          discountValue: 0,
          discountAmount: 0,
          taxRate: estItem.gstRate,
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
    } else {
      // Fresh new invoice
      const generated = getNextInvoiceNumber(selectedBranch);
      setInvoiceNumber(generated);
      setTransactionType('Cash');
      setPaymentMode('Cash');
    }
  }, [selectedBranch, initialInvoice, convertedFromEstimate, getNextInvoiceNumber]);

  // Ensure at least one row exists
  useEffect(() => {
    if (lineItems.length === 0 && !initialInvoice && !convertedFromEstimate) {
      addNewRow();
    }
  }, [lineItems.length, initialInvoice, convertedFromEstimate]);

  const addNewRow = (selectedItem?: Item) => {
    const newId = `li-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    let newRow: InvoiceLineItem;

    if (selectedItem) {
      const preTaxPrice =
        selectedItem.salePriceTaxMode === 'with'
          ? selectedItem.salePrice / (1 + selectedItem.gstTaxSlab / 100)
          : selectedItem.salePrice;

      const roundedPrice = Math.round(preTaxPrice * 100) / 100;
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
        taxRate: 18,
        taxableAmount: 0,
        cgstAmount: 0,
        sgstAmount: 0,
        totalTax: 0,
        totalAmount: 0,
      };
    }

    setLineItems((prev) => [...prev, newRow]);
  };

  const updateLineItem = (id: string, updates: Partial<InvoiceLineItem>) => {
    setLineItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;

        const merged = { ...item, ...updates };
        const qty = Number(merged.quantity) || 0;
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
    if (availableQty <= 0) {
      toast.error('Out of stock at this branch', {
        description: `"${item.itemName}" has 0 available stock at ${BRANCHES.find((b) => b.id === selectedBranch)?.name || 'this branch'}.`,
      });
      return;
    }

    const preTaxPrice =
      item.salePriceTaxMode === 'with'
        ? item.salePrice / (1 + item.gstTaxSlab / 100)
        : item.salePrice;

    const roundedPrice = Math.round(preTaxPrice * 100) / 100;

    updateLineItem(rowId, {
      itemId: item.id,
      itemCode: item.itemCode,
      itemName: item.itemName,
      itemHSN: item.itemHSN,
      unit: item.unit,
      unitPrice: roundedPrice,
      taxRate: item.gstTaxSlab,
      isCombo: false,
      comboId: undefined,
      comboComponents: undefined,
    });
  };

  const selectComboForRow = (rowId: string, combo: ComboItem) => {
    const availQty = getComboAvailability(combo, selectedBranch);
    if (availQty <= 0) {
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
      taxRate: 18,
      isCombo: true,
      comboId: combo.id,
      comboComponents: combo.components,
    });
  };

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
    return calculateTaxBreakdown(lineItems);
  }, [lineItems, withGst]);

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

  // Build the complete invoice object
  const assembleInvoiceObject = (): Invoice | null => {
    if (!customerName.trim()) {
      toast.error('Customer name is required', {
        description: 'Please specify the customer or organization for this invoice.',
      });
      return null;
    }

    const validItems = lineItems.filter((i) => i.itemName.trim() && i.quantity > 0);
    if (validItems.length === 0) {
      toast.error('At least one valid item is required', {
        description: 'Please enter a product description and quantity > 0.',
      });
      return null;
    }

    if (isPartialPayment && (partialAmount <= 0 || partialAmount > totals.grandTotal)) {
      toast.error('Invalid partial payment amount', {
        description: `Partial amount must be greater than 0 and not exceed total ₹${totals.grandTotal.toLocaleString('en-IN')}`,
      });
      return null;
    }

    const newInvoice: Invoice = {
      id: initialInvoice ? initialInvoice.id : `inv-${Date.now()}`,
      invoiceNumber,
      branchId: selectedBranch,
      transactionType,
      customerId: customerId || selectedCustomerObj?.id,
      customerName: customerName.trim(),
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
      termsAndConditions: terms,
      description: description.trim() || undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
      paymentMode,
      isPartialPayment,
      partialAmount: isPartialPayment ? partialAmount : undefined,
      balanceDue: isPartialPayment ? balanceDue : undefined,
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

  const handleSave = () => {
    const inv = assembleInvoiceObject();
    if (!inv) return;
    saveInvoice(inv);
    onSaved(inv);
  };

  const handlePreview = () => {
    const inv = assembleInvoiceObject();
    if (!inv) return;
    onPreviewPdf(inv);
  };

  const handleShare = () => {
    const inv = assembleInvoiceObject();
    if (!inv) return;
    const text = `*SALES INVOICE — MAJESTRONICZ*\nInvoice: ${inv.invoiceNumber}\nDate: ${inv.date}\nCustomer: ${inv.customerName}\nGrand Total: ₹${inv.grandTotal.toLocaleString('en-IN')}\nPayment: ${inv.paymentMode} (${inv.transactionType})\nThank you for doing business with Majestronicz!`;
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
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

      {/* Top Banner with Bill Type Dropdown & Action Buttons */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Left: Bill Type (Cash Sale / Credit Bill) Dropdown */}
        <div className="flex items-center gap-3">
          <div className="w-44 sm:w-48">
            <UniversalDropdown
              options={[
                { value: 'Cash', label: 'Cash Sale' },
                { value: 'Credit', label: 'Credit Bill' },
              ]}
              value={transactionType}
              onChange={(val) => setTransactionType(val as TransactionType)}
            />
          </div>

          {sourceEstimateId && (
            <span className="text-[11px] font-semibold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              <span>Converted from Estimate</span>
            </span>
          )}
        </div>

        {/* Right: Quick Actions */}
        <div className="flex items-center gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors"
            >
              Cancel
            </button>
          )}

          <button
            type="button"
            onClick={handleShare}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl transition-colors shadow-2xs"
          >
            <Share2 className="h-3.5 w-3.5" />
            <span>Share</span>
          </button>

          <button
            type="button"
            onClick={handlePreview}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-colors shadow-2xs"
          >
            <Printer className="h-3.5 w-3.5 text-slate-500" />
            <span>Preview PDF</span>
          </button>

          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-xs"
          >
            <Save className="h-3.5 w-3.5" />
            <span>Save & Decrement Stock</span>
          </button>
        </div>
      </div>

      {/* Main Invoice Form Header Details Card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-6">
        {/* Top Header Row: Branch, Invoice No, Date, Time, State */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Branch Picker */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Billing Branch
            </label>
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value as BranchId)}
              disabled={!isAllBranches && currentBranch !== 'all'}
              className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-600 disabled:opacity-75"
            >
              {BRANCHES.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.shortCode})
                </option>
              ))}
            </select>
          </div>

          {/* Auto Invoice Number */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Invoice Number
            </label>
            <div className="relative">
              <input
                type="text"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-blue-50/50 border border-blue-200 text-xs font-mono font-bold text-blue-800 focus:outline-none focus:border-blue-600"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] font-bold text-blue-600 uppercase bg-blue-100/70 px-1.5 py-0.5 rounded">
                Auto
              </span>
            </div>
          </div>

          {/* Invoice Date */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Invoice Date
            </label>
            <div className="relative">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full pl-3 pr-8 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-600"
              />
              <Calendar className="h-3.5 w-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          </div>

          {/* Invoice Time */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Time
            </label>
            <div className="relative">
              <input
                type="text"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full pl-3 pr-8 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-600 font-mono"
              />
              <Clock className="h-3.5 w-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          </div>

          {/* State of Supply */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              State of Supply
            </label>
            <select
              value={stateOfSupply}
              onChange={(e) => setStateOfSupply(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-600"
            >
              {INDIAN_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Customer & Payment Terms Details Row */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pt-2 border-t border-slate-100">
          {/* Customer Search & Select (Customer Master) */}
          <div className="md:col-span-4">
            <CustomerSearchSelect
              label="Customer / Organization Name"
              required
              selectedCustomerId={customerId}
              customerName={customerName}
              customerPhone={customerPhone}
              customerAddress={customerAddress}
              onSelectCustomer={(cust) => {
                setCustomerId(cust.id);
                setCustomerName(cust.name);
                setCustomerPhone(cust.phone || '');
                setCustomerAddress(cust.address || '');
              }}
              onClearCustomer={() => {
                setCustomerId(undefined);
                setCustomerName('');
                setCustomerPhone('');
                setCustomerAddress('');
                setIsLoyaltyRewardApplied(false);
              }}
              onCustomerNameChange={setCustomerName}
              onCustomerPhoneChange={setCustomerPhone}
              onCustomerAddressChange={setCustomerAddress}
            />
          </div>

          {/* Customer Phone */}
          <div className="md:col-span-3">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Phone / Mobile
            </label>
            <div className="relative">
              <input
                type="tel"
                placeholder="e.g. 9842100000"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600 font-mono"
              />
              <Phone className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          {/* Payment Terms */}
          <div className="md:col-span-3">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Payment Terms
            </label>
            <UniversalDropdown
              options={paymentTermsOptions.map((opt) => ({
                value: opt.value,
                label: opt.label,
              }))}
              value={paymentTerms}
              onChange={(val) => handlePaymentTermsChange(val)}
              addNewLabel="+ Add New Payment Term"
              onAddNew={(name) => {
                addPaymentTerm(name);
                handlePaymentTermsChange(name);
              }}
            />
          </div>

          {/* Due Date */}
          <div className="md:col-span-2">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Due Date
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-600"
            />
          </div>

          {/* Billing Address */}
          <div className="md:col-span-9">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Billing Address (Optional)
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="Street address, city, pin code..."
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600"
              />
              <MapPin className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          {/* GST Toggle Control */}
          <div className="md:col-span-3 flex flex-col justify-end">
            <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-xs font-bold text-slate-700">GST Invoice Mode</span>
              <button
                type="button"
                onClick={() => handleToggleGst(!withGst)}
                className={cn(
                  'px-3 py-1 rounded-lg text-xs font-bold transition-all',
                  withGst
                    ? 'bg-emerald-600 text-white shadow-2xs'
                    : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                )}
              >
                {withGst ? 'With GST' : 'Without Tax'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* LINE ITEMS TABLE CARD */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
        {/* Table Header Strip */}
        <div className="px-6 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
              Invoice Line Items ({lineItems.length})
            </span>
            <span className="text-[10px] text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
              Branch: {BRANCHES.find((b) => b.id === selectedBranch)?.shortCode}
            </span>
          </div>
          <span className="text-[11px] text-blue-700 font-medium">
            💡 Price edits apply only to this invoice; catalog item prices are never modified.
          </span>
        </div>

        {/* Line Items Table */}
        <div className="overflow-x-auto min-h-[300px] pb-32">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                <th className="py-3 px-3 w-10 text-center">#</th>
                <th className="py-3 px-3 min-w-[240px]">Item Description / Search Catalog</th>
                <th className="py-3 px-3 w-24">HSN/SAC</th>
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
                        onChange={(val) => updateLineItem(item.id, { itemName: val })}
                        onSelectItem={(masterItem) => selectMasterItemForRow(item.id, masterItem)}
                        onSelectCombo={(combo) => selectComboForRow(item.id, combo)}
                        includeCombos={true}
                        selectedBranchId={selectedBranch}
                        lockOutOfStock={true}
                        placeholder="Type or search product or combo..."
                        dropdownWidth="w-[520px]"
                        inputClassName="w-full px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600"
                      />
                      {item.isCombo && (
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-purple-100 text-purple-700 border border-purple-200 uppercase">
                            Combo Bundle
                          </span>
                          <span className="text-[10px] text-purple-700 font-mono font-bold">
                            {item.itemCode}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* HSN Code */}
                    <td className="py-2.5 px-3">
                      <input
                        type="text"
                        placeholder="HSN"
                        value={item.itemHSN}
                        onChange={(e) => updateLineItem(item.id, { itemHSN: e.target.value })}
                        className="w-full px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono text-slate-700 focus:outline-none focus:border-blue-600"
                      />
                    </td>

                    {/* Quantity */}
                    <td className="py-2.5 px-3">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={item.quantity}
                        onChange={(e) => updateLineItem(item.id, { quantity: Number(e.target.value) })}
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
                        className="w-full px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-bold text-slate-900 text-right focus:outline-none focus:border-blue-600 font-mono"
                        title="Override price for this invoice. Never mutates catalog."
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
                          className="w-full px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono text-right focus:outline-none focus:border-blue-600"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            updateLineItem(item.id, {
                              discountType: item.discountType === '%' ? 'amount' : '%',
                            })
                          }
                          className="px-1.5 py-1 text-[10px] font-bold rounded bg-slate-100 hover:bg-slate-200 text-slate-600 shrink-0"
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
          {/* PAYMENT MODE (Connected to Daily Cash Register) */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
                  Payment Mode (Daily Cash Register) <span className="text-rose-500">*</span>
                </h3>
                <p className="text-[11px] text-slate-500">
                  Select payment destination matching the Daily Cash sheet columns.
                </p>
              </div>
              <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                Auto-Reconciles
              </span>
            </div>

            {/* Payment Mode Dropdown matching Daily Cash Register */}
            <UniversalDropdown
              options={[
                { value: 'Cash', label: 'Cash' },
                { value: 'HDFC', label: 'HDFC (Bank Transfer)' },
                { value: 'GPay', label: 'GPay (UPI/QR)' },
                { value: 'COD-Credit', label: 'COD-Credit (Pay on Delivery)' },
              ]}
              value={paymentMode}
              onChange={(val) => setPaymentMode(val as PaymentMode)}
            />

            {/* Partial Payment (PP) Toggle & Input for COD-Credit */}
            {paymentMode === 'COD-Credit' && (
              <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 space-y-3 mt-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-amber-900">
                      Partial Payment (PP) Received?
                    </span>
                    <span className="text-[10px] bg-amber-200 text-amber-800 px-1.5 py-0.2 rounded font-mono font-bold">
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
          </div>

          {/* Terms and Conditions Preset Selector */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-700">
                Terms & Conditions Template
              </label>
              <select
                value={termsPresetId}
                onChange={(e) => handleTermsPresetChange(e.target.value)}
                className="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-600"
              >
                {INVOICE_TERMS_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              rows={3}
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-800 focus:outline-none focus:border-blue-600 font-mono"
            />
          </div>

          {/* Extra Notes & Attachments Accordion */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
            <button
              type="button"
              onClick={() => setIsExtraOpen(!isExtraOpen)}
              className="w-full p-4 flex items-center justify-between text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Paperclip className="h-4 w-4 text-slate-500" />
                <span>Add Description & Attachments</span>
                {attachments.length > 0 && (
                  <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.2 rounded font-bold">
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
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
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
                      <Sparkles className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-amber-950 block">
                        🎉 Loyalty Milestone Reached!
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
                    <Sparkles className="h-3.5 w-3.5" />
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
                <div className="bg-slate-50 p-2 rounded-lg border border-slate-200 mt-1 space-y-1 text-[10px]">
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

          {/* Grand Total Box */}
          <div className="p-4 rounded-xl bg-blue-600 text-white shadow-xs space-y-1">
            <div className="flex justify-between items-baseline">
              <span className="text-xs uppercase font-bold tracking-wider text-blue-100">
                Grand Total
              </span>
              <span className="text-2xl font-black font-mono">
                {formatCurrency(totals.grandTotal)}
              </span>
            </div>
            <p className="text-[10px] text-blue-200">
              {withGst ? 'All GST taxes included' : 'Net invoice total (non-tax)'}
            </p>
          </div>

          {/* Amount In Words */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
            <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
              Amount in Words
            </span>
            <p className="font-bold text-slate-900 italic leading-relaxed">
              {totals.amountInWords}
            </p>
          </div>

          {/* Primary Save Action Button */}
          <button
            type="button"
            onClick={handleSave}
            className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-md transition-colors flex items-center justify-center gap-2"
          >
            <Save className="h-4 w-4" />
            <span>Save Invoice & Update Inventory</span>
          </button>
        </div>
      </div>
    </div>
  );
};
