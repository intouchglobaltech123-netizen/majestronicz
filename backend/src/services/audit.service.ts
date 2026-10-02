import { prisma } from '../db.js';
import { nowIso } from '../lib/stockLedger.js';

/**
 * Append-only audit trail. recordAudit() is best-effort (never throws into the
 * caller) so an audit failure can't break a real operation. There is no update
 * or delete path — the log can only be read and appended to.
 */
export interface AuditInput {
  actor?: string;
  action: string;
  entity: string;
  entityId?: string | null;
  summary?: string;
  before?: unknown;
  after?: unknown;
  /** Branch the change belongs to (RPT3-1: a Manager reads only their branch). */
  branchId?: string | null;
}

// Trim large / noisy fields so the log stays lightweight and readable.
function slim(v: unknown): any {
  if (v == null) return undefined;
  try {
    const clone: any = JSON.parse(JSON.stringify(v));
    if (clone && typeof clone === 'object') {
      for (const k of ['attachments', 'items', 'paymentSplits', 'returns', 'receivingHistory', 'components', 'value']) {
        if (k in clone && (Array.isArray(clone[k]) ? clone[k].length > 0 : typeof clone[k] === 'object')) {
          clone[k] = Array.isArray(clone[k]) ? `[${clone[k].length} item(s)]` : '[object]';
        }
      }
      if ('pin' in clone) delete clone.pin; // never log secrets
    }
    return clone;
  } catch {
    return undefined;
  }
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: nowIso(),
        actor: input.actor || 'system',
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        summary: input.summary ?? null,
        before: (slim(input.before) as any) ?? undefined,
        after: (slim(input.after) as any) ?? undefined,
        branchId: input.branchId ?? null,
      },
    });
  } catch (e) {
    console.error('audit record failed (non-fatal):', e);
  }
}

/**
 * Read the trail, newest first. A branch-locked reader (a Manager) sees only
 * their branch's events (RPT3-1). Rows written before the trail carried a
 * branch are placed by what they point at — the bill, payment, purchase order
 * or pending order — and rows that belong to no branch (logins, staff
 * accounts, the access matrix) stay CEO-only.
 */
export async function listAudit(filter?: { entity?: string; entityId?: string; action?: string; limit?: number; branchId?: string | null }) {
  const where: any = {};
  if (filter?.entity) where.entity = filter.entity;
  if (filter?.entityId) where.entityId = filter.entityId;
  if (filter?.action) where.action = filter.action;
  const take = Math.min(Math.max(Number(filter?.limit) || 200, 1), 1000);
  const branch = filter?.branchId;
  if (!branch) return prisma.auditLog.findMany({ where, orderBy: { timestamp: 'desc' }, take });

  const rows = await prisma.auditLog.findMany({ where, orderBy: { timestamp: 'desc' }, take: Math.min(take * 5, 5000) });
  const legacy = rows.filter((r) => !r.branchId && r.entityId);
  const ids = (entity: string) => [...new Set(legacy.filter((r) => r.entity === entity).map((r) => String(r.entityId)))];
  const branchOf = new Map<string, string>();
  const invIds = ids('invoice');
  if (invIds.length) {
    for (const i of await prisma.invoice.findMany({ where: { OR: [{ id: { in: invIds } }, { invoiceNumber: { in: invIds } }] }, select: { id: true, invoiceNumber: true, branchId: true } })) {
      branchOf.set(`invoice:${i.id}`, i.branchId);
      branchOf.set(`invoice:${i.invoiceNumber}`, i.branchId);
    }
  }
  const payIds = ids('payment');
  if (payIds.length) {
    for (const p of await prisma.payment.findMany({ where: { id: { in: payIds } }, select: { id: true, branchId: true } })) branchOf.set(`payment:${p.id}`, p.branchId);
  }
  const poIds = ids('purchaseOrder');
  if (poIds.length) {
    for (const p of await prisma.purchaseOrder.findMany({ where: { id: { in: poIds } }, select: { id: true, branchId: true } })) branchOf.set(`purchaseOrder:${p.id}`, p.branchId);
  }
  const pendIds = ids('pendingOrder');
  if (pendIds.length) {
    for (const p of await prisma.pendingOrder.findMany({ where: { id: { in: pendIds } }, select: { id: true, branchId: true } })) branchOf.set(`pendingOrder:${p.id}`, p.branchId);
  }
  return rows
    .filter((r) => (r.branchId ?? branchOf.get(`${r.entity}:${r.entityId}`)) === branch)
    .slice(0, take);
}
