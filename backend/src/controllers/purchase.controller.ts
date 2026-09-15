import { Request, Response } from 'express';
import * as purchase from '../services/purchase.service.js';

export const savePO = async (req: Request, res: Response) => {
  const { po, actor } = req.body;
  res.json(await purchase.savePurchaseOrder(po, actor, (req as any).user));
};
export const deletePO = async (req: Request, res: Response) => {
  res.json(await purchase.deletePurchaseOrder(req.params.id));
};
export const cancelPO = async (req: Request, res: Response) => {
  res.json(await purchase.cancelPurchaseOrder(req.params.id));
};
export const receive = async (req: Request, res: Response) => {
  const { poId, receipts, notes, actor } = req.body;
  res.json(await purchase.receivePurchaseOrderStock(poId, receipts, notes, actor, (req as any).user));
};
export const addAttachment = async (req: Request, res: Response) => {
  const { poId, attachment, actor } = req.body;
  res.json(await purchase.addAttachment(poId, attachment, actor));
};
export const deleteAttachment = async (req: Request, res: Response) => {
  const { poId, attachmentId } = req.body;
  res.json(await purchase.deleteAttachment(poId, attachmentId));
};
