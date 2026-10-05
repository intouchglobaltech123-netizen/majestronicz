import React, { useState } from 'react';
import {
  Invoice,
  OnlineOrderStatus,
  OrderCommType,
  OrderIssueType,
  ONLINE_ORDER_PIPELINE,
  ONLINE_NEXT_ACTION,
  ORDER_COMM_LABEL,
  ORDER_ISSUE_TYPES,
  onlinePipelineIndex,
  recommendCouriers,
} from '../../types';
import { useErp } from '../../context/ErpContext';
import { formatCurrency, cn } from '../../lib/utils';
import {
  ArrowLeft, ArrowRight, Truck, CheckCircle2, Clock, Camera, MapPin,
  User, Phone, Package, Receipt, History, Link as LinkIcon, Boxes,
  MessageSquare, Image as ImageIcon, Send, Scale, Save, CheckSquare, Square,
  AlertTriangle, ShieldCheck,
} from 'lucide-react';

/** Build a wa.me link to the customer with a prefilled message. */
const waLink = (phone: string | undefined, text: string): string | null => {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const intl = digits.length === 10 ? `91${digits}` : digits.replace(/^0+/, '');
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
};

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
  onComm: (type: OrderCommType, note?: string) => void;
  onSaveTracking: (patch: { courierName?: string; trackingNumber?: string; trackingUrl?: string; trackingReference?: string; trackingSlipUrl?: string | null }) => void;
  onSavePacking: (patch: { parcelWeightKg?: number; boxCount?: number; addressLabelDone?: boolean; invoiceIncluded?: boolean }) => void;
  onAddIssue: (type: OrderIssueType, description?: string) => void;
  onResolveIssue: (issueId: string, resolution?: string) => void;
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
export const OnlineOrderDetail: React.FC<Props> = ({ inv, busy, onBack, onAdvance, onUploadPhoto, onComm, onSaveTracking, onSavePacking, onAddIssue, onResolveIssue }) => {
  const { courierPartners } = useErp();
  const recommended = recommendCouriers(inv, courierPartners || []);
  const s = (inv.onlineStatus as OnlineOrderStatus) || 'New';
  const idx = onlinePipelineIndex(s);
  const isCancelled = s === 'Cancelled';
  const isDone = s === 'Completed' || s === 'Delivered';
  const next = idx >= 0 && idx < ONLINE_ORDER_PIPELINE.length - 1 ? ONLINE_ORDER_PIPELINE[idx + 1] : null;
  const history = Array.isArray(inv.onlineStatusHistory) ? inv.onlineStatusHistory : [];
  const comms = Array.isArray(inv.communicationLog) ? inv.communicationLog : [];
  const [t, setT] = useState({ number: inv.trackingNumber || '', courier: inv.courierName || '', url: inv.trackingUrl || '', reference: inv.trackingReference || '', slip: (inv.trackingSlipUrl || null) as string | null });

  const readSlip = (file: File | null) => {
    if (!file) { setT((p) => ({ ...p, slip: null })); return; }
    const r = new FileReader();
    r.onload = () => setT((p) => ({ ...p, slip: String(r.result || '') }));
    r.readAsDataURL(file);
  };
  const saveTracking = () => onSaveTracking({
    courierName: t.courier.trim(),
    trackingNumber: t.number.trim(),
    trackingUrl: t.url.trim(),
    trackingReference: t.reference.trim(),
    trackingSlipUrl: t.slip,
  });

  const name = inv.customerName || 'Customer';
  const photoMsg = `Hello ${name}, your order ${inv.invoiceNumber} is getting ready for dispatch. Please check the products before we pack.`;
  const trackMsg = `Hello ${name}, your order ${inv.invoiceNumber} has been handed over to the courier${inv.courierName ? ` (${inv.courierName})` : ''}.${inv.trackingNumber ? ` Tracking: ${inv.trackingNumber}.` : ''}${inv.trackingUrl ? ` Track here: ${inv.trackingUrl}` : ''}`;
  const photoWa = waLink(inv.customerPhone, photoMsg);
  const trackWa = waLink(inv.customerPhone, trackMsg);
  const photoSent = comms.some((c) => c.type === 'photo_sent');
  const trackingSent = comms.some((c) => c.type === 'tracking_sent');

  const [pack, setPack] = useState({
    weight: inv.parcelWeightKg != null ? String(inv.parcelWeightKg) : '',
    boxes: inv.boxCount != null ? String(inv.boxCount) : '',
    label: !!inv.addressLabelDone,
    invoice: !!inv.invoiceIncluded,
  });

  const issues = Array.isArray(inv.issues) ? inv.issues : [];
  const openIssues = issues.filter((i) => i.status !== 'resolved');
  const [issueType, setIssueType] = useState<OrderIssueType>(ORDER_ISSUE_TYPES[0]);
  const [issueDesc, setIssueDesc] = useState('');

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
        {openIssues.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">
            <AlertTriangle className="h-4 w-4" /> {openIssues.length} open issue{openIssues.length > 1 ? 's' : ''} — {openIssues.map((i) => i.type).join(', ')}
          </div>
        )}
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

        {/* Packing */}
        <Section title="Packing" icon={<Boxes className="h-3.5 w-3.5" />} right={inv.packedBy ? <span className="text-[11px] text-slate-400">by {inv.packedBy}{inv.packedAt ? ` · ${new Date(inv.packedAt).toLocaleString('en-IN')}` : ''}</span> : undefined}>
          <div className="space-y-2.5">
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
                <Scale className="h-4 w-4 text-slate-400" /> Weight (kg)
                <input type="number" min={0} step="0.1" value={pack.weight} onChange={(e) => setPack({ ...pack, weight: e.target.value })}
                  className="w-20 px-2 py-1 rounded-md bg-white border border-slate-200 text-xs font-mono focus:outline-none focus:border-emerald-500" />
              </label>
              <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
                <Boxes className="h-4 w-4 text-slate-400" /> Boxes
                <input type="number" min={0} step="1" value={pack.boxes} onChange={(e) => setPack({ ...pack, boxes: e.target.value })}
                  className="w-16 px-2 py-1 rounded-md bg-white border border-slate-200 text-xs font-mono focus:outline-none focus:border-emerald-500" />
              </label>
            </div>
            <div className="flex flex-wrap gap-4">
              {([['label', 'Address label attached'], ['invoice', 'Invoice included']] as const).map(([k, lbl]) => (
                <button key={k} type="button" onClick={() => setPack({ ...pack, [k]: !pack[k] })}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700">
                  {pack[k] ? <CheckSquare className="h-4 w-4 text-emerald-600" /> : <Square className="h-4 w-4 text-slate-300" />} {lbl}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => onSavePacking({
                parcelWeightKg: pack.weight === '' ? undefined : Number(pack.weight),
                boxCount: pack.boxes === '' ? undefined : Number(pack.boxes),
                addressLabelDone: pack.label,
                invoiceIncluded: pack.invoice,
              })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold disabled:opacity-60"
            >
              <Save className="h-3.5 w-3.5" /> Save packing
            </button>
          </div>
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

        {/* Courier & tracking — editable at ANY stage (the courier often gives the
            AWB after dispatch), per the fulfillment spec. */}
        <Section title="Courier & Tracking" icon={<Truck className="h-3.5 w-3.5" />}>
          <div className="space-y-2.5">
            {/* Recommended couriers for this order's state / payment / weight */}
            {recommended.length > 0 && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">Recommended couriers</p>
                <div className="flex flex-wrap gap-1.5">
                  {recommended.slice(0, 5).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setT({ ...t, courier: c.name })}
                      className={cn('inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold border',
                        t.courier === c.name ? 'bg-emerald-600 text-white border-emerald-700' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50')}
                      title={[c.deliveryDays ? `~${c.deliveryDays}d` : '', c.maxWeightKg ? `≤${c.maxWeightKg}kg` : ''].filter(Boolean).join(' · ')}
                    >
                      <Truck className="h-3 w-3" /> {c.name}{c.deliveryDays ? ` · ~${c.deliveryDays}d` : ''}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {courierPartners.length === 0 && (
              <p className="text-[11px] text-amber-600">No couriers set up yet — add them in Shopify → Couriers to get recommendations.</p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              <input value={t.courier} onChange={(e) => setT({ ...t, courier: e.target.value })} placeholder="Courier" className="px-2 py-1.5 rounded-md bg-white border border-slate-200 text-xs focus:outline-none focus:border-indigo-500" />
              <input value={t.number} onChange={(e) => setT({ ...t, number: e.target.value })} placeholder="Tracking / AWB no." className="px-2 py-1.5 rounded-md bg-white border border-slate-200 text-xs font-mono focus:outline-none focus:border-indigo-500" />
              <input value={t.reference} onChange={(e) => setT({ ...t, reference: e.target.value })} placeholder="Reference / docket no." className="px-2 py-1.5 rounded-md bg-white border border-slate-200 text-xs font-mono focus:outline-none focus:border-indigo-500" />
              <input value={t.url} onChange={(e) => setT({ ...t, url: e.target.value })} placeholder="Tracking link (URL)" className="px-2 py-1.5 rounded-md bg-white border border-slate-200 text-xs focus:outline-none focus:border-indigo-500" />
            </div>

            {/* Courier slip image */}
            <div className="flex items-center gap-2 flex-wrap">
              <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-300 bg-white text-[11px] font-bold text-slate-700 hover:bg-slate-50 cursor-pointer">
                <ImageIcon className="h-3.5 w-3.5" /> {t.slip ? 'Change slip photo' : 'Attach courier slip'}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => readSlip(e.target.files?.[0] || null)} />
              </label>
              {t.slip && (
                <>
                  <a href={t.slip} target="_blank" rel="noreferrer" className="h-9 w-9 rounded border border-slate-300 overflow-hidden"><img src={t.slip} alt="Courier slip" className="w-full h-full object-cover" /></a>
                  <button type="button" onClick={() => setT({ ...t, slip: null })} className="text-[11px] text-rose-600 hover:text-rose-800 font-semibold">Remove</button>
                </>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 pt-0.5">
              <div className="text-[11px] text-slate-500">
                {inv.trackingReceivedAt ? <>Tracking recorded {new Date(inv.trackingReceivedAt).toLocaleString('en-IN')}</> : 'Not recorded yet'}
                {inv.trackingUrl && (
                  <> · <a href={inv.trackingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-blue-600 hover:text-blue-800"><LinkIcon className="h-3 w-3" /> open link</a></>
                )}
              </div>
              <button type="button" disabled={busy} onClick={saveTracking} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 border border-indigo-700 disabled:opacity-50 cursor-pointer">
                <Truck className="h-3.5 w-3.5" /> Save tracking
              </button>
            </div>
          </div>
        </Section>

        {/* Communication (WhatsApp / contact) */}
        <Section title="Customer Communication (WhatsApp)" icon={<MessageSquare className="h-3.5 w-3.5" />}>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {/* Send tray photo */}
              <a
                href={photoWa || undefined}
                target="_blank"
                rel="noreferrer"
                className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border',
                  photoWa ? 'bg-[#25D366]/10 text-[#128C7E] border-[#25D366]/40 hover:bg-[#25D366]/20' : 'bg-slate-50 text-slate-400 border-slate-200 pointer-events-none')}
              >
                <ImageIcon className="h-3.5 w-3.5" /> Open WhatsApp — send tray photo
              </a>
              <button
                type="button"
                disabled={busy}
                onClick={() => onComm('photo_sent')}
                className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border disabled:opacity-60',
                  photoSent ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50')}
              >
                {photoSent ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />} {photoSent ? 'Photo marked sent' : 'Mark photo sent'}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Send tracking */}
              <a
                href={trackWa || undefined}
                target="_blank"
                rel="noreferrer"
                className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border',
                  trackWa ? 'bg-[#25D366]/10 text-[#128C7E] border-[#25D366]/40 hover:bg-[#25D366]/20' : 'bg-slate-50 text-slate-400 border-slate-200 pointer-events-none')}
              >
                <Truck className="h-3.5 w-3.5" /> Open WhatsApp — send tracking
              </a>
              <button
                type="button"
                disabled={busy}
                onClick={() => onComm('tracking_sent')}
                className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border disabled:opacity-60',
                  trackingSent ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50')}
              >
                {trackingSent ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />} {trackingSent ? 'Tracking marked sent' : 'Mark tracking sent'}
              </button>
            </div>
            {!inv.customerPhone && <p className="text-[11px] text-amber-600">No customer phone on this order — WhatsApp links are disabled.</p>}
            {/* Contact log */}
            {comms.length > 0 && (
              <ul className="pt-1 space-y-1 border-t border-slate-100">
                {[...comms].reverse().map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-[11px] text-slate-600">
                    <MessageSquare className="h-3.5 w-3.5 text-[#128C7E] mt-0.5 shrink-0" />
                    <span><span className="font-bold text-slate-800">{ORDER_COMM_LABEL[c.type]}</span>{c.note ? ` — ${c.note}` : ''} · <span className="font-medium">{c.by}</span><span className="text-slate-400"> · {new Date(c.at).toLocaleString('en-IN')}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>

        {/* Issues / complaints */}
        <Section
          title="Issues & Complaints"
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          right={openIssues.length > 0 ? <span className="text-[11px] font-bold text-rose-600">{openIssues.length} open</span> : <span className="text-[11px] text-emerald-600">None open</span>}
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <select value={issueType} onChange={(e) => setIssueType(e.target.value as OrderIssueType)} className="px-2 py-1.5 rounded-md bg-white border border-slate-200 text-xs font-bold text-slate-700 focus:outline-none focus:border-rose-500">
                {ORDER_ISSUE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input value={issueDesc} onChange={(e) => setIssueDesc(e.target.value)} placeholder="Describe the problem (optional)" className="flex-1 min-w-[10rem] px-2 py-1.5 rounded-md bg-white border border-slate-200 text-xs focus:outline-none focus:border-rose-500" />
              <button type="button" disabled={busy} onClick={() => { onAddIssue(issueType, issueDesc); setIssueDesc(''); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold border border-rose-700 disabled:opacity-60">
                <AlertTriangle className="h-3.5 w-3.5" /> Log issue
              </button>
            </div>
            {issues.length === 0 ? (
              <p className="text-xs text-slate-400">No issues on this order.</p>
            ) : (
              <ul className="space-y-2">
                {[...issues].reverse().map((it) => (
                  <li key={it.id} className={cn('rounded-lg border p-2', it.status === 'resolved' ? 'border-emerald-200 bg-emerald-50/40' : 'border-rose-200 bg-rose-50/40')}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-800 inline-flex items-center gap-1.5">
                        {it.status === 'resolved' ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> : <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />}
                        {it.type}
                        <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded border', it.status === 'resolved' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-rose-100 text-rose-700 border-rose-200')}>{it.status}</span>
                      </span>
                      {it.status !== 'resolved' && (
                        <button type="button" disabled={busy} onClick={() => { const r = prompt('Resolution / outcome (optional):') ?? undefined; onResolveIssue(it.id, r); }}
                          className="text-[11px] font-bold text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Resolve</button>
                      )}
                    </div>
                    {it.description && <p className="text-[11px] text-slate-600 mt-0.5">{it.description}</p>}
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      raised by {it.createdBy} · {new Date(it.createdAt).toLocaleString('en-IN')}
                      {it.status === 'resolved' && it.resolvedAt ? ` · resolved by ${it.resolvedBy} · ${new Date(it.resolvedAt).toLocaleString('en-IN')}${it.resolution ? ` — ${it.resolution}` : ''}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
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
