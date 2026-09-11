import { prisma } from '../db.js';
import { withRetry } from './retry.js';

/**
 * Runs a transaction at Serializable isolation with automatic retry on
 * serialization/unique conflicts. Use for stock-mutating operations so
 * concurrent writes to the same branch stock can never lose updates or
 * oversell — Postgres aborts the conflicting tx and we transparently retry.
 */
export function serializableTx<T>(fn: (tx: any) => Promise<T>): Promise<T> {
  return withRetry(() => prisma.$transaction(fn, { isolationLevel: 'Serializable' }));
}
