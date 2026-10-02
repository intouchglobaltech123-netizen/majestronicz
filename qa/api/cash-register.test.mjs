// Daily cash register: carry-forward, expenses, approvals, day close.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  post, get, del, ok, expectStatus, near, uid, createItem, line, saleBody, mustSell, receive, freshDays, freshDay,
  register, createPO, paymentsFor, utcToday, addDays, randomPhone,
} from './lib.mjs';

const BR = 'chennai'; // most tests use Chennai so they do not touch Erode/Coimbatore days

async function openDay(branchId, date, amount = 5000) {
  ok(await post('/api/cash/override', { branchId, date, amount, reason: 'QA opening' }), 'set opening');
}
/** Create the next day's register (via a tiny expense) and return its opening. */
async function nextOpening(branchId, date) {
  ok(await post('/api/cash/expense', { branchId, date, expense: { reason: 'QA trigger', cashAmount: 1 }, actor: 'QA' }), 'next-day expense');
  return (await register(branchId, date)).openingAmount;
}

describe('cash register', () => {
  test('CASH-1 yesterday\'s cash carries into today even when the day was not closed', async () => {
    const [d1, d2] = await freshDays(BR, 2);
    await openDay(BR, d1, 5000);
    const item = await createItem({ price: 1000, stock: { [BR]: 10 } });
    await mustSell(saleBody({ branchId: BR, date: d1, lines: [line(item, 1)], splits: [{ mode: 'Cash', amount: 1180 }] }));
    near(await nextOpening(BR, d2), 6180, 'opening = 5000 + 1180 cash sale');
  });

  test('CASH3-3 the carry-forward keeps the cash down-payment of a part-credit bill', async () => {
    const [d1, d2] = await freshDays(BR, 2);
    await openDay(BR, d1, 5000);
    const item = await createItem({ price: 1000, stock: { [BR]: 10 } });
    await mustSell(saleBody({ branchId: BR, date: d1, transactionType: 'Credit', lines: [line(item, 2)],
      splits: [{ mode: 'Cash', amount: 500 }, { mode: 'COD-Credit', amount: 1860 }] }));
    near(await nextOpening(BR, d2), 5500, 'opening = 5000 + 500 cash down-payment');
  });

  test('CASH2-6 cash receipts move the drawer; GPay receipts do not', async () => {
    const [d1, d2] = await freshDays(BR, 2);
    const item = await createItem({ price: 1000, stock: { [BR]: 10 } });
    // The bill is made on d1 too: a receipt can't predate its bill (CRM9-8).
    const inv = await mustSell(saleBody({ branchId: BR, date: d1, transactionType: 'Credit', customerPhone: randomPhone(),
      lines: [line(item, 1)], splits: [{ mode: 'COD-Credit', amount: 1180 }] }));
    await openDay(BR, d1, 5000);
    ok(await receive(inv, 300, { date: d1, mode: 'Cash' }), 'cash receipt');
    ok(await receive(inv, 200, { date: d1, mode: 'GPay' }), 'gpay receipt');
    near(await nextOpening(BR, d2), 5300, 'opening = 5000 + 300 cash receipt');
  });

  test('CASH2-9 pending bank deposits do not reduce the drawer; normal cash expenses do', async () => {
    const [d1, d2] = await freshDays(BR, 2);
    await openDay(BR, d1, 5000);
    ok(await post('/api/cash/expense', { branchId: BR, date: d1, expense: { reason: 'Tea', cashAmount: 200 }, actor: 'QA' }));
    ok(await post('/api/cash/expense', { branchId: BR, date: d1, expense: { reason: 'Bank', category: 'Deposit to Bank', cashAmount: 1000 }, actor: 'QA' }));
    near(await nextOpening(BR, d2), 4800, 'opening = 5000 - 200 (deposit still pending)');
  });

  test('CASH2-9 an approved deposit reduces the next day\'s opening', async () => {
    const [d1, d2] = await freshDays(BR, 2);
    await openDay(BR, d1, 5000);
    const snap = ok(await post('/api/cash/expense', { branchId: BR, date: d1, expense: { reason: 'Bank', category: 'Deposit to Bank', cashAmount: 1000 }, actor: 'QA' }));
    const reg = snap.cashRegisters.find((r) => r.branchId === BR && r.date === d1);
    const dep = reg.expenses.find((e) => e.category === 'Deposit to Bank');
    ok(await post('/api/cash/expense/approve', { branchId: BR, date: d1, expenseId: dep.id, decision: 'approved', actor: 'QA' }));
    near(await nextOpening(BR, d2), 4000);
  });

  test('CASH2-5 a deposit can only be decided once, with a valid decision', async () => {
    const d1 = await freshDay(BR);
    const snap = ok(await post('/api/cash/expense', { branchId: BR, date: d1, expense: { reason: 'Bank', category: 'Deposit to Bank', cashAmount: 700 }, actor: 'QA' }));
    const dep = snap.cashRegisters.find((r) => r.branchId === BR && r.date === d1).expenses[0];
    expectStatus(await post('/api/cash/expense/approve', { branchId: BR, date: d1, expenseId: dep.id, decision: 'maybe', actor: 'QA' }), 400, 'bad decision');
    ok(await post('/api/cash/expense/approve', { branchId: BR, date: d1, expenseId: dep.id, decision: 'approved', actor: 'QA' }));
    expectStatus(await post('/api/cash/expense/approve', { branchId: BR, date: d1, expenseId: dep.id, decision: 'approved', actor: 'QA' }), 409, 'second approval');
  });

  test('CASH2-5 negative or zero expenses are refused', async () => {
    const d1 = await freshDay(BR);
    expectStatus(await post('/api/cash/expense', { branchId: BR, date: d1, expense: { reason: 'x', cashAmount: -50 }, actor: 'QA' }), 400);
    expectStatus(await post('/api/cash/expense', { branchId: BR, date: d1, expense: { reason: 'x', cashAmount: 0 }, actor: 'QA' }), 400);
  });

  test('CASH-9 a future day cannot be closed', async () => {
    expectStatus(await post('/api/cash/close', { branchId: BR, date: addDays(utcToday(), 3), actor: 'QA' }), 400);
  });

  test('CASH6-2 an expense cannot be dated in the future', async () => {
    const future = addDays(utcToday(), 20 + Math.floor(Math.random() * 300));
    const res = await post('/api/cash/expense', { branchId: BR, date: future, expense: { reason: 'QA future', cashAmount: 10 }, actor: 'QA' });
    expectStatus(res, 400, `expense dated ${future}`);
  });

  test('CASH2-4 Billing cannot close, reopen or override a day', async () => {
    const d1 = await freshDay('erode-hq');
    expectStatus(await post('/api/cash/close', { branchId: 'erode-hq', date: d1, actor: 'QA' }, 'Billing'), 403, 'close');
    expectStatus(await post('/api/cash/reopen', { branchId: 'erode-hq', date: d1 }, 'Billing'), 403, 'reopen');
    expectStatus(await post('/api/cash/override', { branchId: 'erode-hq', date: d1, amount: 1, reason: 'x' }, 'Billing'), 403, 'override');
  });

  test('CASH2-1 closing a seeded day updates that day instead of creating a duplicate', async () => {
    const regs = ok(await get('/api/cash-registers'));
    const seeded = regs.find((r) => !r.isClosed && r.date < utcToday());
    assert.ok(seeded, 'an open past register exists');
    ok(await post('/api/cash/close', { branchId: seeded.branchId, date: seeded.date, actor: 'QA' }));
    const same = ok(await get('/api/cash-registers')).filter((r) => r.branchId === seeded.branchId && r.date === seeded.date);
    assert.equal(same.length, 1, 'one register row for the day');
    assert.equal(same[0].isClosed, true);
    ok(await post('/api/cash/reopen', { branchId: seeded.branchId, date: seeded.date }), 'reopen again');
  });

  test('CASH2-5 a recurring expense can be approved once per month, with a real amount and mode', async () => {
    const tpl = ok(await post('/api/recurring-expenses', { id: `rec-qa-${uid()}`, name: 'QA rent', defaultAmount: 900, branchId: BR, frequency: 'Monthly', dueDay: 5, paymentMode: 'Cash' })).recurringExpense;
    const d1 = await freshDay(BR);
    expectStatus(await post('/api/cash/approve-recurring', { templateId: tpl.id, branchId: BR, date: d1, amount: 0, paymentMode: 'Cash', actor: 'QA' }), 400, 'zero amount');
    expectStatus(await post('/api/cash/approve-recurring', { templateId: tpl.id, branchId: BR, date: d1, amount: 900, paymentMode: 'Bitcoin', actor: 'QA' }), 400, 'bad mode');
    ok(await post('/api/cash/approve-recurring', { templateId: tpl.id, branchId: BR, date: d1, amount: 900, paymentMode: 'Cash', actor: 'QA' }), 'approve');
    expectStatus(await post('/api/cash/approve-recurring', { templateId: tpl.id, branchId: BR, date: d1, amount: 900, paymentMode: 'Cash', actor: 'QA' }), 409, 'second approval same month');
  });

  test('CASH-7 deleting an approved recurring expense clears the approval', async () => {
    const tpl = ok(await post('/api/recurring-expenses', { id: `rec-qa-${uid()}`, name: 'QA EB', defaultAmount: 400, branchId: BR, frequency: 'Monthly', dueDay: 9, paymentMode: 'Cash' })).recurringExpense;
    const d1 = await freshDay(BR);
    const snap = ok(await post('/api/cash/approve-recurring', { templateId: tpl.id, branchId: BR, date: d1, amount: 400, paymentMode: 'Cash', actor: 'QA' }));
    const exp = snap.cashRegisters.find((r) => r.branchId === BR && r.date === d1).expenses.find((e) => e.reason === 'QA EB');
    const after = ok(await post('/api/cash/expense/delete', { branchId: BR, date: d1, expenseId: exp.id }));
    const t = after.recurringExpenses.find((x) => x.id === tpl.id);
    assert.equal(t.lastApprovedMonth, null);
  });

  test('CASH3-5 cash paid to a vendor from the PO page leaves the drawer (ledger row on the PO branch)', async () => {
    const item = await createItem({ stock: {} });
    const po = await createPO([{ item, qty: 10, price: 500 }], { branchId: BR });
    ok(await post('/api/purchase/payment', { poId: po.id, amount: 2000, mode: 'Cash', actor: 'QA' }), 'PO payment');
    const rows = (await paymentsFor(po.id)).filter((p) => p.type === 'out');
    assert.equal(rows.length, 1, 'one ledger row');
    assert.equal(rows[0].paymentMode, 'Cash');
    assert.equal(rows[0].branchId, BR);
    near(rows[0].amount, 2000);
    assert.equal(rows[0].date, utcToday());
  });

  test('CASH3-5 cash paid to a vendor while receiving stock leaves the drawer too', async () => {
    const item = await createItem({ stock: {} });
    const po = await createPO([{ item, qty: 10, price: 500 }], { branchId: BR });
    ok(await post('/api/purchase/receive', { poId: po.id, receipts: [{ itemId: item.id, quantityReceived: 10 }], payment: { amount: 1500, mode: 'Cash' }, actor: 'QA' }), 'receive + pay');
    const rows = (await paymentsFor(po.id)).filter((p) => p.type === 'out');
    assert.equal(rows.length, 1, 'pay-now at receipt should write a cash ledger row like the PO page does');
    near(rows[0]?.amount, 1500);
  });
});

