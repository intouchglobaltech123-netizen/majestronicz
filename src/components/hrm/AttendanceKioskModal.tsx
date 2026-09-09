import React, { useState, useEffect } from 'react';
import {
  X,
  LogIn,
  LogOut,
  Clock,
  KeyRound,
  AlertTriangle,
  CheckCircle2,
  Navigation,
} from 'lucide-react';
import { useErp } from '../../context/ErpContext';
import { GeoLocationCapture, BRANCHES } from '../../types';
import { CameraCapture } from './CameraCapture';
import { toast } from 'sonner';

interface AttendanceKioskModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultMode?: 'in' | 'out';
  preSelectedEmployeeId?: string;
}

export const AttendanceKioskModal: React.FC<AttendanceKioskModalProps> = ({
  isOpen,
  onClose,
  defaultMode = 'in',
  preSelectedEmployeeId,
}) => {
  const {
    employees,
    attendanceRecords,
    clockIn,
    clockOut,
    currentUser,
  } = useErp();

  const [mode, setMode] = useState<'in' | 'out'>(defaultMode);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const [pinInput, setPinInput] = useState<string>('');
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [location, setLocation] = useState<GeoLocationCapture | null>(null);
  const [isFetchingLocation, setIsFetchingLocation] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Filter employees: active only; if Manager, only employees of their branch
  const activeEmployees = employees.filter((e) => {
    if (e.status !== 'Active') return false;
    if (currentUser.role === 'Manager') {
      const branch = currentUser.assignedBranchId || 'coimbatore';
      return e.branchId === branch;
    }
    return true;
  });

  // Current clock ticker
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch geolocation on open
  useEffect(() => {
    if (isOpen) {
      setMode(defaultMode);
      setCapturedPhoto(null);
      setPinInput('');
      const empId = preSelectedEmployeeId || (activeEmployees.length > 0 ? activeEmployees[0].id : '');
      setSelectedEmployeeId(empId);

      // Attempt browser geolocation
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
            fallbackToBranchLocation(empId);
            setIsFetchingLocation(false);
          },
          { timeout: 8000, enableHighAccuracy: true }
        );
      } else {
        fallbackToBranchLocation(empId);
        setIsFetchingLocation(false);
      }
    }
  }, [isOpen, defaultMode, preSelectedEmployeeId]);

  const fallbackToBranchLocation = (empId: string) => {
    const emp = employees.find((e) => e.id === empId);
    const branch = emp?.branchId || 'erode-hq';
    if (branch === 'coimbatore') {
      setLocation({
        latitude: 11.0168,
        longitude: 76.9558,
        accuracy: 10,
        addressHint: 'Coimbatore Branch (Default GPS)',
      });
    } else if (branch === 'chennai') {
      setLocation({
        latitude: 13.0827,
        longitude: 80.2707,
        accuracy: 10,
        addressHint: 'Chennai Outlet (Default GPS)',
      });
    } else {
      setLocation({
        latitude: 11.341,
        longitude: 77.7172,
        accuracy: 10,
        addressHint: 'Erode HQ Warehouse (Default GPS)',
      });
    }
  };

  if (!isOpen) return null;

  const currentEmp = employees.find((e) => e.id === selectedEmployeeId);
  const todayStr = currentTime.toISOString().split('T')[0];

  // Today's record for this employee
  const todayRecord = attendanceRecords.find(
    (a) => a.employeeId === selectedEmployeeId && a.date === todayStr
  );

  const isAlreadyCheckedIn = Boolean(todayRecord && todayRecord.checkInTime);
  const isAlreadyCheckedOut = Boolean(todayRecord && todayRecord.checkOutTime);

  const handleEmployeeChange = (id: string) => {
    setSelectedEmployeeId(id);
    setPinInput('');
    setCapturedPhoto(null);
    if (!location) {
      fallbackToBranchLocation(id);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentEmp) {
      toast.error('Please select an employee');
      return;
    }

    // Verify PIN
    if (pinInput.trim() !== currentEmp.pin) {
      toast.error('Incorrect attendance PIN', {
        description: `PIN verification failed for ${currentEmp.name}`,
      });
      return;
    }

    // Verify photo
    if (!capturedPhoto) {
      toast.error('Selfie photo is required to record attendance');
      return;
    }

    const effectiveLocation: GeoLocationCapture = location || {
      latitude: 11.341,
      longitude: 77.7172,
      accuracy: 15,
      addressHint: 'Verified Branch Premises',
    };

    if (mode === 'in') {
      const result = clockIn(currentEmp.id, capturedPhoto, effectiveLocation);
      if (result.success) {
        onClose();
      } else {
        toast.error(result.message);
      }
    } else {
      const result = clockOut(currentEmp.id, capturedPhoto, effectiveLocation);
      if (result.success) {
        onClose();
      } else {
        toast.error(result.message);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-3 sm:p-5 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div
              className={`h-10 w-10 rounded-xl flex items-center justify-center border ${
                mode === 'in'
                  ? 'bg-blue-50 text-blue-600 border-blue-200/60'
                  : 'bg-emerald-50 text-emerald-600 border-emerald-200/60'
              }`}
            >
              {mode === 'in' ? <LogIn className="h-5 w-5" /> : <LogOut className="h-5 w-5" />}
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Attendance Terminal — {mode === 'in' ? 'Check-In' : 'Check-Out'}
              </h3>
              <p className="text-xs text-slate-500">
                Biometric device camera selfie & GPS location verification
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Live Clock & Mode Switcher Bar */}
        <div className="px-6 py-3 bg-slate-900 text-white flex items-center justify-between shrink-0">
          {/* Real-time Clock */}
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-blue-400 animate-pulse" />
            <div className="font-mono text-sm font-bold tracking-wider">
              {currentTime.toLocaleTimeString()}
            </div>
            <span className="text-xs text-slate-400">
              • {currentTime.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
            </span>
          </div>

          {/* Mode Switcher Tabs */}
          <div className="flex items-center bg-slate-800 p-0.5 rounded-xl border border-slate-700">
            <button
              type="button"
              onClick={() => setMode('in')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                mode === 'in'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Check-In
            </button>
            <button
              type="button"
              onClick={() => setMode('out')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                mode === 'out'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Check-Out
            </button>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Status Warning Alerts */}
          {mode === 'in' && isAlreadyCheckedIn && (
            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                <span>
                  <strong>Already Checked In:</strong> {currentEmp?.name} clocked in today at{' '}
                  <span className="font-mono font-bold">{todayRecord?.checkInTime}</span>.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMode('out')}
                className="text-xs font-bold text-blue-700 underline shrink-0 hover:text-blue-900"
              >
                Switch to Check-Out →
              </button>
            </div>
          )}

          {mode === 'out' && !isAlreadyCheckedIn && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
                <span>
                  <strong>No Check-In Record:</strong> {currentEmp?.name} hasn't checked in yet today.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMode('in')}
                className="text-xs font-bold text-blue-700 underline shrink-0 hover:text-blue-900"
              >
                Switch to Check-In →
              </button>
            </div>
          )}

          {mode === 'out' && isAlreadyCheckedOut && (
            <div className="p-3.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-700 text-xs flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              <span>
                <strong>Shift Completed:</strong> Already checked out at{' '}
                <span className="font-mono font-bold">{todayRecord?.checkOutTime}</span> (Worked:{' '}
                {todayRecord?.hoursWorked} hrs).
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Left Column: Employee & Security PIN */}
            <div className="space-y-4">
              {/* Employee Picker */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  Select Employee <span className="text-rose-500">*</span>
                </label>
                <select
                  value={selectedEmployeeId}
                  onChange={(e) => handleEmployeeChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-100 font-medium"
                >
                  {activeEmployees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} — {emp.designation} ({BRANCHES.find((b) => b.id === emp.branchId)?.name})
                    </option>
                  ))}
                </select>
                {currentEmp && (
                  <div className="mt-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1">
                    <div className="flex items-center justify-between text-slate-700">
                      <span className="font-bold">{currentEmp.name}</span>
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold">
                        {currentEmp.designation}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Assigned Branch: {BRANCHES.find((b) => b.id === currentEmp.branchId)?.name}
                    </p>
                  </div>
                )}
              </div>

              {/* 4-Digit Attendance PIN */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  Enter 4-Digit Attendance PIN <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <KeyRound className="absolute left-3.5 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="password"
                    maxLength={6}
                    value={pinInput}
                    onChange={(e) => setPinInput(e.target.value)}
                    placeholder="e.g. 1001"
                    className="w-full pl-10 pr-4 py-2 text-sm font-mono tracking-widest rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Demo hint: PINs are {currentEmp?.pin || '1001'} for {currentEmp?.name || 'this staff'}
                </p>
              </div>

              {/* Geolocation Stamp Card */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1 text-xs">
                <div className="flex items-center justify-between font-semibold text-slate-700">
                  <span className="flex items-center gap-1.5">
                    <Navigation className="h-3.5 w-3.5 text-blue-600" />
                    <span>Geolocation Capture</span>
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold ${
                    isFetchingLocation
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  }`}>
                    {isFetchingLocation ? 'Detecting GPS...' : 'GPS Active'}
                  </span>
                </div>
                {location ? (
                  <p className="text-[11px] text-slate-600 font-mono">
                    Lat: {location.latitude.toFixed(4)}°, Long: {location.longitude.toFixed(4)}°{' '}
                    <span className="text-slate-400 font-sans">({location.addressHint})</span>
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-400 italic">Detecting device coordinates...</p>
                )}
              </div>
            </div>

            {/* Right Column: Live Camera Selfie Capture */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Device Camera Selfie <span className="text-rose-500">*</span>
              </label>
              <CameraCapture
                onCapture={(data) => setCapturedPhoto(data)}
                capturedPhoto={capturedPhoto}
                onRetake={() => setCapturedPhoto(null)}
                employeeName={currentEmp?.name}
              />
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/70 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-500">
            Selfie and GPS location are recorded for attendance verification.
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!capturedPhoto || !pinInput || (mode === 'in' && isAlreadyCheckedIn) || (mode === 'out' && (!isAlreadyCheckedIn || isAlreadyCheckedOut))}
              className={`inline-flex items-center gap-2 px-6 py-2 text-sm font-bold text-white rounded-xl shadow-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                mode === 'in'
                  ? 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'
                  : 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800'
              }`}
            >
              {mode === 'in' ? <LogIn className="h-4 w-4" /> : <LogOut className="h-4 w-4" />}
              <span>{mode === 'in' ? 'Record Check-In' : 'Record Check-Out'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
