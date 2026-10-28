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

const LS_HIDE_PAY = 'hidePaymentOnBill';
/** Hide the payment-details box (modes / cash tendered / balance / bank & UPI)
 *  on the printed bill — both thermal and A4. Default OFF (payment shown). */
export const isHidePaymentOnBillOn = (): boolean => {
  try { return localStorage.getItem(LS_HIDE_PAY) === 'on'; } catch { return false; }
};
export const setHidePaymentOnBill = (on: boolean): void => {
  try { localStorage.setItem(LS_HIDE_PAY, on ? 'on' : 'off'); } catch { /* ignore */ }
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

/** Build the receipt HTML for one sale bill, sized to the chosen paper width.
 *  `logoDataUrl`, when given, prints the Majestronicz logo at the very top in
 *  place of the shop-name text (the rest of the format is unchanged). */
export const buildThermalReceiptHtml = (inv: Invoice, company: CompanyProfile, widthMm: ThermalWidth = getThermalWidth(), logoDataUrl?: string): string => {
  // Narrow (58mm) paper gets smaller fonts and tighter columns than 80mm.
  const narrow = widthMm === 58;
  // Tighter padding than before — the client wanted a shorter slip to save
  // thermal roll (Oct 2026). Still readable, not cramped.
  const pad = narrow ? '1.5mm 2.5mm 3mm' : '2mm 3mm 3.5mm';
  // Fonts a notch smaller than the old "big" slip (client: not too big, not
  // too small) — strokes stay bold so the thermal head still burns them solid.
  const fHd = narrow ? 13 : 15;
  const fItem = narrow ? 11 : 12;
  const fTot = narrow ? 11 : 13;
  const fGrand = narrow ? 14 : 16;
  const aW = narrow ? 16 : 20;
  const gW = narrow ? 9 : 12;
  const items = Array.isArray(inv.items) ? inv.items : [];
  const subtotal = items.reduce((s, li: any) => s + (Number(li.taxableAmount) || 0) + (Number(li.discountAmount) || 0), 0)
    || (Number(inv.subtotal) || 0);
  const discount = items.reduce((s, li: any) => s + (Number(li.discountAmount) || 0), 0);
  const roundOff = Number(inv.roundOff) || 0;
  const shipping = Number(inv.shippingCharges) || 0;
  const grand = Number(inv.grandTotal) || 0;
  const balance = Math.max(0, Number(inv.balanceDue) || 0);
  const hidePayment = isHidePaymentOnBillOn();

  // Item rows: Item | Qty | Amt (line total), like the reference bill.
  const rows = items.map((li: any) => {
    const name = esc(li.itemName || '');
    const q = Number(li.quantity) || 0;
    // Pre-tax line base (qty × rate), so the Amt column sums to Sub Total.
    const amt = q * (Number(li.unitPrice) || 0);
    return `<tr><td class="nm">${name}</td><td class="g">${q}</td><td class="a">${money(amt)}</td></tr>`;
  }).join('');

  // GST grouped by rate → CGST @ half% / SGST @ half% lines (e.g. 18% → 9% + 9%).
  const taxGroups = new Map<number, { cgst: number; sgst: number }>();
  for (const li of items as any[]) {
    const r = Number(li.taxRate) || 0;
    if (r <= 0) continue;
    const g = taxGroups.get(r) || { cgst: 0, sgst: 0 };
    g.cgst += Number(li.cgstAmount) || 0;
    g.sgst += Number(li.sgstAmount) || 0;
    taxGroups.set(r, g);
  }
  const taxRows = [...taxGroups.entries()]
    .sort((a, b) => b[0] - a[0])
    .flatMap(([rate, g]) => {
      const half = (rate / 2).toFixed(2);
      const out: string[] = [];
      if (g.cgst > 0) out.push(`<tr class="tax"><td>CGST @ ${half}%</td><td class="tl">${money(g.cgst)}</td></tr>`);
      if (g.sgst > 0) out.push(`<tr class="tax"><td>SGST @ ${half}%</td><td class="tl">${money(g.sgst)}</td></tr>`);
      return out;
    }).join('');

  // Payment lines: one per mode (e.g. "Cash : Rs 811.00"), then amount tendered.
  const paySplits = Array.isArray(inv.paymentSplits) && inv.paymentSplits.length
    ? inv.paymentSplits
    : [{ mode: inv.paymentMode || 'Cash', amount: grand - balance } as any];
  const payRows = paySplits
    .filter((p: any) => (Number(p.amount) || 0) > 0)
    .map((p: any) => `<tr class="grand"><td>${esc(p.mode)} :</td><td class="tl">Rs ${money(p.amount)}</td></tr>`)
    .join('');
  const tendered = Number((inv as any).cashTendered) || (grand - balance);

  return `<!doctype html><html><head><meta charset="utf-8"><title>Bill ${esc(inv.invoiceNumber)}</title>
  <style>
    @page { size: ${widthMm}mm auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    /* Maximum darkness on a thermal head: bold weight PLUS a text-stroke that
       thickens every glyph outline (extra ink spread), so thin Courier strokes
       no longer anti-alias to grey and fade — every line burns solid black.
       The printer's own Density/Darkness setting is still the main lever if it
       is set low. */
    body { width: ${widthMm}mm; font-family: 'Courier New', monospace; color: #000; font-weight: 700; -webkit-font-smoothing: none; -webkit-text-stroke: 0.38px #000; }
    .r { padding: ${pad}; }
    .c { text-align: center; }
    .b { font-weight: 700; }
    .hd { font-size: ${fHd}px; font-weight: 800; letter-spacing: 0.5px; }
    .ttl { font-size: ${fItem + 1}px; font-weight: 800; }
    .sm { font-size: ${narrow ? 10 : 12}px; line-height: 1.45; }
    .xs { font-size: ${narrow ? 9 : 11}px; }
    hr { border: none; border-top: 1px dashed #000; margin: 1.2mm 0; }
    table { width: 100%; border-collapse: collapse; }
    td { font-size: ${fItem}px; vertical-align: top; padding: 0; }
    thead td { font-weight: 700; border-bottom: 1px solid #000; padding-bottom: 1mm; }
    tbody tr td { padding-top: 1mm; }
    .nm { font-weight: 700; }
    .g { text-align: center; width: ${gW}mm; }
    .a { text-align: right; width: ${aW}mm; white-space: nowrap; }
    .tot td { font-size: ${fTot}px; padding-top: 0.6mm; }
    .tl { text-align: right; }
    .tax td { font-size: ${narrow ? 8 : 9}px; color: #000; }
    tr.grand td { font-size: ${fGrand}px; font-weight: 800; padding-top: 1mm; }
    .foot { font-size: ${narrow ? 8 : 9}px; margin-top: 2mm; }
  </style></head>
  <body><div class="r">
    ${logoDataUrl
      ? `<div class="c" style="margin-bottom:1mm"><img src="${logoDataUrl}" alt="MAJESTRONICZ" style="width:${narrow ? 26 : 34}mm;max-width:100%;height:auto;object-fit:contain;filter:grayscale(1) brightness(0.9) contrast(2.8);"/></div>`
      : `<div class="c hd">${esc(company.name || 'MAJESTRONICZ')}</div>`}
    <!-- Header kept minimal per client: logo, "Erode", shop phone only.
         Address & GSTIN removed from the thermal slip (Oct 2026). -->
    <div class="c sm b" style="margin-top:0.5mm">Erode</div>
    ${company.phone ? `<div class="c sm">${esc(company.phone)}</div>` : ''}
    <div class="c ttl" style="margin-top:1.5mm">Retail Invoice</div>
    <hr/>
    <div class="sm"><span class="b">Date :</span> ${esc(inv.date || '')}${inv.time ? ', ' + esc(inv.time) : ''}</div>
    ${(inv.customerName || inv.customerPhone)
      ? `<div class="sm b" style="margin-top:1mm">${esc(inv.customerName || 'Walk-in')}${inv.customerPhone ? ' - ' + esc(inv.customerPhone) : ''}</div>`
      : ''}
    <div class="sm" style="margin-top:1mm"><span class="b">Bill No:</span> ${esc(inv.invoiceNumber)}</div>
    ${hidePayment ? '' : `<div class="sm"><span class="b">Payment Mode:</span> ${esc(inv.paymentMode || 'Cash')}</div>`}
    <hr/>
    <table>
      <thead><tr><td>Item</td><td class="g">Qty</td><td class="a">Amt</td></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <hr/>
    <table class="tot"><tbody>
      <tr><td>Sub Total</td><td class="tl">${money(subtotal)}</td></tr>
      ${discount > 0 ? `<tr><td>(-) Discount</td><td class="tl">${money(discount)}</td></tr>` : ''}
      ${taxRows}
      ${shipping > 0 ? `<tr><td>Shipping Charges</td><td class="tl">${money(shipping)}</td></tr>` : ''}
      ${roundOff ? `<tr><td>Round Off</td><td class="tl">${money(roundOff)}</td></tr>` : ''}
    </tbody></table>
    <hr/>
    <table><tbody>
      <tr class="grand"><td>TOTAL</td><td class="tl">Rs ${money(grand)}</td></tr>
    </tbody></table>
    <hr/>
    ${hidePayment ? '' : `<table class="tot"><tbody>
      ${payRows}
      <tr><td>Cash tendered:</td><td class="tl">Rs ${money(tendered)}</td></tr>
      ${balance > 0 ? `<tr><td class="b">Balance Due:</td><td class="tl b">Rs ${money(balance)}</td></tr>` : ''}
    </tbody></table>
    <hr/>`}
    <div class="c xs b">E & O E</div>
    <div class="c foot">Thank you! Visit again.</div>
    ${!hidePayment && company.upiId ? `<div class="c xs">UPI: ${esc(company.upiId)}</div>` : ''}
  </div></body></html>`;
};

// The Majestronicz logo, loaded once and cached as a data URL so it is embedded
// directly in the receipt HTML — guaranteeing it is present when the printer
// fires (a plain <img src="/assets/…"> can race the print dialog and come out
// blank). Returns '' if it can't be loaded, so the receipt falls back to text.
const LOGO_URL = '/assets/majestronicz-logo.png';
let logoCache: string | null = null;
const loadLogoDataUrl = async (): Promise<string> => {
  if (logoCache !== null) return logoCache;
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const res = await fetch(origin + LOGO_URL);
    if (!res.ok) throw new Error('logo fetch failed');
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
    logoCache = dataUrl;
  } catch {
    logoCache = ''; // don't retry every print; fall back to text name
  }
  return logoCache;
};

