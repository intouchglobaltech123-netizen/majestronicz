// Money arithmetic that every report is built on: bill totals, GST splits,
// dues, refunds. Recomputed independently and compared with what is stored.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  post, get, ok, expectStatus, near, r2, createItem, line, serviceLine, saleBody, mustSell, sell, getInvoice, receive,
  returnLine, freshDay, randomPhone,
} from './lib.mjs';

const sum = (a, f) => a.reduce((t, x) => t + (Number(f(x)) || 0), 0);

describe('reports arithmetic', () => {
  test('SAL-11 CGST + SGST always equals the total tax (odd paise)', async () => {
    const date = await freshDay('erode-hq');
    const inv = await mustSell(saleBody({ date, lines: [serviceLine(3, 333.33, 18), serviceLine(1, 10.01, 5), serviceLine(7, 0.99, 12)] }));
    for (const l of inv.items) near(l.cgstAmount + l.sgstAmount, l.totalTax, `line ${l.id}`);
    near(inv.totalCgst + inv.totalSgst, inv.totalTax, 'bill');
    near(sum(inv.items, (l) => l.totalTax), inv.totalTax, 'E2E5-18 line tax adds up to bill tax');
  });

  test('SAL-13 GST is charged on the value after the overall discount', async () => {
    const date = await freshDay('erode-hq');
    const inv = await mustSell(saleBody({ date, lines: [serviceLine(2, 5000, 18)], overallDiscountValue: 5 }));
    near(inv.subtotal, 10000);
    near(inv.overallDiscountAmount, 500);
    near(inv.totalTax, 1710, 'tax = 18% of 9,500');
    near(inv.grandTotal, 11210);
  });

  test('SAL-11 grand total = subtotal - discount + GST + shipping + round-off', async () => {
    const date = await freshDay('erode-hq');
    const inv = await mustSell(saleBody({
      date, roundOffEnabled: true, shippingCharges: 125, overallDiscountType: 'amount', overallDiscountValue: 333,
      lines: [serviceLine(3, 1234.5, 18, { discountValue: 7 }), serviceLine(2, 99.99, 5)],
    }));
    const expected = inv.subtotal - inv.overallDiscountAmount + inv.totalTax + inv.shippingCharges + inv.roundOff;
    near(inv.grandTotal, expected, 'grand total identity');
    assert.equal(inv.grandTotal, Math.round(inv.grandTotal), 'rounded to the rupee');
    assert.ok(Math.abs(inv.roundOff) <= 0.5, 'round-off within 50 paise');
    // Independent recompute of the lines.
    const l1 = r2(r2(3 * 1234.5) * 0.93);
    near(inv.items[0].taxableAmount, l1, 'line 1 taxable after 7% line discount');
  });

  test('PLT-14 the amount in words is right for large bills', async () => {
    const date = await freshDay('erode-hq');
    const inv = await mustSell(saleBody({ date, lines: [serviceLine(1, 1234567890, 0)] }));
    assert.equal(inv.amountInWords, 'Rupees One Hundred Twenty-Three Crore Forty-Five Lakh Sixty-Seven Thousand Eight Hundred Ninety only');
  });

  test('SAL-9 a bill\'s payment split always adds up to its total', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ price: 1000, stock: { 'erode-hq': 20 } });
    const bills = [
      await mustSell(saleBody({ date, transactionType: 'Credit', lines: [line(item, 3)], splits: [{ mode: 'Cash', amount: 1000 }, { mode: 'GPay', amount: 540 }, { mode: 'COD-Credit', amount: 2000 }] })),
      await mustSell(saleBody({ date, lines: [line(item, 1)], splits: [{ mode: 'Cash', amount: 5000 }] })), // over-stated cash
      await mustSell(saleBody({ date, lines: [line(item, 2)], splits: [{ mode: 'Cash', amount: 100 }, { mode: 'GPay', amount: 100 }] })), // under-stated
      await mustSell(saleBody({ date, transactionType: 'Credit', lines: [line(item, 1)], splits: [{ mode: 'Cash', amount: 1180 }] })),
    ];
    for (const b of bills) {
      near(sum(b.paymentSplits, (s) => s.amount), b.grandTotal, `${b.invoiceNumber} splits vs total`);
      const credit = sum(b.paymentSplits.filter((s) => s.mode === 'COD-Credit'), (s) => s.amount);
      near(b.balanceDue, credit, `${b.invoiceNumber} due = credit split`);
    }
  });

  test('CRM6-1 every bill\'s stored due equals credit at billing - receipts - returns', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ price: 1000, stock: { 'erode-hq': 10 } });
    const inv = await mustSell(saleBody({ date, transactionType: 'Credit', customerPhone: randomPhone(), lines: [line(item, 2)], splits: [{ mode: 'COD-Credit', amount: 2360 }] }));
    ok(await receive(inv, 700));
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', actor: 'QA', refundMode: 'Adjust' }));
    const payments = ok(await get('/api/payments'));
    const receipts = new Map();
    for (const p of payments.filter((x) => x.type === 'in')) {
      for (const a of p.allocations || []) receipts.set(a.refId, (receipts.get(a.refId) || 0) + a.amount);
    }
    const bills = ok(await get('/api/invoices')).filter((i) => !i.isVoided && Array.isArray(i.paymentSplits) && i.paymentSplits.length);
    for (const b of bills) {
      // Credit at billing = total minus everything collected when the bill was made.
      const credit = b.grandTotal - sum(b.paymentSplits.filter((s) => s.mode !== 'COD-Credit'), (s) => s.amount);
      const due = Math.max(0, r2(credit - (receipts.get(b.id) || 0) - (b.totalReturnedAmount || 0)));
      near(b.balanceDue ?? 0, due, `${b.invoiceNumber} due`);
    }
    near((await getInvoice(inv.id)).balanceDue, 480, 'test bill: 2360 - 700 - 1180');
  });

  test('SAL2-4 refunds never exceed the bill total', async () => {
    const bills = ok(await get('/api/invoices'));
    for (const b of bills) {
      assert.ok((b.totalReturnedAmount || 0) <= b.grandTotal + 0.01, `${b.invoiceNumber}: returned ${b.totalReturnedAmount} > total ${b.grandTotal}`);
    }
  });

  test('RPT4-3 an inter-state sale is stored as IGST, not CGST + SGST', async () => {
    const date = await freshDay('erode-hq');
    const inv = await mustSell(saleBody({ date, stateOfSupply: '29-Karnataka', lines: [serviceLine(1, 1650, 18)] }));
    near(inv.totalTax, 297);
    assert.equal(inv.totalCgst + inv.totalSgst, 0, `stored CGST ${inv.totalCgst} + SGST ${inv.totalSgst} on a Karnataka sale`);
  });

  test('SAL-17 an overall discount above 100% is refused', async () => {
    const date = await freshDay('erode-hq');
    const { res } = await sell(saleBody({ date, lines: [serviceLine(1, 1000, 18)], overallDiscountValue: 150 }));
    expectStatus(res, 400);
  });

  test('SAL-17 a negative unit price is refused', async () => {
    const date = await freshDay('erode-hq');
    const { res } = await sell(saleBody({ date, lines: [serviceLine(1, 1000, 18), serviceLine(1, -400, 18)] }));
    expectStatus(res, 400);
  });

  test('SAL4-5 a GST rate that is not a real slab is refused', async () => {
    const date = await freshDay('erode-hq');
    const { res } = await sell(saleBody({ date, lines: [serviceLine(1, 1000, 7)] }));
    expectStatus(res, 400);
  });

  test('VAL-1 the salesperson incentive is worked out from the server total, not the browser', async () => {
    const date = await freshDay('erode-hq');
    const body = saleBody({ date, lines: [serviceLine(1, 1000, 18)] });
    Object.assign(body, { salespersonId: 'emp-001', salespersonName: 'K. Ramachandran', incentivePercent: 2, incentiveAmount: 9999, grandTotal: 1 });
    const inv = await mustSell(body);
    near(inv.grandTotal, 1180);
    near(inv.incentiveAmount, 23.6);
  });
});
