import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, Camera, VideoOff, CheckCircle2, Keyboard, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Phone-camera barcode scanner for billing. Point the phone at a product
 * barcode and it fires onScan(code). Uses the browser's native BarcodeDetector
 * (Android Chrome / Edge). Where that is unavailable (e.g. iOS Safari) it falls
 * back to typing the code by hand so the counter is never blocked.
 *
 * Designed for "scan many, then done": each distinct code fires once, a short
 * cooldown prevents the same barcode adding ten times, and the camera keeps
 * running so staff can scan item after item.
 */
interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with each scanned/typed code. The parent decides what to add. */
  onScan: (code: string) => void;
  title?: string;
}

// Barcode symbologies we care about for retail (EAN/UPC + Code128/39 + QR).
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'codabar', 'itf', 'qr_code'];

export const CameraScanModal: React.FC<Props> = ({ open, onClose, onScan, title = 'Scan with camera' }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectorRef = useRef<any>(null);
  const lastCodeRef = useRef<{ code: string; at: number } | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [manual, setManual] = useState('');

  const beep = useCallback(() => {
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880; gain.gain.value = 0.08;
      osc.start();
      setTimeout(() => { osc.stop(); ctx.close(); }, 90);
    } catch { /* ignore */ }
    try { navigator.vibrate?.(60); } catch { /* ignore */ }
  }, []);

  const accept = useCallback((raw: string) => {
    const code = (raw || '').trim();
    if (!code) return;
    const now = Date.now();
    // Ignore the same code fired again within 1.5s (one barcode in frame).
    if (lastCodeRef.current && lastCodeRef.current.code === code && now - lastCodeRef.current.at < 1500) return;
    lastCodeRef.current = { code, at: now };
    beep();
    setLastScan(code);
    setCount((c) => c + 1);
    onScan(code);
  }, [beep, onScan]);

  const stop = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    const hasDetector = typeof (window as any).BarcodeDetector !== 'undefined';
    setSupported(hasDetector);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (e: any) {
      setError(e?.message || 'Could not open the camera. Check camera permission.');
      return;
    }
    if (!hasDetector) return; // manual-entry fallback stays available

    try {
      detectorRef.current = new (window as any).BarcodeDetector({ formats: FORMATS });
    } catch {
      // Some browsers reject unknown formats — retry with defaults.
      try { detectorRef.current = new (window as any).BarcodeDetector(); } catch { setSupported(false); return; }
    }

    const tick = async () => {
      const video = videoRef.current;
      if (video && video.readyState >= 2 && detectorRef.current) {
        try {
          const codes = await detectorRef.current.detect(video);
          if (codes && codes.length) accept(codes[0].rawValue);
        } catch { /* transient detect error — keep going */ }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [accept]);

  useEffect(() => {
    if (open) start();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-900 inline-flex items-center gap-2"><Camera className="h-4 w-4 text-blue-600" />{title}</h3>
          <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500"><X className="h-4 w-4" /></button>
        </div>

        {/* Camera view */}
        <div className="relative bg-black aspect-[3/4] sm:aspect-video">
          <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
          {/* Aiming frame */}
          {!error && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-3/4 h-24 border-2 border-white/80 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 text-white">
              <VideoOff className="h-10 w-10 mb-2 text-rose-400" />
              <p className="text-sm font-bold">Camera not available</p>
              <p className="text-xs text-white/70 mt-1">{error}</p>
              <button onClick={start} className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-slate-800 text-xs font-bold"><RefreshCw className="h-3.5 w-3.5" /> Try again</button>
            </div>
          )}
          {/* Last scan toast */}
          {lastScan && !error && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-600 text-white text-xs font-bold shadow-lg">
              <CheckCircle2 className="h-3.5 w-3.5" /> {lastScan}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 space-y-3">
          {supported ? (
            <p className="text-[11px] text-slate-500 text-center">Point the camera at the product barcode — it adds to the bill automatically. Keep scanning, then tap Done.</p>
          ) : (
            <div className="space-y-1.5">
              <p className="text-[11px] text-amber-600 font-semibold inline-flex items-center gap-1"><Keyboard className="h-3.5 w-3.5" /> This browser can't scan with the camera — type or paste the code instead.</p>
              <form
                onSubmit={(e) => { e.preventDefault(); if (manual.trim()) { accept(manual.trim()); setManual(''); } }}
                className="flex items-center gap-2"
              >
                <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Enter barcode / item code" className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm" autoFocus />
                <button type="submit" className="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold">Add</button>
              </form>
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">{count} scanned</span>
            <button onClick={onClose} className={cn('px-4 py-2 rounded-lg text-sm font-bold', count > 0 ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700')}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CameraScanModal;
