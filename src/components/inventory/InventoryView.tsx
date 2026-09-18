import React, { useState, useMemo, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import { Item, BranchId, BRANCHES } from '../../types';
import {
  Layers,
  History,
  Search,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Building,
  Boxes,
  Edit3,
  MapPin,
  AlertOctagon,
  Settings,
  Package,
  ChevronDown,
  ChevronUp,
  Info,
  IndianRupee,
  TrendingUp,
  Percent,
} from 'lucide-react';
import { cn, formatCurrency } from '../../lib/utils';
import { ItemImage } from '../common/ItemImage';
import { AdjustStockModal } from './AdjustStockModal';
import { TransferStockModal } from './TransferStockModal';
import { StockHistoryModal } from './StockHistoryModal';
import { ThresholdEditModal } from './ThresholdEditModal';
import { EditLocationModal } from './EditLocationModal';
import { InventorySettingsModal } from './InventorySettingsModal';
import { TransferHistoryModal } from './TransferHistoryModal';

export const InventoryView: React.FC = () => {
  const {
    items,
    branchStocks,
    currentBranch,
    currentBranchData,
    isAllBranches,
    currentUser,
    inventoryFilterQuery,
    setInventoryFilterQuery,
    inventorySettings,
    getItemLastSaleInfo,
    inventoryMovementFilter,
    setInventoryMovementFilter,
    combos,
    getComboAvailability,
    getComboBuyingSeparatelyPrice,
    getTotalStockAcrossBranches,
    getBranchStock,
    activeSubTab,
  } = useErp();

  // Search and Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'in-stock' | 'low-stock' | 'out-of-stock'>('all');
  const [movementFilter, setMovementFilter] = useState<'all' | 'not-moving' | 'active'>(
    inventoryMovementFilter || 'all'
  );

  // Combos Tab & Expand state
  const [activeInventoryTab, setActiveInventoryTab] = useState<'items' | 'combos'>('items');
  const [expandedComboId, setExpandedComboId] = useState<string | null>(null);
  const [comboSearchQuery, setComboSearchQuery] = useState('');

  // Sync search filter from navigation (e.g. from Items module "Manage Stock")
  useEffect(() => {
    if (inventoryFilterQuery) {
      setSearchQuery(inventoryFilterQuery);
      setInventoryFilterQuery('');
    }
  }, [inventoryFilterQuery, setInventoryFilterQuery]);

  // Sync movement filter from external navigation (e.g. from Dashboard KPI card)
  useEffect(() => {
    if (inventoryMovementFilter) {
      setMovementFilter(inventoryMovementFilter);
    }
  }, [inventoryMovementFilter]);

  // Modals state
  const [adjustItem, setAdjustItem] = useState<{ item: Item; branchId?: BranchId } | null>(null);
  const [transferState, setTransferState] = useState<{ item?: Item; from?: BranchId; to?: BranchId } | null>(null);
  const [historyItem, setHistoryItem] = useState<Item | null>(null);
  const [isAllHistoryOpen, setAllHistoryOpen] = useState(false);
  const [isTransferHistoryOpen, setIsTransferHistoryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [thresholdItem, setThresholdItem] = useState<Item | null>(null);
  const [locationModalItem, setLocationModalItem] = useState<{ item: Item; branchId?: BranchId } | null>(null);

  // Synchronize view tab and modals when triggered from secondary navbar flyout
  useEffect(() => {
    if (activeSubTab?.view === 'inventory') {
      const tab = activeSubTab.tab;
      if (tab === 'items') {
        setActiveInventoryTab('items');
      } else if (tab === 'combos') {
        setActiveInventoryTab('combos');
      } else if (tab === 'transfer') {
        setTransferState({});
      } else if (tab === 'transfer-history') {
        setIsTransferHistoryOpen(true);
      } else if (tab === 'audit') {
        setAllHistoryOpen(true);
      }
    }
  }, [activeSubTab]);

  // Available categories from catalog
  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => set.add(i.category));
    return Array.from(set).sort();
  }, [items]);

  // Compute stock and status for an item based on branch scope
  const getItemStockData = (item: Item) => {
    const threshold = item.reorderThreshold ?? 10;

    if (isAllBranches) {
      const branchCounts: Record<BranchId, number> = {
        'erode-hq': 0,
        'coimbatore': 0,
        'chennai': 0,
      };

      let totalStock = 0;
      let latestUpdated = item.updatedAt;

      BRANCHES.forEach((b) => {
        const stockRow = branchStocks.find((s) => s.itemId === item.id && s.branchId === b.id);
        const qty = stockRow?.quantity ?? 0;
        branchCounts[b.id] = qty;
        totalStock += qty;
        if (stockRow?.updatedAt && stockRow.updatedAt > latestUpdated) {
          latestUpdated = stockRow.updatedAt;
        }
      });

      let status: 'in-stock' | 'low-stock' | 'out-of-stock';
      if (totalStock === 0) {
        status = 'out-of-stock';
      } else if (totalStock <= threshold) {
        status = 'low-stock';
      } else {
        status = 'in-stock';
      }

      // Check for imbalances (e.g. one branch has 0 while others have healthy stock)
      const hasBranchZero = Object.values(branchCounts).some((c) => c === 0);
      const hasBranchLow = Object.values(branchCounts).some((c) => c > 0 && c <= Math.ceil(threshold / 3));

      return {
        threshold,
        currentStock: totalStock,
        branchCounts,
        status,
        hasImbalance: hasBranchZero || hasBranchLow,
        latestUpdated,
      };
    } else {
      const stockRow = branchStocks.find(
        (s) => s.itemId === item.id && s.branchId === currentBranch
      );
      const currentStock = stockRow?.quantity ?? 0;
      const latestUpdated = stockRow?.updatedAt || item.updatedAt;

      let status: 'in-stock' | 'low-stock' | 'out-of-stock';
      if (currentStock === 0) {
        status = 'out-of-stock';
      } else if (currentStock <= threshold) {
        status = 'low-stock';
      } else {
        status = 'in-stock';
      }

      return {
        threshold,
        currentStock,
        branchCounts: undefined,
        status,
        hasImbalance: false,
        latestUpdated,
      };
    }
  };

  // Precompute metrics for top KPI cards
  const metrics = useMemo(() => {
    let inStock = 0;
    let lowStock = 0;
    let outOfStock = 0;
    let totalUnits = 0;
    let notMovingCount = 0;
    let activeMovingCount = 0;
    let costValue = 0;
    let retailValue = 0;
    let deadStockValue = 0;

    items.forEach((item) => {
      const data = getItemStockData(item);
      const qty = data.currentStock;
      totalUnits += qty;
      costValue += qty * (item.purchasePrice || 0);
      retailValue += qty * (item.salePrice || 0);
      if (data.status === 'out-of-stock') {
        outOfStock++;
      } else if (data.status === 'low-stock') {
        lowStock++;
      } else {
        inStock++;
      }

      const saleInfo = getItemLastSaleInfo(item.id, isAllBranches ? 'all' : currentBranch);
      if (saleInfo.isDeadStock) {
        notMovingCount++;
        deadStockValue += qty * (item.purchasePrice || 0);
      } else {
        activeMovingCount++;
      }
    });

    const potentialMargin = retailValue - costValue;
    return {
      totalSkus: items.length,
      inStock,
      lowStock,
      outOfStock,
      totalUnits,
      notMovingCount,
      activeMovingCount,
      costValue,
      retailValue,
      deadStockValue,
      potentialMargin,
      marginPct: retailValue > 0 ? Math.round((potentialMargin / retailValue) * 100) : 0,
    };
  }, [items, branchStocks, isAllBranches, currentBranch, inventorySettings, getItemLastSaleInfo]);

  // Filter items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = item.itemName.toLowerCase().includes(q);
        const matchCode = item.itemCode.toLowerCase().includes(q);
        const matchHsn = item.itemHSN.toLowerCase().includes(q);
        const matchCat = item.category.toLowerCase().includes(q);
        if (!matchName && !matchCode && !matchHsn && !matchCat) {
          return false;
        }
      }

      // 2. Category Filter
      if (selectedCategory !== 'all' && item.category !== selectedCategory) {
        return false;
      }

      // 3. Status Filter
      if (statusFilter !== 'all') {
        const data = getItemStockData(item);
        if (data.status !== statusFilter) {
          return false;
        }
      }

      // 4. Movement Filter (Not Moving vs Active)
      if (movementFilter !== 'all') {
        const saleInfo = getItemLastSaleInfo(item.id, isAllBranches ? 'all' : currentBranch);
        if (movementFilter === 'not-moving' && !saleInfo.isDeadStock) {
          return false;
        }
        if (movementFilter === 'active' && saleInfo.isDeadStock) {
          return false;
        }
      }

      return true;
    });
  }, [items, searchQuery, selectedCategory, statusFilter, movementFilter, branchStocks, isAllBranches, currentBranch, inventorySettings, getItemLastSaleInfo]);

  // Filtered combos for Combos Inventory Tab
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

  // Metrics for Combos Inventory Tab
  const comboMetrics = useMemo(() => {
    let inStock = 0;
    let outOfStock = 0;
    let totalAvailableKits = 0;

    combos.forEach((c) => {
      const avail = getComboAvailability(c, currentBranch);
      totalAvailableKits += avail;
      if (avail > 0) inStock++;
      else outOfStock++;
    });

    return {
      totalCombos: combos.length,
      inStock,
      outOfStock,
      totalAvailableKits,
    };
  }, [combos, currentBranch, getComboAvailability]);

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const formatDateShort = (iso: string | null) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return iso;
    }
  };

  const isBillingUser = currentUser.role === 'Billing';

  return (
    <div className="p-4 sm:p-6 space-y-6 w-full">
      {/* Top Banner */}
      <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              {activeInventoryTab === 'combos' ? 'Combos & Kits Inventory' : 'Regular Items Stock'}
            </h1>
            <span
              className={cn(
                'text-[11px] uppercase font-bold px-2 py-0.5 rounded-full border',
                isAllBranches
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              )}
            >
              {isAllBranches ? 'All Branches' : currentBranchData?.name}
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-0.5">
            {isAllBranches
              ? 'Physical inventory and branch balances across Erode HQ, Coimbatore, and Chennai.'
              : `Live physical stock counts and audit history for ${currentBranchData?.name} (${currentBranchData?.location}).`}
          </p>
        </div>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-2.5 flex-wrap self-end md:self-auto">
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            title="Configure Dead Stock Threshold"
            className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Settings className="h-4 w-4 text-slate-600" />
            <span className="text-xs font-semibold">Dead Stock ({inventorySettings.deadStockThresholdDays}d)</span>
          </button>
        </div>
      </div>

      {activeInventoryTab === 'items' && (
        <>
          {/* Inventory Worth — money locked in stock */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 mb-3.5">
            <div className="p-4 rounded-xl border border-slate-200 bg-gradient-to-br from-blue-50/60 to-white shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Stock Value (Cost)</span>
                <div className="h-8 w-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600"><IndianRupee className="h-4 w-4" /></div>
              </div>
              <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1 font-mono tracking-tight">{formatCurrency(metrics.costValue)}</p>
              <span className="text-[11px] text-slate-400 mt-0.5 block">Capital tied up at purchase cost</span>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 bg-gradient-to-br from-emerald-50/60 to-white shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Retail Value</span>
                <div className="h-8 w-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600"><TrendingUp className="h-4 w-4" /></div>
              </div>
              <p className="text-xl sm:text-2xl font-bold text-emerald-700 mt-1 font-mono tracking-tight">{formatCurrency(metrics.retailValue)}</p>
              <span className="text-[11px] text-slate-400 mt-0.5 block">If sold at listed sale price</span>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 bg-gradient-to-br from-violet-50/60 to-white shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Potential Margin</span>
                <div className="h-8 w-8 rounded-lg bg-violet-50 border border-violet-200 flex items-center justify-center text-violet-600"><Percent className="h-4 w-4" /></div>
              </div>
              <p className="text-xl sm:text-2xl font-bold text-violet-700 mt-1 font-mono tracking-tight">{formatCurrency(metrics.potentialMargin)}</p>
              <span className="text-[11px] text-slate-400 mt-0.5 block">{metrics.marginPct}% blended margin on hand</span>
            </div>
            <div
              onClick={() => setMovementFilter(movementFilter === 'not-moving' ? 'all' : 'not-moving')}
              className={cn('p-4 rounded-xl border bg-gradient-to-br from-rose-50/60 to-white shadow-2xs cursor-pointer transition-all hover:border-rose-400',
                movementFilter === 'not-moving' ? 'ring-2 ring-rose-500/20 border-rose-500' : 'border-slate-200')}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Locked in Dead Stock</span>
                <div className="h-8 w-8 rounded-lg bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600"><AlertOctagon className="h-4 w-4" /></div>
              </div>
              <p className="text-xl sm:text-2xl font-bold text-rose-700 mt-1 font-mono tracking-tight">{formatCurrency(metrics.deadStockValue)}</p>
              <span className="text-[11px] text-rose-500 mt-0.5 block">{metrics.notMovingCount} non-moving items · tap to filter</span>
            </div>
          </div>

          {/* KPI Metric Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
        {/* Total Items */}
        <div
          onClick={() => {
            setStatusFilter('all');
            setMovementFilter('all');
          }}
          className={cn(
            'p-4 rounded-xl border bg-white shadow-2xs cursor-pointer transition-all hover:border-blue-400',
            statusFilter === 'all' && movementFilter === 'all'
              ? 'ring-2 ring-blue-500/20 border-blue-500 bg-blue-50/20'
              : 'border-slate-200'
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Items</span>
            <Boxes className="h-4 w-4 text-slate-400" />
          </div>
          <p className="text-xl sm:text-2xl sm:text-3xl font-bold text-slate-900 mt-1">{metrics.totalSkus}</p>
          <span className="text-[11px] text-slate-400 mt-0.5 block">Cataloged items</span>
        </div>

        {/* Healthy / In Stock */}
        <div
          onClick={() => setStatusFilter(statusFilter === 'in-stock' ? 'all' : 'in-stock')}
          className={cn(
            'p-4 rounded-xl border bg-white shadow-2xs cursor-pointer transition-all hover:border-emerald-400',
            statusFilter === 'in-stock' ? 'ring-2 ring-emerald-500/20 border-emerald-500 bg-emerald-50/30' : 'border-slate-200'
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">In Stock</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="text-xl sm:text-2xl sm:text-3xl font-bold text-emerald-700 mt-1">{metrics.inStock}</p>
          <span className="text-[11px] text-emerald-600 mt-0.5 block">&gt; Threshold stock</span>
        </div>

        {/* Low Stock */}
        <div
          onClick={() => setStatusFilter(statusFilter === 'low-stock' ? 'all' : 'low-stock')}
          className={cn(
            'p-4 rounded-xl border bg-white shadow-2xs cursor-pointer transition-all hover:border-amber-400',
            statusFilter === 'low-stock' ? 'ring-2 ring-amber-500/20 border-amber-500 bg-amber-50/30' : 'border-slate-200'
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wider">Low Stock</span>
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </div>
          <p className="text-xl sm:text-2xl sm:text-3xl font-bold text-amber-700 mt-1">{metrics.lowStock}</p>
          <span className="text-[11px] text-amber-600 mt-0.5 block">&le; Threshold alert</span>
        </div>

        {/* Out of Stock */}
        <div
          onClick={() => setStatusFilter(statusFilter === 'out-of-stock' ? 'all' : 'out-of-stock')}
          className={cn(
            'p-4 rounded-xl border bg-white shadow-2xs cursor-pointer transition-all hover:border-rose-400',
            statusFilter === 'out-of-stock' ? 'ring-2 ring-rose-500/20 border-rose-500 bg-rose-50/30' : 'border-slate-200'
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-rose-700 uppercase tracking-wider">Out of Stock</span>
            <XCircle className="h-4 w-4 text-rose-600" />
          </div>
          <p className="text-xl sm:text-2xl sm:text-3xl font-bold text-rose-700 mt-1">{metrics.outOfStock}</p>
          <span className="text-[11px] text-rose-600 mt-0.5 block">0 units on hand</span>
        </div>

        {/* Not Moving / Dead Stock Card */}
        <div
          onClick={() => setMovementFilter(movementFilter === 'not-moving' ? 'all' : 'not-moving')}
          className={cn(
            'p-4 rounded-xl border bg-white shadow-2xs cursor-pointer transition-all hover:border-rose-400',
            movementFilter === 'not-moving'
              ? 'ring-2 ring-rose-500/20 border-rose-500 bg-rose-50/40'
              : 'border-slate-200'
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-rose-800 uppercase tracking-wider">Dead Stock</span>
            <AlertOctagon className="h-4 w-4 text-rose-600" />
          </div>
          <p className="text-xl sm:text-2xl sm:text-3xl font-bold text-rose-800 mt-1">{metrics.notMovingCount}</p>
          <span className="text-[11px] text-rose-600 mt-0.5 block">
            {inventorySettings.deadStockThresholdDays}+ days or never sold
          </span>
        </div>

        {/* Total Physical Units */}
        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Units on Hand</span>
            <Building className="h-4 w-4 text-blue-600" />
          </div>
          <p className="text-xl sm:text-2xl sm:text-3xl font-bold text-blue-700 mt-1">
            {metrics.totalUnits.toLocaleString('en-IN')}
          </p>
          <span className="text-[11px] text-slate-500 mt-0.5 block">
            {isAllBranches ? 'Across all 3 branches' : 'This branch only'}
          </span>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search items by name, code, HSN..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
          />
        </div>

        {/* Category, Movement & Status Filter Controls */}
        <div className="flex items-center gap-2.5 w-full md:w-auto flex-wrap">
          {/* Category dropdown */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 focus:outline-none focus:border-blue-600"
          >
            <option value="all">All Categories ({items.length})</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          {/* Movement Filter Toggle (Not Moving / Active) */}
          <div className="flex flex-wrap items-center bg-slate-100 p-1 rounded-xl gap-1 text-xs font-bold">
            <button
              type="button"
              onClick={() => {
                setMovementFilter('all');
                setInventoryMovementFilter('all');
              }}
              className={cn(
                'px-2.5 py-1 rounded-lg transition-all',
                movementFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              All Movement
            </button>
            <button
              type="button"
              onClick={() => {
                const next = movementFilter === 'not-moving' ? 'all' : 'not-moving';
                setMovementFilter(next);
                setInventoryMovementFilter(next);
              }}
              className={cn(
                'px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5',
                movementFilter === 'not-moving'
                  ? 'bg-rose-600 text-white shadow-2xs'
                  : 'text-rose-700 hover:bg-rose-50'
              )}
            >
              <AlertOctagon className="h-3 w-3" />
              <span>Not Moving</span>
              <span
                className={cn(
                  'px-1.5 py-0.2 rounded-full text-[11px] font-extrabold',
                  movementFilter === 'not-moving' ? 'bg-white/20 text-white' : 'bg-rose-100 text-rose-800'
                )}
              >
                {metrics.notMovingCount}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                const next = movementFilter === 'active' ? 'all' : 'active';
                setMovementFilter(next);
                setInventoryMovementFilter(next);
              }}
              className={cn(
                'px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5',
                movementFilter === 'active'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'text-emerald-700 hover:bg-emerald-50'
              )}
            >
              <CheckCircle2 className="h-3 w-3" />
              <span>Active</span>
              <span
                className={cn(
                  'px-1.5 py-0.2 rounded-full text-[11px] font-extrabold',
                  movementFilter === 'active' ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-800'
                )}
              >
                {metrics.activeMovingCount}
              </span>
            </button>
          </div>

          {/* Status Pills */}
          <div className="flex flex-wrap items-center bg-slate-100 p-1 rounded-xl gap-1 text-xs font-bold">
            <button
              onClick={() => setStatusFilter('all')}
              className={cn(
                'px-2.5 py-1 rounded-lg transition-all',
                statusFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              All Status
            </button>
            <button
              onClick={() => setStatusFilter('in-stock')}
              className={cn(
                'px-2.5 py-1 rounded-lg transition-all flex items-center gap-1',
                statusFilter === 'in-stock'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'text-emerald-700 hover:bg-emerald-50'
              )}
            >
              In Stock
            </button>
            <button
              onClick={() => setStatusFilter('low-stock')}
              className={cn(
                'px-2.5 py-1 rounded-lg transition-all flex items-center gap-1',
                statusFilter === 'low-stock'
                  ? 'bg-amber-500 text-slate-900 shadow-2xs'
                  : 'text-amber-700 hover:bg-amber-50'
              )}
            >
              Low Stock
            </button>
            <button
              onClick={() => setStatusFilter('out-of-stock')}
              className={cn(
                'px-2.5 py-1 rounded-lg transition-all flex items-center gap-1',
                statusFilter === 'out-of-stock'
                  ? 'bg-rose-600 text-white shadow-2xs'
                  : 'text-rose-700 hover:bg-rose-50'
              )}
            >
              Out of Stock
            </button>
          </div>
        </div>
      </div>

      {/* Main Inventory Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
                <th className="py-3.5 px-4">Item Details</th>
                <th className="py-3.5 px-3">Category</th>
                <th className="py-3.5 px-3">Location</th>
                {isAllBranches ? (
                  <>
                    <th className="py-3.5 px-3 text-center">Erode HQ</th>
                    <th className="py-3.5 px-3 text-center">Coimbatore</th>
                    <th className="py-3.5 px-3 text-center">Chennai</th>
                    <th className="py-3.5 px-3 text-center bg-blue-50/50 text-blue-900 font-extrabold">
                      Total Units
                    </th>
                  </>
                ) : (
                  <th className="py-3.5 px-4 text-right">
                    Current Stock ({currentBranchData?.shortCode})
                  </th>
                )}
                <th className="py-3.5 px-3 text-center">Low Stock Threshold</th>
                <th className="py-3.5 px-3 text-center">Computed Status</th>
                <th className="py-3.5 px-3 text-center">Days Since Last Sale</th>
                <th className="py-3.5 px-3 text-center">Last Updated</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredItems.length === 0 ? (
                <tr>
                  <td
                    colSpan={isAllBranches ? 12 : 9}
                    className="py-12 text-center text-slate-400 font-medium"
                  >
                    No items match the active search or filter criteria.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const stockData = getItemStockData(item);
                  const isLow = stockData.status === 'low-stock';
                  const isOut = stockData.status === 'out-of-stock';

                  return (
                    <tr
                      key={item.id}
                      className={cn(
                        'hover:bg-slate-50/80 transition-colors',
                        isOut ? 'bg-rose-50/20' : isLow ? 'bg-amber-50/20' : ''
                      )}
                    >
                      {/* Item Details */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900">{item.itemName}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="font-mono text-[11px] font-bold px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 border border-slate-200">
                            {item.itemCode}
                          </span>
                          <span className="text-[11px] text-slate-400">HSN: {item.itemHSN}</span>
                          <span className="text-[11px] text-slate-400">• Unit: {item.unit}</span>
                        </div>
                      </td>

                      {/* Category */}
                      <td className="py-3.5 px-3">
                        <span className="text-slate-600 font-medium">{item.category}</span>
                      </td>

                      {/* Rack Location */}
                      <td className="py-3.5 px-3">
                        {isAllBranches ? (
                          <button
                            type="button"
                            onClick={() => setLocationModalItem({ item })}
                            title="Click to view/edit branch rack locations"
                            className="text-left group hover:bg-slate-100 p-1 rounded-lg transition-colors"
                          >
                            <div className="flex flex-col gap-0.5 text-[11px]">
                              {BRANCHES.map((b) => {
                                const loc = branchStocks.find((s) => s.itemId === item.id && s.branchId === b.id)?.location;
                                return (
                                  <div key={b.id} className="flex items-center gap-1">
                                    <span className="font-bold text-[11px] text-slate-400 w-6 uppercase">{b.shortCode}:</span>
                                    {loc ? (
                                      <span className="font-mono font-bold text-slate-700">{loc}</span>
                                    ) : (
                                      <span className="text-slate-300 italic">—</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </button>
                        ) : (
                          (() => {
                            const loc = branchStocks.find((s) => s.itemId === item.id && s.branchId === currentBranch)?.location;
                            return loc ? (
                              <button
                                type="button"
                                onClick={() => setLocationModalItem({ item, branchId: currentBranch !== 'all' ? currentBranch : undefined })}
                                title="Click to edit rack / row location"
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 hover:bg-blue-50 hover:text-blue-700 border border-slate-200 text-slate-700 font-mono text-[11px] font-semibold transition-colors group"
                              >
                                <MapPin className="h-3 w-3 text-slate-400 group-hover:text-blue-600 shrink-0" />
                                <span>{loc}</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setLocationModalItem({ item, branchId: currentBranch !== 'all' ? currentBranch : undefined })}
                                title="Click to assign rack / row location"
                                className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-blue-600 font-medium transition-colors"
                              >
                                <MapPin className="h-3 w-3 text-slate-300 shrink-0" />
                                <span className="italic">Unassigned</span>
                              </button>
                            );
                          })()
                        )}
                      </td>

                      {/* Stock Columns */}
                      {isAllBranches && stockData.branchCounts ? (
                        <>
                          {/* Erode HQ */}
                          <td className="py-3.5 px-3 text-center">
                            <span
                              className={cn(
                                'font-bold text-xs px-2 py-0.5 rounded',
                                stockData.branchCounts['erode-hq'] === 0
                                  ? 'bg-rose-100 text-rose-800'
                                  : stockData.branchCounts['erode-hq'] <= Math.ceil(stockData.threshold / 3)
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'text-slate-800'
                              )}
                            >
                              {stockData.branchCounts['erode-hq']}
                            </span>
                          </td>

                          {/* Coimbatore */}
                          <td className="py-3.5 px-3 text-center">
                            <span
                              className={cn(
                                'font-bold text-xs px-2 py-0.5 rounded',
                                stockData.branchCounts['coimbatore'] === 0
                                  ? 'bg-rose-100 text-rose-800'
                                  : stockData.branchCounts['coimbatore'] <= Math.ceil(stockData.threshold / 3)
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'text-slate-800'
                              )}
                            >
                              {stockData.branchCounts['coimbatore']}
                            </span>
                          </td>

                          {/* Chennai */}
                          <td className="py-3.5 px-3 text-center">
                            <span
                              className={cn(
                                'font-bold text-xs px-2 py-0.5 rounded',
                                stockData.branchCounts['chennai'] === 0
                                  ? 'bg-rose-100 text-rose-800'
                                  : stockData.branchCounts['chennai'] <= Math.ceil(stockData.threshold / 3)
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'text-slate-800'
                              )}
                            >
                              {stockData.branchCounts['chennai']}
                            </span>
                          </td>

                          {/* Total Units Across All Branches */}
                          <td className="py-3.5 px-3 text-center bg-blue-50/40">
                            <span className="font-extrabold text-sm text-blue-900">
                              {stockData.currentStock}{' '}
                              <span className="text-[11px] font-normal text-slate-500">
                                {item.unit}
                              </span>
                            </span>
                          </td>
                        </>
                      ) : (
                        <td className="py-3.5 px-4 text-right">
                          <span
                            className={cn(
                              'text-sm font-extrabold',
                              isOut ? 'text-rose-600' : isLow ? 'text-amber-700' : 'text-slate-900'
                            )}
                          >
                            {stockData.currentStock}{' '}
                            <span className="text-[11px] font-normal text-slate-500">{item.unit}</span>
                          </span>
                        </td>
                      )}

                      {/* Low Stock Threshold (Editable) */}
                      <td className="py-3.5 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => setThresholdItem(item)}
                          title="Click to edit alert threshold"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-100 border border-transparent hover:border-slate-200 transition-all text-xs font-semibold text-slate-700 group"
                        >
                          <span>{stockData.threshold} {item.unit}</span>
                          <Edit3 className="h-3 w-3 text-slate-400 group-hover:text-blue-600" />
                        </button>
                      </td>

                      {/* Computed Status */}
                      <td className="py-3.5 px-3 text-center">
                        {isOut ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                            <XCircle className="h-3 w-3" />
                            Out of Stock
                          </span>
                        ) : isLow ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                            <AlertTriangle className="h-3 w-3" />
                            Low Stock
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            <CheckCircle2 className="h-3 w-3" />
                            In Stock
                          </span>
                        )}
                        {isAllBranches && stockData.hasImbalance && !isOut && (
                          <span className="block text-[11px] font-bold text-purple-700 mt-0.5">
                            Branch Imbalance
                          </span>
                        )}
                      </td>

                      {/* Days Since Last Sale / Dead Stock Indicator */}
                      <td className="py-3.5 px-3 text-center">
                        {(() => {
                          const saleInfo = getItemLastSaleInfo(
                            item.id,
                            isAllBranches ? 'all' : currentBranch
                          );

                          if (!saleInfo.hasSales) {
                            return (
                              <div className="flex flex-col items-center gap-0.5">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                                  <AlertOctagon className="h-3 w-3 text-rose-600 shrink-0" />
                                  <span>Not Moving</span>
                                </span>
                                <span className="text-[11px] text-slate-400 italic">Never Sold</span>
                              </div>
                            );
                          }

                          if (saleInfo.isDeadStock) {
                            return (
                              <div className="flex flex-col items-center gap-0.5">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                                  <AlertOctagon className="h-3 w-3 text-rose-600 shrink-0" />
                                  <span>Not Moving</span>
                                </span>
                                <span className="text-[11px] font-bold text-rose-700 font-mono">
                                  {saleInfo.daysSinceLastSale}d ago
                                </span>
                                <span className="text-[11px] text-slate-400 font-mono">
                                  {formatDateShort(saleInfo.lastSaleDate)}
                                </span>
                              </div>
                            );
                          }

                          return (
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                                <span>Active ({saleInfo.daysSinceLastSale === 0 ? 'Today' : `${saleInfo.daysSinceLastSale}d`})</span>
                              </span>
                              <span className="text-[11px] text-slate-400 font-mono">
                                {formatDateShort(saleInfo.lastSaleDate)}
                              </span>
                            </div>
                          );
                        })()}
                      </td>

                      {/* Last Updated */}
                      <td className="py-3.5 px-3 text-center text-slate-500 text-[11px]">
                        {formatDate(stockData.latestUpdated)}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Adjust Stock Button (Gated if Billing) */}
                          {!isBillingUser && (
                            <button
                              type="button"
                              onClick={() => {
                                setAdjustItem({
                                  item,
                                  branchId: currentBranch !== 'all' ? currentBranch : 'erode-hq',
                                });
                              }}
                              title="Manual stock correction / audit adjustment"
                              className="px-2.5 py-1 rounded-lg text-xs font-bold text-blue-700 hover:bg-blue-50 border border-blue-200 transition-colors"
                            >
                              Adjust
                            </button>
                          )}

                          {/* Transfer Button */}
                          {!isBillingUser && (
                            <button
                              type="button"
                              onClick={() => {
                                setTransferState({
                                  item,
                                  from: currentBranch !== 'all' ? currentBranch : 'erode-hq',
                                });
                              }}
                              title="Transfer stock to another branch"
                              className="px-2.5 py-1 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-100 border border-slate-200 transition-colors"
                            >
                              Transfer
                            </button>
                          )}

                          {/* History Button */}
                          <button
                            type="button"
                            onClick={() => setHistoryItem(item)}
                            title="View audit trail for this item"
                            className="p-1 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
                          >
                            <History className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50/80 flex items-center justify-between text-xs text-slate-500">
          <span>
            Showing <strong className="text-slate-800 font-bold">{filteredItems.length}</strong> of{' '}
            <strong className="text-slate-800 font-bold">{items.length}</strong> catalog items
          </span>
          <span className="text-[11px] text-slate-400">
            {isAllBranches
              ? 'Multi-branch balance matrix active'
              : `Stock counts filtered for ${currentBranchData?.name}`}
          </span>
        </div>
      </div>
        </>
      )}

      {/* COMBOS INVENTORY TAB VIEW */}
      {activeInventoryTab === 'combos' && (
        <div className="space-y-4">
          {/* Read-only verification notice banner */}
          <div className="p-4 rounded-xl bg-purple-50/70 border border-purple-200 flex items-start gap-3 text-purple-900">
            <Info className="h-5 w-5 text-purple-600 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="font-bold text-purple-950">
                Read-Only Verification View: Live Computed Combo Availability
              </p>
              <p className="text-purple-700 leading-relaxed">
                Combos are dynamic, bundled product offerings with zero independent stock. Available quantities are computed in real-time from the available branch stock of their individual components. Click any combo row to expand and inspect its component breakdown and bottleneck constraints. To replenish or adjust stock, adjust the component items under the <strong>Regular Items</strong> tab.
              </p>
            </div>
          </div>

          {/* Combos KPI Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 sm:grid-cols-4 gap-3.5">
            <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Combos</span>
                <Layers className="h-4 w-4 text-purple-600" />
              </div>
              <p className="text-xl sm:text-2xl sm:text-3xl font-bold text-slate-900 mt-1">{comboMetrics.totalCombos}</p>
              <span className="text-[11px] text-slate-400 mt-0.5 block">Configured bundle templates</span>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">In Stock Combos</span>
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              </div>
              <p className="text-xl sm:text-2xl sm:text-3xl font-bold text-emerald-700 mt-1">{comboMetrics.inStock}</p>
              <span className="text-[11px] text-emerald-600 mt-0.5 block">Ready to assemble at this branch</span>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-rose-700 uppercase tracking-wider">Unavailable</span>
                <XCircle className="h-4 w-4 text-rose-600" />
              </div>
              <p className="text-xl sm:text-2xl sm:text-3xl font-bold text-rose-700 mt-1">{comboMetrics.outOfStock}</p>
              <span className="text-[11px] text-rose-600 mt-0.5 block">Component shortage at branch</span>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-purple-700 uppercase tracking-wider">Total Units Ready</span>
                <Package className="h-4 w-4 text-purple-600" />
              </div>
              <p className="text-xl sm:text-2xl sm:text-3xl font-bold text-purple-700 mt-1">{comboMetrics.totalAvailableKits}</p>
              <span className="text-[11px] text-purple-600 mt-0.5 block">Sum of assembleable kits</span>
            </div>
          </div>

          {/* Action / Search Bar for Combos */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
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
            <div className="text-xs text-slate-500 font-medium">
              Live branch: <strong className="text-slate-800">{isAllBranches ? 'All Branches' : currentBranchData?.name}</strong>
            </div>
          </div>

          {/* Combos Inventory Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-3 w-10 text-center"></th>
                    <th className="py-3 px-4 w-12 text-center">#</th>
                    <th className="py-3 px-4 min-w-[220px]">Combo Name & Code</th>
                    <th className="py-3 px-4">Components</th>
                    <th className="py-3 px-4 text-right">Pricing (₹)</th>
                    <th className="py-3 px-4 text-right">Available Qty ({isAllBranches ? 'All Branches' : currentBranchData?.name})</th>
                    <th className="py-3 px-4 text-center">Stock Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredCombos.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400">
                        <Layers className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                        <p className="font-semibold text-slate-700">No combos found</p>
                        <p className="text-[11px] mt-0.5">No combos matched your search.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredCombos.map((combo, idx) => {
                      const avail = getComboAvailability(combo, currentBranch);
                      const isExpanded = expandedComboId === combo.id;
                      const separatePrice = getComboBuyingSeparatelyPrice(combo);
                      const isOutOfStock = avail <= 0;

                      // Find limiting bottleneck component(s)
                      let bottleneckItemName = '';
                      let lowestSupported = Infinity;
                      combo.components.forEach((comp) => {
                        const compStock = isAllBranches
                          ? getTotalStockAcrossBranches(comp.itemId)
                          : getBranchStock(comp.itemId, currentBranch)?.quantity || 0;
                        const canMake = comp.quantity > 0 ? Math.floor(compStock / comp.quantity) : 0;
                        if (canMake < lowestSupported) {
                          lowestSupported = canMake;
                          const it = items.find((i) => i.id === comp.itemId);
                          bottleneckItemName = it?.itemName || 'Component';
                        }
                      });

                      return (
                        <React.Fragment key={combo.id}>
                          <tr
                            onClick={() => setExpandedComboId(isExpanded ? null : combo.id)}
                            className={cn(
                              'cursor-pointer transition-colors select-none',
                              isExpanded ? 'bg-purple-50/40' : 'hover:bg-slate-50/80'
                            )}
                          >
                            <td className="py-3 px-3 text-center text-slate-400">
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-purple-600 mx-auto" />
                              ) : (
                                <ChevronUp className="h-4 w-4 text-slate-400 rotate-90 mx-auto" />
                              )}
                            </td>
                            <td className="py-3 px-4 text-center font-mono font-bold text-slate-400">
                              {idx + 1}
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-3">
                                <ItemImage
                                  src={combo.imageUrl}
                                  alt={combo.comboName}
                                  isCombo={true}
                                  className="h-10 w-10 rounded-xl shrink-0"
                                  iconClassName="h-4 w-4"
                                />
                                <div>
                                  <div className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                                    <span>{combo.comboName}</span>
                                    <span className="px-1.5 py-0.2 rounded text-[11px] font-bold bg-purple-100 text-purple-700 border border-purple-200 uppercase">
                                      Combo
                                    </span>
                                  </div>
                                  <span className="font-mono text-[11px] text-purple-700 font-bold">
                                    {combo.comboCode}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <span className="text-xs font-medium text-slate-600">
                                {combo.components.length} components
                              </span>
                              {isOutOfStock && bottleneckItemName && (
                                <p className="text-[11px] text-rose-600 font-bold truncate max-w-xs mt-0.5">
                                  Shortage: {bottleneckItemName}
                                </p>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <span className="font-mono font-bold text-slate-900">
                                {formatCurrency(combo.comboPrice)}
                              </span>
                              {separatePrice > combo.comboPrice && (
                                <span className="block text-[11px] text-slate-400">
                                  vs {formatCurrency(separatePrice)} sep.
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-sm">
                              <span
                                className={cn(
                                  avail > 0 ? 'text-emerald-700' : 'text-rose-600'
                                )}
                              >
                                {avail}
                              </span>
                              <span className="text-[11px] font-normal text-slate-400 ml-1">kits</span>
                            </td>
                            <td className="py-3 px-4 text-center">
                              {avail > 0 ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                                  <span>In Stock ({avail})</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                  <XCircle className="h-3 w-3 text-rose-600" />
                                  <span>Unavailable (0)</span>
                                </span>
                              )}
                            </td>
                          </tr>

                          {/* Expanded Component Breakdown Accordion */}
                          {isExpanded && (
                            <tr className="bg-slate-50/60">
                              <td colSpan={7} className="p-4 pl-12 border-b border-purple-100">
                                <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
                                  <div className="px-4 py-3 bg-slate-50/90 border-b border-slate-200 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <Boxes className="h-4 w-4 text-purple-600" />
                                      <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                                        Component Stock Breakdown ({combo.comboName})
                                      </span>
                                    </div>
                                    <span className="text-[11px] text-slate-500 font-medium">
                                      Branch: <strong>{isAllBranches ? 'All Branches' : currentBranchData?.name}</strong>
                                    </span>
                                  </div>

                                  <div className="overflow-x-auto">
                                    <table className="w-full text-left text-xs border-collapse">
                                      <thead>
                                        <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-600 font-bold uppercase text-[11px] tracking-wider">
                                          <th className="py-2.5 px-3 w-8 text-center">#</th>
                                          <th className="py-2.5 px-3">Component Item</th>
                                          <th className="py-2.5 px-3">SKU / Code</th>
                                          <th className="py-2.5 px-3 text-right">Required / Unit</th>
                                          <th className="py-2.5 px-3 text-right">Current Branch Stock</th>
                                          <th className="py-2.5 px-3 text-right">Kits Supported</th>
                                          <th className="py-2.5 px-3 text-center">Component Status</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100">
                                        {combo.components.map((comp, cIdx) => {
                                          const item = items.find((i) => i.id === comp.itemId);
                                          const stock = isAllBranches
                                            ? getTotalStockAcrossBranches(comp.itemId)
                                            : getBranchStock(comp.itemId, currentBranch)?.quantity || 0;
                                          const kitsSupported = comp.quantity > 0 ? Math.floor(stock / comp.quantity) : 0;
                                          const isBottleneck = kitsSupported === lowestSupported;
                                          const isDepleted = stock < comp.quantity;

                                          return (
                                            <tr
                                              key={cIdx}
                                              className={cn(
                                                'transition-colors',
                                                isDepleted
                                                  ? 'bg-rose-50/40'
                                                  : isBottleneck
                                                  ? 'bg-amber-50/40'
                                                  : 'hover:bg-slate-50/50'
                                              )}
                                            >
                                              <td className="py-2.5 px-3 text-center text-slate-400 font-mono text-[11px]">
                                                {cIdx + 1}
                                              </td>
                                              <td className="py-2.5 px-3 font-semibold text-slate-900">
                                                <div className="flex items-center gap-2">
                                                  <ItemImage
                                                    src={item?.imageUrl}
                                                    alt={item?.itemName || 'Item'}
                                                    className="h-7 w-7 rounded-lg shrink-0"
                                                    iconClassName="h-3.5 w-3.5"
                                                  />
                                                  <div>
                                                    <div>{item?.itemName || comp.itemId}</div>
                                                    {item?.category && (
                                                      <span className="text-[11px] text-slate-400 font-normal">
                                                        {item.category}
                                                      </span>
                                                    )}
                                                  </div>
                                                </div>
                                              </td>
                                              <td className="py-2.5 px-3 font-mono text-slate-600 text-[11px]">
                                                {item?.itemCode || '-'}
                                              </td>
                                              <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-700">
                                                {comp.quantity} {item?.unit || 'PCS'}
                                              </td>
                                              <td className="py-2.5 px-3 text-right font-mono font-bold">
                                                <span
                                                  className={cn(
                                                    stock < comp.quantity ? 'text-rose-600' : 'text-slate-900'
                                                  )}
                                                >
                                                  {stock} {item?.unit || 'PCS'}
                                                </span>
                                              </td>
                                              <td className="py-2.5 px-3 text-right font-mono font-bold">
                                                <span
                                                  className={cn(
                                                    kitsSupported === 0
                                                      ? 'text-rose-600'
                                                      : isBottleneck
                                                      ? 'text-amber-700'
                                                      : 'text-emerald-700'
                                                  )}
                                                >
                                                  {kitsSupported}
                                                </span>
                                              </td>
                                              <td className="py-2.5 px-3 text-center">
                                                {isDepleted ? (
                                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-300">
                                                    <AlertTriangle className="h-3 w-3 text-rose-600" />
                                                    <span>Depleted (Shortage)</span>
                                                  </span>
                                                ) : isBottleneck ? (
                                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                                                    <AlertOctagon className="h-3 w-3 text-amber-600" />
                                                    <span>Limiting Bottleneck</span>
                                                  </span>
                                                ) : (
                                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                    <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                                                    <span>Sufficient Stock</span>
                                                  </span>
                                                )}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>

                                  <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
                                    <span>
                                      Max available combo kits ({avail}) is determined by the bottleneck component with the lowest supported count ({lowestSupported === Infinity ? 0 : lowestSupported}).
                                    </span>
                                    <span className="font-medium text-slate-400">
                                      Read-only verification · Adjust stock under Regular Items
                                    </span>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50/80 flex items-center justify-between text-xs text-slate-500">
              <span>
                Showing <strong className="text-slate-800 font-bold">{filteredCombos.length}</strong> of{' '}
                <strong className="text-slate-800 font-bold">{combos.length}</strong> combo offerings
              </span>
              <span className="text-[11px] text-purple-700 font-medium">
                Live availability derived from component inventory
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Wire up Modals */}
      {adjustItem && (
        <AdjustStockModal
          isOpen={Boolean(adjustItem)}
          onClose={() => setAdjustItem(null)}
          item={adjustItem.item}
          targetBranchId={adjustItem.branchId}
        />
      )}

      {transferState && (
        <TransferStockModal
          isOpen={Boolean(transferState)}
          onClose={() => setTransferState(null)}
          preselectedItem={transferState.item}
          defaultFromBranch={transferState.from}
          defaultToBranch={transferState.to}
        />
      )}

      {historyItem && (
        <StockHistoryModal
          isOpen={Boolean(historyItem)}
          onClose={() => setHistoryItem(null)}
          filterItem={historyItem}
        />
      )}

      {isAllHistoryOpen && (
        <StockHistoryModal
          isOpen={isAllHistoryOpen}
          onClose={() => setAllHistoryOpen(false)}
        />
      )}

      {thresholdItem && (
        <ThresholdEditModal
          isOpen={Boolean(thresholdItem)}
          onClose={() => setThresholdItem(null)}
          item={thresholdItem}
        />
      )}

      {locationModalItem && (
        <EditLocationModal
          isOpen={Boolean(locationModalItem)}
          onClose={() => setLocationModalItem(null)}
          item={locationModalItem.item}
          targetBranchId={locationModalItem.branchId}
        />
      )}

      {isTransferHistoryOpen && (
        <TransferHistoryModal
          isOpen={isTransferHistoryOpen}
          onClose={() => setIsTransferHistoryOpen(false)}
        />
      )}

      {isSettingsOpen && (
        <InventorySettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}
    </div>
  );
};
