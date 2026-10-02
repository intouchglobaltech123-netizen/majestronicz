// Round-11 final-check fixes: store credit on bill edits, ended months, the
// access matrix, live counts, incentives and the rest of the FIN-A / FIN-B findings.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  post, get, put, ok, expectStatus, near, createItem, line, saleBody, mustSell, getInvoice, resave,
  freshDay, thisMonthDay, randomPhone,
} from './lib.mjs';

async function newEmployee(branchId, extra = {}) {
  for (let i = 0; i < 20; i++) {
    const pin = String(1000 + Math.floor(Math.random() * 9000));
    const res = await post('/api/employees', { name: `QA Seller ${Date.now()}${i}`, designation: 'QA', branchId, monthlySalary: 15000, status: 'Active', joinedDate: '2026-01-01', pin, ...extra });
    if (res.status === 409) continue;
    return ok(res, 'create employee').employee;
  }
  throw new Error('could not create employee');
}
const customerOf = async (id) => ok(await get('/api/customers')).find((c) => c.id === id);
const collected = (inv) => (inv.paymentSplits || []).filter((s) => s.mode !== 'COD-Credit').reduce((t, s) => t + (Number(s.amount) || 0), 0);

describe('round 11: bill edits', () => {
  test('FIN-A-1 editing a paid bill down then back up never puts uncollected money in the drawer', async () => {
    const date = await thisMonthDay();
    const item = await createItem({ price: 1000, stock: { 'erode-hq': 20 } });
    const inv = await mustSell(saleBody({ date, customerName: 'QA Edit Up', customerPhone: randomPhone(), lines: [line(item, 2)] }));
    near(collected(inv), 2360, 'cash collected at billing');
    // Down to ₹1,180: ₹1,180 paid over the total is kept as store credit.
    ok(await resave(await getInvoice(inv.id), { items: [line(item, 1)] }), 'edit down');
    near((await customerOf(inv.customerId)).creditBalance, 1180, 'store credit given');
    // Back up to ₹3,540 with the form's single-mode split reset to the full total.
    ok(await resave(await getInvoice(inv.id), { items: [line(item, 3)], paymentMode: 'Cash', paymentSplits: [{ mode: 'Cash', amount: 3540 }] }), 'edit up');
    const up = await getInvoice(inv.id);
    near(collected(up), 2360, 'the drawer keeps only what was really collected');
    near((await customerOf(inv.customerId)).creditBalance, 0, 'the store credit is applied back');
    near(up.balanceDue, 1180, 'the rest is a due to collect');
    // Back to the original total: credit fully applied, nothing owed.
    const inv2 = await mustSell(saleBody({ date, customerName: 'QA Edit Up 2', customerPhone: randomPhone(), lines: [line(item, 2)] }));
    ok(await resave(await getInvoice(inv2.id), { items: [line(item, 1)] }), 'edit down');
    ok(await resave(await getInvoice(inv2.id), { items: [line(item, 2)], paymentSplits: [{ mode: 'Cash', amount: 2360 }] }), 'edit back');
    const back = await getInvoice(inv2.id);
    near(collected(back), 2360);
    near(back.balanceDue, 0);
    near((await customerOf(inv2.customerId)).creditBalance, 0);
  });

  test('FIN-A-3 a bill of an ended month cannot be edited, nor can an edit move a bill into one', async () => {
    const old = await freshDay('erode-hq'); // a month that has ended
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const inv = await mustSell(saleBody({ date: old, lines: [line(item, 1)] }));
    for (const changes of [{ customerName: 'QA renamed' }, { date: await thisMonthDay() }]) {
      const res = await resave(await getInvoice(inv.id), changes);
      expectStatus(res, 409, JSON.stringify(changes));
      assert.equal(res.body.error, 'MONTH_CLOSED');
    }
    const cur = await mustSell(saleBody({ date: await thisMonthDay(), lines: [line(item, 1)] }));
    const res = await resave(await getInvoice(cur.id), { date: old });
    expectStatus(res, 409, 'moved into an ended month');
    assert.equal(res.body.error, 'MONTH_CLOSED');
    assert.equal((await getInvoice(cur.id)).date, cur.date);
  });
});

describe('round 11: salesperson incentive', () => {
  test('FIN-B-1 the incentive rate comes from the Employee master and the salesperson must be an active employee of the branch', async () => {
    const date = await thisMonthDay();
    const item = await createItem({ price: 1000, stock: { 'erode-hq': 10 } });
    const emp = await newEmployee('erode-hq', { incentivePercent: 2 });
    const body = (extra) => Object.assign(saleBody({ date, lines: [line(item, 1)] }), extra);
    // Billing asks for 50%: the server uses the master's 2%.
    const inv = await mustSell(body({ salespersonId: emp.id, salespersonName: 'Someone Else', incentivePercent: 50, incentiveAmount: 9999 }), 'Billing');
    assert.equal(inv.incentivePercent, 2);
    near(inv.incentiveAmount, 23.6);
    assert.equal(inv.salespersonName, emp.name);
    // No rate on the master: no incentive at all, whatever the request says.
    const plain = await newEmployee('erode-hq');
    const inv2 = await mustSell(body({ salespersonId: plain.id, incentivePercent: 10 }), 'Billing');
    assert.equal(inv2.incentiveAmount ?? null, null);
    // Another branch's employee, an inactive one, or a made-up id: refused.
    const other = await newEmployee('chennai', { incentivePercent: 5 });
    const gone = await newEmployee('erode-hq', { incentivePercent: 5 });
    ok(await post('/api/employees', { ...gone, status: 'Inactive' }), 'deactivate');
    for (const id of [other.id, gone.id, 'emp-nobody']) {
      const res = await post('/api/tx/sale', body({ salespersonId: id, incentivePercent: 5 }), 'Billing');
      expectStatus(res, 400, id);
      assert.equal(res.body.error, 'BAD_SALESPERSON');
    }
  });
});

describe('round 11: staff, purchases and stock', () => {
  test('FIN-B-7 employee status, branch, joined date, phone and email are validated', async () => {
    const emp = await newEmployee('coimbatore');
    const base = { id: emp.id, name: emp.name, designation: 'QA', branchId: 'coimbatore' };
    for (const [bad, code] of [[{ status: 'Banana' }, 'BAD_STATUS'], [{ joinedDate: 'not-a-date' }, 'BAD_DATE'], [{ joinedDate: '2026-02-30' }, 'BAD_DATE'],
      [{ phone: 'abc' }, 'BAD_PHONE'], [{ email: 'x' }, 'BAD_EMAIL'], [{ branchId: 'mars' }, 'BAD_BRANCH']]) {
      const res = await post('/api/employees', { ...base, ...bad }, 'Manager');
      expectStatus(res, [400, 403], JSON.stringify(bad));
      if (res.status === 400) assert.equal(res.body.error, code, JSON.stringify(bad));
    }
    const stored = ok(await get('/api/employees')).find((e) => e.id === emp.id);
    assert.equal(stored.status, 'Active');
    ok(await post('/api/employees', { ...base, phone: '98421 01122', email: 'qa@example.com', joinedDate: '2026-01-05' }, 'Manager'), 'valid values save');
  });
});
