import { Request, Response } from 'express';
import * as invoiceService from '../services/invoice.service.js';

export const createSale = async (req: Request, res: Response) => {
  res.json(await invoiceService.createSale(req.body));
};

export const voidInvoice = async (req: Request, res: Response) => {
  const { invoiceId, reason, actor } = req.body;
  res.json(await invoiceService.voidInvoice(invoiceId, reason, actor));
};

export const processReturn = async (req: Request, res: Response) => {
  const { invoiceId, returnLines, reason, notes, actor } = req.body;
  res.json(await invoiceService.processReturn(invoiceId, returnLines, reason, notes, actor));
};

export const deleteInvoice = async (req: Request, res: Response) => {
  res.json(await invoiceService.deleteInvoice(req.params.id));
};
