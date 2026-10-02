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

describe('round 10: returns and reports', () => {
  test('RPT10-3 a return on a bill with a bill-level discount refunds the discounted value incl. GST (no GST on the discount)', async () => {
    const date = await thisMonthDay();
    const a = await createItem({ price: 1000, gst: 18, stock: { 'erode-hq': 10 } });
    const b = await createItem({ price: 500, gst: 5, stock: { 'erode-hq': 10 } });
    const inv = await mustSell(saleBody({ date, lines: [line(a, 2), line(b, 2)], overallDiscountValue: 10 }));
    // taxable 3,000 − 10% = 2,700; GST (360 + 50) × 0.9 = 369; total 3,069.
    near(inv.grandTotal, 3069, 'bill');
    const res = ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(a, 1)], reason: 'QA', refundMode: 'Cash' }));
    near(res.returnSummary.value, 1062, 'one unit of A = 1,180 × 0.9');
    const all = ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(a, 1), returnLine(b, 2)], reason: 'QA', refundMode: 'Cash' }));
    near((await getInvoice(inv.id)).totalReturnedAmount, 3069, 'a full return gives back exactly the bill');
    assert.ok(all.returnSummary.cashRefund > 0);
  });
});

describe('round 10: report period rule and retry (unit)', async () => {
  const { importTs } = await import('./lib-ts.mjs');
  const rm = await importTs('src/lib/reportMath.ts');
  const retry = await importTs('backend/src/lib/retry.ts');

  test('RPT10-1 sales of a period: bills in full in their month, returns as credit notes in the month they happened', () => {
    const bill = (id, date, total, returns = []) => ({ id, branchId: 'erode-hq', date, grandTotal: total, withGst: true, items: [], returns });
    const sep = bill('a', '2026-09-20', 1180, [{ refundAmount: 590, returnedAt: '2026-10-01T05:00:00.000Z' }]);
    const oct = bill('b', '2026-10-01', 2360);
    const inSep = (d) => d.startsWith('2026-09');
    const inOct = (d) => d.startsWith('2026-10');
    assert.deepEqual(rm.periodSales([sep, oct], inSep), { gross: 1180, returns: 0, net: 1180, bills: 1 }, 'September keeps its bill');
    assert.deepEqual(rm.periodSales([sep, oct], inOct), { gross: 2360, returns: 590, net: 1770, bills: 1 }, 'October carries the credit note');
    const days = rm.salesByDay([sep, oct]);
    assert.equal(days.get('2026-10-01'), 2360 - 590);
  });

  test('RPT10-2 / SAL10-2 CGST + SGST add up to the tax exactly; printed rate rows add up to the bill\'s stored tax', async () => {
    const lines = [1, 2, 3].map((i) => ({ id: `l${i}`, itemId: `it${i}`, itemName: 'x', quantity: 1, taxRate: 18, taxableAmount: 0.28, totalTax: 0.05, totalAmount: 0.33 }));
    const inv = { id: 'i1', branchId: 'erode-hq', date: '2026-10-01', withGst: true, stateOfSupply: '33-Tamil Nadu', subtotal: 0.84, totalTax: 0.15, totalCgst: 0.07, totalSgst: 0.08, grandTotal: 0.99, items: lines, returns: [] };
    const g = rm.gstCollected([inv]);
    assert.equal(Math.round((g.cgst + g.sgst) * 100), Math.round(g.tax * 100), `cgst ${g.cgst} + sgst ${g.sgst} = tax ${g.tax}`);
    const tc = await importTs('src/lib/taxCalculations.ts');
    const big = [{ taxableAmount: 333.33, taxRate: 18, totalTax: 60 }, { taxableAmount: 333.33, taxRate: 18, totalTax: 60 }, { taxableAmount: 101.01, taxRate: 5, totalTax: 5.05 }];
    const rows = tc.calculateTaxBreakdown(big, 0, 767.67, false, 125.05);
    const sum = Math.round(rows.reduce((t, r) => t + r.taxAmount, 0) * 100) / 100;
    assert.equal(sum, 125.05, 'rows add up to the bill tax');
  });

  test('PUR10-3 a deadlock (40P01) or serialization failure from a raw query is retried, other errors are not', () => {
    assert.equal(retry.isRetryableTxError({ code: 'P2010', meta: { code: '40P01' }, message: 'deadlock detected' }), true);
    assert.equal(retry.isRetryableTxError({ code: 'P2034' }), true);
    assert.equal(retry.isRetryableTxError({ message: 'ERROR: could not serialize access due to concurrent update' }), true);
    assert.equal(retry.isRetryableTxError({ code: 'P2025' }), false);
    assert.equal(retry.isRetryableTxError(new Error('boom')), false);
  });
});

