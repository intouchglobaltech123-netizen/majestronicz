import React, { useState, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import { Item } from '../../types';
import { X, Sliders, Check } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  item: Item | null;
}

export const ThresholdEditModal: React.FC<Props> = ({
  isOpen,
  onClose,
  item,
}) => {
  const { updateItemThreshold, canManageItems } = useErp();
  const [threshold, setThreshold] = useState<number | ''>(10);

  useEffect(() => {
    if (item) {
      setThreshold(item.reorderThreshold ?? 10);
    }
    // Seed once per opened item — not on the item reference changing
    // (live-sync re-bootstrap), which would reset the field mid-entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, isOpen]);

  if (!isOpen || !item) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (threshold === '' || threshold < 0) return;
    updateItemThreshold(item.id, Number(threshold));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white border border-slate-300 rounded-none w-full max-w-sm shadow-2xl overflow-y-auto max-h-[90vh] text-slate-900">
        <div className="px-5 py-4 border-b border-slate-300 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-none bg-red-50 border border-red-200 flex items-center justify-center text-red-700">
              <Sliders className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Edit Alert Threshold</h3>
              <p className="text-[11px] text-slate-500">Applies uniformly across all branches</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-none text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="p-3 rounded-none bg-slate-50 border border-slate-300">
            <div className="text-xs font-bold text-slate-900">{item.itemName}</div>
            <div className="font-mono text-[11px] text-slate-500 mt-0.5">{item.itemCode} • {item.unit}</div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              Low Stock Alert Threshold
            </label>
            <div className="relative">
              <input
                type="number"
                min="0"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value) || 0))}
                className="w-full px-3.5 py-2.5 rounded-none bg-white border border-slate-300 text-slate-900 font-bold text-base focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 pr-12 text-center"
                autoFocus
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">
                {item.unit}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
              When branch stock drops to or below this quantity, the item is flagged as <strong>Low Stock</strong> on Dashboard & Inventory screens.
            </p>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-300">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-none text-xs font-semibold text-slate-700 hover:bg-slate-100 border border-slate-300 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canManageItems || threshold === ''}
              className="px-4 py-2 rounded-none text-xs font-bold uppercase tracking-wider text-white bg-red-600 hover:bg-red-700 active:bg-red-800 border border-red-700 shadow-none transition-colors disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
            >
              <Check className="h-3.5 w-3.5" />
              <span>Save Threshold</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
