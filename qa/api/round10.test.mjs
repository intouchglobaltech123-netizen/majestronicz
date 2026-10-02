// Round-10 fixes: money behind a closed day, ended months, store credit on
// void/delete, archived items, and the rest of the round-10 findings.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  post, get, put, del, ok, expectStatus, near, createItem, line, saleBody, mustSell, sell, getInvoice, resave,
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

describe('round 10: sale replies, live sync and the bootstrap window (SAL10-1)', () => {
  test('SAL10-1 a sale answers with the saved bill and the stock rows it moved, not whole tables', async () => {
    const date = await thisMonthDay();
    const item = await createItem({ stock: { 'erode-hq': 10, chennai: 10 } });
    const res = ok(await post('/api/tx/sale', saleBody({ date, customerName: 'QA Delta', customerPhone: randomPhone(), lines: [line(item, 2)] })));
    assert.equal(res.delta, true);
    assert.deepEqual(res.invoices.map((i) => i.id), [res.savedInvoice.id], 'only the saved bill');
    assert.equal(res.customers.length, 1, 'only its customer');
    assert.deepEqual(res.branchStocks.map((b) => `${b.itemId}@${b.branchId}:${b.quantity}`), [`${item.id}@erode-hq:8`], 'only the moved stock row');
    assert.equal(res.stockAdjustmentLogs.length, 1);
    assert.ok(res.changes && res.changes.invoices[0] === res.savedInvoice.id, 'ids for the live-update event');
    // A cash return answers with its refund row.
    const ret = ok(await post('/api/tx/sale-return', { invoiceId: res.savedInvoice.id, returnLines: [returnLine(item, 1)], reason: 'QA', refundMode: 'Cash' }));
    assert.ok(ret.payments.some((p) => p.type === 'out'), 'the refund row is in the reply');
    // The rows an event names can be re-read on their own, scoped to the reader.
    const sync = ok(await get(`/api/sync?invoices=${res.savedInvoice.id}&stock=${item.id}@erode-hq,${item.id}@chennai`, 'Billing'));
    assert.equal(sync.invoices.length, 1);
    assert.equal(sync.branchStocks.length, 2);
    const other = await mustSell(saleBody({ branchId: 'chennai', date, lines: [line(item, 1)] }));
    assert.equal(ok(await get(`/api/sync?invoices=${other.id}`, 'Billing')).invoices.length, 0, 'another branch bill is not sent to Billing');
    assert.equal(ok(await get(`/api/sync?invoices=${other.id}`, 'Sales')).invoices.length, 0, 'no bills for Sales');
  });

  test('SAL10-1 six cashiers billing the same item at once all succeed with their own numbers and exact stock', async () => {
    const date = await thisMonthDay();
    const item = await createItem({ stock: { 'erode-hq': 100 } });
    const results = await Promise.all(Array.from({ length: 6 }, (_, w) => (async () => {
      const out = [];
      for (let i = 0; i < 4; i++) out.push(await sell(saleBody({ date, customerName: `QA Cashier ${w}`, customerPhone: randomPhone(), lines: [line(item, 1)] })));
      return out;
    })()));
    const all = results.flat();
    assert.deepEqual(all.map((r) => r.res.status).filter((s) => s !== 200), [], 'no failures');
    const numbers = all.map((r) => r.inv.invoiceNumber);
    assert.equal(new Set(numbers).size, 24, 'every bill has its own number');
    const { stockOf } = await import('./lib.mjs');
    assert.equal(await stockOf(item.id, 'erode-hq'), 76, 'stock taken exactly once per bill');
  });

  test('SAL10-1 the bootstrap carries recent bills; older ones come page by page; ?full=1 has everything', async () => {
    const old = await freshDay('erode-hq'); // 2016-2024
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const paid = await mustSell(saleBody({ date: old, lines: [line(item, 1)] }));
    const owing = await mustSell(saleBody({ date: old, transactionType: 'Credit', customerName: 'QA Owing', customerPhone: randomPhone(), lines: [line(item, 1)], splits: [{ mode: 'COD-Credit', amount: 1180 }] }));
    if (sql('SELECT 1')) sql(`UPDATE "Invoice" SET "updatedAt"='${old}T06:00:00.000Z' WHERE id IN ('${paid.id}','${owing.id}')`);
    const boot = ok(await get('/api/bootstrap'));
    assert.match(String(boot.historyFrom), /^\d{4}-\d{2}-\d{2}$/);
    const ids = new Set(boot.invoices.map((i) => i.id));
    if (sql('SELECT 1')) assert.ok(!ids.has(paid.id), 'a settled old bill is not in the first load');
    assert.ok(ids.has(owing.id), 'an old bill that still owes money is');
    const seen = new Set();
    for (let page = 0; page != null;) {
      const h = ok(await get(`/api/history?kind=invoices&page=${page}`));
      h.invoices.forEach((i) => seen.add(i.id));
      page = h.nextPage;
    }
    assert.ok(seen.has(paid.id), 'the old bill is in the history pages');
    assert.ok(ok(await get('/api/bootstrap?full=1')).invoices.some((i) => i.id === paid.id), 'full=1');
    assert.deepEqual(ok(await get('/api/history?kind=invoices&page=0', 'Sales')).invoices, [], 'Sales gets no bills');
  });
});

