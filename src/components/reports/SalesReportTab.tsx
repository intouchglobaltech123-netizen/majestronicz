import React, { useMemo, useState } from 'react';
import { useErp } from '../../context/ErpContext';
import { BranchScope, BRANCHES } from '../../types';
import { gstCollected, productSales } from '../../lib/reportMath';
import { collectionsByMode, MODE_GROUPS } from '../../lib/paymentModes';
import { exportToCsv } from '../../utils/csvExport';
import { exportToExcel, exportToPdf, ExportFormat } from '../../utils/exportHelpers';
import { ReportExportButtons } from './ReportExportButtons';
import { SALES_EXPORT_HEADERS, salesExportRows } from '../../lib/salesExport';
import {
  Receipt,

  CreditCard,
  Banknote,
  Smartphone,
  Truck,
  TrendingUp,
  AlertCircle,
  Award,
} from 'lucide-react';
import { cn, formatCurrency, formatDate } from '../../lib/utils';

/** Whole rupees, Indian grouping (FMT-1). */
const rs = (n: number) => formatCurrency(Math.round(n));

interface Props {
  startDate: string;
  endDate: string;
  branchScope: BranchScope;
}

export const SalesReportTab: React.FC<Props> = ({
  startDate,
  endDate,
  branchScope,
}) => {
  const { invoices } = useErp();
  const [topItemsMetric, setTopItemsMetric] = useState<'qty' | 'revenue'>('revenue');

  // Filter invoices by date range and branch scope
  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      // Exclude voided sales from reports
      if (inv.isVoided) return false;

      // Date filter (inclusive)
      if (startDate && inv.date < startDate) return false;
      if (endDate && inv.date > endDate) return false;

      // Branch filter
      if (branchScope !== 'all' && inv.branchId !== branchScope) return false;

      return true;
    });
  }, [invoices, startDate, endDate, branchScope]);

  // Aggregate Sales Metrics — through the shared report maths, so GST, product
  // figures and the payment-mode mix match the GST tab, the Reports header, the
  // Dashboard and the Payments Log (RPT5-1 / RPT8-1 / RPT-1 / RPT5-3 / SAL6-2).
  const { payments } = useErp();
  const summary = useMemo(() => {
    let totalGross = 0;
    let totalReturns = 0;
    let loyaltyRewardCount = 0;
    let loyaltyDiscountGivenTotal = 0;

    filteredInvoices.forEach((inv) => {
      totalGross += inv.grandTotal;
      totalReturns += inv.totalReturnedAmount || 0;
      if (inv.isLoyaltyRewardApplied) {
        loyaltyRewardCount++;
        loyaltyDiscountGivenTotal += (inv.loyaltyRewardDiscountAmount || inv.overallDiscountAmount || 0);
      }
    });

    // GST collected: net of returns and the bill discount, IGST included.
    const gst = gstCollected(filteredInvoices);
    // Money collected in the period by the mode it came in: bills' at-billing
    // splits plus receipts on their own date and mode.
    const inScope = (b: string) => branchScope === 'all' || b === branchScope;
    const inRange = (d: string) => (!startDate || d >= startDate) && (!endDate || d <= endDate);
    const modes = collectionsByMode(invoices, payments, inRange, inScope);
    // Units and revenue per product, net of returns and the bill discount.
    const allItems = productSales(filteredInvoices).filter((p) => p.quantity > 0.0005 || p.revenue > 0.005); // RPT9-3: fully returned items are not "top"
    const topByQty = [...allItems].sort((a, b) => b.quantity - a.quantity).slice(0, 10);
    const topByRevenue = [...allItems].sort((a, b) => b.revenue - a.revenue).slice(0, 10);

    return {
      totalGross,
      totalReturns,
      netSales: totalGross - totalReturns,
      gst,
      totalTax: gst.tax,
      loyaltyRewardCount,
      loyaltyDiscountGivenTotal,
      invoiceCount: filteredInvoices.length,
      averageInvoice: filteredInvoices.length > 0 ? totalGross / filteredInvoices.length : 0,
      modes,
      topByQty,
      topByRevenue,
    };
  }, [filteredInvoices, invoices, payments, branchScope, startDate, endDate]);

  const handleExport = (format: ExportFormat = 'csv') => {
    if (filteredInvoices.length === 0) return;

    const branchName = branchScope === 'all'
      ? 'All_Branches'
      : (BRANCHES.find((b) => b.id === branchScope)?.shortCode || branchScope);
    const filename = `Sales_Report_${branchName}_${startDate}_to_${endDate}.csv`;

    // One layout with the Sales list (SAL6-9 / RPT-4): status for every bill,
    // every payment mode of a split, discount, returns, net, received, due and a
    // totals row. Summary rows put the label in the first column and the figure
    // in the second, so nothing lands under an unrelated header (RPT4-7).
    const headers = SALES_EXPORT_HEADERS;
    const rows: (string | number)[][] = salesExportRows(
      [...filteredInvoices].sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.invoiceNumber || '').localeCompare(b.invoiceNumber || '')),
    );
    const money = (n: number) => Math.round(n * 100) / 100;

    rows.push([]);
    rows.push(['--- SUMMARY BREAKDOWN ---']);
    rows.push(['Total Invoices', summary.invoiceCount]);
    rows.push(['Total Gross Sales (Rs)', money(summary.totalGross)]);
    rows.push(['Less: Returns (Rs)', money(summary.totalReturns)]);
    rows.push(['Net Sales (Rs)', money(summary.netSales)]);
    rows.push(['GST Collected (Rs)', money(summary.gst.tax)]);
    rows.push(['  of which CGST (Rs)', money(summary.gst.cgst)]);
    rows.push(['  of which SGST (Rs)', money(summary.gst.sgst)]);
    rows.push(['  of which IGST (Rs)', money(summary.gst.igst)]);
    rows.push(['Average Invoice Value (Rs)', money(summary.averageInvoice)]);
    rows.push(['Loyalty Rewards Given (bills)', summary.loyaltyRewardCount]);
    rows.push(['Total Loyalty Discounts Waived (Rs)', money(summary.loyaltyDiscountGivenTotal)]);
    rows.push([]);
    rows.push(['--- MONEY COLLECTED BY MODE ---']);
    MODE_GROUPS.forEach((g) => { if (summary.modes.byGroup[g]) rows.push([g, money(summary.modes.byGroup[g])]); });
    rows.push(['Total collected (Rs)', money(summary.modes.total)]);
    rows.push(['Credit given at billing (Rs)', money(summary.modes.creditGiven)]);

    rows.push([]);
    rows.push(['--- TOP SELLING ITEMS & COMBOS ---']);
    rows.push(['Item / Combo Name', 'Item Code', 'Type', 'Units Sold (net)', 'Revenue (Rs, net)']);
    summary.topByRevenue.forEach((item) => {
      rows.push([item.itemName, item.itemCode, item.isCombo ? 'Combo' : 'Product', item.quantity, money(item.revenue)]);
    });

    if (format === 'excel') exportToExcel(filename, headers, rows);

    else if (format === 'pdf') exportToPdf(filename, headers, rows, filename.replace(/[_-]+/g, ' ').replace(/\.csv$/i, '').trim());

    else exportToCsv(filename, headers, rows);
  };

  return (
    <div className="space-y-4">
      {/* Top Header with CSV Action */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-4 rounded-none border border-slate-300 shadow-none">
        <div>
          <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <Receipt className="h-5 w-5 text-red-700" />
            <span>Sales & Revenue Summary</span>
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Aggregated from official Sales Invoices for the period {formatDate(startDate)} to {formatDate(endDate)}
          </p>
        </div>

        <ReportExportButtons onExport={handleExport} />
      </div>

      {filteredInvoices.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-none border border-slate-300 shadow-none">
          <AlertCircle className="h-10 w-10 text-slate-300 mx-auto mb-2" />
          <h3 className="text-sm font-bold text-slate-700">No sales invoices found for this range</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Try adjusting the date range or switching the branch filter to view invoice transactions.
          </p>
        </div>
      ) : (
        <>
          {/* Gross → Returns → Net reconciliation */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 rounded-none bg-slate-50 border border-slate-300 text-xs font-mono">
            <span className="font-sans text-[11px] font-bold uppercase tracking-wider text-slate-600">Sales reconciliation:</span>
            <span className="font-bold text-slate-900">{rs(summary.totalGross)}</span>
            <span className="font-sans text-[11px] text-slate-500">gross</span>
            <span className="text-rose-600 font-bold">−</span>
            <span className="font-bold text-rose-700">{rs(summary.totalReturns)}</span>
            <span className="font-sans text-[11px] text-slate-500">returns</span>
            <span className="text-slate-400 font-bold">=</span>
            <span className="font-bold text-emerald-800 bg-emerald-50 border border-emerald-300 px-2 py-0.5 rounded-none">{rs(summary.netSales)}</span>
            <span className="font-sans text-[11px] text-slate-500">net sales</span>
          </div>

          {/* KPI Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="p-3.5 rounded-none border border-slate-300 bg-white shadow-none border-t-3 border-t-red-700">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block">
                Total Revenue
              </span>
              <p className="text-xl sm:text-2xl font-extrabold text-red-800 mt-1 font-mono tabular-nums">
                {rs(summary.totalGross)}
              </p>
              <span className="text-[11px] text-slate-500 mt-0.5 block">
                Gross sales inclusive of tax
              </span>
            </div>

            <div className="p-3.5 rounded-none border border-slate-300 bg-white shadow-none border-t-3 border-t-slate-700">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block">
                Billed Invoices
              </span>
              <p className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1 font-mono tabular-nums">{summary.invoiceCount}</p>
              <span className="text-[11px] text-slate-500 mt-0.5 block">Completed sale records</span>
            </div>

            <div className="p-3.5 rounded-none border border-slate-300 bg-white shadow-none border-t-3 border-t-emerald-600">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block">
                Average Order Value
              </span>
              <p className="text-xl sm:text-2xl font-extrabold text-emerald-800 mt-1 font-mono tabular-nums">
                {rs(summary.averageInvoice)}
              </p>
              <span className="text-[11px] text-slate-500 mt-0.5 block">Average ticket size</span>
            </div>

            <div className="p-3.5 rounded-none border border-slate-300 bg-white shadow-none border-t-3 border-t-slate-600">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block">
                GST Tax Collected
              </span>
              <p className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1 font-mono tabular-nums">
                {rs(summary.totalTax)}
              </p>
              <span className="text-[11px] text-slate-500 mt-0.5 block">CGST + SGST + IGST, net of returns &amp; discounts</span>
            </div>

            {/* Loyalty Rewards Given */}
            <div className="p-3.5 rounded-none border border-amber-300 bg-amber-50/50 shadow-none border-t-3 border-t-amber-600">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-900 block">
                  Loyalty Rewards
                </span>
                <Award className="h-4 w-4 text-amber-600" />
              </div>
              <p className="text-xl sm:text-2xl font-extrabold text-amber-950 mt-1 font-mono tabular-nums">
                {summary.loyaltyRewardCount}{' '}
                <span className="text-xs text-amber-700 font-bold">bills</span>
              </p>
              <span className="text-[11px] text-amber-800 mt-0.5 block font-semibold">
                - {rs(summary.loyaltyDiscountGivenTotal)} waived
              </span>
            </div>
          </div>

          {/* Payment Mode Distribution */}
          <div className="bg-white p-4 rounded-none border border-slate-300 shadow-none space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-red-700" />
                <span>Money Collected by Mode</span>
              </h3>
              <span className="text-[11px] text-slate-500 font-semibold">Money collected: bills on their day + receipts by their own mode and date</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {[...MODE_GROUPS.filter((g) => g !== 'Store Credit' && (summary.modes.byGroup[g] > 0 || g !== 'Other')).map((g) => ({ label: g, amount: summary.modes.byGroup[g] })),
                { label: 'Credit given (owed)', amount: summary.modes.creditGiven }].map((m) => {
                const pct = summary.modes.total > 0 && !m.label.startsWith('Credit') ? (m.amount / summary.modes.total) * 100 : 0;
                return (
                  <div key={m.label} className="p-3 rounded-none bg-slate-50 border border-slate-300 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        {m.label === 'Cash' ? <Banknote className="h-4 w-4 text-emerald-600" />
                          : m.label === 'GPay / UPI' ? <Smartphone className="h-4 w-4 text-purple-600" />
                          : m.label.startsWith('Credit') ? <Truck className="h-4 w-4 text-amber-600" />
                          : <CreditCard className="h-4 w-4 text-blue-600" />}
                        <span className="text-xs font-bold text-slate-900">{m.label}</span>
                      </div>
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-base font-extrabold text-slate-900 font-mono tabular-nums">{rs(m.amount)}</span>
                      {!m.label.startsWith('Credit') && <span className="text-xs font-bold text-slate-600 font-mono">{pct.toFixed(1)}%</span>}
                    </div>
                    <div className="w-full h-1.5 rounded-none bg-slate-200 overflow-hidden">
                      <div className="h-full bg-red-700 rounded-none transition-all" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top 10 Selling Items Table */}
          <div className="bg-white rounded-none border border-slate-300 shadow-none overflow-hidden">
            <div className="p-3.5 border-b border-slate-300 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-50">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-red-700" />
                <h3 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">
                  Top 10 Selling Products
                </h3>
              </div>

              {/* Metric Toggle: By Revenue vs By Quantity */}
              <div className="flex flex-wrap items-center bg-white border border-slate-300 p-0.5 rounded-none text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setTopItemsMetric('revenue')}
                  className={cn(
                    'px-2.5 py-1 rounded-none transition-all cursor-pointer',
                    topItemsMetric === 'revenue'
                      ? 'bg-red-700 text-white shadow-none font-bold'
                      : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
                  )}
                >
                  By Revenue (₹)
                </button>
                <button
                  type="button"
                  onClick={() => setTopItemsMetric('qty')}
                  className={cn(
                    'px-2.5 py-1 rounded-none transition-all cursor-pointer',
                    topItemsMetric === 'qty'
                      ? 'bg-red-700 text-white shadow-none font-bold'
                      : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
                  )}
                >
                  By Quantity (Units)
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-300 bg-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-800">
                    <th className="py-2.5 px-4 w-12 text-center">#</th>
                    <th className="py-2.5 px-4">Item Name & Code</th>
                    <th className="py-2.5 px-4 text-right font-bold">Units Sold</th>
                    <th className="py-2.5 px-4 text-right font-bold">Total Revenue (₹)</th>
                    <th className="py-2.5 px-4 text-right font-bold">% of Gross Sales</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {(topItemsMetric === 'revenue' ? summary.topByRevenue : summary.topByQty).map(
                    (item, idx) => {
                      const share = summary.totalGross > 0 ? (item.revenue / summary.totalGross) * 100 : 0;
                      return (
                        <tr key={item.itemName + idx} className="hover:bg-slate-50 transition-colors">
                          <td className="py-2.5 px-4 text-center font-bold text-slate-500 font-mono">
                            {idx + 1}
                          </td>
                          <td className="py-2.5 px-4">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900">{item.itemName}</span>
                              {item.isCombo && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-none text-[10px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-300 uppercase">
                                  Combo
                                </span>
                              )}
                            </div>
                            <span className="font-mono text-[11px] text-slate-500">
                              {item.itemCode}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-right font-bold font-mono tabular-nums text-slate-900">
                            {item.quantity.toLocaleString('en-IN', { maximumFractionDigits: 3 })}
                          </td>
                          <td className="py-2.5 px-4 text-right font-bold font-mono tabular-nums text-slate-900">
                            {rs(item.revenue)}
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            <span className="inline-block px-1.5 py-0.5 rounded-none text-[11px] font-mono font-bold bg-slate-100 text-slate-800 border border-slate-300">
                              {share.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      );
                    }
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
