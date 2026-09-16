import React, { useMemo, useState } from 'react';
import { useErp } from '../../context/ErpContext';
import { BranchScope, BranchId, BRANCHES } from '../../types';
import { exportToCsv } from '../../utils/csvExport';
import { exportToExcel, exportToPdf, ExportFormat } from '../../utils/exportHelpers';
import { ReportExportButtons } from './ReportExportButtons';
import {
  Boxes,

  Building,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Search,
} from 'lucide-react';
import { cn } from '../../lib/utils';

interface Props {
  branchScope: BranchScope;
}

export const StockValuationReportTab: React.FC<Props> = ({ branchScope }) => {
  const { items, branchStocks } = useErp();
  const [searchFilter, setSearchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'in-stock' | 'low-stock' | 'out-of-stock'>('all');

  // Compute Valuation Metrics
  const valuationData = useMemo(() => {
    const branchValuations: Record<
      BranchId,
      {
        totalUnits: number;
        purchaseValue: number;
        retailValue: number;
        lowStockCount: number;
        outOfStockCount: number;
        inStockCount: number;
      }
    > = {
      'erode-hq': { totalUnits: 0, purchaseValue: 0, retailValue: 0, lowStockCount: 0, outOfStockCount: 0, inStockCount: 0 },
      'coimbatore': { totalUnits: 0, purchaseValue: 0, retailValue: 0, lowStockCount: 0, outOfStockCount: 0, inStockCount: 0 },
      'chennai': { totalUnits: 0, purchaseValue: 0, retailValue: 0, lowStockCount: 0, outOfStockCount: 0, inStockCount: 0 },
    };

    items.forEach((item) => {
      const threshold = item.reorderThreshold ?? 10;
      const unitPurchase = item.purchasePrice || 0;
      const unitSale = item.salePrice || 0;

      BRANCHES.forEach((b) => {
        const stockRow = branchStocks.find((s) => s.itemId === item.id && s.branchId === b.id);
        const qty = stockRow?.quantity ?? 0;

        branchValuations[b.id].totalUnits += qty;
        branchValuations[b.id].purchaseValue += qty * unitPurchase;
        branchValuations[b.id].retailValue += qty * unitSale;

        if (qty === 0) {
          branchValuations[b.id].outOfStockCount++;
        } else if (qty <= threshold) {
          branchValuations[b.id].lowStockCount++;
        } else {
          branchValuations[b.id].inStockCount++;
        }
      });
    });

    // Item-level rows for the active branch scope
    const itemRows = items.map((item) => {
      const threshold = item.reorderThreshold ?? 10;
      let qty = 0;

      if (branchScope === 'all') {
        qty = branchStocks
          .filter((s) => s.itemId === item.id)
          .reduce((sum, s) => sum + s.quantity, 0);
      } else {
        const row = branchStocks.find((s) => s.itemId === item.id && s.branchId === branchScope);
        qty = row?.quantity ?? 0;
      }

      let status: 'in-stock' | 'low-stock' | 'out-of-stock';
      if (qty === 0) {
        status = 'out-of-stock';
      } else if (qty <= threshold) {
        status = 'low-stock';
      } else {
        status = 'in-stock';
      }

      const unitCost = item.purchasePrice || 0;
      const unitSale = item.salePrice || 0;
      const totalCost = qty * unitCost;
      const totalRetail = qty * unitSale;

      return {
        item,
        quantity: qty,
        threshold,
        status,
        unitCost,
        unitSale,
        totalCost,
        totalRetail,
        potentialProfit: totalRetail - totalCost,
      };
    });

    // Active scope totals
    const activePurchaseValue =
      branchScope === 'all'
        ? Object.values(branchValuations).reduce((sum, b) => sum + b.purchaseValue, 0)
        : branchValuations[branchScope].purchaseValue;

    const activeRetailValue =
      branchScope === 'all'
        ? Object.values(branchValuations).reduce((sum, b) => sum + b.retailValue, 0)
        : branchValuations[branchScope].retailValue;

    const activeUnits =
      branchScope === 'all'
        ? Object.values(branchValuations).reduce((sum, b) => sum + b.totalUnits, 0)
        : branchValuations[branchScope].totalUnits;

    const activeLowStock =
      branchScope === 'all'
        ? itemRows.filter((r) => r.status === 'low-stock').length
        : branchValuations[branchScope].lowStockCount;

    const activeOutOfStock =
      branchScope === 'all'
        ? itemRows.filter((r) => r.status === 'out-of-stock').length
        : branchValuations[branchScope].outOfStockCount;

    const activeInStock =
      branchScope === 'all'
        ? itemRows.filter((r) => r.status === 'in-stock').length
        : branchValuations[branchScope].inStockCount;

    return {
      branchValuations,
      itemRows,
      activeUnits,
      activePurchaseValue,
      activeRetailValue,
      activeMargin: activeRetailValue - activePurchaseValue,
      activeLowStock,
      activeOutOfStock,
      activeInStock,
    };
  }, [items, branchStocks, branchScope]);

  // Filtered rows for display
  const filteredRows = useMemo(() => {
    return valuationData.itemRows.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (searchFilter.trim()) {
        const q = searchFilter.toLowerCase();
        const matchName = r.item.itemName.toLowerCase().includes(q);
        const matchCode = r.item.itemCode.toLowerCase().includes(q);
        const matchCat = r.item.category.toLowerCase().includes(q);
        if (!matchName && !matchCode && !matchCat) return false;
      }
      return true;
    });
  }, [valuationData.itemRows, searchFilter, statusFilter]);

  const handleExport = (format: ExportFormat = 'csv') => {
    const branchLabel = branchScope === 'all' ? 'All_Branches' : branchScope;
    const filename = `Stock_Valuation_Report_${branchLabel}_${new Date().toISOString().split('T')[0]}.csv`;

    const headers = [
      'Item Name',
      'Item Code',
      'Category',
      'Unit',
      'Physical Quantity',
      'Reorder Threshold',
      'Stock Status',
      'Unit Purchase Price (₹)',
      'Unit Sale Price (₹)',
      'Total Cost Valuation (₹)',
      'Total Retail Valuation (₹)',
      'Potential Gross Margin (₹)',
    ];

    const rows = valuationData.itemRows.map((r) => [
      r.item.itemName,
      r.item.itemCode,
      r.item.category,
      r.item.unit,
      r.quantity,
      r.threshold,
      r.status,
      r.unitCost.toFixed(2),
      r.unitSale.toFixed(2),
      r.totalCost.toFixed(2),
      r.totalRetail.toFixed(2),
      r.potentialProfit.toFixed(2),
    ]);

    // Summary block
    rows.push([]);
    rows.push(['--- VALUATION SUMMARY ---']);
    rows.push(['Total Physical Units', valuationData.activeUnits]);
    rows.push(['Total Cost Valuation (₹)', valuationData.activePurchaseValue.toFixed(2)]);
    rows.push(['Total Retail Valuation (₹)', valuationData.activeRetailValue.toFixed(2)]);
    rows.push(['Potential Margin (₹)', valuationData.activeMargin.toFixed(2)]);
    rows.push(['Low Stock Items Count', valuationData.activeLowStock]);
    rows.push(['Out of Stock Items Count', valuationData.activeOutOfStock]);

    if (format === 'excel') exportToExcel(filename, headers, rows);

    else if (format === 'pdf') exportToPdf(filename, headers, rows, filename.replace(/[_-]+/g, ' ').replace(/\.csv$/i, '').trim());

    else exportToCsv(filename, headers, rows);
  };

  return (
    <div className="space-y-6">
      {/* Top Header with CSV Action */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
        <div>
          <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <Boxes className="h-5 w-5 text-blue-600" />
            <span>Stock Valuation & Asset Health</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Physical inventory asset schedule based on purchase costs and retail valuations
          </p>
        </div>

        <ReportExportButtons onExport={handleExport} />
      </div>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
            Total Purchase Cost
          </span>
          <p className="text-2xl font-extrabold text-blue-700 mt-1">
            ₹{valuationData.activePurchaseValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </p>
          <span className="text-[11px] text-slate-400 mt-0.5 block">
            Asset value at cost price
          </span>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
            Total Retail Value
          </span>
          <p className="text-2xl font-extrabold text-slate-900 mt-1">
            ₹{valuationData.activeRetailValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </p>
          <span className="text-[11px] text-slate-400 mt-0.5 block">
            Catalog sale value
          </span>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
            Potential Margin
          </span>
          <p className="text-2xl font-extrabold text-emerald-700 mt-1">
            ₹{valuationData.activeMargin.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </p>
          <span className="text-[11px] text-emerald-600 mt-0.5 block">
            {valuationData.activeRetailValue > 0
              ? `${((valuationData.activeMargin / valuationData.activeRetailValue) * 100).toFixed(1)}% gross margin`
              : '0% margin'}
          </span>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
            Stock Alerts
          </span>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm font-extrabold text-amber-700 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              {valuationData.activeLowStock} Low
            </span>
            <span className="text-slate-300">•</span>
            <span className="text-sm font-extrabold text-rose-700 flex items-center gap-1">
              <XCircle className="h-3.5 w-3.5" />
              {valuationData.activeOutOfStock} Out
            </span>
          </div>
          <span className="text-[11px] text-slate-400 mt-0.5 block">
            {valuationData.activeInStock} healthy items
          </span>
        </div>
      </div>

      {/* Branch-Wise Valuation Breakdown (When "All Branches") */}
      {branchScope === 'all' && (
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <Building className="h-4 w-4 text-blue-600" />
              <span>Branch Warehouse Valuation Breakdown</span>
            </h3>
            <span className="text-[11px] text-slate-400 font-medium">Physical asset allocation</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {BRANCHES.map((b) => {
              const val = valuationData.branchValuations[b.id];
              const share =
                valuationData.activePurchaseValue > 0
                  ? (val.purchaseValue / valuationData.activePurchaseValue) * 100
                  : 0;

              return (
                <div key={b.id} className="p-4 rounded-xl bg-slate-50/70 border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-slate-900">{b.name}</span>
                      <span className="text-[11px] text-slate-400 block">{b.location}</span>
                    </div>
                    <span className="text-xs font-extrabold text-blue-700">{share.toFixed(1)}%</span>
                  </div>

                  <div className="flex items-baseline justify-between pt-1">
                    <span className="text-lg font-extrabold text-slate-900">
                      ₹{val.purchaseValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </span>
                    <span className="text-[11px] font-bold text-slate-600">
                      {val.totalUnits.toLocaleString('en-IN')} units
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-200/60">
                    <span className="text-amber-700 font-semibold">{val.lowStockCount} Low</span>
                    <span className="text-rose-700 font-semibold">{val.outOfStockCount} Out</span>
                    <span className="text-emerald-700 font-semibold">{val.inStockCount} Healthy</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Item-level Valuation Schedule */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-50/50">
          <div className="relative w-full sm:w-72">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search item name, code, category..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="w-full pl-9 pr-3.5 py-1.5 rounded-xl bg-white border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-blue-600"
            />
          </div>

          <div className="flex items-center bg-slate-100 p-1 rounded-xl text-xs font-bold">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={cn(
                'px-2.5 py-1 rounded-lg transition-all',
                statusFilter === 'all' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              )}
            >
              All ({valuationData.itemRows.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('in-stock')}
              className={cn(
                'px-2.5 py-1 rounded-lg transition-all',
                statusFilter === 'in-stock' ? 'bg-emerald-600 text-white shadow-2xs' : 'text-emerald-700 hover:bg-emerald-50'
              )}
            >
              In Stock ({valuationData.activeInStock})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('low-stock')}
              className={cn(
                'px-2.5 py-1 rounded-lg transition-all',
                statusFilter === 'low-stock' ? 'bg-amber-500 text-slate-900 shadow-2xs' : 'text-amber-700 hover:bg-amber-50'
              )}
            >
              Low Stock ({valuationData.activeLowStock})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('out-of-stock')}
              className={cn(
                'px-2.5 py-1 rounded-lg transition-all',
                statusFilter === 'out-of-stock' ? 'bg-rose-600 text-white shadow-2xs' : 'text-rose-700 hover:bg-rose-50'
              )}
            >
              Out of Stock ({valuationData.activeOutOfStock})
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="py-3 px-4">Item Details</th>
                <th className="py-3 px-3">Category</th>
                <th className="py-3 px-3 text-right">Physical Stock</th>
                <th className="py-3 px-3 text-right">Unit Cost (₹)</th>
                <th className="py-3 px-3 text-right">Unit Sale (₹)</th>
                <th className="py-3 px-4 text-right">Total Cost Value (₹)</th>
                <th className="py-3 px-4 text-right">Total Retail Value (₹)</th>
                <th className="py-3 px-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    No items match the active search or filter criteria.
                  </td>
                </tr>
              ) : (
                filteredRows.map((r) => (
                  <tr key={r.item.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900">{r.item.itemName}</div>
                      <span className="font-mono text-[11px] text-slate-500">{r.item.itemCode}</span>
                    </td>
                    <td className="py-3 px-3 text-slate-600 font-medium">{r.item.category}</td>
                    <td className="py-3 px-3 text-right font-extrabold text-slate-900">
                      {r.quantity} <span className="text-[11px] font-normal text-slate-400">{r.item.unit}</span>
                    </td>
                    <td className="py-3 px-3 text-right text-slate-700 font-semibold">
                      ₹{r.unitCost.toLocaleString('en-IN')}
                    </td>
                    <td className="py-3 px-3 text-right text-slate-700 font-semibold">
                      ₹{r.unitSale.toLocaleString('en-IN')}
                    </td>
                    <td className="py-3 px-4 text-right font-extrabold text-blue-700">
                      ₹{r.totalCost.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="py-3 px-4 text-right font-extrabold text-slate-900">
                      ₹{r.totalRetail.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="py-3 px-3 text-center">
                      {r.status === 'out-of-stock' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                          <XCircle className="h-3 w-3" /> Out
                        </span>
                      ) : r.status === 'low-stock' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                          <AlertTriangle className="h-3 w-3" /> Low
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                          <CheckCircle2 className="h-3 w-3" /> Healthy
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
