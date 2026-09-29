import { prisma } from '../db.js';
import { AppError } from '../middleware/errorHandler.js';
import { nowIso, rid } from '../lib/stockLedger.js';

/** List every courier partner (newest first). */
export async function listCouriers() {
  return prisma.courierPartner.findMany({ orderBy: { createdAt: 'desc' } });
}

/**
 * Create or update a courier partner. Validated: a name is required, weight /
 * delivery days can't be negative, and `states` is normalized to a string array.
 */
export async function saveCourier(data: any) {
  const name = (data?.name || '').trim();
  if (!name) throw new AppError('NAME_REQUIRED', 'Courier name is required', 400);

  const states = Array.isArray(data.states)
    ? data.states.map((s: any) => String(s).trim()).filter(Boolean)
    : [];
  const maxWeightKg = data.maxWeightKg != null && data.maxWeightKg !== '' ? Number(data.maxWeightKg) : null;
  const deliveryDays = data.deliveryDays != null && data.deliveryDays !== '' ? Math.trunc(Number(data.deliveryDays)) : null;
  if (maxWeightKg != null && (!Number.isFinite(maxWeightKg) || maxWeightKg < 0)) throw new AppError('BAD_WEIGHT', 'Max weight cannot be negative', 400);
  if (deliveryDays != null && (!Number.isInteger(deliveryDays) || deliveryDays < 0)) throw new AppError('BAD_DAYS', 'Delivery days cannot be negative', 400);

  const ts = nowIso();
  const fields = {
    name,
    phone: (data.phone || '').trim() || null,
    portalUrl: (data.portalUrl || '').trim() || null,
    states,
    supportsCod: data.supportsCod == null ? true : !!data.supportsCod,
    supportsPrepaid: data.supportsPrepaid == null ? true : !!data.supportsPrepaid,
    maxWeightKg,
    deliveryDays,
    active: data.active == null ? true : !!data.active,
    updatedAt: ts,
  };

  const existing = data.id ? await prisma.courierPartner.findUnique({ where: { id: data.id } }) : null;
  if (existing) {
    await prisma.courierPartner.update({ where: { id: existing.id }, data: fields });
  } else {
    await prisma.courierPartner.create({ data: { id: data.id || rid('courier'), createdAt: ts, ...fields } });
  }
  return { couriers: await listCouriers() };
}

export async function deleteCourier(id: string) {
  await prisma.courierPartner.deleteMany({ where: { id } });
  return { couriers: await listCouriers() };
}
