// Fast / average / slow / no-sale stock movement (#2), classified from how many
// units an item sold over a trailing window — "based on previous sale". Shared by
// the Inventory screen and the Stock Valuation report so both always agree.

export type StockMovement = 'fast' | 'average' | 'slow' | 'no-sale';

/** Defaults: 90-day window, fast ≥ 10/month, average ≥ 2/month (else slow). */
export const MOVEMENT_WINDOW_DAYS = 90;
export const DEFAULT_FAST_PER_MONTH = 10;
export const DEFAULT_AVERAGE_PER_MONTH = 2;

export interface MovementThresholds {
  windowDays?: number;
  fastPerMonth?: number;
  averagePerMonth?: number;
}

/** Classify an item from its NET units sold over the window. */
export function classifyStockMovement(unitsSold: number, t?: MovementThresholds): StockMovement {
  if (!(Number(unitsSold) > 0)) return 'no-sale';
  const windowDays = t?.windowDays && t.windowDays > 0 ? t.windowDays : MOVEMENT_WINDOW_DAYS;
  const fast = t?.fastPerMonth != null && t.fastPerMonth > 0 ? t.fastPerMonth : DEFAULT_FAST_PER_MONTH;
  const average = t?.averagePerMonth != null && t.averagePerMonth >= 0 ? t.averagePerMonth : DEFAULT_AVERAGE_PER_MONTH;
  const perMonth = Number(unitsSold) / (windowDays / 30);
  if (perMonth >= fast) return 'fast';
  if (perMonth >= average) return 'average';
  return 'slow';
}

export const MOVEMENT_META: Record<StockMovement, { label: string; short: string; cls: string }> = {
  fast: { label: 'Fast moving', short: 'Fast', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  average: { label: 'Average', short: 'Average', cls: 'bg-blue-100 text-blue-800 border-blue-200' },
  slow: { label: 'Slow moving', short: 'Slow', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  'no-sale': { label: 'No sales', short: 'No sales', cls: 'bg-rose-100 text-rose-800 border-rose-200' },
};

/** NET units sold for an item from the server's itemSales90d map, branch-scoped. */
export function unitsSoldFor(
  itemSales: Record<string, Record<string, number>> | undefined,
  itemId: string,
  branchScope: string, // branch id, or 'all'
): number {
  const byBranch = (itemSales || {})[itemId];
  if (!byBranch) return 0;
  if (branchScope === 'all') return Object.values(byBranch).reduce((t, n) => t + (Number(n) || 0), 0);
  return Number(byBranch[branchScope]) || 0;
}
