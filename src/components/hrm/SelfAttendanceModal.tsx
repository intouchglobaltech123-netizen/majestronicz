import React, { useEffect, useState } from 'react';
import { X, LogIn, LogOut, Clock, Navigation, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useErp } from '../../context/ErpContext';
import { GeoLocationCapture } from '../../types';
import { CameraCapture } from './CameraCapture';
import { apiGet, apiPost } from '../../lib/api';
import { toast } from 'sonner';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type Today = { linked: boolean; record: { checkInTime?: string; checkOutTime?: string; hoursWorked?: number } | null };

/**
 * "My Attendance" — self check-in/out for the currently logged-in user (any
 * role). Talks to the self-attendance endpoints scoped to the user's own
 * linked employee; the mode (in/out) is auto-detected server-side.
 */
export const SelfAttendanceModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { currentUser } = useErp();

  const [today, setToday] = useState<Today | null>(null);
  const [loading, setLoading] = useState(true);
  const [photo, setPhoto] = useState<string | null>(null);
  const [location, setLocation] = useState<GeoLocationCapture | null>(null);
  const [fetchingLoc, setFetchingLoc] = useState(false);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setPhoto(null);
    setToday(null);
    setLoading(true);
    apiGet<Today>('/api/attendance/self-today')
      .then((d) => setToday(d))
      .catch(() => setToday({ linked: false, record: null }))
      .finally(() => setLoading(false));

    // Best-effort geolocation
    setFetchingLoc(true);
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy, addressHint: 'Live Device Geolocation' });
          setFetchingLoc(false);
        },
        () => { setLocation(null); setFetchingLoc(false); },
        { timeout: 8000, enableHighAccuracy: true }
      );
    } else {
      setFetchingLoc(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const rec = today?.record;
  const alreadyDone = Boolean(rec?.checkOutTime);
  const mode: 'in' | 'out' = rec?.checkInTime && !rec?.checkOutTime ? 'out' : 'in';
  const linked = today?.linked !== false;

  const handleRecord = async () => {
    if (!photo) { toast.error('Please capture your selfie first'); return; }
    setSaving(true);
    try {
      const fallback: GeoLocationCapture = location || { latitude: 11.341, longitude: 77.7172, accuracy: 15, addressHint: 'Branch premises' };
      const res = await apiPost<{ action: 'in' | 'out' | 'done'; record: { checkInTime?: string; checkOutTime?: string } }>(
        '/api/attendance/self-clock',
        { photo, location: fallback }
      );
      if (res.action === 'in') toast.success(`Checked in at ${res.record.checkInTime}`);
      else if (res.action === 'out') toast.success(`Checked out at ${res.record.checkOutTime}`);
      else toast.info("You've already completed today's shift.");
      onClose();
    } catch (e: any) {
      toast.error('Could not record attendance', { description: e?.message ?? 'Please try again' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-3 sm:p-5 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-white/10 flex items-center justify-center">
              <Clock className="h-4 w-4 text-blue-300" />
            </div>
            <div>
              <h3 className="text-sm font-bold">My Attendance</h3>
              <p className="text-[11px] text-slate-300 font-mono">{now.toLocaleTimeString()}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-300 hover:text-white hover:bg-white/10 rounded-lg">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <p className="text-center text-xs text-slate-400 py-8">Loading your attendance…</p>
          ) : !linked ? (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              <span>No attendance profile is linked to your account yet. Please contact the administrator.</span>
            </div>
          ) : (
            <>
              {/* Status banner */}
              <div className={`p-3.5 rounded-xl border flex items-center gap-3 ${
                alreadyDone ? 'bg-slate-50 border-slate-200'
                  : mode === 'in' ? 'bg-blue-50 border-blue-200' : 'bg-emerald-50 border-emerald-200'
              }`}>
                <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 text-white ${
                  alreadyDone ? 'bg-slate-400' : mode === 'in' ? 'bg-blue-600' : 'bg-emerald-600'
                }`}>
                  {alreadyDone ? <CheckCircle2 className="h-5 w-5" /> : mode === 'in' ? <LogIn className="h-5 w-5" /> : <LogOut className="h-5 w-5" />}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 truncate">{currentUser.name}</p>
                  <p className="text-[11px] text-slate-600">
                    {alreadyDone
                      ? `Shift complete — out at ${rec?.checkOutTime} (${rec?.hoursWorked ?? 0} hrs)`
                      : mode === 'in'
                      ? 'Ready to record your check-in'
                      : `Checked in at ${rec?.checkInTime} — ready to check out`}
                  </p>
                </div>
              </div>

              {!alreadyDone && (
                <>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                      Take your selfie <span className="text-rose-500">*</span>
                    </label>
                    <CameraCapture
                      onCapture={(data) => setPhoto(data)}
                      capturedPhoto={photo}
                      onRetake={() => setPhoto(null)}
                      employeeName={currentUser.name}
                    />
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-semibold text-slate-700">
                      <Navigation className="h-3.5 w-3.5 text-blue-600" /> Location
                    </span>
                    {location ? (
                      <span className="text-[11px] font-mono text-slate-600">
                        {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400">{fetchingLoc ? 'Detecting…' : 'Unavailable'}</span>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-200 bg-slate-50/70 flex items-center justify-between gap-3 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
            Close
          </button>
          {linked && !alreadyDone && (
            <button
              type="button"
              onClick={handleRecord}
              disabled={!photo || saving}
              className={`inline-flex items-center gap-2 px-6 py-2 text-sm font-bold text-white rounded-xl shadow-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                mode === 'in' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              {mode === 'in' ? <LogIn className="h-4 w-4" /> : <LogOut className="h-4 w-4" />}
              <span>{saving ? 'Recording…' : mode === 'in' ? 'Check In' : 'Check Out'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