describe('round 10: purchases and access matrix', async () => {
  const b64 = (x) => Buffer.from(typeof x === 'string' ? x : Uint8Array.from(x)).toString('base64');
  const pdf = (kb) => `data:application/pdf;base64,${b64(Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(kb * 1024, 65)]))}`;
  const { createPO, getPO, uid } = await import('./lib.mjs');
  const newVendor = async () => ok(await post('/api/vendors', { vendorName: `QA Vendor ${uid()}`, contactNo: randomPhone(), address: 'QA' })).vendor;

  test('PUR10-1 uploads and supplier bills sent at the same time all land; the 10 MB limit holds', async () => {
    const item = await createItem({ price: 300, purchasePrice: 100, stock: {} });
    const po = await createPO([{ item, qty: 50, price: 100, tax: 18 }]);
    const ups = await Promise.all(Array.from({ length: 4 }, (_, i) => post('/api/purchase/attachment', { poId: po.id, attachment: { name: `f${i}.pdf`, dataUrl: pdf(4) }, actor: 'QA' })));
    assert.deepEqual(ups.map((r) => r.status), [200, 200, 200, 200]);
    assert.equal((await getPO(po.id)).attachments.length, 4, 'every file is listed');
    const bills = await Promise.all(Array.from({ length: 3 }, (_, i) => post('/api/purchase/bill', { poId: po.id, bill: { number: `B-${uid()}-${i}`, date: '2026-09-16', taxable: 100, gst: 18 } })));
    assert.deepEqual(bills.map((r) => r.status), [200, 200, 200]);
    assert.equal((await getPO(po.id)).supplierBills.length, 3, 'every bill is kept');
    // 10 MB per PO: two 4 MB files fit, a third at the same time does not.
    const po2 = await createPO([{ item, qty: 5, price: 100, tax: 18 }]);
    const big = await Promise.all(Array.from({ length: 3 }, (_, i) => post('/api/purchase/attachment', { poId: po2.id, attachment: { name: `big${i}.pdf`, dataUrl: pdf(4 * 1024) }, actor: 'QA' })));
    assert.equal(big.filter((r) => r.status === 200).length, 2, `two fit, one is refused (${big.map((r) => r.status)})`);
  });

  test('PUR3-8 a supplier bill\'s GST cannot exceed the highest GST rate on the PO lines', async () => {
    const item = await createItem({ price: 300, purchasePrice: 100, stock: {} });
    const po = await createPO([{ item, qty: 10, price: 100, tax: 5 }]);
    expectStatus(await post('/api/purchase/bill', { poId: po.id, bill: { number: `B-${uid()}`, date: '2026-09-16', taxable: 1000, gst: 180 } }), 400, '18% on a 5% PO');
    ok(await post('/api/purchase/bill', { poId: po.id, bill: { number: `B-${uid()}`, date: '2026-09-16', taxable: 1000, gst: 50 } }), '5%');
  });

  test('PUR10-6 deleting a vendor payment also removes its "moved to supplier advance" history row', async () => {
    const vendor = await newVendor();
    const item = await createItem({ price: 300, purchasePrice: 100, stock: {} });
    const po = await createPO([{ item, qty: 2, price: 100, tax: 0 }], { vendor });
    const pay = ok(await post('/api/payments', { type: 'out', partyType: 'vendor', partyId: vendor.id, partyName: vendor.vendorName, branchId: 'erode-hq', amount: 200, paymentMode: 'GPay', allocations: [{ refId: po.id, amount: 200 }] }));
    ok(await post('/api/purchase/receive', { poId: po.id, receipts: [{ itemId: item.id, quantityReceived: 1, damagedQuantity: 1 }], actor: 'QA' }));
    ok(await post('/api/payments/vendor-advance/release', { poId: po.id }), 'release');
    assert.ok((await getPO(po.id)).payments.some((e) => e.mode === 'Moved to supplier advance'));
    ok(await del(`/api/payments/${pay.id}`), 'delete the payment');
    const after = await getPO(po.id);
    assert.ok(!after.payments.some((e) => e.mode === 'Moved to supplier advance'), 'no orphan history row');
    near(after.amountPaid, 0);
  });

  test('UPG10-8 an older attachment whose bytes are not the image/PDF it claims is served only as a download', async () => {
    if (!sql('SELECT 1')) return;
    const item = await createItem({ price: 300, purchasePrice: 100, stock: {} });
    const po = await createPO([{ item, qty: 1, price: 100, tax: 0 }]);
    const id = `po-att-old-${uid()}`;
    sql(`INSERT INTO "PoAttachment" (id, "poId", name, "mimeType", bytes, "dataUrl", "uploadedAt") VALUES ('${id}', '${po.id}', 'old.pdf', 'application/pdf', 30, 'data:application/pdf;base64,${b64('<html><script>alert(1)</script>')}', '2026-01-01T00:00:00.000Z')`);
    sql(`UPDATE "PurchaseOrder" SET attachments = '[{"id":"${id}","name":"old.pdf","fileType":"pdf","mimeType":"application/pdf"}]'::jsonb WHERE id='${po.id}'`);
    const res = ok(await get(`/api/purchase/attachment/${po.id}/${id}`));
    assert.equal(res.mimeType, 'application/octet-stream');
    assert.ok(res.dataUrl.startsWith('data:application/octet-stream;base64,'));
  });

  test('SAL10-10 the access-matrix PUT refuses a malformed body and never wipes the roles it leaves out', async () => {
    const before = ok(await get('/api/access-matrix')).matrix;
    expectStatus(await put('/api/access-matrix', { Billing: 'everything' }), 400, 'role not an object');
    expectStatus(await put('/api/access-matrix', { Billing: { views: 'all', caps: [] } }), 400, 'views not a list');
    expectStatus(await put('/api/access-matrix', []), 400, 'array');
    expectStatus(await put('/api/access-matrix', { nobody: {} }), 400, 'no role');
    try {
      ok(await put('/api/access-matrix', { Sales: before.Sales }), 'one role only');
      const after = ok(await get('/api/access-matrix')).matrix;
      assert.deepEqual(after.Billing, before.Billing, 'Billing kept');
      assert.deepEqual(after.Manager, before.Manager, 'Manager kept');
    } finally {
      ok(await put('/api/access-matrix', before), 'restore');
    }
  });
});

