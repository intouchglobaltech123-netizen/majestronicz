// Customer money, closed cash days and business dates (Srimun phase 1).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  post, get, del, put, ok, expectStatus, near, createItem, line, saleBody, mustSell, sell, getInvoice, receive, resave,
  freshDay, freshDays, addDays, istToday, together, randomPhone, paymentsFor, returnLine, register, uid, insertLegacyBill,
} from './lib.mjs';

/** A fresh customer master row (for receipts that need a customer). */
async function newCustomer(name = `QA Cust ${uid()}`) {
  const phone = randomPhone();
  ok(await post('/api/catalog/customer', { name, phone, address: 'QA' }), 'create customer');
  const rows = ok(await get('/api/customers'));
  return rows.find((c) => c.phone === phone);
}

const customerOf = async (id) => ok(await get('/api/customers')).find((c) => c.id === id);
const openingOf = async (branchId, date) => (await register(branchId, date))?.openingAmount;

describe('closed cash days never change', () => {
  test('CASH-2 a bill cannot be moved off a closed day by editing its date', async () => {
    const [d1, d2] = await freshDays('erode-hq', 2);
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const inv = await mustSell(saleBody({ date: d1, lines: [line(item, 1)] }));
    ok(await post('/api/cash/close', { branchId: 'erode-hq', date: d1, actor: 'QA' }), 'close d1');
    expectStatus(await resave(inv, { date: d2 }), 409, 'move bill to an open day');
    assert.equal((await getInvoice(inv.id)).date, d1);
    ok(await post('/api/cash/reopen', { branchId: 'erode-hq', date: d1 }));
  });

  test('CASH7-4 a cash refund is refused when today (IST) is closed, and books on the IST day when open', async () => {
    const d1 = await freshDay('chennai');
    const item = await createItem({ stock: { chennai: 5 } });
    const inv = await mustSell(saleBody({ branchId: 'chennai', date: d1, lines: [line(item, 2)] }));
    const today = istToday();
    ok(await post('/api/cash/close', { branchId: 'chennai', date: today, actor: 'QA' }), 'close today');
    try {
      const res = await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', refundMode: 'Cash' });
      expectStatus(res, 409, 'cash refund into a closed today');
      assert.equal((await paymentsFor(inv.id)).filter((p) => p.type === 'out').length, 0, 'no refund row');
    } finally {
      ok(await post('/api/cash/reopen', { branchId: 'chennai', date: today }), 'reopen today');
    }
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', refundMode: 'Cash' }));
    const refund = (await paymentsFor(inv.id)).find((p) => p.type === 'out');
    assert.equal(refund.date, today, 'refund dated on the IST day');
  });

  test('SAL8-6 voiding a bill whose refund was paid on a closed day is refused', async () => {
    const d1 = await freshDay('chennai');
    const item = await createItem({ stock: { chennai: 5 } });
    const inv = await mustSell(saleBody({ branchId: 'chennai', date: d1, lines: [line(item, 2)] }));
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', refundMode: 'Cash' }));
    const today = istToday();
    ok(await post('/api/cash/close', { branchId: 'chennai', date: today, actor: 'QA' }));
    try {
      expectStatus(await post('/api/tx/void-invoice', { invoiceId: inv.id, reason: 'QA' }), 409, 'void');
      expectStatus(await del(`/api/tx/invoice/${inv.id}`), 409, 'delete');
      assert.equal((await paymentsFor(inv.id)).filter((p) => p.type === 'out').length, 1, 'refund row kept');
    } finally {
      ok(await post('/api/cash/reopen', { branchId: 'chennai', date: today }));
    }
  });

  test('CASH7-9 a refund row cannot be deleted while its return stands (and never by Billing)', async () => {
    const d1 = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const inv = await mustSell(saleBody({ date: d1, lines: [line(item, 2)] }));
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', refundMode: 'Cash' }));
    const refund = (await paymentsFor(inv.id)).find((p) => p.type === 'out');
    assert.ok(refund, 'refund row');
    expectStatus(await del(`/api/payments/${refund.id}`, 'Billing'), 403, 'Billing deletes a refund');
    expectStatus(await del(`/api/payments/${refund.id}`), 409, 'CEO deletes a refund while the return stands');
    assert.ok((await paymentsFor(inv.id)).some((p) => p.id === refund.id), 'refund still there');
  });
});

