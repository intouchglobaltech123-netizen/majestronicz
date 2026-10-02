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
const PINS = { CEO: '1111', Manager: '2222', Billing: '3333', Sales: '4444', Purchase: '5555' };
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
        ? JSON.stringify({ sales: true, items: true, reports: true, purchases: true, 'cash-bank': true, parties: true, staff: true, enquiries: true }) : get.call(this, key);
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

  const money = (t) => Number(String(t || '').replace(/[^\d.-]/g, ''));
  const grandOf = async (page) => Number(((await page.locator('body').innerText()).match(/GRAND TOTAL\s*₹([\d,\.]+)/)?.[1] || 'NaN').replace(/,/g, ''));
  const pickItem = async (page, item) => {
    const box = page.getByPlaceholder('Type or search product or combo...').first();
    await box.click(); await box.fill(item.itemCode); await page.waitForTimeout(800);
    await page.locator(`text=${item.itemCode}`).first().click(); await page.waitForTimeout(800);
  };
  const qtyBox = (page) => page.locator('table tbody tr').first().locator('input[type="number"]').first();

  // ---------- FIN-A-2: an overall ₹ discount keeps the bill total when GST is switched off ----------
  if (want('FIN-A-2')) {
    const item = await createItem(1000, { 'erode-hq': 20 });
    const { ctx, page } = await login('Billing');
    await nav(page, 'New Sale');
    await pickItem(page, item);
    await qtyBox(page).fill('2'); await page.waitForTimeout(500);
    const row = page.locator('div', { has: page.getByText('Overall Discount:', { exact: true }) }).last();
    await row.locator('button').first().click(); await page.waitForTimeout(300); // % → ₹
    await row.locator('input[type="number"]').fill('100'); await page.waitForTimeout(600);
    const on = await grandOf(page);
    await page.locator('button', { hasText: /^On$/ }).first().click(); await page.waitForTimeout(800);
    const off = await grandOf(page);
    await page.screenshot({ path: path.join(SHOTS, 'r11-gst-off-overall.png') });
    check('FIN-A-2 GST off keeps the total of a bill with an overall ₹ discount', Math.abs(on - off) <= 0.02 && Math.abs(on - 2242) <= 0.02, `on ₹${on}, off ₹${off} (2 × ₹1,000 − ₹100, +18%)`);
    await ctx.close();
  }

  // ---------- SAL4-13: a reload brings the bill tab back with its lines, and no extra empty tab ----------
  if (want('SAL4-13')) {
    const item = await createItem(1000, { 'erode-hq': 20 });
    const { ctx, page } = await login('Billing');
    await nav(page, 'New Sale');
    await pickItem(page, item);
    await qtyBox(page).fill('3'); await page.waitForTimeout(1500);
    const tabsBefore = await page.locator('[data-bill-id]').count();
    await page.reload(); await page.waitForTimeout(3500);
    const body = (await page.locator('body').innerText()) + (await page.locator('input').evaluateAll((els) => els.map((e) => e.value).join(' ')));
    const tabsAfter = await page.locator('[data-bill-id]').count();
    const q = await qtyBox(page).inputValue().catch(() => '');
    await page.screenshot({ path: path.join(SHOTS, 'r11-tabs-after-reload.png') });
    check('SAL4-13 after a reload the bill tab still has its line (item and quantity) and no extra tab opens', body.includes(item.itemCode) && q === '3' && tabsAfter === tabsBefore, `tabs ${tabsBefore} → ${tabsAfter}, qty "${q}"`);
    await page.getByRole('button', { name: /Save Invoice/ }).first().click(); await page.waitForTimeout(2500);
    const saved = (await api('GET', '/api/invoices')).body.filter((i) => (i.items || []).some((l) => l.itemId === item.id));
    check('SAL4-13 the restored bill saves as a new sale with its line', saved.length === 1 && saved[0].items.find((l) => l.itemId === item.id)?.quantity === 3, `${saved.length} bill(s)`);
    await ctx.close();
  }

  // ---------- E2E-20: a credit bill offers payment terms and shows the due date ----------
  if (want('E2E-20')) {
    const item = await createItem(1000, { 'erode-hq': 20 });
    const { ctx, page } = await login('Billing');
    await nav(page, 'New Sale');
    await pickItem(page, item);
    await page.locator('button', { hasText: /^Cash Sale$/ }).first().click(); await page.waitForTimeout(300);
    await page.locator('button', { hasText: /^Credit Bill$/ }).first().click(); await page.waitForTimeout(500);
    const terms = page.getByTestId('payment-terms');
    const shown = await terms.count();
    if (shown) {
      await terms.locator('button').first().click(); await page.waitForTimeout(300);
      await page.locator('button', { hasText: /^Net 15 Days$/ }).first().click(); await page.waitForTimeout(500);
    }
    const txt = shown ? await terms.innerText() : '';
    const due = new Date(Date.parse(`${istToday()}T00:00:00Z`) + 15 * 86400000).toISOString().slice(0, 10).split('-').reverse().join('/');
    await page.screenshot({ path: path.join(SHOTS, 'r11-payment-terms.png') });
    check('E2E-20 a credit bill offers payment terms and shows the due date (Net 15 → +15 days)', shown === 1 && txt.includes(due), txt.replace(/\s+/g, ' '));
    await ctx.close();
  }

  // ---------- SAL-21: an Organization buyer gets the wholesale price only from the minimum quantity ----------
  if (want('SAL-21')) {
    const item = await createItem(1000, { 'erode-hq': 20 }, { wholesalePrice: 800, minWholesaleQty: 3 });
    const ph = phone();
    await must('POST', '/api/catalog/customer', { name: `QA Org ${uid()}`, phone: ph, address: 'QA', customerType: 'Organization' });
    const { ctx, page } = await login('Billing');
    await nav(page, 'New Sale');
    const phoneBox = page.locator('input[type="tel"]').first();
    await phoneBox.fill(ph); await page.waitForTimeout(1200);
    await page.keyboard.press('Escape').catch(() => {});
    await pickItem(page, item);
    const price = () => page.locator('table tbody tr').first().locator('input[type="number"]').nth(1).inputValue();
    const p1 = await price();
    await qtyBox(page).fill('3'); await page.waitForTimeout(800);
    const p3 = await price();
    await qtyBox(page).fill('2'); await page.waitForTimeout(800);
    const p2 = await price();
    await page.screenshot({ path: path.join(SHOTS, 'r11-wholesale.png') });
    check('SAL-21 the wholesale price applies from the minimum wholesale quantity and goes back below it', Number(p1) === 1000 && Number(p3) === 800 && Number(p2) === 1000, `qty1 ₹${p1}, qty3 ₹${p3}, qty2 ₹${p2}`);
    await ctx.close();
  }

  // ---------- FIN-B-2: a Manager has no Payroll screens and sees "Confidential", not ₹0 ----------
  if (want('FIN-B-2')) {
    const { ctx, page } = await login('Manager');
    const side = await page.locator('aside').innerText();
    await nav(page, 'Staff Directory');
    const conf = await page.getByTestId('payroll-confidential').count();
    const tabs = await page.locator('button', { hasText: /^Payroll Processing$|^Salary Structure$/ }).count();
    await page.screenshot({ path: path.join(SHOTS, 'r11-manager-staff.png') });
    check('FIN-B-2 the Manager menu has no Payroll / Salary Structure, the tabs are hidden and the payroll card says Confidential', !/\nPayroll\n|Salary Structure/.test(`\n${side}\n`) && tabs === 0 && conf === 1, `menu payroll ${/\nPayroll\n/.test(`\n${side}\n`)}, tabs ${tabs}, confidential ${conf}`);
    await ctx.close();
  }

  // ---------- FIN-B-13: the Sales login has no "Sales" menu that only opens Enquiries ----------
  if (want('FIN-B-13')) {
    const { ctx, page } = await login('Sales');
    const titles = await page.locator('aside button').allInnerTexts();
    const hasSales = titles.some((t) => t.trim() === 'Sales');
    const hasEnq = titles.some((t) => /Enquiries/.test(t));
    check('FIN-B-13 the Sales login shows Enquiries but no Sales menu', !hasSales && hasEnq, titles.filter(Boolean).slice(0, 12).join(' | '));
    await ctx.close();
  }

  // ---------- FIN-B-4: Stock Valuation tab counts equal the rows they list ----------
  if (want('FIN-B-4')) {
    const { ctx, page } = await login('CEO');
    await nav(page, 'Stock Valuation');
    const tab = page.locator('button', { hasText: /^Low Stock \(\d+\)$/ }).first();
    const label = await tab.innerText().catch(() => '');
    await tab.click().catch(() => {}); await page.waitForTimeout(800);
    const n = Number(label.match(/\((\d+)\)/)?.[1] ?? NaN);
    const rows = await page.locator('table').last().locator('tbody > tr').filter({ hasNotText: 'No items' }).count();
    await page.screenshot({ path: path.join(SHOTS, 'r11-stock-valuation-low.png') });
    check('FIN-B-4 the Low Stock tab count equals the rows it lists', Number.isFinite(n) && n === rows, `${label} vs ${rows} rows`);
    await ctx.close();
  }

  // ---------- FIN-A-4: a branch whose returns outweigh its sales still shows its P&L ----------
  if (want('FIN-A-4')) {
    const month = istToday().slice(0, 7);
    const prevDay = new Date(Date.parse(`${month}-01T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    const item = await createItem(1000, { chennai: 5 });
    const old = (await must('POST', '/api/tx/sale', saleBody({ branchId: 'chennai', date: `${prevDay.slice(0, 7)}-20`, lines: [lineOf(item, 3)] }))).savedInvoice;
    await must('POST', '/api/tx/sale-return', { invoiceId: old.id, returnLines: [{ itemId: item.id, returnQty: 3 }], reason: 'QA', refundMode: 'Cash' });
    const { ctx, page } = await login('CEO');
    await nav(page, 'Profit & Loss Statement');
    await page.getByLabel('Report branch').selectOption('chennai').catch(() => {});
    await page.getByLabel('Report from date').fill(istToday());
    await page.getByLabel('Report to date').fill(istToday());
    await page.waitForTimeout(1200);
    const txt = await page.locator('main').innerText();
    await page.screenshot({ path: path.join(SHOTS, 'r11-pnl-negative.png') });
    check('FIN-A-4 the P&L of a period with net negative revenue is shown, not the empty state', /Net Profit/i.test(txt) && !/No (activity|data)/i.test(txt), txt.slice(0, 160).replace(/\s+/g, ' '));
    await ctx.close();
  }

  // ---------- FIN-A-9: while older bills load, the bill list says so ----------
  if (want('FIN-A-9')) {
    const ctx0 = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Kolkata' });
    await ctx0.addInitScript(() => {
      const get = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key) { return String(key).startsWith('majestronicz_sidebar_expanded') ? JSON.stringify({ sales: true }) : get.call(this, key); };
    });
    await ctx0.route('**/api/history**', async (route) => { await new Promise((r) => setTimeout(r, 9000)); await route.continue().catch(() => {}); });
    const page = await ctx0.newPage();
    await page.goto(FE, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500);
    await page.keyboard.type(PINS.CEO, { delay: 80 });
    await page.locator('aside').first().waitFor({ state: 'visible', timeout: 20000 });
    await nav(page, 'Sale Invoices');
    const seen = await page.getByTestId('history-loading').count();
    check('FIN-A-9 the Sale Invoices list says "loading older bills" while they load', seen >= 1, `hint elements ${seen}`);
    await ctx0.close();
  }

  // ---------- FIN-E-4: the return dialog shows what is booked ----------
  if (want('FIN-E-4')) {
    const a = await createItem(333.33, { 'erode-hq': 5 });
    const b = await createItem(333.33, { 'erode-hq': 5 });
    const c = await createItem(333.33, { 'erode-hq': 5 });
    const bill = (await must('POST', '/api/tx/sale', { ...saleBody({ lines: [lineOf(a, 1), lineOf(b, 1), lineOf(c, 1)] }), roundOffEnabled: true })).savedInvoice;
    const { ctx, page } = await login('CEO');
    await nav(page, 'Sale Invoices');
    await (await findRow(page, bill.invoiceNumber)).locator('button[title="Process Line-Item Return"]').click();
    await page.waitForTimeout(1000);
    await page.locator('button', { hasText: 'Return All' }).first().click(); await page.waitForTimeout(600);
    const preview = money(await page.locator('div').filter({ has: page.getByText('Total Return Value', { exact: true }) }).filter({ has: page.locator('.text-xl') }).last().locator('.text-xl').first().innerText());
    await page.locator('button[type="submit"]', { hasText: 'Confirm Return' }).click(); await page.waitForTimeout(2500);
    const after = (await api('GET', `/api/invoices/${bill.id}`)).body;
    check('FIN-E-4 a full return previews exactly the amount it books', Math.abs(preview - (after.totalReturnedAmount || 0)) < 0.005 && Math.abs(preview - bill.grandTotal) < 0.005, `preview ₹${preview}, booked ₹${after.totalReturnedAmount}, bill ₹${bill.grandTotal}`);
    await ctx.close();
  }
  // @@NEXT@@
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} round-11 UI checks passed`);
process.exit(failed.length ? 1 : 0);
