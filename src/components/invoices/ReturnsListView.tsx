import React, { useState, useMemo } from 'react';
import { useErp } from '../../context/ErpContext';
import { Invoice, BranchId, BRANCHES } from '../../types';
import { formatCurrency, cn } from '../../lib/utils';
import {
  RotateCcw,
  Search,
  Calendar,
  Building,
  User,
  Package,
  ExternalLink,
  ShieldCheck,
  Receipt,
} from 'lucide-react';

interface Props {
  onSelectReturn: (invoice: Invoice) => void;
  onViewOriginalSale: (invoice: Invoice) => void;
}

export const ReturnsListView: React.FC<Props> = ({
  onSelectReturn,
  onViewOriginalSale,
}) => {
  const { invoices, currentBranch, isAllBranches } = useErp();

  const [searchQuery, setSearchQuery] = useState('');
  const [branchFilter, setBranchFilter] = useState<'ALL' | BranchId>(() =>
    isAllBranches ? 'ALL' : (currentBranch as BranchId)
  );

  // Sync branch filter with global header
  React.useEffect(() => {
    if (!isAllBranches) {
      setBranchFilter(currentBranch as BranchId);
    }
  }, [currentBranch, isAllBranches]);

  // Filter only sales with returns processed
  const returnedInvoices = useMemo(() => {
    return invoices.filter(
      (inv) =>
        (inv.returns && inv.returns.length > 0) || (inv.totalReturnedAmount || 0) > 0
    );
  }, [invoices]);

  const filteredReturns = useMemo(() => {
    return returnedInvoices.filter((inv) => {
      // Branch filter
      const matchesBranch =
        branchFilter === 'ALL'
          ? isAllBranches || inv.branchId === currentBranch
          : inv.branchId === branchFilter;
      if (!matchesBranch) return false;

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesCustomer = inv.customerName.toLowerCase().includes(q);
        const matchesNumber = inv.invoiceNumber.toLowerCase().includes(q);
        const matchesPhone = inv.customerPhone && inv.customerPhone.includes(q);
        const matchesReturnItem = (inv.returns || []).some(
          (r) =>
            r.itemName.toLowerCase().includes(q) ||
            r.itemCode.toLowerCase().includes(q) ||
            (r.reason && r.reason.toLowerCase().includes(q)) ||
            (r.processedBy && r.processedBy.toLowerCase().includes(q))
        );
        if (!matchesCustomer && !matchesNumber && !matchesPhone && !matchesReturnItem) {
          return false;
        }
      }

      return true;
    });
  }, [returnedInvoices, branchFilter, isAllBranches, currentBranch, searchQuery]);

  // KPI calculations across filtered returns
  const totalRefundAmount = filteredReturns.reduce(
    (sum, inv) => sum + (inv.totalReturnedAmount || 0),
    0
  );
  const totalUnitsRestocked = filteredReturns.reduce((sum, inv) => {
    const units = (inv.returns || []).reduce((s, r) => s + r.returnedQuantity, 0);
    return sum + units;
  }, 0);

  return (
    <div className="space-y-4">
      {/* Top Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center gap-3.5">
          <div className="h-10 w-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0 border border-amber-200">
            <RotateCcw className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Total Returns Processed
            </p>
            <p className="text-xl font-extrabold text-slate-900 font-mono mt-0.5">
              {filteredReturns.length}
            </p>
            <p className="text-[11px] text-slate-500">
              Active return vouchers logged
            </p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center gap-3.5">
          <div className="h-10 w-10 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center shrink-0 border border-rose-200">
            <Receipt className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Total Refund Value
            </p>
            <p className="text-xl font-extrabold text-rose-700 font-mono mt-0.5">
              {formatCurrency(totalRefundAmount)}
            </p>
            <p className="text-[11px] text-slate-500">
              Credited / refunded to customers
            </p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center gap-3.5">
          <div className="h-10 w-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-200">
            <Package className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Physical Stock Restocked
            </p>
            <p className="text-xl font-extrabold text-emerald-700 font-mono mt-0.5">
              {totalUnitsRestocked} units
            </p>
            <p className="text-[11px] text-slate-500">
              Inwarded back into warehouses
            </p>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by Sale No, Customer, Item, Reason, or Staff..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all bg-slate-50/50"
          />
        </div>

        {/* Branch Filter */}
        <div className="flex items-center gap-2 w-full md:w-auto">
          <Building className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value as 'ALL' | BranchId)}
            className="px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white font-medium text-slate-700 focus:outline-hidden focus:border-blue-500"
          >
            <option value="ALL">All Branches</option>
            {BRANCHES.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Returns Table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
        <div className="px-6 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
              Returns & Refunds Log ({filteredReturns.length})
            </span>
            <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded border border-amber-300 font-bold">
              Restoration Verified
            </span>
          </div>
          <span className="text-[11px] text-slate-500">
            Click any row to open full Return Voucher & line-item breakdown.
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                <th className="py-3.5 px-4">Original Sale No.</th>
                <th className="py-3.5 px-4">Date of Return</th>
                <th className="py-3.5 px-4">Customer</th>
                <th className="py-3.5 px-4">Items Returned</th>
                <th className="py-3.5 px-4 text-right">Return Amount</th>
                <th className="py-3.5 px-4">Branch</th>
                <th className="py-3.5 px-4">Processed By</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {filteredReturns.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <RotateCcw className="h-8 w-8 mx-auto text-slate-300 mb-2" />
                    <p className="font-bold text-sm text-slate-700">No return records found</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {searchQuery || branchFilter !== 'ALL'
                        ? 'Try adjusting your search query or branch filter.'
                        : 'No sales returns have been processed yet.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredReturns.map((inv) => {
                  const returns = inv.returns || [];
                  const latest = returns[returns.length - 1];
                  const returnDateStr = latest?.returnedAt
                    ? new Date(latest.returnedAt).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })
                    : inv.date;
                  const returnTimeStr = latest?.returnedAt
                    ? new Date(latest.returnedAt).toLocaleTimeString('en-IN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : inv.time;

                  const returnStaff = latest?.processedBy || 'Store Staff';
                  const isFullReturn = (inv.totalReturnedAmount || 0) >= inv.grandTotal;

                  return (
                    <tr
                      key={inv.id}
                      onClick={() => onSelectReturn(inv)}
                      className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                      title="Click to view full return detail & refund voucher"
                    >
                      {/* 1. Original Sale No. */}
                      <td className="py-3.5 px-4 font-mono">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-blue-700 group-hover:underline">
                            {inv.invoiceNumber}
                          </span>
                          <span
                            className={cn(
                              'text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded border',
                              isFullReturn
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : 'bg-amber-50 text-amber-800 border-amber-200'
                            )}
                          >
                            {isFullReturn ? 'Full' : 'Partial'}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400 block font-sans mt-0.5">
                          Sale: {formatCurrency(inv.grandTotal)}
                        </span>
                      </td>

                      {/* 2. Date of Return */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1 text-slate-800 font-medium">
                          <Calendar className="h-3.5 w-3.5 text-slate-400" />
                          <span>{returnDateStr}</span>
                        </div>
                        <span className="text-[10px] text-slate-400 pl-4.5">{returnTimeStr}</span>
                      </td>

                      {/* 3. Customer */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900 flex items-center gap-1.5">
                          <User className="h-3 w-3 text-slate-400 shrink-0" />
                          <span>{inv.customerName}</span>
                        </div>
                        {inv.customerPhone && (
                          <div className="text-[11px] text-slate-500 font-mono pl-4.5">
                            {inv.customerPhone}
                          </div>
                        )}
                      </td>

                      {/* 4. Items Returned */}
                      <td className="py-3.5 px-4">
                        {returns.length === 0 ? (
                          <span className="text-slate-400 italic">No line detail</span>
                        ) : returns.length === 1 ? (
                          <div>
                            <span className="font-semibold text-slate-900 line-clamp-1">
                              {returns[0].itemName}
                            </span>
                            <span className="text-[10px] font-mono text-amber-800 font-bold bg-amber-50 px-1 rounded border border-amber-200 mt-0.5 inline-block">
                              {returns[0].returnedQuantity} unit{returns[0].returnedQuantity === 1 ? '' : 's'}
                            </span>
                          </div>
                        ) : (
                          <div>
                            <span className="font-semibold text-slate-900">
                              {returns.length} items returned
                            </span>
                            <div className="text-[10px] text-slate-500 truncate max-w-[200px]">
                              {returns.map((r) => `${r.returnedQuantity}x ${r.itemName}`).join(', ')}
                            </div>
                          </div>
                        )}
                      </td>

                      {/* 5. Return Amount */}
                      <td className="py-3.5 px-4 text-right font-mono">
                        <span className="font-black text-sm text-rose-700 block">
                          {formatCurrency(inv.totalReturnedAmount || 0)}
                        </span>
                        <span className="text-[10px] text-slate-400">Refund value</span>
                      </td>

                      {/* 6. Branch */}
                      <td className="py-3.5 px-4">
                        <span className="font-mono uppercase text-[11px] text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                          {inv.branchId}
                        </span>
                      </td>

                      {/* 7. Processed By */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5 text-slate-700 font-medium">
                          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                          <span className="truncate max-w-[140px]">{returnStaff}</span>
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => onSelectReturn(inv)}
                            className="px-2.5 py-1 text-xs font-bold rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 transition-colors flex items-center gap-1 shadow-2xs"
                            title="View Return Voucher"
                          >
                            <RotateCcw className="h-3 w-3" />
                            <span>Return Slip</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => onViewOriginalSale(inv)}
                            className="px-2 py-1 text-xs font-medium rounded-lg text-blue-700 hover:bg-blue-50 border border-blue-200 transition-colors flex items-center gap-1 shadow-2xs"
                            title="View Original Sale Invoice"
                          >
                            <ExternalLink className="h-3 w-3" />
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
      </div>
    </div>
  );
};
