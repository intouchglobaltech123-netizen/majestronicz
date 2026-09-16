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
    <div className="space-y-6">
      {/* Top Header with CSV Action */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
        <div>
          <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-blue-600" />
            <span>Enquiry Conversion & Pending Orders Pipeline</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Customer enquiry sales funnel and open pending order tracking
          </p>
        </div>

        <ReportExportButtons onExport={handleExport} />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
            Total Leads
          </span>
          <p className="text-2xl font-extrabold text-slate-900 mt-1">{metrics.total}</p>
          <span className="text-[11px] text-slate-400 mt-0.5 block">Logged enquiries</span>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 block">
            Converted
          </span>
          <p className="text-2xl font-extrabold text-emerald-700 mt-1">{metrics.converted}</p>
          <span className="text-[11px] text-emerald-600 mt-0.5 block">To Estimate / Sale</span>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700 block">
            Follow-Up
          </span>
          <p className="text-2xl font-extrabold text-amber-700 mt-1">{metrics.followUps}</p>
          <span className="text-[11px] text-amber-600 mt-0.5 block">Active negotiations</span>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-rose-700 block">
            Cancelled / Lost
          </span>
          <p className="text-2xl font-extrabold text-rose-700 mt-1">{metrics.cancelled}</p>
          <span className="text-[11px] text-rose-600 mt-0.5 block">Declined leads</span>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700 block">
            Conversion Rate
          </span>
          <p className="text-2xl font-extrabold text-blue-700 mt-1">
            {metrics.conversionRate.toFixed(1)}%
          </p>
          <span className="text-[11px] text-blue-600 mt-0.5 block">Converted / Total</span>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-purple-700 block">
            Avg Velocity
          </span>
          <p className="text-2xl font-extrabold text-purple-700 mt-1">
            {metrics.avgDaysToConvert} <span className="text-xs font-medium text-slate-500">days</span>
          </p>
          <span className="text-[11px] text-purple-600 mt-0.5 block">Avg days to convert</span>
        </div>
      </div>

      {filteredEnquiries.length === 0 ? (
        <div className="p-10 text-center bg-white rounded-2xl border border-slate-200 shadow-2xs">
          <AlertCircle className="h-10 w-10 text-slate-300 mx-auto mb-2" />
          <h3 className="text-sm font-bold text-slate-700">No enquiries found for this range</h3>
          <p className="text-xs text-slate-400 mt-1">
            Adjust your date range or select a different branch scope.
          </p>
        </div>
      ) : (
        /* Enquiry Status Distribution Visual */
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            Pipeline Conversion Progress
          </h3>
          <div className="w-full h-3.5 rounded-full bg-slate-100 flex overflow-hidden">
            {metrics.converted > 0 && (
              <div
                style={{ width: `${(metrics.converted / metrics.total) * 100}%` }}
                className="bg-emerald-500 h-full transition-all"
                title={`Converted: ${metrics.converted}`}
              />
            )}
            {metrics.followUps > 0 && (
              <div
                style={{ width: `${(metrics.followUps / metrics.total) * 100}%` }}
                className="bg-amber-400 h-full transition-all"
                title={`Follow-up: ${metrics.followUps}`}
              />
            )}
            {metrics.cancelled > 0 && (
              <div
                style={{ width: `${(metrics.cancelled / metrics.total) * 100}%` }}
                className="bg-rose-400 h-full transition-all"
                title={`Cancelled: ${metrics.cancelled}`}
              />
            )}
          </div>
          <div className="flex items-center gap-4 text-xs font-semibold text-slate-600">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Converted ({metrics.converted})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              Follow-up ({metrics.followUps})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-rose-400" />
              Cancelled ({metrics.cancelled})
            </span>
          </div>
        </div>
      )}

      {/* Currently Open Pending Orders */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-600" />
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Open Pending Orders ({openPendingOrders.length})
            </h3>
          </div>
          <span className="text-[11px] text-slate-500">
            Awaiting restock to fulfill enquiry demand
          </span>
        </div>

        {openPendingOrders.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-xs">
            <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-1.5" />
            <p className="font-bold text-slate-700">All customer enquiry demands are currently fulfilled!</p>
            <p className="text-[11px] text-slate-400 mt-0.5">No open pending orders in queue.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="py-3 px-4">Customer & Enquiry</th>
                  <th className="py-3 px-3">Item Requested</th>
                  <th className="py-3 px-3 text-center">Quantity</th>
                  <th className="py-3 px-3 text-center">Expected Restock Date</th>
                  <th className="py-3 px-3 text-center">Waiting Days</th>
                  <th className="py-3 px-4 text-right">Order Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {openPendingOrders.map((p) => {
                  const linkedEnquiry = enquiries.find((e) => e.id === p.enquiryId);
                  const waitingDays = calculateWaitingDays(p.createdAt);

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{linkedEnquiry?.customerName || 'Customer'}</div>
                        <span className="font-mono text-[11px] text-slate-500">
                          {linkedEnquiry?.enquiryNumber || p.enquiryId}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-bold text-slate-900">{linkedEnquiry?.itemName || 'Item'}</div>
                        <span className="text-[11px] text-slate-400">{linkedEnquiry?.unit || 'PCS'}</span>
                      </td>
                      <td className="py-3 px-3 text-center font-extrabold text-blue-700">
                        {p.quantityNeeded}
                      </td>
                      <td className="py-3 px-3 text-center text-slate-700 font-semibold">
                        {p.expectedRestockDate ? (
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="h-3 w-3 text-slate-400" />
                            {p.expectedRestockDate}
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">Unscheduled</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span
                          className={cn(
                            'font-extrabold px-2 py-0.5 rounded-full text-xs',
                            waitingDays > 5
                              ? 'bg-rose-100 text-rose-800'
                              : waitingDays > 2
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-100 text-slate-700'
                          )}
                        >
                          {waitingDays} {waitingDays === 1 ? 'day' : 'days'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold',
                            p.status === 'Stock Arrived'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : 'bg-amber-100 text-amber-800 border border-amber-200'
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
