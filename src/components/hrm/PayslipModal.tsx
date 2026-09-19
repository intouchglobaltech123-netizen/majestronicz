import React from 'react';
import { PayrollRecord, COMPANY_PROFILE, BRANCHES } from '../../types';
import { MajestroniczLogo } from '../common/MajestroniczLogo';
import { formatCurrency } from '../../lib/utils';
import { numberToWordsIndian } from '../../lib/numberToWords';
import { X, Printer, CheckCircle2, Clock } from 'lucide-react';

interface PayslipModalProps {
  isOpen: boolean;
  onClose: () => void;
  payrollRecord: PayrollRecord | null;
}

export const PayslipModal: React.FC<PayslipModalProps> = ({
  isOpen,
  onClose,
  payrollRecord,
}) => {
  if (!isOpen || !payrollRecord) return null;

  const branchObj = BRANCHES.find((b) => b.id === payrollRecord.branchId);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/70 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto print:p-0 print:bg-white">
      <div className="bg-white border border-slate-300 rounded-none w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[94vh] print:max-h-none print:border-none print:shadow-none print:w-full print:rounded-none">
        {/* Action Header (Hidden when printing) */}
        <div className="px-6 py-3.5 border-b border-slate-300 bg-slate-100 flex items-center justify-between print:hidden shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Salary Payslip Voucher
            </span>
            <span className="text-xs font-mono font-bold text-slate-900 bg-slate-200 px-2 py-0.5 rounded-none border border-slate-300">
              {payrollRecord.month}
            </span>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-none border ${
                payrollRecord.status === 'Paid'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200'
              }`}
            >
              {payrollRecord.status === 'Paid' ? 'PAID' : 'DRAFT'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-white bg-red-600 hover:bg-red-700 active:bg-red-800 rounded-none border border-red-700 transition-colors shadow-none cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Print Payslip</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-none text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors ml-2"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Printable Payslip Body */}
        <div className="flex-1 overflow-y-auto p-8 bg-white print:p-0 print:overflow-visible text-slate-900 font-sans">
          {/* Header */}
          <div className="border-b-2 border-slate-900 pb-4 mb-6">
            <div className="flex justify-between items-start">
              <div>
                <MajestroniczLogo />
                <div className="mt-2 text-xs text-slate-600 space-y-0.5">
                  <p className="font-bold text-slate-900">{COMPANY_PROFILE.name}</p>
                  <p>{COMPANY_PROFILE.address}</p>
                  <p className="font-mono">GSTIN: {COMPANY_PROFILE.gstin}</p>
                </div>
              </div>

              <div className="text-right">
                <div className="inline-block bg-slate-900 text-white px-3 py-1 rounded-none text-xs font-black tracking-widest uppercase mb-1.5">
                  SALARY PAYSLIP
                </div>
                <p className="text-xs font-bold text-slate-900">
                  Pay Period: {payrollRecord.month}
                </p>
                <p className="text-[11px] text-slate-500">
                  Branch: {branchObj?.name || payrollRecord.branchId}
                </p>
              </div>
            </div>
          </div>

          {/* Employee & Shift Summary Box */}
          <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 rounded-none border border-slate-300 text-xs mb-6">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Employee Details</p>
              <p className="font-bold text-slate-900 text-sm mt-0.5">{payrollRecord.employeeName}</p>
              <p className="text-slate-600 font-medium">{payrollRecord.designation}</p>
              <p className="text-slate-500 font-mono mt-0.5">Emp ID: {payrollRecord.employeeId}</p>
            </div>

            <div className="border-l border-slate-300 pl-4 space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Attendance Metrics</p>
              <div className="flex justify-between">
                <span className="text-slate-600">Standard Monthly Hours:</span>
                <span className="font-mono font-bold text-slate-900">{payrollRecord.standardHoursPerMonth} hrs</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Recorded Hours Worked:</span>
                <span className="font-mono font-bold text-slate-900">{payrollRecord.totalHoursWorked.toFixed(1)} hrs</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Days Present:</span>
                <span className="font-mono font-bold text-emerald-700">{payrollRecord.totalDaysPresent} shifts</span>
              </div>
            </div>
          </div>

          {/* Earnings & Deductions Breakdown Table */}
          <table className="w-full border-collapse text-xs mb-6">
            <thead>
              <tr className="border-y-2 border-slate-800 bg-slate-100 text-slate-800 font-bold uppercase tracking-wider">
                <th className="py-2.5 px-3 text-left">Salary & Remuneration Components</th>
                <th className="py-2.5 px-3 text-right w-36">Calculation Basis</th>
                <th className="py-2.5 px-3 text-right w-32">Amount (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              <tr>
                <td className="py-2.5 px-3 font-semibold text-slate-900">Agreed Fixed Monthly Salary</td>
                <td className="py-2.5 px-3 text-right font-mono text-slate-600">Full Month</td>
                <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900">
                  {formatCurrency(payrollRecord.monthlySalary)}
                </td>
              </tr>
              <tr>
                <td className="py-2.5 px-3 text-slate-700">Effective Hourly Rate</td>
                <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                  ₹{payrollRecord.monthlySalary} ÷ {payrollRecord.standardHoursPerMonth}h
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                  ₹{payrollRecord.hourlyRate.toFixed(2)}/hr
                </td>
              </tr>
              <tr className="bg-slate-50">
                <td className="py-2.5 px-3 font-bold text-slate-900">
                  Computed Pay (Actual Recorded Attendance)
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-slate-800">
                  {payrollRecord.totalHoursWorked.toFixed(1)}h × ₹{payrollRecord.hourlyRate.toFixed(2)}
                </td>
                <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                  {formatCurrency(payrollRecord.computedPay)}
                </td>
              </tr>
              {!!payrollRecord.incentiveEarned && payrollRecord.incentiveEarned !== 0 && (
                <tr className="bg-emerald-50/40">
                  <td className="py-2.5 px-3">
                    <span className="font-semibold text-slate-900">Sales Incentive</span>
                    <p className="text-[11px] text-slate-500 italic mt-0.5">Earned on attributed sales (net of returns)</p>
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-500">Auto-computed</td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700">
                    +{formatCurrency(payrollRecord.incentiveEarned)}
                  </td>
                </tr>
              )}
              {payrollRecord.manualAdjustment !== 0 && (
                <tr className={payrollRecord.manualAdjustment > 0 ? 'bg-emerald-50/40' : 'bg-rose-50/40'}>
                  <td className="py-2.5 px-3">
                    <span className="font-semibold text-slate-900">
                      {payrollRecord.manualAdjustment > 0 ? 'Incentive / Bonus' : 'Deductions / Advance Adjustment'}
                    </span>
                    {payrollRecord.adjustmentReason && (
                      <p className="text-[11px] text-slate-500 italic mt-0.5">{payrollRecord.adjustmentReason}</p>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-500">Manual Entry</td>
                  <td
                    className={`py-2.5 px-3 text-right font-mono font-bold ${
                      payrollRecord.manualAdjustment > 0 ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    {payrollRecord.manualAdjustment > 0 ? '+' : ''}
                    {formatCurrency(payrollRecord.manualAdjustment)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Net Payable & Words */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="p-3 bg-slate-50 rounded-none border border-slate-300 text-xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                NET PAYABLE IN WORDS
              </span>
              <p className="font-medium text-slate-800 italic leading-relaxed">
                {numberToWordsIndian(payrollRecord.finalPayable)}
              </p>
            </div>

            <div className="p-4 bg-slate-50 rounded-none border border-slate-300 flex flex-col justify-between text-right">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                Net Take-Home Salary
              </span>
              <span className="text-2xl font-black font-mono text-red-700">
                {formatCurrency(payrollRecord.finalPayable)}
              </span>
            </div>
          </div>

          {/* Payment Status Stamp */}
          {payrollRecord.status === 'Paid' ? (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-none flex items-center justify-between text-xs text-emerald-900 mb-6">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>
                  <strong>Disbursed on:</strong>{' '}
                  {payrollRecord.paidAt ? new Date(payrollRecord.paidAt).toLocaleDateString() : 'Paid'} via{' '}
                  <span className="font-bold">{payrollRecord.paymentMode}</span>
                  {payrollRecord.paymentReference && ` (${payrollRecord.paymentReference})`}
                </span>
              </div>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-none bg-emerald-600 text-white">
                Verified Paid
              </span>
            </div>
          ) : (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-none flex items-center gap-2 text-xs text-amber-900 mb-6">
              <Clock className="h-4 w-4 text-amber-600 shrink-0" />
              <span>Pending Disbursement — Subject to CEO approval</span>
            </div>
          )}

          {/* Signatures */}
          <div className="pt-6 border-t border-slate-300 grid grid-cols-2 gap-12 text-xs">
            <div>
              <div className="h-10" />
              <div className="border-t border-slate-400 w-48 pt-1 text-slate-600">
                Employee Signature / Acknowledgment
              </div>
            </div>
            <div className="flex flex-col items-end text-right">
              <div className="h-10" />
              <div className="border-t border-slate-400 w-48 pt-1 text-slate-800 font-bold">
                For {COMPANY_PROFILE.name}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
