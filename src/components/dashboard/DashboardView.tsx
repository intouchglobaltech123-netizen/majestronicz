import React, { useMemo } from 'react';
import { useErp } from '../../context/ErpContext';
import { BRANCHES, BranchId } from '../../types';
import { formatCurrency, cn } from '../../lib/utils';
import {
  TrendingUp,
  Boxes,
  AlertTriangle,
  ReceiptText,
  Building,
  ArrowRight,
  ShieldCheck,
  Building2,
  CheckCircle2,
  Layers,
  ChevronRight,
  Package,
  ClipboardList,
  Sparkles,
  AlertOctagon,
} from 'lucide-react';

export const DashboardView: React.FC = () => {
  const {
    items,
    branchStocks,
    currentBranch,
    isAllBranches,
    currentBranchData,
    switchBranch,
    setCurrentView,
    currentUser,
    invoices,
    enquiries,
    pendingOrders,
    navigateToNewItemRequestsQueue,
    getItemLastSaleInfo,
    inventorySettings,
    navigateToInventoryWithMovementFilter,
  } = useErp();

  // 1. Calculate KPI Metrics based on current scope (All Branches vs Individual Branch)
  const kpiData = useMemo(() => {
    let totalStockValue = 0;
    let lowStockCount = 0;
    let inStockSkuCount = 0;
    let deadStockCount = 0;
    const lowStockItems: { item: typeof items[0]; quantity: number; threshold: number; branchName?: string }[] = [];

    items.forEach((item) => {
      const threshold = item.reorderThreshold ?? 10;

      // Dead Stock calculation
      const saleInfo = getItemLastSaleInfo(item.id, isAllBranches ? 'all' : currentBranch);
      if (saleInfo.isDeadStock) {
        deadStockCount++;
      }

      if (isAllBranches) {
        // Aggregate across all branches
        const itemStocks = branchStocks.filter((s) => s.itemId === item.id);
        const totalQty = itemStocks.reduce((sum, s) => sum + s.quantity, 0);

        totalStockValue += totalQty * (item.purchasePrice || 0);

        if (totalQty > 0) {
          inStockSkuCount++;
        }

        if (totalQty <= threshold) {
          lowStockCount++;
          lowStockItems.push({ item, quantity: totalQty, threshold });
        }
      } else {
        // Scoped to specific single branch
        const stockRow = branchStocks.find(
          (s) => s.itemId === item.id && s.branchId === currentBranch
        );
        const branchQty = stockRow?.quantity ?? 0;

        totalStockValue += branchQty * (item.purchasePrice || 0);

        if (branchQty > 0) {
          inStockSkuCount++;
        }

        if (branchQty <= threshold) {
          lowStockCount++;
          lowStockItems.push({
            item,
            quantity: branchQty,
            threshold,
            branchName: currentBranchData?.name,
          });
        }
      }
    });

    return {
      totalStockValue,
      totalSkuCount: items.length,
      inStockSkuCount,
      lowStockCount,
      lowStockItems,
      deadStockCount,
    };
  }, [items, branchStocks, isAllBranches, currentBranch, currentBranchData, getItemLastSaleInfo, inventorySettings]);

  // Role visibility for management widgets: CEO & Manager only (hidden for Billing)
  const canViewNewItemRequests = currentUser.role === 'CEO' || currentUser.role === 'Manager';

  // Count of open (unresolved) Enquiries where isNewItemRequest = true, scoped to selected branch or All Branches
  const openNewItemRequests = useMemo(() => {
    return enquiries.filter((e) => {
      if (!e.isNewItemRequest || e.itemId || e.status === 'Cancelled') return false;
      if (!isAllBranches && e.branchId !== currentBranch) return false;
      return true;
    });
  }, [enquiries, isAllBranches, currentBranch]);

  const openNewItemRequestsCount = openNewItemRequests.length;

  // 2. Calculate Branch Breakdown data (Used when isAllBranches is true)
  const branchBreakdowns = useMemo(() => {
    return BRANCHES.map((b) => {
      let branchValue = 0;
      let skuWithStock = 0;
      let branchLowStockCount = 0;

      items.forEach((item) => {
        const threshold = item.reorderThreshold ?? 10;
        const stockRow = branchStocks.find(
          (s) => s.itemId === item.id && s.branchId === b.id
        );
        const qty = stockRow?.quantity ?? 0;

        branchValue += qty * (item.purchasePrice || 0);
        if (qty > 0) skuWithStock++;
        if (qty <= threshold) branchLowStockCount++;
      });

      return {
        branch: b,
        stockValue: branchValue,
        skuCount: items.length,
        activeStockSkus: skuWithStock,
        lowStockCount: branchLowStockCount,
      };
    });
  }, [items, branchStocks]);

  return (
    <div className="p-6 space-y-6 w-full">
      {/* Header Banner */}
      <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="h-12 w-12 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700 shrink-0">
            {isAllBranches ? (
              <Layers className="h-6 w-6" />
            ) : (
              <Building className="h-6 w-6" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                {isAllBranches ? 'Executive Dashboard — All Branches' : `Branch Dashboard — ${currentBranchData?.name}`}
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
                ? 'Aggregating physical inventory valuation across Erode HQ, Coimbatore, and Chennai.'
                : `Showing stock valuation and item health strictly for ${currentBranchData?.location}.`}
            </p>
          </div>
        </div>

        {/* Scope Mode Pill or Drill-out button */}
        <div className="flex items-center gap-2">
          {!isAllBranches && currentUser.role === 'CEO' && (
            <button
              onClick={() => switchBranch('all')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold border border-slate-200 transition-colors"
            >
              <span>← Return to All Branches</span>
            </button>
          )}

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-600">
            {currentUser.role === 'CEO' ? (
              <ShieldCheck className="h-4 w-4 text-amber-600" />
            ) : (
              <Building2 className="h-4 w-4 text-blue-600" />
            )}
            <span>Logged in as: <strong>{currentUser.name}</strong></span>
          </div>
        </div>
      </div>

      {/* TOP ROW: KPI CARDS (Values update dynamically based on branch selection) */}
      <div className={cn(
        'grid grid-cols-1 sm:grid-cols-2 gap-4',
        canViewNewItemRequests ? 'lg:grid-cols-3 xl:grid-cols-6' : 'lg:grid-cols-3 xl:grid-cols-5'
      )}>
        {/* KPI 1: Total Stock Value */}
        <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between relative overflow-hidden group hover:border-blue-300 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">
              {isAllBranches ? 'Total Stock Value' : `Stock Value (${currentBranchData?.name})`}
            </span>
            <div className="h-9 w-9 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-3xl lg:text-4xl font-black text-slate-900 tracking-tight font-mono">
              {formatCurrency(kpiData.totalStockValue)}
            </div>
            <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
              <span>Based on inward purchase cost</span>
            </p>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>Branch Scope:</span>
            <span className="font-semibold text-slate-800">
              {isAllBranches ? 'All 3 Branches' : currentBranchData?.name}
            </span>
          </div>
        </div>

        {/* KPI 2: Total Items Count */}
        <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between relative overflow-hidden group hover:border-blue-300 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Total Items</span>
            <div className="h-9 w-9 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-700">
              <Boxes className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-3xl lg:text-4xl font-black text-slate-900 tracking-tight font-mono">
              {kpiData.totalSkuCount} Items
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              {kpiData.inStockSkuCount} Items with active available stock
            </p>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>Items in Stock:</span>
            <span className="font-bold text-slate-800 font-mono">
              {kpiData.inStockSkuCount} / {kpiData.totalSkuCount}
            </span>
          </div>
        </div>

        {/* KPI 3: Low Stock Alerts */}
        <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between relative overflow-hidden group hover:border-amber-300 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Low Stock Alerts</span>
            <div
              className={cn(
                'h-9 w-9 rounded-xl border flex items-center justify-center',
                kpiData.lowStockCount > 0
                  ? 'bg-amber-50 border-amber-200 text-amber-700'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-700'
              )}
            >
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <div
              className={cn(
                'text-3xl lg:text-4xl font-black tracking-tight font-mono',
                kpiData.lowStockCount > 0 ? 'text-amber-700' : 'text-slate-900'
              )}
            >
              {kpiData.lowStockCount} {kpiData.lowStockCount === 1 ? 'Item' : 'Items'}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Units at or below reorder threshold
            </p>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>Reorder Trigger:</span>
            <span className="font-semibold text-slate-800">
              {isAllBranches ? 'Combined ≤ Threshold' : 'Branch ≤ Threshold'}
            </span>
          </div>
        </div>

        {/* KPI 4: Dead Stock Items Alert Widget (Alongside Low Stock Alerts) */}
        <div
          onClick={() => navigateToInventoryWithMovementFilter('not-moving')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              navigateToInventoryWithMovementFilter('not-moving');
            }
          }}
          className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between relative overflow-hidden group hover:border-rose-300 hover:shadow-md cursor-pointer transition-all"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Dead Stock Items</span>
            <div
              className={cn(
                'h-9 w-9 rounded-xl border flex items-center justify-center transition-colors',
                kpiData.deadStockCount > 0
                  ? 'bg-rose-50 border-rose-200 text-rose-700 group-hover:bg-rose-100'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-700'
              )}
            >
              {kpiData.deadStockCount > 0 ? (
                <AlertOctagon className="h-4 w-4" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
            </div>
          </div>

          <div className="mt-3">
            <div
              className={cn(
                'text-3xl lg:text-4xl font-black tracking-tight font-mono',
                kpiData.deadStockCount > 0 ? 'text-rose-700' : 'text-slate-900'
              )}
            >
              {kpiData.deadStockCount} {kpiData.deadStockCount === 1 ? 'Item' : 'Items'}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              No sale in {inventorySettings.deadStockThresholdDays}+ days or never sold
            </p>
          </div>

          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>Filter Inventory:</span>
            <span className="font-semibold text-rose-700 flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
              <span>View Not Moving</span>
              <ArrowRight className="h-3 w-3" />
            </span>
          </div>
        </div>

        {/* KPI 4: New Item Requests Alert Widget (Visible to CEO & Manager, placed alongside Low Stock Alerts) */}
        {canViewNewItemRequests && (
          <div
            onClick={navigateToNewItemRequestsQueue}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                navigateToNewItemRequestsQueue();
              }
            }}
            className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between relative overflow-hidden group hover:border-purple-300 hover:shadow-md cursor-pointer transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">New Item Requests</span>
              <div
                className={cn(
                  'h-9 w-9 rounded-xl border flex items-center justify-center transition-colors',
                  openNewItemRequestsCount > 0
                    ? 'bg-purple-50 border-purple-200 text-purple-700 group-hover:bg-purple-100'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                )}
              >
                {openNewItemRequestsCount > 0 ? (
                  <Sparkles className="h-4 w-4" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
              </div>
            </div>

            <div className="mt-3">
              {openNewItemRequestsCount > 0 ? (
                <>
                  <div className="text-3xl lg:text-4xl font-black text-purple-700 tracking-tight font-mono">
                    {openNewItemRequestsCount} {openNewItemRequestsCount === 1 ? 'Request' : 'Requests'}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Awaiting catalog review
                  </p>
                </>
              ) : (
                <>
                  <div className="text-2xl lg:text-3xl font-black text-slate-900 tracking-tight font-mono">
                    All caught up
                  </div>
                  <p className="text-[11px] text-emerald-600 font-medium mt-1">
                    No pending new item requests
                  </p>
                </>
              )}
            </div>

            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <span>View Queue:</span>
              <span className="font-semibold text-purple-700 flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                <span>{isAllBranches ? 'All Branches' : currentBranchData?.name}</span>
                <ArrowRight className="h-3 w-3" />
              </span>
            </div>
          </div>
        )}

        {/* KPI 4: Billed Sales Invoices */}
        <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Billed Sales</span>
            <div className="h-9 w-9 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
              <ReceiptText className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-3xl lg:text-4xl font-black text-slate-900 tracking-tight font-mono">
              {formatCurrency(
                invoices
                  .filter((i) => (isAllBranches || i.branchId === currentBranch) && !i.isVoided)
                  .reduce((sum, i) => sum + Math.max(0, i.grandTotal - (i.totalReturnedAmount || 0)), 0)
              )}
            </div>
            <p className="text-[11px] font-medium text-emerald-700 mt-1">
              {invoices.filter((i) => (isAllBranches || i.branchId === currentBranch) && !i.isVoided).length} Sales Recorded
            </p>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>Sales:</span>
            <button
              onClick={() => setCurrentView('invoices')}
              className="font-bold text-blue-600 hover:text-blue-800 flex items-center gap-0.5"
            >
              <span>View Sales</span>
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Enquiry Conversion & Pending Orders Tie-In Widget */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-blue-50/80 via-white to-slate-50 border border-blue-200/70 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="h-10 w-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shrink-0 shadow-xs">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900">Enquiries & Pending Orders</h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                Live Status
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {enquiries.filter((e) => e.status === 'Follow-up').length} active customer enquiries •{' '}
              {pendingOrders.filter((p) => p.status === 'Waiting').length} waiting pending orders •{' '}
              {pendingOrders.filter((p) => p.status === 'Stock Arrived').length > 0 ? (
                <strong className="text-emerald-700">
                  {pendingOrders.filter((p) => p.status === 'Stock Arrived').length} Stock Arrived (Action needed)
                </strong>
              ) : (
                '0 pending orders ready'
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setCurrentView('enquiries')}
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs flex items-center gap-1.5"
          >
            <span>Enquiries</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setCurrentView('pending-orders')}
            className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition-colors shadow-xs flex items-center gap-1.5"
          >
            <span>Pending Orders</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* BRANCH BREAKDOWN TABLE (Visible ONLY in "All Branches" mode) */}
      {isAllBranches ? (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
          <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/60">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">Branch Stock Breakdown</h2>
              <p className="text-xs text-slate-500">
                Combined overview across all warehouses. Click any branch row to view single-branch mode.
              </p>
            </div>
            <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200 flex items-center gap-1">
              <span>View Branch</span>
              <ArrowRight className="h-3 w-3" />
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                  <th className="py-3.5 px-5">Branch Location</th>
                  <th className="py-3.5 px-5">Physical Stock Value</th>
                  <th className="py-3.5 px-5">Items in Stock</th>
                  <th className="py-3.5 px-5">Low Stock Count</th>
                  <th className="py-3.5 px-5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {branchBreakdowns.map(({ branch, stockValue, activeStockSkus, lowStockCount }) => (
                  <tr
                    key={branch.id}
                    onClick={() => switchBranch(branch.id as BranchId)}
                    className="hover:bg-blue-50/50 cursor-pointer transition-colors group"
                  >
                    {/* Branch Info */}
                    <td className="py-4 px-5">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-xl bg-slate-100 group-hover:bg-blue-100 group-hover:text-blue-700 border border-slate-200 flex items-center justify-center text-slate-700 transition-colors">
                          <Building className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="font-bold text-slate-900 group-hover:text-blue-700 flex items-center gap-2">
                            <span>{branch.name}</span>
                            {branch.isHq && (
                              <span className="text-[9px] uppercase font-bold px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 border border-slate-200">
                                HQ
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5">{branch.location}</p>
                        </div>
                      </div>
                    </td>

                    {/* Stock Value */}
                    <td className="py-4 px-5">
                      <span className="font-extrabold text-sm text-slate-900 font-mono">
                        {formatCurrency(stockValue)}
                      </span>
                    </td>

                    {/* Item Count */}
                    <td className="py-4 px-5">
                      <div className="font-semibold text-slate-800">
                        {activeStockSkus} of {items.length} Items in stock
                      </div>
                      <span className="text-[10px] text-slate-500">
                        {Math.round((activeStockSkus / items.length) * 100)}% catalog coverage
                      </span>
                    </td>

                    {/* Low Stock Count */}
                    <td className="py-4 px-5">
                      {lowStockCount > 0 ? (
                        <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 inline-flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> {lowStockCount} below threshold
                        </span>
                      ) : (
                        <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 inline-flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Healthy Stock
                        </span>
                      )}
                    </td>

                    {/* Action */}
                    <td className="py-4 px-5 text-right">
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 group-hover:text-blue-700 transition-colors">
                        <span>View Branch</span>
                        <ChevronRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* SINGLE BRANCH DETAILS VIEW (When individual branch is selected) */
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">
                {currentBranchData?.name} — Branch Summary
              </h2>
              <p className="text-xs text-slate-500">
                Viewing physical stock and reorder requirements for this facility.
              </p>
            </div>
            <button
              onClick={() => setCurrentView('items')}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors shadow-xs"
            >
              <span>Manage Items in {currentBranchData?.name}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-xs font-medium text-slate-500">Branch Address</span>
              <p className="text-xs font-bold text-slate-900 mt-1">{currentBranchData?.location}</p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-xs font-medium text-slate-500">Facility Type</span>
              <p className="text-xs font-bold text-slate-900 mt-1">{currentBranchData?.tagline}</p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-xs font-medium text-slate-500">Branch Access</span>
              <p className="text-xs font-bold text-slate-900 mt-1">
                {currentUser.role === 'CEO'
                  ? 'CEO (All Branches)'
                  : currentUser.assignedBranchId === currentBranch
                  ? 'Branch Manager'
                  : 'Read Only'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Low Stock Items Detailed List */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                Low Stock Alerts ({isAllBranches ? 'All Branches' : currentBranchData?.name})
              </h3>
              <p className="text-xs text-slate-500">
                Items requiring procurement or internal branch stock transfer.
              </p>
            </div>
          </div>
          <button
            onClick={() => setCurrentView('items')}
            className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1"
          >
            <span>Open Items</span>
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>

        {kpiData.lowStockItems.length === 0 ? (
          <div className="py-8 text-center text-slate-500">
            <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-500 mb-1" />
            <p className="font-semibold text-xs text-slate-700">All stock levels healthy!</p>
            <p className="text-[11px] text-slate-400">
              No items are below their specified reorder threshold.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {kpiData.lowStockItems.slice(0, 6).map(({ item, quantity, threshold }) => (
              <div
                key={item.id}
                className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-start justify-between gap-3 hover:border-slate-300 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] text-slate-500 bg-white px-1.5 py-0.2 rounded border border-slate-200">
                      {item.itemCode}
                    </span>
                    <span className="text-[10px] text-slate-500">{item.category}</span>
                  </div>
                  <h4 className="text-xs font-bold text-slate-900 mt-1 truncate">
                    {item.itemName}
                  </h4>
                  <div className="flex items-center gap-3 mt-2 text-[11px]">
                    <span className="text-slate-500">
                      Stock: <strong className="text-amber-700 font-bold">{quantity} {item.unit}</strong>
                    </span>
                    <span className="text-slate-400">
                      Threshold: {threshold} {item.unit}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => setCurrentView('items')}
                  title="View in Items catalog"
                  className="p-1.5 rounded-lg bg-white hover:bg-slate-200 text-slate-600 border border-slate-200 transition-colors"
                >
                  <Package className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
