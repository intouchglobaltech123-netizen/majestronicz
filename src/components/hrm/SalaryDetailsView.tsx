import React, { useMemo, useState } from 'react';
import {
  DollarSign,
  Clock,
  CalendarDays,
  CalendarCheck,
  CalendarX,
  TrendingUp,
  Wallet,
  Timer,
  Percent,
  Search,
  ChevronRight,
  Briefcase,
  UserRound,
} from 'lucide-react';
import { useErp } from '../../context/ErpContext';
import { Employee, BRANCHES } from '../../types';
import { formatCurrency } from '../../lib/utils';

/**
 * Salary Details — per-employee compensation & attendance breakdown.
 * Left: searchable employee list. Right: detailed KPI cards for the selection.
 * All figures are derived from verified attendance + salesperson incentives.
 */
export const SalaryDetailsView: React.FC = () => {
  const { employees, attendanceRecords, payrollSettings, invoices, currentUser, currentBranch } = useErp();

  const standardHours = payrollSettings.standardHoursPerMonth || 208;

  // Branch scoping (Managers see only their branch, matching Payroll view)
  const scopedEmployees = useMemo(() => {
    return employees.filter((emp) => {
      if (currentUser.role === 'Manager') {
        const managerBranch = currentUser.assignedBranchId || 'coimbatore';
        return emp.branchId === managerBranch;
      }
      if (currentBranch !== 'all' && emp.branchId !== currentBranch) return false;
      return true;
    });
  }, [employees, currentUser, currentBranch]);

  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? scopedEmployees.filter(
          (e) =>
            e.name.toLowerCase().includes(q) ||
            e.designation.toLowerCase().includes(q)
        )
      : scopedEmployees;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [scopedEmployees, search]);

  const selected: Employee | null =
    filtered.find((e) => e.id === selectedId) ||
    scopedEmployees.find((e) => e.id === selectedId) ||
    null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
      {/* Employee list */}
      <div className="bg-white rounded-none border border-slate-300 shadow-xs overflow-hidden flex flex-col max-h-[70vh]">
        <div className="p-3 border-b border-slate-300 bg-slate-50/50">
          <div className="relative">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employee…"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-none border border-slate-300 bg-white focus:outline-hidden focus:border-red-600"
            />
          </div>
        </div>
        <div className="overflow-y-auto divide-y divide-slate-200">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">No employees found.</div>
          ) : (
            filtered.map((emp) => {
              const isActive = emp.id === selectedId;
              return (
                <button
                  key={emp.id}
                  onClick={() => setSelectedId(emp.id)}
                  className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${
                    isActive ? 'bg-red-50/80 border-l-4 border-l-red-600' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className={`h-9 w-9 rounded-none flex items-center justify-center shrink-0 text-xs font-bold ${
                    isActive ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-700 border border-slate-300'
                  }`}>
                    {emp.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-bold truncate ${isActive ? 'text-red-700' : 'text-slate-800'}`}>
                      {emp.name}
                    </p>
                    <p className="text-[11px] text-slate-500 truncate">{emp.designation}</p>
                  </div>
                  <ChevronRight className={`h-4 w-4 shrink-0 ${isActive ? 'text-red-600' : 'text-slate-300'}`} />
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selected ? (
        <SalaryDetailPanel
          employee={selected}
          attendanceRecords={attendanceRecords}
          invoices={invoices}
          standardHours={standardHours}
        />
      ) : (
        <div className="bg-white rounded-none border border-dashed border-slate-300 shadow-xs flex flex-col items-center justify-center p-12 text-center min-h-[300px]">
          <UserRound className="h-12 w-12 text-slate-300 mb-3" />
          <p className="text-base font-bold text-slate-700">Select an employee</p>
          <p className="text-xs text-slate-400 mt-1">
            Choose a staff member to view detailed salary and attendance information.
          </p>
        </div>
      )}
    </div>
  );
};

// ---- Detail panel ----

interface PanelProps {
  employee: Employee;
  attendanceRecords: ReturnType<typeof useErp>['attendanceRecords'];
  invoices: ReturnType<typeof useErp>['invoices'];
  standardHours: number;
}

/** Count expected working days (excluding Sundays) from month start up to today. */
function expectedWorkingDaysThisMonth(): number {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  let count = 0;
  for (let d = 1; d <= today; d++) {
    const day = new Date(year, month, d).getDay();
    if (day !== 0) count++; // exclude Sundays
  }
  return count;
}

const SalaryDetailPanel: React.FC<PanelProps> = ({ employee, attendanceRecords, invoices, standardHours }) => {
  const hourlyRate = parseFloat((employee.monthlySalary / standardHours).toFixed(2));

  const empAttendance = useMemo(
    () => attendanceRecords.filter((a) => a.employeeId === employee.id),
    [attendanceRecords, employee.id]
  );

  const currentMonthStr = new Date().toISOString().slice(0, 7); // YYYY-MM

  const stats = useMemo(() => {
    const totalDaysPresent = empAttendance.length;
    const totalHoursWorked = empAttendance.reduce((s, a) => s + (a.hoursWorked || 0), 0);
    const monthsWorked = new Set(empAttendance.map((a) => a.date.slice(0, 7))).size;
    const avgHoursPerDay = totalDaysPresent > 0 ? totalHoursWorked / totalDaysPresent : 0;

    // Lifetime incentives credited to this employee (net of returns, excl. voided)
    const totalIncentive = Math.round(
      invoices
        .filter((inv) => !inv.isVoided && inv.salespersonId === employee.id)
        .reduce((sum, inv) => {
          const amt = inv.incentiveAmount || 0;
          if (!amt) return sum;
          const gross = inv.grandTotal || 0;
          const netRatio = gross > 0 ? Math.max(0, gross - (inv.totalReturnedAmount || 0)) / gross : 0;
          return sum + amt * netRatio;
        }, 0)
    );

    const totalEarned = Math.round(hourlyRate * totalHoursWorked) + totalIncentive;

    // This month
    const monthAtt = empAttendance.filter((a) => a.date.startsWith(currentMonthStr));
    const presentThisMonth = monthAtt.length;
    const hoursThisMonth = monthAtt.reduce((s, a) => s + (a.hoursWorked || 0), 0);
    const expectedDays = expectedWorkingDaysThisMonth();
    const absentThisMonth = Math.max(0, expectedDays - presentThisMonth);
    const avgHoursThisMonth = presentThisMonth > 0 ? hoursThisMonth / presentThisMonth : 0;

    return {
      totalDaysPresent,
      totalHoursWorked,
      monthsWorked,
      avgHoursPerDay,
      totalIncentive,
      totalEarned,
      presentThisMonth,
      hoursThisMonth,
      absentThisMonth,
      avgHoursThisMonth,
      expectedDays,
    };
  }, [empAttendance, invoices, employee.id, hourlyRate, currentMonthStr]);

  const branchName = BRANCHES.find((b) => b.id === employee.branchId)?.name || employee.branchId;

  // Tenure since joining
  const tenure = useMemo(() => {
    if (!employee.joinedDate) return '—';
    const start = new Date(employee.joinedDate);
    const now = new Date();
    const months =
      (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
    if (isNaN(months) || months < 0) return '—';
    const yrs = Math.floor(months / 12);
    const mos = months % 12;
    return yrs > 0 ? `${yrs}y ${mos}m` : `${mos}m`;
  }, [employee.joinedDate]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-none border border-slate-300 shadow-xs p-5 flex items-center gap-4">
        <div className="h-14 w-14 rounded-none bg-red-600 text-white flex items-center justify-center text-lg font-bold shrink-0">
          {employee.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-bold text-slate-900 truncate">{employee.name}</h3>
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-0.5 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" />{employee.designation}</span>
            <span>•</span>
            <span>{branchName}</span>
            <span>•</span>
            <span>Joined {employee.joinedDate || '—'} ({tenure})</span>
          </div>
        </div>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-none border ${
          employee.status === 'Active'
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-slate-100 text-slate-500 border-slate-300'
        }`}>
          {employee.status}
        </span>
      </div>

      {/* Compensation KPI cards */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Compensation</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <KpiCard icon={<DollarSign className="h-5 w-5" />} tone="red" label="Monthly Salary" value={formatCurrency(employee.monthlySalary)} hint="Agreed fixed salary" />
          <KpiCard icon={<Percent className="h-5 w-5" />} tone="slate" label="Hourly Rate" value={formatCurrency(hourlyRate)} hint={`Based on ${standardHours} std hrs`} />
          <KpiCard icon={<Wallet className="h-5 w-5" />} tone="emerald" label="Total Earned (Lifetime)" value={formatCurrency(stats.totalEarned)} hint="Attendance pay + incentives" />
          <KpiCard icon={<TrendingUp className="h-5 w-5" />} tone="slate" label="Incentives Earned" value={formatCurrency(stats.totalIncentive)} hint="Net sales incentives" />
        </div>
      </div>

      {/* Attendance (lifetime) KPI cards */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Work History</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <KpiCard icon={<CalendarDays className="h-5 w-5" />} tone="red" label="Months Worked" value={String(stats.monthsWorked)} hint="Months with attendance" />
          <KpiCard icon={<CalendarCheck className="h-5 w-5" />} tone="emerald" label="Total Days Present" value={String(stats.totalDaysPresent)} hint="Verified check-ins" />
          <KpiCard icon={<Clock className="h-5 w-5" />} tone="amber" label="Total Hours Worked" value={`${stats.totalHoursWorked.toFixed(1)} hrs`} hint="Sum of all shifts" />
          <KpiCard icon={<Timer className="h-5 w-5" />} tone="slate" label="Avg Work Hours / Day" value={`${stats.avgHoursPerDay.toFixed(1)} hrs`} hint="Per present day" />
        </div>
      </div>

      {/* This month KPI cards */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">This Month</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <KpiCard icon={<CalendarCheck className="h-5 w-5" />} tone="emerald" label="Present Days" value={String(stats.presentThisMonth)} hint={`of ~${stats.expectedDays} working days`} />
          <KpiCard icon={<CalendarX className="h-5 w-5" />} tone="rose" label="Absent Days" value={String(stats.absentThisMonth)} hint="Excludes Sundays" />
          <KpiCard icon={<Timer className="h-5 w-5" />} tone="amber" label="Avg Hours / Day" value={`${stats.avgHoursThisMonth.toFixed(1)} hrs`} hint={`${stats.hoursThisMonth.toFixed(1)} hrs total`} />
        </div>
      </div>
    </div>
  );
};

// ---- KPI card ----

const TONES: Record<string, string> = {
  red: 'bg-red-50 text-red-700 border-red-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
  slate: 'bg-slate-100 text-slate-700 border-slate-300',
};

const KpiCard: React.FC<{
  icon: React.ReactNode;
  tone: keyof typeof TONES | string;
  label: string;
  value: string;
  hint?: string;
}> = ({ icon, tone, label, value, hint }) => (
  <div className="bg-white p-4 rounded-none border border-slate-300 shadow-xs flex items-center gap-3.5">
    <div className={`h-11 w-11 rounded-none flex items-center justify-center shrink-0 border ${TONES[tone] || TONES.slate}`}>
      {icon}
    </div>
    <div className="min-w-0 flex-1">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 truncate">{label}</p>
      <p className="text-xl lg:text-2xl font-bold text-slate-900 truncate font-mono mt-0.5">{value}</p>
      {hint && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{hint}</p>}
    </div>
  </div>
);
