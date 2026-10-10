import React, { useMemo, useState, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import { ATTENDANCE_STATUSES, AttendanceStatus, BRANCHES, BranchId } from '../../types';
import { isActiveEmployee } from '../../lib/payroll';
import { cn, getTodayDateString } from '../../lib/utils';
import { CalendarCheck, Save, Users } from 'lucide-react';

/**
 * Old-school attendance register (#HRM): a manager picks a date and marks each
 * staff member Present / Absent / Leave / Holiday / Week-off — no selfie, no GPS.
 * Prefills from what's already recorded for the day; Sundays default to Week Off.
 */
export const AttendanceRegisterView: React.FC = () => {
  const { employees, attendanceRecords, currentBranch, currentUser, markAttendance } = useErp();
  const isManager = currentUser.role === 'Manager';
  const defaultBranch: BranchId = (isManager && currentUser.assignedBranchId)
    ? (currentUser.assignedBranchId as BranchId)
    : (currentBranch !== 'all' ? currentBranch : 'erode-hq');

  const [date, setDate] = useState(getTodayDateString());
  const [branchId, setBranchId] = useState<BranchId>(defaultBranch);
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const canEdit = currentUser.role === 'CEO' || currentUser.role === 'Manager';
  const isSunday = useMemo(() => { const d = new Date(date + 'T00:00:00'); return d.getDay() === 0; }, [date]);

  const staff = useMemo(
    () => employees.filter((e) => isActiveEmployee(e) && e.branchId === branchId).sort((a, b) => a.name.localeCompare(b.name)),
    [employees, branchId]
  );

  // Load what's already marked for this date/branch (else default: Sunday=Week Off, else Present).
  useEffect(() => {
    const next: Record<string, AttendanceStatus> = {};
    const nextNotes: Record<string, string> = {};
    for (const e of staff) {
      const rec = attendanceRecords.find((a) => a.employeeId === e.id && a.date === date);
      next[e.id] = (rec?.status as AttendanceStatus) || (isSunday ? 'Week Off' : 'Present');
      if (rec?.notes) nextNotes[e.id] = rec.notes;
    }
    setMarks(next);
    setNotes(nextNotes);
  }, [date, branchId, staff, attendanceRecords, isSunday]);

  const setAll = (status: AttendanceStatus) => setMarks(Object.fromEntries(staff.map((e) => [e.id, status])));

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of staff) { const s = marks[e.id]; c[s] = (c[s] || 0) + 1; }
    return c;
  }, [marks, staff]);

  const save = async () => {
    if (!staff.length) return;
    setSaving(true);
    const payload = staff.map((e) => ({ employeeId: e.id, status: marks[e.id] || 'Present', notes: notes[e.id] || undefined }));
    await markAttendance(date, branchId, payload);
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">Date</label>
          <input type="date" value={date} max={getTodayDateString()} onChange={(e) => setDate(e.target.value)}
            className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-300 text-sm text-slate-900 focus:outline-none focus:border-red-600" />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">Branch</label>
          <select value={branchId} disabled={isManager} onChange={(e) => setBranchId(e.target.value as BranchId)}
            className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-300 text-sm font-semibold text-slate-900 focus:outline-none focus:border-red-600 disabled:opacity-70">
            {BRANCHES.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        {canEdit && (
          <button type="button" onClick={() => setAll('Present')} className="px-3 py-2 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100">
            Mark all Present
          </button>
        )}
        {isSunday && <span className="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-1.5 rounded-lg font-semibold">Sunday — defaulted to Week Off</span>}
        <div className="ml-auto flex items-center gap-2 text-[11px] text-slate-500">
          <Users className="h-3.5 w-3.5" /> {staff.length} staff
          {Object.entries(counts).map(([s, n]) => <span key={s} className="font-semibold text-slate-700">· {s}: {n}</span>)}
        </div>
      </div>

      {/* Register */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
          <CalendarCheck className="h-4 w-4 text-red-600" />
          <h3 className="text-sm font-bold text-slate-900">Attendance Register — {date}</h3>
        </div>
        {staff.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">No active staff in this branch.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {staff.map((e, i) => (
              <div key={e.id} className="px-4 py-3 flex flex-wrap items-center gap-3">
                <div className="w-48 shrink-0">
                  <div className="font-bold text-slate-900 text-sm">{i + 1}. {e.name}</div>
                  <div className="text-[11px] text-slate-500">{e.designation}</div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {ATTENDANCE_STATUSES.map((s) => (
                    <button
                      key={s.value} type="button" disabled={!canEdit}
                      onClick={() => setMarks((prev) => ({ ...prev, [e.id]: s.value }))}
                      className={cn(
                        'px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors disabled:opacity-60',
                        marks[e.id] === s.value ? s.cls + ' ring-1 ring-offset-1 ring-slate-300' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                      )}
                      title={s.label}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <input
                  type="text" disabled={!canEdit} value={notes[e.id] || ''} placeholder="Note (optional)"
                  onChange={(ev) => setNotes((prev) => ({ ...prev, [e.id]: ev.target.value }))}
                  className="flex-1 min-w-[120px] px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {canEdit && staff.length > 0 && (
        <div className="flex justify-end">
          <button type="button" onClick={save} disabled={saving}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-xs font-bold border border-red-700 rounded-lg cursor-pointer">
            <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save Register'}
          </button>
        </div>
      )}
    </div>
  );
};
