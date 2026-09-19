import React, { useMemo, useState } from 'react';
import { useErp } from '../../context/ErpContext';
import { BranchScope, BranchId, BRANCHES } from '../../types';
import { exportToCsv } from '../../utils/csvExport';
import { exportToExcel, exportToPdf, ExportFormat } from '../../utils/exportHelpers';
import { ReportExportButtons } from './ReportExportButtons';
import {
  Users,

  Building,
  ExternalLink,
  ShieldAlert,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { computePayrollRows } from '../../lib/payroll';

interface Props {
  branchScope: BranchScope;
}

export const PayrollSummaryReportTab: React.FC<Props> = ({ branchScope }) => {
  const {
    payrollRecords,
    employees,
    attendanceRecords,
    invoices,
    payrollSettings,
    currentUser,
    setCurrentView,
  } = useErp();

  // Pick month filter (default: "2026-09")
  const [selectedMonth, setSelectedMonth] = useState('2026-09');

  // Security check: Only CEO can view Payroll report
  if (currentUser.role !== 'CEO') {
    return (
      <div className="p-12 text-center bg-white rounded-xl border border-rose-200 shadow-2xs space-y-2">
        <ShieldAlert className="h-10 w-10 text-rose-600 mx-auto" />
        <h3 className="text-base font-bold text-slate-900">Access Restricted</h3>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          Confidential payroll compensation and disbursement reports are restricted exclusively to the Chief Executive Officer (CEO).
        </p>
      </div>
    );
  }

  // Live payroll rows — SAME computation as the Attendance › Payroll screen, so
  // the report and the operational payroll agree (was reading only sparse saved
  // records, which diverged in staff count, hours and liability).
  const filteredRecords = useMemo(() => {
    return computePayrollRows({
      employees,
      attendanceRecords,
      invoices,
      payrollRecords,
      month: selectedMonth,
      standardHours: payrollSettings.standardHoursPerMonth || 208,
      branchScope,
    });
  }, [employees, attendanceRecords, invoices, payrollRecords, selectedMonth, payrollSettings, branchScope]);

  // Aggregate Metrics
  const summary = useMemo(() => {
    let totalLiability = 0;
    let totalBasePay = 0;
    let totalAdjustments = 0;
    let totalHoursWorked = 0;
    let paidCount = 0;
    let draftCount = 0;

    const branchLiability: Record<BranchId, { total: number; count: number }> = {
      'erode-hq': { total: 0, count: 0 },
      'coimbatore': { total: 0, count: 0 },
      'chennai': { total: 0, count: 0 },
    };

    filteredRecords.forEach((rec) => {
      totalLiability += rec.finalPayable;
      totalBasePay += rec.computedPay;
      totalAdjustments += rec.manualAdjustment;
      totalHoursWorked += rec.totalHoursWorked;

      if (rec.status === 'Paid') paidCount++;
      else draftCount++;

      if (branchLiability[rec.branchId]) {
        branchLiability[rec.branchId].total += rec.finalPayable;
        branchLiability[rec.branchId].count++;
      }
    });

    return {
      totalLiability,
      totalBasePay,
      totalAdjustments,
      totalHoursWorked,
      paidCount,
      draftCount,
      branchLiability,
      activeCount: filteredRecords.length,
    };
  }, [filteredRecords]);

  const handleExport = (format: ExportFormat = 'csv') => {
    if (filteredRecords.length === 0) return;

    const branchLabel = branchScope === 'all' ? 'All_Branches' : branchScope;
    const filename = `Payroll_Report_${branchLabel}_${selectedMonth}.csv`;

    const headers = [
      'Employee ID',
      'Employee Name',
      'Designation',
      'Branch',
      'Month',
      'Monthly Salary (₹)',
      'Days Present',
      'Hours Worked',
      'Hourly Rate (₹)',
      'Computed Base Pay (₹)',
      'Adjustments / Bonus (₹)',
      'Adjustment Reason',
      'Final Net Payable (₹)',
      'Status',
      'Payment Mode',
      'Payment Reference',
    ];

    const rows = filteredRecords.map((r) => {
      const bObj = BRANCHES.find((b) => b.id === r.branchId);
      return [
        r.employeeId,
        r.employeeName,
        r.designation,
        bObj?.name || r.branchId,
        r.month,
        r.monthlySalary.toFixed(2),
        r.totalDaysPresent,
        r.totalHoursWorked.toFixed(1),
        r.hourlyRate.toFixed(2),
        r.computedPay.toFixed(2),
        r.manualAdjustment.toFixed(2),
        r.adjustmentReason || '—',
        r.finalPayable.toFixed(2),
        r.status,
        r.paymentMode || '—',
        r.paymentReference || '—',
      ];
    });

    // Summary block
    rows.push([]);
    rows.push(['--- PAYROLL MONTHLY SUMMARY ---']);
    rows.push(['Pay Month', selectedMonth]);
    rows.push(['Staff Processed', summary.activeCount]);
    rows.push(['Total Net Payable (₹)', summary.totalLiability.toFixed(2)]);
    rows.push(['Total Base Computed Pay (₹)', summary.totalBasePay.toFixed(2)]);
    rows.push(['Total Adjustments (₹)', summary.totalAdjustments.toFixed(2)]);
    rows.push(['Total Productive Hours', summary.totalHoursWorked.toFixed(1)]);
    rows.push(['Disbursed (Paid)', summary.paidCount]);
    rows.push(['Pending (Draft)', summary.draftCount]);

    if (format === 'excel') exportToExcel(filename, headers, rows);

    else if (format === 'pdf') exportToPdf(filename, headers, rows, filename.replace(/[_-]+/g, ' ').replace(/\.csv$/i, '').trim());

    else exportToCsv(filename, headers, rows);
  };

  return (
    <div className="space-y-4">
      {/* Header Banner with Month Selector & Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-4 rounded-none border border-slate-300 shadow-none">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
              <Users className="h-5 w-5 text-red-700" />
              <span>Payroll Cost & Labor Expense Summary</span>
            </h2>
            <span className="text-[10px] uppercase font-mono font-bold px-1.5 py-0.5 rounded-none bg-amber-50 text-amber-800 border border-amber-300">
              CEO Restricted
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-0.5">
            Attendance-computed labor costs and staff remuneration disbursement schedule
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-2.5 py-1 rounded-none border border-slate-300 bg-white text-xs font-bold text-slate-800 focus:outline-none focus:border-red-600"
          />

          <button
            onClick={() => setCurrentView('hrm')}
            className="px-2.5 py-1 rounded-none text-xs font-bold text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-300 transition-colors flex items-center gap-1.5 cursor-pointer uppercase font-mono"
          >
            <span>Full HRM</span>
            <ExternalLink className="h-3 w-3" />
          </button>

          <ReportExportButtons onExport={handleExport} />
        </div>
      </div>

      {filteredRecords.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-none border border-slate-300 shadow-none">
          <Clock className="h-10 w-10 text-slate-300 mx-auto mb-2" />
          <h3 className="text-sm font-bold text-slate-700">No payroll records generated for {selectedMonth}</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Payroll records are automatically computed from check-in/out attendance logs in the HRM module.
          </p>
        </div>
      ) : (
        <>
          {/* Summary Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-none border border-slate-300 bg-white shadow-none border-t-3 border-t-red-700">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block">
                Total Payroll Cost
              </span>
              <p className="text-xl sm:text-2xl font-extrabold text-red-800 mt-1 font-mono tabular-nums">
                ₹{summary.totalLiability.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </p>
              <span className="text-[11px] text-slate-500 mt-0.5 block font-mono">
                {summary.activeCount} employees processed
              </span>
            </div>

            <div className="p-3.5 rounded-none border border-slate-300 bg-white shadow-none border-t-3 border-t-slate-700">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block">
                Productive Hours Logged
              </span>
              <p className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1 font-mono tabular-nums">
                {summary.totalHoursWorked.toFixed(1)} <span className="text-sm font-bold text-slate-500 font-sans">hrs</span>
              </p>
              <span className="text-[11px] text-slate-500 mt-0.5 block">
                From biometric selfie kiosk
              </span>
            </div>

            <div className="p-3.5 rounded-none border border-slate-300 bg-white shadow-none border-t-3 border-t-emerald-600">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 block">
                Disbursed / Paid
              </span>
              <p className="text-xl sm:text-2xl font-extrabold text-emerald-800 mt-1 font-mono tabular-nums">
                {summary.paidCount}
              </p>
              <span className="text-[11px] text-emerald-700 mt-0.5 block">
                Completed disbursements
              </span>
            </div>

            <div className="p-3.5 rounded-none border border-amber-300 bg-amber-50/50 shadow-none border-t-3 border-t-amber-600">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-900 block">
                Pending Approval / Draft
              </span>
              <p className="text-xl sm:text-2xl font-extrabold text-amber-900 mt-1 font-mono tabular-nums">
                {summary.draftCount}
              </p>
              <span className="text-[11px] text-amber-800 mt-0.5 block">
                Ready for payment
              </span>
            </div>
          </div>

          {/* Branch-Wise Payroll Allocation (If All Branches) */}
          {branchScope === 'all' && (
            <div className="bg-white p-4 rounded-none border border-slate-300 shadow-none space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <Building className="h-4 w-4 text-red-700" />
                  <span>Branch-Wise Payroll Liability Allocation</span>
                </h3>
                <span className="text-[11px] text-slate-500 font-semibold">Departmental salary spend</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {BRANCHES.map((b) => {
                  const data = summary.branchLiability[b.id];
                  const share =
                    summary.totalLiability > 0 ? (data.total / summary.totalLiability) * 100 : 0;

                  return (
                    <div key={b.id} className="p-3 rounded-none bg-slate-50 border border-slate-300 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xs font-bold text-slate-900">{b.name}</span>
                          <span className="text-[11px] text-slate-500 block">{b.location}</span>
                        </div>
                        <span className="text-xs font-extrabold font-mono text-red-800">{share.toFixed(1)}%</span>
                      </div>

                      <div className="flex items-baseline justify-between pt-1">
                        <span className="text-base font-extrabold text-slate-900 font-mono tabular-nums">
                          ₹{data.total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </span>
                        <span className="text-[11px] font-bold text-slate-600 font-mono">{data.count} staff</span>
                      </div>

                      <div className="w-full h-1.5 rounded-none bg-slate-200 overflow-hidden mt-1">
                        <div
                          className="h-full bg-red-700 rounded-none"
                          style={{ width: `${Math.min(100, Math.max(0, share))}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Employee-by-Employee Breakdown Table */}
          <div className="bg-white rounded-none border border-slate-300 shadow-none overflow-hidden">
            <div className="p-3.5 border-b border-slate-300 bg-slate-100 flex items-center justify-between">
              <h3 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">
                Staff Compensation Roster ({filteredRecords.length})
              </h3>
              <span className="text-[11px] text-slate-600 font-mono font-bold">
                Period: {selectedMonth}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-300 bg-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-800">
                    <th className="py-2.5 px-4">Employee</th>
                    <th className="py-2.5 px-3">Designation & Branch</th>
                    <th className="py-2.5 px-3 text-right">Fixed Monthly (₹)</th>
                    <th className="py-2.5 px-3 text-center">Hours Worked</th>
                    <th className="py-2.5 px-3 text-right">Computed Pay (₹)</th>
                    <th className="py-2.5 px-3 text-right">Bonus / Adj (₹)</th>
                    <th className="py-2.5 px-4 text-right">Net Payable (₹)</th>
                    <th className="py-2.5 px-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredRecords.map((r) => {
                    const bObj = BRANCHES.find((b) => b.id === r.branchId);

                    return (
                      <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-2.5 px-4">
                          <div className="font-bold text-slate-900">{r.employeeName}</div>
                          <span className="font-mono text-[11px] text-slate-500">{r.employeeId}</span>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="text-slate-900 font-semibold">{r.designation}</div>
                          <span className="text-[11px] text-slate-600 font-mono">{bObj?.name}</span>
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-800 font-mono tabular-nums font-semibold">
                          ₹{r.monthlySalary.toLocaleString('en-IN')}
                        </td>
                        <td className="py-2.5 px-3 text-center font-bold text-slate-900 font-mono">
                          {r.totalHoursWorked.toFixed(1)} hrs
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-900 font-mono tabular-nums font-semibold">
                          ₹{r.computedPay.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <span
                            className={cn(
                              'font-bold font-mono tabular-nums',
                              r.manualAdjustment > 0
                                ? 'text-emerald-800'
                                : r.manualAdjustment < 0
                                ? 'text-rose-800'
                                : 'text-slate-500'
                            )}
                          >
                            {r.manualAdjustment > 0 ? `+₹${r.manualAdjustment}` : r.manualAdjustment < 0 ? `-₹${Math.abs(r.manualAdjustment)}` : '₹0'}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right font-extrabold text-slate-900 font-mono tabular-nums text-sm">
                          ₹{r.finalPayable.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-none text-[10px] font-mono font-bold uppercase border',
                              r.status === 'Paid'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                : 'bg-amber-50 text-amber-800 border-amber-300'
                            )}
                          >
                            {r.status === 'Paid' ? (
                              <>
                                <CheckCircle2 className="h-3 w-3" />
                                Paid
                              </>
                            ) : (
                              'Draft'
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
