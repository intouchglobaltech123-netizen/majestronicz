import React, { useState } from 'react';
import { useErp } from '../../context/ErpContext';
import { CourierPartner } from '../../types';
import { cn } from '../../lib/utils';
import { Truck, Plus, Trash2, Edit2, Check, X, Link as LinkIcon, Phone } from 'lucide-react';

const blank = {
  id: '', name: '', phone: '', portalUrl: '', states: '',
  supportsCod: true, supportsPrepaid: true, maxWeightKg: '', deliveryDays: '', active: true,
};

export const CourierMasterTab: React.FC = () => {
  const { courierPartners, saveCourier, deleteCourier } = useErp();
  const [form, setForm] = useState<typeof blank>(blank);
  const [editing, setEditing] = useState(false);

  const edit = (c: CourierPartner) => {
    setEditing(true);
    setForm({
      id: c.id, name: c.name, phone: c.phone || '', portalUrl: c.portalUrl || '',
      states: (c.states || []).join(', '),
      supportsCod: c.supportsCod, supportsPrepaid: c.supportsPrepaid,
      maxWeightKg: c.maxWeightKg != null ? String(c.maxWeightKg) : '',
      deliveryDays: c.deliveryDays != null ? String(c.deliveryDays) : '',
      active: c.active,
    });
  };
  const reset = () => { setForm(blank); setEditing(false); };

  const submit = async () => {
    if (!form.name.trim()) return;
    await saveCourier({
      id: form.id || undefined,
      name: form.name.trim(),
      phone: form.phone.trim() || undefined,
      portalUrl: form.portalUrl.trim() || undefined,
      states: form.states.split(',').map((s) => s.trim()).filter(Boolean),
      supportsCod: form.supportsCod,
      supportsPrepaid: form.supportsPrepaid,
      maxWeightKg: form.maxWeightKg === '' ? undefined : Number(form.maxWeightKg),
      deliveryDays: form.deliveryDays === '' ? undefined : Number(form.deliveryDays),
      active: form.active,
    });
    reset();
  };

  const input = 'w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-emerald-600';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Form */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 h-fit">
        <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">
          <Truck className="h-4 w-4 text-emerald-600" /> {editing ? 'Edit courier' : 'Add courier partner'}
        </h3>
        <input className={input} placeholder="Courier name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <input className={input} placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <input className={input} placeholder="Portal URL" value={form.portalUrl} onChange={(e) => setForm({ ...form, portalUrl: e.target.value })} />
        </div>
        <input className={input} placeholder="Served states (comma-sep; blank = all-India)" value={form.states} onChange={(e) => setForm({ ...form, states: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <input className={input} type="number" min={0} step="0.5" placeholder="Max weight (kg)" value={form.maxWeightKg} onChange={(e) => setForm({ ...form, maxWeightKg: e.target.value })} />
          <input className={input} type="number" min={0} step="1" placeholder="Delivery days" value={form.deliveryDays} onChange={(e) => setForm({ ...form, deliveryDays: e.target.value })} />
        </div>
        <div className="flex flex-wrap gap-4 text-xs font-bold text-slate-700">
          {([['supportsPrepaid', 'Prepaid'], ['supportsCod', 'COD'], ['active', 'Active']] as const).map(([k, lbl]) => (
            <label key={k} className="inline-flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={form[k] as boolean} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} className="accent-emerald-600" /> {lbl}
            </label>
          ))}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button onClick={submit} disabled={!form.name.trim()} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold border border-emerald-700 disabled:opacity-50">
            {editing ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {editing ? 'Save changes' : 'Add courier'}
          </button>
          {editing && <button onClick={reset} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white text-slate-600 text-xs font-bold border border-slate-200"><X className="h-3.5 w-3.5" /> Cancel</button>}
        </div>
      </div>

      {/* List */}
      <div className="lg:col-span-2 space-y-2">
        {courierPartners.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-400 bg-white border border-slate-200 rounded-xl">No couriers yet. Add your delivery partners to enable courier recommendations.</div>
        ) : (
          courierPartners.map((c) => (
            <div key={c.id} className={cn('bg-white border rounded-xl p-3 flex flex-wrap items-center gap-3', c.active ? 'border-slate-200' : 'border-slate-200 opacity-60')}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-slate-900">{c.name}</span>
                  {!c.active && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">Inactive</span>}
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">{c.supportsPrepaid ? 'Prepaid' : ''}{c.supportsPrepaid && c.supportsCod ? ' + ' : ''}{c.supportsCod ? 'COD' : ''}</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  {c.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{c.phone}</span>}
                  {c.portalUrl && <a href={c.portalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800"><LinkIcon className="h-3 w-3" />portal</a>}
                  <span>{(c.states && c.states.length) ? c.states.join(', ') : 'All-India'}</span>
                  {c.maxWeightKg != null && <span>≤ {c.maxWeightKg} kg</span>}
                  {c.deliveryDays != null && <span>~{c.deliveryDays} days</span>}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => edit(c)} className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 border border-transparent hover:border-blue-200"><Edit2 className="h-4 w-4" /></button>
                <button onClick={() => { if (confirm(`Remove courier "${c.name}"?`)) deleteCourier(c.id); }} className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default CourierMasterTab;
