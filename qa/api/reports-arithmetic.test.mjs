// Money arithmetic that every report is built on: bill totals, GST splits,
// dues, refunds. Recomputed independently and compared with what is stored.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  post, put, get, api, ok, expectStatus, near, r2, uid, createItem, createCombo, comboLine, line, serviceLine, saleBody, mustSell, sell,
  getInvoice, receive, returnLine, freshDay, freshDays, randomPhone, istToday, login,
} from './lib.mjs';
import { importTs } from './lib-ts.mjs';

// The report maths the screens run (src/lib), bundled for node.
const rm = await importTs('src/lib/reportMath.ts');
const pm = await importTs('src/lib/paymentModes.ts');
const pl = await importTs('src/lib/paymentsLog.ts');

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

  test('RPT4-3 the GST report base nets the overall bill discount, not just line discounts', async () => {
    const date = await freshDay('erode-hq');
    const inv = await mustSell(saleBody({ date, lines: [serviceLine(2, 5000, 18)], overallDiscountValue: 5 }));
    // The stored per-line taxable reflects only the LINE discount (sums to 10,000),
    // while the real GST base is after the 5% overall discount (9,500). The GST
    // report scales each line by (subtotal - overallDiscount) / subtotal — verify
    // that scaling reproduces the invoice's own discounted taxable value and tax.
    const lineTaxable = inv.items.reduce((s, l) => s + (l.taxableAmount || 0), 0);
    const lineTax = inv.items.reduce((s, l) => s + (l.totalTax || 0), 0);
    near(lineTaxable, 10000, 'stored line taxable is pre-overall-discount');
    const discRatio = (inv.subtotal - inv.overallDiscountAmount) / inv.subtotal;
    near(lineTaxable * discRatio, 9500, 'report taxable nets the overall discount');
    near(lineTax * discRatio, inv.totalTax, 'report tax matches the bill tax (1,710)');
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

  test('CRM6-1 every bill\'s stored due equals credit at billing - receipts - returns + refunds', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ price: 1000, stock: { 'erode-hq': 10 } });
    const inv = await mustSell(saleBody({ date, transactionType: 'Credit', customerPhone: randomPhone(), lines: [line(item, 2)], splits: [{ mode: 'COD-Credit', amount: 2360 }] }));
    ok(await receive(inv, 700));
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'QA', actor: 'QA', refundMode: 'Adjust' }));
    const payments = ok(await get('/api/payments'));
    const receipts = new Map();
    const refunds = new Map(); // cash refunded to the customer against a bill ('out' rows)
    for (const p of payments) {
      for (const a of p.allocations || []) {
        if (p.type === 'in') receipts.set(a.refId, (receipts.get(a.refId) || 0) + a.amount);
        else if (p.type === 'out' && p.partyType === 'customer') refunds.set(a.refId, (refunds.get(a.refId) || 0) + a.amount);
      }
    }
    // Store credit handed back against a bill (a credit note, or the excess of an
    // edit below what was paid) counts like a refund (CRM9-1 / CRM9-3).
    const creditBack = new Map();
    for (const c of ok(await get('/api/customers'))) {
      for (const h of c.creditHistory || []) if (h?.refId) creditBack.set(`${c.id}|${h.refId}`, (creditBack.get(`${c.id}|${h.refId}`) || 0) + (Number(h.amount) || 0));
    }
    const bills = ok(await get('/api/invoices')).filter((i) => !i.isVoided && Array.isArray(i.paymentSplits) && i.paymentSplits.length);
    for (const b of bills) {
      // Credit at billing = total minus everything collected when the bill was made
      // (negative when an edit took the total below what was collected).
      const credit = b.grandTotal - sum(b.paymentSplits.filter((s) => s.mode !== 'COD-Credit'), (s) => s.amount);
      const back = b.customerId ? (creditBack.get(`${b.customerId}|${b.id}`) || 0) + (creditBack.get(`${b.customerId}|fix-overpay:${b.id}`) || 0) : 0;
      // Cash refunded to the customer raises what they owe (money left the drawer).
      const due = Math.max(0, r2(credit - (receipts.get(b.id) || 0) - (b.totalReturnedAmount || 0) + (refunds.get(b.id) || 0) + back));
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

/** A fresh employee for payroll tests. */
async function newEmployee(branchId, salary = 20800) {
  for (let i = 0; i < 20; i++) {
    const pin = String(1000 + Math.floor(Math.random() * 9000));
    const res = await post('/api/employees', { name: `QA Payee ${uid()}`, designation: 'QA Technician', branchId, monthlySalary: salary, status: 'Active', joinedDate: '2026-01-01', pin });
    if (res.status === 409) continue;
    return ok(res, 'create employee').employee;
  }
  throw new Error('could not create employee');
}
async function payrollDraft(emp, month, adjustment = 1500) {
  const snap = ok(await post('/api/hrm/payroll-adjustment', { employeeId: emp.id, month, adjustment, reason: 'QA', standardHoursPerMonth: 208 }), 'draft payroll');
  return snap.payrollRecords.find((p) => p.employeeId === emp.id && p.month === month);
}

describe('profit, GST and money reports (phase 6)', () => {
  test('E2E5-5 a sale stores each line\'s purchase cost at the time of sale; a later cost change does not move it', async () => {
    const date = await freshDay('erode-hq');
    const a = await createItem({ price: 1000, purchasePrice: 600, stock: { 'erode-hq': 10 } });
    const b = await createItem({ price: 500, purchasePrice: 200, stock: { 'erode-hq': 10 } });
    const combo = await createCombo([{ item: a, qty: 1 }, { item: b, qty: 2 }], 2000);
    const inv = await mustSell(saleBody({ date, lines: [line(a, 2), comboLine(combo, 1), serviceLine(1, 300, 18)] }));
    near(inv.items[0].unitCost, 600, 'item line cost');
    near(inv.items[1].unitCost, 1000, 'combo line cost = 600 + 2 x 200');
    near(inv.items[2].unitCost, 0, 'typed line has no cost');
    ok(await put(`/api/catalog/item/${a.id}`, { item: { purchasePrice: 900 } }), 'raise the cost');
    const after = await getInvoice(inv.id);
    near(after.items[0].unitCost, 600, 'the bill keeps the cost it was sold at');
    // The report maths cost the sale at 600 even though the item now costs 900.
    const items = ok(await get('/api/items'));
    const fig = rm.invoiceFigures(after, rm.makeCostOf(items));
    near(fig.cogs, 2 * 600 + 1000, 'COGS at sale-time cost');
  });

  test('E2E-8 profit: ex-GST revenue net of bill discount and returns, damaged return written off', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ price: 1000, gst: 18, purchasePrice: 600, stock: { 'erode-hq': 10 } });
    const inv = await mustSell(saleBody({ date, lines: [line(item, 3)], overallDiscountValue: 5, shippingCharges: 100 }));
    ok(await post('/api/tx/sale-return', { invoiceId: inv.id, returnLines: [returnLine(item, 1)], reason: 'Defective / Damaged Goods', actor: 'QA', refundMode: 'Cash' }));
    const saved = await getInvoice(inv.id);
    const fig = rm.invoiceFigures(saved, rm.makeCostOf([]));
    near(fig.revenue, 2850 * (2 / 3) + 100, 'revenue = taxable after 5% discount for the 2 kept units + shipping');
    near(fig.cogs, 1200, 'cost of the 2 kept units');
    near(fig.writeOff, 600, 'the damaged unit is a loss, not recovered');
    near(fig.grossProfit, 2000 - 1200 - 600);
    near(fig.tax, 513 * (2 / 3), 'GST on the kept units');
  });

  test('RPT5-1 one GST-collected figure: net of returns and bill discount, IGST included', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ price: 5000, gst: 18, purchasePrice: 3000, stock: { 'erode-hq': 5 } });
    const intra = await mustSell(saleBody({ date, lines: [line(item, 2)], overallDiscountValue: 5 }));
    ok(await post('/api/tx/sale-return', { invoiceId: intra.id, returnLines: [returnLine(item, 1)], reason: 'QA', actor: 'QA', refundMode: 'Cash' }));
    const inter = await mustSell(saleBody({ date, stateOfSupply: '29-Karnataka', lines: [serviceLine(1, 1650, 18)] }));
    const g = rm.gstCollected([await getInvoice(intra.id), await getInvoice(inter.id)]);
    near(g.tax, 1710 / 2 + 297, 'net GST');
    near(g.igst, 297, 'IGST included');
    near(g.cgst + g.sgst, 855, 'CGST + SGST on the kept unit');
    near(g.taxable, 4750 + 1650, 'taxable after discount and return');
  });

  test('E2E5-12 Mark Paid books the salary as money out on today\'s cash day at the employee\'s branch', async () => {
    const emp = await newEmployee('coimbatore');
    const row = await payrollDraft(emp, '2026-04', 2500);
    const snap = ok(await post('/api/hrm/payroll-paid', { payrollId: row.id, paymentMode: 'Cash', record: { ...row } }));
    const pay = snap.payments.find((p) => p.partyType === 'staff' && p.partyId === emp.id);
    assert.ok(pay, 'a salary payment row was written');
    assert.equal(pay.type, 'out');
    assert.equal(pay.branchId, 'coimbatore');
    assert.equal(pay.date, istToday());
    assert.equal(pay.paymentMode, 'Cash');
    near(pay.amount, row.finalPayable);
    // A salary row cannot be deleted from the ledger on its own.
    expectStatus(await api('DELETE', `/api/payments/${pay.id}`), 409, 'delete salary row');
    // The Coimbatore manager sees the money leave the drawer, not who was paid what.
    const seen = ok(await get('/api/payments', 'Manager')).find((p) => p.id === pay.id);
    assert.ok(seen, 'manager sees the row');
    assert.equal(seen.partyName, 'Salary payment');
    near(seen.amount, pay.amount);
  });

  test('E2E5-12 Mark Paid is refused while today\'s cash day is closed', async () => {
    const emp = await newEmployee('chennai');
    const row = await payrollDraft(emp, '2026-02', 1000);
    const today = istToday();
    ok(await post('/api/cash/close', { branchId: 'chennai', date: today, actor: 'QA' }), 'close today');
    try {
      expectStatus(await post('/api/hrm/payroll-paid', { payrollId: row.id, paymentMode: 'Cash', record: { ...row } }), 409);
      const after = ok(await get('/api/payroll-records')).find((p) => p.id === row.id);
      assert.notEqual(after.status, 'Paid', 'not marked paid');
    } finally {
      ok(await post('/api/cash/reopen', { branchId: 'chennai', date: today }), 'reopen today');
    }
  });

  test('E2E-8 P&L and Dashboard profit: payroll paid is an expense, bank deposits and pending items are not', async () => {
    const inv = {
      id: 'x', branchId: 'erode-hq', date: '2026-10-01', withGst: true, stateOfSupply: '33-Tamil Nadu', subtotal: 1000, overallDiscountAmount: 0,
      totalTax: 180, totalCgst: 90, totalSgst: 90, shippingCharges: 0, grandTotal: 1180,
      items: [{ id: 'l1', itemId: 'i1', itemName: 'X', quantity: 1, taxRate: 18, taxableAmount: 1000, totalTax: 180, totalAmount: 1180, unitCost: 400 }],
    };
    const registers = [{ branchId: 'erode-hq', date: '2026-10-01', expenses: [
      { id: 'e1', category: 'Tea / Snacks', reason: 'tea', cashAmount: 50, gpayAmount: 0 },
      { id: 'e2', category: 'Deposit to Bank', reason: 'deposit', cashAmount: 5000, gpayAmount: 0, approvalStatus: 'approved' },
      { id: 'e3', category: 'Repairs / Maintenance', reason: 'pending', cashAmount: 70, gpayAmount: 0, approvalStatus: 'pending' },
      { id: 'e4', reason: 'Showroom Rent', cashAmount: 100, gpayAmount: 0 },
    ] }];
    const payments = [{ id: 'p1', type: 'out', partyType: 'staff', branchId: 'erode-hq', date: '2026-10-01', amount: 200, paymentMode: 'Cash', allocations: [{ refId: 'pr1', amount: 200 }] }];
    const payrollRecords = [{ id: 'pr1', status: 'Paid', paidAt: '2026-10-01T05:00:00Z', branchId: 'erode-hq', finalPayable: 200 }];
    const templates = [{ id: 't1', category: 'Rent', approvalHistory: [{ cashExpenseId: 'e4', month: '2026-10' }] }];
    const { total } = rm.computeProfit({ invoices: [inv], items: [], registers, payments, payrollRecords, recurringTemplates: templates, startDate: '2026-10-01', endDate: '2026-10-31', inScope: () => true });
    near(total.grossProfit, 600);
    near(total.expenses, 150, 'tea + rent; no deposit, no pending');
    near(total.payroll, 200, 'payroll counted once (row + record)');
    near(total.netProfit, 250);
    assert.equal(total.categoryExpenses.Rent, 100, 'RPT2-4 rent posted from a template is categorised');
  });

  test('CRM6-9 money collected is counted by the receipt\'s own mode and date', async () => {
    const [date, later] = await freshDays('erode-hq', 2); // a receipt can't predate its bill (CRM9-8)
    const inv = await mustSell(saleBody({ date, transactionType: 'Credit', customerPhone: randomPhone(), lines: [serviceLine(1, 1000, 18)], splits: [{ mode: 'COD-Credit', amount: 1180 }] }));
    ok(await receive(inv, 1180, { mode: 'GPay', date: later }));
    const payments = ok(await get('/api/payments'));
    const bills = [await getInvoice(inv.id)];
    const onBillDay = pm.collectionsByMode(bills, payments, (d) => d === date, () => true);
    near(onBillDay.total, 0, 'nothing collected on the bill day');
    near(onBillDay.creditGiven, 1180);
    const onReceiptDay = pm.collectionsByMode(bills, payments, (d) => d === later, () => true);
    near(onReceiptDay.byGroup['GPay / UPI'], 1180, 'the receipt counts as GPay on its own day');
    near(onReceiptDay.byGroup.Cash, 0);
  });

  test('RPT8-2 the Payments Log lists refunds only from refund rows (none for credit-bill or credit-note returns)', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ price: 1000, stock: { 'erode-hq': 10 } });
    const credit = await mustSell(saleBody({ date, transactionType: 'Credit', customerPhone: randomPhone(), lines: [line(item, 2)], splits: [{ mode: 'COD-Credit', amount: 2360 }] }));
    ok(await post('/api/tx/sale-return', { invoiceId: credit.id, returnLines: [returnLine(item, 1)], reason: 'QA', actor: 'QA', refundMode: 'Cash' }));
    const paid = await mustSell(saleBody({ date, customerPhone: randomPhone(), lines: [line(item, 2)] }));
    ok(await post('/api/tx/sale-return', { invoiceId: paid.id, returnLines: [returnLine(item, 1)], reason: 'QA', actor: 'QA', refundMode: 'Adjust' }));
    const cash = await mustSell(saleBody({ date, lines: [line(item, 1)] }));
    ok(await post('/api/tx/sale-return', { invoiceId: cash.id, returnLines: [returnLine(item, 1)], reason: 'QA', actor: 'QA', refundMode: 'Cash' }));
    const payments = ok(await get('/api/payments'));
    const invoices = await Promise.all([credit, paid, cash].map((i) => getInvoice(i.id)));
    const rows = pl.buildPaymentsLog({ invoices, payments, purchaseOrders: [], pendingOrders: [], cashRegisters: [], branchScope: 'all' });
    const refunds = rows.filter((r) => r.type === 'Sale refund' && [credit, paid, cash].some((i) => r.ref && payments.find((p) => p.receiptNumber === r.ref)?.allocations?.[0]?.refId === i.id));
    assert.equal(refunds.length, 1, `one real refund (the cash bill), got ${refunds.length}`);
    near(refunds[0].amount, 1180);
    assert.equal(refunds[0].date, istToday(), 'on the day it was paid');
  });
});


