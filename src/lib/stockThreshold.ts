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
