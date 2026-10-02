// Items, combos and stock rules (round 8 inventory findings).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  post, get, put, del, ok, expectStatus, uid, createItem, createCombo, stockOf, ledgerOf, line, comboLine, saleBody,
  sell, mustSell, getInvoice, resave, returnLine, freshDay, addDays, istToday, register,
} from './lib.mjs';

const ret = (invoiceId, returnLines, as = 'CEO') =>
  post('/api/tx/sale-return', { invoiceId, returnLines, reason: 'QA', actor: 'QA', refundMode: 'Cash' }, as);

describe('combos and returns', () => {
  test('INV8-1 a return line flagged as a combo with its own parts creates no stock', async () => {
    const date = await freshDay('erode-hq');
    const omron = await createItem({ price: 950, stock: { 'erode-hq': 10 } });
    const servo = await createItem({ price: 24000, stock: { 'erode-hq': 5 } });
    const inv = await mustSell(saleBody({ date, lines: [line(omron, 1)] }), 'Billing');
    // The plain Omron line, sent back as a "combo" made of 10 servo motors.
    const forged = { ...returnLine(omron, 1), isCombo: true, comboComponents: [{ itemId: servo.id, quantity: 10 }] };
    const res = await ret(inv.id, [forged], 'Billing');
    if (res.status === 200) {
      // Accepted only as the sold Omron line: the Omron comes back, no servo appears.
      assert.equal(await stockOf(omron.id, 'erode-hq'), 10, 'the Omron is restocked');
    } else {
      expectStatus(res, 400, 'forged combo return');
      assert.equal(await stockOf(omron.id, 'erode-hq'), 9);
    }
    assert.equal(await stockOf(servo.id, 'erode-hq'), 5, 'no servo stock from nothing');
    // A combo id that is not on the bill is refused too.
    const combo = await createCombo([{ item: servo, qty: 10 }]);
    expectStatus(await ret(inv.id, [{ ...forged, itemId: combo.id, comboId: combo.id }], 'Billing'), 400, 'combo not on the bill');
    assert.equal(await stockOf(servo.id, 'erode-hq'), 5, 'still no servo stock');
  });

  test('INV8-2 a combo return stores the sold parts, so a later void restores each unit once', async () => {
    const date = await freshDay('erode-hq');
    const a = await createItem({ stock: { 'erode-hq': 20 } });
    const b = await createItem({ stock: { 'erode-hq': 20 } });
    const combo = await createCombo([{ item: a, qty: 2 }, { item: b, qty: 1 }]);
    const inv = await mustSell(saleBody({ date, lines: [comboLine(combo, 2)] }));
    assert.equal(await stockOf(a.id, 'erode-hq'), 16);
    // The browser sends the combo back with no parts at all.
    ok(await ret(inv.id, [{ itemId: combo.id, comboId: combo.id, isCombo: true, itemName: combo.comboName, returnQty: 1, comboComponents: [] }]), 'return 1 kit');
    assert.equal(await stockOf(a.id, 'erode-hq'), 18, 'one kit of A back');
    assert.equal(await stockOf(b.id, 'erode-hq'), 19);
    const stored = await getInvoice(inv.id);
    const rec = stored.returns.find((r) => r.isCombo);
    assert.deepEqual(rec.comboComponents.map((c) => [c.itemId, c.quantity]).sort(), [[a.id, 2], [b.id, 1]].sort(), 'return record keeps the sold parts');
    ok(await post('/api/tx/void-invoice', { invoiceId: inv.id, reason: 'QA', actor: 'QA' }), 'void');
    assert.equal(await stockOf(a.id, 'erode-hq'), 20, 'A back to where it started, not more');
    assert.equal(await stockOf(b.id, 'erode-hq'), 20, 'B back to where it started, not more');
  });

  test('INV8-2 deleting a bill after a combo return restores each unit once', async () => {
    const date = await freshDay('erode-hq');
    const a = await createItem({ stock: { 'erode-hq': 20 } });
    const combo = await createCombo([{ item: a, qty: 3 }]);
    const inv = await mustSell(saleBody({ date, lines: [comboLine(combo, 2)] }));
    ok(await ret(inv.id, [{ itemId: combo.id, comboId: combo.id, isCombo: true, itemName: combo.comboName, returnQty: 1, comboComponents: [{ itemId: a.id, quantity: 50 }] }]), 'return');
    assert.equal(await stockOf(a.id, 'erode-hq'), 17, 'the return restocks the sold 3, not the 50 sent');
    ok(await del(`/api/tx/invoice/${inv.id}`), 'delete');
    assert.equal(await stockOf(a.id, 'erode-hq'), 20);
  });

  test('INV3-3 a combo line with a made-up or missing combo id is refused', async () => {
    const date = await freshDay('erode-hq');
    const a = await createItem({ stock: { 'erode-hq': 20 } });
    const combo = await createCombo([{ item: a, qty: 1 }]);
    const fake = { ...comboLine(combo, 1, [{ itemId: a.id, quantity: -50 }]), comboId: `combo-fake-${uid()}`, itemId: `combo-fake-${uid()}` };
    expectStatus((await sell(saleBody({ date, lines: [fake] }), 'Billing')).res, 400, 'made-up combo id');
    const missing = { ...comboLine(combo, 1, [{ itemId: a.id, quantity: -50 }]) };
    delete missing.comboId;
    missing.itemId = `combo-none-${uid()}`;
    expectStatus((await sell(saleBody({ date, lines: [missing] }), 'Billing')).res, 400, 'missing combo id');
    assert.equal(await stockOf(a.id, 'erode-hq'), 20, 'no stock moved');
  });

  test('INV6-9 the combo API refuses a blank name, a negative price, no parts, unknown items and bad quantities', async () => {
    const a = await createItem({ stock: {} });
    const base = { id: `combo-qa-${uid()}`, comboName: 'QA combo', comboPrice: 100, components: [{ itemId: a.id, quantity: 1 }] };
    expectStatus(await post('/api/catalog/combo', { ...base, comboName: '  ' }), 400, 'blank name');
    expectStatus(await post('/api/catalog/combo', { ...base, comboPrice: -5 }), 400, 'negative price');
    expectStatus(await post('/api/catalog/combo', { ...base, comboPrice: 'abc' }), 400, 'text price');
    expectStatus(await post('/api/catalog/combo', { ...base, components: [] }), 400, 'no parts');
    expectStatus(await post('/api/catalog/combo', { ...base, components: [{ itemId: 'item-does-not-exist', quantity: 1 }] }), 400, 'unknown item');
    for (const quantity of [-3, 0, 2.5, 'abc']) {
      expectStatus(await post('/api/catalog/combo', { ...base, components: [{ itemId: a.id, quantity }] }), 400, `part qty ${quantity}`);
    }
    const combos = ok(await get('/api/combos'));
    assert.ok(!combos.some((c) => c.id === base.id), 'nothing was stored');
    ok(await post('/api/catalog/combo', base), 'a valid combo saves');
  });

  test('INV8-3 editing a bill after its combo changed restores what the bill really took', async () => {
    const date = await freshDay('erode-hq');
    const a = await createItem({ stock: { 'erode-hq': 20 } });
    const b = await createItem({ stock: { 'erode-hq': 20 } });
    const combo = await createCombo([{ item: a, qty: 1 }, { item: b, qty: 1 }]);
    const inv = await mustSell(saleBody({ date, lines: [comboLine(combo, 3)] }));
    // The combo master changes after the sale: now 2 of A and no B.
    ok(await post('/api/catalog/combo', { ...combo, components: [{ itemId: a.id, quantity: 2 }] }), 'change combo');
    const stored = await getInvoice(inv.id);
    ok(await resave(stored, { customerName: 'QA edited name' }), 'edit customer name');
    assert.equal(await stockOf(a.id, 'erode-hq'), 17, 'the unchanged combo line keeps its sold parts');
    assert.equal(await stockOf(b.id, 'erode-hq'), 17);
    ok(await post('/api/tx/void-invoice', { invoiceId: inv.id, reason: 'QA', actor: 'QA' }), 'void');
    assert.equal(await stockOf(a.id, 'erode-hq'), 20, 'A fully restored');
    assert.equal(await stockOf(b.id, 'erode-hq'), 20, 'B fully restored, nothing vanished');
  });

  test('INV6-8 combo component stock-history rows carry the component name and code', async () => {
    const date = await freshDay('erode-hq');
    const a = await createItem({ stock: { 'erode-hq': 10 } });
    const combo = await createCombo([{ item: a, qty: 2 }]);
    await mustSell(saleBody({ date, lines: [comboLine(combo, 1)] }));
    const row = (await ledgerOf(a.id, 'erode-hq')).find((r) => r.reason === 'Sale');
    assert.ok(row, 'a sale row exists');
    assert.equal(row.itemName, a.itemName);
    assert.equal(row.itemCode, a.itemCode);
  });

  test('INV6-4 a sale for an unknown branch is refused', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 10 } });
    expectStatus((await sell(saleBody({ branchId: 'mars', date, lines: [line(item, 1)] }))).res, 400, 'branch mars');
    const invoices = ok(await get('/api/invoices'));
    assert.ok(!invoices.some((i) => i.branchId === 'mars'), 'no bill for mars');
  });
});

