// Stock movements and the stock history (ledger) that must explain them.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  post, get, del, ok, expectStatus, createItem, stockOf, ledgerOf, line, saleBody, mustSell, getInvoice, resave,
  returnLine, freshDay, thisMonthDay, createPO,
} from './lib.mjs';

const sumChanges = (rows) => rows.reduce((t, r) => t + (Number(r.quantityChange) || 0), 0);

/** Ledger must explain every unit: sum(changes) === stock now. Opening stock is
 *  itself a ledger row, so a complete history starts from 0 and adds up to now. */
async function assertReconciles(item, branchId, opening, what) {
  const now = await stockOf(item.id, branchId);
  const rows = await ledgerOf(item.id, branchId);
  assert.equal(sumChanges(rows), now, `${what}: stock ${now} but ledger sums to ${sumChanges(rows)}`);
}

describe('stock & ledger', () => {
  test('INV2-4 sales, receipts, returns and voids all write stock history that adds up', async () => {
    const date = await thisMonthDay();
    const item = await createItem({ stock: { 'erode-hq': 30 } });
    const sale = await mustSell(saleBody({ date, lines: [line(item, 4)] }));
    const po = await createPO([{ item, qty: 6, price: 100 }]);
    ok(await post('/api/purchase/receive', { poId: po.id, receipts: [{ itemId: item.id, quantityReceived: 6 }], actor: 'QA' }));
    ok(await post('/api/tx/sale-return', { invoiceId: sale.id, returnLines: [returnLine(item, 1)], reason: 'QA', actor: 'QA', refundMode: 'Cash' }));
    const sale2 = await mustSell(saleBody({ date, lines: [line(item, 2)] }));
    ok(await post('/api/tx/void-invoice', { invoiceId: sale2.id, reason: 'QA', actor: 'QA' }));
    assert.equal(await stockOf(item.id, 'erode-hq'), 30 - 4 + 6 + 1);
    await assertReconciles(item, 'erode-hq', 30, 'after sale/receipt/return/void');
  });

  test('INV2-4 opening stock on a new item writes a stock-history row', async () => {
    const item = await createItem({ stock: { 'erode-hq': 12 } });
    const rows = await ledgerOf(item.id, 'erode-hq');
    assert.equal(sumChanges(rows), 12, 'opening stock should appear in the stock history');
  });

  test('INV2-4 editing a bill writes stock history that adds up', async () => {
    const date = await thisMonthDay(); // FIN-A-3: only a bill of the current month can be edited
    const item = await createItem({ stock: { 'erode-hq': 20 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 2)] }));
    const stored = await getInvoice(inv.id);
    ok(await resave(stored, { items: [line(item, 3)] }), 'edit qty 2 -> 3');
    assert.equal(await stockOf(item.id, 'erode-hq'), 17);
    await assertReconciles(item, 'erode-hq', 20, 'after bill edit');
  });

  test('INV2-4 deleting a live bill writes stock history that adds up', async () => {
    const date = await thisMonthDay();
    const item = await createItem({ stock: { 'erode-hq': 20 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 5)] }));
    ok(await del(`/api/tx/invoice/${inv.id}`));
    assert.equal(await stockOf(item.id, 'erode-hq'), 20);
    await assertReconciles(item, 'erode-hq', 20, 'after deleting a bill');
  });

  test('INV2-4 a direct stock set (/stock/update) writes stock history', async () => {
    const item = await createItem({ stock: { 'erode-hq': 10 } });
    ok(await post('/api/stock/update', { itemId: item.id, branchId: 'erode-hq', quantity: 25 }));
    await assertReconciles(item, 'erode-hq', 10, 'after /stock/update');
  });

  test('INV2-4 / FIN-B-11 an adjustment below zero is refused with the real count; down to zero logs exactly', async () => {
    const item = await createItem({ stock: { 'erode-hq': 45 } });
    const res = await post('/api/stock/adjust', { itemId: item.id, branchId: 'erode-hq', quantityChange: -1000, reason: 'Damage', actor: 'QA' });
    expectStatus(res, 409, 'over-removal');
    assert.match(res.body.message, /Only 45 /);
    assert.equal(await stockOf(item.id, 'erode-hq'), 45, 'nothing removed');
    ok(await post('/api/stock/adjust', { itemId: item.id, branchId: 'erode-hq', quantityChange: -45, reason: 'Damage', actor: 'QA' }));
    assert.equal(await stockOf(item.id, 'erode-hq'), 0);
    await assertReconciles(item, 'erode-hq', 45, 'after -45 adjustment');
  });

  test('ACT-1 a stock adjustment is stamped with the logged-in user, not the name sent in the body', async () => {
    const item = await createItem({ stock: { 'erode-hq': 20 } });
    ok(await post('/api/stock/adjust', { itemId: item.id, branchId: 'erode-hq', quantityChange: -2, reason: 'QA', actor: 'HACKER McFakename' }));
    const row = (await ledgerOf(item.id, 'erode-hq')).find((r) => r.reason === 'QA');
    assert.ok(row, 'the adjustment was logged');
    assert.notEqual(row.adjustedBy, 'HACKER McFakename', 'the body-supplied actor must be ignored');
    assert.ok(row.adjustedBy && row.adjustedBy !== 'System', 'stamped with the authenticated user');
  });

  test('INV8-4 a stock adjustment sent as a string number does not create phantom stock', async () => {
    const item = await createItem({ stock: { 'erode-hq': 20 } });
    // The request body is untyped JSON — the client can send "5" (a string).
    ok(await post('/api/stock/adjust', { itemId: item.id, branchId: 'erode-hq', quantityChange: '5', reason: 'QA', actor: 'QA' }));
    assert.equal(await stockOf(item.id, 'erode-hq'), 25, 'string "5" adds 5, not 205');
    expectStatus(await post('/api/stock/adjust', { itemId: item.id, branchId: 'erode-hq', quantityChange: 'abc', reason: 'QA', actor: 'QA' }), 400, 'a non-numeric adjustment is refused');
  });

  test('INV2-2 a batch transfer with the same item on two lines cannot move more than the stock', async () => {
    const item = await createItem({ stock: { 'erode-hq': 20 } });
    const res = await post('/api/stock/transfer-batch', { items: [{ itemId: item.id, quantity: 15 }, { itemId: item.id, quantity: 15 }], fromBranch: 'erode-hq', toBranch: 'chennai', actor: 'QA' });
    expectStatus(res, 409);
    assert.equal(await stockOf(item.id, 'erode-hq'), 20);
  });

  test('PLT-17 a transfer takes stock out on dispatch and adds it once on receipt (a second receive does nothing)', async () => {
    const item = await createItem({ stock: { 'erode-hq': 10, chennai: 1 } });
    const res = ok(await post('/api/stock/transfer', { itemId: item.id, fromBranch: 'erode-hq', toBranch: 'chennai', quantity: 4, actor: 'QA' }));
    assert.equal(await stockOf(item.id, 'erode-hq'), 6);
    assert.equal(await stockOf(item.id, 'chennai'), 1, 'in transit, not yet received');
    const trf = res.stockTransfers.find((t) => t.transferNumber === res.transferRef);
    ok(await post('/api/stock/transfer-receive', { transferId: trf.id, actor: 'QA' }));
    ok(await post('/api/stock/transfer-receive', { transferId: trf.id, actor: 'QA' }));
    assert.equal(await stockOf(item.id, 'chennai'), 5);
  });

  test('SEC2-1 only the destination branch can receive a transfer', async () => {
    const item = await createItem({ stock: { 'erode-hq': 10 } });
    const res = ok(await post('/api/stock/transfer', { itemId: item.id, fromBranch: 'erode-hq', toBranch: 'chennai', quantity: 2, actor: 'QA' }));
    const trf = res.stockTransfers.find((t) => t.transferNumber === res.transferRef);
    expectStatus(await post('/api/stock/transfer-receive', { transferId: trf.id, actor: 'QA' }, 'Manager'), 403, 'Coimbatore manager receiving a Chennai transfer');
    assert.equal(await stockOf(item.id, 'chennai'), 0);
  });

  test('SEC2-1 a Coimbatore manager cannot adjust or transfer Erode stock', async () => {
    const item = await createItem({ stock: { 'erode-hq': 10 } });
    expectStatus(await post('/api/stock/adjust', { itemId: item.id, branchId: 'erode-hq', quantityChange: -5, reason: 'x', actor: 'QA' }, 'Manager'), 403, 'adjust');
    expectStatus(await post('/api/stock/transfer', { itemId: item.id, fromBranch: 'erode-hq', toBranch: 'coimbatore', quantity: 5, actor: 'QA' }, 'Manager'), 403, 'transfer');
    assert.equal(await stockOf(item.id, 'erode-hq'), 10);
  });

  test('STK-6 stock cannot be sent to an unknown branch', async () => {
    const item = await createItem({ stock: { 'erode-hq': 10 } });
    expectStatus(await post('/api/stock/transfer', { itemId: item.id, fromBranch: 'erode-hq', toBranch: 'mars', quantity: 2, actor: 'QA' }), 400);
    assert.equal(await stockOf(item.id, 'erode-hq'), 10);
  });

  test('INV6-4 /stock/location refuses an unknown branch', async () => {
    const item = await createItem({ stock: { 'erode-hq': 1 } });
    const res = await post('/api/stock/location', { itemId: item.id, branchId: 'mars', location: 'Rack 1' });
    expectStatus(res, 400);
  });

  test('INV-5 an item whose stock is in transit cannot be deleted', async () => {
    const item = await createItem({ stock: { 'erode-hq': 3 } });
    ok(await post('/api/stock/transfer', { itemId: item.id, fromBranch: 'erode-hq', toBranch: 'chennai', quantity: 3, actor: 'QA' }));
    expectStatus(await del(`/api/catalog/item/${item.id}`), 409, 'delete item with stock in transit');
  });

  test('INV-5 an item with stock cannot be deleted', async () => {
    const item = await createItem({ stock: { 'erode-hq': 3 } });
    expectStatus(await del(`/api/catalog/item/${item.id}`), 409);
  });

  test('INV4-5 a Coimbatore manager cannot create opening stock in another branch', async () => {
    const res = await post('/api/catalog/item', { item: {
      itemName: 'QA branch rule', itemHSN: '85371000', category: 'QA', itemCode: `QA-BR-${Date.now()}`, unit: 'PCS',
      salePrice: 10, salePriceTaxMode: 'exclusive', wholesalePrice: 10, minWholesaleQty: 1, purchasePrice: 5, gstTaxSlab: 18,
    }, initialStocks: { 'erode-hq': 50 } }, 'Manager');
    expectStatus(res, 403);
  });

  test('INV-2 / INV-9 duplicate item codes and negative prices are refused', async () => {
    const item = await createItem();
    const dup = await post('/api/catalog/item', { item: { ...item, id: undefined, itemCode: item.itemCode.toLowerCase() }, initialStocks: {} });
    expectStatus(dup, 409, 'duplicate code');
    const neg = await post('/api/catalog/item', { item: { ...item, id: undefined, itemCode: `${item.itemCode}-N`, salePrice: -5 }, initialStocks: {} });
    expectStatus(neg, 400, 'negative price');
  });

  test('CRUD-1 branch stock cannot be overwritten through a generic route', async () => {
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const res = await post('/api/branch-stock', { itemId: item.id, branchId: 'erode-hq', quantity: 9999 });
    expectStatus(res, 404);
    assert.equal(await stockOf(item.id, 'erode-hq'), 5);
  });
});
