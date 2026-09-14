import { Request, Response } from 'express';
import * as invoiceService from '../services/invoice.service.js';
import { recordAudit } from '../services/audit.service.js';

const actorOf = (req: any) => (req.user ? `${req.user.name} [${req.user.role}]` : (req.body?.actor || 'unknown'));

export const createSale = async (req: Request, res: Response) => {
  const inv = req.body;
  const result: any = await invoiceService.createSale(inv);
  await recordAudit({
    actor: actorOf(req), action: 'sale.save', entity: 'invoice', entityId: result?.invoiceNumber || inv?.id,
    summary: `Sale ${inv?.customerName || ''} · ₹${inv?.grandTotal ?? ''}${inv?.salespersonName ? ` · incentive ${inv?.incentivePercent}% to ${inv.salespersonName}` : ''}`,
    after: inv,
  });
  res.json(result);
};

export const voidInvoice = async (req: Request, res: Response) => {
  const { invoiceId, reason, actor } = req.body;
  const result = await invoiceService.voidInvoice(invoiceId, reason, actor);
  await recordAudit({ actor: actorOf(req), action: 'sale.void', entity: 'invoice', entityId: invoiceId, summary: `Voided sale — ${reason || 'no reason'}` });
  res.json(result);
};

export const processReturn = async (req: Request, res: Response) => {
  const { invoiceId, returnLines, reason, notes, actor } = req.body;
  const result = await invoiceService.processReturn(invoiceId, returnLines, reason, notes, actor);
  const qty = Array.isArray(returnLines) ? returnLines.reduce((s: number, l: any) => s + (l.returnQty || 0), 0) : 0;
  await recordAudit({ actor: actorOf(req), action: 'sale.return', entity: 'invoice', entityId: invoiceId, summary: `Return ${qty} unit(s) — ${reason || 'no reason'}${notes ? ` (${notes})` : ''}` });
  res.json(result);
};

export const deleteInvoice = async (req: Request, res: Response) => {
  const result = await invoiceService.deleteInvoice(req.params.id);
  await recordAudit({ actor: actorOf(req), action: 'sale.delete', entity: 'invoice', entityId: req.params.id, summary: 'Deleted invoice' });
  res.json(result);
};
