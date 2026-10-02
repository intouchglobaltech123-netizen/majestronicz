// Browser checks for the round-11 final-check screen fixes (FIN-A, FIN-B and FIN-E
// findings). Drives the real screens; data is prepared
// through the API.
//
//   QA_FRONTEND_URL=http://127.0.0.1:5199 QA_API_URL=http://127.0.0.1:4100 node qa/smoke/round11-ui.mjs
//
// Needs the frontend + backend running (as for smoke.mjs) and the seeded data.
import os from 'node:os';
import path from 'node:path';

const PW = process.env.QA_PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const FE = (process.env.QA_FRONTEND_URL || 'http://127.0.0.1:5199').replace(/\/$/, '');
const API = (process.env.QA_API_URL || 'http://127.0.0.1:4100').replace(/\/$/, '');
const PINS = { CEO: '1111', Manager: '2222', Billing: '3333', Purchase: '5555' };
const ONLY = process.env.QA_ONLY ? new Set(process.env.QA_ONLY.split(',')) : null;
const want = (id) => !ONLY || ONLY.has(id);
const SHOTS = process.env.QA_SHOTS || os.tmpdir();

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
    item: { itemName: `QA r11 ${code}`, itemHSN: '85371000', category: 'QA', itemCode: code, unit: 'PCS', salePrice: price, salePriceTaxMode: 'exclusive', wholesalePrice: price, minWholesaleQty: 10, purchasePrice: 600, gstTaxSlab: 18, ...extra },
    initialStocks: stock,
  });
  return body.item;
}

const saleBody = ({ branchId = 'erode-hq', date = istToday(), lines, customerName = 'QA r11 walk-in', customerPhone = '', splits, transactionType = 'Cash', withGst = true }) => ({
  id: `inv-qa-${uid()}`, invoiceNumber: 'DRAFT', branchId, transactionType, customerName, customerPhone, customerAddress: '', date, time: '11:00',
  paymentTerms: 'Due on Receipt', dueDate: date, stateOfSupply: '33-Tamil Nadu', withGst, items: lines, overallDiscountType: '%', overallDiscountValue: 0,
  shippingCharges: 0, roundOffEnabled: false, termsAndConditions: 'QA', paymentMode: splits?.[0]?.mode || 'Cash', paymentSplits: splits || [{ mode: 'Cash', amount: 0 }],
  createdAt: new Date().toISOString(),
});
const lineOf = (item, quantity, extra = {}) => ({ id: `li-${uid()}`, itemId: item.id, itemName: item.itemName, itemCode: item.itemCode, itemHSN: item.itemHSN, unit: item.unit, quantity, unitPrice: item.salePrice, taxRate: item.gstTaxSlab, discountType: '%', discountValue: 0, ...extra });
const findRow = async (page, number) => {
  await page.getByPlaceholder('Search sale by Customer, Invoice No, Phone, or Item...').fill(number);
  await page.waitForTimeout(700);
  return page.locator('tr', { hasText: number }).first();
};

try {
  // ---------- FIN-A-1 / FIN-E-1 / FIN-E-2: edit down then back up shows the credit applied and what's left to collect ----------
  if (want('FIN-A-1')) {
    const item = await createItem(1000, { 'erode-hq': 10 });
    const bill = (await must('POST', '/api/tx/sale', saleBody({ lines: [lineOf(item, 2)], customerName: `QA EditUp ${uid()}`, customerPhone: phone(), splits: [{ mode: 'Cash', amount: 2360 }] }), 'Billing')).savedInvoice;
    const { ctx, page } = await login('CEO');
    await nav(page, 'Sale Invoices');
    const qty = () => page.locator('table tbody tr').first().locator('input[type="number"]').first();
    const saveBtn = () => page.getByRole('button', { name: /Save Invoice/ }).first();
    await (await findRow(page, bill.invoiceNumber)).locator('button[title="Edit Sale"]').click();
    await page.waitForTimeout(1500);
    await qty().fill('1'); await page.waitForTimeout(800);
    const banner = (await page.getByTestId('paid-over-banner').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const panel = await page.getByTestId('kept-split-panel').innerText().catch(() => '');
    check('FIN-E-1 the edit-below-paid banner says "₹2,360 paid is ₹1,180 more than the new total"', /₹2,360(\.00)? paid is ₹1,180(\.00)? more than the new total/.test(banner), banner);
    check('FIN-E-2 the payment panel shows only what was collected (no credit split, no over-allocated)', /Cash/.test(panel) && !/over-allocated/i.test(await page.locator('body').innerText()), panel.replace(/\s+/g, ' '));
    await saveBtn().click(); await page.waitForTimeout(2500);
    await page.keyboard.press('Escape'); await page.waitForTimeout(500); // the print preview of the saved bill
    if (await page.locator('#invoice-print-overlay').count()) { await page.reload(); await page.waitForTimeout(2500); }
    await nav(page, 'Sale Invoices');
    await (await findRow(page, bill.invoiceNumber)).locator('button[title="Edit Sale"]').click();
    await page.waitForTimeout(1500);
    await qty().fill('3'); await page.waitForTimeout(800);
    const cb = (await page.getByTestId('credit-back-banner').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const left = await page.getByTestId('left-to-collect').innerText().catch(() => '');
    await page.screenshot({ path: path.join(SHOTS, 'r11-edit-up.png') });
    check('FIN-A-1 editing back up shows the store credit applied back and ₹1,180 left to collect', /applied back/.test(cb) && /1,180/.test(left), `${cb} | ${left.replace(/\s+/g, ' ')}`);
    await saveBtn().click(); await page.waitForTimeout(2500);
    const after = (await api('GET', `/api/invoices/${bill.id}`)).body;
    const cash = (after.paymentSplits || []).filter((s) => s.mode === 'Cash').reduce((t, s) => t + s.amount, 0);
    check('FIN-A-1 the saved bill keeps ₹2,360 cash and ₹1,180 due', Math.abs(cash - 2360) < 0.01 && Math.abs(after.balanceDue - 1180) < 0.01, `cash ₹${cash}, due ₹${after.balanceDue}`);
    await ctx.close();
  }

  // ---------- FIN-A-3: a bill of an ended month cannot be edited from the list ----------
  if (want('FIN-A-3')) {
    const month = istToday().slice(0, 7);
    const prevDay = new Date(Date.parse(`${month}-01T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    const item = await createItem(1000, { 'erode-hq': 5 });
    const old = (await must('POST', '/api/tx/sale', saleBody({ date: `${prevDay.slice(0, 7)}-27`, lines: [lineOf(item, 1)] }))).savedInvoice;
    const { ctx, page } = await login('CEO');
    await nav(page, 'Sale Invoices');
    const btn = (await findRow(page, old.invoiceNumber)).getByTestId('edit-sale');
    const title = await btn.getAttribute('title').catch(() => '');
    check('FIN-A-3 the Edit button of a bill from an ended month is disabled and says why', (await btn.count()) === 1 && (await btn.isDisabled()) && /month has ended/.test(title || ''), title || '');
    await ctx.close();
  }
  // @@NEXT@@
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} round-11 UI checks passed`);
process.exit(failed.length ? 1 : 0);