describe('delivery challans', () => {
  const challans = async () => ok(await get('/api/challans'));
  const manual = (extra = {}) => ({
    id: `dc-qa-${uid()}`, challanNumber: 'DC-777', recipientName: 'QA Customer', location: 'Erode', contactNo: '9876543210',
    date: '2026-09-15', time: '10:00', items: [{ id: 'l1', itemName: 'QA part', quantity: 2, unit: 'NOS' }], totalQuantity: 2,
    termsAndConditions: 'QA', ...extra,
  });
  const dispatch = async (qty = 2) => {
    const item = await createItem({ stock: { 'erode-hq': 10 } });
    const res = ok(await post('/api/stock/transfer', { itemId: item.id, fromBranch: 'erode-hq', toBranch: 'chennai', quantity: qty }));
    const trf = res.stockTransfers.find((t) => t.transferNumber === res.transferRef);
    const ch = res.challans.find((c) => c.challanNumber === res.challanNumber);
    return { item, trf, ch, res };
  };

  test('INV8-5 receiving a transfer marks its DC-TRF challan received with the IST time', async () => {
    const { trf, ch } = await dispatch();
    assert.equal(ch.status, 'pending');
    ok(await post('/api/stock/transfer-receive', { transferId: trf.id }));
    const after = (await challans()).find((c) => c.id === ch.id);
    assert.equal(after.status, 'received', 'the challan follows the transfer');
    assert.ok(after.receivedAt, 'with the time it was received');
    const ist = new Date(Date.parse(after.receivedAt) + 5.5 * 3600 * 1000).toISOString();
    assert.equal(after.receivedBy.date, ist.slice(0, 10), 'the document date is the IST day');
    assert.equal(after.receivedBy.time, ist.slice(11, 16), 'the document time is IST');
  });

  test('INV8-5 Mark Received on a DC-TRF challan receives the transfer and credits the destination', async () => {
    const { item, trf, ch } = await dispatch(3);
    // Only the destination branch (or CEO) may receive it.
    expectStatus(await post(`/api/catalog/challan/${ch.id}/received`, {}, 'Billing'), 403, 'Erode Billing on a Chennai transfer');
    expectStatus(await post(`/api/catalog/challan/${ch.id}/received`, {}, 'Manager'), 403, 'Coimbatore manager');
    assert.equal((await challans()).find((c) => c.id === ch.id).status, 'pending');
    ok(await post(`/api/catalog/challan/${ch.id}/received`, {}), 'CEO receives');
    assert.equal(await stockOf(item.id, 'chennai'), 3, 'stock credited once');
    const t = ok(await get('/api/stock-transfers')).find((x) => x.id === trf.id);
    assert.equal(t.status, 'received', 'the transfer is received too');
    // INV8-6: a second Mark Received is refused, and stock does not move again.
    expectStatus(await post(`/api/catalog/challan/${ch.id}/received`, {}), 409, 'second mark received');
    assert.equal(await stockOf(item.id, 'chennai'), 3);
  });

  test('INV8-6 Mark Received on a manual challan is refused the second time', async () => {
    const saved = ok(await post('/api/catalog/challan', manual())).savedChallan;
    const first = ok(await post(`/api/catalog/challan/${saved.id}/received`, { receiverName: 'QA receiver' }));
    const row = first.challans.find((c) => c.id === saved.id);
    expectStatus(await post(`/api/catalog/challan/${saved.id}/received`, { receiverName: 'Someone else' }), 409);
    const again = (await challans()).find((c) => c.id === saved.id);
    assert.equal(again.receivedAt, row.receivedAt, 'time not overwritten');
    assert.equal(again.receivedBy.name, 'QA receiver', 'name not overwritten');
  });

  test('INV-3 / INV-12 challan numbers come from the server and are never reused after a delete', async () => {
    const a = ok(await post('/api/catalog/challan', manual())).savedChallan;
    assert.notEqual(a.challanNumber, 'DC-777', 'a typed number is not used');
    ok(await del(`/api/catalog/challan/${a.id}`));
    const b = ok(await post('/api/catalog/challan', manual())).savedChallan;
    assert.notEqual(b.challanNumber, a.challanNumber, 'manual number not reused');
    // Transfer challans: delete the newest, then transfer again.
    const first = await dispatch();
    ok(await del(`/api/catalog/challan/${first.ch.id}`), 'CEO deletes the newest transfer challan');
    const second = await dispatch();
    assert.notEqual(second.ch.challanNumber, first.ch.challanNumber, 'DC-TRF number not reused');
  });

  test('INV-13 manual challans are validated; Billing cannot edit or delete transfer challans; received ones are locked', async () => {
    for (const items of [[], [{ itemName: 'QA', quantity: 1_000_000 }], [{ itemName: 'QA', quantity: -1 }], [{ itemName: 'QA', quantity: 'abc' }], [{ itemName: '', quantity: 1 }]]) {
      expectStatus(await post('/api/catalog/challan', manual({ items }), 'Billing'), 400, `items ${JSON.stringify(items)}`);
    }
    const counted = await createItem({ stock: {} });
    expectStatus(await post('/api/catalog/challan', manual({ items: [{ itemId: counted.id, itemName: counted.itemName, quantity: 1.5, unit: 'PCS' }] }), 'Billing'), 400, '1.5 PCS');
    const { trf, ch } = await dispatch();
    expectStatus(await post('/api/catalog/challan', { ...ch, recipientName: 'Billing rewrite' }, 'Billing'), 403, 'Billing edits a transfer challan');
    expectStatus(await del(`/api/catalog/challan/${ch.id}`, 'Billing'), 403, 'Billing deletes a transfer challan');
    ok(await post('/api/stock/transfer-receive', { transferId: trf.id }));
    expectStatus(await post('/api/catalog/challan', { ...ch, recipientName: 'CEO rewrite' }), 409, 'edit a received transfer challan');
    expectStatus(await del(`/api/catalog/challan/${ch.id}`), 409, 'delete a received transfer challan');
  });
});

