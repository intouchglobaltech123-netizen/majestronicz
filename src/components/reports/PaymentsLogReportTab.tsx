import React, { useMemo } from 'react';
import { useErp } from '../../context/ErpContext';
import { BranchScope, BRANCHES } from '../../types';
import { buildPaymentsLog } from '../../lib/paymentsLog';
import { formatCurrency, formatDate } from '../../lib/utils';
import { modeGroup } from '../../lib/paymentModes';
import { exportToCsv } from '../../utils/csvExport';
import { exportToExcel, exportToPdf, ExportFormat } from '../../utils/exportHelpers';
import { ReportExportButtons } from './ReportExportButtons';
import { ArrowDownCircle, ArrowUpCircle, Banknote } from 'lucide-react';

interface Props {
  startDate: string;
  endDate: string;
  branchScope: BranchScope;
}

/** Payments log: every rupee in (sales receipts, advances) and out (refunds, vendor payments, salaries, expenses). */
export const PaymentsLogReportTab: React.FC<Props> = ({ startDate, endDate, branchScope }) => {
  const { invoices, purchaseOrders, pendingOrders, cashRegisters, payments } = useErp();

  const rows = useMemo(
    () => buildPaymentsLog({ invoices, payments, purchaseOrders, pendingOrders, cashRegisters, startDate, endDate, branchScope }),
    [invoices, purchaseOrders, pendingOrders, cashRegisters, payments, startDate, endDate, branchScope],
  );

  const totals = useMemo(() => {
    const inTotal = rows.filter((r) => r.direction === 'IN').reduce((s, r) => s + r.amount, 0);
    const outTotal = rows.filter((r) => r.direction === 'OUT').reduce((s, r) => s + r.amount, 0);
    const byMode: Record<string, number> = {};
    // Grouped by where the money lands, the same groups as the Dashboard and the
    // Sales register (E2E5-3).
    rows.filter((r) => r.direction === 'IN').forEach((r) => { const g = modeGroup(r.mode); byMode[g] = (byMode[g] || 0) + r.amount; });
    return { inTotal, outTotal, net: inTotal - outTotal, byMode: Object.entries(byMode).sort((a, b) => b[1] - a[1]) };
  }, [rows]);

  const handleExport = (fmt: ExportFormat) => {
    const headers = ['Date', 'In/Out', 'Type', 'Party / Detail', 'Mode', 'Amount (Rs)', 'Reference', 'Branch'];
    const data = rows.map((r) => [
      r.date, r.direction, r.type, r.party, r.mode, Math.round(r.amount * 100) / 100, r.ref,
      BRANCHES.find((b) => b.id === r.branchId)?.name || r.branchId,
    ]);
    const name = `payments-log-${startDate}_to_${endDate}`;
    if (fmt === 'csv') exportToCsv(name, headers, data);
    else if (fmt === 'excel') exportToExcel(name, headers, data);
    else exportToPdf(name, headers, data, 'Payments Log');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <Banknote className="h-4 w-4 text-red-600" /> Payments Log
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">Every payment in (sales, receipts, advances) and out (refunds, vendor payments, salaries, expenses).</p>
        </div>
        <ReportExportButtons onExport={handleExport} disabled={rows.length === 0} />
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Money In', value: formatCurrency(totals.inTotal), tone: 'text-emerald-700' },
          { label: 'Money Out', value: formatCurrency(totals.outTotal), tone: 'text-rose-700' },
          { label: 'Net', value: formatCurrency(totals.net), tone: totals.net >= 0 ? 'text-emerald-700' : 'text-rose-700' },
          { label: 'Entries', value: String(rows.length), tone: 'text-slate-900' },
        ].map((m) => (
          <div key={m.label} className="bg-white border border-slate-300 p-3 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{m.label}</div>
            <div className={`text-lg font-bold font-mono mt-1 ${m.tone}`}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Money in by mode */}
      {totals.byMode.length > 0 && (
        <div className="bg-white border border-slate-300 p-3 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Money In by Mode</div>
          <div className="flex flex-wrap gap-2">
            {totals.byMode.map(([mode, amt]) => (
              <span key={mode} className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800">
                {mode}: <span className="font-mono font-bold">{formatCurrency(amt)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Log table */}
      <div className="bg-white border border-slate-300 shadow-xs overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse min-w-[760px]">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-bold uppercase text-[11px]">
              <th className="py-2.5 px-3">Date</th>
              <th className="py-2.5 px-3">In/Out</th>
              <th className="py-2.5 px-3">Type</th>
              <th className="py-2.5 px-3">Party / Detail</th>
              <th className="py-2.5 px-3">Mode</th>
              <th className="py-2.5 px-3 text-right">Amount</th>
              <th className="py-2.5 px-3">Reference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="py-8 text-center text-slate-400">No payments in this period.</td></tr>
            ) : rows.map((r, i) => (
              <tr key={i} className="hover:bg-slate-50/60">
                <td className="py-2 px-3 font-mono text-slate-500 whitespace-nowrap">{formatDate(r.date)}</td>
                <td className="py-2 px-3">
                  {r.direction === 'IN' ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 font-bold"><ArrowDownCircle className="h-3.5 w-3.5" /> IN</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-rose-700 font-bold"><ArrowUpCircle className="h-3.5 w-3.5" /> OUT</span>
                  )}
                </td>
                <td className="py-2 px-3 text-slate-600">{r.type}</td>
                <td className="py-2 px-3 text-slate-800">{r.party}</td>
                <td className="py-2 px-3"><span className="px-1.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-[11px] font-bold">{r.mode}</span></td>
                <td className={`py-2 px-3 text-right font-mono font-bold ${r.direction === 'IN' ? 'text-emerald-700' : 'text-rose-700'}`}>{formatCurrency(r.amount)}</td>
                <td className="py-2 px-3 font-mono text-slate-500">{r.ref || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
