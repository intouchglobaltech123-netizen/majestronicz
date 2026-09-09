import React, { useState } from 'react';
import { Enquiry } from '../../types';
import {
  Bell,
  Calendar,
  Clock,
  X,
  CheckCircle2,
  User,
  Sparkles,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  enquiry: Enquiry | null;
  onConfirm: (dueDate: string, dueTime: string, notes?: string) => void;
}

export const FollowUpReminderModal: React.FC<Props> = ({
  isOpen,
  onClose,
  enquiry,
  onConfirm,
}) => {
  const getTodayStr = () => new Date().toISOString().split('T')[0];
  const getTomorrowStr = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  };
  const getInDaysStr = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  };

  const [dueDate, setDueDate] = useState<string>(() => {
    return enquiry?.reminderDate || getTomorrowStr();
  });

  const [dueTime, setDueTime] = useState<string>(() => {
    return enquiry?.reminderTime || '11:00';
  });

  const [notes, setNotes] = useState<string>(() => {
    return (
      enquiry?.reminderNotes ||
      'Follow up on customer requirement and pricing quotation.'
    );
  });

  // Re-sync if enquiry changes
  React.useEffect(() => {
    if (enquiry) {
      if (enquiry.reminderDate) setDueDate(enquiry.reminderDate);
      else setDueDate(getTomorrowStr());

      if (enquiry.reminderTime) setDueTime(enquiry.reminderTime);
      else setDueTime('11:00');

      if (enquiry.reminderNotes) setNotes(enquiry.reminderNotes);
    }
  }, [enquiry]);

  if (!isOpen || !enquiry) return null;

  const quickPresets = [
    { label: 'Today', value: getTodayStr() },
    { label: 'Tomorrow', value: getTomorrowStr() },
    { label: 'In 3 Days', value: getInDaysStr(3) },
    { label: 'Next Week', value: getInDaysStr(7) },
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dueDate || !dueTime) {
      toast.error('Please specify both a Reminder Date and Time.');
      return;
    }
    onConfirm(dueDate, dueTime, notes.trim() || undefined);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-amber-50/50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-700 shadow-2xs">
              <Bell className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Schedule Follow-up Reminder
              </h2>
              <p className="text-xs text-slate-500">
                Surfaces in notification bell on due date with 1-click actions
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Enquiry Context Bar */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
              {enquiry.enquiryNumber}
            </span>
            <div className="flex items-center gap-1 font-semibold text-slate-800">
              <User className="h-3 w-3 text-slate-400" />
              <span>{enquiry.customerName}</span>
            </div>
          </div>
          <span className="text-[11px] text-slate-500 font-mono">
            {enquiry.itemName} ({enquiry.quantity} {enquiry.unit})
          </span>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Quick Date Presets */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-2">
              Quick Presets
            </label>
            <div className="grid grid-cols-4 gap-2">
              {quickPresets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setDueDate(preset.value)}
                  className={cn(
                    'py-2 px-2.5 rounded-xl text-xs font-semibold border transition-all text-center',
                    dueDate === preset.value
                      ? 'bg-amber-500 text-white border-amber-500 shadow-xs'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Due Date & Due Time */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Reminder Date <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="date"
                  required
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full pl-3 pr-8 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 focus:outline-none focus:border-amber-500"
                />
                <Calendar className="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Reminder Time <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="time"
                  required
                  value={dueTime}
                  onChange={(e) => setDueTime(e.target.value)}
                  className="w-full pl-3 pr-8 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 focus:outline-none focus:border-amber-500 font-mono"
                />
                <Clock className="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Reminder Notes / Objective */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Reminder Objective / Staff Instructions
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Call customer to confirm if estimate accepted and collect advance..."
              className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-amber-500 resize-none placeholder-slate-400"
            />
          </div>

          {/* Info Notice */}
          <div className="p-3 bg-amber-50 border border-amber-200/70 rounded-xl text-[11px] text-amber-800 flex items-start gap-2">
            <Sparkles className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <p>
              On <strong>{dueDate}</strong> at <strong>{dueTime}</strong>, this reminder will flash in the TopBar Bell icon. Staff can jump directly into this Enquiry to convert or update.
            </p>
          </div>

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-xs transition-colors flex items-center gap-1.5"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>Confirm & Schedule Reminder</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
