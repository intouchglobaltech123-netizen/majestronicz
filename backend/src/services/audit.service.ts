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
      },
    });
  } catch (e) {
    console.error('audit record failed (non-fatal):', e);
  }
}

export async function listAudit(filter?: { entity?: string; entityId?: string; action?: string; limit?: number }) {
  const where: any = {};
  if (filter?.entity) where.entity = filter.entity;
  if (filter?.entityId) where.entityId = filter.entityId;
  if (filter?.action) where.action = filter.action;
  return prisma.auditLog.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: Math.min(Math.max(Number(filter?.limit) || 200, 1), 1000),
  });
}