describe('business dates (IST, never in the future)', () => {
  const future = () => addDays(istToday(), 3);

  test('CASH8-7 a sale, a receipt and a recurring approval cannot be dated in the future', async () => {
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const { res } = await sell(saleBody({ date: future(), lines: [line(item, 1)] }));
    expectStatus(res, 400, 'future sale');
    const d1 = await freshDay('erode-hq');
    const inv = await mustSell(saleBody({ date: d1, transactionType: 'Credit', customerPhone: randomPhone(), customerName: 'QA future', lines: [line(item, 1)], splits: [{ mode: 'COD-Credit', amount: 1180 }] }));
    expectStatus(await receive(inv, 100, { date: future() }), 400, 'future receipt');
    const tpl = ok(await get('/api/recurring-expenses'))[0];
    expectStatus(await post('/api/cash/approve-recurring', { templateId: tpl.id, branchId: tpl.branchId, date: '2099-01-05', amount: 10, paymentMode: 'Cash' }), 400, 'future recurring approval');
  });

  test('CASH8-3 an opening override needs a number >= 0, a reason, and a non-future day (400, not 500)', async () => {
    const d1 = await freshDay('erode-hq');
    const o = (body) => post('/api/cash/override', { branchId: 'erode-hq', date: d1, reason: 'QA', ...body });
    expectStatus(await o({ amount: -5000 }), 400, 'negative');
    expectStatus(await o({ amount: 'abc' }), 400, 'not a number');
    expectStatus(await o({ amount: 100, reason: '' }), 400, 'no reason');
    expectStatus(await o({ amount: 100, date: future() }), 400, 'future');
    assert.equal(await register('erode-hq', future()), null, 'no future register created');
    ok(await o({ amount: 100 }), 'valid override');
    near(await openingOf('erode-hq', d1), 100);
  });
});

describe('one carry-forward for every opening', () => {
  test('CASH-1 a day with only a cash sale (no register) carries into the next opening', async () => {
    const [d0, d1, d2] = await freshDays('erode-hq', 3);
    ok(await post('/api/cash/expense', { branchId: 'erode-hq', date: d0, expense: { reason: 'QA', cashAmount: 10 } }));
    const o0 = await openingOf('erode-hq', d0);
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    await mustSell(saleBody({ date: d1, lines: [line(item, 1)] })); // 1,180 cash, no register on d1
    ok(await post('/api/cash/expense', { branchId: 'erode-hq', date: d2, expense: { reason: 'QA', cashAmount: 10 } }));
    near(await openingOf('erode-hq', d2), o0 - 10 + 1180, 'd2 opening = d0 closing + d1 cash');
  });

  test('CASH8-4 a branch\'s first register includes the cash taken before it', async () => {
    const regs = ok(await get('/api/cash-registers')).filter((r) => r.branchId === 'chennai').map((r) => r.date).sort();
    const first = regs[0] || '2026-01-01';
    const d1 = addDays(first < '2012-01-10' ? first : '2012-01-10', -3);
    const d2 = addDays(d1, 1);
    const item = await createItem({ stock: { chennai: 5 } });
    await mustSell(saleBody({ branchId: 'chennai', date: d1, lines: [line(item, 1)] }));
    ok(await post('/api/cash/expense', { branchId: 'chennai', date: d2, expense: { reason: 'QA', cashAmount: 10 } }));
    near(await openingOf('chennai', d2), 8000 + 1180, 'default float + the earlier cash sale');
  });

  test('CASH-5 an open day\'s opening follows a change to an earlier open day; a closed day keeps its own', async () => {
    const [d1, d2, d3] = await freshDays('coimbatore', 3);
    ok(await post('/api/cash/expense', { branchId: 'coimbatore', date: d1, expense: { reason: 'QA', cashAmount: 10 } }));
    ok(await post('/api/cash/expense', { branchId: 'coimbatore', date: d3, expense: { reason: 'QA', cashAmount: 10 } }));
    const before = await openingOf('coimbatore', d3);
    const item = await createItem({ stock: { coimbatore: 5 } });
    await mustSell(saleBody({ branchId: 'coimbatore', date: d1, lines: [line(item, 1)] }));
    near(await openingOf('coimbatore', d3), before + 1180, 'open later day moved with the earlier change');
    ok(await post('/api/cash/close', { branchId: 'coimbatore', date: d3, actor: 'QA' }));
    const frozen = await openingOf('coimbatore', d3);
    await mustSell(saleBody({ branchId: 'coimbatore', date: d2, lines: [line(item, 1)] }));
    near(await openingOf('coimbatore', d3), frozen, 'closed day opening unchanged');
    ok(await post('/api/cash/reopen', { branchId: 'coimbatore', date: d3 }));
  });

  test('E2E8-6 a legacy part-paid COD bill counts its part-payment as billing-day cash (screen = server)', async () => {
    const [d0, d1, d2] = await freshDays('coimbatore', 3);
    ok(await post('/api/cash/expense', { branchId: 'coimbatore', date: d0, expense: { reason: 'QA', cashAmount: 10 } }));
    const o0 = await openingOf('coimbatore', d0);
    insertLegacyBill({ branchId: 'coimbatore', date: d1, grand: 8024, partial: 5000, due: 3024 });
    ok(await post('/api/cash/expense', { branchId: 'coimbatore', date: d2, expense: { reason: 'QA', cashAmount: 10 } }));
    near(await openingOf('coimbatore', d2), o0 - 10 + 5000, 'the ₹5,000 part-payment is cash on the bill day');
  });

  test('UPG8-1 a receipt on a legacy bill does not rewrite its part-payment or its (closed) bill day', async () => {
    const [d0, d1, d2, d3] = await freshDays('coimbatore', 4);
    ok(await post('/api/cash/expense', { branchId: 'coimbatore', date: d0, expense: { reason: 'QA', cashAmount: 10 } }));
    const cust = await newCustomer();
    const bill = insertLegacyBill({ branchId: 'coimbatore', date: d1, grand: 8024, partial: 5000, due: 3024, customerId: cust.id, customerName: cust.name });
    ok(await post('/api/cash/close', { branchId: 'coimbatore', date: d1, actor: 'QA' }), 'close the bill day');
    ok(await post('/api/cash/expense', { branchId: 'coimbatore', date: d2, expense: { reason: 'QA', cashAmount: 10 } }));
    const o2 = await openingOf('coimbatore', d2);
    ok(await receive({ ...bill, customerId: cust.id }, 1000, { date: d2 }), 'receipt 1,000');
    ok(await receive({ ...bill, customerId: cust.id }, 500, { date: d2 }), 'receipt 500');
    const inv = await getInvoice(bill.id);
    near(inv.partialAmount, 5000, 'part-payment unchanged');
    assert.equal(inv.isPartialPayment, true);
    near(inv.balanceDue, 1524, '3,024 − 1,000 − 500');
    near(await openingOf('coimbatore', d2), o2, 'the closed bill day did not move');
    ok(await post('/api/cash/expense', { branchId: 'coimbatore', date: d3, expense: { reason: 'QA', cashAmount: 10 } }));
    near(await openingOf('coimbatore', d3), o2 - 10 + 1500, 'receipts counted once, on their own day');
    ok(await post('/api/cash/reopen', { branchId: 'coimbatore', date: d1 }));
  });
});

