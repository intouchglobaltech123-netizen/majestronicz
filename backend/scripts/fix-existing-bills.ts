/**
 * One-time correction of bills, refunds, salaries, stock history and a few
 * master-data fields created by builds before this release (UPG8-1 / UPG8-2 /
 * UPG8-3 / UPG9-1..11 / CASH7-1 / CASH7-2 / CASH3-3 / CASH3-6 / E2E8-6 /
 * E2E5-5 / SAL9-14). Read docs/DEPLOY_EXISTING_DATA.md before running it.
 *
 *   DATABASE_URL=... npx tsx scripts/fix-existing-bills.ts                 # dry run (default): report only
 *   DATABASE_URL=... npx tsx scripts/fix-existing-bills.ts --check         # dry run, prints only what needs a person
 *   DATABASE_URL=... npx tsx scripts/fix-existing-bills.ts --apply --i-have-a-backup
 *
 * Options:
 *   --out <dir>            where to write the report (default ./fix-existing-bills-report)
 *   --overrides <file>     JSON for bills the report marks REVIEW and you have checked by hand:
 *                            { "<invoice number>": <collected at billing> }  or
 *                            { "<invoice number>": { "collectedAtBilling": 5000, "trimRefunds": true } }
 *                          collectedAtBilling: what the bill really collected on its own day.
 *                          trimRefunds: an older build paid out a refund larger than the
 *                            over-paid part and staff confirm that cash never left the
 *                            drawer — the older refund row(s) are cut down to the over-paid part.
 *                          keepRefunds: that cash DID leave the drawer — keep the refund
 *                            rows; the customer owes the difference.
 *   --check                dry run that prints only the findings that need a decision
 *                          (exit code 3 when there are any, 0 when there are none).
 *
 * What it does, for every bill that is not voided:
 *   1. Works out what was COLLECTED AT BILLING from the earliest evidence:
 *      the stored payment split, else the audit trail's first saved state, else
 *      an EXACT replay of the older builds' bill updates (their receipts,
 *      returns and refunds) that ends on the bill's stored figures. A bill whose
 *      history does not replay to exactly one answer is NOT changed: it is
 *      listed as REVIEW until --overrides says what was collected.
 *   2. Freezes that as the bill's payment split (paymentSplits / partialAmount /
 *      isPartialPayment), so the drawer reads the bill's own day exactly as it
 *      was billed and later receipts never move it again.
 *   3. Sets creditOriginal = grand total − collected at billing.
 *   4. Receipts whose money was not applied to any bill (older builds capped
 *      them at a wrong due, or they were taken "on account") are topped up onto
 *      the bill they were for, and any rest becomes the customer's store credit.
 *   5. Each older return (batch) with no refund recorded was paid back in cash
 *      (client decision): a Cash refund row for what this release would have
 *      paid back for it, dated on the return day. Each older "Adjust (credit
 *      note)" refund row becomes ONE store-credit entry for the over-paid part
 *      (the row is removed — it was never cash).
 *   6. balanceDue = max(0, creditOriginal − receipts − returns + refunds); what
 *      the customer paid beyond the bill and was never paid back becomes store
 *      credit. Refunds an older build paid beyond the over-paid part → REVIEW.
 *   7. Adds one 'Opening Stock' history row per item/branch whose stock history
 *      does not add up to the current stock, dated before its first movement.
 *   8. Salaries marked Paid by older builds had no Payment 'out' row: one is
 *      added per such payroll row (its mode and amount, dated on the IST day it
 *      was paid, at the employee's branch, notes/createdByName mark it backfilled).
 *   9. Bill lines without a sale-time cost (`unitCost`) get one: the price of the
 *      latest purchase receipt of that item on/before the bill date, else the
 *      item's current purchase price (combos: the sum of their parts).
 *  10. Employee status 'active'/'disabled' (older login values) → 'Active'/'Inactive';
 *      quotations with no status → 'Converted' (a live bill was made from it) or 'Open'.
 *
 * Idempotent: everything is computed from the data, and every row it adds has a
 * fixed id / reference, so a second run finds nothing to change. Each --apply
 * run is recorded in AppConfig key 'migration:fix-existing-bills'.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { prisma } from '../src/db.js';
import { nextPersistent } from '../src/lib/sequences.js';
import { buildOpeningStockRows } from '../src/lib/openingStock.js';
import { istDateOf } from '../src/lib/businessDate.js';
import { cashAtBilling } from '../src/lib/billingSplit.js';
import { legacyRefundId, creditNotesForBill } from '../src/lib/returnRefunds.js';
import { registerFigures } from '../src/services/cash.service.js';
import { cleanPhone } from '../src/lib/stockLedger.js';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const CHECK = flag('--check');
const APPLY = flag('--apply') && !CHECK;
const OUT_DIR = resolve(opt('--out') || 'fix-existing-bills-report');
const OVERRIDES_FILE = opt('--overrides');
const MARKER_KEY = 'migration:fix-existing-bills';
const BY = 'fix-existing-bills';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const eq = (a: number | null | undefined, b: number | null | undefined) =>
  (a == null || Number(a) === 0) && (b == null || Number(b) === 0) ? true : a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.011;
const inr = (n: number) => `₹${r2(n).toLocaleString('en-IN')}`;
const isCash = (mode: unknown) => String(mode || '').toLowerCase() === 'cash';
const isCreditNoteMode = (mode: unknown) => /adjust|credit/i.test(String(mode || ''));

class DryRunRollback extends Error {}

interface Split { mode: string; amount: number }
interface Override { collectedAtBilling?: number; trimRefunds?: boolean; keepRefunds?: boolean }
interface BillRow {
  invoiceNumber: string;
  invoiceId: string;
  branchId: string;
  date: string;
  customer: string;
  total: number;
  method: string;
  reason: string;
  collectedAtBilling: number;
  receipts: number;
  receiptsToppedUp: number;
  returns: number;
  refundsExisting: number;
  refundsBackfilled: number;
  creditNotes: number;
  oldDue: number | null;
  newDue: number;
  oldCreditOriginal: number | null;
  newCreditOriginal: number;
  oldPartialAmount: number | null;
  newPartialAmount: number | null;
  storeCreditAdded: number;
  unitCostLines: number;
  flags: string[];
  action: string;
}

function usage(msg?: string): never {
  if (msg) console.error(`\n${msg}\n`);
  console.error('Usage: DATABASE_URL=... npx tsx scripts/fix-existing-bills.ts [--check | --apply --i-have-a-backup] [--out <dir>] [--overrides <file.json>]');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Exact replay of the older builds on a bill WITHOUT a stored payment split
// (the oldest bills, e.g. the go-live ones). Each build stored the bill's state
// differently on a receipt or a return:
//   S  (first backend builds): a receipt lowered balanceDue and set
//      partialAmount = billed − due − returns; returns changed nothing.
//   RC (a0b710e … cf9b5b4): every receipt / return recomputed the due from the
//      synthesised split (partialAmount) and rewrote partialAmount = net − due;
//      a return booked a refund row for its FULL value in the chosen mode.
//   N4 (403d331): on the first touch anchored creditOriginal = stored due +
//      receipts + returns − refunds; due = creditOriginal − receipts − returns +
//      refunds, still rewriting partialAmount = net − due; a return refunded the
//      over-paid delta (cash row, or a credit note on 'Adjust').
//   NW (this release, if it ran before the script): same anchor, partialAmount
//      never touched.
// Every build capped a receipt at the due it believed, so a capped receipt
// pins down that due. The builds ran in this order, so a bill's events are
// replayed as S… then RC… then N4… then NW…, trying every split point.
// ---------------------------------------------------------------------------

type Build = 'S' | 'RC' | 'N4' | 'NW';
type Ev =
  | { kind: 'receipt'; at: string; amount: number; paid?: number; audited: boolean }
  | { kind: 'return'; at: string; value: number; cashRow: number; adjustRow: number; creditNote: number; hasRow: boolean; audited: boolean }
  | { kind: 'refund'; at: string; amount: number };
interface St { partial: number | null; isP: boolean; bd: number; co: number | null; R: number; ret: number; rf: number; cn: number }

function initialState(G: number, c0: number): St {
  const base = { co: null, R: 0, ret: 0, rf: 0, cn: 0 };
  if (c0 > 0.009 && c0 < G - 0.009) return { ...base, partial: r2(c0), isP: true, bd: r2(G - c0) };
  if (c0 >= G - 0.009) return { ...base, partial: null, isP: false, bd: 0 };
  return { ...base, partial: null, isP: false, bd: G };
}

function simulate(inv: any, c0: number, evs: Ev[], builds: Build[], v: { rcRecompute: boolean; nwFixed: boolean }): St | null {
  const G = r2(inv.grandTotal);
  const cod = inv.paymentMode === 'COD-Credit';
  let st = initialState(G, c0);
  const rcOwed = (s: St) => (s.isP && s.partial && s.bd ? G - s.partial : cod ? G : 0);
  const rcRecompute = (s: St) => {
    const due = Math.max(0, r2(rcOwed(s) - s.R - s.ret));
    const collected = Math.max(0, r2(G - s.ret - due));
    const isP = due > 0 && collected > 0;
    return { ...s, partial: isP ? collected : null, isP, bd: due };
  };
  const anchoredDue = (s: St) => Math.max(0, r2((s.co || 0) - s.R - s.ret + s.rf));
  const n4Recompute = (s: St) => {
    const due = anchoredDue(s);
    const collected = Math.max(0, r2(G - s.ret - due));
    const isP = due > 0 && collected > 0;
    return { ...s, partial: isP ? collected : null, isP, bd: due };
  };
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    const b = builds[i];
    if (e.kind === 'refund') { st = { ...st, rf: r2(st.rf + e.amount) }; continue; }
    if ((b === 'N4' || b === 'NW') && st.co == null) st = { ...st, co: Math.max(0, r2(Math.max(0, st.bd) + st.R + st.ret - st.rf)) };
    if (e.kind === 'receipt') {
      let due: number;
      if (b === 'S') due = Math.max(0, r2(Math.max(0, st.bd) - st.ret));
      else if (b === 'RC') due = Math.max(0, r2(rcOwed(st) - st.R - st.ret));
      else due = anchoredDue(st);
      if (e.paid != null && !eq(Math.min(e.paid, due), e.amount)) return null;
      if (b === 'S') {
        const newDue = Math.max(0, r2(due - Math.min(e.amount, due)));
        st = { ...st, R: r2(st.R + e.amount), partial: r2(G - newDue - st.ret), isP: newDue > 0, bd: newDue };
      } else {
        st = { ...st, R: r2(st.R + e.amount) };
        if (b === 'RC') st = rcRecompute(st);
        else if (b === 'N4') st = n4Recompute(st);
        else st = { ...st, bd: anchoredDue(st) };
      }
      continue;
    }
    // return
    if (b === 'S') {
      if (e.hasRow || e.creditNote > 0.009) return null; // the first builds never recorded a refund
      st = { ...st, ret: r2(st.ret + e.value) };
    } else if (b === 'RC') {
      if (e.creditNote > 0.009) return null;
      const row = r2(e.cashRow + e.adjustRow);
      if (e.hasRow && !eq(row, e.value)) return null; // RC refunded the full value
      st = { ...st, ret: r2(st.ret + e.value) };
      if (v.rcRecompute) st = rcRecompute(st);
      st = { ...st, rf: r2(st.rf + row) };
    } else {
      if (e.adjustRow > 0.009) return null; // N4 / NW never wrote 'Adjust' refund rows
      const paid = r2(G - (st.co || 0) + st.R);
      const overBefore = Math.max(0, r2(paid - (G - st.ret)));
      const retAfter = r2(st.ret + e.value);
      const overAfter = Math.max(0, r2(paid - (G - retAfter)));
      const fixed = b === 'NW' && v.nwFixed;
      const back = fixed ? Math.max(0, r2(paid - st.rf - st.cn - (G - retAfter))) : Math.max(0, r2(overAfter - overBefore));
      if (!eq(r2(e.cashRow + e.creditNote), back)) return null;
      st = { ...st, ret: retAfter };
      if (fixed) st = { ...st, rf: r2(st.rf + e.cashRow), cn: r2(st.cn + e.creditNote) };
      st = b === 'N4' ? n4Recompute(st) : { ...st, bd: anchoredDue(st) };
      if (!fixed) st = { ...st, rf: r2(st.rf + e.cashRow), cn: r2(st.cn + e.creditNote) };
    }
  }
  return st;
}

const matchesStored = (inv: any, st: St) =>
  eq(st.bd, Number(inv.balanceDue) || 0) &&
  (st.partial == null ? !Number(inv.partialAmount) : eq(st.partial, Number(inv.partialAmount))) &&
  !!st.isP === !!inv.isPartialPayment &&
  (st.co == null ? inv.creditOriginal == null : inv.creditOriginal != null && eq(st.co, Number(inv.creditOriginal)));

const LEVEL: Record<Build, number> = { S: 0, RC: 1, N4: 2, NW: 3 };
interface Hit { c0: number; builds: Build[] }

/** Every (amount collected at billing, build per event) that replays the
 *  bill's history exactly to its stored figures. */
