// Items, combos and stock rules (round 8 inventory findings).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  post, get, put, del, ok, expectStatus, uid, createItem, createCombo, stockOf, ledgerOf, line, comboLine, saleBody,
  sell, mustSell, getInvoice, resave, returnLine, freshDay,
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
