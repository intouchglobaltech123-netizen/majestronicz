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

interface Props {
  branchScope: BranchScope;
}

export const PayrollSummaryReportTab: React.FC<Props> = ({ branchScope }) => {
  const {
    payrollRecords,
    currentUser,
    setCurrentView,
  } = useErp();

  // Pick month filter (default: "2026-09")
  const [selectedMonth, setSelectedMonth] = useState('2026-09');

  // Security check: Only CEO can view Payroll report
  if (currentUser.role !== 'CEO') {
    return (
      <div className="p-12 text-center bg-white rounded-2xl border border-rose-200 shadow-2xs space-y-2">
        <ShieldAlert className="h-10 w-10 text-rose-600 mx-auto" />
        <h3 className="text-base font-bold text-slate-900">Access Restricted</h3>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          Confidential payroll compensation and disbursement reports are restricted exclusively to the Chief Executive Officer (CEO).
        </p>
      </div>
    );
  }

  // Filter records for selected month and branch
  const filteredRecords = useMemo(() => {
    return payrollRecords.filter((rec) => {
      if (selectedMonth && rec.month !== selectedMonth) return false;
      if (branchScope !== 'all' && rec.branchId !== branchScope) return false;
      return true;
    });
  }, [payrollRecords, selectedMonth, branchScope]);

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
    <div className="space-y-6">
      {/* Header Banner with Month Selector & Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-600" />
              <span>Payroll Cost & Labor Expense Summary</span>
            </h2>
            <span className="text-[11px] uppercase font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              CEO Restricted
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Attendance-computed labor costs and staff remuneration disbursement schedule
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-800 focus:outline-none focus:border-blue-600"
          />

          <button
            onClick={() => setCurrentView('hrm')}
            className="px-3 py-1.5 rounded-xl text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-colors flex items-center gap-1.5"
          >
            <span>Full HRM View</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </button>

          <ReportExportButtons onExport={handleExport} />
        </div>
      </div>

      {filteredRecords.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 shadow-2xs">
          <Clock className="h-10 w-10 text-slate-300 mx-auto mb-2" />
          <h3 className="text-sm font-bold text-slate-700">No payroll records generated for {selectedMonth}</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            Payroll records are automatically computed from check-in/out attendance logs in the HRM module.
          </p>
        </div>
      ) : (
        <>
          {/* Summary Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 sm:grid-cols-4 gap-3.5">
            <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                Total Payroll Cost
              </span>
              <p className="text-xl sm:text-2xl font-extrabold text-blue-700 mt-1">
                ₹{summary.totalLiability.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </p>
              <span className="text-[11px] text-slate-400 mt-0.5 block">
                {summary.activeCount} employees processed
              </span>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                Productive Hours Logged
              </span>
              <p className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">
                {summary.totalHoursWorked.toFixed(1)} <span className="text-sm font-normal text-slate-500">hrs</span>
              </p>
              <span className="text-[11px] text-slate-400 mt-0.5 block">
                From biometric selfie kiosk
              </span>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 block">
                Disbursed / Paid
              </span>
              <p className="text-xl sm:text-2xl font-extrabold text-emerald-700 mt-1">
                {summary.paidCount}
              </p>
              <span className="text-[11px] text-emerald-600 mt-0.5 block">
                Completed disbursements
              </span>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700 block">
                Pending Approval / Draft
              </span>
              <p className="text-xl sm:text-2xl font-extrabold text-amber-700 mt-1">
                {summary.draftCount}
              </p>
              <span className="text-[11px] text-amber-600 mt-0.5 block">
                Ready for payment
              </span>
            </div>
          </div>

          {/* Branch-Wise Payroll Allocation (If All Branches) */}
          {branchScope === 'all' && (
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <Building className="h-4 w-4 text-blue-600" />
                  <span>Branch-Wise Payroll Liability Allocation</span>
                </h3>
                <span className="text-[11px] text-slate-400 font-medium">Departmental salary spend</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {BRANCHES.map((b) => {
                  const data = summary.branchLiability[b.id];
                  const share =
                    summary.totalLiability > 0 ? (data.total / summary.totalLiability) * 100 : 0;

                  return (
                    <div key={b.id} className="p-4 rounded-xl bg-slate-50/70 border border-slate-200 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xs font-bold text-slate-900">{b.name}</span>
                          <span className="text-[11px] text-slate-400 block">{b.location}</span>
                        </div>
                        <span className="text-xs font-extrabold text-blue-700">{share.toFixed(1)}%</span>
                      </div>

                      <div className="flex items-baseline justify-between pt-1">
                        <span className="text-lg font-extrabold text-slate-900">
                          ₹{data.total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </span>
                        <span className="text-[11px] font-bold text-slate-600">{data.count} staff</span>
                      </div>

                      <div className="w-full h-1.5 rounded-full bg-slate-200 overflow-hidden mt-1">
                        <div
                          className="h-full bg-blue-600 rounded-full"
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
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50/60 flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Staff Compensation Roster ({filteredRecords.length})
              </h3>
              <span className="text-[11px] text-slate-500 font-medium">
                Period: {selectedMonth}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="py-3 px-4">Employee</th>
                    <th className="py-3 px-3">Designation & Branch</th>
                    <th className="py-3 px-3 text-right">Fixed Monthly (₹)</th>
                    <th className="py-3 px-3 text-center">Hours Worked</th>
                    <th className="py-3 px-3 text-right">Computed Pay (₹)</th>
                    <th className="py-3 px-3 text-right">Bonus / Adj (₹)</th>
                    <th className="py-3 px-4 text-right">Net Payable (₹)</th>
                    <th className="py-3 px-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRecords.map((r) => {
                    const bObj = BRANCHES.find((b) => b.id === r.branchId);

                    return (
                      <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900">{r.employeeName}</div>
                          <span className="font-mono text-[11px] text-slate-400">{r.employeeId}</span>
                        </td>
                        <td className="py-3 px-3">
                          <div className="text-slate-800 font-medium">{r.designation}</div>
                          <span className="text-[11px] text-blue-700 font-semibold">{bObj?.name}</span>
                        </td>
                        <td className="py-3 px-3 text-right text-slate-600 font-semibold">
                          ₹{r.monthlySalary.toLocaleString('en-IN')}
                        </td>
                        <td className="py-3 px-3 text-center font-bold text-slate-800">
                          {r.totalHoursWorked.toFixed(1)} hrs
                        </td>
                        <td className="py-3 px-3 text-right text-slate-700 font-semibold">
                          ₹{r.computedPay.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <span
                            className={cn(
                              'font-bold',
                              r.manualAdjustment > 0
                                ? 'text-emerald-700'
                                : r.manualAdjustment < 0
                                ? 'text-rose-700'
                                : 'text-slate-400'
                            )}
                          >
                            {r.manualAdjustment > 0 ? `+₹${r.manualAdjustment}` : r.manualAdjustment < 0 ? `-₹${Math.abs(r.manualAdjustment)}` : '₹0'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-extrabold text-blue-700 text-sm">
                          ₹{r.finalPayable.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border',
                              r.status === 'Paid'
                                ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                                : 'bg-amber-100 text-amber-800 border-amber-200'
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
