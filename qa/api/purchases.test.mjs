// Purchase orders: save, receive, pay, cancel, delete.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  post, get, del, ok, expectStatus, near, createItem, stockOf, createPO, getPO, anyVendor, together, paymentsFor,
  uid, randomPhone, addDays, sql,
} from './lib.mjs';

/** A fresh supplier, so advances / payables of other tests can't interfere. */
async function newVendor(extra = {}) {
  const res = await post('/api/vendors', { vendorName: `QA Vendor ${uid()}`, contactNo: randomPhone(), address: 'QA', ...extra });
  return ok(res, 'create vendor').vendor;
}
const receiveAll = (po, receipts, extra = {}) => post('/api/purchase/receive', { poId: po.id, receipts, actor: 'QA', ...extra });
const vendorPay = (vendor, amount, allocations, extra = {}) => post('/api/payments', {
  type: 'out', partyType: 'vendor', partyId: vendor.id, partyName: vendor.vendorName, branchId: 'erode-hq',
  amount, paymentMode: 'GPay', allocations, ...extra,
});
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
/** The stored PO as an Edit-Prices / Edit-PO save would send it back. */
const editBody = (po, changes = {}) => {
  const { poNumber, status, amountPaid, createdAt, updatedAt, ...rest } = po;
  return { po: { ...rest, ...changes }, actor: 'QA' };
};

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

  // ---------------------------------------------------------------- phase 3 (r8)

  test('PUR8-1 owed = good units incl. GST: 7 good, 1 damaged, 2 missing of 10 @ 100 at 18% owes 826', async () => {
    const vendor = await newVendor();
    const item = await createItem();
    const po = await createPO([{ item, qty: 10, price: 100, tax: 18 }], { vendor });
    ok(await receiveAll(po, [{ itemId: item.id, quantityReceived: 7, damagedQuantity: 1, missingQuantity: 2, taxPercent: 18 }]), 'receive');
    const after = await getPO(po.id);
    assert.equal(after.status, 'Received');
    expectStatus(await post('/api/purchase/payment', { poId: po.id, amount: 826.01, mode: 'Cash', actor: 'QA' }), 400, 'more than 826');
    ok(await post('/api/purchase/payment', { poId: po.id, amount: 826, mode: 'Cash', actor: 'QA' }), 'pay 826');
    expectStatus(await post('/api/purchase/payment', { poId: po.id, amount: 1, mode: 'Cash', actor: 'QA' }), 400, 'already paid');
  });

  test('E2E-4 a debit note carries GST on damaged and missing units', async () => {
    const item = await createItem();
    const po = await createPO([{ item, qty: 10, price: 100, tax: 18 }]);
    ok(await receiveAll(po, [{ itemId: item.id, quantityReceived: 7, damagedQuantity: 1, missingQuantity: 2, taxPercent: 18 }]));
    const dn = (await getPO(po.id)).debitNotes[0];
    near(dn.totalTaxable, 300, 'taxable = 3 units x 100');
    near(dn.totalTax, 54, 'GST 18% reversed');
    near(dn.totalAmount, 354, 'debit note incl. GST');
    assert.equal(dn.lines[0].damagedQuantity, 1);
    assert.equal(dn.lines[0].missingQuantity, 2);
  });

  test('PUR8-1 "pay now" while receiving is capped by the same formula (refused above it)', async () => {
    const item = await createItem();
    const po = await createPO([{ item, qty: 10, price: 100, tax: 18 }]);
    expectStatus(await receiveAll(po, [{ itemId: item.id, quantityReceived: 7, damagedQuantity: 1, missingQuantity: 2, taxPercent: 18 }], { payment: { amount: 880, mode: 'Cash' } }), 400, 'over 826');
    assert.equal(await stockOf(item.id, 'erode-hq'), 0, 'refused receipt changes nothing');
    ok(await receiveAll(po, [{ itemId: item.id, quantityReceived: 7, damagedQuantity: 1, missingQuantity: 2, taxPercent: 18 }], { payment: { amount: 826, mode: 'Cash' } }), 'exactly 826');
    near((await getPO(po.id)).amountPaid, 826);
  });

  test('E2E8-5 receiving the rest at 18% does not add GST to units received earlier at 0%', async () => {
    const item = await createItem();
    const po = await createPO([{ item, qty: 4, price: 1000, tax: 0 }]);
    ok(await receiveAll(po, [{ itemId: item.id, quantityReceived: 2, taxPercent: 0 }]));
    ok(await receiveAll(po, [{ itemId: item.id, quantityReceived: 2, taxPercent: 18 }]));
    expectStatus(await post('/api/purchase/payment', { poId: po.id, amount: 4360.01, mode: 'Cash', actor: 'QA' }), 400, 'more than 2000 + 2360');
    ok(await post('/api/purchase/payment', { poId: po.id, amount: 4360, mode: 'Cash', actor: 'QA' }), 'pays 4,360');
  });

  test('PUR8-2 packing / other charges are added once per receipt and cannot be set by a PO save', async () => {
    const item = await createItem();
    const po = await createPO([{ item, qty: 4, price: 100 }], { extra: { otherCharges: 999 } });
    assert.equal(po.otherCharges || 0, 0, 'a new PO has no charges');
    ok(await receiveAll(po, [{ itemId: item.id, quantityReceived: 2 }], { otherCharges: 150 }));
    ok(await receiveAll(po, [{ itemId: item.id, quantityReceived: 1 }]));
    near((await getPO(po.id)).otherCharges, 150, 'not doubled by a later receipt');
    ok(await post('/api/purchase/save', editBody(await getPO(po.id), { otherCharges: 5000 })), 'edit');
    near((await getPO(po.id)).otherCharges, 150, 'a PO save cannot change charges');
    expectStatus(await receiveAll(po, [{ itemId: item.id, quantityReceived: 1 }], { otherCharges: -5 }), 400, 'negative charges');
  });

  test('PUR8-3 a PO save cannot remove or replace a received line, cut qty below received, or change the vendor', async () => {
    const a = await createItem();
    const b = await createItem();
    const po = await createPO([{ item: a, qty: 10, price: 100 }, { item: b, qty: 5, price: 50 }]);
    ok(await receiveAll(po, [{ itemId: a.id, quantityReceived: 6 }]));
    const stored = await getPO(po.id);
    const [la, lb] = stored.items;
    expectStatus(await post('/api/purchase/save', editBody(stored, { items: [lb] })), 409, 'remove received line');
    expectStatus(await post('/api/purchase/save', editBody(stored, { items: [{ ...la, itemId: b.id }, lb] })), 409, 'replace received line');
    expectStatus(await post('/api/purchase/save', editBody(stored, { items: [{ ...la, quantityOrdered: 5 }, lb] })), 400, 'qty below received');
    const other = await newVendor();
    expectStatus(await post('/api/purchase/save', editBody(stored, { vendorId: other.id, vendorName: other.vendorName })), 409, 'vendor change');
    ok(await post('/api/purchase/save', editBody(stored, { items: [{ ...la, quantityOrdered: 6 }] })), 'unreceived line may go; qty may drop to received');
    const after = await getPO(po.id);
    assert.equal(after.items.length, 1);
    assert.equal(after.items[0].receivedQuantity, 6, 'received kept');
    assert.equal(after.status, 'Received', 'fully settled after the edit');
  });

  test('PUR5-2 a PO save refuses qty 2.5 of a piece item, a bad date and a missing vendor (400, not 500)', async () => {
    const item = await createItem();
    const v = await anyVendor();
    const base = { vendorId: v.id, vendorName: v.vendorName, branchId: 'erode-hq', date: '2026-09-15', expectedDeliveryDate: '2026-09-30',
      items: [{ itemId: item.id, itemName: item.itemName, quantityOrdered: 2, purchasePrice: 10 }] };
    expectStatus(await post('/api/purchase/save', { po: { ...base, items: [{ ...base.items[0], quantityOrdered: 2.5 }] } }), 400, 'qty 2.5');
    expectStatus(await post('/api/purchase/save', { po: { ...base, date: 'hello' } }), 400, 'date hello');
    expectStatus(await post('/api/purchase/save', { po: { ...base, vendorId: undefined } }), 400, 'no vendorId');
    ok(await post('/api/purchase/save', { po: base }), 'valid PO');
  });

  test('PUR5-2 receiving uses the shared unit rule: 2.5 of a piece item is refused, 2.5 metres of cable is received', async () => {
    const piece = await createItem();
    const po = await createPO([{ item: piece, qty: 5, price: 10 }]);
    expectStatus(await receiveAll(po, [{ itemId: piece.id, quantityReceived: 2.5 }]), 400, 'receive 2.5 PCS');
    expectStatus(await receiveAll(po, [{ itemId: piece.id, quantityReceived: 2, damagedQuantity: 0.5 }]), 400, 'damaged 0.5 PCS');
    assert.equal(await stockOf(piece.id, 'erode-hq'), 0, 'nothing received');
    // The PO line carries no unit of its own — the item master's MTR decides.
    const cable = await createItem({ unit: 'MTR' });
    const cablePo = await createPO([{ item: cable, qty: 5, price: 10 }]);
    ok(await receiveAll(cablePo, [{ itemId: cable.id, quantityReceived: 2.5 }]), 'receive 2.5 MTR');
    near(await stockOf(cable.id, 'erode-hq'), 2.5, '2.5 m in stock');
  });

  test('PUR8-5 saving a PO with the same item on two lines keeps the received quantities', async () => {
    const item = await createItem();
    const po = await createPO([{ item, qty: 5, price: 100 }, { item, qty: 5, price: 100 }]);
    ok(await receiveAll(po, [{ itemId: item.id, quantityReceived: 5 }]));
    const stored = await getPO(po.id);
    ok(await post('/api/purchase/save', editBody(stored, { items: stored.items.map((l) => ({ ...l, purchasePrice: 110 })) })), 'save prices');
    const after = await getPO(po.id);
    assert.deepEqual(after.items.map((l) => l.receivedQuantity), [5, 0]);
    expectStatus(await receiveAll(po, [{ itemId: item.id, quantityReceived: 6 }]), 400, 'only 5 remain');
  });

  test('PUR4-3 a short shipment with nothing delivered (0 good + 3 missing) can be recorded', async () => {
    const item = await createItem();
    const po = await createPO([{ item, qty: 3, price: 100 }]);
    ok(await receiveAll(po, [{ itemId: item.id, quantityReceived: 0, missingQuantity: 3 }]));
    const after = await getPO(po.id);
    assert.equal(after.status, 'Received');
    assert.equal(after.items[0].missingQuantity, 3);
    assert.equal(await stockOf(item.id, 'erode-hq'), 0);
  });

  test('PUR8-4 a vendor over-payment keeps the full amount; the rest is an advance applied to a later PO', async () => {
    const vendor = await newVendor();
    const item = await createItem();
    const po1 = await createPO([{ item, qty: 2, price: 500 }], { vendor });
    ok(await receiveAll(po1, [{ itemId: item.id, quantityReceived: 2 }]));
    const pay = ok(await vendorPay(vendor, 1500, [{ refId: po1.id, refNumber: po1.poNumber, amount: 1500 }]), 'pay 1,500 on 1,000 owed');
    near(pay.amount, 1500, 'full amount stored (drawer not short)');
    near(pay.allocations.reduce((s, a) => s + a.amount, 0), 1000, 'applied to the PO');
    near((await getPO(po1.id)).amountPaid, 1000);
    const po2 = await createPO([{ item, qty: 1, price: 300 }], { vendor });
    ok(await receiveAll(po2, [{ itemId: item.id, quantityReceived: 1 }]));
    expectStatus(await post('/api/payments/vendor-advance/apply', { vendorId: vendor.id, poId: po2.id, amount: 600 }), 400, 'more than available');
    const applied = ok(await post('/api/payments/vendor-advance/apply', { vendorId: vendor.id, poId: po2.id }), 'apply advance');
    near(applied.applied, 300);
    near((await getPO(po2.id)).amountPaid, 300);
    const row = (await paymentsFor(po2.id)).find((p) => p.id === pay.id);
    near(row.amount, 1500, 'still one 1,500 payment');
    ok(await del(`/api/payments/${pay.id}`), 'delete payment');
    near((await getPO(po1.id)).amountPaid, 0, 'PO1 restored');
    near((await getPO(po2.id)).amountPaid, 0, 'PO2 restored');
  });

  test("CASH8-5 / PUR3-5 one vendor payment cannot settle another vendor's or another branch's PO", async () => {
    const v1 = await newVendor();
    const v2 = await newVendor();
    const item = await createItem();
    const p1 = await createPO([{ item, qty: 1, price: 100 }], { vendor: v1 });
    const p2 = await createPO([{ item, qty: 1, price: 100 }], { vendor: v2 });
    const p3 = await createPO([{ item, qty: 1, price: 100 }], { vendor: v1, branchId: 'chennai' });
    expectStatus(await vendorPay(v1, 200, [{ refId: p1.id, amount: 100 }, { refId: p2.id, amount: 100 }]), 400, 'mixed vendors');
    expectStatus(await vendorPay(v1, 100, [{ refId: p2.id, amount: 100 }]), 400, "other vendor's PO");
    expectStatus(await vendorPay(v1, 200, [{ refId: p1.id, amount: 100 }, { refId: p3.id, amount: 100 }]), 400, 'mixed branches');
    assert.equal((await getPO(p2.id)).amountPaid || 0, 0);
  });

  test('PUR8-8 a vendor payment to a missing or fully paid PO, or of 0, is refused', async () => {
    const vendor = await newVendor();
    const item = await createItem();
    const po = await createPO([{ item, qty: 1, price: 100 }], { vendor });
    ok(await receiveAll(po, [{ itemId: item.id, quantityReceived: 1 }]));
    ok(await post('/api/purchase/payment', { poId: po.id, amount: 100, mode: 'Cash', actor: 'QA' }));
    const r1 = expectStatus(await vendorPay(vendor, 50, [{ refId: po.id, amount: 50 }]), 400, 'fully paid');
    assert.equal(r1.body.error, 'NOTHING_TO_APPLY');
    expectStatus(await vendorPay(vendor, 50, [{ refId: 'po-does-not-exist', amount: 50 }]), 400, 'missing PO');
    expectStatus(await vendorPay(vendor, 50, [{ refId: po.id, amount: 0 }]), 400, 'zero allocation');
  });

  test('PUR8-9 a vendor payment dated in the future (IST) is refused', async () => {
    const vendor = await newVendor();
    expectStatus(await vendorPay(vendor, 100, [], { date: addDays(istToday(), 1) }), 400);
  });

  test('PUR3-8 supplier bill: GST must be 0..28% of taxable, a real past date and a bill number', async () => {
    const item = await createItem();
    const po = await createPO([{ item, qty: 1, price: 100 }]);
    const bill = (b) => post('/api/purchase/bill', { poId: po.id, bill: { number: 'B-1', date: '2026-09-16', taxable: 100, gst: 18, ...b } });
    expectStatus(await bill({ gst: -500 }), 400, 'negative GST');
    expectStatus(await bill({ gst: 99999 }), 400, 'GST above 28%');
    expectStatus(await bill({ taxable: -1, gst: 0 }), 400, 'negative taxable');
    expectStatus(await bill({ date: addDays(istToday(), 2) }), 400, 'future date');
    expectStatus(await bill({ date: 'hello' }), 400, 'bad date');
    expectStatus(await bill({ number: '' }), 400, 'no bill number');
    ok(await bill({}), 'valid bill');
    near((await getPO(po.id)).supplierBillGst, 18);
  });

  test('PUR2-12 attachments must be an image or PDF of at most 5 MB', async () => {
    const item = await createItem();
    const po = await createPO([{ item, qty: 1, price: 100 }]);
    const att = (dataUrl, name = 'x') => post('/api/purchase/attachment', { poId: po.id, attachment: { name, dataUrl }, actor: 'QA' });
    expectStatus(await att('data:application/x-msdownload;base64,TVqQAAMAAAAEAAAA', 'evil.exe'), 400, '.exe');
    expectStatus(await att('javascript:alert(1)'), 400, 'script');
    expectStatus(await att(`data:application/pdf;base64,${'A'.repeat(7 * 1024 * 1024)}`), 413, 'over 5 MB');
    ok(await att('data:application/pdf;base64,JVBERi0=', 'bill.pdf'), 'small PDF');
    assert.equal((await getPO(po.id)).attachments[0].fileType, 'pdf');
  });

  test('PUR6-5 a duplicate supplier (same GSTIN, or same name and phone) is refused', async () => {
    const letters = 'ABCDEFGHIJ';
    const pan = Array.from({ length: 5 }, () => letters[Math.floor(Math.random() * 10)]).join('');
    const gstin = `33${pan}${String(1000 + Math.floor(Math.random() * 9000))}A1Z5`;
    const v = await newVendor({ gstin });
    expectStatus(await post('/api/vendors', { vendorName: `Other ${uid()}`, contactNo: randomPhone(), address: '', gstin }), 409, 'same GSTIN');
    expectStatus(await post('/api/vendors', { vendorName: v.vendorName.toUpperCase(), contactNo: `+91 ${v.contactNo}`, address: '' }), 409, 'same name + phone');
    ok(await post('/api/vendors', { ...v, address: 'edited' }), 'editing the supplier itself is fine');
  });
});

