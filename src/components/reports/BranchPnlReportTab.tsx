import React, { useMemo } from 'react';
import { useErp } from '../../context/ErpContext';
import { BranchId, BranchScope, BRANCHES } from '../../types';
import { computeProfit, ProfitLine } from '../../lib/reportMath';
import { exportToCsv } from '../../utils/csvExport';
import { exportToExcel, exportToPdf, ExportFormat } from '../../utils/exportHelpers';
import { ReportExportButtons } from './ReportExportButtons';
import {
  PieChart,

  Building,
  TrendingUp,
  TrendingDown,
  WalletCards,
  AlertCircle,
} from 'lucide-react';
import { cn, formatCurrency, formatDate } from '../../lib/utils';

/** Whole rupees, Indian grouping, one sign style (FMT-1). */
const rs = (n: number) => formatCurrency(Math.round(n));

interface Props {
  startDate: string;
  endDate: string;
  branchScope: BranchScope;
}

export const BranchPnlReportTab: React.FC<Props> = ({
  startDate,
  endDate,
  branchScope,
}) => {
  const { invoices, cashRegisters, items, payments, payrollRecords, recurringExpenses } = useErp();

  // 1. P&L per branch — the ONE profit formula shared with the Dashboard
  // (src/lib/reportMath computeProfit): ex-GST revenue net of returns and bill
  // discount, cost of goods at the cost captured when sold, damaged returns
  // written off, approved operating expenses (never bank deposits) and payroll
  // paid in the period (E2E-8 / E2E5-5 / E2E5-12 / RPT2-4). The cards, the table
  // and the export all read these figures, for the selected branch (RPT-2).
  const pnlData = useMemo(() => {
    const inScope = (b: string) => branchScope === 'all' || b === branchScope;
    const { total, byBranch } = computeProfit({
      invoices, items, registers: cashRegisters, payments, payrollRecords, recurringTemplates: recurringExpenses, startDate, endDate, inScope,
    });
    const blank = (): ProfitLine => ({
      revenue: 0, cogs: 0, writeOff: 0, grossProfit: 0, expenses: 0, payroll: 0, netProfit: 0, invoiceCount: 0, expenseCount: 0, categoryExpenses: {},
    });
    const branchStats = Object.fromEntries(BRANCHES.map((b) => [b.id, byBranch[b.id] || blank()])) as Record<BranchId, ProfitLine>;
    return {
      branchStats,
      consolidated: {
        ...total,
        totalExpenses: total.expenses,
        marginPct: total.revenue > 0 ? (total.netProfit / total.revenue) * 100 : 0,
      },
    };
  }, [invoices, cashRegisters, items, payments, payrollRecords, recurringExpenses, startDate, endDate, branchScope]);

  const displayedBranches = useMemo(() => {
    if (branchScope === 'all') return BRANCHES;
    return BRANCHES.filter((b) => b.id === branchScope);
  }, [branchScope]);

  // Per-branch derived P&L lines (so the table/cards/CSV all agree).
  const branchPnl = (id: BranchId) => {
    const s = pnlData.branchStats[id];
    return {
      ...s,
      totalExpenses: s.expenses,
      marginPct: s.revenue > 0 ? (s.netProfit / s.revenue) * 100 : 0,
    };
  };

  const hasAnyActivity =
    pnlData.consolidated.revenue > 0 ||
    pnlData.consolidated.cogs > 0 ||
    pnlData.consolidated.totalExpenses > 0 ||
    pnlData.consolidated.payroll > 0;

  const handleExport = (format: ExportFormat = 'csv') => {
    if (!hasAnyActivity) return;

    const branchLabel = branchScope === 'all' ? 'All_Branches' : branchScope;
    const filename = `Branch_PnL_Report_${branchLabel}_${startDate}_to_${endDate}.csv`;

    const headers = [
      'Metric / Breakdown',
      ...displayedBranches.map((b) => `${b.name} (${b.shortCode})`),
      ...(branchScope === 'all' ? ['Consolidated Enterprise Total'] : []),
    ];

    const rows: (string | number)[][] = [];
    const cons = pnlData.consolidated;
    const money = (n: number) => Math.round(n * 100) / 100; // numbers stay numbers in Excel (RPT2-6)
    const line = (label: string, pick: (l: ProfitLine) => number) => rows.push([
      label,
      ...displayedBranches.map((b) => money(pick(pnlData.branchStats[b.id]))),
      ...(branchScope === 'all' ? [money(pick(cons))] : []),
    ]);

    line('Net Revenue ex-GST (Rs)', (l) => l.revenue);
    line('Invoice Count', (l) => l.invoiceCount);
    line('Cost of Goods Sold (Rs)', (l) => l.cogs);
    line('Damaged Goods Written Off (Rs)', (l) => l.writeOff);
    line('Gross Profit (Rs)', (l) => l.grossProfit);
    line('Operating Expenses (Rs)', (l) => l.expenses);
    line('Payroll Paid (Rs)', (l) => l.payroll);
    line('Net Profit (Rs)', (l) => l.netProfit);
    line('Net Margin (%)', (l) => (l.revenue > 0 ? (l.netProfit / l.revenue) * 100 : 0));

    // Detailed Expense Categories Section
    rows.push([]);
    rows.push(['--- EXPENSES BY CATEGORY ---']);
    const allCategories = new Set<string>();
    displayedBranches.forEach((b) => {
      Object.keys(pnlData.branchStats[b.id].categoryExpenses).forEach((cat) => allCategories.add(cat));
    });

    allCategories.forEach((cat) => {
      rows.push([
        cat,
        ...displayedBranches.map((b) => money(pnlData.branchStats[b.id].categoryExpenses[cat] || 0)),
        ...(branchScope === 'all' ? [money(pnlData.consolidated.categoryExpenses[cat] || 0)] : []),
      ]);
    });

    if (format === 'excel') exportToExcel(filename, headers, rows);

    else if (format === 'pdf') exportToPdf(filename, headers, rows, filename.replace(/[_-]+/g, ' ').replace(/\.csv$/i, '').trim());

    else exportToCsv(filename, headers, rows);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner with CSV Action */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
        <div>
          <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <PieChart className="h-5 w-5 text-blue-600" />
            <span>Branch-Wise Profit & Loss (P&L)</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Net revenue (ex-GST) − cost of goods sold − write-offs − operating expenses − payroll, {formatDate(startDate)} to {formatDate(endDate)}
          </p>
        </div>

        <ReportExportButtons onExport={handleExport} />
      </div>

      {!hasAnyActivity ? (
        <div className="p-12 text-center bg-white rounded-xl border border-slate-200 shadow-2xs">
          <AlertCircle className="h-10 w-10 text-slate-300 mx-auto mb-2" />
          <h3 className="text-sm font-bold text-slate-700">No transactions recorded for this period</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            Try adjusting your date range or selecting a different branch to inspect revenue and operational expense data.
          </p>
        </div>
      ) : (
        <>
          {/* Top Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-2xs">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
                Net Revenue (ex-GST)
              </span>
              <p className="text-xl sm:text-2xl font-extrabold text-blue-700 mt-1">
                {rs(pnlData.consolidated.revenue)}
              </p>
              <span className="text-[11px] text-slate-400 mt-0.5 block">
                {pnlData.consolidated.invoiceCount} invoices · net of GST &amp; returns
              </span>
            </div>

            <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-2xs">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
                Cost of Goods Sold
              </span>
              <p className="text-xl sm:text-2xl font-extrabold text-amber-700 mt-1">
                {rs(pnlData.consolidated.cogs)}
              </p>
              <span className="text-[11px] text-slate-400 mt-0.5 block">
                Gross profit {rs(pnlData.consolidated.grossProfit)}
              </span>
            </div>

            <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-2xs">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
                Operating Expenses
              </span>
              <p className="text-xl sm:text-2xl font-extrabold text-rose-700 mt-1">
                {rs(pnlData.consolidated.totalExpenses)}
              </p>
              <span className="text-[11px] text-slate-400 mt-0.5 block">
                {pnlData.consolidated.expenseCount} register entries · payroll paid {rs(pnlData.consolidated.payroll)}
              </span>
            </div>

            <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-2xs">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
                Net Profit
              </span>
              <div className="flex items-baseline gap-2 mt-1">
                <p
                  className={cn(
                    'text-xl sm:text-2xl font-extrabold',
                    pnlData.consolidated.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'
                  )}
                >
                  {rs(pnlData.consolidated.netProfit)}
                </p>
                <span
                  className={cn(
                    'text-xs font-bold px-2 py-0.5 rounded-full',
                    pnlData.consolidated.netProfit >= 0
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-rose-100 text-rose-800'
                  )}
                >
                  {pnlData.consolidated.marginPct.toFixed(1)}%
                </span>
              </div>
              <span className="text-[11px] text-slate-400 mt-0.5 block">
                Gross profit − expenses − payroll
              </span>
            </div>
          </div>

          {/* Side-by-Side Multi-Branch P&L Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building className="h-4 w-4 text-blue-600" />
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Branch Performance Comparison Matrix
                </h3>
              </div>
              <span className="text-[11px] text-slate-500 font-medium">All figures in INR (₹)</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="py-3 px-4">Financial Metric</th>
                    {displayedBranches.map((b) => (
                      <th key={b.id} className="py-3 px-4 text-right">
                        <div>{b.name}</div>
                        <span className="text-[11px] text-slate-400 font-normal">{b.location}</span>
                      </th>
                    ))}
                    {branchScope === 'all' && (
                      <th className="py-3 px-4 text-right bg-blue-50/50 text-blue-900 font-extrabold">
                        Consolidated Enterprise
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {/* Net Revenue (ex-GST) */}
                  <tr className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4 font-bold text-slate-800 flex items-center gap-2">
                      <TrendingUp className="h-3.5 w-3.5 text-blue-600" />
                      <span>Net Revenue (ex-GST)</span>
                    </td>
                    {displayedBranches.map((b) => (
                      <td key={b.id} className="py-3.5 px-4 text-right font-extrabold text-blue-700">
                        {rs(branchPnl(b.id).revenue)}
                      </td>
                    ))}
                    {branchScope === 'all' && (
                      <td className="py-3.5 px-4 text-right font-extrabold text-blue-900 bg-blue-50/20 text-sm">
                        {rs(pnlData.consolidated.revenue)}
                      </td>
                    )}
                  </tr>

                  {/* Billed Bills */}
                  <tr className="hover:bg-slate-50/80 transition-colors text-slate-600">
                    <td className="py-2.5 px-4 pl-8 text-[11px]">Billed Invoices Count</td>
                    {displayedBranches.map((b) => (
                      <td key={b.id} className="py-2.5 px-4 text-right text-[11px]">
                        {pnlData.branchStats[b.id].invoiceCount} bills
                      </td>
                    ))}
                    {branchScope === 'all' && (
                      <td className="py-2.5 px-4 text-right text-[11px] font-bold bg-blue-50/10">
                        {pnlData.consolidated.invoiceCount} bills
                      </td>
                    )}
                  </tr>

                  {/* Cost of Goods Sold */}
                  <tr className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4 font-bold text-slate-800 flex items-center gap-2">
                      <TrendingDown className="h-3.5 w-3.5 text-amber-600" />
                      <span>Cost of Goods Sold</span>
                    </td>
                    {displayedBranches.map((b) => (
                      <td key={b.id} className="py-3.5 px-4 text-right font-extrabold text-amber-700">
                        −{rs(branchPnl(b.id).cogs)}
                      </td>
                    ))}
                    {branchScope === 'all' && (
                      <td className="py-3.5 px-4 text-right font-extrabold text-amber-800 bg-blue-50/20 text-sm">
                        −{rs(pnlData.consolidated.cogs)}
                      </td>
                    )}
                  </tr>

                  {/* Damaged write-off: a damaged return is a loss, not recovered (E2E5-5) */}
                  <tr className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2.5 px-4 pl-8 text-[11px] font-semibold text-slate-700">Damaged Goods Written Off</td>
                    {displayedBranches.map((b) => (
                      <td key={b.id} className="py-2.5 px-4 text-right text-[11px] font-bold text-amber-700">
                        −{rs(branchPnl(b.id).writeOff)}
                      </td>
                    ))}
                    {branchScope === 'all' && (
                      <td className="py-2.5 px-4 text-right text-[11px] font-bold text-amber-800 bg-blue-50/10">
                        −{rs(pnlData.consolidated.writeOff)}
                      </td>
                    )}
                  </tr>

                  {/* Gross Profit */}
                  <tr className="hover:bg-slate-50/80 transition-colors text-slate-700">
                    <td className="py-2.5 px-4 pl-8 text-[11px] font-semibold">Gross Profit (Revenue − COGS − write-off)</td>
                    {displayedBranches.map((b) => (
                      <td key={b.id} className="py-2.5 px-4 text-right text-[11px] font-bold">
                        {rs(branchPnl(b.id).grossProfit)}
                      </td>
                    ))}
                    {branchScope === 'all' && (
                      <td className="py-2.5 px-4 text-right text-[11px] font-bold bg-blue-50/10">
                        {rs(pnlData.consolidated.grossProfit)}
                      </td>
                    )}
                  </tr>

                  {/* Operating Expenses */}
                  <tr className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4 font-bold text-slate-800 flex items-center gap-2">
                      <TrendingDown className="h-3.5 w-3.5 text-rose-600" />
                      <span>Operating Expenses</span>
                    </td>
                    {displayedBranches.map((b) => (
                      <td key={b.id} className="py-3.5 px-4 text-right font-extrabold text-rose-700">
                        −{rs(branchPnl(b.id).totalExpenses)}
                      </td>
                    ))}
                    {branchScope === 'all' && (
                      <td className="py-3.5 px-4 text-right font-extrabold text-rose-900 bg-blue-50/20 text-sm">
                        −{rs(pnlData.consolidated.totalExpenses)}
                      </td>
                    )}
                  </tr>

                  {/* Payroll paid in the period (E2E5-12) */}
                  <tr className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4 font-bold text-slate-800 flex items-center gap-2">
                      <TrendingDown className="h-3.5 w-3.5 text-rose-600" />
                      <span>Payroll Paid</span>
                    </td>
                    {displayedBranches.map((b) => (
                      <td key={b.id} className="py-3.5 px-4 text-right font-extrabold text-rose-700">
                        −{rs(branchPnl(b.id).payroll)}
                      </td>
                    ))}
                    {branchScope === 'all' && (
                      <td className="py-3.5 px-4 text-right font-extrabold text-rose-900 bg-blue-50/20 text-sm">
                        −{rs(pnlData.consolidated.payroll)}
                      </td>
                    )}
                  </tr>

                  {/* Net Profit */}
                  <tr className="hover:bg-slate-50/80 transition-colors bg-slate-50/40 font-bold">
                    <td className="py-3.5 px-4 text-slate-900 font-extrabold">
                      Net Profit (Gross Profit − Expenses − Payroll)
                    </td>
                    {displayedBranches.map((b) => {
                      const net = branchPnl(b.id).netProfit;
                      return (
                        <td
                          key={b.id}
                          className={cn(
                            'py-3.5 px-4 text-right font-extrabold',
                            net >= 0 ? 'text-emerald-700' : 'text-rose-700'
                          )}
                        >
                          {rs(net)}
                        </td>
                      );
                    })}
                    {branchScope === 'all' && (
                      <td
                        className={cn(
                          'py-3.5 px-4 text-right font-bold text-sm bg-blue-50/30',
                          pnlData.consolidated.netProfit >= 0 ? 'text-emerald-800' : 'text-rose-800'
                        )}
                      >
                        {rs(pnlData.consolidated.netProfit)}
                      </td>
                    )}
                  </tr>

                  {/* Margin % */}
                  <tr className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2.5 px-4 font-semibold text-slate-700">Net Margin %</td>
                    {displayedBranches.map((b) => (
                      <td key={b.id} className="py-2.5 px-4 text-right font-bold text-slate-800">
                        {branchPnl(b.id).marginPct.toFixed(1)}%
                      </td>
                    ))}
                    {branchScope === 'all' && (
                      <td className="py-2.5 px-4 text-right font-extrabold text-blue-900 bg-blue-50/20">
                        {pnlData.consolidated.marginPct.toFixed(1)}%
                      </td>
                    )}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Operating Expense Categories Breakdown */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <WalletCards className="h-4 w-4 text-blue-600" />
                <span>Operating Expense Breakdown by Category</span>
              </h3>
              <span className="text-[11px] text-slate-400 font-medium">Recorded via Daily Cash Register</span>
            </div>

            {Object.keys(pnlData.consolidated.categoryExpenses).length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">No categorized expenses recorded in this period.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Object.entries(pnlData.consolidated.categoryExpenses).map(([category, amount]) => {
                  const share =
                    pnlData.consolidated.totalExpenses > 0
                      ? (amount / pnlData.consolidated.totalExpenses) * 100
                      : 0;

                  return (
                    <div
                      key={category}
                      className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-800">{category}</span>
                        <span className="font-extrabold text-rose-700">
                          {rs(amount)}
                        </span>
                      </div>

                      <div className="w-full h-1.5 rounded-full bg-slate-200 overflow-hidden">
                        <div
                          className="h-full bg-rose-500 rounded-full"
                          style={{ width: `${Math.min(100, Math.max(0, share))}%` }}
                        />
                      </div>

                      <span className="text-[11px] text-slate-400 font-medium block">
                        {share.toFixed(1)}% of total operating expenses
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
