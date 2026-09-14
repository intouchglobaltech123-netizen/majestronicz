export const nowIso = () => new Date().toISOString();
export const cleanPhone = (raw?: string): string => {
  let d = (raw || '').trim().replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
};
export const rid = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

/**
 * In-memory branch-stock ledger mirroring the original frontend array logic,
 * scoped to a single branch. Accumulates deltas then flushes changed rows via
 * upsert inside the caller's transaction.
 */
export class StockLedger {
  private map = new Map<string, { quantity: number; location?: string | null; existed: boolean }>();
  private touched = new Set<string>();
  constructor(rows: any[], private branchId: string) {
    for (const r of rows) {
      if (r.branchId === branchId) {
        this.map.set(r.itemId, { quantity: r.quantity, location: r.location, existed: true });
      }
    }
  }
  qty(itemId: string) {
    return this.map.get(itemId)?.quantity ?? 0;
  }
  /** Apply a delta (negative = out, positive = in). floorZero clamps at 0. Returns prev/new. */
  apply(itemId: string, delta: number, floorZero = false) {
    const cur = this.map.get(itemId);
    const prevQty = cur?.quantity ?? 0;
    const raw = prevQty + delta;
    const newQty = floorZero ? Math.max(0, raw) : raw;
    this.map.set(itemId, {
      quantity: newQty,
      location: cur?.location ?? null,
      existed: cur?.existed ?? false,
    });
    this.touched.add(itemId);
    return { prevQty, newQty };
  }
  async flush(tx: any) {
    const ts = nowIso();
    for (const itemId of this.touched) {
      const row = this.map.get(itemId)!;
      await tx.branchStock.upsert({
        where: { itemId_branchId: { itemId, branchId: this.branchId } },
        create: {
          itemId,
          branchId: this.branchId,
          quantity: row.quantity,
          location: row.location ?? null,
          updatedAt: ts,
        },
        update: { quantity: row.quantity, updatedAt: ts },
      });
    }
  }
}
