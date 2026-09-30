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
  cashPaid: number;
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
  for (const p of payments || []) {
    if (p.branchId !== branchId || p.date !== date) continue;
    if ((p.paymentMode || '').toLowerCase() !== 'cash') continue;
    if (p.type === 'in') cashReceipts += Number(p.amount) || 0;
    else if (p.type === 'out') cashPaid += Number(p.amount) || 0;
  }

  const cashExpenses = (expenses || [])
    .filter((e) => expenseIsEffective(e))
    .reduce((s, e) => s + (Number(e.cashAmount) || 0), 0);

  const closing = round2(openingAmount + cashSales + cashReceipts - cashPaid - cashExpenses);
  return {
    cashSales: round2(cashSales),
    cashReceipts: round2(cashReceipts),
    cashPaid: round2(cashPaid),
    cashExpenses: round2(cashExpenses),
    closing,
  };
}
