import React, { useState, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import { Item, BranchId, BRANCHES, StockAdjustmentReason } from '../../types';
import { X, Plus, Minus, AlertTriangle, Check, ShieldAlert, ArrowRight, MapPin } from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { UniversalDropdown } from '../common/UniversalDropdown';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  item: Item | null;
  targetBranchId?: BranchId;
}

const ADJUSTMENT_REASONS: { label: string; value: StockAdjustmentReason; description: string }[] = [
  { label: 'Stock Audit Correction', value: 'Stock Audit Correction', description: 'Reconcile count mismatch from physical stocktaking' },
  { label: 'Damage', value: 'Damage', description: 'Goods broken, bent, water-damaged, or unusable' },
  { label: 'Loss / Theft', value: 'Loss / Theft', description: 'Missing items unaccounted for during inspection' },
  { label: 'Return to Vendor', value: 'Return to Vendor', description: 'Faulty or rejected items returned back to supplier' },
  { label: 'Other', value: 'Other', description: 'Custom reason (mandatory explanation required)' },
];

export const AdjustStockModal: React.FC<Props> = ({
  isOpen,
  onClose,
  item,
  targetBranchId,
}) => {
  const {
    getBranchStock,
    adjustStock,
    updateBranchStockLocation,
    currentBranch,
    currentUser,
    canAdjustBranchStock,
  } = useErp();

  const [selectedBranch, setSelectedBranch] = useState<BranchId>(() => {
    if (targetBranchId) return targetBranchId;
    if (currentBranch !== 'all') return currentBranch;
    if (currentUser.role === 'Manager') return currentUser.assignedBranchId || 'erode-hq';
    return 'erode-hq';
  });

  const [adjustmentType, setAdjustmentType] = useState<'add' | 'deduct'>('add');
  const [quantity, setQuantity] = useState<number | ''>('');
  const [location, setLocation] = useState('');
  const [reason, setReason] = useState<StockAdjustmentReason>('Stock Audit Correction');
  const [customReason, setCustomReason] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const activeB = targetBranchId || (currentBranch !== 'all' ? currentBranch : 'erode-hq');
    if (targetBranchId) {
      setSelectedBranch(targetBranchId);
    } else if (currentBranch !== 'all') {
      setSelectedBranch(currentBranch);
    }
    setQuantity('');
    setReason('Stock Audit Correction');
    setCustomReason('');
    setNotes('');
    setAdjustmentType('add');
    if (item) {
      setLocation(getBranchStock(item.id, activeB)?.location || '');
    }
  }, [isOpen, targetBranchId, currentBranch, item, getBranchStock]);

  const handleBranchChange = (branchId: BranchId) => {
    setSelectedBranch(branchId);
    if (item) {
      setLocation(getBranchStock(item.id, branchId)?.location || '');
    }
  };

  if (!isOpen || !item) return null;

  const currentStockRow = getBranchStock(item.id, selectedBranch);
  const currentQuantity = currentStockRow?.quantity ?? 0;
  const numQty = typeof quantity === 'number' ? quantity : 0;
  const delta = adjustmentType === 'add' ? numQty : -numQty;
  const projectedQuantity = Math.max(0, currentQuantity + delta);
  const isDeductExceeding = adjustmentType === 'deduct' && numQty > currentQuantity;

  const isPermitted = canAdjustBranchStock(selectedBranch);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!isPermitted) {
      toast.error('You do not have permission to adjust stock for this branch');
      return;
    }

    if (!numQty || numQty <= 0) {
      toast.error('Please enter a valid adjustment quantity greater than 0');
      return;
    }

    if (reason === 'Other' && !customReason.trim()) {
      toast.error('Please specify the custom reason for this stock adjustment');
      return;
    }

    if (isDeductExceeding) {
      toast.error(`Cannot deduct ${numQty} units. Current stock is only ${currentQuantity} units.`);
      return;
    }

    const finalNotes = reason === 'Other'
      ? `${customReason.trim()}${notes.trim() ? ` — ${notes.trim()}` : ''}`
      : notes.trim() || undefined;

    adjustStock(item.id, selectedBranch, delta, reason, finalNotes);

    if (location.trim() !== (currentStockRow?.location || '')) {
      updateBranchStockLocation(item.id, selectedBranch, location.trim() || undefined);
    }

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[92vh] text-slate-900">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-blue-100 border border-blue-200 flex items-center justify-center text-blue-700">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Manual Stock Adjustment</h2>
              <p className="text-xs text-slate-500">Creates an immutable audit log entry for this item</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5">
          {/* Item Banner */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                  {item.itemCode}
                </span>
                <span className="text-xs text-slate-500">{item.category}</span>
              </div>
              <h3 className="text-sm font-bold text-slate-900 mt-1">{item.itemName}</h3>
            </div>
            <div className="text-right shrink-0">
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Unit</span>
              <span className="text-xs font-bold text-slate-800">{item.unit}</span>
            </div>
          </div>

          {/* Branch Picker */}
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1.5">
              Stock Location / Branch <span className="text-rose-500">*</span>
            </label>
            {currentUser.role === 'CEO' ? (
              <div className="grid grid-cols-3 gap-2">
                {BRANCHES.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => handleBranchChange(b.id)}
                    className={cn(
                      'p-2.5 rounded-xl border text-left transition-all text-xs font-semibold',
                      selectedBranch === b.id
                        ? 'border-blue-600 bg-blue-50/80 text-blue-900 shadow-xs ring-2 ring-blue-500/20'
                        : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700'
                    )}
                  >
                    <div className="font-bold text-slate-900">{b.name}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      Current: <span className="font-bold text-slate-800">{getBranchStock(item.id, b.id)?.quantity ?? 0}</span> {item.unit}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-between text-xs">
                <span className="font-bold text-slate-800">
                  {BRANCHES.find((b) => b.id === selectedBranch)?.name || selectedBranch}
                </span>
                <span className="text-slate-500 font-medium">
                  Current Stock: <strong className="text-slate-900 font-bold">{currentQuantity}</strong> {item.unit}
                </span>
              </div>
            )}
          </div>

          {/* Physical Rack / Row Location */}
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-blue-600" />
                <span>Rack / Row Location (Shelf)</span>
              </span>
              <span className="text-[11px] font-normal text-slate-400">Optional</span>
            </label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Rack R2, Shelf B-4, Bin 10"
              className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 font-medium text-xs focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all"
            />
          </div>

          {/* Adjustment Direction Toggle */}
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1.5">
              Adjustment Action <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAdjustmentType('add')}
                className={cn(
                  'flex items-center justify-center gap-2 p-3 rounded-xl border text-xs font-bold transition-all',
                  adjustmentType === 'add'
                    ? 'bg-emerald-50 border-emerald-500 text-emerald-800 ring-2 ring-emerald-500/20 shadow-xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                )}
              >
                <Plus className="h-4 w-4 text-emerald-600" />
                <span>Add Stock (+)</span>
              </button>
              <button
                type="button"
                onClick={() => setAdjustmentType('deduct')}
                className={cn(
                  'flex items-center justify-center gap-2 p-3 rounded-xl border text-xs font-bold transition-all',
                  adjustmentType === 'deduct'
                    ? 'bg-rose-50 border-rose-500 text-rose-800 ring-2 ring-rose-500/20 shadow-xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                )}
              >
                <Minus className="h-4 w-4 text-rose-600" />
                <span>Deduct Stock (-)</span>
              </button>
            </div>
          </div>

          {/* Quantity Input & Preview */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1.5">
                Quantity to {adjustmentType === 'add' ? 'Add' : 'Deduct'} <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="1"
                  max={adjustmentType === 'deduct' ? currentQuantity : undefined}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value) || 0))}
                  placeholder="e.g. 5"
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-900 font-bold text-base focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20 transition-all pr-12"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">
                  {item.unit}
                </span>
              </div>
            </div>

            {/* Live Stock Transition Preview */}
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-center">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Stock Result Preview</span>
              <div className="flex items-center gap-2 mt-1">
                <div className="text-sm font-bold text-slate-600">
                  {currentQuantity}
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <div className={cn(
                  'text-xs font-bold px-1.5 py-0.5 rounded',
                  adjustmentType === 'add' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                )}>
                  {adjustmentType === 'add' ? `+${numQty}` : `-${numQty}`}
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <div className="text-base font-extrabold text-blue-700">
                  {projectedQuantity} <span className="text-xs font-medium text-slate-500">{item.unit}</span>
                </div>
              </div>
            </div>
          </div>

          {isDeductExceeding && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-xs text-rose-700 font-semibold">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>Cannot deduct more than available physical stock ({currentQuantity} {item.unit}).</span>
            </div>
          )}

          {/* Reason Selection */}
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1.5">
              Adjustment Reason <span className="text-rose-500">*</span>
            </label>
            <UniversalDropdown
              value={reason}
              onChange={(v) => setReason(v as StockAdjustmentReason)}
              options={ADJUSTMENT_REASONS.map((r) => ({ value: r.value, label: r.label, sublabel: r.description }))}
              addNewLabel="Add custom reason"
              addNewPlaceholder="e.g. Scrapped in calibration test"
              onAddNew={(name) => {
                // A typed-in reason routes through the "Other" custom-reason path.
                setReason('Other');
                setCustomReason(name);
              }}
              buttonClassName="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-900 font-semibold text-xs"
            />
          </div>

          {/* Free-text input if "Other" */}
          {reason === 'Other' && (
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1.5">
                Specify Reason <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="e.g. Scrapped during machine calibration testing"
                required
                className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 font-medium text-xs focus:outline-none focus:border-blue-600"
              />
            </div>
          )}

          {/* Optional remarks */}
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1.5">
              Additional Audit Notes / Remarks <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Approved by plant supervisor during shift handover"
              className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 font-normal text-xs focus:outline-none focus:border-blue-600 resize-none"
            />
          </div>

          {/* Audit disclaimer */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 flex items-start gap-2">
            <ShieldAlert className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
            <span>
              This operation will permanently log an adjustment attributed to{' '}
              <strong className="text-slate-800 font-bold">{currentUser.name} ({currentUser.role})</strong>{' '}
              with the current timestamp.
            </span>
          </div>

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isPermitted || !numQty || isDeductExceeding || (reason === 'Other' && !customReason.trim())}
              className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-xs hover:shadow transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Check className="h-4 w-4" />
              <span>Confirm Stock Adjustment</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
