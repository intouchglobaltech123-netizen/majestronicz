import React, { useState, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import {
  Item,
  SalePriceTaxMode,
  DiscountType,
  BRANCHES,
  MARGIN_CATEGORIES,
  computeMarginSalePrice,
} from '../../types';
import {
  X,
  Building,
  Calculator,
  ArrowRight,
  History,
  MapPin,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { UniversalDropdown } from '../common/UniversalDropdown';
import { ItemHistoryTab } from './ItemHistoryTab';
import { ItemImage } from '../common/ItemImage';
import { ImageUploadField } from '../common/ImageUploadField';
import { ImageViewModal } from '../common/ImageViewModal';

interface Props {
  item: Item | null;
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'pricing' | 'stock' | 'history';
}

export const EditItemModal: React.FC<Props> = ({ item, isOpen, onClose, initialTab }) => {
  const {
    items,
    updateItem,
    getBranchStock,
    canManageItems,
    currentUser,
    navigateToInventoryItem,
    categories,
    subcategoriesByCategory,
    addCategory,
    addSubcategory,
    unitsList,
    addUnit,
    gstSlabsList,
    addGstSlab,
    hasFlag,
  } = useErp();

  const [activeTab, setActiveTab] = useState<'pricing' | 'stock' | 'history'>(
    () => initialTab || 'pricing'
  );

  // Master Item details
  const [itemName, setItemName] = useState('');
  const [itemHSN, setItemHSN] = useState('');
  const [category, setCategory] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [marginCategory, setMarginCategory] = useState<'A' | 'B' | 'C' | 'D' | ''>('');
  const [itemCode, setItemCode] = useState('');
  const [unit, setUnit] = useState('PCS');
  const [imageUrl, setImageUrl] = useState('');
  const [description, setDescription] = useState('');
  const [zoomImage, setZoomImage] = useState(false);

  // Static Master Pricing fields
  const [salePrice, setSalePrice] = useState<number | ''>('');
  const [salePriceTaxMode, setSalePriceTaxMode] = useState<SalePriceTaxMode>('without');
  const [discountOnSalePrice, setDiscountOnSalePrice] = useState<number | ''>(0);
  const [discountType, setDiscountType] = useState<DiscountType>('%');
  const [wholesalePrice, setWholesalePrice] = useState<number | ''>('');
  const [minWholesaleQty, setMinWholesaleQty] = useState<number | ''>(1);
  const [purchasePrice, setPurchasePrice] = useState<number | ''>('');
  const [gstTaxSlab, setGstTaxSlab] = useState<number>(18);

  // Low Stock Alert Threshold (per-item master)
  const [reorderThreshold, setReorderThreshold] = useState<number | ''>(10);

  // Populate the form ONCE per opened item. Keyed on item id + open state (NOT
  // the item object reference or subcategoriesByCategory), so a background
  // live-sync re-bootstrap does not re-run this and wipe in-progress edits.
  useEffect(() => {
    if (isOpen && item) {
      setItemName(item.itemName);
      setItemHSN(item.itemHSN);
      setCategory(item.category);
      const subList = subcategoriesByCategory[item.category] || ['General'];
      setSubcategory(item.subcategory || subList[0] || 'General');
      setMarginCategory((item.marginCategory as 'A' | 'B' | 'C' | 'D') || '');
      setItemCode(item.itemCode);
      setUnit(item.unit);
      setImageUrl(item.imageUrl || '');
      setDescription(item.description || '');

      setSalePrice(item.salePrice);
      setSalePriceTaxMode(item.salePriceTaxMode);
      setDiscountOnSalePrice(item.discountOnSalePrice ?? 0);
      setDiscountType(item.discountType ?? '%');
      setWholesalePrice(item.wholesalePrice);
      setMinWholesaleQty(item.minWholesaleQty);
      setPurchasePrice(item.purchasePrice);
      setGstTaxSlab(item.gstTaxSlab);
      setReorderThreshold(item.reorderThreshold ?? 10);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, isOpen]);

  // Set the active tab only when the modal opens or the requested tab changes —
  // never on a background re-render, which previously snapped the user back to
  // the initial tab after a few seconds.
  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialTab]);

  // Margin band A/B/C → auto-fill Sale Price = Purchase Price + margin (e.g. A: 100 → 135).
  useEffect(() => {
    const sp = computeMarginSalePrice(Number(purchasePrice) || 0, marginCategory);
    if (sp != null) setSalePrice(sp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchasePrice, marginCategory]);

  if (!isOpen || !item) return null;

  const calculateEffectiveCustomerPrice = () => {
    const rawSale = Number(salePrice) || 0;
    let afterDiscount = rawSale;
    if (discountType === '%') {
      afterDiscount = rawSale - (rawSale * (Number(discountOnSalePrice) || 0)) / 100;
    } else {
      afterDiscount = Math.max(0, rawSale - (Number(discountOnSalePrice) || 0));
    }

    if (salePriceTaxMode === 'with') {
      return {
        basePrice: afterDiscount / (1 + gstTaxSlab / 100),
        taxAmount: afterDiscount - afterDiscount / (1 + gstTaxSlab / 100),
        finalPrice: afterDiscount,
      };
    } else {
      return {
        basePrice: afterDiscount,
        taxAmount: (afterDiscount * gstTaxSlab) / 100,
        finalPrice: afterDiscount + (afterDiscount * gstTaxSlab) / 100,
      };
    }
  };

  const effective = calculateEffectiveCustomerPrice();

  const handleSave = () => {
    if (!canManageItems) {
      toast.error('Permission denied: You do not have permission to edit items');
      return;
    }

    if (!itemName.trim()) {
      toast.error('Item Name is required');
      return;
    }

    // #5 Enforce item-code uniqueness across all other items (exclude self)
    const finalItemCode = itemCode.trim();
    // An item must always keep a code — a blank one prints the barcode as
    // "SAMPLE" and breaks lookups (INV-6).
    if (!finalItemCode) {
      toast.error('Item code is required. Use Auto Assign if unsure.');
      return;
    }
    const codeExists = items.some(
      (it) => it.id !== item.id && (it.itemCode || '').trim().toLowerCase() === finalItemCode.toLowerCase()
    );
    if (codeExists) {
      toast.error(`Item code "${finalItemCode}" already exists on another item.`);
      return;
    }

    // Reject negative money (INV-9).
    if (Number(salePrice) < 0 || Number(purchasePrice) < 0 || Number(wholesalePrice) < 0) {
      toast.error('Prices cannot be negative.');
      return;
    }

    // HSN, when provided, must be a valid 4/6/8-digit numeric code (INV-10).
    const hsnTrimmed = itemHSN.trim();
    if (hsnTrimmed && !/^\d{4}(\d{2}(\d{2})?)?$/.test(hsnTrimmed)) {
      toast.error('HSN code must be 4, 6, or 8 digits (numbers only).');
      return;
    }

    // GST slab must be one of the statutory rates (INV-24).
    const VALID_GST_SLABS = [0, 5, 12, 18, 28];
    if (!VALID_GST_SLABS.includes(gstTaxSlab)) {
      toast.error('GST rate must be one of 0%, 5%, 12%, 18%, or 28%.');
      return;
    }

    // Update Item and Pricing (Stock changes stay exclusively in Inventory)
    updateItem(item.id, {
      itemName: itemName.trim(),
      itemHSN: itemHSN.trim(),
      category,
      subcategory: subcategory.trim() || undefined,
      marginCategory: marginCategory || undefined,
      itemCode: itemCode.trim(),
      unit,
      imageUrl: imageUrl.trim() || undefined,
      description: description.trim() || undefined,
      salePrice: Number(salePrice) || 0,
      salePriceTaxMode,
      wholesalePrice: Number(wholesalePrice) || 0,
      minWholesaleQty: Number(minWholesaleQty) || 1,
      purchasePrice: Number(purchasePrice) || 0,
      gstTaxSlab,
      discountOnSalePrice: Number(discountOnSalePrice) || 0,
      discountType,
      reorderThreshold: reorderThreshold === '' ? 10 : Math.max(0, Number(reorderThreshold)),
    });

    toast.success('Item details updated successfully');
    onClose();
  };

  const handleNavigateToInventory = () => {
    onClose();
    navigateToInventoryItem(item.itemCode);
  };

  const availableSubcategories = subcategoriesByCategory[category] || ['General'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white border border-slate-300 rounded-none w-full max-w-4xl lg:max-w-5xl shadow-xl overflow-hidden flex flex-col max-h-[92vh] text-slate-900">
        {/* Modal Header */}
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => { if (imageUrl || item.imageUrl) setZoomImage(true); }}
              className={cn('shrink-0 rounded-none', (imageUrl || item.imageUrl) ? 'cursor-zoom-in hover:ring-2 hover:ring-red-300 transition-all' : 'cursor-default')}
              title={(imageUrl || item.imageUrl) ? 'Click to enlarge' : undefined}
            >
              <ItemImage
                src={imageUrl || item.imageUrl}
                alt={item.itemName}
                className="h-14 w-14 rounded-none border border-slate-300 object-cover"
                iconClassName="h-6 w-6"
              />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-900">
                  {activeTab === 'history'
                    ? 'Item History & Analytics'
                    : canManageItems
                    ? 'Edit Item'
                    : 'Item Details'}
                </h2>
                {!canManageItems && (
                  <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-none bg-slate-100 text-slate-700 border border-slate-300">
                    Read-Only
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500">
                Item Code: <span className="font-mono text-red-700 font-bold">{item.itemCode}</span>
                {item.subcategory && (
                  <span className="text-slate-400"> • {item.category} / {item.subcategory}</span>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-none text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors border border-transparent hover:border-slate-300 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 bg-white">
          {/* Item Details */}
          <div className="bg-slate-50 p-4 rounded-none border border-slate-200 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-bold text-slate-700">
                  Item Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-none bg-white border border-slate-300 text-slate-900 text-sm focus:outline-none focus:border-red-600"
                />
              </div>

              {/* Description / Technical Specs (Optional) */}
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                  <span>Description / Technical Specs</span>
                  <span className="text-[11px] text-slate-400 font-normal">Optional</span>
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Enter detailed technical specifications, voltage/pinout ratings, variations, or internal staff notes..."
                  className="w-full px-3.5 py-2 rounded-none bg-white border border-slate-300 text-slate-900 placeholder-slate-400 text-xs focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-500 transition-colors resize-y"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700">HSN / SAC Code</label>
                <input
                  type="text"
                  value={itemHSN}
                  inputMode="numeric"
                  onChange={(e) => setItemHSN(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  className="w-full px-3.5 py-2 rounded-none bg-white border border-slate-300 text-slate-900 text-sm font-mono focus:outline-none focus:border-red-600"
                />
              </div>

              {/* Category */}
              <UniversalDropdown
                label="Category"
                value={category}
                onChange={(cat) => {
                  setCategory(cat);
                  const subList = subcategoriesByCategory[cat] || ['General'];
                  if (!subList.includes(subcategory)) {
                    setSubcategory(subList[0] || 'General');
                  }
                }}
                options={categories.map((c) => ({ value: c, label: c }))}
                addNewLabel="+ Add New Category"
                addNewPlaceholder="e.g. Industrial IoT"
                onAddNew={(cat) => {
                  addCategory(cat);
                  setCategory(cat);
                  const subList = subcategoriesByCategory[cat] || ['General'];
                  setSubcategory(subList[0] || 'General');
                }}
              />

              {/* Subcategory */}
              <UniversalDropdown
                label="Subcategory"
                value={subcategory}
                onChange={(sub) => setSubcategory(sub)}
                options={availableSubcategories.map((s) => ({ value: s, label: s }))}
                addNewLabel="+ Add New Subcategory"
                addNewPlaceholder="e.g. Modbus Gateways"
                onAddNew={(sub) => {
                  addSubcategory(category, sub);
                  setSubcategory(sub);
                }}
              />

              {/* Margin / profit band (A 35% · B 25% · C 15% · D custom) */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-700">Margin Category</label>
                <select
                  value={marginCategory}
                  onChange={(e) => setMarginCategory(e.target.value as 'A' | 'B' | 'C' | 'D' | '')}
                  className="w-full px-3 py-2 rounded-none bg-white border border-slate-300 text-sm font-semibold text-slate-900 focus:outline-none focus:border-red-600"
                >
                  <option value="">— None —</option>
                  {MARGIN_CATEGORIES.map((m) => (
                    <option key={m.code} value={m.code}>{m.label}</option>
                  ))}
                </select>
              </div>

              {/* Item Code */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700">Item Code</label>
                <input
                  type="text"
                  value={itemCode}
                  onChange={(e) => setItemCode(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-none bg-white border border-slate-300 text-slate-900 text-sm font-mono focus:outline-none focus:border-red-600"
                />
              </div>

              {/* Unit */}
              <UniversalDropdown
                label="Unit of Measurement"
                value={unit}
                onChange={(u) => setUnit(String(u))}
                options={unitsList.map((u) => ({ value: u.value, label: u.label }))}
                addNewLabel="+ Add New Unit"
                addNewPlaceholder="e.g. ROLL"
                onAddNew={(u) => {
                  addUnit(u);
                  setUnit(u.toUpperCase());
                }}
              />

              {/* Product Image File Upload with Live Thumbnail Preview */}
              <div className="md:col-span-2">
                <ImageUploadField
                  value={imageUrl}
                  onChange={setImageUrl}
                  disabled={!canManageItems}
                  label="Product Image"
                  altText={itemName || 'Preview'}
                />
              </div>

              {/* Physical Shelf Locations per branch */}
              {item && (
                <div className="md:col-span-2 p-3 rounded-none bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                    <MapPin className="h-3.5 w-3.5 text-red-700" />
                    <span>Physical Shelf Locations (Rack/Row):</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {BRANCHES.map((b) => {
                      const bStock = getBranchStock(item.id, b.id);
                      const loc = bStock?.location?.trim();
                      return (
                        <span
                          key={b.id}
                          className={cn(
                            'inline-flex items-center gap-1 px-2 py-0.5 rounded-none text-[11px] font-mono border',
                            loc
                              ? 'bg-white border-slate-300 text-slate-800'
                              : 'bg-slate-100 border-dashed border-slate-300 text-slate-400'
                          )}
                        >
                          <span className="font-semibold text-slate-600">{b.name}:</span>
                          <span>{loc || 'Unassigned'}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Pricing vs Stock Tabs */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-200">
              <button
                type="button"
                onClick={() => setActiveTab('pricing')}
                className={cn(
                  'pb-2.5 px-4 text-xs font-bold transition-all relative border-b-2 -mb-[1px]',
                  activeTab === 'pricing'
                    ? 'border-red-600 text-red-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                )}
              >
                Pricing
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('stock')}
                className={cn(
                  'pb-2.5 px-4 text-xs font-bold transition-all relative border-b-2 -mb-[1px] flex items-center gap-1.5',
                  activeTab === 'stock'
                    ? 'border-red-600 text-red-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                )}
              >
                <span>Stock by Branch</span>
                <span className="text-[11px] px-1.5 py-0.2 rounded-none bg-slate-100 text-slate-600 font-semibold">
                  Read-Only
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className={cn(
                  'pb-2.5 px-4 text-xs font-bold transition-all relative border-b-2 -mb-[1px] flex items-center gap-1.5',
                  activeTab === 'history'
                    ? 'border-red-600 text-red-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                )}
              >
                <History className="h-3.5 w-3.5" />
                <span>Item History</span>
              </button>
            </div>

            {/* PRICING TAB */}
            {activeTab === 'pricing' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                      <span>Sale Price (₹)</span>
                      <span className="text-[11px] text-slate-400">Price across all branches</span>
                    </label>
                    <input
                      type="number"
                      placeholder="0.00"
                      min="0"
                      step="any"
                      value={salePrice}
                      onChange={(e) =>
                        setSalePrice(e.target.value === '' ? '' : Number(e.target.value))
                      }
                      className="w-full px-3.5 py-2 rounded-none bg-white border border-slate-300 text-slate-900 text-sm font-semibold focus:outline-none focus:border-red-600"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                      <span>Standard Discount</span>
                      <span className="text-[11px] text-slate-400">Default discount scheme</span>
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        placeholder="0"
                        min="0"
                        step="any"
                        value={discountOnSalePrice}
                        onChange={(e) =>
                          setDiscountOnSalePrice(
                            e.target.value === '' ? '' : Number(e.target.value)
                          )
                        }
                        className="flex-1 px-3.5 py-2 rounded-none bg-white border border-slate-300 text-slate-900 text-sm font-semibold focus:outline-none focus:border-red-600"
                      />
                      <select
                        value={discountType}
                        onChange={(e) => setDiscountType(e.target.value as DiscountType)}
                        className="px-3 py-2 rounded-none bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-700 focus:outline-none"
                      >
                        <option value="%">% (Percentage)</option>
                        <option value="amount">₹ (Fixed Amount)</option>
                      </select>
                    </div>
                  </div>

                  {currentUser.role !== 'Sales' && (
                    <>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-700">
                          <span>Wholesale Price (₹)</span>
                        </label>
                        <input
                          type="number"
                          placeholder="0.00"
                          min="0"
                          step="any"
                          value={wholesalePrice}
                          onChange={(e) =>
                            setWholesalePrice(e.target.value === '' ? '' : Number(e.target.value))
                          }
                          className="w-full px-3.5 py-2 rounded-none bg-white border border-slate-300 text-slate-900 text-sm focus:outline-none focus:border-red-600"
                        />
                      </div>

                      {hasFlag('view.purchaseCost') && (
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                          <span>Purchase Price (₹)</span>
                          <span className="text-[11px] text-slate-400">Default purchase cost</span>
                        </label>
                        <input
                          type="number"
                          placeholder="0.00"
                          min="0"
                          step="any"
                          value={purchasePrice}
                          onChange={(e) =>
                            setPurchasePrice(e.target.value === '' ? '' : Number(e.target.value))
                          }
                          className="w-full px-3.5 py-2 rounded-none bg-white border border-slate-300 text-slate-900 text-sm focus:outline-none focus:border-red-600"
                        />
                        <p className="text-[11px] text-slate-500">
                          Default cost — used as starting point for Purchase Orders, editable per order
                        </p>
                      </div>
                      )}

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                          <span>Min Wholesale Quantity</span>
                          <span className="text-[11px] text-slate-400">Bulk threshold</span>
                        </label>
                        <input
                          type="number"
                          placeholder="1"
                          min="1"
                          value={minWholesaleQty}
                          onChange={(e) =>
                            setMinWholesaleQty(e.target.value === '' ? '' : Number(e.target.value))
                          }
                          className="w-full px-3.5 py-2 rounded-none bg-white border border-slate-300 text-slate-900 text-sm focus:outline-none focus:border-red-600"
                        />
                      </div>
                    </>
                  )}

                  {/* GST Tax Slab with UniversalDropdown */}
                  <UniversalDropdown
                    label="GST Tax Slab"
                    value={gstTaxSlab}
                    onChange={(val) => setGstTaxSlab(Number(val))}
                    options={gstSlabsList.map((g) => ({
                      value: g.rate,
                      label: g.label,
                    }))}
                    addNewLabel="+ Add New Tax Slab"
                    addNewPlaceholder="Enter rate (e.g. 12)..."
                    onAddNew={(val) => {
                      const num = parseFloat(val.replace(/[^0-9.]/g, ''));
                      if (!isNaN(num)) {
                        addGstSlab(num);
                        setGstTaxSlab(num);
                      }
                    }}
                  />
                </div>

                {/* Net Price breakdown */}
                <div className="p-3.5 rounded-none bg-slate-50 border border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calculator className="h-4 w-4 text-slate-600" />
                    <span className="text-xs font-semibold text-slate-700">
                      Standard Net Billing Price:
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-base font-extrabold text-slate-900 font-mono">
                      ₹{effective.finalPrice.toFixed(2)}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      (Base ₹{effective.basePrice.toFixed(2)} + GST ₹{effective.taxAmount.toFixed(2)})
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* READ-ONLY STOCK BY BRANCH TAB */}
            {activeTab === 'stock' && (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 bg-slate-50 border border-slate-300 rounded-none">
                  <div>
                    <h3 className="text-xs font-bold text-slate-900">Branch Stock Overview</h3>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                      Stock quantities are managed exclusively in the Inventory module via transfers & adjustments.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleNavigateToInventory}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-none border border-red-700 text-xs font-bold shadow-none transition-colors shrink-0 cursor-pointer"
                  >
                    <span>Manage Stock</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Read-Only Mini-Table */}
                <div className="border border-slate-200 rounded-none overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[11px] tracking-wider">
                      <tr>
                        <th className="py-2.5 px-4">Branch</th>
                        <th className="py-2.5 px-4">Location / Rack</th>
                        <th className="py-2.5 px-4 text-right">Available Stock</th>
                        <th className="py-2.5 px-4 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {BRANCHES.map((b) => {
                        const stock = getBranchStock(item.id, b.id);
                        const qty = stock?.quantity ?? 0;
                        const threshold = Number(reorderThreshold) || (item.reorderThreshold ?? 10);
                        return (
                          <tr key={b.id} className="hover:bg-slate-50/60 transition-colors">
                            <td className="py-3 px-4 font-bold text-slate-900">
                              <div className="flex items-center gap-2">
                                <Building className="h-3.5 w-3.5 text-slate-600" />
                                <span>{b.name}</span>
                                {b.isHq && (
                                  <span className="text-[11px] uppercase font-bold px-1.5 py-0.2 rounded-none bg-slate-100 text-slate-700 border border-slate-200">
                                    HQ
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-[11px]">
                              <div className="text-slate-700 font-medium">{b.location}</div>
                              <div className="text-slate-500 font-mono mt-0.5">
                                {stock?.location?.trim() ? (
                                  <span className="inline-flex items-center gap-1 font-bold text-slate-800 bg-slate-100 px-1.5 py-0.2 rounded-none border border-slate-300">
                                    Rack: {stock.location.trim()}
                                  </span>
                                ) : (
                                  <span className="text-slate-400 italic">No rack assigned</span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <span className="font-extrabold text-sm text-slate-900 font-mono">
                                {qty}
                              </span>{' '}
                              <span className="text-[11px] text-slate-500 font-semibold">{unit}</span>
                            </td>
                            <td className="py-3 px-4 text-center">
                              {qty > threshold ? (
                                <span className="text-[11px] font-bold px-2 py-0.5 rounded-none bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  In Stock
                                </span>
                              ) : qty > 0 ? (
                                <span className="text-[11px] font-bold px-2 py-0.5 rounded-none bg-amber-50 text-amber-700 border border-amber-200">
                                  Low Stock
                                </span>
                              ) : (
                                <span className="text-[11px] font-bold px-2 py-0.5 rounded-none bg-rose-50 text-rose-700 border border-rose-200">
                                  Out of Stock
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-slate-100 border-t-2 border-slate-300 font-bold text-slate-900">
                      <tr>
                        <td colSpan={2} className="py-3 px-4 text-xs font-bold text-slate-900 uppercase tracking-wide">
                          Total (All Branches)
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className="text-base font-bold text-slate-900 font-mono">
                            {BRANCHES.reduce((sum, b) => sum + (getBranchStock(item.id, b.id)?.quantity ?? 0), 0)}
                          </span>{' '}
                          <span className="text-[11px] text-slate-700 font-bold">{unit}</span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          {(() => {
                            const totalQty = BRANCHES.reduce((sum, b) => sum + (getBranchStock(item.id, b.id)?.quantity ?? 0), 0);
                            const threshold = Number(reorderThreshold) || (item.reorderThreshold ?? 10);
                            if (totalQty === 0) {
                              return <span className="text-[11px] font-bold px-2 py-0.5 rounded-none bg-rose-50 text-rose-700 border border-rose-200">Out of Stock</span>;
                            } else if (totalQty <= threshold) {
                              return <span className="text-[11px] font-bold px-2 py-0.5 rounded-none bg-amber-50 text-amber-700 border border-amber-200">Low Stock</span>;
                            } else {
                              return <span className="text-[11px] font-bold px-2 py-0.5 rounded-none bg-emerald-50 text-emerald-700 border border-emerald-200">In Stock</span>;
                            }
                          })()}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Low Stock Alert Threshold (Catalog-wide item setting) */}
                <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-amber-900">Low Stock Alert Threshold</p>
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      Triggers "Low Stock" warning whenever branch quantity drops to or below this count.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-bold text-slate-700">Threshold:</span>
                    <input
                      type="number"
                      min="0"
                      value={reorderThreshold}
                      onChange={(e) => setReorderThreshold(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-24 px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-slate-900 font-bold text-sm focus:outline-none focus:border-amber-500 text-center"
                    />
                    <span className="text-xs font-semibold text-slate-500">{unit}</span>
                  </div>
                </div>
              </div>
            )}

            {/* ITEM HISTORY TAB */}
            {activeTab === 'history' && (
              <ItemHistoryTab item={item} onCloseParentModal={onClose} />
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-none text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 cursor-pointer transition-colors"
          >
            {activeTab === 'history' || !canManageItems ? 'Close' : 'Cancel'}
          </button>

          {canManageItems && activeTab !== 'history' && (
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-1.5 rounded-none text-xs font-bold text-white bg-red-600 hover:bg-red-700 border border-red-700 shadow-2xs transition-all cursor-pointer"
            >
              Save Changes
            </button>
          )}
        </div>
      </div>

      {/* Full Image Preview Modal */}
      <ImageViewModal
        isOpen={zoomImage}
        onClose={() => setZoomImage(false)}
        src={imageUrl || item.imageUrl}
        title={item.itemName}
        subtitle={`Item Code: ${item.itemCode}`}
      />
    </div>
  );
};
