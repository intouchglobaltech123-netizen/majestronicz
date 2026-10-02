// Shared helpers for the API regression tests.
// Uses only Node built-ins (fetch, node:test, node:assert, node:crypto, node:child_process).

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { afterEach } from 'node:test';

export const API = (process.env.QA_API_URL || 'http://127.0.0.1:4008').replace(/\/$/, '');

// Seed PINs (see backend/src/lib/auth.ts ROLE_DEFS).
export const PINS = { CEO: '1111', Manager: '2222', Billing: '3333', Sales: '4444', Purchase: '5555' };
// Branch each seeded login is locked to.
export const HOME = { Manager: 'coimbatore', Billing: 'erode-hq', Sales: 'erode-hq', Purchase: 'erode-hq' };
export const BRANCHES = ['erode-hq', 'coimbatore', 'chennai'];

const tokens = new Map();

/** Log in with a PIN and return the token. Tokens are cached per PIN. */
export async function loginPin(pin) {
  if (tokens.has(pin)) return tokens.get(pin);
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.token) throw new Error(`Login with PIN ${pin} failed: ${res.status} ${JSON.stringify(body)}`);
  tokens.set(pin, body.token);
  return body.token;
}

export const login = (role) => loginPin(PINS[role]);

/**
 * Call the API. `as` is a role name ("CEO"), a raw token ({ token }), or null for
 * no token. Returns { status, body, headers }. Never throws on HTTP errors.
 */
