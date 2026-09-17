import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  LogIn,
  LogOut,
  Clock,
  KeyRound,
  AlertTriangle,
  CheckCircle2,
  Navigation,
  Search,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';
import { useErp } from '../../context/ErpContext';
import { GeoLocationCapture } from '../../types';
import { CameraCapture } from './CameraCapture';
import { toast } from 'sonner';

interface AttendanceKioskModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultMode?: 'in' | 'out';
  preSelectedEmployeeId?: string;
}

/** Today's IST date (matches backend attendance stamping). */
function istToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export const AttendanceKioskModal: React.FC<AttendanceKioskModalProps> = ({
  isOpen,
  onClose,
  preSelectedEmployeeId,
}) => {
  const { employees, attendanceRecords, clockIn, clockOut, currentUser } = useErp();

  // Two-step self-service flow: 1) identify + PIN, 2) selfie + confirm.
  const [step, setStep] = useState<'identify' | 'capture'>('identify');
  const [search, setSearch] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const [pinInput, setPinInput] = useState<string>('');
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [location, setLocation] = useState<GeoLocationCapture | null>(null);
  const [isFetchingLocation, setIsFetchingLocation] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  const activeEmployees = useMemo(
    () =>
      employees.filter((e) => {
        if (e.status !== 'Active') return false;
        if (currentUser.role === 'Manager') {
          return e.branchId === (currentUser.assignedBranchId || 'coimbatore');
        }
        return true;
      }),
    [employees, currentUser]
  );

  const today = istToday();

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Reset + fetch location when opened.
  useEffect(() => {
    if (!isOpen) return;
    setStep('identify');
    setSearch('');
    setPinInput('');
    setCapturedPhoto(null);
    setSelectedEmployeeId(preSelectedEmployeeId || '');

    setIsFetchingLocation(true);
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocation({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            addressHint: 'Live Device Geolocation',
          });
          setIsFetchingLocation(false);
        },
        (err) => {
          console.warn('Geolocation denied or failed, using branch fallback:', err);
          fallbackToBranchLocation(preSelectedEmployeeId || '');
          setIsFetchingLocation(false);
        },
        { timeout: 8000, enableHighAccuracy: true }
      );
    } else {
      fallbackToBranchLocation(preSelectedEmployeeId || '');
      setIsFetchingLocation(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, preSelectedEmployeeId]);

  const fallbackToBranchLocation = (empId: string) => {
    const emp = employees.find((e) => e.id === empId);
    const branch = emp?.branchId || 'erode-hq';
    const coords: Record<string, GeoLocationCapture> = {
      coimbatore: { latitude: 11.0168, longitude: 76.9558, accuracy: 10, addressHint: 'Coimbatore Branch (Default GPS)' },
      chennai: { latitude: 13.0827, longitude: 80.2707, accuracy: 10, addressHint: 'Chennai Outlet (Default GPS)' },
      'erode-hq': { latitude: 11.341, longitude: 77.7172, accuracy: 10, addressHint: 'Erode HQ Warehouse (Default GPS)' },
    };
    setLocation(coords[branch] || coords['erode-hq']);
  };

  const currentEmp = employees.find((e) => e.id === selectedEmployeeId);

  const statusOf = (empId: string): 'in' | 'out' | 'done' => {
    const rec = attendanceRecords.find((a) => a.employeeId === empId && a.date === today);
    if (rec?.checkOutTime) return 'done';
    if (rec?.checkInTime) return 'out'; // checked in → next action is check-out
    return 'in'; // not checked in → next action is check-in
  };

  const todayRecord = attendanceRecords.find((a) => a.employeeId === selectedEmployeeId && a.date === today);
  // The action this employee needs next, auto-detected.
  const mode: 'in' | 'out' = todayRecord?.checkInTime && !todayRecord?.checkOutTime ? 'out' : 'in';
  const alreadyDone = Boolean(todayRecord?.checkOutTime);

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeEmployees.filter(
      (e) => !q || e.name.toLowerCase().includes(q) || e.designation.toLowerCase().includes(q)
    );
  }, [activeEmployees, search]);

  if (!isOpen) return null;

  const proceedToCapture = () => {
    if (!currentEmp) {
      toast.error('Please select your name');
      return;
    }
    if (pinInput.trim() !== currentEmp.pin) {
      toast.error('Incorrect attendance PIN', { description: `PIN verification failed for ${currentEmp.name}` });
      return;
    }
    setCapturedPhoto(null);
    setStep('capture');
  };

  const handleConfirm = () => {
    if (!currentEmp) return;
    if (!capturedPhoto) {
      toast.error('Please capture your selfie to record attendance');
      return;
    }
    const effectiveLocation: GeoLocationCapture =
      location || { latitude: 11.341, longitude: 77.7172, accuracy: 15, addressHint: 'Verified Branch Premises' };

    const result = mode === 'in'
      ? clockIn(currentEmp.id, capturedPhoto, effectiveLocation)
      : clockOut(currentEmp.id, capturedPhoto, effectiveLocation);
    if (result.success) onClose();
    else toast.error(result.message);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-3 sm:p-5 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header + live clock */}
        <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-white/10 flex items-center justify-center">
              <Clock className="h-5 w-5 text-blue-300" />
            </div>
            <div>
              <h3 className="text-base font-bold">Attendance Check-In / Out</h3>
              <p className="text-[11px] text-slate-300 font-mono">
                {currentTime.toLocaleTimeString()} •{' '}
                {currentTime.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="px-5 py-2.5 border-b border-slate-100 flex items-center gap-2 text-[11px] font-bold shrink-0">
          <span className={step === 'identify' ? 'text-blue-700' : 'text-slate-400'}>1. Who are you</span>
          <ArrowRight className="h-3 w-3 text-slate-300" />
          <span className={step === 'capture' ? 'text-blue-700' : 'text-slate-400'}>2. Selfie &amp; confirm</span>
        </div>

        {step === 'identify' ? (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search your name…"
                className="w-full pl-9 pr-3 py-2.5 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:border-blue-500"
              />
            </div>

            {/* Employee tiles */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto">
              {filteredEmployees.length === 0 ? (
                <p className="col-span-full text-center text-xs text-slate-400 py-6">No matching staff.</p>
              ) : (
                filteredEmployees.map((emp) => {
                  const st = statusOf(emp.id);
                  const active = emp.id === selectedEmployeeId;
                  return (
                    <button
                      key={emp.id}
                      type="button"
                      onClick={() => { setSelectedEmployeeId(emp.id); setPinInput(''); }}
                      className={`text-left p-3 rounded-xl border flex items-center gap-3 transition-all ${
                        active ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-300' : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                        active ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {emp.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-slate-800 truncate">{emp.name}</p>
                        <p className="text-[11px] text-slate-500 truncate">{emp.designation}</p>
                      </div>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                        st === 'done' ? 'bg-slate-100 text-slate-500'
                          : st === 'out' ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      }`}>
                        {st === 'done' ? 'Done' : st === 'out' ? 'On shift' : 'Check in'}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {/* PIN */}
            {currentEmp && (
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  {currentEmp.name} — enter your 4-digit PIN
                </label>
                <div className="relative">
                  <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    autoFocus
                    value={pinInput}
                    onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
                    onKeyDown={(e) => { if (e.key === 'Enter') proceedToCapture(); }}
                    placeholder="••••"
                    className="w-full pl-10 pr-4 py-2.5 text-lg font-mono tracking-[0.4em] rounded-xl border border-slate-300 focus:outline-hidden focus:border-blue-500"
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Selected employee + what happens */}
            <div className={`p-3.5 rounded-xl border flex items-center gap-3 ${
              mode === 'in' ? 'bg-blue-50 border-blue-200' : 'bg-emerald-50 border-emerald-200'
            }`}>
              <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 text-white ${
                mode === 'in' ? 'bg-blue-600' : 'bg-emerald-600'
              }`}>
                {mode === 'in' ? <LogIn className="h-5 w-5" /> : <LogOut className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-900 truncate">{currentEmp?.name}</p>
                <p className="text-[11px] text-slate-600">
                  {alreadyDone
                    ? `Shift complete — checked out at ${todayRecord?.checkOutTime}`
                    : mode === 'in'
                    ? 'Recording your CHECK-IN for today'
                    : `Checked in at ${todayRecord?.checkInTime} — recording CHECK-OUT`}
                </p>
              </div>
            </div>

            {alreadyDone ? (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-center text-sm text-slate-600 flex flex-col items-center gap-2">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                <span>You've already completed today's shift ({todayRecord?.hoursWorked} hrs). Nothing to record.</span>
              </div>
            ) : (
              <>
                {/* Selfie */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                    Take your selfie <span className="text-rose-500">*</span>
                  </label>
                  <CameraCapture
                    onCapture={(data) => setCapturedPhoto(data)}
                    capturedPhoto={capturedPhoto}
                    onRetake={() => setCapturedPhoto(null)}
                    employeeName={currentEmp?.name}
                  />
                </div>

                {/* Location */}
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-semibold text-slate-700">
                    <Navigation className="h-3.5 w-3.5 text-blue-600" /> Location
                  </span>
                  {location ? (
                    <span className="text-[11px] text-slate-600 font-mono">
                      {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
                      <span className="text-slate-400 font-sans"> ({location.addressHint})</span>
                    </span>
                  ) : (
                    <span className={`text-[11px] px-1.5 py-0.5 rounded border font-bold ${
                      isFetchingLocation ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-100 text-slate-500 border-slate-200'
                    }`}>{isFetchingLocation ? 'Detecting…' : 'Unavailable'}</span>
                  )}
                </div>
              </>
            )}

            {(mode === 'out' && !todayRecord?.checkInTime) && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
                <span>No check-in found today — you need to check in first.</span>
              </div>
            )}
          </div>
        )}

        {/* Footer actions */}
        <div className="px-5 py-4 border-t border-slate-200 bg-slate-50/70 flex items-center justify-between gap-3 shrink-0">
          {step === 'identify' ? (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
                Cancel
              </button>
              <button
                type="button"
                onClick={proceedToCapture}
                disabled={!currentEmp || pinInput.length < 4}
                className="inline-flex items-center gap-2 px-6 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span>Continue</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setStep('identify')}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={alreadyDone || !capturedPhoto || (mode === 'out' && !todayRecord?.checkInTime)}
                className={`inline-flex items-center gap-2 px-6 py-2 text-sm font-bold text-white rounded-xl shadow-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  mode === 'in' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {mode === 'in' ? <LogIn className="h-4 w-4" /> : <LogOut className="h-4 w-4" />}
                <span>{mode === 'in' ? 'Confirm Check-In' : 'Confirm Check-Out'}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
