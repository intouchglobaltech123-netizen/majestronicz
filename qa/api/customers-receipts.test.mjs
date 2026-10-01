// Customers, receipts against bills, and the "one source of truth" for dues.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  post, get, del, ok, expectStatus, near, createItem, line, saleBody, mustSell, getInvoice, receive,
  freshDay, together, randomPhone, paymentsFor, serviceLine,
} from './lib.mjs';

/** A credit (COD) bill of 1,180 on a fresh day; returns the saved invoice. */
async function creditBill({ branchId = 'erode-hq', phone, qty = 1, as = 'CEO' } = {}) {
  const date = await freshDay(branchId);
  const item = await createItem({ price: 1000, stock: { [branchId]: 10 } });
  const total = 1180 * qty;
  return mustSell(saleBody({
    branchId, date, transactionType: 'Credit', customerName: 'QA Credit Customer', customerPhone: phone || randomPhone(),
    lines: [line(item, qty)], splits: [{ mode: 'COD-Credit', amount: total }],
  }), as);
}

describe('customers & receipts', () => {
  test('CRM6-1 a receipt does not rewrite the bill\'s original payment split', async () => {
    const inv = await creditBill();
    const before = JSON.stringify(inv.paymentSplits);
    ok(await receive(inv, 500, { mode: 'GPay' }), 'receipt');
    const after = await getInvoice(inv.id);
    assert.equal(JSON.stringify(after.paymentSplits), before, 'paymentSplits unchanged');
    near(after.balanceDue, 680, 'due = 1180 - 500');
  });

  test('CRM5-1 deleting a receipt restores the debt', async () => {
    const inv = await creditBill();
    const pay = ok(await receive(inv, 400), 'receipt');
    near((await getInvoice(inv.id)).balanceDue, 780);
    ok(await del(`/api/payments/${pay.id}`), 'delete receipt');
    near((await getInvoice(inv.id)).balanceDue, 1180, 'debt back after delete');
  });

  test('CRM6-4 a bill with receipts cannot be voided or deleted', async () => {
    const inv = await creditBill();
    ok(await receive(inv, 300), 'receipt');
    expectStatus(await post('/api/tx/void-invoice', { invoiceId: inv.id, reason: 'QA', actor: 'QA' }), 409, 'void');
    expectStatus(await del(`/api/tx/invoice/${inv.id}`), 409, 'delete');
    assert.ok(await getInvoice(inv.id), 'bill still there');
  });

  test('SAL6-7 three simultaneous full receipts on one bill: only one is banked', async () => {
    const inv = await creditBill();
    const results = await together(3, () => receive(inv, 1180));
    const wins = results.filter((r) => r.status === 200).length;
    assert.equal(wins, 1, `expected 1 receipt accepted, got ${wins} (${results.map((r) => r.status).join(',')})`);
    const banked = (await paymentsFor(inv.id)).filter((p) => p.type === 'in').reduce((t, p) => t + p.amount, 0);
    near(banked, 1180, 'cash banked against the bill');
    near((await getInvoice(inv.id)).balanceDue, 0);
  });

  test('SAL6-7 a receipt on a fully paid bill is refused', async () => {
    const inv = await creditBill();
    ok(await receive(inv, 1180));
    const again = await receive(inv, 100);
    expectStatus(again, 400, 'receipt on a settled bill');
  });

  test('CRM2-7 six simultaneous receipts on different bills all save with unique numbers', async () => {
    const bills = [];
    for (let i = 0; i < 6; i++) bills.push(await creditBill());
    const results = await Promise.all(bills.map((b) => receive(b, 100)));
    for (const r of results) ok(r, 'receipt');
    const nums = new Set(results.map((r) => r.body.receiptNumber));
    assert.equal(nums.size, 6, 'unique receipt numbers');
  });

  test('CRM4-3 a receipt is booked to the bill\'s branch, not the branch picked on screen', async () => {
    const inv = await creditBill({ branchId: 'coimbatore' });
    const pay = ok(await receive(inv, 200, { branchId: 'erode-hq' }), 'CEO receipt from "All Branches"');
    assert.equal(pay.branchId, 'coimbatore');
  });

  test('CRM4-2 Billing (Erode) cannot record a receipt on a Coimbatore bill', async () => {
    const inv = await creditBill({ branchId: 'coimbatore' });
    expectStatus(await receive(inv, 200, { as: 'Billing', branchId: 'erode-hq' }), 403);
    near((await getInvoice(inv.id)).balanceDue, 1180);
  });

  test('CASH-2 a receipt cannot be dated to a closed day', async () => {
    const inv = await creditBill();
    ok(await post('/api/cash/close', { branchId: inv.branchId, date: inv.date, actor: 'QA' }), 'close day');
    expectStatus(await receive(inv, 200), 409);
  });

  test('CRM6-5 a receipt date in another format does not skip the closed-day lock', async () => {
    const inv = await creditBill();
    ok(await post('/api/cash/close', { branchId: inv.branchId, date: inv.date, actor: 'QA' }), 'close day');
    const odd = inv.date.replaceAll('-', '/'); // e.g. 2019/04/07
    const res = await receive(inv, 200, { date: odd });
    expectStatus(res, [400, 409], `receipt dated "${odd}"`);
  });

  test('CRM4-4 money received above what is owed is not stored as unexplained cash', async () => {
    const inv = await creditBill();
    const res = await post('/api/payments', {
      type: 'in', partyType: 'customer', partyName: inv.customerName, branchId: inv.branchId, date: inv.date,
      amount: 1500, paymentMode: 'Cash', allocations: [{ refId: inv.id, amount: 1500 }],
    });
    if (res.status === 200) {
      const applied = (res.body.allocations || []).reduce((t, a) => t + a.amount, 0);
      near(res.body.amount, applied, `stored ${res.body.amount} but only ${applied} was applied to the bill`);
    } else {
      expectStatus(res, 400);
    }
  });

  test('CRM-4 a sale does not overwrite the customer master name', async () => {
    const phone = randomPhone();
    ok(await post('/api/catalog/customer', { name: 'Original Name Pvt Ltd', phone, address: 'QA' }), 'create customer');
    const date = await freshDay('erode-hq');
    const inv = await mustSell(saleBody({ date, customerName: 'Typo Name', customerPhone: phone, lines: [serviceLine(1, 100)] }));
    const cust = ok(await get('/api/customers')).find((c) => c.id === inv.customerId);
    assert.equal(cust.name, 'Original Name Pvt Ltd');
    assert.equal(cust.purchaseCount, 1);
  });

  test('CRM-7 a duplicate or malformed phone is refused', async () => {
    const phone = randomPhone();
    ok(await post('/api/catalog/customer', { name: 'QA One', phone, address: '' }));
    expectStatus(await post('/api/catalog/customer', { name: 'QA Two', phone, address: '' }), 409, 'duplicate phone');
    expectStatus(await post('/api/catalog/customer', { name: 'QA Three', phone: '12345', address: '' }), 400, 'short phone');
  });

  test('CRM3-1 a valid GSTIN saves and an invalid one is refused', async () => {
    ok(await post('/api/catalog/customer', { name: 'QA GST', phone: randomPhone(), address: '', gstin: '33ABZFM5739L1ZD' }), 'valid GSTIN');
    expectStatus(await post('/api/catalog/customer', { name: 'QA GST bad', phone: randomPhone(), address: '', gstin: 'NOT-A-GSTIN' }), 400);
  });

  test('CRM5-6 creating a customer cannot set made-up purchase totals', async () => {
    const phone = randomPhone();
    ok(await post('/api/catalog/customer', { name: 'QA Fake Totals', phone, address: '', totalSpent: 999999, purchaseCount: 77 }, 'Billing'));
    const cust = ok(await get('/api/customers')).find((c) => c.phone === phone);
    assert.equal(cust.totalSpent, 0, 'totalSpent comes from bills only');
    assert.equal(cust.purchaseCount, 0, 'purchaseCount comes from bills only');
  });

  test('CRM5-1 deleting a receipt AFTER a cash refund restores the full debt, not the wrong one', async () => {
    const inv = await creditBill(); // credit bill of 1,180
    const pay = ok(await receive(inv, 1180), 'pay in full');
    near((await getInvoice(inv.id)).balanceDue, 0, 'paid');
    // Return the goods for a cash refund (the over-paid 1,180 comes back).
    const li = inv.items[0];
    const rl = { itemId: li.itemId, itemCode: li.itemCode, itemName: li.itemName, returnQty: 1, unitPrice: li.unitPrice, taxRate: li.taxRate };
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [rl], reason: 'QA', actor: 'QA', refundMode: 'Cash' }), 'return + refund');
    assert.ok((await paymentsFor(inv.id)).some((p) => p.type === 'out'), 'a cash refund was paid');
    near((await getInvoice(inv.id)).balanceDue, 0, 'settled: paid, returned, refunded');
    // Deleting the receipt means "they never paid" — but they DID take 1,180 cash
    // back, so they now owe the full 1,180 again (the old model wrongly showed 0).
    ok(await del(`/api/payments/${pay.id}`), 'delete the receipt');
    near((await getInvoice(inv.id)).balanceDue, 1180, 'full debt restored, accounting for the refund taken');
  });

  test('SEC: the Purchase role cannot record or delete a customer receipt', async () => {
    const inv = await creditBill();
    expectStatus(await receive(inv, 100, { as: 'Purchase' }), 403, 'Purchase records a receipt');
    const pay = ok(await receive(inv, 100), 'CEO records a receipt');
    expectStatus(await del(`/api/payments/${pay.id}`, 'Purchase'), 403, 'Purchase deletes a receipt');
  });

  test('CRM6-5 a receipt dated in the future or absurdly in the past is refused', async () => {
    const inv = await creditBill();
    expectStatus(await receive(inv, 100, { date: '2099-01-01' }), 400, 'future date');
    expectStatus(await receive(inv, 100, { date: '1990-01-01' }), 400, 'too-old date');
  });

  test('CRM2-7 a receipt number is not reissued after the receipt is deleted', async () => {
    const inv1 = await creditBill();
    const p1 = ok(await receive(inv1, 100, { date: inv1.date }), 'receipt 1');
    ok(await del(`/api/payments/${p1.id}`), 'delete receipt 1');
    const inv2 = await creditBill();
    const p2 = ok(await receive(inv2, 100, { date: inv1.date }), 'receipt 2 (same month)');
    assert.notEqual(p2.receiptNumber, p1.receiptNumber, 'the deleted number must not be reissued');
  });

  test('CRM-3 "Adjust to credit note" banks store credit instead of paying cash', async () => {
    const inv = await creditBill();
    ok(await receive(inv, 1180), 'pay in full');
    const li = inv.items[0];
    const rl = { itemId: li.itemId, itemCode: li.itemCode, itemName: li.itemName, returnQty: 1, unitPrice: li.unitPrice, taxRate: li.taxRate };
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [rl], reason: 'QA', actor: 'QA', refundMode: 'Adjust to credit note' }), 'credit-note return');
    assert.equal((await paymentsFor(inv.id)).filter((p) => p.type === 'out').length, 0, 'no cash refund on a credit note');
    const cust = ok(await get('/api/customers')).find((c) => c.id === inv.customerId);
    near(cust.creditBalance || 0, 1180, 'the over-paid portion is banked as store credit');
  });

  test('CRM-3 store credit can settle a future bill and the balance goes down', async () => {
    const inv = await creditBill(); // due 1,180
    ok(await post(`/api/catalog/customer/${inv.customerId}/credit`, { amount: 2000, reason: 'QA grant' }), 'grant credit');
    ok(await post('/api/payments', {
      type: 'in', partyType: 'customer', partyId: inv.customerId, partyName: inv.customerName,
      branchId: inv.branchId, date: inv.date, amount: 1180, paymentMode: 'Store Credit',
      allocations: [{ refId: inv.id, amount: 1180 }],
    }), 'pay with store credit');
    near((await getInvoice(inv.id)).balanceDue, 0, 'bill settled by store credit');
    const cust = ok(await get('/api/customers')).find((c) => c.id === inv.customerId);
    near(cust.creditBalance || 0, 820, '2,000 granted − 1,180 applied');
  });

  test('CRM-3 store credit cannot be overdrawn', async () => {
    const inv = await creditBill();
    ok(await post(`/api/catalog/customer/${inv.customerId}/credit`, { amount: 100, reason: 'QA' }), 'grant 100');
    const res = await post('/api/payments', {
      type: 'in', partyType: 'customer', partyId: inv.customerId, partyName: inv.customerName,
      branchId: inv.branchId, date: inv.date, amount: 500, paymentMode: 'Store Credit',
      allocations: [{ refId: inv.id, amount: 500 }],
    });
    expectStatus(res, 400, 'applying more credit than the balance');
  });

  test('CRM-3 only a Manager or CEO can adjust store credit', async () => {
    const inv = await creditBill();
    expectStatus(await post(`/api/catalog/customer/${inv.customerId}/credit`, { amount: 100, reason: 'x' }, 'Billing'), 403, 'Billing adjusts credit');
  });

  test('CRM-21 a customer with invoices cannot be deleted', async () => {
    const inv = await creditBill();
    assert.ok(inv.customerId, 'bill linked to a customer');
    const res = await del(`/api/catalog/customer/${inv.customerId}`);
    expectStatus(res, 409, 'delete customer with bills');
    assert.ok(ok(await get('/api/customers')).some((c) => c.id === inv.customerId), 'customer still exists');
  });
});