function replay(inv: any, evs: Ev[], candidates: number[]): Hit[] {
  const n = evs.length;
  const hits: Hit[] = [];
  const variants = [
    { rcRecompute: true, nwFixed: true }, { rcRecompute: true, nwFixed: false },
    { rcRecompute: false, nwFixed: true }, { rcRecompute: false, nwFixed: false },
  ];
  for (let i1 = 0; i1 <= n; i1++) {
    for (let i2 = i1; i2 <= n; i2++) {
      for (let i3 = i2; i3 <= n; i3++) {
        const builds: Build[] = evs.map((_, j) => (j < i1 ? 'S' : j < i2 ? 'RC' : j < i3 ? 'N4' : 'NW'));
        // Every build since 4068f1e writes an audit row for each receipt and
        // return; one without any is from before that (or demo data): build S.
        if (evs.some((e, j) => e.kind !== 'refund' && !e.audited && builds[j] !== 'S')) continue;
        for (const c0 of candidates) {
          for (const v of variants) {
            if (!builds.includes('RC') && !v.rcRecompute) continue;
            if (!builds.includes('NW') && !v.nwFixed) continue;
            const st = simulate(inv, c0, evs, builds, v);
            if (st && matchesStored(inv, st)) { hits.push({ c0, builds }); break; }
          }
        }
      }
    }
  }
  return hits;
}

/**
 * The builds were deployed one after another (S, then RC, then N4, then this
 * release), so a time at which some bill's history can ONLY have been written
 * by build ≥ L means no event after it was written by an older build — and a
 * time at which an event can only be older than L means nothing before it was
 * written by L or newer. Applied to every bill's replays until nothing changes;
 * it settles replays that one bill alone can't tell apart.
 */
function constrainByDeployOrder(pending: { evs: Ev[]; hits: Hit[] }[], known: { level: number; at: string }[]): void {
  for (let pass = 0; pass < 6; pass++) {
    const minAt: (string | null)[] = [null, null, null, null]; // earliest event forced to level ≥ L
    const maxAt: (string | null)[] = [null, null, null, null]; // latest event forced to level < L
    for (const k of known) for (let L = 1; L <= k.level; L++) if (minAt[L] == null || k.at < minAt[L]!) minAt[L] = k.at;
    for (const { evs, hits } of pending) {
      if (!hits.length) continue;
      evs.forEach((e, j) => {
        if (e.kind === 'refund') return;
        const lo = Math.min(...hits.map((h) => LEVEL[h.builds[j]]));
        const hi = Math.max(...hits.map((h) => LEVEL[h.builds[j]]));
        for (let L = 1; L <= 3; L++) {
          if (lo >= L && (minAt[L] == null || e.at < minAt[L]!)) minAt[L] = e.at;
          if (hi < L && (maxAt[L] == null || e.at > maxAt[L]!)) maxAt[L] = e.at;
        }
      });
    }
    let changed = false;
    for (const item of pending) {
      const keep = item.hits.filter((h) => item.evs.every((e, j) => {
        if (e.kind === 'refund') return true;
        const lv = LEVEL[h.builds[j]];
        for (let L = 1; L <= 3; L++) {
          if (minAt[L] != null && e.at >= minAt[L]! && lv < L) return false;
          if (maxAt[L] != null && e.at <= maxAt[L]! && lv >= L) return false;
        }
        return true;
      }));
      // Never let the global picture wipe out every explanation of a bill.
      if (keep.length && keep.length !== item.hits.length) { item.hits = keep; changed = true; }
    }
    if (!changed) return;
  }
}

// ---------------------------------------------------------------------------

