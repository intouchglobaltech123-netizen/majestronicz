import React, { useEffect, useState } from 'react';
import { useErp } from '../../context/ErpContext';
import { AuditEntry } from '../../types';
import { History, RefreshCw, ShieldCheck, IndianRupee, Users, RotateCcw, Ban, KeyRound } from 'lucide-react';

const ACTION_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  'payment.record': { label: 'Payment recorded', icon: IndianRupee, tone: 'text-emerald-600 bg-emerald-50' },
  'payment.delete': { label: 'Payment deleted', icon: IndianRupee, tone: 'text-rose-600 bg-rose-50' },
  'sale.save': { label: 'Sale saved', icon: IndianRupee, tone: 'text-blue-600 bg-blue-50' },
  'sale.void': { label: 'Sale voided', icon: Ban, tone: 'text-rose-600 bg-rose-50' },
  'sale.return': { label: 'Sale return', icon: RotateCcw, tone: 'text-amber-600 bg-amber-50' },
  'sale.delete': { label: 'Sale deleted', icon: Ban, tone: 'text-rose-600 bg-rose-50' },
  'user.create': { label: 'Staff created', icon: Users, tone: 'text-blue-600 bg-blue-50' },
  'user.update': { label: 'Staff updated', icon: Users, tone: 'text-slate-600 bg-slate-100' },
  'user.delete': { label: 'Staff removed', icon: Users, tone: 'text-rose-600 bg-rose-50' },
  'user.reset-pin': { label: 'PIN reset', icon: KeyRound, tone: 'text-amber-600 bg-amber-50' },
  'auth.change-pin': { label: 'PIN changed', icon: KeyRound, tone: 'text-slate-600 bg-slate-100' },
  'user.link-login': { label: 'Login enabled', icon: Users, tone: 'text-emerald-600 bg-emerald-50' },
  'user.unlink-login': { label: 'Login removed', icon: Users, tone: 'text-rose-600 bg-rose-50' },
  'access.update': { label: 'Access changed', icon: ShieldCheck, tone: 'text-violet-600 bg-violet-50' },
};

export const AuditLogSection: React.FC = () => {
  const { getAuditLog } = useErp();
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setRows(await getAuditLog({ limit: 200 }));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
      <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600">
            <History className="h-4.5 w-4.5" />
          </div>
          <div>
            <h2 className="text-sm font-extrabold text-slate-900">Activity &amp; Audit Log</h2>
            <p className="text-xs text-slate-500">Append-only record of financial, payroll and access changes — who did what, when.</p>
          </div>
        </div>
        <button onClick={load} className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors" title="Refresh">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="max-h-[28rem] overflow-y-auto divide-y divide-slate-100">
        {rows.length === 0 ? (
          <p className="py-10 text-center text-xs text-slate-400">{loading ? 'Loading…' : 'No activity recorded yet.'}</p>
        ) : (
          rows.map((r) => {
            const meta = ACTION_META[r.action] || { label: r.action, icon: History, tone: 'text-slate-600 bg-slate-100' };
            const Icon = meta.icon;
            const when = new Date(r.timestamp);
            return (
              <div key={r.id} className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50/60">
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${meta.tone}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-slate-800">{meta.label}</span>
                    {r.entityId && <span className="text-[11px] font-mono text-slate-400">{r.entityId}</span>}
                  </div>
                  {r.summary && <p className="text-[11px] text-slate-600 mt-0.5">{r.summary}</p>}
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {r.actor} · {when.toLocaleDateString('en-IN')} {when.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
