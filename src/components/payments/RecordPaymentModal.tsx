import React, { useMemo, useState } from 'react';
import { X, Wallet, IndianRupee, Check, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import { useErp } from '../../context/ErpContext';
import { UniversalDropdown } from '../common/UniversalDropdown';
import { formatCurrency, cn } from '../../lib/utils';
import type { PaymentAllocation } from '../../types';

const PAYMENT_MODES = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Cheque'];

/** A document (invoice or purchase order) this payment can be applied to. */
export interface OutstandingDoc {
  refId: string;
  refNumber: string;
  date?: string;
  balanceDue: number;
}

interface RecordPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'in' | 'out';
  partyType: 'customer' | 'vendor';
  partyId?: string;
  partyName: string;
  branchId: string;
  /** Outstanding invoices/bills this payment can be allocated against. */
  outstanding?: OutstandingDoc[];
}

export const RecordPaymentModal: React.FC<RecordPaymentModalProps> = ({
  isOpen,
  onClose,
  type,
  partyType,
  partyId,
  partyName,
  branchId,
  outstanding = [],
}) => {
  const { recordPayment } = useErp();
  const totalDue = useMemo(() => outstanding.reduce((t, o) => t + o.balanceDue, 0), [outstanding]);

  const [amount, setAmount] = useState<string>(totalDue > 0 ? String(Math.round(totalDue)) : '');
  const [mode, setMode] = useState('Cash');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [autoAllocate, setAutoAllocate] = useState(true);
  const [manual, setManual] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const amountNum = Number(amount) || 0;

  // Allocation preview: auto = oldest-first fill; manual = per-invoice inputs.
  const allocations: PaymentAllocation[] = useMemo(() => {
    if (outstanding.length === 0) return [];
    if (!autoAllocate) {
      return outstanding
        .map((o) => ({ refId: o.refId, refNumber: o.refNumber, amount: Number(manual[o.refId]) || 0 }))
        .filter((a) => a.amount > 0);
    }
    let remaining = amountNum;
    const out: PaymentAllocation[] = [];
    // "Oldest first": settle earliest-dated bills before newer ones, regardless
    // of the order the caller passed the outstanding list in.
    const oldestFirst = [...outstanding].sort((a, b) => {
      const da = a.date || '';
      const db = b.date || '';
      if (da !== db) return da < db ? -1 : 1;
      return (a.refNumber || '').localeCompare(b.refNumber || '');
    });
    for (const o of oldestFirst) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, o.balanceDue);
      if (take > 0) {
        out.push({ refId: o.refId, refNumber: o.refNumber, amount: Math.round(take * 100) / 100 });
        remaining -= take;
      }
    }
    return out;
  }, [outstanding, autoAllocate, manual, amountNum]);

  const allocatedTotal = allocations.reduce((t, a) => t + a.amount, 0);
  const unallocated = Math.round((amountNum - allocatedTotal) * 100) / 100;

  const submit = async () => {
    if (amountNum <= 0 || saving) return;
    setSaving(true);
    const res = await recordPayment({
      type, partyType, partyId, partyName, branchId,
      date, amount: amountNum, paymentMode: mode,
      reference: reference.trim() || undefined,
      notes: notes.trim() || undefined,
      allocations: allocations.length ? allocations : undefined,
    });
    setSaving(false);
    if (res) onClose();
  };

  const isIn = type === 'in';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white border border-slate-200 shadow-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn('h-10 w-10 rounded-xl flex items-center justify-center', isIn ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-rose-50 text-rose-600 border border-rose-200')}>
              {isIn ? <ArrowDownCircle className="h-5 w-5" /> : <ArrowUpCircle className="h-5 w-5" />}
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900">
                {isIn ? 'Receive Payment' : 'Make Payment'}
              </h2>
              <p className="text-xs text-slate-500">{partyName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {totalDue > 0 && (
            <div className="flex items-center justify-between rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5">
              <span className="text-xs font-semibold text-amber-800">Total outstanding</span>
              <span className="text-sm font-black text-amber-900 font-mono">{formatCurrency(totalDue)}</span>
            </div>
          )}

          {/* Amount + mode */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1 block">Amount</label>
              <div className="relative">
                <IndianRupee className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="number" min={0} value={amount} autoFocus
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm font-bold font-mono text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white"
                  placeholder="0"
                />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1 block">Mode</label>
              <UniversalDropdown
                value={mode}
                onChange={setMode}
                options={PAYMENT_MODES.map((m) => ({ value: m, label: m }))}
                buttonClassName="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold text-slate-900"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1 block">Date</label>
              <input
                type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm font-medium text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1 block">Reference (optional)</label>
              <input
                type="text" value={reference} onChange={(e) => setReference(e.target.value)}
                placeholder="UPI ref / cheque no."
                className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600 focus:bg-white"
              />
            </div>
          </div>

          {/* Allocation against outstanding bills / purchase orders */}
          {outstanding.length > 0 && (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-3.5 py-2 bg-slate-50 border-b border-slate-200">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{isIn ? 'Apply to bills' : 'Apply to purchase orders'}</span>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={autoAllocate} onChange={(e) => setAutoAllocate(e.target.checked)} className="accent-blue-600" />
                  Auto (oldest first)
                </label>
              </div>
              <div className="max-h-44 overflow-y-auto divide-y divide-slate-100">
                {outstanding.map((o) => {
                  const alloc = allocations.find((a) => a.refId === o.refId)?.amount || 0;
                  return (
                    <div key={o.refId} className="flex items-center justify-between px-3.5 py-2 gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-800 truncate font-mono">{o.refNumber}</p>
                        <p className="text-[11px] text-slate-500">{o.date ? `${o.date} · ` : ''}due {formatCurrency(o.balanceDue)}</p>
                      </div>
                      {autoAllocate ? (
                        <span className={cn('text-xs font-bold font-mono', alloc > 0 ? 'text-emerald-700' : 'text-slate-300')}>
                          {alloc > 0 ? formatCurrency(alloc) : '—'}
                        </span>
                      ) : (
                        <input
                          type="number" min={0} max={o.balanceDue}
                          value={manual[o.refId] ?? ''}
                          onChange={(e) => setManual((m) => ({ ...m, [o.refId]: e.target.value }))}
                          placeholder="0"
                          className="w-24 px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono font-semibold text-right text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between px-3.5 py-2 bg-slate-50 border-t border-slate-200 text-[11px] font-semibold">
                <span className="text-slate-500">Applied {formatCurrency(allocatedTotal)}</span>
                <span className={cn(unallocated > 0 ? 'text-blue-700' : unallocated < 0 ? 'text-rose-600' : 'text-slate-400')}>
                  {unallocated > 0 ? `${formatCurrency(unallocated)} as advance` : unallocated < 0 ? `Over by ${formatCurrency(-unallocated)}` : 'Fully applied'}
                </span>
              </div>
            </div>
          )}

          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1 block">Notes (optional)</label>
            <input
              type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600 focus:bg-white"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">
            {isIn ? 'Receipt' : 'Voucher'} will be recorded in the party ledger.
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition-colors">
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={amountNum <= 0 || unallocated < 0 || saving}
              className={cn('px-4 py-2 rounded-xl text-white text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-xs', isIn ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700')}
            >
              {saving ? <Wallet className="h-3.5 w-3.5 animate-pulse" /> : <Check className="h-3.5 w-3.5" />}
              {saving ? 'Saving…' : isIn ? `Receive ${formatCurrency(amountNum)}` : `Pay ${formatCurrency(amountNum)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
