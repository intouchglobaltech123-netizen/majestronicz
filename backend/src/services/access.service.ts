import { prisma } from '../db.js';
import {
  AccessMatrix, buildDefaultMatrix, setLiveMatrix, getLiveMatrix,
  ALL_VIEWS, ALL_CAPS, Role, Capability,
} from '../lib/auth.js';

const CONFIG_KEY = 'accessMatrix';

/** Load the matrix from AppConfig into the in-memory cache (called at startup). */
export async function loadAccessMatrix(): Promise<AccessMatrix> {
  const row = await prisma.appConfig.findUnique({ where: { key: CONFIG_KEY } });
  const matrix = (row?.value as AccessMatrix) || buildDefaultMatrix();
  setLiveMatrix(matrix);
  return getLiveMatrix();
}

/** Ensure the matrix config row exists (seed default if missing). */
export async function ensureAccessMatrix(): Promise<AccessMatrix> {
  const row = await prisma.appConfig.findUnique({ where: { key: CONFIG_KEY } });
  if (!row) {
    const def = buildDefaultMatrix();
    await prisma.appConfig.create({ data: { key: CONFIG_KEY, value: def as any } });
    setLiveMatrix(def);
    return def;
  }
  setLiveMatrix(row.value as AccessMatrix);
  return getLiveMatrix();
}

/** Sanitize + persist an updated matrix. CEO is always forced to full access. */
export async function updateAccessMatrix(input: AccessMatrix): Promise<AccessMatrix> {
  const roles = Object.keys(buildDefaultMatrix()) as Role[];
  const clean = {} as AccessMatrix;
  for (const role of roles) {
    const incoming = input?.[role] || { views: [], caps: [] };
    // Whitelist against known views/caps to prevent junk.
    const views = (incoming.views || []).filter((v) => ALL_VIEWS.includes(v));
    const caps = (incoming.caps || []).filter((c) => ALL_CAPS.includes(c as Capability)) as Capability[];
    clean[role] = { views, caps };
  }
  // CEO always retains everything (cannot be locked out).
  clean.CEO = { views: [...ALL_VIEWS], caps: [...ALL_CAPS] };

  await prisma.appConfig.upsert({
    where: { key: CONFIG_KEY },
    create: { key: CONFIG_KEY, value: clean as any },
    update: { value: clean as any },
  });
  setLiveMatrix(clean);
  return getLiveMatrix();
}

export const catalog = { ALL_VIEWS, ALL_CAPS };
