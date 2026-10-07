/**
 * ONE-TIME GO-LIVE: clear every piece of demo/old business data from the
 * database but KEEP all staff logins (the User table), then load ONLY the real
 * item catalog (backend/src/data/importedCatalog.ts, from the client's Vyapar
 * export) with opening stock at one branch.
 *
 * Run it straight against the Railway Postgres (no app, no button):
 *
 *   # dry run (default) — prints what is there now and what WILL be done, changes nothing:
 *   DATABASE_URL="<railway postgres url>" npx tsx scripts/reset-to-catalog.ts
 *
 *   # actually do it (irreversible — take a DB backup first):
 *   DATABASE_URL="<railway postgres url>" npx tsx scripts/reset-to-catalog.ts --apply --i-have-a-backup
 *
 * On Railway you can also let the CLI inject the service's DATABASE_URL:
 *   railway run npx tsx scripts/reset-to-catalog.ts --apply --i-have-a-backup
 *
 * Options:
 *   --apply              perform the wipe + import (otherwise dry run)
 *   --i-have-a-backup    required together with --apply (forces a conscious backup)
 *   --branch <id>        branch for opening stock (default erode-hq; or set CATALOG_BRANCH)
 */
import { prisma } from '../src/db.js';
import { resetToCatalog } from '../src/services/reseed.service.js';
import { IMPORTED_CATALOG } from '../src/data/importedCatalog.js';

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const APPLY = has('--apply');
const HAVE_BACKUP = has('--i-have-a-backup');
const branchArg = (() => {
  const i = argv.indexOf('--branch');
  return i >= 0 ? argv[i + 1] : undefined;
})();
if (branchArg) process.env.CATALOG_BRANCH = branchArg;
const branchId = process.env.CATALOG_BRANCH || 'erode-hq';

async function counts() {
  const [users, items, branchStock, invoices, customers, payments, vendors, pendingOrders, employees, estimates, purchaseOrders] = await Promise.all([
    prisma.user.count(), prisma.item.count(), prisma.branchStock.count(), prisma.invoice.count(),
    prisma.customer.count(), prisma.payment.count(), prisma.vendor.count(), prisma.pendingOrder.count(),
    prisma.employee.count(), prisma.estimate.count(), prisma.purchaseOrder.count(),
  ]);
  return { users, items, branchStock, invoices, customers, payments, vendors, pendingOrders, employees, estimates, purchaseOrders };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('Refusing to run: DATABASE_URL is not set. Pass the target database explicitly.');
    process.exit(2);
  }
  const dbHost = process.env.DATABASE_URL.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
  console.log(`\nTarget database: ${dbHost}`);

  const before = await counts();
  console.log('\nData in the database NOW:');
  console.table(before);

  console.log(`\nThis will DELETE everything above EXCEPT the ${before.users} login(s), then load ${IMPORTED_CATALOG.length} catalog items with opening stock at "${branchId}".`);

  if (!APPLY) {
    console.log('\nDRY RUN — nothing was changed. Re-run with  --apply --i-have-a-backup  to do it.\n');
    await prisma.$disconnect();
    return;
  }
  if (!HAVE_BACKUP) {
    console.error('\nRefusing --apply without --i-have-a-backup. Take a database backup first, then pass both flags.\n');
    await prisma.$disconnect();
    process.exit(2);
  }

  console.log('\nApplying…');
  const result = await resetToCatalog();
  const after = await counts();
  console.log('\nDone. Data in the database AFTER:');
  console.table(after);
  console.log(`\nLoaded ${result.items} items with opening stock at "${result.branchId}". Logins kept: ${after.users}.`);
  if (after.invoices || after.customers || after.payments || after.vendors || after.pendingOrders) {
    console.warn('WARNING: some business tables are not empty — review the output above.');
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('\nreset-to-catalog FAILED:', e?.message || e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
