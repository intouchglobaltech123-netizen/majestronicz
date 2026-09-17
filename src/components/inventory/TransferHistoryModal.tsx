import React, { useState } from 'react';
import { useErp } from '../../context/ErpContext';
import { BranchScope, BRANCHES, DeliveryChallan } from '../../types';
import { toast } from 'sonner';
import { DeliveryChallanPdfModal } from '../challans/DeliveryChallanPdfModal';
import {
  X,
  History,
  Search,
  ArrowRight,
  Truck,
  ChevronDown,
  ChevronUp,
  Package,
  Calendar,
  User,
  ShieldCheck,
  PackageCheck,
  Clock,
} from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const TransferHistoryModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const {
    stockTransfers,
    challans,
    currentBranch,
    currentUser,
    receiveStockTransfer,
  } = useErp();

  // The destination branch (or CEO) confirms an in-transit transfer.
  const canReceive = (toBranch: string) => {
    if (currentUser.role === 'CEO') return true;
    const myBranch = currentUser.assignedBranchId || (currentBranch !== 'all' ? currentBranch : undefined);
    return !!myBranch && myBranch === toBranch;
  };

  const [previewChallan, setPreviewChallan] = useState<DeliveryChallan | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBranchFilter, setSelectedBranchFilter] = useState<BranchScope>(() => {
    if (currentUser.role === 'Manager') return currentUser.assignedBranchId || 'coimbatore';
    if (currentBranch !== 'all') return currentBranch;
    return 'all';
  });

  const [expandedTransferIds, setExpandedTransferIds] = useState<Set<string>>(new Set());

  if (!isOpen) return null;

  const toggleExpand = (id: string) => {
    setExpandedTransferIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedTransferIds(new Set(stockTransfers.map((t) => t.id)));
  };

  const collapseAll = () => {
    setExpandedTransferIds(new Set());
  };

  const filteredTransfers = stockTransfers.filter((transfer) => {
    // Branch Filter: source or destination matches selected branch
    if (currentUser.role === 'Manager') {
      const mgrBranch = currentUser.assignedBranchId || 'coimbatore';
      if (transfer.fromBranch !== mgrBranch && transfer.toBranch !== mgrBranch) return false;
    } else if (selectedBranchFilter !== 'all') {
      if (transfer.fromBranch !== selectedBranchFilter && transfer.toBranch !== selectedBranchFilter) {
        return false;
      }
    }

    // Search query: transfer #, notes, user, or item details
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchNumber = transfer.transferNumber.toLowerCase().includes(q);
      const matchUser = transfer.transferredBy.toLowerCase().includes(q);
      const matchNotes = transfer.notes?.toLowerCase().includes(q) || false;
      const matchChallan = transfer.challanNumber?.toLowerCase().includes(q) || false;
      const matchItems = transfer.items.some(
        (i) => i.itemName.toLowerCase().includes(q) || i.itemCode.toLowerCase().includes(q)
      );

      if (!matchNumber && !matchUser && !matchNotes && !matchChallan && !matchItems) {
        return false;
      }
    }

    return true;
  });

  const formatTimestamp = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-slate-900">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-blue-100 border border-blue-200 flex items-center justify-center text-blue-700">
              <History className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">Inter-Branch Transfer Batches</h2>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  {stockTransfers.length} Batches
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Multi-item atomic warehouse transfers grouped by dispatch batch
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Toolbar & Filters */}
        <div className="p-4 border-b border-slate-200 bg-white flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by transfer #, item, user, notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end flex-wrap">
            {currentUser.role === 'CEO' && (
              <select
                value={selectedBranchFilter}
                onChange={(e) => setSelectedBranchFilter(e.target.value as BranchScope)}
                className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 focus:outline-none focus:border-blue-600"
              >
                <option value="all">All Branches</option>
                {BRANCHES.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={expandAll}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-slate-600 hover:bg-slate-100 border border-slate-200 transition-colors"
            >
              Expand All
            </button>
            <button
              type="button"
              onClick={collapseAll}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-slate-600 hover:bg-slate-100 border border-slate-200 transition-colors"
            >
              Collapse All
            </button>
          </div>
        </div>

        {/* Transfer Batches List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-4 sm:p-6 space-y-4">
          {filteredTransfers.length === 0 ? (
            <div className="py-12 text-center text-slate-500">
              <Package className="h-10 w-10 mx-auto text-slate-300 mb-2" />
              <p className="text-sm font-semibold text-slate-700">No transfer batches found</p>
              <p className="text-xs text-slate-400 mt-0.5">
                New multi-item transfers completed via "Transfer Stock" will appear here as expandable batches.
              </p>
            </div>
          ) : (
            filteredTransfers.map((transfer) => {
              const fromObj = BRANCHES.find((b) => b.id === transfer.fromBranch);
              const toObj = BRANCHES.find((b) => b.id === transfer.toBranch);
              const isExpanded = expandedTransferIds.has(transfer.id);

              return (
                <div
                  key={transfer.id}
                  className="rounded-xl border border-slate-200 bg-white shadow-2xs hover:shadow-xs transition-all overflow-hidden"
                >
                  {/* Batch Summary Header Row */}
                  <div
                    onClick={() => toggleExpand(transfer.id)}
                    className="p-4 bg-slate-50/70 hover:bg-slate-100/70 cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors select-none"
                  >
                    <div className="flex items-start sm:items-center gap-3 min-w-0">
                      <button
                        type="button"
                        className="p-1 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-blue-600 transition-colors shrink-0 mt-0.5 sm:mt-0"
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>

                      <div>
                        <div className="flex items-center flex-wrap gap-2">
                          <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                            {transfer.transferNumber}
                          </span>

                          {/* Route Badge */}
                          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white border border-slate-200 text-xs font-bold text-slate-800">
                            <span>{fromObj?.name || transfer.fromBranch}</span>
                            <ArrowRight className="h-3.5 w-3.5 text-blue-600" />
                            <span>{toObj?.name || transfer.toBranch}</span>
                          </div>

                          <span className="text-[11px] font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                            {transfer.items.length} {transfer.items.length === 1 ? 'Item' : 'Items'} • {transfer.totalQuantity} Units
                          </span>

                          {/* Status pill */}
                          {(transfer.status || 'received') === 'in_transit' ? (
                            <span className="flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                              <Clock className="h-3 w-3" /> In Transit
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                              <PackageCheck className="h-3 w-3" /> Received
                            </span>
                          )}
                        </div>

                        {transfer.notes && (
                          <p className="text-xs text-slate-600 italic mt-1.5">
                            "{transfer.notes}"
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 self-end sm:self-auto text-[11px] text-slate-500">
                      <div className="flex flex-col sm:items-end gap-0.5 text-right">
                        <span className="flex items-center gap-1 font-medium text-slate-600">
                          <Calendar className="h-3 w-3 text-slate-400" />
                          {formatTimestamp(transfer.timestamp)}
                        </span>
                        <span className="flex items-center gap-1 text-[11px] text-slate-400">
                          <User className="h-3 w-3 text-slate-400" />
                          {transfer.transferredBy}
                        </span>
                      </div>

                      {transfer.challanNumber && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const matched = challans.find(
                              (c) => c.challanNumber === transfer.challanNumber
                            );
                            if (matched) {
                              setPreviewChallan(matched);
                            } else {
                              toast.error('Linked challan not found');
                            }
                          }}
                          title="View linked Delivery Challan"
                          className="px-2 py-1 rounded-lg text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 transition-colors flex items-center gap-1"
                        >
                          <Truck className="h-3 w-3" />
                          <span>{transfer.challanNumber}</span>
                        </button>
                      )}

                      {/* Receive: destination branch (or CEO) confirms intake */}
                      {(transfer.status || 'received') === 'in_transit' && canReceive(transfer.toBranch) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            receiveStockTransfer(transfer.id);
                          }}
                          title={`Confirm receipt at ${toObj?.name || transfer.toBranch}`}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-600 text-white border border-emerald-600 hover:bg-emerald-700 transition-colors flex items-center gap-1"
                        >
                          <PackageCheck className="h-3.5 w-3.5" />
                          <span>Receive</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expandable Line-Items Table */}
                  {isExpanded && (
                    <div className="p-4 border-t border-slate-200 bg-white">
                      <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center justify-between">
                        <span>Transferred Line Items ({transfer.items.length})</span>
                        <span>Atomic Batch Content</span>
                      </div>

                      <div className="border border-slate-200 rounded-xl overflow-hidden">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="bg-slate-50 text-slate-600 font-bold uppercase text-[11px] border-b border-slate-200">
                              <th className="py-2.5 px-3 w-10 text-center">#</th>
                              <th className="py-2.5 px-3">Item Details</th>
                              <th className="py-2.5 px-3 w-28 font-mono">Code</th>
                              <th className="py-2.5 px-3 text-right w-28">Transferred Qty</th>
                              <th className="py-2.5 px-3 w-20">Unit</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {transfer.items.map((item, idx) => (
                              <tr key={item.itemId || idx} className="hover:bg-slate-50/70">
                                <td className="py-2 px-3 text-center text-slate-400 font-mono">
                                  {idx + 1}
                                </td>
                                <td className="py-2 px-3">
                                  <div className="font-bold text-slate-900">{item.itemName}</div>
                                  {item.itemHSN && (
                                    <span className="text-[11px] text-slate-400">HSN: {item.itemHSN}</span>
                                  )}
                                </td>
                                <td className="py-2 px-3">
                                  <span className="font-mono text-[11px] font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                                    {item.itemCode}
                                  </span>
                                </td>
                                <td className="py-2 px-3 text-right">
                                  <span className="font-mono font-bold text-blue-700 text-sm">
                                    {item.quantity}
                                  </span>
                                </td>
                                <td className="py-2 px-3 text-slate-500 font-semibold text-[11px] uppercase">
                                  {item.unit}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="bg-slate-50/80 border-t border-slate-200 font-bold text-xs text-slate-700">
                              <td colSpan={3} className="py-2.5 px-3 text-right uppercase text-[11px]">
                                Total Quantity Transferred:
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-sm text-slate-900">
                                {transfer.totalQuantity}
                              </td>
                              <td className="py-2.5 px-3 text-slate-500 uppercase text-[11px]">Units</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>

                      {(transfer.status || 'received') === 'in_transit' ? (
                        <p className="mt-2.5 text-[11px] text-amber-700 flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5" />
                          Stock has left {fromObj?.name || transfer.fromBranch} and is awaiting receipt at {toObj?.name || transfer.toBranch}. Destination stock updates only after Receive.
                        </p>
                      ) : transfer.receivedBy ? (
                        <p className="mt-2.5 text-[11px] text-emerald-700 flex items-center gap-1.5">
                          <PackageCheck className="h-3.5 w-3.5" />
                          Received by {transfer.receivedBy}{transfer.receivedAt ? ` • ${formatTimestamp(transfer.receivedAt)}` : ''}
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50/80 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <span>Each batch maintains individual paired StockAdjustmentLog audit entries for both source and target branches.</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      <DeliveryChallanPdfModal
        challan={previewChallan}
        isOpen={previewChallan !== null}
        onClose={() => setPreviewChallan(null)}
      />
    </div>
  );
};
