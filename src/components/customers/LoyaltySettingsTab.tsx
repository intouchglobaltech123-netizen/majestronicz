import React, { useState, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import { formatCurrency } from '../../lib/utils';
import {
  Sparkles,
  Save,
  AlertCircle,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';

export const LoyaltySettingsTab: React.FC = () => {
  const { loyaltySettings, updateLoyaltySettings, canManageLoyalty } = useErp();

  const [threshold, setThreshold] = useState<number>(loyaltySettings.purchaseThreshold);
  const [discountType, setDiscountType] = useState<'percentage' | 'flat'>(
    loyaltySettings.discountType
  );
  const [discountValue, setDiscountValue] = useState<number>(loyaltySettings.discountValue);
  const [isActive, setIsActive] = useState<boolean>(loyaltySettings.isActive);

  useEffect(() => {
    setThreshold(loyaltySettings.purchaseThreshold);
    setDiscountType(loyaltySettings.discountType);
    setDiscountValue(loyaltySettings.discountValue);
    setIsActive(loyaltySettings.isActive);
  }, [loyaltySettings]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageLoyalty) {
      toast.error('Only CEO or Manager can modify loyalty rules');
      return;
    }

    if (threshold <= 0) {
      toast.error('Purchase threshold must be at least 1');
      return;
    }

    if (discountValue <= 0) {
      toast.error('Discount value must be greater than 0');
      return;
    }

    if (discountType === 'percentage' && discountValue > 100) {
      toast.error('Percentage discount cannot exceed 100%');
      return;
    }

    updateLoyaltySettings({
      purchaseThreshold: Number(threshold),
      discountType,
      discountValue: Number(discountValue),
      isActive,
    });
  };

  const currentRuleText = isActive
    ? `Every ${threshold} purchases → ${discountValue}${discountType === 'percentage' ? '%' : '₹'} off entire bill`
    : 'Loyalty Program is currently paused';

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-150">
      {/* Active Rule Banner */}
      <div className="p-6 rounded-3xl bg-linear-to-r from-amber-500 via-amber-600 to-orange-600 text-white shadow-lg space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-amber-100 text-xs font-bold uppercase tracking-wider">
            <Sparkles className="h-4 w-4 text-amber-200" />
            <span>Active Loyalty Rule</span>
          </div>
          <span
            className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold ${
              isActive ? 'bg-white/20 text-white' : 'bg-rose-950/40 text-rose-200'
            }`}
          >
            {isActive ? '● Live & Enforcing' : '○ Paused'}
          </span>
        </div>

        <div className="text-2xl font-black tracking-tight">{currentRuleText}</div>

        <p className="text-xs text-amber-100/90 leading-relaxed max-w-2xl">
          Rules apply globally across all branches in real-time. When a customer reaches this
          milestone, an interactive discount banner pops up during billing with 1-click apply.
        </p>
      </div>

      {/* Permission Warning for Billing Role */}
      {!canManageLoyalty && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 flex items-center gap-3 text-xs">
          <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
          <span>
            <strong>View Only:</strong> Only CEO Sathish Kumar or Branch Managers have permission to
            modify loyalty milestone rules.
          </span>
        </div>
      )}

      {/* Settings Form Card */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-xs space-y-6">
        <div className="border-b border-slate-100 pb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-extrabold text-slate-900 tracking-tight">
              Rule Configuration
            </h3>
            <p className="text-xs text-slate-500">
              Customize the milestone interval and reward value given to repeat customers
            </p>
          </div>
          <div className="flex items-center gap-1 text-xs text-slate-400">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <span>CEO-controlled</span>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          {/* Program Status Toggle */}
          <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-200">
            <div>
              <span className="text-xs font-bold text-slate-900 block">
                Enable Customer Loyalty Engine
              </span>
              <span className="text-[11px] text-slate-500">
                Track purchase counts and highlight milestone discounts on the billing screen
              </span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                disabled={!canManageLoyalty}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Purchase Threshold */}
            <div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                Purchase Threshold (Milestone Interval)
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="1"
                  step="1"
                  required
                  disabled={!canManageLoyalty}
                  value={threshold || ''}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white disabled:opacity-75"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">
                  purchases
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                e.g. Every 10 purchases, every 5 purchases, or every 8 purchases.
              </p>
            </div>

            {/* Reward Type */}
            <div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                Reward Discount Type
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDiscountType('percentage')}
                  disabled={!canManageLoyalty}
                  className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition-all ${
                    discountType === 'percentage'
                      ? 'bg-blue-50 border-blue-600 text-blue-700 shadow-2xs'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Percentage (%)
                </button>
                <button
                  type="button"
                  onClick={() => setDiscountType('flat')}
                  disabled={!canManageLoyalty}
                  className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition-all ${
                    discountType === 'flat'
                      ? 'bg-blue-50 border-blue-600 text-blue-700 shadow-2xs'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Flat Amount (₹)
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                Choose percentage discount off the bill or fixed rupee waiver.
              </p>
            </div>

            {/* Discount Value */}
            <div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                Discount Value
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="0.1"
                  step={discountType === 'percentage' ? '0.5' : '10'}
                  max={discountType === 'percentage' ? '100' : undefined}
                  required
                  disabled={!canManageLoyalty}
                  value={discountValue || ''}
                  onChange={(e) => setDiscountValue(Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white disabled:opacity-75"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">
                  {discountType === 'percentage' ? '%' : '₹'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                {discountType === 'percentage'
                  ? 'e.g. 10% off total invoice value.'
                  : 'e.g. ₹500 flat deducted from bill.'}
              </p>
            </div>

            {/* Example Preview Card */}
            <div className="p-4 rounded-2xl bg-blue-50/60 border border-blue-200/80 space-y-1.5 flex flex-col justify-center">
              <span className="text-[11px] font-bold text-blue-900 uppercase tracking-wider flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-blue-600" />
                Live Example
              </span>
              <p className="text-xs text-blue-950 font-medium leading-relaxed">
                On a ₹5,000 bill, a customer at their {threshold}th purchase will be eligible for{' '}
                <strong className="font-bold text-blue-700">
                  {discountType === 'percentage'
                    ? `${formatCurrency((5000 * discountValue) / 100)} (${discountValue}%)`
                    : formatCurrency(discountValue)}
                </strong>{' '}
                discount with one click!
              </p>
            </div>
          </div>

          {canManageLoyalty && (
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="submit"
                className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors"
              >
                <Save className="h-4 w-4" />
                <span>Save Loyalty Settings</span>
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};
