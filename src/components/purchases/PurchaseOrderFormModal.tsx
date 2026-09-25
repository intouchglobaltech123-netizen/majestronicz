import React, { useState, useEffect } from 'react';
import {
  X,
  ShoppingBag,
  Plus,
  Trash2,
  AlertCircle,
} from 'lucide-react';
import {
  POLineItem,
  Vendor,
  BranchId,
  Item,
} from '../../types';
import { useErp } from '../../context/ErpContext';
import { ItemSearchDropdown } from '../common/ItemSearchDropdown';
import { UniversalDropdown } from '../common/UniversalDropdown';
import { VendorMasterModal } from './VendorMasterModal';
import { formatCurrency, getTodayDateString } from '../../lib/utils';

interface PurchaseOrderFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  preSelectedVendor?: Vendor | null;
  preFilledItems?: Array<{ itemId: string; quantity: number }>;
  preFilledBranchId?: BranchId;
  linkedPendingOrderId?: string;
  linkedPendingOrderNumber?: string;
}

export const PurchaseOrderFormModal: React.FC<PurchaseOrderFormModalProps> = ({
  isOpen,
  onClose,
  preSelectedVendor,
  preFilledItems,
  preFilledBranchId,
  linkedPendingOrderId,
  linkedPendingOrderNumber,
}) => {
  const {
    vendors,
    saveVendor,
    items: masterItems,
    currentBranch,
    currentUser,
    accessibleBranches,
    savePurchaseOrder,
    getNextPoNumber,
  } = useErp();

  // Selected Branch
  const defaultBranch: BranchId =
    currentUser.role === 'Manager'
      ? currentUser.assignedBranchId || 'coimbatore'
      : currentBranch !== 'all'
      ? currentBranch
      : 'erode-hq';

  const [branchId, setBranchId] = useState<BranchId>(defaultBranch);

  // Selected Vendor
  const [selectedVendorId, setSelectedVendorId] = useState<string>('');
  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);

  // Dates
  const todayStr = getTodayDateString();
  const nextWeek = getTodayDateString(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  const [orderDate, setOrderDate] = useState(todayStr);
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(nextWeek);

  // Notes
  const [notes, setNotes] = useState('');

  // Line items
  const [lines, setLines] = useState<
    Array<{
      id: string;
      item: Item | null;
      searchQuery: string;
      vendorSku?: string;
      quantity: number;
      purchasePrice: number;
      amount: number;
    }>
  >([
    {
      id: `poli-init-${Date.now()}`,
      item: null,
      searchQuery: '',
      quantity: 1,
      purchasePrice: 0,
      amount: 0,
    },
  ]);

  // Validation
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Sync default branch or pre-selected vendor when opening
  useEffect(() => {
    if (isOpen) {
      const initialBranch: BranchId =
        preFilledBranchId ||
        (currentUser.role === 'Manager'
          ? currentUser.assignedBranchId || 'coimbatore'
          : currentBranch !== 'all'
          ? currentBranch
          : 'erode-hq');
      setBranchId(initialBranch);

      if (preSelectedVendor) {
        setSelectedVendorId(preSelectedVendor.id);
      } else if (linkedPendingOrderId) {
        // Leave vendor selection for staff to pick as required
        setSelectedVendorId('');
      } else if (vendors.length > 0 && !selectedVendorId) {
        setSelectedVendorId(vendors[0].id);
      }

      setOrderDate(todayStr);
      setExpectedDeliveryDate(nextWeek);
      setNotes('');
      setFormErrors({});

      // If preFilledItems passed (e.g. from out-of-stock pending order)
      if (preFilledItems && preFilledItems.length > 0) {
        const prefilledLines = preFilledItems.map((pf, idx) => {
          const matchedItem = masterItems.find((m) => m.id === pf.itemId);
          const price = matchedItem?.purchasePrice || (matchedItem ? matchedItem.salePrice * 0.7 : 0);
          return {
            id: `poli-pf-${idx}-${Date.now()}`,
            item: matchedItem || null,
            searchQuery: matchedItem?.itemName || '',
            quantity: pf.quantity,
            purchasePrice: price,
            amount: pf.quantity * price,
          };
        });
        setLines(prefilledLines);
      } else {
        setLines([
          {
            id: `poli-init-${Date.now()}`,
            item: null,
            searchQuery: '',
            quantity: 1,
            purchasePrice: 0,
            amount: 0,
          },
        ]);
      }
    }
  }, [isOpen, preSelectedVendor, preFilledItems, preFilledBranchId, linkedPendingOrderId]);

  if (!isOpen) return null;

  const currentVendor = vendors.find((v) => v.id === selectedVendorId);
  const poNumber = getNextPoNumber(branchId);

  // Line item actions
  const handleSelectItem = (index: number, item: Item) => {
    setLines((prev) => {
      const next = [...prev];
      const price = item.purchasePrice || Math.round(item.salePrice * 0.7);
      const qty = next[index].quantity || 1;
      next[index] = {
        ...next[index],
        item,
        searchQuery: item.itemName,
        purchasePrice: price,
        amount: qty * price,
      };
      // Auto-open a fresh row when the LAST line just got an item (like the sales bill).
      if (index === next.length - 1) {
        next.push({
          id: `poli-auto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          item: null,
          searchQuery: '',
          quantity: 1,
          purchasePrice: 0,
          amount: 0,
        });
      }
      return next;
    });
  };

  const handleUpdateLineQty = (index: number, qtyStr: string) => {
    const qty = parseInt(qtyStr, 10);
    setLines((prev) => {
      const next = [...prev];
      const safeQty = isNaN(qty) || qty < 1 ? 1 : qty;
      next[index] = {
        ...next[index],
        quantity: safeQty,
        amount: safeQty * (next[index].purchasePrice || 0),
      };
      return next;
    });
  };

  const handleUpdateLineSku = (index: number, sku: string) => {
    setLines((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], vendorSku: sku };
      return next;
    });
  };

  const handleAddLine = () => {
    setLines((prev) => [
      ...prev,
      {
        id: `poli-add-${Date.now()}`,
        item: null,
        searchQuery: '',
        quantity: 1,
        purchasePrice: 0,
        amount: 0,
      },
    ]);
  };

  const handleRemoveLine = (index: number) => {
    setLines((prev) => {
      // Removing the only remaining line clears it back to a fresh blank row
      // instead of erroring — the submit validation still requires a real item.
      if (prev.length <= 1) {
        return [{ id: `poli-add-${Date.now()}`, item: null, searchQuery: '', quantity: 1, purchasePrice: 0, amount: 0 }];
      }
      return prev.filter((_, idx) => idx !== index);
    });
  };

  // Calculations
  const totalAmount = lines.reduce((sum, line) => sum + line.amount, 0);

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!selectedVendorId) {
      errs.vendor = 'Please select a supplier';
    }
    if (!branchId) {
      errs.branch = 'Please select a destination branch';
    }
    if (!expectedDeliveryDate) {
      errs.deliveryDate = 'Expected delivery date is required';
    }

    // Check lines
    const validLines = lines.filter((l) => l.item !== null);
    if (validLines.length === 0) {
      errs.lines = 'Please select at least one valid item from the catalog';
    }
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    if (!currentVendor) return;

    const formattedLines: POLineItem[] = lines
      .filter((l): l is typeof l & { item: Item } => l.item !== null)
      .map((l) => ({
        id: l.id,
        itemId: l.item.id,
        itemCode: l.item.itemCode,
        itemName: l.item.itemName,
        itemHSN: l.item.itemHSN || '',
        vendorSku: (l.vendorSku || '').trim() || undefined,
        unit: l.item.unit || 'PCS',
        quantityOrdered: l.quantity,
        purchasePrice: l.purchasePrice,
        amount: l.amount,
        receivedQuantity: 0,
      }));

    savePurchaseOrder({
      poNumber,
      vendorId: currentVendor.id,
      vendorName: currentVendor.vendorName,
      vendorContact: currentVendor.contactNo,
      vendorAddress: currentVendor.address,
      vendorGstin: currentVendor.gstin,
      branchId,
      date: orderDate,
      expectedDeliveryDate,
      status: 'Ordered',
      items: formattedLines,
      totalAmount,
      notes: notes.trim() || undefined,
      pendingOrderId: linkedPendingOrderId,
      pendingOrderNumber: linkedPendingOrderNumber,
    });

    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-3 sm:p-5 animate-in fade-in duration-150">
        <div className="bg-white rounded-none shadow-xl border border-slate-300 w-full max-w-4xl overflow-hidden flex flex-col max-h-[92vh]">
          {/* Header */}
          <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-none bg-red-50 text-red-700 flex items-center justify-center border border-red-200 shrink-0">
                <ShoppingBag className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900">
                    Create Purchase Order
                  </h3>
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-none bg-red-50 text-red-700 border border-red-200">
                    {poNumber}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Procure stock from authorized supplier into physical warehouse inventory
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-none transition-colors border border-transparent hover:border-slate-300 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Form Content */}
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
            {linkedPendingOrderNumber && (
              <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-purple-900">
                    Linked to Pending Order:
                  </span>
                  <span className="text-xs font-mono font-bold bg-white px-2 py-0.5 rounded text-purple-800 border border-purple-300">
                    {linkedPendingOrderNumber}
                  </span>
                </div>
                <span className="text-[11px] text-purple-700">
                  Items & Branch pre-filled. Please select a supplier below.
                </span>
              </div>
            )}

            {/* Top Parameters Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
              {/* Supplier Selection */}
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Supplier / Vendor <span className="text-rose-500">*</span>
                </label>
                {/* Stray "+ New" button removed — the dropdown's own "Add New Supplier" is enough. */}
                <UniversalDropdown
                  options={vendors.map((v) => ({
                    value: v.id,
                    label: v.vendorName,
                    sublabel: v.gstin ? `GST: ${v.gstin}` : v.contactNo || undefined,
                  }))}
                  value={selectedVendorId}
                  onChange={(val) => {
                    setSelectedVendorId(val);
                    if (formErrors.vendor) setFormErrors((prev) => ({ ...prev, vendor: '' }));
                  }}
                  placeholder="Select Supplier..."
                  addNewLabel="+ Add New Supplier"
                  onAddNew={(name) => {
                    const newV = saveVendor({
                      vendorName: name,
                      contactNo: '',
                      address: '',
                    });
                    setSelectedVendorId(newV.id);
                  }}
                />
                {formErrors.vendor && (
                  <p className="text-xs text-rose-600">{formErrors.vendor}</p>
                )}
                {currentVendor && (
                  <p className="text-[11px] text-slate-500 truncate mt-0.5">
                    Phone: {currentVendor.contactNo} • {currentVendor.address}
                  </p>
                )}
              </div>

              {/* Destination Branch */}
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Destination Branch <span className="text-rose-500">*</span>
                </label>
                <select
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value as BranchId)}
                  disabled={currentUser.role === 'Manager'}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500"
                >
                  {accessibleBranches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.location})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-400">Stock will inward to this warehouse</p>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Order Date
                  </label>
                  <input
                    type="date"
                    value={orderDate}
                    onChange={(e) => setOrderDate(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Expected By
                  </label>
                  <input
                    type="date"
                    value={expectedDeliveryDate}
                    onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Line Items Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Procurement Line Items</h4>
                  <p className="text-xs text-slate-500">
                    Search item catalog with live stock status. Unit cost pre-fills from purchase master and is editable.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddLine}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Line Item</span>
                </button>
              </div>

              {formErrors.lines && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{formErrors.lines}</span>
                </div>
              )}

              <div className="border border-slate-200 rounded-xl overflow-visible shadow-2xs">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-xs font-bold uppercase tracking-wider">
                      <th className="py-2.5 px-3 w-10 text-center">#</th>
                      <th className="py-2.5 px-3 min-w-[280px]">Item Description & Master Stock</th>
                      <th className="py-2.5 px-3 w-40">Vendor SKU</th>
                      <th className="py-2.5 px-3 w-28 text-center">Qty Ordered</th>
                      <th className="py-2.5 px-2 w-12 text-center"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lines.map((line, idx) => (
                      <tr key={line.id} className="hover:bg-slate-50/50 transition-colors">
                        {/* Index */}
                        <td className="py-3 px-3 text-center text-slate-400 font-mono text-xs">
                          {idx + 1}
                        </td>

                        {/* Item Search Autocomplete */}
                        <td className="py-3 px-3 overflow-visible">
                          <ItemSearchDropdown
                            value={line.searchQuery}
                            onChange={(val) => {
                              setLines((prev) => {
                                const next = [...prev];
                                next[idx] = { ...next[idx], searchQuery: val };
                                return next;
                              });
                            }}
                            onSelectItem={(item) => handleSelectItem(idx, item)}
                            selectedBranchId={branchId}
                            placeholder="Type item name or code..."
                            dropdownWidth="w-[420px] max-w-[calc(100vw-2rem)]"
                          />
                          {line.item && (
                            <div className="text-[11px] text-slate-500 font-mono mt-1 flex items-center gap-3">
                              <span>Code: {line.item.itemCode}</span>
                              {line.item.itemHSN && <span>HSN: {line.item.itemHSN}</span>}
                              <span className="font-sans text-slate-600">Unit: {line.item.unit}</span>
                            </div>
                          )}
                        </td>

                        {/* Vendor SKU / part code (entered by staff) */}
                        <td className="py-3 px-3">
                          <input
                            type="text"
                            value={line.vendorSku || ''}
                            onChange={(e) => handleUpdateLineSku(idx, e.target.value)}
                            placeholder="Vendor code"
                            className="w-36 px-2.5 py-1.5 text-sm font-mono border rounded-lg bg-white border-slate-300 focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                          />
                        </td>

                        {/* Quantity */}
                        <td className="py-3 px-3 text-center">
                          <input
                            type="number"
                            min={1}
                            value={line.quantity}
                            onChange={(e) => handleUpdateLineQty(idx, e.target.value)}
                            className="w-20 text-center px-2 py-1.5 text-sm font-semibold border rounded-lg bg-white border-slate-300 focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                          />
                        </td>

                        {/* Remove */}
                        <td className="py-3 px-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveLine(idx)}
                            disabled={lines.length === 1}
                            className={`p-1.5 rounded-lg transition-colors ${
                              lines.length === 1
                                ? 'text-slate-200 cursor-not-allowed'
                                : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
                            }`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Bottom Row: Notes & Order Total */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
              {/* Instructions / Notes */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  Supplier Delivery Notes / Instructions
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="e.g. Urgent shipment via Speed Post / Transport. Include GST tax invoice copy."
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-100 resize-none"
                />
              </div>

              {/* Total Card */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Line Items:</span>
                  <span className="font-bold text-slate-900">{lines.filter((l) => l.item).length} items</span>
                </div>
                <div className="flex items-center justify-between border-t border-slate-200 pt-3">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-600 block">
                      Estimated Order Value
                    </span>
                    <span className="text-[11px] text-slate-500">Purchase price is confirmed while receiving</span>
                  </div>
                  <div className="text-xl sm:text-2xl font-bold text-slate-900 font-mono">
                    {formatCurrency(totalAmount)}
                  </div>
                </div>
              </div>
            </div>
          </form>

          {/* Footer Actions */}
          <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-none cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 active:bg-red-800 rounded-none border border-red-700 shadow-2xs transition-colors cursor-pointer"
            >
              <ShoppingBag className="h-4 w-4" />
              <span>Issue Purchase Order</span>
            </button>
          </div>
        </div>
      </div>

      {/* Quick Add Vendor Modal */}
      <VendorMasterModal
        isOpen={isVendorModalOpen}
        onClose={() => setIsVendorModalOpen(false)}
        onVendorSaved={(v) => setSelectedVendorId(v.id)}
      />
    </>
  );
};