describe('round 10: customer money', async () => {
  const { uid } = await import('./lib.mjs');
  const newEnquiry = async (phone, item, branchId = 'erode-hq') => {
    const id = `enq-qa-${uid()}`;
    ok(await post('/api/enquiry/save', {
      enquiry: {
        id, enquiryNumber: `ENQ-QA-${uid()}`, customerName: 'QA Enquiry Customer', customerPhone: phone, itemId: item.id,
        itemName: item.itemName, itemCode: item.itemCode, unit: 'PCS', quantity: 1, branchId, date: istToday(), time: '10:00',
        status: 'Open', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      },
      actor: 'QA',
    }), 'enquiry');
    return id;
  };

  test('CRM10-2 editing a bill back up after an edit below what was paid uses the credit given, not a due on top of it', async () => {
    const date = await thisMonthDay();
    const item = await createItem({ price: 1000, stock: { 'erode-hq': 10 } });
    const inv = await mustSell(saleBody({ date, customerName: 'QA Edit Up', customerPhone: randomPhone(), lines: [line(item, 2)] }));
    ok(await resave(await getInvoice(inv.id), { items: [line(item, 1)] }), 'edit down');
    near((await customerOf(inv.customerId)).creditBalance, 1180, 'excess kept as credit');
    ok(await resave(await getInvoice(inv.id), { items: [line(item, 2)], paymentSplits: [{ mode: 'Cash', amount: 2360 }] }), 'edit back up');
    near((await getInvoice(inv.id)).balanceDue, 0, 'nothing owed');
    near((await customerOf(inv.customerId)).creditBalance, 0, 'the credit went back into the bill');
  });

  test('CRM10-3 / SAL10-6 / PUR10-7 receipts, refunds and vendor payments take only real modes; "Cash " is the drawer\'s cash; ₹0 split parts are not stored', async () => {
    const date = await thisMonthDay();
    const item = await createItem({ price: 1000, stock: { 'erode-hq': 10 } });
    const credit = await mustSell(saleBody({ date, transactionType: 'Credit', customerName: 'QA Modes', customerPhone: randomPhone(), lines: [line(item, 1)], splits: [{ mode: 'COD-Credit', amount: 1180 }] }));
    expectStatus(await receive(credit, 100, { mode: 'Bitcoin', date }), 400, 'receipt in Bitcoin');
    const r = ok(await receive(credit, 100, { mode: 'cash ', date }), 'receipt typed "cash "');
    assert.equal(r.paymentMode, 'Cash', 'stored as Cash');
    const paid = await mustSell(saleBody({ date, lines: [line(item, 1)] }));
    expectStatus(await post('/api/tx/sale-return', { invoiceId: paid.id, returnLines: [returnLine(item, 1)], reason: 'QA', refundMode: 'Bitcoin' }), 400, 'refund in Bitcoin');
    const v = await anyVendor();
    expectStatus(await post('/api/payments', { type: 'out', partyType: 'vendor', partyId: v.id, partyName: v.vendorName, branchId: 'erode-hq', date, amount: 10, paymentMode: 'Gold' }), 400, 'vendor paid in gold');
    const split = await mustSell(saleBody({ date, lines: [line(item, 1)], splits: [{ mode: 'Cash', amount: 1000 }, { mode: 'GPay', amount: 0 }, { mode: 'COD-Credit', amount: 180 }], transactionType: 'Credit', customerName: 'QA Split', customerPhone: randomPhone() }));
    assert.deepEqual(split.paymentSplits.map((s) => s.mode), ['Cash', 'COD-Credit'], 'no ₹0 GPay part');
  });

  test('CRM10-4 deleting a pending-order advance receipt takes the advance off the order', async () => {
    const item = await createItem({ price: 1000, stock: {} });
    const enquiryId = await newEnquiry(randomPhone(), item);
    const order = ok(await get('/api/pending-orders')).find((o) => o.enquiryId === enquiryId);
    const adv = ok(await post('/api/payments/advance', { orderId: order.id, amount: 500, mode: 'Cash' }));
    near(ok(await get('/api/pending-orders')).find((o) => o.id === order.id).advanceAmount, 500);
    ok(await del(`/api/payments/${adv.payment.id}`), 'delete the advance receipt');
    near(ok(await get('/api/pending-orders')).find((o) => o.id === order.id).advanceAmount, 0, 'order shows no advance');
  });

  test('CRM10-6 an enquiry closes only with a bill for its own customer, also when the bill names it as its source', async () => {
    const date = await thisMonthDay();
    const item = await createItem({ price: 1000, stock: { 'erode-hq': 5 } });
    const phone = randomPhone();
    const enquiryId = await newEnquiry(phone, item);
    expectStatus((await sell({ ...saleBody({ date, lines: [line(item, 1)] }), sourceEnquiryId: 'enq-does-not-exist' })).res, 400, 'a made-up enquiry');
    const other = await mustSell({ ...saleBody({ date, customerName: 'Someone else', customerPhone: randomPhone(), lines: [line(item, 1)] }), sourceEnquiryId: enquiryId });
    const res = await post('/api/enquiry/convert', { enquiryId, targetType: 'invoice', docId: other.id, docNumber: other.invoiceNumber });
    expectStatus(res, 400, 'another customer\'s bill does not close it');
    const mine = await mustSell({ ...saleBody({ date, customerName: 'QA Enquiry Customer', customerPhone: phone, lines: [line(item, 1)] }), sourceEnquiryId: enquiryId });
    ok(await post('/api/enquiry/convert', { enquiryId, targetType: 'invoice', docId: mine.id, docNumber: mine.invoiceNumber }), 'the customer\'s bill closes it');
  });

});

