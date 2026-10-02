// Browser smoke test: log in as each role and open every screen in the sidebar.
// Fails on uncaught page errors, the app's "Something went wrong" screen, or
// any API response with status >= 500.
//
//   QA_FRONTEND_URL=http://127.0.0.1:5108 QA_API_URL=http://127.0.0.1:4008 node qa/smoke/smoke.mjs
//
// Uses the preinstalled Playwright (QA_PLAYWRIGHT overrides the module path).
// Requests to any host other than the frontend and API are blocked.

import os from 'node:os';
import path from 'node:path';

const FRONTEND = (process.env.QA_FRONTEND_URL || 'http://127.0.0.1:5108').replace(/\/$/, '');
const API = (process.env.QA_API_URL || 'http://127.0.0.1:4008').replace(/\/$/, '');
const PW = process.env.QA_PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const HEADED = process.env.QA_HEADED === '1';
const SHOTS = process.env.QA_SHOTS || os.tmpdir();

let chromium;
try {
  ({ chromium } = await import(PW));
} catch {
  ({ chromium } = await import('playwright'));
}

const ROLES = [
  { role: 'CEO', pin: '1111' },
  { role: 'Manager', pin: '2222' },
  { role: 'Billing', pin: '3333' },
  { role: 'Sales', pin: '4444' },
  { role: 'Purchase', pin: '5555' },
];
const MODULE_IDS = ['dashboard', 'ai-assistant', 'sales', 'enquiries', 'parties', 'items', 'purchases', 'cash-bank', 'reports', 'staff', 'settings'];
const allowedHosts = new Set([new URL(FRONTEND).host, new URL(API).host]);

async function apiCall(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** HRM6-1: make sure a check-in without a location exists, so the Attendance screen is exercised with it. */
async function seedNullLocationCheckIn() {
  const login = await apiCall('POST', '/api/auth/login', null, { pin: '1111' });
  const token = login.body?.token;
  if (!token) throw new Error(`CEO login failed: ${login.status}`);
  for (const branchId of ['coimbatore', 'erode-hq']) {
    for (let i = 0; i < 10; i++) {
      const pin = String(1000 + Math.floor(Math.random() * 9000));
      const emp = await apiCall('POST', '/api/employees', token, {
        name: `QA Smoke No-Location ${branchId}`, designation: 'QA', branchId, monthlySalary: 10000, status: 'Active', joinedDate: '2026-01-01', pin,
      });
      if (emp.status === 409) continue;
      if (emp.status !== 200) throw new Error(`create employee: ${emp.status} ${JSON.stringify(emp.body)}`);
      const r = await apiCall('POST', '/api/hrm/clock-in', token, { employeeId: emp.body.employee.id });
      if (r.status !== 200) throw new Error(`clock-in without location: ${r.status}`);
      break;
    }
  }
}

/** Close any dialog a screen opened (e.g. Register History) so the sidebar is clickable again. */
async function closeDialogs(page) {
  await page.keyboard.press('Escape').catch(() => {});
  for (let i = 0; i < 3; i++) {
    const overlay = page.locator('div.fixed.inset-0:visible');
    if (!(await overlay.count())) return;
    const close = overlay.last().getByRole('button', { name: /^(close|cancel|×)$/i });
    if (await close.count()) await close.first().click({ timeout: 2000 }).catch(() => {});
    else await overlay.last().locator('button:has(svg.lucide-x)').first().click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
}

async function runRole(browser, { role, pin }) {
  const problems = [];
  const opened = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Kolkata', locale: 'en-IN' });
  await context.route('**/*', (route) => {
    const host = new URL(route.request().url()).host;
    return allowedHosts.has(host) ? route.continue() : route.abort();
  });
  await context.addInitScript((ids) => {
    try {
      // The sidebar's expanded state is stored per logged-in user
      // ("majestronicz_sidebar_expanded__u_<user>"), so answer every variant of the key.
      const expanded = JSON.stringify(Object.fromEntries(ids.map((m) => [m, true])));
      const get = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key) {
        return String(key).startsWith('majestronicz_sidebar_expanded') ? expanded : get.call(this, key);
      };
    } catch { /* ignore */ }
  }, MODULE_IDS);
  const page = await context.newPage();
  let where = 'login';
  page.on('pageerror', (err) => problems.push(`[${where}] page error: ${err.message}`));
  page.on('response', (res) => {
    if (res.url().startsWith(API) && res.status() >= 500) problems.push(`[${where}] ${res.status()} ${res.request().method()} ${res.url().slice(API.length)}`);
  });

  await page.goto(FRONTEND, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.keyboard.type(pin, { delay: 80 });
  await page.locator('aside').first().waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(2000);

  const errorScreen = async () => (await page.getByText('Something went wrong', { exact: true }).count()) > 0;

  // Every clickable screen entry in the sidebar: sub-items and single-item modules.
  // Module headers that only expand/collapse (they carry a chevron) are skipped.
  const labels = await page.$$eval('aside button', (buttons) => buttons
    .filter((b) => !b.querySelector('svg.lucide-chevron-down'))
    .map((b) => b.querySelector('span.truncate')?.textContent?.trim())
    .filter((t) => t && t.length > 1));
  const unique = [...new Set(labels)];

  for (const label of unique) {
    where = label;
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const btn = page.locator('aside button').filter({ has: page.locator('span.truncate', { hasText: new RegExp(`^${esc}$`) }) }).first();
    // Some screens (e.g. the billing screen) collapse the sidebar; open it again.
    const expand = page.getByRole('button', { name: 'Expand navigation menu' });
    if (await expand.isVisible().catch(() => false)) {
      await expand.click().catch(() => {});
      await page.waitForTimeout(400);
    }
    if (!(await btn.count())) { problems.push(`[${label}] sidebar entry disappeared`); continue; }
    try {
      await btn.click({ timeout: 8000 });
    } catch (e) {
      const shot = path.join(SHOTS, `${role}-${label.replace(/[^a-z0-9]+/gi, '_')}.png`);
      await page.screenshot({ path: shot }).catch(() => {});
      problems.push(`[${label}] could not click the sidebar entry (${e.message.split('\n')[0]}); screenshot ${shot}`);
      continue;
    }
    await page.waitForTimeout(900);
    if (await errorScreen()) {
      const msg = await page.locator('p.font-mono').first().textContent().catch(() => '');
      problems.push(`[${label}] error screen: ${msg || 'Something went wrong'}`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('aside').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1500);
      continue;
    }
    opened.push(label);
    await closeDialogs(page);
  }
  await context.close();
  return { role, opened, problems };
}

const browser = await chromium.launch({ headless: !HEADED });
let failed = 0;
try {
  await seedNullLocationCheckIn();
  const only = process.env.QA_ROLES ? process.env.QA_ROLES.split(',') : null;
  for (const r of ROLES.filter((x) => !only || only.includes(x.role))) {
    const result = await runRole(browser, r);
    const status = result.problems.length ? 'FAIL' : 'PASS';
    if (result.problems.length) failed++;
    console.log(`${status} ${result.role}: opened ${result.opened.length} screens (${result.opened.join(', ')})`);
    for (const p of result.problems) console.log(`   - ${p}`);
  }
} finally {
  await browser.close();
}
if (failed) {
  console.log(`\nSmoke test failed for ${failed} role(s).`);
  process.exit(1);
}
console.log('\nSmoke test passed for all roles.');