describe('cash register audit and close rules (phase 6)', () => {
  const auditRows = async (as = 'CEO') => ok(await get('/api/audit?limit=1000', as), 'audit');

  test('CASH6-3 a day with a pending bank deposit cannot be closed until it is decided', async () => {
    const d1 = await freshDay(BR);
    const snap = ok(await post('/api/cash/expense', { branchId: BR, date: d1, expense: { reason: 'Bank', category: 'Deposit to Bank', cashAmount: 5000 } }));
    const dep = snap.cashRegisters.find((r) => r.branchId === BR && r.date === d1).expenses[0];
    expectStatus(await post('/api/cash/close', { branchId: BR, date: d1 }), 409, 'close with a pending deposit');
    ok(await post('/api/cash/expense/approve', { branchId: BR, date: d1, expenseId: dep.id, decision: 'rejected' }));
    ok(await post('/api/cash/close', { branchId: BR, date: d1 }), 'close once decided');
  });

  test('CASH-12 close, reopen, override and expenses are on the audit trail, named from the login', async () => {
    const d1 = await freshDay('coimbatore');
    ok(await post('/api/cash/override', { branchId: 'coimbatore', date: d1, amount: 4321, reason: 'QA count' }, 'Manager'));
    const snap = ok(await post('/api/cash/expense', { branchId: 'coimbatore', date: d1, expense: { reason: 'QA tea', cashAmount: 60 }, actor: 'Someone Else' }, 'Manager'));
    const exp = snap.cashRegisters.find((r) => r.branchId === 'coimbatore' && r.date === d1).expenses.find((e) => e.reason === 'QA tea');
    assert.notEqual(exp.createdBy, 'Someone Else', 'createdBy comes from the token');
    ok(await post('/api/cash/expense/delete', { branchId: 'coimbatore', date: d1, expenseId: exp.id }, 'Manager'));
    const closed = ok(await post('/api/cash/close', { branchId: 'coimbatore', date: d1, actor: 'CEO', notes: 'QA' }, 'Manager'));
    const reg = closed.cashRegisters.find((r) => r.branchId === 'coimbatore' && r.date === d1);
    assert.notEqual(reg.closedBy, 'CEO', 'closedBy comes from the token, not the body');
    ok(await post('/api/cash/reopen', { branchId: 'coimbatore', date: d1 }, 'Manager'));
    const rows = (await auditRows()).filter((a) => a.entity === 'cashRegister' && a.entityId === `coimbatore:${d1}`);
    for (const action of ['cash.override', 'cash.expense.add', 'cash.expense.delete', 'cash.close', 'cash.reopen']) {
      assert.ok(rows.some((a) => a.action === action), `audit row for ${action}`);
    }
    assert.ok(rows.every((a) => a.branchId === 'coimbatore'), 'rows carry the branch');
    assert.ok(rows.every((a) => /\[Manager\]/.test(a.actor)), 'actor is the logged-in manager');
  });

  test('RPT3-1 a Manager reads only their branch\'s audit trail; PO payments are on it', async () => {
    const d1 = await freshDay('erode-hq');
    ok(await post('/api/cash/override', { branchId: 'erode-hq', date: d1, amount: 1234, reason: 'QA erode' }));
    const item = await createItem({ purchasePrice: 100 });
    const po = await createPO([{ item, qty: 2, price: 100 }], { branchId: 'coimbatore' });
    ok(await post('/api/purchase/receive', { poId: po.id, receipts: [{ itemId: item.id, quantityReceived: 2 }], actor: 'QA' }));
    ok(await post('/api/purchase/payment', { poId: po.id, amount: 50, mode: 'GPay' }));
    const all = await auditRows();
    assert.ok(all.some((a) => a.action === 'purchase.payment' && a.entityId === po.id && a.branchId === 'coimbatore'), 'PO payment audited');
    const mine = await auditRows('Manager');
    assert.ok(mine.length > 0, 'manager sees rows');
    assert.ok(!mine.some((a) => a.entityId === `erode-hq:${d1}`), 'no Erode cash events');
    assert.ok(mine.some((a) => a.action === 'purchase.payment' && a.entityId === po.id), 'own branch PO payment visible');
    assert.ok(!mine.some((a) => a.entity === 'user' || a.entity === 'accessMatrix'), 'no branch-less admin events');
  });
});

