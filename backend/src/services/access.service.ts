import { prisma } from '../db.js';
import {
  AccessMatrix, buildDefaultMatrix, setLiveMatrix, getLiveMatrix,
  ALL_VIEWS, ALL_CAPS, ALL_FLAGS, Role, Capability,
} from '../lib/auth.js';

const CONFIG_KEY = 'accessMatrix';
const MIGRATIONS_KEY = 'accessMatrixMigrations';

/**
 * One-time, tracked, ADDITIVE migrations for the stored access matrix. When a
 * new view/capability ships, existing DB matrices (seeded before it existed)
 * won't contain it, so roles never gain it. Each migration is applied exactly
 * once (tracked in AppConfig) and only ADDS the specifically-intended grant —
 * it never re-adds on later restarts, so a CEO's deliberate removal sticks.
 */
const MATRIX_MIGRATIONS: { id: string; apply: (m: AccessMatrix) => void }[] = [
  {
    // Parties directory shipped after initial matrix seed — grant it to the
    // roles whose defaults include it (Manager, Billing, Purchase). CEO always
    // has everything already.
    id: '2026-09-parties-view',
    apply: (m) => {
      for (const role of ['Manager', 'Billing', 'Purchase'] as Role[]) {
        if (m[role] && !m[role].views.includes('parties')) {
          m[role].views.push('parties');
        }
      }
    },
  },
];

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

/**
 * Apply any pending additive matrix migrations exactly once. Call at startup
 * AFTER ensureAccessMatrix so the row exists.
 */
export async function migrateAccessMatrix(): Promise<AccessMatrix> {
  const markerRow = await prisma.appConfig.findUnique({ where: { key: MIGRATIONS_KEY } });
  const applied: string[] = Array.isArray(markerRow?.value) ? (markerRow!.value as string[]) : [];
  const pending = MATRIX_MIGRATIONS.filter((mig) => !applied.includes(mig.id));
  if (pending.length === 0) return getLiveMatrix();

  const row = await prisma.appConfig.findUnique({ where: { key: CONFIG_KEY } });
  const matrix = (row?.value as AccessMatrix) || buildDefaultMatrix();
  for (const mig of pending) mig.apply(matrix);

  const newApplied = [...applied, ...pending.map((p) => p.id)];
  await prisma.$transaction([
    prisma.appConfig.upsert({ where: { key: CONFIG_KEY }, create: { key: CONFIG_KEY, value: matrix as any }, update: { value: matrix as any } }),
    prisma.appConfig.upsert({ where: { key: MIGRATIONS_KEY }, create: { key: MIGRATIONS_KEY, value: newApplied as any }, update: { value: newApplied as any } }),
  ]);
  setLiveMatrix(matrix);
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
    const flags = (incoming.flags || []).filter((f) => ALL_FLAGS.includes(f));
    clean[role] = { views, caps, flags };
  }
  // CEO always retains everything (cannot be locked out).
  clean.CEO = { views: [...ALL_VIEWS], caps: [...ALL_CAPS], flags: [...ALL_FLAGS] };

  await prisma.appConfig.upsert({
    where: { key: CONFIG_KEY },
    create: { key: CONFIG_KEY, value: clean as any },
    update: { value: clean as any },
  });
  setLiveMatrix(clean);
  return getLiveMatrix();
}

export const catalog = { ALL_VIEWS, ALL_CAPS, ALL_FLAGS };
