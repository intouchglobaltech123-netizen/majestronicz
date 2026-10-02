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

  // ---------- SAL10-3: hiding GST never changes the bill total (₹ discounts convert too) ----------
  if (want('SAL10-3')) {
    const item = await createItem(1180, { 'erode-hq': 20 }, { discountOnSalePrice: 118, discountType: 'amount' });
    const { ctx, page } = await login('Billing');
    await nav(page, 'New Sale');
    const s = page.getByPlaceholder('Type or search product or combo...').first();
    await s.click(); await s.fill(item.itemCode); await page.waitForTimeout(800);
    await page.locator(`text=${item.itemCode}`).first().click(); await page.waitForTimeout(800);
    const qty = page.locator('table tbody tr').first().locator('input[type="number"]').first();
    await qty.fill('2'); await page.waitForTimeout(500);
    const grand = async () => Number(((await page.locator('body').innerText()).match(/GRAND TOTAL\s*₹([\d,\.]+)/)?.[1] || 'NaN').replace(/,/g, ''));
    const on = await grand();
    await page.locator('button', { hasText: /^On$/ }).first().click(); await page.waitForTimeout(800);
    const off = await grand();
    await page.screenshot({ path: path.join(SHOTS, 'r10-gst-off.png') });
    await page.locator('button', { hasText: /^Off$/ }).first().click(); await page.waitForTimeout(800);
    const back = await grand();
    check('SAL10-3 GST off keeps the total of a line with a ₹ standard discount', Math.abs(on - off) < 0.02 && Math.abs(on - back) < 0.02, `on ₹${on}, off ₹${off}, on again ₹${back}`);
    await ctx.close();
  }

  // ---------- RPT10-1: one period rule for the Sales register, the header and the Dashboard ----------
  if (want('RPT10-1')) {
    const money = (t) => Number(String(t || '').replace(/[^\d.-]/g, ''));
    const { ctx, page } = await login('CEO');
    const read = async (from, to) => {
      await nav(page, 'Sales Register');
      await page.getByLabel('Report from date').fill(from);
      await page.getByLabel('Report to date').fill(to);
      await page.waitForTimeout(800);
      const header = money(await page.locator('div', { has: page.getByText('Sales (Period)', { exact: true }) }).last().locator('p').first().innerText());
      const recon = await page.locator('div', { hasText: 'Sales reconciliation:' }).last().innerText();
      const net = money(recon.split('=').pop());
      return { header, net };
    };
    const month = istToday().slice(0, 7);
    const prev = new Date(Date.parse(`${month}-01T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    const prevFrom = `${prev.slice(0, 7)}-01`;
    const item = await createItem(1000, { 'erode-hq': 5 });
    const old = (await must('POST', '/api/tx/sale', saleBody({ date: `${prev.slice(0, 7)}-25`, lines: [lineOf(item, 2)] }))).savedInvoice;
    await must('POST', '/api/tx/sale', saleBody({ lines: [lineOf(item, 1)] })); // a bill this month too
    await page.reload(); await page.waitForTimeout(2500);
    const before = { prev: await read(prevFrom, prev), now: await read(`${month}-01`, istToday()) };
    await must('POST', '/api/tx/sale-return', { invoiceId: old.id, returnLines: [{ itemId: item.id, returnQty: 1 }], reason: 'QA', refundMode: 'Cash' });
    await page.waitForTimeout(2500); // live update
    let after;
    try { after = { prev: await read(prevFrom, prev), now: await read(`${month}-01`, istToday()) }; } catch (e) { await page.screenshot({ path: path.join(SHOTS, 'r10-sales-register-fail.png') }); throw e; }
    await page.screenshot({ path: path.join(SHOTS, 'r10-sales-register.png') });
    check('RPT10-1 the header "Sales (Period)" equals the Sales register net', after.now.header === after.now.net && after.prev.header === after.prev.net, JSON.stringify(after));
    check('RPT10-1 a return today on last month\'s bill lowers this month, not last month', after.prev.net === before.prev.net && Math.abs(before.now.net - after.now.net - 1180) <= 1, JSON.stringify({ before, after }));
    await nav(page, 'Dashboard');
    await page.waitForTimeout(1200);
    await ctx.close();
  }

  // ---------- SEC10-5: a default-PIN login stays on "Set your PIN", also after a reload ----------
  if (want('SEC10-5')) {
    let pin = null;
    for (let i = 0; i < 20 && !pin; i++) {
      const p = String(1000 + Math.floor(Math.random() * 9000));
      if (Object.values(PINS).includes(p) || p === '4444') continue;
      const r = await api('POST', '/api/users', { name: `QA r10 reset ${uid()}`, role: 'Billing', pin: p, assignedBranchId: 'erode-hq' });
      if (r.status === 200) pin = p;
    }
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, timezoneId: 'Asia/Kolkata' });
    const page = await ctx.newPage();
    await page.goto(FE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.keyboard.type(pin, { delay: 80 });
    await page.waitForTimeout(2500);
    const first = (await page.getByText('Set your PIN').count()) > 0 && (await page.locator('aside').count()) === 0;
    await page.reload(); await page.waitForTimeout(2500);
    const again = (await page.getByText('Set your PIN').count()) > 0 && (await page.locator('aside').count()) === 0;
    await page.screenshot({ path: path.join(SHOTS, 'r10-pin-reset.png') });
    check('SEC10-5 a new login is held on "Set your PIN", also after reloading the page', first && again, `first ${first}, after reload ${again}`);
    await ctx.close();
  }

  // ---------- E2E10-4 / SAL10-9 / RPT10-4: Sale Invoices screen ----------
  if (want('E2E10-4')) {
    const item = await createItem(1000, { 'erode-hq': 10 });
    const ph = phone();
    // Part-paid: ₹2,000 cash of ₹2,360, the rest owed.
    const bill = (await must('POST', '/api/tx/sale', saleBody({ lines: [lineOf(item, 2)], customerName: `QA Edit ${uid()}`, customerPhone: ph, transactionType: 'Credit', splits: [{ mode: 'Cash', amount: 2000 }, { mode: 'COD-Credit', amount: 360 }] }), 'Billing')).savedInvoice;
    await must('POST', '/api/payments', { type: 'in', partyType: 'customer', partyId: bill.customerId, partyName: bill.customerName, branchId: 'erode-hq', date: istToday(), amount: 100, paymentMode: 'GPay', allocations: [{ refId: bill.id, amount: 100 }] }, 'Billing');
    const { ctx, page } = await login('CEO');
    await nav(page, 'Sale Invoices');
    await page.waitForTimeout(800);
    // SAL10-9: today's GPay card includes the receipt.
    const gpay = Number(((await page.locator('div', { has: page.getByText('GPay', { exact: true }) }).filter({ hasText: 'incl. receipts' }).last().innerText()).match(/₹([\d,]+)/)?.[1] || 'NaN').replace(/,/g, ''));
    check('SAL10-9 the Today GPay card includes a receipt taken today', gpay >= 100, `GPay ₹${gpay}`);
    await page.getByPlaceholder('Search sale by Customer, Invoice No, Phone, or Item...').fill(bill.invoiceNumber);
    await page.waitForTimeout(600);
    await page.locator('tr', { hasText: bill.invoiceNumber }).first().locator('button[title="Edit Sale"]').click();
    await page.waitForTimeout(1500);
    const qty = page.locator('table tbody tr').first().locator('input[type="number"]').first();
    await qty.fill('1'); await page.waitForTimeout(800);
    const banner = await page.getByTestId('paid-over-banner').count();
    const saveBtn = page.getByRole('button', { name: /Save Invoice/ }).first();
    const enabled = await saveBtn.isEnabled();
    await page.screenshot({ path: path.join(SHOTS, 'r10-edit-below-paid.png') });
    check('E2E10-4 editing a part-paid bill below what was paid explains the store credit and can be saved', banner > 0 && enabled, `banner ${banner}, save enabled ${enabled}`);
    if (enabled) {
      await saveBtn.click(); await page.waitForTimeout(2500);
      const after = (await api('GET', `/api/invoices/${bill.id}`)).body;
      const cust = (await api('GET', '/api/customers')).body.find((c) => c.id === bill.customerId);
      check('E2E10-4 the save keeps the cash and puts the difference on store credit', Math.abs(after.grandTotal - 1180) < 0.01 && Math.abs((cust?.creditBalance || 0) - 920) < 0.02, `total ₹${after.grandTotal}, credit ₹${cust?.creditBalance}`);
    }
    await ctx.close();
  }

  // ---------- PUR10-2: the PO detail breakdown adds up after mixed receipts ----------
  if (want('PUR10-2')) {
    const a = await createItem(300, {}, { purchasePrice: 100 });
    const b = await createItem(300, {}, { purchasePrice: 200 });
    const vendor = (await api('GET', '/api/vendors')).body[0];
    const po = (await must('POST', '/api/purchase/save', { po: { vendorId: vendor.id, vendorName: vendor.vendorName, branchId: 'erode-hq', date: istToday(), expectedDeliveryDate: istToday(),
      items: [{ itemId: a.id, itemName: a.itemName, itemCode: a.itemCode, quantityOrdered: 10, receivedQuantity: 0, purchasePrice: 100, taxPercent: 18 }, { itemId: b.id, itemName: b.itemName, itemCode: b.itemCode, quantityOrdered: 5, receivedQuantity: 0, purchasePrice: 200, taxPercent: 12 }], totalAmount: 0, notes: 'QA' }, actor: 'QA' })).saved;
    await must('POST', '/api/purchase/receive', { poId: po.id, receipts: [{ itemId: a.id, quantityReceived: 4, damagedQuantity: 1, taxPercent: 5 }, { itemId: b.id, quantityReceived: 2, missingQuantity: 1 }], otherCharges: 50, actor: 'QA' });
    const { ctx, page } = await login('CEO');
    await nav(page, 'Purchases');
    await page.waitForTimeout(800);
    await page.getByText(po.poNumber).first().click();
    await page.waitForTimeout(1200);
    const card = await page.locator('div', { has: page.getByText('Order Value', { exact: true }) }).last().innerText();
    const nums = (card.match(/₹[\d,]+(\.\d+)?/g) || []).map((x) => Number(x.replace(/[₹,]/g, '')));
    const [total, goods, gst, charges] = nums;
    await page.screenshot({ path: path.join(SHOTS, 'r10-po-detail.png') });
    check('PUR10-2 the PO value equals its goods + GST + charges after mixed receipts', nums.length >= 4 && Math.abs(goods + gst + charges - total) < 0.02, card.replace(/\s+/g, ' '));
    await ctx.close();
  }

  // ---------- RPT10-4: a bill of an ended month cannot be voided from the list ----------
  if (want('RPT10-4')) {
    const month = istToday().slice(0, 7);
    const prevDay = new Date(Date.parse(`${month}-01T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    const item = await createItem(1000, { 'erode-hq': 5 });
    const old = (await must('POST', '/api/tx/sale', saleBody({ date: `${prevDay.slice(0, 7)}-26`, lines: [lineOf(item, 1)] }))).savedInvoice;
    const { ctx, page } = await login('CEO');
    await nav(page, 'Sale Invoices');
    await page.getByPlaceholder('Search sale by Customer, Invoice No, Phone, or Item...').fill(old.invoiceNumber);
    await page.waitForTimeout(700);
    const btn = page.locator('tr', { hasText: old.invoiceNumber }).first().locator('button[title*="month has ended — use a return"]'); // the Void button (Edit says so too since FIN-A-3)
    check('RPT10-4 the Void button of a bill from an ended month is disabled and says why', (await btn.count()) === 1 && (await btn.isDisabled()));
    await ctx.close();
  }

  // ---------- CASH10-1: a day before a closed day is shown locked ----------
  if (want('CASH10-1')) {
    // Two fresh past days of Chennai: close the later one, look at the earlier.
    const regs = (await api('GET', '/api/cash-registers')).body.filter((r) => r.branchId === 'chennai').map((r) => r.date);
    let d1 = null;
    for (let k = 0; k < 200 && !d1; k++) {
      const d = new Date(Date.parse('2019-01-01T00:00:00Z') + Math.floor(Math.random() * 1500) * 86400000).toISOString().slice(0, 10);
      const d2 = new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
      if (!regs.includes(d) && !regs.includes(d2)) d1 = d;
    }
    const d2 = new Date(Date.parse(`${d1}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    await must('POST', '/api/cash/close', { branchId: 'chennai', date: d2 });
    try {
      const { ctx, page } = await login('CEO');
      await nav(page, 'Daily Cash Register');
      const sel = page.locator('select').filter({ has: page.locator('option[value="chennai"]') }).first();
      if (await sel.count()) await sel.selectOption('chennai').catch(() => {});
      await page.getByLabel('Register date').fill(d1);
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(SHOTS, 'r10-register-locked.png') });
      check('CASH10-1 a day before a closed day is shown locked (no expense entry)', (await page.getByTestId('locked-by-later-close').count()) === 1);
      await ctx.close();
    } finally {
      await api('POST', '/api/cash/reopen', { branchId: 'chennai', date: d2 });
    }
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} round-10 UI checks passed`);
process.exit(failed.length ? 1 : 0);
