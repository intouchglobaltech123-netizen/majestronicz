/**
 * One-time correction of bills, refunds and stock history created by builds
 * before this release (UPG8-1 / UPG8-2 / UPG8-3 / CASH7-1 / CASH7-2 / CASH3-3 /
 * CASH3-6 / E2E8-6). Read docs/DEPLOY_EXISTING_DATA.md before running it.
 *
 *   DATABASE_URL=... npx tsx scripts/fix-existing-bills.ts                 # dry run (default): report only
 *   DATABASE_URL=... npx tsx scripts/fix-existing-bills.ts --apply --i-have-a-backup
 *
 * Options:
 *   --out <dir>            where to write the report (default ./fix-existing-bills-report)
 *   --overrides <file>     JSON for bills the report marks REVIEW and you have checked by hand:
 *                            { "<invoice number>": <collected at billing> }  or
 *                            { "<invoice number>": { "collectedAtBilling": 5000, "trimRefunds": true } }
 *                          trimRefunds: an older build paid out a refund larger than the
 *                          over-paid portion and staff confirm that cash never left the
 *                          drawer — the refund row(s) are cut down to the over-paid portion.
 *
 * What it does, for every bill that is not voided:
 *   1. Works out what was COLLECTED AT BILLING from the bill's original state —
 *      never from later receipts. Older builds rewrote `partialAmount` (and the
 *      COD-Credit split) on every receipt; those effects are reversed using the
 *      receipt rows, the audit trail and a replay of the old build's rules.
 *   2. Freezes that as the bill's payment split (paymentSplits / partialAmount /
 *      isPartialPayment), so the drawer reads the bill's own day exactly as it
 *      was billed and later receipts never move it again.
 *   3. Sets creditOriginal = grand total − collected at billing.
 *   4. Receipts whose money was not applied to any bill (older builds capped
 *      them at a wrong due, or they were taken "on account") are topped up onto
 *      the bill they were for, and any rest becomes the customer's store credit.
 *   5. Old returns with no refund row were paid back in cash (client decision):
 *      a Cash refund row is created for the over-paid portion only (what the
 *      current return logic would refund), dated on the return day. Old
 *      "Adjust (credit note)" refund rows become store credit instead.
 *   6. balanceDue = max(0, creditOriginal − receipts − returns + refunds); a
 *      remaining over-payment becomes store credit.
 *   7. Adds one 'Opening Stock' history row per item/branch whose stock history
 *      does not add up to the current stock, dated before its first movement.
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
import { registerFigures } from '../src/services/cash.service.js';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const APPLY = flag('--apply');
const OUT_DIR = resolve(opt('--out') || 'fix-existing-bills-report');
const OVERRIDES_FILE = opt('--overrides');
const MARKER_KEY = 'migration:fix-existing-bills';
const BY = 'fix-existing-bills';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const eq = (a: number | null | undefined, b: number | null | undefined) =>
  (a == null || Number(a) === 0) && (b == null || Number(b) === 0) ? true : a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.011;

class DryRunRollback extends Error {}

interface Split { mode: string; amount: number }
interface BillRow {
  invoiceNumber: string;
  invoiceId: string;
  branchId: string;
  date: string;
  customer: string;
  total: number;
  method: string;
  collectedAtBilling: number;
  receipts: number;
  receiptsToppedUp: number;
  returns: number;
  refundsExisting: number;
  refundsBackfilled: number;
  oldDue: number | null;
  newDue: number;
  oldCreditOriginal: number | null;
  newCreditOriginal: number;
  oldPartialAmount: number | null;
  newPartialAmount: number | null;
  storeCreditAdded: number;
  flags: string[];
  action: string;
}

function usage(msg?: string): never {
  if (msg) console.error(`\n${msg}\n`);
  console.error('Usage: DATABASE_URL=... npx tsx scripts/fix-existing-bills.ts [--apply --i-have-a-backup] [--out <dir>] [--overrides <file.json>]');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Replays of the old builds' bill updates, used to undo what they did to
// `partialAmount` on bills without a stored payment split.
// ---------------------------------------------------------------------------

/** A receipt event carries what the customer handed over (`paid`, when the row
 *  paid only this bill) and what the old build applied (`amount`), because the
 *  old build capped a receipt at the due it believed — a capped receipt pins
 *  down exactly what that due was. */
type Ev = { kind: 'receipt' | 'return'; at: string; amount: number; paid?: number };
type State = { partial: number | null; isPartial: boolean; bd: number; capsOk?: boolean };

function initialState(G: number, P0: number): State {
  if (P0 > 0.009 && P0 < G - 0.009) return { partial: r2(P0), isPartial: true, bd: r2(G - P0) };
  if (P0 >= G - 0.009) return { partial: null, isPartial: false, bd: 0 };
  return { partial: null, isPartial: false, bd: G };
}

/** Builds a0b710e … cf9b5b4: every receipt / return recomputed due from the
 *  (synthesised) split and rewrote partialAmount = net − due. */
