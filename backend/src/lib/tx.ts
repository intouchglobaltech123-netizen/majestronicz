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

/**
 * SAL10-1: the sale chain (sale, edit, return, void, delete, reverse return)
 * runs at Read Committed and takes explicit ROW locks on exactly the rows it
 * changes (the bill, its customer(s), the stock rows of its items, the number
 * counter) instead of Serializable over whole tables. Serializable turned every
 * whole-table read into a conflict with every other cashier (one invoice-number
 * counter, all bills, all stock), so 6 cashiers saw 18 s saves and 500s.
 * Locks are always taken in the same order — bill → quote → customers (by id)
 * → stock rows (by item id) → number counter — and a deadlock or unique clash
 * is retried.
 */
export function lockedTx<T>(fn: (tx: any) => Promise<T>): Promise<T> {
  return withRetry(() => prisma.$transaction(fn, { isolationLevel: 'ReadCommitted', maxWait: 15_000, timeout: 60_000 }));
}

/** Lock one bill row (no-op when it does not exist). */
export async function lockInvoice(tx: any, id: string | null | undefined): Promise<void> {
  if (id) await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${String(id)} FOR UPDATE`;
}

/** Lock one quotation row. */
export async function lockEstimate(tx: any, id: string | null | undefined): Promise<void> {
  if (id) await tx.$queryRaw`SELECT id FROM "Estimate" WHERE id = ${String(id)} FOR UPDATE`;
}

/** Lock customer rows, in id order. */
export async function lockCustomers(tx: any, ids: (string | null | undefined)[]): Promise<void> {
  const list = [...new Set(ids.filter(Boolean).map(String))].sort();
  if (list.length) await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ANY(${list}::text[]) ORDER BY id FOR UPDATE`;
}

/**
 * Lock and read the stock rows of these items at one branch (in item order).
 * Returns the rows, read AFTER the lock so they are the latest committed values.
 */
export async function lockStockRows(tx: any, branchId: string, itemIds: Iterable<string>): Promise<any[]> {
  const list = [...new Set([...itemIds].filter(Boolean).map(String))].sort();
  if (!list.length) return [];
  await tx.$queryRaw`SELECT "itemId" FROM "BranchStock" WHERE "branchId" = ${branchId} AND "itemId" = ANY(${list}::text[]) ORDER BY "itemId" FOR UPDATE`;
  return tx.branchStock.findMany({ where: { branchId, itemId: { in: list } } });
}

/** PUR10-1: lock one purchase order row before a read-modify-write of its
 *  attachment / supplier-bill lists, so two uploads at once can't lose one. */
export async function lockPurchaseOrder(tx: any, id: string | null | undefined): Promise<void> {
  if (id) await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${String(id)} FOR UPDATE`;
}
