import React, { useMemo } from 'react';
import { useErp } from '../../context/ErpContext';
import { BranchScope, BRANCHES, attendanceDayWeight, ATTENDANCE_STATUSES } from '../../types';
import { exportToCsv } from '../../utils/csvExport';
import { exportToExcel, exportToPdf, ExportFormat } from '../../utils/exportHelpers';
import { ReportExportButtons } from './ReportExportButtons';
import { CalendarCheck } from 'lucide-react';
import { cn } from '../../lib/utils';

interface Props {
  startDate: string;
  endDate: string;
  branchScope: BranchScope;
}

// #HRM — per-staff attendance summary over the selected range (use the date
// range for weekly / monthly / yearly). Counts Present / Half-Day / Absent /
// Casual + Sick Leave / Holiday / Week-Off, days worked and attendance %.
export const AttendanceReportTab: React.FC<Props> = ({ startDate, endDate, branchScope }) => {
  const { employees, attendanceRecords } = useErp();

  const rows = useMemo(() => {
    const inRange = (d: string) => (!startDate || d >= startDate) && (!endDate || d <= endDate);
    const byEmp = new Map<string, { empId: string; name: string; branchId: string; designation?: string; counts: Record<string, number>; worked: number }>();
    for (const e of employees) {
      if (branchScope !== 'all' && e.branchId !== branchScope) continue;
      byEmp.set(e.id, { empId: e.id, name: e.name, branchId: e.branchId, designation: e.designation, counts: {}, worked: 0 });
    }
    for (const a of attendanceRecords) {
      if (!inRange(a.date)) continue;
      if (branchScope !== 'all' && a.branchId !== branchScope) continue;
      const row = byEmp.get(a.employeeId);
      if (!row) continue;
      row.counts[a.status] = (row.counts[a.status] || 0) + 1;
      row.worked += attendanceDayWeight(a.status);
    }
    return Array.from(byEmp.values()).map((r) => {
      const absent = r.counts['Absent'] || 0;
      const leave = (r.counts['Casual Leave'] || 0) + (r.counts['Sick Leave'] || 0);
      // Working days = days that count toward attendance (exclude holidays / week-offs).
      const workingDays = r.worked + absent + leave;
      const pct = workingDays > 0 ? Math.round((r.worked / workingDays) * 1000) / 10 : 0;
      return { ...r, worked: Math.round(r.worked * 10) / 10, absent, leave, workingDays, pct };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [employees, attendanceRecords, startDate, endDate, branchScope]);

  const col = (r: typeof rows[number], v: string) => r.counts[v] || 0;

  const handleExport = (format: ExportFormat = 'csv') => {
    if (!rows.length) return;
    const branchLabel = branchScope === 'all' ? 'All_Branches' : branchScope;
    const filename = `Attendance_Report_${branchLabel}_${startDate}_to_${endDate}.csv`;
    const headers = ['Staff', 'Branch', 'Present', 'Half-Day', 'Absent', 'Casual Leave', 'Sick Leave', 'Holiday', 'Week Off', 'Days Worked', 'Attendance %'];
    const out = rows.map((r) => [
      r.name, BRANCHES.find((b) => b.id === r.branchId)?.name || r.branchId,
      col(r, 'Present'), col(r, 'Half-Day'), col(r, 'Absent'), col(r, 'Casual Leave'), col(r, 'Sick Leave'),
      col(r, 'Holiday'), col(r, 'Week Off'), r.worked, `${r.pct}%`,
    ]);
    if (format === 'excel') exportToExcel(filename, headers, out);
    else if (format === 'pdf') exportToPdf(filename, headers, out, 'Attendance Report');
    else exportToCsv(filename, headers, out);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">Per-staff attendance for the selected date range — set the range for a week, a month or a year.</p>
        <ReportExportButtons onExport={handleExport} />
      </div>
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-600 font-bold uppercase text-[11px] tracking-wider">
              <th className="py-3 px-4">Staff</th>
              {ATTENDANCE_STATUSES.map((s) => <th key={s.value} className="py-3 px-2 text-center" title={s.label}>{s.short}</th>)}
              <th className="py-3 px-3 text-center">Worked</th>
              <th className="py-3 px-3 text-center">Attendance %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {rows.map((r) => (
              <tr key={r.empId} className="hover:bg-slate-50/50">
                <td className="py-2.5 px-4">
                  <div className="font-bold text-slate-900">{r.name}</div>
                  <div className="text-[11px] text-slate-500">{r.designation || ''}</div>
                </td>
                {ATTENDANCE_STATUSES.map((s) => (
                  <td key={s.value} className="py-2.5 px-2 text-center font-mono">{col(r, s.value) || <span className="text-slate-300">·</span>}</td>
                ))}
                <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-900">{r.worked}</td>
                <td className="py-2.5 px-3 text-center">
                  <span className={cn('font-mono font-bold px-2 py-0.5 rounded',
                    r.workingDays === 0 ? 'text-slate-400' : r.pct >= 90 ? 'text-emerald-700 bg-emerald-50' : r.pct >= 75 ? 'text-amber-700 bg-amber-50' : 'text-rose-700 bg-rose-50')}>
                    {r.workingDays === 0 ? '—' : `${r.pct}%`}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="py-12 text-center text-slate-400 text-sm flex flex-col items-center gap-2">
            <CalendarCheck className="h-8 w-8 text-slate-300" />
            <span>No staff / attendance in this range.</span>
          </div>
        )}
      </div>
    </div>
  );
};
