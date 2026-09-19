import React, { useState, useEffect, useMemo } from 'react';
import { useErp } from '../../context/ErpContext';
import {
  Item,
  Estimate,
  EstimateLineItem,
  DEFAULT_TERMS_AND_CONDITIONS,
  BranchId,
  GstBreakdownRow,
  ComboItem,
  cleanCustomerName,
} from '../../types';
import { formatCurrency, cn } from '../../lib/utils';
import { calculateLineTax, calculateTaxBreakdown, calculateInvoiceTotals } from '../../lib/taxCalculations';
import {
  Plus,
  Trash2,
  Save,
  Printer,
  Calendar,
  Clock,
  MapPin,
  Link,
  Copy,
} from 'lucide-react';
import { toast } from 'sonner';
import { ItemSearchDropdown } from '../common/ItemSearchDropdown';
import { UniversalDropdown } from '../common/UniversalDropdown';
import { CustomerSearchSelect } from '../common/CustomerSearchSelect';
import { PhoneInput } from '../common/PhoneInput';

interface Props {
  onSaved: (estimate: Estimate) => void;
  onPreviewPdf: (estimate: Estimate) => void;
  initialEstimate?: Estimate | null;
  duplicateSourceEstimate?: Estimate | null;
}

export const EstimateForm: React.FC<Props> = ({
  onSaved,
  onPreviewPdf,
  initialEstimate,
  duplicateSourceEstimate,
}) => {
  const {
    currentBranch,
    isAllBranches,
    getNextEstimateNumber,
    saveEstimate,
    branchStocks,
    getComboAvailability,
    paymentTermsOptions,
    addPaymentTerm,
  } = useErp();

  // Target branch for this estimate (if in 'all' scope, default to 'erode-hq' or permit picking)
  const [selectedBranch, setSelectedBranch] = useState<BranchId>(() => {
    if (initialEstimate) return initialEstimate.branchId;
    if (duplicateSourceEstimate) return duplicateSourceEstimate.branchId;
    if (!isAllBranches && currentBranch !== 'all') return currentBranch as BranchId;
    return 'erode-hq';
  });

  // Estimate Header details
  const [estimateNumber, setEstimateNumber] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [time, setTime] = useState(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });

  // Customer details
  const [customerId, setCustomerId] = useState<string | undefined>(
    initialEstimate?.customerId
  );
  const [customerName, setCustomerName] = useState('');
  const [customerContact, setCustomerContact] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('Due on Receipt');

  // GST Toggle: With GST vs Without GST
  const [withGst, setWithGst] = useState(true);

  // Bulk Tax Apply Controls
  const [isBulkTaxOpen, setIsBulkTaxOpen] = useState(false);
  const [bulkGstRate, setBulkGstRate] = useState<number>(18);

  // Source Enquiry link tracking
  const [sourceEnquiryId, setSourceEnquiryId] = useState<string | undefined>(
    initialEstimate?.sourceEnquiryId
  );
  const [sourceEnquiryNumber, setSourceEnquiryNumber] = useState<string | undefined>(
    initialEstimate?.sourceEnquiryNumber
  );

  // Line items
  const [lineItems, setLineItems] = useState<EstimateLineItem[]>([]);

  // Terms and conditions
  const [terms, setTerms] = useState(DEFAULT_TERMS_AND_CONDITIONS);

  // Auto-generate Estimate Number when branch or initial changes
  useEffect(() => {
    if (initialEstimate) {
      setEstimateNumber(initialEstimate.estimateNumber);
      setSelectedBranch(initialEstimate.branchId);
      setDate(initialEstimate.date);
      setTime(initialEstimate.time);
      setCustomerId(initialEstimate.customerId);
      setCustomerName(initialEstimate.customerName);
      setCustomerContact(initialEstimate.customerContact || '');
      setCustomerAddress(initialEstimate.customerAddress || '');
      setWithGst(initialEstimate.withGst);
      setLineItems(initialEstimate.items);
      setTerms(initialEstimate.termsAndConditions);
      setSourceEnquiryId(initialEstimate.sourceEnquiryId);
      setSourceEnquiryNumber(initialEstimate.sourceEnquiryNumber);
    } else if (duplicateSourceEstimate) {
      // Duplicate quote: copy branch, withGst, terms, line items; CLEAR customer, fresh date/time & sequence
      setSelectedBranch(duplicateSourceEstimate.branchId);
      setDate(new Date().toISOString().split('T')[0]);
      const d = new Date();
      setTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
      setCustomerId(undefined);
      setCustomerName('');
      setCustomerContact('');
      setCustomerAddress('');
      setWithGst(duplicateSourceEstimate.withGst);
      setTerms(duplicateSourceEstimate.termsAndConditions);
      setSourceEnquiryId(undefined);
      setSourceEnquiryNumber(undefined);

      // Clone line items with fresh unique IDs
      const duplicatedItems: EstimateLineItem[] = duplicateSourceEstimate.items.map((item) => ({
        ...item,
        id: `li-dup-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      }));
      setLineItems(duplicatedItems);

      const generated = getNextEstimateNumber(duplicateSourceEstimate.branchId);
      setEstimateNumber(generated);
      toast.info(`Duplicated from Quote #${duplicateSourceEstimate.estimateNumber}`, {
        description: 'All line items and rates copied. Please search or enter a customer to proceed.',
      });
    } else {
      const generated = getNextEstimateNumber(selectedBranch, date);
      setEstimateNumber(generated);
    }
  }, [selectedBranch, initialEstimate, duplicateSourceEstimate, getNextEstimateNumber, date]);

  // Keep estimate number in sync with financial year when date or branch changes
  useEffect(() => {
    if (!initialEstimate) {
      const generated = getNextEstimateNumber(selectedBranch, date);
      setEstimateNumber(generated);
    }
  }, [selectedBranch, date, initialEstimate, getNextEstimateNumber]);

  // If no line items on new form, initialize with one empty row
  useEffect(() => {
    if (lineItems.length === 0 && !initialEstimate && !duplicateSourceEstimate) {
      addNewRow();
    }
  }, [lineItems.length, initialEstimate, duplicateSourceEstimate]);

  const addNewRow = (selectedItem?: Item) => {
    const newId = `li-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    let newRow: EstimateLineItem;

    if (selectedItem) {
      const preTaxPrice =
        selectedItem.salePriceTaxMode === 'with'
          ? selectedItem.salePrice / (1 + selectedItem.gstTaxSlab / 100)
          : selectedItem.salePrice;

      const taxable = Math.round(preTaxPrice * 100) / 100;
      const gstRate = selectedItem.gstTaxSlab;
      const totalTax = (taxable * gstRate) / 100;

      newRow = {
        id: newId,
        itemId: selectedItem.id,
        itemName: selectedItem.itemName,
        itemHSN: selectedItem.itemHSN,
        quantity: 1,
        unit: selectedItem.unit,
        unitPrice: taxable,
        gstRate: gstRate,
        taxableAmount: taxable,
        cgstAmount: totalTax / 2,
        sgstAmount: totalTax / 2,
        totalTax: totalTax,
        totalAmount: taxable + totalTax,
      };
    } else {
      newRow = {
        id: newId,
        itemName: '',
        itemHSN: '',
        quantity: 1,
        unit: 'PCS',
        unitPrice: 0,
        gstRate: isBulkTaxOpen ? bulkGstRate : 18,
        taxableAmount: 0,
        cgstAmount: 0,
        sgstAmount: 0,
        totalTax: 0,
        totalAmount: 0,
      };
    }

    setLineItems((prev) => [...prev, newRow]);
  };

  const updateLineItem = (id: string, updates: Partial<EstimateLineItem>) => {
    setLineItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;

        const merged = { ...item, ...updates };
        const qty = Number(merged.quantity) || 0;
        const price = Number(merged.unitPrice) || 0;
        const rate = Number(merged.gstRate) || 0;

        const calculated = calculateLineTax(qty, price, rate, withGst);

        return {
          ...merged,
          quantity: qty,
          unitPrice: price,
          gstRate: rate,
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
        description: `"${item.itemName}" has 0 available stock at this branch.`,
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
      itemName: item.itemName,
      itemHSN: item.itemHSN,
      unit: item.unit,
      unitPrice: roundedPrice,
      gstRate: isBulkTaxOpen ? bulkGstRate : item.gstTaxSlab,
      isCombo: false,
      comboId: undefined,
      comboComponents: undefined,
    });
  };

  const selectComboForRow = (rowId: string, combo: ComboItem) => {
    const avail = getComboAvailability(combo, selectedBranch);
    if (avail <= 0) {
      toast.error('Combo out of stock at this branch', {
        description: `"${combo.comboName}" currently has 0 available kits at this branch.`,
      });
      return;
    }

    updateLineItem(rowId, {
      itemId: combo.id,
      itemName: combo.comboName,
      itemHSN: '85371000',
      unit: 'SET',
      unitPrice: combo.comboPrice,
      gstRate: isBulkTaxOpen ? bulkGstRate : 18,
      isCombo: true,
      comboId: combo.id,
      comboComponents: combo.components,
    });
  };

  const removeLineItem = (id: string) => {
    if (lineItems.length === 1) {
      toast.info('Estimates must contain at least one line item');
      return;
    }
    setLineItems((prev) => prev.filter((i) => i.id !== id));
  };

  // Bulk-apply tax rate and/or mode to all current estimate line items
  const handleApplyBulkTax = (rateToApply: number, modeWithGst: boolean = withGst) => {
    if (lineItems.length === 0) {
      toast.info('No line items to update');
      return;
    }

    if (modeWithGst !== withGst) {
      setWithGst(modeWithGst);
    }

    setLineItems((prev) =>
      prev.map((item) => {
        const calculated = calculateLineTax(
          item.quantity,
          item.unitPrice,
          rateToApply,
          modeWithGst
        );

        return {
          ...item,
          gstRate: rateToApply,
          taxableAmount: calculated.taxableAmount,
          cgstAmount: calculated.cgstAmount,
          sgstAmount: calculated.sgstAmount,
          totalTax: calculated.totalTax,
          totalAmount: calculated.totalAmount,
        };
      })
    );

    toast.success(
      modeWithGst
        ? `Applied ${rateToApply}% GST to all ${lineItems.length} quotation lines`
        : `Switched all ${lineItems.length} quotation lines to Without GST mode`
    );
  };

  // Aggregated Totals Calculation using standardized tax engine
  const totals = useMemo(() => {
    return calculateInvoiceTotals(lineItems, withGst);
  }, [lineItems, withGst]);

  // GST Rate breakdown pairs for With GST mode
  const gstBreakdown = useMemo((): GstBreakdownRow[] => {
    if (!withGst) return [];
    return calculateTaxBreakdown(lineItems, totals.overallDiscountAmount, totals.subtotal);
  }, [lineItems, withGst, totals.overallDiscountAmount, totals.subtotal]);

  const assembleEstimateObject = (): Estimate | null => {
    if (!customerName.trim()) {
      toast.error('Customer Name is required');
      return null;
    }

    const validItems = lineItems.filter((i) => i.itemName.trim() && i.quantity > 0);
    if (validItems.length === 0) {
      toast.error('Add at least one item with valid name and quantity');
      return null;
    }

    return {
      id: initialEstimate?.id || `est-${Date.now()}`,
      estimateNumber: estimateNumber.trim() || getNextEstimateNumber(selectedBranch, date),
      branchId: selectedBranch,
      date,
      time,
      customerId,
      customerName: cleanCustomerName(customerName),
      customerContact: customerContact.trim() || undefined,
      customerAddress: customerAddress.trim() || undefined,
      withGst,
      items: validItems,
      subtotal: totals.subtotal,
      totalCgst: totals.totalCgst,
      totalSgst: totals.totalSgst,
      totalTax: totals.totalTax,
      grandTotal: totals.grandTotal,
      amountInWords: totals.amountInWords,
      termsAndConditions: terms,
      sourceEnquiryId,
      sourceEnquiryNumber,
      createdAt: initialEstimate?.createdAt || new Date().toISOString(),
    };
  };

  const handleSave = () => {
    const est = assembleEstimateObject();
    if (!est) return;

    saveEstimate(est);
    onSaved(est);
  };

  const handlePreview = () => {
    const est = assembleEstimateObject();
    if (!est) return;

    onPreviewPdf(est);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
      {/* Header Bar */}
      <div className="p-5 border-b border-slate-200 bg-slate-50/70 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-extrabold text-slate-900 tracking-tight">
              {initialEstimate ? 'Edit Estimate' : duplicateSourceEstimate ? 'Duplicate Estimate' : 'New Quotation / Estimate'}
            </h2>
            <span className="text-xs font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
              {estimateNumber}
            </span>
            {duplicateSourceEstimate && (
              <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-lg border border-indigo-200 flex items-center gap-1">
                <Copy className="h-3 w-3" />
                <span>Duplicate of #{duplicateSourceEstimate.estimateNumber}</span>
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {duplicateSourceEstimate
              ? `Duplicating items from Quote #${duplicateSourceEstimate.estimateNumber}. Customer fields have been cleared.`
              : 'Auto-numbered financial estimate with editable unit price overrides & GST breakdown.'}
          </p>
        </div>

        {/* GST Toggle & Actions */}
        <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
          {/* GST Mode Segmented Toggle */}
          <div className="flex items-center bg-slate-200/80 p-1 rounded-xl text-xs">
            <button
              type="button"
              onClick={() => setWithGst(true)}
              className={cn(
                'px-3 py-1.5 rounded-lg font-bold transition-all',
                withGst
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              With GST
            </button>
            <button
              type="button"
              onClick={() => setWithGst(false)}
              className={cn(
                'px-3 py-1.5 rounded-lg font-bold transition-all',
                !withGst
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              Without GST
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePreview}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold border border-slate-200 transition-colors"
            >
              <Printer className="h-3.5 w-3.5 text-blue-600" />
              <span>Preview PDF</span>
            </button>

            <button
              type="button"
              onClick={handleSave}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors"
            >
              <Save className="h-3.5 w-3.5" />
              <span>Save Estimate</span>
            </button>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-6">
        {/* Linked Enquiry Notification Banner */}
        {sourceEnquiryNumber && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 flex items-center justify-between text-xs text-blue-900">
            <div className="flex items-center gap-2">
              <Link className="h-4 w-4 text-blue-600 shrink-0" />
              <span className="font-bold">Linked to Customer Enquiry:</span>
              <span className="bg-white px-2 py-0.5 rounded border border-blue-200 font-mono font-bold text-blue-700">
                #{sourceEnquiryNumber}
              </span>
            </div>
            <span className="text-[11px] text-blue-600 font-medium hidden sm:inline">
              Pre-filled from enquiry requirements
            </span>
          </div>
        )}

        {/* Row 1: Document Details & Customer Info */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          {/* Customer Details Box (Span 7) */}
          <div className="md:col-span-7 bg-slate-50/60 p-4 rounded-xl border border-slate-200 space-y-3">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
              Estimate For (Customer)
            </span>

            <div className="space-y-2.5">
              <CustomerSearchSelect
                label=""
                required
                selectedCustomerId={customerId}
                customerName={customerName}
                customerPhone={customerContact}
                customerAddress={customerAddress}
                onSelectCustomer={(cust) => {
                  const clean = cleanCustomerName(cust.name, cust.notes);
                  setCustomerId(cust.id);
                  setCustomerName(clean);
                  setCustomerContact(cust.phone || '');
                  setCustomerAddress(cust.address || '');
                }}
                onClearCustomer={() => {
                  setCustomerId(undefined);
                  setCustomerName('');
                  setCustomerContact('');
                  setCustomerAddress('');
                }}
                onCustomerNameChange={setCustomerName}
                onCustomerPhoneChange={setCustomerContact}
                onCustomerAddressChange={setCustomerAddress}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <PhoneInput
                  placeholder="98421 00000"
                  value={customerContact}
                  onChange={setCustomerContact}
                  size="sm"
                />

                <div className="relative">
                  <MapPin className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Customer Billing Address (Optional)"
                    value={customerAddress}
                    onChange={(e) => setCustomerAddress(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-white border border-slate-300 text-slate-900 placeholder-slate-400 text-xs focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Document Meta (Span 5) */}
          <div className="md:col-span-5 bg-slate-50/60 p-4 rounded-xl border border-slate-200 space-y-2.5">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
              Estimate Meta
            </span>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-semibold text-slate-600 w-24">Estimate No:</label>
                <input
                  type="text"
                  value={estimateNumber}
                  onChange={(e) => setEstimateNumber(e.target.value)}
                  className="flex-1 px-3 py-1.5 rounded-xl bg-white border border-slate-300 text-slate-900 font-mono text-xs font-bold focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="flex items-center gap-2">
                <label className="text-[11px] font-semibold text-slate-600 w-24">Date & Time:</label>
                <div className="flex items-center gap-2 flex-1">
                  <div className="relative flex-1">
                    <Calendar className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="w-full pl-8 pr-2 py-1.5 rounded-xl bg-white border border-slate-300 text-slate-900 text-xs font-medium focus:outline-none focus:border-blue-600"
                    />
                  </div>
                  <div className="relative w-24">
                    <Clock className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      className="w-full pl-8 pr-2 py-1.5 rounded-xl bg-white border border-slate-300 text-slate-900 text-xs font-medium focus:outline-none focus:border-blue-600"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <label className="text-[11px] font-semibold text-slate-600 w-24">Issuing Branch:</label>
                <select
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value as BranchId)}
                  className="flex-1 px-3 py-1.5 rounded-xl bg-white border border-slate-300 text-slate-900 text-xs font-semibold focus:outline-none focus:border-blue-600"
                >
                  <option value="erode-hq">Erode HQ (Central Hub)</option>
                  <option value="coimbatore">Coimbatore (Robotics)</option>
                  <option value="chennai">Chennai (Metro Outlet)</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <label className="text-[11px] font-semibold text-slate-600 w-24">Payment Terms:</label>
                <div className="flex-1">
                  <UniversalDropdown
                    options={paymentTermsOptions.map((opt) => ({
                      value: opt.value,
                      label: opt.label,
                    }))}
                    value={paymentTerms}
                    onChange={(val) => {
                      setPaymentTerms(val);
                      if (!terms.includes(val)) {
                        setTerms((prev) => `${prev}\n• Payment Terms: ${val}`.trim());
                      }
                    }}
                    addNewLabel="+ Add New Payment Term"
                    onAddNew={(name) => {
                      addPaymentTerm(name);
                      setPaymentTerms(name);
                      if (!terms.includes(name)) {
                        setTerms((prev) => `${prev}\n• Payment Terms: ${name}`.trim());
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Line Items Table */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
                Quotation Line Items ({lineItems.length})
              </span>
            </div>

            {/* Bulk Tax Settings Shortcut Control */}
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs">
                <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isBulkTaxOpen}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setIsBulkTaxOpen(checked);
                      if (checked) {
                        handleApplyBulkTax(bulkGstRate, withGst);
                      }
                    }}
                    className="rounded text-blue-600 focus:ring-blue-500 h-3.5 w-3.5 cursor-pointer"
                  />
                  <span>Apply to all items</span>
                </label>

                {isBulkTaxOpen && (
                  <div className="flex items-center gap-2 border-l border-slate-200 pl-2.5 ml-1">
                    {/* Mode Selector */}
                    <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-[11px]">
                      <button
                        type="button"
                        onClick={() => handleApplyBulkTax(bulkGstRate, true)}
                        className={cn(
                          'px-2 py-0.5 rounded-md font-bold transition-all',
                          withGst ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                        )}
                      >
                        With GST
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApplyBulkTax(0, false)}
                        className={cn(
                          'px-2 py-0.5 rounded-md font-bold transition-all',
                          !withGst ? 'bg-slate-700 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                        )}
                      >
                        No GST
                      </button>
                    </div>

                    {/* GST Rate Dropdown */}
                    {withGst && (
                      <div className="flex items-center gap-1.5">
                        <select
                          value={bulkGstRate}
                          onChange={(e) => {
                            const rate = Number(e.target.value);
                            setBulkGstRate(rate);
                            handleApplyBulkTax(rate, true);
                          }}
                          className="px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs font-bold text-slate-800 focus:outline-none focus:border-blue-600 cursor-pointer"
                        >
                          <option value="0">0% GST</option>
                          <option value="5">5% GST</option>
                          <option value="12">12% GST</option>
                          <option value="18">18% GST</option>
                          <option value="28">28% GST</option>
                        </select>

                        <button
                          type="button"
                          onClick={() => handleApplyBulkTax(bulkGstRate, true)}
                          className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-2xs transition-colors cursor-pointer"
                          title="Re-apply this tax rate to all quotation lines"
                        >
                          Apply
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <span className="text-[11px] text-slate-500 hidden md:inline-block">
                *Price per line can be edited/discounted. Overrides never write back to master catalog.
              </span>
            </div>
          </div>

          <div className="border border-slate-200 rounded-xl overflow-visible shadow-2xs">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100/90 border-b border-slate-200 text-slate-700 font-bold uppercase text-[11px] tracking-wider">
                  <th className="py-2.5 px-3 w-10 text-center">#</th>
                  <th className="py-2.5 px-3 min-w-[220px]">Item Description</th>
                  <th className="py-2.5 px-3 w-28">Location</th>
                  <th className="py-2.5 px-3 w-20 text-right">Qty</th>
                  <th className="py-2.5 px-3 w-20">Unit</th>
                  <th className="py-2.5 px-3 w-28 text-right">Price/Unit (₹)</th>
                  {withGst && (
                    <>
                      <th className="py-2.5 px-3 w-20 text-right">GST %</th>
                      <th className="py-2.5 px-3 w-24 text-right">Tax (₹)</th>
                    </>
                  )}
                  <th className="py-2.5 px-3 w-28 text-right">Amount (₹)</th>
                  <th className="py-2.5 px-2 w-10 text-center"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {lineItems.map((row, idx) => (
                  <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-2.5 px-3 text-center text-slate-400 font-mono font-bold">
                      {idx + 1}
                    </td>

                    {/* Item Autocomplete Search & Input */}
                    <td className="py-2 px-3 relative">
                      <ItemSearchDropdown
                        value={row.itemName}
                        onChange={(val) => updateLineItem(row.id, { itemName: val })}
                        onSelectItem={(item) => selectMasterItemForRow(row.id, item)}
                        onSelectCombo={(combo) => selectComboForRow(row.id, combo)}
                        includeCombos={true}
                        selectedBranchId={selectedBranch}
                        lockOutOfStock={true}
                        placeholder="Search product or combo..."
                        dropdownWidth="w-[480px] max-w-[calc(100vw-2rem)]"
                        inputClassName="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-900 text-xs font-semibold focus:outline-none focus:border-blue-600 bg-white"
                      />
                      {row.isCombo && (
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="px-1.5 py-0.2 rounded text-[11px] font-bold bg-purple-100 text-purple-700 border border-purple-200 uppercase">
                            Combo Bundle
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Location */}
                    <td className="py-2 px-3">
                      {(() => {
                        const stock = branchStocks.find(
                          (s) => s.itemId === row.itemId && s.branchId === selectedBranch
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
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        min="1"
                        step="any"
                        value={row.quantity}
                        onChange={(e) =>
                          updateLineItem(row.id, { quantity: parseFloat(e.target.value) || 0 })
                        }
                        className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-slate-900 text-right font-bold text-xs focus:outline-none focus:border-blue-600"
                      />
                    </td>

                    {/* Unit */}
                    <td className="py-2 px-3">
                      <input
                        type="text"
                        value={row.unit}
                        onChange={(e) => updateLineItem(row.id, { unit: e.target.value })}
                        className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-slate-600 uppercase font-mono text-xs focus:outline-none focus:border-blue-600"
                      />
                    </td>

                    {/* Price/Unit (Pre-Tax Editable Override) */}
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={row.unitPrice}
                        onChange={(e) =>
                          updateLineItem(row.id, { unitPrice: parseFloat(e.target.value) || 0 })
                        }
                        className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-slate-900 text-right font-mono font-bold text-xs focus:outline-none focus:border-blue-600"
                      />
                    </td>

                    {/* GST Columns (Only if With GST) */}
                    {withGst && (
                      <>
                        <td className="py-2 px-3">
                          <select
                            value={row.gstRate}
                            onChange={(e) =>
                              updateLineItem(row.id, { gstRate: Number(e.target.value) })
                            }
                            className="w-full px-1.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 text-xs font-mono text-right focus:outline-none focus:border-blue-600"
                          >
                            <option value={0}>0%</option>
                            <option value={5}>5%</option>
                            <option value={12}>12%</option>
                            <option value={18}>18%</option>
                            <option value={28}>28%</option>
                          </select>
                        </td>

                        <td className="py-2 px-3 text-right font-mono text-slate-600 text-xs">
                          {formatCurrency(row.totalTax)}
                        </td>
                      </>
                    )}

                    {/* Line Total Amount */}
                    <td className="py-2 px-3 text-right font-mono font-extrabold text-slate-900 text-xs">
                      {formatCurrency(row.totalAmount)}
                    </td>

                    {/* Remove Row Button */}
                    <td className="py-2 px-2 text-center">
                      <button
                        type="button"
                        onClick={() => removeLineItem(row.id)}
                        className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                        title="Remove row"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => addNewRow()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-700 text-xs font-bold border border-slate-200 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Empty Row</span>
            </button>
            <span className="text-xs text-slate-500">
              Total Lines: <strong>{lineItems.length}</strong>
            </span>
          </div>
        </div>

        {/* Row 3: GST Breakdown / Words & Totals Panel */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5 pt-2">
          {/* Left Column (Span 7): Tax Breakdown & Words & Terms */}
          <div className="md:col-span-7 space-y-4">
            {/* WITH GST TAX BREAKDOWN TABLE */}
            {withGst && gstBreakdown.length > 0 && (
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <div className="bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-800 border-b border-slate-200 flex items-center justify-between">
                  <span>Tax Breakdown (SGST & CGST Split)</span>
                  <span className="text-[11px] text-slate-500 font-normal">
                    One pair per distinct GST slab (half rate each)
                  </span>
                </div>
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-100/70 text-slate-600 font-semibold border-b border-slate-200 text-[11px] uppercase">
                      <th className="py-1.5 px-3.5">Tax Type</th>
                      <th className="py-1.5 px-3.5 text-right">Taxable Amount (₹)</th>
                      <th className="py-1.5 px-3.5 text-right">Rate</th>
                      <th className="py-1.5 px-3.5 text-right">Tax Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700 font-mono">
                    {gstBreakdown.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/60">
                        <td className="py-1.5 px-3.5 font-bold text-slate-900">{row.taxType}</td>
                        <td className="py-1.5 px-3.5 text-right">{row.taxableAmount.toFixed(2)}</td>
                        <td className="py-1.5 px-3.5 text-right">{row.rate}%</td>
                        <td className="py-1.5 px-3.5 text-right font-bold text-slate-900">
                          {row.taxAmount.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Estimate Amount in Words */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">
                Amount In Words (Indian Numbering)
              </span>
              <p className="font-bold text-slate-900 italic">{totals.amountInWords}</p>
            </div>

            {/* Terms and Conditions (Editable with default text) */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                <span>Terms and Conditions</span>
                <span className="text-[11px] text-slate-400 font-normal">Default pre-filled</span>
              </label>
              <textarea
                rows={3}
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 text-xs font-medium focus:outline-none focus:border-blue-600 leading-relaxed font-mono"
              />
            </div>
          </div>

          {/* Right Column (Span 5): Amounts Summary Panel */}
          <div className="md:col-span-5 bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-3 text-xs">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block pb-1 border-b border-slate-200">
              Amounts Summary
            </span>

            <div className="flex justify-between py-1 text-slate-600">
              <span>Sub Total (Pre-tax):</span>
              <span className="font-mono font-bold text-slate-900 text-sm">
                {formatCurrency(totals.subtotal)}
              </span>
            </div>

            {withGst && (
              <>
                <div className="flex justify-between py-1 text-slate-600 border-t border-slate-200">
                  <span>Total SGST:</span>
                  <span className="font-mono font-semibold text-slate-800">
                    {formatCurrency(totals.totalSgst)}
                  </span>
                </div>
                <div className="flex justify-between py-1 text-slate-600 border-t border-slate-200">
                  <span>Total CGST:</span>
                  <span className="font-mono font-semibold text-slate-800">
                    {formatCurrency(totals.totalCgst)}
                  </span>
                </div>
                <div className="flex justify-between py-1 text-slate-600 border-t border-slate-200">
                  <span>Combined Tax:</span>
                  <span className="font-mono font-bold text-blue-700">
                    {formatCurrency(totals.totalTax)}
                  </span>
                </div>
              </>
            )}

            <div className="mt-4 p-4 rounded-xl bg-blue-600 text-white flex items-baseline justify-between shadow-xs">
              <div>
                <span className="text-[11px] uppercase font-bold tracking-wider block text-blue-100">
                  Final Estimate Total
                </span>
                <span className="text-[11px] text-blue-200">
                  {withGst ? 'With GST (CGST+SGST)' : 'Without GST'}
                </span>
              </div>
              <div className="text-xl sm:text-2xl font-bold font-mono">
                {formatCurrency(totals.grandTotal)}
              </div>
            </div>

            <div className="pt-2 flex gap-2">
              <button
                type="button"
                onClick={handlePreview}
                className="flex-1 py-2 rounded-xl bg-white hover:bg-slate-100 text-slate-800 font-bold border border-slate-200 transition-colors shadow-2xs flex items-center justify-center gap-1.5"
              >
                <Printer className="h-3.5 w-3.5 text-blue-600" />
                <span>PDF Preview</span>
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition-colors shadow-xs flex items-center justify-center gap-1.5"
              >
                <Save className="h-3.5 w-3.5" />
                <span>Save Estimate</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