describe('several supplier bills per PO', () => {
  test('E2E5-11 a PO keeps one supplier bill per delivery; the totals and old fields add them up; edit and remove work', async () => {
    const vendor = await newVendor();
    const item = await createItem();
    const po = await createPO([{ item, qty: 10, price: 100, tax: 18 }], { vendor });
    const n1 = `DEL-${uid()}`, n2 = `DEL-${uid()}`;
    ok(await post('/api/purchase/attachment', { poId: po.id, attachment: { name: 'bill1.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0=' }, actor: 'QA' }));
    const file = (await getPO(po.id)).attachments[0];
    ok(await post('/api/purchase/bill', { poId: po.id, bill: { number: n1, date: '2026-09-16', taxable: 600, gst: 108, attachmentId: file.id } }), 'first delivery bill');
    ok(await post('/api/purchase/bill', { poId: po.id, bill: { number: n2, date: '2026-09-20', taxable: 400, gst: 72 } }), 'second delivery bill');
    let after = await getPO(po.id);
    assert.equal(after.supplierBills.length, 2, 'both bills kept');
    assert.equal(after.supplierBills[0].attachmentId, file.id, 'bill linked to its file');
    near(after.supplierBillGst, 180, 'old field carries the total GST');
    near(after.supplierBillTaxable, 1000);
    assert.equal(after.supplierBillDate, '2026-09-20');
    // A file that isn't on the PO can't be linked.
    expectStatus(await post('/api/purchase/bill', { poId: po.id, bill: { number: `X-${uid()}`, date: '2026-09-20', taxable: 1, gst: 0, attachmentId: 'att-nope' } }), 400);
    // Edit the second bill, then remove the first.
    const second = after.supplierBills[1];
    ok(await post('/api/purchase/bill', { poId: po.id, bill: { id: second.id, number: n2, date: '2026-09-21', taxable: 500, gst: 90 } }), 'edit keeps its own number');
    ok(await post('/api/purchase/bill/delete', { poId: po.id, billId: after.supplierBills[0].id }), 'remove first');
    after = await getPO(po.id);
    assert.deepEqual(after.supplierBills.map((b) => [b.number, b.date, b.gst]), [[n2, '2026-09-21', 90]]);
    near(after.supplierBillGst, 90);
  });

  test('E2E5-11 the same supplier bill number cannot be recorded twice for one vendor', async () => {
    const vendor = await newVendor();
    const other = await newVendor();
    const item = await createItem();
    const po1 = await createPO([{ item, qty: 2, price: 100 }], { vendor });
    const po2 = await createPO([{ item, qty: 2, price: 100 }], { vendor });
    const po3 = await createPO([{ item, qty: 2, price: 100 }], { vendor: other });
    const n = `INV-${uid()}`;
    ok(await post('/api/purchase/bill', { poId: po1.id, bill: { number: n, date: '2026-09-16', taxable: 100, gst: 18 } }));
    const dupSame = await post('/api/purchase/bill', { poId: po1.id, bill: { number: n, date: '2026-09-17', taxable: 100, gst: 18 } });
    expectStatus(dupSame, 409, 'same PO');
    assert.equal(dupSame.body.error, 'DUPLICATE_SUPPLIER_BILL');
    expectStatus(await post('/api/purchase/bill', { poId: po2.id, bill: { number: ` ${n.toLowerCase()} `, date: '2026-09-17', taxable: 100, gst: 18 } }), 409, 'other PO, retyped');
    ok(await post('/api/purchase/bill', { poId: po3.id, bill: { number: n, date: '2026-09-17', taxable: 100, gst: 18 } }), 'another vendor may use the same number');
  });

  test('E2E5-11 an older PO with only the single-bill fields still reads as one bill and gains a second', async () => {
    const vendor = await newVendor();
    const item = await createItem();
    const po = await createPO([{ item, qty: 2, price: 100 }], { vendor });
    const old = `OLD-${uid()}`;
    if (!sql('SELECT 1')) return; // needs DATABASE_URL to fake the older row
    sql(`UPDATE "PurchaseOrder" SET "supplierBillNumber"='${old}', "supplierBillDate"='2026-09-10', "supplierBillTaxable"=200, "supplierBillGst"=36, "supplierBills"=NULL WHERE id='${po.id}'`);
    expectStatus(await post('/api/purchase/bill', { poId: po.id, bill: { number: old, date: '2026-09-12', taxable: 1, gst: 0 } }), 409, 'old bill number is known');
    ok(await post('/api/purchase/bill', { poId: po.id, bill: { number: `NEW-${uid()}`, date: '2026-09-12', taxable: 100, gst: 18 } }));
    const after = await getPO(po.id);
    assert.equal(after.supplierBills.length, 2, 'the old bill is kept as the first entry');
    assert.equal(after.supplierBills[0].number, old);
    near(after.supplierBillGst, 54);
  });
});

describe('PO GST per line', () => {
  test('PUR-14 a new PO carries GST per line, so its total shows tax before anything is received', async () => {
    const a = await createItem({ gst: 18 });
    const b = await createItem({ gst: 5 });
    const po = await createPO([{ item: a, qty: 2, price: 100, tax: 18 }, { item: b, qty: 1, price: 200, tax: 5 }]);
    near(po.totalAmount, 400);
    near(po.totalTax, 46, 'GST 36 + 10 before receipt');
    assert.deepEqual(po.items.map((l) => l.taxPercent), [18, 5]);
  });
});
