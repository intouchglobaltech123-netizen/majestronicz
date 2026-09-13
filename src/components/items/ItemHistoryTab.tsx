import React, { useState, useMemo } from 'react';
import { useErp } from '../../context/ErpContext';
import { Item, PurchaseOrder, Invoice, StockAdjustmentLog, BRANCHES, BranchId } from '../../types';
import { formatCurrency, cn } from '../../lib/utils';
import {
  ShoppingBag,
  Receipt,
  History,
  Calendar,
  Search,
  ExternalLink,
  Building,
  User,
  Users,
  ArrowRight,
  ShieldAlert,
  MapPin,
  X,
} from 'lucide-react';
import { PurchaseOrderPdfModal } from '../purchases/PurchaseOrderPdfModal';
import { InvoicePdfModal } from '../invoices/InvoicePdfModal';
import { ItemImage } from '../common/ItemImage';

interface ItemHistoryTabProps {
  item: Item;
  onCloseParentModal?: () => void;
}

type HistorySubTab = 'purchases' | 'sales' | 'adjustments';
type DatePreset = 'all' | 'month' | '30days' | '90days' | 'custom';

export const ItemHistoryTab: React.FC<ItemHistoryTabProps> = ({
  item,
  onCloseParentModal,
}) => {
  const {
    purchaseOrders,
    invoices,
    stockAdjustmentLogs,
    getBranchStock,
    setCurrentView,
    currentUser,
  } = useErp();

  const isSales = currentUser.role === 'Sales';

  // Subtab navigation
  const [subTab, setSubTab] = useState<HistorySubTab>(() => (isSales ? 'sales' : 'purchases'));

  // Date filters
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals for source record links
  const [selectedPo, setSelectedPo] = useState<PurchaseOrder | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [selectedAdjustment, setSelectedAdjustment] = useState<StockAdjustmentLog | null>(null);

  // 1. Raw historical datasets for this item
  const allItemPos = useMemo(() => {
    return purchaseOrders.flatMap((po) => {
      const line = po.items.find((it) => it.itemId === item.id);
      if (!line) return [];
      return [
        {
          po,
          line,
          date: po.date,
          poNumber: po.poNumber,
          vendorName: po.vendorName,
          qtyOrdered: line.quantityOrdered,
          qtyReceived: line.receivedQuantity || 0,
          purchasePrice: line.purchasePrice,
          totalAmount: line.amount,
          branchId: po.branchId,
          status: po.status,
        },
      ];
    });
  }, [purchaseOrders, item.id]);

  const allItemSales = useMemo(() => {
    return invoices.flatMap((inv) => {
      const line = inv.items.find((it) => it.itemId === item.id);
      if (!line) return [];
      return [
        {
          invoice: inv,
          line,
          date: inv.date,
          time: inv.time,
          invoiceNumber: inv.invoiceNumber,
          customerName: inv.customerName,
          customerPhone: inv.customerPhone,
          quantitySold: line.quantity,
          priceBilled: line.unitPrice,
          isPriceOverridden: Math.abs(line.unitPrice - item.salePrice) > 0.01,
          totalAmount: line.totalAmount,
          branchId: inv.branchId,
          transactionType: inv.transactionType,
          isVoided: Boolean(inv.isVoided),
        },
      ];
    });
  }, [invoices, item.id, item.salePrice]);

  const allItemAdjustments = useMemo(() => {
    return stockAdjustmentLogs
      .filter((log) => log.itemId === item.id)
      .map((log) => ({
        log,
        timestamp: log.timestamp,
        date: log.timestamp.split('T')[0],
        branchId: log.branchId,
        delta: log.quantityChange,
        previousQuantity: log.previousQuantity,
        newQuantity: log.newQuantity,
        reason: log.reason,
        adjustedBy: log.adjustedBy,
        notes: log.notes,
        linkedChallanNumber: log.linkedChallanNumber,
        transferRef: log.transferRef,
      }));
  }, [stockAdjustmentLogs, item.id]);

  // 2. Summary stats (lifetime)
  const summaryStats = useMemo(() => {
    // Total Purchased (lifetime units received across non-cancelled orders)
    const totalPurchased = allItemPos
      .filter((p) => p.status !== 'Cancelled')
      .reduce((sum, p) => sum + (p.qtyReceived || p.qtyOrdered), 0);

    // Total Sold (lifetime units sold across non-voided invoices)
    const totalSold = allItemSales
      .filter((s) => !s.isVoided)
      .reduce((sum, s) => sum + s.quantitySold, 0);

    // Most Frequent Vendor
    const vendorCounts: Record<string, number> = {};
    allItemPos.forEach((p) => {
      if (p.vendorName) {
        vendorCounts[p.vendorName] = (vendorCounts[p.vendorName] || 0) + 1;
      }
    });
    let topVendor = 'None yet';
    let topVendorCount = 0;
    Object.entries(vendorCounts).forEach(([vName, count]) => {
      if (count > topVendorCount) {
        topVendorCount = count;
        topVendor = `${vName} (${count} PO${count > 1 ? 's' : ''})`;
      }
    });

    // Most Frequent Customer
    const customerCounts: Record<string, number> = {};
    allItemSales.forEach((s) => {
      if (s.customerName && s.customerName.trim() && s.customerName.toLowerCase() !== 'walk-in customer') {
        customerCounts[s.customerName] = (customerCounts[s.customerName] || 0) + 1;
      }
    });
    let topCustomer = 'None yet';
    let topCustomerCount = 0;
    Object.entries(customerCounts).forEach(([cName, count]) => {
      if (count > topCustomerCount) {
        topCustomerCount = count;
        topCustomer = `${cName} (${count} bill${count > 1 ? 's' : ''})`;
      }
    });

    // Current Combined Stock (all branches)
    const combinedStock = BRANCHES.reduce(
      (sum, b) => sum + (getBranchStock(item.id, b.id)?.quantity ?? 0),
      0
    );
    const threshold = item.reorderThreshold ?? 10;
    let stockStatus: 'in-stock' | 'low-stock' | 'out-of-stock';
    if (combinedStock === 0) {
      stockStatus = 'out-of-stock';
    } else if (combinedStock <= threshold) {
      stockStatus = 'low-stock';
    } else {
      stockStatus = 'in-stock';
    }

    return {
      totalPurchased,
      totalSold,
      topVendor,
      topCustomer,
      combinedStock,
      threshold,
      stockStatus,
    };
  }, [allItemPos, allItemSales, getBranchStock, item.id, item.reorderThreshold]);

  // 3. Date filtering helper
  const isWithinDateRange = (dateStr: string) => {
    if (datePreset === 'all') return true;
    if (!dateStr) return false;

    const rowDate = new Date(dateStr).getTime();
    const now = new Date();

    if (datePreset === 'month') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      return rowDate >= startOfMonth;
    }
    if (datePreset === '30days') {
      const past30 = now.getTime() - 30 * 24 * 3600 * 1000;
      return rowDate >= past30;
    }
    if (datePreset === '90days') {
      const past90 = now.getTime() - 90 * 24 * 3600 * 1000;
      return rowDate >= past90;
    }
    if (datePreset === 'custom') {
      if (customStartDate) {
        const start = new Date(customStartDate).getTime();
        if (rowDate < start) return false;
      }
      if (customEndDate) {
        // End of the day
        const end = new Date(customEndDate).getTime() + 24 * 3600 * 1000;
        if (rowDate > end) return false;
      }
      return true;
    }
    return true;
  };

  // 4. Filtered & Sorted Subsets (Newest-first)
  const filteredPos = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return allItemPos
      .filter((p) => {
        if (!isWithinDateRange(p.date)) return false;
        if (q) {
          return (
            p.poNumber.toLowerCase().includes(q) ||
            p.vendorName.toLowerCase().includes(q) ||
            p.status.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [allItemPos, datePreset, customStartDate, customEndDate, searchQuery]);

  const filteredSales = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return allItemSales
      .filter((s) => {
        if (!isWithinDateRange(s.date)) return false;
        if (q) {
          return (
            s.invoiceNumber.toLowerCase().includes(q) ||
            s.customerName.toLowerCase().includes(q) ||
            (s.customerPhone && s.customerPhone.includes(q))
          );
        }
        return true;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [allItemSales, datePreset, customStartDate, customEndDate, searchQuery]);

  const filteredAdjustments = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return allItemAdjustments
      .filter((a) => {
        if (!isWithinDateRange(a.date)) return false;
        if (q) {
          return (
            a.reason.toLowerCase().includes(q) ||
            a.adjustedBy.toLowerCase().includes(q) ||
            (a.notes && a.notes.toLowerCase().includes(q)) ||
            (a.linkedChallanNumber && a.linkedChallanNumber.toLowerCase().includes(q))
          );
        }
        return true;
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [allItemAdjustments, datePreset, customStartDate, customEndDate, searchQuery]);

  const getBranchBadge = (bId: BranchId) => {
    const b = BRANCHES.find((x) => x.id === bId);
    return (
      <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
        {b?.shortCode || bId}
      </span>
    );
  };

  const formatDate = (iso: string) => {
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

  const handleJumpToPurchases = (_po?: PurchaseOrder) => {
    if (onCloseParentModal) onCloseParentModal();
    setCurrentView('purchases');
  };

  const handleJumpToInvoices = (_inv?: Invoice) => {
    if (onCloseParentModal) onCloseParentModal();
    setCurrentView('invoices');
  };

  return (
    <div className="space-y-5">
      {/* PRODUCT OVERVIEW & LARGE IMAGE PREVIEW */}
      <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <ItemImage
            src={item.imageUrl}
            alt={item.itemName}
            className="h-16 w-16 sm:h-20 sm:w-20 rounded-2xl shadow-xs border border-slate-200 bg-white"
            iconClassName="h-8 w-8 text-slate-400"
            fallbackIcon="boxes"
          />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200">
                {item.itemCode}
              </span>
              <span className="text-xs font-semibold text-slate-500">
                {item.category}{item.subcategory ? ` / ${item.subcategory}` : ''}
              </span>
              <span className="text-[10px] text-slate-400">• HSN: {item.itemHSN}</span>
            </div>
            <h3 className="text-base font-black text-slate-900 mt-1">
              {item.itemName}
            </h3>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-sm font-black text-blue-700">
                {formatCurrency(item.salePrice)}
              </span>
              <span className="text-[10px] text-slate-500 font-medium">
                ({item.salePriceTaxMode === 'with' ? 'Incl. GST' : 'Excl. GST'} @ {item.gstTaxSlab}%)
              </span>
            </div>
            {item.description && (
              <p className="text-xs text-slate-600 mt-2 bg-white/80 p-2.5 rounded-xl border border-slate-200/80 leading-relaxed max-w-2xl whitespace-pre-line">
                <span className="font-semibold text-slate-700">Description: </span>
                {item.description}
              </p>
            )}
          </div>
        </div>

        {item.imageUrl && (
          <a
            href={item.imageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs hover:bg-slate-50 transition-colors shrink-0"
          >
            <span>View Full Image</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {/* BRANCH PHYSICAL SHELF LOCATIONS & STOCK CARD */}
      <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-blue-600" />
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
              Branch Stock & Shelf Locations (Rack / Row)
            </h4>
          </div>
          <span className="text-[11px] text-slate-500 font-medium">
            Physical warehouse placement per branch
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {BRANCHES.map((b) => {
            const bStock = getBranchStock(item.id, b.id);
            const qty = bStock?.quantity ?? 0;
            const loc = bStock?.location?.trim();

            return (
              <div
                key={b.id}
                className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 hover:bg-slate-50 transition-colors flex flex-col justify-between"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Building className="h-3.5 w-3.5 text-slate-400" />
                    {b.name}
                  </span>
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-white text-slate-600 border border-slate-200">
                    {b.shortCode}
                  </span>
                </div>

                <div className="mt-2.5 pt-2.5 border-t border-slate-200/80 flex items-center justify-between gap-2">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                      Physical Location
                    </span>
                    {loc ? (
                      <span className="inline-flex items-center gap-1 mt-0.5 px-2 py-0.5 rounded-md text-xs font-mono font-bold bg-amber-50 text-amber-900 border border-amber-200">
                        <MapPin className="h-3 w-3 text-amber-600 shrink-0" />
                        {loc}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400 italic mt-0.5 block">
                        No rack assigned
                      </span>
                    )}
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                      Stock
                    </span>
                    <span className="text-sm font-black font-mono text-slate-900">
                      {qty}{' '}
                      <span className="text-[10px] font-semibold text-slate-500">
                        {item.unit}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* LIFETIME SUMMARY CARDS */}
      <div className={cn('grid gap-3', isSales ? 'grid-cols-2 lg:grid-cols-3' : 'grid-cols-2 lg:grid-cols-5')}>
        {/* Total Purchased */}
        {!isSales && (
          <div className="p-3.5 rounded-xl border border-slate-200 bg-blue-50/40 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-800">
                Total Purchased
              </span>
              <ShoppingBag className="h-4 w-4 text-blue-600" />
            </div>
            <div className="mt-1.5 flex items-baseline gap-1">
              <span className="text-xl font-black text-blue-950 font-mono">
                {summaryStats.totalPurchased}
              </span>
              <span className="text-[10px] font-bold text-blue-700">{item.unit}</span>
            </div>
            <span className="text-[10px] text-blue-700 mt-0.5 block">Lifetime procurement</span>
          </div>
        )}

        {/* Total Sold */}
        <div className="p-3.5 rounded-xl border border-slate-200 bg-emerald-50/40 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">
              Total Sold
            </span>
            <Receipt className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <span className="text-xl font-black text-emerald-950 font-mono">
              {summaryStats.totalSold}
            </span>
            <span className="text-[10px] font-bold text-emerald-700">{item.unit}</span>
          </div>
          <span className="text-[10px] text-emerald-700 mt-0.5 block">Lifetime sales billing</span>
        </div>

        {/* Current Combined Stock */}
        <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Combined Stock
            </span>
            <Building className="h-4 w-4 text-blue-600" />
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-xl font-black text-slate-900 font-mono">
              {summaryStats.combinedStock}
            </span>
            <span className="text-[10px] font-semibold text-slate-500">{item.unit}</span>
            <span
              className={cn(
                'text-[9px] font-bold px-1.5 py-0.2 rounded-full border',
                summaryStats.stockStatus === 'in-stock'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : summaryStats.stockStatus === 'low-stock'
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : 'bg-rose-50 text-rose-700 border-rose-200'
              )}
            >
              {summaryStats.stockStatus === 'in-stock'
                ? 'In Stock'
                : summaryStats.stockStatus === 'low-stock'
                ? 'Low'
                : 'Out'}
            </span>
          </div>
          <span className="text-[10px] text-slate-500 mt-0.5 block">All 3 branches total</span>
        </div>

        {/* Most Frequent Vendor */}
        {!isSales && (
          <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Top Vendor
              </span>
              <Users className="h-4 w-4 text-purple-600" />
            </div>
            <div className="mt-1.5 font-bold text-xs text-slate-900 truncate" title={summaryStats.topVendor}>
              {summaryStats.topVendor}
            </div>
            <span className="text-[10px] text-slate-500 mt-0.5 block truncate">Most frequent supplier</span>
          </div>
        )}

        {/* Most Frequent Customer */}
        <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Top Customer
            </span>
            <User className="h-4 w-4 text-indigo-600" />
          </div>
          <div className="mt-1.5 font-bold text-xs text-slate-900 truncate" title={summaryStats.topCustomer}>
            {summaryStats.topCustomer}
          </div>
          <span className="text-[10px] text-slate-500 mt-0.5 block truncate">Most frequent client</span>
        </div>
      </div>

      {/* CONTROLS: SUBTABS & DATE FILTERS */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
        {/* Subtabs Switcher */}
        <div className="flex items-center gap-1 bg-slate-200/80 p-1 rounded-xl w-full md:w-auto">
          {!isSales && (
            <button
              type="button"
              onClick={() => setSubTab('purchases')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex-1 md:flex-initial justify-center',
                subTab === 'purchases'
                  ? 'bg-white text-blue-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              <ShoppingBag className="h-3.5 w-3.5" />
              <span>Purchase History ({allItemPos.length})</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setSubTab('sales')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex-1 md:flex-initial justify-center',
              subTab === 'sales'
                ? 'bg-white text-emerald-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            )}
          >
            <Receipt className="h-3.5 w-3.5" />
            <span>Sales History ({allItemSales.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('adjustments')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex-1 md:flex-initial justify-center',
              subTab === 'adjustments'
                ? 'bg-white text-purple-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            )}
          >
            <History className="h-3.5 w-3.5" />
            <span>Stock Adjustments ({allItemAdjustments.length})</span>
          </button>
        </div>

        {/* Date Filter & Search Row */}
        <div className="flex items-center gap-2 w-full md:w-auto flex-wrap">
          {/* Quick Preset Selector */}
          <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-200 text-[11px] font-semibold">
            <Calendar className="h-3 w-3 text-slate-400 ml-1" />
            <button
              type="button"
              onClick={() => setDatePreset('all')}
              className={cn(
                'px-2 py-0.5 rounded transition-colors',
                datePreset === 'all' ? 'bg-blue-600 text-white font-bold' : 'text-slate-600 hover:bg-slate-100'
              )}
            >
              All Time
            </button>
            <button
              type="button"
              onClick={() => setDatePreset('month')}
              className={cn(
                'px-2 py-0.5 rounded transition-colors',
                datePreset === 'month' ? 'bg-blue-600 text-white font-bold' : 'text-slate-600 hover:bg-slate-100'
              )}
            >
              This Month
            </button>
            <button
              type="button"
              onClick={() => setDatePreset('30days')}
              className={cn(
                'px-2 py-0.5 rounded transition-colors',
                datePreset === '30days' ? 'bg-blue-600 text-white font-bold' : 'text-slate-600 hover:bg-slate-100'
              )}
            >
              30D
            </button>
            <button
              type="button"
              onClick={() => setDatePreset('90days')}
              className={cn(
                'px-2 py-0.5 rounded transition-colors',
                datePreset === '90days' ? 'bg-blue-600 text-white font-bold' : 'text-slate-600 hover:bg-slate-100'
              )}
            >
              90D
            </button>
            <button
              type="button"
              onClick={() => setDatePreset('custom')}
              className={cn(
                'px-2 py-0.5 rounded transition-colors',
                datePreset === 'custom' ? 'bg-blue-600 text-white font-bold' : 'text-slate-600 hover:bg-slate-100'
              )}
            >
              Custom
            </button>
          </div>

          {/* Custom Date Inputs */}
          {datePreset === 'custom' && (
            <div className="flex items-center gap-1.5 text-xs">
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="px-2 py-1 rounded-lg border border-slate-300 text-[11px] bg-white text-slate-800 focus:outline-none focus:border-blue-600"
              />
              <span className="text-slate-400 text-xs">to</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="px-2 py-1 rounded-lg border border-slate-300 text-[11px] bg-white text-slate-800 focus:outline-none focus:border-blue-600"
              />
            </div>
          )}

          {/* Search Input */}
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search in history..."
              className="pl-8 pr-2.5 py-1 text-xs rounded-lg border border-slate-300 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-600 w-36 sm:w-44"
            />
          </div>
        </div>
      </div>

      {/* 1. PURCHASE HISTORY SUBTAB */}
      {subTab === 'purchases' && !isSales && (
        <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs bg-white">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
              <tr>
                <th className="py-2.5 px-3.5">PO Number</th>
                <th className="py-2.5 px-3.5">Vendor</th>
                <th className="py-2.5 px-3">Date</th>
                <th className="py-2.5 px-3 text-center">Qty (Ordered / Rcvd)</th>
                <th className="py-2.5 px-3 text-right">Purchase Price</th>
                <th className="py-2.5 px-3 text-right">Line Total</th>
                <th className="py-2.5 px-3 text-center">Branch</th>
                <th className="py-2.5 px-3 text-center">Status</th>
                <th className="py-2.5 px-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredPos.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-400 font-medium">
                    No purchase orders found for this item in the selected period.
                  </td>
                </tr>
              ) : (
                filteredPos.map((record) => (
                  <tr key={record.po.id} className="hover:bg-slate-50/70 transition-colors">
                    {/* PO Number with click to open */}
                    <td className="py-2.5 px-3.5 font-bold">
                      <button
                        type="button"
                        onClick={() => setSelectedPo(record.po)}
                        title="Click to view Purchase Order document"
                        className="inline-flex items-center gap-1 font-mono text-blue-700 hover:text-blue-900 hover:underline"
                      >
                        <span>{record.poNumber}</span>
                        <ExternalLink className="h-3 w-3 opacity-60" />
                      </button>
                    </td>

                    {/* Vendor */}
                    <td className="py-2.5 px-3.5 font-medium text-slate-800">
                      {record.vendorName}
                    </td>

                    {/* Date */}
                    <td className="py-2.5 px-3 text-slate-600 text-[11px] whitespace-nowrap">
                      {formatDate(record.date)}
                    </td>

                    {/* Qty Ordered / Received */}
                    <td className="py-2.5 px-3 text-center font-mono">
                      <span className="font-bold text-slate-900">{record.qtyOrdered}</span>
                      <span className="text-slate-400"> / </span>
                      <span
                        className={cn(
                          'font-bold',
                          record.qtyReceived >= record.qtyOrdered
                            ? 'text-emerald-700'
                            : record.qtyReceived > 0
                            ? 'text-amber-700'
                            : 'text-slate-400'
                        )}
                      >
                        {record.qtyReceived}
                      </span>{' '}
                      <span className="text-[10px] text-slate-500 font-sans">{item.unit}</span>
                    </td>

                    {/* Purchase Price */}
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-800">
                      {formatCurrency(record.purchasePrice)}
                    </td>

                    {/* Line Total */}
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                      {formatCurrency(record.totalAmount)}
                    </td>

                    {/* Branch */}
                    <td className="py-2.5 px-3 text-center">{getBranchBadge(record.branchId)}</td>

                    {/* Status */}
                    <td className="py-2.5 px-3 text-center">
                      <span
                        className={cn(
                          'text-[10px] font-bold px-2 py-0.5 rounded-full border',
                          record.status === 'Received'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : record.status === 'Partially Received'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : record.status === 'Ordered'
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                        )}
                      >
                        {record.status}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedPo(record.po)}
                          className="px-2 py-1 rounded-md text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-colors"
                        >
                          View PO
                        </button>
                        <button
                          type="button"
                          onClick={() => handleJumpToPurchases(record.po)}
                          title="Open Purchases module"
                          className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                        >
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 2. SALES HISTORY SUBTAB */}
      {subTab === 'sales' && (
        <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs bg-white">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
              <tr>
                <th className="py-2.5 px-3.5">Sale No.</th>
                <th className="py-2.5 px-3">Date & Time</th>
                <th className="py-2.5 px-3.5">Customer</th>
                <th className="py-2.5 px-3 text-center">Qty Sold</th>
                <th className="py-2.5 px-3 text-right">Price Billed</th>
                <th className="py-2.5 px-3 text-right">Line Total</th>
                <th className="py-2.5 px-3 text-center">Branch</th>
                <th className="py-2.5 px-3 text-center">Type</th>
                <th className="py-2.5 px-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSales.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-400 font-medium">
                    No sales records found for this item in the selected period.
                  </td>
                </tr>
              ) : (
                filteredSales.map((record) => (
                  <tr
                    key={record.invoice.id}
                    className={cn(
                      'hover:bg-slate-50/70 transition-colors',
                      record.isVoided ? 'opacity-50 bg-rose-50/30' : ''
                    )}
                  >
                    {/* Sale No / Invoice Link */}
                    <td className="py-2.5 px-3.5 font-bold">
                      <button
                        type="button"
                        onClick={() => setSelectedInvoice(record.invoice)}
                        title="Click to view full Invoice"
                        className="inline-flex items-center gap-1 font-mono text-emerald-700 hover:text-emerald-900 hover:underline"
                      >
                        <span>{record.invoiceNumber}</span>
                        <ExternalLink className="h-3 w-3 opacity-60" />
                      </button>
                    </td>

                    {/* Date */}
                    <td className="py-2.5 px-3 text-slate-600 text-[11px] whitespace-nowrap">
                      <div>{formatDate(record.date)}</div>
                      {record.time && (
                        <div className="text-[10px] text-slate-400 font-mono">{record.time}</div>
                      )}
                    </td>

                    {/* Customer */}
                    <td className="py-2.5 px-3.5">
                      <div className="font-semibold text-slate-900">{record.customerName}</div>
                      {record.customerPhone && (
                        <div className="text-[10px] text-slate-400 font-mono">{record.customerPhone}</div>
                      )}
                    </td>

                    {/* Qty Sold */}
                    <td className="py-2.5 px-3 text-center font-mono">
                      <span className="font-extrabold text-slate-900 text-sm">{record.quantitySold}</span>{' '}
                      <span className="text-[10px] text-slate-500 font-sans">{item.unit}</span>
                    </td>

                    {/* Price Billed (Highlight if overridden vs master catalog salePrice) */}
                    <td className="py-2.5 px-3 text-right font-mono">
                      <div className="font-bold text-slate-900">
                        {formatCurrency(record.priceBilled)}
                      </div>
                      {record.isPriceOverridden && (
                        <span
                          className="inline-block text-[9px] font-bold px-1 rounded bg-amber-100 text-amber-800"
                          title={`Overridden from master catalog price ₹${item.salePrice}`}
                        >
                          Override
                        </span>
                      )}
                    </td>

                    {/* Line Total */}
                    <td className="py-2.5 px-3 text-right font-mono font-extrabold text-slate-900">
                      {formatCurrency(record.totalAmount)}
                    </td>

                    {/* Branch */}
                    <td className="py-2.5 px-3 text-center">{getBranchBadge(record.branchId)}</td>

                    {/* Type / Voided Badge */}
                    <td className="py-2.5 px-3 text-center">
                      {record.isVoided ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200">
                          Voided
                        </span>
                      ) : (
                        <span
                          className={cn(
                            'text-[10px] font-bold px-2 py-0.5 rounded-full border',
                            record.transactionType === 'Cash'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-blue-50 text-blue-700 border-blue-200'
                          )}
                        >
                          {record.transactionType}
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedInvoice(record.invoice)}
                          className="px-2 py-1 rounded-md text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors"
                        >
                          View Bill
                        </button>
                        <button
                          type="button"
                          onClick={() => handleJumpToInvoices(record.invoice)}
                          title="Open Invoices module"
                          className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                        >
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 3. STOCK ADJUSTMENT HISTORY SUBTAB */}
      {subTab === 'adjustments' && (
        <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs bg-white">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
              <tr>
                <th className="py-2.5 px-3.5">Timestamp</th>
                <th className="py-2.5 px-3 text-center">Branch</th>
                <th className="py-2.5 px-3 text-center">Adjustment</th>
                <th className="py-2.5 px-3 text-center">Stock Transition</th>
                <th className="py-2.5 px-3.5">Reason</th>
                <th className="py-2.5 px-3.5">Adjusted By</th>
                <th className="py-2.5 px-3.5">Notes / Ref</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAdjustments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400 font-medium">
                    No physical adjustments or transfer logs found for this item in the selected period.
                  </td>
                </tr>
              ) : (
                filteredAdjustments.map((record) => {
                  const isPositive = record.delta > 0;
                  return (
                    <tr
                      key={record.log.id}
                      onClick={() => setSelectedAdjustment(record.log)}
                      className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                    >
                      {/* Timestamp */}
                      <td className="py-2.5 px-3.5 text-slate-700 font-mono text-[11px] whitespace-nowrap">
                        {formatDate(record.timestamp)}
                        <span className="block text-[10px] text-slate-400">
                          {new Date(record.timestamp).toLocaleTimeString('en-IN', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </td>

                      {/* Branch */}
                      <td className="py-2.5 px-3 text-center">{getBranchBadge(record.branchId)}</td>

                      {/* Adjustment Delta */}
                      <td className="py-2.5 px-3 text-center font-mono font-extrabold text-sm">
                        <span
                          className={cn(
                            'inline-flex items-center gap-0.5 px-2 py-0.5 rounded',
                            isPositive
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          )}
                        >
                          {isPositive ? `+${record.delta}` : record.delta}
                        </span>
                      </td>

                      {/* Transition (prev -> new) */}
                      <td className="py-2.5 px-3 text-center font-mono text-xs">
                        <span className="text-slate-500">{record.previousQuantity}</span>
                        <span className="text-slate-300 mx-1">→</span>
                        <span className="font-bold text-slate-900">{record.newQuantity}</span>{' '}
                        <span className="text-[10px] text-slate-400 font-sans">{item.unit}</span>
                      </td>

                      {/* Reason */}
                      <td className="py-2.5 px-3.5 font-semibold text-slate-800">
                        {record.reason}
                      </td>

                      {/* Adjusted By */}
                      <td className="py-2.5 px-3.5 text-slate-600 text-xs font-medium">
                        {record.adjustedBy}
                      </td>

                      {/* Notes / References */}
                      <td className="py-2.5 px-3.5 text-slate-500 text-[11px] max-w-[200px] truncate">
                        {record.notes || record.linkedChallanNumber || record.transferRef || '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ADJUSTMENT DETAIL POPUP (IF CLICKED) */}
      {selectedAdjustment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-blue-600" />
                <h3 className="font-bold text-sm text-slate-900">Stock Adjustment Audit Details</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAdjustment(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2.5 text-xs text-slate-700">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500 font-medium">Reason:</span>
                <span className="font-bold text-slate-900">{selectedAdjustment.reason}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500 font-medium">Branch:</span>
                <span className="font-bold">{BRANCHES.find((b) => b.id === selectedAdjustment.branchId)?.name}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500 font-medium">Quantity Delta:</span>
                <span className={cn('font-bold font-mono', selectedAdjustment.quantityChange > 0 ? 'text-emerald-700' : 'text-rose-700')}>
                  {selectedAdjustment.quantityChange > 0 ? `+${selectedAdjustment.quantityChange}` : selectedAdjustment.quantityChange} {item.unit}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500 font-medium">Stock Before / After:</span>
                <span className="font-mono font-bold">{selectedAdjustment.previousQuantity} → {selectedAdjustment.newQuantity} {item.unit}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500 font-medium">Adjusted By:</span>
                <span className="font-semibold text-slate-900">{selectedAdjustment.adjustedBy}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500 font-medium">Timestamp:</span>
                <span className="font-mono">{new Date(selectedAdjustment.timestamp).toLocaleString('en-IN')}</span>
              </div>
              {selectedAdjustment.notes && (
                <div className="pt-1">
                  <span className="text-slate-500 font-medium block mb-1">Remarks / Notes:</span>
                  <p className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-800 text-[11px] leading-relaxed">
                    {selectedAdjustment.notes}
                  </p>
                </div>
              )}
              {selectedAdjustment.linkedChallanNumber && (
                <div className="flex justify-between py-1">
                  <span className="text-slate-500 font-medium">Delivery Challan:</span>
                  <span className="font-mono font-bold text-blue-700">{selectedAdjustment.linkedChallanNumber}</span>
                </div>
              )}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedAdjustment(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DOCUMENT PREVIEW MODALS */}
      {selectedPo && (
        <PurchaseOrderPdfModal
          purchaseOrder={selectedPo}
          isOpen={Boolean(selectedPo)}
          onClose={() => setSelectedPo(null)}
        />
      )}

      {selectedInvoice && (
        <InvoicePdfModal
          invoice={selectedInvoice}
          isOpen={Boolean(selectedInvoice)}
          onClose={() => setSelectedInvoice(null)}
        />
      )}
    </div>
  );
};
