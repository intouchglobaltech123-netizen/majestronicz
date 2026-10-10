import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, Receipt, IndianRupee } from 'lucide-react';
import { useErp } from '../../context/ErpContext';
import { BRANCHES, BranchId, Item } from '../../types';
import { formatCurrency, getTodayDateString, cn } from '../../lib/utils';
import { ItemSearchDropdown } from '../common/ItemSearchDropdown';
import { VendorSearchSelect } from './VendorSearchSelect';
import { VendorMasterModal } from './VendorMasterModal';
import { toast } from 'sonner';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  defaultBranch: BranchId;
}

type Line = { key: string; itemId: string; itemName: string; search: string; qty: string; price: string; tax: string };
const GST_SLABS = ['0', '5', '12', '18', '28'];
const newLine = (): Line => ({ key: `l-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, itemId: '', itemName: '', search: '', qty: '1', price: '', tax: '18' });

/**
 * Record a DIRECT purchase bill — a supplier purchase entered without first
 * raising a PO. Adds stock and a payable (and can pay the supplier now). The
 * server treats it like a received-and-billed PO (createDirectPurchaseBill).
 */
export const DirectPurchaseBillModal: React.FC<Props> = ({ isOpen, onClose, defaultBranch }) => {
  const { vendors, createDirectPurchaseBill, currentUser } = useErp();
  const [branchId, setBranchId] = useState<BranchId>(defaultBranch === ('all' as any) ? 'erode-hq' : defaultBranch);
  const [vendorId, setVendorId] = useState('');
  const [date, setDate] = useState(getTodayDateString());
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [billNumber, setBillNumber] = useState('');
  const [billDate, setBillDate] = useState(getTodayDateString());
  const [payNow, setPayNow] = useState('');
  const [payMode, setPayMode] = useState('Cash');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [addVendorOpen, setAddVendorOpen] = useState(false);

  const branchLocked = currentUser.role !== 'CEO' && !!currentUser.assignedBranchId;

  const totals = useMemo(() => {
    // G3: round PER LINE then sum — exactly as the server does — so the total
    // shown here equals what the bill owes and paying it is never off by a paisa.
    const r2 = (n: number) => Math.round(n * 100) / 100;
    let taxable = 0;
    let tax = 0;
    for (const l of lines) {
      const q = Number(l.qty) || 0;
      const p = Number(l.price) || 0;
      const t = Number(l.tax) || 0;
      const amt = r2(q * p);
      taxable += amt;
      tax += r2((amt * t) / 100);
    }
    taxable = r2(taxable);
    tax = r2(tax);
    return { taxable, tax, grand: r2(taxable + tax) };
  }, [lines]);

  if (!isOpen) return null;

  const setLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));

  const submit = async () => {
    if (saving) return;
    if (!vendorId) { toast.error('Choose the supplier'); return; }
    const items = lines
      .filter((l) => l.itemId && Number(l.qty) > 0)
      .map((l) => ({ itemId: l.itemId, quantityOrdered: Number(l.qty), purchasePrice: Number(l.price) || 0, taxPercent: Number(l.tax) || 0 }));
    if (!items.length) { toast.error('Add at least one item with a quantity'); return; }
    const pay = Number(payNow) || 0;
    if (pay > totals.grand + 0.01) { toast.error(`Paid now can't be more than the bill total ${formatCurrency(totals.grand)}`); return; }
    setSaving(true);
    const ok = await createDirectPurchaseBill({
      vendorId, branchId, date,
      items,
      supplierBillNumber: billNumber.trim() || undefined,
      supplierBillDate: billNumber.trim() ? billDate : undefined,
      payNow: pay > 0 ? pay : undefined,
      payMode: pay > 0 ? payMode : undefined,
      notes: notes.trim() || undefined,
    });
    setSaving(false);
    if (ok) onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-3 sm:p-5">
      <div className="bg-white rounded-none shadow-2xl border border-slate-300 w-full max-w-2xl max-h-[92vh] flex flex-col">
        <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-none bg-white/10 flex items-center justify-center border border-white/20"><Receipt className="h-4 w-4 text-amber-300" /></div>
            <div>
              <h3 className="text-sm font-bold">Purchase Bill</h3>
              <p className="text-[11px] text-slate-300">Record a supplier purchase — stock in + payable, no PO needed</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-300 hover:text-white hover:bg-white/10 rounded-none"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Supplier + branch + date */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1 block">Supplier *</label>
              <VendorSearchSelect vendors={vendors} value={vendorId} onChange={setVendorId} onAddNew={() => setAddVendorOpen(true)} />
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1 block">Branch</label>
              <select
                value={branchId}
                disabled={branchLocked}
                onChange={(e) => setBranchId(e.target.value as BranchId)}
                className="w-full px-2.5 py-2 rounded-none bg-white border border-slate-300 text-sm disabled:bg-slate-100"
              >
                {BRANCHES.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1 block">Date</label>
              <input type="date" value={date} max={getTodayDateString()} onChange={(e) => setDate(e.target.value)} className="w-full px-2.5 py-2 rounded-none bg-white border border-slate-300 text-sm" />
            </div>
          </div>

          {/* Lines */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Items</label>
              <button type="button" onClick={() => setLines((ls) => [...ls, newLine()])} className="text-[11px] font-bold text-red-700 hover:text-red-900 flex items-center gap-1 cursor-pointer"><Plus className="h-3 w-3" />Add line</button>
            </div>
            <div className="space-y-1.5">
              {lines.map((l) => {
                const amt = (Number(l.qty) || 0) * (Number(l.price) || 0);
                return (
                  <div key={l.key} className="grid grid-cols-12 gap-1.5 items-start">
                    <div className="col-span-12 sm:col-span-5">
                      <ItemSearchDropdown
                        value={l.itemId ? l.itemName : l.search}
                        onChange={(v) => setLine(l.key, { search: v, ...(l.itemId ? { itemId: '', itemName: '' } : {}) })}
                        onSelectItem={(it: Item) => setLine(l.key, { itemId: it.id, itemName: it.itemName, search: it.itemName, price: l.price || String(it.purchasePrice ?? ''), tax: String(it.gstTaxSlab ?? l.tax) })}
                        placeholder="Search item…"
                      />
                    </div>
                    <input type="number" min={0} value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} placeholder="Qty" className="col-span-3 sm:col-span-2 px-2 py-2 rounded-none border border-slate-300 text-sm font-mono" />
                    <input type="number" min={0} value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })} placeholder="Cost" className="col-span-4 sm:col-span-2 px-2 py-2 rounded-none border border-slate-300 text-sm font-mono" />
                    <select value={l.tax} onChange={(e) => setLine(l.key, { tax: e.target.value })} className="col-span-3 sm:col-span-2 px-1 py-2 rounded-none border border-slate-300 text-sm">
                      {GST_SLABS.map((s) => <option key={s} value={s}>{s}%</option>)}
                    </select>
                    <div className="col-span-2 sm:col-span-1 flex items-center justify-end gap-1 pt-2">
                      <span className="text-[11px] font-mono text-slate-500 hidden sm:inline">{amt ? formatCurrency(amt) : ''}</span>
                      <button type="button" onClick={() => removeLine(l.key)} className="text-slate-400 hover:text-rose-600 cursor-pointer"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Supplier bill + pay now */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-none space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Supplier bill (for GST / ITC)</p>
              <input value={billNumber} onChange={(e) => setBillNumber(e.target.value)} placeholder="Bill / invoice no. (optional)" className="w-full px-2.5 py-1.5 rounded-none border border-slate-300 text-sm" />
              {billNumber.trim() && (
                <input type="date" value={billDate} max={getTodayDateString()} onChange={(e) => setBillDate(e.target.value)} className="w-full px-2.5 py-1.5 rounded-none border border-slate-300 text-sm" />
              )}
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-none space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Pay now (optional)</p>
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <IndianRupee className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <input type="number" min={0} value={payNow} onChange={(e) => setPayNow(e.target.value)} placeholder="0" className="w-full pl-7 pr-2 py-1.5 rounded-none border border-slate-300 text-sm font-mono" />
                </div>
                <select value={payMode} onChange={(e) => setPayMode(e.target.value)} className="px-2 py-1.5 rounded-none border border-slate-300 text-sm">
                  {['Cash', 'GPay', 'Bank Transfer', 'Cheque', 'Card'].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <p className="text-[11px] text-slate-400">Leave blank to settle later from To Pay.</p>
            </div>
          </div>

          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" className="w-full px-2.5 py-1.5 rounded-none border border-slate-300 text-sm" />
        </div>

        {/* Footer with totals */}
        <div className="px-5 py-3.5 border-t border-slate-300 bg-slate-50 flex items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-600">
            Taxable <b className="font-mono text-slate-900">{formatCurrency(totals.taxable)}</b> · GST <b className="font-mono text-slate-900">{formatCurrency(totals.tax)}</b> · Total <b className="font-mono text-slate-900">{formatCurrency(totals.grand)}</b>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-none border border-slate-300">Cancel</button>
            <button
              type="button"
              onClick={submit}
              disabled={saving || !vendorId || totals.grand <= 0}
              className={cn('px-5 py-2 text-xs font-bold uppercase tracking-wider text-white rounded-none border border-amber-700 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5')}
            >
              <Receipt className="h-4 w-4" />
              {saving ? 'Saving…' : 'Record Bill'}
            </button>
          </div>
        </div>
      </div>

      <VendorMasterModal isOpen={addVendorOpen} onClose={() => setAddVendorOpen(false)} />
    </div>,
    document.body,
  );
};
