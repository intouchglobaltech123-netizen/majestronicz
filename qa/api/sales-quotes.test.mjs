// Sales, quotes, returns, voids and deletes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  post, get, put, del, ok, expectStatus, near, uid, createItem, stockOf, line, comboLine, createCombo, saleBody, sell,
  mustSell, getInvoice, resave, returnLine, receive, freshDay, thisMonthDay, freshDays, utcToday, together, paymentsFor,
  serviceLine, randomPhone, istToday, addDays, sql, ledgerOf,
} from './lib.mjs';

async function createQuote(item, qty, branchId = 'erode-hq', date, extra = {}) {
  const id = `est-qa-${uid()}`;
  const body = ok(await post('/api/catalog/estimate', {
    id, branchId, date, time: '10:00', customerName: 'QA Quote Customer', withGst: true,
    items: [{ id: `li-${uid()}`, itemId: item.id, itemName: item.itemName, itemCode: item.itemCode, itemHSN: item.itemHSN,
      unit: 'PCS', quantity: qty, unitPrice: item.salePrice, gstRate: item.gstTaxSlab }],
    termsAndConditions: 'QA', ...extra,
  }), 'create quote');
  return body.estimates.find((e) => e.id === id);
}

describe('sales & quotes', () => {
  test('SAL3-1 a quote converts to an invoice only once', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 20 } });
    const quote = await createQuote(item, 2, 'erode-hq', date);
    const mk = () => saleBody({ date, lines: [line(item, 2)], sourceEstimateId: quote.id, sourceEstimateNumber: quote.estimateNumber });
    ok((await sell(mk())).res, 'first conversion');
    const second = await sell(mk());
    expectStatus(second.res, 409, 'second conversion');
    assert.equal(await stockOf(item.id, 'erode-hq'), 18, 'stock taken once');
  });

  test('SAL3-1 five cashiers converting the same quote at once create one invoice', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 20 } });
    const quote = await createQuote(item, 2, 'erode-hq', date);
    const results = await together(5, () => sell(saleBody({ date, lines: [line(item, 2)], sourceEstimateId: quote.id })));
    const wins = results.filter((r) => r.res.status === 200).length;
    assert.equal(wins, 1, `expected 1 conversion, got ${wins} (${results.map((r) => r.res.status).join(',')})`);
    const invs = ok(await get('/api/invoices')).filter((i) => i.sourceEstimateId === quote.id);
    assert.equal(invs.length, 1, 'invoices created from the quote');
    assert.equal(await stockOf(item.id, 'erode-hq'), 18, 'stock taken once');
  });

  test('SAL3-1 a voided conversion frees the quote to be converted again', async () => {
    const date = await thisMonthDay();
    const item = await createItem({ stock: { 'erode-hq': 20 } });
    const quote = await createQuote(item, 1, 'erode-hq', date);
    const first = await mustSell(saleBody({ date, lines: [line(item, 1)], sourceEstimateId: quote.id }));
    ok(await post('/api/tx/void-invoice', { invoiceId: first.id, reason: 'QA', actor: 'QA' }), 'void');
    ok((await sell(saleBody({ date, lines: [line(item, 1)], sourceEstimateId: quote.id }))).res, 'reconvert after void');
  });

  test('SAL-5 a quote with discount and shipping converts at the same total', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ price: 1000, stock: { 'erode-hq': 10 } });
    const id = `est-qa-${uid()}`;
    const est = ok(await post('/api/catalog/estimate', {
      id, branchId: 'erode-hq', date, time: '10:00', customerName: 'QA', withGst: true,
      items: [{ id: 'l1', itemId: item.id, itemName: item.itemName, unit: 'PCS', quantity: 3, unitPrice: 1000, gstRate: 18 }],
      overallDiscountType: '%', overallDiscountValue: 10, shippingCharges: 150, roundOffEnabled: false, termsAndConditions: 'QA',
    })).estimates.find((e) => e.id === id);
    const inv = await mustSell(saleBody({
      date, lines: [line(item, 3)], overallDiscountValue: 10, shippingCharges: 150, sourceEstimateId: est.id,
    }));
    near(inv.grandTotal, est.grandTotal, 'invoice total vs quote total');
    near(est.grandTotal, 2700 + 486 + 150, 'quote total = 2700 taxable + 486 GST + 150 shipping');
  });

  test('SAL-1 selling more than the branch holds is refused', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 3 } });
    const { res } = await sell(saleBody({ date, lines: [line(item, 5)] }));
    expectStatus(res, 400);
    assert.equal(res.body.error, 'INSUFFICIENT_STOCK');
    assert.equal(await stockOf(item.id, 'erode-hq'), 3);
  });

  test('SAL-1 simultaneous sales never oversell', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const results = await together(4, () => sell(saleBody({ date, lines: [line(item, 2)] })));
    const wins = results.filter((r) => r.res.status === 200).length;
    const left = await stockOf(item.id, 'erode-hq');
    assert.ok(wins <= 2, `at most 2 sales of 2 fit in 5, got ${wins}`);
    assert.equal(left, 5 - 2 * wins, 'stock matches the sales that went through');
    assert.ok(left >= 0, 'stock never negative');
  });

  test('SAL2-1 two cashiers saving at once get separate bills and numbers', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 10 } });
    const fixedId = `inv-qa-same-${uid()}`; // the browser used to mint the same id in the same millisecond
    const results = await together(3, () => sell(saleBody({ id: fixedId, date, lines: [line(item, 1)] })));
    for (const r of results) ok(r.res, 'sale');
    const nums = new Set(results.map((r) => r.inv.invoiceNumber));
    const ids = new Set(results.map((r) => r.inv.id));
    assert.equal(nums.size, 3, 'distinct invoice numbers');
    assert.equal(ids.size, 3, 'distinct invoice ids');
    assert.equal(await stockOf(item.id, 'erode-hq'), 7);
  });

  test('SAL2-8 a zero or negative quantity is refused', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 10 } });
    expectStatus((await sell(saleBody({ date, lines: [line(item, 0)] }))).res, 400, 'qty 0');
    expectStatus((await sell(saleBody({ date, lines: [line(item, -3)] }))).res, 400, 'qty -3');
    assert.equal(await stockOf(item.id, 'erode-hq'), 10);
  });

  test('SAL2-6 editing a bill keeps its branch and number', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 10, chennai: 10 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 1)] }));
    ok(await resave(inv, { branchId: 'chennai', invoiceNumber: 'HACKED-1' }), 'edit');
    const after = await getInvoice(inv.id);
    assert.equal(after.branchId, 'erode-hq');
    assert.equal(after.invoiceNumber, inv.invoiceNumber);
    assert.equal(await stockOf(item.id, 'chennai'), 10, 'other branch stock untouched');
  });

  test('SAL3-2 a bill with a return cannot be edited (no stock is created)', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 10 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 2)] }));
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 2)], reason: 'QA', actor: 'QA', refundMode: 'Cash' }));
    assert.equal(await stockOf(item.id, 'erode-hq'), 10);
    const edited = await getInvoice(inv.id);
    const res = await resave(edited, { items: [line(item, 1)] });
    expectStatus(res, 409, 'edit after return');
    assert.equal(await stockOf(item.id, 'erode-hq'), 10, 'stock unchanged');
  });

  test('SAL5-3 void after a partial return of an item on two lines restores the rest of the stock', async () => {
    const date = await thisMonthDay();
    const item = await createItem({ stock: { 'erode-hq': 40 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 1), line(item, 1)] }));
    assert.equal(await stockOf(item.id, 'erode-hq'), 38);
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', actor: 'QA', refundMode: 'Cash' }));
    assert.equal(await stockOf(item.id, 'erode-hq'), 39);
    ok(await post('/api/tx/void-invoice', { invoiceId: inv.id, reason: 'QA', actor: 'QA' }));
    assert.equal(await stockOf(item.id, 'erode-hq'), 40, 'all units back after void');
  });

  test('SAL5-3 delete after a partial return of an item on two lines restores the rest of the stock', async () => {
    const date = await thisMonthDay();
    const item = await createItem({ stock: { 'erode-hq': 40 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 1), line(item, 1)] }));
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', actor: 'QA', refundMode: 'Cash' }));
    ok(await del(`/api/tx/invoice/${inv.id}`));
    assert.equal(await stockOf(item.id, 'erode-hq'), 40, 'all units back after delete');
  });

  test('SAL2-7 deleting a voided bill does not add stock back twice', async () => {
    const date = await thisMonthDay();
    const item = await createItem({ stock: { 'erode-hq': 10 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 3)] }));
    ok(await post('/api/tx/void-invoice', { invoiceId: inv.id, reason: 'QA', actor: 'QA' }));
    assert.equal(await stockOf(item.id, 'erode-hq'), 10);
    ok(await del(`/api/tx/invoice/${inv.id}`));
    assert.equal(await stockOf(item.id, 'erode-hq'), 10);
  });

  test('SAL2-4 returns are capped at what was sold, also when sent at the same time', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 10 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 2)] }));
    expectStatus(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 3)], reason: 'QA', actor: 'QA' }), 400, 'over-return');
    const results = await together(4, () => post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', actor: 'QA' }));
    assert.equal(results.filter((r) => r.status === 200).length, 2, 'only 2 units can come back');
    assert.equal(await stockOf(item.id, 'erode-hq'), 10);
    const after = await getInvoice(inv.id);
    assert.equal(after.returns.reduce((s, r) => s + r.returnedQuantity, 0), 2);
  });

  test('SAL-2 a refund reflects the line discount', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ price: 1000, stock: { 'erode-hq': 10 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 2, { discountValue: 50 })] }));
    near(inv.grandTotal, 1180, 'bill total (2 x 1000, 50% off, 18% GST)');
    const res = ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', actor: 'QA', refundMode: 'Cash' }));
    const after = res.invoices.find((i) => i.id === inv.id);
    near(after.totalReturnedAmount, 590, 'refund for one unit');
  });

  test('SAL2-11 the same item on two lines at different prices refunds the average, not the higher line', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ price: 100, stock: { 'erode-hq': 10 } });
    // Two lines of the SAME item: 1 @ 100 and 1 @ 300 (18% GST → 118 + 354 = 472).
    const inv = await mustSell(saleBody({ date, lines: [line(item, 1, { price: 100 }), line(item, 1, { price: 300 })] }));
    near(inv.grandTotal, 472, 'bill total');
    // Returning one unit can't know which line it came from → refund the average
    // per-unit (236), never the higher line's 354 (the old first-line-wins bug).
    const r1 = ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', actor: 'QA', refundMode: 'Cash' }));
    near(r1.invoices.find((i) => i.id === inv.id).totalReturnedAmount, 236, 'first unit refunds the average');
    // Returning the second unit brings the running total to exactly the bill value.
    const r2 = ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', actor: 'QA', refundMode: 'Cash' }));
    near(r2.invoices.find((i) => i.id === inv.id).totalReturnedAmount, 472, 'both units refund the full bill');
  });

  test('SAL5-4 voiding a bill after a cash refund removes the refund row (drawer not left short)', async () => {
    const date = await thisMonthDay();
    const item = await createItem({ price: 1000, stock: { 'erode-hq': 10 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 2)] })); // paid cash, 2360
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', actor: 'QA', refundMode: 'Cash' }), 'return');
    assert.ok((await paymentsFor(inv.id)).some((p) => p.type === 'out'), 'a refund row exists after the return');
    ok(await post('/api/tx/void-invoice', { invoiceId: inv.id, reason: 'QA', actor: 'QA' }), 'void');
    assert.equal((await paymentsFor(inv.id)).filter((p) => p.type === 'out').length, 0, 'the refund row is gone after void');
    assert.equal(await stockOf(item.id, 'erode-hq'), 10, 'all stock restored');
  });

  test('SAL5-4 deleting a bill after a cash refund removes the refund row', async () => {
    const date = await thisMonthDay();
    const item = await createItem({ price: 1000, stock: { 'erode-hq': 10 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 2)] }));
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', actor: 'QA', refundMode: 'Cash' }), 'return');
    assert.ok((await paymentsFor(inv.id)).some((p) => p.type === 'out'), 'a refund row exists after the return');
    ok(await del(`/api/tx/invoice/${inv.id}`), 'delete');
    assert.equal((await paymentsFor(inv.id)).filter((p) => p.type === 'out').length, 0, 'the refund row is gone after delete');
    assert.equal(await stockOf(item.id, 'erode-hq'), 10, 'all stock restored');
  });

  test('INV3-3 a combo sale takes the stored combo parts, not the parts sent by the browser', async () => {
    const date = await freshDay('erode-hq');
    const a = await createItem({ stock: { 'erode-hq': 20 } });
    const b = await createItem({ stock: { 'erode-hq': 20 } });
    const combo = await createCombo([{ item: a, qty: 2 }, { item: b, qty: 1 }]);
    // The request claims the kit uses none of item A.
    const tampered = [{ itemId: a.id, quantity: 0 }, { itemId: b.id, quantity: 1 }];
    await mustSell(saleBody({ date, lines: [comboLine(combo, 1, tampered)] }), 'Billing');
    assert.equal(await stockOf(a.id, 'erode-hq'), 18, 'item A goes down by the stored 2 per kit');
    assert.equal(await stockOf(b.id, 'erode-hq'), 19);
  });

  test('INV3-3 a combo sale with negative component quantities never creates stock', async () => {
    const date = await freshDay('erode-hq');
    const a = await createItem({ stock: { 'erode-hq': 20 } });
    const combo = await createCombo([{ item: a, qty: 1 }]);
    await sell(saleBody({ date, lines: [comboLine(combo, 1, [{ itemId: a.id, quantity: -50 }])] }), 'Billing');
    assert.ok(await stockOf(a.id, 'erode-hq') <= 20, 'stock must not grow from a sale');
  });

  test('E2E6-1 a Credit bill sent with the default Cash split is saved as money owed, not cash', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ price: 1000, stock: { 'erode-hq': 10 } });
    const inv = await mustSell(saleBody({ date, transactionType: 'Credit', lines: [line(item, 1)], splits: [{ mode: 'Cash', amount: 1180 }] }));
    near(inv.balanceDue, 1180, 'balance due');
    const cash = (inv.paymentSplits || []).filter((s) => s.mode === 'Cash').reduce((t, s) => t + s.amount, 0);
    assert.equal(cash, 0, 'no cash counted for a credit bill');
  });

  test('SAL4-4 re-saving a paid credit bill does not bring the debt back', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ price: 1000, stock: { 'erode-hq': 10 } });
    const inv = await mustSell(saleBody({ date, transactionType: 'Credit', lines: [line(item, 1)], splits: [{ mode: 'COD-Credit', amount: 1180 }] }));
    ok(await receive(inv, 1180), 'receipt');
    near((await getInvoice(inv.id)).balanceDue, 0, 'paid');
    // The browser re-sends the bill with its ORIGINAL (unsettled) split.
    ok(await resave(inv, { paymentSplits: [{ mode: 'COD-Credit', amount: 1180 }], balanceDue: 1180 }), 'edit');
    near((await getInvoice(inv.id)).balanceDue, 0, 'still paid after edit');
  });

  test('SAL4-4 re-saving a part-paid credit bill keeps the receipt applied and adds no cash', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ price: 1000, stock: { 'erode-hq': 10 } });
    const inv = await mustSell(saleBody({ date, transactionType: 'Credit', lines: [line(item, 2)], splits: [{ mode: 'COD-Credit', amount: 2360 }] }));
    ok(await receive(inv, 500), 'part receipt');
    ok(await resave(inv, { paymentSplits: [{ mode: 'Cash', amount: 2360 }], transactionType: 'Cash' }), 'edit');
    const after = await getInvoice(inv.id);
    near(after.balanceDue, 1860, 'due after edit');
    const cash = (after.paymentSplits || []).filter((s) => s.mode === 'Cash').reduce((t, s) => t + s.amount, 0);
    assert.equal(cash, 0, 'edit must not invent cash on the bill');
  });

  test('QA8-1 (new) editing a paid cash bill to a higher total records the new payment instead of a hidden due', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ price: 1000, stock: { 'erode-hq': 10 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 2)], splits: [{ mode: 'Cash', amount: 2360 }] }));
    // The billing screen re-sends the bill with qty 3 and the cash split for the new total.
    ok(await resave(inv, { items: [line(item, 3)], paymentSplits: [{ mode: 'Cash', amount: 3540 }], paymentMode: 'Cash' }), 'edit');
    const after = await getInvoice(inv.id);
    near(after.grandTotal, 3540);
    const splitSum = (after.paymentSplits || []).reduce((t, s) => t + s.amount, 0);
    near(splitSum, after.grandTotal, `payment split ${JSON.stringify(after.paymentSplits)} vs total`);
    near(after.balanceDue, 0, 'a cash bill must not show money owed after an edit');
  });

  test('CASH-2 a bill on a closed day cannot be voided, deleted or added', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 10 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 1)] }));
    ok(await post('/api/cash/close', { branchId: 'erode-hq', date, actor: 'QA' }), 'close day');
    expectStatus(await post('/api/tx/void-invoice', { invoiceId: inv.id, reason: 'QA', actor: 'QA' }), 409, 'void');
    expectStatus(await del(`/api/tx/invoice/${inv.id}`), 409, 'delete');
    expectStatus((await sell(saleBody({ date, lines: [line(item, 1)] }))).res, 409, 'new sale');
    assert.equal(await stockOf(item.id, 'erode-hq'), 9);
  });

  test('SAL4-12 a bill from a closed day can be returned; the refund is booked on the return day', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ price: 1000, stock: { 'erode-hq': 10 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 1)] }));
    ok(await post('/api/cash/close', { branchId: 'erode-hq', date, actor: 'QA' }), 'close day');
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', actor: 'QA', refundMode: 'Cash' }), 'return');
    const refund = (await paymentsFor(inv.id)).find((p) => p.type === 'out');
    assert.ok(refund, 'a refund row exists');
    assert.equal(refund.date, utcToday(), 'refund dated on the return day');
    assert.notEqual(refund.date, date, 'closed day is not changed');
    near(refund.amount, 1180);
    assert.equal(await stockOf(item.id, 'erode-hq'), 10);
  });

  test('E2E5-6 a refund records how it was paid', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ price: 1000, stock: { 'erode-hq': 10 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 1)], splits: [{ mode: 'GPay', amount: 1180 }] }));
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', actor: 'QA', refundMode: 'GPay' }));
    const refund = (await paymentsFor(inv.id)).find((p) => p.type === 'out');
    assert.equal(refund?.paymentMode, 'GPay');
  });

  test('SAL6-1 a return on a part-cash part-credit bill reduces what is owed before taking cash from the drawer', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ price: 950, stock: { 'erode-hq': 10 } });
    // 2 x 950 + 18% = 2,242: Cash 1,000 now, 1,242 on credit.
    const inv = await mustSell(saleBody({ date, transactionType: 'Credit', lines: [line(item, 2)],
      splits: [{ mode: 'Cash', amount: 1000 }, { mode: 'COD-Credit', amount: 1242 }] }));
    near(inv.balanceDue, 1242, 'due before return');
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', actor: 'QA', refundMode: 'Cash' }));
    const after = await getInvoice(inv.id);
    near(after.balanceDue, 121, 'due after returning a 1,121 unit');
    const cashRefund = (await paymentsFor(inv.id)).filter((p) => p.type === 'out' && p.paymentMode === 'Cash').reduce((t, p) => t + p.amount, 0);
    assert.equal(cashRefund, 0, `no cash should leave the drawer (customer still owes), but ${cashRefund} was booked as a cash refund`);
  });

  test('SEC-6 Billing cannot void or permanently delete a bill', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 10 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 1)] }), 'Billing');
    expectStatus(await post('/api/tx/void-invoice', { invoiceId: inv.id, reason: 'QA', actor: 'QA' }, 'Billing'), 403, 'Billing void');
    expectStatus(await del(`/api/tx/invoice/${inv.id}`, 'Billing'), 403, 'Billing delete');
  });

  test('CASH-2 a bill cannot be re-dated off a closed cash day', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 10 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 1)] }));
    ok(await post('/api/cash/close', { branchId: 'erode-hq', date, actor: 'QA' }), 'close the bill day');
    const other = await freshDay('erode-hq');
    const stored = await getInvoice(inv.id);
    expectStatus(await resave(stored, { date: other }), 409, 'moving the bill off a closed day');
  });

  test('SAL4-9 deleting the newest bill does not let its number be reused', async () => {
    const date = await thisMonthDay();
    const item = await createItem({ stock: { chennai: 10 } });
    const a = await mustSell(saleBody({ branchId: 'chennai', date, lines: [line(item, 1)] }));
    ok(await del(`/api/tx/invoice/${a.id}`), 'delete newest bill');
    const b = await mustSell(saleBody({ branchId: 'chennai', date, lines: [line(item, 1)] }));
    assert.notEqual(b.invoiceNumber, a.invoiceNumber, 'invoice numbers must never be reissued');
  });
});

