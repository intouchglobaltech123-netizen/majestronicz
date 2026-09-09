import React, { useState, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import { Item, BranchId, BRANCHES } from '../../types';
import { X, ArrowRightLeft, Truck, AlertTriangle, Check, ArrowRight, ShieldCheck } from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  preselectedItem?: Item | null;
  defaultFromBranch?: BranchId;
  defaultToBranch?: BranchId;
}

export const TransferStockModal: React.FC<Props> = ({
  isOpen,
  onClose,
  preselectedItem,
  defaultFromBranch,
  defaultToBranch,
}) => {
  const {
    items,
    getBranchStock,
    transferStock,
    currentBranch,
    currentUser,
    canInitiateTransferFrom,
    setCurrentView,
  } = useErp();

  const managerBranch = currentUser.role === 'Manager' ? (currentUser.assignedBranchId || 'erode-hq') : undefined;

  const [fromBranch, setFromBranch] = useState<BranchId>(() => {
    if (managerBranch) return managerBranch;
    if (defaultFromBranch) return defaultFromBranch;
    if (currentBranch !== 'all') return currentBranch;
    return 'erode-hq';
  });

  const [toBranch, setToBranch] = useState<BranchId>(() => {
    if (defaultToBranch && defaultToBranch !== fromBranch) return defaultToBranch;
    const alternate = BRANCHES.find((b) => b.id !== fromBranch)?.id || 'coimbatore';
    return alternate;
  });

  const [selectedItemId, setSelectedItemId] = useState<string>(preselectedItem?.id || (items[0]?.id ?? ''));
  const [searchItemText, setSearchItemText] = useState('');
  const [quantity, setQuantity] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [autoGenerateChallan, setAutoGenerateChallan] = useState(true);

  useEffect(() => {
    if (isOpen) {
      if (preselectedItem) {
        setSelectedItemId(preselectedItem.id);
      } else if (!selectedItemId && items.length > 0) {
        setSelectedItemId(items[0].id);
      }

      if (managerBranch) {
        setFromBranch(managerBranch);
        const alt = BRANCHES.find((b) => b.id !== managerBranch)?.id || 'coimbatore';
        setToBranch(alt);
      } else if (defaultFromBranch) {
        setFromBranch(defaultFromBranch);
        if (defaultToBranch && defaultToBranch !== defaultFromBranch) {
          setToBranch(defaultToBranch);
        } else {
          const alt = BRANCHES.find((b) => b.id !== defaultFromBranch)?.id || 'coimbatore';
          setToBranch(alt);
        }
      } else if (currentBranch !== 'all') {
        setFromBranch(currentBranch);
        const alt = BRANCHES.find((b) => b.id !== currentBranch)?.id || 'coimbatore';
        setToBranch(alt);
      }

      setQuantity('');
      setNotes('');
      setAutoGenerateChallan(true);
      setSearchItemText('');
    }
  }, [isOpen, preselectedItem, defaultFromBranch, defaultToBranch, currentBranch, managerBranch]);

  if (!isOpen) return null;

  const currentItem = items.find((i) => i.id === selectedItemId);
  const fromStockRow = currentItem ? getBranchStock(currentItem.id, fromBranch) : undefined;
  const toStockRow = currentItem ? getBranchStock(currentItem.id, toBranch) : undefined;

  const availableInFrom = fromStockRow?.quantity ?? 0;
  const currentInTo = toStockRow?.quantity ?? 0;
  const numQty = typeof quantity === 'number' ? quantity : 0;
  const isOverAvailable = numQty > availableInFrom;

  const canTransfer = canInitiateTransferFrom(fromBranch);

  const filteredItems = items.filter((item) => {
    if (!searchItemText.trim()) return true;
    const term = searchItemText.toLowerCase();
    return (
      item.itemName.toLowerCase().includes(term) ||
      item.itemCode.toLowerCase().includes(term) ||
      item.category.toLowerCase().includes(term)
    );
  });

  const handleFromBranchChange = (newFrom: BranchId) => {
    setFromBranch(newFrom);
    if (newFrom === toBranch) {
      const other = BRANCHES.find((b) => b.id !== newFrom)?.id || 'erode-hq';
      setToBranch(other);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!canTransfer) {
      toast.error('You are not authorized to transfer stock out of this branch');
      return;
    }

    if (fromBranch === toBranch) {
      toast.error('Source and destination branches cannot be identical');
      return;
    }

    if (!currentItem) {
      toast.error('Please select an item to transfer');
      return;
    }

    if (!numQty || numQty <= 0) {
      toast.error('Please enter a valid transfer quantity');
      return;
    }

    if (isOverAvailable) {
      toast.error(`Transfer quantity exceeds available stock in ${BRANCHES.find(b => b.id === fromBranch)?.name}`);
      return;
    }

    try {
      const res = transferStock(
        currentItem.id,
        fromBranch,
        toBranch,
        numQty,
        notes.trim() || undefined,
        autoGenerateChallan
      );

      onClose();

      if (res.challanNumber && autoGenerateChallan) {
        toast('Delivery Challan generated', {
          description: `Challan #${res.challanNumber} was auto-created for this transit.`,
          action: {
            label: 'View Challans',
            onClick: () => setCurrentView('challans'),
          },
        });
      }
    } catch {
      // toast already handled in transferStock
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] text-slate-900">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-blue-100 border border-blue-200 flex items-center justify-center text-blue-700">
              <ArrowRightLeft className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Inter-Branch Stock Transfer</h2>
              <p className="text-xs text-slate-500">Atomic inventory movement between physical branch warehouses</p>
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
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5">
          {/* Branch Routing (From -> To) */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-slate-700">
              <span>Transfer Route</span>
              <span className="text-[10px] text-blue-600 font-semibold uppercase tracking-wider">Atomic Transaction</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
              {/* Source Branch */}
              <div>
                <label className="text-[11px] font-bold text-slate-600 block mb-1">
                  From (Source Warehouse) <span className="text-rose-500">*</span>
                </label>
                {currentUser.role === 'CEO' ? (
                  <select
                    value={fromBranch}
                    onChange={(e) => handleFromBranchChange(e.target.value as BranchId)}
                    className="w-full px-3 py-2 rounded-xl bg-white border border-slate-300 text-xs font-bold text-slate-900 focus:outline-none focus:border-blue-600"
                  >
                    {BRANCHES.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.shortCode})
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="px-3 py-2 rounded-xl bg-slate-100 border border-slate-200 text-xs font-bold text-slate-800 flex items-center justify-between">
                    <span>{BRANCHES.find((b) => b.id === fromBranch)?.name}</span>
                    <span className="text-[10px] px-1 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                      Your Branch
                    </span>
                  </div>
                )}
              </div>

              {/* Destination Branch */}
              <div>
                <label className="text-[11px] font-bold text-slate-600 block mb-1">
                  To (Destination Warehouse) <span className="text-rose-500">*</span>
                </label>
                <select
                  value={toBranch}
                  onChange={(e) => setToBranch(e.target.value as BranchId)}
                  className="w-full px-3 py-2 rounded-xl bg-white border border-slate-300 text-xs font-bold text-slate-900 focus:outline-none focus:border-blue-600"
                >
                  {BRANCHES.filter((b) => b.id !== fromBranch).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.shortCode})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Item Selector */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700">
                Select Item to Transfer <span className="text-rose-500">*</span>
              </label>
              {items.length > 6 && (
                <span className="text-[10px] text-slate-500 font-medium">
                  {items.length} items cataloged
                </span>
              )}
            </div>

            {/* Quick search input */}
            <input
              type="text"
              placeholder="Quick search item by name or code..."
              value={searchItemText}
              onChange={(e) => setSearchItemText(e.target.value)}
              className="w-full mb-2 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-300 text-xs text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white"
            />

            <select
              value={selectedItemId}
              onChange={(e) => setSelectedItemId(e.target.value)}
              size={Math.min(5, Math.max(2, filteredItems.length))}
              className="w-full rounded-xl border border-slate-300 bg-white text-xs text-slate-900 overflow-y-auto focus:outline-none focus:border-blue-600 divide-y divide-slate-100"
            >
              {filteredItems.map((item) => {
                const stock = getBranchStock(item.id, fromBranch)?.quantity ?? 0;
                return (
                  <option key={item.id} value={item.id} className="p-2.5 hover:bg-blue-50 cursor-pointer">
                    {item.itemName} ({item.itemCode}) — Current: {stock} {item.unit}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Selected Item Stock Overview */}
          {currentItem && (
            <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-white text-blue-700 border border-blue-200">
                    {currentItem.itemCode}
                  </span>
                  <span className="font-bold text-slate-900">{currentItem.itemName}</span>
                </div>
                <p className="text-[11px] text-slate-600 mt-0.5">Category: {currentItem.category}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">From Stock</span>
                  <span className={cn('text-sm font-extrabold', availableInFrom > 0 ? 'text-emerald-700' : 'text-rose-600')}>
                    {availableInFrom} {currentItem.unit}
                  </span>
                </div>
                <div className="h-6 w-px bg-blue-200" />
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">To Stock</span>
                  <span className="text-sm font-extrabold text-slate-800">
                    {currentInTo} {currentItem.unit}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Quantity Input & Max Stock Button */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700">
                Transfer Quantity <span className="text-rose-500">*</span>
              </label>
              {availableInFrom > 0 && (
                <button
                  type="button"
                  onClick={() => setQuantity(availableInFrom)}
                  className="text-[10px] font-bold text-blue-600 hover:text-blue-800 hover:underline"
                >
                  Transfer Max ({availableInFrom} {currentItem?.unit})
                </button>
              )}
            </div>
            <div className="relative">
              <input
                type="number"
                min="1"
                max={availableInFrom}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value) || 0))}
                placeholder={`1 to ${availableInFrom}`}
                required
                className={cn(
                  'w-full px-3.5 py-2.5 rounded-xl bg-white border text-slate-900 font-bold text-base focus:outline-none focus:ring-2 transition-all pr-14',
                  isOverAvailable
                    ? 'border-rose-400 focus:border-rose-600 focus:ring-rose-500/20'
                    : 'border-slate-300 focus:border-blue-600 focus:ring-blue-500/20'
                )}
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">
                {currentItem?.unit}
              </span>
            </div>
            {isOverAvailable && (
              <p className="text-[11px] font-semibold text-rose-600 mt-1 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" /> Quantity exceeds available warehouse stock ({availableInFrom}).
              </p>
            )}
          </div>

          {/* Live Route Transition Preview */}
          {numQty > 0 && !isOverAvailable && currentItem && (
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-2">
                Projected Balance After Transfer
              </span>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-2 rounded-lg bg-white border border-slate-200">
                  <div className="font-bold text-slate-700">{BRANCHES.find((b) => b.id === fromBranch)?.name}</div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-slate-500">{availableInFrom}</span>
                    <ArrowRight className="h-3 w-3 text-slate-400" />
                    <span className="font-extrabold text-slate-900">{availableInFrom - numQty} {currentItem.unit}</span>
                    <span className="text-[10px] font-bold text-rose-600">(-{numQty})</span>
                  </div>
                </div>
                <div className="p-2 rounded-lg bg-white border border-slate-200">
                  <div className="font-bold text-slate-700">{BRANCHES.find((b) => b.id === toBranch)?.name}</div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-slate-500">{currentInTo}</span>
                    <ArrowRight className="h-3 w-3 text-slate-400" />
                    <span className="font-extrabold text-emerald-700">{currentInTo + numQty} {currentItem.unit}</span>
                    <span className="text-[10px] font-bold text-emerald-600">(+{numQty})</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Auto-generate Delivery Challan Option */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-start gap-3">
            <input
              type="checkbox"
              id="autoChallan"
              checked={autoGenerateChallan}
              onChange={(e) => setAutoGenerateChallan(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="autoChallan" className="text-xs text-slate-700 cursor-pointer">
              <span className="font-bold text-slate-900 block flex items-center gap-1.5">
                <Truck className="h-3.5 w-3.5 text-blue-600" />
                Auto-generate Delivery Challan for transit dispatch
              </span>
              <span className="text-[11px] text-slate-500 block mt-0.5">
                Creates an official dispatch document with Delivered By ({BRANCHES.find((b) => b.id === fromBranch)?.name}) and Received By ({BRANCHES.find((b) => b.id === toBranch)?.name}) ready for driver sign-off.
              </span>
            </label>
          </div>

          {/* Transfer Remarks */}
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1.5">
              Transfer Purpose / Notes <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Urgent machine retrofit batch / Replenishment from Central Stores"
              className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-xs text-slate-900 focus:outline-none focus:border-blue-600"
            />
          </div>

          {/* Audit Trail Note */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 flex items-start gap-2">
            <ShieldCheck className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
            <span>
              Generates a linked pair of audit logs with a cross-referenced transfer ID, ensuring traceability from both branches.
            </span>
          </div>

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canTransfer || !numQty || isOverAvailable || !currentItem}
              className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-xs hover:shadow transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Check className="h-4 w-4" />
              <span>Confirm Stock Transfer</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
