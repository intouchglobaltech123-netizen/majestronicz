// Barcode sheet print check (INV4-4 / E2E6-12): prints each label preset to PDF
// through the real Barcode Generator screen and counts the pages. A full sheet
// is one page, one label more is two, nothing spills a row onto the next sheet
// or leaves a blank trailing page, and a thermal roll prints one page per label.
//
//   QA_FRONTEND_URL=http://127.0.0.1:5199 node qa/smoke/barcode-pages.mjs
//
// Needs the frontend + backend running (as for smoke.mjs) and the seeded data.
import fs from 'node:fs';
import os from 'node:os';

const PW = process.env.QA_PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const FE = (process.env.QA_FRONTEND_URL || 'http://127.0.0.1:5199').replace(/\/$/, '');
const OUT = process.env.QA_SHOTS || os.tmpdir();
const cases = [
  { preset: '38x21', labels: 65, pages: 1 },
  { preset: '38x21', labels: 73, pages: 2 },
  { preset: '38x21', labels: 130, pages: 2 },
  { preset: '38x21', labels: 11, pages: 1 },
  { preset: '63.5x38.1', labels: 21, pages: 1 },
  { preset: '63.5x38.1', labels: 22, pages: 2 },
  { preset: '50x25', labels: 40, pages: 1 },
  { preset: '100x50', labels: 10, pages: 1 },
  { preset: 'thermal-50x25', labels: 3, pages: 3 },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Kolkata' });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(FE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.keyboard.type('1111', { delay: 80 });
await page.locator('aside').first().waitFor({ state: 'visible', timeout: 20000 });
await page.waitForTimeout(1500);

const results = [];
for (const c of cases) {
  // Open Barcode Generator fresh (resets the queue).
  await page.goto(FE, { waitUntil: 'domcontentloaded' });
  await page.locator('aside').first().waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(800);
  const nav = page.locator('aside button', { hasText: 'Barcode Generator' }).first();
  if (!(await nav.isVisible().catch(() => false))) {
    await page.locator('aside button', { hasText: /^Items/ }).first().click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.locator('aside button', { hasText: 'Barcode Generator' }).first().click();
  await page.waitForTimeout(800);
  // Preset via settings.
  await page.locator('main button', { hasText: 'Settings' }).first().click().catch(async (e) => { await page.screenshot({ path: `${OUT}/dbg.png` }); throw e; });
  await page.waitForTimeout(300);
  if (!(await page.locator('form select').count())) { await page.screenshot({ path: `${OUT}/dbg.png` }); throw new Error('settings not open'); }
  await page.locator('form select').filter({ has: page.locator(`option[value="${c.preset}"]`) }).first().selectOption(c.preset);
  if (c.preset.startsWith('thermal')) {
    // Thermal printer type may be needed; try clicking a thermal option if present.
    await page.getByText(/thermal/i).first().click().catch(() => {});
    await page.locator('form select').filter({ has: page.locator(`option[value="${c.preset}"]`) }).first().selectOption(c.preset).catch(() => {});
  }
  await page.getByRole('button', { name: /save|apply/i }).last().click();
  await page.waitForTimeout(300);
  // Queue one item with N labels.
  const search = page.getByPlaceholder('Type to search items by name or code...');
  await search.fill('a');
  await page.waitForTimeout(500);
  await search.press('ArrowDown').catch(() => {});
  await search.press('Enter').catch(() => {});
  await page.waitForTimeout(300);
  const num = page.locator('input[type="number"][max="5000"]');
  await num.fill(String(c.labels));
  await page.locator('button[type="submit"]', { hasText: /Add/ }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /^Preview$/ }).first().click();
  await page.waitForTimeout(800);
  const summary = (await page.locator('[data-testid="barcode-sheet-summary"]').textContent().catch(() => '')) || '';
  await page.evaluate(() => document.body.classList.add('barcode-printing'));
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => document.body.classList.remove('barcode-printing'));
  const file = `${OUT}/barcode-${c.preset}-${c.labels}.pdf`;
  fs.writeFileSync(file, pdf);
  const n = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  results.push({ ...c, got: n, summary: summary.trim() });
  console.log(`${n === c.pages ? 'PASS' : 'FAIL'} ${c.preset} x${c.labels}: ${n} page(s), expected ${c.pages} — "${summary.trim()}"`);
}
await browser.close();
if (results.some((r) => r.got !== r.pages)) process.exit(1);
