import React, { useState, useEffect } from 'react';
import { X, Settings, Clock, Check, HelpCircle, CalendarDays } from 'lucide-react';
import { useErp } from '../../context/ErpContext';

interface PayrollSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PayrollSettingsModal: React.FC<PayrollSettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { payrollSettings, updatePayrollSettings } = useErp();
  const [standardHours, setStandardHours] = useState<number>(208);
  const [casualLeaves, setCasualLeaves] = useState<number>(1);

  useEffect(() => {
    if (isOpen) {
      setStandardHours(payrollSettings.standardHoursPerMonth || 208);
      setCasualLeaves(payrollSettings.monthlyCasualLeaves ?? 1);
    }
  }, [isOpen, payrollSettings]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (standardHours <= 0 || casualLeaves < 0) return;
    updatePayrollSettings({ standardHoursPerMonth: standardHours, monthlyCasualLeaves: casualLeaves });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-none shadow-2xl border border-slate-300 w-full max-w-md overflow-y-auto max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-300 bg-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-none bg-red-50 text-red-700 flex items-center justify-center border border-red-200">
              <Settings className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Payroll Calculation Settings</h3>
              <p className="text-xs text-slate-500">Day-based Loss-of-Pay &amp; paid-leave rules</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-none transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Paid Casual Leave / Month
            </label>
            <div className="relative">
              <CalendarDays className="absolute left-3.5 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="number"
                min={0}
                max={10}
                step={1}
                value={casualLeaves}
                onChange={(e) => setCasualLeaves(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                className="w-full pl-10 pr-4 py-2 text-sm font-mono font-bold rounded-none border border-slate-300 bg-white focus:outline-hidden focus:border-red-600"
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Paid leave days allowed before Loss-of-Pay starts. Casual + Sick leave share this. Sundays (Week Off) &amp; Holidays are always free.
            </p>
          </div>

          <div className="p-3.5 bg-slate-50 border border-slate-300 rounded-none text-xs space-y-1.5 text-slate-800">
            <p className="font-bold flex items-center gap-1.5 text-slate-900">
              <HelpCircle className="h-4 w-4 text-red-700" />
              <span>How Loss-of-Pay is Calculated (day-based):</span>
            </p>
            <div className="text-[11px] leading-relaxed text-slate-700 space-y-1 font-mono">
              <p>• Per-Day = Monthly Salary ÷ actual days in that month (30/31)</p>
              <p>• LOP days = Absent + ½×Half-Day + leave beyond the quota</p>
              <p>• Earned Pay = Monthly Salary − (LOP days × Per-Day)</p>
              <p className="text-slate-400">e.g. ₹10,000 ÷ 30 = ₹333/day; 2 LOP days → −₹666</p>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Standard Working Hours / Month <span className="font-normal normal-case text-slate-400">(reference only)</span>
            </label>
            <div className="relative">
              <Clock className="absolute left-3.5 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="number"
                min={50}
                max={350}
                value={standardHours}
                onChange={(e) => setStandardHours(Number(e.target.value))}
                className="w-full pl-10 pr-4 py-2 text-sm font-mono font-bold rounded-none border border-slate-300 bg-white focus:outline-hidden focus:border-red-600"
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              No longer used for pay (pay is day-based). Kept for reference reports.
            </p>
          </div>

          {/* Actions */}
          <div className="pt-3 border-t border-slate-300 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-none border border-slate-300 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 active:bg-red-800 rounded-none border border-red-700 shadow-none cursor-pointer transition-colors"
            >
              <Check className="h-4 w-4" />
              <span>Save Setting</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
