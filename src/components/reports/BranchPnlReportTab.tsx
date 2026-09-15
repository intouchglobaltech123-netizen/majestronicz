import React, { useMemo } from 'react';
import { useErp } from '../../context/ErpContext';
import { BranchId, BranchScope, BRANCHES } from '../../types';
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
import { cn } from '../../lib/utils';

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
  const { invoices, cashRegisters } = useErp();

  // 1. Calculate P&L per Branch
  const pnlData = useMemo(() => {
    // Branch breakdown accumulator
    const branchStats: Record<
      BranchId,
      {
        totalSales: number;
        invoiceCount: number;
        totalExpenses: number;
        expenseCount: number;
        categoryExpenses: Record<string, number>;
      }
    > = {
      'erode-hq': { totalSales: 0, invoiceCount: 0, totalExpenses: 0, expenseCount: 0, categoryExpenses: {} },
      'coimbatore': { totalSales: 0, invoiceCount: 0, totalExpenses: 0, expenseCount: 0, categoryExpenses: {} },
      'chennai': { totalSales: 0, invoiceCount: 0, totalExpenses: 0, expenseCount: 0, categoryExpenses: {} },
    };

    // Aggregate Sales from Invoices (excluding voided sales)
    invoices.forEach((inv) => {
      if (inv.isVoided) return;
      if (startDate && inv.date < startDate) return;
      if (endDate && inv.date > endDate) return;
      if (branchStats[inv.branchId]) {
        const netSales = Math.max(0, inv.grandTotal - (inv.totalReturnedAmount || 0));
        branchStats[inv.branchId].totalSales += netSales;
        branchStats[inv.branchId].invoiceCount++;
      }
    });

    // Aggregate Operating Expenses from Daily Cash Registers
    cashRegisters.forEach((reg) => {
      if (startDate && reg.date < startDate) return;
      if (endDate && reg.date > endDate) return;
      if (branchStats[reg.branchId]) {
        reg.expenses.forEach((exp) => {
          const expAmt = (exp.cashAmount || 0) + (exp.gpayAmount || 0);
          branchStats[reg.branchId].totalExpenses += expAmt;
          branchStats[reg.branchId].expenseCount++;
          const cat = exp.reason || 'General Operating';
          branchStats[reg.branchId].categoryExpenses[cat] =
            (branchStats[reg.branchId].categoryExpenses[cat] || 0) + expAmt;
        });
      }
    });

    // Compute consolidated totals
    let consolidatedSales = 0;
    let consolidatedExpenses = 0;
    let consolidatedInvoices = 0;
    let consolidatedExpenseCount = 0;
    const consolidatedCategories: Record<string, number> = {};

    BRANCHES.forEach((b) => {
      const bStat = branchStats[b.id];
      consolidatedSales += bStat.totalSales;
      consolidatedExpenses += bStat.totalExpenses;
      consolidatedInvoices += bStat.invoiceCount;
      consolidatedExpenseCount += bStat.expenseCount;

      Object.entries(bStat.categoryExpenses).forEach(([cat, amt]) => {
        consolidatedCategories[cat] = (consolidatedCategories[cat] || 0) + amt;
      });
    });

    return {
      branchStats,
      consolidated: {
        totalSales: consolidatedSales,
        totalExpenses: consolidatedExpenses,
        netPosition: consolidatedSales - consolidatedExpenses,
        marginPct: consolidatedSales > 0 ? ((consolidatedSales - consolidatedExpenses) / consolidatedSales) * 100 : 0,
        invoiceCount: consolidatedInvoices,
        expenseCount: consolidatedExpenseCount,
        categoryExpenses: consolidatedCategories,
      },
    };
  }, [invoices, cashRegisters, startDate, endDate]);

  const displayedBranches = useMemo(() => {
    if (branchScope === 'all') return BRANCHES;
    return BRANCHES.filter((b) => b.id === branchScope);
  }, [branchScope]);

  const hasAnyActivity = pnlData.consolidated.totalSales > 0 || pnlData.consolidated.totalExpenses > 0;

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

    // Row 1: Total Sales
    rows.push([
      'Gross Sales (₹)',
      ...displayedBranches.map((b) => pnlData.branchStats[b.id].totalSales.toFixed(2)),
      ...(branchScope === 'all' ? [pnlData.consolidated.totalSales.toFixed(2)] : []),
    ]);

    // Row 2: Invoices count
    rows.push([
      'Invoice Count',
      ...displayedBranches.map((b) => pnlData.branchStats[b.id].invoiceCount),
      ...(branchScope === 'all' ? [pnlData.consolidated.invoiceCount] : []),
    ]);

    // Row 3: Total Expenses
    rows.push([
      'Operating Expenses (₹)',
      ...displayedBranches.map((b) => pnlData.branchStats[b.id].totalExpenses.toFixed(2)),
      ...(branchScope === 'all' ? [pnlData.consolidated.totalExpenses.toFixed(2)] : []),
    ]);

    // Row 4: Net Position
    rows.push([
      'Net Profit / Operating Position (₹)',
      ...displayedBranches.map((b) => {
        const net = pnlData.branchStats[b.id].totalSales - pnlData.branchStats[b.id].totalExpenses;
        return net.toFixed(2);
      }),
      ...(branchScope === 'all' ? [pnlData.consolidated.netPosition.toFixed(2)] : []),
    ]);

    // Row 5: Margin %
    rows.push([
      'Operating Margin (%)',
      ...displayedBranches.map((b) => {
        const sales = pnlData.branchStats[b.id].totalSales;
        const net = sales - pnlData.branchStats[b.id].totalExpenses;
        return sales > 0 ? `${((net / sales) * 100).toFixed(1)}%` : '0.0%';
      }),
      ...(branchScope === 'all' ? [`${pnlData.consolidated.marginPct.toFixed(1)}%`] : []),
    ]);

    // Detailed Expense Categories Section
    rows.push([]);
    rows.push(['--- EXPENSES BY CATEGORY ---']);
    const allCategories = new Set<string>();
    Object.values(pnlData.branchStats).forEach((b) => {
      Object.keys(b.categoryExpenses).forEach((cat) => allCategories.add(cat));
    });

    allCategories.forEach((cat) => {
      rows.push([
        cat,
        ...displayedBranches.map((b) => (pnlData.branchStats[b.id].categoryExpenses[cat] || 0).toFixed(2)),
        ...(branchScope === 'all' ? [(pnlData.consolidated.categoryExpenses[cat] || 0).toFixed(2)] : []),
      ]);
    });

    if (format === 'excel') exportToExcel(filename, headers, rows);

    else if (format === 'pdf') exportToPdf(filename, headers, rows, filename.replace(/[_-]+/g, ' ').replace(/\.csv$/i, '').trim());

    else exportToCsv(filename, headers, rows);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner with CSV Action */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
        <div>
          <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <PieChart className="h-5 w-5 text-blue-600" />
            <span>Branch-Wise Profit & Loss (P&L)</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Operating comparison of Sales vs Register Expenses for {startDate} to {endDate}
          </p>
        </div>

        <ReportExportButtons onExport={handleExport} />
      </div>

      {!hasAnyActivity ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 shadow-2xs">
          <AlertCircle className="h-10 w-10 text-slate-300 mx-auto mb-2" />
          <h3 className="text-sm font-bold text-slate-700">No transactions recorded for this period</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            Try adjusting your date range or selecting a different branch to inspect revenue and operational expense data.
          </p>
        </div>
      ) : (
        <>
          {/* Top Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-2xs">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
                Total Operating Sales
              </span>
              <p className="text-2xl font-extrabold text-blue-700 mt-1">
                ₹{pnlData.consolidated.totalSales.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </p>
              <span className="text-[11px] text-slate-400 mt-0.5 block">
                {pnlData.consolidated.invoiceCount} invoices billed
              </span>
            </div>

            <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-2xs">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
                Total Branch Expenses
              </span>
              <p className="text-2xl font-extrabold text-rose-700 mt-1">
                ₹{pnlData.consolidated.totalExpenses.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </p>
              <span className="text-[11px] text-slate-400 mt-0.5 block">
                {pnlData.consolidated.expenseCount} cash register expense entries
              </span>
            </div>

            <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-2xs">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
                Net Operating Position
              </span>
              <div className="flex items-baseline gap-2 mt-1">
                <p
                  className={cn(
                    'text-2xl font-extrabold',
                    pnlData.consolidated.netPosition >= 0 ? 'text-emerald-700' : 'text-rose-700'
                  )}
                >
                  ₹{pnlData.consolidated.netPosition.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </p>
                <span
                  className={cn(
                    'text-xs font-bold px-2 py-0.5 rounded-full',
                    pnlData.consolidated.netPosition >= 0
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-rose-100 text-rose-800'
                  )}
                >
                  {pnlData.consolidated.marginPct.toFixed(1)}% margin
                </span>
              </div>
              <span className="text-[11px] text-slate-400 mt-0.5 block">
                Gross sales minus register expenses
              </span>
            </div>
          </div>

          {/* Side-by-Side Multi-Branch P&L Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
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
                  {/* Gross Sales */}
                  <tr className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4 font-bold text-slate-800 flex items-center gap-2">
                      <TrendingUp className="h-3.5 w-3.5 text-blue-600" />
                      <span>Gross Sales Revenue</span>
                    </td>
                    {displayedBranches.map((b) => (
                      <td key={b.id} className="py-3.5 px-4 text-right font-extrabold text-blue-700">
                        ₹{pnlData.branchStats[b.id].totalSales.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </td>
                    ))}
                    {branchScope === 'all' && (
                      <td className="py-3.5 px-4 text-right font-extrabold text-blue-900 bg-blue-50/20 text-sm">
                        ₹{pnlData.consolidated.totalSales.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
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

                  {/* Operating Expenses */}
                  <tr className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4 font-bold text-slate-800 flex items-center gap-2">
                      <TrendingDown className="h-3.5 w-3.5 text-rose-600" />
                      <span>Total Operating Expenses</span>
                    </td>
                    {displayedBranches.map((b) => (
                      <td key={b.id} className="py-3.5 px-4 text-right font-extrabold text-rose-700">
                        ₹{pnlData.branchStats[b.id].totalExpenses.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </td>
                    ))}
                    {branchScope === 'all' && (
                      <td className="py-3.5 px-4 text-right font-extrabold text-rose-900 bg-blue-50/20 text-sm">
                        ₹{pnlData.consolidated.totalExpenses.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </td>
                    )}
                  </tr>

                  {/* Net Operating Position */}
                  <tr className="hover:bg-slate-50/80 transition-colors bg-slate-50/40 font-bold">
                    <td className="py-3.5 px-4 text-slate-900 font-extrabold">
                      Net Operating Position (Sales - Expenses)
                    </td>
                    {displayedBranches.map((b) => {
                      const net = pnlData.branchStats[b.id].totalSales - pnlData.branchStats[b.id].totalExpenses;
                      return (
                        <td
                          key={b.id}
                          className={cn(
                            'py-3.5 px-4 text-right font-extrabold',
                            net >= 0 ? 'text-emerald-700' : 'text-rose-700'
                          )}
                        >
                          ₹{net.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </td>
                      );
                    })}
                    {branchScope === 'all' && (
                      <td
                        className={cn(
                          'py-3.5 px-4 text-right font-black text-sm bg-blue-50/30',
                          pnlData.consolidated.netPosition >= 0 ? 'text-emerald-800' : 'text-rose-800'
                        )}
                      >
                        ₹{pnlData.consolidated.netPosition.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </td>
                    )}
                  </tr>

                  {/* Margin % */}
                  <tr className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2.5 px-4 font-semibold text-slate-700">Operating Margin %</td>
                    {displayedBranches.map((b) => {
                      const sales = pnlData.branchStats[b.id].totalSales;
                      const net = sales - pnlData.branchStats[b.id].totalExpenses;
                      const pct = sales > 0 ? (net / sales) * 100 : 0;
                      return (
                        <td key={b.id} className="py-2.5 px-4 text-right font-bold text-slate-800">
                          {pct.toFixed(1)}%
                        </td>
                      );
                    })}
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
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
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
                          ₹{amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
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
