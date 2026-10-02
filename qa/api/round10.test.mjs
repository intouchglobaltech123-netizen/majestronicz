// Round-10 fixes: money behind a closed day, ended months, store credit on
// void/delete, archived items, and the rest of the round-10 findings.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  post, get, del, ok, expectStatus, near, createItem, line, saleBody, mustSell, sell, getInvoice, resave,
  freshDays, freshDay, thisMonthDay, randomPhone, paymentsFor, returnLine, receive, sql, istToday, anyVendor,
} from './lib.mjs';

const customerOf = async (id) => ok(await get('/api/customers')).find((c) => c.id === id);
const lastReturn = (inv) => inv.returns[inv.returns.length - 1];

describe('round 10: closed days and ended months', () => {
  test('CASH10-1 / PUR10-8 nothing is booked on a day before the latest closed day', async () => {
    const [d1, d2, d3] = await freshDays('chennai', 3);
    const item = await createItem({ stock: { chennai: 10 } });
    const early = await mustSell(saleBody({ branchId: 'chennai', date: d1, customerName: 'QA C', customerPhone: randomPhone(), transactionType: 'Credit', lines: [line(item, 1)], splits: [{ mode: 'COD-Credit', amount: 1180 }] }));
    const pay = ok(await receive(early, 100, { date: d1 }), 'receipt while d1 is open');
    ok(await post('/api/cash/expense', { branchId: 'chennai', date: d1, expense: { reason: 'QA', cashAmount: 10 } }), 'expense while open');
    ok(await post('/api/cash/close', { branchId: 'chennai', date: d2, actor: 'QA' }), 'close d2');

    const refused = (res, what) => { expectStatus(res, 409, what); assert.equal(res.body.error, 'DAY_CLOSED', what); };
    refused((await sell(saleBody({ branchId: 'chennai', date: d1, lines: [line(item, 1)] }))).res, 'sale on an earlier open day');
    refused(await resave(await getInvoice(early.id), { customerName: 'QA C edited' }), 'edit of a bill on an earlier day');
    refused(await receive(early, 50, { date: d1 }), 'receipt on an earlier day');
    refused(await del(`/api/payments/${pay.id}`), 'delete of a receipt on an earlier day');
    refused(await post('/api/cash/expense', { branchId: 'chennai', date: d1, expense: { reason: 'QA', cashAmount: 10 } }), 'expense on an earlier day');
    refused(await post('/api/cash/override', { branchId: 'chennai', date: d1, amount: 5, reason: 'QA' }), 'opening override on an earlier day');
    const v = await anyVendor();
    refused(await post('/api/payments', { type: 'out', partyType: 'vendor', partyId: v.id, partyName: v.vendorName, branchId: 'chennai', date: d1, amount: 100, paymentMode: 'Cash' }), 'vendor payment on an earlier day');
    // A day AFTER the closed one is open as usual.
    ok(await receive(early, 50, { date: d3 }), 'receipt after the closed day');
  });

  test('UPG10-4 reversing a return whose refund sits on an earlier day takes the money back today, never deletes it', async () => {
    if (!sql('SELECT 1')) return;
    const date = await thisMonthDay();
    const past = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 2)] }));
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', refundMode: 'Cash' }));
    const refund = (await paymentsFor(inv.id)).find((p) => p.type === 'out');
    sql(`UPDATE "Payment" SET "date"='${past}' WHERE id='${refund.id}'`); // an older, register-less day
    const res = ok(await post('/api/tx/reverse-return', { invoiceId: inv.id, returnId: lastReturn(await getInvoice(inv.id)).id }));
    assert.equal(res.reversed.refund.kind, 'collected');
    assert.equal(res.reversed.refund.date, istToday());
    const rows = await paymentsFor(inv.id);
    assert.ok(rows.some((p) => p.id === refund.id), 'the past refund is kept');
    assert.ok(rows.some((p) => p.type === 'in' && p.date === istToday()), 'taken back today');
    near((await getInvoice(inv.id)).balanceDue, 0, 'nothing owed');
  });

  test('RPT10-4 a bill of an ended month cannot be voided or deleted, CEO included', async () => {
    const date = await freshDay('erode-hq'); // 2016-2024: a month that has ended
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 1)] }));
    for (const res of [
      await post('/api/tx/void-invoice', { invoiceId: inv.id, reason: 'QA' }),
      await del(`/api/tx/invoice/${inv.id}`),
      await post('/api/tx/void-invoice', { invoiceId: inv.id, reason: 'QA' }, 'Manager'),
    ]) {
      expectStatus(res, [403, 409]);
      if (res.status === 409) {
        assert.equal(res.body.error, 'MONTH_CLOSED');
        assert.match(res.body.message, /Use a return \/ credit note instead/);
      }
    }
    assert.ok(!(await getInvoice(inv.id)).isVoided, 'still live');
    // The way out: a return in the current month.
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', refundMode: 'Cash' }), 'return instead');
  });

  test('CRM10-1 voiding or deleting a bill takes back the store credit given on it, or refuses once spent', async () => {
    const date = await thisMonthDay();
    const phone = randomPhone();
    const item = await createItem({ price: 1000, stock: { 'erode-hq': 10 } });
    const sale = (q) => mustSell(saleBody({ date, customerName: 'QA Credit Back', customerPhone: phone, lines: [line(item, q)] }));
    // A: credit-note return on a paid bill → ₹1,180 store credit, then void.
    const a = await sale(2);
    ok(await post('/api/tx/sale-return', { invoiceId: a.id, returnLines: [returnLine(item, 1)], reason: 'QA', refundMode: 'Adjust to credit note' }));
    near((await customerOf(a.customerId)).creditBalance, 1180, 'credit note issued');
    ok(await post('/api/tx/void-invoice', { invoiceId: a.id, reason: 'QA' }), 'void');
    near((await customerOf(a.customerId)).creditBalance, 0, 'credit taken back on void');
    // B: edited below what was paid → excess as credit; then delete.
    const b = await sale(2);
    ok(await resave(await getInvoice(b.id), { items: [line(item, 1)] }), 'edit below paid');
    near((await customerOf(b.customerId)).creditBalance, 1180, 'excess kept as credit');
    ok(await del(`/api/tx/invoice/${b.id}`), 'delete');
    near((await customerOf(b.customerId)).creditBalance, 0, 'credit taken back on delete');
    // C: credit already spent on another bill → void refused.
    const c = await sale(2);
    ok(await post('/api/tx/sale-return', { invoiceId: c.id, returnLines: [returnLine(item, 1)], reason: 'QA', refundMode: 'Adjust to credit note' }));
    const owe = await mustSell(saleBody({ date, customerName: 'QA Credit Back', customerPhone: phone, transactionType: 'Credit', lines: [line(item, 1)], splits: [{ mode: 'COD-Credit', amount: 1180 }] }));
    ok(await post('/api/payments', { type: 'in', partyType: 'customer', partyId: c.customerId, partyName: 'QA Credit Back', branchId: 'erode-hq', date, amount: 1000, paymentMode: 'Store Credit', allocations: [{ refId: owe.id, amount: 1000 }] }), 'spend credit');
    const res = await post('/api/tx/void-invoice', { invoiceId: c.id, reason: 'QA' });
    expectStatus(res, 409, 'void after the credit was spent');
    assert.equal(res.body.error, 'CREDIT_SPENT');
    assert.ok(!(await getInvoice(c.id)).isVoided);
  });
});