describe('round 10: billing rights and quote checks', () => {
  const withoutRights = async (fn) => {
    const matrix = ok(await get('/api/access-matrix')).matrix;
    const restricted = JSON.parse(JSON.stringify(matrix));
    restricted.Billing.flags = restricted.Billing.flags.filter((f) => f !== 'bill.editPrice' && f !== 'bill.giveDiscount');
    ok(await put('/api/access-matrix', restricted), 'take the rights away from Billing');
    try { await fn(); } finally { ok(await put('/api/access-matrix', matrix), 'restore'); }
  };
  const quote = (lines, extra = {}) => ({
    id: `est-qa-${Date.now()}${Math.random().toString(36).slice(2, 6)}`, branchId: 'erode-hq', date: istToday(), time: '10:00', customerName: 'QA Quote', withGst: true,
    items: lines, overallDiscountType: '%', overallDiscountValue: 0, shippingCharges: 0, roundOffEnabled: false, termsAndConditions: 'QA', ...extra,
  });

  test('SAL10-4 without the discount right, an item\'s own ₹ standard discount still sells (rupees per unit, to the paisa); more is refused', async () => {
    const date = await thisMonthDay();
    // ₹118 off a ₹1,180 tax-inclusive price = ₹100 per unit before GST.
    const item = await createItem({ price: 1180, stock: { 'erode-hq': 10 }, extra: { salePriceTaxMode: 'with', discountOnSalePrice: 118, discountType: 'amount' } });
    await withoutRights(async () => {
      ok(await post('/api/tx/sale', saleBody({ date, lines: [line(item, 3, { price: 1000, discountType: 'amount', discountValue: 300 })] }), 'Billing'), 'the standard discount');
      expectStatus(await post('/api/tx/sale', saleBody({ date, lines: [line(item, 3, { price: 1000, discountType: 'amount', discountValue: 303 })] }), 'Billing'), 403, '₹1 per unit more');
      expectStatus(await post('/api/tx/sale', saleBody({ date, lines: [line(item, 1, { price: 1000, discountValue: 12 })] }), 'Billing'), 403, '12% is more than ₹100 of ₹1,000');
      ok(await post('/api/tx/sale', saleBody({ date, lines: [line(item, 1, { price: 1000, discountValue: 10 })] }), 'Billing'), '10% = ₹100 is the standard');
    });
  });

  test('SAL10-5 the price floor uses the catalogue GST rate, not a 0% sent with a GST-off bill', async () => {
    const date = await thisMonthDay();
    const item = await createItem({ price: 1000, stock: { 'erode-hq': 10 } });
    await withoutRights(async () => {
      const off = (price, taxRate) => ({ ...saleBody({ date, lines: [line(item, 1, { price, taxRate })] }), withGst: false });
      expectStatus(await post('/api/tx/sale', off(1000, 0), 'Billing'), 403, '₹1,000 on a GST-off bill is below ₹1,180');
      ok(await post('/api/tx/sale', off(1180, 18), 'Billing'), 'the full price on a GST-off bill');
    });
  });

  test('SAL10-8 / SAL10-7 quotes follow the same rights; empty, undated or unknown-branch quotes and empty bills are refused', async () => {
    const item = await createItem({ price: 1000, stock: { 'erode-hq': 10 } });
    await withoutRights(async () => {
      expectStatus(await post('/api/catalog/estimate', quote([line(item, 1, { price: 800 })]), 'Billing'), 403, 'quote below catalogue');
      expectStatus(await post('/api/catalog/estimate', quote([line(item, 1, { discountValue: 20 })]), 'Billing'), 403, 'quote with a discount');
      ok(await post('/api/catalog/estimate', quote([line(item, 1)]), 'Billing'), 'a plain quote');
    });
    expectStatus(await post('/api/catalog/estimate', quote([])), 400, 'empty quote');
    expectStatus(await post('/api/catalog/estimate', quote([line(item, 1)], { date: 'abc' })), 400, 'date abc');
    expectStatus(await post('/api/catalog/estimate', quote([line(item, 1)], { date: '2030-01-01' })), 400, 'date in 2030');
    expectStatus(await post('/api/catalog/estimate', quote([line(item, 1)], { branchId: 'mars' })), [400, 403], 'branch mars');
    expectStatus(await post('/api/tx/sale', saleBody({ date: istToday(), lines: [] })), 400, 'empty bill');
  });
});
