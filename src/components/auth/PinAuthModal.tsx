import React, { useState } from 'react';
import { useErp } from '../../context/ErpContext';
import { PRESET_ROLES, BRANCHES, BranchId } from '../../types';
import {
  ShieldCheck,
  Building2,
  Lock,
  X,
  KeyRound,
  CheckCircle2,
  Info,
} from 'lucide-react';
import { cn } from '../../lib/utils';

export const PinAuthModal: React.FC = () => {
  const { isAuthModalOpen, setAuthModalOpen, loginWithPin, currentUser } = useErp();
  const [pinInput, setPinInput] = useState('');
  const [selectedBranchForManager, setSelectedBranchForManager] = useState<BranchId>('coimbatore');

  if (!isAuthModalOpen) return null;

  const handleKeyPress = (num: string) => {
    if (pinInput.length < 4) {
      const nextPin = pinInput + num;
      setPinInput(nextPin);
      if (nextPin.length === 4) {
        setTimeout(() => {
          loginWithPin(nextPin, selectedBranchForManager);
          setPinInput('');
        }, 150);
      }
    }
  };

  const handleBackspace = () => {
    setPinInput((prev) => prev.slice(0, -1));
  };

  const handlePresetSelect = (pin: string, branch?: BranchId) => {
    setPinInput(pin);
    setTimeout(() => {
      loginWithPin(pin, branch || selectedBranchForManager);
      setPinInput('');
    }, 150);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden text-slate-900 flex flex-col">
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-blue-100 border border-blue-200 flex items-center justify-center text-blue-700">
              <KeyRound className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Role Authentication</h2>
              <p className="text-xs text-slate-500">Enter 4-digit PIN or pick demo preset</p>
            </div>
          </div>
          <button
            onClick={() => setAuthModalOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-6 bg-white">
          {/* Quick Presets for Demo */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[11px] uppercase font-bold tracking-wider text-slate-500">
                Demo Quick Presets
              </span>
              <span className="text-[10px] text-blue-600 flex items-center gap-1 font-semibold">
                <Info className="h-3 w-3" /> One-click switch
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              {PRESET_ROLES.map((preset) => {
                const isCurrent = currentUser.role === preset.role;
                return (
                  <button
                    key={preset.role}
                    onClick={() => handlePresetSelect(preset.pin, preset.defaultBranch)}
                    className={cn(
                      'p-3 rounded-xl border flex flex-col items-start text-left transition-all relative overflow-hidden group',
                      isCurrent
                        ? 'bg-blue-50 border-blue-400 shadow-xs'
                        : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                    )}
                  >
                    {isCurrent && (
                      <div className="absolute top-2 right-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-blue-600" />
                      </div>
                    )}
                    <div className="h-7 w-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center mb-2 shadow-2xs">
                      {preset.role === 'CEO' && <ShieldCheck className="h-4 w-4 text-amber-600" />}
                      {preset.role === 'Manager' && <Building2 className="h-4 w-4 text-blue-600" />}
                      {preset.role === 'Billing' && <Lock className="h-4 w-4 text-slate-600" />}
                    </div>
                    <span className="text-xs font-bold text-slate-900 block">{preset.role}</span>
                    <span className="text-[10px] text-slate-500 block font-mono">PIN: {preset.pin}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Manager Branch Selector Configuration */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-700 font-semibold">Manager's Assigned Branch:</span>
              <span className="text-[10px] text-slate-400">(for role testing)</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {BRANCHES.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setSelectedBranchForManager(b.id)}
                  className={cn(
                    'py-1.5 px-2 rounded-lg text-xs font-semibold border transition-colors truncate text-center',
                    selectedBranchForManager === b.id
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                  )}
                >
                  {b.name}
                </button>
              ))}
            </div>
          </div>

          {/* PIN Display Dots */}
          <div className="flex flex-col items-center">
            <div className="flex gap-3 mb-4">
              {[0, 1, 2, 3].map((idx) => (
                <div
                  key={idx}
                  className={cn(
                    'h-3.5 w-3.5 rounded-full transition-all duration-150',
                    idx < pinInput.length
                      ? 'bg-blue-600 ring-4 ring-blue-100 scale-110'
                      : 'bg-slate-200'
                  )}
                />
              ))}
            </div>
            <p className="text-[11px] text-slate-500">
              CEO (1111) • Manager (2222) • Billing (3333)
            </p>
          </div>

          {/* PIN Keypad */}
          <div className="grid grid-cols-3 gap-2 max-w-[280px] mx-auto">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button
                key={digit}
                onClick={() => handleKeyPress(digit)}
                className="h-12 rounded-xl bg-slate-50 hover:bg-slate-100 active:bg-blue-600 active:text-white text-slate-900 font-bold text-lg border border-slate-200 transition-all flex items-center justify-center shadow-xs"
              >
                {digit}
              </button>
            ))}
            <button
              onClick={() => setPinInput('')}
              className="h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold text-xs border border-slate-200 transition-all flex items-center justify-center"
            >
              Clear
            </button>
            <button
              onClick={() => handleKeyPress('0')}
              className="h-12 rounded-xl bg-slate-50 hover:bg-slate-100 active:bg-blue-600 active:text-white text-slate-900 font-bold text-lg border border-slate-200 transition-all flex items-center justify-center shadow-xs"
            >
              0
            </button>
            <button
              onClick={handleBackspace}
              className="h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold text-xs border border-slate-200 transition-all flex items-center justify-center"
            >
              ⌫
            </button>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 text-center">
          <p className="text-[11px] text-slate-500">
            Master catalog pricing is protected by role-based authentication
          </p>
        </div>
      </div>
    </div>
  );
};
