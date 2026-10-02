import { prisma } from '../db.js';
import { AppError } from '../middleware/errorHandler.js';
import { nowIso, rid, cleanPhone } from '../lib/stockLedger.js';
import { nextPendingOrderNumber, nextEnquiryNumber } from '../lib/sequences.js';
import { serializableTx } from '../lib/tx.js';
import { assertBranchAllowed } from '../lib/branchGuard.js';
import { isValidBranch } from '../lib/constants.js';
import { roleCan } from '../lib/auth.js';

const snap = async (tx: any) => ({
  enquiries: await tx.enquiry.findMany(),
  pendingOrders: await tx.pendingOrder.findMany(),
  reminders: await tx.followUpReminder.findMany(),
});

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const isDate = (v: any) => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const isTime = (v: any) => typeof v === 'string' && TIME_RE.test(v);
/** Today in India (the shop's calendar), YYYY-MM-DD. */
const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const OPEN_ORDER = ['Waiting', 'Stock Arrived'];

/** A follow-up reminder must be a real date/time, not in the past (CRM-9). */
function assertReminder(dueDate: any, dueTime: any) {
  if (!isDate(dueDate)) throw new AppError('BAD_REMINDER_DATE', 'Reminder date must be a valid date (YYYY-MM-DD).', 400);
  if (!isTime(dueTime)) throw new AppError('BAD_REMINDER_TIME', 'Reminder time must be HH:mm (24-hour).', 400);
  if (dueDate < istToday()) throw new AppError('BAD_REMINDER_DATE', 'Reminder date cannot be in the past.', 400);
}

/** Close every open follow-up reminder of an enquiry that is no longer open (CRM-9). */
const closeReminders = (tx: any, enquiryId: string) =>
  tx.followUpReminder.updateMany({ where: { enquiryId, isCompleted: false }, data: { isCompleted: true, completedAt: nowIso() } });

/**
 * Fields a client may send when saving an enquiry. Lifecycle state (status,
 * conversion, cancellation, the linked pending order) is server-owned and set
 * only by the dedicated flows (CRM2-9 / CRM8-6).
 */
const ENQUIRY_FIELDS = [
  'id', 'enquiryNumber', 'customerName', 'customerPhone', 'itemId', 'itemName', 'itemCode', 'unit', 'quantity',
  'branchId', 'date', 'time', 'notes', 'reminderDate', 'reminderTime', 'reminderNotes', 'timeline',
  'isNewItemRequest', 'itemImageUrl', 'createdAt',
];

function cleanEnquiry(input: any) {
  if (!input || typeof input !== 'object') throw new AppError('BAD_REQUEST', 'Enquiry details are missing.', 400);
  const e: any = {};
  for (const k of ENQUIRY_FIELDS) if (input[k] !== undefined && input[k] !== null) e[k] = input[k];
  if (typeof e.id !== 'string' || !e.id.trim()) throw new AppError('BAD_REQUEST', 'Enquiry id is missing.', 400);
  if (typeof e.customerName !== 'string' || !e.customerName.trim()) throw new AppError('NAME_REQUIRED', 'Customer name is required.', 400);
  e.customerName = e.customerName.trim();
  if (typeof e.itemName !== 'string' || !e.itemName.trim()) throw new AppError('ITEM_REQUIRED', 'Item is required.', 400);
  const qty = Number(e.quantity);
  if (typeof e.quantity === 'boolean' || !Number.isFinite(qty) || qty <= 0 || qty > 1e6) throw new AppError('BAD_QTY', 'Quantity must be greater than zero.', 400);
  e.quantity = qty;
  if (e.customerPhone !== undefined && e.customerPhone !== '') {
    const digits = String(e.customerPhone).replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(digits)) throw new AppError('BAD_PHONE', 'Enter a valid 10-digit mobile number, or leave the phone blank.', 400); // CRM4-7
  }
  if (!isDate(e.date)) throw new AppError('BAD_DATE', 'Enquiry date must be a valid date (YYYY-MM-DD).', 400);
  if (!isTime(e.time)) throw new AppError('BAD_TIME', 'Enquiry time must be HH:mm (24-hour).', 400); // CRM-15
  if (typeof e.unit !== 'string' || !e.unit.trim()) e.unit = 'Units';
  if (e.timeline !== undefined && !Array.isArray(e.timeline)) delete e.timeline;
  for (const k of ['enquiryNumber', 'itemId', 'itemCode', 'notes', 'reminderNotes', 'itemImageUrl', 'createdAt']) {
    if (e[k] !== undefined && typeof e[k] !== 'string') throw new AppError('BAD_REQUEST', `Invalid ${k}.`, 400);
  }
  if (e.isNewItemRequest !== undefined) e.isNewItemRequest = Boolean(e.isNewItemRequest);
  return e;
}

