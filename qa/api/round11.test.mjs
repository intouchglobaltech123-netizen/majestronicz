// Round-11 final-check fixes: store credit on bill edits, ended months, the
// access matrix, live counts, incentives and the rest of the FIN-A / FIN-B findings.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  post, get, put, ok, expectStatus, near, createItem, line, saleBody, mustSell, getInvoice, resave,
  freshDay, thisMonthDay, randomPhone, sql, returnLine, createPO, getPO, stockOf, together,
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

  test('FIN-B-10 salary for a month that has not started cannot be paid', async () => {
    const emp = await newEmployee('erode-hq');
    const [y, m] = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 7).split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    const record = { employeeId: emp.id, month: next, monthlySalary: 15000, computedPay: 15000, finalPayable: 15000, standardHoursPerMonth: 208, hourlyRate: 72.12 };
    const res = await post('/api/hrm/payroll-paid', { payrollId: `calc-${emp.id}-${next}`, paymentMode: 'Cash', record });
    expectStatus(res, 400);
    assert.equal(res.body.error, 'FUTURE_MONTH');
  });

  test('FIN-B-8 a supplier payment stores the supplier\'s own name; FIN-B-9 a new supplier needs a contact number', async () => {
    const v = ok(await post('/api/vendors', { vendorName: `QA Vendor ${Date.now()}`, contactNo: randomPhone(), address: 'QA' })).vendor;
    const pay = ok(await post('/api/payments', { type: 'out', partyType: 'vendor', partyId: v.id, partyName: 'Someone Else', branchId: 'erode-hq', date: await thisMonthDay(), amount: 10, paymentMode: 'Cash' }));
    assert.equal(pay.partyName, v.vendorName);
    for (const contactNo of ['', '123']) {
      const res = await post('/api/vendors', { vendorName: `QA Bare ${Date.now()}${contactNo}`, contactNo, address: '' });
      expectStatus(res, 400, `contact "${contactNo}"`);
      assert.equal(res.body.error, 'BAD_PHONE');
    }
  });
});

describe('round 11: live counts', () => {
  test('FIN-A-5 live updates and /api/sync carry the live bill count, not the stored counter', async () => {
    if (!sql('SELECT 1')) return;
    const date = await thisMonthDay();
    const item = await createItem({ stock: { 'erode-hq': 10 } });
    const phone = randomPhone();
    const a = await mustSell(saleBody({ date, customerName: 'QA Count', customerPhone: phone, lines: [line(item, 1)] }));
    sql(`UPDATE "Customer" SET "purchaseCount"=99 WHERE id='${a.customerId}'`);
    const res = ok(await post('/api/tx/sale', saleBody({ date, customerName: 'QA Count', customerPhone: phone, lines: [line(item, 1)] })));
    sql(`UPDATE "Customer" SET "purchaseCount"=99 WHERE id='${a.customerId}'`);
    assert.equal(res.customers.find((c) => c.id === a.customerId)?.purchaseCount, 2, 'sale reply');
    const sync = ok(await get(`/api/sync?customers=${a.customerId}`));
    assert.equal(sync.customers.find((c) => c.id === a.customerId)?.purchaseCount, 2, '/api/sync');
  });
});

