/**
 * Server-side, transaction-scoped sequence-number generators. Run inside the
 * same $transaction as the insert; combined with UNIQUE constraints + retry,
 * this makes document numbers collision-free under concurrency.
 */

import { istToday } from './businessDate.js';

// Indian financial year (Apr 1 – Mar 31). Accepts a Date or a YYYY-MM-DD string
// so invoice numbers roll over based on the document's own date.
// No date: today's IST day, so 00:00–05:30 IST on 1 April is already the new year (UTC-1).
export function financialYear(input: Date | string = istToday()): string {
  let d: Date;
  if (typeof input === 'string') {
    const p = input.split('T')[0].split('-').map(Number);
    d = p.length >= 3 && p.every((n) => !isNaN(n)) ? new Date(p[0], p[1] - 1, p[2]) : new Date(input);
  } else {
    d = input instanceof Date && !isNaN(input.getTime()) ? input : new Date();
  }
  const m = d.getMonth(); // 0=Jan, 3=Apr
  const y = d.getFullYear();
  const start = m >= 3 ? y : y - 1;
  return `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
}

// Invoice/Estimate use CHN for Chennai; PO/Enquiry use CHE (matches original code).
const invBranchCode = (b: string) => (b === 'coimbatore' ? 'CBE' : b === 'chennai' ? 'CHN' : 'ERD');
const poBranchCode = (b: string) => (b === 'coimbatore' ? 'CBE' : b === 'chennai' ? 'CHE' : 'ERD');

const maxSeq = (numbers: string[], prefix: string, floor = 0) => {
  let max = floor;
  for (const n of numbers) {
    const v = parseInt(n.slice(prefix.length), 10);
    if (!isNaN(v) && v > max) max = v;
  }
  return max;
};

/**
 * A persistent high-water mark so a number is NEVER reissued after the row that
 * held it is deleted (SAL4-9). Takes the greater of the max among existing rows
 * and the stored counter, bumps it, and persists the new value. Scoped per prefix
 * in appConfig so each branch/FY sequence advances on its own.
 */
export async function nextPersistent(tx: any, key: string, fromRowsMax: number): Promise<number> {
  // SAL10-1: the counter row is created if missing and then LOCKED, so two
  // documents saved at once queue on this one row (briefly, at the end of the
  // save) instead of both reading the same value and one failing and retrying.
  await tx.$executeRaw`INSERT INTO "AppConfig" ("key", "value") VALUES (${key}, '{"n":0}'::jsonb) ON CONFLICT ("key") DO NOTHING`;
  const rows: any[] = await tx.$queryRaw`SELECT "value" FROM "AppConfig" WHERE "key" = ${key} FOR UPDATE`;
  const value = rows[0]?.value as any;
  const stored = value && typeof value.n === 'number' ? value.n : 0;
  const next = Math.max(fromRowsMax, stored) + 1;
  await tx.appConfig.update({ where: { key }, data: { value: { n: next } as any } });
  return next;
}

/**
 * SAL2-15: the shop's bill series continued from its old software at /7307 in
 * the year it went live (FY 26-27). Only THAT year starts there; every other
 * financial year starts its own series at 0001. The go-live year and start can
 * be configured (AppConfig 'invoiceSeriesStart' = { fy: '26-27', start: 7307 }).
 */
const DEFAULT_SERIES_START = { fy: '26-27', start: 7307 };

export async function nextInvoiceNumber(tx: any, branchId: string, date?: string): Promise<string> {
  const fy = financialYear(date);
  const prefix = `MZ${invBranchCode(branchId)}${fy}/`;
  const rows = await tx.invoice.findMany({
    where: { invoiceNumber: { startsWith: prefix } },
    select: { invoiceNumber: true },
  });
  const cfg = (await tx.appConfig.findUnique({ where: { key: 'invoiceSeriesStart' } }))?.value as any;
  const series = cfg && typeof cfg.fy === 'string' && Number(cfg.start) > 0 ? { fy: cfg.fy, start: Number(cfg.start) } : DEFAULT_SERIES_START;
  const floor = fy === series.fy ? series.start - 1 : 0;
  const fromRows = maxSeq(rows.map((r: any) => r.invoiceNumber), prefix, floor);
  const next = await nextPersistent(tx, `seq:inv:${prefix}`, fromRows);
  return `${prefix}${String(next).padStart(4, '0')}`;
}

export async function nextEstimateNumber(tx: any, branchId: string, date?: string): Promise<string> {
  const prefix = `MZ${invBranchCode(branchId)}${financialYear(date)}EST/`;
  const rows = await tx.estimate.findMany({
    where: { estimateNumber: { startsWith: prefix } },
    select: { estimateNumber: true },
  });
  const fromRows = maxSeq(rows.map((r: any) => r.estimateNumber), prefix);
  const next = await nextPersistent(tx, `seq:est:${prefix}`, fromRows);
  return `${prefix}${String(next).padStart(3, '0')}`;
}

export async function nextChallanNumber(tx: any): Promise<string> {
  const prefix = 'DC-';
  const rows = await tx.deliveryChallan.findMany({
    where: { challanNumber: { startsWith: prefix } },
    select: { challanNumber: true },
  });
  const fromRows = maxSeq(rows.map((r: any) => r.challanNumber), prefix);
  const next = await nextPersistent(tx, `seq:dc:${prefix}`, fromRows);
  return `${prefix}${String(next).padStart(3, '0')}`;
}

export async function nextComboCode(tx: any): Promise<string> {
  const rows = await tx.comboItem.findMany({ select: { comboCode: true } });
  let max = 0;
  for (const r of rows) {
    const m = r.comboCode.match(/^CB-(\d{4})$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const next = await nextPersistent(tx, 'seq:combo:CB-', max);
  return `CB-${String(next).padStart(4, '0')}`;
}

/** PLT9-1: the PO series is per financial year, named by the year it starts
 *  (PO-ERD-2026-… for FY 26-27, PO-ERD-2027-… for FY 27-28); it was "-2026-"
 *  for ever. */
export async function nextPoNumber(tx: any, branchId: string, date?: string): Promise<string> {
  const prefix = `PO-${poBranchCode(branchId)}-20${financialYear(date).slice(0, 2)}-`;
  const rows = await tx.purchaseOrder.findMany({
    where: { poNumber: { startsWith: prefix } },
    select: { poNumber: true },
  });
  const fromRows = maxSeq(rows.map((r: any) => r.poNumber), prefix);
  const next = await nextPersistent(tx, `seq:po:${prefix}`, fromRows);
  return `${prefix}${String(next).padStart(3, '0')}`;
}

export async function nextEnquiryNumber(tx: any, branchId: string): Promise<string> {
  const prefix = `ENQ-${poBranchCode(branchId)}-`;
  const rows = await tx.enquiry.findMany({
    where: { enquiryNumber: { startsWith: prefix } },
    select: { enquiryNumber: true },
  });
  const fromRows = maxSeq(rows.map((r: any) => r.enquiryNumber), prefix);
  const next = await nextPersistent(tx, `seq:enq:${prefix}`, fromRows);
  return `${prefix}${String(next).padStart(3, '0')}`;
}

export async function nextPendingOrderNumber(tx: any): Promise<string> {
  const prefix = 'PO-WAIT-';
  const rows = await tx.pendingOrder.findMany({
    where: { orderNumber: { startsWith: prefix } },
    select: { orderNumber: true },
  });
  const fromRows = maxSeq(rows.map((r: any) => r.orderNumber), prefix);
  const next = await nextPersistent(tx, `seq:pwait:${prefix}`, fromRows);
  return `${prefix}${String(next).padStart(3, '0')}`;
}
