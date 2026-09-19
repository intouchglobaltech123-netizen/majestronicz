import React from 'react';
import { Item, BRANCHES } from '../../types';
import { useErp } from '../../context/ErpContext';
import { formatCurrency } from '../../lib/utils';
import { X, Building2, Layers, CheckCircle2, ArrowRight } from 'lucide-react';
import { cn } from '../../lib/utils';

interface Props {
  item: Item | null;
  onClose: () => void;
}

export const BranchStockModal: React.FC<Props> = ({ item, onClose }) => {
  const { getBranchStock, currentBranch, navigateToInventoryItem } = useErp();

  if (!item) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white border border-slate-300 rounded-none w-full max-w-2xl shadow-xl overflow-hidden flex flex-col text-slate-900">
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-none bg-red-50 border border-red-200 flex items-center justify-center text-red-700">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">{item.itemName}</h2>
                <span className="text-xs px-2 py-0.5 rounded-none bg-white text-red-700 border border-slate-300 font-mono font-bold">
                  {item.itemCode}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Multi-Branch Physical Stock Distribution
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-none text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 space-y-6 bg-white">
          {/* Static Pricing Header Reminder */}
          <div className="p-3.5 rounded-none bg-slate-50 border border-slate-200 flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-500 block">Master Static Price:</span>
              <span className="text-lg font-bold text-slate-900 font-mono">
                {formatCurrency(item.salePrice)}
              </span>
              <span className="text-[11px] text-slate-500 ml-1.5">
                ({item.salePriceTaxMode === 'with' ? 'Incl. Tax' : 'Excl. Tax'})
              </span>
            </div>
            <div className="text-right text-xs text-slate-500">
              <span>GST Slab: </span>
              <span className="font-bold text-slate-800">{item.gstTaxSlab}%</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {BRANCHES.map((b) => {
              const stock = getBranchStock(item.id, b.id);
              const isSelected = currentBranch === b.id;
              const qty = stock?.quantity ?? 0;

              return (
                <div
                  key={b.id}
                  className={cn(
                    'rounded-none border p-4 flex flex-col transition-all relative',
                    isSelected
                      ? 'bg-red-50/40 border-red-500 ring-1 ring-red-500/20'
                      : 'bg-slate-50 border-slate-200'
                  )}
                >
                  {isSelected && (
                    <div className="absolute top-2.5 right-2.5">
                      <span className="text-[11px] uppercase font-bold px-1.5 py-0.5 rounded-none bg-red-600 text-white">
                        Active Location
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 mb-3">
                    <Building2 className="h-4 w-4 text-red-700" />
                    <div>
                      <h3 className="font-bold text-sm text-slate-900">{b.name}</h3>
                      <p className="text-[11px] text-slate-500">{b.shortCode}</p>
                    </div>
                  </div>

                  <div className="mt-2 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500 font-medium">Physical Stock:</span>
                      {stock?.location?.trim() && (
                        <span className="text-[11px] font-mono font-bold text-slate-800 bg-slate-100 px-1.5 py-0.2 rounded-none border border-slate-300">
                          Rack: {stock.location.trim()}
                        </span>
                      )}
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-xl sm:text-2xl font-bold text-slate-900 font-mono">{qty}</span>
                      <span className="text-xs font-semibold text-slate-600">{item.unit}</span>
                    </div>
                    <div className="pt-1">
                      {qty > 10 ? (
                        <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-none border border-emerald-200 inline-flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> In Stock
                        </span>
                      ) : qty > 0 ? (
                        <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-none border border-amber-200">
                          Low Stock
                        </span>
                      ) : (
                        <span className="text-[11px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-none border border-rose-200">
                          Out of Stock
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Total (All Branches) Summary Row */}
          <div className="p-4 rounded-none bg-slate-100 border border-slate-300 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-slate-700" />
              <div>
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Total (All Branches)
                </h4>
                <p className="text-[11px] text-slate-500">
                  Aggregated on-hand count across Erode HQ, Coimbatore & Chennai
                </p>
              </div>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl sm:text-2xl font-bold text-slate-900 font-mono">
                {BRANCHES.reduce((sum, b) => sum + (getBranchStock(item.id, b.id)?.quantity ?? 0), 0)}
              </span>
              <span className="text-xs font-bold text-slate-700">{item.unit}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-none bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-xs font-bold transition-colors cursor-pointer"
          >
            Close View
          </button>

          <button
            onClick={() => {
              onClose();
              navigateToInventoryItem(item.itemCode);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-none border border-red-700 text-xs font-bold shadow-none transition-colors cursor-pointer"
          >
            <span>Manage Stock in Inventory</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
