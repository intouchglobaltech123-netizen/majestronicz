import React, { useState } from 'react';
import {
  ShoppingBag,
  Search,
  Plus,
  PackageCheck,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Ban,
  Building2,
  Calendar,
  Paperclip,
  Eye,
} from 'lucide-react';
import {
  PurchaseOrder,
  PurchaseOrderStatus,
  BRANCHES,
  BranchScope,
} from '../../types';
import { useErp } from '../../context/ErpContext';
import { ReceiveStockModal } from './ReceiveStockModal';
import { PurchaseOrderPdfModal } from './PurchaseOrderPdfModal';
import { PurchaseOrderDetailModal } from './PurchaseOrderDetailModal';
import { formatCurrency } from '../../lib/utils';

interface PurchaseOrderListProps {
  onCreateNewPo: () => void;
}

export const PurchaseOrderList: React.FC<PurchaseOrderListProps> = ({ onCreateNewPo }) => {
  const {
    purchaseOrders,
    currentBranch,
    currentUser,
    cancelPurchaseOrder,
    canManagePurchases,
    selectedPurchaseOrderForDetail,
    setSelectedPurchaseOrderForDetail,
  } = useErp();

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<PurchaseOrderStatus | 'ALL'>('ALL');
  const [showOverdueOnly, setShowOverdueOnly] = useState(false);
  const [branchFilter, setBranchFilter] = useState<BranchScope>(currentBranch);

  // Active Modals
  const [selectedPoForReceive, setSelectedPoForReceive] = useState<PurchaseOrder | null>(null);
  const [selectedPoForPdf, setSelectedPoForPdf] = useState<PurchaseOrder | null>(null);

  const todayStr = new Date().toISOString().split('T')[0];

  const isPoOverdue = (po: PurchaseOrder): boolean => {
    return (
      (po.status === 'Ordered' || po.status === 'Partially Received') &&
      po.expectedDeliveryDate < todayStr
    );
  };

  // Filtered dataset
  const filteredPos = purchaseOrders.filter((po) => {
    // Branch scope filter
    const effectiveScope = branchFilter === 'all' ? null : branchFilter;
    if (effectiveScope && po.branchId !== effectiveScope) return false;

    // Status filter
    if (selectedStatus !== 'ALL' && po.status !== selectedStatus) return false;

    // Overdue filter
    if (showOverdueOnly && !isPoOverdue(po)) return false;

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchPo = po.poNumber.toLowerCase().includes(q);
      const matchVendor = po.vendorName.toLowerCase().includes(q);
      const matchItem = po.items.some(
        (it) => it.itemName.toLowerCase().includes(q) || it.itemCode.toLowerCase().includes(q)
      );
      if (!matchPo && !matchVendor && !matchItem) return false;
    }

    return true;
  });

  // Overdue count across all active POs
  const overdueCount = purchaseOrders.filter(isPoOverdue).length;

  return (
    <div className="space-y-4">
      {/* Control Bar */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search PO #, supplier, or item description..."
            className="w-full pl-10 pr-4 py-2 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-100 bg-white"
          />
        </div>

        {/* Filters & Actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Branch Filter — hidden for branch-locked roles (Manager, Purchase)
              so they can't view other branches' POs via this internal filter. */}
          {currentUser.role !== 'Manager' && currentUser.role !== 'Purchase' && (
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value as BranchScope)}
              className="px-3 py-2 text-xs font-semibold rounded-xl border border-slate-300 bg-white text-slate-700 focus:outline-hidden focus:border-blue-500"
            >
              <option value="all">All Branches</option>
              {BRANCHES.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}

          {/* Overdue quick toggle */}
          <button
            type="button"
            onClick={() => setShowOverdueOnly(!showOverdueOnly)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl border transition-colors ${
              showOverdueOnly
                ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                : overdueCount > 0
                ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>Overdue ({overdueCount})</span>
          </button>

          {/* Create PO CTA */}
          {canManagePurchases && (
            <button
              onClick={onCreateNewPo}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-xl shadow-xs transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span>Issue New PO</span>
            </button>
          )}
        </div>
      </div>

      {/* Status Segment Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {(['ALL', 'Ordered', 'Partially Received', 'Received', 'Cancelled'] as const).map((st) => {
          const count =
            st === 'ALL'
              ? purchaseOrders.length
              : purchaseOrders.filter((p) => p.status === st).length;

          return (
            <button
              key={st}
              onClick={() => setSelectedStatus(st)}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-xl transition-all shrink-0 ${
                selectedStatus === st
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              <span>{st === 'ALL' ? 'All Orders' : st}</span>
              <span
                className={`ml-1.5 text-[11px] px-1.5 py-0.2 rounded-md ${
                  selectedStatus === st ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Decluttered PO Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 text-xs font-bold uppercase tracking-wider">
                <th className="py-3 px-4">PO Number & Date</th>
                <th className="py-3 px-4">Vendor</th>
                <th className="py-3 px-3">Branch</th>
                <th className="py-3 px-3 text-center">Status</th>
                <th className="py-3 px-3">Expected Delivery</th>
                <th className="py-3 px-4 text-right">Total</th>
                <th className="py-3 px-3 text-center" title="Vendor Bills Attached">
                  <div className="flex items-center justify-center gap-1">
                    <Paperclip className="h-3.5 w-3.5 text-slate-400" />
                    <span className="hidden sm:inline">Bills</span>
                  </div>
                </th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredPos.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <ShoppingBag className="h-10 w-10 mx-auto text-slate-300 mb-2" />
                    <p className="text-sm font-medium text-slate-600">No purchase orders found</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {searchQuery || selectedStatus !== 'ALL' || showOverdueOnly
                        ? 'Try clearing active search or filters'
                        : 'Issue your first purchase order to replenish stock'}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredPos.map((po) => {
                  const overdue = isPoOverdue(po);
                  const branchObj = BRANCHES.find((b) => b.id === po.branchId);
                  const billCount = po.attachments?.length || 0;

                  return (
                    <tr
                      key={po.id}
                      onClick={() => setSelectedPurchaseOrderForDetail(po)}
                      className={`hover:bg-slate-50/80 transition-colors group cursor-pointer ${
                        overdue ? 'bg-rose-50/30' : ''
                      }`}
                      title="Click to open Purchase Order details"
                    >
                      {/* PO Number & Date */}
                      <td className="py-3.5 px-4">
                        <div className="font-mono font-bold text-slate-900 group-hover:text-blue-600 flex items-center gap-1.5 transition-colors">
                          <span>{po.poNumber}</span>
                        </div>
                        <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                          <Calendar className="h-3 w-3" />
                          <span>{po.date}</span>
                        </div>
                      </td>

                      {/* Vendor */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900">
                          {po.vendorName}
                        </div>
                        {po.vendorContact && (
                          <div className="text-xs text-slate-400">{po.vendorContact}</div>
                        )}
                      </td>

                      {/* Branch */}
                      <td className="py-3.5 px-3">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-xs font-semibold">
                          <Building2 className="h-3 w-3 text-slate-400" />
                          {branchObj?.name || po.branchId}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-3 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                            po.status === 'Received'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : po.status === 'Partially Received'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : po.status === 'Cancelled'
                              ? 'bg-slate-100 text-slate-500 border-slate-200'
                              : 'bg-blue-50 text-blue-700 border-blue-200'
                          }`}
                        >
                          {po.status === 'Received' && <CheckCircle2 className="h-3 w-3" />}
                          {po.status === 'Partially Received' && <Clock className="h-3 w-3" />}
                          {po.status === 'Cancelled' && <Ban className="h-3 w-3" />}
                          {po.status === 'Ordered' && <ShoppingBag className="h-3 w-3" />}
                          <span>{po.status}</span>
                        </span>
                      </td>

                      {/* Expected Delivery */}
                      <td className="py-3.5 px-3">
                        {overdue ? (
                          <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 border border-rose-200 text-xs font-bold">
                            <AlertTriangle className="h-3 w-3 text-rose-600 shrink-0" />
                            <span>{po.expectedDeliveryDate}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-600 font-medium">
                            {po.expectedDeliveryDate}
                          </span>
                        )}
                      </td>

                      {/* Total */}
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900">
                        {formatCurrency(po.totalAmount)}
                      </td>

                      {/* Vendor Bills Attached Indicator */}
                      <td className="py-3.5 px-3 text-center">
                        {billCount > 0 ? (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-colors"
                            title={`${billCount} vendor bill(s) attached — click row to view`}
                          >
                            <Paperclip className="h-3 w-3 text-blue-600 shrink-0" />
                            <span>{billCount}</span>
                          </span>
                        ) : (
                          <span className="text-slate-300 font-mono text-xs" title="No bills attached">
                            —
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {/* Receive Stock Button */}
                          {(po.status === 'Ordered' || po.status === 'Partially Received') && canManagePurchases && (
                            <button
                              onClick={() => setSelectedPoForReceive(po)}
                              title="Inward physical stock"
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 shadow-2xs transition-colors"
                            >
                              <PackageCheck className="h-3.5 w-3.5" />
                              <span className="hidden md:inline">Receive</span>
                            </button>
                          )}

                          {/* View Detail Modal Button */}
                          <button
                            onClick={() => setSelectedPurchaseOrderForDetail(po)}
                            title="Open detailed PO view"
                            className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            <Eye className="h-4 w-4" />
                          </button>

                          {/* View / Print Official Document PDF */}
                          <button
                            onClick={() => setSelectedPoForPdf(po)}
                            title="Print / View Purchase Order PDF document"
                            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                          >
                            <FileText className="h-4 w-4" />
                          </button>

                          {/* Cancel button */}
                          {po.status === 'Ordered' && canManagePurchases && (
                            <button
                              onClick={() => {
                                if (window.confirm(`Cancel Purchase Order ${po.poNumber}?`)) {
                                  cancelPurchaseOrder(po.id);
                                }
                              }}
                              title="Cancel Purchase Order"
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            >
                              <Ban className="h-4 w-4" />
                            </button>
                          )}
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

      {/* Stock Receiving Modal */}
      <ReceiveStockModal
        isOpen={Boolean(selectedPoForReceive)}
        onClose={() => setSelectedPoForReceive(null)}
        purchaseOrder={selectedPoForReceive}
      />

      {/* Purchase Order Full Detail View Modal */}
      <PurchaseOrderDetailModal
        isOpen={Boolean(selectedPurchaseOrderForDetail)}
        onClose={() => setSelectedPurchaseOrderForDetail(null)}
        purchaseOrder={selectedPurchaseOrderForDetail}
      />

      {/* PO Document Print / PDF Modal */}
      <PurchaseOrderPdfModal
        isOpen={Boolean(selectedPoForPdf)}
        onClose={() => setSelectedPoForPdf(null)}
        purchaseOrder={selectedPoForPdf}
      />
    </div>
  );
};