describe('customer money', () => {
  const creditBill = async (customer, total = 1, branchId = 'erode-hq') => {
    const date = await freshDay(branchId);
    const item = await createItem({ price: 1000, stock: { [branchId]: 10 } });
    return mustSell(saleBody({
      branchId, date, transactionType: 'Credit', customerName: customer.name, customerPhone: customer.phone,
      lines: [line(item, total)], splits: [{ mode: 'COD-Credit', amount: 1180 * total }],
    }));
  };

  test('CRM4-2 a receipt for one customer cannot settle another customer\'s bill', async () => {
    const a = await newCustomer();
    const b = await newCustomer();
    const billB = await creditBill(b);
    const res = await post('/api/payments', {
      type: 'in', partyType: 'customer', partyId: a.id, partyName: a.name, branchId: billB.branchId, date: billB.date,
      amount: 500, paymentMode: 'Cash', allocations: [{ refId: billB.id, amount: 500 }],
    });
    expectStatus(res, 400, 'A pays B\'s bill');
    const noParty = await post('/api/payments', {
      type: 'in', partyType: 'customer', partyName: a.name, branchId: billB.branchId, date: billB.date,
      amount: 500, paymentMode: 'Cash', allocations: [{ refId: billB.id, amount: 500 }],
    });
    expectStatus(noParty, 400, 'receipt without partyId named for another customer');
    near((await getInvoice(billB.id)).balanceDue, 1180, 'B still owes everything');
    ok(await post('/api/payments', {
      type: 'in', partyType: 'customer', partyName: b.name, branchId: billB.branchId, date: billB.date,
      amount: 500, paymentMode: 'Cash', allocations: [{ refId: billB.id, amount: 500 }],
    }), 'B pays its own bill without a partyId');
  });

  test('SAL6-7 two receipts racing on one bill: the extra is kept as store credit, nothing is trimmed', async () => {
    const c = await newCustomer();
    const bill = await creditBill(c, 2); // 2,360
    const before = Number((await customerOf(c.id)).creditBalance) || 0;
    const results = await together(2, () => receive({ ...bill, customerId: c.id }, 1500));
    results.forEach((r) => ok(r, 'receipt'));
    const banked = (await paymentsFor(bill.id)).filter((p) => p.type === 'in').reduce((t, p) => t + p.amount, 0);
    near(banked, 3000, 'both receipts stored in full');
    near((await getInvoice(bill.id)).balanceDue, 0);
    near((Number((await customerOf(c.id)).creditBalance) || 0) - before, 640, '3,000 − 2,360 kept as credit');
  });

  test('CASH8-6 a refund with no mode chosen goes back the way the bill was paid', async () => {
    const d1 = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const inv = await mustSell(saleBody({ date: d1, lines: [line(item, 2)], splits: [{ mode: 'GPay', amount: 2360 }] }));
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA' }));
    const refund = (await paymentsFor(inv.id)).find((p) => p.type === 'out');
    assert.equal(refund.paymentMode, 'GPay');
  });

  test('CASH7-7 a damaged return is refunded in the chosen mode and not restocked', async () => {
    const d1 = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const inv = await mustSell(saleBody({ date: d1, lines: [line(item, 2)] }));
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'Defective / Damaged', refundMode: 'GPay' }));
    const refund = (await paymentsFor(inv.id)).find((p) => p.type === 'out');
    assert.equal(refund.paymentMode, 'GPay', 'no silent cash refund');
    near(refund.amount, 1180);
  });

  test('SAL7-4 returns and voids with missing fields are 400s; item names come from the bill', async () => {
    const d1 = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const inv = await mustSell(saleBody({ date: d1, lines: [line(item, 2)] }));
    expectStatus(await post('/api/tx/sale-return', { returnLines: [returnLine(item, 1)], reason: 'QA' }), 400, 'no invoiceId');
    expectStatus(await post('/api/tx/void-invoice', { reason: 'QA' }), 400, 'void without invoiceId');
    expectStatus(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [{ itemId: 'item-not-on-bill', returnQty: 1 }], reason: 'QA' }), 400, 'item not on the bill');
    const res = await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [{ itemId: item.id, returnQty: 1, itemName: 'FAKE NAME' }], reason: 'QA', refundMode: 'Cash' });
    ok(res, 'return without code, with a fake name');
    const saved = await getInvoice(inv.id);
    assert.equal(saved.returns[0].itemName, item.itemName, 'name from the bill');
    assert.equal(saved.returns[0].itemCode, item.itemCode, 'code from the bill');
  });

  test('CRM2-8 a pending-order advance is a real receipt and is settled on the bill made from the order', async () => {
    const branchId = 'erode-hq';
    const item = await createItem({ price: 1000, stock: {} });
    const phone = randomPhone();
    const enquiryId = `enq-qa-${uid()}`;
    ok(await post('/api/enquiry/save', {
      enquiry: {
        id: enquiryId, enquiryNumber: `ENQ-QA-${uid()}`, customerName: 'QA Advance Customer', customerPhone: phone, itemId: item.id,
        itemName: item.itemName, itemCode: item.itemCode, unit: 'PCS', quantity: 1, branchId, date: istToday(), time: '10:00',
        status: 'Open', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      },
      actor: 'QA',
    }), 'enquiry');
    const order = ok(await get('/api/pending-orders')).find((o) => o.enquiryId === enquiryId);
    assert.ok(order, 'pending order created for the out-of-stock item');
    const adv = ok(await post('/api/payments/advance', { orderId: order.id, amount: 500, mode: 'Cash' }), 'advance');
    assert.equal(adv.payment.type, 'in');
    near(adv.payment.amount, 500);
    assert.equal(adv.payment.date, istToday());
    const cust = await customerOf(adv.payment.partyId);
    near(cust.creditBalance, 500, 'advance held as store credit');
    ok(await post('/api/stock/adjust', { itemId: item.id, branchId, quantityChange: 5, reason: 'QA restock' }), 'restock');
    const bill = await mustSell({
      ...saleBody({ branchId, date: istToday(), transactionType: 'Credit', customerName: 'QA Advance Customer', customerPhone: phone, lines: [line(item, 1)],
        splits: [{ mode: 'Cash', amount: 680 }, { mode: 'COD-Credit', amount: 500 }] }),
      sourceEnquiryId: enquiryId,
    });
    const saved = await getInvoice(bill.id);
    near(saved.balanceDue, 0, 'the unpaid part was settled from the advance');
    const applied = (await paymentsFor(bill.id)).filter((p) => p.type === 'in');
    assert.equal(applied.length, 1);
    assert.equal(applied[0].paymentMode, 'Store Credit', 'settled from credit, not new cash');
    near((await customerOf(cust.id)).creditBalance, 0, 'advance used up');
    expectStatus(await post('/api/payments/advance/clear', { orderId: order.id }), 409, 'a used advance cannot be given back');
  });
});

