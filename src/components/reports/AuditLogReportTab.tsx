import React, { useMemo, useState, useEffect } from 'react';
import { BranchScope, AuditEntry } from '../../types';
import { apiGet } from '../../lib/api';
import { getTodayDateString } from '../../lib/utils';
import { exportToCsv } from '../../utils/csvExport';
import { exportToExcel, exportToPdf, ExportFormat } from '../../utils/exportHelpers';
import { ReportExportButtons } from './ReportExportButtons';
import { History } from 'lucide-react';

interface Props {
  startDate: string;
  endDate: string;
  branchScope: BranchScope;
}

// Display label + pill tone per audited entity type (server `entity` field).
const ENTITY_LABEL: Record<string, string> = {
  invoice: 'Sales',
  payment: 'Payment',
  purchaseOrder: 'Purchase',
  user: 'User',
  employee: 'HRM',
  accessMatrix: 'Access',
};
const ENTITY_TONE: Record<string, string> = {
  invoice: 'bg-red-50 text-red-700 border-red-200',
  payment: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  purchaseOrder: 'bg-amber-50 text-amber-700 border-amber-200',
  user: 'bg-blue-50 text-blue-700 border-blue-200',
  employee: 'bg-violet-50 text-violet-700 border-violet-200',
  accessMatrix: 'bg-slate-100 text-slate-600 border-slate-200',
};

/** Format a stored UTC ISO timestamp for display in local (IST) time. */
const fmtLocal = (ts: string): string => {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString('en-IN', { hour12: false });
};

/** Full audit trail: the real append-only server audit log (who did what, when). */
export const AuditLogReportTab: React.FC<Props> = ({ startDate, endDate, branchScope }) => {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load the server audit log once. This is the authoritative trail — actor, action
  // and timestamp come straight from the backend rather than being reconstructed.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiGet<AuditEntry[]>('/api/audit?limit=1000')
      .then((data) => { if (!cancelled) setEntries(Array.isArray(data) ? data : []); })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Failed to load audit log'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const events = useMemo(() => {
    return entries
      .filter((e) => {
        const day = e.timestamp ? getTodayDateString(new Date(e.timestamp)) : '';
        if (startDate && day && day < startDate) return false;
        if (endDate && day && day > endDate) return false;
        return true;
      })
      .sort((a, b) => ((a.timestamp || '') < (b.timestamp || '') ? 1 : -1));
  }, [entries, startDate, endDate]);

  const handleExport = (fmt: ExportFormat) => {
    const headers = ['Timestamp', 'Actor', 'Entity', 'Action', 'Details'];
    const rows = events.map((e) => [
      fmtLocal(e.timestamp),
      e.actor,
      ENTITY_LABEL[e.entity] || e.entity,
      e.action,
      e.summary || e.entityId || '',
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
          <p className="text-[11px] text-slate-500 mt-0.5">
            The append-only server audit log — who changed what, and when (local time).
          </p>
        </div>
        <ReportExportButtons onExport={handleExport} disabled={events.length === 0} />
      </div>

      {branchScope !== 'all' && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded">
          The audit trail is organisation-wide and is not filtered by branch.
        </p>
      )}

      {error && (
        <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1.5 rounded">
          {error}
        </p>
      )}

      <div className="bg-white border border-slate-300 shadow-xs overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse min-w-[780px]">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-bold uppercase text-[11px]">
              <th className="py-2.5 px-3">When</th>
              <th className="py-2.5 px-3">Actor</th>
              <th className="py-2.5 px-3">Entity</th>
              <th className="py-2.5 px-3">Action</th>
              <th className="py-2.5 px-3">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={5} className="py-8 text-center text-slate-400">Loading audit trail…</td></tr>
            ) : events.length === 0 ? (
              <tr><td colSpan={5} className="py-8 text-center text-slate-400">No activity in this period.</td></tr>
            ) : events.map((e) => (
              <tr key={e.id} className="hover:bg-slate-50/60">
                <td className="py-2 px-3 font-mono text-slate-500 whitespace-nowrap">{fmtLocal(e.timestamp)}</td>
                <td className="py-2 px-3 font-semibold text-slate-800">{e.actor}</td>
                <td className="py-2 px-3">
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${ENTITY_TONE[e.entity] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>{ENTITY_LABEL[e.entity] || e.entity}</span>
                </td>
                <td className="py-2 px-3 font-semibold text-slate-700 whitespace-nowrap">{e.action}</td>
                <td className="py-2 px-3 text-slate-600">{e.summary || e.entityId || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400">{loading ? 'Loading…' : `${events.length} event(s) in range.`}</p>
    </div>
  );
};
