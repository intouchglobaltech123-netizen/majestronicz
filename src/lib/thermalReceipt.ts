import { Invoice, CompanyProfile } from '../types';

/**
 * Thermal (80mm) receipt printing for sale bills — the small department-store
 * style slip. Builds a narrow HTML receipt and prints it through a hidden iframe
 * so it can fire automatically on save without a pop-up window. The staff's
 * default printer (set the 80mm thermal printer as default in the OS/browser)
 * receives it; browsers remember "don't ask" once the dialog is confirmed.
 */

const LS_KEY = 'thermalAutoPrint';
/** Auto-print after saving a bill is ON unless the user turned it off. */
export const isThermalAutoPrintOn = (): boolean => {
  try { return localStorage.getItem(LS_KEY) !== 'off'; } catch { return true; }
};
export const setThermalAutoPrint = (on: boolean): void => {
  try { localStorage.setItem(LS_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
};

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
const money = (n: number): string => (Number(n) || 0).toFixed(2);

/** Build the 80mm receipt HTML for one sale bill. */
export const buildThermalReceiptHtml = (inv: Invoice, company: CompanyProfile): string => {
  const items = Array.isArray(inv.items) ? inv.items : [];
  const subtotal = Number(inv.subtotal) || items.reduce((s, li: any) => s + (Number(li.taxableAmount) || 0), 0);
  const tax = Number(inv.totalTax) || items.reduce((s, li: any) => s + (Number(li.totalTax) || 0), 0);
  const discount = items.reduce((s, li: any) => s + (Number(li.discountAmount) || 0), 0);
  const roundOff = Number(inv.roundOff) || 0;
  const grand = Number(inv.grandTotal) || 0;
  const balance = Math.max(0, Number(inv.balanceDue) || 0);
  const splits = Array.isArray(inv.paymentSplits) && inv.paymentSplits.length
    ? inv.paymentSplits.map((p) => `${esc(p.mode)} ${money(p.amount)}`).join(', ')
    : esc(inv.paymentMode || '');
  const qty = items.reduce((s, li: any) => s + (Number(li.quantity) || 0), 0);

  const rows = items.map((li: any) => {
    const name = esc(li.itemName || '');
    const q = Number(li.quantity) || 0;
    const rate = Number(li.unitPrice) || 0;
    const amt = Number(li.totalAmount) || q * rate;
    return `<tr><td class="nm" colspan="3">${name}</td></tr>
      <tr><td class="q">${q} ${esc(li.unit || '')} x ${money(rate)}</td><td class="g">${li.taxRate ? `${li.taxRate}%` : ''}</td><td class="a">${money(amt)}</td></tr>`;
  }).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>Bill ${esc(inv.invoiceNumber)}</title>
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { width: 80mm; font-family: 'Courier New', monospace; color: #000; }
    .r { padding: 3mm 3.5mm 5mm; }
    .c { text-align: center; }
    .b { font-weight: 700; }
    .hd { font-size: 15px; font-weight: 800; letter-spacing: 0.5px; }
    .sm { font-size: 10px; line-height: 1.35; }
    .xs { font-size: 9px; }
    hr { border: none; border-top: 1px dashed #000; margin: 2mm 0; }
    table { width: 100%; border-collapse: collapse; }
    td { font-size: 11px; vertical-align: top; padding: 0; }
    .nm { font-weight: 700; padding-top: 1mm; }
    .q { color: #000; }
    .g { text-align: center; width: 12mm; }
    .a { text-align: right; width: 20mm; white-space: nowrap; }
    .tot td { font-size: 12px; padding-top: 0.5mm; }
    .tl { text-align: right; }
    .grand td { font-size: 15px; font-weight: 800; padding-top: 1mm; }
    .foot { font-size: 10px; margin-top: 2mm; }
  </style></head>
  <body><div class="r">
    <div class="c hd">${esc(company.name || 'TAX INVOICE')}</div>
    <div class="c sm">${esc(company.address || '')}</div>
    <div class="c sm">${company.phone ? 'Ph: ' + esc(company.phone) : ''}${company.gstin ? ' · GSTIN: ' + esc(company.gstin) : ''}</div>
    <hr/>
    <div class="sm"><span class="b">Bill:</span> ${esc(inv.invoiceNumber)}</div>
    <div class="sm"><span class="b">Date:</span> ${esc(inv.date || '')} ${esc(inv.time || '')}</div>
    <div class="sm"><span class="b">Customer:</span> ${esc(inv.customerName || 'Walk-in')}${inv.customerPhone ? ' · ' + esc(inv.customerPhone) : ''}</div>
    <hr/>
    <table><tbody>${rows}</tbody></table>
    <hr/>
    <table class="tot"><tbody>
      <tr><td>Items / Qty</td><td class="tl">${items.length} / ${qty}</td></tr>
      <tr><td>Sub Total</td><td class="tl">${money(subtotal)}</td></tr>
      ${discount > 0 ? `<tr><td>Discount</td><td class="tl">-${money(discount)}</td></tr>` : ''}
      ${tax > 0 ? `<tr><td>GST</td><td class="tl">${money(tax)}</td></tr>` : ''}
      ${roundOff ? `<tr><td>Round Off</td><td class="tl">${money(roundOff)}</td></tr>` : ''}
    </tbody></table>
    <hr/>
    <table class="grand"><tbody><tr><td>TOTAL</td><td class="tl">Rs ${money(grand)}</td></tr></tbody></table>
    <table class="tot"><tbody>
      <tr><td>Paid (${splits || '-'})</td><td class="tl">${money(grand - balance)}</td></tr>
      ${balance > 0 ? `<tr><td class="b">Balance Due</td><td class="tl b">${money(balance)}</td></tr>` : ''}
    </tbody></table>
    <hr/>
    <div class="c foot">Thank you! Visit again.</div>
    ${company.ratingLink ? `<div class="c xs">Rate us: ${esc(company.ratingLink)}</div>` : ''}
    ${company.upiId ? `<div class="c xs">UPI: ${esc(company.upiId)}</div>` : ''}
  </div></body></html>`;
};

/** Print the bill on the thermal printer via a hidden iframe. */
export const printThermalReceipt = (inv: Invoice, company: CompanyProfile): void => {
  try {
    const html = buildThermalReceiptHtml(inv, company);
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (!doc) { iframe.remove(); return; }
    doc.open(); doc.write(html); doc.close();
    const fire = () => {
      try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } catch { /* ignore */ }
      setTimeout(() => iframe.remove(), 2000);
    };
    // Give the layout a moment to settle before printing.
    setTimeout(fire, 350);
  } catch {
    /* printing must never break the save flow */
  }
};
