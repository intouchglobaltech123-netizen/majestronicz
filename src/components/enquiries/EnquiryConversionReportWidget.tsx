import React from 'react';
import { Enquiry, PendingOrder } from '../../types';
import {
  TrendingUp,
  Clock,
  CheckCircle2,
  XCircle,
  PackageX,
} from 'lucide-react';

interface Props {
  enquiries: Enquiry[];
  pendingOrders: PendingOrder[];
}

export const EnquiryConversionReportWidget: React.FC<Props> = ({
  enquiries,
  pendingOrders,
}) => {
  const total = enquiries.length;
  const followUps = enquiries.filter((e) => e.status === 'Follow-up').length;
  const converted = enquiries.filter((e) => e.status === 'Converted').length;
  const cancelled = enquiries.filter((e) => e.status === 'Cancelled').length;

  // Conversion rate = converted / total enquiries (clear, standard definition).
  const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;

  const waitingOrders = pendingOrders.filter((p) => p.status === 'Waiting').length;
  const stockArrivedOrders = pendingOrders.filter((p) => p.status === 'Stock Arrived').length;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3 mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-blue-600" />
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
            Enquiry Conversion & Lead Pipeline
          </h2>
        </div>
        <span className="text-[11px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
          Executive Summary
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Total Enquiries */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
            Total Enquiries
          </span>
          <div className="text-lg sm:text-2xl lg:text-3xl font-bold font-mono text-slate-900">{total}</div>
          <span className="text-[11px] text-slate-400">All branches logged</span>
        </div>

        {/* Active Follow-ups */}
        <div className="p-3.5 rounded-xl bg-amber-50/60 border border-amber-200/80 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800 block">
              Follow-ups
            </span>
            <Clock className="h-3.5 w-3.5 text-amber-600" />
          </div>
          <div className="text-lg sm:text-2xl lg:text-3xl font-bold font-mono text-amber-900">{followUps}</div>
          <span className="text-[11px] text-amber-700 font-medium">Open buyer queries</span>
        </div>

        {/* Converted */}
        <div className="p-3.5 rounded-xl bg-emerald-50/60 border border-emerald-200/80 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 block">
              Converted
            </span>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          </div>
          <div className="text-lg sm:text-2xl lg:text-3xl font-bold font-mono text-emerald-900">{converted}</div>
          <span className="text-[11px] text-emerald-700 font-medium">Billed / Invoiced</span>
        </div>

        {/* Cancelled */}
        <div className="p-3.5 rounded-xl bg-rose-50/60 border border-rose-200/80 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-rose-800 block">
              Cancelled
            </span>
            <XCircle className="h-3.5 w-3.5 text-rose-600" />
          </div>
          <div className="text-lg sm:text-2xl lg:text-3xl font-bold font-mono text-rose-900">{cancelled}</div>
          <span className="text-[11px] text-rose-700 font-medium">Lost / Dropped</span>
        </div>

        {/* Conversion Rate */}
        <div className="p-3.5 rounded-xl bg-blue-50/60 border border-blue-200/80 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-blue-800 block">
              Conversion Rate
            </span>
            <TrendingUp className="h-3.5 w-3.5 text-blue-600" />
          </div>
          <div className="text-lg sm:text-2xl lg:text-3xl font-bold font-mono text-blue-900">{conversionRate}%</div>
          <div className="text-[11px] text-blue-700 font-semibold">{converted} converted / {total} enquiries</div>
          <div className="w-full bg-blue-200 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-blue-600 h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, conversionRate)}%` }}
            />
          </div>
        </div>

        {/* Pending Orders & Stock Arrived */}
        <div className="p-3.5 rounded-xl bg-purple-50/60 border border-purple-200/80 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-purple-800 block">
              Pending Orders
            </span>
            <PackageX className="h-3.5 w-3.5 text-purple-600" />
          </div>
          <div className="text-lg sm:text-2xl lg:text-3xl font-bold font-mono text-purple-900">
            {waitingOrders}
            {stockArrivedOrders > 0 && (
              <span className="text-xs font-bold text-emerald-700 ml-1.5 font-sans bg-emerald-100 px-1 rounded">
                +{stockArrivedOrders} Arrived
              </span>
            )}
          </div>
          <span className="text-[11px] text-purple-700 font-medium">Pending order log</span>
        </div>
      </div>
    </div>
  );
};