// ---------------------------------------------------------------- round 8: quotes, validation, reverse return

const quoteBody = (item, over = {}, lineOver = {}) => ({
  id: `est-qa-${uid()}`, branchId: 'erode-hq', date: '2026-09-20', time: '10:00', customerName: 'QA Quote', withGst: true,
  items: [{ id: `li-${uid()}`, itemId: item.id, itemName: item.itemName, itemCode: item.itemCode, unit: 'PCS', quantity: 1,
    unitPrice: item.salePrice, gstRate: item.gstTaxSlab, ...lineOver }],
  termsAndConditions: 'QA', ...over,
});
const estimates = async () => ok(await get('/api/estimates'), 'estimates');
const auditRows = async (entityId) => ok(await get(`/api/audit?entity=invoice&entityId=${encodeURIComponent(entityId)}`), 'audit');
const reverse = (invoiceId, returnId, as = 'CEO') => post('/api/tx/reverse-return', { invoiceId, returnId }, as);
const lastReturn = (inv) => inv.returns[inv.returns.length - 1];

describe('quotes and bills (round 8)', () => {
  test('SAL8-3 a quote can only be deleted by the CEO, never once converted', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const q = await createQuote(item, 1, 'erode-hq', date);
    expectStatus(await del(`/api/catalog/estimate/${q.id}`, 'Billing'), 403, 'Billing delete');
    expectStatus(await del(`/api/catalog/estimate/${q.id}`, 'Manager'), 403, 'Coimbatore Manager deletes an Erode quote');
    const conv = await createQuote(item, 1, 'erode-hq', date);
    await mustSell(saleBody({ date, lines: [line(item, 1)], sourceEstimateId: conv.id }));
    expectStatus(await del(`/api/catalog/estimate/${conv.id}`), 409, 'CEO deletes a converted quote');
    ok(await del(`/api/catalog/estimate/${q.id}`), 'CEO deletes an open quote');
    assert.ok(!(await estimates()).some((e) => e.id === q.id));
    assert.ok((await estimates()).some((e) => e.id === conv.id), 'converted quote kept');
  });

  test('SAL8-2 a bill cannot be made from a missing, cancelled or other-branch quote', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 10, coimbatore: 10 } });
    const missing = await sell(saleBody({ date, lines: [line(item, 1)], sourceEstimateId: 'est-does-not-exist' }));
    expectStatus(missing.res, 400, 'made-up quote');
    const cancelled = await createQuote(item, 1, 'erode-hq', date);
    ok(await post(`/api/catalog/estimate/${cancelled.id}/cancel`, { reason: 'QA' }), 'cancel quote');
    const c = await sell(saleBody({ date, lines: [line(item, 1)], sourceEstimateId: cancelled.id }));
    expectStatus(c.res, 409, 'cancelled quote');
    assert.equal(c.res.body.error, 'QUOTE_CANCELLED');
    const other = await createQuote(item, 1, 'coimbatore', date);
    const o = await sell(saleBody({ date, lines: [line(item, 1)], sourceEstimateId: other.id }));
    expectStatus(o.res, 400, 'other branch quote');
    assert.equal(await stockOf(item.id, 'erode-hq'), 10, 'no stock moved');
  });

  test('SAL8-10 billing a quote stores it as Converted; voiding the bill reopens it', async () => {
    const date = await thisMonthDay();
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const q = await createQuote(item, 1, 'erode-hq', date);
    const inv = await mustSell(saleBody({ date, lines: [line(item, 1)], sourceEstimateId: q.id }));
    assert.equal((await estimates()).find((e) => e.id === q.id).status, 'Converted');
    ok(await post('/api/tx/void-invoice', { invoiceId: inv.id, reason: 'QA' }), 'void');
    assert.equal((await estimates()).find((e) => e.id === q.id).status, 'Open');
    expectStatus(await post(`/api/catalog/estimate/${q.id}/cancel`, { reason: 'QA' }), 200, 'an Open quote can be cancelled again');
  });

  test('SAL9-14 a quotation cannot be cancelled without a reason', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const q = await createQuote(item, 1, 'erode-hq', date);
    for (const reason of [undefined, '', '   ']) {
      expectStatus(await post(`/api/catalog/estimate/${q.id}/cancel`, reason === undefined ? {} : { reason }), 400, `reason ${JSON.stringify(reason)}`);
    }
    assert.equal((await estimates()).find((e) => e.id === q.id).status, 'Open', 'still open');
    ok(await post(`/api/catalog/estimate/${q.id}/cancel`, { reason: '  Customer bought elsewhere ' }), 'cancel with a reason');
    const after = (await estimates()).find((e) => e.id === q.id);
    assert.equal(after.status, 'Cancelled');
    assert.equal(after.cancelReason, 'Customer bought elsewhere');
  });

  test('SAL8-8 quotes get the invoice checks: GST slab, price, discount', async () => {
    const item = await createItem();
    for (const [what, over, lineOver] of [
      ['GST 3%', {}, { gstRate: 3 }],
      ['negative price', {}, { unitPrice: -100 }],
      ['price "abc"', {}, { unitPrice: 'abc' }],
      ['150% line discount', {}, { discountType: '%', discountValue: 150 }],
      ['150% overall discount', { overallDiscountType: '%', overallDiscountValue: 150 }, {}],
      ['0% on an 18% item', {}, { gstRate: 0 }],
    ]) {
      const res = await post('/api/catalog/estimate', quoteBody(item, over, lineOver));
      expectStatus(res, 400, what);
    }
  });

  test('SAL4-5 a sale refuses a GST rate other than the catalogue rate and a non-number price', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ gst: 18, stock: { 'erode-hq': 5 } });
    const zero = await sell(saleBody({ date, lines: [line(item, 1, { taxRate: 0 })] }));
    expectStatus(zero.res, 400, 'rate 0 on an 18% item');
    assert.equal(zero.res.body.error, 'BAD_GST');
    const abc = await sell(saleBody({ date, lines: [line(item, 1, { price: 'abc' })] }));
    expectStatus(abc.res, 400, 'price "abc"');
    const svc = await sell(saleBody({ date, lines: [serviceLine(1, 500, 3)] }));
    expectStatus(svc.res, 400, 'free-text line at 3%');
    await mustSell(saleBody({ date, lines: [serviceLine(1, 500, 0)] }));
    assert.equal(await stockOf(item.id, 'erode-hq'), 5);
  });

  test('SAL8-9 a ₹0 line with no catalogue item is refused', async () => {
    const date = await freshDay('erode-hq');
    const res = (await sell(saleBody({ date, lines: [serviceLine(1, 0)] }))).res;
    expectStatus(res, 400);
    assert.equal(res.body.error, 'ZERO_PRICE_LINE');
  });

  test('SAL2-8 a fractional quantity of a whole-unit item is refused; metres may be fractional', async () => {
    const date = await freshDay('erode-hq');
    const pcs = await createItem({ stock: { 'erode-hq': 10 } });
    const half = await sell(saleBody({ date, lines: [line(pcs, 0.5)] }));
    expectStatus(half.res, 400, '0.5 PCS');
    assert.equal(half.res.body.error, 'WHOLE_UNITS');
    assert.equal(await stockOf(pcs.id, 'erode-hq'), 10);
    const cable = await createItem({ unit: 'MTR', stock: { 'erode-hq': 10 } });
    await mustSell(saleBody({ date, lines: [line(cable, 2.5)] }));
    assert.equal(await stockOf(cable.id, 'erode-hq'), 7.5);
  });

  test('SAL3-4 a bill cannot be re-dated into another financial year', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 1)] }));
    const [y, m] = date.split('-').map(Number);
    const otherFy = m >= 4 ? `${y}-03-15` : `${y}-04-15`;
    const res = await resave(await getInvoice(inv.id), { date: otherFy });
    expectStatus(res, 400);
    assert.equal(res.body.error, 'FY_CHANGE');
    assert.equal((await getInvoice(inv.id)).date, date);
  });

  test('SAL2-15 a future-dated bill is refused', async () => {
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    expectStatus((await sell(saleBody({ date: addDays(istToday(), 2), lines: [line(item, 1)] }))).res, 400);
  });

  test('SAL8-5 place of supply: "Tamil Nadu" is intra-state, another state is IGST (bills and quotes)', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const tn = await mustSell(saleBody({ date, lines: [line(item, 1)], stateOfSupply: 'Tamil Nadu' }));
    near(tn.totalCgst, 90, 'CGST'); near(tn.totalSgst, 90, 'SGST');
    const ka = await mustSell(saleBody({ date, lines: [line(item, 1)], stateOfSupply: '29-Karnataka' }));
    near(ka.totalCgst, 0); near(ka.totalSgst, 0); near(ka.totalTax, 180);
    near(ka.items[0].igstAmount, 180, 'line IGST');
    const q = await createQuote(item, 1, 'erode-hq', date, { stateOfSupply: '29-Karnataka' });
    near(q.totalCgst, 0); near(q.totalTax, 180); near(q.items[0].igstAmount, 180);
  });

  test('SAL4-9 deleting a bill writes an audit row with its number, amount and branch', async () => {
    const date = await thisMonthDay();
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 1)] }));
    ok(await del(`/api/tx/invoice/${inv.id}`), 'delete');
    const row = (await auditRows(inv.id)).find((a) => a.action === 'sale.delete');
    assert.ok(row, 'audit row');
    assert.match(row.summary, new RegExp(inv.invoiceNumber.replace(/[/]/g, '\\/')));
    assert.match(row.summary, /₹1180/);
    assert.match(row.summary, /erode-hq/);
  });

  test('E2E8-13 a return on a credit bill reports the due reduced, not a refund', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const inv = await mustSell(saleBody({ date, transactionType: 'Credit', customerPhone: randomPhone(), lines: [line(item, 2)], splits: [{ mode: 'COD-Credit', amount: 2360 }] }));
    const r = ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA' }));
    near(r.returnSummary.cashRefund, 0, 'nothing paid back');
    near(r.returnSummary.dueReduced, 1180, 'due reduced');
    assert.equal(r.returnSummary.restockedUnits, 1);
  });

  test('E2E-15 a damaged return reports units written off, none restocked', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 2)] }));
    const r = ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'Damaged on arrival', refundMode: 'Cash' }));
    assert.equal(r.returnSummary.restockedUnits, 0);
    assert.equal(r.returnSummary.writtenOffUnits, 1);
    assert.equal(r.returnSummary.damaged, true);
    assert.equal(await stockOf(item.id, 'erode-hq'), 3);
  });
});

