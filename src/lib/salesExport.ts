import { Invoice, BRANCHES, computeInvoiceFinance, getInvoicePaymentSplits, isInvoiceFullyReturned } from '../types';

/**
 * One sales-export layout for the Sales list and the Sales report (SAL6-9 /
 * RPT-4): a status for every bill (not just voided ones), every payment mode of
 * a split, returns, net, received and due, and a totals row.
 */
export const SALES_EXPORT_HEADERS = [
  'Date', 'Invoice No', 'Customer', 'Phone', 'Branch', 'Place of Supply', 'Payment Modes', 'Taxable (₹)',
  'CGST (₹)', 'SGST (₹)', 'IGST (₹)', 'Bill Total (₹)', 'Returned (₹)', 'Net (₹)', 'Received (₹)', 'Due (₹)', 'Status',
];

const r2 = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);

export function saleStatus(inv: Invoice): string {
  if (inv.isVoided) return 'Voided';
  const fin = computeInvoiceFinance(inv);
  const returned = fin.returns > 0
    ? (isInvoiceFullyReturned(inv) || fin.net <= 0 ? 'Fully returned' : 'Partly returned')
    : '';
  const pay = fin.due > 0.009 ? (fin.received > 0.009 ? 'Part paid' : 'Unpaid (credit)') : 'Paid';
  return returned ? `${returned} · ${pay}` : pay;
}

export function paymentModesLabel(inv: Invoice): string {
  const splits = getInvoicePaymentSplits(inv).filter((s) => (Number(s.amount) || 0) > 0);
  if (!splits.length) return inv.paymentMode || '';
  return splits.map((s) => `${s.mode === 'COD-Credit' ? 'Credit' : s.mode} ${r2(s.amount)}`).join(' + ');
}

export function salesExportRows(invoices: Invoice[]): (string | number)[][] {
  const rows: (string | number)[][] = [];
  const t = { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0, ret: 0, net: 0, rec: 0, due: 0, live: 0 };
  for (const inv of invoices) {
    const fin = computeInvoiceFinance(inv);
    const igst = inv.withGst && (inv.totalCgst || 0) + (inv.totalSgst || 0) < (inv.totalTax || 0) - 0.009 ? (inv.totalTax || 0) - (inv.totalCgst || 0) - (inv.totalSgst || 0) : 0;
    rows.push([
      inv.date, inv.invoiceNumber, inv.customerName, inv.customerPhone || '',
      BRANCHES.find((b) => b.id === inv.branchId)?.shortCode || inv.branchId,
      inv.stateOfSupply || '', paymentModesLabel(inv), r2(inv.subtotal), r2(inv.totalCgst), r2(inv.totalSgst), r2(igst),
      r2(inv.grandTotal), r2(fin.returns), r2(fin.net), r2(fin.received), r2(fin.due), saleStatus(inv),
    ]);
    // Voided bills are listed for the record but not added to the totals.
    if (inv.isVoided) continue;
    t.live += 1;
    t.taxable += inv.subtotal || 0; t.cgst += inv.totalCgst || 0; t.sgst += inv.totalSgst || 0; t.igst += igst;
    t.total += inv.grandTotal || 0; t.ret += fin.returns; t.net += fin.net; t.rec += fin.received; t.due += fin.due;
  }
  rows.push([
    'TOTAL', `${t.live} live bill(s)`, '', '', '', '', '', r2(t.taxable), r2(t.cgst), r2(t.sgst), r2(t.igst),
    r2(t.total), r2(t.ret), r2(t.net), r2(t.rec), r2(t.due), 'Voided bills excluded',
  ]);
  return rows;
}
