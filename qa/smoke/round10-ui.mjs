// Browser checks for the round-10 screen fixes (SAL10-1 live sync, CASH10-1,
// RPT10-4, SAL10-3 and more). Drives the real screens; data is prepared
// through the API.
//
//   QA_FRONTEND_URL=http://127.0.0.1:5199 QA_API_URL=http://127.0.0.1:4100 node qa/smoke/round10-ui.mjs
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
    item: { itemName: `QA r10 ${code}`, itemHSN: '85371000', category: 'QA', itemCode: code, unit: 'PCS', salePrice: price, salePriceTaxMode: 'exclusive', wholesalePrice: price, minWholesaleQty: 10, purchasePrice: 600, gstTaxSlab: 18, ...extra },
    initialStocks: stock,
  });
  return body.item;
}

const saleBody = ({ branchId = 'erode-hq', date = istToday(), lines, customerName = 'QA r10 walk-in', customerPhone = '', splits, transactionType = 'Cash', withGst = true }) => ({
  id: `inv-qa-${uid()}`, invoiceNumber: 'DRAFT', branchId, transactionType, customerName, customerPhone, customerAddress: '', date, time: '11:00',
  paymentTerms: 'Due on Receipt', dueDate: date, stateOfSupply: '33-Tamil Nadu', withGst, items: lines, overallDiscountType: '%', overallDiscountValue: 0,
  shippingCharges: 0, roundOffEnabled: false, termsAndConditions: 'QA', paymentMode: splits?.[0]?.mode || 'Cash', paymentSplits: splits || [{ mode: 'Cash', amount: 0 }],
  createdAt: new Date().toISOString(),
});
const lineOf = (item, quantity, extra = {}) => ({ id: `li-${uid()}`, itemId: item.id, itemName: item.itemName, itemCode: item.itemCode, itemHSN: item.itemHSN, unit: item.unit, quantity, unitPrice: item.salePrice, taxRate: item.gstTaxSlab, discountType: '%', discountValue: 0, ...extra });

try {
  // ---------- SAL10-1: a sale elsewhere reaches an open screen as a few rows, not a full reload ----------
  if (want('SAL10-1')) {
    const { ctx, page } = await login('CEO');
    const calls = { bootstrap: 0, sync: 0, history: 0, syncBytes: 0 };
    page.on('response', async (r) => {
      const u = r.url();
      if (u.includes('/api/bootstrap')) calls.bootstrap++;
      if (u.includes('/api/history')) calls.history++;
      if (u.includes('/api/sync')) { calls.sync++; calls.syncBytes += Number(r.headers()['content-length'] || (await r.body().catch(() => '')).length || 0); }
    });
    const item = await createItem(1000, { 'erode-hq': 20 });
    await nav(page, 'Sale Invoices');
    await page.waitForTimeout(2500); // the item's own live update settles first
    const before = { ...calls };
    const saved = (await must('POST', '/api/tx/sale', saleBody({ lines: [lineOf(item, 1)], customerName: `QA Live ${uid()}` }), 'Billing')).savedInvoice;
    let seen = false;
    for (let i = 0; i < 20 && !seen; i++) {
      await page.waitForTimeout(500);
      seen = (await page.locator('body', { hasText: saved.invoiceNumber }).count()) > 0 && (await page.getByText(saved.invoiceNumber).count()) > 0;
    }
    await page.screenshot({ path: path.join(SHOTS, 'r10-live-sale.png') });
    check('SAL10-1 a bill saved by another cashier appears on an open Sale Invoices screen', seen, saved.invoiceNumber);
    check('SAL10-1 it arrives through /api/sync, without re-downloading the bootstrap', calls.sync > before.sync && calls.bootstrap === before.bootstrap, JSON.stringify(calls));
    await ctx.close();
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} round-10 UI checks passed`);
process.exit(failed.length ? 1 : 0);