const tl = (type: string, title: string, description: string, actor: string) => ({
  id: `tl-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
  timestamp: nowIso(), type, title, description, actor,
});

/** Save/edit an enquiry; auto-create a pending order on stock shortage; optional reminder. */
export function saveEnquiry(enquiry: any, initialExpectedRestockDate: string | undefined, actor: string, reqUser?: any) {
  const e = cleanEnquiry(enquiry);
  // Serializable + retry: the enquiry number is allocated here (CRM9-12), so two
  // enquiries saved at the same moment must not take the same number.
  return serializableTx(async (tx: any) => {
    // SEC5-2: on edit, authorize against the STORED enquiry's branch (not the
    // client-supplied one) and keep the branch immutable, so a branch-locked user
    // can't edit or reassign another branch's enquiry via the request body.
    const existingEnq = e.id ? await tx.enquiry.findUnique({ where: { id: e.id } }) : null;
    if (existingEnq) {
      assertBranchAllowed(reqUser, existingEnq.branchId);
      e.branchId = existingEnq.branchId;
      // Lifecycle stays server-owned: keep the stored number and the already-
      // linked pending order (re-saving must not spawn a second one).
      e.enquiryNumber = existingEnq.enquiryNumber;
      e.createdAt = existingEnq.createdAt;
      // The status is server-owned too; the upsert's create branch needs it, so
      // an edit without it was refused (400) — keep the stored one.
      e.status = existingEnq.status;
      e.hasPendingOrder = existingEnq.hasPendingOrder;
      e.pendingOrderId = existingEnq.pendingOrderId;
    } else {
      assertBranchAllowed(reqUser, e.branchId);
      if (!isValidBranch(e.branchId)) throw new AppError('BAD_BRANCH', 'Choose a valid branch.', 400);
      // CRM9-12: the number comes from the server's per-branch sequence — the
      // browser's guess collided when two counters logged enquiries together.
      e.enquiryNumber = await nextEnquiryNumber(tx, e.branchId);
      e.status = 'Follow-up';
      e.createdAt = nowIso(); // ACT-1: when it was logged is the server's clock, not the request's
    }
    e.updatedAt = nowIso();
    const newReminder = !!(e.reminderDate && e.reminderTime) &&
      (!existingEnq || existingEnq.reminderDate !== e.reminderDate || existingEnq.reminderTime !== e.reminderTime);
    if (newReminder) assertReminder(e.reminderDate, e.reminderTime);
    // ACT-1: the timeline is the server's own record — a request can't write or
    // back-date entries. An edit keeps the stored history; a new enquiry starts
    // with its "created" entry by the logged-in user.
    if (existingEnq) {
      e.timeline = [tl('edited', 'Enquiry Details Updated', 'The enquiry was edited.', actor), ...(Array.isArray(existingEnq.timeline) ? existingEnq.timeline : [])];
    } else {
      e.timeline = [tl('created', e.isNewItemRequest ? 'New Item Enquiry Created' : 'Customer Enquiry Created',
        `Requirement logged for ${e.quantity} ${e.unit || 'Units'} of ${e.itemName} at ${e.branchId}.`, actor)];
    }

    if (e.itemId) {
      const stockRow = await tx.branchStock.findUnique({ where: { itemId_branchId: { itemId: e.itemId, branchId: e.branchId } } });
      const availableQty = stockRow?.quantity ?? 0;
      if (availableQty < e.quantity && !e.pendingOrderId) {
        const orderNumber = await nextPendingOrderNumber(tx);
        const poId = `po-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
        await tx.pendingOrder.create({
          data: {
            id: poId, orderNumber, enquiryId: e.id, enquiryNumber: e.enquiryNumber, itemId: e.itemId,
            itemName: e.itemName, itemCode: e.itemCode ?? null, unit: e.unit, branchId: e.branchId,
            customerName: e.customerName, customerPhone: e.customerPhone ?? null, quantityNeeded: e.quantity,
            expectedRestockDate: initialExpectedRestockDate || null, status: 'Waiting', createdAt: nowIso(), updatedAt: nowIso(),
          },
        });
        e.hasPendingOrder = true;
        e.pendingOrderId = poId;
        e.timeline = [tl('status_change', 'Linked Pending Order Created', `Logged backlog order ${orderNumber} due to inventory shortage at ${e.branchId}.`, 'System'), ...e.timeline];
      }
    }

    if (newReminder) {
      await tx.followUpReminder.deleteMany({ where: { enquiryId: e.id, isCompleted: false } });
      await tx.followUpReminder.create({
        data: {
          id: rid('rem'), enquiryId: e.id, enquiryNumber: e.enquiryNumber, customerName: e.customerName,
          customerPhone: e.customerPhone ?? null, itemName: e.itemName, branchId: e.branchId,
          dueDate: e.reminderDate, dueTime: e.reminderTime, notes: e.reminderNotes ?? null, isCompleted: false, createdAt: nowIso(),
        },
      });
      e.timeline = [tl('reminder_set', 'Follow-up Reminder Set', `Reminder scheduled for ${e.reminderDate} at ${e.reminderTime}.`, actor), ...e.timeline];
    }

    const { id, ...rest } = e;
    await tx.enquiry.upsert({ where: { id }, create: e, update: rest });
    return snap(tx);
  });
}

