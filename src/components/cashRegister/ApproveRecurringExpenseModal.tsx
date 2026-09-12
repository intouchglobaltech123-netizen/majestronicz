import React, { useState } from 'react';
import { RecurringExpenseTemplate, BranchId, BRANCHES } from '../../types';
import { useErp } from '../../context/ErpContext';
import { formatCurrency } from '../../lib/utils';
import { X, CheckCircle, Calendar, Building, DollarSign, Wallet, CreditCard } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  template: RecurringExpenseTemplate | null;
  targetBranchId: BranchId;
  targetDate: string;
}

export const ApproveRecurringExpenseModal: React.FC<Props> = ({
  isOpen,
  onClose,
  template,
  targetBranchId,
  targetDate,
}) => {
  const { approveRecurringExpense, isDayClosed } = useErp();

  const [amount, setAmount] = useState<number>(() => template?.defaultAmount || 0);
  const [paymentMode, setPaymentMode] = useState<'Cash' | 'GPay'>(
    () => template?.paymentMode || 'Cash'
  );

  React.useEffect(() => {
    if (template) {
      setAmount(template.defaultAmount);
      setPaymentMode(template.paymentMode);
    }
  }, [template]);

  if (!isOpen || !template) return null;

  const branchObj = BRANCHES.find((b) => b.id === targetBranchId);
  const isClosed = isDayClosed(targetBranchId, targetDate);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isClosed) {
      toast.error('Cannot approve expense: Cash register for this day is already closed.');
      return;
    }
    if (amount <= 0) {
      toast.error('Please enter a valid expense amount greater than ₹0.');
      return;
    }

    approveRecurringExpense(template.id, targetBranchId, targetDate, amount, paymentMode);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-purple-100 border border-purple-200 flex items-center justify-center text-purple-700">
              <Wallet className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-slate-900">
                Approve Scheduled Expense
              </h3>
              <p className="text-[11px] text-slate-500">
                Post to Daily Cash Register expenses
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Target Register Summary */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Expense Item:</span>
              <span className="font-extrabold text-slate-900">{template.name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium flex items-center gap-1">
                <Building className="h-3 w-3 text-slate-400" />
                <span>Target Branch:</span>
              </span>
              <span className="font-bold text-slate-800">
                {branchObj?.name || targetBranchId}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium flex items-center gap-1">
                <Calendar className="h-3 w-3 text-slate-400" />
                <span>Register Date:</span>
              </span>
              <span className="font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                {targetDate}
              </span>
            </div>
          </div>

          {/* Amount Input (Editable for varying monthly costs like Electricity/Water) */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
              <span>Confirmed Amount (₹) *</span>
              <span className="text-[11px] font-normal text-slate-400">
                Default: {formatCurrency(template.defaultAmount)}
              </span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 font-mono text-sm">
                ₹
              </div>
              <input
                type="number"
                min="1"
                step="1"
                required
                value={amount || ''}
                onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
                placeholder="Enter confirmed amount"
                className="w-full pl-8 pr-3 py-2 text-sm font-mono font-bold bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 text-slate-900"
              />
            </div>
            <p className="text-[11px] text-slate-500 italic">
              Adjust if this month's bill differs from the standard template default.
            </p>
          </div>

          {/* Payment Mode Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700">
              Payment Mode *
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMode('Cash')}
                className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                  paymentMode === 'Cash'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300 ring-2 ring-emerald-500/20 shadow-2xs'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <DollarSign className="h-3.5 w-3.5" />
                <span>Physical Cash</span>
              </button>
              <button
                type="button"
                onClick={() => setPaymentMode('GPay')}
                className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                  paymentMode === 'GPay'
                    ? 'bg-blue-50 text-blue-800 border-blue-300 ring-2 ring-blue-500/20 shadow-2xs'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <CreditCard className="h-3.5 w-3.5" />
                <span>GPay / Bank Transfer</span>
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isClosed}
              className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-xs flex items-center gap-1.5 disabled:opacity-50"
            >
              <CheckCircle className="h-3.5 w-3.5" />
              <span>Confirm & Add to Register</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
