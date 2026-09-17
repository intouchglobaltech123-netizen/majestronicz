import React from 'react';
import {
  RecurringExpenseTemplate,
  BranchId,
  isExpenseDueInMonth,
  isExpenseApprovedForMonth,
  formatExpenseSchedule,
  getOrdinalSuffix,
} from '../../types';
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
  const monthNumber = parseInt(registerDate.split('-')[1], 10);
  const dayOfMonth = parseInt(registerDate.split('-')[2], 10);

  // Find scheduled amounts for this branch that are due in this month cycle and not yet approved
  const actionableExpenses = recurringExpenses.filter((template) => {
    if (template.branchId !== branchId) return false;
    if (!isExpenseDueInMonth(template, monthNumber)) return false;
    if (isExpenseApprovedForMonth(template, yearMonth)) return false;

    // Show if due today or overdue relative to the current register date
    return dayOfMonth >= template.dueDay;
  });

  if (actionableExpenses.length === 0) return null;

  return (
    <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
      {actionableExpenses.map((template) => {
        const isOverdue = dayOfMonth > template.dueDay;

        return (
          <div
            key={template.id}
            className={`p-4 sm:p-4.5 rounded-xl bg-white border border-slate-200 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all border-l-4 ${
              isOverdue ? 'border-l-rose-600' : 'border-l-amber-500'
            }`}
          >
            <div className="flex items-start gap-3.5 min-w-0">
              <div
                className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5 border ${
                  isOverdue
                    ? 'bg-rose-50 border-rose-100 text-rose-600'
                    : 'bg-amber-50 border-amber-100 text-amber-600'
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
                    className={`text-[11px] uppercase font-bold px-2.5 py-0.5 rounded-full border tracking-wider ${
                      isOverdue
                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                        : 'bg-amber-50 text-amber-700 border-amber-200'
                    }`}
                  >
                    {isOverdue ? 'Overdue Expense' : 'Due Today'}
                  </span>
                  <span className="font-mono text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                    {formatExpenseSchedule(template)}
                  </span>
                </div>

                <div className="text-xs sm:text-sm font-bold text-slate-900 mt-1 flex items-center gap-1.5 flex-wrap">
                  <span>{template.name}</span>
                  <span className="font-mono font-bold text-rose-600">
                    {formatCurrency(template.defaultAmount)}
                  </span>
                  <span className="text-xs font-medium text-slate-500">
                    {isOverdue
                      ? `— Overdue (was due on the ${template.dueDay}${getOrdinalSuffix(template.dueDay)})`
                      : '— Due today'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Default mode: <strong className="text-slate-700">{template.paymentMode}</strong> • Click Approve to confirm amount &amp; add to drawer.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
              {canManageItems && (
                <button
                  type="button"
                  onClick={() => onApprove(template)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold text-white transition-all shadow-xs flex items-center gap-1.5 ${
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
