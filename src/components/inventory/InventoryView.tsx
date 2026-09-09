import React, { useState, useMemo, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import { Item, BranchId, BRANCHES } from '../../types';
import {
  Layers,
  ArrowRightLeft,
  ShieldAlert,
  History,
  Search,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Building,
  Boxes,
  Edit3,
  MapPin,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { AdjustStockModal } from './AdjustStockModal';
import { TransferStockModal } from './TransferStockModal';
import { StockHistoryModal } from './StockHistoryModal';
import { ThresholdEditModal } from './ThresholdEditModal';
import { EditLocationModal } from './EditLocationModal';

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
  } = useErp();

  // Search and Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'in-stock' | 'low-stock' | 'out-of-stock'>('all');

  // Sync search filter from navigation (e.g. from Items module "Manage Stock")
  useEffect(() => {
    if (inventoryFilterQuery) {
      setSearchQuery(inventoryFilterQuery);
      setInventoryFilterQuery('');
    }
  }, [inventoryFilterQuery, setInventoryFilterQuery]);

  // Modals state
  const [adjustItem, setAdjustItem] = useState<{ item: Item; branchId?: BranchId } | null>(null);
  const [transferState, setTransferState] = useState<{ item?: Item; from?: BranchId; to?: BranchId } | null>(null);
  const [historyItem, setHistoryItem] = useState<Item | null>(null);
  const [isAllHistoryOpen, setAllHistoryOpen] = useState(false);
  const [thresholdItem, setThresholdItem] = useState<Item | null>(null);
  const [locationModalItem, setLocationModalItem] = useState<{ item: Item; branchId?: BranchId } | null>(null);

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

    items.forEach((item) => {
      const data = getItemStockData(item);
      totalUnits += data.currentStock;
      if (data.status === 'out-of-stock') {
        outOfStock++;
      } else if (data.status === 'low-stock') {
        lowStock++;
      } else {
        inStock++;
      }
    });

    return {
      totalSkus: items.length,
      inStock,
      lowStock,
      outOfStock,
      totalUnits,
    };
  }, [items, branchStocks, isAllBranches, currentBranch]);

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

      return true;
    });
  }, [items, searchQuery, selectedCategory, statusFilter, branchStocks, isAllBranches, currentBranch]);

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

  const isBillingUser = currentUser.role === 'Billing';

  return (
    <div className="p-6 space-y-6 w-full">
      {/* Top Banner */}
      <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="h-12 w-12 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700 shrink-0">
            <Layers className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                Inventory
              </h1>
              <span
                className={cn(
                  'text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border',
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
        </div>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-2.5 flex-wrap self-end md:self-auto">
          <button
            onClick={() => setAllHistoryOpen(true)}
            className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 transition-colors flex items-center gap-1.5"
          >
            <History className="h-4 w-4 text-slate-600" />
            <span>Audit Trail</span>
          </button>

          {!isBillingUser && (
            <>
              <button
                onClick={() => setTransferState({})}
                className="px-3.5 py-2 rounded-xl text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-colors flex items-center gap-1.5"
              >
                <ArrowRightLeft className="h-4 w-4 text-blue-600" />
                <span>Transfer Stock</span>
              </button>

              <button
                onClick={() => {
                  if (items.length > 0) {
                    setAdjustItem({
                      item: items[0],
                      branchId: currentBranch !== 'all' ? currentBranch : 'erode-hq',
                    });
                  }
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-xs hover:shadow transition-all flex items-center gap-1.5"
              >
                <ShieldAlert className="h-4 w-4" />
                <span>Adjust Stock</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* KPI Metric Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {/* Total Items */}
        <div
          onClick={() => setStatusFilter('all')}
          className={cn(
            'p-4 rounded-xl border bg-white shadow-2xs cursor-pointer transition-all hover:border-blue-400',
            statusFilter === 'all' ? 'ring-2 ring-blue-500/20 border-blue-500 bg-blue-50/20' : 'border-slate-200'
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Items</span>
            <Boxes className="h-4 w-4 text-slate-400" />
          </div>
          <p className="text-3xl font-black text-slate-900 mt-1">{metrics.totalSkus}</p>
          <span className="text-[10px] text-slate-400 mt-0.5 block">Cataloged items</span>
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
          <p className="text-3xl font-black text-emerald-700 mt-1">{metrics.inStock}</p>
          <span className="text-[10px] text-emerald-600 mt-0.5 block">&gt; Threshold stock</span>
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
          <p className="text-3xl font-black text-amber-700 mt-1">{metrics.lowStock}</p>
          <span className="text-[10px] text-amber-600 mt-0.5 block">&le; Threshold alert</span>
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
          <p className="text-3xl font-black text-rose-700 mt-1">{metrics.outOfStock}</p>
          <span className="text-[10px] text-rose-600 mt-0.5 block">0 units on hand</span>
        </div>

        {/* Total Physical Units */}
        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Units on Hand</span>
            <Building className="h-4 w-4 text-blue-600" />
          </div>
          <p className="text-3xl font-black text-blue-700 mt-1">
            {metrics.totalUnits.toLocaleString('en-IN')}
          </p>
          <span className="text-[10px] text-slate-500 mt-0.5 block">
            {isAllBranches ? 'Across all 3 branches' : 'This branch only'}
          </span>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs flex flex-col md:flex-row items-center justify-between gap-3">
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

        {/* Category & Status Filter Pills */}
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

          {/* Status Pills */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl gap-1 text-xs font-bold">
            <button
              onClick={() => setStatusFilter('all')}
              className={cn(
                'px-2.5 py-1 rounded-lg transition-all',
                statusFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              All
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
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
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
                <th className="py-3.5 px-3 text-center">Last Updated</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredItems.length === 0 ? (
                <tr>
                  <td
                    colSpan={isAllBranches ? 11 : 8}
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
                          <span className="font-mono text-[10px] font-bold px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 border border-slate-200">
                            {item.itemCode}
                          </span>
                          <span className="text-[10px] text-slate-400">HSN: {item.itemHSN}</span>
                          <span className="text-[10px] text-slate-400">• Unit: {item.unit}</span>
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
                            <div className="flex flex-col gap-0.5 text-[10px]">
                              {BRANCHES.map((b) => {
                                const loc = branchStocks.find((s) => s.itemId === item.id && s.branchId === b.id)?.location;
                                return (
                                  <div key={b.id} className="flex items-center gap-1">
                                    <span className="font-bold text-[9px] text-slate-400 w-6 uppercase">{b.shortCode}:</span>
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
                              <span className="text-[10px] font-normal text-slate-500">
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
                            <span className="text-[10px] font-normal text-slate-500">{item.unit}</span>
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
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                            <XCircle className="h-3 w-3" />
                            Out of Stock
                          </span>
                        ) : isLow ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                            <AlertTriangle className="h-3 w-3" />
                            Low Stock
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            <CheckCircle2 className="h-3 w-3" />
                            In Stock
                          </span>
                        )}
                        {isAllBranches && stockData.hasImbalance && !isOut && (
                          <span className="block text-[9px] font-bold text-purple-700 mt-0.5">
                            Branch Imbalance
                          </span>
                        )}
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
    </div>
  );
};
