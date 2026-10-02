// Enquiries, follow-up reminders and pending (backlog) orders.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  post, get, ok, expectStatus, uid, createItem, serviceLine, saleBody, mustSell, freshDay, randomPhone,
} from './lib.mjs';

/** Today in India, YYYY-MM-DD (the server validates reminder dates against it). */
const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const tomorrow = () => new Date(Date.parse(`${istToday()}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

/** Log an enquiry. With `shortage`, the item has no stock so a pending order is created. */
async function newEnquiry({ shortage = true, as = 'CEO', branchId = 'erode-hq', extra = {} } = {}) {
  const item = await createItem({ stock: { [branchId]: shortage ? 0 : 10 } });
  const id = `enq-qa-${uid()}`;
  const enquiry = {
    id, enquiryNumber: `ENQ-QA-${uid()}`.toUpperCase(), customerName: 'QA Enquirer', customerPhone: randomPhone(),
    itemId: item.id, itemName: item.itemName, itemCode: item.itemCode, unit: item.unit, quantity: 2,
    branchId, date: istToday(), time: '10:30', status: 'Follow-up',
    reminderDate: tomorrow(), reminderTime: '11:00', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...extra,
  };
  const res = await post('/api/enquiry/save', { enquiry, initialExpectedRestockDate: tomorrow(), actor: 'QA' }, as);
  const snap = ok(res, 'save enquiry');
  return {
    item,
    enq: snap.enquiries.find((e) => e.id === id),
    order: snap.pendingOrders.find((p) => p.enquiryId === id),
    reminders: snap.reminders.filter((r) => r.enquiryId === id),
  };
}

/** A real saved bill made from the enquiry. */
async function billFor(enq) {
  const date = await freshDay(enq.branchId);
  const body = saleBody({ branchId: enq.branchId, date, lines: [serviceLine(1, 500)], customerName: enq.customerName });
  body.sourceEnquiryId = enq.id;
  body.sourceEnquiryNumber = enq.enquiryNumber;
  return mustSell(body);
}

const snapOf = async () => ({
  enquiries: ok(await get('/api/enquiries')),
  pendingOrders: ok(await get('/api/pending-orders')),
  reminders: ok(await get('/api/reminders')),
});

describe('enquiries & pending orders', () => {
  test('CRM2-9 an enquiry status must be a real status', async () => {
    const { enq } = await newEnquiry({ shortage: false });
    expectStatus(await post('/api/enquiry/status', { enquiryId: enq.id, status: 'Banana', actor: 'QA' }, 'Sales'), 400, 'Banana');
    expectStatus(await post('/api/enquiry/status', { enquiryId: enq.id, status: 'Converted', actor: 'QA' }, 'Sales'), 400, 'Converted by hand');
    const after = (await snapOf()).enquiries.find((e) => e.id === enq.id);
    assert.equal(after.status, 'Follow-up');
  });

  test('CRM-2 / PLT7-1 converting needs a real saved bill, then marks the enquiry Converted and the order Fulfilled once', async () => {
    const { enq, order } = await newEnquiry();
    assert.ok(order, 'pending order created for the shortage');
    expectStatus(await post('/api/enquiry/convert', { enquiryId: enq.id, targetType: 'invoice', docId: `inv-fake-${uid()}`, docNumber: 'FAKE', actor: 'QA' }), 400, 'fake doc id');
    expectStatus(await post('/api/enquiry/convert', { enquiryId: enq.id, targetType: 'invoice', actor: 'QA' }), 400, 'no doc id');
    let s = await snapOf();
    assert.equal(s.enquiries.find((e) => e.id === enq.id).status, 'Follow-up', 'not converted by a fake link');
    assert.equal(s.pendingOrders.find((p) => p.id === order.id).status, 'Waiting', 'order not fulfilled without a bill');

    const inv = await billFor(enq);
    ok(await post('/api/enquiry/convert', { enquiryId: enq.id, targetType: 'invoice', docId: inv.id, docNumber: 'IGNORED', actor: 'QA' }), 'convert');
    s = await snapOf();
    const after = s.enquiries.find((e) => e.id === enq.id);
    assert.equal(after.status, 'Converted');
    assert.equal(after.convertedTo.id, inv.id);
    assert.equal(after.convertedTo.number, inv.invoiceNumber, 'number taken from the saved bill, not the client');
    assert.equal(s.pendingOrders.find((p) => p.id === order.id).status, 'Fulfilled');
    assert.ok(s.reminders.filter((r) => r.enquiryId === enq.id).every((r) => r.isCompleted), 'CRM-9 reminders closed on the server');

    expectStatus(await post('/api/enquiry/convert', { enquiryId: enq.id, targetType: 'invoice', docId: inv.id, actor: 'QA' }), 409, 'second conversion');
  });

  test('CRM2-9 the Sales role cannot convert an enquiry into a bill', async () => {
    const { enq } = await newEnquiry({ shortage: false });
    const inv = await billFor(enq);
    expectStatus(await post('/api/enquiry/convert', { enquiryId: enq.id, targetType: 'invoice', docId: inv.id, actor: 'QA' }, 'Sales'), 403);
  });

  test('CRM8-6 / PLT7-1 a pending-order update only accepts the editable fields', async () => {
    const { order } = await newEnquiry();
    for (const [what, updates] of [
      ['orderNumber', { orderNumber: 'HACK' }],
      ['quantity', { quantityNeeded: -5 }],
      ['branch', { branchId: 'chennai' }],
      ['unknown field', { bogusField: 1 }],
      ['status Fulfilled', { status: 'Fulfilled' }],
      ['negative advance', { advanceAmount: -500 }],
      ['advance typed onto the order', { advanceAmount: 300, advanceMode: 'GPay' }],
      ['bad date', { expectedRestockDate: '2026-13-45' }],
    ]) {
      const res = await post('/api/enquiry/pending/update', { orderId: order.id, updates }, 'Billing');
      expectStatus(res, 400, what);
      assert.doesNotMatch(JSON.stringify(res.body), /prisma|invocation/i, `${what}: leaks database detail`);
    }
    const snap = ok(await post('/api/enquiry/pending/update', { orderId: order.id, updates: { expectedRestockDate: tomorrow(), notes: 'QA note' } }, 'Billing'), 'valid update');
    const after = snap.pendingOrders.find((p) => p.id === order.id);
    assert.equal(after.orderNumber, order.orderNumber);
    assert.equal(after.quantityNeeded, order.quantityNeeded);
    assert.equal(after.branchId, order.branchId);
    assert.equal(after.advanceAmount || 0, order.advanceAmount || 0, 'the advance is untouched — it is only taken as a receipt');
    assert.equal(after.expectedRestockDate, tomorrow());
  });

  test('CRM-12 a fulfilled pending order can no longer be edited', async () => {
    const { enq, order } = await newEnquiry();
    const inv = await billFor(enq);
    ok(await post('/api/enquiry/convert', { enquiryId: enq.id, targetType: 'invoice', docId: inv.id, actor: 'QA' }), 'convert');
    expectStatus(await post('/api/enquiry/pending/update', { orderId: order.id, updates: { expectedRestockDate: tomorrow() } }), 409, 'change date');
    expectStatus(await post('/api/enquiry/pending/cancel', { orderId: order.id, reason: 'x' }), 409, 'cancel');
  });

  test('CRM3-3 linking a catalogue item twice creates only one pending order', async () => {
    const { enq } = await newEnquiry({ shortage: false, extra: { itemId: undefined, itemCode: undefined, isNewItemRequest: true, itemName: `QA new thing ${uid()}` } });
    const item = await createItem();
    ok(await post('/api/enquiry/link-item', { enquiryId: enq.id, item, actor: 'QA' }), 'first link');
    expectStatus(await post('/api/enquiry/link-item', { enquiryId: enq.id, item, actor: 'QA' }), 409, 'second link');
    const orders = (await snapOf()).pendingOrders.filter((p) => p.enquiryId === enq.id);
    assert.equal(orders.length, 1);
  });

  test('CRM-9 reminders must be a real date/time, not in the past, and close when the enquiry is cancelled', async () => {
    const { enq } = await newEnquiry({ shortage: false });
    expectStatus(await post('/api/enquiry/reminder', { enquiryId: enq.id, dueDate: '2020-01-01', dueTime: '11:00', actor: 'QA' }), 400, 'past date');
    expectStatus(await post('/api/enquiry/reminder', { enquiryId: enq.id, dueDate: tomorrow(), dueTime: '99:99', actor: 'QA' }), 400, 'bad time');
    ok(await post('/api/enquiry/reminder', { enquiryId: enq.id, dueDate: tomorrow(), dueTime: '15:30', actor: 'QA' }), 'valid reminder');
    ok(await post('/api/enquiry/cancel', { enquiryId: enq.id, reason: 'QA cancel', actor: 'QA' }), 'cancel');
    const s = await snapOf();
    assert.ok(s.reminders.filter((r) => r.enquiryId === enq.id).every((r) => r.isCompleted), 'reminders closed on the server');
    expectStatus(await post('/api/enquiry/convert', { enquiryId: enq.id, targetType: 'invoice', docId: 'x', actor: 'QA' }), 409, 'cancelled enquiry cannot convert');
  });

  test('CRM-9 marking a reminder done clears the enquiry\'s next reminder', async () => {
    const { enq, reminders } = await newEnquiry({ shortage: false });
    assert.equal(reminders.length, 1);
    const snap = ok(await post('/api/enquiry/reminder/complete', { reminderId: reminders[0].id }), 'done');
    const after = snap.enquiries.find((e) => e.id === enq.id);
    assert.ok(!after.reminderDate, 'next reminder cleared');
  });

  test('CRM-15 / CRM4-7 an enquiry needs a real time and a valid phone', async () => {
    const item = await createItem();
    const base = {
      id: `enq-qa-${uid()}`, enquiryNumber: `ENQ-QA-${uid()}`, customerName: 'QA', itemId: item.id, itemName: item.itemName, unit: 'PCS',
      quantity: 1, branchId: 'erode-hq', date: istToday(), time: '10:00', status: 'Follow-up',
    };
    expectStatus(await post('/api/enquiry/save', { enquiry: { ...base, time: '99:99 zz' } }), 400, 'time');
    expectStatus(await post('/api/enquiry/save', { enquiry: { ...base, customerPhone: '12345' } }), 400, 'phone');
    expectStatus(await post('/api/enquiry/save', { enquiry: { ...base, quantity: -5 } }), 400, 'quantity');
    expectStatus(await post('/api/enquiry/save', { enquiry: { ...base, reminderDate: '2020-01-01', reminderTime: '10:00' } }), 400, 'past reminder');
  });

  test('CRM2-9 saving an enquiry cannot set its status or conversion', async () => {
    const { enq } = await newEnquiry({ shortage: false, extra: { status: 'Converted', convertedTo: { type: 'invoice', id: 'x', number: 'HACK' } } });
    assert.equal(enq.status, 'Follow-up');
    assert.ok(!enq.convertedTo);
  });

  test('CRM-14 a Coimbatore manager cannot log an enquiry for Chennai', async () => {
    const item = await createItem();
    const res = await post('/api/enquiry/save', { enquiry: {
      id: `enq-qa-${uid()}`, enquiryNumber: `ENQ-QA-${uid()}`, customerName: 'QA', itemId: item.id, itemName: item.itemName, unit: 'PCS',
      quantity: 1, branchId: 'chennai', date: istToday(), time: '10:00', status: 'Follow-up',
    } }, 'Manager');
    expectStatus(res, 403);
  });
});
