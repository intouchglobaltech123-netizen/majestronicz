import React, { useState, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import { Item, BranchId, BRANCHES } from '../../types';
import {
  X,
  ArrowRightLeft,
  Truck,
  AlertTriangle,
  Check,
  ArrowRight,
  ShieldCheck,
  Plus,
  Trash2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { ItemSearchDropdown } from '../common/ItemSearchDropdown';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  preselectedItem?: Item | null;
  defaultFromBranch?: BranchId;
  defaultToBranch?: BranchId;
}

interface TransferRow {
  id: string;
  itemId: string;
  quantity: number | '';
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
    transferStockBatch,
    currentBranch,
    currentUser,
    canInitiateTransferFrom,
    setCurrentView,
  } = useErp();

  const managerBranch =
    currentUser.role === 'Manager' ? currentUser.assignedBranchId || 'erode-hq' : undefined;

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

  const [rows, setRows] = useState<TransferRow[]>([
    {
      id: `tr-row-${Date.now()}-1`,
      itemId: preselectedItem?.id || (items[0]?.id ?? ''),
      quantity: '',
    },
  ]);

  const [notes, setNotes] = useState('');
  const [autoGenerateChallan, setAutoGenerateChallan] = useState(true);

  // Sync state upon opening
  useEffect(() => {
    if (isOpen) {
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

      setRows([
        {
          id: `tr-row-${Date.now()}-1`,
          itemId: preselectedItem?.id || (items[0]?.id ?? ''),
          quantity: '',
        },
      ]);
      setNotes('');
      setAutoGenerateChallan(true);
    }
  }, [isOpen, preselectedItem, defaultFromBranch, defaultToBranch, currentBranch, managerBranch, items]);

  if (!isOpen) return null;

  const canTransfer = canInitiateTransferFrom(fromBranch);

  const handleFromBranchChange = (newFrom: BranchId) => {
    setFromBranch(newFrom);
    if (newFrom === toBranch) {
      const other = BRANCHES.find((b) => b.id !== newFrom)?.id || 'erode-hq';
      setToBranch(other);
    }
  };

  const handleAddRow = () => {
    // Pick an item that isn't already chosen if possible
    const chosenItemIds = new Set(rows.map((r) => r.itemId).filter(Boolean));
    const nextItem = items.find((i) => !chosenItemIds.has(i.id)) || items[0];

    const newRow: TransferRow = {
      id: `tr-row-${Date.now()}-${rows.length + 1}`,
      itemId: nextItem?.id || '',
      quantity: '',
    };
    setRows((prev) => [...prev, newRow]);
  };

  const handleRemoveRow = (rowId: string) => {
    if (rows.length === 1) {
      // Don't completely remove last row, just clear it
      setRows([
        {
          id: `tr-row-${Date.now()}-1`,
          itemId: '',
          quantity: '',
        },
      ]);
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  const handleUpdateRow = (rowId: string, updates: Partial<TransferRow>) => {
    setRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, ...updates } : r))
    );
  };

  // Row validation data & calculations
  const rowValidations = rows.map((row, idx) => {
    const item = items.find((i) => i.id === row.itemId);
    const availableInFrom = item ? (getBranchStock(item.id, fromBranch)?.quantity ?? 0) : 0;
    const currentInTo = item ? (getBranchStock(item.id, toBranch)?.quantity ?? 0) : 0;
    const numQty = typeof row.quantity === 'number' ? row.quantity : 0;

    // Check duplicate
    const isDuplicate = Boolean(
      row.itemId && rows.filter((r) => r.itemId === row.itemId).length > 1
    );

    const isMissingItem = !row.itemId;
    const isZeroOrNegative = numQty <= 0;
    const isOverAvailable = numQty > availableInFrom;

    let errorMessage: string | null = null;
    if (isMissingItem) {
      errorMessage = 'Please select an item';
    } else if (isDuplicate) {
      errorMessage = 'Duplicate item in transfer list';
    } else if (isZeroOrNegative) {
      errorMessage = 'Enter transfer quantity > 0';
    } else if (isOverAvailable) {
      errorMessage = `Insufficient stock: only ${availableInFrom} ${item?.unit || 'units'} available in source warehouse (requested ${numQty})`;
    }

    return {
      row,
      item,
      idx,
      availableInFrom,
      currentInTo,
      numQty,
      isDuplicate,
      isMissingItem,
      isOverAvailable,
      isZeroOrNegative,
      isValid: !errorMessage,
      errorMessage,
    };
  });

  const totalTransferUnits = rowValidations.reduce(
    (sum, r) => sum + (r.isValid ? r.numQty : 0),
    0
  );

  const hasInvalidRows = rowValidations.some((r) => !r.isValid);
  const invalidRowsList = rowValidations.filter((r) => !r.isValid);

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

    if (rows.length === 0) {
      toast.error('Please add at least one line item to transfer');
      return;
    }

    // Check if any row has errors
    if (hasInvalidRows) {
      const firstError = invalidRowsList[0];
      toast.error(`Row #${firstError.idx + 1} validation issue`, {
        description: firstError.errorMessage || 'Please correct line item errors before transferring.',
      });
      return;
    }

    const payload = rowValidations.map((r) => ({
      itemId: r.row.itemId,
      quantity: r.numQty,
    }));

    try {
      const res = transferStockBatch(
        payload,
        fromBranch,
        toBranch,
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
      // error toast already triggered inside transferStockBatch
    }
  };

  const fromBranchName = BRANCHES.find((b) => b.id === fromBranch)?.name || fromBranch;
  const toBranchName = BRANCHES.find((b) => b.id === toBranch)?.name || toBranch;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] text-slate-900">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-blue-100 border border-blue-200 flex items-center justify-center text-blue-700">
              <ArrowRightLeft className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">Multi-Item Inter-Branch Transfer</h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  Atomic Batch Transfer
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Transfer multiple catalog items in a single consolidated transit dispatch
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Branch Routing (Set Once) */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-slate-700">
              <span className="flex items-center gap-1.5">
                <span>Transfer Route</span>
                <span className="text-[10px] text-slate-400 font-normal">(Configured once for the entire batch)</span>
              </span>
              <span className="text-[10px] text-blue-600 font-semibold uppercase tracking-wider">
                All lines commit together
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
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

          {/* Line-Item List Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <span>Items to Transfer</span>
                <span className="text-[11px] font-normal text-slate-500 lowercase">
                  ({rows.length} line{rows.length === 1 ? '' : 's'})
                </span>
              </label>
              <button
                type="button"
                onClick={handleAddRow}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold border border-blue-200 transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Row</span>
              </button>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 font-bold uppercase text-[10px] tracking-wider border-b border-slate-200">
                      <th className="py-3 px-3 w-10 text-center">#</th>
                      <th className="py-3 px-3 min-w-[260px]">Product / Search Catalog</th>
                      <th className="py-3 px-3 w-32 text-center">
                        Available in {BRANCHES.find((b) => b.id === fromBranch)?.shortCode}
                      </th>
                      <th className="py-3 px-3 w-36 text-right">Transfer Qty</th>
                      <th className="py-3 px-3 w-20">Unit</th>
                      <th className="py-3 px-3 w-36 text-center">
                        Projected in {BRANCHES.find((b) => b.id === toBranch)?.shortCode}
                      </th>
                      <th className="py-3 px-2 w-10 text-center"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rowValidations.map(({ row, item, idx, availableInFrom, currentInTo, numQty, isOverAvailable, isDuplicate, errorMessage }) => {
                      const hasError = Boolean(errorMessage);

                      return (
                        <tr
                          key={row.id}
                          className={cn(
                            'transition-colors',
                            hasError ? 'bg-rose-50/40' : 'hover:bg-slate-50/50'
                          )}
                        >
                          {/* Row Number */}
                          <td className="py-3 px-3 text-center text-slate-400 font-mono">
                            {idx + 1}
                          </td>

                          {/* Item Search Dropdown */}
                          <td className="py-3 px-3">
                            <ItemSearchDropdown
                              value={item?.itemName || ''}
                              onChange={() => {}}
                              onSelectItem={(selected) => handleUpdateRow(row.id, { itemId: selected.id })}
                              selectedBranchId={fromBranch}
                              lockOutOfStock={false}
                              placeholder="Search catalog item by name or code..."
                              dropdownWidth="w-[480px]"
                              inputClassName={cn(
                                'w-full px-3 py-1.5 rounded-lg bg-slate-50 border text-xs font-semibold focus:outline-none transition-all',
                                isDuplicate || !row.itemId
                                  ? 'border-rose-300 focus:border-rose-600 text-rose-900'
                                  : 'border-slate-200 focus:border-blue-600 text-slate-900'
                              )}
                            />

                            {item && (
                              <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500">
                                <span className="font-mono font-bold px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 border border-slate-200">
                                  {item.itemCode}
                                </span>
                                <span>{item.category}</span>
                              </div>
                            )}

                            {/* Specific Error Notice */}
                            {errorMessage && (
                              <div className="flex items-center gap-1 text-[11px] font-bold text-rose-600 mt-1">
                                <AlertTriangle className="h-3 w-3 shrink-0" />
                                <span>{errorMessage}</span>
                              </div>
                            )}
                          </td>

                          {/* Source Available Stock */}
                          <td className="py-3 px-3 text-center">
                            <span
                              className={cn(
                                'font-bold font-mono text-xs px-2 py-0.5 rounded border',
                                availableInFrom === 0
                                  ? 'bg-rose-100 text-rose-800 border-rose-200'
                                  : availableInFrom < 5
                                  ? 'bg-amber-100 text-amber-800 border-amber-200'
                                  : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              )}
                            >
                              {availableInFrom} {item?.unit || ''}
                            </span>
                          </td>

                          {/* Transfer Quantity */}
                          <td className="py-3 px-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <input
                                type="number"
                                min="1"
                                max={availableInFrom}
                                value={row.quantity}
                                onChange={(e) =>
                                  handleUpdateRow(row.id, {
                                    quantity:
                                      e.target.value === ''
                                        ? ''
                                        : Math.max(1, parseInt(e.target.value) || 0),
                                  })
                                }
                                placeholder={`1-${availableInFrom || 0}`}
                                className={cn(
                                  'w-24 px-2.5 py-1.5 rounded-lg bg-slate-50 border text-xs font-mono font-bold text-right focus:outline-none transition-all',
                                  isOverAvailable
                                    ? 'border-rose-400 bg-rose-50 text-rose-900 focus:border-rose-600'
                                    : 'border-slate-200 focus:border-blue-600 text-slate-900'
                                )}
                              />
                              {availableInFrom > 0 && (
                                <button
                                  type="button"
                                  onClick={() => handleUpdateRow(row.id, { quantity: availableInFrom })}
                                  title="Transfer maximum available stock"
                                  className="text-[10px] font-bold text-blue-600 hover:text-blue-800 underline shrink-0 cursor-pointer"
                                >
                                  Max
                                </button>
                              )}
                            </div>
                          </td>

                          {/* Unit */}
                          <td className="py-3 px-3 font-semibold text-slate-600 uppercase text-[11px]">
                            {item?.unit || '—'}
                          </td>

                          {/* Projected Destination Stock */}
                          <td className="py-3 px-3 text-center">
                            {item && numQty > 0 && !isOverAvailable ? (
                              <div className="flex items-center justify-center gap-1 font-mono text-xs">
                                <span className="text-slate-400">{currentInTo}</span>
                                <ArrowRight className="h-3 w-3 text-slate-400" />
                                <span className="font-extrabold text-emerald-700">
                                  {currentInTo + numQty}
                                </span>
                                <span className="text-[10px] font-bold text-emerald-600">(+{numQty})</span>
                              </div>
                            ) : (
                              <span className="text-slate-400 font-mono text-xs">
                                {currentInTo} {item?.unit || ''}
                              </span>
                            )}
                          </td>

                          {/* Remove Action */}
                          <td className="py-3 px-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveRow(row.id)}
                              title="Remove item line"
                              className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50/80 border-t border-slate-200 font-bold text-xs">
                      <td colSpan={3} className="py-3 px-4">
                        <button
                          type="button"
                          onClick={handleAddRow}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-blue-700 text-xs font-bold border border-slate-200 shadow-2xs transition-colors cursor-pointer"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>Add Another Item Row</span>
                        </button>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className="text-[10px] uppercase font-bold text-slate-500 mr-2">Total:</span>
                        <span className="font-mono font-black text-sm text-slate-900">
                          {totalTransferUnits}
                        </span>
                      </td>
                      <td className="py-3 px-3 uppercase text-[10px] text-slate-500">Units</td>
                      <td colSpan={2} className="py-3 px-3 text-right text-[11px] text-slate-500">
                        {rows.length} {rows.length === 1 ? 'Item' : 'Items'} in batch
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>

          {/* Validation Banner if errors exist */}
          {hasInvalidRows && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-rose-900">
                <AlertTriangle className="h-4 w-4 text-rose-600" />
                <span>Cannot submit transfer batch due to row issues:</span>
              </div>
              <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                {invalidRowsList.map((err) => (
                  <li key={err.row.id}>
                    <strong>Row #{err.idx + 1}:</strong> {err.errorMessage}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Auto-generate Delivery Challan Option */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-start gap-3">
            <input
              type="checkbox"
              id="autoChallanBatch"
              checked={autoGenerateChallan}
              onChange={(e) => setAutoGenerateChallan(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
            />
            <label htmlFor="autoChallanBatch" className="text-xs text-slate-700 cursor-pointer select-none">
              <span className="font-bold text-slate-900 flex items-center gap-1.5">
                <Truck className="h-3.5 w-3.5 text-blue-600" />
                Auto-generate single Delivery Challan for entire batch
              </span>
              <span className="text-[11px] text-slate-500 block mt-0.5">
                Consolidates all {rows.length} line items onto one transit dispatch challan ({fromBranchName} → {toBranchName}) with driver sign-off blocks.
              </span>
            </label>
          </div>

          {/* Transfer Remarks */}
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1.5">
              Batch Transfer Purpose / Remarks <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Urgent machine retrofit batch / Replenishment from Central Stores"
              className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-xs text-slate-900 focus:outline-none focus:border-blue-600"
            />
          </div>

          {/* Atomic Logging Guarantee */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 flex items-start gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>
              <strong>Atomic Batch Guarantee:</strong> Either all {rows.length} line items transfer successfully together, or none of them do. Creates 1 linked Transfer record with paired StockAdjustmentLog entries for each item.
            </span>
          </div>

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-between border-t border-slate-200">
            <div className="text-xs text-slate-500">
              Transferring <strong className="text-slate-900 font-bold">{totalTransferUnits}</strong> total units across{' '}
              <strong className="text-slate-900 font-bold">{rows.length}</strong> SKU{rows.length === 1 ? '' : 's'}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canTransfer || hasInvalidRows || totalTransferUnits <= 0}
                className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-xs hover:shadow transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer"
              >
                <Check className="h-4 w-4" />
                <span>Confirm Batch Transfer</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