describe('round 9: cash endpoints', () => {
  test('CASH9-2 close/reopen/expense/override need a real date and branch (a missing date never picks a random day)', async () => {
    const d1 = await freshDay('erode-hq');
    ok(await post('/api/cash/expense', { branchId: 'erode-hq', date: d1, expense: { reason: 'Tea', cashAmount: 10 } }), 'expense on d1');
    expectStatus(await post('/api/cash/close', { branchId: 'erode-hq' }), 400, 'close without a date');
    expectStatus(await post('/api/cash/reopen', { branchId: 'erode-hq' }), 400, 'reopen without a date');
    expectStatus(await post('/api/cash/close', { branchId: 'erode-hq', date: '2026-13-45' }), 400, 'bad date');
    expectStatus(await post('/api/cash/expense', { branchId: 'erode-hq', date: 'hello', expense: { reason: 'x', cashAmount: 1 } }), 400, 'bad expense date');
    assert.equal((await register('erode-hq', d1)).isClosed, false, 'nothing was closed');
  });

  test('CASH9-3 / SEC9-2 an unknown branch or an absurd amount is refused on every cash action', async () => {
    const d1 = await freshDay('erode-hq');
    expectStatus(await post('/api/cash/expense', { branchId: 'mars', date: d1, expense: { reason: 'x', cashAmount: 1 } }), 400, 'expense mars');
    expectStatus(await post('/api/cash/override', { branchId: 'mars', date: d1, amount: 100, reason: 'x' }), 400, 'override mars');
    expectStatus(await post('/api/cash/close', { branchId: 'mars', date: d1 }), 400, 'close mars');
    expectStatus(await post('/api/cash/reopen', { branchId: 'mars', date: d1 }), 400, 'reopen mars');
    expectStatus(await post('/api/cash/override', { branchId: 'erode-hq', date: d1, amount: 1e15, reason: 'x' }), 400, 'override 1e15');
    assert.equal(ok(await get('/api/cash-registers')).filter((r) => r.branchId === 'mars').length, 0, 'no register for mars');
  });

  test('CASH9-4 a vendor voucher number from the PO page is never reissued after a delete', async () => {
    const item = await createItem({ price: 1000, purchasePrice: 500, stock: {} });
    const po = await createPO([{ item, qty: 4, price: 500 }]);
    ok(await post('/api/purchase/receive', { poId: po.id, receipts: [{ itemId: item.id, quantityReceived: 4 }], actor: 'QA' }), 'receive');
    ok(await post('/api/purchase/payment', { poId: po.id, amount: 100, mode: 'GPay' }), 'pay 1');
    ok(await post('/api/purchase/payment', { poId: po.id, amount: 100, mode: 'GPay' }), 'pay 2');
    const vouchers = (await paymentsFor(po.id)).filter((p) => p.type === 'out').sort((a, b) => String(a.receiptNumber).localeCompare(String(b.receiptNumber)));
    const last = vouchers[vouchers.length - 1];
    ok(await del(`/api/payments/${last.id}`), 'delete the last voucher');
    ok(await post('/api/purchase/payment', { poId: po.id, amount: 100, mode: 'GPay' }), 'pay 3');
    const after = (await paymentsFor(po.id)).filter((p) => p.type === 'out');
    assert.ok(!after.some((p) => p.receiptNumber === last.receiptNumber), `${last.receiptNumber} was reissued`);
    assert.equal(new Set(after.map((p) => p.receiptNumber)).size, after.length, 'unique numbers');
  });
});
