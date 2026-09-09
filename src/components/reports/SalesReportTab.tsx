import React, { useMemo, useState } from 'react';
import { useErp } from '../../context/ErpContext';
import { BranchScope, BRANCHES, PaymentMode } from '../../types';
import { exportToCsv } from '../../utils/csvExport';
import {
  Receipt,
  Download,
  CreditCard,
  Banknote,
  Smartphone,
  Truck,
  TrendingUp,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import { cn } from '../../lib/utils';

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

  // Aggregate Sales Metrics
  const summary = useMemo(() => {
    let totalGross = 0;
    let totalTaxable = 0;
    let totalTax = 0;
    let loyaltyRewardCount = 0;
    let loyaltyDiscountGivenTotal = 0;

    const paymentModes: Record<PaymentMode, { count: number; total: number }> = {
      HDFC: { count: 0, total: 0 },
      Cash: { count: 0, total: 0 },
      GPay: { count: 0, total: 0 },
      'COD-Credit': { count: 0, total: 0 },
    };

    // Item-level performance accumulator
    const itemMap = new Map<
      string,
      {
        itemId?: string;
        itemName: string;
        itemCode: string;
        isCombo?: boolean;
        quantity: number;
        revenue: number;
      }
    >();

    filteredInvoices.forEach((inv) => {
      totalGross += inv.grandTotal;
      totalTaxable += inv.subtotal;
      totalTax += inv.totalCgst + inv.totalSgst;

      if (inv.isLoyaltyRewardApplied) {
        loyaltyRewardCount++;
        loyaltyDiscountGivenTotal += (inv.loyaltyRewardDiscountAmount || inv.overallDiscountAmount || 0);
      }

      const mode = inv.paymentMode || 'Cash';
      if (paymentModes[mode]) {
        paymentModes[mode].count++;
        paymentModes[mode].total += inv.grandTotal;
      }

      // Tally line items
      inv.items.forEach((line) => {
        const isCombo = Boolean(line.isCombo || line.comboId);
        const key = line.itemId || line.comboId || line.itemName;
        const existing = itemMap.get(key);
        if (existing) {
          existing.quantity += line.quantity;
          existing.revenue += line.totalAmount;
          if (isCombo) existing.isCombo = true;
        } else {
          itemMap.set(key, {
            itemId: line.itemId || line.comboId,
            itemName: line.itemName,
            itemCode: line.itemCode || '—',
            isCombo,
            quantity: line.quantity,
            revenue: line.totalAmount,
          });
        }
      });
    });

    const allItems = Array.from(itemMap.values());
    const topByQty = [...allItems].sort((a, b) => b.quantity - a.quantity).slice(0, 10);
    const topByRevenue = [...allItems].sort((a, b) => b.revenue - a.revenue).slice(0, 10);

    return {
      totalGross,
      totalTaxable,
      totalTax,
      loyaltyRewardCount,
      loyaltyDiscountGivenTotal,
      invoiceCount: filteredInvoices.length,
      averageInvoice: filteredInvoices.length > 0 ? totalGross / filteredInvoices.length : 0,
      paymentModes,
      topByQty,
      topByRevenue,
    };
  }, [filteredInvoices]);

  const handleExportCsv = () => {
    if (filteredInvoices.length === 0) return;

    const branchName = branchScope === 'all'
      ? 'All_Branches'
      : (BRANCHES.find((b) => b.id === branchScope)?.shortCode || branchScope);
    const filename = `Sales_Report_${branchName}_${startDate}_to_${endDate}.csv`;

    const headers = [
      'Invoice Number',
      'Date',
      'Branch',
      'Customer Name',
      'Phone',
      'Payment Mode',
      'Subtotal (₹)',
      'CGST (₹)',
      'SGST (₹)',
      'Loyalty Reward Applied',
      'Loyalty Discount (₹)',
      'Total Amount (₹)',
      'Status',
    ];

    const rows: (string | number)[][] = filteredInvoices.map((inv) => {
      const bObj = BRANCHES.find((b) => b.id === inv.branchId);
      const discountGiven = inv.isLoyaltyRewardApplied
        ? (inv.loyaltyRewardDiscountAmount || inv.overallDiscountAmount || 0)
        : 0;
      return [
        inv.invoiceNumber,
        inv.date,
        bObj?.name || inv.branchId,
        inv.customerName,
        inv.customerPhone || '—',
        inv.paymentMode,
        inv.subtotal.toFixed(2),
        inv.totalCgst.toFixed(2),
        inv.totalSgst.toFixed(2),
        inv.isLoyaltyRewardApplied ? 'Yes' : 'No',
        discountGiven.toFixed(2),
        inv.grandTotal.toFixed(2),
        inv.isPartialPayment ? 'Partial Payment' : 'Fully Billed',
      ];
    });

    // Add empty row separator and Summary section
    rows.push([]);
    rows.push(['--- SUMMARY BREAKDOWN ---', '', '', '', '', '', '', '', '', '', '', '', '']);
    rows.push(['Total Invoices', summary.invoiceCount, '', '', '', '', '', '', '', '', '', '', '']);
    rows.push(['Total Gross Sales (₹)', summary.totalGross.toFixed(2), '', '', '', '', '', '', '', '', '', '', '']);
    rows.push(['Total Tax Collected (₹)', summary.totalTax.toFixed(2), '', '', '', '', '', '', '', '', '', '', '']);
    rows.push(['Average Invoice Value (₹)', summary.averageInvoice.toFixed(2), '', '', '', '', '', '', '', '', '', '', '']);
    rows.push(['Loyalty Rewards Given', `${summary.loyaltyRewardCount} bills`, '', '', '', '', '', '', '', '', '', '', '']);
    rows.push(['Total Loyalty Discounts Waived (₹)', summary.loyaltyDiscountGivenTotal.toFixed(2), '', '', '', '', '', '', '', '', '', '', '']);
    rows.push([]);
    rows.push(['--- PAYMENT MODE BREAKDOWN ---', '', '', '', '', '', '', '', '', '', '']);
    Object.entries(summary.paymentModes).forEach(([mode, data]) => {
      rows.push([
        mode,
        `${data.count} bills`,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        data.total.toFixed(2),
        '',
      ]);
    });

    rows.push([]);
    rows.push(['--- TOP SELLING ITEMS & COMBOS ---', '', '', '', '', '', '', '', '', '', '']);
    rows.push(['Item / Combo Name', 'Item Code', 'Type', 'Units Sold', 'Revenue (₹)', '', '', '', '', '', '']);
    summary.topByRevenue.forEach((item) => {
      rows.push([
        item.itemName,
        item.itemCode,
        item.isCombo ? 'Combo' : 'Product',
        item.quantity,
        item.revenue.toFixed(2),
        '',
        '',
        '',
        '',
        '',
        '',
      ]);
    });

    exportToCsv(filename, headers, rows);
  };

  const getModeIcon = (mode: PaymentMode) => {
    switch (mode) {
      case 'HDFC':
        return <CreditCard className="h-4 w-4 text-blue-600" />;
      case 'Cash':
        return <Banknote className="h-4 w-4 text-emerald-600" />;
      case 'GPay':
        return <Smartphone className="h-4 w-4 text-purple-600" />;
      case 'COD-Credit':
        return <Truck className="h-4 w-4 text-amber-600" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header with CSV Action */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
        <div>
          <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <Receipt className="h-5 w-5 text-blue-600" />
            <span>Sales & Revenue Summary</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Aggregated from official Sales Invoices for the period {startDate} to {endDate}
          </p>
        </div>

        <button
          onClick={handleExportCsv}
          disabled={filteredInvoices.length === 0}
          className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-xs hover:shadow transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <Download className="h-4 w-4" />
          <span>Export Sales CSV</span>
        </button>
      </div>

      {filteredInvoices.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 shadow-2xs">
          <AlertCircle className="h-10 w-10 text-slate-300 mx-auto mb-2" />
          <h3 className="text-sm font-bold text-slate-700">No sales invoices found for this range</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            Try adjusting the date range or switching the branch filter to view invoice transactions.
          </p>
        </div>
      ) : (
        <>
          {/* KPI Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
            <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                Total Revenue
              </span>
              <p className="text-2xl font-extrabold text-blue-700 mt-1">
                ₹{summary.totalGross.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </p>
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                Gross sales inclusive of tax
              </span>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                Billed Invoices
              </span>
              <p className="text-2xl font-extrabold text-slate-900 mt-1">{summary.invoiceCount}</p>
              <span className="text-[10px] text-slate-400 mt-0.5 block">Completed sale records</span>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                Average Order Value
              </span>
              <p className="text-2xl font-extrabold text-emerald-700 mt-1">
                ₹{summary.averageInvoice.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </p>
              <span className="text-[10px] text-slate-400 mt-0.5 block">Average ticket size</span>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                GST Tax Collected
              </span>
              <p className="text-2xl font-extrabold text-slate-800 mt-1">
                ₹{summary.totalTax.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </p>
              <span className="text-[10px] text-slate-400 mt-0.5 block">CGST + SGST remittance</span>
            </div>

            {/* Loyalty Rewards Given */}
            <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/40 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-900 block">
                  Loyalty Rewards
                </span>
                <Sparkles className="h-4 w-4 text-amber-600" />
              </div>
              <p className="text-2xl font-extrabold text-amber-950 mt-1">
                {summary.loyaltyRewardCount}{' '}
                <span className="text-xs text-amber-700 font-bold">bills</span>
              </p>
              <span className="text-[10px] text-amber-800 mt-0.5 block font-semibold">
                - ₹{summary.loyaltyDiscountGivenTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })} waived
              </span>
            </div>
          </div>

          {/* Payment Mode Distribution */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-blue-600" />
                <span>Payment Mode Breakdown</span>
              </h3>
              <span className="text-[11px] text-slate-400 font-medium">Reconciled to Cash Register</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {(['HDFC', 'Cash', 'GPay', 'COD-Credit'] as PaymentMode[]).map((mode) => {
                const data = summary.paymentModes[mode];
                const pct = summary.totalGross > 0 ? (data.total / summary.totalGross) * 100 : 0;

                return (
                  <div
                    key={mode}
                    className="p-4 rounded-xl bg-slate-50/70 border border-slate-200 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {getModeIcon(mode)}
                        <span className="text-xs font-bold text-slate-900">{mode}</span>
                      </div>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white text-slate-600 border border-slate-200">
                        {data.count} bills
                      </span>
                    </div>

                    <div className="flex items-baseline justify-between">
                      <span className="text-lg font-extrabold text-slate-900">
                        ₹{data.total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </span>
                      <span className="text-xs font-bold text-slate-500">{pct.toFixed(1)}%</span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full h-1.5 rounded-full bg-slate-200 overflow-hidden">
                      <div
                        className="h-full bg-blue-600 rounded-full transition-all"
                        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top 10 Selling Items Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-50/50">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-blue-600" />
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Top 10 Selling Products
                </h3>
              </div>

              {/* Metric Toggle: By Revenue vs By Quantity */}
              <div className="flex items-center bg-slate-100 p-1 rounded-xl text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setTopItemsMetric('revenue')}
                  className={cn(
                    'px-3 py-1 rounded-lg transition-all',
                    topItemsMetric === 'revenue'
                      ? 'bg-white text-blue-700 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  )}
                >
                  By Revenue (₹)
                </button>
                <button
                  type="button"
                  onClick={() => setTopItemsMetric('qty')}
                  className={cn(
                    'px-3 py-1 rounded-lg transition-all',
                    topItemsMetric === 'qty'
                      ? 'bg-white text-blue-700 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  )}
                >
                  By Quantity (Units)
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="py-3 px-4 w-12 text-center">#</th>
                    <th className="py-3 px-4">Item Name & Code</th>
                    <th className="py-3 px-4 text-right">Units Sold</th>
                    <th className="py-3 px-4 text-right">Total Revenue (₹)</th>
                    <th className="py-3 px-4 text-right">% of Gross Sales</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(topItemsMetric === 'revenue' ? summary.topByRevenue : summary.topByQty).map(
                    (item, idx) => {
                      const share = summary.totalGross > 0 ? (item.revenue / summary.totalGross) * 100 : 0;
                      return (
                        <tr key={item.itemName + idx} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-4 text-center font-bold text-slate-400">
                            {idx + 1}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900">{item.itemName}</span>
                              {item.isCombo && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                                  Combo
                                </span>
                              )}
                            </div>
                            <span className="font-mono text-[10px] text-slate-500">
                              {item.itemCode}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right font-extrabold text-slate-800">
                            {item.quantity.toLocaleString('en-IN')}
                          </td>
                          <td className="py-3 px-4 text-right font-extrabold text-blue-700">
                            ₹{item.revenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
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
