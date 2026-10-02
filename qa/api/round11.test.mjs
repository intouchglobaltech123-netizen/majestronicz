// Round-11 final-check fixes: store credit on bill edits, ended months, the
// access matrix, live counts, incentives and the rest of the FIN-A / FIN-B findings.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  post, get, put, ok, expectStatus, near, createItem, line, saleBody, mustSell, getInvoice, resave,
  freshDay, thisMonthDay, randomPhone,
} from './lib.mjs';

const customerOf = async (id) => ok(await get('/api/customers')).find((c) => c.id === id);
const collected = (inv) => (inv.paymentSplits || []).filter((s) => s.mode !== 'COD-Credit').reduce((t, s) => t + (Number(s.amount) || 0), 0);

describe('round 11: bill edits', () => {
  test('FIN-A-1 editing a paid bill down then back up never puts uncollected money in the drawer', async () => {
    const date = await thisMonthDay();
    const item = await createItem({ price: 1000, stock: { 'erode-hq': 20 } });
    const inv = await mustSell(saleBody({ date, customerName: 'QA Edit Up', customerPhone: randomPhone(), lines: [line(item, 2)] }));
    near(collected(inv), 2360, 'cash collected at billing');
    // Down to ₹1,180: ₹1,180 paid over the total is kept as store credit.
    ok(await resave(await getInvoice(inv.id), { items: [line(item, 1)] }), 'edit down');
    near((await customerOf(inv.customerId)).creditBalance, 1180, 'store credit given');
    // Back up to ₹3,540 with the form's single-mode split reset to the full total.
    ok(await resave(await getInvoice(inv.id), { items: [line(item, 3)], paymentMode: 'Cash', paymentSplits: [{ mode: 'Cash', amount: 3540 }] }), 'edit up');
    const up = await getInvoice(inv.id);
    near(collected(up), 2360, 'the drawer keeps only what was really collected');
    near((await customerOf(inv.customerId)).creditBalance, 0, 'the store credit is applied back');
    near(up.balanceDue, 1180, 'the rest is a due to collect');
    // Back to the original total: credit fully applied, nothing owed.
    const inv2 = await mustSell(saleBody({ date, customerName: 'QA Edit Up 2', customerPhone: randomPhone(), lines: [line(item, 2)] }));
    ok(await resave(await getInvoice(inv2.id), { items: [line(item, 1)] }), 'edit down');
    ok(await resave(await getInvoice(inv2.id), { items: [line(item, 2)], paymentSplits: [{ mode: 'Cash', amount: 2360 }] }), 'edit back');
    const back = await getInvoice(inv2.id);
    near(collected(back), 2360);
    near(back.balanceDue, 0);
    near((await customerOf(inv2.customerId)).creditBalance, 0);
  });

  test('FIN-A-3 a bill of an ended month cannot be edited, nor can an edit move a bill into one', async () => {
    const old = await freshDay('erode-hq'); // a month that has ended
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    const inv = await mustSell(saleBody({ date: old, lines: [line(item, 1)] }));
    for (const changes of [{ customerName: 'QA renamed' }, { date: await thisMonthDay() }]) {
      const res = await resave(await getInvoice(inv.id), changes);
      expectStatus(res, 409, JSON.stringify(changes));
      assert.equal(res.body.error, 'MONTH_CLOSED');
    }
    const cur = await mustSell(saleBody({ date: await thisMonthDay(), lines: [line(item, 1)] }));
    const res = await resave(await getInvoice(cur.id), { date: old });
    expectStatus(res, 409, 'moved into an ended month');
    assert.equal(res.body.error, 'MONTH_CLOSED');
    assert.equal((await getInvoice(cur.id)).date, cur.date);
  });
});
