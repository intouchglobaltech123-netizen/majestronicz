import React, { useState, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import { Item, SalePriceTaxMode, DiscountType, BRANCHES, BranchId } from '../../types';
import {
  X,
  Plus,
  Search,
  Calculator,
  Building,
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
    addItem,
    canManageItems,
    currentBranch,
    isAllBranches,
    currentBranchData,
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
  const [itemCode, setItemCode] = useState('');
  const [isCodeOverridden, setIsCodeOverridden] = useState(false);
  const [unit, setUnit] = useState('PCS');
  const [imageUrl, setImageUrl] = useState('');

  // Static Master Pricing Fields
  const [salePrice, setSalePrice] = useState<number | ''>('');
  const [salePriceTaxMode, setSalePriceTaxMode] = useState<SalePriceTaxMode>('without');
  const [discountOnSalePrice, setDiscountOnSalePrice] = useState<number | ''>(0);
  const [discountType, setDiscountType] = useState<DiscountType>('%');
  const [wholesalePrice, setWholesalePrice] = useState<number | ''>('');
  const [minWholesaleQty, setMinWholesaleQty] = useState<number | ''>(5);
  const [purchasePrice, setPurchasePrice] = useState<number | ''>('');
  const [gstTaxSlab, setGstTaxSlab] = useState<number>(18);

  // Scoped Initial Stock and Rack Location for currently selected branch
  const [initialStockQty, setInitialStockQty] = useState<number | ''>(0);
  const [initialStockLocation, setInitialStockLocation] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState<BranchId>(() => {
    if (!isAllBranches && currentBranch !== 'all') {
      return currentBranch as BranchId;
    }
    return 'erode-hq';
  });

  const targetBranch = (!isAllBranches && currentBranch !== 'all')
    ? (currentBranchData || BRANCHES.find((b) => b.id === currentBranch) || BRANCHES[0])
    : (BRANCHES.find((b) => b.id === selectedBranchId) || BRANCHES[0]);

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
    setSalePrice('');
    setSalePriceTaxMode('without');
    setDiscountOnSalePrice(0);
    setDiscountType('%');
    setWholesalePrice('');
    setMinWholesaleQty(5);
    setPurchasePrice('');
    setGstTaxSlab(18);
    setInitialStockQty(0);
    setInitialStockLocation('');
    setReorderThreshold(10);
    setActiveTab('pricing');
  };

  const handleSave = (saveAndNew = false) => {
    if (!canManageItems) {
      toast.error('Permission denied: Billing role cannot create items');
      return;
    }

    if (!itemName.trim()) {
      toast.error('Item Name is required');
      return;
    }

    const finalItemCode = itemCode.trim() || generateItemCode(category, subcategory);

    const targetBranchId: BranchId = targetBranch.id;
    const initialStocksMap: Partial<Record<BranchId, number>> = {
      [targetBranchId]: Math.max(0, parseInt(String(initialStockQty), 10) || 0),
    };
    const initialLocationsMap: Partial<Record<BranchId, string>> = {
      [targetBranchId]: initialStockLocation.trim(),
    };

    const savedItem = addItem(
      {
        itemName: itemName.trim(),
        itemHSN: itemHSN.trim() || '85371000',
        category,
        subcategory: subcategory.trim() || undefined,
        itemCode: finalItemCode,
        unit,
        imageUrl: imageUrl.trim() || undefined,
        salePrice: Number(salePrice) || 0,
        salePriceTaxMode,
        wholesalePrice: Number(wholesalePrice) || 0,
        minWholesaleQty: Number(minWholesaleQty) || 1,
        purchasePrice: Number(purchasePrice) || 0,
        gstTaxSlab,
        discountOnSalePrice: Number(discountOnSalePrice) || 0,
        discountType,
        reorderThreshold: Number(reorderThreshold) || 10,
      },
      initialStocksMap,
      initialLocationsMap
    );

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
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] text-slate-900">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-blue-100 border border-blue-200 flex items-center justify-center text-blue-700">
              <Plus className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Add New Item</h2>
              <p className="text-xs text-slate-500">
                Catalog product details & pricing
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 bg-white">
          {/* Section 1: Item Identification */}
          <div className="bg-slate-50/60 p-4 rounded-xl border border-slate-200 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Item Name */}
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                  <span>
                    Item Name <span className="text-rose-500">*</span>
                  </span>
                  <span className="text-[10px] text-slate-400 font-normal">
                    e.g. Delta PLC DVP-14SS2
                  </span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Enter full product description..."
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-colors"
                />
              </div>

              {/* Item HSN */}
              <div className="space-y-1.5 relative">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700">HSN / SAC Code</label>
                  <button
                    type="button"
                    onClick={() => setShowHsnHelper(!showHsnHelper)}
                    className="text-[10px] text-blue-600 hover:text-blue-700 flex items-center gap-1 font-semibold"
                  >
                    <Search className="h-2.5 w-2.5" /> Quick HSNs
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="e.g. 85371000"
                  value={itemHSN}
                  onChange={(e) => setItemHSN(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-colors"
                />

                {/* HSN Helper Popover */}
                {showHsnHelper && (
                  <div className="absolute top-full left-0 right-0 mt-1 p-2 bg-white border border-slate-200 rounded-xl shadow-xl z-20 space-y-1 max-h-48 overflow-y-auto">
                    <p className="text-[10px] font-bold uppercase text-slate-400 px-2 py-1">
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
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-50 text-xs text-slate-800 flex justify-between items-center"
                      >
                        <span className="font-mono font-bold text-blue-700">{item.code}</span>
                        <span className="text-[10px] text-slate-500 truncate max-w-[180px]">
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

              {/* Item Code (Auto-generated & Editable) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <span>Item Code</span>
                    <span className="text-[10px] text-blue-600 font-semibold bg-blue-50 px-1.5 py-0.2 rounded border border-blue-200">
                      {isCodeOverridden ? 'Manual' : 'Auto'}
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={handleAutoGenerateCode}
                    className="text-[10px] text-blue-600 hover:text-blue-700 font-bold"
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
                  className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 placeholder-slate-400 text-sm font-mono focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
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
                  'pb-2.5 px-4 text-xs font-bold transition-all relative border-b-2 -mb-[1px]',
                  activeTab === 'pricing'
                    ? 'border-blue-600 text-blue-600'
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
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                )}
              >
                <span>Initial Stock</span>
                <span
                  className={cn(
                    'px-1.5 py-0.2 rounded-full text-[10px] font-bold',
                    Number(initialStockQty) > 0 ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
                  )}
                >
                  {Number(initialStockQty) || 0} {unit}
                </span>
              </button>
            </div>

            {/* TAB CONTENT: PRICING */}
            {activeTab === 'pricing' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Sale Price */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                      <span>Sale Price (₹)</span>
                      <span className="text-[10px] text-slate-400">Price across all branches</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        placeholder="0.00"
                        min="0"
                        step="any"
                        value={salePrice}
                        onChange={(e) =>
                          setSalePrice(e.target.value === '' ? '' : Number(e.target.value))
                        }
                        className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 text-sm focus:outline-none focus:border-blue-600"
                      />
                      <select
                        value={salePriceTaxMode}
                        onChange={(e) => setSalePriceTaxMode(e.target.value as SalePriceTaxMode)}
                        className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-300 text-xs font-semibold text-slate-700 focus:outline-none focus:border-blue-600 shrink-0"
                      >
                        <option value="without">Without Tax</option>
                        <option value="with">With Tax</option>
                      </select>
                    </div>
                  </div>

                  {/* Standard Discount */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                      <span>Standard Discount</span>
                      <span className="text-[10px] text-slate-400">Default discount scheme</span>
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
                        className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 text-sm focus:outline-none focus:border-blue-600"
                      />
                      <select
                        value={discountType}
                        onChange={(e) => setDiscountType(e.target.value as DiscountType)}
                        className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-300 text-xs font-semibold text-slate-700 focus:outline-none focus:border-blue-600 shrink-0"
                      >
                        <option value="%">% (Percentage)</option>
                        <option value="amount">₹ (Fixed Amount)</option>
                      </select>
                    </div>
                  </div>

                  {/* Wholesale Price */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                      <span>Wholesale Price (₹)</span>
                      <span className="text-[10px] text-slate-400">Bulk purchase tier</span>
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
                      className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 text-sm focus:outline-none focus:border-blue-600"
                    />
                  </div>

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
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calculator className="h-4 w-4 text-blue-600" />
                    <span className="text-xs font-semibold text-slate-700">
                      Standard Net Billing Price:
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-base font-extrabold text-blue-700">
                      ₹{effective.finalPrice.toFixed(2)}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      (Base ₹{effective.basePrice.toFixed(2)} + GST ₹{effective.taxAmount.toFixed(2)})
                    </span>
                  </div>
                </div>

                {/* Starting Stock Quick-View on Pricing Tab */}
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Building className="h-4 w-4 text-blue-600" />
                    <span className="text-slate-600 font-medium">
                      Starting Stock ({targetBranch.name}):
                    </span>
                    <span className="font-bold text-slate-900 font-mono">
                      {Number(initialStockQty) || 0} {unit}
                    </span>
                    {initialStockLocation.trim() && (
                      <span className="font-mono text-[11px] font-bold text-slate-700 bg-slate-200/80 px-2 py-0.5 rounded border border-slate-300">
                        Rack: {initialStockLocation.trim()}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('stock')}
                    className="text-blue-600 hover:text-blue-700 font-semibold hover:underline text-[11px]"
                  >
                    Adjust in Initial Stock tab →
                  </button>
                </div>
              </div>
            )}

            {/* TAB CONTENT: BRANCH STOCK SETUP */}
            {activeTab === 'stock' && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 rounded-lg bg-blue-100 border border-blue-200 flex items-center justify-center text-blue-700">
                        <Building className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="text-xs font-bold text-slate-900">
                          Starting Stock — {targetBranch.name}
                        </h3>
                        <p className="text-[11px] text-slate-500">
                          Physical stock available at this branch warehouse
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                      {targetBranch.location}
                    </span>
                  </div>

                  {isAllBranches && (
                    <div className="pt-2 border-t border-slate-200/80 space-y-1.5">
                      <label className="text-xs font-semibold text-slate-700">
                        Select Branch to Assign Starting Stock:
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {BRANCHES.map((b) => (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => setSelectedBranchId(b.id)}
                            className={cn(
                              'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all text-center',
                              selectedBranchId === b.id
                                ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                            )}
                          >
                            {b.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="pt-2 border-t border-slate-200/80 space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                      <span>Starting Stock Quantity — {targetBranch.name}</span>
                      <span className="text-[10px] text-slate-400 font-normal">Default: 0</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="0"
                        value={initialStockQty}
                        onChange={(e) =>
                          setInitialStockQty(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0))
                        }
                        className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 font-bold text-sm focus:outline-none focus:border-blue-600"
                      />
                      <span className="text-xs font-bold text-slate-500 shrink-0 px-2">
                        {unit}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Creates the starting stock record exclusively for <strong>{targetBranch.name}</strong>. Other branch warehouses will start with 0 stock until replenished via Purchases or Inventory transfers.
                    </p>
                  </div>

                  {/* Physical Rack / Row Location Input */}
                  <div className="pt-2 border-t border-slate-200/80 space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                      <span>Physical Rack / Row Location ({targetBranch.name})</span>
                      <span className="text-[10px] text-slate-400 font-normal">e.g. R2, A-14, Bin 03</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. R2"
                      value={initialStockLocation}
                      onChange={(e) => setInitialStockLocation(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 font-mono text-sm focus:outline-none focus:border-blue-600"
                    />
                    <p className="text-[11px] text-slate-500">
                      Per-branch location where goods are shelved at <strong>{targetBranch.name}</strong>. Physical racks differ per branch.
                    </p>
                  </div>
                </div>

                {/* Low Stock Alert Threshold (Per-Item Master) */}
                <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-amber-900">Low Stock Alert Threshold (Catalog-wide)</p>
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      Triggers "Low Stock" status on Dashboard and Inventory whenever branch quantity drops to or below this count.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-bold text-slate-700">Threshold:</span>
                    <input
                      type="number"
                      min="0"
                      value={reorderThreshold}
                      onChange={(e) =>
                        setReorderThreshold(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value) || 0))
                      }
                      className="w-24 px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-slate-900 font-bold text-sm focus:outline-none focus:border-amber-500 text-center"
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
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-200 transition-colors"
          >
            Cancel
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => handleSave(true)}
              disabled={!canManageItems}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-blue-700 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-colors disabled:opacity-50"
            >
              Save & New
            </button>
            <button
              type="button"
              onClick={() => handleSave(false)}
              disabled={!canManageItems}
              className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-all disabled:opacity-50"
            >
              Save Item
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
