/**
 * 'Opening Stock' history rows that make the stock-movement ledger add up to the
 * actual branch stock (STK-3 / UPG8-3). For every item/branch, the opening
 * quantity is the current stock MINUS the net of the movements already in the
 * ledger, so replaying (opening + movements) lands exactly on the current stock.
 * Shared by the demo reseed and the one-time scripts/fix-existing-bills.ts.
 */
export interface OpeningStockOptions {
  /** Row id for an item/branch. */
  idFor: (branchId: string, itemId: string) => string;
  /** Timestamp for the row, given the earliest existing movement (if any). */
  timestampFor: (firstMovement: string | null) => string;
  notes: string;
  adjustedBy: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function buildOpeningStockRows(
  stocks: { itemId: string; branchId: string; quantity: number }[],
  logs: { itemId: string; branchId: string; quantityChange: number; timestamp?: string | null }[],
  items: { id: string; itemName?: string | null; itemCode?: string | null }[],
  opts: OpeningStockOptions,
) {
  const meta = new Map(items.map((i) => [i.id, i]));
  const net = new Map<string, number>();
  const first = new Map<string, string>();
  for (const log of logs) {
    const k = `${log.itemId}|${log.branchId}`;
    net.set(k, (net.get(k) || 0) + (Number(log.quantityChange) || 0));
    const ts = log.timestamp || '';
    if (ts && (!first.has(k) || ts < first.get(k)!)) first.set(k, ts);
  }
  return stocks
    .map((s) => {
      const k = `${s.itemId}|${s.branchId}`;
      return { s, k, openingQty: round2((Number(s.quantity) || 0) - (net.get(k) || 0)) };
    })
    .filter((x) => x.openingQty !== 0)
    .map(({ s, k, openingQty }) => ({
      id: opts.idFor(s.branchId, s.itemId),
      itemId: s.itemId,
      itemName: meta.get(s.itemId)?.itemName || 'Item',
      itemCode: meta.get(s.itemId)?.itemCode || '',
      branchId: s.branchId,
      previousQuantity: 0,
      quantityChange: openingQty,
      newQuantity: openingQty,
      reason: 'Opening Stock',
      notes: opts.notes,
      adjustedBy: opts.adjustedBy,
      timestamp: opts.timestampFor(first.get(k) || null),
    }));
}
