import { useSyncExternalStore } from 'react';
import type { Invoice } from '../types';

/**
 * Save outbox — the reliability net for billing.
 *
 * Every bill is written here (browser localStorage) the instant Save is pressed,
 * BEFORE the network call. If the save confirms, the entry is removed. If it
 * fails because the server is down / unreachable (e.g. a Railway redeploy
 * restarts the API for ~30s), the entry STAYS and is auto-retried until it
 * lands. Nothing is ever lost just because the save moment caught a restart.
 *
 * Retries are safe against duplicates: each bill carries a stable `clientKey`
 * (see newClientKey) that the backend treats as an idempotency key — a retry of
 * a save that actually reached the DB returns the same bill, never a second one.
 *
 * The queue survives refreshes and crashes because it is in localStorage. It is
 * read back through an in-memory cache so React's useSyncExternalStore gets a
 * stable reference and the banner never loops.
 */

export interface OutboxBill {
  clientKey: string;
  invoice: Invoice;
  queuedAt: string; // ISO
  attempts: number;
  lastError?: string;
  // Lightweight display fields so the banner never has to parse the invoice.
  customerName?: string;
  grandTotal?: number;
}

const KEY = 'majestronicz_save_outbox_v1';

// In-memory mirror of the stored queue. getSnapshot returns THIS reference, so
// it stays identical between renders until a real mutation replaces it.
let cache: OutboxBill[] | null = null;
const listeners = new Set<() => void>();

const read = (): OutboxBill[] => {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? parsed : [];
  } catch {
    cache = [];
  }
  return cache;
};

const write = (next: OutboxBill[]): void => {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full / blocked — the in-memory cache still drives this session */
  }
  listeners.forEach((l) => {
    try { l(); } catch { /* ignore */ }
  });
};

/** A stable, collision-proof key minted once per bill and reused on retries. */
export const newClientKey = (): string => {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return 'ck-' + crypto.randomUUID();
  } catch { /* ignore */ }
  return 'ck-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
};

export const getOutbox = (): OutboxBill[] => read();

/** Add or replace a bill in the outbox (keyed by clientKey). */
export const enqueueBill = (invoice: Invoice): void => {
  if (!invoice.clientKey) return;
  const list = read();
  const existing = list.find((b) => b.clientKey === invoice.clientKey);
  const entry: OutboxBill = {
    clientKey: invoice.clientKey,
    invoice,
    queuedAt: existing?.queuedAt || new Date().toISOString(),
    attempts: existing?.attempts || 0,
    lastError: existing?.lastError,
    customerName: invoice.customerName,
    grandTotal: invoice.grandTotal,
  };
  write([...list.filter((b) => b.clientKey !== invoice.clientKey), entry]);
};

/** Record that a retry was attempted and failed (keeps the bill queued). */
export const markBillAttempt = (clientKey: string, error?: string): void => {
  const list = read();
  write(list.map((b) => (b.clientKey === clientKey ? { ...b, attempts: b.attempts + 1, lastError: error } : b)));
};

/** Remove a bill from the outbox — it is safely stored in the DB now. */
export const removeBill = (clientKey: string): void => {
  const list = read();
  if (!list.some((b) => b.clientKey === clientKey)) return;
  write(list.filter((b) => b.clientKey !== clientKey));
};

export const subscribeOutbox = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

// Keys whose save is in flight RIGHT NOW (an inline save or a retry). The retry
// loop skips these so the same bill is never POSTed twice at the same instant —
// which, with no DB unique constraint, is what keeps a duplicate from slipping
// through the gap before the first POST commits. In-memory only (a tab reload
// clears it, which is correct: nothing is in flight after a reload).
const inFlight = new Set<string>();
export const markInFlight = (clientKey: string): void => { inFlight.add(clientKey); };
export const clearInFlight = (clientKey: string): void => { inFlight.delete(clientKey); };
export const isInFlight = (clientKey: string): boolean => inFlight.has(clientKey);

// Keep multiple tabs in sync — another tab's save/retry updates this one's banner.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      cache = null; // force a re-read from storage
      listeners.forEach((l) => { try { l(); } catch { /* ignore */ } });
    }
  });
}

/** React hook: the live list of bills still waiting to reach the server. */
export const useOutbox = (): OutboxBill[] =>
  useSyncExternalStore(subscribeOutbox, getOutbox, getOutbox);