describe('item master', () => {
  const itemBody = (extra = {}) => {
    const code = `QA-${uid()}`.toUpperCase();
    return {
      itemName: `QA master ${code}`, itemHSN: '85371000', category: 'QA', itemCode: code, unit: 'PCS',
      salePrice: 100, salePriceTaxMode: 'exclusive', wholesalePrice: 100, minWholesaleQty: 1, purchasePrice: 60, gstTaxSlab: 18, ...extra,
    };
  };

  test('INV5-7 an item with stock history cannot be deleted; it is archived instead and keeps its history', async () => {
    const item = await createItem({ stock: { 'erode-hq': 4 } });
    ok(await post('/api/stock/adjust', { itemId: item.id, branchId: 'erode-hq', quantityChange: -4, reason: 'Damage' }), 'adjust to zero');
    const before = (await ledgerOf(item.id)).length;
    assert.ok(before >= 2, 'opening + adjustment rows');
    expectStatus(await del(`/api/catalog/item/${item.id}`), 409, 'delete an item with history');
    assert.equal((await ledgerOf(item.id)).length, before, 'history kept');
    // Billing and Purchase cannot archive; a Manager/CEO can.
    expectStatus(await post(`/api/catalog/item/${item.id}/archive`, { archived: true }, 'Billing'), 403, 'Billing archive');
    const res = ok(await post(`/api/catalog/item/${item.id}/archive`, { archived: true }), 'CEO archives');
    const row = res.items.find((i) => i.id === item.id);
    assert.equal(row.isArchived, true);
    assert.ok(row.archivedBy && row.archivedAt);
    assert.equal((await ledgerOf(item.id)).length, before, 'history still kept');
    // An archive flag sent on a normal edit is ignored; restore works.
    ok(await put(`/api/catalog/item/${item.id}`, { isArchived: false }), 'edit');
    assert.equal(ok(await get('/api/items')).find((i) => i.id === item.id).isArchived, true, 'edit cannot unarchive');
    const back = ok(await post(`/api/catalog/item/${item.id}/archive`, { archived: false }), 'restore');
    assert.ok(!back.items.find((i) => i.id === item.id).isArchived);
  });

  test('INV5-7 an item with stock on hand cannot be archived', async () => {
    const item = await createItem({ stock: { 'erode-hq': 2 } });
    expectStatus(await post(`/api/catalog/item/${item.id}/archive`, { archived: true }), 409);
  });

  test('INV5-7 a never-used item can still be deleted', async () => {
    const item = await createItem({ stock: {} });
    ok(await del(`/api/catalog/item/${item.id}`), 'delete unused item');
    assert.ok(!ok(await get('/api/items')).some((i) => i.id === item.id));
  });

  test('INV4-12 a supplier linked to items cannot be deleted', async () => {
    const vendor = ok(await post('/api/vendors', { vendorName: `QA vendor ${uid()}`, phone: '9876543210' })).vendor;
    ok(await post('/api/catalog/item', { item: itemBody({ vendorId: vendor.id }), initialStocks: {} }), 'item with vendor');
    expectStatus(await del(`/api/vendors/${vendor.id}`), 409, 'delete linked vendor');
    assert.ok(ok(await get('/api/vendors')).some((v) => v.id === vendor.id), 'vendor kept');
    const listed = ok(await post('/api/vendors', { vendorName: `QA vendor ${uid()}`, phone: '9876543211' })).vendor;
    ok(await post('/api/catalog/item', { item: itemBody({ vendors: [{ vendorId: listed.id }] }), initialStocks: {} }), 'item listing the vendor');
    expectStatus(await del(`/api/vendors/${listed.id}`), 409, 'delete vendor in an item supplier list');
  });

  test('INV-2 a duplicate item name is refused (any case or spacing)', async () => {
    const first = itemBody();
    ok(await post('/api/catalog/item', { item: first, initialStocks: {} }));
    const dup = itemBody({ itemName: `  ${first.itemName.toUpperCase().replace(' ', '  ')} ` });
    expectStatus(await post('/api/catalog/item', { item: dup, initialStocks: {} }), 409, 'duplicate name on add');
    const other = ok(await post('/api/catalog/item', { item: itemBody(), initialStocks: {} })).item;
    expectStatus(await put(`/api/catalog/item/${other.id}`, { itemName: first.itemName.toLowerCase() }), 409, 'rename onto an existing name');
  });

  test('INV-10 an item needs a real HSN code; a blank one is not saved as 85371000', async () => {
    expectStatus(await post('/api/catalog/item', { item: itemBody({ itemHSN: '' }), initialStocks: {} }), 400, 'blank HSN');
    expectStatus(await post('/api/catalog/item', { item: itemBody({ itemHSN: undefined }), initialStocks: {} }), 400, 'missing HSN');
    expectStatus(await post('/api/catalog/item', { item: itemBody({ itemHSN: '853' }), initialStocks: {} }), 400, '3 digits');
    const item = ok(await post('/api/catalog/item', { item: itemBody({ itemHSN: '8536' }), initialStocks: {} })).item;
    expectStatus(await put(`/api/catalog/item/${item.id}`, { itemHSN: '' }), 400, 'blanking HSN on edit');
  });

  test('INV4-1 editing an item can clear its subcategory, description and image', async () => {
    const item = ok(await post('/api/catalog/item', { item: itemBody({ subcategory: 'Relays', description: 'QA desc', imageUrl: 'https://example.invalid/x.png' }), initialStocks: {} })).item;
    ok(await put(`/api/catalog/item/${item.id}`, { subcategory: null, description: null, imageUrl: null }), 'clear');
    const row = ok(await get('/api/items')).find((i) => i.id === item.id);
    assert.equal(row.subcategory, null);
    assert.equal(row.description, null);
    assert.equal(row.imageUrl, null);
  });
});