describe('round 11: report arithmetic (unit)', async () => {
  const { importTs } = await import('./lib-ts.mjs');
  const rm = await importTs('src/lib/reportMath.ts');

  test('FIN-A-6 GST collected equals the sum of the bills\' stored totalTax, line figures are whole paisa per bill', async () => {
    // Three lines of ₹0.05 tax and a bill discount: the server stores the tax
    // rounded once per bill (₹0.12 here); summing each line's unrounded share
    // across many bills drifted from Σ bill totalTax.
    const lines = [1, 2, 3].map((i) => ({ id: `l${i}`, itemId: `it${i}`, itemName: 'x', quantity: 1, taxRate: 18, taxableAmount: 0.28, totalTax: 0.05, totalAmount: 0.33 }));
    const bill = (id) => ({ id, branchId: 'erode-hq', date: '2026-10-01', withGst: true, stateOfSupply: '33-Tamil Nadu', subtotal: 0.84, overallDiscountAmount: 0.14, totalTax: 0.12, grandTotal: 0.82, items: lines, returns: [] });
    const bills = [bill('a'), bill('b'), bill('c')];
    const g = rm.gstCollected(bills);
    assert.equal(g.tax, 0.36, `tax ${g.tax}`);
    for (const b of bills) {
      const fig = rm.invoiceFigures(b, () => 0);
      const cents = fig.lines.map((l) => l.tax * 100);
      assert.ok(cents.every((c) => Math.abs(c - Math.round(c)) < 1e-6), `whole paisa ${cents}`);
      assert.equal(Math.round(cents.reduce((t, c) => t + c, 0)), 12);
      assert.equal(Math.round(fig.lines.reduce((t, l) => t + l.taxable, 0) * 100), 70);
    }
    // Real bills saved by the server with a bill discount.
    const date = await thisMonthDay();
    const item = await createItem({ price: 333.33, stock: { 'erode-hq': 50 } });
    const item5 = await createItem({ price: 101.01, gst: 5, stock: { 'erode-hq': 50 } });
    const saved = [];
    for (const d of [3.33, 7.77, 1.11, 9.99]) {
      saved.push(await mustSell({ ...saleBody({ date, lines: [line(item, 1), line(item, 2), line(item5, 1)] }), overallDiscountType: 'amount', overallDiscountValue: d }));
    }
    const stored = Math.round(saved.reduce((t, b) => t + b.totalTax, 0) * 100) / 100;
    assert.equal(rm.gstCollected(saved).tax, stored, 'GST collected = Σ bill totalTax');
  });

  test('FIN-A-7 the printed SGST and CGST put the odd paisa on the same side as the stored bill', async () => {
    const pt = await importTs('src/lib/printTax.ts');
    const server = await importTs('backend/src/lib/taxCalc.ts');
    const r2 = (n) => Math.round(n * 100) / 100;
    for (const [d, a, b] of [[120.46, 2774.97, 666.66], [0, 0.29, 0.29], [3.33, 101.01, 333.33], [0, 333.33, 101.01]]) {
      const items = [
        { itemHSN: '85371000', taxableAmount: a, taxRate: 18, totalTax: r2(a * 0.18) },
        { itemHSN: '85371000', taxableAmount: b, taxRate: 5, totalTax: r2(b * 0.05) },
      ];
      const t = server.calculateInvoiceTotals(items, true, 'amount', d, 0, false);
      const rows = pt.supplyTaxRows(items, t.overallDiscountAmount, t.subtotal, false, t.totalTax);
      const sum = (type) => r2(rows.filter((r) => r.taxType === type).reduce((x, r) => x + r.taxAmount, 0));
      assert.equal(sum('SGST'), t.totalSgst, `SGST ${JSON.stringify(rows)} vs ${t.totalSgst}`);
      assert.equal(sum('CGST'), t.totalCgst, 'CGST');
      const hsn = pt.hsnRateSummary(items, t.overallDiscountAmount, t.subtotal, false, t.totalTax);
      assert.equal(r2(hsn.reduce((x, h) => x + h.sgst, 0)), t.totalSgst, 'HSN SGST');
      assert.equal(r2(hsn.reduce((x, h) => x + h.cgst, 0)), t.totalCgst, 'HSN CGST');
    }
  });
});

describe('round 11: access matrix', () => {
  test('FIN-A-8 a role sent without flags keeps its current billing flags', async () => {
    const before = ok(await get('/api/access-matrix')).matrix;
    assert.ok((before.Billing.flags || []).length > 0, 'Billing has flags to keep');
    try {
      ok(await put('/api/access-matrix', { Billing: { views: before.Billing.views, caps: before.Billing.caps } }), 'no flags in the body');
      assert.deepEqual(ok(await get('/api/access-matrix')).matrix.Billing.flags, before.Billing.flags);
      ok(await put('/api/access-matrix', { Billing: { ...before.Billing, flags: [] } }), 'flags: [] still clears them');
      assert.deepEqual(ok(await get('/api/access-matrix')).matrix.Billing.flags, []);
    } finally {
      ok(await put('/api/access-matrix', before), 'restore');
    }
  });
});

describe('round 11: returns', () => {
  test('FIN-E-5 the reverse-return audit shows money as ₹1,793.60', async () => {
    const date = await thisMonthDay();
    const item = await createItem({ price: 1519.99, stock: { 'erode-hq': 5 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 2)] }));
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', refundMode: 'Cash' }));
    const ret = (await getInvoice(inv.id)).returns.at(-1);
    ok(await post('/api/tx/reverse-return', { invoiceId: inv.id, returnId: ret.id }));
    const rows = ok(await get(`/api/audit?entity=invoice&entityId=${encodeURIComponent(inv.id)}`));
    const row = rows.find((a) => a.action === 'sale.return-reverse');
    assert.ok(row, 'audit row');
    assert.match(row.summary, /· ₹1,793\.59 · .*refund ₹1,793\.59 removed/, row.summary);
  });
});

