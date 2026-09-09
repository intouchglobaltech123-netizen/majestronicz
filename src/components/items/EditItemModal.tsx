import React, { useState, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import {
  Item,
  SalePriceTaxMode,
  DiscountType,
  BRANCHES,
} from '../../types';
import {
  X,
  Building,
  Calculator,
  ArrowRight,
  History,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { UniversalDropdown } from '../common/UniversalDropdown';
import { ItemHistoryTab } from './ItemHistoryTab';
import { ItemImage } from '../common/ItemImage';
import { ImageUploadField } from '../common/ImageUploadField';

interface Props {
  item: Item | null;
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'pricing' | 'stock' | 'history';
}

export const EditItemModal: React.FC<Props> = ({ item, isOpen, onClose, initialTab }) => {
  const {
    updateItem,
    getBranchStock,
    canManageItems,
    navigateToInventoryItem,
    categories,
    subcategoriesByCategory,
    addCategory,
    addSubcategory,
    unitsList,
    addUnit,
    gstSlabsList,
    addGstSlab,
  } = useErp();

  const [activeTab, setActiveTab] = useState<'pricing' | 'stock' | 'history'>(
    () => initialTab || 'pricing'
  );

  // Master Item details
  const [itemName, setItemName] = useState('');
  const [itemHSN, setItemHSN] = useState('');
  const [category, setCategory] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [itemCode, setItemCode] = useState('');
  const [unit, setUnit] = useState('PCS');
  const [imageUrl, setImageUrl] = useState('');

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

  useEffect(() => {
    if (item) {
      setItemName(item.itemName);
      setItemHSN(item.itemHSN);
      setCategory(item.category);
      const subList = subcategoriesByCategory[item.category] || ['General'];
      setSubcategory(item.subcategory || subList[0] || 'General');
      setItemCode(item.itemCode);
      setUnit(item.unit);
      setImageUrl(item.imageUrl || '');

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
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [item, subcategoriesByCategory, isOpen, initialTab]);

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
      toast.error('Permission denied: Billing role cannot edit items');
      return;
    }

    if (!itemName.trim()) {
      toast.error('Item Name is required');
      return;
    }

    // Update Item and Pricing (Stock changes stay exclusively in Inventory)
    updateItem(item.id, {
      itemName: itemName.trim(),
      itemHSN: itemHSN.trim(),
      category,
      subcategory: subcategory.trim() || undefined,
      itemCode: itemCode.trim(),
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
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-4xl lg:max-w-5xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] text-slate-900">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-3.5">
            <ItemImage
              src={imageUrl || item.imageUrl}
              alt={item.itemName}
              className="h-11 w-11 rounded-xl shadow-xs"
              iconClassName="h-5 w-5"
            />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">
                  {activeTab === 'history'
                    ? 'Item History & Analytics'
                    : canManageItems
                    ? 'Edit Item'
                    : 'Item Details'}
                </h2>
                {!canManageItems && (
                  <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                    Read-Only
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Item Code: <span className="font-mono text-blue-700 font-semibold">{item.itemCode}</span>
                {item.subcategory && (
                  <span className="text-slate-400"> • {item.category} / {item.subcategory}</span>
                )}
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
          {/* Item Details */}
          <div className="bg-slate-50/60 p-4 rounded-xl border border-slate-200 space-y-4">
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
                  className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 text-sm focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700">HSN / SAC Code</label>
                <input
                  type="text"
                  value={itemHSN}
                  onChange={(e) => setItemHSN(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 text-sm font-mono focus:outline-none focus:border-blue-600"
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

              {/* Item Code */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700">Item Code</label>
                <input
                  type="text"
                  value={itemCode}
                  onChange={(e) => setItemCode(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 text-sm font-mono focus:outline-none focus:border-blue-600"
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
                <span>Stock by Branch</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 font-semibold">
                  Read-Only
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className={cn(
                  'pb-2.5 px-4 text-xs font-bold transition-all relative border-b-2 -mb-[1px] flex items-center gap-1.5',
                  activeTab === 'history'
                    ? 'border-blue-600 text-blue-600'
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
                    <label className="text-xs font-bold text-slate-700">
                      Sale Price (₹)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        placeholder="0.00"
                        min="0"
                        step="any"
                        value={salePrice}
                        onChange={(e) =>
                          setSalePrice(e.target.value === '' ? '' : Number(e.target.value))
                        }
                        className="flex-1 px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 text-sm font-semibold focus:outline-none focus:border-blue-600"
                      />
                      <select
                        value={salePriceTaxMode}
                        onChange={(e) => setSalePriceTaxMode(e.target.value as SalePriceTaxMode)}
                        className="px-3 py-2 rounded-xl bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-700 focus:outline-none"
                      >
                        <option value="without">Without Tax</option>
                        <option value="with">With Tax</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">
                      Standard Discount
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
                        className="flex-1 px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 text-sm font-semibold focus:outline-none focus:border-blue-600"
                      />
                      <select
                        value={discountType}
                        onChange={(e) => setDiscountType(e.target.value as DiscountType)}
                        className="px-3 py-2 rounded-xl bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-700 focus:outline-none"
                      >
                        <option value="%">% (Percentage)</option>
                        <option value="amount">₹ (Fixed Amount)</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">
                      Wholesale Price (₹)
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

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">
                      Min Wholesale Quantity
                    </label>
                    <input
                      type="number"
                      placeholder="1"
                      min="1"
                      value={minWholesaleQty}
                      onChange={(e) =>
                        setMinWholesaleQty(e.target.value === '' ? '' : Number(e.target.value))
                      }
                      className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 text-sm focus:outline-none focus:border-blue-600"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">
                      Purchase Cost (₹)
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

                {/* Net Price breakdown */}
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
              </div>
            )}

            {/* READ-ONLY STOCK BY BRANCH TAB */}
            {activeTab === 'stock' && (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 bg-blue-50/60 border border-blue-200 rounded-xl">
                  <div>
                    <h3 className="text-xs font-bold text-slate-900">Branch Stock Overview</h3>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                      Stock quantities are managed exclusively in the Inventory module via transfers & adjustments.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleNavigateToInventory}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors shrink-0"
                  >
                    <span>Manage Stock</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Read-Only Mini-Table */}
                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
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
                                <Building className="h-3.5 w-3.5 text-blue-600" />
                                <span>{b.name}</span>
                                {b.isHq && (
                                  <span className="text-[9px] uppercase font-bold px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 border border-slate-200">
                                    HQ
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-[11px]">
                              <div className="text-slate-700 font-medium">{b.location}</div>
                              <div className="text-slate-500 font-mono mt-0.5">
                                {stock?.location?.trim() ? (
                                  <span className="inline-flex items-center gap-1 font-bold text-blue-700 bg-blue-50 px-1.5 py-0.2 rounded border border-blue-200">
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
                              <span className="text-[10px] text-slate-500 font-semibold">{unit}</span>
                            </td>
                            <td className="py-3 px-4 text-center">
                              {qty > threshold ? (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  In Stock
                                </span>
                              ) : qty > 0 ? (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                                  Low Stock
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                                  Out of Stock
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-blue-50/70 border-t-2 border-slate-300 font-bold text-slate-900">
                      <tr>
                        <td colSpan={2} className="py-3 px-4 text-xs font-black text-slate-900 uppercase tracking-wide">
                          Total (All Branches)
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className="text-base font-black text-blue-700 font-mono">
                            {BRANCHES.reduce((sum, b) => sum + (getBranchStock(item.id, b.id)?.quantity ?? 0), 0)}
                          </span>{' '}
                          <span className="text-[10px] text-blue-700 font-bold">{unit}</span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          {(() => {
                            const totalQty = BRANCHES.reduce((sum, b) => sum + (getBranchStock(item.id, b.id)?.quantity ?? 0), 0);
                            const threshold = Number(reorderThreshold) || (item.reorderThreshold ?? 10);
                            if (totalQty === 0) {
                              return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">Out of Stock</span>;
                            } else if (totalQty <= threshold) {
                              return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Low Stock</span>;
                            } else {
                              return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">In Stock</span>;
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
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-200 transition-colors"
          >
            {activeTab === 'history' || !canManageItems ? 'Close' : 'Cancel'}
          </button>

          {canManageItems && activeTab !== 'history' && (
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-all"
            >
              Save Changes
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
