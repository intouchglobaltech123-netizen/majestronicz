import React, { useState } from 'react';
import { CashExpense } from '../../types';
import { formatCurrency } from '../../lib/utils';
import {
  Wallet,
  Plus,
  Trash2,
  Lock,
  Sparkles,
  DollarSign,
} from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  expenses: CashExpense[];
  isClosed: boolean;
  onAddExpense: (expense: { reason: string; cashAmount: number; gpayAmount: number }) => void;
  onDeleteExpense: (expenseId: string) => void;
}

const QUICK_EXPENSE_SUGGESTIONS = [
  'Staff Tea & Coffee',
  'Courier Dispatch (Professional)',
  'Packing Carton Boxes & Tape',
  'Delivery Van Fuel',
  'Shop Drinking Water Cans',
  'Electrical / Hardware Supplies',
];

export const DailyCashExpensesTable: React.FC<Props> = ({
  expenses,
  isClosed,
  onAddExpense,
  onDeleteExpense,
}) => {
  const [reason, setReason] = useState('');
  const [cashAmount, setCashAmount] = useState<string>('');
  const [gpayAmount, setGpayAmount] = useState<string>('');

  const totalCash = expenses.reduce((sum, e) => sum + (e.cashAmount || 0), 0);
  const totalGpay = expenses.reduce((sum, e) => sum + (e.gpayAmount || 0), 0);
  const totalExpenses = totalCash + totalGpay;

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      toast.error('Please enter an expense reason or description');
      return;
    }

    const c = parseFloat(cashAmount) || 0;
    const g = parseFloat(gpayAmount) || 0;

    if (c <= 0 && g <= 0) {
      toast.error('Please specify an expense amount in Cash or GPay');
      return;
    }

    onAddExpense({
      reason: reason.trim(),
      cashAmount: c,
      gpayAmount: g,
    });

    // Reset input fields
    setReason('');
    setCashAmount('');
    setGpayAmount('');
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs flex flex-col h-full">
      {/* Table Header */}
      <div className="p-4 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
            <Wallet className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900">Daily Expenses Log</h3>
              {isClosed ? (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 flex items-center gap-1">
                  <Lock className="h-3 w-3" />
                  <span>Locked</span>
                </span>
              ) : (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                  Manual Entry
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500">
              Record petty cash payouts & digital GPay payments made from the shop
            </p>
          </div>
        </div>

        <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 border border-rose-200">
          Total: {formatCurrency(totalExpenses)}
        </span>
      </div>

      {/* Add Expense Form (Active only when Day is Open) */}
      {!isClosed ? (
        <div className="p-4 bg-slate-50/50 border-b border-slate-200">
          <form onSubmit={handleAdd} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
              {/* Reason */}
              <div className="sm:col-span-6">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Expense Reason / Description <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Staff tea, packing bubble wrap, courier..."
                  className="w-full text-xs bg-white border border-slate-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              {/* Cash Amount */}
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-bold text-slate-700 mb-1 flex items-center gap-1 text-emerald-800">
                  <DollarSign className="h-3 w-3" />
                  <span>Cash (₹)</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={cashAmount}
                  onChange={(e) => setCashAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full text-xs font-mono font-bold bg-white border border-slate-300 rounded-xl px-3 py-2 text-right focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              {/* GPay Amount */}
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-slate-700 mb-1 text-blue-700">
                  GPay (₹)
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={gpayAmount}
                  onChange={(e) => setGpayAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full text-xs font-mono font-bold bg-white border border-slate-300 rounded-xl px-3 py-2 text-right focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              {/* Add Button */}
              <div className="sm:col-span-1">
                <button
                  type="submit"
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-1"
                  title="Add expense entry"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Quick Suggestions Chips */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[10px] text-slate-400 font-semibold flex items-center gap-1">
                <Sparkles className="h-2.5 w-2.5 text-amber-500" />
                <span>Quick:</span>
              </span>
              {QUICK_EXPENSE_SUGGESTIONS.map((sug) => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => setReason(sug)}
                  className="text-[10.5px] px-2 py-0.5 rounded-lg bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 transition-colors"
                >
                  {sug}
                </button>
              ))}
            </div>
          </form>
        </div>
      ) : (
        <div className="p-3 bg-slate-50 border-b border-slate-200 text-xs text-slate-500 flex items-center justify-center gap-2">
          <Lock className="h-3.5 w-3.5 text-slate-400" />
          <span>Register is closed for this date. Expense entries are locked.</span>
        </div>
      )}

      {/* Expenses Table */}
      {expenses.length === 0 ? (
        <div className="flex-1 py-12 px-4 text-center flex flex-col items-center justify-center">
          <div className="h-12 w-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-2">
            <Wallet className="h-6 w-6" />
          </div>
          <h4 className="text-xs font-bold text-slate-700">No Expenses Recorded Today</h4>
          <p className="text-[11px] text-slate-400 max-w-sm mt-1">
            {!isClosed
              ? 'Use the form above to record tea, dispatch courier, or shop maintenance payouts.'
              : 'No expenses were booked for this day.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto flex-1 max-h-[380px]">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-xs border-b border-slate-200 text-slate-600 uppercase text-[10px] font-bold tracking-wider">
              <tr>
                <th className="py-3 px-4">Reason / Description</th>
                <th className="py-3 px-3 text-right bg-rose-50/40 text-rose-900 border-x border-rose-100/50">
                  Cash (Drawer)
                </th>
                <th className="py-3 px-3 text-right">GPay</th>
                {!isClosed && <th className="py-3 px-3 text-center w-14">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {expenses.map((exp) => (
                <tr key={exp.id} className="hover:bg-slate-50/80 transition-colors">
                  {/* Reason & Staff Stamp */}
                  <td className="py-3 px-4">
                    <div className="font-bold text-slate-900 truncate max-w-xs">
                      {exp.reason}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Logged by {exp.createdBy || 'Staff'}
                    </div>
                  </td>

                  {/* Cash Amount */}
                  <td className="py-3 px-3 text-right font-mono font-bold text-rose-800 bg-rose-50/20 border-x border-rose-100/40">
                    {exp.cashAmount > 0 ? formatCurrency(exp.cashAmount) : <span className="text-slate-300">-</span>}
                  </td>

                  {/* GPay Amount */}
                  <td className="py-3 px-3 text-right font-mono font-semibold text-blue-700">
                    {exp.gpayAmount > 0 ? formatCurrency(exp.gpayAmount) : <span className="text-slate-300">-</span>}
                  </td>

                  {/* Action Delete */}
                  {!isClosed && (
                    <td className="py-3 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => onDeleteExpense(exp.id)}
                        className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                        title="Delete expense"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>

            {/* TOTAL EXPENSE ROW */}
            <tfoot className="sticky bottom-0 z-10 bg-slate-100/95 backdrop-blur-xs border-t-2 border-slate-300 font-bold text-xs">
              <tr>
                <td className="py-3 px-4 text-slate-800 uppercase text-[11px] tracking-wider">
                  Total Expense ({expenses.length} Lines)
                </td>
                {/* Cash Total */}
                <td className="py-3 px-3 text-right font-mono text-rose-800 bg-rose-100/60 border-x border-rose-200">
                  {formatCurrency(totalCash)}
                </td>
                {/* GPay Total */}
                <td className="py-3 px-3 text-right font-mono text-blue-700">
                  {formatCurrency(totalGpay)}
                </td>
                {!isClosed && <td className="py-3 px-3" />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Helper Footer */}
      <div className="p-3 border-t border-slate-100 bg-slate-50 text-[11px] text-slate-500 flex items-center justify-between">
        <span>* Only Cash expenses reduce the drawer balance</span>
        <span className="font-bold text-rose-700">
          All Expenses Total: {formatCurrency(totalExpenses)}
        </span>
      </div>
    </div>
  );
};
