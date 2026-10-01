import { Request, Response } from 'express';
import * as purchase from '../services/purchase.service.js';

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
  res.json(await purchase.receivePurchaseOrderStock(poId, receipts, notes, payment, actorOf(req), otherCharges, (req as any).user));
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
  res.json(await purchase.recordPurchaseOrderPayment(poId, amount, mode, actorOf(req), (req as any).user));
};
export const recordBill = async (req: Request, res: Response) => {
  const { poId, bill } = req.body;
  res.json(await purchase.recordPurchaseBill(poId, bill, (req as any).user));
};
