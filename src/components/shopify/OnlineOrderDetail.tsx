import React, { useState } from 'react';
import {
  Invoice,
  OnlineOrderStatus,
  ONLINE_ORDER_PIPELINE,
  ONLINE_NEXT_ACTION,
  onlinePipelineIndex,
} from '../../types';
import { formatCurrency, cn } from '../../lib/utils';
import {
  ArrowLeft, ArrowRight, Truck, CheckCircle2, Clock, Camera, MapPin,
  User, Phone, Package, Receipt, History, Link as LinkIcon, Boxes,
} from 'lucide-react';

const STATUS_STYLE: Record<OnlineOrderStatus, string> = {
  New: 'bg-slate-100 text-slate-700 border-slate-300',
  Picking: 'bg-sky-50 text-sky-700 border-sky-200',
  'Tray Photo': 'bg-cyan-50 text-cyan-700 border-cyan-200',
  Confirmed: 'bg-blue-50 text-blue-700 border-blue-200',
  Billed: 'bg-teal-50 text-teal-700 border-teal-200',
  Packed: 'bg-amber-50 text-amber-700 border-amber-200',
  Shipped: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  'In Transit': 'bg-violet-50 text-violet-700 border-violet-200',
  'Out for Delivery': 'bg-violet-50 text-violet-700 border-violet-200',
  Delivered: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Completed: 'bg-emerald-600 text-white border-emerald-700',
  Cancelled: 'bg-rose-50 text-rose-700 border-rose-200',
};

interface Props {
  inv: Invoice;
  busy: boolean;
  onBack: () => void;
  onAdvance: (to: OnlineOrderStatus, opts?: { trackingNumber?: string; courierName?: string; trackingUrl?: string }) => void;
  onUploadPhoto: (kind: 'tray' | 'parcel', file: File | null) => void;
}

const Section: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }> = ({ title, icon, children, right }) => (
  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
    <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
      <span className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-slate-700">{icon}{title}</span>
      {right}
    </div>
    <div className="p-4">{children}</div>
  </div>
);

