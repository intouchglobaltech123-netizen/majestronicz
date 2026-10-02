import { Request, Response } from 'express';
import * as purchase from '../services/purchase.service.js';
import { recordAudit } from '../services/audit.service.js';
import { prisma } from '../db.js';

/** RPT3-1: vendor money leaving a branch is on the audit trail. */
async function auditPoPayment(req: Request, poId: string, amount: unknown, mode: unknown, how: string) {
  const po = poId ? await prisma.purchaseOrder.findUnique({ where: { id: String(poId) }, select: { poNumber: true, vendorName: true, branchId: true } }) : null;
  const user = (req as any).user;
  await recordAudit({
    actor: user ? `${user.name} [${user.role}]` : actorOf(req), action: 'purchase.payment', entity: 'purchaseOrder', entityId: String(poId || ''),
    summary: `${how} ₹${Number(amount) || 0} (${mode || 'Cash'}) to ${po?.vendorName || 'vendor'} on ${po?.poNumber || 'PO'}`,
    branchId: po?.branchId ?? null,
  });
}

// The acting user comes from the authenticated token, not the request body, so a
// client can't stamp a false name onto a PO's history/payments (ACT-1). Falls back
// to the body only when there is no logged-in user (system/QA call without a token).
const actorOf = (req: Request): string =>
  ((req as any).user?.name as string | undefined)?.trim() || String((req.body as any)?.actor || 'System');

export const savePO = async (req: Request, res: Response) => {
  const { po } = req.body;
  res.json(await purchase.savePurchaseOrder(po, actorOf(req), (req as any).user));
};
export const deletePO = async (req: Request, res: Response) => {
  res.json(await purchase.deletePurchaseOrder(req.params.id, (req as any).user));
};
export const cancelPO = async (req: Request, res: Response) => {
  res.json(await purchase.cancelPurchaseOrder(req.params.id, (req as any).user));
};
export const receive = async (req: Request, res: Response) => {
  const { poId, receipts, notes, payment, otherCharges } = req.body;
  const result = await purchase.receivePurchaseOrderStock(poId, receipts, notes, payment, actorOf(req), otherCharges, (req as any).user);
  if (Number(payment?.amount) > 0) await auditPoPayment(req, poId, payment.amount, payment.mode, 'Paid at receipt');
  res.json(result);
};
export const addAttachment = async (req: Request, res: Response) => {
  const { poId, attachment } = req.body;
  res.json(await purchase.addAttachment(poId, attachment, actorOf(req), (req as any).user));
};
export const deleteAttachment = async (req: Request, res: Response) => {
  const { poId, attachmentId } = req.body;
  res.json(await purchase.deleteAttachment(poId, attachmentId, (req as any).user));
};
export const recordPayment = async (req: Request, res: Response) => {
  const { poId, amount, mode } = req.body;
  const result = await purchase.recordPurchaseOrderPayment(poId, amount, mode, actorOf(req), (req as any).user);
  await auditPoPayment(req, poId, amount, mode, 'Paid');
  res.json(result);
};
export const recordBill = async (req: Request, res: Response) => {
  const { poId, bill } = req.body;
  res.json(await purchase.recordPurchaseBill(poId, bill, (req as any).user));
};
export const deleteBill = async (req: Request, res: Response) => {
  const { poId, billId } = req.body;
  res.json(await purchase.deletePurchaseBill(String(poId || ''), String(billId || ''), (req as any).user));
};
