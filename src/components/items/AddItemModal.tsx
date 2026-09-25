import React, { useState, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import { Item, SalePriceTaxMode, DiscountType, MARGIN_CATEGORIES, computeMarginSalePrice } from '../../types';
import {
  X,
  Plus,
  Search,
  Calculator,
  PackageCheck,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { UniversalDropdown } from '../common/UniversalDropdown';
import { ImageUploadField } from '../common/ImageUploadField';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialValues?: {
    itemName?: string;
    imageUrl?: string;
  };
  onItemAdded?: (newItem: Item) => void;
}

const COMMON_HSN_CODES = [
  { code: '85371000', desc: 'Control boards, PLC, Numerical controls' },
  { code: '85015210', desc: 'AC Servo & Multi-phase motors' },
  { code: '85365090', desc: 'Sensors, Proximity & Photo switches' },
  { code: '85044090', desc: 'SMPS & Power converters' },
  { code: '85364900', desc: 'Relays & Contactors' },
  { code: '90318000', desc: 'Digital meters, counters & measuring' },
  { code: '85369090', desc: 'Connectors & Terminal blocks' },
];

export const AddItemModal: React.FC<Props> = ({
  isOpen,
  onClose,
  initialValues,
  onItemAdded,
}) => {
  const {
    items,
    addItem,
    canManageItems,
    currentUser,
    hasFlag,
    categories,
    subcategoriesByCategory,
    addCategory,
    addSubcategory,
    generateItemCode,
    unitsList,
    addUnit,
    gstSlabsList,
    addGstSlab,
  } = useErp();

  const [activeTab, setActiveTab] = useState<'pricing' | 'stock'>('pricing');

  // Core Item Fields
  const [itemName, setItemName] = useState('');
  const [itemHSN, setItemHSN] = useState('');
  const [category, setCategory] = useState(() => categories[0] || 'PLC & Controllers');
  const availableSubcategories = subcategoriesByCategory[category] || ['General'];
  const [subcategory, setSubcategory] = useState(() => availableSubcategories[0] || 'General');
  const [marginCategory, setMarginCategory] = useState<'A' | 'B' | 'C' | 'D' | ''>('');
  const [itemCode, setItemCode] = useState('');
  const [isCodeOverridden, setIsCodeOverridden] = useState(false);
  const [unit, setUnit] = useState('PCS');
  const [imageUrl, setImageUrl] = useState('');
  const [description, setDescription] = useState('');

  // Static Master Pricing Fields
  const [salePrice, setSalePrice] = useState<number | ''>('');
  const [salePriceTaxMode, setSalePriceTaxMode] = useState<SalePriceTaxMode>('without');
  const [discountOnSalePrice, setDiscountOnSalePrice] = useState<number | ''>(0);
  const [discountType, setDiscountType] = useState<DiscountType>('%');
  const [wholesalePrice, setWholesalePrice] = useState<number | ''>('');
  const [minWholesaleQty, setMinWholesaleQty] = useState<number | ''>(5);
  const [purchasePrice, setPurchasePrice] = useState<number | ''>('');
  const [gstTaxSlab, setGstTaxSlab] = useState<number>(18);

  // Low Stock Alert Threshold (per-item master)
  const [reorderThreshold, setReorderThreshold] = useState<number | ''>(10);

  const [showHsnHelper, setShowHsnHelper] = useState(false);

  // Initialize from initialValues (e.g. from New Item Enquiry request)
  useEffect(() => {
    if (isOpen && initialValues) {
      if (initialValues.itemName) setItemName(initialValues.itemName);
      if (initialValues.imageUrl) setImageUrl(initialValues.imageUrl);
    }
  }, [isOpen, initialValues]);

  // Auto-generate code when category or subcategory changes (if not manually overridden)
  useEffect(() => {
    if (isOpen && !isCodeOverridden && category && subcategory) {
      const generated = generateItemCode(category, subcategory);
      setItemCode(generated);
    }
  }, [isOpen, category, subcategory, isCodeOverridden]);

  // Margin band A/B/C → auto-fill Sale Price = Purchase Price + margin (e.g. A: 100 → 135).
  // Band D (custom) / none leaves the sale price for manual entry.
  useEffect(() => {
    const sp = computeMarginSalePrice(Number(purchasePrice) || 0, marginCategory);
    if (sp != null) setSalePrice(sp);
  }, [purchasePrice, marginCategory]);

  if (!isOpen) return null;

  const handleCategoryChange = (newCat: string) => {
    setCategory(newCat);
    const subList = subcategoriesByCategory[newCat] || ['General'];
    const newSub = subList.includes(subcategory) ? subcategory : (subList[0] || 'General');
    setSubcategory(newSub);
    if (!isCodeOverridden) {
      const nextCode = generateItemCode(newCat, newSub);
      setItemCode(nextCode);
    }
  };

  const handleSubcategoryChange = (newSub: string) => {
    setSubcategory(newSub);
    if (!isCodeOverridden) {
      const nextCode = generateItemCode(category, newSub);
      setItemCode(nextCode);
    }
  };

  const handleAddNewCategory = (newCat: string) => {
    addCategory(newCat);
    handleCategoryChange(newCat);
  };

  const handleAddNewSubcategory = (newSub: string) => {
    addSubcategory(category, newSub);
    handleSubcategoryChange(newSub);
  };

  const handleAutoGenerateCode = () => {
    const code = generateItemCode(category, subcategory);
    setItemCode(code);
    setIsCodeOverridden(false);
    toast.info(`Assigned item code: ${code}`);
  };

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

  const resetForm = () => {
    setItemName('');
    setItemHSN('');
    const defaultCat = categories[0] || 'PLC & Controllers';
    setCategory(defaultCat);
    const defaultSub = (subcategoriesByCategory[defaultCat] && subcategoriesByCategory[defaultCat][0]) || 'General';
    setSubcategory(defaultSub);
    setIsCodeOverridden(false);
    setItemCode(generateItemCode(defaultCat, defaultSub));
    setUnit('PCS');
    setImageUrl('');
    setDescription('');
    setSalePrice('');
    setSalePriceTaxMode('without');
    setDiscountOnSalePrice(0);
    setDiscountType('%');
    setWholesalePrice('');
    setMinWholesaleQty(5);
    setPurchasePrice('');
    setGstTaxSlab(18);
    setReorderThreshold(10);
    setActiveTab('pricing');
  };

  const handleSave = (saveAndNew = false) => {
    if (!canManageItems) {
      toast.error('Permission denied: You do not have permission to create items');
      return;
    }

    if (!itemName.trim()) {
      toast.error('Item Name is required');
      return;
    }

    const finalItemCode = itemCode.trim() || generateItemCode(category, subcategory);

    // #5 Enforce item-code uniqueness — one code can only be created once
    const codeExists = items.some(
      (it) => (it.itemCode || '').trim().toLowerCase() === finalItemCode.toLowerCase()
    );
    if (codeExists) {
      toast.error(`Item code "${finalItemCode}" already exists. Use a unique code or Auto Assign.`);
      return;
    }

    const savedItem = addItem({
      itemName: itemName.trim(),
      itemHSN: itemHSN.trim() || '85371000',
      category,
      subcategory: subcategory.trim() || undefined,
      marginCategory: marginCategory || undefined,
      itemCode: finalItemCode,
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

    if (onItemAdded) {
      onItemAdded(savedItem);
    }

    if (saveAndNew) {
      resetForm();
    } else {
      onClose();
      resetForm();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white border border-slate-300 rounded-none w-full max-w-3xl shadow-xl overflow-hidden flex flex-col max-h-[92vh] text-slate-900">
        {/* Modal Header */}
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-none bg-red-50 border border-red-200 flex items-center justify-center text-red-700 shrink-0">
              <Plus className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Add New Item</h2>
              <p className="text-[11px] text-slate-500">
                Catalog product details & pricing
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
          {/* Section 1: Item Identification */}
          <div className="bg-slate-50/60 p-4 rounded-none border border-slate-300 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Item Name */}
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center justify-between">
                  <span>
                    Item Name <span className="text-red-600">*</span>
                  </span>
                  <span className="text-[11px] text-slate-400 font-normal normal-case">
                    e.g. Delta PLC DVP-14SS2
                  </span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Delta PLC DVP-14SS211R"
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  className="w-full px-3 py-2 rounded-none bg-white border border-slate-300 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 transition-colors"
                />
              </div>

              {/* Description / Technical Specs (Optional) */}
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center justify-between">
                  <span>Description / Technical Specs</span>
                  <span className="text-[11px] text-slate-400 font-normal normal-case">Optional</span>
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Enter detailed technical specifications, voltage/pinout ratings, variations, or internal staff notes..."
                  className="w-full px-3 py-2 rounded-none bg-white border border-slate-300 text-slate-900 placeholder-slate-400 text-xs focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 transition-colors resize-y"
                />
              </div>

              {/* Item HSN */}
              <div className="space-y-1.5 relative">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-700">HSN / SAC Code</label>
                  <button
                    type="button"
                    onClick={() => setShowHsnHelper(!showHsnHelper)}
                    className="text-[11px] text-red-700 hover:text-red-800 flex items-center gap-1 font-bold cursor-pointer"
                  >
                    <Search className="h-2.5 w-2.5" /> Quick HSNs
                  </button>
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. 85371000"
                  value={itemHSN}
                  onChange={(e) => setItemHSN(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  className="w-full px-3 py-2 rounded-none bg-white border border-slate-300 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 transition-colors"
                />

                {/* HSN Helper Popover */}
                {showHsnHelper && (
                  <div className="absolute top-full left-0 right-0 mt-1 p-2 bg-white border border-slate-300 rounded-none shadow-xl z-20 space-y-1 max-h-48 overflow-y-auto">
                    <p className="text-[11px] font-bold uppercase text-slate-400 px-2 py-1">
                      Select Common Automation HSN:
                    </p>
                    {COMMON_HSN_CODES.map((item) => (
                      <button
                        key={item.code}
                        type="button"
                        onClick={() => {
                          setItemHSN(item.code);
                          setShowHsnHelper(false);
                        }}
                        className="w-full text-left px-2 py-1.5 rounded-none hover:bg-slate-100 text-xs text-slate-800 flex justify-between items-center cursor-pointer"
                      >
                        <span className="font-mono font-bold text-red-700">{item.code}</span>
                        <span className="text-[11px] text-slate-500 truncate max-w-[180px]">
                          {item.desc}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <UniversalDropdown
                label="Category"
                value={category}
                onChange={handleCategoryChange}
                options={categories.map((c) => ({ value: c, label: c }))}
                addNewLabel="+ Add New Category"
                addNewPlaceholder="e.g. Industrial IoT"
                onAddNew={handleAddNewCategory}
              />

              <UniversalDropdown
                label="Subcategory"
                value={subcategory}
                onChange={handleSubcategoryChange}
                options={availableSubcategories.map((s) => ({ value: s, label: s }))}
                addNewLabel="+ Add New Subcategory"
                addNewPlaceholder="e.g. Modbus Gateways"
                onAddNew={handleAddNewSubcategory}
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

              {/* Item Code (Auto-generated & Editable) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                    <span>Item Code</span>
                    <span className="text-[11px] text-red-700 font-bold bg-red-50 px-1.5 py-0.2 rounded-none border border-red-200">
                      {isCodeOverridden ? 'Manual' : 'Auto'}
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={handleAutoGenerateCode}
                    className="text-[11px] text-red-700 hover:text-red-800 font-bold cursor-pointer"
                  >
                    + Auto Assign
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="e.g. PL-CP-0001"
                  value={itemCode}
                  onChange={(e) => {
                    setItemCode(e.target.value);
                    setIsCodeOverridden(true);
                  }}
                  className="w-full px-3 py-2 rounded-none bg-white border border-slate-300 text-slate-900 placeholder-slate-400 text-sm font-mono focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600"
                />
              </div>

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
                  label="Add Item Image"
                  altText={itemName || 'Preview'}
                />
              </div>
            </div>
          </div>

          {/* Section 2: Tabs (Pricing vs Stock) */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-200">
              <button
                type="button"
                onClick={() => setActiveTab('pricing')}
                className={cn(
                  'pb-2.5 px-4 text-xs font-bold uppercase tracking-wider transition-all relative border-b-2 -mb-[1px] cursor-pointer',
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
                  'pb-2.5 px-4 text-xs font-bold uppercase tracking-wider transition-all relative border-b-2 -mb-[1px] flex items-center gap-1.5 cursor-pointer',
                  activeTab === 'stock'
                    ? 'border-red-600 text-red-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                )}
              >
                <span>Stock Policy & Alerts</span>
                <span className="px-1.5 py-0.2 rounded-none text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                  0 {unit} (New)
                </span>
              </button>
            </div>

            {/* TAB CONTENT: PRICING */}
            {activeTab === 'pricing' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Sale Price */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center justify-between">
                      <span>Sale Price (₹)</span>
                      <span className="text-[11px] text-slate-400 font-normal normal-case">Price across all branches</span>
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
                      className="w-full px-3 py-2 rounded-none bg-white border border-slate-300 text-slate-900 text-sm focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 font-mono"
                    />
                  </div>

                  {/* Standard Discount */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center justify-between">
                      <span>Standard Discount</span>
                      <span className="text-[11px] text-slate-400 font-normal normal-case">Default discount scheme</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        placeholder="0"
                        min="0"
                        step="any"
                        value={discountOnSalePrice}
                        onChange={(e) =>
                          setDiscountOnSalePrice(e.target.value === '' ? '' : Number(e.target.value))
                        }
                        className="w-full px-3 py-2 rounded-none bg-white border border-slate-300 text-slate-900 text-sm focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 font-mono"
                      />
                      <select
                        value={discountType}
                        onChange={(e) => setDiscountType(e.target.value as DiscountType)}
                        className="px-3 py-2 rounded-none bg-slate-50 border border-slate-300 text-xs font-semibold text-slate-700 focus:outline-none focus:border-red-600 shrink-0 cursor-pointer"
                      >
                        <option value="%">% (Percentage)</option>
                        <option value="amount">₹ (Fixed Amount)</option>
                      </select>
                    </div>
                  </div>

                  {/* Wholesale Price */}
                  {currentUser.role !== 'Sales' && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold uppercase tracking-wider text-slate-700">
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
                        className="w-full px-3 py-2 rounded-none bg-white border border-slate-300 text-slate-900 text-sm focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 font-mono"
                      />
                    </div>
                  )}

                  {/* Purchase Price — gated by view.purchaseCost flag */}
                  {hasFlag('view.purchaseCost') && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center justify-between">
                        <span>Purchase Price (₹)</span>
                        <span className="text-[11px] text-slate-400 font-normal normal-case">Default purchase cost</span>
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
                        className="w-full px-3 py-2 rounded-none bg-white border border-slate-300 text-slate-900 text-sm focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 font-mono"
                      />
                      <p className="text-[11px] text-slate-500">
                        Default cost — used as starting point for Purchase Orders, editable per order
                      </p>
                    </div>
                  )}

                  {/* Min Wholesale Quantity */}
                  {currentUser.role !== 'Sales' && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center justify-between">
                        <span>Min Wholesale Quantity</span>
                        <span className="text-[11px] text-slate-400 font-normal normal-case">Bulk threshold</span>
                      </label>
                      <input
                        type="number"
                        placeholder="5"
                        min="1"
                        value={minWholesaleQty}
                        onChange={(e) =>
                          setMinWholesaleQty(e.target.value === '' ? '' : Number(e.target.value))
                        }
                        className="w-full px-3 py-2 rounded-none bg-white border border-slate-300 text-slate-900 text-sm focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 font-mono"
                      />
                    </div>
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

                {/* Net Price Preview Box */}
                <div className="p-3.5 rounded-none bg-slate-50 border border-slate-300 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calculator className="h-4 w-4 text-slate-700" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      Standard Net Billing Price:
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-base font-extrabold text-red-700 font-mono">
                      ₹{effective.finalPrice.toFixed(2)}
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      (Base ₹{effective.basePrice.toFixed(2)} + GST ₹{effective.taxAmount.toFixed(2)})
                    </span>
                  </div>
                </div>

              </div>
            )}

            {/* TAB CONTENT: STOCK POLICY & ALERTS */}
            {activeTab === 'stock' && (
              <div className="space-y-4">
                <div className="p-4 rounded-none bg-slate-50 border border-slate-300 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-none bg-red-50 border border-red-200 flex items-center justify-center text-red-700 shrink-0">
                      <PackageCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Stock Inward Policy: Purchase Orders Only
                      </h3>
                      <p className="text-xs text-slate-600 mt-0.5">
                        New catalog items start with <strong>0 stock</strong> across all branches. Initial stock cannot be entered manually at item creation.
                      </p>
                    </div>
                  </div>

                  <div className="p-3 bg-white rounded-none border border-slate-300 text-xs text-slate-600 space-y-2">
                    <div className="flex items-start gap-2">
                      <div className="h-2 w-2 rounded-none bg-red-600 mt-1.5 shrink-0" />
                      <p>
                        <strong>Physical Stock Inward:</strong> Stock is gained exclusively by creating and receiving goods through <strong>Purchase Orders</strong>.
                      </p>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="h-2 w-2 rounded-none bg-red-600 mt-1.5 shrink-0" />
                      <p>
                        <strong>Warehouse Shelf Location:</strong> Per-branch shelf / rack location (e.g. Rack R2) is assigned during the Purchase Order receiving step when goods arrive.
                      </p>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="h-2 w-2 rounded-none bg-red-600 mt-1.5 shrink-0" />
                      <p>
                        <strong>Corrections & Audits:</strong> Subsequent adjustments and rack updates can also be made anytime via the <em>Inventory</em> table.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Low Stock Alert Threshold (Per-Item Master) */}
                <div className="p-4 rounded-none bg-amber-50/70 border border-amber-300 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-amber-900 uppercase tracking-wider">Low Stock Alert Threshold (Catalog-wide)</p>
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      Triggers "Low Stock" status on Dashboard and Inventory whenever branch quantity drops to or below this count.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-700">Threshold:</span>
                    <input
                      type="number"
                      min="0"
                      value={reorderThreshold}
                      onChange={(e) =>
                        setReorderThreshold(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value) || 0))
                      }
                      className="w-24 px-3 py-1.5 rounded-none bg-white border border-amber-400 text-slate-900 font-bold text-sm focus:outline-none focus:border-red-600 text-center font-mono"
                    />
                    <span className="text-xs font-semibold text-slate-500">{unit}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-none text-xs font-bold uppercase tracking-wider text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 cursor-pointer transition-colors"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleSave(true)}
              disabled={!canManageItems}
              className="px-3.5 py-1.5 rounded-none text-xs font-bold uppercase tracking-wider text-slate-800 hover:bg-slate-100 bg-white border border-slate-300 transition-colors cursor-pointer disabled:opacity-50"
            >
              Save & New
            </button>
            <button
              type="button"
              onClick={() => handleSave(false)}
              disabled={!canManageItems}
              className="px-4 py-1.5 rounded-none text-xs font-bold uppercase tracking-wider text-white bg-red-600 hover:bg-red-700 active:bg-red-800 shadow-none border border-red-700 transition-all cursor-pointer disabled:opacity-50"
            >
              Save Item
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
