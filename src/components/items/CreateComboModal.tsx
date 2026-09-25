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
  Percent,
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
    getNextComboCode,
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
        const autoCode = getNextComboCode();
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
      const nextCode = getNextComboCode();
      setComboCode(nextCode);
    }
  };

  const handleSubcategoryChange = (newSub: string) => {
    setSubcategory(newSub);
    if (!isCodeOverridden) {
      const nextCode = getNextComboCode();
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
    const code = getNextComboCode();
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

    const finalCode = comboCode.trim() || getNextComboCode();

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
      <div className="bg-white rounded-none shadow-2xl border border-slate-300 w-full max-w-3xl overflow-hidden my-8 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <ItemImage
              src={imageUrl || editingCombo?.imageUrl}
              alt={comboName || 'Combo'}
              isCombo={true}
              className="h-11 w-11 rounded-none shadow-none border border-slate-700"
              iconClassName="h-5 w-5"
            />
            <div>
              <h2 className="text-base font-bold tracking-tight text-white uppercase flex items-center gap-2">
                {editingCombo ? 'Edit Combo Bundle' : 'Create New Combo Item'}
                <span className="text-[11px] uppercase font-mono px-2 py-0.5 rounded-none bg-slate-800 text-slate-200 border border-slate-700">
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
            className="p-1.5 rounded-none text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {/* Info Banner: Zero Independent Stock */}
          <div className="p-3.5 bg-slate-50 border border-slate-300 rounded-none flex items-start gap-2.5 text-xs text-slate-800">
            <Info className="h-4 w-4 text-slate-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">No Physical Stock or Warehouse Rack Required</p>
              <p className="text-slate-600 text-[11px] mt-0.5">
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
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Combo Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={comboName}
                onChange={(e) => setComboName(e.target.value)}
                placeholder="e.g. PLC Automation Starter Kit"
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-none text-xs font-semibold text-slate-900 focus:bg-white focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 transition-all"
              />
            </div>

            {/* Combo Code (Auto-generated with sequence) */}
            <div className="sm:col-span-4">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <span>Combo Code</span>
                  <span className="text-[11px] text-slate-700 font-semibold bg-slate-100 px-1.5 py-0.2 rounded-none border border-slate-300 uppercase font-mono">
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
                value={comboCode}
                onChange={(e) => {
                  setComboCode(e.target.value);
                  setIsCodeOverridden(true);
                }}
                placeholder="e.g. AUT-PLC-0001"
                className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-none text-xs font-mono font-bold text-slate-900 focus:bg-white focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 transition-all"
              />
            </div>

            {/* Description (Optional) */}
            <div className="sm:col-span-12">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Description / Bundle Inclusions <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short summary of what this combo bundle offers to customers..."
                className="w-full px-3.5 py-2 bg-white border border-slate-300 rounded-none text-xs font-medium text-slate-700 focus:bg-white focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 transition-all resize-y"
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
            <div className="flex items-center justify-between border-b border-slate-300 pb-2">
              <div>
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                  <span>Components</span>
                  <span className="px-1.5 py-0.5 rounded-none bg-slate-100 text-slate-700 border border-slate-300 text-[11px] font-mono font-bold">
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
                className="px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-slate-700 bg-white hover:bg-slate-100 rounded-none border border-slate-300 flex items-center gap-1 transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Component</span>
              </button>
            </div>

            {/* Component Rows Header Strip */}
            <div className="hidden sm:grid grid-cols-12 gap-3 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-600 bg-slate-100 border border-slate-300 rounded-none">
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
                    className="p-3 rounded-none bg-slate-50 border border-slate-300 grid grid-cols-1 sm:grid-cols-12 gap-3 items-center"
                  >
                    {/* Index */}
                    <div className="col-span-1 text-center font-mono font-bold text-slate-500 text-xs">
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
                        dropdownWidth="w-[440px] max-w-[calc(100vw-2rem)]"
                        inputClassName="w-full px-3 py-2 rounded-none bg-white border border-slate-300 text-xs font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600"
                      />
                      {item && (
                        <div className="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
                          <span className="font-mono text-red-700 font-bold">{item.itemCode}</span>
                          <span className="text-slate-400">Unit: {item.unit}</span>
                        </div>
                      )}
                    </div>

                    {/* Dedicated Catalog Sale Price Column (Read-Only Reference) */}
                    <div className="col-span-2 text-right">
                      <label className="block text-[11px] font-bold uppercase text-slate-400 mb-0.5 sm:hidden">
                        Catalog Price
                      </label>
                      <div className="font-mono font-bold text-xs text-slate-800">
                        {item ? formatCurrency(item.salePrice) : '—'}
                      </div>
                      <span className="text-[11px] text-slate-400 hidden sm:block">Per {item?.unit || 'Unit'}</span>
                    </div>

                    {/* Quantity per Combo */}
                    <div className="col-span-2">
                      <label className="block text-[11px] font-bold uppercase text-slate-400 mb-0.5 sm:hidden">
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
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-none text-xs font-mono font-bold text-right text-slate-900 focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600"
                      />
                    </div>

                    {/* Subtotal */}
                    <div className="col-span-2 text-right">
                      <label className="block text-[11px] font-bold uppercase text-slate-400 mb-0.5 sm:hidden">
                        Subtotal
                      </label>
                      <span className="font-mono font-bold text-xs text-slate-900 block">
                        {formatCurrency(subtotal)}
                      </span>
                      <span className="text-[11px] text-slate-400 hidden sm:block">Component Total</span>
                    </div>

                    {/* Delete Row Action */}
                    <div className="col-span-1 text-center">
                      <button
                        type="button"
                        onClick={() => handleRemoveComponent(row.id)}
                        disabled={componentRows.length <= 2}
                        className="p-1.5 rounded-none text-slate-400 hover:text-red-700 hover:bg-red-50 border border-transparent hover:border-red-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
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
                  Set Combo Price (Pre-Tax) <span className="text-red-600">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-sm">
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
                    className="w-full pl-8 pr-3.5 py-2 bg-white border border-slate-300 rounded-none text-sm font-mono font-bold text-slate-900 focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 transition-all"
                  />
                </div>
                <span className="text-[11px] text-slate-500 mt-1 block">
                  Static global bundle price. Applies across all branches.
                </span>
              </div>

              {/* Buying Separately Reference Display */}
              <div className="sm:col-span-6 bg-slate-50 p-3 rounded-none border border-slate-300 flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-bold uppercase text-slate-500 block">
                    Individual Catalog Total
                  </span>
                  <span className="text-base font-bold text-slate-900 font-mono">
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
                'p-3.5 rounded-none border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3',
                liveCalculations.savings >= 0
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                  : 'bg-amber-50 border-amber-300 text-amber-950'
              )}
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'h-9 w-9 rounded-none flex items-center justify-center shrink-0 font-bold border',
                    liveCalculations.savings >= 0
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                      : 'bg-amber-100 text-amber-800 border-amber-300'
                  )}
                >
                  {liveCalculations.savings >= 0 ? (
                    <Percent className="h-4 w-4" />
                  ) : (
                    <TrendingDown className="h-4 w-4" />
                  )}
                </div>
                <div>
                  <div className="text-xs font-bold tracking-wide flex items-center gap-2 flex-wrap">
                    <span>Buying separately: {formatCurrency(liveCalculations.buyingSeparately)}</span>
                    <span>·</span>
                    <span>Combo Price: {formatCurrency(liveCalculations.numericComboPrice)}</span>
                    <span>·</span>
                    <span
                      className={cn(
                        'font-bold',
                        liveCalculations.savings >= 0 ? 'text-emerald-700' : 'text-amber-800'
                      )}
                    >
                      {liveCalculations.savings >= 0 ? 'Savings' : 'Extra Cost'}: {formatCurrency(Math.abs(liveCalculations.savings))}
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
                  <span className="px-2.5 py-1 rounded-none text-xs font-bold uppercase tracking-wider bg-emerald-700 text-white border border-emerald-800">
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
              className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-100 rounded-none border border-slate-300 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-bold uppercase tracking-wider text-white bg-red-600 hover:bg-red-700 active:bg-red-800 rounded-none border border-red-700 shadow-none transition-all flex items-center gap-1.5 cursor-pointer"
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