export function linkItemToEnquiry(enquiryId: string, itemInput: any, actor: string, reqUser?: any) {
  return prisma.$transaction(async (tx: any) => {
    const enq = await tx.enquiry.findUnique({ where: { id: enquiryId } });
    if (!enq) throw new AppError('NOT_FOUND', 'Enquiry not found', 404);
    assertBranchAllowed(reqUser, enq.branchId); // SEC2-1
    // CRM3-3: an enquiry is linked to a catalogue item once. Linking again used to
    // create a second pending order for the same request.
    if (enq.status !== 'Follow-up') throw new AppError('ENQUIRY_CLOSED', `This enquiry is already ${enq.status}.`, 409);
    if (enq.itemId || enq.pendingOrderId) throw new AppError('ALREADY_LINKED', 'This enquiry is already linked to a catalogue item.', 409);
    // Prefer the stored catalogue row. The screen creates the item and links it
    // in two back-to-back requests, so the row may not be committed yet — then
    // accept the client's description, but only a well-formed one.
    if (!itemInput || typeof itemInput.id !== 'string' || !itemInput.id.trim()) {
      throw new AppError('ITEM_REQUIRED', 'Choose the catalogue item to link.', 400);
    }
    const stored = await tx.item.findUnique({ where: { id: itemInput.id } });
    const item = stored ?? itemInput;
    if (typeof item.itemName !== 'string' || !item.itemName.trim()) throw new AppError('ITEM_REQUIRED', 'Item name is required.', 400);
    const unit = typeof itemInput.unit === 'string' && itemInput.unit.trim() ? itemInput.unit.trim() : String(item.unit || 'PCS');
    const itemCode = typeof item.itemCode === 'string' ? item.itemCode : null;
    const orderNumber = await nextPendingOrderNumber(tx);
    const poId = `po-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    await tx.pendingOrder.create({
      data: {
        id: poId, orderNumber, enquiryId: enq.id, enquiryNumber: enq.enquiryNumber, itemId: String(item.id),
        itemName: item.itemName, itemCode, unit, branchId: enq.branchId,
        customerName: enq.customerName, customerPhone: enq.customerPhone ?? null, quantityNeeded: enq.quantity,
        status: 'Waiting', createdAt: nowIso(), updatedAt: nowIso(),
      },
    });
    const timeline = [
      tl('status_change', 'Linked Pending Order Created', `Logged backlog order ${orderNumber} due to 0 catalog stock at ${enq.branchId}.`, 'System'),
      tl('status_change', 'Item Added to Master Catalog', `Added "${item.itemName}" (${item.itemCode}) to master catalog and linked to this enquiry.`, actor),
      ...((enq.timeline as any[]) || []),
    ];
    await tx.enquiry.update({
      where: { id: enquiryId },
      data: { itemId: String(item.id), itemName: item.itemName, itemCode, unit, hasPendingOrder: true, pendingOrderId: poId, timeline, updatedAt: nowIso() },
    });
    return snap(tx);
  });
}

/** Pending-order fields editable through /enquiry/pending/update. The advance is
 *  NOT one of them: it is real money, taken only through POST /api/payments/advance
 *  (a receipt kept as store credit), never typed onto the order. */
const PENDING_EDITABLE = ['status', 'expectedRestockDate', 'notes'];
const ADVANCE_FIELDS = ['advanceAmount', 'advanceMode', 'advancePaidAt'];

export function updatePendingOrder(orderId: string, updates: any, reqUser?: any) {
  return prisma.$transaction(async (tx: any) => {
    const order = await tx.pendingOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new AppError('NOT_FOUND', 'Pending order not found', 404);
    assertBranchAllowed(reqUser, order.branchId); // SEC2-1
    // CRM2-9 / CRM8-6 / PLT7-1: an allow-list, not a deny-list. Only the restock
    // date and notes are editable here (plus Waiting <-> Stock
    // Arrived); the number, quantity, branch and fulfilment are server-owned. An
    // unknown field used to reach Prisma and come back as a 500.
    const u = updates && typeof updates === 'object' ? updates : {};
    if (ADVANCE_FIELDS.some((k) => u[k] !== undefined)) {
      throw new AppError('USE_ADVANCE_RECEIPT', 'An advance is recorded as a receipt (Record Advance), not edited on the order.', 400);
    }
    const unknown = Object.keys(u).filter((k) => !PENDING_EDITABLE.includes(k) && u[k] !== undefined);
    if (unknown.length) throw new AppError('FIELD_NOT_EDITABLE', `These fields can't be changed here: ${unknown.join(', ')}.`, 400);
    if (!OPEN_ORDER.includes(order.status)) {
      throw new AppError('ORDER_CLOSED', `This pending order is ${order.status} and can no longer be changed.`, 409); // CRM-12
    }
    const rest: any = {};
    if (u.status !== undefined) {
      if (!OPEN_ORDER.includes(u.status)) {
        // 'Fulfilled' happens by billing/converting the order; 'Cancelled' has its
        // own endpoint — neither may be set through this generic update.
        throw new AppError('BAD_STATUS', "A pending order can only be moved between 'Waiting' and 'Stock Arrived' here. Use Convert to fulfil it, or Cancel.", 400);
      }
      rest.status = u.status;
    }
    if (u.expectedRestockDate !== undefined) {
      if (u.expectedRestockDate !== null && u.expectedRestockDate !== '' && !isDate(u.expectedRestockDate)) {
        throw new AppError('BAD_DATE', 'Expected restock date must be a valid date (YYYY-MM-DD).', 400);
      }
      rest.expectedRestockDate = u.expectedRestockDate || null;
    }
    if (u.notes !== undefined) {
      if (u.notes !== null && typeof u.notes !== 'string') throw new AppError('BAD_REQUEST', 'Notes must be text.', 400);
      rest.notes = u.notes;
    }
    await tx.pendingOrder.updateMany({ where: { id: orderId }, data: { ...rest, updatedAt: nowIso() } });
    return snap(tx);
  });
}