/** Wait until every image in the iframe has finished loading (or a 1.5s cap). */
const waitForImages = (win: Window | null): Promise<void> =>
  new Promise((resolve) => {
    const imgs = win ? Array.from(win.document.images) : [];
    const pending = imgs.filter((i) => !i.complete);
    if (!pending.length) { resolve(); return; }
    let left = pending.length;
    const done = () => { if (--left <= 0) resolve(); };
    pending.forEach((i) => { i.addEventListener('load', done); i.addEventListener('error', done); });
    setTimeout(resolve, 1500); // never hang the print if an image stalls
  });

/** Print the bill on the thermal printer via a hidden iframe. */
export const printThermalReceipt = async (inv: Invoice, company: CompanyProfile, widthMm: ThermalWidth = getThermalWidth()): Promise<void> => {
  try {
    const logo = await loadLogoDataUrl();
    const html = buildThermalReceiptHtml(inv, company, widthMm, logo || undefined);
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (!doc) { iframe.remove(); return; }
    doc.open(); doc.write(html); doc.close();
    // Wait for the logo image to decode, then print, so it never comes out blank.
    await waitForImages(iframe.contentWindow);
    try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } catch { /* ignore */ }
    setTimeout(() => iframe.remove(), 2000);
  } catch {
    /* printing must never break the save flow */
  }
};
