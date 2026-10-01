// Purchase orders: save, receive, pay, cancel, delete.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  post, get, del, ok, expectStatus, near, createItem, stockOf, createPO, getPO, anyVendor, together, paymentsFor,
} from './lib.mjs';

describe('purchases', () => {
  test('PUR5-2 a new PO total is worked out on the server, not taken from the browser', async () => {
    const item = await createItem();
    const po = await createPO([{ item, qty: 4, price: 50, tax: 18 }], { extra: { totalAmount: 1, totalTax: 0 } });
    near(po.totalAmount, 200, 'total = 4 x 50');
    near(po.totalTax, 36, 'tax = 18% of 200');
  });

  test('PUR2-6 a PO save cannot set its own status, paid amount or number', async () => {
    const item = await createItem();
    const po = await createPO([{ item, qty: 2, price: 100 }], { extra: { status: 'Received', amountPaid: 99999, poNumber: 'FAKE-1' } });
    assert.equal(po.status, 'Ordered');
    assert.equal(po.amountPaid, 0);
    assert.notEqual(po.poNumber, 'FAKE-1');
    assert.equal(await stockOf(item.id, 'erode-hq'), 0);
  });

  test('PUR5-2 a PO with a negative quantity or price is refused', async () => {
    const item = await createItem();
    const v = await anyVendor();
    const res = await post('/api/purchase/save', { po: {
      vendorId: v.id, vendorName: v.vendorName, branchId: 'erode-hq', date: '2026-09-15', expectedDeliveryDate: '2026-09-30',
      items: [{ itemId: item.id, itemName: item.itemName, quantityOrdered: -5, purchasePrice: -100, receivedQuantity: 0 }], totalAmount: 0,
    }, actor: 'QA' });
    expectStatus(res, 400);
  });

  test('PUR5-2 a PO for a vendor that does not exist is refused', async () => {
    const item = await createItem();
    const res = await post('/api/purchase/save', { po: {
      vendorId: 'vnd-ghost-does-not-exist', vendorName: 'Ghost', branchId: 'erode-hq', date: '2026-09-15', expectedDeliveryDate: '2026-09-30',
      items: [{ itemId: item.id, itemName: item.itemName, quantityOrdered: 1, purchasePrice: 10, receivedQuantity: 0 }], totalAmount: 0,
    }, actor: 'QA' });
    expectStatus(res, 400);
  });

  test('PUR3-1 the same item twice in one receipt does not double the stock', async () => {
    const item = await createItem({ stock: { 'erode-hq': 20 } });
    const po = await createPO([{ item, qty: 10, price: 100 }]);
    const res = await post('/api/purchase/receive', { poId: po.id, receipts: [
      { itemId: item.id, quantityReceived: 10 }, { itemId: item.id, quantityReceived: 10 },
    ], actor: 'QA' });
    if (res.status === 200) {
      const line = (await getPO(po.id)).items[0];
      assert.equal(await stockOf(item.id, 'erode-hq'), 20 + line.receivedQuantity, 'stock gain must equal what the PO line shows as received');
      assert.ok(line.receivedQuantity <= 10, 'cannot receive more than ordered');
    } else {
      expectStatus(res, 400);
      assert.equal(await stockOf(item.id, 'erode-hq'), 20);
    }
  });

  test('PUR3-11 / E2E-5 damaged and missing units settle the line; only the true remainder can be received', async () => {
    const item = await createItem();
    const po = await createPO([{ item, qty: 10, price: 100 }]);
    ok(await post('/api/purchase/receive', { poId: po.id, receipts: [{ itemId: item.id, quantityReceived: 7, damagedQuantity: 1, missingQuantity: 1 }], actor: 'QA' }));
    assert.equal(await stockOf(item.id, 'erode-hq'), 7, 'only good units go into stock');
    expectStatus(await post('/api/purchase/receive', { poId: po.id, receipts: [{ itemId: item.id, quantityReceived: 2 }], actor: 'QA' }), 400, 'over-receipt');
    ok(await post('/api/purchase/receive', { poId: po.id, receipts: [{ itemId: item.id, quantityReceived: 1 }], actor: 'QA' }), 'last unit');
    const after = await getPO(po.id);
    assert.equal(after.status, 'Received');
    assert.equal(after.debitNotes.length, 1, 'one debit note for damaged + missing');
    near(after.debitNotes[0].totalAmount, 200, 'debit note = 2 units x 100');
  });

  test('PUR3-11 two people receiving the last units at the same time: stock goes up once', async () => {
    const item = await createItem();
    const po = await createPO([{ item, qty: 5, price: 100 }]);
    const results = await together(3, () => post('/api/purchase/receive', { poId: po.id, receipts: [{ itemId: item.id, quantityReceived: 5 }], actor: 'QA' }));
    assert.equal(results.filter((r) => r.status === 200).length, 1, 'one receipt accepted');
    assert.equal(await stockOf(item.id, 'erode-hq'), 5);
  });

  test('PUR-1 a cancelled PO cannot receive stock', async () => {
    const item = await createItem();
    const po = await createPO([{ item, qty: 5, price: 100 }]);
    ok(await post(`/api/purchase/${po.id}/cancel`, {}), 'cancel');
    expectStatus(await post('/api/purchase/receive', { poId: po.id, receipts: [{ itemId: item.id, quantityReceived: 5 }], actor: 'QA' }), 400);
    assert.equal(await stockOf(item.id, 'erode-hq'), 0);
  });

  test('PUR3-6 a PO with a payment cannot be cancelled', async () => {
    const item = await createItem();
    const po = await createPO([{ item, qty: 5, price: 100 }]);
    ok(await post('/api/purchase/payment', { poId: po.id, amount: 100, mode: 'GPay', actor: 'QA' }));
    expectStatus(await post(`/api/purchase/${po.id}/cancel`, {}), 409);
  });

  test('PUR3-6 a PO with a payment cannot be deleted', async () => {
    const item = await createItem();
    const po = await createPO([{ item, qty: 5, price: 300 }]);
    ok(await post('/api/purchase/payment', { poId: po.id, amount: 1500, mode: 'GPay', actor: 'QA' }));
    expectStatus(await del(`/api/purchase/${po.id}`), 409, 'delete paid PO');
    assert.ok((await getPO(po.id)).id, 'PO still exists');
  });

  test('NUM-1 deleting the newest PO does not let its number be reused', async () => {
    const item = await createItem();
    const a = await createPO([{ item, qty: 1, price: 100 }]);
    ok(await del(`/api/purchase/${a.id}`), 'delete newest PO');
    const b = await createPO([{ item, qty: 1, price: 100 }]);
    assert.notEqual(b.poNumber, a.poNumber, 'PO numbers must never be reissued');
  });

  test('PUR3-6 a received PO cannot be cancelled (and then deleted)', async () => {
    const item = await createItem();
    const po = await createPO([{ item, qty: 3, price: 100 }]);
    ok(await post('/api/purchase/receive', { poId: po.id, receipts: [{ itemId: item.id, quantityReceived: 3 }], actor: 'QA' }));
    expectStatus(await del(`/api/purchase/${po.id}`), 409, 'delete received PO');
    expectStatus(await post(`/api/purchase/${po.id}/cancel`, {}), [400, 409], 'cancel received PO');
  });

  test('PUR5-4 "Edit Prices" keeps the supplier bill and attachments saved by someone else', async () => {
    const item = await createItem();
    const po = await createPO([{ item, qty: 10, price: 100, tax: 18 }]);
    const stale = await getPO(po.id); // user A opens Edit Prices
    ok(await post('/api/purchase/bill', { poId: po.id, bill: { number: 'SUP-778', date: '2026-09-16', taxable: 1000, gst: 180 } }), 'user B records the bill');
    ok(await post('/api/purchase/attachment', { poId: po.id, attachment: { name: 'bill.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0=' }, actor: 'QA' }), 'user B attaches');
    const { id, poNumber, status, amountPaid, createdAt, updatedAt, ...rest } = stale;
    ok(await post('/api/purchase/save', { po: { ...rest, id, items: stale.items.map((l) => ({ ...l, purchasePrice: 110 })) }, actor: 'QA' }), 'user A saves prices');
    const after = await getPO(po.id);
    assert.equal(after.supplierBillNumber, 'SUP-778');
    near(after.supplierBillGst, 180);
    assert.equal((after.attachments || []).length, 1, 'attachment kept');
    near(after.totalAmount, 1100, 'new price applied');
  });

  test('PUR2-9 a vendor payment cannot exceed what is owed', async () => {
    const item = await createItem();
    const po = await createPO([{ item, qty: 2, price: 100, tax: 18 }]);
    expectStatus(await post('/api/purchase/payment', { poId: po.id, amount: 1000, mode: 'Cash', actor: 'QA' }), 400, 'overpayment');
    ok(await post('/api/purchase/payment', { poId: po.id, amount: 236, mode: 'Cash', actor: 'QA' }), 'pay in full incl. GST (PUR4-1)');
    expectStatus(await post('/api/purchase/payment', { poId: po.id, amount: 1, mode: 'Cash', actor: 'QA' }), 400, 'already paid');
  });

  test('PUR2-9 "Pay now" while receiving cannot exceed what is owed', async () => {
    const item = await createItem();
    const po = await createPO([{ item, qty: 2, price: 100 }]);
    const res = await post('/api/purchase/receive', { poId: po.id, receipts: [{ itemId: item.id, quantityReceived: 2 }], payment: { amount: 99999, mode: 'Cash' }, actor: 'QA' });
    if (res.status === 200) {
      const after = await getPO(po.id);
      assert.ok(after.amountPaid <= 200, `amountPaid ${after.amountPaid} is more than the PO is worth (200)`);
    } else {
      expectStatus(res, 400);
    }
  });

  test('CASH2-2 five vendor payments on one PO at the same moment are all kept', async () => {
    const item = await createItem();
    const po = await createPO([{ item, qty: 10, price: 100 }]);
    const results = await together(5, () => post('/api/purchase/payment', { poId: po.id, amount: 100, mode: 'GPay', actor: 'QA' }));
    for (const r of results) ok(r, 'payment');
    near((await getPO(po.id)).amountPaid, 500);
    assert.equal((await paymentsFor(po.id)).filter((p) => p.type === 'out').length, 5, 'five ledger rows');
  });

  test('PUR6-1 a Parties vendor payment cannot settle a cancelled PO', async () => {
    const item = await createItem();
    const po = await createPO([{ item, qty: 2, price: 100 }]);
    ok(await post(`/api/purchase/${po.id}/cancel`, {}), 'cancel');
    const res = await post('/api/payments', {
      type: 'out', partyType: 'vendor', partyId: po.vendorId, partyName: po.vendorName, branchId: po.branchId,
      amount: 200, paymentMode: 'GPay', allocations: [{ refId: po.id, amount: 200 }],
    });
    expectStatus(res, [400, 409], 'payment allocated to a cancelled PO');
    assert.equal((await getPO(po.id)).amountPaid || 0, 0);
  });

  test('PUR-7 receiving updates the item cost from the confirmed price', async () => {
    const item = await createItem({ purchasePrice: 600 });
    const po = await createPO([{ item, qty: 2, price: 600 }]);
    ok(await post('/api/purchase/receive', { poId: po.id, receipts: [{ itemId: item.id, quantityReceived: 2, purchasePrice: 640 }], actor: 'QA' }));
    const it = ok(await get(`/api/items/${item.id}`));
    assert.equal(it.purchasePrice, 640);
  });

  test('PUR2-8 a zero price at receipt does not wipe the item cost', async () => {
    const item = await createItem({ purchasePrice: 600 });
    const po = await createPO([{ item, qty: 2, price: 600 }]);
    ok(await post('/api/purchase/receive', { poId: po.id, receipts: [{ itemId: item.id, quantityReceived: 2, purchasePrice: 0 }], actor: 'QA' }));
    const it = ok(await get(`/api/items/${item.id}`));
    assert.equal(it.purchasePrice, 600, 'item cost unchanged');
  });

  test('PUR2-8 a zero price at receipt does not set the PO total to zero', async () => {
    const item = await createItem({ purchasePrice: 600 });
    const po = await createPO([{ item, qty: 2, price: 600 }]);
    ok(await post('/api/purchase/receive', { poId: po.id, receipts: [{ itemId: item.id, quantityReceived: 2, purchasePrice: 0 }], actor: 'QA' }));
    const after = await getPO(po.id);
    assert.ok(after.totalAmount > 0, `PO total became ${after.totalAmount} after a 0 price at receipt`);
  });
});
