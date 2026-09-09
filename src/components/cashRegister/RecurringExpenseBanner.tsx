import React from 'react';
import { RecurringExpenseTemplate, BranchId } from '../../types';
import { useErp } from '../../context/ErpContext';
import { formatCurrency } from '../../lib/utils';
import { AlertTriangle, Clock, CheckCircle2, ArrowRight } from 'lucide-react';

interface Props {
  branchId: BranchId;
  registerDate: string; // YYYY-MM-DD
  onApprove: (template: RecurringExpenseTemplate) => void;
}

export const RecurringExpenseBanner: React.FC<Props> = ({
  branchId,
  registerDate,
  onApprove,
}) => {
  const { recurringExpenses, canManageItems } = useErp();

  const yearMonth = registerDate.substring(0, 7); // e.g. "2026-09"
  const dayOfMonth = parseInt(registerDate.split('-')[2], 10);

  // Find recurring templates for this branch that are due today or overdue for this month and not yet approved
  const actionableExpenses = recurringExpenses.filter((template) => {
    if (template.branchId !== branchId) return false;

    // Check if already approved for this month
    const isApproved =
      template.lastApprovedMonth === yearMonth ||
      template.approvalHistory?.some((a) => a.month === yearMonth);
    if (isApproved) return false;

    // Show if due today or overdue relative to the current register date
    return dayOfMonth >= template.dueDay;
  });

  if (actionableExpenses.length === 0) return null;

  return (
    <div className="space-y-2.5 animate-in fade-in slide-in-from-top-2 duration-200">
      {actionableExpenses.map((template) => {
        const isOverdue = dayOfMonth > template.dueDay;

        return (
          <div
            key={template.id}
            className={`p-4 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs transition-all ${
              isOverdue
                ? 'bg-rose-50/90 border-rose-200 text-rose-950'
                : 'bg-amber-50/90 border-amber-200 text-amber-950'
            }`}
          >
            <div className="flex items-start gap-3 min-w-0">
              <div
                className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                  isOverdue
                    ? 'bg-rose-100 text-rose-700 border border-rose-200'
                    : 'bg-amber-100 text-amber-700 border border-amber-200'
                }`}
              >
                {isOverdue ? (
                  <AlertTriangle className="h-5 w-5" />
                ) : (
                  <Clock className="h-5 w-5" />
                )}
              </div>

              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-[10px] uppercase font-extrabold px-2 py-0.5 rounded-full border ${
                      isOverdue
                        ? 'bg-rose-100 text-rose-800 border-rose-300'
                        : 'bg-amber-100 text-amber-800 border-amber-300'
                    }`}
                  >
                    {isOverdue ? 'Overdue Expense' : 'Due Today'}
                  </span>
                  <span className="font-mono text-xs font-bold text-slate-700">
                    Day {template.dueDay} of month
                  </span>
                </div>

                <p className="text-xs font-bold text-slate-900 mt-1">
                  {template.name}{' '}
                  <span className="font-mono font-black text-slate-900">
                    {formatCurrency(template.defaultAmount)}
                  </span>{' '}
                  {isOverdue
                    ? `Overdue (was due on the ${template.dueDay}th) — Approve to add to today's expenses`
                    : "due today — Approve to add to today's expenses"}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Default mode: <strong>{template.paymentMode}</strong> • Click Approve to confirm amount & add to drawer.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
              {canManageItems && (
                <button
                  type="button"
                  onClick={() => onApprove(template)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold text-white transition-all shadow-xs flex items-center gap-1.5 ${
                    isOverdue
                      ? 'bg-rose-600 hover:bg-rose-700'
                      : 'bg-amber-600 hover:bg-amber-700'
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Approve Expense</span>
                  <ArrowRight className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
