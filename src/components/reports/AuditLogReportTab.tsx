import React, { useMemo } from 'react';
import { useErp } from '../../context/ErpContext';
import { BranchScope, BRANCHES } from '../../types';
import { exportToCsv } from '../../utils/csvExport';
import { exportToExcel, exportToPdf, ExportFormat } from '../../utils/exportHelpers';
import { ReportExportButtons } from './ReportExportButtons';
import { History } from 'lucide-react';

interface Props {
  startDate: string;
  endDate: string;
  branchScope: BranchScope;
}

type AuditEvent = {
  ts: string; // ISO timestamp
  date: string; // YYYY-MM-DD
  actor: string;
  module: string;
  action: string;
  details: string;
  branchId: string;
};

const MODULE_TONE: Record<string, string> = {
  Sales: 'bg-red-50 text-red-700 border-red-200',
  Purchase: 'bg-amber-50 text-amber-700 border-amber-200',
  Inventory: 'bg-blue-50 text-blue-700 border-blue-200',
  Expense: 'bg-violet-50 text-violet-700 border-violet-200',
  QC: 'bg-rose-50 text-rose-700 border-rose-200',
};

/** Full audit trail: who did what, when — aggregated across sales, purchase, stock & expenses. */
export const AuditLogReportTab: React.FC<Props> = ({ startDate, endDate, branchScope }) => {
  const { invoices, purchaseOrders, stockAdjustmentLogs, cashRegisters } = useErp();

  const events = useMemo(() => {
    const out: AuditEvent[] = [];
    const dayOf = (iso: string) => (iso || '').slice(0, 10);

    // Sales invoices (created + voided)
    invoices.forEach((inv: any) => {
      const ts = inv.createdAt || `${inv.date}T${inv.time || '00:00'}:00`;
      out.push({
        ts, date: inv.date, actor: inv.salespersonName || inv.createdBy || 'Billing',
        module: 'Sales', action: 'Invoice created',
        details: `${inv.invoiceNumber} · ${inv.customerName} · ₹${(inv.grandTotal || 0).toLocaleString('en-IN')}`,
        branchId: inv.branchId,
      });
      if (inv.isVoided && inv.voidedAt) {
        out.push({
          ts: inv.voidedAt, date: dayOf(inv.voidedAt), actor: inv.voidedBy || 'Staff',
          module: 'Sales', action: 'Invoice VOIDED',
          details: `${inv.invoiceNumber}${inv.voidReason ? ` · ${inv.voidReason}` : ''}`,
          branchId: inv.branchId,
        });
      }
    });

    // Purchase orders — created, receiving events, debit notes
    purchaseOrders.forEach((po: any) => {
      out.push({
        ts: po.createdAt || `${po.date}T00:00:00`, date: po.date, actor: 'Purchase Desk',
        module: 'Purchase', action: 'PO issued',
        details: `${po.poNumber} · ${po.vendorName} · ₹${(po.totalAmount || 0).toLocaleString('en-IN')}`,
        branchId: po.branchId,
      });
      (po.receivingHistory || []).forEach((ev: any) => {
        const units = (ev.lines || []).reduce((s: number, l: any) => s + (l.quantityReceivedThisEvent || 0), 0);
        out.push({
          ts: ev.timestamp || `${ev.date}T00:00:00`, date: ev.date, actor: ev.receivedBy || 'Staff',
          module: 'Purchase', action: 'Stock received',
          details: `${po.poNumber} · ${units} unit(s) inwarded`,
          branchId: po.branchId,
        });
      });
      (po.debitNotes || []).forEach((dn: any) => {
        out.push({
          ts: `${dn.date}T00:00:00`, date: dn.date, actor: dn.createdBy || 'Staff',
          module: 'QC', action: 'Debit note raised',
          details: `${dn.noteNumber} · damaged goods · ₹${(dn.totalAmount || 0).toLocaleString('en-IN')}`,
          branchId: po.branchId,
        });
      });
    });

    // Stock adjustments
    (stockAdjustmentLogs || []).forEach((log: any) => {
      out.push({
        ts: log.timestamp, date: dayOf(log.timestamp), actor: log.adjustedBy || 'Staff',
        module: 'Inventory', action: `Stock ${log.quantityChange >= 0 ? '+' : ''}${log.quantityChange}`,
        details: `${log.itemName} (${log.itemCode}) · ${log.reason}${log.notes ? ` · ${log.notes}` : ''}`,
        branchId: log.branchId,
      });
    });

    // Expenses
    cashRegisters.forEach((reg: any) => {
      (reg.expenses || []).forEach((e: any) => {
        out.push({
          ts: e.createdAt || `${reg.date}T00:00:00`, date: reg.date, actor: e.createdBy || 'Staff',
          module: 'Expense', action: 'Expense logged',
          details: `${e.category ? `[${e.category}] ` : ''}${e.reason} · ₹${((e.cashAmount || 0) + (e.gpayAmount || 0)).toLocaleString('en-IN')}`,
          branchId: reg.branchId,
        });
      });
    });

    return out
      .filter((e) => {
        if (startDate && e.date < startDate) return false;
        if (endDate && e.date > endDate) return false;
        if (branchScope !== 'all' && e.branchId !== branchScope) return false;
        return true;
      })
      .sort((a, b) => (a.ts < b.ts ? 1 : -1));
  }, [invoices, purchaseOrders, stockAdjustmentLogs, cashRegisters, startDate, endDate, branchScope]);

  const handleExport = (fmt: ExportFormat) => {
    const headers = ['Timestamp', 'Actor', 'Module', 'Action', 'Details', 'Branch'];
    const rows = events.map((e) => [
      e.ts.replace('T', ' ').slice(0, 19), e.actor, e.module, e.action, e.details,
      BRANCHES.find((b) => b.id === e.branchId)?.name || e.branchId,
    ]);
    const name = `audit-log-${startDate}_to_${endDate}`;
    if (fmt === 'csv') exportToCsv(name, headers, rows);
    else if (fmt === 'excel') exportToExcel(name, headers, rows);
    else exportToPdf(name, headers, rows, 'Full Audit Trail');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <History className="h-4 w-4 text-red-600" /> Full Audit Trail
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">Who changed what, and when — across sales, purchases, stock & expenses.</p>
        </div>
        <ReportExportButtons onExport={handleExport} disabled={events.length === 0} />
      </div>

      <div className="bg-white border border-slate-300 shadow-xs overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse min-w-[780px]">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-bold uppercase text-[11px]">
              <th className="py-2.5 px-3">When</th>
              <th className="py-2.5 px-3">Actor</th>
              <th className="py-2.5 px-3">Module</th>
              <th className="py-2.5 px-3">Action</th>
              <th className="py-2.5 px-3">Details</th>
              <th className="py-2.5 px-3">Branch</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {events.length === 0 ? (
              <tr><td colSpan={6} className="py-8 text-center text-slate-400">No activity in this period.</td></tr>
            ) : events.map((e, i) => (
              <tr key={i} className="hover:bg-slate-50/60">
                <td className="py-2 px-3 font-mono text-slate-500 whitespace-nowrap">{e.ts.replace('T', ' ').slice(0, 16)}</td>
                <td className="py-2 px-3 font-semibold text-slate-800">{e.actor}</td>
                <td className="py-2 px-3">
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${MODULE_TONE[e.module] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>{e.module}</span>
                </td>
                <td className="py-2 px-3 font-semibold text-slate-700 whitespace-nowrap">{e.action}</td>
                <td className="py-2 px-3 text-slate-600">{e.details}</td>
                <td className="py-2 px-3 text-slate-500">{BRANCHES.find((b) => b.id === e.branchId)?.shortCode || e.branchId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400">{events.length} event(s) in range.</p>
    </div>
  );
};
