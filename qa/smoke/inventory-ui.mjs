// Browser checks for the round-8 inventory screens (INV-12, E2E7-9, INV8-5,
// INV8-6, INV-13, INV5-6, INV7-2, INV2-10, INV5-7, INV3-6). Drives the real
// screens; data is prepared through the API.
//
//   QA_FRONTEND_URL=http://127.0.0.1:5199 QA_API_URL=http://127.0.0.1:4100 node qa/smoke/inventory-ui.mjs
//
// Needs the frontend + backend running (as for smoke.mjs) and the seeded data.
const PW = process.env.QA_PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const FE = (process.env.QA_FRONTEND_URL || 'http://127.0.0.1:5199').replace(/\/$/, '');
const API = (process.env.QA_API_URL || 'http://127.0.0.1:4100').replace(/\/$/, '');
const PINS = { CEO: '1111', Manager: '2222', Billing: '3333', Purchase: '5555' };

const tokens = {};
async function api(method, path, body, role = 'CEO') {
  if (!tokens[role]) {
    const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: PINS[role] }) });
    tokens[role] = (await r.json()).token;
  }
  const res = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[role]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch();
async function login(role) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Kolkata' });
  await ctx.addInitScript(() => {
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      return String(key).startsWith('majestronicz_sidebar_expanded')
        ? JSON.stringify({ sales: true, items: true, reports: true, purchases: true }) : get.call(this, key);
    };
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [${role}] page error: ${e.message}`));
  await page.goto(FE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.keyboard.type(PINS[role], { delay: 80 });
  await page.locator('aside').first().waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(1500);
  return { ctx, page };
}
const nav = async (page, label) => {
  await page.locator('aside button', { hasText: label }).first().click();
  await page.waitForTimeout(1200);
};

try {
  // ---------- CEO: challans ----------
  {
    const { ctx, page } = await login('CEO');
    await nav(page, 'Delivery Challans');
    await page.getByRole('button', { name: /New Challan/ }).first().click().catch(() => {});
    await page.waitForTimeout(500);
    const numberInput = page.locator('input[title*="Next number"], input[title*="cannot be changed"]').first();
    check('INV-12 the challan number field is read-only', (await numberInput.getAttribute('readonly')) !== null);

    // A transfer from Erode to Chennai through the Transfer screen: the toast
    // must name the challan number the server saved (E2E7-9).
    const stocks = (await api('GET', '/api/branch-stock')).body;
    const items = (await api('GET', '/api/items')).body;
    const src = items.find((i) => !i.isArchived && i.unit !== 'MTR' && (stocks.find((x) => x.itemId === i.id && x.branchId === 'erode-hq')?.quantity || 0) >= 2);
    await nav(page, 'Stock Inventory');
    const invSearch = page.getByPlaceholder(/search/i).first();
    await invSearch.fill(src.itemCode).catch(() => {});
    await page.waitForTimeout(600);
    await page.locator('tbody tr', { hasText: src.itemCode }).first().getByRole('button', { name: 'Transfer', exact: true }).click();
    await page.waitForTimeout(600);
    const modal = page.locator('form').filter({ has: page.locator('button[type="submit"]') }).last();
    const selects = modal.locator('select');
    await selects.nth(0).selectOption('erode-hq').catch(() => {});
    await selects.nth(1).selectOption('chennai').catch(() => {});
    await modal.locator('input[type="number"]').first().fill('1');
    await modal.locator('button[type="submit"]').click();
    const toast = page.locator('[data-sonner-toast]', { hasText: /Challan #DC-TRF-\d+/ }).first();
    await toast.waitFor({ timeout: 10000 }).catch(() => {});
    const toastNo = ((await toast.textContent().catch(() => '')) || '').match(/DC-TRF-\d+/)?.[0];
    const transfers = (await api('GET', '/api/stock-transfers')).body.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    const saved = transfers[0]?.challanNumber;
    check('E2E7-9 the transfer toast names the challan number that was saved', !!toastNo && toastNo === saved, `toast ${toastNo}, saved ${saved}`);

    // Receive it from the challan list: the button says Receive Transfer and asks first.
    await nav(page, 'Delivery Challans');
    await page.locator('main').getByRole('button', { name: /Challan History/ }).first().click();
    await page.waitForTimeout(800);
    const row = page.locator('tr', { hasText: saved }).first();
    const recvBtn = row.getByRole('button', { name: 'Receive Transfer' });
    check('INV8-5 a DC-TRF challan offers "Receive Transfer"', (await recvBtn.count()) === 1);
    let dialogText = '';
    page.once('dialog', async (d) => { dialogText = d.message(); await d.accept(); });
    await recvBtn.click();
    await page.waitForTimeout(1500);
    check('INV8-6 receiving asks for confirmation', /Receive the goods/.test(dialogText), dialogText.slice(0, 60));
    const ch = (await api('GET', '/api/challans')).body.find((c) => c.challanNumber === saved);
    const t = (await api('GET', '/api/stock-transfers')).body.find((x) => x.challanNumber === saved);
    check('INV8-5 the challan and its transfer are both received', ch?.status === 'received' && t?.status === 'received');
    check('INV8-6 a received challan has no Receive button any more', (await row.getByRole('button', { name: /Receive Transfer|Mark Received/ }).count()) === 0);
    check('INV-13 a received transfer challan cannot be edited or deleted from the list',
      (await row.locator('button[title="Edit Challan"]').count()) === 0 && (await row.locator('button[title="Delete Challan"]').count()) === 0);
    // The printed document says Received with the IST time.
    await row.locator('button[title="Preview & Print PDF"]').click();
    await page.waitForTimeout(800);
    const docText = await page.locator('body').innerText();
    check('INV8-5 the challan document says Received with the IST time', /Status:\s*Received/.test(docText) && /\d{2}:\d{2} IST/.test(docText));
    await page.keyboard.press('Escape');

    // ---------- Item archive (INV5-7) ----------
    const code = `QA-UI-${Date.now().toString(36)}`.toUpperCase();
    const created = await api('POST', '/api/catalog/item', { item: { itemName: `QA archive ${code}`, itemHSN: '85371000', category: 'QA', itemCode: code, unit: 'PCS', salePrice: 10, salePriceTaxMode: 'exclusive', wholesalePrice: 10, minWholesaleQty: 1, purchasePrice: 5, gstTaxSlab: 18 }, initialStocks: {} });
    await api('POST', `/api/catalog/item/${created.body.item.id}/archive`, { archived: true });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('aside').first().waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForTimeout(1200);
    await nav(page, 'Item Catalog');
    const search = page.getByPlaceholder(/search/i).first();
    await search.fill(code);
    await page.waitForTimeout(500);
    const hidden = (await page.locator('tbody tr', { hasText: code }).count()) === 0;
    await page.locator('[data-testid="show-archived-items"]').check();
    await page.waitForTimeout(500);
    const shown = (await page.locator('tbody tr', { hasText: code }).filter({ hasText: 'Archived' }).count()) === 1;
    check('INV5-7 an archived item is hidden from the catalog until "Show archived" is ticked', hidden && shown);

    // ---------- Combo savings (INV3-6) ----------
    await nav(page, 'Combos & Bundles');
    const comboRow = page.locator('tbody tr', { hasText: /Save \d+(\.\d)?%/ }).first();
    const listSave = (await comboRow.locator('text=/Save \\d+(\\.\\d)?%/').first().textContent().catch(() => '')) || '';
    await comboRow.locator('button[title="Edit Combo Definition"]').click();
    await page.waitForTimeout(800);
    const editorSave = (await page.locator('text=/Save \\d+(\\.\\d)?%/').last().textContent().catch(() => '')) || '';
    const pct = (s) => (s.match(/Save (\d+(?:\.\d)?)%/) || [])[1];
    check('INV3-6 the combo list and the combo editor show the same saving', !!pct(listSave) && pct(listSave) === pct(editorSave), `${listSave} / ${editorSave}`);
    await ctx.close();
  }

  // ---------- Purchase: no Adjust/Transfer, audit trail readable ----------
  {
    const { ctx, page } = await login('Purchase');
    await nav(page, 'Stock Inventory');
    const adjust = await page.getByRole('button', { name: 'Adjust', exact: true }).count();
    const transfer = await page.getByRole('button', { name: 'Transfer', exact: true }).count();
    check('INV5-6 Purchase sees no Adjust / Transfer buttons', adjust === 0 && transfer === 0, `${adjust}/${transfer}`);
    await nav(page, 'Stock Audit Trail');
    const body = await page.locator('main').innerText();
    check('INV7-2 Purchase sees stock history in the Stock Audit Trail', !/No (audit )?entries|No stock adjustments/i.test(body) && /Opening Stock|Inter-branch Transfer|Sale/.test(body));
    await ctx.close();
  }

  // ---------- Billing: sidebar badge = Inventory "Low Stock" ----------
  for (const role of ['Billing', 'Purchase', 'CEO']) {
    const { ctx, page } = await login(role);
    await nav(page, 'Stock Inventory');
    const badgeEl = page.locator('aside [title*="low on stock"]').first();
    const badge = (await badgeEl.count()) ? Number((await badgeEl.textContent()).trim()) : 0;
    const card = Number((await page.locator('span', { hasText: /^Low Stock$/ }).first().locator('xpath=../..').locator('p').first().textContent()).trim());
    check(`INV2-10 ${role}: sidebar low-stock badge equals the Inventory Low Stock card`, badge === card, `${badge} vs ${card}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
if (failed) process.exit(1);
