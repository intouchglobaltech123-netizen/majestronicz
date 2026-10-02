/**
 * Retries a transaction on a recoverable concurrency error:
 *  - P2002: unique-constraint violation (two creates computed the same doc number)
 *  - P2034: write conflict / serialization failure / deadlock (Prisma's code)
 *  - P2028: the transaction timed out (rolled back) under contention (FIN-B-3)
 *  - SQLSTATE 40001 / 40P01 surfaced by a raw query (P2010) or the driver:
 *    serialization failure and deadlock (PUR10-3 — a deadlock was a 500)
 * The loser recomputes and retries with jittered backoff, so legitimate
 * concurrent writes succeed instead of erroring.
 */
export function isRetryableTxError(e: any): boolean {
  if (!e) return false;
  if (e.code === 'P2002' || e.code === 'P2034') return true;
  // FIN-B-3: a transaction that timed out waiting (P2028) was rolled back — safe to run again.
  if (e.code === 'P2028') return true;
  const sqlState = String(e?.meta?.code || e?.meta?.database_error_code || '');
  if (sqlState === '40001' || sqlState === '40P01') return true;
  return /deadlock detected|could not serialize access|40P01|40001/.test(String(e?.message || ''));
}

export async function withRetry<T>(fn: () => Promise<T>, attempts = 12): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      if (!isRetryableTxError(e)) throw e;
      const backoff = 10 * (i + 1) + Math.floor(Math.random() * 25); // jitter reduces thundering herd
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}