describe('round 10: staff, salary and PINs', () => {
  const emps = async (as) => ok(await get('/api/employees', as));
  test('HRM10-1 / SEC10-1 a Manager can edit staff but not set salary or incentive, and never receives them', async () => {
    const pin = String(1000 + Math.floor(Math.random() * 9000));
    const created = ok(await post('/api/employees', { name: `QA Staff ${Date.now()}`, designation: 'QA', branchId: 'coimbatore', monthlySalary: 18000, incentivePercent: 2, status: 'Active', joinedDate: '2026-01-01', pin }), 'CEO creates');
    const id = created.employee.id;
    assert.equal(created.employee.monthlySalary, 18000, 'the CEO sees the salary');
    // Manager: salary changes are refused…
    for (const body of [{ monthlySalary: 99000 }, { incentivePercent: 50 }]) {
      const res = await post('/api/employees', { id, name: created.employee.name, designation: 'QA', branchId: 'coimbatore', status: 'Active', ...body }, 'Manager');
      expectStatus(res, 403, JSON.stringify(body));
    }
    // …an edit without them works and keeps the salary.
    const edited = ok(await post('/api/employees', { id, name: `${created.employee.name} B`, designation: 'QA Lead', branchId: 'coimbatore', status: 'Active' }, 'Manager'), 'Manager edits');
    assert.equal(edited.employee.monthlySalary, undefined, 'no salary in the Manager reply');
    assert.equal(edited.employee.incentivePercent, undefined);
    const mine = (await emps('Manager')).find((e) => e.id === id);
    assert.ok(mine && mine.designation === 'QA Lead');
    assert.ok(!('monthlySalary' in mine) && !('incentivePercent' in mine), 'GET /employees has no salary for a Manager');
    const one = ok(await get(`/api/employees/${id}`, 'Manager'));
    assert.ok(!('monthlySalary' in one) && !('pin' in one), 'GET /employees/:id has no salary or PIN');
    const ceo = (await emps('CEO')).find((e) => e.id === id);
    assert.equal(ceo.monthlySalary, 18000, 'salary unchanged');
    assert.equal(ceo.incentivePercent, 2);
    expectStatus(await get('/api/employees/emp-does-not-exist'), 404, 'unknown employee');
    // A bad salary from the CEO is a 400, never NaN in the database.
    expectStatus(await post('/api/employees', { id, name: ceo.name, designation: 'QA', branchId: 'coimbatore', status: 'Active', monthlySalary: 'abc' }), 400);
  });

  test('SEC10-1 payroll rows never reach a caller without payroll rights', async () => {
    const boot = ok(await get('/api/bootstrap', 'Manager'));
    assert.deepEqual(boot.payrollRecords, [], 'bootstrap');
    const staff = (await emps('Manager')).find((e) => e.branchId === 'coimbatore' && e.status === 'Active');
    if (!staff) return;
    const res = await post('/api/hrm/clock-in', { employeeId: staff.id, photoDataUrl: '', location: null }, 'Manager');
    if (res.status === 200) assert.deepEqual(res.body.payrollRecords || [], [], 'clock-in reply');
  });

  test('SEC10-2 attendance PINs are stored hashed and still verify', async () => {
    if (!sql('SELECT 1')) return;
    const pin = String(1000 + Math.floor(Math.random() * 9000));
    const created = ok(await post('/api/employees', { name: `QA Pin ${Date.now()}`, designation: 'QA', branchId: 'erode-hq', monthlySalary: 1000, status: 'Active', joinedDate: '2026-01-01', pin }));
    const stored = sql(`SELECT pin FROM "Employee" WHERE id='${created.employee.id}'`)[0][0];
    assert.match(stored, /^[0-9a-f]{64}$/, 'hashed');
    assert.equal(ok(await post('/api/hrm/verify-pin', { employeeId: created.employee.id, pin })).ok, true, 'verifies');
    // An older plaintext PIN still works and is re-stored hashed on first use.
    sql(`UPDATE "Employee" SET pin='${pin}' WHERE id='${created.employee.id}'`);
    assert.equal(ok(await post('/api/hrm/verify-pin', { employeeId: created.employee.id, pin })).ok, true, 'plaintext verifies');
    assert.match(sql(`SELECT pin FROM "Employee" WHERE id='${created.employee.id}'`)[0][0], /^[0-9a-f]{64}$/, 're-hashed');
    // Demo/staff rows: none in plain text.
    assert.equal(sql(`SELECT count(*) FROM "Employee" WHERE pin !~ '^[0-9a-f]{64}$'`)[0][0], '0', 'no plaintext PINs');
  });
});
