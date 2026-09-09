import React, { useMemo } from 'react';
import { useErp } from '../../context/ErpContext';
import { BranchScope, BRANCHES, PurchaseOrderStatus } from '../../types';
import { exportToCsv } from '../../utils/csvExport';
import {
  ShoppingBag,
  Download,
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

      totalValueOrdered += po.totalAmount;

      // Calculate received value from line items
      let poReceivedVal = 0;
      po.items.forEach((item) => {
        const qtyReceived = item.receivedQuantity || 0;
        const lineReceived = qtyReceived * item.purchasePrice;
        poReceivedVal += lineReceived;
        totalValueReceived += lineReceived;
      });

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

  const handleExportCsv = () => {
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

    exportToCsv(filename, headers, rows);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner with CSV Action */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
        <div>
          <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-blue-600" />
            <span>Purchase Order Procurement Status</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Vendor supply status, goods inward progress, and delivery fulfillment monitoring
          </p>
        </div>

        <button
          onClick={handleExportCsv}
          disabled={filteredOrders.length === 0}
          className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-xs hover:shadow transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <Download className="h-4 w-4" />
          <span>Export PO CSV</span>
        </button>
      </div>

      {filteredOrders.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 shadow-2xs">
          <AlertCircle className="h-10 w-10 text-slate-300 mx-auto mb-2" />
          <h3 className="text-sm font-bold text-slate-700">No purchase orders found for this range</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            Try adjusting your date range or selecting a different branch to review purchase order records.
          </p>
        </div>
      ) : (
        <>
          {/* Summary Stat Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
            <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                Total Ordered Value
              </span>
              <p className="text-2xl font-extrabold text-slate-900 mt-1">
                ₹{metrics.totalValueOrdered.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </p>
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                {metrics.totalCount} orders placed
              </span>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 block">
                Goods Inward (Received)
              </span>
              <p className="text-2xl font-extrabold text-emerald-700 mt-1">
                ₹{metrics.totalValueReceived.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </p>
              <span className="text-[10px] text-emerald-600 mt-0.5 block">
                Stock received into warehouse
              </span>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700 block">
                Fulfillment Rate
              </span>
              <p className="text-2xl font-extrabold text-blue-700 mt-1">
                {metrics.completionRate.toFixed(1)}%
              </p>
              <span className="text-[10px] text-blue-600 mt-0.5 block">
                Received / Total Ordered Value
              </span>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-rose-700 block">
                Overdue Purchase Orders
              </span>
              <p className="text-2xl font-extrabold text-rose-700 mt-1">
                {metrics.overdueList.length}
              </p>
              <span className="text-[10px] text-rose-600 mt-0.5 block">
                Past expected delivery date
              </span>
            </div>
          </div>

          {/* Status Breakdown Grid */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <Clock className="h-4 w-4 text-blue-600" />
                <span>PO Status Distribution</span>
              </h3>
              <span className="text-[11px] text-slate-400 font-medium">Procurement funnel</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-xl bg-blue-50/60 border border-blue-200 space-y-1">
                <span className="text-[10px] font-bold uppercase text-blue-700">Ordered (Pending)</span>
                <div className="text-xl font-extrabold text-blue-900">{metrics.statusCounts.Ordered}</div>
                <span className="text-[10px] text-blue-600">Awaiting dispatch</span>
              </div>

              <div className="p-3.5 rounded-xl bg-amber-50/60 border border-amber-200 space-y-1">
                <span className="text-[10px] font-bold uppercase text-amber-700">Partially Received</span>
                <div className="text-xl font-extrabold text-amber-900">{metrics.statusCounts['Partially Received']}</div>
                <span className="text-[10px] text-amber-600">Partial shipment verified</span>
              </div>

              <div className="p-3.5 rounded-xl bg-emerald-50/60 border border-emerald-200 space-y-1">
                <span className="text-[10px] font-bold uppercase text-emerald-700">Fully Received</span>
                <div className="text-xl font-extrabold text-emerald-900">{metrics.statusCounts.Received}</div>
                <span className="text-[10px] text-emerald-600">Complete stock receipt</span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <span className="text-[10px] font-bold uppercase text-slate-500">Cancelled</span>
                <div className="text-xl font-extrabold text-slate-700">{metrics.statusCounts.Cancelled}</div>
                <span className="text-[10px] text-slate-400">Voided orders</span>
              </div>
            </div>
          </div>

          {/* Overdue Purchase Orders Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-rose-50/40 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-600" />
                <h3 className="text-xs font-bold text-rose-900 uppercase tracking-wider">
                  Overdue Purchase Orders ({metrics.overdueList.length})
                </h3>
              </div>
              <span className="text-[11px] text-rose-700 font-semibold">
                Urgent vendor follow-up required
              </span>
            </div>

            {metrics.overdueList.length === 0 ? (
              <div className="py-8 text-center text-slate-400 text-xs">
                <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-1.5" />
                <p className="font-bold text-slate-700">Zero Overdue Purchase Orders!</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  All active procurement is on schedule with agreed vendor delivery dates.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      <th className="py-3 px-4">PO Number</th>
                      <th className="py-3 px-3">Branch</th>
                      <th className="py-3 px-3">Vendor</th>
                      <th className="py-3 px-3 text-center">Expected Delivery</th>
                      <th className="py-3 px-3 text-center">Days Overdue</th>
                      <th className="py-3 px-4 text-right">Order Value (₹)</th>
                      <th className="py-3 px-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {metrics.overdueList.map((po) => {
                      const bObj = BRANCHES.find((b) => b.id === po.branchId);
                      const days = calculateDaysOverdue(po.expectedDeliveryDate || todayStr);

                      return (
                        <tr key={po.id} className="hover:bg-rose-50/20 transition-colors">
                          <td className="py-3 px-4">
                            <span className="font-mono font-bold text-blue-700">{po.poNumber}</span>
                            <span className="text-[10px] text-slate-400 block">{po.date}</span>
                          </td>
                          <td className="py-3 px-3 font-semibold text-slate-700">
                            {bObj?.name || po.branchId}
                          </td>
                          <td className="py-3 px-3 font-bold text-slate-900">{po.vendorName}</td>
                          <td className="py-3 px-3 text-center text-rose-700 font-bold">
                            <span className="inline-flex items-center gap-1">
                              <Calendar className="h-3 w-3 text-rose-500" />
                              {po.expectedDeliveryDate}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center">
                            <span className="font-extrabold px-2 py-0.5 rounded-full text-xs bg-rose-100 text-rose-800">
                              {days} {days === 1 ? 'day' : 'days'} late
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right font-extrabold text-slate-900">
                            ₹{po.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          </td>
                          <td className="py-3 px-3 text-center">
                            <span
                              className={cn(
                                'px-2 py-0.5 rounded-full text-[10px] font-bold border',
                                po.status === 'Partially Received'
                                  ? 'bg-amber-100 text-amber-800 border-amber-200'
                                  : 'bg-blue-100 text-blue-800 border-blue-200'
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
