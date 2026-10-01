// Sales, quotes, returns, voids and deletes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  post, get, del, ok, expectStatus, near, uid, createItem, stockOf, line, comboLine, createCombo, saleBody, sell,
  mustSell, getInvoice, resave, returnLine, receive, freshDay, utcToday, together, paymentsFor,
} from './lib.mjs';

async function createQuote(item, qty, branchId = 'erode-hq', date) {
  const id = `est-qa-${uid()}`;
  const body = ok(await post('/api/catalog/estimate', {
    id, branchId, date, time: '10:00', customerName: 'QA Quote Customer', withGst: true,
    items: [{ id: `li-${uid()}`, itemId: item.id, itemName: item.itemName, itemCode: item.itemCode, itemHSN: item.itemHSN,
      unit: 'PCS', quantity: qty, unitPrice: item.salePrice, gstRate: item.gstTaxSlab }],
    termsAndConditions: 'QA',
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
    const date = await freshDay('erode-hq');
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
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 40 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 1), line(item, 1)] }));
    assert.equal(await stockOf(item.id, 'erode-hq'), 38);
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', actor: 'QA', refundMode: 'Cash' }));
    assert.equal(await stockOf(item.id, 'erode-hq'), 39);
    ok(await post('/api/tx/void-invoice', { invoiceId: inv.id, reason: 'QA', actor: 'QA' }));
    assert.equal(await stockOf(item.id, 'erode-hq'), 40, 'all units back after void');
  });

  test('SAL5-3 delete after a partial return of an item on two lines restores the rest of the stock', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 40 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 1), line(item, 1)] }));
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', actor: 'QA', refundMode: 'Cash' }));
    ok(await del(`/api/tx/invoice/${inv.id}`));
    assert.equal(await stockOf(item.id, 'erode-hq'), 40, 'all units back after delete');
  });

  test('SAL2-7 deleting a voided bill does not add stock back twice', async () => {
    const date = await freshDay('erode-hq');
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
    const date = await freshDay('erode-hq');
    const item = await createItem({ price: 1000, stock: { 'erode-hq': 10 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 2)] })); // paid cash, 2360
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', actor: 'QA', refundMode: 'Cash' }), 'return');
    assert.ok((await paymentsFor(inv.id)).some((p) => p.type === 'out'), 'a refund row exists after the return');
    ok(await post('/api/tx/void-invoice', { invoiceId: inv.id, reason: 'QA', actor: 'QA' }), 'void');
    assert.equal((await paymentsFor(inv.id)).filter((p) => p.type === 'out').length, 0, 'the refund row is gone after void');
    assert.equal(await stockOf(item.id, 'erode-hq'), 10, 'all stock restored');
  });

  test('SAL5-4 deleting a bill after a cash refund removes the refund row', async () => {
    const date = await freshDay('erode-hq');
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
    const date = await freshDay('chennai');
    const item = await createItem({ stock: { chennai: 10 } });
    const a = await mustSell(saleBody({ branchId: 'chennai', date, lines: [line(item, 1)] }));
    ok(await del(`/api/tx/invoice/${a.id}`), 'delete newest bill');
    const b = await mustSell(saleBody({ branchId: 'chennai', date, lines: [line(item, 1)] }));
    assert.notEqual(b.invoiceNumber, a.invoiceNumber, 'invoice numbers must never be reissued');
  });
});
