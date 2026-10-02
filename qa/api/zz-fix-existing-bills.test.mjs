// The one-time data fix for bills made by older builds (backend/scripts/fix-existing-bills.ts).
// Runs last (zz-) because --apply touches every bill in the test database.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get, post, ok, near, sql, uid, freshDays, insertLegacyBill, randomPhone, getInvoice, createItem } from './lib.mjs';

const BACKEND = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend');
const hasDb = !!process.env.DATABASE_URL;

function runScript(...extra) {
  const out = mkdtempSync(join(tmpdir(), 'fixbills-'));
  execFileSync(join(BACKEND, 'node_modules', '.bin', 'tsx'), ['scripts/fix-existing-bills.ts', '--out', out, ...extra], {
    cwd: BACKEND, env: { ...process.env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const file = readdirSync(out).find((f) => f.endsWith('.json'));
  return JSON.parse(readFileSync(join(out, file), 'utf8'));
}

const q = (v) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
function insertReceipt({ bill, amount, applied = amount, at, date, partyId = bill.customerId, allocations }) {
  const id = `pay-legacy-${uid()}`;
  const allocs = allocations ?? [{ refId: bill.id, refNumber: bill.invoiceNumber, amount: applied }];
  sql(`INSERT INTO "Payment" ("id","receiptNumber","type","partyType","partyId","partyName","branchId","date","amount","paymentMode","allocations","createdAt")
    VALUES (${q(id)},${q(`RCPT-LEGACY-${uid()}`)},'in','customer',${q(partyId)},${q(bill.customerName)},${q(bill.branchId)},${q(date)},${amount},'Cash',
    ${allocs.length ? q(JSON.stringify(allocs)) : 'NULL'},${q(at)})`);
  return id;
}
async function newCustomer() {
  const phone = randomPhone();
  ok(await post('/api/catalog/customer', { name: `QA Legacy ${uid()}`, phone, address: 'QA' }));
  return ok(await get('/api/customers')).find((c) => c.phone === phone);
}
const customer = async (id) => ok(await get('/api/customers')).find((c) => c.id === id);

describe('one-time fix for existing bills', { skip: !hasDb && 'needs DATABASE_URL' }, () => {
  test('UPG8-2 dry run, apply, then a second run changes nothing — older bills end with the right dues', async () => {
    const [d1, d2, d3] = await freshDays('coimbatore', 3);
    // A: seed-bill 7308 after two receipts under the cf9b5b4 build — it rewrote
    // partialAmount 5,000 → 6,000 → 7,500 and showed ₹524 due (should be ₹1,524).
    const ca = await newCustomer();
    const a = insertLegacyBill({ branchId: 'coimbatore', date: d1, grand: 8024, partial: 7500, due: 524, customerId: ca.id, customerName: ca.name });
    insertReceipt({ bill: a, amount: 1000, date: d2, at: `${d2}T05:00:00.000Z` });
    insertReceipt({ bill: a, amount: 500, date: d3, at: `${d3}T05:00:00.000Z` });
    // B: same bill, second receipt of ₹2,024 that the old build capped at ₹1,024
    // and then showed as settled — the extra ₹1,000 really paid the bill.
    const cb = await newCustomer();
    const b = insertLegacyBill({ branchId: 'coimbatore', date: d1, grand: 8024, partial: null, due: 0, customerId: cb.id, customerName: cb.name });
    sql(`UPDATE "Invoice" SET "isPartialPayment"=false WHERE id=${q(b.id)}`);
    insertReceipt({ bill: b, amount: 1000, date: d2, at: `${d2}T05:00:00.000Z` });
    const capped = insertReceipt({ bill: b, amount: 2024, applied: 1024, date: d3, at: `${d3}T05:00:00.000Z` });
    // C: seed-bill 7311 shape — ₹5,000 paid on ₹8,024, one unit (₹4,012) returned,
    // no refund row: per the client the over-paid ₹988 went back in cash.
    const item = await createItem({ price: 3400, stock: {} });
    const cc = await newCustomer();
    const c = insertLegacyBill({
      branchId: 'coimbatore', date: d1, grand: 8024, mode: 'Cash', partial: 5000, due: 3024, customerId: cc.id, customerName: cc.name,
      items: [{ id: 'li-1', itemId: item.id, itemName: item.itemName, itemCode: item.itemCode, quantity: 2, unitPrice: 3400, taxRate: 18, taxableAmount: 6800, totalTax: 1224, totalAmount: 8024 }],
    });
    const returnedAt = `${d2}T20:30:00.000Z`; // 02:00 IST the next day
    sql(`UPDATE "Invoice" SET "returns"=${q(JSON.stringify([{ id: `ret-${uid()}`, itemId: item.id, itemName: item.itemName, itemCode: item.itemCode, returnedQuantity: 1, unitPrice: 3400, taxRate: 18, refundAmount: 4012, returnedAt, reason: 'QA', processedBy: 'QA' }]))}, "totalReturnedAmount"=4012 WHERE id=${q(c.id)}`);
    // D: an old "on account" receipt with no bill — held as store credit now.
    const cd = await newCustomer();
    insertReceipt({ bill: { id: 'none', invoiceNumber: '', customerName: cd.name, branchId: 'coimbatore' }, partyId: cd.id, amount: 300, date: d2, at: `${d2}T06:00:00.000Z`, allocations: [] });
    // E: stock whose history doesn't add up (as on a database never reseeded).
    const st = await createItem({ stock: { coimbatore: 4 } });
    sql(`UPDATE "BranchStock" SET quantity = quantity + 3 WHERE "itemId"=${q(st.id)} AND "branchId"='coimbatore'`);

    const before = { a: await getInvoice(a.id), c: await getInvoice(c.id) };
    const dry = runScript();
    assert.equal(dry.mode, 'dry-run');
    const row = (inv) => dry.bills.find((x) => x.invoiceId === inv.id);
    near(row(a).collectedAtBilling, 5000, 'A collected at billing');
    near(row(a).newDue, 1524, 'A due');
    near(row(b).collectedAtBilling, 5000, 'B collected at billing (from the capped receipt)');
    near(row(b).newDue, 0, 'B due');
    near(row(c).refundsBackfilled, 988, 'C refund of the over-paid part');
    near(row(c).newDue, 0, 'C due');
    const seed7308 = dry.bills.find((x) => x.invoiceNumber === 'MZCBE26-27/7308');
    if (seed7308) { near(seed7308.collectedAtBilling, 5000); near(seed7308.newDue, 3024); }
    // Nothing written by a dry run.
    near((await getInvoice(a.id)).partialAmount, before.a.partialAmount, 'dry run left A alone');
    assert.equal(sql(`SELECT count(*) FROM "Payment" WHERE "allocations"::text LIKE ${q(`%${c.id}%`)} AND type='out'`)[0][0], '0');

    const applied = runScript('--apply', '--i-have-a-backup');
    assert.equal(applied.mode, 'apply');
    const seeds = new Set(['MZERD26-27/7307', 'MZCBE26-27/7308', 'MZERD26-27/7309', 'MZERD26-27/7310', 'MZERD26-27/7311']);
    const touched = applied.bills.filter((x) => x.action !== 'no change' && !x.action.startsWith('skip'));
    assert.deepEqual(
      touched.filter((x) => !x.invoiceNumber.startsWith('LEGACY/') && !seeds.has(x.invoiceNumber)).map((x) => `${x.invoiceNumber}: ${x.action}`),
      [], 'bills made by this release are left exactly as they are',
    );
    assert.deepEqual(applied.bills.filter((x) => x.flags.some((f) => f.startsWith('REVIEW'))).map((x) => x.invoiceNumber), [], 'nothing needs a manual review');
    const A = await getInvoice(a.id);
    near(A.partialAmount, 5000, 'A part-payment restored');
    near(A.balanceDue, 1524);
    near(A.creditOriginal, 3024);
    assert.deepEqual(A.paymentSplits, [{ mode: 'Cash', amount: 5000 }, { mode: 'COD-Credit', amount: 3024 }]);
    const B = await getInvoice(b.id);
    near(B.balanceDue, 0);
    const cappedRow = sql(`SELECT allocations::text FROM "Payment" WHERE id=${q(capped)}`)[0][0];
    near(JSON.parse(cappedRow)[0].amount, 2024, 'capped receipt now applies all it took');
    near(Number((await customer(cb.id)).creditBalance) || 0, 0, 'no stray credit for B');
    const C = await getInvoice(c.id);
    near(C.balanceDue, 0);
    const refund = sql(`SELECT date, amount, "paymentMode" FROM "Payment" WHERE type='out' AND "allocations"::text LIKE ${q(`%${c.id}%`)}`);
    assert.equal(refund.length, 1);
    assert.equal(refund[0][0], addDayStr(d2), 'refund dated on the IST return day');
    near(refund[0][1], 988);
    assert.equal(refund[0][2], 'Cash');
    near((await customer(cd.id)).creditBalance, 300, 'on-account receipt held as store credit');
    const ledger = sql(`SELECT coalesce(sum("quantityChange"),0) FROM "StockAdjustmentLog" WHERE "itemId"=${q(st.id)} AND "branchId"='coimbatore'`)[0][0];
    near(ledger, 7, 'stock history adds up to the stock on hand');

    const again = runScript('--apply', '--i-have-a-backup');
    assert.equal(again.totals.billsChanged, 0, `second run changed ${again.totals.billsChanged} bill(s): ${again.bills.filter((x) => x.action !== 'no change' && !x.action.startsWith('skip')).map((x) => `${x.invoiceNumber} ${x.action}`).slice(0, 5).join(' | ')}`);
    assert.equal(again.totals.refundRowsCreated, 0);
    assert.equal(again.totals.storeCreditAdded, 0);
    assert.equal(again.totals.openingStockRowsAdded, 0);
    const marker = sql(`SELECT value::text FROM "AppConfig" WHERE key='migration:fix-existing-bills'`);
    assert.equal(JSON.parse(marker[0][0]).runs.length, 2, 'each apply is recorded');
  });

  test('UPG8-3 --apply without --i-have-a-backup is refused', () => {
    assert.throws(() => runScript('--apply'), /backup|exit|Command failed/i);
  });
});

function addDayStr(d) {
  return new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}