describe('stock reads and sales figures', () => {
  test('INV7-2 Billing and Purchase can read their own branch stock history and transfers', async () => {
    const item = await createItem({ stock: { 'erode-hq': 10, coimbatore: 10 } });
    ok(await post('/api/stock/adjust', { itemId: item.id, branchId: 'coimbatore', quantityChange: -1, reason: 'Damage' }));
    ok(await post('/api/stock/transfer', { itemId: item.id, fromBranch: 'coimbatore', toBranch: 'erode-hq', quantity: 2 }));
    ok(await post('/api/stock/transfer', { itemId: item.id, fromBranch: 'coimbatore', toBranch: 'chennai', quantity: 1 }));
    for (const role of ['Billing', 'Purchase']) {
      const logs = ok(await get('/api/stock-adjustments', role), `${role} stock history`);
      assert.ok(logs.some((l) => l.itemId === item.id && l.branchId === 'erode-hq'), `${role} sees Erode rows`);
      assert.ok(logs.every((l) => l.branchId === 'erode-hq'), `${role} sees only Erode rows`);
      const transfers = ok(await get('/api/stock-transfers', role), `${role} transfers`);
      assert.ok(transfers.some((t) => t.toBranch === 'erode-hq' && t.items.some((li) => li.itemId === item.id)), `${role} sees the transfer into Erode`);
      assert.ok(transfers.every((t) => t.fromBranch === 'erode-hq' || t.toBranch === 'erode-hq'), `${role} sees only Erode transfers`);
      const boot = ok(await get('/api/bootstrap', role), `${role} bootstrap`);
      assert.ok(boot.stockAdjustmentLogs.length > 0 && boot.stockAdjustmentLogs.every((l) => l.branchId === 'erode-hq'), `${role} bootstrap history`);
    }
    expectStatus(await get('/api/stock-adjustments', 'Sales'), 403, 'Sales has no stock screens');
  });

  test('INV2-10 / INV8-7 every role gets the same net 90-day sales figures (returns taken off, combos as parts)', async () => {
    // A recent day (inside the 90-day window, not today) with no cash register.
    let date;
    for (let back = 30; back < 85 && !date; back++) {
      const d = addDays(istToday(), -back);
      if (!(await register('erode-hq', d))) date = d;
    }
    const item = await createItem({ stock: { 'erode-hq': 50 } });
    const part = await createItem({ stock: { 'erode-hq': 50 } });
    const combo = await createCombo([{ item: part, qty: 2 }]);
    const inv = await mustSell(saleBody({ date, lines: [line(item, 30), comboLine(combo, 3)] }));
    ok(await ret(inv.id, [returnLine(item, 30)]), 'return all 30');
    const figures = {};
    for (const role of ['CEO', 'Billing', 'Purchase', 'Sales']) {
      const boot = ok(await get('/api/bootstrap', role), `${role} bootstrap`);
      assert.ok(boot.itemSales90d && typeof boot.itemSales90d === 'object', `${role} gets sales figures`);
      figures[role] = JSON.stringify([boot.itemSales90d[item.id] || {}, boot.itemSales90d[part.id] || {}]);
    }
    assert.equal(new Set(Object.values(figures)).size, 1, `same figures for every role: ${JSON.stringify(figures)}`);
    const [sold, parts] = JSON.parse(figures.CEO);
    assert.ok(!(sold['erode-hq'] > 0), `sold 30, returned 30: net 0 (got ${sold['erode-hq']})`);
    assert.equal(parts['erode-hq'], 6, 'a combo sale counts its parts');
  });
});

