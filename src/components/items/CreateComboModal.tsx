import React, { useState, useEffect, useMemo } from 'react';
import { useErp } from '../../context/ErpContext';
import { ComboItem, ComboComponent } from '../../types';
import { formatCurrency, cn } from '../../lib/utils';
import { ItemSearchDropdown } from '../common/ItemSearchDropdown';
import { ItemImage } from '../common/ItemImage';
import { ImageUploadField } from '../common/ImageUploadField';
import { UniversalDropdown } from '../common/UniversalDropdown';
import {
  X,
  Layers,
  Plus,
  Trash2,
  TrendingDown,
  Sparkles,
  Info,
} from 'lucide-react';
import { toast } from 'sonner';

interface CreateComboModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingCombo?: ComboItem | null;
}

interface ComponentRowState {
  id: string; // Internal temporary row ID
  itemId: string;
  quantity: number;
  searchQuery?: string;
}

export const CreateComboModal: React.FC<CreateComboModalProps> = ({
  isOpen,
  onClose,
  editingCombo,
}) => {
  const {
    items,
    saveCombo,
    categories,
    subcategoriesByCategory,
    addCategory,
    addSubcategory,
    generateItemCode,
    currentBranch,
  } = useErp();

  const [comboName, setComboName] = useState('');
  const [category, setCategory] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [comboCode, setComboCode] = useState('');
  const [isCodeOverridden, setIsCodeOverridden] = useState(false);
  const [comboPrice, setComboPrice] = useState<number | ''>('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [componentRows, setComponentRows] = useState<ComponentRowState[]>([
    { id: 'comp-1', itemId: '', quantity: 1 },
    { id: 'comp-2', itemId: '', quantity: 1 },
  ]);

  const availableSubcategories = useMemo(() => {
    return subcategoriesByCategory[category] || ['General'];
  }, [category, subcategoriesByCategory]);

  // Initialize or reset form
  useEffect(() => {
    if (isOpen) {
      if (editingCombo) {
        setComboName(editingCombo.comboName);
        const cat = editingCombo.category || categories[0] || 'General';
        const subList = subcategoriesByCategory[cat] || ['General'];
        const sub = editingCombo.subcategory || subList[0] || 'General';
        setCategory(cat);
        setSubcategory(sub);
        setComboCode(editingCombo.comboCode);
        setIsCodeOverridden(true);
        setComboPrice(editingCombo.comboPrice);
        setDescription(editingCombo.description || '');
        setImageUrl(editingCombo.imageUrl || '');
        setComponentRows(
          editingCombo.components.map((c, i) => ({
            id: `comp-${i}-${Date.now()}`,
            itemId: c.itemId,
            quantity: c.quantity,
          }))
        );
      } else {
        setComboName('');
        const defaultCat = categories[0] || 'General';
        const subList = subcategoriesByCategory[defaultCat] || ['General'];
        const defaultSub = subList[0] || 'General';
        setCategory(defaultCat);
        setSubcategory(defaultSub);
        setIsCodeOverridden(false);
        const autoCode = generateItemCode(defaultCat, defaultSub);
        setComboCode(autoCode);
        setComboPrice('');
        setDescription('');
        setImageUrl('');
        setComponentRows([
          { id: `comp-1-${Date.now()}`, itemId: '', quantity: 1 },
          { id: `comp-2-${Date.now()}`, itemId: '', quantity: 1 },
        ]);
      }
    }
  }, [isOpen, editingCombo, categories, subcategoriesByCategory]);

  const handleCategoryChange = (newCat: string) => {
    setCategory(newCat);
    const subList = subcategoriesByCategory[newCat] || ['General'];
    const newSub = subList.includes(subcategory) ? subcategory : (subList[0] || 'General');
    setSubcategory(newSub);
    if (!isCodeOverridden) {
      const nextCode = generateItemCode(newCat, newSub);
      setComboCode(nextCode);
    }
  };

  const handleSubcategoryChange = (newSub: string) => {
    setSubcategory(newSub);
    if (!isCodeOverridden) {
      const nextCode = generateItemCode(category, newSub);
      setComboCode(nextCode);
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
    if (!category || !subcategory) {
      toast.warning('Please select a category and subcategory first');
      return;
    }
    const code = generateItemCode(category, subcategory);
    setComboCode(code);
    setIsCodeOverridden(false);
    toast.info(`Assigned combo code: ${code}`);
  };

  // Add new component slot
  const handleAddComponent = () => {
    setComponentRows((prev) => [
      ...prev,
      { id: `comp-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`, itemId: '', quantity: 1 },
    ]);
  };

  // Remove component slot
  const handleRemoveComponent = (id: string) => {
    if (componentRows.length <= 2) {
      toast.warning('A combo must contain at least 2 components');
      return;
    }
    setComponentRows((prev) => prev.filter((row) => row.id !== id));
  };

  // Update component item or quantity
  const handleUpdateComponent = (
    id: string,
    updates: Partial<Omit<ComponentRowState, 'id'>>
  ) => {
    setComponentRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...updates } : row))
    );
  };

  // Compute live separate prices, combo price, and savings
  const liveCalculations = useMemo(() => {
    let buyingSeparately = 0;
    const componentDetails = componentRows.map((row) => {
      const item = items.find((i) => i.id === row.itemId);
      const unitPrice = item ? item.salePrice : 0;
      const subtotal = unitPrice * (row.quantity || 0);
      buyingSeparately += subtotal;
      return {
        ...row,
        item,
        unitPrice,
        subtotal,
      };
    });

    const numericComboPrice = typeof comboPrice === 'number' ? comboPrice : 0;
    const savings = buyingSeparately - numericComboPrice;
    const savingsPercent =
      buyingSeparately > 0 && savings > 0
        ? ((savings / buyingSeparately) * 100).toFixed(1)
        : '0.0';

    return {
      buyingSeparately,
      numericComboPrice,
      savings,
      savingsPercent,
      componentDetails,
    };
  }, [componentRows, items, comboPrice]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedName = comboName.trim();
    if (!trimmedName) {
      toast.error('Please enter a combo name');
      return;
    }

    if (!category.trim()) {
      toast.error('Category is required');
      return;
    }

    if (!subcategory.trim()) {
      toast.error('Subcategory is required');
      return;
    }

    const finalCode = comboCode.trim() || generateItemCode(category, subcategory);

    if (!comboPrice || comboPrice <= 0) {
      toast.error('Please specify a valid combo price greater than ₹0');
      return;
    }

    // Filter valid selected components
    const validComponents: ComboComponent[] = componentRows
      .filter((row) => row.itemId && row.quantity > 0)
      .map((row) => ({
        itemId: row.itemId,
        quantity: Math.max(1, Math.floor(row.quantity)),
      }));

    if (validComponents.length < 2) {
      toast.error('Combo bundle requires at least 2 distinct component items', {
        description: 'Please select items from catalog for each component row.',
      });
      return;
    }

    // Check duplicate components
    const itemIds = validComponents.map((c) => c.itemId);
    const uniqueIds = new Set(itemIds);
    if (uniqueIds.size !== itemIds.length) {
      toast.error('Duplicate component detected', {
        description: 'Please combine quantities into a single component row.',
      });
      return;
    }

    const payload: ComboItem = {
      id: editingCombo ? editingCombo.id : `combo-${Date.now()}`,
      comboCode: finalCode,
      comboName: trimmedName,
      category,
      subcategory,
      comboPrice: Number(comboPrice),
      description: description.trim() || undefined,
      imageUrl: imageUrl.trim() || undefined,
      components: validComponents,
      createdAt: editingCombo ? editingCombo.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    saveCombo(payload);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden my-8 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <ItemImage
              src={imageUrl || editingCombo?.imageUrl}
              alt={comboName || 'Combo'}
              isCombo={true}
              className="h-11 w-11 rounded-xl shadow-xs"
              iconClassName="h-5 w-5"
            />
            <div>
              <h2 className="text-lg font-black tracking-tight text-white flex items-center gap-2">
                {editingCombo ? 'Edit Combo Bundle' : 'Create New Combo Item'}
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  {comboCode || 'CB-000X'}
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Bundled offer with zero independent stock · Availability computed live from components
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Info Banner: Zero Independent Stock */}
          <div className="p-3.5 bg-purple-50 border border-purple-200 rounded-xl flex items-start gap-2.5 text-xs text-purple-900">
            <Info className="h-4 w-4 text-purple-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">No Physical Stock or Warehouse Rack Required</p>
              <p className="text-purple-700 text-[11px] mt-0.5">
                Combos do not have independent stock or physical rack locations. Their availability at any branch is
                calculated on the fly from the minimum available inventory across all component items.
              </p>
            </div>
          </div>

          {/* Basic Details Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
            {/* Category Dropdown */}
            <div className="sm:col-span-6">
              <UniversalDropdown
                label="Category *"
                value={category}
                onChange={handleCategoryChange}
                options={categories.map((c) => ({ value: c, label: c }))}
                addNewLabel="+ Add New Category"
                addNewPlaceholder="e.g. Industrial IoT"
                onAddNew={handleAddNewCategory}
              />
            </div>

            {/* Subcategory Dropdown */}
            <div className="sm:col-span-6">
              <UniversalDropdown
                label="Subcategory *"
                value={subcategory}
                onChange={handleSubcategoryChange}
                options={availableSubcategories.map((s) => ({ value: s, label: s }))}
                addNewLabel="+ Add New Subcategory"
                addNewPlaceholder="e.g. Modbus Gateways"
                onAddNew={handleAddNewSubcategory}
              />
            </div>

            {/* Combo Name */}
            <div className="sm:col-span-8">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Combo Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={comboName}
                onChange={(e) => setComboName(e.target.value)}
                placeholder="e.g. PLC Automation Starter Kit"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:bg-white focus:outline-none focus:border-purple-600 transition-all"
              />
            </div>

            {/* Combo Code (Auto-generated with sequence) */}
            <div className="sm:col-span-4">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                  <span>Combo Code</span>
                  <span className="text-[10px] text-purple-700 font-semibold bg-purple-50 px-1.5 py-0.2 rounded border border-purple-200 uppercase font-mono">
                    {isCodeOverridden ? 'Manual' : 'Auto'}
                  </span>
                </label>
                <button
                  type="button"
                  onClick={handleAutoGenerateCode}
                  className="text-[10px] text-purple-600 hover:text-purple-700 font-bold cursor-pointer"
                >
                  + Auto Assign
                </button>
              </div>
              <input
                type="text"
                value={comboCode}
                onChange={(e) => {
                  setComboCode(e.target.value);
                  setIsCodeOverridden(true);
                }}
                placeholder="e.g. AUT-PLC-0001"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-purple-700 focus:bg-white focus:outline-none focus:border-purple-600 transition-all"
              />
            </div>

            {/* Description (Optional) */}
            <div className="sm:col-span-12">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Description / Bundle Inclusions <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short summary of what this combo bundle offers to customers..."
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:bg-white focus:outline-none focus:border-purple-600 transition-all resize-y"
              />
            </div>

            {/* Combo Image File Upload with Live Thumbnail Preview */}
            <div className="sm:col-span-12">
              <ImageUploadField
                value={imageUrl}
                onChange={setImageUrl}
                label="Combo Image"
                altText={comboName || 'Combo Preview'}
              />
            </div>
          </div>

          {/* Components Section */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <div>
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                  <span>Components</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-mono font-bold">
                    {componentRows.length} items (Min 2)
                  </span>
                </h3>
                <p className="text-[11px] text-slate-500">
                  Select existing catalog products and specify the exact quantity needed per combo unit
                </p>
              </div>

              <button
                type="button"
                onClick={handleAddComponent}
                className="px-2.5 py-1 text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg border border-purple-200 flex items-center gap-1 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Component</span>
              </button>
            </div>

            {/* Component Rows Header Strip */}
            <div className="hidden sm:grid grid-cols-12 gap-3 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 rounded-lg">
              <div className="col-span-1 text-center">#</div>
              <div className="col-span-4">Component Product</div>
              <div className="col-span-2 text-right">Catalog Price (Unit)</div>
              <div className="col-span-2 text-right">Qty Needed</div>
              <div className="col-span-2 text-right">Line Total</div>
              <div className="col-span-1 text-center"></div>
            </div>

            {/* Component Rows Table */}
            <div className="space-y-2.5">
              {componentRows.map((row, idx) => {
                const item = items.find((i) => i.id === row.itemId);
                const subtotal = item ? item.salePrice * row.quantity : 0;

                return (
                  <div
                    key={row.id}
                    className="p-3 rounded-xl bg-slate-50/80 border border-slate-200 grid grid-cols-1 sm:grid-cols-12 gap-3 items-center"
                  >
                    {/* Index */}
                    <div className="col-span-1 text-center font-mono font-bold text-slate-400 text-xs">
                      #{idx + 1}
                    </div>

                    {/* Catalog Item Search Dropdown */}
                    <div className="col-span-4 relative">
                      <ItemSearchDropdown
                        value={
                          row.searchQuery !== undefined
                            ? row.searchQuery
                            : item
                            ? `${item.itemName} (${item.itemCode})`
                            : ''
                        }
                        onChange={(val) => handleUpdateComponent(row.id, { searchQuery: val })}
                        onSelectItem={(selected) =>
                          handleUpdateComponent(row.id, { itemId: selected.id, searchQuery: undefined })
                        }
                        selectedBranchId={currentBranch}
                        lockOutOfStock={false}
                        placeholder="Search product from catalog..."
                        dropdownWidth="w-[440px]"
                        inputClassName="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-purple-600"
                      />
                      {item && (
                        <div className="text-[10px] text-slate-500 mt-1 flex items-center justify-between">
                          <span className="font-mono text-purple-700 font-bold">{item.itemCode}</span>
                          <span className="text-slate-400">Unit: {item.unit}</span>
                        </div>
                      )}
                    </div>

                    {/* Dedicated Catalog Sale Price Column (Read-Only Reference) */}
                    <div className="col-span-2 text-right">
                      <label className="block text-[9px] font-bold uppercase text-slate-400 mb-0.5 sm:hidden">
                        Catalog Price
                      </label>
                      <div className="font-mono font-bold text-xs text-slate-800">
                        {item ? formatCurrency(item.salePrice) : '—'}
                      </div>
                      <span className="text-[9px] text-slate-400 hidden sm:block">Per {item?.unit || 'Unit'}</span>
                    </div>

                    {/* Quantity per Combo */}
                    <div className="col-span-2">
                      <label className="block text-[9px] font-bold uppercase text-slate-400 mb-0.5 sm:hidden">
                        Qty Needed
                      </label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        required
                        value={row.quantity}
                        onChange={(e) =>
                          handleUpdateComponent(row.id, {
                            quantity: Math.max(1, parseInt(e.target.value, 10) || 1),
                          })
                        }
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold text-right text-slate-900 focus:outline-none focus:border-purple-600"
                      />
                    </div>

                    {/* Subtotal */}
                    <div className="col-span-2 text-right">
                      <label className="block text-[9px] font-bold uppercase text-slate-400 mb-0.5 sm:hidden">
                        Subtotal
                      </label>
                      <span className="font-mono font-bold text-xs text-slate-900 block">
                        {formatCurrency(subtotal)}
                      </span>
                      <span className="text-[9px] text-slate-400 hidden sm:block">Component Total</span>
                    </div>

                    {/* Delete Row Action */}
                    <div className="col-span-1 text-center">
                      <button
                        type="button"
                        onClick={() => handleRemoveComponent(row.id)}
                        disabled={componentRows.length <= 2}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        title={componentRows.length <= 2 ? 'Minimum 2 components required' : 'Remove component'}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Pricing Section */}
          <div className="border-t border-slate-200 pt-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-end">
              <div className="sm:col-span-6">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Set Combo Price (Pre-Tax) <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
                    ₹
                  </span>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    required
                    value={comboPrice}
                    onChange={(e) =>
                      setComboPrice(e.target.value === '' ? '' : parseFloat(e.target.value))
                    }
                    placeholder="Enter bundle offer price..."
                    className="w-full pl-8 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono font-black text-slate-900 focus:bg-white focus:outline-none focus:border-purple-600 transition-all"
                  />
                </div>
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Static global bundle price. Applies across all branches.
                </span>
              </div>

              {/* Buying Separately Reference Display */}
              <div className="sm:col-span-6 bg-slate-50 p-3 rounded-xl border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-500 block">
                    Individual Catalog Total
                  </span>
                  <span className="text-base font-black text-slate-900 font-mono">
                    {formatCurrency(liveCalculations.buyingSeparately)}
                  </span>
                </div>
                <span className="text-xs text-slate-400 font-medium">
                  Sum of components
                </span>
              </div>
            </div>

            {/* LIVE SAVINGS CALLOUT BANNER (User Prompt Mandate) */}
            <div
              className={cn(
                'p-4 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3',
                liveCalculations.savings >= 0
                  ? 'bg-emerald-50/90 border-emerald-300 text-emerald-950'
                  : 'bg-amber-50/90 border-amber-300 text-amber-950'
              )}
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'h-10 w-10 rounded-xl flex items-center justify-center shrink-0 font-bold',
                    liveCalculations.savings >= 0
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-amber-100 text-amber-700'
                  )}
                >
                  {liveCalculations.savings >= 0 ? (
                    <Sparkles className="h-5 w-5" />
                  ) : (
                    <TrendingDown className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <div className="text-xs font-black tracking-wide flex items-center gap-2 flex-wrap">
                    <span>Buying separately: {formatCurrency(liveCalculations.buyingSeparately)}</span>
                    <span>·</span>
                    <span>Combo Price: {formatCurrency(liveCalculations.numericComboPrice)}</span>
                    <span>·</span>
                    <span
                      className={cn(
                        'font-black',
                        liveCalculations.savings >= 0 ? 'text-emerald-700' : 'text-amber-800'
                      )}
                    >
                      Savings: {formatCurrency(Math.abs(liveCalculations.savings))}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    {liveCalculations.savings >= 0
                      ? `Customers save ${formatCurrency(liveCalculations.savings)} (${liveCalculations.savingsPercent}%) by purchasing this combo bundle.`
                      : `Note: Combo price is ${formatCurrency(Math.abs(liveCalculations.savings))} higher than buying components individually.`}
                  </p>
                </div>
              </div>

              {liveCalculations.savings > 0 && (
                <div className="shrink-0">
                  <span className="px-2.5 py-1 rounded-full text-xs font-black bg-emerald-600 text-white shadow-xs">
                    Save {liveCalculations.savingsPercent}%
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-xs hover:shadow transition-all flex items-center gap-1.5"
            >
              <Layers className="h-4 w-4" />
              <span>{editingCombo ? 'Update Combo Bundle' : 'Create Combo Bundle'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
