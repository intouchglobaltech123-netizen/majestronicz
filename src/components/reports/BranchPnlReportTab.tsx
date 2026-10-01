import React, { useMemo } from 'react';
import { useErp } from '../../context/ErpContext';
import { BranchId, BranchScope, BRANCHES, expenseIsEffective, BANK_DEPOSIT_CATEGORY, computeInvoiceFinance, computeInvoiceCogs } from '../../types';
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
  const { invoices, cashRegisters, items } = useErp();

  // 1. Calculate P&L per Branch
  const pnlData = useMemo(() => {
    // Branch breakdown accumulator. A real P&L: Net Revenue (ex-GST, net of
    // returns) − Cost of Goods Sold = Gross Profit; − Operating Expenses = Net
    // Profit. Previously this showed GROSS, GST-inclusive sales minus register
    // expenses only (no COGS at all), so "profit" was overstated.
    const branchStats: Record<
      BranchId,
      {
        revenue: number;   // net revenue, ex-GST, net of returns
        cogs: number;      // cost of goods sold (combos expanded, pro-rated for returns)
        invoiceCount: number;
        totalExpenses: number;
        expenseCount: number;
        categoryExpenses: Record<string, number>;
      }
    > = {
      'erode-hq': { revenue: 0, cogs: 0, invoiceCount: 0, totalExpenses: 0, expenseCount: 0, categoryExpenses: {} },
      'coimbatore': { revenue: 0, cogs: 0, invoiceCount: 0, totalExpenses: 0, expenseCount: 0, categoryExpenses: {} },
      'chennai': { revenue: 0, cogs: 0, invoiceCount: 0, totalExpenses: 0, expenseCount: 0, categoryExpenses: {} },
    };

    // Aggregate Sales from Invoices (excluding voided sales)
    invoices.forEach((inv) => {
      if (inv.isVoided) return;
      if (startDate && inv.date < startDate) return;
      if (endDate && inv.date > endDate) return;
      if (branchStats[inv.branchId]) {
        // Revenue is the taxable value net of GST (a pass-through liability, not
        // profit) and net of returns; COGS via the shared helper (combos expanded).
        const fin = computeInvoiceFinance(inv);
        const grand = Number(inv.grandTotal) || 0;
        const ratio = grand > 0 ? fin.net / grand : 1;
        const exGstRevenue = Math.max(0, fin.net - (Number(inv.totalTax) || 0) * ratio);
        branchStats[inv.branchId].revenue += exGstRevenue;
        branchStats[inv.branchId].cogs += computeInvoiceCogs(inv, items);
        branchStats[inv.branchId].invoiceCount++;
      }
    });

    // Aggregate Operating Expenses from Daily Cash Registers
    cashRegisters.forEach((reg) => {
      if (startDate && reg.date < startDate) return;
      if (endDate && reg.date > endDate) return;
      if (branchStats[reg.branchId]) {
        reg.expenses.forEach((exp) => {
          // Only real, approved operating expenses count. Skip pending/rejected
          // entries and bank deposits — a deposit is a cash transfer, not an
          // expense (RPT2-4).
          if (!expenseIsEffective(exp)) return;
          if (exp.category === BANK_DEPOSIT_CATEGORY) return;
          const expAmt = (exp.cashAmount || 0) + (exp.gpayAmount || 0);
          branchStats[reg.branchId].totalExpenses += expAmt;
          branchStats[reg.branchId].expenseCount++;
          // Group by the structured category field (matching the Expense Report),
          // not the free-text reason, so the two reports agree (RPT-8).
          const cat = exp.category || 'Uncategorised';
          branchStats[reg.branchId].categoryExpenses[cat] =
            (branchStats[reg.branchId].categoryExpenses[cat] || 0) + expAmt;
        });
      }
    });

    // Compute consolidated totals
    let consolidatedRevenue = 0;
    let consolidatedCogs = 0;
    let consolidatedExpenses = 0;
    let consolidatedInvoices = 0;
    let consolidatedExpenseCount = 0;
    const consolidatedCategories: Record<string, number> = {};

    BRANCHES.forEach((b) => {
      const bStat = branchStats[b.id];
      consolidatedRevenue += bStat.revenue;
      consolidatedCogs += bStat.cogs;
      consolidatedExpenses += bStat.totalExpenses;
      consolidatedInvoices += bStat.invoiceCount;
      consolidatedExpenseCount += bStat.expenseCount;

      Object.entries(bStat.categoryExpenses).forEach(([cat, amt]) => {
        consolidatedCategories[cat] = (consolidatedCategories[cat] || 0) + amt;
      });
    });

    const consolidatedGrossProfit = consolidatedRevenue - consolidatedCogs;
    const consolidatedNetProfit = consolidatedGrossProfit - consolidatedExpenses;

    return {
      branchStats,
      consolidated: {
        revenue: consolidatedRevenue,
        cogs: consolidatedCogs,
        grossProfit: consolidatedGrossProfit,
        totalExpenses: consolidatedExpenses,
        netProfit: consolidatedNetProfit,
        marginPct: consolidatedRevenue > 0 ? (consolidatedNetProfit / consolidatedRevenue) * 100 : 0,
        invoiceCount: consolidatedInvoices,
        expenseCount: consolidatedExpenseCount,
        categoryExpenses: consolidatedCategories,
      },
    };
  }, [invoices, cashRegisters, items, startDate, endDate]);

  const displayedBranches = useMemo(() => {
    if (branchScope === 'all') return BRANCHES;
    return BRANCHES.filter((b) => b.id === branchScope);
  }, [branchScope]);

  // Per-branch derived P&L lines (so the table/cards/CSV all agree).
  const branchPnl = (id: BranchId) => {
    const s = pnlData.branchStats[id];
    const grossProfit = s.revenue - s.cogs;
    const netProfit = grossProfit - s.totalExpenses;
    return {
      revenue: s.revenue,
      cogs: s.cogs,
      grossProfit,
      totalExpenses: s.totalExpenses,
      netProfit,
      marginPct: s.revenue > 0 ? (netProfit / s.revenue) * 100 : 0,
    };
  };

  const hasAnyActivity =
    pnlData.consolidated.revenue > 0 ||
    pnlData.consolidated.cogs > 0 ||
    pnlData.consolidated.totalExpenses > 0;

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

    // Net Revenue (ex-GST, net of returns)
    rows.push([
      'Net Revenue ex-GST (₹)',
      ...displayedBranches.map((b) => branchPnl(b.id).revenue.toFixed(2)),
      ...(branchScope === 'all' ? [cons.revenue.toFixed(2)] : []),
    ]);

    // Invoices count
    rows.push([
      'Invoice Count',
      ...displayedBranches.map((b) => pnlData.branchStats[b.id].invoiceCount),
      ...(branchScope === 'all' ? [cons.invoiceCount] : []),
    ]);

    // Cost of Goods Sold
    rows.push([
      'Cost of Goods Sold (₹)',
      ...displayedBranches.map((b) => branchPnl(b.id).cogs.toFixed(2)),
      ...(branchScope === 'all' ? [cons.cogs.toFixed(2)] : []),
    ]);

    // Gross Profit
    rows.push([
      'Gross Profit (₹)',
      ...displayedBranches.map((b) => branchPnl(b.id).grossProfit.toFixed(2)),
      ...(branchScope === 'all' ? [cons.grossProfit.toFixed(2)] : []),
    ]);

    // Operating Expenses
    rows.push([
      'Operating Expenses (₹)',
      ...displayedBranches.map((b) => branchPnl(b.id).totalExpenses.toFixed(2)),
      ...(branchScope === 'all' ? [cons.totalExpenses.toFixed(2)] : []),
    ]);

    // Net Profit
    rows.push([
      'Net Profit (₹)',
      ...displayedBranches.map((b) => branchPnl(b.id).netProfit.toFixed(2)),
      ...(branchScope === 'all' ? [cons.netProfit.toFixed(2)] : []),
    ]);

    // Net Margin %
    rows.push([
      'Net Margin (%)',
      ...displayedBranches.map((b) => `${branchPnl(b.id).marginPct.toFixed(1)}%`),
      ...(branchScope === 'all' ? [`${cons.marginPct.toFixed(1)}%`] : []),
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
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
        <div>
          <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <PieChart className="h-5 w-5 text-blue-600" />
            <span>Branch-Wise Profit & Loss (P&L)</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Net revenue (ex-GST) − cost of goods sold − operating expenses, {startDate} to {endDate}
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
                ₹{pnlData.consolidated.revenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
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
                ₹{pnlData.consolidated.cogs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </p>
              <span className="text-[11px] text-slate-400 mt-0.5 block">
                Gross profit ₹{pnlData.consolidated.grossProfit.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </span>
            </div>

            <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-2xs">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
                Operating Expenses
              </span>
              <p className="text-xl sm:text-2xl font-extrabold text-rose-700 mt-1">
                ₹{pnlData.consolidated.totalExpenses.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </p>
              <span className="text-[11px] text-slate-400 mt-0.5 block">
                {pnlData.consolidated.expenseCount} register expense entries
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
                  ₹{pnlData.consolidated.netProfit.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
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
                Revenue − COGS − expenses
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
                        ₹{branchPnl(b.id).revenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </td>
                    ))}
                    {branchScope === 'all' && (
                      <td className="py-3.5 px-4 text-right font-extrabold text-blue-900 bg-blue-50/20 text-sm">
                        ₹{pnlData.consolidated.revenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
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
                        −₹{branchPnl(b.id).cogs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </td>
                    ))}
                    {branchScope === 'all' && (
                      <td className="py-3.5 px-4 text-right font-extrabold text-amber-800 bg-blue-50/20 text-sm">
                        −₹{pnlData.consolidated.cogs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </td>
                    )}
                  </tr>

                  {/* Gross Profit */}
                  <tr className="hover:bg-slate-50/80 transition-colors text-slate-700">
                    <td className="py-2.5 px-4 pl-8 text-[11px] font-semibold">Gross Profit (Revenue − COGS)</td>
                    {displayedBranches.map((b) => (
                      <td key={b.id} className="py-2.5 px-4 text-right text-[11px] font-bold">
                        ₹{branchPnl(b.id).grossProfit.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </td>
                    ))}
                    {branchScope === 'all' && (
                      <td className="py-2.5 px-4 text-right text-[11px] font-bold bg-blue-50/10">
                        ₹{pnlData.consolidated.grossProfit.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
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
                        −₹{branchPnl(b.id).totalExpenses.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </td>
                    ))}
                    {branchScope === 'all' && (
                      <td className="py-3.5 px-4 text-right font-extrabold text-rose-900 bg-blue-50/20 text-sm">
                        −₹{pnlData.consolidated.totalExpenses.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </td>
                    )}
                  </tr>

                  {/* Net Profit */}
                  <tr className="hover:bg-slate-50/80 transition-colors bg-slate-50/40 font-bold">
                    <td className="py-3.5 px-4 text-slate-900 font-extrabold">
                      Net Profit (Gross Profit − Expenses)
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
                          ₹{net.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
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
                        ₹{pnlData.consolidated.netProfit.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
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
