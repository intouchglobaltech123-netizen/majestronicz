import React, { useState } from 'react';
import { formatCurrency } from '../../lib/utils';
import { X, Lock, CheckCircle2, AlertCircle } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  date: string;
  branchName: string;
  openingAmount: number;
  cashSales: number;
  cashExpenses: number;
  closingBalance: number;
  onConfirmClose: (notes?: string) => void;
}

export const CloseDayConfirmModal: React.FC<Props> = ({
  isOpen,
  onClose,
  date,
  branchName,
  openingAmount,
  cashSales,
  cashExpenses,
  closingBalance,
  onConfirmClose,
}) => {
  const [notes, setNotes] = useState('');

  if (!isOpen) return null;

  const handleConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirmClose(notes.trim() || undefined);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-none max-w-lg w-full shadow-2xl border border-slate-300 overflow-y-auto max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-none bg-red-50 border border-red-200 flex items-center justify-center text-red-700">
              <Lock className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Close Daily Cash Register</h3>
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

        {/* Audit Numbers Breakdown Box */}
        <form onSubmit={handleConfirm} className="p-6 space-y-5">
          <div className="p-4 rounded-none bg-slate-50 border border-slate-300 space-y-2.5 text-xs">
            <div className="flex items-center justify-between text-slate-600">
              <span>Opening Cash Balance:</span>
              <span className="font-mono font-semibold text-slate-900">
                {formatCurrency(openingAmount)}
              </span>
            </div>
            <div className="flex items-center justify-between text-emerald-700">
              <span>+ Cash Sales Collected:</span>
              <span className="font-mono font-bold">
                +{formatCurrency(cashSales)}
              </span>
            </div>
            <div className="flex items-center justify-between text-rose-700">
              <span>- Cash Expenses Paid:</span>
              <span className="font-mono font-bold">
                -{formatCurrency(cashExpenses)}
              </span>
            </div>
            <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-sm">
              <span className="font-extrabold text-slate-900">
                Expected Physical Cash in Drawer:
              </span>
              <span className="font-mono text-base font-bold text-red-700">
                {formatCurrency(closingBalance)}
              </span>
            </div>
          </div>

          {/* Locking Warning */}
          <div className="p-3 bg-amber-50 rounded-none border border-amber-300 flex items-start gap-2.5 text-xs text-amber-900">
            <AlertCircle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Important Audit Notice:</p>
              <p className="text-[11px] text-amber-800 mt-0.5">
                Closing locks this register. No further invoices or expenses can be backdated into this date. This closing balance will automatically become tomorrow's opening amount.
              </p>
            </div>
          </div>

          {/* Optional Closing Notes */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Closing Denomination / Verification Notes <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. 500x12, 200x20, 100x15... Physical cash counted and locked in shop safe."
              className="w-full text-xs bg-white border border-slate-300 rounded-none px-3 py-2 focus:outline-none focus:border-red-600 resize-none"
            />
          </div>

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-300 rounded-none transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 active:bg-red-800 rounded-none border border-red-700 transition-all shadow-none flex items-center gap-1.5 cursor-pointer"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>Confirm & Lock Register</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
