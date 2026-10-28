import React, { useState } from 'react';
import { AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';
import { useOutbox } from '../../lib/saveOutbox';
import { useErp } from '../../context/ErpContext';

/**
 * A loud, always-on-screen banner shown whenever one or more bills are still
 * waiting to reach the server (the save caught a network/server-down moment).
 * It reassures staff the bill is safe, auto-retries, and offers a manual retry.
 * Hidden entirely when the outbox is empty (the normal state).
 */
export const UnsavedBillsBanner: React.FC = () => {
  const pending = useOutbox();
  const { flushOutbox } = useErp();
  const [busy, setBusy] = useState(false);

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
