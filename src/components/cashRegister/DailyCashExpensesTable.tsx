import React, { useState } from 'react';
import { CashExpense, EXPENSE_CATEGORIES, expenseIsEffective } from '../../types';
import { formatCurrency } from '../../lib/utils';
import {
  Wallet,
  Plus,
  Trash2,
  Lock,
  DollarSign,
  Paperclip,
} from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  expenses: CashExpense[];
  isClosed: boolean;
  /** Cash currently in the drawer (opening + cash sales − cash expenses). Used to
   *  warn when a new cash expense would overdraw it (CASH-10). */
  drawerCash?: number;
  onAddExpense: (expense: { reason: string; cashAmount: number; gpayAmount: number; category?: string; billUrl?: string }) => void;
  onDeleteExpense: (expenseId: string) => void;
  canApprove?: boolean;
  onApprove?: (expenseId: string, decision: 'approved' | 'rejected') => void;
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
  drawerCash,
  onAddExpense,
  onDeleteExpense,
  canApprove,
  onApprove,
}) => {
  const [reason, setReason] = useState('');
  const [category, setCategory] = useState<string>('');
  const [cashAmount, setCashAmount] = useState<string>('');
  const [gpayAmount, setGpayAmount] = useState<string>('');
  const [billUrl, setBillUrl] = useState<string>('');
  const [billName, setBillName] = useState<string>('');

  // Totals count only EFFECTIVE expenses (approved, or not needing approval). A
  // pending/rejected entry — e.g. a bank deposit awaiting approval — must not be
  // added to the drawer's Total Expense (CASH2-9).
  const effectiveExpenses = expenses.filter(expenseIsEffective);
  const totalCash = effectiveExpenses.reduce((sum, e) => sum + (e.cashAmount || 0), 0);
  const totalGpay = effectiveExpenses.reduce((sum, e) => sum + (e.gpayAmount || 0), 0);
  const totalExpenses = totalCash + totalGpay;

  // Report: total per category (effective entries only, same rule as above)
  const byCategory = effectiveExpenses.reduce<Record<string, number>>((acc, e) => {
    const key = e.category || 'Uncategorised';
    acc[key] = (acc[key] || 0) + (e.cashAmount || 0) + (e.gpayAmount || 0);
    return acc;
  }, {});
  const categorySummary = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);

  const handleBillFile = (file: File | null) => {
    if (!file) { setBillUrl(''); setBillName(''); return; }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Bill file too large (max 2 MB)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { setBillUrl(String(reader.result || '')); setBillName(file.name); };
    reader.readAsDataURL(file);
  };

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

    // Warn (but allow) when the cash portion would push the drawer below zero, so
    // an over-large cash expense isn't recorded silently (CASH-10).
    if (c > 0 && drawerCash != null && c > drawerCash) {
      const shortfall = Math.round((c - drawerCash) * 100) / 100;
      const ok = window.confirm(
        `This cash expense (₹${c.toLocaleString('en-IN')}) is more than the ₹${Math.max(0, drawerCash).toLocaleString('en-IN')} currently in the drawer and would leave it ₹${shortfall.toLocaleString('en-IN')} negative.\n\nRecord it anyway?`
      );
      if (!ok) return;
    }

    onAddExpense({
      reason: reason.trim(),
      category: category.trim() || undefined,
      billUrl: billUrl || undefined,
      cashAmount: c,
      gpayAmount: g,
    });

    // Reset input fields
    setReason('');
    setCategory('');
    setCashAmount('');
    setGpayAmount('');
    setBillUrl('');
    setBillName('');
  };

  return (
    <div className="bg-white border border-slate-300 rounded-none overflow-hidden shadow-xs flex flex-col h-full">
      {/* Table Header */}
      <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-none bg-red-50 border border-red-200 flex items-center justify-center text-red-700">
            <Wallet className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900">Daily Expenses Log</h3>
              {isClosed ? (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-none bg-slate-200 text-slate-700 flex items-center gap-1 border border-slate-300">
                  <Lock className="h-3 w-3" />
                  <span>Locked</span>
                </span>
              ) : (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-none bg-red-50 text-red-700 border border-red-200">
                  Manual Entry
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500">
              Record petty cash payouts & digital GPay payments made from the shop
            </p>
          </div>
        </div>

        <span className="text-xs font-bold px-2.5 py-1 rounded-none bg-red-50 text-red-700 border border-red-200 font-mono">
          Total: {formatCurrency(totalExpenses)}
        </span>
      </div>

      {/* Add Expense Form (Active only when Day is Open) */}
      {!isClosed ? (
        <div className="p-4 bg-slate-50 border-b border-slate-200">
          <form onSubmit={handleAdd} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
              {/* Reason */}
              <div className="sm:col-span-6">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Expense Reason / Description <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Staff tea, packing bubble wrap, courier..."
                  className="w-full text-xs bg-white border border-slate-300 rounded-none px-3 py-2 focus:outline-none focus:border-red-600"
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
                  className="w-full text-xs font-mono font-bold bg-white border border-slate-300 rounded-none px-3 py-2 text-right focus:outline-none focus:border-red-600"
                />
              </div>

              {/* GPay Amount */}
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  GPay (₹)
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={gpayAmount}
                  onChange={(e) => setGpayAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full text-xs font-mono font-bold bg-white border border-slate-300 rounded-none px-3 py-2 text-right focus:outline-none focus:border-red-600"
                />
              </div>

              {/* Add Button */}
              <div className="sm:col-span-1">
                <button
                  type="submit"
                  className="w-full py-2 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white rounded-none border border-red-700 text-xs font-bold transition-all shadow-none flex items-center justify-center gap-1 cursor-pointer"
                  title="Add expense entry"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Category + Bill upload row */}
            <div className="flex flex-wrap items-end gap-2.5">
              <div className="flex-1 min-w-[180px]">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Category</label>
                <input
                  list="expense-category-list"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="Pick or type a category…"
                  className="w-full text-xs bg-white border border-slate-300 rounded-none px-3 py-2 focus:outline-none focus:border-red-600"
                />
                <datalist id="expense-category-list">
                  {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div className="min-w-[160px]">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Bill / Receipt</label>
                <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-none px-3 py-2 cursor-pointer hover:bg-slate-50">
                  <Paperclip className="h-3.5 w-3.5 text-slate-500" />
                  <span className="truncate max-w-[120px]">{billName || 'Upload bill'}</span>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => handleBillFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </label>
              </div>
              {billUrl && (
                <button type="button" onClick={() => handleBillFile(null)} className="text-[11px] font-bold text-rose-600 hover:text-rose-800 pb-2 cursor-pointer">Remove bill</button>
              )}
            </div>

            {/* Quick Suggestions Chips */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] text-slate-400 font-semibold">
                Quick:
              </span>
              {QUICK_EXPENSE_SUGGESTIONS.map((sug) => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => setReason(sug)}
                  className="text-[11px] px-2 py-0.5 rounded-none bg-white hover:bg-slate-100 text-slate-600 border border-slate-300 transition-colors cursor-pointer"
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
          <div className="h-12 w-12 rounded-none bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 mb-2">
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
            <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200 text-slate-600 uppercase text-[11px] font-bold tracking-wider">
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
                <tr key={exp.id} className={`hover:bg-slate-50/80 transition-colors ${exp.approvalStatus === 'pending' ? 'bg-amber-50/50' : exp.approvalStatus === 'rejected' ? 'opacity-60' : ''}`}>
                  {/* Reason & Staff Stamp */}
                  <td className="py-3 px-4">
                    <div className="font-bold text-slate-900 truncate max-w-xs flex items-center gap-1.5 flex-wrap">
                      <span className="truncate">{exp.reason}</span>
                      {exp.category && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">{exp.category}</span>
                      )}
                      {exp.approvalStatus === 'pending' && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">Pending Approval</span>
                      )}
                      {exp.approvalStatus === 'approved' && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">Approved{exp.approvedBy ? ` · ${exp.approvedBy}` : ''}</span>
                      )}
                      {exp.approvalStatus === 'rejected' && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300">Rejected</span>
                      )}
                      {exp.billUrl && (
                        <a href={exp.billUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[10px] font-bold text-blue-600 hover:text-blue-800" title="View uploaded bill">
                          <Paperclip className="h-3 w-3" /> Bill
                        </a>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Logged by {exp.createdBy || 'Staff'}
                    </div>
                  </td>

                  {/* Cash Amount */}
                  <td className="py-3 px-3 text-right font-mono font-bold text-rose-800 bg-rose-50/20 border-x border-rose-100/40">
                    {exp.cashAmount > 0 ? formatCurrency(exp.cashAmount) : <span className="text-slate-300">-</span>}
                  </td>

                  {/* GPay Amount */}
                  <td className="py-3 px-3 text-right font-mono font-semibold text-slate-800">
                    {exp.gpayAmount > 0 ? formatCurrency(exp.gpayAmount) : <span className="text-slate-300">-</span>}
                  </td>

                  {/* Actions: approve/reject (pending) + delete */}
                  {!isClosed && (
                    <td className="py-3 px-3 text-center whitespace-nowrap">
                      {exp.approvalStatus === 'pending' && canApprove && onApprove && (
                        <>
                          <button
                            type="button"
                            onClick={() => onApprove(exp.id, 'approved')}
                            className="px-1.5 py-1 rounded-none text-emerald-700 hover:bg-emerald-50 transition-colors cursor-pointer font-bold text-xs"
                            title="Approve — deduct this cash from the drawer"
                          >
                            ✓
                          </button>
                          <button
                            type="button"
                            onClick={() => onApprove(exp.id, 'rejected')}
                            className="px-1.5 py-1 rounded-none text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer font-bold text-xs"
                            title="Reject"
                          >
                            ✕
                          </button>
                        </>
                      )}
                      {exp.approvalStatus === 'pending' && !canApprove && (
                        <span className="text-[10px] text-amber-700 font-semibold">Awaiting M/CEO</span>
                      )}
                      <button
                        type="button"
                        onClick={() => onDeleteExpense(exp.id)}
                        className="p-1 rounded-none text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
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
            <tfoot className="sticky bottom-0 z-10 bg-slate-100 border-t-2 border-slate-300 font-bold text-xs">
              <tr>
                <td className="py-3 px-4 text-slate-800 uppercase text-[11px] tracking-wider">
                  Total Expense ({expenses.length} Lines)
                </td>
                {/* Cash Total */}
                <td className="py-3 px-3 text-right font-mono text-rose-800 bg-rose-100/60 border-x border-rose-200">
                  {formatCurrency(totalCash)}
                </td>
                {/* GPay Total */}
                <td className="py-3 px-3 text-right font-mono text-slate-800">
                  {formatCurrency(totalGpay)}
                </td>
                {!isClosed && <td className="py-3 px-3" />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* By-category summary (mini report) */}
      {categorySummary.length > 0 && (
        <div className="px-3 py-2 border-t border-slate-200 bg-white">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">By Category</div>
          <div className="flex flex-wrap gap-1.5">
            {categorySummary.map(([cat, amt]) => (
              <span key={cat} className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-slate-700">
                {cat}: <span className="font-mono font-bold text-slate-900">{formatCurrency(amt)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Helper Footer */}
      <div className="p-3 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-500 flex items-center justify-between">
        <span>* Only Cash expenses reduce the drawer balance</span>
        <span className="font-bold text-red-700 font-mono">
          All Expenses Total: {formatCurrency(totalExpenses)}
        </span>
      </div>
    </div>
  );
};
