import React, { useMemo } from 'react';
import { useErp } from '../../context/ErpContext';
import { BranchScope, BRANCHES } from '../../types';
import { isOperatingExpense, makeExpenseCategoryOf, payrollPaymentRows } from '../../lib/reportMath';
import { modeGroup } from '../../lib/paymentModes';

const PAYROLL_CATEGORY = 'Payroll (salaries paid)';
import { formatCurrency, formatDate } from '../../lib/utils';
import { exportToCsv } from '../../utils/csvExport';
import { exportToExcel, exportToPdf, ExportFormat } from '../../utils/exportHelpers';
import { ReportExportButtons } from './ReportExportButtons';
import { Wallet, Paperclip } from 'lucide-react';

interface Props {
  startDate: string;
  endDate: string;
  branchScope: BranchScope;
}

/** Daily-expense report: every logged expense in range, with category + branch breakdowns. */
export const ExpenseReportTab: React.FC<Props> = ({ startDate, endDate, branchScope }) => {
  const { cashRegisters, recurringExpenses, payments, payrollRecords } = useErp();

  // The same expenses as the P&L (RPT2-4): approved register expenses (never
  // pending/rejected entries or bank deposits — a deposit moves cash to the bank,
  // it is not spent), categorised (rent posted from a recurring template takes
  // the template's category), plus payroll paid in the period (E2E5-12).
  const rowsData = useMemo(() => {
    const out: {
      date: string; branchId: string; category: string; reason: string;
      cash: number; gpay: number; total: number; by: string; hasBill: boolean;
    }[] = [];
    const inRange = (d: string) => (!startDate || d >= startDate) && (!endDate || d <= endDate);
    const inScope = (b: string) => branchScope === 'all' || b === branchScope;
    const categoryOf = makeExpenseCategoryOf(recurringExpenses);
    cashRegisters.forEach((reg) => {
      if (!inRange(reg.date) || !inScope(reg.branchId)) return;
      (reg.expenses || []).forEach((e) => {
        if (!isOperatingExpense(e)) return;
        const cash = e.cashAmount || 0;
        const gpay = e.gpayAmount || 0;
        out.push({
          date: reg.date, branchId: reg.branchId, category: categoryOf(e),
          reason: e.reason || '', cash, gpay, total: cash + gpay, by: e.createdBy || 'Staff',
          hasBill: !!e.billUrl,
        });
      });
    });
    for (const p of payrollPaymentRows(payments, payrollRecords, inRange, inScope)) {
      const isCash = modeGroup(p.mode) === 'Cash';
      out.push({
        date: p.date, branchId: p.branchId, category: PAYROLL_CATEGORY,
        reason: `Salary ${p.month ? `for ${p.month} ` : ''}— ${p.name} (${p.mode})`,
        cash: isCash ? p.amount : 0, gpay: isCash ? 0 : p.amount, total: p.amount, by: 'Payroll', hasBill: false,
      });
    }
    return out.sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [cashRegisters, recurringExpenses, payments, payrollRecords, startDate, endDate, branchScope]);

  const totals = useMemo(() => {
    const grand = rowsData.reduce((s, r) => s + r.total, 0);
    const cash = rowsData.reduce((s, r) => s + r.cash, 0);
    const gpay = rowsData.reduce((s, r) => s + r.gpay, 0);
    const payroll = rowsData.filter((r) => r.category === PAYROLL_CATEGORY).reduce((s, r) => s + r.total, 0);
    const byCat: Record<string, number> = {};
    rowsData.forEach((r) => { byCat[r.category] = (byCat[r.category] || 0) + r.total; });
    return { grand, cash, gpay, payroll, byCat: Object.entries(byCat).sort((a, b) => b[1] - a[1]) };
  }, [rowsData]);

  const handleExport = (fmt: ExportFormat) => {
    const headers = ['Date', 'Branch', 'Category', 'Description', 'Cash (Rs)', 'GPay / Bank (Rs)', 'Total (Rs)', 'By', 'Bill'];
    const money = (n: number) => Math.round(n * 100) / 100;
    const rows: (string | number)[][] = rowsData.map((r) => [
      r.date, BRANCHES.find((b) => b.id === r.branchId)?.name || r.branchId, r.category, r.reason,
      money(r.cash), money(r.gpay), money(r.total), r.by, r.hasBill ? 'Yes' : '',
    ]);
    rows.push(['TOTAL', '', '', `${rowsData.length} entries`, money(totals.cash), money(totals.gpay), money(totals.grand), '', '']);
    const name = `expense-report-${startDate}_to_${endDate}`;
    if (fmt === 'csv') exportToCsv(name, headers, rows);
    else if (fmt === 'excel') exportToExcel(name, headers, rows);
    else exportToPdf(name, headers, rows, 'Daily Expense Report');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-700 flex items-center gap-2">
          <Wallet className="h-4 w-4 text-red-600" /> Daily Expense Report
        </h3>
        <ReportExportButtons onExport={handleExport} disabled={rowsData.length === 0} />
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total (incl. payroll)', value: formatCurrency(totals.grand), tone: 'text-rose-700' },
          { label: 'Payroll paid', value: formatCurrency(totals.payroll), tone: 'text-rose-700' },
          { label: 'Cash', value: formatCurrency(totals.cash), tone: 'text-emerald-700' },
          { label: 'GPay / Bank', value: formatCurrency(totals.gpay), tone: 'text-blue-700' },
        ].map((m) => (
          <div key={m.label} className="bg-white border border-slate-300 p-3 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{m.label}</div>
            <div className={`text-lg font-bold font-mono mt-1 ${m.tone}`}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* By category */}
      {totals.byCat.length > 0 && (
        <div className="bg-white border border-slate-300 p-3 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">By Category</div>
          <div className="flex flex-wrap gap-2">
            {totals.byCat.map(([cat, amt]) => (
              <span key={cat} className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-50 border border-slate-200 text-slate-700">
                {cat}: <span className="font-mono font-bold text-slate-900">{formatCurrency(amt)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Entries table */}
      <div className="bg-white border border-slate-300 shadow-xs overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse min-w-[720px]">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-bold uppercase text-[11px]">
              <th className="py-2.5 px-3">Date</th>
              <th className="py-2.5 px-3">Branch</th>
              <th className="py-2.5 px-3">Category</th>
              <th className="py-2.5 px-3">Description</th>
              <th className="py-2.5 px-3 text-right">Cash</th>
              <th className="py-2.5 px-3 text-right">GPay / Bank</th>
              <th className="py-2.5 px-3 text-right">Total</th>
              <th className="py-2.5 px-3">By</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rowsData.length === 0 ? (
              <tr><td colSpan={8} className="py-8 text-center text-slate-400">No expenses in this period.</td></tr>
            ) : rowsData.map((r, i) => (
              <tr key={i} className="hover:bg-slate-50/60">
                <td className="py-2 px-3 font-mono text-slate-600 whitespace-nowrap">{formatDate(r.date)}</td>
                <td className="py-2 px-3">{BRANCHES.find((b) => b.id === r.branchId)?.shortCode || r.branchId}</td>
                <td className="py-2 px-3"><span className="px-1.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-[11px] font-bold">{r.category}</span></td>
                <td className="py-2 px-3 text-slate-700 flex items-center gap-1.5">{r.reason}{r.hasBill && <Paperclip className="h-3 w-3 text-blue-500" />}</td>
                <td className="py-2 px-3 text-right font-mono text-rose-700">{r.cash ? formatCurrency(r.cash) : '-'}</td>
                <td className="py-2 px-3 text-right font-mono text-slate-700">{r.gpay ? formatCurrency(r.gpay) : '-'}</td>
                <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">{formatCurrency(r.total)}</td>
                <td className="py-2 px-3 text-slate-500">{r.by}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
