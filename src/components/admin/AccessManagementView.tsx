import React, { useMemo, useState, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import {
  Role, AccessMatrix, Capability, ALL_VIEWS, ALL_CAPABILITIES, VIEW_LABELS, CAP_LABELS, PRESET_ROLES,
} from '../../types';
import { ShieldCheck, Save, RotateCcw, Lock, Check } from 'lucide-react';
import { toast } from 'sonner';

const EDITABLE_ROLES: Role[] = ['Manager', 'Billing', 'Purchase', 'Sales'];
const roleName = (r: Role) => PRESET_ROLES.find((p) => p.role === r)?.defaultName || r;

export const AccessManagementView: React.FC = () => {
  const { accessMatrix, updateAccessMatrix, currentUser } = useErp();

  const [draft, setDraft] = useState<AccessMatrix | null>(accessMatrix);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(accessMatrix); }, [accessMatrix]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(accessMatrix),
    [draft, accessMatrix]
  );

  if (currentUser.role !== 'CEO') {
    return (
      <div className="p-10 text-center text-sm text-slate-500">Access Control is available to the CEO only.</div>
    );
  }
  if (!draft) return <div className="p-10 text-center text-sm text-slate-500">Loading access matrix…</div>;

  const toggle = (role: Role, kind: 'views' | 'caps', key: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const cur = prev[role][kind] as string[];
      const has = cur.includes(key);
      const next = has ? cur.filter((x) => x !== key) : [...cur, key];
      return { ...prev, [role]: { ...prev[role], [kind]: next } };
    });
  };

  const save = async () => {
    setSaving(true);
    await updateAccessMatrix(draft);
    setSaving(false);
  };
  const resetChanges = () => { setDraft(accessMatrix); toast.info('Reverted unsaved changes'); };

  return (
    <div className="p-6 space-y-6 w-full">
      {/* Header */}
      <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="h-12 w-12 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shrink-0">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Access Control</h1>
            <p className="text-xs text-slate-600 mt-0.5">
              Grant each role the modules it can open and the actions it can perform. Changes apply
              instantly across every logged-in session and are enforced on the server.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={resetChanges}
            disabled={!dirty || saving}
            className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center gap-1.5 disabled:opacity-40 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Revert
          </button>
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-40 transition-colors shadow-xs"
          >
            <Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
          </button>
        </div>
      </div>

      {/* CEO locked card */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 flex items-center gap-3">
        <Lock className="h-4 w-4 text-amber-600" />
        <p className="text-xs font-semibold text-amber-800">
          CEO ({roleName('CEO')}) always retains full access and cannot be restricted.
        </p>
      </div>

      {/* Per-role editors */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {EDITABLE_ROLES.map((role) => {
          const cfg = draft[role];
          return (
            <div key={role} className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
              <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <span className="text-sm font-extrabold text-slate-900">{role}</span>
                  <span className="ml-2 text-[11px] text-slate-500">{roleName(role)}</span>
                </div>
                <span className="text-[10px] font-semibold text-slate-500">
                  {cfg.views.length} modules · {cfg.caps.length} actions
                </span>
              </div>

              <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-5">
                {/* Modules */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Modules (can open)</p>
                  <div className="space-y-1">
                    {ALL_VIEWS.filter((v) => v !== 'access').map((v) => {
                      const on = cfg.views.includes(v);
                      return (
                        <button
                          key={v}
                          onClick={() => toggle(role, 'views', v)}
                          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-left transition-colors ${
                            on ? 'bg-blue-50 text-blue-800 border border-blue-200' : 'bg-slate-50 text-slate-500 border border-transparent hover:bg-slate-100'
                          }`}
                        >
                          <span className={`h-4 w-4 rounded flex items-center justify-center shrink-0 ${on ? 'bg-blue-600 text-white' : 'border border-slate-300'}`}>
                            {on && <Check className="h-3 w-3" />}
                          </span>
                          {VIEW_LABELS[v] || v}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Capabilities */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Actions (can perform)</p>
                  <div className="space-y-1">
                    {ALL_CAPABILITIES.filter((c) => c !== 'admin').map((c: Capability) => {
                      const on = cfg.caps.includes(c);
                      return (
                        <button
                          key={c}
                          onClick={() => toggle(role, 'caps', c)}
                          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-left transition-colors ${
                            on ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-slate-50 text-slate-500 border border-transparent hover:bg-slate-100'
                          }`}
                        >
                          <span className={`h-4 w-4 rounded flex items-center justify-center shrink-0 ${on ? 'bg-emerald-600 text-white' : 'border border-slate-300'}`}>
                            {on && <Check className="h-3 w-3" />}
                          </span>
                          {CAP_LABELS[c] || c}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