/** Full-page ERP view of one online order — everything about it on one screen. */
export const OnlineOrderDetail: React.FC<Props> = ({ inv, busy, onBack, onAdvance, onUploadPhoto }) => {
  const s = (inv.onlineStatus as OnlineOrderStatus) || 'New';
  const idx = onlinePipelineIndex(s);
  const isCancelled = s === 'Cancelled';
  const isDone = s === 'Completed' || s === 'Delivered';
  const next = idx >= 0 && idx < ONLINE_ORDER_PIPELINE.length - 1 ? ONLINE_ORDER_PIPELINE[idx + 1] : null;
  const history = Array.isArray(inv.onlineStatusHistory) ? inv.onlineStatusHistory : [];
  const [t, setT] = useState({ number: inv.trackingNumber || '', courier: inv.courierName || '', url: inv.trackingUrl || '' });

  return (
    <div className="w-full space-y-4">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={onBack} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-lg">
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </button>
            <span className="font-mono text-sm font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">{inv.invoiceNumber}</span>
            <span className="text-base font-extrabold text-slate-900 truncate">{inv.customerName || 'Online customer'}</span>
          </div>
          <span className={cn('text-xs font-bold px-2.5 py-1 rounded-full border', STATUS_STYLE[s])}>{s}</span>
        </div>
        {/* Current stage + next action */}
        {!isCancelled && !isDone && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-600">
            <ArrowRight className="h-4 w-4 text-emerald-600" />
            <span className="font-bold text-slate-700">NEXT ACTION:</span> {ONLINE_NEXT_ACTION[s]}
          </div>
        )}
        {/* Stepper */}
        {!isCancelled && (
          <div className="mt-3 overflow-x-auto">
            <div className="flex items-center min-w-max">
              {ONLINE_ORDER_PIPELINE.map((stage, i) => {
                const done = i < idx; const active = i === idx;
                return (
                  <React.Fragment key={stage}>
                    <div className="flex flex-col items-center shrink-0" style={{ width: 78 }}>
                      <div className={cn('h-6 w-6 rounded-full flex items-center justify-center border text-[11px] font-bold',
                        done ? 'bg-emerald-600 text-white border-emerald-700' : active ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-slate-400 border-slate-300')}>
                        {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                      </div>
                      <span className={cn('mt-1 text-[9px] font-bold uppercase tracking-wide text-center leading-tight', active ? 'text-blue-700' : done ? 'text-emerald-700' : 'text-slate-400')}>{stage}</span>
                    </div>
                    {i < ONLINE_ORDER_PIPELINE.length - 1 && <div className={cn('h-0.5 w-6 shrink-0', i < idx ? 'bg-emerald-500' : 'bg-slate-200')} />}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}
        {/* Action bar (stage-gated) */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!isCancelled && next && s !== 'Delivered' && (
            <button disabled={busy} onClick={() => onAdvance(next, next === 'Shipped' ? { trackingNumber: t.number || undefined, courierName: t.courier || undefined, trackingUrl: t.url || undefined } : undefined)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold border border-emerald-700 disabled:opacity-60">
              {next === 'Shipped' ? <Truck className="h-4 w-4" /> : <Clock className="h-4 w-4" />} Mark {next}
            </button>
          )}
          {s === 'Delivered' && (
            <button disabled={busy} onClick={() => onAdvance('Completed')} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold border border-emerald-700 disabled:opacity-60">
              <CheckCircle2 className="h-4 w-4" /> Mark Completed
            </button>
          )}
          {s === 'Completed' && <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Completed</span>}
          {!isCancelled && !isDone && (
            <button disabled={busy} onClick={() => onAdvance('Cancelled')} className="px-3 py-2 rounded-lg bg-white hover:bg-rose-50 text-rose-600 text-xs font-bold border border-rose-200 disabled:opacity-60">Cancel order</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Customer & address */}
        <Section title="Customer & Delivery Address" icon={<User className="h-3.5 w-3.5" />}>
          <div className="space-y-1.5 text-sm text-slate-700">
            <div className="flex items-center gap-2"><User className="h-4 w-4 text-slate-400" /><span className="font-bold">{inv.customerName || '—'}</span></div>
            {inv.customerPhone && <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-slate-400" /><span className="font-mono">{inv.customerPhone}</span></div>}
            <div className="flex items-start gap-2"><MapPin className="h-4 w-4 text-slate-400 mt-0.5" /><span>{inv.customerAddress || 'No address'}</span></div>
          </div>
        </Section>

        {/* Payment / invoice */}
        <Section title="Invoice & Payment" icon={<Receipt className="h-3.5 w-3.5" />}>
          <div className="space-y-1 text-sm">
            <Row label="Invoice #" value={inv.invoiceNumber} mono />
            <Row label="Date" value={`${inv.date} ${inv.time || ''}`} />
            <Row label="Subtotal" value={formatCurrency(inv.subtotal || 0)} />
            {(inv.shippingCharges || 0) > 0 && <Row label="Shipping" value={formatCurrency(inv.shippingCharges || 0)} />}
            <Row label="Grand total" value={formatCurrency(inv.grandTotal || 0)} bold />
            <Row label="Payment" value={inv.paymentMode || '—'} />
            {(inv.balanceDue || 0) > 0 && <Row label="Balance due" value={formatCurrency(inv.balanceDue || 0)} danger />}
          </div>
        </Section>

        {/* Products */}
        <Section title="Products" icon={<Package className="h-3.5 w-3.5" />}>
          <ul className="divide-y divide-slate-100">
            {(inv.items || []).map((li, i) => (
              <li key={i} className="py-1.5 flex items-center justify-between gap-2 text-sm">
                <span className="text-slate-800 truncate">{li.itemName}</span>
                <span className="text-slate-500 font-mono shrink-0">{li.quantity} × {formatCurrency(li.unitPrice || 0)}</span>
              </li>
            ))}
            {(inv.items || []).length === 0 && <li className="py-2 text-xs text-slate-400">No line items</li>}
          </ul>
        </Section>

        {/* Photos */}
        <Section title="Photos (Picking & Dispatch)" icon={<Camera className="h-3.5 w-3.5" />}>
          <div className="flex flex-wrap gap-6">
            {(['tray', 'parcel'] as const).map((kind) => {
              const url = kind === 'tray' ? inv.trayPhotoUrl : inv.parcelPhotoUrl;
              const label = kind === 'tray' ? 'Tray photo' : 'Parcel photo';
              return (
                <div key={kind} className="flex items-center gap-2">
                  {url ? <img src={url} alt={label} className="h-16 w-16 object-cover rounded border border-slate-200" />
                    : <div className="h-16 w-16 rounded border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center text-slate-300"><Camera className="h-6 w-6" /></div>}
                  <label className="text-xs font-bold text-slate-600 cursor-pointer">
                    <span className="block">{label}</span>
                    <span className="text-[11px] font-normal text-emerald-700 underline">{url ? 'Replace' : 'Upload'}</span>
                    <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={(e) => onUploadPhoto(kind, e.target.files?.[0] || null)} />
                  </label>
                </div>
              );
            })}
          </div>
        </Section>

        {/* Courier & tracking */}
        <Section title="Courier & Tracking" icon={<Truck className="h-3.5 w-3.5" />}>
          {inv.trackingNumber ? (
            <div className="space-y-1 text-sm">
              <Row label="Courier" value={inv.courierName || '—'} />
              <Row label="Tracking / AWB" value={inv.trackingNumber} mono />
              {inv.trackingUrl && (
                <div className="pt-1"><a href={inv.trackingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800"><LinkIcon className="h-3.5 w-3.5" /> Open tracking link</a></div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">Enter tracking, then use “Mark Shipped”.</p>
              <div className="flex flex-wrap gap-1.5">
                <input value={t.number} onChange={(e) => setT({ ...t, number: e.target.value })} placeholder="Tracking / AWB no." className="w-40 px-2 py-1.5 rounded-md bg-white border border-slate-200 text-xs font-mono focus:outline-none focus:border-indigo-500" />
                <input value={t.courier} onChange={(e) => setT({ ...t, courier: e.target.value })} placeholder="Courier" className="w-32 px-2 py-1.5 rounded-md bg-white border border-slate-200 text-xs focus:outline-none focus:border-indigo-500" />
                <input value={t.url} onChange={(e) => setT({ ...t, url: e.target.value })} placeholder="Tracking link (URL)" className="w-48 px-2 py-1.5 rounded-md bg-white border border-slate-200 text-xs focus:outline-none focus:border-indigo-500" />
              </div>
            </div>
          )}
        </Section>

        {/* Activity history */}
        <Section title="Activity History" icon={<History className="h-3.5 w-3.5" />} right={<span className="text-[11px] text-slate-400">{history.length} events</span>}>
          {history.length === 0 ? (
            <p className="text-xs text-slate-400">No activity yet.</p>
          ) : (
            <ul className="space-y-2">
              {[...history].reverse().map((h, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-slate-600">
                  <Boxes className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
                  <span><span className="font-bold text-slate-800">{h.status}</span>{h.note ? ` — ${h.note}` : ''} · <span className="font-medium">{h.by}</span><span className="text-slate-400"> · {new Date(h.at).toLocaleString('en-IN')}</span></span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; value: string; mono?: boolean; bold?: boolean; danger?: boolean }> = ({ label, value, mono, bold, danger }) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-slate-500">{label}</span>
    <span className={cn('text-slate-800', mono && 'font-mono', bold && 'font-bold', danger && 'text-rose-600 font-bold')}>{value}</span>
  </div>
);

export default OnlineOrderDetail;
