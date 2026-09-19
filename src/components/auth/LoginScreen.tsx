import React, { useState, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import { MajestroniczLogo } from '../common/MajestroniczLogo';
import { Delete, LogIn, AlertCircle, ShieldCheck, KeyRound, Check } from 'lucide-react';

/**
 * Mandatory login gate. The app is not usable until a valid PIN is entered and
 * verified by the backend (which issues the session token). New staff accounts
 * are flagged mustResetPin and are shown a mandatory "set your PIN" step before
 * they can enter the app. Branch scope is derived from the account server-side.
 */
export const LoginScreen: React.FC = () => {
  const { loginWithPin, loginError, clearLoginError, mustResetPin } = useErp();

  if (mustResetPin) return <ForcePinReset />;

  return <PinLogin loginWithPin={loginWithPin} loginError={loginError} clearLoginError={clearLoginError} />;
};

// ---------- Standard PIN login ----------
const PinLogin: React.FC<{
  loginWithPin: (pin: string) => Promise<boolean>;
  loginError: string | null;
  clearLoginError: () => void;
}> = ({ loginWithPin, loginError, clearLoginError }) => {
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [shake, setShake] = useState(false);

  const submit = async (finalPin: string) => {
    if (finalPin.length !== 4 || submitting) return;
    setSubmitting(true);
    const ok = await loginWithPin(finalPin);
    if (!ok) {
      setPin('');
      setSubmitting(false);
      setShake(true);
      setTimeout(() => setShake(false), 450);
    }
  };

  const press = (d: string) => {
    if (pin.length >= 4 || submitting) return;
    if (loginError) clearLoginError();
    const next = pin + d;
    setPin(next);
    if (next.length === 4) setTimeout(() => submit(next), 120);
  };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-slate-100 p-4">
      <div className={`w-full max-w-sm rounded-none bg-white border border-slate-300 shadow-none p-7 ${shake ? 'animate-[shake_0.4s]' : ''}`}>
        <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-7px)}40%,80%{transform:translateX(7px)}}`}</style>
        <div className="flex flex-col items-center gap-2 mb-5">
          <MajestroniczLogo variant="stacked" size="lg" />
          <p className="text-xs font-bold text-slate-600 mt-2">Enter your 4-digit PIN to sign in</p>
        </div>

        {/* PIN dots */}
        <div className="flex justify-center gap-3 mb-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`h-3.5 w-3.5 rounded-none border-2 transition-colors ${
                i < pin.length ? 'bg-red-600 border-red-600' : loginError ? 'border-rose-400' : 'border-slate-300'
              }`}
            />
          ))}
        </div>

        {/* Inline error */}
        <div className="h-9 mb-2">
          {loginError && (
            <div className="flex items-center justify-center gap-1.5 rounded-none bg-rose-50 border border-rose-300 px-3 py-1.5 text-[11px] font-bold text-rose-800">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{loginError}</span>
            </div>
          )}
        </div>

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-2">
          {keys.map((k) => (
            <button
              key={k}
              onClick={() => press(k)}
              disabled={submitting}
              className="py-3 rounded-none bg-white border border-slate-300 text-lg font-bold text-slate-800 hover:bg-slate-50 active:bg-slate-100 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {k}
            </button>
          ))}
          <button
            onClick={() => { if (loginError) clearLoginError(); setPin((p) => p.slice(0, -1)); }}
            disabled={submitting}
            className="py-3 rounded-none bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 flex items-center justify-center disabled:opacity-50 cursor-pointer"
            aria-label="Backspace"
          >
            <Delete className="h-5 w-5" />
          </button>
          <button
            onClick={() => press('0')}
            disabled={submitting}
            className="py-3 rounded-none bg-white border border-slate-300 text-lg font-bold text-slate-800 hover:bg-slate-50 active:bg-slate-100 transition-colors disabled:opacity-50 cursor-pointer"
          >
            0
          </button>
          <button
            onClick={() => submit(pin)}
            disabled={pin.length !== 4 || submitting}
            className="py-3 rounded-none bg-red-600 text-white hover:bg-red-700 border border-red-700 flex items-center justify-center disabled:opacity-40 transition-colors cursor-pointer"
            aria-label="Sign in"
          >
            <LogIn className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------- Mandatory first-login PIN reset ----------
const ForcePinReset: React.FC = () => {
  const { currentUser, changeOwnPin, logout } = useErp();
  const [step, setStep] = useState<'new' | 'confirm'>('new');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const active = step === 'new' ? newPin : confirmPin;
  const setActive = step === 'new' ? setNewPin : setConfirmPin;

  useEffect(() => { setError(null); }, [step]);

  const finish = async (finalConfirm: string) => {
    if (newPin !== finalConfirm) {
      setError('PINs do not match. Start again.');
      setStep('new'); setNewPin(''); setConfirmPin('');
      return;
    }
    if (newPin === '0000' || newPin === '1234') {
      setError('Choose a less obvious PIN.');
      setStep('new'); setNewPin(''); setConfirmPin('');
      return;
    }
    setSubmitting(true);
    const ok = await changeOwnPin(newPin);
    setSubmitting(false);
    if (!ok) { setStep('new'); setNewPin(''); setConfirmPin(''); }
  };

  const press = (d: string) => {
    if (active.length >= 4 || submitting) return;
    if (error) setError(null);
    const next = active + d;
    setActive(next);
    if (next.length === 4) {
      if (step === 'new') setTimeout(() => setStep('confirm'), 150);
      else setTimeout(() => finish(next), 150);
    }
  };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm rounded-none bg-white border border-slate-300 shadow-none p-7">
        <div className="flex flex-col items-center gap-2 mb-4 text-center">
          <div className="h-10 w-10 rounded-none bg-amber-50 border border-amber-300 flex items-center justify-center text-amber-700">
            <KeyRound className="h-5 w-5" />
          </div>
          <h2 className="text-sm font-extrabold text-slate-900 mt-1 uppercase tracking-wide">Set your PIN</h2>
          <p className="text-xs text-slate-600 max-w-[16rem]">
            Welcome, <span className="font-bold text-slate-800">{currentUser.name}</span>. For security, please
            replace the default PIN before you continue.
          </p>
        </div>

        <div className="flex items-center justify-center gap-2 mb-3">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-none border ${step === 'new' ? 'bg-red-50 text-red-800 border-red-200' : 'bg-slate-50 text-slate-500 border-slate-300'}`}>1. New PIN</span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-none border ${step === 'confirm' ? 'bg-red-50 text-red-800 border-red-200' : 'bg-slate-50 text-slate-500 border-slate-300'}`}>2. Confirm</span>
        </div>

        {/* dots */}
        <div className="flex justify-center gap-3 mb-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`h-3.5 w-3.5 rounded-none border-2 transition-colors ${i < active.length ? 'bg-red-600 border-red-600' : 'border-slate-300'}`} />
          ))}
        </div>

        <div className="h-9 mb-2">
          {error && (
            <div className="flex items-center justify-center gap-1.5 rounded-none bg-rose-50 border border-rose-300 px-3 py-1.5 text-[11px] font-bold text-rose-800">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" /><span>{error}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {keys.map((k) => (
            <button key={k} onClick={() => press(k)} disabled={submitting} className="py-3 rounded-none bg-white border border-slate-300 text-lg font-bold text-slate-800 hover:bg-slate-50 active:bg-slate-100 transition-colors disabled:opacity-50 cursor-pointer">{k}</button>
          ))}
          <button onClick={() => setActive((p) => p.slice(0, -1))} disabled={submitting} className="py-3 rounded-none bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 flex items-center justify-center disabled:opacity-50 cursor-pointer" aria-label="Backspace">
            <Delete className="h-5 w-5" />
          </button>
          <button onClick={() => press('0')} disabled={submitting} className="py-3 rounded-none bg-white border border-slate-300 text-lg font-bold text-slate-800 hover:bg-slate-50 active:bg-slate-100 transition-colors disabled:opacity-50 cursor-pointer">0</button>
          <button
            onClick={() => step === 'confirm' && finish(confirmPin)}
            disabled={active.length !== 4 || submitting}
            className="py-3 rounded-none bg-red-600 text-white hover:bg-red-700 border border-red-700 flex items-center justify-center disabled:opacity-40 transition-colors cursor-pointer"
            aria-label="Confirm PIN"
          >
            <Check className="h-5 w-5" />
          </button>
        </div>

        <button onClick={logout} className="mt-4 w-full text-[11px] font-bold text-slate-500 hover:text-slate-800 flex items-center justify-center gap-1 cursor-pointer">
          <ShieldCheck className="h-3.5 w-3.5" /> Cancel and sign out
        </button>
      </div>
    </div>
  );
};
