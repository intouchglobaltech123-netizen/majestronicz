import React, { useState } from 'react';
import { useErp } from '../../context/ErpContext';
import { Item, BranchId, BRANCHES, Enquiry } from '../../types';
import { cn } from '../../lib/utils';
import {
  X,
  User,
  Phone,
  Calendar,
  Clock,
  Boxes,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Receipt,
  Save,
  Bell,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { ItemSearchDropdown } from '../common/ItemSearchDropdown';
import { ImageUploadField } from '../common/ImageUploadField';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSavedAndConvert?: (enquiryId: string, targetType: 'estimate' | 'invoice') => void;
}

export const EnquiryFormModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onSavedAndConvert,
}) => {
  const {
    currentBranch,
    isAllBranches,
    getBranchStock,
    getNextEnquiryNumber,
    saveEnquiry,
    canConvertEnquiry,
  } = useErp();

  // Branch
  const [branchId, setBranchId] = useState<BranchId>(() => {
    return !isAllBranches && currentBranch !== 'all' ? (currentBranch as BranchId) : 'erode-hq';
  });

  // Customer details
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');

  // Mode: 'existing' (Catalog) vs 'new' (New Item — Not in Catalog)
  const [itemMode, setItemMode] = useState<'existing' | 'new'>('existing');

  // Item & Quantity (Existing mode)
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [quantity, setQuantity] = useState<number>(1);

  // New Item Request Fields (New mode)
  const [newItemName, setNewItemName] = useState('');
  const [newItemImageUrl, setNewItemImageUrl] = useState('');
  const [newItemUnit, setNewItemUnit] = useState('Units');

  // Date & Time
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [time, setTime] = useState(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });

  // Expected restock date (for shortage)
  const [expectedRestockDate, setExpectedRestockDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  });

  // Notes
  const [notes, setNotes] = useState('');

  // Follow-up Reminder Scheduling State (explicit prompt, never silently defaulted)
  const [reminderDate, setReminderDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  });
  const [reminderTime, setReminderTime] = useState('11:00');
  const [reminderNotes, setReminderNotes] = useState('');

  if (!isOpen) return null;

  // Check physical stock for currently selected branch
  const branchStock = selectedItem ? getBranchStock(selectedItem.id, branchId) : undefined;
  const currentStock = branchStock?.quantity ?? 0;
  const isInStock = selectedItem ? currentStock >= quantity : false;
  const hasShortage = selectedItem ? currentStock < quantity : false;

  const handleSelectItem = (item: Item) => {
    setSelectedItem(item);
    setSearchQuery(item.itemName);
  };

  const handleSaveOnly = (e: React.FormEvent) => {
    e.preventDefault();

    if (itemMode === 'new') {
      if (!customerName.trim() || !newItemName.trim() || quantity <= 0) {
        toast.error('Please enter customer name, product description, and quantity.');
        return;
      }

      if (!reminderDate || !reminderTime) {
        toast.error('Please specify a Reminder Date and Time for Follow-up.');
        return;
      }

      const generatedNumber = getNextEnquiryNumber(branchId);
      const newEnquiry: Enquiry = {
        id: `enq-${Date.now()}`,
        enquiryNumber: generatedNumber,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim() || undefined,
        itemId: undefined,
        itemName: newItemName.trim(),
        itemCode: undefined,
        unit: newItemUnit.trim() || 'Units',
        quantity,
        branchId,
        date,
        time,
        notes: notes.trim() || undefined,
        status: 'Follow-up',
        isNewItemRequest: true,
        itemImageUrl: newItemImageUrl || undefined,
        reminderDate,
        reminderTime,
        reminderNotes: reminderNotes.trim() || undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      saveEnquiry(newEnquiry);
      onClose();
      return;
    }

    if (!customerName.trim() || !selectedItem || quantity <= 0) {
      toast.error('Please complete all required fields');
      return;
    }

    if (!reminderDate || !reminderTime) {
      toast.error('Please specify a Reminder Date and Time for Follow-up.');
      return;
    }

    const generatedNumber = getNextEnquiryNumber(branchId);
    const newEnquiry: Enquiry = {
      id: `enq-${Date.now()}`,
      enquiryNumber: generatedNumber,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim() || undefined,
      itemId: selectedItem.id,
      itemName: selectedItem.itemName,
      itemCode: selectedItem.itemCode,
      unit: selectedItem.unit,
      quantity,
      branchId,
      date,
      time,
      notes: notes.trim() || undefined,
      status: 'Follow-up',
      reminderDate,
      reminderTime,
      reminderNotes: reminderNotes.trim() || undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    saveEnquiry(newEnquiry, hasShortage ? expectedRestockDate : undefined);
    onClose();
  };

  const handleSaveAndConvert = (targetType: 'estimate' | 'invoice') => {
    if (!customerName.trim() || !selectedItem || quantity <= 0) {
      toast.error('Please complete all required fields');
      return;
    }

    const generatedNumber = getNextEnquiryNumber(branchId);
    const newEnquiry: Enquiry = {
      id: `enq-${Date.now()}`,
      enquiryNumber: generatedNumber,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim() || undefined,
      itemId: selectedItem.id,
      itemName: selectedItem.itemName,
      itemCode: selectedItem.itemCode,
      unit: selectedItem.unit,
      quantity,
      branchId,
      date,
      time,
      notes: notes.trim() || undefined,
      status: 'Follow-up',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    saveEnquiry(newEnquiry, hasShortage ? expectedRestockDate : undefined);
    onClose();
    if (onSavedAndConvert) {
      onSavedAndConvert(newEnquiry.id, targetType);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700">
              <Boxes className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">New Customer Enquiry</h2>
              <p className="text-xs text-slate-500">
                Log buyer requirement, verify branch stock, and route to quotation or pending order
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSaveOnly} className="p-6 overflow-y-auto space-y-4 flex-1">
          {/* Customer Name & Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Customer Name / Firm <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  placeholder="Enter customer name..."
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-600"
                  autoFocus
                />
                <User className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Phone / Mobile Number
              </label>
              <div className="relative">
                <input
                  type="tel"
                  placeholder="e.g. 9842100000"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-600 font-mono"
                />
                <Phone className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </div>
          </div>

          {/* Branch & Date/Time */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Target Branch
              </label>
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value as BranchId)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-600"
              >
                {BRANCHES.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.shortCode})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Enquiry Date
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

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
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
          </div>

          {/* Mode Switcher: Existing Item vs New Item (Not in Catalog) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700">
                Item Requirement Mode <span className="text-rose-500">*</span>
              </label>
              <span className="text-[11px] text-slate-400 font-medium">
                {itemMode === 'existing' ? 'Master Catalog Item' : 'New Item Request'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setItemMode('existing')}
                className={cn(
                  'flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all',
                  itemMode === 'existing'
                    ? 'bg-white text-blue-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                )}
              >
                <Boxes className="h-3.5 w-3.5" />
                <span>Existing Item</span>
              </button>

              <button
                type="button"
                onClick={() => setItemMode('new')}
                className={cn(
                  'flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all',
                  itemMode === 'new'
                    ? 'bg-purple-600 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                )}
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>New Item — Not in Catalog</span>
              </button>
            </div>
          </div>

          {/* MODE A: EXISTING CATALOG ITEM */}
          {itemMode === 'existing' ? (
            <>
              {/* Item Requested Autocomplete Search with Live Stock Display */}
              <div className="space-y-1.5 relative">
                <label className="block text-xs font-bold text-slate-700">
                  Item Requested (Master Catalog) <span className="text-rose-500">*</span>
                </label>
                <ItemSearchDropdown
                  value={searchQuery}
                  onChange={(val) => {
                    setSearchQuery(val);
                    if (selectedItem && selectedItem.itemName !== val) {
                      setSelectedItem(null);
                    }
                  }}
                  onSelectItem={(item) => handleSelectItem(item)}
                  selectedBranchId={branchId}
                  placeholder="Search item name, code, or HSN..."
                  dropdownWidth="w-full"
                  inputClassName="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600"
                  required
                  onClear={() => {
                    setSearchQuery('');
                    setSelectedItem(null);
                  }}
                />
              </div>

              {/* Quantity Requested & Stock status */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Quantity Requested <span className="text-rose-500">*</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      required
                      value={quantity}
                      onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:border-blue-600"
                    />
                    <span className="px-3 py-2 rounded-xl bg-slate-100 text-xs font-semibold text-slate-600 uppercase shrink-0">
                      {selectedItem?.unit || 'Units'}
                    </span>
                  </div>
                </div>

                {/* LIVE AVAILABILITY FEEDBACK PANEL */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Stock Status @ {BRANCHES.find((b) => b.id === branchId)?.shortCode}
                  </label>
                  {selectedItem ? (
                    <div
                      className={cn(
                        'p-2.5 rounded-xl border text-xs flex items-center gap-2.5',
                        isInStock
                          ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
                          : 'bg-amber-50/80 border-amber-200 text-amber-900'
                      )}
                    >
                      {isInStock ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="font-bold block">
                          {isInStock ? 'In Stock (Available)' : 'Stock Shortage'}
                        </span>
                        <span className="text-[11px] opacity-90 block">
                          {currentStock} {selectedItem.unit} in branch (Req: {quantity})
                          {hasShortage && ` • Need ${quantity - currentStock} more`}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-400">
                      Select an item to verify stock
                    </div>
                  )}
                </div>
              </div>

              {/* Expected Restock Date (Shows if out of stock / shortage) */}
              {hasShortage && (
                <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span className="text-xs font-bold text-amber-900">
                      Automatic Pending Order Generation
                    </span>
                  </div>
                  <p className="text-[11px] text-amber-800 leading-relaxed">
                    Saving this enquiry will automatically create a linked <strong>Pending Order</strong> for staff backlog tracking until stock arrives.
                  </p>
                  <div>
                    <label className="block text-[11px] font-bold text-amber-900 mb-1">
                      Expected Restock Arrival Date
                    </label>
                    <input
                      type="date"
                      value={expectedRestockDate}
                      onChange={(e) => setExpectedRestockDate(e.target.value)}
                      className="w-full sm:w-64 px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-600"
                    />
                  </div>
                </div>
              )}
            </>
          ) : (
            /* MODE B: NEW ITEM — NOT IN CATALOG */
            <div className="p-4.5 rounded-2xl bg-purple-50/50 border border-purple-200 space-y-4">
              {/* Informational banner */}
              <div className="flex items-start gap-2.5 text-xs text-purple-950">
                <Sparkles className="h-4 w-4 text-purple-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <span className="font-bold">New Item Request (Not in Catalog)</span>
                  <p className="text-[11px] text-purple-800">
                    This request will be sent to the Manager/CEO queue. Once reviewed and added to the master catalog, it will automatically rejoin the normal procurement flow.
                  </p>
                </div>
              </div>

              {/* Product Name / Technical Description */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Product Name / Description <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required={itemMode === 'new'}
                  placeholder="e.g. Omron Relay MY4N 24VDC, Delta 2.2kW Inverter, custom sensor..."
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-300 text-xs font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-purple-600 focus:ring-1 focus:ring-purple-600"
                />
              </div>

              {/* Photo Upload (Client-side compressed via ImageUploadField) */}
              <ImageUploadField
                value={newItemImageUrl}
                onChange={setNewItemImageUrl}
                label="Product Photo / Drawing"
                sublabel="JPG, PNG, or WEBP (auto-compressed to max 600px)"
                altText="New item reference"
              />

              {/* Quantity Needed & Unit */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Quantity Needed <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
                    className="w-full px-3 py-2 rounded-xl bg-white border border-slate-300 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:border-purple-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Unit of Measure
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Units, PCS, SET, MTR..."
                    value={newItemUnit}
                    onChange={(e) => setNewItemUnit(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 rounded-xl bg-white border border-slate-300 text-xs font-bold text-slate-900 focus:outline-none focus:border-purple-600 font-mono"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Enquiry Notes / Buyer Specifications
            </label>
            <textarea
              rows={2}
              placeholder="e.g. Customer urgently needs for plant maintenance; requested 5% discount on bulk..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-600 font-medium"
            />
          </div>

          {/* Follow-up Reminder Schedule (Prompt required for Follow-up status, never silently defaulted) */}
          <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-amber-700" />
                <span className="text-xs font-bold text-amber-950">
                  Follow-up Reminder Schedule <span className="text-rose-500">*</span>
                </span>
              </div>
              <span className="text-[11px] font-semibold text-amber-700 bg-amber-100/70 px-2 py-0.5 rounded border border-amber-200">
                Notification Bell Alert
              </span>
            </div>
            <p className="text-[11px] text-amber-800">
              When logged in Follow-up status, this reminder creates a linked record and alerts staff in the TopBar Bell on its due date.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-amber-900 mb-1">
                  Reminder Date <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="date"
                    required
                    value={reminderDate}
                    onChange={(e) => setReminderDate(e.target.value)}
                    className="w-full pl-3 pr-8 py-2 rounded-lg bg-white border border-amber-300 text-xs font-semibold text-slate-900 focus:outline-none focus:border-amber-600"
                  />
                  <Calendar className="h-3.5 w-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-amber-900 mb-1">
                  Reminder Time <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="time"
                    required
                    value={reminderTime}
                    onChange={(e) => setReminderTime(e.target.value)}
                    className="w-full pl-3 pr-8 py-2 rounded-lg bg-white border border-amber-300 text-xs font-semibold text-slate-900 focus:outline-none focus:border-amber-600 font-mono"
                  />
                  <Clock className="h-3.5 w-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-amber-900 mb-1">
                Reminder Action / Objective (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Call customer regarding price discount & stock confirmation..."
                value={reminderNotes}
                onChange={(e) => setReminderNotes(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-600"
              />
            </div>
          </div>

          {/* Action Strip */}
          <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Cancel
            </button>

            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
              {/* If in stock and existing item, surface prominent 1-click convert actions (CEO, Manager, Billing only) */}
              {canConvertEnquiry && itemMode === 'existing' && isInStock && (
                <>
                  <button
                    type="button"
                    onClick={() => handleSaveAndConvert('estimate')}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl transition-colors shadow-2xs"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    <span>Save & Convert to Estimate</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSaveAndConvert('invoice')}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl transition-colors shadow-2xs"
                  >
                    <Receipt className="h-3.5 w-3.5" />
                    <span>Save & Convert to Invoice</span>
                  </button>
                </>
              )}

              {/* Standard Save */}
              <button
                type="submit"
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white rounded-xl transition-colors shadow-xs',
                  itemMode === 'new'
                    ? 'bg-purple-600 hover:bg-purple-700'
                    : 'bg-blue-600 hover:bg-blue-700'
                )}
              >
                {itemMode === 'new' ? (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Save New Item Request</span>
                  </>
                ) : (
                  <>
                    <Save className="h-3.5 w-3.5" />
                    <span>{hasShortage ? 'Save & Log Pending Order' : 'Save Enquiry (Follow-up)'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