describe('seeded stock history', () => {
  test('INV8-9 seeded demo stock rows continue from the opening rows', async () => {
    const rows = ok(await get('/api/stock-adjustments'));
    const demo = rows.filter((r) => /^adj-00\d$/.test(r.id));
    if (!demo.length) return; // not a freshly seeded database
    for (const d of demo) {
      const opening = rows.find((r) => r.id === `adj-open-${d.branchId}-${d.itemId}`);
      const before = demo
        .filter((x) => x.itemId === d.itemId && x.branchId === d.branchId && x.timestamp < d.timestamp)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const expectedPrev = before.length ? before[before.length - 1].newQuantity : (opening ? opening.newQuantity : 0);
      assert.equal(d.previousQuantity, expectedPrev, `${d.id} (${d.itemId} @ ${d.branchId}) starts where the history left off`);
      assert.equal(d.newQuantity, d.previousQuantity + d.quantityChange, `${d.id} before + change = after`);
    }
  });
});

describe('stock quantity rules', () => {
  const adjust = (item, quantityChange, extra = {}, as = 'CEO') =>
    post('/api/stock/adjust', { itemId: item.id, branchId: 'erode-hq', quantityChange, reason: 'Stock Audit Correction', ...extra }, as);

  test('INV8-4 a stock adjustment must be a non-zero whole number with a reason and a sane size', async () => {
    const item = await createItem({ stock: { 'erode-hq': 20 } }); // PCS: whole units
    for (const q of [0, 2.5, 'abc', '', null, 1e9, true]) {
      expectStatus(await adjust(item, q), 400, `quantityChange ${JSON.stringify(q)}`);
    }
    expectStatus(await adjust(item, 3, { reason: '' }), 400, 'empty reason');
    expectStatus(await adjust(item, 3, { reason: '   ' }), 400, 'blank reason');
    assert.equal(await stockOf(item.id, 'erode-hq'), 20, 'nothing moved');
    ok(await adjust(item, '5'), 'a numeric string is read as a number');
    assert.equal(await stockOf(item.id, 'erode-hq'), 25);
  });

  test('INV-23 a weighed or measured item may move in fractions; a counted item may not', async () => {
    const counted = await createItem({ stock: { 'erode-hq': 10 } });
    expectStatus(await post('/api/stock/transfer', { itemId: counted.id, fromBranch: 'erode-hq', toBranch: 'chennai', quantity: 2.5 }), 400, 'transfer 2.5 PCS');
    expectStatus(await post('/api/stock/transfer-batch', { items: [{ itemId: counted.id, quantity: 1.5 }], fromBranch: 'erode-hq', toBranch: 'chennai' }), 400, 'batch transfer 1.5 PCS');
    assert.equal(await stockOf(counted.id, 'erode-hq'), 10);
    const code = `QA-${uid()}`.toUpperCase();
    const cable = ok(await post('/api/catalog/item', { item: {
      itemName: `QA cable ${code}`, itemHSN: '85444999', category: 'QA', itemCode: code, unit: 'MTR',
      salePrice: 10, salePriceTaxMode: 'exclusive', wholesalePrice: 10, minWholesaleQty: 1, purchasePrice: 5, gstTaxSlab: 18,
    }, initialStocks: { 'erode-hq': 12.5 } })).item;
    ok(await adjust(cable, -0.5), 'half a metre off a cable reel');
    assert.equal(await stockOf(cable.id, 'erode-hq'), 12);
    // Opening stock follows the same rule.
    const code2 = `QA-${uid()}`.toUpperCase();
    expectStatus(await post('/api/catalog/item', { item: {
      itemName: `QA relay ${code2}`, itemHSN: '85364900', category: 'QA', itemCode: code2, unit: 'NOS',
      salePrice: 10, salePriceTaxMode: 'exclusive', wholesalePrice: 10, minWholesaleQty: 1, purchasePrice: 5, gstTaxSlab: 18,
    }, initialStocks: { 'erode-hq': 2.5 } }), 400, 'opening stock 2.5 NOS');
  });

  test('INV7-1 /stock/update takes whole numbers, a threshold of 0 or more, and logs the real user', async () => {
    const item = await createItem({ stock: { 'erode-hq': 10 } });
    const set = (body) => post('/api/stock/update', { itemId: item.id, branchId: 'erode-hq', ...body });
    expectStatus(await set({ quantity: 2.5 }), 400, '2.5 PCS');
    expectStatus(await set({ quantity: -5 }), 400, '-5');
    expectStatus(await set({ quantity: 'abc' }), 400, 'abc');
    expectStatus(await set({ quantity: 10, minStockAlert: -5 }), 400, 'minStockAlert -5');
    expectStatus(await post('/api/stock/update', { itemId: 'item-nope', branchId: 'erode-hq', quantity: 3 }), 404, 'unknown item');
    ok(await set({ quantity: '7', minStockAlert: 3 }), '"7" is read as 7');
    assert.equal(await stockOf(item.id, 'erode-hq'), 7);
    const row = (await ledgerOf(item.id, 'erode-hq')).find((r) => r.reason === 'Stock Set');
    assert.ok(row && row.adjustedBy && row.adjustedBy !== 'System', `stamped with the logged-in user (got ${row?.adjustedBy})`);
  });
});
