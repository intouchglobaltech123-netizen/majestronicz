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
});
