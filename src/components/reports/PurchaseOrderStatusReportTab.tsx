import React, { useMemo } from 'react';
import { useErp } from '../../context/ErpContext';
import { BranchScope, BRANCHES, PurchaseOrderStatus } from '../../types';
import { exportToCsv } from '../../utils/csvExport';
import { exportToExcel, exportToPdf, ExportFormat } from '../../utils/exportHelpers';
import { ReportExportButtons } from './ReportExportButtons';
import {
  ShoppingBag,

  AlertTriangle,
  CheckCircle2,
  Clock,
  Calendar,
  AlertCircle,
} from 'lucide-react';
import { cn } from '../../lib/utils';

interface Props {
  startDate: string;
  endDate: string;
  branchScope: BranchScope;
}

export const PurchaseOrderStatusReportTab: React.FC<Props> = ({
  startDate,
  endDate,
  branchScope,
}) => {
  const { purchaseOrders } = useErp();

  // Filter Purchase Orders
  const filteredOrders = useMemo(() => {
    return purchaseOrders.filter((po) => {
      if (startDate && po.date < startDate) return false;
      if (endDate && po.date > endDate) return false;
      if (branchScope !== 'all' && po.branchId !== branchScope) return false;
      return true;
    });
  }, [purchaseOrders, startDate, endDate, branchScope]);

  const todayStr = new Date().toISOString().split('T')[0];

  // Compute Metrics & Overdue List
  const metrics = useMemo(() => {
    const statusCounts: Record<PurchaseOrderStatus, number> = {
      Ordered: 0,
      'Partially Received': 0,
      Received: 0,
      Cancelled: 0,
    };

    let totalValueOrdered = 0;
    let totalValueReceived = 0;

    const overdueList: typeof filteredOrders = [];

    filteredOrders.forEach((po) => {
      if (statusCounts[po.status] !== undefined) {
        statusCounts[po.status]++;
      }

      // Cancelled orders still show in the status counts but must NOT inflate the
      // ordered/received value or the fulfillment denominator.
      const countsTowardValue = po.status !== 'Cancelled';
      if (countsTowardValue) totalValueOrdered += po.totalAmount;

      // Calculate received value from line items
      let poReceivedVal = 0;
      if (countsTowardValue) {
        po.items.forEach((item) => {
          const qtyReceived = item.receivedQuantity || 0;
          const lineReceived = qtyReceived * item.purchasePrice;
          poReceivedVal += lineReceived;
          totalValueReceived += lineReceived;
        });
      }

      // Check if overdue: expectedDeliveryDate < today and status is Ordered or Partially Received
      if (
        po.expectedDeliveryDate &&
        po.expectedDeliveryDate < todayStr &&
        (po.status === 'Ordered' || po.status === 'Partially Received')
      ) {
        overdueList.push(po);
      }
    });

    const completionRate =
      totalValueOrdered > 0 ? (totalValueReceived / totalValueOrdered) * 100 : 0;

    return {
      totalCount: filteredOrders.length,
      statusCounts,
      totalValueOrdered,
      totalValueReceived,
      completionRate,
      overdueList,
    };
  }, [filteredOrders, todayStr]);

  const calculateDaysOverdue = (expectedDate: string) => {
    try {
      const exp = new Date(expectedDate).getTime();
      const today = new Date().getTime();
      return Math.max(1, Math.floor((today - exp) / (1000 * 60 * 60 * 24)));
    } catch {
      return 1;
    }
  };

  const handleExport = (format: ExportFormat = 'csv') => {
    if (filteredOrders.length === 0) return;

    const branchLabel = branchScope === 'all' ? 'All_Branches' : branchScope;
    const filename = `Purchase_Order_Report_${branchLabel}_${startDate}_to_${endDate}.csv`;

    const headers = [
      'PO Number',
      'Date',
      'Branch',
      'Vendor Name',
      'Expected Delivery',
      'Total Amount (₹)',
      'Status',
      'Items Count',
      'Is Overdue',
    ];

    const rows = filteredOrders.map((po) => {
      const bObj = BRANCHES.find((b) => b.id === po.branchId);
      const isOverdue =
        po.expectedDeliveryDate &&
        po.expectedDeliveryDate < todayStr &&
        (po.status === 'Ordered' || po.status === 'Partially Received');

      return [
        po.poNumber,
        po.date,
        bObj?.name || po.branchId,
        po.vendorName,
        po.expectedDeliveryDate || '—',
        po.totalAmount.toFixed(2),
        po.status,
        po.items.length,
        isOverdue ? 'YES' : 'NO',
      ];
    });

    // Summary section
    rows.push([]);
    rows.push(['--- PO PERFORMANCE SUMMARY ---']);
    rows.push(['Total POs Placed', metrics.totalCount]);
    rows.push(['Total Value Ordered (₹)', metrics.totalValueOrdered.toFixed(2)]);
    rows.push(['Total Value Received (₹)', metrics.totalValueReceived.toFixed(2)]);
    rows.push(['Fulfillment Completion (%)', `${metrics.completionRate.toFixed(1)}%`]);
    rows.push(['Overdue POs Count', metrics.overdueList.length]);

    // Overdue details
    if (metrics.overdueList.length > 0) {
      rows.push([]);
      rows.push(['--- OVERDUE PURCHASE ORDERS ---']);
      rows.push(['PO Number', 'Vendor Name', 'Branch', 'Expected Delivery', 'Days Overdue', 'Total Value (₹)', 'Status']);
      metrics.overdueList.forEach((po) => {
        const bObj = BRANCHES.find((b) => b.id === po.branchId);
        const days = calculateDaysOverdue(po.expectedDeliveryDate || todayStr);
        rows.push([
          po.poNumber,
          po.vendorName,
          bObj?.name || po.branchId,
          po.expectedDeliveryDate,
          days,
          po.totalAmount.toFixed(2),
          po.status,
        ]);
      });
    }

    if (format === 'excel') exportToExcel(filename, headers, rows);

    else if (format === 'pdf') exportToPdf(filename, headers, rows, filename.replace(/[_-]+/g, ' ').replace(/\.csv$/i, '').trim());

    else exportToCsv(filename, headers, rows);
  };

  return (
    <div className="space-y-4">
      {/* Header Banner with CSV Action */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-4 rounded-none border border-slate-300 shadow-none">
        <div>
          <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-red-700" />
            <span>Purchase Order Procurement Status</span>
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Vendor supply status, goods inward progress, and delivery fulfillment monitoring
          </p>
        </div>

        <ReportExportButtons onExport={handleExport} />
      </div>

      {filteredOrders.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-none border border-slate-300 shadow-none">
          <AlertCircle className="h-10 w-10 text-slate-300 mx-auto mb-2" />
          <h3 className="text-sm font-bold text-slate-700">No purchase orders found for this range</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Try adjusting your date range or selecting a different branch to review purchase order records.
          </p>
        </div>
      ) : (
        <>
          {/* Summary Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-none border border-slate-300 bg-white shadow-none border-t-3 border-t-slate-700">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block">
                Total Ordered Value
              </span>
              <p className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1 font-mono tabular-nums">
                ₹{metrics.totalValueOrdered.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </p>
              <span className="text-[11px] text-slate-500 mt-0.5 block font-mono">
                {metrics.totalCount} orders placed
              </span>
            </div>

            <div className="p-3.5 rounded-none border border-slate-300 bg-white shadow-none border-t-3 border-t-emerald-600">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 block">
                Goods Inward (Received)
              </span>
              <p className="text-xl sm:text-2xl font-extrabold text-emerald-800 mt-1 font-mono tabular-nums">
                ₹{metrics.totalValueReceived.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </p>
              <span className="text-[11px] text-emerald-700 mt-0.5 block">
                Stock received into warehouse
              </span>
            </div>

            <div className="p-3.5 rounded-none border border-slate-300 bg-white shadow-none border-t-3 border-t-red-700">
              <span className="text-[11px] font-bold uppercase tracking-wider text-red-800 block">
                Fulfillment Rate
              </span>
              <p className="text-xl sm:text-2xl font-extrabold text-red-800 mt-1 font-mono tabular-nums">
                {metrics.completionRate.toFixed(1)}%
              </p>
              <span className="text-[11px] text-red-700 mt-0.5 block">
                Received / Total Ordered Value
              </span>
            </div>

            <div className="p-3.5 rounded-none border border-rose-300 bg-rose-50/50 shadow-none border-t-3 border-t-rose-600">
              <span className="text-[11px] font-bold uppercase tracking-wider text-rose-900 block">
                Overdue Purchase Orders
              </span>
              <p className="text-xl sm:text-2xl font-extrabold text-rose-900 mt-1 font-mono tabular-nums">
                {metrics.overdueList.length}
              </p>
              <span className="text-[11px] text-rose-800 mt-0.5 block">
                Past expected delivery date
              </span>
            </div>
          </div>

          {/* Status Breakdown Grid */}
          <div className="bg-white p-4 rounded-none border border-slate-300 shadow-none space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <Clock className="h-4 w-4 text-red-700" />
                <span>PO Status Distribution</span>
              </h3>
              <span className="text-[11px] text-slate-500 font-semibold">Procurement pipeline</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="p-3 rounded-none bg-slate-50 border border-slate-300 space-y-1">
                <span className="text-[11px] font-bold uppercase text-slate-700">Ordered (Pending)</span>
                <div className="text-xl font-extrabold text-slate-900 font-mono tabular-nums">{metrics.statusCounts.Ordered}</div>
                <span className="text-[11px] text-slate-500">Awaiting dispatch</span>
              </div>

              <div className="p-3 rounded-none bg-amber-50/60 border border-amber-300 space-y-1">
                <span className="text-[11px] font-bold uppercase text-amber-900">Partially Received</span>
                <div className="text-xl font-extrabold text-amber-950 font-mono tabular-nums">{metrics.statusCounts['Partially Received']}</div>
                <span className="text-[11px] text-amber-800">Partial shipment verified</span>
              </div>

              <div className="p-3 rounded-none bg-emerald-50/60 border border-emerald-300 space-y-1">
                <span className="text-[11px] font-bold uppercase text-emerald-900">Fully Received</span>
                <div className="text-xl font-extrabold text-emerald-950 font-mono tabular-nums">{metrics.statusCounts.Received}</div>
                <span className="text-[11px] text-emerald-800">Complete stock receipt</span>
              </div>

              <div className="p-3 rounded-none bg-slate-50 border border-slate-300 space-y-1">
                <span className="text-[11px] font-bold uppercase text-slate-600">Cancelled</span>
                <div className="text-xl font-extrabold text-slate-800 font-mono tabular-nums">{metrics.statusCounts.Cancelled}</div>
                <span className="text-[11px] text-slate-500">Voided orders</span>
              </div>
            </div>
          </div>

          {/* Overdue Purchase Orders Table */}
          <div className="bg-white rounded-none border border-slate-300 shadow-none overflow-hidden">
            <div className="p-3.5 border-b border-slate-300 bg-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-700" />
                <h3 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">
                  Overdue Purchase Orders ({metrics.overdueList.length})
                </h3>
              </div>
              <span className="text-[11px] text-rose-700 font-bold uppercase tracking-wider">
                Urgent vendor follow-up required
              </span>
            </div>

            {metrics.overdueList.length === 0 ? (
              <div className="py-8 text-center text-slate-500 text-xs">
                <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto mb-1.5" />
                <p className="font-bold text-slate-800">Zero Overdue Purchase Orders!</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  All active procurement is on schedule with agreed vendor delivery dates.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-300 bg-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-800">
                      <th className="py-2.5 px-4">PO Number</th>
                      <th className="py-2.5 px-3">Branch</th>
                      <th className="py-2.5 px-3">Vendor</th>
                      <th className="py-2.5 px-3 text-center">Expected Delivery</th>
                      <th className="py-2.5 px-3 text-center">Days Overdue</th>
                      <th className="py-2.5 px-4 text-right">Order Value (₹)</th>
                      <th className="py-2.5 px-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {metrics.overdueList.map((po) => {
                      const bObj = BRANCHES.find((b) => b.id === po.branchId);
                      const days = calculateDaysOverdue(po.expectedDeliveryDate || todayStr);

                      return (
                        <tr key={po.id} className="hover:bg-rose-50/30 transition-colors">
                          <td className="py-2.5 px-4">
                            <span className="font-mono font-bold text-red-800">{po.poNumber}</span>
                            <span className="text-[11px] text-slate-500 block font-mono">{po.date}</span>
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-slate-800">
                            {bObj?.name || po.branchId}
                          </td>
                          <td className="py-2.5 px-3 font-bold text-slate-900">{po.vendorName}</td>
                          <td className="py-2.5 px-3 text-center text-rose-800 font-bold font-mono">
                            <span className="inline-flex items-center gap-1">
                              <Calendar className="h-3 w-3 text-rose-600" />
                              {po.expectedDeliveryDate}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span className="font-extrabold px-1.5 py-0.5 rounded-none text-xs font-mono bg-rose-50 text-rose-800 border border-rose-300">
                              {days} {days === 1 ? 'day' : 'days'} late
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-right font-bold font-mono tabular-nums text-slate-900">
                            ₹{po.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span
                              className={cn(
                                'px-1.5 py-0.5 rounded-none text-[10px] font-bold uppercase font-mono border',
                                po.status === 'Partially Received'
                                  ? 'bg-amber-50 text-amber-800 border-amber-300'
                                  : 'bg-slate-100 text-slate-800 border-slate-300'
                              )}
                            >
                              {po.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