/** Cancel an enquiry inside a transaction: its open pending orders and reminders close too. */
async function cancelInTx(tx: any, enq: any, reason: string, actor: string) {
  const timeline = [tl('cancelled', 'Enquiry Cancelled', `Reason: ${reason}`, actor), ...((enq.timeline as any[]) || [])];
  await tx.enquiry.update({ where: { id: enq.id }, data: { status: 'Cancelled', cancellationReason: reason, timeline, updatedAt: nowIso() } });
  // Only OPEN orders are cancelled — a Fulfilled order stays Fulfilled.
  await tx.pendingOrder.updateMany({ where: { enquiryId: enq.id, status: { in: OPEN_ORDER } }, data: { status: 'Cancelled', cancellationReason: reason, updatedAt: nowIso() } });
  await closeReminders(tx, enq.id); // CRM-9: closed on the server, not just on screen
  return snap(tx);
}

export function cancelEnquiry(enquiryId: string, reason: string, actor: string, reqUser?: any) {
  return prisma.$transaction(async (tx: any) => {
    const enq = await tx.enquiry.findUnique({ where: { id: enquiryId } });
    if (!enq) throw new AppError('NOT_FOUND', 'Enquiry not found', 404);
    assertBranchAllowed(reqUser, enq.branchId); // SEC2-1
    if (enq.status === 'Converted') throw new AppError('ENQUIRY_CONVERTED', 'This enquiry was already converted and cannot be cancelled.', 409);
    return cancelInTx(tx, enq, String(reason || '').trim() || 'Cancelled', actor);
  });
}

