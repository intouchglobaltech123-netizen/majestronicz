import React, { useState, useEffect } from 'react';
import {
  Users,
  Clock,
  DollarSign,
  Camera,
  Plus,
  CheckCircle2,
  Percent,
  UserX,
} from 'lucide-react';
import { useErp } from '../../context/ErpContext';
import { EmployeeMasterView } from './EmployeeMasterView';
import { AttendanceLogView } from './AttendanceLogView';
import { PayrollSummaryView } from './PayrollSummaryView';
import { SalaryDetailsView } from './SalaryDetailsView';
import { AttendanceKioskModal } from './AttendanceKioskModal';
import { EmployeeModal } from './EmployeeModal';
import { formatCurrency } from '../../lib/utils';

export const HrmView: React.FC = () => {
  const {
    employees,
    attendanceRecords,
    payrollSettings,
    canViewHrm,
    activeSubTab,
  } = useErp();

  const [activeTab, setActiveTab] = useState<'attendance' | 'payroll' | 'employees' | 'salary'>('attendance');
  const [isKioskModalOpen, setIsKioskModalOpen] = useState(false);
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);

  // Synchronize view tab and actions when triggered from secondary navbar flyout
  useEffect(() => {
    if (activeSubTab?.view === 'hrm') {
      const tab = activeSubTab.tab;
      if (tab === 'attendance' || tab === 'payroll' || tab === 'employees' || tab === 'salary') {
        setActiveTab(tab);
      } else if (tab === 'kiosk') {
        setIsKioskModalOpen(true);
      } else if (tab === 'new-employee') {
        setIsEmployeeModalOpen(true);
      }
    }
  }, [activeSubTab]);

  const todayStr = new Date().toISOString().split('T')[0];
  const currentMonthStr = '2026-09';

  // KPI Calculations
  const activeStaff = employees.filter((e) => e.status === 'Active');
  const todayCheckIns = attendanceRecords.filter((a) => a.date === todayStr && a.checkInTime);
  const monthRecords = attendanceRecords.filter((a) => a.date.startsWith(currentMonthStr));
  const monthLaborHours = monthRecords.reduce((sum, r) => sum + (r.hoursWorked || 0), 0);

  // Approximate monthly payroll expense
  const standardHours = payrollSettings.standardHoursPerMonth || 208;
  const monthPayrollExpense = activeStaff.reduce((sum, emp) => {
    const empHours = monthRecords
      .filter((r) => r.employeeId === emp.id)
      .reduce((s, r) => s + (r.hoursWorked || 0), 0);
    const hourlyRate = emp.monthlySalary / standardHours;
    return sum + hourlyRate * empHours;
  }, 0);

  // Today's presence — unique active staff who checked in vs those who didn't.
  const presentIds = new Set(todayCheckIns.map((a) => a.employeeId));
  const presentToday = activeStaff.filter((e) => presentIds.has(e.id)).length;
  const absentToday = Math.max(0, activeStaff.length - presentToday);
  const attendanceRate = activeStaff.length > 0 ? Math.round((presentToday / activeStaff.length) * 100) : 0;

  if (!canViewHrm) {
    return (
      <div className="p-12 text-center text-slate-500">
        <Users className="h-12 w-12 mx-auto text-slate-300 mb-3" />
        <p className="text-base font-bold text-slate-700">Access Restricted</p>
        <p className="text-xs text-slate-400 mt-1">
          HRM & Payroll is restricted to CEO and Manager personnel.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 w-full">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              {activeTab === 'attendance'
                ? 'Staff Attendance'
                : activeTab === 'payroll'
                ? 'Payroll Processing'
                : activeTab === 'salary'
                ? 'Salary Structure'
                : 'Staff Directory'}
            </h1>
            <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              {activeTab === 'attendance'
                ? 'Shifts & Clock-ins'
                : activeTab === 'payroll'
                ? 'Wages & Deductions'
                : activeTab === 'salary'
                ? 'Base Pay Rules'
                : 'Employee Profiles'}
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Verified attendance tracking, staff shifts, and monthly payroll computation.
          </p>
        </div>

        {/* Action CTAs */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setIsKioskModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-xl shadow-xs transition-colors"
          >
            <Camera className="h-4 w-4" />
            <span>Clock-In / Out Terminal</span>
          </button>
          <button
            onClick={() => setIsEmployeeModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 active:bg-slate-100 border border-slate-300 rounded-xl shadow-2xs transition-colors"
          >
            <Plus className="h-4 w-4 text-slate-500" />
            <span>Enroll Staff</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Attendance rate today */}
        <div className={`p-4 rounded-xl border shadow-2xs flex items-center gap-3.5 ${attendanceRate >= 80 ? 'bg-emerald-50/50 border-emerald-200' : attendanceRate >= 50 ? 'bg-amber-50/50 border-amber-200' : 'bg-white border-slate-200'}`}>
          <div className="h-11 w-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-200/60">
            <Percent className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Attendance Today</p>
            <p className="text-lg sm:text-2xl lg:text-3xl font-bold text-slate-900 truncate font-mono mt-0.5">{attendanceRate}%</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{presentToday}/{activeStaff.length} present</p>
          </div>
        </div>

        {/* Absent today */}
        <div className={`p-4 rounded-xl border shadow-2xs flex items-center gap-3.5 ${absentToday > 0 ? 'bg-rose-50/50 border-rose-200' : 'bg-white border-slate-200'}`}>
          <div className="h-11 w-11 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-200/60">
            <UserX className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Not Clocked In</p>
            <p className={`text-lg sm:text-2xl lg:text-3xl font-bold truncate font-mono mt-0.5 ${absentToday > 0 ? 'text-rose-700' : 'text-slate-900'}`}>{absentToday}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{absentToday > 0 ? 'Yet to check in today' : 'Everyone is in'}</p>
          </div>
        </div>

        {/* Active Staff */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex items-center gap-3.5">
          <div className="h-11 w-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-200/60 font-bold">
            <Users className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Enrolled Staff
            </p>
            <p className="text-lg sm:text-2xl lg:text-3xl font-bold text-slate-900 truncate font-mono mt-0.5">
              {activeStaff.length} Employees
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">Across 3 branches</p>
          </div>
        </div>

        {/* Today's Check-Ins */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex items-center gap-3.5">
          <div className="h-11 w-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-200/60 font-bold">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Today's Attendance
            </p>
            <p className="text-lg sm:text-2xl lg:text-3xl font-bold text-emerald-700 truncate font-mono mt-0.5">
              {todayCheckIns.length} Checked In
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {todayStr} verified check-ins
            </p>
          </div>
        </div>

        {/* Monthly Hours Worked */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex items-center gap-3.5">
          <div className="h-11 w-11 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 border border-amber-200/60 font-bold">
            <Clock className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Labor Hours (Sep)
            </p>
            <p className="text-lg sm:text-2xl lg:text-3xl font-bold text-slate-900 truncate font-mono mt-0.5">
              {monthLaborHours.toFixed(1)} hrs
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">Sum of verified shifts</p>
          </div>
        </div>

        {/* Monthly Payroll */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex items-center gap-3.5">
          <div className="h-11 w-11 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0 border border-purple-200/60 font-bold">
            <DollarSign className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Payroll Expense
            </p>
            <p className="text-lg sm:text-2xl lg:text-3xl font-bold text-slate-900 truncate font-mono mt-0.5">
              {formatCurrency(Math.round(monthPayrollExpense))}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">Attendance computed net pay</p>
          </div>
        </div>
      </div>

      {/* Active Tab View */}
      {activeTab === 'attendance' ? (
        <AttendanceLogView />
      ) : activeTab === 'payroll' ? (
        <PayrollSummaryView />
      ) : activeTab === 'salary' ? (
        <SalaryDetailsView />
      ) : (
        <EmployeeMasterView />
      )}

      {/* Terminal Kiosk Modal */}
      <AttendanceKioskModal
        isOpen={isKioskModalOpen}
        onClose={() => setIsKioskModalOpen(false)}
      />

      {/* Employee Modal */}
      <EmployeeModal
        isOpen={isEmployeeModalOpen}
        onClose={() => setIsEmployeeModalOpen(false)}
      />
    </div>
  );
};
