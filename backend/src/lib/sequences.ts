/**
 * Server-side, transaction-scoped sequence-number generators. Run inside the
 * same $transaction as the insert; combined with UNIQUE constraints + retry,
 * this makes document numbers collision-free under concurrency.
 */

// Indian financial year (Apr 1 – Mar 31). Accepts a Date or a YYYY-MM-DD string
// so invoice numbers roll over based on the document's own date.
export function financialYear(input: Date | string = new Date()): string {
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

export async function nextInvoiceNumber(tx: any, branchId: string, date?: string): Promise<string> {
  const prefix = `MZ${invBranchCode(branchId)}${financialYear(date)}/`;
  const rows = await tx.invoice.findMany({
    where: { invoiceNumber: { startsWith: prefix } },
    select: { invoiceNumber: true },
  });
  const next = rows.length ? maxSeq(rows.map((r: any) => r.invoiceNumber), prefix, 7306) + 1 : 7307;
  return `${prefix}${next}`;
}

export async function nextEstimateNumber(tx: any, branchId: string, date?: string): Promise<string> {
  const prefix = `MZ${invBranchCode(branchId)}${financialYear(date)}EST/`;
  const rows = await tx.estimate.findMany({
    where: { estimateNumber: { startsWith: prefix } },
    select: { estimateNumber: true },
  });
  const next = maxSeq(rows.map((r: any) => r.estimateNumber), prefix) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

export async function nextChallanNumber(tx: any): Promise<string> {
  const prefix = 'DC-';
  const rows = await tx.deliveryChallan.findMany({
    where: { challanNumber: { startsWith: prefix } },
    select: { challanNumber: true },
  });
  const next = maxSeq(rows.map((r: any) => r.challanNumber), prefix) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

export async function nextComboCode(tx: any): Promise<string> {
  const rows = await tx.comboItem.findMany({ select: { comboCode: true } });
  let max = 0;
  for (const r of rows) {
    const m = r.comboCode.match(/^CB-(\d{4})$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `CB-${String(max + 1).padStart(4, '0')}`;
}

export async function nextPoNumber(tx: any, branchId: string): Promise<string> {
  const prefix = `PO-${poBranchCode(branchId)}-2026-`;
  const rows = await tx.purchaseOrder.findMany({
    where: { poNumber: { startsWith: prefix } },
    select: { poNumber: true },
  });
  const next = maxSeq(rows.map((r: any) => r.poNumber), prefix) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

export async function nextEnquiryNumber(tx: any, branchId: string): Promise<string> {
  const prefix = `ENQ-${poBranchCode(branchId)}-`;
  const rows = await tx.enquiry.findMany({
    where: { enquiryNumber: { startsWith: prefix } },
    select: { enquiryNumber: true },
  });
  const next = maxSeq(rows.map((r: any) => r.enquiryNumber), prefix) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

export async function nextPendingOrderNumber(tx: any): Promise<string> {
  const prefix = 'PO-WAIT-';
  const rows = await tx.pendingOrder.findMany({
    where: { orderNumber: { startsWith: prefix } },
    select: { orderNumber: true },
  });
  const next = maxSeq(rows.map((r: any) => r.orderNumber), prefix) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}