export function cancelPendingOrder(orderId: string, reason: string, reqUser?: any) {
  return prisma.$transaction(async (tx: any) => {
    const order = await tx.pendingOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new AppError('NOT_FOUND', 'Pending order not found', 404);
    assertBranchAllowed(reqUser, order.branchId); // SEC2-1
    if (!OPEN_ORDER.includes(order.status)) throw new AppError('ORDER_CLOSED', `This pending order is already ${order.status}.`, 409);
    await tx.pendingOrder.updateMany({ where: { id: orderId }, data: { status: 'Cancelled', cancellationReason: reason, updatedAt: nowIso() } });
    return snap(tx);
  });
}

export function addReminder(enquiryId: string, dueDate: string, dueTime: string, notes: string | undefined, actor: string, reqUser?: any) {
  return prisma.$transaction(async (tx: any) => {
    const enq = await tx.enquiry.findUnique({ where: { id: enquiryId } });
    if (!enq) throw new AppError('NOT_FOUND', 'Enquiry not found', 404);
    assertBranchAllowed(reqUser, enq.branchId); // SEC2-1
    assertReminder(dueDate, dueTime); // CRM-9: no 2020-01-01 / "99:99"
    if (enq.status !== 'Follow-up') throw new AppError('ENQUIRY_CLOSED', `This enquiry is ${enq.status}; it has no follow-ups.`, 409);
    // Replace any active (incomplete) reminder for this enquiry
    await tx.followUpReminder.deleteMany({ where: { enquiryId, isCompleted: false } });
    await tx.followUpReminder.create({
      data: {
        id: rid('rem'), enquiryId: enq.id, enquiryNumber: enq.enquiryNumber, customerName: enq.customerName,
        customerPhone: enq.customerPhone ?? null, itemName: enq.itemName, branchId: enq.branchId,
        dueDate, dueTime, notes: notes ?? null, isCompleted: false, createdAt: nowIso(),
      },
    });
    const timeline = [tl('reminder_set', 'Follow-up Reminder Scheduled', `Reminder set for ${dueDate} at ${dueTime}${notes ? ` — "${notes}"` : ''}`, actor), ...((enq.timeline as any[]) || [])];
    await tx.enquiry.update({ where: { id: enquiryId }, data: { status: 'Follow-up', reminderDate: dueDate, reminderTime: dueTime, reminderNotes: notes ?? null, timeline, updatedAt: nowIso() } });
    return snap(tx);
  });
}

