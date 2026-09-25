import React, { useState } from 'react';
import { DailyCashRegister, Invoice, BranchId, BRANCHES } from '../../types';
import { formatCurrency } from '../../lib/utils';
import { X, History, Lock, Eye, Calendar } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  registers: DailyCashRegister[];
  invoices: Invoice[];
  onSelectDateAndBranch: (date: string, branchId: BranchId) => void;
}

export const DailyCashHistoryModal: React.FC<Props> = ({
  isOpen,
  onClose,
  registers,
  invoices,
  onSelectDateAndBranch,
}) => {
  const [filterBranch, setFilterBranch] = useState<string>('all');

  if (!isOpen) return null;

  // Filter only closed registers
  const closedRegisters = registers
    .filter((r) => r.isClosed && (filterBranch === 'all' || r.branchId === filterBranch))
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto">
      <div className="bg-white rounded-xl max-w-4xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700">
              <History className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Closed Registers Audit History</h3>
              <p className="text-[11px] text-slate-500">
                Log of past closed days, total sales, expenses, and physical drawer balances
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Branch Filter */}
            <select
              value={filterBranch}
              onChange={(e) => setFilterBranch(e.target.value)}
              className="text-xs bg-white border border-slate-300 rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="all">All Branches</option>
              {BRANCHES.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Table Content */}
        {closedRegisters.length === 0 ? (
          <div className="py-16 text-center">
            <Lock className="h-10 w-10 text-slate-300 mx-auto mb-2" />
            <h4 className="text-xs font-bold text-slate-700">No Closed Registers Found</h4>
            <p className="text-[11px] text-slate-400 max-w-sm mx-auto mt-1">
              Once you close a day's cash register using the "Close Day" button, it will be permanently archived in this audit log.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto flex-1 p-6">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase text-[11px] font-bold tracking-wider">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Branch</th>
                  <th className="py-3 px-3 text-right">Total Sale</th>
                  <th className="py-3 px-3 text-right">Total Expense</th>
                  <th className="py-3 px-3 text-right bg-blue-50/50 text-blue-900">
                    Closing Balance
                  </th>
                  <th className="py-3 px-4">Closed By</th>
                  <th className="py-3 px-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {closedRegisters.map((reg) => {
                  const branch = BRANCHES.find((b) => b.id === reg.branchId);

                  // Calculate total sales for that day (excluding voided sales)
                  const dayInvoices = invoices.filter(
                    (i) => i.branchId === reg.branchId && i.date === reg.date && !i.isVoided
                  );
                  const totalSale = dayInvoices.reduce(
                    (sum, i) => {
                      const amount = i.isPartialPayment && i.partialAmount ? i.partialAmount : i.grandTotal;
                      return sum + Math.max(0, amount - (i.totalReturnedAmount || 0));
                    },
                    0
                  );

                  // Calculate cash sales for closing balance formula
                  const cashSales = dayInvoices
                    .filter((i) => i.paymentMode === 'Cash')
                    .reduce(
                      (sum, i) => {
                        const amount = i.isPartialPayment && i.partialAmount ? i.partialAmount : i.grandTotal;
                        return sum + Math.max(0, amount - (i.totalReturnedAmount || 0));
                      },
                      0
                    );

                  // Total expenses
                  const totalExpense = reg.expenses.reduce(
                    (sum, e) => sum + (e.cashAmount || 0) + (e.gpayAmount || 0),
                    0
                  );
                  const cashExpense = reg.expenses.reduce((sum, e) => sum + (e.cashAmount || 0), 0);

                  const closing = reg.openingAmount + cashSales - cashExpense;

                  return (
                    <tr key={reg.id} className="hover:bg-slate-50/80 transition-colors">
                      {/* Date */}
                      <td className="py-3 px-4 font-mono font-bold text-slate-900">
                        <span className="inline-flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5 text-slate-400" />
                          <span>{reg.date}</span>
                        </span>
                      </td>

                      {/* Branch */}
                      <td className="py-3 px-4 text-slate-700">
                        <span className="font-semibold">{branch?.name}</span>
                        <span className="text-[11px] text-slate-400 block">
                          {branch?.shortCode}
                        </span>
                      </td>

                      {/* Total Sale */}
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                        {formatCurrency(totalSale)}
                        <span className="text-[11px] text-slate-400 block font-normal">
                          {dayInvoices.length} Bills
                        </span>
                      </td>

                      {/* Total Expense */}
                      <td className="py-3 px-3 text-right font-mono text-rose-700 font-semibold">
                        {formatCurrency(totalExpense)}
                        <span className="text-[11px] text-slate-400 block font-normal">
                          {reg.expenses.length} Lines
                        </span>
                      </td>

                      {/* Closing Balance */}
                      <td className="py-3 px-3 text-right font-mono font-extrabold text-blue-700 bg-blue-50/30">
                        {formatCurrency(closing)}
                        <span className="text-[11px] text-slate-500 block font-normal">
                          Drawer cash
                        </span>
                      </td>

                      {/* Closed By */}
                      <td className="py-3 px-4 text-slate-600">
                        <span className="font-medium text-slate-800 block">
                          {reg.closedBy || 'Admin'}
                        </span>
                        {reg.closedAt && (
                          <span className="text-[11px] text-slate-400">
                            {new Date(reg.closedAt).toLocaleTimeString('en-IN', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="py-3 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => {
                            onSelectDateAndBranch(reg.date, reg.branchId);
                            onClose();
                          }}
                          className="px-2.5 py-1 text-xs font-bold text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors inline-flex items-center gap-1 border border-blue-200"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>View</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 bg-slate-100 rounded-xl transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
