import React, { useState } from 'react';
import {
  DollarSign,
  Clock,
  CheckCircle2,
  FileText,
  Settings,
  CreditCard,
  Edit,
  X,
  Lock,
} from 'lucide-react';
import { useErp } from '../../context/ErpContext';
import { Employee, PayrollRecord, BRANCHES, BranchScope } from '../../types';
import { formatCurrency } from '../../lib/utils';
import { PayslipModal } from './PayslipModal';
import { PayrollSettingsModal } from './PayrollSettingsModal';
import { computePayrollRows } from '../../lib/payroll';

export const PayrollSummaryView: React.FC = () => {
  const {
    employees,
    attendanceRecords,
    payrollSettings,
    payrollRecords,
    invoices,
    updatePayrollAdjustment,
    markPayrollPaid,
    currentBranch,
    currentUser,
    canEditSalaries,
    canMarkPayrollPaid,
    canAdjustPayroll,
  } = useErp();

  const [selectedMonth, setSelectedMonth] = useState('2026-09');
  const [branchFilter, setBranchFilter] = useState<BranchScope>(currentBranch);

  // Modals
  const [activePayslipRecord, setActivePayslipRecord] = useState<PayrollRecord | null>(null);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  // Adjustment Modal state
  const [adjustmentTarget, setAdjustmentTarget] = useState<{
    employee: Employee;
    currentAdj: number;
    reason: string;
  } | null>(null);

  // Mark Paid Modal state
  const [markPaidTarget, setMarkPaidTarget] = useState<{
    record: PayrollRecord;
    mode: 'Cash' | 'Bank Transfer';
    reference: string;
  } | null>(null);
  // Guard against double-submitting a disbursal (locks button on first click)
  const [isDisbursing, setIsDisbursing] = useState(false);

  const standardHours = payrollSettings.standardHoursPerMonth || 208;

  // Branch scope for this screen (Manager is locked to their branch).
  const payrollScope =
    currentUser.role === 'Manager'
      ? currentUser.assignedBranchId || 'coimbatore'
      : branchFilter;

  // Live computed payroll rows — shared with the Payroll Report (single truth).
  const payrollRows: PayrollRecord[] = computePayrollRows({
    employees,
    attendanceRecords,
    invoices,
    payrollRecords,
    month: selectedMonth,
    standardHours,
    branchScope: payrollScope,
  });

  // KPI calculations
  const totalGrossPayable = payrollRows.reduce((sum, r) => sum + r.finalPayable, 0);
  const totalHoursWorkedSum = payrollRows.reduce((sum, r) => sum + r.totalHoursWorked, 0);
  const paidCount = payrollRows.filter((r) => r.status === 'Paid').length;
  const pendingCount = payrollRows.filter((r) => r.status !== 'Paid').length;

  const handleSaveAdjustment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustmentTarget) return;

    updatePayrollAdjustment(
      adjustmentTarget.employee.id,
      selectedMonth,
      Number(adjustmentTarget.currentAdj),
      adjustmentTarget.reason.trim() || undefined
    );
    setAdjustmentTarget(null);
  };

  const handleConfirmPaid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!markPaidTarget || isDisbursing) return;

    setIsDisbursing(true);
    try {
      await markPayrollPaid(
        markPaidTarget.record,
        markPaidTarget.mode,
        markPaidTarget.reference.trim() || undefined
      );
      setMarkPaidTarget(null);
    } finally {
      setIsDisbursing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Select Pay Period
            </label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-3 py-1.5 text-xs font-bold rounded-xl border border-slate-300 bg-white text-slate-800 focus:outline-hidden focus:border-blue-500"
            />
          </div>

          {currentUser.role !== 'Manager' && (
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Branch Scope
              </label>
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value as BranchScope)}
                className="px-3 py-1.5 text-xs font-medium rounded-xl border border-slate-300 bg-white text-slate-800 focus:outline-hidden focus:border-blue-500"
              >
                <option value="all">All Branches</option>
                {BRANCHES.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Standard Hours Pill */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Standard Baseline
            </label>
            <div className="flex items-center gap-1.5">
              <span className="px-2.5 py-1 rounded-xl bg-slate-100 border border-slate-200 text-xs font-mono font-bold text-slate-700">
                {standardHours} hrs/mo
              </span>
              {currentUser.role === 'CEO' && (
                <button
                  onClick={() => setIsSettingsModalOpen(true)}
                  title="Configure standard working hours per month"
                  className="p-1 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors"
                >
                  <Settings className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-medium">
            Staff Enrolled: <strong className="text-slate-900">{payrollRows.length}</strong>
          </span>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center gap-3.5">
          <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
            <DollarSign className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Net Payable</p>
            <p className="text-xl font-black text-slate-900 font-mono mt-0.5">{formatCurrency(totalGrossPayable)}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{selectedMonth} Payroll Disbursal</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center gap-3.5">
          <div className="h-10 w-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Recorded Labor Hours</p>
            <p className="text-xl font-black text-slate-900 font-mono mt-0.5">{totalHoursWorkedSum.toFixed(1)} hrs</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Sum of all verified shift durations</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center gap-3.5">
          <div className="h-10 w-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold">
            <CreditCard className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Disbursement Status</p>
            <p className="text-xl font-black text-slate-900 font-mono mt-0.5">
              {paidCount} Paid <span className="text-slate-400 text-sm font-normal">/ {pendingCount} Draft</span>
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">Approved vs Pending Payment</p>
          </div>
        </div>
      </div>

      {/* Payroll Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 text-xs font-bold uppercase tracking-wider">
                <th className="py-3 px-4">Staff Member</th>
                <th className="py-3 px-3">Branch</th>
                <th className="py-3 px-3 text-right">Fixed Salary</th>
                <th className="py-3 px-3 text-center">Days / Hours</th>
                <th className="py-3 px-3 text-right">Hourly Rate</th>
                <th className="py-3 px-3 text-right">Computed Pay</th>
                <th className="py-3 px-3 text-right">Incentive</th>
                <th className="py-3 px-3 text-right">Adjustment</th>
                <th className="py-3 px-4 text-right">Final Payable</th>
                <th className="py-3 px-3 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payrollRows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-slate-400">
                    <DollarSign className="h-10 w-10 mx-auto text-slate-300 mb-2" />
                    <p className="text-sm font-medium text-slate-600">No employees for this period</p>
                  </td>
                </tr>
              ) : (
                payrollRows.map((row) => {
                  const emp = employees.find((e) => e.id === row.employeeId);
                  const branchObj = BRANCHES.find((b) => b.id === row.branchId);

                  return (
                    <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                      {/* Name & Role */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900">{row.employeeName}</div>
                        <div className="text-xs text-slate-400">{row.designation}</div>
                      </td>

                      {/* Branch */}
                      <td className="py-3.5 px-3">
                        <span className="text-xs text-slate-600 font-medium">
                          {branchObj?.name || row.branchId}
                        </span>
                      </td>

                      {/* Fixed Monthly Salary */}
                      <td className="py-3.5 px-3 text-right font-mono font-medium text-slate-700">
                        {canEditSalaries ? (
                          formatCurrency(row.monthlySalary)
                        ) : (
                          <span className="text-slate-400 font-sans text-xs italic">Confidential</span>
                        )}
                      </td>

                      {/* Days & Hours */}
                      <td className="py-3.5 px-3 text-center">
                        <div className="font-bold text-slate-900 font-mono">
                          {row.totalHoursWorked.toFixed(1)} hrs
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {row.totalDaysPresent} days present
                        </div>
                      </td>

                      {/* Hourly Rate */}
                      <td className="py-3.5 px-3 text-right font-mono text-xs text-slate-600">
                        ₹{row.hourlyRate.toFixed(2)}/h
                      </td>

                      {/* Computed Pay */}
                      <td className="py-3.5 px-3 text-right font-mono font-bold text-slate-900">
                        {formatCurrency(row.computedPay)}
                      </td>

                      {/* Salesperson incentive */}
                      <td className="py-3.5 px-3 text-right font-mono">
                        {(row.incentiveEarned || 0) > 0 ? (
                          <span className="font-bold text-violet-700">+{formatCurrency(row.incentiveEarned || 0)}</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      {/* Adjustment (+/-) */}
                      <td className="py-3.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {row.manualAdjustment !== 0 ? (
                            <span
                              className={`font-mono font-bold text-xs ${
                                row.manualAdjustment > 0 ? 'text-emerald-700' : 'text-rose-700'
                              }`}
                              title={row.adjustmentReason || 'Manual adjustment'}
                            >
                              {row.manualAdjustment > 0 ? '+' : ''}
                              {formatCurrency(row.manualAdjustment)}
                            </span>
                          ) : (
                            <span className="text-slate-300 text-xs">₹0</span>
                          )}

                          {canAdjustPayroll && emp && row.status !== 'Paid' && (
                            <button
                              type="button"
                              onClick={() =>
                                setAdjustmentTarget({
                                  employee: emp,
                                  currentAdj: row.manualAdjustment,
                                  reason: row.adjustmentReason || '',
                                })
                              }
                              title="Edit adjustment / bonus / deduction"
                              className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
                            >
                              <Edit className="h-3 w-3" />
                            </button>
                          )}
                          {row.status === 'Paid' && (
                            <span title="Disbursed — locked" className="text-slate-300">
                              <Lock className="h-3 w-3" />
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Final Net Payable */}
                      <td className="py-3.5 px-4 text-right font-mono font-black text-blue-700 text-base">
                        {formatCurrency(row.finalPayable)}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-3 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                            row.status === 'Paid'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                          }`}
                        >
                          {row.status === 'Paid' ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : (
                            <Clock className="h-3 w-3" />
                          )}
                          <span>{row.status}</span>
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {/* Mark as Paid (CEO Only) */}
                          {canMarkPayrollPaid && row.status !== 'Paid' && (
                            <button
                              onClick={() =>
                                setMarkPaidTarget({
                                  record: row,
                                  mode: 'Bank Transfer',
                                  reference: '',
                                })
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-2xs transition-colors"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>Pay</span>
                            </button>
                          )}

                          {/* View Payslip */}
                          <button
                            onClick={() => setActivePayslipRecord(row)}
                            title="Print / View Payslip"
                            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
                          >
                            <FileText className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manual Adjustment Modal */}
      {adjustmentTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                Adjust Pay: {adjustmentTarget.employee.name}
              </h3>
              <button
                onClick={() => setAdjustmentTarget(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveAdjustment} className="p-4 sm:p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  Adjustment Amount (₹)
                </label>
                <input
                  type="number"
                  step="100"
                  value={adjustmentTarget.currentAdj}
                  onChange={(e) =>
                    setAdjustmentTarget({
                      ...adjustmentTarget,
                      currentAdj: Number(e.target.value),
                    })
                  }
                  placeholder="e.g. +1500 for bonus, -500 for advance"
                  className="w-full px-3 py-2 text-sm font-bold font-mono rounded-xl border border-slate-300 focus:outline-hidden focus:border-blue-500"
                  autoFocus
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Use positive numbers for bonuses/incentives, negative numbers for deductions/advance repayments.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  Reason / Description
                </label>
                <input
                  type="text"
                  value={adjustmentTarget.reason}
                  onChange={(e) =>
                    setAdjustmentTarget({
                      ...adjustmentTarget,
                      reason: e.target.value,
                    })
                  }
                  placeholder="e.g. Festival performance bonus, Cash advance deduction"
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:border-blue-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAdjustmentTarget(null)}
                  className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs"
                >
                  Apply Adjustment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Mark As Paid Modal */}
      {markPaidTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Mark Payroll Disbursed</h3>
                <p className="text-xs text-slate-500">
                  {markPaidTarget.record.employeeName} • {formatCurrency(markPaidTarget.record.finalPayable)}
                </p>
              </div>
              <button
                onClick={() => setMarkPaidTarget(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleConfirmPaid} className="p-4 sm:p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  Disbursement Payment Mode
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(['Bank Transfer', 'Cash'] as const).map((m) => (
                    <button
                      type="button"
                      key={m}
                      onClick={() => setMarkPaidTarget({ ...markPaidTarget, mode: m })}
                      className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all ${
                        markPaidTarget.mode === m
                          ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-xs'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  Payment Reference / Note (Optional)
                </label>
                <input
                  type="text"
                  value={markPaidTarget.reference}
                  onChange={(e) =>
                    setMarkPaidTarget({
                      ...markPaidTarget,
                      reference: e.target.value,
                    })
                  }
                  placeholder="e.g. IMPS Ref #99238411, Cash voucher #104"
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:border-blue-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setMarkPaidTarget(null)}
                  disabled={isDisbursing}
                  className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isDisbursing}
                  className="px-5 py-2 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isDisbursing ? 'Processing…' : 'Confirm Disbursal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payslip View Modal */}
      <PayslipModal
        isOpen={Boolean(activePayslipRecord)}
        onClose={() => setActivePayslipRecord(null)}
        payrollRecord={activePayslipRecord}
      />

      {/* Settings Modal */}
      <PayrollSettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
      />
    </div>
  );
};