export function completeReminder(reminderId: string, reqUser?: any) {
  return prisma.$transaction(async (tx: any) => {
    const rem = await tx.followUpReminder.findUnique({ where: { id: reminderId } });
    if (!rem) throw new AppError('NOT_FOUND', 'Reminder not found', 404);
    assertBranchAllowed(reqUser, rem.branchId); // SEC2-1
    await tx.followUpReminder.updateMany({ where: { id: reminderId }, data: { isCompleted: true, completedAt: nowIso() } });
    // CRM-9: the enquiry's "Next Reminder" was this one — clear it once done.
    await tx.enquiry.updateMany({
      where: { id: rem.enquiryId, reminderDate: rem.dueDate, reminderTime: rem.dueTime },
      data: { reminderDate: null, reminderTime: null, reminderNotes: null, updatedAt: nowIso() },
    });
    return snap(tx);
  });
}

export function deleteReminder(reminderId: string, reqUser?: any) {
  return prisma.$transaction(async (tx: any) => {
    const rem = await tx.followUpReminder.findUnique({ where: { id: reminderId } });
    if (!rem) throw new AppError('NOT_FOUND', 'Reminder not found', 404);
    assertBranchAllowed(reqUser, rem.branchId); // SEC2-1
    await tx.followUpReminder.deleteMany({ where: { id: reminderId } });
    return snap(tx);
  });
}

export function updateNotes(enquiryId: string, notes: string, actor: string, reqUser?: any) {
  return prisma.$transaction(async (tx: any) => {
    const enq = await tx.enquiry.findUnique({ where: { id: enquiryId } });
    if (!enq) throw new AppError('NOT_FOUND', 'Enquiry not found', 404);
    assertBranchAllowed(reqUser, enq.branchId); // SEC2-1
    const timeline = [tl('note_updated', 'Notes Updated', notes, actor), ...((enq.timeline as any[]) || [])];
    await tx.enquiry.update({ where: { id: enquiryId }, data: { notes, timeline, updatedAt: nowIso() } });
    return snap(tx);
  });
}

export function updateStatus(enquiryId: string, status: string, reason: string | undefined, actor: string, reqUser?: any) {
  return prisma.$transaction(async (tx: any) => {
    const enq = await tx.enquiry.findUnique({ where: { id: enquiryId } });
    if (!enq) throw new AppError('NOT_FOUND', 'Enquiry not found', 404);
    assertBranchAllowed(reqUser, enq.branchId); // SEC2-1
    // CRM2-9: only real statuses ("Banana" was stored). 'Converted' is set by
    // convert, with a real document, and a converted enquiry is final.
    if (status !== 'Follow-up' && status !== 'Cancelled') {
      throw new AppError('BAD_STATUS', "Status must be 'Follow-up' or 'Cancelled'. Convert the enquiry to bill it.", 400);
    }
    if (enq.status === 'Converted') throw new AppError('ENQUIRY_CONVERTED', 'This enquiry was already converted.', 409);
    if (status === 'Cancelled') return cancelInTx(tx, enq, String(reason || '').trim() || 'Cancelled', actor);
    const timeline = [tl('status_change', `Status Changed to ${status}`, reason || `Status set to ${status}`, actor), ...((enq.timeline as any[]) || [])];
    await tx.enquiry.update({
      where: { id: enquiryId },
      data: { status, cancellationReason: null, timeline, updatedAt: nowIso() },
    });
    return snap(tx);
  });
}

/**
 * Mark an enquiry Converted and its open pending orders Fulfilled — called once
 * the quotation / invoice has actually been SAVED. It used to run when the form
 * was merely opened, so leaving the form (or "+ Bill" without billing) closed
 * the enquiry and fulfilled the order with a fake document link (CRM-2 /
 * PLT7-1). The document must exist, belong to the enquiry's branch and not have
 * been made from another enquiry; an enquiry converts once (CRM2-9).
 */
