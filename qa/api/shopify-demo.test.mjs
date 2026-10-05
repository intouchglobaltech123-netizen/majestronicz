// Shopify demo-order loader — populate the fulfillment pipeline without a store.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { post, get, ok, expectStatus } from './lib.mjs';

describe('shopify demo orders', () => {
  test('SHOP-DEMO loads demo online orders spread across the pipeline', async () => {
    const res = ok(await post('/api/shopify/demo-orders', { count: 6 }), 'load demo orders');
    assert.equal(res.created, 6, 'created the requested count');
    const demo = ok(await get('/api/invoices')).filter((i) => i.sourceChannel === 'shopify-demo');
    assert.ok(demo.length >= 6, 'demo orders exist as online-order invoices');
    assert.ok(demo.every((i) => i.onlineStatus), 'each carries a fulfillment stage');
    assert.ok(new Set(demo.map((i) => i.onlineStatus)).size > 1, 'spread across more than one stage');
  });

  test('SHOP-DEMO only a Manager or CEO can load demo orders', async () => {
    expectStatus(await post('/api/shopify/demo-orders', { count: 3 }, 'Billing'), 403, 'Billing is refused');
  });

  test('SHOP-FLOW a demo order can be marked through the pipeline, annotated and have an issue raised', async () => {
    ok(await post('/api/shopify/demo-orders', { count: 4 }), 'load demo orders');
    const orders = ok(await get('/api/invoices')).filter((i) => i.sourceChannel === 'shopify-demo');
    const o = orders.find((i) => i.onlineStatus === 'New') || orders[0];
    assert.ok(o, 'a demo order exists to work');
    // Mark it through the fulfillment stages (the "Mark next" action).
    ok(await post('/api/shopify/order-status', { invoiceId: o.id, status: 'Picking', note: 'picking started' }), 'mark Picking');
    ok(await post('/api/shopify/order-status', { invoiceId: o.id, status: 'Confirmed' }), 'mark Confirmed');
    // Communication (WhatsApp photo sent), packing details, and an issue.
    ok(await post('/api/shopify/order-comm', { invoiceId: o.id, type: 'photo_sent', note: 'tray photo sent' }), 'record communication');
    ok(await post('/api/shopify/order-packing', { invoiceId: o.id, parcelWeightKg: 1.2, boxCount: 1, addressLabelDone: true, invoiceIncluded: true }), 'save packing');
    const issued = ok(await post('/api/shopify/order-issue', { invoiceId: o.id, type: 'Damaged', description: 'dented box' }), 'raise an issue');
    const issueId = (issued.invoice?.issues || []).slice(-1)[0]?.id;
    assert.ok(issueId, 'issue recorded on the order');
    ok(await post('/api/shopify/order-issue-resolve', { invoiceId: o.id, issueId, resolution: 'replaced' }), 'resolve the issue');
    const after = ok(await get('/api/invoices')).find((i) => i.id === o.id);
    assert.equal(after.onlineStatus, 'Confirmed', 'the stage advance is stored');
    assert.ok(Array.isArray(after.onlineStatusHistory) && after.onlineStatusHistory.length >= 3, 'append-only activity history kept');
  });

  test('SHOP-TRACK tracking (courier, AWB, reference, URL) can be recorded on an order at any stage', async () => {
    ok(await post('/api/shopify/demo-orders', { count: 1 }), 'load a demo order');
    const o = ok(await get('/api/invoices')).filter((i) => i.sourceChannel === 'shopify-demo')[0];
    assert.ok(o, 'a demo order exists');
    const res = ok(await post('/api/shopify/order-tracking', {
      invoiceId: o.id, courierName: 'DTDC', trackingNumber: 'AWB-123456', trackingUrl: 'https://dtdc.in/track/AWB-123456', trackingReference: 'DKT-9',
    }), 'save tracking');
    const inv = res.invoice;
    assert.equal(inv.courierName, 'DTDC');
    assert.equal(inv.trackingNumber, 'AWB-123456');
    assert.equal(inv.trackingReference, 'DKT-9');
    assert.ok(inv.trackingReceivedAt, 'the recorded time is stamped');
    assert.ok((inv.onlineStatusHistory || []).some((h) => /Tracking recorded/.test(h.note || '')), 'logged to the activity history');
    // A non-image courier slip is refused.
    expectStatus(await post('/api/shopify/order-tracking', { invoiceId: o.id, trackingSlipUrl: 'definitely-not-an-image' }), 400, 'a bad slip image is rejected');
  });

  test('SHOP-COURIER courier step, staff assignment and proof of delivery are recorded', async () => {
    ok(await post('/api/shopify/demo-orders', { count: 1 }));
    const o = ok(await get('/api/invoices')).filter((i) => i.sourceChannel === 'shopify-demo')[0];
    let r = ok(await post('/api/shopify/order-courier-status', { invoiceId: o.id, status: 'Booked' }), 'set courier step');
    assert.equal(r.invoice.courierStatus, 'Booked', 'courier status is its own track');
    expectStatus(await post('/api/shopify/order-courier-status', { invoiceId: o.id, status: 'Nope' }), 400, 'invalid courier step refused');
    r = ok(await post('/api/shopify/order-assign', { invoiceId: o.id, stage: 'Picking', staffName: 'Gokul' }), 'assign staff');
    assert.equal(r.invoice.assignedStaff.Picking, 'Gokul', 'staff assigned to the step');
    r = ok(await post('/api/shopify/order-pod', { invoiceId: o.id, receiverName: 'Neighbour', note: 'left with watchman' }), 'record POD');
    assert.equal(r.invoice.podReceiverName, 'Neighbour');
    assert.ok(r.invoice.podReceivedAt, 'delivery time captured');
    expectStatus(await post('/api/shopify/order-pod', { invoiceId: o.id, receiverName: '' }), 400, 'receiver name required');
  });

  test('SHOP-FLOW an invalid order stage is refused', async () => {
    ok(await post('/api/shopify/demo-orders', { count: 1 }));
    const o = ok(await get('/api/invoices')).filter((i) => i.sourceChannel === 'shopify-demo')[0];
    expectStatus(await post('/api/shopify/order-status', { invoiceId: o.id, status: 'Banana' }), 400, 'a nonsense stage is rejected');
  });
});
