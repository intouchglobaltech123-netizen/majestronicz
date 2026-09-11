import React, { useState } from 'react';
import { useErp } from '../../context/ErpContext';
import { BRANCHES, BranchId } from '../../types';
import { MajestroniczLogo } from '../common/MajestroniczLogo';
import { Delete, LogIn, Building2 } from 'lucide-react';

/**
 * Mandatory login gate. The app is not usable until a valid PIN is entered and
 * verified by the backend (which issues the session token). No default session,
 * no quick role switching.
 */
export const LoginScreen: React.FC = () => {
  const { loginWithPin } = useErp();
  const [pin, setPin] = useState('');
  const [branch, setBranch] = useState<BranchId>('coimbatore');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (finalPin: string) => {
    if (finalPin.length !== 4 || submitting) return;
    setSubmitting(true);
    const ok = await loginWithPin(finalPin, branch);
    if (!ok) {
      setPin('');
      setSubmitting(false);
    }
    // on success the gate unmounts as the app renders
  };

  const press = (d: string) => {
    if (pin.length >= 4 || submitting) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) setTimeout(() => submit(next), 120);
  };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white border border-slate-200 shadow-xl p-7">
        <div className="flex flex-col items-center gap-2 mb-6">
          <MajestroniczLogo />
          <p className="text-xs font-semibold text-slate-500 mt-2">Enter your PIN to sign in</p>
        </div>

        {/* PIN dots */}
        <div className="flex justify-center gap-3 mb-5">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`h-3.5 w-3.5 rounded-full border-2 transition-colors ${
                i < pin.length ? 'bg-blue-600 border-blue-600' : 'border-slate-300'
              }`}
            />
          ))}
        </div>

        {/* Branch selector (applies for Manager sign-in) */}
        <div className="mb-5">
          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 mb-1.5">
            <Building2 className="h-3.5 w-3.5" /> Branch (for Manager login)
          </label>
          <select
            value={branch}
            onChange={(e) => setBranch(e.target.value as BranchId)}
            className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm font-medium text-slate-800 focus:outline-none focus:border-blue-600"
          >
            {BRANCHES.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-2.5">
          {keys.map((k) => (
            <button
              key={k}
              onClick={() => press(k)}
              disabled={submitting}
              className="py-3.5 rounded-xl bg-slate-50 border border-slate-200 text-lg font-bold text-slate-800 hover:bg-slate-100 active:bg-slate-200 transition-colors disabled:opacity-50"
            >
              {k}
            </button>
          ))}
          <button
            onClick={() => setPin((p) => p.slice(0, -1))}
            disabled={submitting}
            className="py-3.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-500 hover:bg-slate-100 flex items-center justify-center disabled:opacity-50"
            aria-label="Backspace"
          >
            <Delete className="h-5 w-5" />
          </button>
          <button
            onClick={() => press('0')}
            disabled={submitting}
            className="py-3.5 rounded-xl bg-slate-50 border border-slate-200 text-lg font-bold text-slate-800 hover:bg-slate-100 active:bg-slate-200 transition-colors disabled:opacity-50"
          >
            0
          </button>
          <button
            onClick={() => submit(pin)}
            disabled={pin.length !== 4 || submitting}
            className="py-3.5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 flex items-center justify-center disabled:opacity-40 transition-colors"
            aria-label="Sign in"
          >
            <LogIn className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
};
