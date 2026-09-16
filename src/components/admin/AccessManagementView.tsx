import React, { useMemo, useState, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import {
  Role, AccessMatrix, Capability, ALL_VIEWS, ALL_CAPABILITIES, ALL_FLAGS, AI_DATA_FLAGS,
  VIEW_LABELS, CAP_LABELS, FLAG_LABELS, PRESET_ROLES,
} from '../../types';
import { ShieldCheck, Save, RotateCcw, Lock, Check, Sparkles, LayoutGrid, Zap, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { StaffAccountsSection } from './StaffAccountsSection';
import { AuditLogSection } from './AuditLogSection';
import { UniversalDropdown } from '../common/UniversalDropdown';

const FIELD_FLAGS = ALL_FLAGS.filter((f) => !AI_DATA_FLAGS.includes(f));

const EDITABLE_ROLES: Role[] = ['Manager', 'Billing', 'Purchase', 'Sales'];
const roleName = (r: Role) => PRESET_ROLES.find((p) => p.role === r)?.defaultName || r;

export const AccessManagementView: React.FC = () => {
  const { accessMatrix, updateAccessMatrix, currentUser } = useErp();

  const [draft, setDraft] = useState<AccessMatrix | null>(accessMatrix);
  const [selectedRole, setSelectedRole] = useState<Role>('Manager');
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

  const toggle = (role: Role, kind: 'views' | 'caps' | 'flags', key: string) => {
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
    <div className="p-4 sm:p-6 space-y-6 w-full">
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

      {/* Staff login accounts */}
      <StaffAccountsSection />

      {/* Role editor — pick a role, then edit its access by section */}
      {(() => {
        const role = selectedRole;
        const cfg = draft[role];
        const tone: Record<string, { on: string; box: string }> = {
          blue: { on: 'bg-blue-50 text-blue-800 border-blue-200', box: 'bg-blue-600' },
          emerald: { on: 'bg-emerald-50 text-emerald-800 border-emerald-200', box: 'bg-emerald-600' },
          violet: { on: 'bg-violet-50 text-violet-800 border-violet-200', box: 'bg-violet-600' },
          fuchsia: { on: 'bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200', box: 'bg-fuchsia-600' },
        };
        const ToggleGrid = ({ items, on, onToggle, color }: { items: { key: string; label: string }[]; on: (k: string) => boolean; onToggle: (k: string) => void; color: string }) => (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {items.map((it) => {
              const active = on(it.key);
              const t = tone[color];
              return (
                <button
                  key={it.key}
                  onClick={() => onToggle(it.key)}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-left transition-colors border ${active ? t.on : 'bg-slate-50 text-slate-500 border-transparent hover:bg-slate-100'}`}
                >
                  <span className={`h-4 w-4 rounded flex items-center justify-center shrink-0 ${active ? `${t.box} text-white` : 'border border-slate-300'}`}>
                    {active && <Check className="h-3 w-3" />}
                  </span>
                  {it.label}
                </button>
              );
            })}
          </div>
        );

        const Section = ({ icon: Icon, title, hint, children }: { icon: React.ComponentType<{ className?: string }>; title: string; hint?: string; children: React.ReactNode }) => (
          <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
              <Icon className="h-4 w-4 text-slate-500" />
              <span className="text-xs font-extrabold text-slate-800 uppercase tracking-wide">{title}</span>
              {hint && <span className="text-[11px] text-slate-400 ml-1">{hint}</span>}
            </div>
            <div className="p-5">{children}</div>
          </div>
        );

        return (
          <div className="space-y-5">
            {/* Role picker */}
            <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Editing role</span>
              </div>
              <div className="w-full sm:w-72">
                <UniversalDropdown
                  value={role}
                  onChange={(v) => setSelectedRole(v as Role)}
                  options={EDITABLE_ROLES.map((r) => ({ value: r, label: r, sublabel: roleName(r) }))}
                  buttonClassName="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-bold text-slate-900"
                />
              </div>
              <span className="text-[11px] font-semibold text-slate-500 sm:ml-auto">
                {cfg.views.length} modules · {cfg.caps.length} actions · {cfg.flags.length} data scopes
              </span>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              <Section icon={LayoutGrid} title="Modules" hint="pages this role can open">
                <ToggleGrid
                  color="blue"
                  items={ALL_VIEWS.filter((v) => v !== 'access').map((v) => ({ key: v, label: VIEW_LABELS[v] || v }))}
                  on={(k) => cfg.views.includes(k)}
                  onToggle={(k) => toggle(role, 'views', k)}
                />
              </Section>

              <Section icon={Zap} title="Actions" hint="what this role can do">
                <ToggleGrid
                  color="emerald"
                  items={ALL_CAPABILITIES.filter((c) => c !== 'admin').map((c) => ({ key: c, label: CAP_LABELS[c as Capability] || c }))}
                  on={(k) => cfg.caps.includes(k as Capability)}
                  onToggle={(k) => toggle(role, 'caps', k)}
                />
              </Section>

              <Section icon={Eye} title="Field & Data Visibility" hint="Vyapar-style fine control">
                <ToggleGrid
                  color="violet"
                  items={FIELD_FLAGS.map((f) => ({ key: f, label: FLAG_LABELS[f] || f }))}
                  on={(k) => cfg.flags.includes(k)}
                  onToggle={(k) => toggle(role, 'flags', k)}
                />
              </Section>

              <Section icon={Sparkles} title="Beta AI — Data the AI Can Read">
                {!cfg.caps.includes('ai:use') && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mb-3">
                    Enable “Use Beta AI assistant” under Actions first — these scopes then limit what its AI can read.
                  </p>
                )}
                <ToggleGrid
                  color="fuchsia"
                  items={AI_DATA_FLAGS.map((f) => ({ key: f, label: FLAG_LABELS[f]?.replace(/^AI can read /, '') || f }))}
                  on={(k) => cfg.flags.includes(k)}
                  onToggle={(k) => toggle(role, 'flags', k)}
                />
              </Section>
            </div>
          </div>
        );
      })()}

      {/* Audit trail */}
      <AuditLogSection />
    </div>
  );
};
