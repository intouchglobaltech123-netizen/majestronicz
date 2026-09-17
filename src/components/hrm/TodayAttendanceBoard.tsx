import React, { useMemo } from 'react';
import {
  MapPin,
  LogIn,
  LogOut,
  Clock,
  CheckCircle2,
  UserX,
  Timer,
  CalendarCheck,
} from 'lucide-react';
import { useErp } from '../../context/ErpContext';
import { BRANCHES } from '../../types';

/** Today's IST date (YYYY-MM-DD) — matches how the backend stamps attendance. */
function istToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

type TodayStatus = 'on-shift' | 'checked-out' | 'absent';

/**
 * Vyapar/Ordu-style live attendance board: every (branch-scoped) staff member's
 * status TODAY — checked in / on shift / checked out / absent — with times,
 * location, and top-line metrics. Read-only overview for owners & managers.
 */
export const TodayAttendanceBoard: React.FC = () => {
  const { employees, attendanceRecords, currentUser, currentBranch, isAllBranches } = useErp();

  const today = istToday();

  const staff = useMemo(() => {
    const active = employees.filter((e) => e.status === 'Active');
    return active.filter((e) => {
      if (currentUser.role === 'Manager') {
        return e.branchId === (currentUser.assignedBranchId || 'coimbatore');
      }
      return isAllBranches || e.branchId === currentBranch;
    });
  }, [employees, currentUser, currentBranch, isAllBranches]);

  const rows = useMemo(() => {
    return staff
      .map((emp) => {
        const rec = attendanceRecords.find((a) => a.employeeId === emp.id && a.date === today);
        let status: TodayStatus = 'absent';
        if (rec?.checkInTime && rec?.checkOutTime) status = 'checked-out';
        else if (rec?.checkInTime) status = 'on-shift';
        return { emp, rec, status };
      })
      // Present first (on-shift, then checked-out), absent last; then by name.
      .sort((a, b) => {
        const order = { 'on-shift': 0, 'checked-out': 1, absent: 2 };
        if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
        return a.emp.name.localeCompare(b.emp.name);
      });
  }, [staff, attendanceRecords, today]);

  const metrics = useMemo(() => {
    const onShift = rows.filter((r) => r.status === 'on-shift').length;
    const checkedOut = rows.filter((r) => r.status === 'checked-out').length;
    const present = onShift + checkedOut;
    const absent = rows.filter((r) => r.status === 'absent').length;
    const hoursToday = rows.reduce((s, r) => s + (r.rec?.hoursWorked || 0), 0);
    const avgHours = checkedOut > 0 ? hoursToday / checkedOut : 0;
    const rate = staff.length > 0 ? Math.round((present / staff.length) * 100) : 0;
    return { onShift, checkedOut, present, absent, avgHours, rate };
  }, [rows, staff.length]);

  const prettyDate = new Date(today).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-blue-50 text-blue-600 border border-blue-200/60 flex items-center justify-center">
            <CalendarCheck className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Today's Attendance</h3>
            <p className="text-[11px] text-slate-500">{prettyDate}</p>
          </div>
        </div>
        <span
          className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
            metrics.rate >= 80
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : metrics.rate >= 50
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : 'bg-rose-50 text-rose-700 border-rose-200'
          }`}
        >
          {metrics.rate}% present
        </span>
      </div>

      {/* Metric chips */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 border-b border-slate-100 bg-slate-50/40">
        <Metric icon={<LogIn className="h-4 w-4" />} tone="amber" label="On shift" value={metrics.onShift} />
        <Metric icon={<CheckCircle2 className="h-4 w-4" />} tone="emerald" label="Checked out" value={metrics.checkedOut} />
        <Metric icon={<UserX className="h-4 w-4" />} tone="rose" label="Absent" value={metrics.absent} />
        <Metric icon={<Timer className="h-4 w-4" />} tone="blue" label="Avg hrs" value={`${metrics.avgHours.toFixed(1)}h`} />
      </div>

      {/* Roster */}
      <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
        {rows.length === 0 ? (
          <div className="py-10 text-center text-slate-400 text-xs">No active staff in scope.</div>
        ) : (
          rows.map(({ emp, rec, status }) => {
            const branchObj = BRANCHES.find((b) => b.id === emp.branchId);
            return (
              <div key={emp.id} className="px-4 sm:px-5 py-3 flex items-center gap-3">
                <div
                  className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 text-xs font-bold border ${
                    status === 'absent'
                      ? 'bg-slate-100 text-slate-400 border-slate-200'
                      : 'bg-blue-50 text-blue-700 border-blue-200/60'
                  }`}
                >
                  {emp.name.slice(0, 2).toUpperCase()}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-800 truncate">{emp.name}</p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {emp.designation}
                    {isAllBranches && branchObj ? ` • ${branchObj.name}` : ''}
                  </p>
                </div>

                {/* Times + location */}
                {status === 'absent' ? (
                  <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 border border-slate-200 shrink-0">
                    Not checked in
                  </span>
                ) : (
                  <div className="flex items-center gap-3 sm:gap-5 shrink-0">
                    <div className="text-right">
                      <div className="text-[11px] font-mono font-bold text-slate-800 flex items-center justify-end gap-1">
                        <LogIn className="h-3 w-3 text-blue-600" /> {rec?.checkInTime}
                      </div>
                      {rec?.checkInLocation && (
                        <a
                          href={`https://www.google.com/maps?q=${rec.checkInLocation.latitude},${rec.checkInLocation.longitude}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-blue-600 hover:text-blue-800 inline-flex items-center gap-0.5"
                        >
                          <MapPin className="h-2.5 w-2.5 text-rose-500" />
                          <span className="truncate max-w-[90px]">{rec.checkInLocation.addressHint || 'GPS'}</span>
                        </a>
                      )}
                    </div>

                    <div className="text-right min-w-[64px]">
                      {status === 'checked-out' ? (
                        <>
                          <div className="text-[11px] font-mono font-bold text-slate-800 flex items-center justify-end gap-1">
                            <LogOut className="h-3 w-3 text-emerald-600" /> {rec?.checkOutTime}
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono">{(rec?.hoursWorked || 0).toFixed(2)}h</div>
                        </>
                      ) : (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" /> On shift
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

const TONES: Record<string, string> = {
  amber: 'bg-amber-50 text-amber-600 border-amber-200/60',
  emerald: 'bg-emerald-50 text-emerald-600 border-emerald-200/60',
  rose: 'bg-rose-50 text-rose-600 border-rose-200/60',
  blue: 'bg-blue-50 text-blue-600 border-blue-200/60',
};

const Metric: React.FC<{ icon: React.ReactNode; tone: string; label: string; value: React.ReactNode }> = ({
  icon,
  tone,
  label,
  value,
}) => (
  <div className="flex items-center gap-2.5 rounded-xl bg-white border border-slate-200 px-3 py-2">
    <div className={`h-8 w-8 rounded-lg flex items-center justify-center border shrink-0 ${TONES[tone] || TONES.blue}`}>
      {icon}
    </div>
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 truncate">{label}</p>
      <p className="text-base font-black text-slate-900 font-mono leading-tight">{value}</p>
    </div>
  </div>
);
