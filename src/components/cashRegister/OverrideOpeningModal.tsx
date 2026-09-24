import React, { useState, useEffect } from 'react';
import { X, Edit2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentOpeningAmount: number;
  date: string;
  branchName: string;
  onSaveOverride: (amount: number, reason: string) => void;
}

export const OverrideOpeningModal: React.FC<Props> = ({
  isOpen,
  onClose,
  currentOpeningAmount,
  date,
  branchName,
  onSaveOverride,
}) => {
  const [newAmount, setNewAmount] = useState<string>('');
  const [reason, setReason] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      setNewAmount(String(currentOpeningAmount || ''));
      setReason('');
    }
  }, [isOpen, currentOpeningAmount]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(newAmount);
    if (isNaN(parsed) || parsed < 0) {
      toast.error('Please enter a valid opening amount');
      return;
    }
    if (!reason.trim()) {
      toast.error('Please enter an audit reason for overriding the opening cash');
      return;
    }

    onSaveOverride(parsed, reason.trim());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-none max-w-md w-full shadow-2xl border border-slate-300 overflow-y-auto max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-none bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
              <Edit2 className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Override Opening Cash</h3>
              <p className="text-[11px] text-slate-500">
                {date} • {branchName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-none text-slate-400 hover:text-slate-700 hover:bg-slate-100 border border-transparent hover:border-slate-300 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Warning Banner */}
        <div className="p-4 bg-amber-50 border-b border-amber-200 flex items-start gap-2.5 text-xs text-amber-900">
          <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
          <p>
            The Opening Amount is normally carried forward automatically from yesterday's closing drawer count. Override this only if there is a verified discrepancy or physical cash replenishment.
          </p>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              New Opening Cash Amount (₹) <span className="text-red-600">*</span>
            </label>
            <div className="relative">
              <input
                type="number"
                step="any"
                min="0"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                placeholder="0.00"
                className="w-full text-base font-mono font-bold bg-white border border-slate-300 rounded-none px-3 py-2.5 pl-8 focus:outline-none focus:border-red-600"
              />
              <span className="absolute left-3 top-3 font-bold text-slate-400">₹</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Reason for Override (Audit Log) <span className="text-red-600">*</span>
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Added ₹2,000 small change float from central bank locker, or physical recount before opening..."
              className="w-full text-xs bg-white border border-slate-300 rounded-none px-3 py-2 focus:outline-none focus:border-red-600 resize-none"
            />
          </div>

          <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-300 rounded-none transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 active:bg-red-800 rounded-none border border-red-700 transition-colors shadow-none cursor-pointer"
            >
              Save Override
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
