import { Invoice } from '../types';
import { getTodayDateString } from './utils';

/**
 * Average units of an item sold per month, from real sales history.
 * Looks back `windowDays` (default 90) and normalises to a monthly figure, so a
 * one-off spike is smoothed. Voided invoices are ignored. Branch-scoped when a
 * branchId is given (matches how stock is counted per branch).
 */
export function averageMonthlyUnitsSold(
  itemId: string,
  invoices: Invoice[],
  branchId?: string,
  windowDays = 90
): number {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffStr = getTodayDateString(cutoff);

  let units = 0;
  for (const inv of invoices) {
    if (inv.isVoided) continue;
    if (branchId && inv.branchId !== branchId) continue;
    if ((inv.date || '') < cutoffStr) continue;
    for (const li of inv.items) {
      if (li.itemId === itemId) units += li.quantity || 0;
    }
  }
  const months = Math.max(1, windowDays / 30);
  return units / months;
}

/**
 * Dynamic low-stock reorder threshold = average monthly units sold + buffer (default 10).
 * Falls back to the item's static threshold when there is no sales history yet.
 * e.g. an item that moves ~35/month → alert when stock drops below 45.
 */
export function dynamicReorderThreshold(
  itemId: string,
  invoices: Invoice[],
  branchId: string | undefined,
  fallback: number,
  buffer = 10
): number {
  const avg = averageMonthlyUnitsSold(itemId, invoices, branchId);
  if (avg <= 0) return fallback; // no sales yet → keep the manual/static threshold
  return Math.round(avg) + buffer;
}

/** Units of each item sold per branch over the last 90 days (server-computed,
 *  sent to every role in the bootstrap as itemSales90d). */
export type ItemSales90d = Record<string, Record<string, number>>;

/**
 * THE low-stock threshold every screen uses (INV2-10): the item's average monthly
 * sales over the last 90 days + 10, from the server's sales figures, so every
 * role (Purchase has no bills) and every screen sees the same number. Falls back
 * to the item's static threshold when it has not sold in that window.
 */
export function reorderThresholdOf(
  sales: ItemSales90d | undefined,
  itemId: string,
  branchId: string | undefined,
  fallback: number,
  buffer = 10
): number {
  const row = sales?.[itemId];
  const units = !row ? 0 : branchId ? row[branchId] || 0 : Object.values(row).reduce((t, n) => t + (n || 0), 0);
  const avg = units / 3; // 90 days = 3 months
  if (avg <= 0) return fallback;
  return Math.round(avg) + buffer;
}

export type StockStatus = 'in-stock' | 'low-stock' | 'out-of-stock';

/** Out of stock at 0 or less; low at or below the threshold; else in stock. */
export const stockStatusOf = (qty: number, threshold: number): StockStatus =>
  qty <= 0 ? 'out-of-stock' : qty <= threshold ? 'low-stock' : 'in-stock';
