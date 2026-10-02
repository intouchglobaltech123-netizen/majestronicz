import {
  Invoice,
  Payment,
  DailyCashRegister,
  getInvoicePaymentSplits,
  expenseIsEffective,
} from '../types';

/**
 * SINGLE SOURCE OF TRUTH for a day's cash drawer closing balance.
 *
 * Previously the register card, the next-day opening carry-forward and the
 * history modal each computed this differently (splits vs paymentMode-only,
 * proportional vs full-return, with/without the payment ledger, effective vs all
 * expenses), so one day showed three different figures (CASH2-3, CASH-4). They
 * now all call this.
 *
 * closing = opening
 *         + cash sales (net of returns, proportional per split)
 *         + cash receipts from customers (Payment ledger)
 *         − cash paid to vendors (Payment ledger)
 *         − effective cash expenses (pending/rejected excluded)
 */
export interface DayCashClosing {
  cashSales: number;
  cashReceipts: number;
  cashPaid: number;       // every cash payment out (= refunds + vendor + salaries)
  cashRefunds: number;    // cash paid back to customers for returns
  cashVendorPaid: number; // cash paid to suppliers
  cashSalaries: number;   // salaries paid in cash (E2E5-12)
  cashExpenses: number;
  closing: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeDayCashClosing(
  branchId: string,
  date: string,
  openingAmount: number,
  invoices: Invoice[],
  payments: Payment[],
  expenses: DailyCashRegister['expenses'],
): DayCashClosing {
  // Cash collected on bills of this day. Returns are NOT netted here — a refund
  // is booked as a Cash 'out' payment on the RETURN day (below), so netting it
  // here as well would double-count it and would retroactively change a closed
  // billing day (SAL4-12). Must mirror the backend invoiceCashCollected.
  const cashSales = (invoices || [])
    .filter((inv) => inv.branchId === branchId && inv.date === date && !inv.isVoided)
    .reduce((sum, inv) => {
      const splits = getInvoicePaymentSplits(inv);
      const cash = splits
        .filter((s) => s.mode === 'Cash')
        .reduce((c, s) => c + (Number(s.amount) || 0), 0);
      return sum + cash;
    }, 0);

  let cashReceipts = 0;
  let cashPaid = 0;
  let cashRefunds = 0;
  let cashSalaries = 0;
  for (const p of payments || []) {
    if (p.branchId !== branchId || p.date !== date) continue;
    if ((p.paymentMode || '').toLowerCase() !== 'cash') continue;
    if (p.type === 'in') cashReceipts += Number(p.amount) || 0;
    else if (p.type === 'out') {
      cashPaid += Number(p.amount) || 0;
      if (p.partyType === 'customer') cashRefunds += Number(p.amount) || 0;
      else if (p.partyType === 'staff') cashSalaries += Number(p.amount) || 0;
    }
  }

  const cashExpenses = (expenses || [])
    .filter((e) => expenseIsEffective(e))
    .reduce((s, e) => s + (Number(e.cashAmount) || 0), 0);

  const closing = round2(openingAmount + cashSales + cashReceipts - cashPaid - cashExpenses);
  return {
    cashSales: round2(cashSales),
    cashReceipts: round2(cashReceipts),
    cashPaid: round2(cashPaid),
    cashRefunds: round2(cashRefunds),
    cashVendorPaid: round2(cashPaid - cashRefunds - cashSalaries),
    cashSalaries: round2(cashSalaries),
    cashExpenses: round2(cashExpenses),
    closing,
  };
}

const DEFAULT_OPENING = (branchId: string) => (branchId === 'erode-hq' ? 12000 : 8000);
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

/**
 * Opening balances for one branch — the SAME carry-forward rule as the server
 * (backend cash.service.ts branchOpenings), so the screen and the stored figures
 * agree (CASH-1 / CASH-5 / CASH8-4 / RPT2-2):
 *   - a CLOSED day, or one whose opening was overridden, keeps its stored opening;
 *   - any other day opens at the previous register day's closing plus the cash
 *     movements of the register-less days in between;
 *   - a branch's first register opens at the default float plus all earlier cash.
 * Returns a lookup giving the opening of any date (with or without a register).
 * The opening of the day AFTER today is the cash in hand at the end of today.
 */
export function makeOpeningLookup(
  branchId: string,
  registers: DailyCashRegister[],
  invoices: Invoice[],
  payments: Payment[],
): (date: string) => number {
  const flow = new Map<string, number>();
  const add = (d: string, v: number) => flow.set(d, (flow.get(d) || 0) + v);
  for (const inv of invoices || []) {
    if (inv.branchId !== branchId || inv.isVoided) continue;
    const cash = getInvoicePaymentSplits(inv)
      .filter((s) => s.mode === 'Cash')
      .reduce((c, s) => c + (Number(s.amount) || 0), 0);
    if (cash) add(inv.date, Math.max(0, cash));
  }
  for (const p of payments || []) {
    if (p.branchId !== branchId) continue;
    if ((p.paymentMode || '').toLowerCase() !== 'cash') continue;
    if (p.type === 'in') add(p.date, Number(p.amount) || 0);
    else if (p.type === 'out') add(p.date, -(Number(p.amount) || 0));
  }
  const flowDays = [...flow.keys()].sort();
  const flowBetween = (from: string | null, to: string) =>
    flowDays.filter((d) => (from == null || d >= from) && d < to).reduce((t, d) => t + (flow.get(d) || 0), 0);

  const regs = (registers || [])
    .filter((r) => r.branchId === branchId)
    .sort((a, b) => (a.date === b.date ? String(a.id).localeCompare(String(b.id)) : a.date.localeCompare(b.date)));
  const points: { date: string; opening: number; closing: number }[] = [];
  let bal = DEFAULT_OPENING(branchId);
  let cursor: string | null = null;
  for (const r of regs) {
    if (points.length && points[points.length - 1].date === r.date) continue;
    bal += flowBetween(cursor, r.date);
    const opening = r.isClosed || r.isOpeningOverridden ? Number(r.openingAmount) || 0 : round2(bal);
    const expenses = (r.expenses || []).filter((e) => expenseIsEffective(e)).reduce((t, e) => t + (Number(e.cashAmount) || 0), 0);
    const closing = round2(opening + (flow.get(r.date) || 0) - expenses);
    points.push({ date: r.date, opening, closing });
    bal = closing;
    cursor = nextDay(r.date);
  }
  return (date: string) => {
    let prev: { date: string; opening: number; closing: number } | null = null;
    for (const p of points) {
      if (p.date === date) return round2(p.opening);
      if (p.date < date) prev = p;
    }
    if (!prev) return round2(DEFAULT_OPENING(branchId) + flowBetween(null, date));
    return round2(prev.closing + flowBetween(nextDay(prev.date), date));
  };
}

export const dayAfter = nextDay;