describe('reverse return (SAL3-2)', () => {
  test('SAL3-2 reversing a cash return takes the stock back out, removes the refund and lets the bill be edited', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 2)] }));
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', refundMode: 'Cash' }));
    assert.equal(await stockOf(item.id, 'erode-hq'), 4);
    assert.equal((await paymentsFor(inv.id)).filter((p) => p.type === 'out').length, 1, 'refund row');
    const returned = await getInvoice(inv.id);
    expectStatus(await resave(returned), 409, 'edit refused while the return stands');
    const res = ok(await reverse(inv.id, lastReturn(returned).id), 'reverse');
    assert.equal(res.reversed.refund.kind, 'deleted');
    assert.equal(await stockOf(item.id, 'erode-hq'), 3, 'stock back out');
    assert.equal((await paymentsFor(inv.id)).filter((p) => p.type === 'out').length, 0, 'refund removed (its day is open)');
    const after = await getInvoice(inv.id);
    assert.equal(after.returns.length, 0);
    near(after.totalReturnedAmount, 0);
    near(after.balanceDue, 0);
    const hist = (await ledgerOf(item.id, 'erode-hq')).filter((l) => l.reason === 'Sales Return Reversed');
    assert.equal(hist.length, 1); near(hist[0].quantityChange, -1);
    assert.ok((await auditRows(inv.id)).some((a) => a.action === 'sale.return-reverse'), 'audit row');
    // (An edit BELOW the collected total on a walk-in is refused — CRM9-5.)
    ok(await resave(after, { items: [line(item, 3)] }), 'edit allowed again');
    assert.equal(await stockOf(item.id, 'erode-hq'), 2);
  });

  test('SAL3-2 reversing a damaged return changes no stock', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 2)] }));
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'Damaged', refundMode: 'Cash' }));
    assert.equal(await stockOf(item.id, 'erode-hq'), 3);
    ok(await reverse(inv.id, lastReturn(await getInvoice(inv.id)).id));
    assert.equal(await stockOf(item.id, 'erode-hq'), 3);
    assert.equal((await paymentsFor(inv.id)).filter((p) => p.type === 'out').length, 0);
  });

  test('SAL3-2 reversing a return on a credit bill restores the due', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const inv = await mustSell(saleBody({ date, transactionType: 'Credit', customerPhone: randomPhone(), lines: [line(item, 2)], splits: [{ mode: 'COD-Credit', amount: 2360 }] }));
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA' }));
    near((await getInvoice(inv.id)).balanceDue, 1180);
    ok(await reverse(inv.id, lastReturn(await getInvoice(inv.id)).id));
    near((await getInvoice(inv.id)).balanceDue, 2360, 'due restored');
    assert.equal(await stockOf(item.id, 'erode-hq'), 3);
  });

  test('SAL3-2 a credit-note return is reversed off the store credit, refused once spent', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const mk = async () => {
      const inv = await mustSell(saleBody({ date, customerName: 'QA credit note', customerPhone: randomPhone(), lines: [line(item, 1)] }));
      ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', refundMode: 'Adjust to credit note' }));
      return getInvoice(inv.id);
    };
    const credit = async (id) => ok(await get('/api/customers')).find((c) => c.id === id).creditBalance || 0;
    const a = await mk();
    near(await credit(a.customerId), 1180);
    ok(await reverse(a.id, lastReturn(a).id), 'reverse');
    near(await credit(a.customerId), 0, 'credit taken back');
    const b = await mk();
    ok(await post(`/api/catalog/customer/${b.customerId}/credit`, { amount: -1000, reason: 'QA spend' }), 'spend credit');
    const res = await reverse(b.id, lastReturn(b).id);
    expectStatus(res, 409, 'credit already spent');
    assert.equal(res.body.error, 'CREDIT_SPENT');
    assert.equal((await getInvoice(b.id)).returns.length, 1, 'return kept');
  });

  test('SAL3-2 only Manager/CEO of the bill branch may reverse, and newest return first', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 3)] }));
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', refundMode: 'Cash' }));
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', refundMode: 'Cash' }));
    const cur = await getInvoice(inv.id);
    expectStatus(await reverse(inv.id, cur.returns[1].id, 'Billing'), 403, 'Billing');
    expectStatus(await reverse(inv.id, cur.returns[1].id, 'Manager'), 403, 'Coimbatore Manager on an Erode bill');
    expectStatus(await reverse(inv.id, cur.returns[0].id), 409, 'older return first');
    ok(await reverse(inv.id, cur.returns[1].id), 'newest');
    ok(await reverse(inv.id, cur.returns[0].id), 'then the older one');
    assert.equal(await stockOf(item.id, 'erode-hq'), 2);
  });

  test('SAL3-2 a refund paid today cannot be reversed while today is closed', async () => {
    const date = await freshDay('chennai');
    const item = await createItem({ stock: { chennai: 5 } });
    const inv = await mustSell(saleBody({ branchId: 'chennai', date, lines: [line(item, 1)] }));
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', refundMode: 'Cash' }));
    const today = istToday();
    ok(await post('/api/cash/close', { branchId: 'chennai', date: today, actor: 'QA' }), 'close today');
    try {
      expectStatus(await reverse(inv.id, lastReturn(await getInvoice(inv.id)).id), 409, 'today closed');
      assert.equal(await stockOf(item.id, 'chennai'), 5, 'nothing changed');
    } finally {
      ok(await post('/api/cash/reopen', { branchId: 'chennai', date: today }), 'reopen today');
    }
  });

  test('SAL3-2 a refund from a closed earlier day is taken back as a receipt today', { skip: !process.env.DATABASE_URL && 'needs DATABASE_URL' }, async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 1)] }));
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', refundMode: 'Cash' }));
    const refund = (await paymentsFor(inv.id)).find((p) => p.type === 'out');
    sql(`UPDATE "Payment" SET "date" = '${date}' WHERE "id" = '${refund.id}'`);
    ok(await post('/api/cash/close', { branchId: 'erode-hq', date, actor: 'QA' }), 'close the refund day');
    const res = ok(await reverse(inv.id, lastReturn(await getInvoice(inv.id)).id), 'reverse');
    assert.equal(res.reversed.refund.kind, 'collected');
    const rows = await paymentsFor(inv.id);
    assert.ok(rows.some((p) => p.id === refund.id), 'the closed day keeps its refund');
    const back = rows.find((p) => p.type === 'in');
    assert.ok(back, 'refund taken back as a receipt');
    assert.equal(back.date, istToday());
    near(back.amount, refund.amount);
    near((await getInvoice(inv.id)).balanceDue, 0, 'nothing owed');
  });
});

