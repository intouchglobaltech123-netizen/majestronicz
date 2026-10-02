// The one-time data fix for bills made by older builds (backend/scripts/fix-existing-bills.ts).
// Runs last (zz-) because --apply touches every bill in the test database.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get, post, ok, near, sql, uid, freshDays, insertLegacyBill, randomPhone, getInvoice, createItem, createPO, line, saleBody, mustSell, istToday, expectStatus } from './lib.mjs';

const BACKEND = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend');
const hasDb = !!process.env.DATABASE_URL;

function runScript(...extra) {
  const out = mkdtempSync(join(tmpdir(), 'fixbills-'));
  let stdout = '';
  let status = 0;
  try {
    stdout = execFileSync(join(BACKEND, 'node_modules', '.bin', 'tsx'), ['scripts/fix-existing-bills.ts', '--out', out, ...extra], {
      cwd: BACKEND, env: { ...process.env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    // --check exits 3 when something needs a decision; anything else is a failure.
    if (e.status !== 3 || !extra.includes('--check')) throw e;
    stdout = e.stdout;
    status = e.status;
  }
  const file = readdirSync(out).find((f) => f.endsWith('.json'));
  return { ...JSON.parse(readFileSync(join(out, file), 'utf8')), stdout, status };
}

const q = (v) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
/** Every build since the audit trail began logged each receipt and return. */
function insertAudit(action, entityId, at) {
  const t = new Date(Date.parse(at) + 300).toISOString();
  sql(`INSERT INTO "AuditLog" ("id","timestamp","actor","action","entity","entityId","summary") VALUES (${q(`aud-legacy-${uid()}`)},${q(t)},'QA',${q(action)},'x',${q(entityId)},'QA legacy')`);
}
function insertReceipt({ bill, amount, applied = amount, at, date, partyId = bill.customerId, allocations, audited = true }) {
  const id = `pay-legacy-${uid()}`;
  const allocs = allocations ?? [{ refId: bill.id, refNumber: bill.invoiceNumber, amount: applied }];
  sql(`INSERT INTO "Payment" ("id","receiptNumber","type","partyType","partyId","partyName","branchId","date","amount","paymentMode","allocations","createdAt")
    VALUES (${q(id)},${q(`RCPT-LEGACY-${uid()}`)},'in','customer',${q(partyId)},${q(bill.customerName)},${q(bill.branchId)},${q(date)},${amount},'Cash',
    ${allocs.length ? q(JSON.stringify(allocs)) : 'NULL'},${q(at)})`);
  if (audited) insertAudit('payment.record', id, at);
  return id;
}
/** A refund row as an older build booked it: stamped with the return's own time. */
function insertRefundRow({ bill, amount, at, mode = 'Cash' }) {
  const id = `pay-legacy-out-${uid()}`;
  sql(`INSERT INTO "Payment" ("id","receiptNumber","type","partyType","partyId","partyName","branchId","date","amount","paymentMode","allocations","createdAt")
    VALUES (${q(id)},${q(`PAY-LEGACY-${uid()}`)},'out','customer',${q(bill.customerId)},${q(bill.customerName)},${q(bill.branchId)},${q(at.slice(0, 10))},${amount},${q(mode)},
    ${q(JSON.stringify([{ refId: bill.id, refNumber: bill.invoiceNumber, amount }]))},${q(at)})`);
  return id;
}
/** Older returns on a bill (one batch per entry), with or without an audit row. */
function setReturns(bill, item, batches) {
  const recs = batches.map((b) => ({ id: `ret-${uid()}`, itemId: item.id, itemName: item.itemName, itemCode: item.itemCode, returnedQuantity: b.qty ?? 1, unitPrice: 3400, taxRate: 18, refundAmount: b.value, returnedAt: b.at, reason: 'QA', processedBy: 'QA' }));
  sql(`UPDATE "Invoice" SET "returns"=${q(JSON.stringify(recs))}, "totalReturnedAmount"=${batches.reduce((t, b) => t + b.value, 0)} WHERE id=${q(bill.id)}`);
  for (const b of batches) if (b.audited) insertAudit('sale.return', bill.id, b.at);
}
const smpsLines = (item) => [{ id: 'li-1', itemId: item.id, itemName: item.itemName, itemCode: item.itemCode, quantity: 2, unitPrice: 3400, taxRate: 18, taxableAmount: 6800, totalTax: 1224, totalAmount: 8024 }];
const outRows = (bill) => sql(`SELECT id, amount, date, "paymentMode" FROM "Payment" WHERE type='out' AND "allocations"::text LIKE ${q(`%${bill.id}%`)} ORDER BY date, id`);
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
    const item = await createItem({ price: 3400, stock: { coimbatore: 1 } });
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

    // F: a salary marked Paid by an older build — no Payment 'out' row. Paid at
    // 20:00 UTC = 01:30 IST the next day, by bank transfer.
    let emp;
    for (let i = 0; !emp && i < 20; i++) {
      const res = await post('/api/employees', { name: `QA Legacy Staff ${uid()}`, designation: 'QA', branchId: 'coimbatore', monthlySalary: 15000, status: 'Active', joinedDate: '2026-01-01', pin: String(1000 + Math.floor(Math.random() * 9000)) });
      if (res.status !== 409) emp = ok(res, 'create employee').employee;
    }
    const payId = `pay-legacy-${uid()}`;
    sql(`INSERT INTO "PayrollRecord" ("id","employeeId","employeeName","designation","branchId","month","monthlySalary","standardHoursPerMonth","hourlyRate",
      "totalDaysPresent","totalHoursWorked","computedPay","manualAdjustment","finalPayable","status","paidAt","paymentMode","paymentReference","updatedAt")
      VALUES (${q(payId)},${q(emp.id)},${q(emp.name)},'QA','coimbatore','2025-05',15000,208,72.12,26,208,15000,0,14750,'Paid',${q(`${d1}T20:00:00.000Z`)},'Bank Transfer','UTR-QA',${q(`${d1}T20:00:00.000Z`)})`);

    // SAL9-8: before the one-time fix has run, an older return with no refund
    // recorded can't be reversed (its cash refund isn't on the books yet).
    sql(`DELETE FROM "AppConfig" WHERE key='migration:fix-existing-bills'`);
    const early = await post('/api/tx/reverse-return', { invoiceId: c.id, returnId: (await getInvoice(c.id)).returns[0].id });
    expectStatus(early, 409, 'reverse an older return before the fix');
    assert.equal(early.body.error, 'MIGRATION_PENDING');

    const before = { a: await getInvoice(a.id), c: await getInvoice(c.id) };
    const dry = runScript();
    assert.ok(dry.salaries.some((x) => x.payroll === payId), 'dry run lists the legacy salary');
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
    assert.equal(sql(`SELECT count(*) FROM "Payment" WHERE "allocations"::text LIKE ${q(`%${payId}%`)}`)[0][0], '0', 'no salary row on a dry run');

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

    const salary = sql(`SELECT date, amount, "paymentMode", "branchId", "partyType", notes FROM "Payment" WHERE type='out' AND "allocations"::text LIKE ${q(`%${payId}%`)}`);
    assert.equal(salary.length, 1, 'one salary payment backfilled');
    assert.equal(salary[0][0], addDayStr(d1), 'dated on the IST day it was paid');
    near(salary[0][1], 14750);
    assert.equal(salary[0][2], 'Bank Transfer', 'mode from the payroll row');
    assert.equal(salary[0][3], 'coimbatore');
    assert.equal(salary[0][4], 'staff');
    assert.match(salary[0][5], /backfilled/);

    const again = runScript('--apply', '--i-have-a-backup');
    assert.equal(again.totals.salaryPaymentsBackfilled, 0, 'salary rows are added once');
    assert.equal(again.totals.billsChanged, 0, `second run changed ${again.totals.billsChanged} bill(s): ${again.bills.filter((x) => x.action !== 'no change' && !x.action.startsWith('skip')).map((x) => `${x.invoiceNumber} ${x.action}`).slice(0, 5).join(' | ')}`);
    assert.equal(again.totals.refundRowsCreated, 0);
    assert.equal(again.totals.storeCreditAdded, 0);
    assert.equal(again.totals.openingStockRowsAdded, 0);
    const marker = sql(`SELECT value::text FROM "AppConfig" WHERE key='migration:fix-existing-bills'`);
    assert.equal(JSON.parse(marker[0][0]).runs.length, 2, 'each apply is recorded');

    // UPG9-10: after the fix, reversing that older return finds the refund it backfilled.
    const rev = ok(await post('/api/tx/reverse-return', { invoiceId: c.id, returnId: (await getInvoice(c.id)).returns[0].id }), 'reverse the older return');
    assert.equal(rev.reversed.refund?.kind, 'deleted', 'the backfilled refund (an open day) is taken off');
    near(rev.reversed.refund.amount, 988);
    assert.equal(outRows(c).length, 0, 'no refund left on the bill');
    near((await getInvoice(c.id)).balanceDue, 3024, 'back to owing what was not paid at billing');
  });

  test('UPG9-1..4 older Adjust rows, returns and receipts by older builds: one credit, exact replays, per-batch refunds, REVIEW leaves a bill alone', async () => {
    const [d1, d2, d3] = await freshDays('erode-hq', 3);
    const item = await createItem({ price: 3400, stock: {} });
    const at = (d, hh = '06') => `${d}T${hh}:00:00.000Z`;

    // F (UPG9-1): cf9b5b4 booked an 'Adjust to credit note' return as a refund ROW.
    const cf = await newCustomer();
    const f = insertLegacyBill({ branchId: 'erode-hq', date: d1, grand: 8732, mode: 'Cash', partial: null, due: 0, customerId: cf.id, customerName: cf.name });
    sql(`UPDATE "Invoice" SET "paymentSplits"='[{"mode":"Cash","amount":8732}]' WHERE id=${q(f.id)}`);
    setReturns(f, item, [{ value: 2183, at: at(d2), audited: true }]);
    const adjustRow = insertRefundRow({ bill: f, amount: 2183, at: at(d2), mode: 'Adjust to credit note' });

    // G (UPG9-3a): 403d331 returned one unit of an untouched go-live bill
    // (5,000 paid on 8,024): it anchored creditOriginal 3,024, rewrote the part
    // payment away and refunded the over-paid 988.
    const cg = await newCustomer();
    const g = insertLegacyBill({ branchId: 'erode-hq', date: d1, grand: 8024, partial: null, due: 0, customerId: cg.id, customerName: cg.name, items: smpsLines(item) });
    sql(`UPDATE "Invoice" SET "creditOriginal"=3024 WHERE id=${q(g.id)}`);
    setReturns(g, item, [{ value: 4012, at: at(d2), audited: true }]);
    insertRefundRow({ bill: g, amount: 988, at: at(d2) });

    // H (UPG9-2 / UPG9-3b): the 7311 shape — 5,000 paid, one unit returned before
    // refunds were recorded — then 403d331 took a receipt at the stale due of
    // 3,024 (anchoring creditOriginal 7,036).
    const ch = await newCustomer();
    const h = insertLegacyBill({ branchId: 'erode-hq', date: d1, grand: 8024, mode: 'Cash', partial: null, due: 0, customerId: ch.id, customerName: ch.name, items: smpsLines(item) });
    sql(`UPDATE "Invoice" SET "creditOriginal"=7036 WHERE id=${q(h.id)}`);
    setReturns(h, item, [{ value: 4012, at: at(d1, '12'), audited: false }]);
    insertReceipt({ bill: h, amount: 3024, date: d2, at: at(d2, '07') });

    // I (UPG9-4): a paid-in-full bill with two older returns, neither refunded on record.
    const ci = await newCustomer();
    const i = insertLegacyBill({ branchId: 'erode-hq', date: d1, grand: 8024, mode: 'Cash', partial: null, due: 0, customerId: ci.id, customerName: ci.name, items: smpsLines(item) });
    setReturns(i, item, [{ value: 4012, at: at(d2, '08') }, { value: 4012, at: at(d3, '08') }]);

    // J: the history can't tell what was collected (the 7311 shape after
    // cf9b5b4 refunded the second unit in full) -> REVIEW, untouched.
    const cj = await newCustomer();
    const j = insertLegacyBill({ branchId: 'erode-hq', date: d1, grand: 8024, mode: 'Cash', partial: null, due: 0, customerId: cj.id, customerName: cj.name, items: smpsLines(item) });
    setReturns(j, item, [{ value: 4012, at: at(d1, '12') }, { value: 4012, at: at(d2, '09'), audited: true }]);
    insertRefundRow({ bill: j, amount: 4012, at: at(d2, '09') });

    // K: an older build refunded 1,947 on a bill that had collected only 1,000 -> REVIEW.
    const ck = await newCustomer();
    const k = insertLegacyBill({ branchId: 'erode-hq', date: d1, grand: 3894, mode: 'Cash', partial: 1000, due: 2894, customerId: ck.id, customerName: ck.name });
    sql(`UPDATE "Invoice" SET "paymentSplits"='[{"mode":"Cash","amount":1000},{"mode":"COD-Credit","amount":2894}]' WHERE id=${q(k.id)}`);
    setReturns(k, item, [{ value: 1947, at: at(d2, '10'), audited: true }]);
    insertRefundRow({ bill: k, amount: 1947, at: at(d2, '10') });
    const untouched = { j: await getInvoice(j.id), k: await getInvoice(k.id) };

    // E2E5-5: lines without a sale-time cost. One bill on the day a purchase was
    // received (costed at that receipt's price), one long before (current cost).
    const costed = await createItem({ price: 900, purchasePrice: 500, stock: {} });
    const po = await createPO([{ item: costed, qty: 4, price: 550 }]);
    ok(await post('/api/purchase/receive', { poId: po.id, receipts: [{ itemId: costed.id, quantityReceived: 4 }], actor: 'QA' }), 'receive');
    sql(`UPDATE "Item" SET "purchasePrice"=700 WHERE id=${q(costed.id)}`);
    const costLine = [{ id: 'li-c', itemId: costed.id, itemName: costed.itemName, itemCode: costed.itemCode, quantity: 1, unitPrice: 900, taxRate: 18, taxableAmount: 900, totalTax: 162, totalAmount: 1062 }];
    const today = insertLegacyBill({ branchId: 'erode-hq', date: istToday(), grand: 1062, mode: 'Cash', items: costLine });
    const old = insertLegacyBill({ branchId: 'erode-hq', date: d1, grand: 1062, mode: 'Cash', items: costLine });

    // UPG9-9 / SAL9-14: employee status saved by older builds; quotations with no status.
    const empA = `emp-legacy-${uid()}`, empD = `emp-legacy-${uid()}`;
    for (const [id, st] of [[empA, 'active'], [empD, 'disabled']]) {
      sql(`INSERT INTO "Employee" ("id","name","designation","branchId","monthlySalary","pin","status","joinedDate","createdAt","updatedAt") VALUES (${q(id)},${q(`QA Legacy ${st}`)},'QA','erode-hq',10000,'0000',${q(st)},'2026-01-01','2026-01-01','2026-01-01')`);
    }
    const quote = async () => {
      const id = `est-qa-${uid()}`;
      ok(await post('/api/catalog/estimate', { id, branchId: 'erode-hq', date: d1, time: '10:00', customerName: 'QA Quote', withGst: true, termsAndConditions: 'QA',
        items: [{ id: `li-${uid()}`, itemId: costed.id, itemName: costed.itemName, itemCode: costed.itemCode, itemHSN: '85371000', unit: 'PCS', quantity: 1, unitPrice: 900, gstRate: 18 }] }), 'quote');
      return id;
    };
    const qOpen = await quote(), qConv = await quote();
    const stocked = await createItem({ price: 900, stock: { 'erode-hq': 2 } });
    await mustSell(saleBody({ date: d1, lines: [line(stocked, 1)], sourceEstimateId: qConv }));
    sql(`UPDATE "Estimate" SET status=NULL WHERE id IN (${q(qOpen)},${q(qConv)})`);

    // --check names what needs a person and exits 3.
    const check = runScript('--check');
    assert.equal(check.status, 3, '--check exits 3 when a decision is needed');
    assert.match(check.stdout, new RegExp(j.invoiceNumber.replace(/\//g, '\\/')), '--check lists the ambiguous bill');
    assert.match(check.stdout, new RegExp(k.invoiceNumber.replace(/\//g, '\\/')), '--check lists the over-refunded bill');
    const row = (rep, bill) => rep.bills.find((x) => x.invoiceId === bill.id);
    assert.equal(row(check, j).action, 'no change (REVIEW)');
    assert.equal(row(check, k).action, 'no change (REVIEW)');

    // Apply WITHOUT overrides: J and K are left exactly as they are.
    const first = runScript('--apply', '--i-have-a-backup');
    for (const [key, bill] of [['j', j], ['k', k]]) {
      const now = await getInvoice(bill.id);
      for (const f2 of ['balanceDue', 'creditOriginal', 'partialAmount', 'isPartialPayment', 'paymentSplits']) {
        assert.deepEqual(now[f2] ?? null, untouched[key][f2] ?? null, `${key} ${f2} untouched while under REVIEW`);
      }
    }
    // F: one store-credit entry for the old Adjust row, which is gone.
    near((await customer(cf.id)).creditBalance, 2183, 'F credit note once');
    assert.equal(sql(`SELECT count(*) FROM "Payment" WHERE id=${q(adjustRow)}`)[0][0], '0', 'the Adjust row is removed');
    assert.equal(outRows(f).length, 0, 'F no cash refund');
    near((await getInvoice(f.id)).balanceDue, 0);
    // G: 5,000 collected at billing; 988 already refunded; nothing more.
    near(row(first, g).collectedAtBilling, 5000, 'G collected at billing');
    near((await getInvoice(g.id)).balanceDue, 0);
    near((await getInvoice(g.id)).partialAmount, 5000);
    assert.equal(outRows(g).length, 1, 'G keeps its one refund');
    near((await customer(cg.id)).creditBalance || 0, 0, 'G no store credit');
    // H: 5,000 + 3,024 paid on 4,012 kept: 988 back in cash for the first
    // return (its day), 3,024 store credit for the receipt at the stale due.
    near(row(first, h).collectedAtBilling, 5000, 'H collected at billing');
    const hr = outRows(h);
    assert.equal(hr.length, 1);
    near(hr[0][1], 988, 'H refund for the older return');
    assert.equal(hr[0][2], d1, 'H refund dated on the return day (IST)');
    near((await customer(ch.id)).creditBalance, 3024, 'H over-payment held as store credit');
    near((await getInvoice(h.id)).balanceDue, 0);
    // I: one refund per return batch.
    const ir = outRows(i);
    assert.deepEqual(ir.map((x) => [Number(x[1]), x[2]]), [[4012, d2], [4012, d3]], 'I two refunds, one per return');
    // Line costs.
    const costOf = async (bill) => (await getInvoice(bill.id)).items[0].unitCost;
    near(await costOf(today), 550, 'costed at the purchase receipt on/before the bill date');
    near(await costOf(old), 700, 'no earlier purchase: the item cost at the time of the fix');
    assert.ok(first.totals.lineCostsBackfilled >= 2);
    // Staff and quotations.
    assert.deepEqual(sql(`SELECT status FROM "Employee" WHERE id IN (${q(empA)},${q(empD)}) ORDER BY name`).map((r) => r[0]), ['Active', 'Inactive']);
    const quotes = ok(await get('/api/estimates'));
    assert.equal(quotes.find((x) => x.id === qOpen).status, 'Open');
    assert.equal(quotes.find((x) => x.id === qConv).status, 'Converted');

    // A second apply changes nothing (no cash refund for F's credit note, no second credit).
    const second = runScript('--apply', '--i-have-a-backup');
    assert.equal(second.totals.billsChanged, 0);
    assert.equal(second.totals.refundRowsCreated, 0);
    assert.equal(second.totals.storeCreditAdded, 0);
    assert.equal(second.totals.lineCostsBackfilled, 0);
    near((await customer(cf.id)).creditBalance, 2183, 'F still credited once');

    // Overrides settle J and K.
    const dir = mkdtempSync(join(tmpdir(), 'fixbills-over-'));
    const file = join(dir, 'overrides.json');
    writeFileSync(file, JSON.stringify({ [j.invoiceNumber]: 5000, [k.invoiceNumber]: { keepRefunds: true } }));
    const third = runScript('--apply', '--i-have-a-backup', '--overrides', file);
    assert.equal(row(third, j).method, 'override');
    const jr = outRows(j);
    assert.deepEqual(jr.map((x) => Number(x[1])).sort((x, y) => x - y), [988, 4012], 'J: 988 back for the first return, the 4,012 refund kept');
    near((await getInvoice(j.id)).balanceDue, 0);
    near((await getInvoice(k.id)).balanceDue, 2894, 'K: refund kept, the customer owes it back');
    const fourth = runScript('--apply', '--i-have-a-backup', '--overrides', file);
    assert.equal(fourth.totals.billsChanged, 0, 'with the same overrides a further run changes nothing');
    assert.equal(fourth.totals.refundRowsCreated, 0);
  });

  test('UPG8-3 --apply without --i-have-a-backup is refused', () => {
    assert.throws(() => runScript('--apply'), /backup|exit|Command failed/i);
  });
});

function addDayStr(d) {
  return new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}
