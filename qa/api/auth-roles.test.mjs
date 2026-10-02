// Login, tokens, roles and branch scoping.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  API, api, post, put, get, del, ok, expectStatus, uid, login, createItem, line, saleBody, mustSell, sell,
  freshDay, createPO, signToken, createStaff, loginPin, receive, randomPhone, HOME,
} from './lib.mjs';

describe('auth & roles', () => {
  test('SEC-1 the API refuses requests without a token', async () => {
    for (const p of ['/api/bootstrap', '/api/invoices', '/api/branch-stock', '/api/payments', '/api/config/payrollSettings']) {
      expectStatus(await api('GET', p, { as: null }), 401, p);
    }
  });

  test('SEC-1 a wrong PIN is refused', async () => {
    const res = await api('POST', '/api/auth/login', { as: null, body: { pin: '0007' } });
    expectStatus(res, 401);
    await login('CEO'); // a successful login resets the per-IP failure counter
  });

  test('SEC-2 an edited token (role changed in the payload) is refused', async () => {
    const real = await login('Billing');
    const [payload, sig] = real.split('.');
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    data.role = 'CEO';
    const forged = `${Buffer.from(JSON.stringify(data)).toString('base64url')}.${sig}`;
    expectStatus(await api('GET', '/api/users', { as: { token: forged } }), 401);
  });

  test('SEC3-3 a token signed with the public dev-default secret is refused', async () => {
    const forged = signToken({ role: 'CEO', name: 'Forged', userId: 'user-ceo', exp: Date.now() + 3600e3 }, 'majestronicz-dev-secret-change-in-prod');
    expectStatus(await api('GET', '/api/users', { as: { token: forged } }), 401);
  });

  test('SEC3-3 a validly signed token without a user id is refused', { skip: !process.env.QA_AUTH_SECRET && 'set QA_AUTH_SECRET to the backend AUTH_SECRET to run' }, async () => {
    const forged = signToken({ role: 'CEO', name: 'No user id', exp: Date.now() + 3600e3 }, process.env.QA_AUTH_SECRET);
    expectStatus(await api('GET', '/api/users', { as: { token: forged } }), 401);
  });

  test('CRUD-1 generic write routes on business tables are gone', async () => {
    expectStatus(await post('/api/invoices', { id: 'x', grandTotal: 1 }), 404, 'POST /invoices');
    expectStatus(await put('/api/invoices/inv-001', { grandTotal: 1 }), 404, 'PUT /invoices/:id');
    expectStatus(await del('/api/customers/cust-001'), 404, 'DELETE /customers/:id');
    expectStatus(await put('/api/cash-registers/bulk', []), 404, 'PUT /cash-registers/bulk');
  });

  test('SEC3-1 a manager cannot change the access matrix or payroll settings', async () => {
    expectStatus(await put('/api/access-matrix', {}, 'Manager'), 403, 'PUT /access-matrix');
    expectStatus(await put('/api/config/accessMatrix', {}, 'Manager'), 403, 'PUT /config/accessMatrix');
    expectStatus(await put('/api/config/payrollSettings', { standardHoursPerMonth: 1 }, 'Manager'), 403, 'PUT /config/payrollSettings');
  });

  test('SEC4-1 only known settings can be written', async () => {
    expectStatus(await put('/api/config/invoices', [{ id: 'fake' }]), 400);
  });

  test('SEC-2 each role can only do what its role allows', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ stock: { 'erode-hq': 5 } });
    expectStatus((await sell(saleBody({ date, lines: [line(item, 1)] }), 'Sales')).res, 403, 'Sales sells');
    expectStatus((await sell(saleBody({ date, lines: [line(item, 1)] }), 'Purchase')).res, 403, 'Purchase sells');
    expectStatus(await post('/api/purchase/save', { po: { branchId: 'erode-hq', items: [] } }, 'Billing'), 403, 'Billing saves a PO');
    expectStatus(await post('/api/stock/adjust', { itemId: item.id, branchId: 'erode-hq', quantityChange: 5, reason: 'x' }, 'Billing'), 403, 'Billing adjusts stock');
    expectStatus(await post('/api/hrm/payroll-paid', { payrollId: 'pay-001', paymentMode: 'Cash' }, 'Manager'), 403, 'Manager pays payroll');
    expectStatus(await get('/api/users', 'Manager'), 403, 'Manager lists logins');
    expectStatus(await post('/api/admin/reseed', {}, 'Manager'), 403, 'Manager resets demo data');
  });

  test('SEC2-2 staff PINs never reach the browser', async () => {
    for (const role of ['CEO', 'Manager']) {
      const emps = ok(await get('/api/employees', role));
      assert.ok(emps.length > 0);
      assert.ok(emps.every((e) => !('pin' in e)), `${role}: /api/employees has no pin`);
      const boot = ok(await get('/api/bootstrap', role));
      assert.ok((boot.employees || []).every((e) => !('pin' in e)), `${role}: bootstrap employees have no pin`);
    }
  });

  test('SEC2-3 branch users only read their own branch\'s bills, registers and staff', async () => {
    const inv = ok(await get('/api/invoices', 'Billing'));
    assert.ok(inv.every((i) => i.branchId === HOME.Billing), 'Billing sees only Erode bills');
    const regs = ok(await get('/api/cash-registers', 'Manager'));
    assert.ok(regs.every((r) => r.branchId === HOME.Manager), 'Manager sees only Coimbatore registers');
    const emps = ok(await get('/api/employees', 'Manager'));
    assert.ok(emps.every((e) => e.branchId === HOME.Manager), 'Manager sees only Coimbatore staff');
    const other = await get('/api/invoices/inv-001', 'Manager'); // an Erode bill
    assert.ok(!other.body?.id, 'Manager cannot fetch an Erode bill by id');
  });

  test('SEC2-3 the Sales role cannot read customer payments', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ price: 100, stock: { 'erode-hq': 5 } });
    const inv = await mustSell(saleBody({ date, transactionType: 'Credit', customerPhone: randomPhone(), lines: [line(item, 1)], splits: [{ mode: 'COD-Credit', amount: 118 }] }));
    ok(await receive(inv, 50), 'receipt');
    const res = await get('/api/payments', 'Sales');
    const leaked = res.status === 200 && Array.isArray(res.body) ? res.body.length : 0;
    assert.ok(res.status === 403 || leaked === 0, `Sales read ${leaked} payment rows`);
  });

  test('SEC2-3 the live update stream needs a login', async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${API}/api/events`, { signal: ctrl.signal });
    const status = res.status;
    ctrl.abort();
    assert.equal(status, 401, `GET /api/events without a token returned ${status}`);
  });

  test('SEC6-1 changing your own PIN is rate-limited', async () => {
    const { pin } = await createStaff('Sales', 'erode-hq');
    const token = await loginPin(pin);
    const codes = [];
    for (let i = 0; i < 9; i++) {
      const r = await api('POST', '/api/auth/change-pin', { as: { token }, body: { newPin: '1111' } });
      codes.push(r.status);
    }
    assert.equal(codes[8], 429, `9th attempt should be rate-limited, got ${codes.join(',')}`);
  });

  test('SEC6-1 changing your own PIN does not reveal that another person uses it', async () => {
    const { pin } = await createStaff('Sales', 'erode-hq');
    const token = await loginPin(pin);
    const r = await api('POST', '/api/auth/change-pin', { as: { token }, body: { newPin: '1111' } }); // the CEO's PIN
    assert.notEqual(r.status, 409, `"${r.body?.message}" tells the caller that 1111 is someone's login PIN`);
  });

  test('SEC5-1 a Coimbatore manager cannot edit or create Erode staff', async () => {
    expectStatus(await post('/api/employees', { id: 'emp-001', name: 'K. Ramachandran', designation: 'Tech', monthlySalary: 99999, branchId: 'coimbatore' }, 'Manager'), 403, 'edit Erode employee');
    expectStatus(await post('/api/employees', { name: `QA ${uid()}`, designation: 'Tech', monthlySalary: 1000, branchId: 'erode-hq', pin: '4321' }, 'Manager'), 403, 'create Erode employee');
    const emp = ok(await get('/api/employees/emp-001'));
    assert.equal(emp.monthlySalary, 24000);
    assert.equal(emp.branchId, 'erode-hq');
  });

  test('SEC5-1 a Coimbatore manager cannot take over another branch\'s recurring expense', async () => {
    const tpl = ok(await post('/api/recurring-expenses', { id: `rec-qa-${uid()}`, name: 'QA Chennai rent', defaultAmount: 9000, branchId: 'chennai', frequency: 'Monthly', dueDay: 3, paymentMode: 'Cash' })).recurringExpense;
    expectStatus(await post('/api/recurring-expenses', { id: tpl.id, name: 'Taken', defaultAmount: 99999, branchId: 'coimbatore', frequency: 'Monthly', dueDay: 3, paymentMode: 'Cash' }, 'Manager'), 403, 'upsert');
    expectStatus(await put(`/api/cash/recurring/${tpl.id}`, { defaultAmount: 1 }, 'Manager'), 403, 'edit');
    expectStatus(await del(`/api/cash/recurring/${tpl.id}`, 'Manager'), 403, 'delete');
  });

  test('CASH4-1 a Coimbatore manager cannot approve another branch\'s recurring expense', async () => {
    const tpl = ok(await post('/api/recurring-expenses', { id: `rec-qa-${uid()}`, name: 'QA Chennai EB', defaultAmount: 2200, branchId: 'chennai', frequency: 'Monthly', dueDay: 3, paymentMode: 'Cash' })).recurringExpense;
    const date = await freshDay('chennai');
    const res = await post('/api/cash/approve-recurring', { templateId: tpl.id, branchId: 'coimbatore', date, amount: 2200, paymentMode: 'Cash', actor: 'QA' }, 'Manager');
    expectStatus(res, 403, 'approve Chennai template');
  });

  test('CASH4-1 Billing cannot create recurring expense templates', async () => {
    const res = await post('/api/recurring-expenses', { id: `rec-qa-${uid()}`, name: 'QA by billing', defaultAmount: 500, branchId: 'erode-hq', frequency: 'Monthly', dueDay: 4, paymentMode: 'Cash' }, 'Billing');
    expectStatus(res, 403);
  });

  test('SAL4-3 a Coimbatore manager cannot edit an Erode bill', async () => {
    const date = await freshDay('erode-hq');
    const item = await createItem({ price: 1000, stock: { 'erode-hq': 10 } });
    const inv = await mustSell(saleBody({ date, customerName: 'Erode Customer', lines: [line(item, 5)] }));
    const res = await post('/api/tx/sale', { ...saleBody({ id: inv.id, branchId: 'coimbatore', date, customerName: 'Renamed', lines: [line(item, 1)] }) }, 'Manager');
    expectStatus(res, 403);
    const after = ok(await get(`/api/invoices/${inv.id}`));
    assert.equal(after.customerName, 'Erode Customer');
    assert.equal(after.grandTotal, inv.grandTotal);
  });

  test('SEC5-2 a branch user cannot move another branch\'s PO by sending their own branch', async () => {
    const item = await createItem();
    const po = await createPO([{ item, qty: 2, price: 100 }], { branchId: 'chennai' });
    const res = await post('/api/purchase/save', { po: { ...po, branchId: 'erode-hq' }, actor: 'QA' }, 'Purchase');
    expectStatus(res, 403);
    assert.equal(ok(await get(`/api/purchase-orders/${po.id}`)).branchId, 'chennai');
  });

  test('SAL4-11 a Coimbatore manager cannot edit an Erode quote', async () => {
    const id = `est-qa-${uid()}`;
    ok(await post('/api/catalog/estimate', { id, branchId: 'erode-hq', date: '2026-09-20', time: '10:00', customerName: 'Erode Quote', withGst: true,
      items: [{ id: 'l1', itemName: 'Service', quantity: 1, unitPrice: 1000, gstRate: 18 }], termsAndConditions: 'QA' }));
    const res = await post('/api/catalog/estimate', { id, branchId: 'coimbatore', date: '2026-09-20', time: '10:00', customerName: 'Taken over', withGst: true,
      items: [{ id: 'l1', itemName: 'Service', quantity: 1, unitPrice: 1, gstRate: 18 }], termsAndConditions: 'QA' }, 'Manager');
    expectStatus(res, 403);
  });

  test('PUR6-1 a Coimbatore manager cannot pay off an Erode PO through Parties', async () => {
    const item = await createItem();
    const po = await createPO([{ item, qty: 2, price: 100 }], { branchId: 'erode-hq' });
    const res = await post('/api/payments', { type: 'out', partyType: 'vendor', partyId: po.vendorId, partyName: po.vendorName, branchId: 'coimbatore',
      amount: 200, paymentMode: 'GPay', allocations: [{ refId: po.id, amount: 200 }] }, 'Manager');
    expectStatus(res, 403);
    assert.equal(ok(await get(`/api/purchase-orders/${po.id}`)).amountPaid || 0, 0);
  });

  test('PUR6-1 Billing (no purchase rights) cannot reduce a vendor payable through Parties', async () => {
    const item = await createItem();
    const po = await createPO([{ item, qty: 2, price: 100 }], { branchId: 'erode-hq' });
    const res = await post('/api/payments', { type: 'out', partyType: 'vendor', partyId: po.vendorId, partyName: po.vendorName, branchId: 'erode-hq',
      amount: 200, paymentMode: 'GPay', allocations: [{ refId: po.id, amount: 200 }] }, 'Billing');
    expectStatus(res, 403);
    assert.equal(ok(await get(`/api/purchase-orders/${po.id}`)).amountPaid || 0, 0);
  });
  test('SEC8-1 Billing cannot edit or delete recurring expense templates', async () => {
    const tpl = ok(await post('/api/recurring-expenses', { id: `rec-qa-${uid()}`, name: 'QA Erode rent', defaultAmount: 9000, branchId: 'erode-hq', frequency: 'Monthly', dueDay: 3, paymentMode: 'Cash' })).recurringExpense;
    expectStatus(await put(`/api/cash/recurring/${tpl.id}`, { defaultAmount: 12345 }, 'Billing'), 403, 'edit');
    expectStatus(await del(`/api/cash/recurring/${tpl.id}`, 'Billing'), 403, 'delete');
    const after = ok(await get('/api/recurring-expenses')).find((t) => t.id === tpl.id);
    assert.ok(after, 'template still exists');
    assert.equal(after.defaultAmount, 9000);
    // The Manager of the template's own branch still can.
    const erodeMgr = await createStaff('Manager', 'erode-hq');
    ok(await api('PUT', `/api/cash/recurring/${tpl.id}`, { as: { token: await loginPin(erodeMgr.pin) }, body: { defaultAmount: 9500 } }), 'own-branch manager edit');
  });

  test('VAL-1 / PLT6-1 recurring templates reject wrong types and unknown frequencies with 400', async () => {
    const base = { name: 'QA EB', defaultAmount: 900, branchId: 'erode-hq', frequency: 'Monthly', dueDay: 5, paymentMode: 'Cash' };
    for (const [what, patch] of [
      ['frequency hourly', { frequency: 'hourly' }],
      ['frequency missing', { frequency: undefined }],
      ['startMonth text', { frequency: 'Quarterly', startMonth: 'abc' }],
      ['amount 1e15', { defaultAmount: 1e15 }],
      ['branch mars', { branchId: 'mars' }],
      ['dueDay text', { dueDay: 'soon' }],
    ]) {
      const res = await post('/api/recurring-expenses', { ...base, id: `rec-qa-${uid()}`, ...patch });
      expectStatus(res, 400, what);
      assert.doesNotMatch(JSON.stringify(res.body), /prisma|invocation/i, `${what}: leaks database detail`);
    }
    const tpl = ok(await post('/api/recurring-expenses', { ...base, id: `rec-qa-${uid()}` })).recurringExpense;
    expectStatus(await put(`/api/cash/recurring/${tpl.id}`, { frequency: 'hourly' }), 400, 'edit frequency');
    expectStatus(await put(`/api/cash/recurring/${tpl.id}`, { startMonth: 'abc' }), 400, 'edit startMonth');
  });

  test('VAL-1 an absurd expense amount is refused', async () => {
    const date = await freshDay('erode-hq');
    const res = await post('/api/cash/expense', { branchId: 'erode-hq', date, expense: { reason: 'QA huge', cashAmount: 1e15, gpayAmount: 0 }, actor: 'QA' });
    expectStatus(res, 400);
  });

  test('ERR-1 an unknown /api route answers JSON 404', async () => {
    for (const [method, path] of [['GET', '/api/no-such-thing'], ['PUT', '/api/invoices/x/y/z'], ['POST', '/api/tx/nope']]) {
      const res = await api(method, path, { body: method === 'GET' ? undefined : {} });
      expectStatus(res, 404, `${method} ${path}`);
      assert.equal(typeof res.body, 'object', `${method} ${path} should be JSON, got: ${String(res.body).slice(0, 60)}`);
      assert.equal(res.body.error, 'NOT_FOUND');
    }
  });

  test('ERR-1 malformed JSON is a 400, not a 500', async () => {
    const res = await fetch(`${API}/api/catalog/customer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await login('CEO')}` }, body: '{"name": ',
    });
    assert.equal(res.status, 400);
  });

  test('PLT5-1 an unknown online-order status is a 400', async () => {
    const res = await post('/api/shopify/order-status', { invoiceId: 'inv-001', status: 'Teleported' });
    expectStatus(res, 400);
    const missing = await post('/api/shopify/order-status', { status: 'Packed' }); // no invoiceId → Prisma validation
    expectStatus(missing, [400, 404]);
    assert.doesNotMatch(JSON.stringify(missing.body), /prisma|invocation|findUnique/i, 'leaks database detail');
  });

  test('CRM6-7 a customer save ignores unknown fields and defaults a missing address', async () => {
    const phone = randomPhone();
    const res = await post('/api/catalog/customer', { name: 'QA Allow-list', phone, hackerField: 'x', totalSpent: 999999, creditBalance: 5000 });
    const body = ok(res, 'save');
    const c = body.customers.find((x) => x.phone === phone);
    assert.ok(c, 'customer saved');
    assert.equal(c.address, '');
    assert.equal(c.totalSpent, 0);
    assert.ok(!c.creditBalance, 'credit balance not taken from the client');
    assert.equal(c.hackerField, undefined);
    expectStatus(await post('/api/catalog/customer', { id: c.id, name: 'QA Allow-list', phone, address: 42 }), 400, 'address must be text');
  });

  test('SEC7-1 editing a bill without a date keeps its own date (no spurious day-closed)', async () => {
    const [d1, d2] = await (async () => [await freshDay('erode-hq'), await freshDay('erode-hq')])();
    const inv = await mustSell(saleBody({ date: d1, lines: [line(await createItem({ stock: { 'erode-hq': 5 } }), 1)] }));
    // Close a DIFFERENT day of the same branch.
    ok(await post('/api/cash/close', { branchId: 'erode-hq', date: d2, notes: 'QA', actor: 'QA' }), 'close other day');
    const edit = { ...inv };
    delete edit.date;
    const res = await post('/api/tx/sale', edit);
    ok(res, 'edit without date');
    assert.equal(res.body.savedInvoice.date, d1);
    const fresh = saleBody({ lines: [line(await createItem({ stock: { 'erode-hq': 5 } }), 1)] });
    delete fresh.date;
    expectStatus(await post('/api/tx/sale', fresh), 400, 'new sale without date');
  });

  test('SEC-5 signing out revokes the token', async () => {
    const { pin } = await createStaff('Sales', 'erode-hq');
    const token = await loginPin(pin);
    ok(await api('GET', '/api/branch-stock', { as: { token } }), 'works before sign-out');
    ok(await api('POST', '/api/auth/logout', { as: { token }, body: {} }), 'logout');
    expectStatus(await api('GET', '/api/branch-stock', { as: { token } }), 401, 'old token after sign-out');
    expectStatus(await api('GET', `/api/events?token=${encodeURIComponent(token)}`, { as: null }), 401, 'live stream with old token');
    // Logging in again works.
    const res = await api('POST', '/api/auth/login', { as: null, body: { pin } });
    const fresh = ok(res, 'login again').token;
    ok(await api('GET', '/api/branch-stock', { as: { token: fresh } }), 'new token works');
    expectStatus(await api('POST', '/api/auth/logout', { as: null, body: {} }), 401, 'logout needs a login');
  });

  test('SEC6-1 every refused PIN change answers the same status', async () => {
    const { pin } = await createStaff('Sales', 'erode-hq');
    const token = await loginPin(pin);
    const taken = await api('POST', '/api/auth/change-pin', { as: { token }, body: { newPin: '1111' } });
    const same = await api('POST', '/api/auth/change-pin', { as: { token }, body: { newPin: pin } });
    const bad = await api('POST', '/api/auth/change-pin', { as: { token }, body: { newPin: '12a' } });
    assert.deepEqual([taken.status, same.status, bad.status], [400, 400, 400]);
    assert.equal(taken.body.message, same.body.message, 'taken and own-PIN refusals read the same');
  });
});