describe('round 11: enquiries', () => {
  test('ACT-1 an enquiry\'s createdAt is the server\'s clock; editing an enquiry saves (no 400)', async () => {
    const item = await createItem({ stock: { 'erode-hq': 10 } });
    const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const id = `enq-qa-${Date.now()}`;
    const enquiry = { id, customerName: 'QA Enq', customerPhone: randomPhone(), itemId: item.id, itemName: item.itemName, unit: 'PCS', quantity: 1,
      branchId: 'erode-hq', date: today, time: '10:30', createdAt: '2019-01-01T00:00:00.000Z' };
    const snap = ok(await post('/api/enquiry/save', { enquiry }, 'Sales'));
    const saved = snap.enquiries.find((e) => e.id === id);
    assert.ok(Date.now() - Date.parse(saved.createdAt) < 10 * 60 * 1000, `createdAt ${saved.createdAt}`);
    const edited = ok(await post('/api/enquiry/save', { enquiry: { ...saved, notes: 'QA edited', status: undefined } }, 'Sales'), 'edit');
    const after = edited.enquiries.find((e) => e.id === id);
    assert.equal(after.notes, 'QA edited');
    assert.equal(after.status, saved.status);
    assert.equal(after.createdAt, saved.createdAt);
  });
});

describe('round 11: purchases', async () => {
  const { importTs } = await import('./lib-ts.mjs');
  const retry = await importTs('backend/src/lib/retry.ts');

  test('FIN-B-3 PO receipts at the same time as sales all land (a timed-out try is retried)', async () => {
    assert.equal(retry.isRetryableTxError({ code: 'P2028', message: 'Transaction already closed: timeout' }), true);
    const items = [await createItem({ stock: { 'erode-hq': 100 } }), await createItem({ stock: { 'erode-hq': 100 } }), await createItem({ stock: { 'erode-hq': 100 } })];
    const pos = [];
    for (let i = 0; i < 6; i++) pos.push(await createPO(items.map((item) => ({ item, qty: 5, price: 100, tax: 18 }))));
    const date = await thisMonthDay();
    const res = await Promise.all([
      ...pos.map((po, i) => post('/api/purchase/receive', { poId: po.id, receipts: (i % 2 ? items : [...items].reverse()).map((it) => ({ itemId: it.id, quantityReceived: 5, taxPercent: 18 })), actor: 'QA' }, i % 2 ? 'CEO' : 'Purchase')),
      ...[0, 1, 2, 3].map((i) => post('/api/tx/sale', saleBody({ date, lines: (i % 2 ? items : [...items].reverse()).map((it) => line(it, 1)) }), 'Billing')),
    ]);
    assert.deepEqual(res.map((r) => r.status), res.map(() => 200), JSON.stringify(res.filter((r) => r.status !== 200).map((r) => r.body)).slice(0, 300));
    for (const it of items) assert.equal(await stockOf(it.id, 'erode-hq'), 100 + 30 - 4);
  });

  test('FIN-B-5 a PO line GST must be a real slab; a PO of only 0% lines takes no GST on its bill', async () => {
    const item = await createItem({ price: 300, purchasePrice: 100, stock: {} });
    const v = (await get('/api/vendors')).body[0];
    const po = (tax) => ({ vendorId: v.id, vendorName: v.vendorName, branchId: 'erode-hq', date: '2026-09-15', expectedDeliveryDate: '2026-09-30', totalAmount: 0, notes: 'QA',
      items: [{ itemId: item.id, itemName: item.itemName, itemCode: item.itemCode, quantityOrdered: 10, receivedQuantity: 0, purchasePrice: 100, taxPercent: tax }] });
    const bad = await post('/api/purchase/save', { po: po(7), actor: 'QA' });
    expectStatus(bad, 400, '7% GST');
    assert.equal(bad.body.error, 'BAD_TAX');
    const zero = ok(await post('/api/purchase/save', { po: po(0), actor: 'QA' }), '0% PO').saved;
    const res = await post('/api/purchase/bill', { poId: zero.id, bill: { number: `B0-${Date.now()}`, date: '2026-09-16', taxable: 1000, gst: 180 } });
    expectStatus(res, 400, 'GST on a 0% PO');
    ok(await post('/api/purchase/bill', { poId: zero.id, bill: { number: `B0-${Date.now()}x`, date: '2026-09-16', taxable: 1000, gst: 0 } }), 'no GST');
  });
});

describe('round 11: errors', () => {
  test('ERR-1 a generic GET of an unknown id is a 404', async () => {
    for (const p of ['/api/invoices/inv-nope', '/api/payroll-records/pay-nope', '/api/purchase-orders/po-nope']) {
      const res = await get(p);
      expectStatus(res, 404, p);
    }
  });
});
