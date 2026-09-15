import React, { useEffect, useState } from 'react';
import { useErp } from '../../context/ErpContext';
import { BRANCHES } from '../../types';
import { Users, KeyRound, Trash2, ShieldCheck, Check, X, UserCog, Ban, CheckCircle2 } from 'lucide-react';
import { cn } from '../../lib/utils';

const branchName = (id?: string | null) => BRANCHES.find((b) => b.id === id)?.name || '—';

export const StaffAccountsSection: React.FC = () => {
  const { staffUsers, refreshStaffUsers, updateStaffUser, resetStaffPin, deleteStaffUser } = useErp();

  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetPinValue, setResetPinValue] = useState('');

  useEffect(() => { refreshStaffUsers(); }, []);

  const submitReset = async (id: string) => {
    if (!/^\d{4}$/.test(resetPinValue)) return;
    const ok = await resetStaffPin(id, resetPinValue);
    if (ok) { setResettingId(null); setResetPinValue(''); }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700">
            <Users className="h-4.5 w-4.5" />
          </div>
          <div>
            <h2 className="text-sm font-extrabold text-slate-900">Staff Login Accounts</h2>
            <p className="text-xs text-slate-500">Add staff from <span className="font-semibold text-slate-700">Attendance → Enroll Employee</span> (set an App Login role there). Manage their access &amp; PINs here.</p>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50/70 border-b border-slate-200 text-slate-500 font-bold uppercase text-[11px] tracking-wider">
              <th className="py-3 px-4">Staff</th>
              <th className="py-3 px-4">Role</th>
              <th className="py-3 px-4">Branch</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {staffUsers.length === 0 ? (
              <tr><td colSpan={5} className="py-8 text-center text-slate-400">No staff accounts yet.</td></tr>
            ) : (
              staffUsers.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50/60 align-middle">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      <div className={cn('h-8 w-8 rounded-lg flex items-center justify-center shrink-0 border', u.isSystem ? 'bg-amber-50 border-amber-200 text-amber-600' : 'bg-slate-100 border-slate-200 text-slate-600')}>
                        {u.isSystem ? <ShieldCheck className="h-4 w-4" /> : <UserCog className="h-4 w-4" />}
                      </div>
                      <div>
                        <div className="font-bold text-slate-900">{u.name}</div>
                        {u.isSystem && <div className="text-[11px] text-amber-600 font-semibold">Owner account</div>}
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4"><span className="font-semibold">{u.role}</span></td>
                  <td className="py-3 px-4 text-slate-600">{u.role === 'Manager' ? branchName(u.assignedBranchId) : '—'}</td>
                  <td className="py-3 px-4">
                    <div className="flex flex-col gap-1">
                      <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border w-fit', u.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200')}>
                        {u.status === 'active' ? <CheckCircle2 className="h-3 w-3" /> : <Ban className="h-3 w-3" />}
                        {u.status === 'active' ? 'Active' : 'Disabled'}
                      </span>
                      {u.mustResetPin && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200 w-fit">
                          <KeyRound className="h-3 w-3" /> PIN reset pending
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    {resettingId === u.id ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <input
                          value={resetPinValue} onChange={(e) => setResetPinValue(e.target.value.replace(/\D/g, '').slice(0, 4))}
                          inputMode="numeric" placeholder="New PIN" autoFocus
                          className="w-24 px-2 py-1 rounded-lg bg-white border border-slate-200 text-xs font-mono font-bold tracking-widest text-slate-900 placeholder:font-sans placeholder:font-normal focus:outline-none focus:border-blue-600"
                        />
                        <button onClick={() => submitReset(u.id)} disabled={!/^\d{4}$/.test(resetPinValue)} className="p-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-40" title="Save new PIN"><Check className="h-3.5 w-3.5" /></button>
                        <button onClick={() => { setResettingId(null); setResetPinValue(''); }} className="p-1.5 rounded-lg bg-slate-100 text-slate-500" title="Cancel"><X className="h-3.5 w-3.5" /></button>
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-1 justify-end w-full">
                        <button onClick={() => { setResettingId(u.id); setResetPinValue(''); }} title="Reset PIN" className="p-1.5 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors">
                          <KeyRound className="h-4 w-4" />
                        </button>
                        {!u.isSystem && (
                          <>
                            <button
                              onClick={() => updateStaffUser(u.id, { status: u.status === 'active' ? 'disabled' : 'active' })}
                              title={u.status === 'active' ? 'Disable account' : 'Enable account'}
                              className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                              {u.status === 'active' ? <Ban className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                            </button>
                            <button
                              onClick={() => { if (confirm(`Remove ${u.name}'s login account? They will no longer be able to sign in.`)) deleteStaffUser(u.id); }}
                              title="Delete account"
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