describe('report exports (phase 6)', () => {
  test('RPT4-4 Excel keeps numbers as numbers, also under "Consolidated" and "Shipping" headers', async () => {
    const { buildXlsx } = await importTs('src/utils/xlsxWriter.ts');
    const bytes = buildXlsx(['Metric', 'Consolidated Enterprise Total', 'Shipping (Rs)', 'Invoice No', 'Date'], [
      ['Net Profit (Rs)', -53998, '125.50', 'MZ/7307', '2026-10-01'],
    ]);
    const xml = Buffer.from(bytes).toString('utf8');
    assert.match(xml, /<c r="B2"><v>-53998<\/v><\/c>/, 'negative total is a number');
    assert.match(xml, /<c r="C2"><v>125.5<\/v><\/c>/, 'shipping amount is a number');
    assert.match(xml, /<c r="D2" t="inlineStr">/, 'invoice number stays text');
    assert.match(xml, /<c r="E2" t="inlineStr">/, 'date stays text');
  });
});

describe('customers and register helpers (phase 6)', () => {
  test('RPT7-1 a bill linked to a customer counts only for that customer; an unlinked bill matches by phone', async () => {
    const t = await importTs('src/types/index.ts');
    const a = { id: 'c-a', name: 'A', phone: '9876500001' };
    const b = { id: 'c-b', name: 'B', phone: '+91 98765 00002' };
    const bill = (id, customerId, customerPhone, due) => ({ id, invoiceNumber: id, customerId, customerPhone, grandTotal: due, balanceDue: due, totalReturnedAmount: 0 });
    const invoices = [bill('i1', 'c-a', '9876500002', 100), bill('i2', undefined, '09876500002', 50), bill('i3', undefined, '9000000000', 25)];
    near(t.getCustomerOutstandingSummary(a, invoices).totalOutstanding, 100, 'A: only its linked bill');
    near(t.getCustomerOutstandingSummary(b, invoices).totalOutstanding, 50, 'B: unlinked bill by normalised phone, not A\'s bill');
    const linked = invoices.filter((i) => [a, b].some((c) => t.isInvoiceForCustomer(i, c)));
    assert.deepEqual(linked.map((i) => i.id), ['i1', 'i2'], 'i3 is unlinked and shown on its own row');
  });

  test('CASH-8 a due-day-31 template falls due on the last day of a shorter month', async () => {
    const t = await importTs('src/types/index.ts');
    assert.equal(t.dueDayInMonth({ dueDay: 31 }, '2026-09'), 30);
    assert.equal(t.dueDayInMonth({ dueDay: 31 }, '2027-02'), 28);
    assert.equal(t.dueDayInMonth({ dueDay: 31 }, '2028-02'), 29);
    assert.equal(t.dueDayInMonth({ dueDay: 5 }, '2026-09'), 5);
  });

  test('CASH4-4 the closing splits cash paid out into refunds, suppliers and salaries that add up', async () => {
    const c = await importTs('src/lib/cashClosing.ts');
    const pay = (type, partyType, amount, mode = 'Cash') => ({ branchId: 'b', date: 'd', type, partyType, amount, paymentMode: mode });
    const day = c.computeDayCashClosing('b', 'd', 1000, [
      { branchId: 'b', date: 'd', grandTotal: 500, paymentSplits: [{ mode: 'Cash', amount: 300 }, { mode: 'COD-Credit', amount: 200 }] },
    ], [pay('in', 'customer', 200), pay('out', 'customer', 50), pay('out', 'vendor', 70), pay('out', 'staff', 80), pay('out', 'vendor', 999, 'GPay')],
    [{ cashAmount: 10, gpayAmount: 0 }, { cashAmount: 500, approvalStatus: 'pending' }]);
    near(day.cashSales, 300);
    near(day.cashRefunds, 50);
    near(day.cashVendorPaid, 70);
    near(day.cashSalaries, 80);
    near(day.cashPaid, 200);
    near(day.closing, 1000 + 300 + 200 - 50 - 70 - 80 - 10, 'every line in the sum');
  });
});
