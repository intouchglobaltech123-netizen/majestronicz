import React, { useState, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import { X, Settings, Clock, AlertTriangle, Check, ShieldCheck } from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const PRESET_DAYS = [30, 60, 90, 120, 180];

export const InventorySettingsModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { inventorySettings, updateInventorySettings } = useErp();
  const [thresholdDays, setThresholdDays] = useState<number>(inventorySettings.deadStockThresholdDays || 90);

  useEffect(() => {
    if (isOpen) {
      setThresholdDays(inventorySettings.deadStockThresholdDays || 90);
    }
  }, [isOpen, inventorySettings.deadStockThresholdDays]);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (isNaN(thresholdDays) || thresholdDays < 1) {
      toast.error('Please enter a valid threshold in days (minimum 1 day)');
      return;
    }

    updateInventorySettings({ deadStockThresholdDays: thresholdDays });
    toast.success('Dead Stock threshold updated', {
      description: `Items with no sales in ${thresholdDays}+ days will be flagged as "Not Moving".`,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col text-slate-900">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-blue-100 border border-blue-200 flex items-center justify-center text-blue-700">
              <Settings className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Inventory Settings</h2>
              <p className="text-xs text-slate-500">Configure dead-stock and movement criteria</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-6 space-y-5">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-blue-600" />
                <span>"Not Moving" / Dead Stock Threshold</span>
              </label>
              <span className="text-[11px] font-mono font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                {thresholdDays} Days
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mb-3">
              Items with zero sales recorded, or with their most recent sale older than this number of days, will be labeled <strong>Not Moving</strong> with an alert badge.
            </p>

            {/* Presets */}
            <div className="grid grid-cols-5 gap-1.5 mb-3">
              {PRESET_DAYS.map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setThresholdDays(days)}
                  className={cn(
                    'py-1.5 text-xs font-bold rounded-lg border transition-all',
                    thresholdDays === days
                      ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                      : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                  )}
                >
                  {days}d
                </button>
              ))}
            </div>

            {/* Custom Input */}
            <div className="relative">
              <input
                type="number"
                min="1"
                max="3650"
                value={thresholdDays}
                onChange={(e) => setThresholdDays(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 font-bold text-sm focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20 pr-16"
                required
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">
                Days
              </span>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 text-[11px] text-amber-800 space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-amber-900">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-700" />
              <span>Zero-Sales Handling</span>
            </div>
            <p>
              Catalog items with <strong>zero sales ever recorded</strong> will automatically flag as "Not Moving (Never Sold)" regardless of the number of days, ensuring no slow-moving inventory is overlooked.
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 flex items-start gap-2">
            <ShieldCheck className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
            <span>
              This threshold dynamically updates the Inventory list indicators, the "Not Moving" filter counts, and the Dashboard KPI card.
            </span>
          </div>

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-xs hover:shadow transition-all flex items-center gap-1.5"
            >
              <Check className="h-4 w-4" />
              <span>Save Settings</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
