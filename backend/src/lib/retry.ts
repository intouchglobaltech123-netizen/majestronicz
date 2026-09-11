/**
 * Retries a transaction on a recoverable concurrency error:
 *  - P2002: unique-constraint violation (two creates computed the same doc number)
 *  - P2034: write conflict / serialization failure (Serializable isolation)
 * The loser recomputes and retries with jittered backoff, so legitimate
 * concurrent writes succeed instead of erroring.
 */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 12): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      if (e?.code !== 'P2002' && e?.code !== 'P2034') throw e;
      const backoff = 10 * (i + 1) + Math.floor(Math.random() * 25); // jitter reduces thundering herd
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}
