// Browser checks for the round-9 screen fixes (INV6-7, CASH-13, CRM9-2, PUR9-1,
// SAL9-3, SAL4-10, INV9-8). Drives the real screens; data is prepared through
// the API.
//
//   QA_FRONTEND_URL=http://127.0.0.1:5199 QA_API_URL=http://127.0.0.1:4100 node qa/smoke/round9-ui.mjs
//
// Needs the frontend + backend running (as for smoke.mjs) and the seeded data.
// The challan print check writes a PDF and reads its text with Python's
// pymupdf when it is installed (skipped otherwise).
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const PW = process.env.QA_PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const FE = (process.env.QA_FRONTEND_URL || 'http://127.0.0.1:5199').replace(/\/$/, '');
const API = (process.env.QA_API_URL || 'http://127.0.0.1:4100').replace(/\/$/, '');
const PINS = { CEO: '1111', Manager: '2222', Billing: '3333', Purchase: '5555' };
const ONLY = process.env.QA_ONLY ? new Set(process.env.QA_ONLY.split(',')) : null;
const want = (id) => !ONLY || ONLY.has(id);

const tokens = {};
async function api(method, p, body, role = 'CEO') {
  if (!tokens[role]) {
    const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: PINS[role] }) });
    tokens[role] = (await r.json()).token;
  }
  const res = await fetch(`${API}${p}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[role]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const must = async (method, p, body, role) => {
  const r = await api(method, p, body, role);
  if (r.status !== 200) throw new Error(`${method} ${p}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body;
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const phone = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch();
async function login(role, { clock } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Kolkata' });
  await ctx.addInitScript(() => {
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      return String(key).startsWith('majestronicz_sidebar_expanded')
        ? JSON.stringify({ sales: true, items: true, reports: true, purchases: true, 'cash-bank': true, parties: true }) : get.call(this, key);
    };
  });
  const page = await ctx.newPage();
  if (clock) await page.clock.install({ time: clock });
  page.on('pageerror', (e) => console.log(`  [${role}] page error: ${e.message}`));
  await page.goto(FE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.keyboard.type(PINS[role], { delay: 80 });
  await page.locator('aside').first().waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(1500);
  return { ctx, page };
}
const nav = async (page, label) => {
  const expand = page.getByRole('button', { name: 'Expand navigation menu' });
  if (await expand.isVisible().catch(() => false)) { await expand.click().catch(() => {}); await page.waitForTimeout(300); }
  await page.locator('aside button', { hasText: label }).first().click();
  await page.waitForTimeout(1200);
};

async function createItem(price = 1000, stock = { 'erode-hq': 20 }, extra = {}) {
  const code = `QA-${uid()}`.toUpperCase();
  const body = await must('POST', '/api/catalog/item', {
    item: { itemName: `QA r9 ${code}`, itemHSN: '85371000', category: 'QA', itemCode: code, unit: 'PCS', salePrice: price, salePriceTaxMode: 'exclusive', wholesalePrice: price, minWholesaleQty: 10, purchasePrice: 600, gstTaxSlab: 18, ...extra },
    initialStocks: stock,
  });
  return body.item;
}

try {
  // ---------- INV6-7: a long delivery challan prints every row once ----------
  if (want('INV6-7')) {
    const items = Array.from({ length: 46 }, (_, i) => ({ id: `l${i + 1}`, itemName: `QA print row ${String(i + 1).padStart(2, '0')}`, quantity: 1, unit: 'NOS' }));
    const saved = (await must('POST', '/api/catalog/challan', { recipientName: `QA Print ${uid()}`, location: 'Erode', contactNo: '9876543210', date: istToday(), time: '10:00', items, totalQuantity: 46, termsAndConditions: 'QA' })).savedChallan;
    const { ctx, page } = await login('CEO');
    await nav(page, 'Delivery Challans');
    await page.getByRole('button', { name: /Challan History/i }).first().click().catch(() => {});
    await page.waitForTimeout(800);
    await page.getByPlaceholder(/search/i).first().fill(saved.challanNumber).catch(() => {});
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(os.tmpdir(), 'r9-challan-list.png') });
    const row = page.locator('tr:visible', { hasText: saved.challanNumber }).first();
    await row.locator('button[title="Preview & Print PDF"]').click();
    await page.waitForTimeout(800);
    check('INV9-8 the challan preview opens in a portal overlay', (await page.locator('body > #invoice-print-overlay').count()) === 1);
    await page.evaluate(() => document.body.classList.add('invoice-printing'));
    await page.emulateMedia({ media: 'print' });
    const pdfPath = path.join(os.tmpdir(), `challan-${uid()}.pdf`);
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => document.body.classList.remove('invoice-printing'));
    let text = null;
    try {
      text = execFileSync('python3', ['-c', 'import sys,pymupdf;d=pymupdf.open(sys.argv[1]);print(len(d));print("\\f".join(p.get_text() for p in d))', pdfPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { /* pymupdf missing */ }
    if (text) {
      const pages = Number(text.split('\n')[0]);
      const rowsSeen = Array.from({ length: 46 }, (_, i) => (text.match(new RegExp(`QA print row ${String(i + 1).padStart(2, '0')}\\b`, 'g')) || []).length);
      check('INV6-7 every challan row printed exactly once', rowsSeen.every((n) => n === 1), `counts ${rowsSeen.join('')}`);
      check('INV6-7 header, total and signatures are printed', /DELIVERY CHALLAN/i.test(text) && /Total Quantity Dispatched/i.test(text) && /Authorized Signatory/i.test(text) && /Recipient Signature/i.test(text));
      check('INV6-7 no duplicate pages (2-3 pages for 46 rows)', pages >= 2 && pages <= 3, `${pages} pages`);
      check('INV6-7 the app behind the preview is not printed', !/Delivery Challan Preview/.test(text) && !/New Challan/.test(text));
    } else {
      console.log('SKIP INV6-7 PDF text check (python3 pymupdf not installed)');
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    check('INV9-8 Esc closes the challan preview', (await page.locator('#invoice-print-overlay').count()) === 0);
    await ctx.close();
  }

  // ---------- CASH-13: the drawer follows the date across midnight ----------
  if (want('CASH-13')) {
    // 23:58 IST on some day: the drawer shows that day; two minutes later it shows the next.
    const day = istToday();
    const start = new Date(`${day}T23:58:00+05:30`);
    const { ctx, page } = await login('CEO', { clock: start });
    await nav(page, 'Daily Cash Register');
    const dateInput = page.locator('input[type="date"]:visible').first();
    const before = await dateInput.inputValue();
    await page.clock.fastForward('03:00');
    await page.waitForTimeout(1500);
    const after = await dateInput.inputValue();
    const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    check('CASH-13 the drawer moves to the new day after midnight', before === day && after === next, `${before} → ${after}`);
    await ctx.close();
  }

  // ---------- CRM9-2: a Store Credit receipt must be fully applied ----------
  if (want('CRM9-2')) {
    const item = await createItem();
    const custPhone = phone();
    const inv = (await must('POST', '/api/tx/sale', {
      id: `inv-qa-${uid()}`, invoiceNumber: 'DRAFT', branchId: 'erode-hq', transactionType: 'Credit', customerName: `QA SC ${uid()}`, customerPhone: custPhone,
      customerAddress: '', date: istToday(), time: '11:00', paymentTerms: 'Due on Receipt', dueDate: istToday(), stateOfSupply: '33-Tamil Nadu', withGst: true,
      items: [{ id: `li-${uid()}`, itemId: item.id, itemName: item.itemName, itemCode: item.itemCode, itemHSN: '85371000', unit: 'PCS', quantity: 1, unitPrice: 1000, taxRate: 18, discountType: '%', discountValue: 0 }],
      overallDiscountType: '%', overallDiscountValue: 0, shippingCharges: 0, roundOffEnabled: false, termsAndConditions: 'QA', paymentMode: 'COD-Credit', paymentSplits: [{ mode: 'COD-Credit', amount: 1180 }],
      createdAt: new Date().toISOString(),
    })).savedInvoice;
    await must('POST', `/api/catalog/customer/${inv.customerId}/credit`, { amount: 5000, reason: 'QA' });
    const { ctx, page } = await login('CEO');
    await nav(page, 'Customers');
    await page.getByPlaceholder('Search customers by name, phone, or address...').fill(custPhone);
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: inv.customerName }).first().click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: /Receive Payment/i }).first().click();
    await page.waitForTimeout(600);
    await page.locator('#rp-amount').fill('2000');
    await page.getByText('Cash', { exact: true }).last().click().catch(() => {});
    await page.getByRole('option', { name: 'Store Credit' }).or(page.getByText('Store Credit', { exact: true }).last()).first().click().catch(() => {});
    await page.waitForTimeout(400);
    const save = page.getByRole('button', { name: /Save|Record|Receive/i }).last();
    const disabledOver = await save.isDisabled();
    const msg = await page.getByText(/Store credit can only be applied to bills/).count();
    await page.locator('#rp-amount').fill('1180');
    await page.waitForTimeout(300);
    const enabledExact = !(await save.isDisabled());
    check('CRM9-2 Save is disabled while store credit is left unapplied', disabledOver && msg > 0, `disabled=${disabledOver} msg=${msg}`);
    check('CRM9-2 Save is enabled when the store credit is fully applied', enabledExact);
    check('CRM9-11 the customer detail shows the store-credit ledger', (await page.locator('[data-testid="store-credit-ledger"]').count()) > 0);
    await ctx.close();
  }

  // ---------- SAL4-10: the sales ledger pages long lists ----------
  if (want('SAL4-10')) {
    const { ctx, page } = await login('CEO');
    const t0 = Date.now();
    await page.locator('aside button', { hasText: 'Sale Invoices' }).first().click();
    await page.getByText(/Showing \d+ sales/).first().waitFor({ timeout: 60000 });
    await page.locator('table tbody tr').first().waitFor({ timeout: 60000 });
    const ms = Date.now() - t0;
    const rows = await page.locator('table tbody tr').count();
    const total = Number((await page.getByText(/Showing \d+ sales/).first().textContent()).match(/\d+/)[0]);
    check('SAL4-10 the ledger renders at most one page of rows', rows <= 100, `${rows} rows of ${total}, opened in ${ms} ms`);
    if (total > 100) check('SAL4-10 a pager is shown for long lists', (await page.getByRole('navigation', { name: 'Sales ledger pages' }).count()) === 1);
    check('SAL4-10 the subtitle no longer says "Today\'s tax invoices"', (await page.getByText("Today's tax invoices").count()) === 0);
    if (total > 1000) check('SAL4-10 the ledger opens in under 2 s with thousands of bills', ms < 2000, `${ms} ms for ${total} bills`);
    const s0 = Date.now();
    await page.getByLabel('Search sales').pressSequentially('zzqa-no-match', { delay: 20 });
    await page.getByText('No sales records found').waitFor({ timeout: 60000 });
    const searchMs = Date.now() - s0;
    check('SAL4-10 searching is quick (typing + result)', searchMs < 3000, `${searchMs} ms`);
    await ctx.close();
  }

  // ---------- PUR9-1: Receive defaults GST to the PO line's rate ----------
  if (want('PUR9-1')) {
    const item = await createItem(1000, {}, { gstTaxSlab: 18 });
    const vendors = await must('GET', '/api/vendors');
    const v = vendors[0];
    const po = (await must('POST', '/api/purchase/save', { po: {
      vendorId: v.id, vendorName: v.vendorName, branchId: 'erode-hq', date: istToday(), expectedDeliveryDate: istToday(),
      items: [{ itemId: item.id, itemName: item.itemName, itemCode: item.itemCode, quantityOrdered: 2, receivedQuantity: 0, purchasePrice: 500, taxPercent: 5 }],
      totalAmount: 0, notes: 'QA r9',
    }, actor: 'QA' })).saved;
    const { ctx, page } = await login('CEO');
    await nav(page, 'Purchases');
    const row = page.locator('tr:visible', { hasText: po.poNumber }).first();
    await row.locator('button[title="Inward physical stock"]').click();
    await page.waitForTimeout(800);
    const gst = await page.locator('input[title="GST % as billed by the supplier"]').first().inputValue();
    check('PUR9-1 Receive Stock defaults GST to the PO line rate (5%), not the catalogue 18%', gst === '5', `GST shown ${gst}`);
    await ctx.close();
  }

  // ---------- SAL9-3: place of supply follows the customer ----------
  if (want('SAL9-3')) {
    const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const gstinFor = (state) => {
      const pan = Array.from({ length: 5 }, () => 'ABCDEFGHJK'[Math.floor(Math.random() * 10)]).join('') + String(1000 + Math.floor(Math.random() * 8999)) + 'F';
      const base = `${state}${pan}1Z`;
      let sum = 0;
      for (let i = 0; i < 14; i++) { const v = CH.indexOf(base[i]) * (i % 2 ? 2 : 1); sum += Math.floor(v / 36) + (v % 36); }
      return base + CH[(36 - (sum % 36)) % 36];
    };
    const kPhone = phone();
    const tPhone = phone();
    await must('POST', '/api/catalog/customer', { name: `QA Kerala ${uid()}`, phone: kPhone, address: 'Kochi', gstin: gstinFor('32') });
    await must('POST', '/api/catalog/customer', { name: `QA Local ${uid()}`, phone: tPhone, address: 'Erode' });
    const { ctx, page } = await login('CEO');
    await nav(page, 'New Sale');
    const pos = page.getByTestId('place-of-supply').first();
    const mobile = page.getByPlaceholder('Customer mobile no.').first();
    await mobile.fill(kPhone);
    await page.waitForTimeout(800);
    const kerala = await pos.inputValue();
    await page.getByRole('button', { name: 'Change' }).first().click().catch(() => {});
    await mobile.fill(tPhone);
    await page.waitForTimeout(800);
    const local = await pos.inputValue();
    check('SAL9-3 a Kerala GSTIN customer sets place of supply to Kerala', /^32/.test(kerala), kerala);
    check('SAL9-3 switching to a customer without GSTIN resets it to Tamil Nadu', local === '33-Tamil Nadu', local);
    await ctx.close();
  }

  // ---------- V2: the sales PDF shows whole invoice numbers and totals ----------
  if (want('V2')) {
    const { ctx, page } = await login('CEO');
    await nav(page, 'Sale Invoices');
    const from = page.getByLabel('From date').first();
    await from.fill('2000-01-01').catch(() => {});
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.locator('button[title="Download as PDF"]').first().click()]);
    const pdfPath = path.join(os.tmpdir(), `sales-${uid()}.pdf`);
    await dl.saveAs(pdfPath);
    let text = null;
    try {
      text = execFileSync('python3', ['-c', 'import sys,pymupdf;d=pymupdf.open(sys.argv[1]);print("\\f".join(p.get_text() for p in d))', pdfPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { /* pymupdf missing */ }
    if (text) {
      const bills = (await must('GET', '/api/invoices')).filter((i) => !String(i.invoiceNumber).startsWith('BULK/')).slice(0, 5);
      const missing = bills.filter((b) => !text.replace(/\s+/g, '').includes(String(b.invoiceNumber).replace(/\s+/g, '')));
      check('V2 every invoice number is printed whole in the sales PDF', missing.length === 0, missing.map((b) => b.invoiceNumber).join(', '));
      check('V2 no value is cut with "..."', !/\d\.\.\./.test(text));
    } else {
      console.log('SKIP V2 PDF text check (python3 pymupdf not installed)');
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