export function convertEnquiry(enquiryId: string, targetType: string, docId: string, _docNumber: string, actor: string, reqUser?: any) {
  if (targetType !== 'estimate' && targetType !== 'invoice') throw new AppError('BAD_TARGET', "Convert to 'estimate' or 'invoice'.", 400);
  const cap = targetType === 'invoice' ? 'sales:write' : 'estimate:write';
  if (reqUser && !roleCan(reqUser.role, cap)) throw new AppError('FORBIDDEN', `Role ${reqUser.role} cannot create a ${targetType === 'invoice' ? 'bill' : 'quotation'}.`, 403);
  if (typeof docId !== 'string' || !docId.trim()) throw new AppError('DOC_REQUIRED', 'Save the bill or quotation first.', 400);
  return prisma.$transaction(async (tx: any) => {
    const enq = await tx.enquiry.findUnique({ where: { id: enquiryId } });
    if (!enq) throw new AppError('NOT_FOUND', 'Enquiry not found', 404);
    assertBranchAllowed(reqUser, enq.branchId); // SEC2-1
    if (enq.status === 'Converted') throw new AppError('ALREADY_CONVERTED', `This enquiry was already converted to #${(enq.convertedTo as any)?.number ?? ''}.`, 409);
    if (enq.status === 'Cancelled') throw new AppError('ENQUIRY_CANCELLED', 'A cancelled enquiry cannot be converted.', 409);
    const doc = targetType === 'invoice'
      ? await tx.invoice.findUnique({ where: { id: docId } })
      : await tx.estimate.findUnique({ where: { id: docId } });
    if (!doc || doc.isVoided) throw new AppError('DOC_NOT_FOUND', 'That bill / quotation does not exist. Save it first.', 400);
    if (doc.branchId !== enq.branchId) throw new AppError('DOC_MISMATCH', 'That document belongs to another branch.', 400);
    if (doc.sourceEnquiryId && doc.sourceEnquiryId !== enq.id) throw new AppError('DOC_MISMATCH', 'That document was made from a different enquiry.', 400);
    // CRM9-10 / CRM10-6: the document must be for the enquiry's customer — same
    // phone; a document that names this enquiry as its source (a link the
    // browser sets) may instead carry no phone and the enquiry's customer name.
    {
      const docPhone = cleanPhone(targetType === 'invoice' ? doc.customerPhone : doc.customerContact);
      const norm = (n: unknown) => String(n || '').toLowerCase().replace(/[.\s]+/g, ' ').trim();
      const samePhone = !!docPhone && docPhone === cleanPhone(enq.customerPhone);
      const sameNameFromEnquiry = doc.sourceEnquiryId === enq.id && !docPhone && !!norm(doc.customerName) && norm(doc.customerName) === norm(enq.customerName);
      if (!samePhone && !sameNameFromEnquiry) {
        throw new AppError('DOC_MISMATCH', doc.sourceEnquiryId ? "That document is not for the enquiry's customer." : "That document was not made from this enquiry and is not for the enquiry's customer.", 400);
      }
    }
    // CRM9-10: one document converts one enquiry.
    const others = await tx.enquiry.findMany({ where: { status: 'Converted', NOT: { id: enq.id } }, select: { enquiryNumber: true, convertedTo: true } });
    const sharing = others.find((o: any) => (o.convertedTo as any)?.id === doc.id);
    if (sharing) throw new AppError('DOC_MISMATCH', `That document already closed enquiry ${sharing.enquiryNumber}.`, 409);
    const docNumber = targetType === 'invoice' ? doc.invoiceNumber : doc.estimateNumber;
    const timeline = [tl('converted', `Converted to ${targetType === 'estimate' ? 'Quotation / Estimate' : 'Sales Invoice'}`, `Generated document #${docNumber}.`, actor), ...((enq.timeline as any[]) || [])];
    await tx.enquiry.update({
      where: { id: enquiryId },
      data: { status: 'Converted', convertedTo: { type: targetType, id: doc.id, number: docNumber, convertedAt: nowIso() }, timeline, updatedAt: nowIso() },
    });
    // Only OPEN pending orders (Waiting / Stock Arrived) become Fulfilled — a
    // Cancelled order must stay Cancelled, not be revived as Fulfilled (CRM-11).
    await tx.pendingOrder.updateMany({
      where: { enquiryId, status: { in: OPEN_ORDER } },
      data: { status: 'Fulfilled', fulfilledAt: nowIso(), convertedTo: { type: targetType, id: doc.id, number: docNumber }, updatedAt: nowIso() },
    });
    await closeReminders(tx, enquiryId); // CRM-9
    return snap(tx);
  });
}
