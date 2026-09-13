import React, { useState, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import { Item, BranchId, BRANCHES } from '../../types';
import { X, MapPin, Check } from 'lucide-react';
import { toast } from 'sonner';

interface EditLocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: Item | null;
  targetBranchId?: BranchId;
}

export const EditLocationModal: React.FC<EditLocationModalProps> = ({
  isOpen,
  onClose,
  item,
  targetBranchId,
}) => {
  const { getBranchStock, updateBranchStockLocation, currentBranch, isAllBranches } = useErp();

  const [locations, setLocations] = useState<Record<BranchId, string>>({
    'erode-hq': '',
    'coimbatore': '',
    'chennai': '',
  });

  useEffect(() => {
    if (item && isOpen) {
      setLocations({
        'erode-hq': getBranchStock(item.id, 'erode-hq')?.location || '',
        'coimbatore': getBranchStock(item.id, 'coimbatore')?.location || '',
        'chennai': getBranchStock(item.id, 'chennai')?.location || '',
      });
    }
  }, [item, isOpen, getBranchStock]);

  if (!isOpen || !item) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;

    if (!isAllBranches && targetBranchId) {
      updateBranchStockLocation(item.id, targetBranchId, locations[targetBranchId].trim() || undefined);
    } else if (!isAllBranches && currentBranch !== 'all') {
      updateBranchStockLocation(item.id, currentBranch, locations[currentBranch].trim() || undefined);
    } else {
      BRANCHES.forEach((b) => {
        updateBranchStockLocation(item.id, b.id, locations[b.id].trim() || undefined);
      });
    }

    toast.success(`Rack / Row locations updated for ${item.itemName}`);
    onClose();
  };

  const branchesToEdit = (!isAllBranches && targetBranchId)
    ? BRANCHES.filter((b) => b.id === targetBranchId)
    : (!isAllBranches && currentBranch !== 'all')
    ? BRANCHES.filter((b) => b.id === currentBranch)
    : BRANCHES;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-slate-900">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-blue-100 border border-blue-200 flex items-center justify-center text-blue-700">
              <MapPin className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Physical Rack / Row Location</h2>
              <p className="text-xs text-slate-500">Assign physical shelf or warehouse location</p>
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
        <form onSubmit={handleSave} className="p-6 space-y-4">
          {/* Item details */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                  {item.itemCode}
                </span>
                <span className="text-xs text-slate-500">{item.category}</span>
                {item.subcategory && (
                  <span className="text-xs text-slate-400">/ {item.subcategory}</span>
                )}
              </div>
              <h3 className="text-sm font-bold text-slate-900 mt-1">{item.itemName}</h3>
            </div>
          </div>

          {/* Location inputs per branch */}
          <div className="space-y-3 pt-1">
            {branchesToEdit.map((b) => (
              <div key={b.id} className="p-3.5 rounded-xl border border-slate-200 bg-white">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold text-slate-800">{b.name}</span>
                  <span className="text-[10px] uppercase font-semibold text-slate-400">
                    {b.shortCode} • Stock: {getBranchStock(item.id, b.id)?.quantity ?? 0} {item.unit}
                  </span>
                </div>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 h-3.5 w-3.5" />
                  <input
                    type="text"
                    value={locations[b.id] || ''}
                    onChange={(e) => setLocations((prev) => ({ ...prev, [b.id]: e.target.value }))}
                    placeholder="e.g. Rack R2, Shelf B-4, Bay 12"
                    className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Footer Actions */}
          <div className="pt-3 flex items-center justify-end gap-2.5 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-xs transition-all flex items-center gap-1.5"
            >
              <Check className="h-4 w-4" />
              <span>Save Location</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
