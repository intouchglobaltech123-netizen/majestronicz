import React, { useState, useEffect } from 'react';
import { X, Settings, Clock, Check, HelpCircle } from 'lucide-react';
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

  useEffect(() => {
    if (isOpen) {
      setStandardHours(payrollSettings.standardHoursPerMonth || 208);
    }
  }, [isOpen, payrollSettings]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (standardHours <= 0) return;
    updatePayrollSettings({ standardHoursPerMonth: standardHours });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-200/60">
              <Settings className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Payroll Calculation Settings</h3>
              <p className="text-xs text-slate-500">Configurable monthly standard working hours</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Standard Working Hours / Month
            </label>
            <div className="relative">
              <Clock className="absolute left-3.5 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="number"
                min={50}
                max={350}
                value={standardHours}
                onChange={(e) => setStandardHours(Number(e.target.value))}
                className="w-full pl-10 pr-4 py-2 text-sm font-mono font-bold rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:border-blue-500"
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Standard guideline: 26 working days × 8 hours = <strong>208 hours/month</strong>
            </p>
          </div>

          <div className="p-3.5 bg-blue-50/70 border border-blue-200 rounded-xl text-xs space-y-1.5 text-blue-900">
            <p className="font-bold flex items-center gap-1.5">
              <HelpCircle className="h-4 w-4 text-blue-600" />
              <span>How Hourly Pay is Derived:</span>
            </p>
            <div className="text-[11px] leading-relaxed text-blue-800 space-y-1 font-mono">
              <p>• Hourly Rate = Employee Monthly Salary ÷ Standard Hours/Month</p>
              <p>• Computed Pay = Hourly Rate × Actual Recorded Hours</p>
            </div>
          </div>

          {/* Actions */}
          <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs transition-colors"
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
