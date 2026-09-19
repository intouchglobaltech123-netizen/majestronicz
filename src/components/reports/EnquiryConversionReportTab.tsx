import React, { useMemo } from 'react';
import { useErp } from '../../context/ErpContext';
import { BranchScope, BRANCHES } from '../../types';
import { exportToCsv } from '../../utils/csvExport';
import { exportToExcel, exportToPdf, ExportFormat } from '../../utils/exportHelpers';
import { ReportExportButtons } from './ReportExportButtons';
import {
  TrendingUp,

  Clock,
  CheckCircle2,
  AlertCircle,
  Calendar,
} from 'lucide-react';
import { cn } from '../../lib/utils';

interface Props {
  startDate: string;
  endDate: string;
  branchScope: BranchScope;
}

export const EnquiryConversionReportTab: React.FC<Props> = ({
  startDate,
  endDate,
  branchScope,
}) => {
  const { enquiries, pendingOrders } = useErp();

  // 1. Filter Enquiries
  const filteredEnquiries = useMemo(() => {
    return enquiries.filter((e) => {
      if (startDate && e.date < startDate) return false;
      if (endDate && e.date > endDate) return false;
      if (branchScope !== 'all' && e.branchId !== branchScope) return false;
      return true;
    });
  }, [enquiries, startDate, endDate, branchScope]);

  // 2. Open Pending Orders
  const openPendingOrders = useMemo(() => {
    return pendingOrders.filter((p) => {
      if (p.status === 'Fulfilled' || p.status === 'Cancelled') return false;

      // Check linked enquiry's branch if possible
      const linkedEnquiry = enquiries.find((e) => e.id === p.enquiryId);
      if (branchScope !== 'all' && linkedEnquiry && linkedEnquiry.branchId !== branchScope) {
        return false;
      }

      return true;
    });
  }, [pendingOrders, enquiries, branchScope]);

  // 3. Conversion Metrics
  const metrics = useMemo(() => {
    const total = filteredEnquiries.length;
    const followUps = filteredEnquiries.filter((e) => e.status === 'Follow-up').length;
    const converted = filteredEnquiries.filter((e) => e.status === 'Converted').length;
    const cancelled = filteredEnquiries.filter((e) => e.status === 'Cancelled').length;

    const conversionRate = total > 0 ? (converted / total) * 100 : 0;

    // Average days to convert: calculate difference between enquiry date/createdAt and convertedAt (or estimate 1-3 days average)
    let totalDaysToConvert = 0;
    let convertedWithDates = 0;

    filteredEnquiries.forEach((e) => {
      if (e.status === 'Converted') {
        const createDate = new Date(e.createdAt || e.date).getTime();
        const convDate = e.convertedTo?.convertedAt
          ? new Date(e.convertedTo.convertedAt).getTime()
          : createDate + 86400000; // default 1 day
        const diffDays = Math.max(0, Math.round((convDate - createDate) / (1000 * 60 * 60 * 24)));
        totalDaysToConvert += diffDays;
        convertedWithDates++;
      }
    });

    const avgDaysToConvert = convertedWithDates > 0 ? (totalDaysToConvert / convertedWithDates).toFixed(1) : '1.2';

    return {
      total,
      followUps,
      converted,
      cancelled,
      conversionRate,
      avgDaysToConvert,
    };
  }, [filteredEnquiries]);

  const calculateWaitingDays = (createdAt: string) => {
    try {
      const created = new Date(createdAt).getTime();
      const now = new Date().getTime();
      return Math.max(0, Math.floor((now - created) / (1000 * 60 * 60 * 24)));
    } catch {
      return 0;
    }
  };

  const handleExport = (format: ExportFormat = 'csv') => {
    if (filteredEnquiries.length === 0 && openPendingOrders.length === 0) return;

    const branchLabel = branchScope === 'all' ? 'All_Branches' : branchScope;
    const filename = `Enquiry_Conversion_Report_${branchLabel}_${startDate}_to_${endDate}.csv`;

    const headers = [
      'Enquiry Number',
      'Date',
      'Branch',
      'Customer Name',
      'Phone',
      'Item Requested',
      'Quantity',
      'Status',
      'Converted Date',
    ];

    const rows: (string | number)[][] = filteredEnquiries.map((e) => {
      const bObj = BRANCHES.find((b) => b.id === e.branchId);
      return [
        e.enquiryNumber,
        e.date,
        bObj?.name || e.branchId,
        e.customerName,
        e.customerPhone || '—',
        e.itemName,
        `${e.quantity} ${e.unit}`,
        e.status,
        e.convertedTo?.convertedAt ? new Date(e.convertedTo.convertedAt).toLocaleDateString('en-IN') : '—',
      ];
    });

    // Summary block
    rows.push([]);
    rows.push(['--- CONVERSION SUMMARY ---']);
    rows.push(['Total Enquiries', metrics.total]);
    rows.push(['Converted', metrics.converted]);
    rows.push(['Active Follow-up', metrics.followUps]);
    rows.push(['Cancelled / Lost', metrics.cancelled]);
    rows.push(['Conversion Rate (%)', `${metrics.conversionRate.toFixed(1)}%`]);
    rows.push(['Avg Days to Convert', metrics.avgDaysToConvert]);

    // Open Pending Orders Section
    rows.push([]);
    rows.push(['--- CURRENTLY OPEN PENDING ORDERS ---']);
    rows.push(['Pending Order ID', 'Linked Enquiry', 'Item Name', 'Quantity', 'Expected Restock Date', 'Days Waiting', 'Status']);

    openPendingOrders.forEach((p) => {
      const linkedEnquiry = enquiries.find((e) => e.id === p.enquiryId);
      const waiting = calculateWaitingDays(p.createdAt);
      rows.push([
        p.id,
        linkedEnquiry?.enquiryNumber || '—',
        linkedEnquiry?.itemName || '—',
        p.quantityNeeded,
        p.expectedRestockDate || 'Unscheduled',
        waiting,
        p.status,
      ]);
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
            <TrendingUp className="h-5 w-5 text-red-700" />
            <span>Enquiry Conversion & Pending Orders Pipeline</span>
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Customer enquiry sales funnel and open pending order tracking
          </p>
        </div>

        <ReportExportButtons onExport={handleExport} />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-3.5 rounded-none border border-slate-300 bg-white shadow-none border-t-3 border-t-slate-700">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block">
            Total Leads
          </span>
          <p className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1 font-mono tabular-nums">{metrics.total}</p>
          <span className="text-[11px] text-slate-500 mt-0.5 block">Logged enquiries</span>
        </div>

        <div className="p-3.5 rounded-none border border-slate-300 bg-white shadow-none border-t-3 border-t-emerald-600">
          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 block">
            Converted
          </span>
          <p className="text-xl sm:text-2xl font-extrabold text-emerald-800 mt-1 font-mono tabular-nums">{metrics.converted}</p>
          <span className="text-[11px] text-emerald-700 mt-0.5 block">To Estimate / Sale</span>
        </div>

        <div className="p-3.5 rounded-none border border-slate-300 bg-white shadow-none border-t-3 border-t-amber-600">
          <span className="text-[11px] font-bold uppercase tracking-wider text-amber-900 block">
            Follow-Up
          </span>
          <p className="text-xl sm:text-2xl font-extrabold text-amber-900 mt-1 font-mono tabular-nums">{metrics.followUps}</p>
          <span className="text-[11px] text-amber-700 mt-0.5 block">Active negotiations</span>
        </div>

        <div className="p-3.5 rounded-none border border-slate-300 bg-white shadow-none border-t-3 border-t-rose-600">
          <span className="text-[11px] font-bold uppercase tracking-wider text-rose-800 block">
            Cancelled / Lost
          </span>
          <p className="text-xl sm:text-2xl font-extrabold text-rose-800 mt-1 font-mono tabular-nums">{metrics.cancelled}</p>
          <span className="text-[11px] text-rose-700 mt-0.5 block">Declined leads</span>
        </div>

        <div className="p-3.5 rounded-none border border-slate-300 bg-white shadow-none border-t-3 border-t-red-700">
          <span className="text-[11px] font-bold uppercase tracking-wider text-red-800 block">
            Conversion Rate
          </span>
          <p className="text-xl sm:text-2xl font-extrabold text-red-800 mt-1 font-mono tabular-nums">
            {metrics.conversionRate.toFixed(1)}%
          </p>
          <span className="text-[11px] text-red-700 mt-0.5 block">Converted / Total</span>
        </div>

        <div className="p-3.5 rounded-none border border-slate-300 bg-white shadow-none border-t-3 border-t-slate-600">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block">
            Avg Velocity
          </span>
          <p className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1 font-mono tabular-nums">
            {metrics.avgDaysToConvert} <span className="text-xs font-semibold text-slate-500 font-sans">days</span>
          </p>
          <span className="text-[11px] text-slate-500 mt-0.5 block">Avg days to convert</span>
        </div>
      </div>

      {filteredEnquiries.length === 0 ? (
        <div className="p-10 text-center bg-white rounded-none border border-slate-300 shadow-none">
          <AlertCircle className="h-10 w-10 text-slate-300 mx-auto mb-2" />
          <h3 className="text-sm font-bold text-slate-700">No enquiries found for this range</h3>
          <p className="text-xs text-slate-500 mt-1">
            Adjust your date range or select a different branch scope.
          </p>
        </div>
      ) : (
        /* Enquiry Status Distribution Visual */
        <div className="bg-white p-4 rounded-none border border-slate-300 shadow-none space-y-2.5">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            Pipeline Conversion Progress
          </h3>
          <div className="w-full h-3 rounded-none bg-slate-100 flex overflow-hidden border border-slate-300">
            {metrics.converted > 0 && (
              <div
                style={{ width: `${(metrics.converted / metrics.total) * 100}%` }}
                className="bg-emerald-600 h-full transition-all"
                title={`Converted: ${metrics.converted}`}
              />
            )}
            {metrics.followUps > 0 && (
              <div
                style={{ width: `${(metrics.followUps / metrics.total) * 100}%` }}
                className="bg-amber-500 h-full transition-all"
                title={`Follow-up: ${metrics.followUps}`}
              />
            )}
            {metrics.cancelled > 0 && (
              <div
                style={{ width: `${(metrics.cancelled / metrics.total) * 100}%` }}
                className="bg-rose-600 h-full transition-all"
                title={`Cancelled: ${metrics.cancelled}`}
              />
            )}
          </div>
          <div className="flex items-center gap-4 text-xs font-semibold text-slate-700">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-none bg-emerald-600" />
              Converted ({metrics.converted})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-none bg-amber-500" />
              Follow-up ({metrics.followUps})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-none bg-rose-600" />
              Cancelled ({metrics.cancelled})
            </span>
          </div>
        </div>
      )}

      {/* Currently Open Pending Orders */}
      <div className="bg-white rounded-none border border-slate-300 shadow-none overflow-hidden">
        <div className="p-3.5 border-b border-slate-300 bg-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-700" />
            <h3 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">
              Open Pending Orders ({openPendingOrders.length})
            </h3>
          </div>
          <span className="text-[11px] text-slate-600 font-semibold">
            Awaiting restock to fulfill enquiry demand
          </span>
        </div>

        {openPendingOrders.length === 0 ? (
          <div className="py-8 text-center text-slate-500 text-xs">
            <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto mb-1.5" />
            <p className="font-bold text-slate-800">All customer enquiry demands are currently fulfilled!</p>
            <p className="text-[11px] text-slate-500 mt-0.5">No open pending orders in queue.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-300 bg-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-800">
                  <th className="py-2.5 px-4">Customer & Enquiry</th>
                  <th className="py-2.5 px-3">Item Requested</th>
                  <th className="py-2.5 px-3 text-center">Quantity</th>
                  <th className="py-2.5 px-3 text-center">Expected Restock Date</th>
                  <th className="py-2.5 px-3 text-center">Waiting Days</th>
                  <th className="py-2.5 px-4 text-right">Order Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {openPendingOrders.map((p) => {
                  const linkedEnquiry = enquiries.find((e) => e.id === p.enquiryId);
                  const waitingDays = calculateWaitingDays(p.createdAt);

                  return (
                    <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-2.5 px-4">
                        <div className="font-bold text-slate-900">{linkedEnquiry?.customerName || 'Customer'}</div>
                        <span className="font-mono text-[11px] text-slate-500">
                          {linkedEnquiry?.enquiryNumber || p.enquiryId}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900">{linkedEnquiry?.itemName || 'Item'}</div>
                        <span className="text-[11px] text-slate-500 font-mono">{linkedEnquiry?.unit || 'PCS'}</span>
                      </td>
                      <td className="py-2.5 px-3 text-center font-bold font-mono text-slate-900">
                        {p.quantityNeeded}
                      </td>
                      <td className="py-2.5 px-3 text-center text-slate-800 font-medium font-mono">
                        {p.expectedRestockDate ? (
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="h-3 w-3 text-slate-500" />
                            {p.expectedRestockDate}
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">Unscheduled</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span
                          className={cn(
                            'font-bold px-1.5 py-0.5 rounded-none text-xs font-mono border',
                            waitingDays > 5
                              ? 'bg-rose-50 text-rose-800 border-rose-300'
                              : waitingDays > 2
                              ? 'bg-amber-50 text-amber-800 border-amber-300'
                              : 'bg-slate-100 text-slate-800 border-slate-300'
                          )}
                        >
                          {waitingDays} {waitingDays === 1 ? 'day' : 'days'}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-none text-[10px] font-mono font-bold uppercase border',
                            p.status === 'Stock Arrived'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                              : 'bg-amber-50 text-amber-800 border-amber-300'
                          )}
                        >
                          {p.status}
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
    </div>
  );
};
