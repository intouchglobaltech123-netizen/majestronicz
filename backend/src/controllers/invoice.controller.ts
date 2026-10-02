import { Request, Response } from 'express';
import * as invoiceService from '../services/invoice.service.js';
import { recordAudit } from '../services/audit.service.js';

const actorOf = (req: any) => (req.user ? `${req.user.name} [${req.user.role}]` : (req.body?.actor || 'unknown'));
// The acting user's NAME for history stamps (voidedBy/processedBy), taken from the
// token not the body so a client can't attribute the action to someone else (ACT-1).
const actorName = (req: any): string => (req.user?.name as string | undefined)?.trim() || String(req.body?.actor || 'System');
/** SAL10-1: the live-update event names the rows this write changed. */
const withChanges = (res: Response, result: any) => {
  if (result?.changes) res.locals.changes = result.changes;
  return result;
};

export const createSale = async (req: Request, res: Response) => {
  const inv = req.body;
  const result: any = await invoiceService.createSale(inv, (req as any).user);
  await recordAudit({
    actor: actorOf(req), action: 'sale.save', entity: 'invoice', entityId: result?.invoiceNumber || inv?.id,
    summary: `Sale ${inv?.customerName || ''} · ₹${inv?.grandTotal ?? ''}${inv?.salespersonName ? ` · incentive ${inv?.incentivePercent}% to ${inv.salespersonName}` : ''}`,
    after: inv,
  });
  res.json(withChanges(res, result));
};

export const voidInvoice = async (req: Request, res: Response) => {
  const { invoiceId, reason } = req.body;
  const result = await invoiceService.voidInvoice(invoiceId, reason, actorName(req), (req as any).user);
  await recordAudit({ actor: actorOf(req), action: 'sale.void', entity: 'invoice', entityId: invoiceId, summary: `Voided sale — ${reason || 'no reason'}` });
  res.json(withChanges(res, result));
};

export const processReturn = async (req: Request, res: Response) => {
  const { invoiceId, returnLines, reason, notes, refundMode } = req.body;
  const result = await invoiceService.processReturn(invoiceId, returnLines, reason, notes, actorName(req), (req as any).user, refundMode);
  const qty = Array.isArray(returnLines) ? returnLines.reduce((s: number, l: any) => s + (Number(l?.returnQty) || 0), 0) : 0;
  // The audit row names the bill and what was paid back (cash refund, credit
  // note or due reduced), not just a unit count.
  const bill: any = (result as any)?.invoices?.find((i: any) => i.id === invoiceId);
  const rs: any = (result as any)?.returnSummary || {};
  const money = rs.cashRefund > 0 ? `refund ₹${rs.cashRefund} (${rs.refundMode})` : rs.creditIssued > 0 ? `credit note ₹${rs.creditIssued}` : 'no refund';
  await recordAudit({
    actor: actorOf(req), action: 'sale.return', entity: 'invoice', entityId: invoiceId, branchId: bill?.branchId ?? null,
    summary: `Return on ${bill?.invoiceNumber || invoiceId} · ${qty} unit(s) · value ₹${rs.value ?? ''} · ${money}${rs.dueReduced > 0 ? ` · due reduced ₹${rs.dueReduced}` : ''}${rs.damaged ? ' · damaged' : ''} — ${reason || 'no reason'}${notes ? ` (${notes})` : ''}`,
  });
  res.json(withChanges(res, result));
};

export const deleteInvoice = async (req: Request, res: Response) => {
  const result: any = await invoiceService.deleteInvoice(req.params.id, (req as any).user);
  const d = result?.deleted;
  // SAL4-9: the audit row names the bill (number, amount, branch), not just its id.
  await recordAudit({
    actor: actorOf(req), action: 'sale.delete', entity: 'invoice', entityId: req.params.id,
    summary: d
      ? `Deleted ${d.wasVoided ? 'voided ' : ''}bill ${d.invoiceNumber} · ₹${d.grandTotal} · ${d.branchId} · ${d.date}${d.customerName ? ` · ${d.customerName}` : ''}`
      : 'Deleted invoice (not found)',
    before: d || undefined,
  });
  res.json(withChanges(res, result));
};

export const reverseReturn = async (req: Request, res: Response) => {
  const { invoiceId, returnId } = req.body || {};
  const result: any = await invoiceService.reverseReturn(invoiceId, returnId, actorName(req), (req as any).user);
  const r = result?.reversed;
  const money = r?.refund
    ? ` · refund ₹${r.refund.amount} ${r.refund.kind === 'deleted' ? `removed from ${r.refund.date}` : `collected back on ${r.refund.date}`}`
    : r?.creditTakenBack ? ` · credit note ₹${r.creditTakenBack} taken back` : '';
  await recordAudit({
    actor: actorOf(req), action: 'sale.return-reverse', entity: 'invoice', entityId: invoiceId,
    summary: `Reversed return on ${r?.invoiceNumber} (${r?.branchId}) · ${r?.units} unit(s) · ₹${r?.value}${r?.damaged ? ' · damaged (no stock change)' : ` · ${r?.stockOut} unit(s) back out of stock`}${money}`,
    after: r,
  });
  res.json(withChanges(res, result));
};
