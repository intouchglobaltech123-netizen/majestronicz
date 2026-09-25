import { prisma } from '../db.js';
import { AppError } from '../middleware/errorHandler.js';
import { nowIso, rid } from '../lib/stockLedger.js';
import { nextPendingOrderNumber } from '../lib/sequences.js';

const snap = async (tx: any) => ({
  enquiries: await tx.enquiry.findMany(),
  pendingOrders: await tx.pendingOrder.findMany(),
  reminders: await tx.followUpReminder.findMany(),
});

const tl = (type: string, title: string, description: string, actor: string) => ({
  id: `tl-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
  timestamp: nowIso(), type, title, description, actor,
});

/** Save/edit an enquiry; auto-create a pending order on stock shortage; optional reminder. */
export function saveEnquiry(enquiry: any, initialExpectedRestockDate: string | undefined, actor: string) {
  return prisma.$transaction(async (tx: any) => {
    const e = { ...enquiry };
    if (!e.timeline || e.timeline.length === 0) {
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

    if (e.reminderDate && e.reminderTime) {
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

export function linkItemToEnquiry(enquiryId: string, item: any, actor: string) {
  return prisma.$transaction(async (tx: any) => {
    const enq = await tx.enquiry.findUnique({ where: { id: enquiryId } });
    if (!enq) throw new AppError('NOT_FOUND', 'Enquiry not found', 404);
    const orderNumber = await nextPendingOrderNumber(tx);
    const poId = `po-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    await tx.pendingOrder.create({
      data: {
        id: poId, orderNumber, enquiryId: enq.id, enquiryNumber: enq.enquiryNumber, itemId: item.id,
        itemName: item.itemName, itemCode: item.itemCode ?? null, unit: item.unit, branchId: enq.branchId,
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
      data: { itemId: item.id, itemName: item.itemName, itemCode: item.itemCode, unit: item.unit, hasPendingOrder: true, pendingOrderId: poId, timeline, updatedAt: nowIso() },
    });
    return snap(tx);
  });
}

export function updatePendingOrder(orderId: string, updates: any) {
  return prisma.$transaction(async (tx: any) => {
    await tx.pendingOrder.updateMany({ where: { id: orderId }, data: { ...updates, updatedAt: nowIso() } });
    return snap(tx);
  });
}

export function cancelEnquiry(enquiryId: string, reason: string, actor: string) {
  return prisma.$transaction(async (tx: any) => {
    const enq = await tx.enquiry.findUnique({ where: { id: enquiryId } });
    if (!enq) throw new AppError('NOT_FOUND', 'Enquiry not found', 404);
    const timeline = [tl('cancelled', 'Enquiry Cancelled', `Reason: ${reason}`, actor), ...((enq.timeline as any[]) || [])];
    await tx.enquiry.update({ where: { id: enquiryId }, data: { status: 'Cancelled', cancellationReason: reason, timeline, updatedAt: nowIso() } });
    await tx.pendingOrder.updateMany({ where: { enquiryId }, data: { status: 'Cancelled', cancellationReason: reason, updatedAt: nowIso() } });
    return snap(tx);
  });
}

export function cancelPendingOrder(orderId: string, reason: string) {
  return prisma.$transaction(async (tx: any) => {
    await tx.pendingOrder.updateMany({ where: { id: orderId }, data: { status: 'Cancelled', cancellationReason: reason, updatedAt: nowIso() } });
    return snap(tx);
  });
}

export function addReminder(enquiryId: string, dueDate: string, dueTime: string, notes: string | undefined, actor: string) {
  return prisma.$transaction(async (tx: any) => {
    const enq = await tx.enquiry.findUnique({ where: { id: enquiryId } });
    if (!enq) throw new AppError('NOT_FOUND', 'Enquiry not found', 404);
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

export function completeReminder(reminderId: string) {
  return prisma.$transaction(async (tx: any) => {
    await tx.followUpReminder.updateMany({ where: { id: reminderId }, data: { isCompleted: true, completedAt: nowIso() } });
    return snap(tx);
  });
}

export function deleteReminder(reminderId: string) {
  return prisma.$transaction(async (tx: any) => {
    await tx.followUpReminder.deleteMany({ where: { id: reminderId } });
    return snap(tx);
  });
}

export function updateNotes(enquiryId: string, notes: string, actor: string) {
  return prisma.$transaction(async (tx: any) => {
    const enq = await tx.enquiry.findUnique({ where: { id: enquiryId } });
    if (!enq) throw new AppError('NOT_FOUND', 'Enquiry not found', 404);
    const timeline = [tl('note_updated', 'Notes Updated', notes, actor), ...((enq.timeline as any[]) || [])];
    await tx.enquiry.update({ where: { id: enquiryId }, data: { notes, timeline, updatedAt: nowIso() } });
    return snap(tx);
  });
}

export function updateStatus(enquiryId: string, status: string, reason: string | undefined, actor: string) {
  return prisma.$transaction(async (tx: any) => {
    const enq = await tx.enquiry.findUnique({ where: { id: enquiryId } });
    if (!enq) throw new AppError('NOT_FOUND', 'Enquiry not found', 404);
    const timeline = [tl(status === 'Cancelled' ? 'cancelled' : 'status_change', `Status Changed to ${status}`, reason || `Status set to ${status}`, actor), ...((enq.timeline as any[]) || [])];
    await tx.enquiry.update({
      where: { id: enquiryId },
      data: { status, cancellationReason: status === 'Cancelled' ? reason : enq.cancellationReason, timeline, updatedAt: nowIso() },
    });
    return snap(tx);
  });
}

/** Mark enquiry Converted + linked pending orders Fulfilled. The estimate/invoice
 * pre-fill + navigation remains a client concern (UI-only), matching prior behavior. */
export function convertEnquiry(enquiryId: string, targetType: string, docId: string, docNumber: string, actor: string) {
  return prisma.$transaction(async (tx: any) => {
    const enq = await tx.enquiry.findUnique({ where: { id: enquiryId } });
    if (!enq) throw new AppError('NOT_FOUND', 'Enquiry not found', 404);
    const timeline = [tl('converted', `Converted to ${targetType === 'estimate' ? 'Quotation / Estimate' : 'Sales Invoice'}`, `Generated document #${docNumber}.`, actor), ...((enq.timeline as any[]) || [])];
    await tx.enquiry.update({
      where: { id: enquiryId },
      data: { status: 'Converted', convertedTo: { type: targetType, id: docId, number: docNumber, convertedAt: nowIso() }, timeline, updatedAt: nowIso() },
    });
    // Only OPEN pending orders (Waiting / Stock Arrived) become Fulfilled — a
    // Cancelled order must stay Cancelled, not be revived as Fulfilled (CRM-11).
    await tx.pendingOrder.updateMany({
      where: { enquiryId, status: { in: ['Waiting', 'Stock Arrived'] } },
      data: { status: 'Fulfilled', fulfilledAt: nowIso(), updatedAt: nowIso() },
    });
    return snap(tx);
  });
}
