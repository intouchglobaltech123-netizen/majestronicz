import React, { useState } from 'react';
import { useErp } from '../../context/ErpContext';
import { Item, BranchId } from '../../types';
import { QueuedBarcodeItem } from '../../types/barcode';
import { formatCurrency, cn } from '../../lib/utils';
import {
  Plus,
  RotateCcw,
  Tag,
  Barcode,
} from 'lucide-react';
import { toast } from 'sonner';
import { ItemSearchDropdown } from '../common/ItemSearchDropdown';

// The barcode/label MRP must match what the bill charges: the tax-INCLUSIVE price.
// If the stored salePrice already includes tax ('with'), use it as-is; otherwise
// ('without') add the item's GST slab on top.
const getInclusivePrice = (item: Item): number =>
  item.salePriceTaxMode === 'with'
    ? item.salePrice
    : item.salePrice * (1 + (item.gstTaxSlab || 0) / 100);

const formatMrp = (item: Item): string =>
  `MRP: ₹${getInclusivePrice(item).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

interface Props {
  onAddToQueue: (item: QueuedBarcodeItem) => void;
  // Controlled form state passed up so BarcodePreviewCard can mirror it in real-time
  itemCode: string;
  setItemCode: (val: string) => void;
  itemName: string;
  setItemName: (val: string) => void;
  header: string;
  setHeader: (val: string) => void;
  line1: string;
  setLine1: (val: string) => void;
  line2: string;
  setLine2: (val: string) => void;
  line3: string;
  setLine3: (val: string) => void;
  line4: string;
  setLine4: (val: string) => void;
}

export const BarcodeForm: React.FC<Props> = ({
  onAddToQueue,
  itemCode,
  setItemCode,
  itemName,
  setItemName,
  header,
  setHeader,
  line1,
  setLine1,
  line2,
  setLine2,
  line3,
  setLine3,
  line4,
  setLine4,
}) => {
  const { branchStocks, currentBranch, isAllBranches, currentBranchData } = useErp();

  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [noOfLabels, setNoOfLabels] = useState<number>(1);

  // Compute live stock for an item
  const getItemStock = (itemId: string): number => {
    if (isAllBranches) {
      return branchStocks
        .filter((s) => s.itemId === itemId)
        .reduce((sum, s) => sum + s.quantity, 0);
    }
    const stock = branchStocks.find((s) => s.itemId === itemId && s.branchId === currentBranch);
    return stock ? stock.quantity : 0;
  };

  // Compute live rack / row location
  const getItemLocation = (itemId: string): string => {
    if (isAllBranches) {
      const locs = branchStocks
        .filter((s) => s.itemId === itemId && s.location)
        .map((s) => `${s.branchId === 'erode-hq' ? 'ERD' : s.branchId === 'coimbatore' ? 'CJB' : 'MAA'}: ${s.location}`);
      return locs.length > 0 ? locs.join(' · ') : 'Unassigned';
    }
    const stock = branchStocks.find((s) => s.itemId === itemId && s.branchId === currentBranch);
    return stock?.location || 'Unassigned';
  };

  // Handle item selection from autocomplete table
  const handleSelectItem = (item: Item) => {
    setSelectedItem(item);
    setSearchQuery(item.itemName);
    setItemName(item.itemName);
    setItemCode(item.itemCode);

    const activeBranchId = isAllBranches ? 'erode-hq' : (currentBranch !== 'all' ? currentBranch : 'erode-hq');
    const stockRow = branchStocks.find((s) => s.itemId === item.id && s.branchId === activeBranchId);

    // Smart pre-fill for sticker lines
    setHeader('MAJESTRONICZ');
    setLine1(formatMrp(item));
    setLine2(`HSN: ${item.itemHSN} • ${item.category}`);
    setLine3(`Warranty: 1 Year Comprehensive`);
    setLine4(stockRow?.location ? `Rack: ${stockRow.location}` : `Loc: ${isAllBranches ? 'All Branches' : currentBranchData?.shortCode || 'ERD'}`);
  };

  // Reset/Clear form
  const handleReset = () => {
    setSelectedItem(null);
    setSearchQuery('');
    setItemName('');
    setItemCode('');
    setHeader('');
    setLine1('');
    setLine2('');
    setLine3('');
    setLine4('');
    setNoOfLabels(1);
  };

  // Auto-fill standard sticker lines shortcut
  const handleAutoFill = () => {
    if (!selectedItem) {
      toast.error('Please pick an item first to autofill details');
      return;
    }
    setHeader('MAJESTRONICZ');
    setLine1(formatMrp(selectedItem));
    setLine2(`HSN: ${selectedItem.itemHSN} • ${selectedItem.category}`);
    setLine3(`Model: ${selectedItem.itemCode}`);
    setLine4(`PKD: 09/2026 • ${isAllBranches ? 'HQ' : currentBranchData?.shortCode || 'ERD'}`);
    toast.success('Autofilled standard retail label text');
  };

  // Add configured item to the queue
  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) {
      toast.error('Please select an item');
      return;
    }
    if (noOfLabels < 1) {
      toast.error('Number of labels must be at least 1');
      return;
    }

    const currentStock = getItemStock(selectedItem.id);

    const queuedItem: QueuedBarcodeItem = {
      id: `queue-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      itemId: selectedItem.id,
      itemCode: itemCode || selectedItem.itemCode,
      itemName: itemName || selectedItem.itemName,
      salePrice: selectedItem.salePrice,
      purchasePrice: selectedItem.purchasePrice,
      stock: currentStock,
      noOfLabels: Number(noOfLabels),
      header: header.trim(),
      line1: line1.trim(),
      line2: line2.trim(),
      line3: line3.trim(),
      line4: line4.trim(),
    };

    onAddToQueue(queuedItem);
    toast.success(`Queued ${noOfLabels} label(s) for "${queuedItem.itemName}"`);
  };

  return (
    <div className="bg-white border border-slate-300 rounded-none p-5 shadow-xs">
      <div className="flex items-center justify-between pb-3 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-none bg-red-50 border border-red-200 flex items-center justify-center text-red-700">
            <Barcode className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Configure Item Barcode</h2>
            <p className="text-[11px] text-slate-500">
              Lookup items & queue copies for printing
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {selectedItem && (
            <button
              type="button"
              onClick={handleAutoFill}
              className="text-[11px] text-red-700 hover:text-red-800 bg-red-50 hover:bg-red-100 font-bold px-2 py-1 rounded-none border border-red-200 flex items-center gap-1 transition-colors"
              title="Reset lines to standard MRP / HSN tags"
            >
              <Tag className="h-3 w-3" />
              <span>Standard Tags</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleReset}
            className="text-[11px] text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-none border border-slate-300 flex items-center gap-1 transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      <form onSubmit={handleAdd} className="mt-4 space-y-4">
        {/* Top Row: Item Name Autocomplete & Item Code */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Autocomplete Dropdown */}
          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Item Name <span className="text-red-600">*</span>
            </label>
            <ItemSearchDropdown
              value={searchQuery}
              onChange={(val) => {
                setSearchQuery(val);
                setItemName(val);
                if (selectedItem && val !== selectedItem.itemName) {
                  setSelectedItem(null);
                }
              }}
              onSelectItem={(item) => handleSelectItem(item)}
              selectedBranchId={isAllBranches ? 'all' : (currentBranch as BranchId)}
              placeholder="Type to search items by name or code..."
              dropdownWidth="w-full"
              inputClassName="w-full text-xs bg-white border border-slate-300 rounded-none px-3 py-2.5 focus:outline-none focus:border-red-600"
              onClear={() => {
                setSearchQuery('');
                setSelectedItem(null);
                setItemName('');
                setItemCode('');
              }}
            />
          </div>

          {/* Item Code (Auto-fills, read-only) */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Item Code
            </label>
            <input
              type="text"
              readOnly
              value={itemCode}
              placeholder="Auto-filled on selection"
              className="w-full text-xs font-mono font-bold bg-slate-50 border border-slate-300 rounded-none px-3 py-2.5 text-slate-800 cursor-not-allowed"
            />
          </div>
        </div>

        {/* Selected Item Stock & Price Live Bar */}
        {selectedItem && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-50 border border-slate-300 rounded-none text-xs text-slate-700">
            <div className="flex flex-wrap items-center gap-3">
              <span>
                Sale Price: <strong>{formatCurrency(selectedItem.salePrice)}</strong>
              </span>
              <span className="text-slate-300">•</span>
              <span>
                Branch Stock: <strong>{getItemStock(selectedItem.id)} {selectedItem.unit}</strong>{' '}
                ({isAllBranches ? 'Combined' : currentBranchData?.shortCode})
              </span>
              <span className="text-slate-300">•</span>
              <span>
                Location: <strong className="font-mono text-slate-900 font-bold">{getItemLocation(selectedItem.id)}</strong>
              </span>
            </div>
            <div className="flex items-center gap-2">
              {selectedItem.subcategory && (
                <span className="text-[10px] text-slate-600 bg-white px-2 py-0.5 rounded-none border border-slate-300 font-medium">
                  {selectedItem.subcategory}
                </span>
              )}
              <span className="text-[11px] text-slate-800 font-bold bg-white px-2 py-0.5 rounded-none border border-slate-300">
                HSN: {selectedItem.itemHSN}
              </span>
            </div>
          </div>
        )}

        {/* Second Row: No of Labels & Header */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              No. of Labels <span className="text-red-600">*</span>
            </label>
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => setNoOfLabels((prev) => Math.max(1, prev - 1))}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 border border-r-0 border-slate-300 rounded-none text-xs font-bold"
              >
                -
              </button>
              <input
                type="number"
                min="1"
                max="5000"
                value={noOfLabels === 0 ? '' : noOfLabels}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setNoOfLabels(Number.isNaN(n) ? 0 : Math.min(5000, Math.max(0, n)));
                }}
                onBlur={() => { if (noOfLabels < 1) setNoOfLabels(1); }}
                className="w-full text-center text-xs font-bold border-y border-slate-300 py-2 focus:outline-none focus:border-red-600 rounded-none"
              />
              <button
                type="button"
                onClick={() => setNoOfLabels((prev) => prev + 1)}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 border border-l-0 border-slate-300 rounded-none text-xs font-bold"
              >
                +
              </button>
            </div>
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Header Text <span className="text-slate-400 font-normal">(Printed above barcode)</span>
            </label>
            <input
              type="text"
              value={header}
              onChange={(e) => setHeader(e.target.value)}
              placeholder="e.g. MAJESTRONICZ"
              className="w-full text-xs bg-white border border-slate-300 rounded-none px-3 py-2 focus:outline-none focus:border-red-600"
            />
          </div>
        </div>

        {/* Optional Lines Row (Line 1 to 4) */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-slate-700">
              Optional Sticker Lines <span className="text-slate-400 font-normal">(Printed below barcode)</span>
            </label>
            <span className="text-[10px] text-slate-400">All fields optional</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <input
                type="text"
                value={line1}
                onChange={(e) => setLine1(e.target.value)}
                placeholder="Line 1: e.g. MRP: ₹1,200.00"
                className="w-full text-xs bg-white border border-slate-300 rounded-none px-3 py-2 focus:outline-none focus:border-red-600"
              />
            </div>
            <div>
              <input
                type="text"
                value={line2}
                onChange={(e) => setLine2(e.target.value)}
                placeholder="Line 2: e.g. Incl. of all taxes"
                className="w-full text-xs bg-white border border-slate-300 rounded-none px-3 py-2 focus:outline-none focus:border-red-600"
              />
            </div>
            <div>
              <input
                type="text"
                value={line3}
                onChange={(e) => setLine3(e.target.value)}
                placeholder="Line 3: e.g. Warranty: 1 Year"
                className="w-full text-xs bg-white border border-slate-300 rounded-none px-3 py-2 focus:outline-none focus:border-red-600"
              />
            </div>
            <div>
              <input
                type="text"
                value={line4}
                onChange={(e) => setLine4(e.target.value)}
                placeholder="Line 4: e.g. PKD: 09/2026"
                className="w-full text-xs bg-white border border-slate-300 rounded-none px-3 py-2 focus:outline-none focus:border-red-600"
              />
            </div>
          </div>
        </div>

        {/* Action Button: Add for Barcode */}
        <div className="pt-2 flex justify-end">
          <button
            type="submit"
            disabled={!selectedItem}
            className={cn(
              'px-5 py-2 rounded-none text-xs font-bold transition-all shadow-none flex items-center gap-2',
              selectedItem
                ? 'bg-red-600 hover:bg-red-700 active:bg-red-800 text-white border border-red-700 cursor-pointer'
                : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
            )}
          >
            <Plus className="h-4 w-4" />
            <span>Add for Barcode</span>
          </button>
        </div>
      </form>
    </div>
  );
};