async function main() {
  if (!process.env.DATABASE_URL) usage('DATABASE_URL is not set.');
  if (flag('--apply') && CHECK) usage('--check is a dry run; leave out --apply.');
  if (APPLY && !flag('--i-have-a-backup')) {
    usage('--apply changes money records. Take a backup first (pg_dump -Fc, see docs/DEPLOY_EXISTING_DATA.md) and add --i-have-a-backup.');
  }
  const raw = OVERRIDES_FILE ? JSON.parse(readFileSync(OVERRIDES_FILE, 'utf8')) : {};
  const overrides: Record<string, Override> = {};
  for (const [k, v] of Object.entries(raw)) overrides[k] = typeof v === 'number' ? { collectedAtBilling: v } : (v as Override);
  const target = (() => {
    try { const u = new URL(process.env.DATABASE_URL!); return `${u.hostname}${u.port ? ':' + u.port : ''}${u.pathname}`; } catch { return '(unparsed DATABASE_URL)'; }
  })();
  console.log(`fix-existing-bills — ${APPLY ? 'APPLY' : CHECK ? 'CHECK (dry run, nothing will be changed)' : 'DRY RUN (nothing will be changed)'} on ${target}`);

  const started = Date.now();
  let report: any = null;
  try {
    await prisma.$transaction(async (tx: any) => {
      report = await run(tx, overrides);
      if (!APPLY) throw new DryRunRollback();
      const prev = await tx.appConfig.findUnique({ where: { key: MARKER_KEY } });
      const prevValue: any = prev?.value && typeof prev.value === 'object' ? prev.value : {};
      const runs = Array.isArray(prevValue.runs) ? prevValue.runs : [];
      runs.push({ appliedAt: new Date().toISOString(), totals: report.totals });
      await tx.appConfig.upsert({ where: { key: MARKER_KEY }, create: { key: MARKER_KEY, value: { runs } as any }, update: { value: { ...prevValue, runs } as any } });
    }, { timeout: 60 * 60 * 1000, maxWait: 60 * 1000 });
  } catch (e) {
    if (!(e instanceof DryRunRollback)) throw e;
  }
  report.totals.seconds = r2((Date.now() - started) / 1000);

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = join(OUT_DIR, `${APPLY ? 'applied' : CHECK ? 'check' : 'dry-run'}-${stamp}`);
  writeFileSync(`${base}.json`, JSON.stringify({ mode: APPLY ? 'apply' : CHECK ? 'check' : 'dry-run', target, ...report }, null, 2));
  const cols: (keyof BillRow)[] = [
    'invoiceNumber', 'branchId', 'date', 'customer', 'total', 'method', 'collectedAtBilling', 'receipts', 'receiptsToppedUp', 'returns',
    'refundsExisting', 'refundsBackfilled', 'creditNotes', 'oldDue', 'newDue', 'oldCreditOriginal', 'newCreditOriginal', 'oldPartialAmount',
    'newPartialAmount', 'storeCreditAdded', 'unitCostLines', 'flags', 'action', 'reason',
  ];
  const csvCell = (v: any) => {
    const s = Array.isArray(v) ? v.join('; ') : v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  writeFileSync(`${base}.csv`, [cols.join(','), ...report.bills.map((b: BillRow) => cols.map((c) => csvCell(b[c])).join(','))].join('\n') + '\n');

  const t = report.totals;
  const review = report.bills.filter((b: BillRow) => b.flags.some((f) => f.startsWith('REVIEW') || f.startsWith('CHECK')));
  const gating = review.length + report.salaries.filter((s: any) => String(s.note || '').startsWith('REVIEW')).length;
  if (!CHECK) {
    console.log('\nTotals');
    for (const [k, v] of Object.entries(t)) console.log(`  ${k.padEnd(36)} ${v}`);
    const dueMoves = report.bills.filter((b: BillRow) => !b.action.startsWith('skip') && !eq(b.oldDue ?? 0, b.newDue) && b.action !== 'no change');
    if (dueMoves.length) {
      console.log(`\n${dueMoves.length} bill(s) whose due changes:`);
      for (const b of dueMoves.slice(0, 50)) console.log(`  ${b.invoiceNumber}: ${b.oldDue ?? '—'} -> ${b.newDue}  [${b.method}] ${b.reason}`);
    }
    const moved = report.closedDays.filter((d: any) => d.why);
    if (moved.length) {
      console.log(`\n${moved.length} closed day(s) whose computed closing changes:`);
      for (const d of moved.slice(0, 50)) console.log(`  ${d.branchId} ${d.date}: ${d.closingBefore} -> ${d.closingAfter}  (${d.why})`);
    }
    if (report.openingGaps.length) {
      console.log(`\n${report.openingGaps.length} closed day(s) whose stored opening doesn't follow from the day before (left as they are — see openingGaps):`);
      for (const g of report.openingGaps.slice(0, 30)) console.log(`  ${g.branchId} ${g.date}: stored ${g.storedOpening}, carried forward ${g.carriedForward} (gap ${g.gap})`);
    }
  }
  console.log(`\nNeeds a decision: ${gating ? `${gating} item(s)` : 'nothing'}`);
  if (report.adjustRows.length) {
    console.log(`\n${report.adjustRows.length} older "Adjust / credit note" refund row(s) — each becomes ONE store-credit entry (no action needed):`);
    for (const a of report.adjustRows.slice(0, 30)) console.log(`  ${a.invoiceNumber} ${a.receiptNumber} ${inr(a.amount)} → store credit ${inr(a.credit)}`);
  }
  if (report.legacyTouched.length) {
    console.log(`\n${report.legacyTouched.length} older bill(s) without a stored split that receipts/returns changed — how each was worked out:`);
    for (const l of report.legacyTouched.slice(0, 50)) console.log(`  ${l.invoiceNumber}: ${l.method} — ${l.reason}${l.review ? `  ** ${l.review}` : ''}`);
  }
  if (review.length) {
    console.log(`\n${review.length} bill(s) need a look (REVIEW = left unchanged until you add an override; CHECK = changed, read the note):`);
    for (const b of review.slice(0, 50)) console.log(`  ${b.invoiceNumber}: ${b.flags.filter((f: string) => f.startsWith('REVIEW') || f.startsWith('CHECK')).join('; ')}`);
  }
  console.log(`\nReport: ${base}.csv and .json  (${t.seconds}s)`);
  console.log(APPLY ? 'Applied in one transaction.' : 'Dry run — nothing was changed. Re-run with --apply --i-have-a-backup to write.');
  if (CHECK && gating) process.exitCode = 3;
}

async function run(tx: any, overrides: Record<string, Override>) {
  const t0 = Date.now();
  const progress = (msg: string) => process.stderr.write(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}\n`);
  const closedBefore = (await registerFigures(tx)).filter((r) => r.isClosed);

  const invoices: any[] = await tx.invoice.findMany();
  const payments: any[] = await tx.payment.findMany();
  const audits: any[] = await tx.auditLog.findMany({ where: { action: 'sale.save' }, select: { entityId: true, timestamp: true, after: true } });
  // Receipts and returns made by builds that kept an audit trail.
  const auditedPayments = new Set<string>();
  const returnAudits = new Map<string, number[]>();
  for (const a of (await tx.auditLog.findMany({ where: { action: { in: ['payment.record', 'sale.return'] } }, select: { action: true, entityId: true, timestamp: true } })) as any[]) {
    if (a.action === 'payment.record') auditedPayments.add(a.entityId);
    else (returnAudits.get(a.entityId) ?? (returnAudits.set(a.entityId, []), returnAudits.get(a.entityId)!)).push(Date.parse(a.timestamp));
  }
  const returnAudited = (invoiceId: string, at: string) => {
    const t = Date.parse(at);
    return (returnAudits.get(invoiceId) || []).some((x) => x - t >= -5_000 && x - t <= 120_000);
  };
  const customers = new Map<string, any>(((await tx.customer.findMany()) as any[]).map((c) => [c.id, { ...c, creditHistory: Array.isArray(c.creditHistory) ? [...c.creditHistory] : [] }]));
  const invById = new Map(invoices.map((i) => [i.id, i]));
  progress(`loaded ${invoices.length} bills, ${payments.length} payments, ${customers.size} customers`);

  // ---- in-memory ledger, indexed once (UPG9-7) --------------------------------
  const allocTo = (p: any, invoiceId: string) =>
    (Array.isArray(p.allocations) ? p.allocations : []).filter((a: any) => a?.refId === invoiceId).reduce((t: number, a: any) => t + (Number(a.amount) || 0), 0);
  const ins = new Map<string, Set<any>>();
  const outs = new Map<string, Set<any>>();
  const setOf = (m: Map<string, Set<any>>, id: string) => m.get(id) ?? (m.set(id, new Set()), m.get(id)!);
  const index = (p: any) => {
    for (const a of Array.isArray(p.allocations) ? p.allocations : []) {
      if (!a?.refId) continue;
      if (p.type === 'in') setOf(ins, a.refId).add(p);
      else if (p.type === 'out' && p.partyType === 'customer') setOf(outs, a.refId).add(p);
    }
  };
  const unindex = (p: any) => { for (const m of [ins, outs]) for (const s of m.values()) s.delete(p); };
  payments.forEach(index);
  const receiptRows = (id: string) => [...(ins.get(id) || [])].filter((p) => allocTo(p, id) > 0);
  const refundRows = (id: string) => [...(outs.get(id) || [])].filter((p) => allocTo(p, id) > 0);
  const receiptsOf = (id: string) => r2(receiptRows(id).reduce((t, p) => t + allocTo(p, id), 0));
  const refundsOf = (id: string) => r2(refundRows(id).reduce((t, p) => t + allocTo(p, id), 0));
  const auditsByKey = new Map<string, Set<any>>();
  for (const a of audits) for (const k of [a.entityId, (a.after as any)?.invoiceNumber].filter(Boolean)) setOf(auditsByKey, String(k)).add(a);

  // Writes are collected and sent at the end of each phase.
  const paymentUpdates = new Map<string, any>();
  const paymentCreates: any[] = [];
  const paymentDeletes = new Set<string>();
  const dirtyCustomers = new Set<string>();
  const customerCreates: any[] = [];

  const bills: BillRow[] = [];
  const C0 = new Map<string, number>();
  const blocked = new Set<string>(); // REVIEW: left exactly as it is
  const stats = { unassignedReceipts: 0, refundsTrimmed: 0, refundRowsCreated: 0, refundAmountBackfilled: 0, adjustRowsConverted: 0, storeCreditAdded: 0, receiptsToppedUp: 0, openingStockRows: 0, openingStockUnits: 0, salaryRowsCreated: 0, salaryAmountBackfilled: 0, unitCostLines: 0, unitCostFromPurchases: 0, unitCostFromItemCost: 0, cogsChangeVsCurrentCost: 0, employeeStatusesFixed: 0, quoteStatusesSet: 0 };
  const extraLog: any[] = [];
  const legacyTouched: any[] = [];
  const adjustLog: any[] = [];
  const dayNotes = new Map<string, { text: string; amount: number }[]>();
  const noteDay = (branchId: string, date: string, text: string, amount: number) => {
    if (Math.abs(amount) < 0.005) return;
    const k = `${branchId}|${date}`;
    (dayNotes.get(k) ?? (dayNotes.set(k, []), dayNotes.get(k)!)).push({ text, amount: r2(amount) });
  };

  // Return batches: one return call stamps its lines with the same batchId
  // (this release) or the same time (older builds).
  const batchesOf = (inv: any) => {
    const m = new Map<string, { key: string; at: string; value: number; recs: any[]; legacy: boolean }>();
    for (const r of (Array.isArray(inv.returns) ? inv.returns : []).filter(Boolean)) {
      const key = r.batchId || `at:${r.returnedAt || inv.date}`;
      const b = m.get(key) ?? (m.set(key, { key, at: String(r.returnedAt || inv.date), value: 0, recs: [], legacy: !r.batchId }), m.get(key)!);
      b.value = r2(b.value + (Number(r.refundAmount) || 0));
      b.recs.push(r);
      if (String(r.returnedAt || '') < b.at) b.at = String(r.returnedAt);
    }
    return [...m.values()].sort((a, b) => a.at.localeCompare(b.at));
  };
  // What each batch was paid back with, as recorded: refund rows stamped with the
  // batch's time / id / the script's fixed id, and credit notes for it.
  const paidBackOf = (inv: any, batch: { at: string; recs: any[] }, rows: any[]) => {
    const r0 = batch.recs[0] || {};
    const ids = new Set([r0.batchRefundPaymentId, legacyRefundId(inv.id, batch.at)].filter(Boolean));
    const matched = rows.filter((p) => ids.has(p.id) || p.createdAt === batch.at);
    const hist = inv.customerId ? customers.get(inv.customerId)?.creditHistory || [] : [];
    const t0b = Date.parse(batch.at);
    const notes = hist.filter((h: any) => h?.type === 'issued' && (
      (h.refId === inv.id && Math.abs(Date.parse(h.date) - t0b) < 10_000) || (h.billId === inv.id && h.batchAt === batch.at)));
    const creditNote = r2(Math.max(Number(r0.batchCreditIssued) || 0, notes.reduce((t: number, h: any) => t + (Number(h.amount) || 0), 0)));
    return {
      cashRows: matched.filter((p) => !isCreditNoteMode(p.paymentMode)),
      adjustRows: matched.filter((p) => isCreditNoteMode(p.paymentMode)),
      creditNote,
    };
  };

  // ---- 1. collected at billing ------------------------------------------------
  let n1 = 0;
  const pending: { inv: any; evs: Ev[]; hits: Hit[]; flags: string[]; row: number; review: (why: string) => void }[] = [];
  // Returns that show which build made them, on any bill: a refund row stamped
  // with the return's own time was written by RC or newer (the first builds
  // never recorded a refund), a credit note by N4 or newer, a return batch id
  // only by this release.
  const known: { level: number; at: string }[] = [];
  for (const inv of invoices) {
    if (inv.isVoided) continue;
    const rows = refundRows(inv.id).filter((p) => !String(p.id).startsWith('pay-fix-'));
    for (const b of batchesOf(inv)) {
      if (!b.legacy) known.push({ level: 3, at: b.at });
      else if (rows.some((p) => p.createdAt === b.at)) known.push({ level: 1, at: b.at });
      else if (inv.customerId && (customers.get(inv.customerId)?.creditHistory || []).some((h: any) => h?.type === 'issued' && h.refId === inv.id && !h.billId && Math.abs(Date.parse(h.date) - Date.parse(b.at)) < 10_000)) known.push({ level: 2, at: b.at });
    }
  }
  for (const inv of invoices) {
    if (++n1 % 5000 === 0) progress(`collected-at-billing: ${n1}/${invoices.length} bills`);
    const G = r2(inv.grandTotal);
    const splits: Split[] = Array.isArray(inv.paymentSplits) ? inv.paymentSplits : [];
    const nonCodSum = r2(splits.filter((s) => s?.mode !== 'COD-Credit').reduce((t, s) => t + (Number(s.amount) || 0), 0));
    const receipts = receiptRows(inv.id);
    const R = receiptsOf(inv.id);
    const returns: any[] = Array.isArray(inv.returns) ? inv.returns : [];
    const outRows = refundRows(inv.id);
    const flags: string[] = [];
    let method = '';
    let reason = '';
    let c0: number | null = null;
    let deferred = false;
    const P = Number(inv.partialAmount) || 0;

    const firstTouch = [...receipts.map((p) => p.createdAt), ...returns.map((r) => r.returnedAt)].filter(Boolean).sort()[0] || null;
    const audit = [...new Set([...(auditsByKey.get(inv.id) || []), ...(auditsByKey.get(inv.invoiceNumber) || [])])]
      .filter((a) => !firstTouch || a.timestamp < firstTouch)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .pop();
    const fromAudit = (): number | null => {
      const af: any = audit?.after;
      if (!af) return null;
      const ag = Number(af.grandTotal) || G;
      if (af.isPartialPayment && Number(af.partialAmount) > 0) return Math.min(ag, r2(af.partialAmount));
      if (af.balanceDue != null && Number.isFinite(Number(af.balanceDue))) return Math.max(0, r2(ag - Number(af.balanceDue)));
      return af.paymentMode === 'COD-Credit' || af.transactionType === 'Credit' ? 0 : ag;
    };
    const review = (why: string) => { flags.push(`REVIEW: ${why} — bill left unchanged; add { "${inv.invoiceNumber}": <collected at billing> } to --overrides once checked`); };

    if (overrides[inv.invoiceNumber]?.collectedAtBilling != null) {
      c0 = r2(Number(overrides[inv.invoiceNumber].collectedAtBilling));
      method = 'override';
      reason = 'collected at billing given in --overrides';
    } else if (nonCodSum > 0.009) {
      // A real stored split: receipts in every build only ever touched its
      // COD-Credit part, so the collected modes are exactly what was taken.
      c0 = nonCodSum;
      method = 'split';
      reason = `stored split: ${inr(nonCodSum)} collected at billing`;
    } else if (splits.length) {
      // Only a COD-Credit split. The old billing form kept a part-payment on such
      // a bill only in partialAmount — but older receipts also wrote their own
      // running total there. The audit trail tells them apart.
      const a = fromAudit();
      if (a != null) { c0 = a; method = 'audit'; reason = 'first saved state in the audit trail'; }
      else if (!(inv.isPartialPayment && P > 0)) { c0 = 0; method = 'credit-split'; reason = 'credit bill, nothing collected at billing'; }
      else if (!receipts.length) { c0 = P; method = 'cod-part-payment'; reason = `part-payment ${inr(P)} on a credit bill, no receipts since`; }
      else if (eq(P, R)) { c0 = 0; method = 'credit-split (partialAmount was the receipts)'; reason = 'the stored part-payment equals the receipts an older build added to it'; }
      else { method = 'cod-part-payment + receipts'; review(`part-payment ${inr(P)} on a credit bill with ${inr(R)} of receipts and no audit row — can't tell what was collected at billing`); }
    } else {
      // No stored split (the oldest bills, e.g. the go-live ones).
      const a = fromAudit();
      const asStored = inv.isPartialPayment && P > 0 ? Math.min(G, P) : inv.paymentMode === 'COD-Credit' ? 0 : G;
      const evs: Ev[] = [];
      for (const p of receipts) {
        const allocs = Array.isArray(p.allocations) ? p.allocations : [];
        evs.push({ kind: 'receipt', at: String(p.createdAt), amount: allocTo(p, inv.id), paid: allocs.length === 1 ? r2(p.amount) : undefined, audited: auditedPayments.has(p.id) });
      }
      const matchedRows = new Set<any>();
      for (const b of batchesOf(inv)) {
        const pb = paidBackOf(inv, b, outRows);
        pb.cashRows.forEach((p) => matchedRows.add(p));
        pb.adjustRows.forEach((p) => matchedRows.add(p));
        const sum = (rows: any[]) => r2(rows.reduce((t, p) => t + allocTo(p, inv.id), 0));
        evs.push({ kind: 'return', at: b.at, value: b.value, cashRow: sum(pb.cashRows), adjustRow: sum(pb.adjustRows), creditNote: pb.creditNote, hasRow: pb.cashRows.length + pb.adjustRows.length > 0, audited: returnAudited(inv.id, b.at) });
      }
      for (const p of outRows) if (!matchedRows.has(p)) evs.push({ kind: 'refund', at: String(p.createdAt), amount: allocTo(p, inv.id) });
      evs.sort((x, y) => x.at.localeCompare(y.at) || (x.kind === 'return' ? 1 : 0) - (y.kind === 'return' ? 1 : 0));

      if (a != null) { c0 = a; method = 'audit'; reason = 'first saved state in the audit trail'; }
      else if (!evs.length && inv.creditOriginal == null) { c0 = asStored; method = 'untouched'; reason = 'no receipts, returns or refunds since billing: the stored part-payment'; }
      else if (!evs.length && eq(Number(inv.creditOriginal), r2(G - asStored))) { c0 = asStored; method = 'current-build'; reason = 'creditOriginal agrees with the stored part-payment'; }
      else if (evs.length > 16) { method = 'replay'; review(`${evs.length} receipts/returns on a bill without a stored split — too many to replay`); }
      else {
        // Candidates for what was collected: the stored figures, the creditOriginal
        // anchor (taken at any of the events), and the old builds' own algebra.
        const cands = new Set<number>([asStored, G, 0, r2(G - (Number(inv.balanceDue) || 0)), r2(P - R)]);
        let Rk = 0, retk = 0, rfk = 0;
        const co = inv.creditOriginal != null ? Number(inv.creditOriginal) : null;
        for (const e of [...evs, null]) {
          if (co != null) cands.add(r2(G - (co - Rk - retk + rfk)));
          if (!e) break;
          if (e.kind === 'receipt') Rk = r2(Rk + e.amount);
          else if (e.kind === 'return') { retk = r2(retk + e.value); rfk = r2(rfk + e.cashRow + e.adjustRow); }
          else rfk = r2(rfk + e.amount);
        }
        if (co != null) cands.add(r2(G - co));
        for (const withReturns of [true, false]) {
          const list = evs.filter((e) => e.kind === 'receipt' || (withReturns && e.kind === 'return'));
          let cum = 0, add = 0;
          for (const e of list) { if (e.kind === 'receipt') cum = r2(cum + e.amount); add = r2(add + cum); }
          if (inv.isPartialPayment && P > 0) cands.add(r2(P - add));
          let cumPrev = 0, addPrev = 0, retNow = 0;
          for (const e of list) {
            if (e.kind === 'return') { retNow = r2(retNow + e.value); addPrev = r2(addPrev + cumPrev); continue; }
            if (e.kind === 'receipt' && e.paid != null && e.paid - e.amount > 0.009) cands.add(r2(G - addPrev - cumPrev - retNow - e.amount));
            if (e.kind === 'receipt') { cumPrev = r2(cumPrev + e.amount); addPrev = r2(addPrev + cumPrev); }
          }
        }
        const valid = [...cands].filter((c) => c >= 0 && c <= G + 0.009).map(r2);
        pending.push({ inv, evs, hits: replay(inv, evs, [...new Set(valid)]), flags, row: bills.length, review });
        method = 'replay';
        deferred = true;
      }
      if (evs.length && !deferred) legacyTouched.push({ invoiceNumber: inv.invoiceNumber, method, reason: c0 != null ? reason : '', review: flags.find((f) => f.startsWith('REVIEW')) || '' });
    }
    if (c0 != null) c0 = Math.max(0, Math.min(G, r2(c0)));
    else if (!inv.isVoided && !deferred) blocked.add(inv.id);
    C0.set(inv.id, c0 ?? 0);
    bills.push({
      invoiceNumber: inv.invoiceNumber, invoiceId: inv.id, branchId: inv.branchId, date: inv.date, customer: inv.customerName,
      total: G, method, reason, collectedAtBilling: c0 ?? r2(G - (Number(inv.creditOriginal) || 0)), receipts: R, receiptsToppedUp: 0, returns: r2(inv.totalReturnedAmount || 0),
      refundsExisting: refundsOf(inv.id), refundsBackfilled: 0, creditNotes: 0,
      oldDue: inv.balanceDue ?? null, newDue: inv.balanceDue ?? 0, oldCreditOriginal: inv.creditOriginal ?? null, newCreditOriginal: c0 != null ? r2(G - c0) : inv.creditOriginal ?? null,
      oldPartialAmount: inv.partialAmount ?? null, newPartialAmount: inv.partialAmount ?? null, storeCreditAdded: 0, unitCostLines: 0, flags,
      action: inv.isVoided ? 'skip (voided)' : '',
    });
  }
  // Bills settled by replaying the older builds: one answer each, after the
  // deploy order has ruled out what it can across all bills.
  constrainByDeployOrder(pending, known);
  for (const pnd of pending) {
    const { inv, hits } = pnd;
    const row = bills[pnd.row];
    const G = r2(inv.grandTotal);
    const distinct = [...new Set(hits.map((h) => h.c0))];
    if (distinct.length === 1) {
      const c0 = Math.max(0, Math.min(G, distinct[0]));
      const used = [...new Set(hits.flatMap((h) => h.builds.filter((_, j) => pnd.evs[j].kind !== 'refund')))].sort((a, b) => LEVEL[a] - LEVEL[b]);
      row.method = `replay (${used.join('→') || 'no events'})`;
      row.reason = `the older builds' updates replay exactly to the stored figures from ${inr(c0)} collected at billing`;
      row.collectedAtBilling = c0;
      row.newCreditOriginal = r2(G - c0);
      C0.set(inv.id, c0);
    } else {
      row.method = distinct.length ? 'replay (ambiguous)' : 'replay (no match)';
      pnd.review(distinct.length
        ? `the history replays exactly from more than one amount collected at billing (${distinct.map(inr).join(' or ')})`
        : 'the receipts/returns on this bill do not replay to its stored figures under any older build');
      if (!inv.isVoided) blocked.add(inv.id);
    }
    legacyTouched.push({ invoiceNumber: inv.invoiceNumber, method: row.method, reason: blocked.has(inv.id) ? '' : row.reason, review: pnd.flags.find((f) => f.startsWith('REVIEW')) || '' });
  }
  const rowOf = new Map(bills.map((b) => [b.invoiceId, b]));
  progress('collected-at-billing done');

  const credit = (customerId: string | null, amount: number, refId: string, reason: string, extra: Record<string, any>): number => {
    if (!customerId || amount <= 0.009) return 0;
    const cust = customers.get(customerId);
    if (!cust) return 0;
    if (cust.creditHistory.some((h: any) => h?.refId === refId)) return 0; // already credited by an earlier run
    const balanceAfter = r2((Number(cust.creditBalance) || 0) + amount);
    cust.creditHistory.push({ id: `cr-fix-${refId}`, date: extra.date || new Date().toISOString(), type: 'issued', amount: r2(amount), balanceAfter, reason, refId, refNumber: extra.refNumber || null, billId: extra.billId || null, ...(extra.batchAt ? { batchAt: extra.batchAt } : {}), by: BY });
    cust.creditBalance = balanceAfter;
    dirtyCustomers.add(customerId);
    stats.storeCreditAdded = r2(stats.storeCreditAdded + amount);
    return r2(amount);
  };
  const dueOf = (inv: any) =>
    r2(r2(inv.grandTotal) - (C0.get(inv.id) || 0) - receiptsOf(inv.id) - (Number(inv.totalReturnedAmount) || 0) + refundsOf(inv.id));
  const payMax = new Map<string, number>();
  const nextPayNo = async (date: string) => {
    const like = `PAY-${date.slice(0, 7).replace('-', '')}-`;
    if (!payMax.has(like)) {
      let max = 0;
      for (const p of payments) {
        if (p.type !== 'out' || !String(p.receiptNumber || '').startsWith(like)) continue;
        const n = parseInt(String(p.receiptNumber).slice(like.length), 10);
        if (!Number.isNaN(n)) max = Math.max(max, n);
      }
      payMax.set(like, max);
    }
    const n = await nextPersistent(tx, `seq:pay:${like}`, payMax.get(like)!);
    payMax.set(like, n);
    return `${like}${String(n).padStart(4, '0')}`;
  };

  // ---- 2. over-refunds by older builds: decide before anything moves ----------
  for (const inv of invoices) {
    if (inv.isVoided || blocked.has(inv.id)) continue;
    const row = rowOf.get(inv.id)!;
    const G = r2(inv.grandTotal);
    // Receipts for this bill alone that an older build capped: step 3 puts
    // that money on the bill, so it counts as paid here already.
    const capped = r2(receiptRows(inv.id).filter((p) => (p.allocations as any[]).length === 1)
      .reduce((t, p) => t + Math.max(0, r2((Number(p.amount) || 0) - allocTo(p, inv.id))), 0));
    const over = Math.max(0, r2((C0.get(inv.id) || 0) + receiptsOf(inv.id) + capped - (G - (Number(inv.totalReturnedAmount) || 0))));
    const rows = refundRows(inv.id);
    const cash = rows.filter((p) => !isCreditNoteMode(p.paymentMode));
    const paidBack = r2(cash.reduce((t, p) => t + allocTo(p, inv.id), 0) + creditNotesForBill(inv.customerId ? customers.get(inv.customerId)?.creditHistory : null, inv.id));
    if (paidBack <= over + 0.01) continue;
    // Rows booked by this release's return logic belong to a batch with an id.
    const newBuildIds = new Set(((inv.returns as any[]) || []).map((r) => r?.batchRefundPaymentId).filter(Boolean));
    const older = cash.filter((p) => !newBuildIds.has(p.id));
    const o = overrides[inv.invoiceNumber] || {};
    if (!older.length || o.keepRefunds) {
      row.flags.push(`refunds (${inr(paidBack)}) exceed what was over-paid (${inr(over)}) — ${older.length ? 'kept on request' : 'booked by the current build'}; the customer owes the difference`);
      continue;
    }
    if (o.trimRefunds) {
      // Staff confirmed the extra never left the drawer: cut the older refund
      // rows (newest first) down to the over-paid part.
      let excess = r2(paidBack - over);
      for (const p of [...older].sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)))) {
        if (excess <= 0.009) break;
        const amt = allocTo(p, inv.id);
        const cut = Math.min(excess, amt);
        extraLog.push({ trimmedRefundRow: p.receiptNumber, invoice: inv.invoiceNumber, by: r2(cut) });
        if (isCash(p.paymentMode)) noteDay(p.branchId, p.date, `refund ${p.receiptNumber} on ${inv.invoiceNumber} cut on request`, cut);
        if (cut >= amt - 0.009) { unindex(p); paymentDeletes.add(p.id); }
        else {
          p.amount = r2(p.amount - cut);
          p.allocations = [{ refId: inv.id, refNumber: inv.invoiceNumber, amount: r2(amt - cut) }];
          p.notes = `${p.notes || ''} [cut by ${BY}: ₹${r2(cut)} was never paid out]`;
          paymentUpdates.set(p.id, p);
        }
        excess = r2(excess - cut);
        stats.refundsTrimmed = r2(stats.refundsTrimmed + cut);
      }
      row.flags.push(`refund cut to the over-paid part (${inr(over)}) on request`);
      continue;
    }
    row.flags.push(`REVIEW: an older build paid back ${inr(paidBack)} but only ${inr(over)} was over-paid — bill left unchanged. If that cash never left the drawer add { "${inv.invoiceNumber}": { "trimRefunds": true } } to --overrides; if it did, add { "${inv.invoiceNumber}": { "keepRefunds": true } } (the customer then owes the difference)`);
    blocked.add(inv.id);
  }

  // ---- 3. receipts whose money was never applied --------------------------------
  const inRows = payments.filter((p) => p.type === 'in' && p.partyType === 'customer' && !/store\s*credit/i.test(p.paymentMode || ''))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  for (const p of inRows) {
    const allocs: any[] = Array.isArray(p.allocations) ? p.allocations.map((a: any) => ({ ...a })) : [];
    let rest = r2((Number(p.amount) || 0) - allocs.reduce((t, a) => t + (Number(a.amount) || 0), 0));
    if (rest <= 0.009) continue;
    const hist = p.partyId ? customers.get(p.partyId)?.creditHistory || [] : [];
    if (hist.some((h: any) => h?.refId === p.id || h?.refId === `fix-unapplied:${p.id}`)) continue; // already held as credit
    if (allocs.some((a) => blocked.has(a.refId))) {
      for (const a of allocs) rowOf.get(a.refId)?.flags.push(`CHECK: receipt ${p.receiptNumber} took ${inr(rest)} more than it applied; left as it is while this bill is under review`);
      continue;
    }
    let topped = 0;
    for (const a of allocs) {
      const inv = invById.get(a.refId);
      if (!inv || inv.isVoided || rest <= 0.009) continue;
      const add = r2(Math.min(rest, Math.max(0, dueOf(inv))));
      if (add <= 0.009) continue;
      a.amount = r2((Number(a.amount) || 0) + add);
      rest = r2(rest - add);
      topped = r2(topped + add);
      const row = rowOf.get(inv.id)!;
      row.receiptsToppedUp = r2(row.receiptsToppedUp + add);
      row.receipts = r2(row.receipts + add);
      unindex(p);
      p.allocations = allocs.map((x) => ({ ...x }));
      index(p);
      paymentUpdates.set(p.id, p);
    }
    if (topped > 0) { stats.receiptsToppedUp = r2(stats.receiptsToppedUp + topped); extraLog.push({ receipt: p.receiptNumber, toppedUp: topped }); }
    if (rest > 0.009) {
      const billCust = allocs.map((a) => invById.get(a.refId)?.customerId).find(Boolean) || null;
      const cid = p.partyId || billCust;
      const got = credit(cid, rest, `fix-unapplied:${p.id}`, `Unapplied part of receipt ${p.receiptNumber} kept as store credit`, { refNumber: p.receiptNumber });
      extraLog.push({ receipt: p.receiptNumber, unapplied: rest, creditedTo: got ? cid : null, note: got ? 'store credit' : 'CHECK: no customer to hold it' });
      if (!got) {
        for (const a of allocs) rowOf.get(a.refId)?.flags.push(`CHECK: receipt ${p.receiptNumber} took ${inr(rest)} more than it applied and the bill has no customer account to hold it as credit`);
        if (!allocs.length) stats.unassignedReceipts++;
      }
    }
  }
  progress('receipts done');

  // ---- 4. refunds for older returns, one per return batch (UPG9-1 / UPG9-4) ---
  for (const inv of invoices) {
    if (inv.isVoided || blocked.has(inv.id)) continue;
    const batches = batchesOf(inv);
    if (!batches.length) continue;
    const row = rowOf.get(inv.id)!;
    const G = r2(inv.grandTotal);
    const c0 = C0.get(inv.id) || 0;
    const rows = refundRows(inv.id);
    const receipts = receiptRows(inv.id);
    const matched = new Set<any>();
    const plan = batches.map((b) => ({ b, pb: paidBackOf(inv, b, rows) }));
    plan.forEach(({ pb }) => [...pb.cashRows, ...pb.adjustRows].forEach((p) => matched.add(p)));
    const loose = rows.filter((p) => !matched.has(p));
    let retAfter = 0;
    let backBefore = 0; // paid back for earlier batches
    for (const { b, pb } of plan) {
      retAfter = r2(retAfter + b.value);
      const paid = r2(c0 + receipts.filter((p) => String(p.createdAt) <= b.at || String(p.date) <= istDateOf(b.at)).reduce((t, p) => t + allocTo(p, inv.id), 0));
      const looseBefore = r2(loose.filter((p) => String(p.createdAt) < b.at).reduce((t, p) => t + allocTo(p, inv.id), 0));
      // What this release would pay back for this batch (UPG9-5's rule).
      const owed = Math.max(0, r2(paid - backBefore - looseBefore - (G - retAfter)));
      let back = r2(pb.cashRows.reduce((t, p) => t + allocTo(p, inv.id), 0) + pb.creditNote);
      // Older 'Adjust' (credit-note) refund rows: never cash. Each becomes ONE
      // store-credit entry for the over-paid part, linked to this bill and batch.
      for (const p of pb.adjustRows) {
        const share = Math.max(0, Math.min(allocTo(p, inv.id), r2(owed - back)));
        const got = credit(inv.customerId, share, `fix-adjust:${p.id}`, `Credit note on return #${inv.invoiceNumber} (was refund row ${p.receiptNumber})`, { refNumber: inv.invoiceNumber, billId: inv.id, batchAt: b.at, date: b.at });
        if (share > 0.009 && !got) row.flags.push(inv.customerId ? `CHECK: credit note row ${p.receiptNumber} was already converted` : `CHECK: credit note ${inr(share)} on a bill with no customer account — not held anywhere`);
        row.storeCreditAdded = r2(row.storeCreditAdded + got);
        back = r2(back + share);
        adjustLog.push({ invoiceNumber: inv.invoiceNumber, receiptNumber: p.receiptNumber, amount: allocTo(p, inv.id), credit: share, date: p.date });
        extraLog.push({ deletedAdjustRow: { ...p } });
        if (isCash(p.paymentMode)) noteDay(p.branchId, p.date, `credit-note row ${p.receiptNumber} removed`, allocTo(p, inv.id));
        unindex(p);
        paymentDeletes.add(p.id);
        stats.adjustRowsConverted++;
      }
      // Older return with nothing paid back: it was paid back in CASH (client
      // decision), on the return day, under a fixed id.
      const hadRefund = pb.cashRows.length > 0 || pb.adjustRows.length > 0 || pb.creditNote > 0.009;
      if (b.legacy && !hadRefund && owed > 0.009) {
        const date = istDateOf(b.at);
        const id = legacyRefundId(inv.id, b.at);
        const p = {
          id, receiptNumber: await nextPayNo(date), type: 'out', partyType: 'customer', partyId: inv.customerId ?? null,
          partyName: inv.customerName || 'Customer', branchId: inv.branchId, date, amount: owed, paymentMode: 'Cash',
          reference: inv.invoiceNumber ?? null,
          notes: `Refund on sale #${inv.invoiceNumber} — backfilled by ${BY} (older return, paid back in cash)`,
          allocations: [{ refId: inv.id, refNumber: inv.invoiceNumber, amount: owed }],
          createdById: null, createdByName: BY, createdAt: new Date().toISOString(),
        };
        paymentCreates.push(p);
        index(p);
        noteDay(inv.branchId, date, `backfilled cash refund for the older return on ${inv.invoiceNumber}`, -owed);
        row.refundsBackfilled = r2(row.refundsBackfilled + owed);
        stats.refundRowsCreated++;
        stats.refundAmountBackfilled = r2(stats.refundAmountBackfilled + owed);
        back = r2(back + owed);
      }
      backBefore = r2(backBefore + back);
    }
  }
  progress('returns done');

  // ---- 5. freeze the billing split, creditOriginal and the due ------------------
  const invoiceUpdates = new Map<string, any>();
  for (const inv of invoices) {
    const row = rowOf.get(inv.id)!;
    if (inv.isVoided) continue;
    if (blocked.has(inv.id)) { row.action = 'no change (REVIEW)'; continue; }
    const G = r2(inv.grandTotal);
    const c0 = C0.get(inv.id) || 0;
    const splits: Split[] = Array.isArray(inv.paymentSplits) ? inv.paymentSplits : [];
    const nonCod = splits.filter((s) => s?.mode !== 'COD-Credit' && (Number(s.amount) || 0) > 0).map((s) => ({ mode: s.mode, amount: r2(s.amount) }));
    let collectedSplits: Split[];
    if (row.method === 'split' || (nonCod.length && eq(r2(nonCod.reduce((t, s) => t + s.amount, 0)), c0))) collectedSplits = nonCod;
    else collectedSplits = c0 > 0 ? [{ mode: !inv.paymentMode || inv.paymentMode === 'COD-Credit' ? 'Cash' : inv.paymentMode, amount: c0 }] : [];
    const codDue = r2(G - c0);
    const storedNonCod = r2(splits.filter((s) => s?.mode !== 'COD-Credit').reduce((t, s) => t + (Number(s.amount) || 0), 0));
    const storedCod = r2(splits.filter((s) => s?.mode === 'COD-Credit').reduce((t, s) => t + (Number(s.amount) || 0), 0));
    // A stored split that already says exactly this is kept as it is.
    const newSplits = splits.length && eq(storedNonCod, c0) && eq(storedCod, codDue)
      ? splits.map((s) => ({ mode: s.mode, amount: r2(s.amount) }))
      : codDue > 0.009 ? [...collectedSplits, { mode: 'COD-Credit', amount: codDue }] : collectedSplits;
    const partialAmount = codDue > 0.009 ? c0 : null;
    const isPartialPayment = codDue > 0.009 && c0 > 0.009;
    const R = receiptsOf(inv.id);
    const refunds = refundsOf(inv.id);
    const ret = r2(inv.totalReturnedAmount || 0);
    const due = Math.max(0, r2(codDue - R - ret + refunds));
    // What the customer paid beyond the (net) bill and never got back — not as
    // a refund row, not as a credit note (this release's, or one converted
    // above, or an earlier run's) — is store credit (client decision).
    const holder = inv.customerId ? customers.get(inv.customerId) : null;
    const notes = creditNotesForBill(holder?.creditHistory, inv.id);
    row.creditNotes = notes;
    const unpaidBack = r2((c0 + R) - (G - ret) - refunds - notes);
    let linked: string | null = null;
    if (unpaidBack > 0.009 && !inv.customerId) {
      // Store credit lives on a customer account. Link the bill to its customer
      // by phone — exactly what saving the bill would do — creating the account
      // when there is none yet.
      const phone = cleanPhone(inv.customerPhone);
      if (/^[6-9]\d{9}$/.test(phone)) {
        let cust = [...customers.values()].find((c) => cleanPhone(c.phone) === phone);
        if (!cust) {
          const now = new Date().toISOString();
          cust = { id: `cust-fix-${inv.id}`.slice(0, 120), name: (inv.customerName || 'Customer').trim(), phone: inv.customerPhone, address: inv.customerAddress || '', firstPurchaseDate: inv.date, purchaseCount: 1, totalSpent: G, notes: `Created by ${BY} to hold store credit for bill ${inv.invoiceNumber}`, createdAt: now, updatedAt: now, creditBalance: 0, creditHistory: [] };
          customers.set(cust.id, cust);
          customerCreates.push(cust);
        }
        inv.customerId = cust.id;
        linked = cust.id;
        for (const p of paymentCreates) if ((p.allocations as any[]).some((a) => a.refId === inv.id) && !p.partyId) p.partyId = cust.id;
        row.flags.push(`linked to customer ${cust.name} (${cust.id}) by phone to hold its store credit`);
      }
    }
    if (unpaidBack > 0.009) {
      const got = credit(inv.customerId, unpaidBack, `fix-overpay:${inv.id}`, `Over-payment on bill ${inv.invoiceNumber} kept as store credit`, { refNumber: inv.invoiceNumber, billId: inv.id });
      row.storeCreditAdded = r2(row.storeCreditAdded + got);
      if (got) row.creditNotes = r2(row.creditNotes + got);
      else row.flags.push(`CHECK: over-paid ${inr(unpaidBack)} but the bill has no customer account to hold it as store credit — pay it back or link the bill to a customer`);
    }
    row.newDue = due;
    row.newCreditOriginal = codDue;
    row.newPartialAmount = partialAmount;
    row.receipts = R;
    const same =
      JSON.stringify(newSplits) === JSON.stringify(splits.map((s) => ({ mode: s.mode, amount: r2(s.amount) }))) &&
      eq(inv.partialAmount, partialAmount) && !!inv.isPartialPayment === isPartialPayment &&
      eq(inv.creditOriginal, codDue) && inv.creditOriginal != null && eq(inv.balanceDue, due) && inv.balanceDue != null;
    const changes: string[] = [];
    if (!eq(inv.balanceDue, due) || inv.balanceDue == null) changes.push('due');
    if (!eq(inv.creditOriginal, codDue) || inv.creditOriginal == null) changes.push('creditOriginal');
    if (!eq(inv.partialAmount, partialAmount)) changes.push('partialAmount');
    if (row.refundsBackfilled) changes.push('refund backfilled');
    if (row.receiptsToppedUp) changes.push('receipt topped up');
    if (row.storeCreditAdded) changes.push('store credit');
    if (linked) changes.push('customer linked');
    row.action = same && !linked && !row.refundsBackfilled && !row.receiptsToppedUp && !row.storeCreditAdded ? 'no change' : `fix: ${changes.join(', ') || 'payment split'}`;
    if (!eq(inv.balanceDue ?? 0, due)) {
      row.reason = `${row.reason}; due = owed at billing ${inr(codDue)} − receipts ${inr(R)} − returns ${inr(ret)} + refunds ${inr(refunds)}`;
    }
    if (!same || linked) {
      const next = { ...inv, paymentSplits: newSplits, partialAmount, isPartialPayment };
      const cashDelta = r2(cashAtBilling(next) - cashAtBilling(inv));
      noteDay(inv.branchId, inv.date, `billing-day cash on ${inv.invoiceNumber} restored to ${inr(cashAtBilling(next))}`, cashDelta);
      invoiceUpdates.set(inv.id, { paymentSplits: newSplits as any, partialAmount, isPartialPayment, creditOriginal: codDue, balanceDue: due, ...(linked ? { customerId: linked } : {}) });
    }
  }
  progress('dues done');

  // ---- 6. sale-time cost on bill lines (E2E5-5) ----------------------------------
  const items: any[] = await tx.item.findMany({ select: { id: true, itemName: true, itemCode: true, purchasePrice: true } });
  const itemById = new Map(items.map((i) => [i.id, i]));
  const itemByCode = new Map(items.filter((i) => i.itemCode).map((i) => [i.itemCode, i]));
  const itemByName = new Map(items.map((i) => [String(i.itemName || '').toLowerCase(), i]));
  const buys = new Map<string, { date: string; ts: string; price: number }[]>();
  for (const po of (await tx.purchaseOrder.findMany({ select: { date: true, status: true, items: true, receivingHistory: true } })) as any[]) {
    if (po.status === 'Cancelled') continue;
    const hist: any[] = Array.isArray(po.receivingHistory) ? po.receivingHistory : [];
    const seen = new Set<string>();
    for (const ev of hist) {
      for (const l of Array.isArray(ev?.lines) ? ev.lines : []) {
        if (!(Number(l?.quantityReceivedThisEvent) > 0) || !(Number(l?.purchasePrice) > 0) || !l.itemId) continue;
        (buys.get(l.itemId) ?? (buys.set(l.itemId, []), buys.get(l.itemId)!)).push({ date: String(ev.date || po.date), ts: String(ev.timestamp || ev.date || po.date), price: Number(l.purchasePrice) });
        seen.add(l.itemId);
      }
    }
    // POs received before receiving history was kept: the PO's own date and price.
    for (const l of Array.isArray(po.items) ? po.items : []) {
      if (!l?.itemId || seen.has(l.itemId) || !(Number(l.receivedQuantity) > 0) || !(Number(l.purchasePrice) > 0)) continue;
      (buys.get(l.itemId) ?? (buys.set(l.itemId, []), buys.get(l.itemId)!)).push({ date: String(po.date), ts: String(po.date), price: Number(l.purchasePrice) });
    }
  }
  for (const list of buys.values()) list.sort((a, b) => a.ts.localeCompare(b.ts));
  const costAt = (itemId: string, date: string): { cost: number; from: 'purchase' | 'item' } => {
    const list = buys.get(itemId) || [];
    let hit: { price: number } | null = null;
    for (const b of list) if (b.date <= date) hit = b;
    return hit ? { cost: r2(hit.price), from: 'purchase' } : { cost: Number(itemById.get(itemId)?.purchasePrice) || 0, from: 'item' };
  };
  for (const inv of invoices) {
    const lines: any[] = Array.isArray(inv.items) ? inv.items : [];
    if (!lines.some((l) => l && l.unitCost == null)) continue;
    let n = 0;
    const next = lines.map((li) => {
      if (!li || li.unitCost != null) return li;
      n++;
      let cost = 0;
      let current = 0;
      if (li.isCombo && Array.isArray(li.comboComponents) && li.comboComponents.length) {
        for (const c of li.comboComponents) {
          const q = Number(c.quantity) || 0;
          const k = costAt(c.itemId, inv.date);
          cost += q * k.cost;
          current += q * (Number(itemById.get(c.itemId)?.purchasePrice) || 0);
          if (k.from === 'purchase') stats.unitCostFromPurchases++; else stats.unitCostFromItemCost++;
        }
      } else {
        const it = (li.itemId && itemById.get(li.itemId)) || (li.itemCode && itemByCode.get(li.itemCode)) || itemByName.get(String(li.itemName || '').toLowerCase());
        if (it) {
          const k = costAt(it.id, inv.date);
          cost = k.cost;
          current = Number(it.purchasePrice) || 0;
          if (k.from === 'purchase') stats.unitCostFromPurchases++; else stats.unitCostFromItemCost++;
        } else stats.unitCostFromItemCost++;
      }
      stats.cogsChangeVsCurrentCost = r2(stats.cogsChangeVsCurrentCost + (Number(li.quantity) || 0) * (cost - current));
      return { ...li, unitCost: r2(cost) };
    });
    stats.unitCostLines += n;
    const row = rowOf.get(inv.id)!;
    row.unitCostLines = n;
    invoiceUpdates.set(inv.id, { ...(invoiceUpdates.get(inv.id) || {}), items: next });
  }
  progress(`line costs done (${stats.unitCostLines} lines)`);

  // ---- write bills, receipts, refunds, credit ----------------------------------
  // Bills are written in batches of 500 rows per statement (UPG9-7).
  const money = [...invoiceUpdates].filter(([, d]) => 'balanceDue' in d)
    .map(([id, d]) => ({ id, ps: d.paymentSplits, pa: d.partialAmount, ip: d.isPartialPayment, co: d.creditOriginal, bd: d.balanceDue, cid: d.customerId ?? null }));
  const costs = [...invoiceUpdates].filter(([, d]) => 'items' in d).map(([id, d]) => ({ id, items: d.items }));
  for (let i = 0; i < money.length; i += 500) {
    await tx.$executeRawUnsafe(
      `UPDATE "Invoice" AS i SET "paymentSplits" = x.ps, "partialAmount" = x.pa, "isPartialPayment" = x.ip, "creditOriginal" = x.co,
         "balanceDue" = x.bd, "customerId" = COALESCE(x.cid, i."customerId")
       FROM jsonb_to_recordset($1::jsonb) AS x(id text, ps jsonb, pa double precision, ip boolean, co double precision, bd double precision, cid text)
       WHERE i.id = x.id`, JSON.stringify(money.slice(i, i + 500)));
    if ((i / 500) % 10 === 9 || i + 500 >= money.length) progress(`writing bills: ${Math.min(i + 500, money.length)}/${money.length}`);
  }
  for (let i = 0; i < costs.length; i += 500) {
    await tx.$executeRawUnsafe(
      `UPDATE "Invoice" AS i SET items = x.items FROM jsonb_to_recordset($1::jsonb) AS x(id text, items jsonb) WHERE i.id = x.id`,
      JSON.stringify(costs.slice(i, i + 500)));
    if ((i / 500) % 10 === 9 || i + 500 >= costs.length) progress(`writing line costs: ${Math.min(i + 500, costs.length)}/${costs.length}`);
  }
  for (const [id, p] of paymentUpdates) {
    if (paymentDeletes.has(id)) continue;
    await tx.payment.update({ where: { id }, data: { allocations: p.allocations, amount: p.amount, notes: p.notes ?? null } });
  }
  if (paymentDeletes.size) await tx.payment.deleteMany({ where: { id: { in: [...paymentDeletes] } } });
  if (paymentCreates.length) {
    const fresh = [];
    for (const p of paymentCreates) if (!(await tx.payment.findUnique({ where: { id: p.id }, select: { id: true } }))) fresh.push(p);
    if (fresh.length) await tx.payment.createMany({ data: fresh });
  }
  for (const c of customerCreates) {
    const { creditBalance, creditHistory, ...rest } = c;
    await tx.customer.create({ data: { ...rest, creditBalance, creditHistory } });
    dirtyCustomers.delete(c.id);
  }
  for (const id of dirtyCustomers) {
    const c = customers.get(id);
    await tx.customer.update({ where: { id }, data: { creditBalance: c.creditBalance, creditHistory: c.creditHistory } });
  }
  progress(`written: ${invoiceUpdates.size} bills, ${paymentUpdates.size} receipts, ${paymentCreates.length} refunds, ${paymentDeletes.size} rows removed, ${dirtyCustomers.size} customers`);

  // ---- 7. opening-stock history rows -------------------------------------------
  const stocks = await tx.branchStock.findMany();
  const logs = await tx.stockAdjustmentLog.findMany({ select: { id: true, itemId: true, branchId: true, quantityChange: true, timestamp: true } });
  const logIds = new Set(logs.map((l: any) => l.id));
  const openingRows = buildOpeningStockRows(stocks, logs, items, {
    idFor: (branchId, itemId) => `adj-open-fix-${branchId}-${itemId}`,
    timestampFor: (first) => {
      const floor = '2025-04-01T00:00:00.000Z';
      if (!first) return floor;
      const t = Date.parse(first);
      return Number.isNaN(t) ? floor : new Date(Math.min(t - 1, Date.parse(floor))).toISOString();
    },
    notes: `Opening balance — added by ${BY} so the stock history adds up to the stock on hand`,
    adjustedBy: `System (${BY})`,
  });
  const stockLog: any[] = [];
  const newStockRows: any[] = [];
  for (const r of openingRows) {
    if (logIds.has(r.id)) {
      stockLog.push({ ...r, note: 'CHECK: history drifted again after an earlier fix; not changed' });
      continue;
    }
    newStockRows.push(r);
    stockLog.push(r);
    stats.openingStockRows++;
    stats.openingStockUnits = r2(stats.openingStockUnits + r.quantityChange);
  }
  if (newStockRows.length) await tx.stockAdjustmentLog.createMany({ data: newStockRows });

  // ---- 8. salaries paid before salaries were money out ---------------------------
  // Builds before E2E5-12 marked a payroll row Paid without a Payment 'out' row,
  // so those salaries never reached the drawer, the Payments Log or the P&L.
  // One 'out' row per Paid payroll row that has none: the row's own mode and
  // amount, dated on the IST day it was paid, at the employee's branch.
  const salaryLog: any[] = [];
  const staffOuts = payments.filter((p) => p.type === 'out' && p.partyType === 'staff');
  const paidFor = new Set<string>();
  for (const p of staffOuts) for (const a of Array.isArray(p.allocations) ? p.allocations : []) if (a?.refId && Number(a.amount) > 0) paidFor.add(a.refId);
  const payIds = new Set(payments.map((p) => p.id));
  const paidRows = (await tx.payrollRecord.findMany({ where: { status: 'Paid' } })) as any[];
  const employeesAll = (await tx.employee.findMany({ select: { id: true, branchId: true, name: true, status: true } })) as any[];
  const employees = new Map(employeesAll.map((e) => [e.id, e]));
  const salaryRows: any[] = [];
  for (const row of paidRows.sort((a, b) => String(a.paidAt || '').localeCompare(String(b.paidAt || '')))) {
    if (paidFor.has(row.id)) continue;
    const id = `pay-fix-salary-${row.id}`.slice(0, 120);
    if (payIds.has(id)) continue;
    const amount = r2(row.finalPayable);
    const emp: any = employees.get(row.employeeId);
    const branchId = emp?.branchId || row.branchId;
    const entry: any = { payroll: row.id, employee: row.employeeName, month: row.month, amount, mode: row.paymentMode || 'Cash', paidAt: row.paidAt };
    if (!(amount > 0) || !branchId) {
      salaryLog.push({ ...entry, note: `${!(amount > 0) ? 'nothing paid (₹0) — listed only' : 'REVIEW: no branch — not changed'}` });
      continue;
    }
    const date = istDateOf(row.paidAt || row.updatedAt || undefined);
    const mode = isCash(row.paymentMode || 'Cash') || /cash/i.test(String(row.paymentMode || 'Cash')) ? 'Cash' : String(row.paymentMode);
    salaryRows.push({
      id, receiptNumber: await nextPayNo(date), type: 'out', partyType: 'staff', partyId: row.employeeId,
      partyName: row.employeeName || emp?.name || 'Staff', branchId, date, amount, paymentMode: mode,
      reference: row.paymentReference ?? null,
      notes: `Salary for ${row.month} — backfilled by ${BY} (paid before salaries were recorded as payments)`,
      allocations: [{ refId: row.id, refNumber: row.month, amount }],
      createdById: null, createdByName: BY, createdAt: new Date().toISOString(),
    });
    if (mode === 'Cash') noteDay(branchId, date, `backfilled cash salary for ${row.employeeName || emp?.name || row.employeeId} (${row.month})`, -amount);
    salaryLog.push({ ...entry, date, branchId, mode });
    stats.salaryRowsCreated++;
    stats.salaryAmountBackfilled = r2(stats.salaryAmountBackfilled + amount);
  }
  if (salaryRows.length) await tx.payment.createMany({ data: salaryRows });

  // ---- 9. master data: employee status, quotation status ----------------------
  for (const e of employeesAll) {
    const s = String(e.status || '').toLowerCase();
    const want = s === 'active' ? 'Active' : s === 'disabled' || s === 'inactive' ? 'Inactive' : null;
    if (want && e.status !== want) {
      await tx.employee.update({ where: { id: e.id }, data: { status: want } });
      stats.employeeStatusesFixed++;
    }
  }
  const liveSources = new Set(invoices.filter((i) => !i.isVoided && i.sourceEstimateId).map((i) => i.sourceEstimateId));
  const quotes = (await tx.estimate.findMany({ where: { OR: [{ status: null }, { status: '' }] }, select: { id: true } })) as any[];
  for (const q of quotes) {
    await tx.estimate.update({ where: { id: q.id }, data: { status: liveSources.has(q.id) ? 'Converted' : 'Open' } });
    stats.quoteStatusesSet++;
  }
  progress('stock, salaries and master data done');

  // ---- report ------------------------------------------------------------------
  const closedAfter = (await registerFigures(tx)).filter((r) => r.isClosed);
  const closedDays = closedBefore.map((c) => {
    const a = closedAfter.find((x) => x.branchId === c.branchId && x.date === c.date);
    const changed = !eq(c.closing, a?.closing);
    let why = '';
    if (changed) {
      const bits = dayNotes.get(`${c.branchId}|${c.date}`) || [];
      const explained = r2(bits.reduce((t, b) => t + b.amount, 0));
      const delta = r2((a?.closing ?? 0) - c.closing);
      why = bits.map((b) => `${b.text} (${b.amount > 0 ? '+' : '−'}${inr(Math.abs(b.amount))})`).join('; ');
      if (!eq(explained, delta)) why += `${why ? '; ' : ''}REVIEW: ${inr(r2(delta - explained))} of the change is not explained above`;
    }
    return { branchId: c.branchId, date: c.date, openingBefore: c.opening, openingAfter: a?.opening, closingBefore: c.closing, closingAfter: a?.closing, why };
  });
  // Closed days keep their stored opening. Where an older build stored an
  // opening that doesn't follow from the day before (e.g. it left out a legacy
  // part-payment, E2E8-6) the gap is listed so a Manager can decide whether to
  // override the first OPEN day's opening; the script never edits a closed day.
  const flow = new Map<string, number>();
  const addFlow = (b: string, d: string, v: number) => flow.set(`${b}|${d}`, (flow.get(`${b}|${d}`) || 0) + v);
  for (const i of (await tx.invoice.findMany({ select: { branchId: true, date: true, grandTotal: true, paymentSplits: true, paymentMode: true, isPartialPayment: true, partialAmount: true, isVoided: true } })) as any[]) addFlow(i.branchId, i.date, cashAtBilling(i));
  for (const p of (await tx.payment.findMany({ select: { branchId: true, date: true, type: true, amount: true, paymentMode: true } })) as any[]) {
    if (isCash(p.paymentMode)) addFlow(p.branchId, p.date, p.type === 'in' ? Number(p.amount) || 0 : p.type === 'out' ? -(Number(p.amount) || 0) : 0);
  }
  const flowByBranch = new Map<string, { d: string; v: number }[]>();
  for (const [k, v] of flow) { const [b, d] = k.split('|'); (flowByBranch.get(b) ?? (flowByBranch.set(b, []), flowByBranch.get(b)!)).push({ d, v }); }
  const allAfter = (await registerFigures(tx)).sort((a, b) => a.branchId.localeCompare(b.branchId) || a.date.localeCompare(b.date));
  const openingGaps: any[] = [];
  for (let i = 1; i < allAfter.length; i++) {
    const r = allAfter[i];
    const prev = allAfter[i - 1];
    if (!r.isClosed || prev.branchId !== r.branchId) continue;
    const between = r2((flowByBranch.get(r.branchId) || []).filter((x) => x.d > prev.date && x.d < r.date).reduce((t, x) => t + x.v, 0));
    const expected = r2(prev.closing + between);
    if (!eq(expected, r.opening)) openingGaps.push({ branchId: r.branchId, date: r.date, storedOpening: r.opening, carriedForward: expected, gap: r2(expected - r.opening), previousDay: prev.date });
  }
  const live = bills.filter((b) => !b.action.startsWith('skip'));
  const totals = {
    bills: bills.length,
    billsVoidedSkipped: bills.length - live.length,
    billsChanged: live.filter((b) => b.action !== 'no change' && !b.action.startsWith('no change')).length,
    billsNeedingReview: live.filter((b) => b.flags.some((f) => f.startsWith('REVIEW'))).length,
    billsToCheck: live.filter((b) => b.flags.some((f) => f.startsWith('CHECK'))).length,
    duesBefore: r2(live.reduce((t, b) => t + (Number(b.oldDue) || 0), 0)),
    duesAfter: r2(live.reduce((t, b) => t + (Number(b.newDue) || 0), 0)),
    refundRowsCreated: stats.refundRowsCreated,
    refundAmountBackfilled: stats.refundAmountBackfilled,
    adjustRefundRowsConvertedToCredit: stats.adjustRowsConverted,
    receiptMoneyToppedUpOntoBills: stats.receiptsToppedUp,
    onAccountReceiptsWithNoCustomer: stats.unassignedReceipts,
    refundsCutOnRequest: stats.refundsTrimmed,
    storeCreditAdded: stats.storeCreditAdded,
    openingStockRowsAdded: stats.openingStockRows,
    openingStockUnitsAdded: stats.openingStockUnits,
    salaryPaymentsBackfilled: stats.salaryRowsCreated,
    salaryAmountBackfilled: stats.salaryAmountBackfilled,
    lineCostsBackfilled: stats.unitCostLines,
    lineCostsFromPurchaseReceipts: stats.unitCostFromPurchases,
    lineCostsFromCurrentItemCost: stats.unitCostFromItemCost,
    costOfGoodsChangeVsCurrentCost: stats.cogsChangeVsCurrentCost,
    employeeStatusesNormalised: stats.employeeStatusesFixed,
    quotationStatusesSet: stats.quoteStatusesSet,
    closedDaysWhoseClosingChanges: closedDays.filter((d) => d.why).length,
    closedDaysWithOpeningGap: openingGaps.length,
  };
  const legacyAdvances = (await tx.pendingOrder.findMany()).filter((o: any) => (Number(o.advanceAmount) || 0) > 0 &&
    !payments.some((p) => p.type === 'in' && p.reference === o.orderNumber));
  progress('report done');
  return {
    totals, bills, receipts: extraLog, adjustRows: adjustLog, legacyTouched, stock: stockLog, salaries: salaryLog, closedDays, openingGaps,
    legacyPendingOrderAdvances: legacyAdvances.map((o: any) => ({ order: o.orderNumber, customer: o.customerName, amount: o.advanceAmount, status: o.status, note: 'advance recorded before advances became receipts — not changed; check by hand' })),
  };
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
