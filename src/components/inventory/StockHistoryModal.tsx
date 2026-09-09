import React, { useState } from 'react';
import { useErp } from '../../context/ErpContext';
import { Item, BranchScope, BRANCHES, StockAdjustmentLog } from '../../types';
import {
  X,
  History,
  Search,
  ArrowRight,
  Truck,
  ArrowRightLeft,
  Calendar,
  User,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '../../lib/utils';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  filterItem?: Item | null;
}

export const StockHistoryModal: React.FC<Props> = ({
  isOpen,
  onClose,
  filterItem,
}) => {
  const {
    stockAdjustmentLogs,
    currentBranch,
    currentUser,
    setCurrentView,
  } = useErp();

  const [selectedBranchFilter, setSelectedBranchFilter] = useState<BranchScope>(() => {
    if (currentUser.role === 'Manager') return currentUser.assignedBranchId || 'erode-hq';
    if (currentBranch !== 'all') return currentBranch;
    return 'all';
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedReasonFilter, setSelectedReasonFilter] = useState<string>('all');

  if (!isOpen) return null;

  const filteredLogs = stockAdjustmentLogs.filter((log) => {
    // 1. Filter by specific item if provided
    if (filterItem && log.itemId !== filterItem.id) return false;

    // 2. Filter by branch
    if (currentUser.role === 'Manager') {
      const mgrBranch = currentUser.assignedBranchId || 'erode-hq';
      if (log.branchId !== mgrBranch) return false;
    } else if (selectedBranchFilter !== 'all') {
      if (log.branchId !== selectedBranchFilter) return false;
    }

    // 3. Filter by reason
    if (selectedReasonFilter !== 'all' && log.reason !== selectedReasonFilter) {
      return false;
    }

    // 4. Text search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = log.itemName.toLowerCase().includes(q);
      const matchCode = log.itemCode.toLowerCase().includes(q);
      const matchUser = log.adjustedBy.toLowerCase().includes(q);
      const matchNotes = log.notes?.toLowerCase().includes(q) || false;
      const matchRef = log.transferRef?.toLowerCase().includes(q) || false;
      const matchChallan = log.linkedChallanNumber?.toLowerCase().includes(q) || false;
      if (!matchName && !matchCode && !matchUser && !matchNotes && !matchRef && !matchChallan) {
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

  const getReasonBadge = (reason: StockAdjustmentLog['reason']) => {
    switch (reason) {
      case 'Inter-branch Transfer':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'Damage':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'Loss / Theft':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'Stock Audit Correction':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'Return to Vendor':
        return 'bg-orange-50 text-orange-700 border-orange-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-slate-900">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-blue-100 border border-blue-200 flex items-center justify-center text-blue-700">
              <History className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">
                  {filterItem ? `Stock Audit History — ${filterItem.itemName}` : 'Master Inventory Audit Trail'}
                </h2>
                {filterItem && (
                  <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                    {filterItem.itemCode}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Immutable chronological log of all stock changes, adjustments, and inter-branch transfers
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Filter Bar */}
        <div className="p-4 border-b border-slate-200 bg-white flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by item code, notes, user, ref..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
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

            <select
              value={selectedReasonFilter}
              onChange={(e) => setSelectedReasonFilter(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 focus:outline-none focus:border-blue-600"
            >
              <option value="all">All Reasons</option>
              <option value="Stock Audit Correction">Stock Audit Correction</option>
              <option value="Damage">Damage</option>
              <option value="Loss / Theft">Loss / Theft</option>
              <option value="Inter-branch Transfer">Inter-branch Transfer</option>
              <option value="Return to Vendor">Return to Vendor</option>
              <option value="Other">Other</option>
            </select>
          </div>
        </div>

        {/* History Records Table / Timeline */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {filteredLogs.length === 0 ? (
            <div className="py-12 text-center text-slate-500">
              <ShieldCheck className="h-10 w-10 mx-auto text-slate-300 mb-2" />
              <p className="text-sm font-semibold text-slate-700">No stock adjustment entries found</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Adjustments made via the Inventory screen will be logged here in real-time.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredLogs.map((log) => {
                const branchObj = BRANCHES.find((b) => b.id === log.branchId);
                const isPositive = log.quantityChange > 0;

                return (
                  <div
                    key={log.id}
                    className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-300 transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs"
                  >
                    {/* Left: Item, Branch & Reason */}
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex items-center flex-wrap gap-2">
                        <span className="font-bold text-slate-900">{log.itemName}</span>
                        <span className="font-mono text-[10px] font-bold px-1.5 py-0.2 rounded bg-white text-slate-600 border border-slate-200">
                          {log.itemCode}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white text-blue-700 border border-blue-200">
                          {branchObj?.name || log.branchId}
                        </span>
                        <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold border', getReasonBadge(log.reason))}>
                          {log.reason}
                        </span>
                      </div>

                      {log.notes && (
                        <p className="text-slate-600 text-[11px] italic bg-white/80 px-2.5 py-1 rounded-lg border border-slate-100">
                          "{log.notes}"
                        </p>
                      )}

                      <div className="flex items-center flex-wrap gap-3 text-[10px] text-slate-500 pt-0.5">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-slate-400" />
                          {formatTimestamp(log.timestamp)}
                        </span>
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3 text-slate-400" />
                          {log.adjustedBy}
                        </span>
                        {log.transferRef && (
                          <span className="flex items-center gap-1 font-mono text-blue-700 font-bold bg-blue-50 px-1.5 py-0.2 rounded border border-blue-200">
                            <ArrowRightLeft className="h-3 w-3" />
                            {log.transferRef}
                          </span>
                        )}
                        {log.linkedChallanNumber && (
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              setCurrentView('challans');
                            }}
                            className="flex items-center gap-1 text-blue-600 hover:text-blue-800 font-bold hover:underline"
                          >
                            <Truck className="h-3 w-3" />
                            {log.linkedChallanNumber}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Right: Quantity Movement Badge */}
                    <div className="flex items-center gap-3 shrink-0 self-end sm:self-center bg-white px-3.5 py-2 rounded-xl border border-slate-200 shadow-2xs">
                      <div className="text-right">
                        <span className="text-[10px] text-slate-400 font-bold uppercase block">From</span>
                        <span className="text-xs font-semibold text-slate-600">{log.previousQuantity}</span>
                      </div>

                      <div className="flex flex-col items-center">
                        <span
                          className={cn(
                            'text-xs font-extrabold px-2 py-0.5 rounded-full',
                            isPositive
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          )}
                        >
                          {isPositive ? `+${log.quantityChange}` : log.quantityChange}
                        </span>
                        <ArrowRight className="h-3 w-3 text-slate-400 mt-0.5" />
                      </div>

                      <div className="text-left">
                        <span className="text-[10px] text-slate-400 font-bold uppercase block">To</span>
                        <span className="text-xs font-extrabold text-blue-700">{log.newQuantity}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <span>
            Showing <strong className="text-slate-800 font-bold">{filteredLogs.length}</strong> log entries
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