describe('write replies are branch-scoped', () => {
  const onlyBranch = (rows, branch, what) => {
    assert.ok(Array.isArray(rows), `${what} is a list`);
    const other = rows.filter((r) => r.branchId && r.branchId !== branch);
    assert.equal(other.length, 0, `${what}: ${other.length} rows of other branches leaked`);
  };

  test('SNAP-1 a sale by Billing answers with only its own branch bills and stock history', async () => {
    // Other branches have bills and stock history.
    const item = await createItem({ stock: { 'erode-hq': 5, coimbatore: 5 } });
    await mustSell(saleBody({ branchId: 'coimbatore', date: await freshDay('coimbatore'), lines: [line(item, 1)] }));
    const reply = (await sell(saleBody({ date: await freshDay('erode-hq'), lines: [line(item, 1)] }), 'Billing')).res;
    const body = ok(reply, 'Billing sale');
    onlyBranch(body.invoices, 'erode-hq', 'invoices');
    onlyBranch(body.stockAdjustmentLogs, 'erode-hq', 'stock history');
    assert.ok(body.invoices.length > 0 && body.stockAdjustmentLogs.length > 0, 'own rows are still there');
  });

  test('SNAP-1 a Manager stock action and stock history reads carry only their branch', async () => {
    const item = await createItem({ stock: { 'erode-hq': 5, coimbatore: 5 } });
    ok(await post('/api/stock/transfer', { itemId: item.id, fromBranch: 'erode-hq', toBranch: 'chennai', quantity: 1 }), 'CEO transfer elsewhere');
    const body = ok(await post('/api/stock/adjust', { itemId: item.id, branchId: 'coimbatore', quantityChange: 1, reason: 'Found' }, 'Manager'));
    onlyBranch(body.stockAdjustmentLogs, 'coimbatore', 'adjust reply stock history');
    onlyBranch(body.challans, 'coimbatore', 'adjust reply challans');
    assert.ok(body.stockTransfers.every((t) => t.fromBranch === 'coimbatore' || t.toBranch === 'coimbatore'), 'only transfers into or out of Coimbatore');
    onlyBranch(ok(await get('/api/stock-adjustments', 'Manager')), 'coimbatore', 'GET stock history');
    const boot = ok(await get('/api/bootstrap', 'Manager'));
    for (const k of ['invoices', 'payments', 'attendanceRecords', 'stockAdjustmentLogs', 'purchaseOrders', 'cashRegisters']) onlyBranch(boot[k], 'coimbatore', `bootstrap ${k}`);
  });

  test('SEC9-1 signing out closes that user\'s open live-updates stream', async () => {
    const { pin } = await createStaff('Billing', 'erode-hq');
    const token = await loginPin(pin);
    const res = await fetch(`${API}/api/events?token=${encodeURIComponent(token)}`);
    assert.equal(res.status, 200);
    const reader = res.body.getReader();
    await reader.read(); // the retry hint
    ok(await api('POST', '/api/auth/logout', { as: { token } }), 'sign out');
    const ended = await Promise.race([
      (async () => { for (;;) { const { done } = await reader.read(); if (done) return true; } })(),
      new Promise((r) => setTimeout(() => r(false), 3000)),
    ]);
    assert.equal(ended, true, 'the stream ended after sign-out');
  });
});

