import React, { useState, useMemo } from 'react';
import { useErp } from '../../context/ErpContext';
import { Item, ComboItem, BRANCHES, BranchScope } from '../../types';
import { formatCurrency, cn } from '../../lib/utils';
import {
  Plus,
  Search,
  Building,
  Edit2,
  Trash2,
  Layers,
  Copy,
  Check,
  Percent,
  SlidersHorizontal,
  Lock,
  ArrowUpDown,
  Tag,
  Boxes,
  HelpCircle,
  TrendingUp,
  History,
  Sparkles,
} from 'lucide-react';
import { AddItemModal } from './AddItemModal';
import { EditItemModal } from './EditItemModal';
import { BranchStockModal } from './BranchStockModal';
import { CreateComboModal } from './CreateComboModal';
import { ItemImage } from '../common/ItemImage';
import { toast } from 'sonner';

export const ItemMasterView: React.FC = () => {
  const {
    items,
    getBranchStock,
    getTotalStockAcrossBranches,
    currentBranch,
    isAllBranches,
    currentBranchData,
    switchBranch,
    deleteItem,
    combos,
    deleteCombo,
    getComboAvailability,
    getComboBuyingSeparatelyPrice,
    canManageItems,
    currentUser,
  } = useErp();

  const [activeMainTab, setActiveMainTab] = useState<'products' | 'combos'>('products');
  const [searchQuery, setSearchQuery] = useState('');
  const [comboSearchQuery, setComboSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'name' | 'code' | 'price' | 'stock'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Modals state
  const [isAddModalOpen, setAddModalOpen] = useState(false);
  const [isCreateComboModalOpen, setCreateComboModalOpen] = useState(false);
  const [editingCombo, setEditingCombo] = useState<ComboItem | null>(null);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [itemModalTab, setItemModalTab] = useState<'pricing' | 'stock' | 'history'>('pricing');
  const [stockModalItem, setStockModalItem] = useState<Item | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Extract unique categories
  const categories = useMemo(() => {
    const set = new Set(items.map((i) => i.category));
    return ['ALL', ...Array.from(set)];
  }, [items]);

  // Filtered & Sorted items
  const filteredItems = useMemo(() => {
    return items
      .filter((item) => {
        const matchesSearch =
          item.itemName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.itemCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.itemHSN.includes(searchQuery) ||
          item.category.toLowerCase().includes(searchQuery.toLowerCase());

        const matchesCategory =
          selectedCategory === 'ALL' || item.category === selectedCategory;

        return matchesSearch && matchesCategory;
      })
      .sort((a, b) => {
        if (sortBy === 'name') {
          const comp = a.itemName.localeCompare(b.itemName);
          return sortOrder === 'asc' ? comp : -comp;
        }
        if (sortBy === 'code') {
          const comp = a.itemCode.localeCompare(b.itemCode);
          return sortOrder === 'asc' ? comp : -comp;
        }
        if (sortBy === 'price') {
          return sortOrder === 'asc' ? a.salePrice - b.salePrice : b.salePrice - a.salePrice;
        }
        if (sortBy === 'stock') {
          const stockA = isAllBranches
            ? getTotalStockAcrossBranches(a.id)
            : getBranchStock(a.id, currentBranch)?.quantity || 0;
          const stockB = isAllBranches
            ? getTotalStockAcrossBranches(b.id)
            : getBranchStock(b.id, currentBranch)?.quantity || 0;
          return sortOrder === 'asc' ? stockA - stockB : stockB - stockA;
        }
        return 0;
      });
  }, [
    items,
    searchQuery,
    selectedCategory,
    sortBy,
    sortOrder,
    currentBranch,
    isAllBranches,
    getBranchStock,
    getTotalStockAcrossBranches,
  ]);

  // Filtered combos
  const filteredCombos = useMemo(() => {
    return combos.filter((combo) => {
      if (!comboSearchQuery.trim()) return true;
      const q = comboSearchQuery.toLowerCase().trim();
      return (
        combo.comboName.toLowerCase().includes(q) ||
        combo.comboCode.toLowerCase().includes(q) ||
        (combo.description && combo.description.toLowerCase().includes(q))
      );
    });
  }, [combos, comboSearchQuery]);

  // Stats
  const stats = useMemo(() => {
    let totalItems = items.length;
    let prices = items.map((i) => i.salePrice);
    let avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
    let totalStockInScope = items.reduce((acc, i) => {
      if (isAllBranches) {
        return acc + getTotalStockAcrossBranches(i.id);
      } else {
        return acc + (getBranchStock(i.id, currentBranch)?.quantity || 0);
      }
    }, 0);
    return { totalItems, avgPrice, totalStockInScope };
  }, [items, currentBranch, isAllBranches, getBranchStock, getTotalStockAcrossBranches]);

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    toast.success(`Copied code: ${code}`);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleDelete = (item: Item) => {
    if (!canManageItems) {
      toast.error('Permission denied: You do not have permission to delete items');
      return;
    }
    if (
      confirm(
        `Are you sure you want to delete "${item.itemName}"? This will remove it from the master catalog.`
      )
    ) {
      deleteItem(item.id);
    }
  };

  const handleDeleteCombo = (combo: ComboItem) => {
    if (!canManageItems) {
      toast.error('Permission denied: You do not have permission to delete combo items');
      return;
    }
    if (
      confirm(
        `Are you sure you want to delete combo bundle "${combo.comboName}" (${combo.comboCode})?`
      )
    ) {
      deleteCombo(combo.id);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 w-full">
      {/* Top Banner: Catalog Pricing & Stock Callout */}
      <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="h-11 w-11 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700 shrink-0">
            {isAllBranches ? <Layers className="h-5 w-5" /> : <Building className="h-5 w-5" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                Items — Stock Location: {isAllBranches ? 'All Branches' : currentBranchData?.name}
              </h1>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                {isAllBranches ? 'All Branches' : currentBranchData?.name}
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              Catalog sale prices are uniform across all branches. Stock counts reflect{' '}
              <strong className="text-slate-900">
                {isAllBranches ? 'combined inventory across 3 warehouses' : currentBranchData?.location}
              </strong>.
            </p>
          </div>
        </div>

        {/* Quick Branch Switcher */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200 shrink-0">
          <span className="text-[11px] uppercase font-bold text-slate-500 px-2">Branch:</span>
          {currentUser.role === 'CEO' && (
            <button
              onClick={() => switchBranch('all')}
              className={cn(
                'px-2.5 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer',
                isAllBranches
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white'
              )}
            >
              All Branches
            </button>
          )}

          {BRANCHES.filter((b) =>
            currentUser.role === 'CEO' ? true : b.id === (currentUser.assignedBranchId || 'coimbatore')
          ).map((b) => (
            <button
              key={b.id}
              onClick={() => switchBranch(b.id as BranchScope)}
              className={cn(
                'px-2.5 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer',
                !isAllBranches && currentBranch === b.id
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white'
              )}
            >
              {b.name}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500">
              {activeMainTab === 'combos' ? 'Total Combos' : 'Total Items'}
            </span>
            <div className="text-xl sm:text-2xl sm:text-3xl lg:text-4xl font-black text-slate-900 tracking-tight font-mono mt-1">
              {activeMainTab === 'combos' ? combos.length : stats.totalItems}
            </div>
            <span className="text-[11px] text-slate-400 mt-0.5 block">
              {activeMainTab === 'combos' ? 'Bundle templates configured' : 'Catalog products'}
            </span>
          </div>
          <div className="h-11 w-11 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-blue-600">
            {activeMainTab === 'combos' ? <Layers className="h-5 w-5 text-purple-600" /> : <Boxes className="h-5 w-5" />}
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500">
              {activeMainTab === 'combos' ? 'In-Stock Combos' : 'Avg. Sale Price'}
            </span>
            <div className="text-xl sm:text-2xl sm:text-3xl lg:text-4xl font-black text-slate-900 tracking-tight font-mono mt-1">
              {activeMainTab === 'combos'
                ? combos.filter((c) => getComboAvailability(c, currentBranch) > 0).length
                : formatCurrency(stats.avgPrice)}
            </div>
            <span className="text-[11px] text-slate-400 mt-0.5 block">
              {activeMainTab === 'combos'
                ? `Ready at ${isAllBranches ? 'all branches' : currentBranchData?.name}`
                : 'Across all items'}
            </span>
          </div>
          <div className="h-11 w-11 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-emerald-600">
            {activeMainTab === 'combos' ? <Sparkles className="h-5 w-5 text-emerald-600" /> : <Tag className="h-5 w-5" />}
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500">
              {isAllBranches ? 'Total Available Stock' : `Stock (${currentBranchData?.name})`}
            </span>
            <div className="text-xl sm:text-2xl sm:text-3xl lg:text-4xl font-black text-blue-700 tracking-tight font-mono mt-1">
              {stats.totalStockInScope} Units
            </div>
            <span className="text-[11px] text-slate-400 mt-0.5 block">
              {isAllBranches ? 'Across all 3 branches' : currentBranchData?.location}
            </span>
          </div>
          <div className="h-11 w-11 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700">
            <TrendingUp className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* Main Top Navigation Tabs: Products vs Combos */}
      <div className="flex items-center gap-2 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveMainTab('products')}
          className={cn(
            'flex items-center gap-2 px-5 py-3 text-xs font-black border-b-2 transition-all cursor-pointer',
            activeMainTab === 'products'
              ? 'border-blue-600 text-blue-700 bg-white shadow-2xs rounded-t-xl'
              : 'border-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-100/60 rounded-t-xl'
          )}
        >
          <Boxes className="h-4 w-4" />
          <span>Products Catalog</span>
          <span
            className={cn(
              'px-2 py-0.5 rounded-full text-[11px] font-mono font-bold',
              activeMainTab === 'products'
                ? 'bg-blue-100 text-blue-800'
                : 'bg-slate-100 text-slate-600'
            )}
          >
            {items.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveMainTab('combos')}
          className={cn(
            'flex items-center gap-2 px-5 py-3 text-xs font-black border-b-2 transition-all cursor-pointer',
            activeMainTab === 'combos'
              ? 'border-purple-600 text-purple-700 bg-white shadow-2xs rounded-t-xl'
              : 'border-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-100/60 rounded-t-xl'
          )}
        >
          <Layers className="h-4 w-4" />
          <span>Combos & Bundles</span>
          <span
            className={cn(
              'px-2 py-0.5 rounded-full text-[11px] font-mono font-bold',
              activeMainTab === 'combos'
                ? 'bg-purple-100 text-purple-800'
                : 'bg-slate-100 text-slate-600'
            )}
          >
            {combos.length}
          </span>
        </button>
      </div>

      {/* PRODUCTS TAB VIEW */}
      {activeMainTab === 'products' && (
        <>
          {/* Action Bar: Search, Category Filter Pills, & Add Item */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 shadow-xs">
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
              {/* Search bar */}
              <div className="relative flex-1 max-w-md">
                <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by Item Name, Code, HSN, or Category..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 text-xs focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                />
              </div>

              {/* Sort Controls & Action */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs">
                  <ArrowUpDown className="h-3.5 w-3.5 text-slate-400 ml-1.5" />
                  <button
                    onClick={() => {
                      if (sortBy === 'price') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                      else {
                        setSortBy('price');
                        setSortOrder('asc');
                      }
                    }}
                    className={cn(
                      'px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
                      sortBy === 'price' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-slate-900'
                    )}
                  >
                    Sort Price {sortBy === 'price' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                  </button>
                  <button
                    onClick={() => {
                      if (sortBy === 'stock') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                      else {
                        setSortBy('stock');
                        setSortOrder('asc');
                      }
                    }}
                    className={cn(
                      'px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
                      sortBy === 'stock' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-slate-900'
                    )}
                  >
                    Sort Stock {sortBy === 'stock' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                  </button>
                </div>

                {/* Add Item Button */}
                {currentUser.role !== 'Sales' && (
                  <button
                    onClick={() => setAddModalOpen(true)}
                    disabled={!canManageItems}
                    title={
                      !canManageItems
                        ? 'Billing role cannot add new items (Read-Only Mode)'
                        : 'Add new master item'
                    }
                    className={cn(
                      'flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer',
                      canManageItems
                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                        : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                    )}
                  >
                    <Plus className="h-4 w-4" />
                    <span>Add Item</span>
                    {!canManageItems && <Lock className="h-3 w-3 ml-1 text-slate-400" />}
                  </button>
                )}
              </div>
            </div>

            {/* Category Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
              <span className="text-slate-500 text-[11px] font-bold uppercase tracking-wider flex items-center gap-1 mr-1 shrink-0">
                <SlidersHorizontal className="h-3 w-3" /> Filter:
              </span>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={cn(
                    'px-3 py-1 rounded-lg font-semibold whitespace-nowrap transition-colors text-xs shrink-0 cursor-pointer',
                    selectedCategory === cat
                      ? 'bg-blue-50 text-blue-700 border border-blue-300'
                      : 'bg-slate-100 text-slate-600 hover:text-slate-900 border border-slate-200'
                  )}
                >
                  {cat === 'ALL' ? 'All Categories' : cat}
                </button>
              ))}
            </div>
          </div>

          {/* Main Item Master Table */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[11px] tracking-wider">
                    <th className="py-3.5 px-4">Item Details</th>
                    <th className="py-3.5 px-4">Item Code</th>
                    <th className="py-3.5 px-4">Category & Unit</th>
                    <th className="py-3.5 px-4 text-slate-800">
                      <div className="flex items-center gap-1.5">
                        <Tag className="h-3.5 w-3.5 text-blue-600" />
                        <span>Sale Price</span>
                      </div>
                    </th>
                    {currentUser.role !== 'Sales' && <th className="py-3.5 px-4">Wholesale Tier</th>}
                    <th className="py-3.5 px-4 bg-blue-50/60 border-x border-blue-200 text-blue-900">
                      <div className="flex items-center gap-1.5">
                        <Building className="h-3.5 w-3.5 text-blue-600" />
                        <span>
                          {isAllBranches ? 'Total Stock (All Branches)' : `Stock (${currentBranchData?.name})`}
                        </span>
                      </div>
                    </th>
                    {currentUser.role !== 'Sales' && (
                      <th className="py-3.5 px-4 text-right">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={currentUser.role === 'Sales' ? 5 : 7} className="py-12 text-center text-slate-500">
                        <Boxes className="h-8 w-8 mx-auto text-slate-300 mb-2" />
                        <p className="font-bold text-sm text-slate-700">No items found</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Try adjusting your search filter or add a new item.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map((item) => {
                      const qty = isAllBranches
                        ? getTotalStockAcrossBranches(item.id)
                        : getBranchStock(item.id, currentBranch)?.quantity ?? 0;

                      const branchStockRecord = !isAllBranches
                        ? getBranchStock(item.id, currentBranch)
                        : undefined;
                      const rackLoc = branchStockRecord?.location?.trim();

                      return (
                        <tr
                          key={item.id}
                          className="hover:bg-slate-50/80 transition-colors group"
                        >
                          {/* Item Details */}
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-3">
                              <ItemImage
                                src={item.imageUrl}
                                alt={item.itemName}
                                className="h-9 w-9 rounded-xl shrink-0"
                                iconClassName="h-4 w-4"
                                fallbackIcon="boxes"
                              />
                              <div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingItem(item);
                                    setItemModalTab('history');
                                  }}
                                  className="font-bold text-slate-900 group-hover:text-blue-700 transition-colors text-left hover:underline cursor-pointer"
                                  title="Click to view item details and history"
                                >
                                  {item.itemName}
                                </button>
                                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                                  <span>HSN: {item.itemHSN}</span>
                                  <span>•</span>
                                  <span>GST: {item.gstTaxSlab}%</span>
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Item Code */}
                          <td className="py-3.5 px-4">
                            <button
                              onClick={() => handleCopyCode(item.itemCode)}
                              title="Click to copy code"
                              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 hover:border-slate-300 font-mono text-[11px] text-slate-700 transition-colors group/code cursor-pointer"
                            >
                              <span>{item.itemCode}</span>
                              {copiedCode === item.itemCode ? (
                                <Check className="h-3 w-3 text-emerald-600" />
                              ) : (
                                <Copy className="h-3 w-3 text-slate-400 group-hover/code:text-slate-600" />
                              )}
                            </button>
                          </td>

                          {/* Category & Unit */}
                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-slate-800">{item.category}</div>
                            {item.subcategory && (
                              <div className="text-[11px] text-slate-500 font-medium">
                                ↳ {item.subcategory}
                              </div>
                            )}
                            <div className="text-[11px] text-slate-400 uppercase font-mono mt-0.5">
                              Unit: {item.unit}
                            </div>
                          </td>

                          {/* STATIC MASTER SALE PRICE COLUMN */}
                          <td className="py-3.5 px-4">
                            <div>
                              <div className="flex items-baseline gap-1.5">
                                <span className="font-black text-sm text-slate-900">
                                  {formatCurrency(item.salePrice)}
                                </span>
                                <span className="text-[11px] text-slate-500">
                                  {item.salePriceTaxMode === 'with' ? 'Incl. Tax' : 'Excl. Tax'}
                                </span>
                              </div>
                              {item.discountOnSalePrice && item.discountOnSalePrice > 0 ? (
                                <div className="text-[11px] text-emerald-700 flex items-center gap-0.5 font-medium mt-0.5">
                                  <Percent className="h-2.5 w-2.5" />
                                  <span>
                                    Disc: {item.discountOnSalePrice}
                                    {item.discountType}
                                  </span>
                                </div>
                              ) : null}
                            </div>
                          </td>

                          {/* Wholesale Tier */}
                          {currentUser.role !== 'Sales' && (
                            <td className="py-3.5 px-4">
                              {item.wholesalePrice > 0 ? (
                                <div>
                                  <span className="font-semibold text-slate-800">
                                    {formatCurrency(item.wholesalePrice)}
                                  </span>
                                  <span className="text-[11px] text-slate-500 block">
                                    Min. {item.minWholesaleQty} {item.unit}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                          )}

                          {/* BRANCH SCOPED STOCK COLUMN */}
                          <td className="py-3.5 px-4 bg-blue-50/40 border-x border-blue-100">
                            <div className="flex flex-col">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-black text-sm text-slate-900">
                                  {qty} {item.unit}
                                </span>
                                <span className="text-slate-300 text-xs font-normal">·</span>
                                {qty > (item.reorderThreshold ?? 10) ? (
                                  <span className="text-[11px] font-bold px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                                    In Stock
                                  </span>
                                ) : qty > 0 ? (
                                  <span className="text-[11px] font-bold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 border border-amber-200">
                                    Low
                                  </span>
                                ) : (
                                  <span className="text-[11px] font-bold px-1.5 py-0.2 rounded bg-rose-100 text-rose-800 border border-rose-200">
                                    Out
                                  </span>
                                )}
                              </div>
                              {!isAllBranches && (
                                <div className="text-[11px] text-slate-500 font-medium mt-0.5">
                                  {rackLoc ? (
                                    <span className="font-mono text-slate-700">
                                      {rackLoc.toLowerCase().startsWith('rack') ||
                                      rackLoc.toLowerCase().startsWith('row') ||
                                      rackLoc.toLowerCase().startsWith('shelf') ||
                                      rackLoc.toLowerCase().startsWith('bin')
                                        ? rackLoc
                                        : `Rack ${rackLoc}`}
                                    </span>
                                  ) : (
                                    <span className="text-slate-400 font-mono">—</span>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Actions */}
                          {currentUser.role !== 'Sales' && (
                            <td className="py-3.5 px-4 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                {/* Multi-Branch Stock Overview Button */}
                                <button
                                  onClick={() => setStockModalItem(item)}
                                  title="View stock levels across all branches"
                                  className="p-1.5 rounded-lg bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-600 border border-slate-200 transition-colors cursor-pointer"
                                >
                                  <Layers className="h-3.5 w-3.5" />
                                </button>

                                {/* Item History Button */}
                                <button
                                  onClick={() => {
                                    setEditingItem(item);
                                    setItemModalTab('history');
                                  }}
                                  title="View Item History (Purchases, Sales & Stock Logs)"
                                  className="p-1.5 rounded-lg bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-600 border border-slate-200 transition-colors cursor-pointer"
                                >
                                  <History className="h-3.5 w-3.5" />
                                </button>

                                {/* Edit Item Button */}
                                <button
                                  onClick={() => {
                                    setEditingItem(item);
                                    setItemModalTab('pricing');
                                  }}
                                  title={
                                    !canManageItems
                                      ? 'View item details'
                                      : 'Edit master item & stock'
                                  }
                                  className="p-1.5 rounded-lg border transition-colors bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200 cursor-pointer"
                                >
                                  <Edit2 className="h-3.5 w-3.5" />
                                </button>

                                {/* Delete Item Button */}
                                <button
                                  onClick={() => handleDelete(item)}
                                  title="Delete item"
                                  disabled={!canManageItems}
                                  className={cn(
                                    'p-1.5 rounded-lg border transition-colors',
                                    canManageItems
                                      ? 'bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-600 border-slate-200 cursor-pointer'
                                      : 'bg-slate-50 text-slate-300 border-slate-200 cursor-not-allowed'
                                  )}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Table Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4 text-blue-600 shrink-0" />
                <span>
                  Switch branches in the top bar to view available stock for each location.
                </span>
              </div>
              <div className="font-mono text-[11px] text-slate-500">
                Showing {filteredItems.length} of {items.length} items
              </div>
            </div>
          </div>
        </>
      )}

      {/* COMBOS TAB VIEW */}
      {activeMainTab === 'combos' && (
        <>
          {/* Action Bar for Combos */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 shadow-xs">
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
              {/* Search bar */}
              <div className="relative flex-1 max-w-md">
                <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search combo by name or code (e.g. CB-0001)..."
                  value={comboSearchQuery}
                  onChange={(e) => setComboSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 text-xs focus:outline-none focus:border-purple-600 focus:ring-1 focus:ring-purple-600"
                />
              </div>

              {/* Notice & Add Combo Button */}
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-purple-700 bg-purple-50 px-2.5 py-1 rounded-lg border border-purple-200 font-medium hidden sm:inline-block">
                  Live availability for <strong>{isAllBranches ? 'All Branches' : currentBranchData?.name}</strong>
                </span>

                {currentUser.role !== 'Sales' && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCombo(null);
                      setCreateComboModalOpen(true);
                    }}
                    disabled={!canManageItems}
                    title={
                      !canManageItems
                        ? 'Billing role cannot create combos (Read-Only Mode)'
                        : 'Create new bundled offer'
                    }
                    className={cn(
                      'flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer',
                      canManageItems
                        ? 'bg-purple-600 hover:bg-purple-700 text-white'
                        : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                    )}
                  >
                    <Plus className="h-4 w-4" />
                    <span>Create Combo</span>
                    {!canManageItems && <Lock className="h-3 w-3 ml-1 text-slate-400" />}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Combos Table */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-4 w-12 text-center">#</th>
                    <th className="py-3 px-4">Combo Name & Code</th>
                    <th className="py-3 px-4">Components Preview</th>
                    <th className="py-3 px-4 text-right">Pricing & Savings</th>
                    <th className="py-3 px-4 text-right">
                      Live Available ({isAllBranches ? 'All Branches' : currentBranchData?.name})
                    </th>
                    {currentUser.role !== 'Sales' && (
                      <th className="py-3 px-4 text-center">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredCombos.length === 0 ? (
                    <tr>
                      <td colSpan={currentUser.role === 'Sales' ? 5 : 6} className="py-12 text-center text-slate-400">
                        <Layers className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                        <p className="font-semibold">No combo items found</p>
                        <p className="text-[11px] mt-0.5">
                          Create bundled offers to sell products together with automated component stock decrementing.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filteredCombos.map((combo, idx) => {
                      const avail = getComboAvailability(combo, currentBranch);
                      const isOutOfStock = avail <= 0;
                      const buyingSeparately = getComboBuyingSeparatelyPrice(combo);
                      const savings = buyingSeparately - combo.comboPrice;
                      const savingsPct =
                        buyingSeparately > 0 && savings > 0
                          ? ((savings / buyingSeparately) * 100).toFixed(0)
                          : '0';

                      // Find bottleneck item if out of stock
                      let bottleneckItemName = '';
                      if (isOutOfStock && combo.components.length > 0) {
                        for (const comp of combo.components) {
                          const stock =
                            currentBranch === 'all'
                              ? getTotalStockAcrossBranches(comp.itemId)
                              : getBranchStock(comp.itemId, currentBranch)?.quantity || 0;
                          if (stock < comp.quantity) {
                            const it = items.find((i) => i.id === comp.itemId);
                            bottleneckItemName = it?.itemName || 'Component';
                            break;
                          }
                        }
                      }

                      return (
                        <tr
                          key={combo.id}
                          className="hover:bg-slate-50/80 transition-colors group"
                        >
                          <td className="py-3.5 px-4 text-center font-mono font-medium text-slate-400">
                            {idx + 1}
                          </td>

                          {/* Combo Details */}
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-3">
                              <ItemImage
                                src={combo.imageUrl}
                                alt={combo.comboName}
                                isCombo={true}
                                className="h-9 w-9 rounded-xl shrink-0"
                                iconClassName="h-4 w-4"
                              />
                              <div>
                                <div className="font-bold text-slate-900 text-xs flex items-center gap-2">
                                  <span>{combo.comboName}</span>
                                  <span className="px-1.5 py-0.2 rounded text-[11px] font-bold bg-purple-100 text-purple-700 border border-purple-200 uppercase">
                                    Combo
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <span className="font-mono text-[11px] text-purple-700 font-bold">
                                    {combo.comboCode}
                                  </span>
                                  <button
                                    onClick={() => handleCopyCode(combo.comboCode)}
                                    className="text-slate-400 hover:text-purple-600 transition-colors p-0.5 cursor-pointer"
                                    title="Copy Combo Code"
                                  >
                                    {copiedCode === combo.comboCode ? (
                                      <Check className="h-3 w-3 text-emerald-600" />
                                    ) : (
                                      <Copy className="h-3 w-3" />
                                    )}
                                  </button>
                                </div>
                                {combo.description && (
                                  <p className="text-[11px] text-slate-500 mt-1 line-clamp-1 max-w-xs">
                                    {combo.description}
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Components Preview */}
                          <td className="py-3.5 px-4">
                            <div className="flex flex-wrap gap-1.5 max-w-md">
                              {combo.components.map((comp, cIdx) => {
                                const it = items.find((i) => i.id === comp.itemId);
                                const compStock =
                                  currentBranch === 'all'
                                    ? getTotalStockAcrossBranches(comp.itemId)
                                    : getBranchStock(comp.itemId, currentBranch)?.quantity || 0;
                                const isCompOut = compStock < comp.quantity;

                                return (
                                  <span
                                    key={cIdx}
                                    title={`${it?.itemName || 'Product'} · ${compStock} available at this branch`}
                                    className={cn(
                                      'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border',
                                      isCompOut
                                        ? 'bg-rose-50 text-rose-700 border-rose-200 font-bold'
                                        : 'bg-slate-100 text-slate-700 border-slate-200'
                                    )}
                                  >
                                    <span className="font-mono font-bold text-purple-700">
                                      {comp.quantity}x
                                    </span>
                                    <span className="truncate max-w-[120px]">
                                      {it?.itemName || 'Item'}
                                    </span>
                                    <span
                                      className={cn(
                                        'font-mono text-[11px]',
                                        isCompOut ? 'text-rose-600' : 'text-slate-400'
                                      )}
                                    >
                                      ({compStock})
                                    </span>
                                  </span>
                                );
                              })}
                            </div>
                          </td>

                          {/* Pricing & Savings */}
                          <td className="py-3.5 px-4 text-right">
                            <div className="font-mono font-black text-slate-900 text-sm">
                              {formatCurrency(combo.comboPrice)}
                            </div>
                            <div className="text-[11px] text-slate-400 flex items-center justify-end gap-1.5 mt-0.5">
                              <span>Separate: {formatCurrency(buyingSeparately)}</span>
                              {savings > 0 && (
                                <span className="font-bold text-emerald-600 bg-emerald-50 px-1 py-0.2 rounded border border-emerald-200">
                                  Save {savingsPct}%
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Live Available Stock */}
                          <td className="py-3.5 px-4 text-right">
                            <div className="flex flex-col items-end gap-1">
                              <span
                                className={cn(
                                  'inline-block px-2.5 py-1 rounded-lg text-xs font-bold font-mono',
                                  isOutOfStock
                                    ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                    : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                )}
                              >
                                {isOutOfStock ? '0 Available' : `${avail} Kits Available`}
                              </span>

                              {isOutOfStock && bottleneckItemName && (
                                <span className="text-[11px] text-rose-600 max-w-[160px] truncate text-right">
                                  Depleted: {bottleneckItemName}
                                </span>
                              )}

                              {!isOutOfStock && (
                                <span className="text-[11px] text-slate-400">
                                  Computed live from components
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Actions */}
                          {currentUser.role !== 'Sales' && (
                            <td className="py-3.5 px-4 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingCombo(combo);
                                    setCreateComboModalOpen(true);
                                  }}
                                  title={canManageItems ? 'Edit Combo Definition' : 'View Combo Details (Read-Only)'}
                                  className="p-1.5 rounded-lg border bg-slate-100 hover:bg-purple-50 hover:text-purple-600 text-slate-600 border-slate-200 transition-colors cursor-pointer"
                                >
                                  <Edit2 className="h-3.5 w-3.5" />
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleDeleteCombo(combo)}
                                  disabled={!canManageItems}
                                  title={canManageItems ? 'Delete Combo Bundle' : 'Billing cannot delete combos'}
                                  className={cn(
                                    'p-1.5 rounded-lg border transition-colors',
                                    canManageItems
                                      ? 'bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-600 border-slate-200 cursor-pointer'
                                      : 'bg-slate-50 text-slate-300 border-slate-200 cursor-not-allowed'
                                  )}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Table Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4 text-purple-600 shrink-0" />
                <span>
                  Combos have zero independent physical stock. Real-time availability reflects component inventory at{' '}
                  <strong>{isAllBranches ? 'all branches' : currentBranchData?.name}</strong>.
                </span>
              </div>
              <div className="font-mono text-[11px] text-slate-500">
                Showing {filteredCombos.length} of {combos.length} combos
              </div>
            </div>
          </div>
        </>
      )}

      {/* Modals */}
      <AddItemModal
        isOpen={isAddModalOpen}
        onClose={() => setAddModalOpen(false)}
      />

      <EditItemModal
        item={editingItem}
        isOpen={!!editingItem}
        onClose={() => setEditingItem(null)}
        initialTab={itemModalTab}
      />

      <BranchStockModal
        item={stockModalItem}
        onClose={() => setStockModalItem(null)}
      />

      <CreateComboModal
        isOpen={isCreateComboModalOpen}
        onClose={() => {
          setCreateComboModalOpen(false);
          setEditingCombo(null);
        }}
        editingCombo={editingCombo}
      />
    </div>
  );
};