describe('round 9: sales', () => {
  test('SAL9-2 a bill accepts only Cash, GPay, HDFC or COD-Credit as payment modes', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    for (const mode of ['Store Credit', 'Bitcoin']) {
      const res = await post('/api/tx/sale', saleBody({ date, lines: [line(item, 1)], splits: [{ mode, amount: 1180 }] }));
      expectStatus(res, 400, mode);
    }
    const mixed = await post('/api/tx/sale', saleBody({ date, lines: [line(item, 1)], splits: [{ mode: 'Cash', amount: 500 }, { mode: 'Bitcoin', amount: 680 }] }));
    expectStatus(mixed, 400, 'Cash + Bitcoin');
    ok(await post('/api/tx/sale', saleBody({ date, lines: [line(item, 1)], splits: [{ mode: 'GPay', amount: 500 }, { mode: 'COD-Credit', amount: 680 }] })), 'GPay + credit');
  });

  test('SAL4-5 a role without "edit price" / "give discount" rights cannot bill below catalogue or with a discount', async () => {
    const matrix = ok(await get('/api/access-matrix')).matrix;
    const restricted = JSON.parse(JSON.stringify(matrix));
    restricted.Billing.flags = restricted.Billing.flags.filter((f) => f !== 'bill.editPrice' && f !== 'bill.giveDiscount');
    ok(await put('/api/access-matrix', restricted), 'take the rights away from Billing');
    try {
      const date = await freshDay('erode-hq');
      const item = await createItem({ price: 1000, stock: { 'erode-hq': 10 } });
      expectStatus(await post('/api/tx/sale', saleBody({ date, lines: [line(item, 1, { price: 900 })] }), 'Billing'), 403, 'below catalogue');
      expectStatus(await post('/api/tx/sale', saleBody({ date, lines: [line(item, 1, { discountValue: 10 })] }), 'Billing'), 403, 'line discount');
      expectStatus(await post('/api/tx/sale', saleBody({ date, lines: [line(item, 1)], overallDiscountValue: 5 }), 'Billing'), 403, 'overall discount');
      const inv = await mustSell(saleBody({ date, lines: [line(item, 1)] }), 'Billing');
      assert.ok(inv, 'catalogue price, no discount is fine');
      ok(await post('/api/tx/sale', saleBody({ date, lines: [line(item, 1, { price: 1100 })] }), 'Billing'), 'above catalogue is fine');
      // The CEO keeps every right.
      ok(await post('/api/tx/sale', saleBody({ date, lines: [line(item, 1, { price: 900, discountValue: 5 })] })), 'CEO');
    } finally {
      ok(await put('/api/access-matrix', matrix), 'restore');
    }
  });

  test('SAL4-5 a kit line is charged the kit GST rate (18%)', async () => {
    const date = await freshDay('erode-hq');
    const a = await createItem({ stock: { 'erode-hq': 10 } });
    const combo = await createCombo([{ item: a, qty: 1 }], 2000);
    const bad = { ...comboLine(combo, 1), taxRate: 0 };
    expectStatus(await post('/api/tx/sale', saleBody({ date, lines: [bad] })), 400, 'kit at 0%');
    ok(await post('/api/tx/sale', saleBody({ date, lines: [comboLine(combo, 1)] })), 'kit at 18%');
  });

  test('SAL9-9 / SAL9-10 absurd prices, quantities and ₹-off discounts above the value are refused', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    expectStatus(await post('/api/tx/sale', saleBody({ date, lines: [serviceLine(1, 2e7)] })), 400, 'price above ₹1 crore');
    expectStatus(await post('/api/tx/sale', saleBody({ date, lines: [serviceLine(200000, 1)] })), 400, 'qty above 1 lakh');
    expectStatus(await post('/api/tx/sale', saleBody({ date, lines: [line(item, 1, { discountType: 'amount', discountValue: 5000 })] })), 400, 'line ₹-off above value');
    expectStatus(await post('/api/tx/sale', saleBody({ date, lines: [line(item, 1)], overallDiscountType: 'amount', overallDiscountValue: 5000 })), 400, 'bill ₹-off above value');
    ok(await post('/api/tx/sale', saleBody({ date, lines: [line(item, 1, { discountType: 'amount', discountValue: 100 })] })), 'a normal ₹-off');
  });

  test('E2E9-5 a full return of a rounded-off bill returns the whole bill (no paisa left)', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ price: 100.77, gst: 18, stock: { 'erode-hq': 5 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 1)], roundOffEnabled: true }));
    near(inv.grandTotal, 119, 'bill rounded up to 119');
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', refundMode: 'Cash' }));
    const after = await getInvoice(inv.id);
    near(after.totalReturnedAmount, 119, 'the whole bill value incl. round-off');
    near(after.balanceDue, 0);
  });

  test('E2E9-9 a credit-note return is refused while today\'s cash day is closed', async () => {
    const date = await freshDay('chennai');
    const item = await createItem({ stock: { chennai: 5 } });
    const inv = await mustSell(saleBody({ branchId: 'chennai', date, customerPhone: randomPhone(), lines: [line(item, 2)] }));
    const today = istToday();
    ok(await post('/api/cash/close', { branchId: 'chennai', date: today }), 'close today');
    try {
      expectStatus(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', refundMode: 'Adjust to credit note' }), 409, 'credit note on a closed today');
    } finally {
      ok(await post('/api/cash/reopen', { branchId: 'chennai', date: today }));
    }
  });

  test('SAL9-12 a bill whose past-day refund was taken back by a reversal can still be voided', async () => {
    if (!sql('SELECT 1')) return; // needs DATABASE_URL to put the refund on an earlier day
    // RPT10-4: only a bill of the current month can be voided, so the bill is
    // dated today and its refund is moved to an earlier day (UPG10-4: a refund
    // on any earlier day is taken back with a receipt today, never deleted).
    const d1 = await thisMonthDay();
    const d2 = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const inv = await mustSell(saleBody({ date: d1, lines: [line(item, 2)] }));
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', refundMode: 'Cash' }));
    const refund = (await paymentsFor(inv.id)).find((p) => p.type === 'out');
    sql(`UPDATE "Payment" SET "date"='${d2}' WHERE id='${refund.id}'`);
    const res = ok(await post('/api/tx/reverse-return', { invoiceId: inv.id, returnId: lastReturn(await getInvoice(inv.id)).id }), 'reverse');
    assert.equal(res.reversed.refund.kind, 'collected', 'taken back with a receipt today');
    ok(await post('/api/tx/void-invoice', { invoiceId: inv.id, reason: 'QA' }), 'void is allowed');
    const rows = await paymentsFor(inv.id);
    assert.equal(rows.length, 2, 'the refund and its take-back stay as a pair');
  });

  test('SAL9-5 a quote line with two different GST rates is refused; the one rate is stored on both fields', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const res = await post('/api/catalog/estimate', {
      id: `est-qa-${uid()}`, branchId: 'erode-hq', date, time: '10:00', customerName: 'QA', withGst: true, termsAndConditions: 'QA',
      items: [{ id: `li-${uid()}`, itemId: item.id, itemName: item.itemName, itemCode: item.itemCode, itemHSN: item.itemHSN, unit: 'PCS', quantity: 1, unitPrice: item.salePrice, gstRate: 0, taxRate: 18 }],
    });
    expectStatus(res, 400, 'gstRate 0 + taxRate 18');
    const quote = await createQuote(item, 1, 'erode-hq', date);
    assert.equal(quote.items[0].taxRate, quote.items[0].gstRate);
  });

  test('SAL9-13 a bill\'s CGST and SGST differ by at most one paisa and add up to its tax', async () => {
    const date = await freshDay('erode-hq');
    const inv = await mustSell(saleBody({ date, lines: Array.from({ length: 5 }, () => serviceLine(1, 100.05, 18)) }));
    assert.ok(Math.abs(inv.totalCgst - inv.totalSgst) <= 0.0101, `CGST ${inv.totalCgst} vs SGST ${inv.totalSgst}`);
    near(inv.totalCgst + inv.totalSgst, inv.totalTax);
  });

  test('SAL2-15 / PLT9-1 each financial year has its own series: only the go-live year continues from /7307; POs are named by their year', async () => {
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const old = await mustSell(saleBody({ date: '2019-06-15', lines: [line(item, 1)] }));
    const m = /^MZERD19-20\/(\d+)$/.exec(old.invoiceNumber);
    assert.ok(m, old.invoiceNumber);
    assert.ok(Number(m[1]) < 7000 && m[1].length >= 4, `an earlier year starts its own series: ${old.invoiceNumber}`);
    const now = await mustSell(saleBody({ date: istToday(), lines: [line(item, 1)] }));
    assert.ok(Number(now.invoiceNumber.split('/')[1]) >= 7307, `the go-live year continues: ${now.invoiceNumber}`);
    const v = ok(await get('/api/vendors'))[0];
    const po = ok(await post('/api/purchase/save', { po: { vendorId: v.id, branchId: 'erode-hq', date: '2025-09-01', expectedDeliveryDate: '2025-09-30',
      items: [{ itemId: item.id, quantityOrdered: 1, receivedQuantity: 0, purchasePrice: 10, taxPercent: 18 }], totalAmount: 0 }, actor: 'QA' })).saved;
    assert.ok(po.poNumber.startsWith('PO-ERD-2025-'), po.poNumber);
  });
});

