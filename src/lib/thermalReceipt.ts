import { Invoice, CompanyProfile } from '../types';

/**
 * Thermal (80mm) receipt printing for sale bills — the small department-store
 * style slip. Builds a narrow HTML receipt and prints it through a hidden iframe
 * so it can fire automatically on save without a pop-up window. The staff's
 * default printer (set the 80mm thermal printer as default in the OS/browser)
 * receives it; browsers remember "don't ask" once the dialog is confirmed.
 */

const LS_KEY = 'thermalAutoPrint';
const LS_WIDTH = 'thermalWidthMm';
/** Auto-print after saving a bill is ON unless the user turned it off. */
export const isThermalAutoPrintOn = (): boolean => {
  try { return localStorage.getItem(LS_KEY) !== 'off'; } catch { return true; }
};
export const setThermalAutoPrint = (on: boolean): void => {
  try { localStorage.setItem(LS_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
};

export type ThermalWidth = 58 | 80;
/** Paper width in mm (per billing device). Default 80mm (department store). */
export const getThermalWidth = (): ThermalWidth => {
  try { return localStorage.getItem(LS_WIDTH) === '58' ? 58 : 80; } catch { return 80; }
};
export const setThermalWidth = (mm: ThermalWidth): void => {
  try { localStorage.setItem(LS_WIDTH, String(mm)); } catch { /* ignore */ }
};

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
const money = (n: number): string => (Number(n) || 0).toFixed(2);

/** Build the receipt HTML for one sale bill, sized to the chosen paper width. */
export const buildThermalReceiptHtml = (inv: Invoice, company: CompanyProfile, widthMm: ThermalWidth = getThermalWidth()): string => {
  // Narrow (58mm) paper gets smaller fonts and tighter columns than 80mm.
  const narrow = widthMm === 58;
  const pad = narrow ? '2mm 2.5mm 4mm' : '3mm 3.5mm 5mm';
  const fHd = narrow ? 13 : 15;
  const fItem = narrow ? 10 : 11;
  const fTot = narrow ? 11 : 12;
  const fGrand = narrow ? 13 : 15;
  const aW = narrow ? 16 : 20;
  const gW = narrow ? 9 : 12;
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
    @page { size: ${widthMm}mm auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { width: ${widthMm}mm; font-family: 'Courier New', monospace; color: #000; }
    .r { padding: ${pad}; }
    .c { text-align: center; }
    .b { font-weight: 700; }
    .hd { font-size: ${fHd}px; font-weight: 800; letter-spacing: 0.5px; }
    .sm { font-size: ${narrow ? 9 : 10}px; line-height: 1.35; }
    .xs { font-size: ${narrow ? 8 : 9}px; }
    hr { border: none; border-top: 1px dashed #000; margin: 2mm 0; }
    table { width: 100%; border-collapse: collapse; }
    td { font-size: ${fItem}px; vertical-align: top; padding: 0; }
    .nm { font-weight: 700; padding-top: 1mm; }
    .q { color: #000; }
    .g { text-align: center; width: ${gW}mm; }
    .a { text-align: right; width: ${aW}mm; white-space: nowrap; }
    .tot td { font-size: ${fTot}px; padding-top: 0.5mm; }
    .tl { text-align: right; }
    .grand td { font-size: ${fGrand}px; font-weight: 800; padding-top: 1mm; }
    .foot { font-size: ${narrow ? 9 : 10}px; margin-top: 2mm; }
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
export const printThermalReceipt = (inv: Invoice, company: CompanyProfile, widthMm: ThermalWidth = getThermalWidth()): void => {
  try {
    const html = buildThermalReceiptHtml(inv, company, widthMm);
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