function replayRecomputeBuild(inv: any, P0: number, events: Ev[]): State {
  const G = Number(inv.grandTotal) || 0;
  let st = initialState(G, P0);
  let R = 0;
  let ret = 0;
  let capsOk = true;
  const recompute = (s: State): State => {
    const oc = s.isPartial && s.partial && s.bd ? G - s.partial : inv.paymentMode === 'COD-Credit' ? G : 0;
    const due = Math.max(0, r2(oc - R - ret));
    const collected = Math.max(0, r2(G - ret - due));
    const isPartial = due > 0 && collected > 0;
    return { partial: isPartial ? collected : null, isPartial, bd: due };
  };
  for (const e of events) {
    if (e.kind === 'receipt') {
      // The due the build saw just before the receipt (same formula, receipt not yet stored).
      const oc = st.isPartial && st.partial && st.bd ? G - st.partial : inv.paymentMode === 'COD-Credit' ? G : 0;
      const dueBefore = Math.max(0, r2(oc - R - ret));
      if (e.paid != null && !eq(Math.min(e.paid, dueBefore), e.amount)) capsOk = false;
      R = r2(R + e.amount);
    } else ret = r2(ret + e.amount);
    st = recompute(st);
  }
  return { ...st, capsOk };
}

/** The first backend builds (before 2ad9621): a receipt on a bill without a
 *  split lowered balanceDue and set partialAmount = billed − due − returns. */
function replaySettleBuild(inv: any, P0: number, events: Ev[]): State {
  const G = Number(inv.grandTotal) || 0;
  let st = initialState(G, P0);
  let ret = 0;
  let capsOk = true;
  for (const e of events) {
    if (e.kind === 'return') { ret = r2(ret + e.amount); continue; }
    let due: number;
    if (st.isPartial) due = st.bd;
    else if (inv.transactionType === 'Credit' || inv.paymentMode === 'COD-Credit') due = st.bd;
    else due = st.bd > 0 ? st.bd : 0;
    due = Math.max(0, r2(due - ret));
    if (e.paid != null && !eq(Math.min(e.paid, due), e.amount)) capsOk = false;
    const newDue = Math.max(0, r2(due - Math.min(e.amount, due)));
    st = { partial: r2(G - newDue - ret), isPartial: newDue > 0, bd: newDue };
  }
  return { ...st, capsOk };
}

const sameState = (inv: any, st: State) =>
  st.capsOk !== false &&
  eq(st.bd, Number(inv.balanceDue) || 0) && (st.partial == null ? !Number(inv.partialAmount) : eq(st.partial, Number(inv.partialAmount)));

/** Cash moved on days strictly between `from` and `to` (bills' billing-day cash,
 *  cash receipts and cash paid out). */
async function cashBetween(tx: any, branchId: string, from: string, to: string): Promise<number> {
  const where = { branchId, date: { gt: from, lt: to } };
  const invs = await tx.invoice.findMany({ where });
  const pays = await tx.payment.findMany({ where });
  let t = invs.reduce((s: number, i: any) => s + cashAtBilling(i), 0);
  for (const p of pays) if (String(p.paymentMode || '').toLowerCase() === 'cash') t += p.type === 'in' ? Number(p.amount) || 0 : -(Number(p.amount) || 0);
  return t;
}

// ---------------------------------------------------------------------------

