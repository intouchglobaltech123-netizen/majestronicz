/**
 * Make EVERY catalog item "price includes tax" (salePriceTaxMode = 'with'),
 * KEEPING the price number the same — so e.g. an Arduino shown at ₹269 "Pre-Tax"
 * becomes ₹269 "Incl. Tax" (the number on screen does not change; only the mode
 * flips, exactly like items already marked inclusive).
 *
 * Run against the Railway Postgres:
 *   DATABASE_URL="<railway url>" npx tsx scripts/set-items-tax-inclusive.ts            # dry run (counts only)
 *   DATABASE_URL="<railway url>" npx tsx scripts/set-items-tax-inclusive.ts --apply    # do it
 * or:  railway run npm run items:tax-inclusive -- --apply
 */
import { prisma } from '../src/db.js';

const APPLY = process.argv.includes('--apply');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('Refusing to run: DATABASE_URL is not set.');
    process.exit(2);
  }
  const total = await prisma.item.count();
  const toFix = await prisma.item.count({ where: { NOT: { salePriceTaxMode: 'with' } } });
  console.log(`\nItems: ${total} · currently NOT inclusive-of-tax: ${toFix}`);

  if (!APPLY) {
    console.log('\nDRY RUN — nothing changed. Re-run with --apply to set them all to "price includes tax".\n');
    await prisma.$disconnect();
    return;
  }
  const res = await prisma.item.updateMany({
    where: { NOT: { salePriceTaxMode: 'with' } },
    data: { salePriceTaxMode: 'with', updatedAt: new Date().toISOString() },
  });
  const left = await prisma.item.count({ where: { NOT: { salePriceTaxMode: 'with' } } });
  console.log(`\nUpdated ${res.count} item(s) to inclusive-of-tax. Remaining non-inclusive: ${left}.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('\nset-items-tax-inclusive FAILED:', e?.message || e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