describe('round 10: sign-in rules', async () => {
  const { loginPin, PINS, api: call } = await import('./lib.mjs');
  test('SEC10-5 a new login with a default PIN can do nothing but change its PIN (enforced by the server)', async () => {
    let pin, created;
    for (let i = 0; i < 20 && !created; i++) {
      pin = String(1000 + Math.floor(Math.random() * 9000));
      if (Object.values(PINS).includes(pin)) continue;
      const res = await post('/api/users', { name: `QA Reset ${Date.now()}`, role: 'Billing', pin, assignedBranchId: 'erode-hq' });
      if (res.status !== 409) created = ok(res, 'create staff');
    }
    const token = await loginPin(pin);
    const boot = await call('GET', '/api/bootstrap', { as: { token } });
    expectStatus(boot, 403, 'bootstrap before the PIN change');
    assert.equal(boot.body.error, 'PIN_RESET_REQUIRED');
    expectStatus(await call('GET', '/api/invoices', { as: { token } }), 403, 'reads too');
    let own;
    for (let i = 0; i < 20; i++) {
      own = String(1000 + Math.floor(Math.random() * 9000));
      if (Object.values(PINS).includes(own) || own === pin) continue;
      if ((await call('POST', '/api/auth/change-pin', { as: { token }, body: { newPin: own } })).status === 200) break;
    }
    ok(await call('GET', '/api/bootstrap', { as: { token } }), 'works once the PIN is changed');
  });
});