async function main() {
  if (!process.env.DATABASE_URL) usage('DATABASE_URL is not set.');
  if (APPLY && !flag('--i-have-a-backup')) {
    usage('--apply changes money records. Take a backup first (pg_dump -Fc, see docs/DEPLOY_EXISTING_DATA.md) and add --i-have-a-backup.');
  }
  const raw = OVERRIDES_FILE ? JSON.parse(readFileSync(OVERRIDES_FILE, 'utf8')) : {};
  const overrides: Record<string, Override> = {};
  for (const [k, v] of Object.entries(raw)) overrides[k] = typeof v === 'number' ? { collectedAtBilling: v } : (v as Override);
  const target = (() => {
    try { const u = new URL(process.env.DATABASE_URL!); return `${u.hostname}${u.port ? ':' + u.port : ''}${u.pathname}`; } catch { return '(unparsed DATABASE_URL)'; }
  })();
  console.log(`fix-existing-bills — ${APPLY ? 'APPLY' : 'DRY RUN (nothing will be changed)'} on ${target}`);

  let report: any = null;
  try {
    await prisma.$transaction(async (tx: any) => {
      report = await run(tx, overrides);
      if (!APPLY) throw new DryRunRollback();
      const prev = await tx.appConfig.findUnique({ where: { key: MARKER_KEY } });
      const runs = Array.isArray((prev?.value as any)?.runs) ? (prev!.value as any).runs : [];
      runs.push({ appliedAt: new Date().toISOString(), totals: report.totals });
      await tx.appConfig.upsert({ where: { key: MARKER_KEY }, create: { key: MARKER_KEY, value: { runs } as any }, update: { value: { runs } as any } });
    }, { timeout: 30 * 60 * 1000, maxWait: 60 * 1000 });
  } catch (e) {
    if (!(e instanceof DryRunRollback)) throw e;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = join(OUT_DIR, `${APPLY ? 'applied' : 'dry-run'}-${stamp}`);
  writeFileSync(`${base}.json`, JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', target, ...report }, null, 2));
  const cols: (keyof BillRow)[] = [
    'invoiceNumber', 'branchId', 'date', 'customer', 'total', 'method', 'collectedAtBilling', 'receipts', 'receiptsToppedUp', 'returns',
    'refundsExisting', 'refundsBackfilled', 'oldDue', 'newDue', 'oldCreditOriginal', 'newCreditOriginal', 'oldPartialAmount',
    'newPartialAmount', 'storeCreditAdded', 'flags', 'action',
  ];
  const csvCell = (v: any) => {
    const s = Array.isArray(v) ? v.join('; ') : v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  writeFileSync(`${base}.csv`, [cols.join(','), ...report.bills.map((b: BillRow) => cols.map((c) => csvCell(b[c])).join(','))].join('\n') + '\n');

  const t = report.totals;
  console.log('\nTotals');
  for (const [k, v] of Object.entries(t)) console.log(`  ${k.padEnd(34)} ${v}`);
  const review = report.bills.filter((b: BillRow) => b.flags.some((f) => f.startsWith('REVIEW')));
  if (review.length) {
    console.log(`\n${review.length} bill(s) need a look (flag REVIEW in the report):`);
    for (const b of review.slice(0, 30)) console.log(`  ${b.invoiceNumber}: ${b.flags.join('; ')}`);
  }
  const moved = report.closedDays.filter((d: any) => !eq(d.closingBefore, d.closingAfter));
  if (moved.length) {
    console.log(`\n${moved.length} closed day(s) whose computed closing changes (see closedDays in the JSON):`);
    for (const d of moved.slice(0, 30)) console.log(`  ${d.branchId} ${d.date}: ${d.closingBefore} -> ${d.closingAfter}  (${d.why})`);
  }
  if (report.openingGaps.length) {
    console.log(`\n${report.openingGaps.length} closed day(s) whose stored opening doesn't follow from the day before (left as they are — see openingGaps):`);
    for (const g of report.openingGaps.slice(0, 30)) console.log(`  ${g.branchId} ${g.date}: stored ${g.storedOpening}, carried forward ${g.carriedForward} (gap ${g.gap})`);
  }
  console.log(`\nReport: ${base}.csv and .json`);
  console.log(APPLY ? 'Applied in one transaction.' : 'Dry run — nothing was changed. Re-run with --apply --i-have-a-backup to write.');
}

interface Override { collectedAtBilling?: number; trimRefunds?: boolean }

async function run(tx: any, overrides: Record<string, Override>) {
  const closedBefore = (await registerFigures(tx)).filter((r) => r.isClosed);

  const invoices: any[] = await tx.invoice.findMany();
  const payments: any[] = await tx.payment.findMany();
  const audits: any[] = await tx.auditLog.findMany({ where: { action: 'sale.save' }, select: { entityId: true, timestamp: true, after: true } });
  const invById = new Map(invoices.map((i) => [i.id, i]));

  const allocTo = (p: any, invoiceId: string) =>
    (Array.isArray(p.allocations) ? p.allocations : []).filter((a: any) => a?.refId === invoiceId).reduce((t: number, a: any) => t + (Number(a.amount) || 0), 0);
  const receiptsOf = (id: string) => payments.filter((p) => p.type === 'in' && allocTo(p, id) > 0);
  const refundRowsOf = (id: string) => payments.filter((p) => p.type === 'out' && p.partyType === 'customer' && allocTo(p, id) > 0);

  const bills: BillRow[] = [];
  const C0 = new Map<string, number>();
  const stats = { unassignedReceipts: 0, refundsTrimmed: 0, refundRowsCreated: 0, refundAmountBackfilled: 0, adjustRowsConverted: 0, storeCreditAdded: 0, receiptsToppedUp: 0, openingStockRows: 0, openingStockUnits: 0 };
  const extraLog: any[] = [];

  // ---- 1. collected at billing ------------------------------------------------
  for (const inv of invoices) {
    const G = r2(inv.grandTotal);
    const splits: Split[] = Array.isArray(inv.paymentSplits) ? inv.paymentSplits : [];
    const nonCod = splits.filter((s) => s?.mode !== 'COD-Credit');
    const nonCodSum = r2(nonCod.reduce((t, s) => t + (Number(s.amount) || 0), 0));
    const receipts = receiptsOf(inv.id);
    const R = r2(receipts.reduce((t, p) => t + allocTo(p, inv.id), 0));
    const returns: any[] = Array.isArray(inv.returns) ? inv.returns : [];
    const outRows = refundRowsOf(inv.id);
    const flags: string[] = [];
    let method = '';
    let c0: number | null = null;

    const firstTouch = [...receipts.map((p) => p.createdAt), ...returns.map((r) => r.returnedAt)].filter(Boolean).sort()[0] || null;
    const audit = audits
      .filter((a) => a.entityId === inv.id || (a.after && (a.after as any).invoiceNumber === inv.invoiceNumber))
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

    if (overrides[inv.invoiceNumber]?.collectedAtBilling != null) {
      c0 = r2(Number(overrides[inv.invoiceNumber].collectedAtBilling));
      method = 'override';
    } else if (nonCodSum > 0.009) {
      // A real stored split: receipts in every build only ever touched its
      // COD-Credit part, so the collected modes are exactly what was taken.
      c0 = nonCodSum;
      method = 'split';
    } else if (splits.length) {
      // Only a COD-Credit split. The old billing form kept a part-payment on such
      // a bill only in partialAmount — but older receipts also wrote their own
      // running total there. The audit trail tells them apart.
      const a = fromAudit();
      const P = Number(inv.partialAmount) || 0;
      if (a != null) { c0 = a; method = 'audit'; }
      else if (!(inv.isPartialPayment && P > 0)) { c0 = 0; method = 'credit-split'; }
      else if (!receipts.length) { c0 = P; method = 'cod-part-payment'; }
      else if (eq(P, R)) { c0 = 0; method = 'credit-split (partialAmount was the receipts)'; }
      else { c0 = Math.max(0, r2(P - R)); method = 'cod-part-payment-minus-receipts'; flags.push('REVIEW: part-payment on a credit bill with receipts and no audit row'); }
    } else {
      // No stored split (the oldest bills, e.g. the seeded ones).
      const P = Number(inv.partialAmount) || 0;
      const a = fromAudit();
      const events: Ev[] = receipts
        .map((p) => {
          const allocs = Array.isArray(p.allocations) ? p.allocations : [];
          return { kind: 'receipt' as const, at: p.createdAt, amount: allocTo(p, inv.id), paid: allocs.length === 1 ? r2(p.amount) : undefined };
        })
        .sort((x, y) => x.at.localeCompare(y.at));
      const returnEvents: Ev[] = returns
        .filter((r) => outRows.some((o) => o.createdAt === r.returnedAt))
        .map((r) => ({ kind: 'return' as const, at: r.returnedAt, amount: Number(r.refundAmount) || 0 }));
      const asStored = inv.isPartialPayment && P > 0 ? Math.min(G, P) : inv.paymentMode === 'COD-Credit' ? 0 : G;
      if (a != null) { c0 = a; method = 'audit'; }
      else if (inv.creditOriginal != null && eq(Number(inv.creditOriginal), r2(G - asStored))) {
        // Only touched by this release, which anchors creditOriginal and never
        // rewrites partialAmount: the stored part-payment is the original.
        c0 = asStored;
        method = 'current-build';
      } else if (!receipts.length) {
        c0 = asStored;
        method = 'untouched';
        if (!inv.isPartialPayment && returns.length && inv.paymentMode === 'COD-Credit') flags.push('REVIEW: legacy credit bill with returns; part-payment (if any) not recorded');
      } else {
        const tries: { name: string; P0: number; ok: boolean }[] = [];
        for (const withReturns of [true, false]) {
          const evs = [...events, ...(withReturns ? returnEvents : [])].sort((x, y) => x.at.localeCompare(y.at));
          // In that build each event added the cumulative receipts to partialAmount.
          let cum = 0, add = 0;
          for (const e of evs) { if (e.kind === 'receipt') cum = r2(cum + e.amount); add = r2(add + cum); }
          const name = `replay-recompute-build${withReturns ? '' : ' (returns not replayed)'}`;
          const cands: number[] = [];
          if (inv.isPartialPayment && P > 0) cands.push(r2(P - add));
          // A receipt the old build capped (applied < handed over) fixes the due it
          // saw: in that build due_before(k) = G − P0 − Σ_{j<k} cum_j − cum_{k−1} − returns.
          let cumPrev = 0, addPrev = 0, retNow = 0;
          for (const e of evs) {
            if (e.kind === 'return') { retNow = r2(retNow + e.amount); addPrev = r2(addPrev + cumPrev); continue; }
            if (e.paid != null && e.paid - e.amount > 0.009) cands.push(r2(Number(inv.grandTotal) - addPrev - cumPrev - retNow - e.amount));
            cumPrev = r2(cumPrev + e.amount);
            addPrev = r2(addPrev + cumPrev);
          }
          for (const P0 of cands) {
            if (P0 >= 0 && P0 <= Number(inv.grandTotal)) tries.push({ name, P0, ok: sameState(inv, replayRecomputeBuild(inv, P0, evs)) });
          }
        }
        if (inv.isPartialPayment && P > 0) {
          const P0 = r2(P - R);
          if (P0 >= 0) tries.push({ name: 'replay-settle-build', P0, ok: sameState(inv, replaySettleBuild(inv, P0, [...events, ...returns.map((r) => ({ kind: 'return' as const, at: r.returnedAt, amount: Number(r.refundAmount) || 0 }))].sort((x, y) => x.at.localeCompare(y.at)))) });
        }
        const hit = tries.find((t) => t.ok);
        if (hit) { c0 = hit.P0; method = hit.name; }
        else if (!inv.isPartialPayment && eq(Number(inv.balanceDue) || 0, 0)) {
          // Shown as settled; the original part-payment can't be recovered. Keep it
          // settled: collected at billing = what is not covered by receipts/returns.
          c0 = Math.max(0, r2(G - R - (Number(inv.totalReturnedAmount) || 0)));
          method = 'settled-kept';
          flags.push('REVIEW: legacy settled bill — part-payment reconstructed so it stays settled');
        } else {
          c0 = Math.max(0, Math.min(G, r2(P - R)));
          method = 'partial-minus-receipts';
          flags.push('REVIEW: legacy bill history did not replay cleanly');
        }
      }
    }
    c0 = Math.max(0, Math.min(G, r2(c0 ?? 0)));
    C0.set(inv.id, c0);
    bills.push({
      invoiceNumber: inv.invoiceNumber, invoiceId: inv.id, branchId: inv.branchId, date: inv.date, customer: inv.customerName,
      total: G, method, collectedAtBilling: c0, receipts: R, receiptsToppedUp: 0, returns: r2(inv.totalReturnedAmount || 0),
      refundsExisting: r2(outRows.reduce((t, p) => t + allocTo(p, inv.id), 0)), refundsBackfilled: 0,
      oldDue: inv.balanceDue ?? null, newDue: 0, oldCreditOriginal: inv.creditOriginal ?? null, newCreditOriginal: r2(G - c0),
      oldPartialAmount: inv.partialAmount ?? null, newPartialAmount: null, storeCreditAdded: 0, flags,
      action: inv.isVoided ? 'skip (voided)' : '',
    });
  }
  const rowOf = new Map(bills.map((b) => [b.invoiceId, b]));

  // Helpers on the CURRENT (in-transaction) ledger.
  const liveReceipts = async (id: string) =>
    (await tx.payment.findMany({ where: { type: 'in' } })).reduce((t: number, p: any) => t + allocTo(p, id), 0);
  const liveRefunds = async (id: string) =>
    (await tx.payment.findMany({ where: { type: 'out', partyType: 'customer' } })).reduce((t: number, p: any) => t + allocTo(p, id), 0);
  const dueOf = async (inv: any) =>
    r2(r2(inv.grandTotal) - (C0.get(inv.id) || 0) - (await liveReceipts(inv.id)) - (Number(inv.totalReturnedAmount) || 0) + (await liveRefunds(inv.id)));
  const credit = async (customerId: string | null, amount: number, refId: string, reason: string, refNumber?: string): Promise<number> => {
    if (!customerId || amount <= 0.009) return 0;
    const cust = await tx.customer.findUnique({ where: { id: customerId } });
    if (!cust) return 0;
    const hist: any[] = Array.isArray(cust.creditHistory) ? cust.creditHistory : [];
    if (hist.some((h) => h?.refId === refId)) return 0; // already credited by an earlier run
    const balanceAfter = r2((Number(cust.creditBalance) || 0) + amount);
    hist.push({ id: `cr-fix-${refId}`, date: new Date().toISOString(), type: 'issued', amount: r2(amount), balanceAfter, reason, refId, refNumber: refNumber || null, by: BY });
    await tx.customer.update({ where: { id: customerId }, data: { creditBalance: balanceAfter, creditHistory: hist } });
    stats.storeCreditAdded = r2(stats.storeCreditAdded + amount);
    return r2(amount);
  };
  const nextPayNo = async (date: string) => {
    const like = `PAY-${date.slice(0, 7).replace('-', '')}-`;
    const rows = await tx.payment.findMany({ where: { receiptNumber: { startsWith: like }, type: 'out' }, select: { receiptNumber: true } });
    let max = 0;
    for (const r of rows) { const n = parseInt(String(r.receiptNumber).slice(like.length), 10); if (!Number.isNaN(n)) max = Math.max(max, n); }
    return `${like}${String(await nextPersistent(tx, `seq:pay:${like}`, max)).padStart(4, '0')}`;
  };

  // ---- 2. receipts whose money was never applied --------------------------------
  const inRows = payments.filter((p) => p.type === 'in' && p.partyType === 'customer' && !/store\s*credit/i.test(p.paymentMode || ''))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  for (const p of inRows) {
    const allocs: any[] = Array.isArray(p.allocations) ? p.allocations.map((a: any) => ({ ...a })) : [];
    let rest = r2((Number(p.amount) || 0) - allocs.reduce((t, a) => t + (Number(a.amount) || 0), 0));
    if (rest <= 0.009) continue;
    const hist = p.partyId ? ((await tx.customer.findUnique({ where: { id: p.partyId } }))?.creditHistory as any[]) || [] : [];
    if (hist.some((h) => h?.refId === p.id || h?.refId === `fix-unapplied:${p.id}`)) continue; // already held as credit
    let topped = 0;
    for (const a of allocs) {
      const inv = invById.get(a.refId);
      if (!inv || inv.isVoided || rest <= 0.009) continue;
      const due = await dueOf(inv);
      const add = r2(Math.min(rest, Math.max(0, due)));
      if (add <= 0.009) continue;
      a.amount = r2((Number(a.amount) || 0) + add);
      rest = r2(rest - add);
      topped = r2(topped + add);
      const row = rowOf.get(inv.id)!;
      row.receiptsToppedUp = r2(row.receiptsToppedUp + add);
      row.receipts = r2(row.receipts + add);
      // persist this allocation now, so the next bill/receipt sees it
      await tx.payment.update({ where: { id: p.id }, data: { allocations: allocs } });
    }
    if (topped > 0) { stats.receiptsToppedUp = r2(stats.receiptsToppedUp + topped); extraLog.push({ receipt: p.receiptNumber, toppedUp: topped }); }
    if (rest > 0.009) {
      const billCust = allocs.map((a) => invById.get(a.refId)?.customerId).find(Boolean) || null;
      const cid = p.partyId || billCust;
      const got = await credit(cid, rest, `fix-unapplied:${p.id}`, `Unapplied part of receipt ${p.receiptNumber} kept as store credit`, p.receiptNumber);
      extraLog.push({ receipt: p.receiptNumber, unapplied: rest, creditedTo: got ? cid : null, note: got ? 'store credit' : 'REVIEW: no customer to hold it' });
      if (!got) {
        for (const a of allocs) rowOf.get(a.refId)?.flags.push(`REVIEW: receipt ${p.receiptNumber} took ₹${rest} more than it applied and the bill has no customer account to hold it as credit`);
        if (!allocs.length) stats.unassignedReceipts++;
      }
    }
  }

  // ---- 3. refunds for old returns ---------------------------------------------
  for (const inv of invoices) {
    if (inv.isVoided) continue;
    const returns: any[] = Array.isArray(inv.returns) ? inv.returns : [];
    if (!returns.length) continue;
    const row = rowOf.get(inv.id)!;
    const outs = (await tx.payment.findMany({ where: { type: 'out', partyType: 'customer' } })).filter((p: any) => allocTo(p, inv.id) > 0);
    const G = r2(inv.grandTotal);
    const c0 = C0.get(inv.id) || 0;
    const receiptsNow = (await tx.payment.findMany({ where: { type: 'in' } })).filter((p: any) => allocTo(p, inv.id) > 0);
    // Over-paid portion of each return batch, as the current return logic computes it.
    const batches = new Map<string, number>();
    for (const r of returns) batches.set(String(r.returnedAt || inv.date), r2((batches.get(String(r.returnedAt || inv.date)) || 0) + (Number(r.refundAmount) || 0)));
    let retBefore = 0;
    const owed: { at: string; amount: number }[] = [];
    for (const [at, value] of [...batches.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const paid = r2(c0 + receiptsNow.filter((p: any) => String(p.createdAt) <= at || String(p.date) <= istDateOf(at)).reduce((t: number, p: any) => t + allocTo(p, inv.id), 0));
      const overBefore = Math.max(0, r2(paid - (G - retBefore)));
      const overAfter = Math.max(0, r2(paid - (G - retBefore - value)));
      retBefore = r2(retBefore + value);
      owed.push({ at, amount: Math.max(0, r2(overAfter - overBefore)) });
    }
    const owedTotal = r2(owed.reduce((t, o) => t + o.amount, 0));

    // Old 'Adjust' (credit-note) refund rows: not money out — the current model
    // keeps a credit note as store credit for the over-paid portion only.
    const adjustRows = outs.filter((p: any) => /adjust|credit/i.test(p.paymentMode || ''));
    for (const p of adjustRows) {
      const share = Math.min(allocTo(p, inv.id), owedTotal);
      const got = await credit(inv.customerId, share, `fix-adjust:${p.id}`, `Credit note on return #${inv.invoiceNumber} (was refund row ${p.receiptNumber})`, inv.invoiceNumber);
      if (share > 0.009 && !got && !inv.customerId) row.flags.push(`REVIEW: credit note ₹${share} on a bill with no customer`);
      row.storeCreditAdded = r2(row.storeCreditAdded + got);
      extraLog.push({ deletedAdjustRow: p });
      await tx.payment.delete({ where: { id: p.id } });
      stats.adjustRowsConverted++;
    }
    const cashOuts = outs.filter((p: any) => !/adjust|credit/i.test(p.paymentMode || ''));
    // A credit note issued by this release (store credit linked to the bill) is
    // the refund for that return — never add a cash refund on top of it.
    const holder = inv.customerId ? await tx.customer.findUnique({ where: { id: inv.customerId } }) : null;
    const creditNoted = ((holder?.creditHistory as any[]) || []).some((h) => h?.refId === inv.id && h?.type === 'issued');
    const hasCreditNoteHistory = adjustRows.length > 0 || creditNoted;
    if (cashOuts.length || hasCreditNoteHistory) {
      const existing = r2(cashOuts.reduce((t: number, p: any) => t + allocTo(p, inv.id), 0));
      if (existing > owedTotal + 0.01) {
        if (overrides[inv.invoiceNumber]?.trimRefunds) {
          // Staff confirmed the extra never left the drawer: cut the refund rows
          // (newest first) down to the over-paid portion.
          let excess = r2(existing - owedTotal);
          for (const p of [...cashOuts].sort((x: any, y: any) => String(y.createdAt).localeCompare(String(x.createdAt)))) {
            if (excess <= 0.009) break;
            const amt = allocTo(p, inv.id);
            const cut = Math.min(excess, amt);
            extraLog.push({ trimmedRefundRow: p.receiptNumber, by: cut });
            if (cut >= amt - 0.009) await tx.payment.delete({ where: { id: p.id } });
            else await tx.payment.update({ where: { id: p.id }, data: { amount: r2(p.amount - cut), allocations: [{ refId: inv.id, refNumber: inv.invoiceNumber, amount: r2(amt - cut) }], notes: `${p.notes || ''} [cut by ${BY}: ₹${cut} was never paid out]` } });
            excess = r2(excess - cut);
            stats.refundsTrimmed = r2(stats.refundsTrimmed + cut);
          }
          row.flags.push(`refund cut to the over-paid portion (₹${owedTotal}) on request`);
        } else if (inv.creditOriginal != null) {
          // Booked by this release's return logic (only the over-paid portion at
          // the time); a receipt deleted later explains the difference.
          row.flags.push(`refunds (₹${existing}) exceed today's over-paid portion (₹${owedTotal}) — booked by the current build, kept`);
        } else {
          row.flags.push(`REVIEW: an older build refunded ₹${existing} but only ₹${owedTotal} was over-paid — kept as recorded (the customer now owes the difference). If that cash never left the drawer, add { "trimRefunds": true } for this bill in --overrides.`);
        }
      }
      continue; // a refund was already recorded for this bill: never double-create
    }
    // Client decision: returns with no refund row were paid back in CASH.
    for (const o of owed) {
      if (o.amount <= 0.009) continue;
      const date = istDateOf(o.at);
      const id = `pay-fix-${inv.id}-${o.at.replace(/[^0-9]/g, '').slice(0, 17) || 'ret'}`.slice(0, 120);
      if (await tx.payment.findUnique({ where: { id } })) continue;
      await tx.payment.create({
        data: {
          id, receiptNumber: await nextPayNo(date), type: 'out', partyType: 'customer', partyId: inv.customerId ?? null,
          partyName: inv.customerName || 'Customer', branchId: inv.branchId, date, amount: o.amount, paymentMode: 'Cash',
          reference: inv.invoiceNumber ?? null,
          notes: `Refund on sale #${inv.invoiceNumber} — backfilled by ${BY} (older return, paid back in cash)`,
          allocations: [{ refId: inv.id, refNumber: inv.invoiceNumber, amount: o.amount }],
          createdById: null, createdByName: BY, createdAt: new Date().toISOString(),
        },
      });
      row.refundsBackfilled = r2(row.refundsBackfilled + o.amount);
      stats.refundRowsCreated++;
      stats.refundAmountBackfilled = r2(stats.refundAmountBackfilled + o.amount);
    }
  }

  // ---- 4. freeze the billing split, creditOriginal and the due ------------------
  for (const inv of invoices) {
    const row = rowOf.get(inv.id)!;
    if (inv.isVoided) continue;
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
    const R = r2(await liveReceipts(inv.id));
    const refunds = r2(await liveRefunds(inv.id));
    const ret = r2(inv.totalReturnedAmount || 0);
    const raw = r2(codDue - R - ret + refunds);
    const due = Math.max(0, raw);
    // Credit notes this release already issued for the bill are its refund.
    const holder = inv.customerId ? await tx.customer.findUnique({ where: { id: inv.customerId } }) : null;
    const creditNoted = r2(((holder?.creditHistory as any[]) || []).filter((h) => h?.refId === inv.id && h?.type === 'issued').reduce((t, h) => t + (Number(h.amount) || 0), 0));
    const overPaid = r2(raw + creditNoted);
    if (overPaid < -0.009) {
      // The customer has paid more than the bill is now worth and it was never
      // refunded: per the client decision, that is store credit.
      const got = await credit(inv.customerId, -overPaid, `fix-overpay:${inv.id}`, `Over-payment on bill ${inv.invoiceNumber} kept as store credit`, inv.invoiceNumber);
      row.storeCreditAdded = r2(row.storeCreditAdded + got);
      if (!got && !inv.customerId) row.flags.push(`REVIEW: over-paid ₹${-overPaid} on a bill with no customer`);
    }
    row.newDue = due;
    row.newCreditOriginal = codDue;
    row.newPartialAmount = partialAmount;
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
    row.action = same && !row.refundsBackfilled && !row.receiptsToppedUp && !row.storeCreditAdded ? 'no change' : `fix: ${changes.join(', ') || 'payment split'}`;
    if (!same) {
      await tx.invoice.update({
        where: { id: inv.id },
        data: { paymentSplits: newSplits as any, partialAmount, isPartialPayment, creditOriginal: codDue, balanceDue: due },
      });
    }
  }

  // ---- 5. opening-stock history rows -------------------------------------------
  const stocks = await tx.branchStock.findMany();
  const logs = await tx.stockAdjustmentLog.findMany({ select: { itemId: true, branchId: true, quantityChange: true, timestamp: true } });
  const items = await tx.item.findMany({ select: { id: true, itemName: true, itemCode: true } });
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
  for (const r of openingRows) {
    if (await tx.stockAdjustmentLog.findUnique({ where: { id: r.id } })) {
      stockLog.push({ ...r, note: 'REVIEW: history drifted again after an earlier fix; not changed' });
      continue;
    }
    await tx.stockAdjustmentLog.create({ data: r });
    stockLog.push(r);
    stats.openingStockRows++;
    stats.openingStockUnits = r2(stats.openingStockUnits + r.quantityChange);
  }

  // ---- report ------------------------------------------------------------------
  const closedAfter = (await registerFigures(tx)).filter((r) => r.isClosed);
  const why = (b: string, d: string) => {
    const bits: string[] = [];
    const billsThatDay = bills.filter((x) => x.branchId === b && x.date === d && !eq(x.oldPartialAmount, x.newPartialAmount));
    if (billsThatDay.length) bits.push(`billing-day cash restored on ${billsThatDay.map((x) => x.invoiceNumber).join(', ')}`);
    if (bills.some((x) => x.branchId === b && x.refundsBackfilled > 0)) bits.push('backfilled cash refund(s) for older returns');
    return bits.join('; ') || 'see bills';
  };
  const closedDays = closedBefore.map((c) => {
    const a = closedAfter.find((x) => x.branchId === c.branchId && x.date === c.date);
    const changed = !eq(c.closing, a?.closing);
    return { branchId: c.branchId, date: c.date, openingBefore: c.opening, openingAfter: a?.opening, closingBefore: c.closing, closingAfter: a?.closing, why: changed ? why(c.branchId, c.date) : '' };
  });
  // Closed days keep their stored opening. Where an older build stored an
  // opening that doesn't follow from the day before (e.g. it left out a legacy
  // part-payment, E2E8-6) the gap is listed so a Manager can decide whether to
  // override the first OPEN day's opening; the script never edits a closed day.
  const allAfter = await registerFigures(tx);
  const openingGaps: any[] = [];
  for (const r of allAfter) {
    if (!r.isClosed) continue;
    const prev = allAfter.filter((x) => x.branchId === r.branchId && x.date < r.date).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!prev) continue;
    const flow = r2(await cashBetween(tx, r.branchId, prev.date, r.date));
    const expected = r2(prev.closing + flow);
    if (!eq(expected, r.opening)) openingGaps.push({ branchId: r.branchId, date: r.date, storedOpening: r.opening, carriedForward: expected, gap: r2(expected - r.opening), previousDay: prev.date });
  }
  const live = bills.filter((b) => !b.action.startsWith('skip'));
  const totals = {
    bills: bills.length,
    billsVoidedSkipped: bills.length - live.length,
    billsChanged: live.filter((b) => b.action !== 'no change').length,
    billsNeedingReview: live.filter((b) => b.flags.some((f) => f.startsWith('REVIEW'))).length,
    duesBefore: r2(live.reduce((t, b) => t + (Number(b.oldDue) || 0), 0)),
    duesAfter: r2(live.reduce((t, b) => t + b.newDue, 0)),
    refundRowsCreated: stats.refundRowsCreated,
    refundAmountBackfilled: stats.refundAmountBackfilled,
    adjustRefundRowsConvertedToCredit: stats.adjustRowsConverted,
    receiptMoneyToppedUpOntoBills: stats.receiptsToppedUp,
    onAccountReceiptsWithNoCustomer: stats.unassignedReceipts,
    refundsCutOnRequest: stats.refundsTrimmed,
    storeCreditAdded: stats.storeCreditAdded,
    openingStockRowsAdded: stats.openingStockRows,
    openingStockUnitsAdded: stats.openingStockUnits,
    closedDaysWhoseClosingChanges: closedDays.filter((d) => d.why).length,
    closedDaysWithOpeningGap: openingGaps.length,
  };
  const legacyAdvances = (await tx.pendingOrder.findMany()).filter((o: any) => (Number(o.advanceAmount) || 0) > 0 &&
    !payments.some((p) => p.type === 'in' && p.reference === o.orderNumber));
  return {
    totals, bills, receipts: extraLog, stock: stockLog, closedDays, openingGaps,
    legacyPendingOrderAdvances: legacyAdvances.map((o: any) => ({ order: o.orderNumber, customer: o.customerName, amount: o.advanceAmount, status: o.status, note: 'REVIEW: advance recorded before advances became receipts — not changed' })),
  };
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