export async function api(method, path, { as = 'CEO', body, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (as && typeof as === 'object' && as.token) h.Authorization = `Bearer ${as.token}`;
  else if (typeof as === 'string') h.Authorization = `Bearer ${await login(as)}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  if (method === 'POST' && path === '/api/cash/close' && res.status === 200 && body?.branchId && body?.date) {
    closedByTest.push({ branchId: body.branchId, date: body.date });
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

// CASH10-1: a closed day locks every earlier day of its branch, so a day a test
// closed is reopened after that test — later tests use random earlier dates.
const closedByTest = [];
afterEach(async () => {
  while (closedByTest.length) {
    const d = closedByTest.pop();
    await api('POST', '/api/cash/reopen', { as: 'CEO', body: d });
  }
});

export const get = (path, as = 'CEO') => api('GET', path, { as });
export const post = (path, body, as = 'CEO') => api('POST', path, { as, body });
export const put = (path, body, as = 'CEO') => api('PUT', path, { as, body });
export const del = (path, as = 'CEO') => api('DELETE', path, { as });

/** Assert an HTTP status, showing the response body when it does not match. */
export function expectStatus(res, expected, what = '') {
  const list = Array.isArray(expected) ? expected : [expected];
  const b = res.body;
  const detail = b && typeof b === 'object' && (b.error || b.message)
    ? `${b.error || ''} ${b.message || ''}`.trim()
    : JSON.stringify(b).slice(0, 160);
  assert.ok(
    list.includes(res.status),
    `${what ? what + ': ' : ''}expected HTTP ${list.join(' or ')}, got ${res.status} (${detail})`,
  );
  return res;
}

/** Assert success and return the body. */
export function ok(res, what = '') {
  expectStatus(res, 200, what);
  return res.body;
}

export const uid = () => `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
export const r2 = (n) => Math.round(n * 100) / 100;
export const near = (a, b, what = '', eps = 0.011) =>
  assert.ok(Math.abs(Number(a) - Number(b)) <= eps, `${what ? what + ': ' : ''}expected ${b}, got ${a}`);

export function randomPhone() {
  return `9${String(crypto.randomInt(0, 1e9)).padStart(9, '0')}`;
}

// ---------------------------------------------------------------- dates

const DAY = 86400000;
export const isoDay = (d) => new Date(d).toISOString().slice(0, 10);
export const addDays = (date, n) => isoDay(Date.parse(`${date}T00:00:00Z`) + n * DAY);
/** Server "today": the shop's cash day is the India (IST) calendar day. */
export const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
/** Kept for older tests: the server now dates money on the IST day, not UTC. */
export const utcToday = istToday;

/**
 * CASH10-1: money can't be booked on or before a branch's latest CLOSED cash
 * day. The demo data (and earlier test files) leave closed days behind, which
 * would lock every random past test date, so each test process first reopens
 * the closed days left over. Tests that close a day reopen it when done.
 */
let reopened = null;
export function reopenClosedDays() {
  reopened ||= (async () => {
    const regs = ok(await get('/api/cash-registers'), 'list registers');
    for (const r of regs.filter((x) => x.isClosed)) {
      ok(await post('/api/cash/reopen', { branchId: r.branchId, date: r.date }), `reopen ${r.branchId} ${r.date}`);
    }
  })();
  return reopened;
}

/**
 * A random past date (2016-2024) with no cash register for `branchId` on that
 * day or the following `span - 1` days, so each test gets its own clean days.
 */
export async function freshDays(branchId, span = 1) {
  await reopenClosedDays();
  const regs = ok(await get('/api/cash-registers'), 'list registers');
  const used = new Set(regs.filter((r) => r.branchId === branchId).map((r) => r.date));
  const start = Date.parse('2016-01-01T00:00:00Z');
  for (let i = 0; i < 200; i++) {
    const d0 = isoDay(start + crypto.randomInt(0, 3200) * DAY);
    const days = Array.from({ length: span }, (_, k) => addDays(d0, k));
    if (days.every((d) => !used.has(d))) return days;
  }
  throw new Error('could not find free test dates');
}
export const freshDay = async (branchId) => (await freshDays(branchId, 1))[0];
/** RPT10-4: a bill can only be voided or deleted in its own month, so tests that
 *  void/delete date their bills TODAY (IST). */
export const thisMonthDay = async () => { await reopenClosedDays(); return istToday(); };

// ---------------------------------------------------------------- items & stock

/** Create a catalogue item with opening stock per branch. Returns the item row. */
export async function createItem({ price = 1000, gst = 18, purchasePrice = 600, stock = {}, name, as = 'CEO', marginCategory, unit = 'PCS', extra = {} } = {}) {
  const code = `QA-${uid()}`.toUpperCase();
  const item = {
    itemName: name || `QA item ${code}`,
    itemHSN: '85371000',
    category: 'QA',
    itemCode: code,
    unit,
    salePrice: price,
    salePriceTaxMode: 'exclusive',
    wholesalePrice: price,
    minWholesaleQty: 10,
    purchasePrice,
    gstTaxSlab: gst,
    ...(marginCategory ? { marginCategory } : {}),
    ...extra,
  };
  const res = await post('/api/catalog/item', { item, initialStocks: stock }, as);
  const body = ok(res, 'create item');
  return body.item;
}

export async function stockOf(itemId, branchId) {
  const rows = ok(await get('/api/branch-stock'), 'branch stock');
  const row = rows.find((r) => r.itemId === itemId && r.branchId === branchId);
  return row ? row.quantity : 0;
}

export async function ledgerOf(itemId, branchId) {
  const rows = ok(await get('/api/stock-adjustments'), 'stock ledger');
  return rows.filter((r) => r.itemId === itemId && (!branchId || r.branchId === branchId));
}

/** Create a combo of [{ item, qty }] components. Returns the combo row. */
export async function createCombo(parts, price = 5000) {
  const id = `combo-qa-${uid()}`;
  const body = ok(await post('/api/catalog/combo', {
    id,
    comboName: `QA combo ${id}`,
    comboPrice: price,
    components: parts.map((p) => ({ itemId: p.item.id, quantity: p.qty })),
  }), 'create combo');
  return body.combos.find((c) => c.id === id);
}

// ---------------------------------------------------------------- sales

/** A bill line for a catalogue item. */
export function line(item, quantity, { price, taxRate, discountValue = 0, discountType = '%' } = {}) {
  return {
    id: `li-${uid()}`,
    itemId: item.id,
    itemName: item.itemName,
    itemCode: item.itemCode,
    itemHSN: item.itemHSN,
    unit: item.unit,
    quantity,
    unitPrice: price ?? item.salePrice,
    taxRate: taxRate ?? item.gstTaxSlab,
    discountType,
    discountValue,
  };
}

/** A typed (non-catalogue) line: no stock is involved. */
export function serviceLine(quantity, unitPrice, taxRate = 18, extra = {}) {
  return {
    id: `li-${uid()}`, itemId: '', itemName: 'QA service charge', itemCode: '', itemHSN: '998719', unit: 'NOS',
    quantity, unitPrice, taxRate, discountType: '%', discountValue: 0, ...extra,
  };
}

/** A combo line as the billing screen builds it. */
export function comboLine(combo, quantity, components = combo.components) {
  return {
    id: `li-${uid()}`, itemId: combo.id, itemCode: combo.comboCode, itemName: combo.comboName, itemHSN: '85371000',
    unit: 'SET', quantity, unitPrice: combo.comboPrice, taxRate: 18, discountType: '%', discountValue: 0,
    isCombo: true, comboId: combo.id, comboComponents: components,
  };
}

/**
 * Build a sale payload like InvoiceForm sends. `splits` is the payment split
 * list, e.g. [{ mode: 'Cash', amount: 1180 }]. When omitted the bill is one
 * Cash split for whatever the server computes (single-split bills are
 * normalised to the grand total server-side).
 */
export function saleBody({
  branchId = 'erode-hq', date, lines, splits, transactionType = 'Cash', customerName = 'QA Walk-in',
  customerPhone = '', overallDiscountValue = 0, overallDiscountType = '%', shippingCharges = 0,
  roundOffEnabled = false, stateOfSupply = '33-Tamil Nadu', sourceEstimateId, sourceEstimateNumber, id,
} = {}) {
  const body = {
    id: id || `inv-qa-${uid()}`,
    invoiceNumber: 'DRAFT',
    branchId,
    transactionType,
    customerName,
    customerPhone,
    customerAddress: '',
    date,
    time: '11:00',
    paymentTerms: 'Due on Receipt',
    dueDate: date,
    stateOfSupply,
    withGst: true,
    items: lines,
    overallDiscountType,
    overallDiscountValue,
    shippingCharges,
    roundOffEnabled,
    termsAndConditions: 'QA',
    paymentMode: splits?.[0]?.mode || 'Cash',
    paymentSplits: splits || [{ mode: 'Cash', amount: 0 }],
    createdAt: new Date().toISOString(),
  };
  if (sourceEstimateId) {
    body.sourceEstimateId = sourceEstimateId;
    body.sourceEstimateNumber = sourceEstimateNumber || null;
  }
  return body;
}

/** POST /api/tx/sale and return { res, inv } (inv = saved invoice when 200). */
export async function sell(body, as = 'CEO') {
  const res = await post('/api/tx/sale', body, as);
  return { res, inv: res.status === 200 ? res.body.savedInvoice : null };
}

/** Create a sale and require success. */
export async function mustSell(body, as = 'CEO') {
  const { res, inv } = await sell(body, as);
  ok(res, 'create sale');
  return inv;
}

export async function getInvoice(id) {
  return ok(await get(`/api/invoices/${encodeURIComponent(id)}`), 'get invoice');
}

/** Re-save an existing bill (the edit path), starting from its stored row. */
export async function resave(inv, changes = {}, as = 'CEO') {
  const editable = [
    'id', 'invoiceNumber', 'branchId', 'transactionType', 'customerId', 'customerName', 'customerPhone',
    'customerAddress', 'date', 'time', 'paymentTerms', 'dueDate', 'stateOfSupply', 'withGst', 'items',
    'overallDiscountType', 'overallDiscountValue', 'shippingCharges', 'roundOffEnabled', 'termsAndConditions',
    'paymentMode', 'paymentSplits', 'isPartialPayment', 'partialAmount', 'balanceDue', 'createdAt',
  ];
  const body = {};
  for (const k of editable) if (inv[k] !== undefined && inv[k] !== null) body[k] = inv[k];
  Object.assign(body, changes);
  return post('/api/tx/sale', body, as);
}

export const returnLine = (item, returnQty, price) => ({
  itemId: item.id, itemCode: item.itemCode, itemName: item.itemName, returnQty,
  unitPrice: price ?? item.salePrice, taxRate: item.gstTaxSlab,
});

export async function receive(invoice, amount, { as = 'CEO', mode = 'Cash', date, branchId } = {}) {
  return post('/api/payments', {
    type: 'in', partyType: 'customer', partyId: invoice.customerId || undefined, partyName: invoice.customerName,
    branchId: branchId || invoice.branchId, date: date || invoice.date, amount, paymentMode: mode,
    allocations: [{ refId: invoice.id, refNumber: invoice.invoiceNumber, amount }],
  }, as);
}

export async function paymentsFor(refId) {
  const rows = ok(await get('/api/payments'), 'payments');
  return rows.filter((p) => Array.isArray(p.allocations) && p.allocations.some((a) => a.refId === refId));
}

// ---------------------------------------------------------------- purchases

export async function anyVendor() {
  const vendors = ok(await get('/api/vendors'), 'vendors');
  return vendors[0];
}

/** Create a PO (status Ordered) for [{ item, qty, price, tax }]. Returns the saved PO. */
export async function createPO(lines, { branchId = 'erode-hq', as = 'CEO', vendor, extra = {} } = {}) {
  const v = vendor || (await anyVendor());
  const po = {
    vendorId: v.id, vendorName: v.vendorName, branchId, date: '2026-09-15', expectedDeliveryDate: '2026-09-30',
    items: lines.map((l) => ({
      itemId: l.item.id, itemName: l.item.itemName, itemCode: l.item.itemCode,
      quantityOrdered: l.qty, receivedQuantity: 0, purchasePrice: l.price ?? l.item.purchasePrice, taxPercent: l.tax ?? 0,
    })),
    totalAmount: 0,
    notes: 'QA',
    ...extra,
  };
  const res = await post('/api/purchase/save', { po, actor: 'QA' }, as);
  return ok(res, 'create PO').saved;
}

export async function getPO(id) {
  return ok(await get(`/api/purchase-orders/${encodeURIComponent(id)}`), 'get PO');
}

// ---------------------------------------------------------------- cash

export async function register(branchId, date) {
  const regs = ok(await get('/api/cash-registers'), 'registers');
  return regs.find((r) => r.branchId === branchId && r.date === date) || null;
}

// ---------------------------------------------------------------- tokens

/** Sign a token payload with a given secret the same way the server does. */
export function signToken(payload, secret) {
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(p).digest('base64url');
  return `${p}.${sig}`;
}

// ---------------------------------------------------------------- staff accounts

/** Create a throwaway staff login (CEO only). Returns { user, pin }. */
export async function createStaff(role, branchId) {
  for (let i = 0; i < 20; i++) {
    const pin = String(crypto.randomInt(1000, 10000));
    if (Object.values(PINS).includes(pin)) continue;
    const res = await post('/api/users', { name: `QA ${role} ${uid()}`, role, pin, assignedBranchId: branchId });
    if (res.status === 409) continue;
    return { user: ok(res, 'create staff'), pin };
  }
  throw new Error('could not create staff account');
}

// ---------------------------------------------------------------- SQL (optional)

/** Run SQL through psql when DATABASE_URL is set; returns rows as arrays of strings, or null. */
export function sql(query) {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const out = execFileSync('psql', [url, '-At', '-F', '\t', '-c', query], { encoding: 'utf8' });
  return out.trim() ? out.trim().split('\n').map((l) => l.split('\t')) : [];
}

/** Fire `n` copies of an async call at the same moment. */
export async function together(n, fn) {
  return Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
}

// ---------------------------------------------------------------- legacy data (SQL)

const q = (v) => (v == null ? 'NULL' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

/** Insert a bill the way OLD builds stored it (no payment split, legacy partial
 *  fields), straight into the database — the API can no longer create one. */
export function insertLegacyBill({ branchId, date, grand, mode = 'COD-Credit', partial = null, due = null, customerId = null, customerName = 'QA legacy customer', items = [] }) {
  const id = `inv-legacy-${uid()}`;
  const number = `LEGACY/${uid()}`;
  sql(`INSERT INTO "Invoice" ("id","invoiceNumber","branchId","transactionType","customerId","customerName","date","time","paymentTerms","dueDate",
    "stateOfSupply","withGst","items","subtotal","totalTax","totalCgst","totalSgst","overallDiscountType","overallDiscountValue","overallDiscountAmount",
    "shippingCharges","roundOff","roundOffEnabled","grandTotal","amountInWords","termsAndConditions","paymentMode","isPartialPayment","partialAmount",
    "balanceDue","createdAt") VALUES (${q(id)},${q(number)},${q(branchId)},'Credit',${q(customerId)},${q(customerName)},${q(date)},'10:00','Due on Receipt',${q(date)},
    '33-Tamil Nadu',true,${q(JSON.stringify(items))},${grand},0,0,0,'%',0,0,0,0,false,${grand},'QA','QA',${q(mode)},${partial ? 'true' : 'false'},${q(partial)},
    ${q(due)},${q(`${date}T04:30:00.000Z`)})`);
  return { id, invoiceNumber: number, branchId, date, customerId, customerName };
}

