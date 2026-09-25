import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  PackageCheck,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { PurchaseOrder, BRANCHES } from '../../types';
import { useErp } from '../../context/ErpContext';
import { formatCurrency } from '../../lib/utils';

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
  // Raw text held while the user is TYPING the total / per-unit price (PUR2-7) so a
  // keystroke isn't divided/reformatted mid-typing; committed to a per-unit price on blur.
  const [totalPriceInputs, setTotalPriceInputs] = useState<Record<string, string>>({});
  const [perUnitInputs, setPerUnitInputs] = useState<Record<string, string>>({});
  // Quality check: line.id -> number of units found damaged (billed back to vendor)
  const [damagedToAssign, setDamagedToAssign] = useState<Record<string, number>>({});
  // Vendor payment recorded at receiving
  const [payNowInput, setPayNowInput] = useState<string>('');
  const [payMode, setPayMode] = useState<string>('Cash');
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
      // Key every input by the PO LINE id (not itemId) so two lines of the same
      // product stay independent — editing one row never changes the other.
      purchaseOrder.items.forEach((item) => {
        const remaining = Math.max(0, item.quantityOrdered - (item.receivedQuantity || 0));
        initial[item.id] = remaining;
        const currentLoc = getBranchStock(item.itemId, purchaseOrder.branchId)?.location || '';
        initialLocs[item.id] = currentLoc;
        initialPrices[item.id] = item.purchasePrice || 0;
      });
      setQuantitiesToReceive(initial);
      setLocationsToAssign(initialLocs);
      setPricesToAssign(initialPrices);
      setTotalPriceInputs({});
      setPerUnitInputs({});
      setDamagedToAssign({});
      setPayNowInput('');
      setPayMode('Cash');
      setReceivingNotes('');
    } else if (!isOpen) {
      // Reset the guard when the modal closes so re-opening seeds fresh.
      seededKeyRef.current = null;
      setQuantitiesToReceive({});
      setLocationsToAssign({});
      setPricesToAssign({});
      setTotalPriceInputs({});
      setPerUnitInputs({});
      setDamagedToAssign({});
      setPayNowInput('');
      setReceivingNotes('');
    }
    // Intentionally keyed on the PO id + open state only (not the object
    // reference or getBranchStock), to survive live-sync re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseOrder?.id, isOpen]);

  if (!isOpen || !purchaseOrder) return null;

  const branchData = BRANCHES.find((b) => b.id === purchaseOrder.branchId);

  const handleQtyChange = (lineId: string, valStr: string, maxAllowed: number) => {
    const parsed = parseInt(valStr, 10);
    if (isNaN(parsed) || parsed < 0) {
      setQuantitiesToReceive((prev) => ({ ...prev, [lineId]: 0 }));
    } else {
      setQuantitiesToReceive((prev) => ({
        ...prev,
        [lineId]: Math.min(parsed, maxAllowed),
      }));
    }
  };

  // Per-unit price: hold raw text while typing, commit the parsed value on blur.
  const handlePerUnitText = (lineId: string, valStr: string) =>
    setPerUnitInputs((prev) => ({ ...prev, [lineId]: valStr }));

  const commitPerUnit = (lineId: string, valStr: string) => {
    const parsed = parseFloat(valStr);
    const per = isNaN(parsed) || parsed < 0 ? 0 : Math.round(parsed * 100) / 100;
    setPricesToAssign((prev) => ({ ...prev, [lineId]: per }));
    setPerUnitInputs((prev) => {
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
  };

  // Enter the OVERALL price for all units → derive the per-unit purchase price.
  // Keep the typed total as raw text while typing; divide by qty only on blur so a
  // keystroke like "1000" for 3 units resolves to 333.33/unit (PUR2-7), not 0.33.
  const handleTotalText = (lineId: string, valStr: string) =>
    setTotalPriceInputs((prev) => ({ ...prev, [lineId]: valStr }));

  const commitTotal = (lineId: string, valStr: string, qty: number) => {
    const total = parseFloat(valStr);
    const per = qty > 0 && !isNaN(total) && total >= 0 ? Math.round((total / qty) * 100) / 100 : 0;
    setPricesToAssign((prev) => ({ ...prev, [lineId]: per }));
    setTotalPriceInputs((prev) => {
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
  };

  const handleDamagedChange = (lineId: string, valStr: string, maxAllowed: number) => {
    const parsed = parseInt(valStr, 10);
    const safe = isNaN(parsed) || parsed < 0 ? 0 : Math.min(parsed, maxAllowed);
    setDamagedToAssign((prev) => ({ ...prev, [lineId]: safe }));
  };

  const handleFillAllRemaining = () => {
    const full: Record<string, number> = {};
    purchaseOrder.items.forEach((item) => {
      const remaining = Math.max(0, item.quantityOrdered - (item.receivedQuantity || 0));
      full[item.id] = remaining;
    });
    setQuantitiesToReceive(full);
  };

  const handleClearAll = () => {
    const cleared: Record<string, number> = {};
    purchaseOrder.items.forEach((item) => {
      cleared[item.id] = 0;
    });
    setQuantitiesToReceive(cleared);
  };

  const totalUnitsReceivingNow = Object.values(quantitiesToReceive).reduce((sum, val) => sum + (val || 0), 0);
  const totalDamagedNow = Object.values(damagedToAssign).reduce((sum, val) => sum + (val || 0), 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (totalUnitsReceivingNow <= 0 && totalDamagedNow <= 0) return;

    // Aggregate line-id-keyed inputs back to one receipt per itemId (summing
    // quantities if the same product spans multiple PO lines).
    const byItem: Record<string, { itemId: string; quantityReceived: number; location?: string; purchasePrice?: number; damagedQuantity?: number }> = {};
    purchaseOrder.items.forEach((line) => {
      const q = Number(quantitiesToReceive[line.id]) || 0;
      const dmg = Number(damagedToAssign[line.id]) || 0;
      if (q <= 0 && dmg <= 0) return;
      const acc = byItem[line.itemId] || { itemId: line.itemId, quantityReceived: 0, damagedQuantity: 0 };
      acc.quantityReceived += q;
      acc.damagedQuantity = (acc.damagedQuantity || 0) + dmg;
      const loc = locationsToAssign[line.id]?.trim();
      if (loc) acc.location = loc;
      // Flush any price still held as raw text (submit clicked before blur) — PUR2-7.
      let price = pricesToAssign[line.id];
      const rawPer = perUnitInputs[line.id];
      const rawTotal = totalPriceInputs[line.id];
      if (rawPer != null && rawPer !== '') {
        const p = parseFloat(rawPer);
        if (!isNaN(p) && p >= 0) price = Math.round(p * 100) / 100;
      } else if (rawTotal != null && rawTotal !== '') {
        const t = parseFloat(rawTotal);
        if (!isNaN(t) && t >= 0 && line.quantityOrdered > 0) price = Math.round((t / line.quantityOrdered) * 100) / 100;
      }
      if (price != null) acc.purchasePrice = price;
      byItem[line.itemId] = acc;
    });
    const receipts = Object.values(byItem).filter((r) => r.quantityReceived > 0 || (r.damagedQuantity || 0) > 0);

    // Vendor payment validation: confirm whether money was paid before stock-in.
    const payNow = Math.max(0, Number(payNowInput) || 0);
    const total = purchaseOrder.totalAmount || 0;
    const alreadyPaid = purchaseOrder.amountPaid || 0;
    const outstandingAfter = Math.max(0, total - alreadyPaid - payNow);
    if (payNow <= 0 && outstandingAfter > 0) {
      const ok = window.confirm(
        `No payment is being recorded now and ₹${outstandingAfter.toLocaleString('en-IN')} is still outstanding to the vendor.\n\nConfirm stock-in without recording a payment?`
      );
      if (!ok) return;
    }

    receivePurchaseOrderStock(
      purchaseOrder.id,
      receipts,
      receivingNotes,
      payNow > 0 ? { amount: payNow, mode: payMode } : undefined
    );

    // Damaged goods are recorded as a vendor debit note by receivePurchaseOrderStock
    // above. We intentionally do NOT pop open / print the bill here — the user asked
    // that submitting not trigger an immediate print. The debit note appears in the
    // Purchase Order detail under "Vendor Debit Notes", where a "Print Bill" button
    // prints it on demand.
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-5xl overflow-hidden flex flex-col max-h-[90vh]">
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
          <div className="border border-slate-200 rounded-xl overflow-x-auto shadow-2xs">
            <table className="w-full min-w-[1000px] text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 text-xs font-bold uppercase tracking-wider">
                  <th className="py-2.5 px-4 min-w-[240px]">Item &amp; Code</th>
                  <th className="py-2.5 px-3 text-center">Ordered</th>
                  <th className="py-2.5 px-3 text-center">Prev. Received</th>
                  <th className="py-2.5 px-3 text-center">Remaining</th>
                  <th className="py-2.5 px-3 text-right w-44">Purchase Price<br/><span className="text-[9px] font-normal lowercase text-slate-400">total for all units → per unit</span></th>
                  <th className="py-2.5 px-3 text-left">
                    <div className="flex items-center gap-1">
                      <span>Shelve / Rack</span>
                      <span className="text-[11px] font-normal lowercase text-slate-400">(optional)</span>
                    </div>
                  </th>
                  <th className="py-2.5 px-3 text-right w-28">Inward Now</th>
                  <th className="py-2.5 px-3 text-right w-28 text-rose-600">Damaged (QC)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {purchaseOrder.items.map((line) => {
                  const ordered = line.quantityOrdered;
                  const received = line.receivedQuantity || 0;
                  const remaining = Math.max(0, ordered - received);
                  const currentInput = quantitiesToReceive[line.id] ?? 0;
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

                      {/* Purchase Price — enter TOTAL for all ordered units → per-unit */}
                      <td className="py-3 px-3 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">₹</span>
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={totalPriceInputs[line.id] ?? (Math.round((pricesToAssign[line.id] || 0) * ordered * 100) / 100 || '')}
                              onChange={(e) => handleTotalText(line.id, e.target.value)}
                              onBlur={(e) => commitTotal(line.id, e.target.value, ordered)}
                              placeholder={`Total for ${ordered}`}
                              title={`Total price for all ${ordered} ${line.unit}`}
                              className="w-32 pl-5 pr-2 py-1 text-xs font-mono font-semibold text-right border rounded-lg bg-white border-slate-300 text-slate-800 focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                            />
                          </div>
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">₹</span>
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={perUnitInputs[line.id] ?? (pricesToAssign[line.id] ?? '')}
                              onChange={(e) => handlePerUnitText(line.id, e.target.value)}
                              onBlur={(e) => commitPerUnit(line.id, e.target.value)}
                              placeholder="per unit"
                              title="Per-unit purchase price"
                              className="w-32 pl-5 pr-2 py-0.5 text-[11px] font-mono text-right border rounded-lg bg-slate-50 border-slate-200 text-slate-600 focus:outline-hidden focus:border-blue-400"
                            />
                            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-slate-400">/unit</span>
                          </div>
                        </div>
                      </td>

                      {/* Shelve / Rack Location */}
                      <td className="py-3 px-3">
                        {isFullyReceived ? (
                          <span className="text-xs text-slate-400 font-mono">
                            {locationsToAssign[line.id] || '—'}
                          </span>
                        ) : (
                          <input
                            type="text"
                            placeholder="e.g. Rack R2"
                            value={locationsToAssign[line.id] || ''}
                            onChange={(e) =>
                              setLocationsToAssign((prev) => ({
                                ...prev,
                                [line.id]: e.target.value,
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
                          <div className="flex items-center justify-end">
                            <input
                              type="number"
                              min={0}
                              max={remaining}
                              value={currentInput}
                              onChange={(e) => handleQtyChange(line.id, e.target.value, remaining)}
                              className="w-24 text-right px-2.5 py-1.5 text-sm font-bold border rounded-lg bg-white border-slate-300 focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                            />
                          </div>
                        )}
                      </td>

                      {/* Damaged / QC-reject qty (raises a vendor debit note) */}
                      <td className="py-3 px-3 text-right">
                        {isFullyReceived ? (
                          <span className="text-xs text-slate-300">—</span>
                        ) : (
                          <input
                            type="number"
                            min={0}
                            max={remaining}
                            value={damagedToAssign[line.id] ?? ''}
                            onChange={(e) => handleDamagedChange(line.id, e.target.value, remaining)}
                            placeholder="0"
                            title="Units received damaged — billed back to the vendor as a debit note"
                            className="w-20 text-right px-2 py-1.5 text-sm font-bold border rounded-lg bg-white border-rose-200 text-rose-700 focus:outline-hidden focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
                          />
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
          {totalUnitsReceivingNow === 0 && totalDamagedNow === 0 && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs">
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
              <span>Enter an inward or damaged quantity for at least one item before clicking confirm.</span>
            </div>
          )}
          {totalDamagedNow > 0 && (
            <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
              <span><strong>{totalDamagedNow}</strong> damaged unit(s) will raise a <strong>vendor debit note</strong> — these are NOT added to stock.</span>
            </div>
          )}
        </form>

        {/* Vendor payables tracking — is the vendor paid, and how much is due */}
        {(() => {
          const total = purchaseOrder.totalAmount || 0;
          const paid = purchaseOrder.amountPaid || 0;
          const outstanding = Math.max(0, total - paid);
          return (
            <div className="px-6 py-2.5 border-t border-slate-200 bg-white flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs shrink-0">
              <span className="text-slate-500">PO Value: <span className="font-bold text-slate-900 font-mono">{formatCurrency(total)}</span></span>
              <span className="text-slate-500">Paid to Vendor: <span className="font-bold text-emerald-700 font-mono">{formatCurrency(paid)}</span></span>
              <span className="text-slate-500">Outstanding: <span className={`font-bold font-mono ${outstanding > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{formatCurrency(outstanding)}</span></span>
              {/* Record a vendor payment now (validated before stock-in) */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-semibold">Pay now:</span>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">₹</span>
                  <input
                    type="number" min={0} value={payNowInput}
                    onChange={(e) => setPayNowInput(e.target.value)}
                    placeholder="0"
                    className="w-24 pl-5 pr-2 py-1 rounded-lg bg-white border border-slate-300 text-xs font-bold font-mono text-slate-900 focus:outline-none focus:border-emerald-600"
                  />
                </div>
                <select
                  value={payMode}
                  onChange={(e) => setPayMode(e.target.value)}
                  className="px-2 py-1 rounded-lg bg-white border border-slate-300 text-xs font-bold text-slate-800 focus:outline-none focus:border-emerald-600"
                >
                  <option>Cash</option>
                  <option>GPay</option>
                  <option>HDFC</option>
                  <option>Bank Transfer</option>
                  <option>Cheque</option>
                </select>
              </div>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${outstanding > 0 ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                {outstanding > 0 ? 'Payment Due' : 'Fully Paid'}
              </span>
            </div>
          );
        })()}

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
              disabled={totalUnitsReceivingNow <= 0 && totalDamagedNow <= 0}
              className={`inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-xl shadow-xs transition-colors ${
                totalUnitsReceivingNow > 0 || totalDamagedNow > 0
                  ? 'text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800'
                  : 'text-slate-400 bg-slate-200 cursor-not-allowed'
              }`}
            >
              <PackageCheck className="h-4 w-4" />
              <span>Confirm Stock In ({totalUnitsReceivingNow}){totalDamagedNow > 0 ? ` · ${totalDamagedNow} damaged` : ''}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
