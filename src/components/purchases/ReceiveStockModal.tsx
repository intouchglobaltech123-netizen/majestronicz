import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  PackageCheck,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { PurchaseOrder, BRANCHES } from '../../types';
import { useErp } from '../../context/ErpContext';

interface ReceiveStockModalProps {
  isOpen: boolean;
  onClose: () => void;
  purchaseOrder: PurchaseOrder | null;
}

export const ReceiveStockModal: React.FC<ReceiveStockModalProps> = ({
  isOpen,
  onClose,
  purchaseOrder,
}) => {
  const { receivePurchaseOrderStock, getBranchStock } = useErp();

  // Map of itemId -> number of units receiving right now
  const [quantitiesToReceive, setQuantitiesToReceive] = useState<Record<string, number>>({});
  // Map of itemId -> shelve/rack location
  const [locationsToAssign, setLocationsToAssign] = useState<Record<string, string>>({});
  // Map of itemId -> actual purchase price confirmed while receiving
  const [pricesToAssign, setPricesToAssign] = useState<Record<string, number>>({});
  // Optional receiving notes (e.g. Courier docket / Vendor DC)
  const [receivingNotes, setReceivingNotes] = useState('');

  // Track which PO/open-session we've already seeded inputs for, so that a
  // background live-sync re-bootstrap (which replaces the purchaseOrder object
  // reference) does NOT wipe the quantity/notes the user is currently typing.
  const seededKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (isOpen && purchaseOrder) {
      const key = purchaseOrder.id;
      // Only seed defaults the first time this PO opens; ignore later
      // reference changes from live-sync while the modal stays open.
      if (seededKeyRef.current === key) return;
      seededKeyRef.current = key;

      const initial: Record<string, number> = {};
      const initialLocs: Record<string, string> = {};
      const initialPrices: Record<string, number> = {};
      purchaseOrder.items.forEach((item) => {
        const remaining = Math.max(0, item.quantityOrdered - (item.receivedQuantity || 0));
        initial[item.itemId] = remaining;
        const currentLoc = getBranchStock(item.itemId, purchaseOrder.branchId)?.location || '';
        initialLocs[item.itemId] = currentLoc;
        initialPrices[item.itemId] = item.purchasePrice || 0;
      });
      setQuantitiesToReceive(initial);
      setLocationsToAssign(initialLocs);
      setPricesToAssign(initialPrices);
      setReceivingNotes('');
    } else if (!isOpen) {
      // Reset the guard when the modal closes so re-opening seeds fresh.
      seededKeyRef.current = null;
      setQuantitiesToReceive({});
      setLocationsToAssign({});
      setPricesToAssign({});
      setReceivingNotes('');
    }
    // Intentionally keyed on the PO id + open state only (not the object
    // reference or getBranchStock), to survive live-sync re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseOrder?.id, isOpen]);

  if (!isOpen || !purchaseOrder) return null;

  const branchData = BRANCHES.find((b) => b.id === purchaseOrder.branchId);

  const handleQtyChange = (itemId: string, valStr: string, maxAllowed: number) => {
    const parsed = parseInt(valStr, 10);
    if (isNaN(parsed) || parsed < 0) {
      setQuantitiesToReceive((prev) => ({ ...prev, [itemId]: 0 }));
    } else {
      setQuantitiesToReceive((prev) => ({
        ...prev,
        [itemId]: Math.min(parsed, maxAllowed),
      }));
    }
  };

  const handlePriceChange = (itemId: string, valStr: string) => {
    const parsed = parseFloat(valStr);
    setPricesToAssign((prev) => ({ ...prev, [itemId]: isNaN(parsed) || parsed < 0 ? 0 : parsed }));
  };

  const handleFillAllRemaining = () => {
    const full: Record<string, number> = {};
    purchaseOrder.items.forEach((item) => {
      const remaining = Math.max(0, item.quantityOrdered - (item.receivedQuantity || 0));
      full[item.itemId] = remaining;
    });
    setQuantitiesToReceive(full);
  };

  const handleClearAll = () => {
    const cleared: Record<string, number> = {};
    purchaseOrder.items.forEach((item) => {
      cleared[item.itemId] = 0;
    });
    setQuantitiesToReceive(cleared);
  };

  const totalUnitsReceivingNow = Object.values(quantitiesToReceive).reduce((sum, val) => sum + (val || 0), 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (totalUnitsReceivingNow <= 0) return;

    const receipts = Object.entries(quantitiesToReceive)
      .map(([itemId, quantityReceived]) => ({
        itemId,
        quantityReceived: Number(quantityReceived) || 0,
        location: locationsToAssign[itemId]?.trim() || undefined,
        purchasePrice: pricesToAssign[itemId] ?? undefined,
      }))
      .filter((r) => r.quantityReceived > 0);

    receivePurchaseOrderStock(purchaseOrder.id, receipts, receivingNotes);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/70 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-200/60">
              <PackageCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">
                  Receive Physical Stock
                </h3>
                <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200">
                  {purchaseOrder.poNumber}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Supplier: <span className="font-semibold text-slate-700">{purchaseOrder.vendorName}</span> • Destination:{' '}
                <span className="font-semibold text-slate-700">{branchData?.name || purchaseOrder.branchId}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Informative Banner */}
        <div className="px-6 py-2.5 bg-blue-50/60 border-b border-blue-100 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-xs text-blue-800">
            <PackageCheck className="h-4 w-4 text-blue-600 shrink-0" />
            <span>
              Inward stock updates physical warehouse counts immediately. Setting shelf/rack location assigns or updates the item's warehouse position for this branch. Waiting customer orders will flip to{' '}
              <strong className="font-semibold text-blue-950">"Stock Arrived"</strong>.
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleFillAllRemaining}
              className="text-xs font-semibold text-blue-700 hover:text-blue-900 px-2 py-1 rounded-md hover:bg-blue-100/70 transition-colors"
            >
              Fill All Remaining
            </button>
            <span className="text-slate-300">|</span>
            <button
              type="button"
              onClick={handleClearAll}
              className="text-xs font-medium text-slate-500 hover:text-slate-700 px-2 py-1 rounded-md hover:bg-slate-100 transition-colors"
            >
              Reset to 0
            </button>
          </div>
        </div>

        {/* Scrollable Line Items Table */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 text-xs font-bold uppercase tracking-wider">
                  <th className="py-2.5 px-4 min-w-[240px]">Item &amp; Code</th>
                  <th className="py-2.5 px-3 text-center">Ordered</th>
                  <th className="py-2.5 px-3 text-center">Prev. Received</th>
                  <th className="py-2.5 px-3 text-center">Remaining</th>
                  <th className="py-2.5 px-3 text-right w-32">Purchase Price (₹)</th>
                  <th className="py-2.5 px-3 text-left">
                    <div className="flex items-center gap-1">
                      <span>Shelve / Rack</span>
                      <span className="text-[11px] font-normal lowercase text-slate-400">(optional)</span>
                    </div>
                  </th>
                  <th className="py-2.5 px-4 text-right w-44">Inward Now</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {purchaseOrder.items.map((line) => {
                  const ordered = line.quantityOrdered;
                  const received = line.receivedQuantity || 0;
                  const remaining = Math.max(0, ordered - received);
                  const currentInput = quantitiesToReceive[line.itemId] ?? 0;
                  const isFullyReceived = remaining === 0;

                  return (
                    <tr
                      key={line.id}
                      className={isFullyReceived ? 'bg-slate-50/50 opacity-70' : 'hover:bg-slate-50/60 transition-colors'}
                    >
                      {/* Item Details */}
                      <td className="py-3 px-4 align-top min-w-[240px]">
                        <div className="font-semibold text-slate-900 leading-snug">{line.itemName}</div>
                        <div className="mt-0.5 text-xs text-slate-500 font-mono flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="whitespace-nowrap">{line.itemCode}</span>
                          {line.vendorSku && <span className="whitespace-nowrap text-indigo-500">SKU: {line.vendorSku}</span>}
                          {line.itemHSN && <span className="whitespace-nowrap text-slate-400">HSN: {line.itemHSN}</span>}
                          <span className="whitespace-nowrap text-slate-400 font-sans">({line.unit})</span>
                        </div>
                      </td>

                      {/* Ordered Qty */}
                      <td className="py-3 px-3 text-center font-medium text-slate-700">
                        {ordered} {line.unit}
                      </td>

                      {/* Previously Received */}
                      <td className="py-3 px-3 text-center font-medium text-slate-600">
                        {received > 0 ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 text-xs font-semibold">
                            <CheckCircle2 className="h-3 w-3" />
                            {received}
                          </span>
                        ) : (
                          <span className="text-slate-400">0</span>
                        )}
                      </td>

                      {/* Remaining Qty */}
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`font-semibold text-xs px-2 py-0.5 rounded-md border ${
                            isFullyReceived
                              ? 'bg-slate-100 text-slate-500 border-slate-200'
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                          }`}
                        >
                          {remaining} {line.unit}
                        </span>
                      </td>

                      {/* Purchase Price (confirmed at receiving) */}
                      <td className="py-3 px-3 text-right">
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">₹</span>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={pricesToAssign[line.itemId] ?? ''}
                            onChange={(e) => handlePriceChange(line.itemId, e.target.value)}
                            placeholder="0.00"
                            className="w-24 pl-5 pr-2 py-1 text-xs font-mono font-semibold text-right border rounded-lg bg-white border-slate-300 text-slate-800 focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                      </td>

                      {/* Shelve / Rack Location */}
                      <td className="py-3 px-3">
                        {isFullyReceived ? (
                          <span className="text-xs text-slate-400 font-mono">
                            {locationsToAssign[line.itemId] || '—'}
                          </span>
                        ) : (
                          <input
                            type="text"
                            placeholder="e.g. Rack R2"
                            value={locationsToAssign[line.itemId] || ''}
                            onChange={(e) =>
                              setLocationsToAssign((prev) => ({
                                ...prev,
                                [line.itemId]: e.target.value,
                              }))
                            }
                            className="w-28 px-2.5 py-1 text-xs font-mono font-semibold border rounded-lg bg-white border-slate-300 text-slate-800 placeholder:text-slate-400 placeholder:font-normal focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                          />
                        )}
                      </td>

                      {/* Inward Qty Input */}
                      <td className="py-3 px-4 text-right">
                        {isFullyReceived ? (
                          <span className="text-xs font-medium text-slate-400 italic">Fully Inwarded</span>
                        ) : (
                          <div className="flex items-center justify-end gap-1.5">
                            <input
                              type="number"
                              min={0}
                              max={remaining}
                              value={currentInput}
                              onChange={(e) => handleQtyChange(line.itemId, e.target.value, remaining)}
                              className="w-24 text-right px-2.5 py-1.5 text-sm font-bold border rounded-lg bg-white border-slate-300 focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                            />
                            <button
                              type="button"
                              onClick={() => handleQtyChange(line.itemId, String(remaining), remaining)}
                              title="Set to all remaining"
                              className="text-xs font-bold px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                            >
                              Max
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Receiving Notes / Delivery Challan */}
          <div className="bg-slate-50/70 p-3 rounded-xl border border-slate-200">
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Receiving Notes / Delivery Challan # <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <input
              type="text"
              value={receivingNotes}
              onChange={(e) => setReceivingNotes(e.target.value)}
              placeholder="e.g. Inwarded via DTDC Air Express #994821, Challan DC-441"
              className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Verification check */}
          {totalUnitsReceivingNow === 0 && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs">
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
              <span>Enter inward quantity for at least one item before clicking confirm.</span>
            </div>
          )}
        </form>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/70 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-600">
            Total units receiving now:{' '}
            <span className="font-bold text-slate-900 text-sm">{totalUnitsReceivingNow}</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={totalUnitsReceivingNow <= 0}
              className={`inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-xl shadow-xs transition-colors ${
                totalUnitsReceivingNow > 0
                  ? 'text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800'
                  : 'text-slate-400 bg-slate-200 cursor-not-allowed'
              }`}
            >
              <PackageCheck className="h-4 w-4" />
              <span>Confirm Stock In ({totalUnitsReceivingNow})</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
