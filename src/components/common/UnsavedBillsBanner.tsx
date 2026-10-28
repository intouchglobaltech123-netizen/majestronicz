import React, { useState, useEffect } from 'react';
import { AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';
import { useOutbox } from '../../lib/saveOutbox';
import { useErp } from '../../context/ErpContext';

// A bill still in the outbox with attempts=0 is one whose FIRST save is simply
// in flight right now — the normal 1–2s of every save. We must NOT alarm staff
// for that (it would flash on every single bill). We only show a bill once we
// KNOW its save failed (attempts > 0), or it has been stuck far longer than any
// healthy save would take (the POST is hanging because the server is down).
const STUCK_MS = 10_000;

/**
 * A loud, always-on-screen banner shown ONLY when one or more bills have truly
 * failed to reach the server (or are hung mid-save because it is down) and are
 * waiting to auto-retry. It reassures staff the bill is safe and offers a manual
 * retry. It stays hidden during the normal in-flight moment of a healthy save.
 */
export const UnsavedBillsBanner: React.FC = () => {
  const queued = useOutbox();
  const { flushOutbox } = useErp();
  const [busy, setBusy] = useState(false);
  // Re-evaluate the "stuck" age a couple of times a second while anything is
  // queued, so a hanging save surfaces even before its POST finally rejects.
  const [, tick] = useState(0);
  const hasQueued = queued.length > 0;
  useEffect(() => {
    if (!hasQueued) return;
    const t = setInterval(() => tick((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, [hasQueued]);

  const now = Date.now();
  const pending = queued.filter(
    (b) => (b.attempts || 0) > 0 || now - Date.parse(b.queuedAt) >= STUCK_MS,
  );

  if (!pending.length) return null;

  const total = pending.reduce((s, b) => s + (Number(b.grandTotal) || 0), 0);
  const names = pending
    .map((b) => b.customerName || 'Walk-in')
    .slice(0, 3)
    .join(', ');

  const retry = async () => {
    setBusy(true);
    try { await flushOutbox(); } finally { setBusy(false); }
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] w-[min(94vw,540px)]">
      <div className="rounded-xl border-2 border-amber-400 bg-amber-50 shadow-xl px-4 py-3 flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold text-amber-900">
            {pending.length} bill{pending.length > 1 ? 's' : ''} not saved yet — kept safe on this device
          </p>
          <p className="text-[12px] text-amber-800 mt-0.5 leading-snug">
            ₹{total.toLocaleString('en-IN')} total ({names}{pending.length > 3 ? ', …' : ''}).
            The server is unreachable; these will finish saving automatically when it is back.
            <strong> Do not re-enter them.</strong>
          </p>
        </div>
        <button
          type="button"
          onClick={retry}
          disabled={busy}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-[12px] font-bold hover:bg-amber-700 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {busy ? 'Retrying…' : 'Retry now'}
        </button>
      </div>
    </div>
  );
};
