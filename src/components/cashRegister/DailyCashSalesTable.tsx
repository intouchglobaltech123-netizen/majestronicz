import React from 'react';
import { Invoice, Payment, PaymentMode, getInvoicePaymentSplits } from '../../types';
import { formatCurrency } from '../../lib/utils';
import { modeGroup } from '../../lib/paymentModes';
import { Receipt, AlertCircle, FileText, Split } from 'lucide-react';

interface Props {
  invoices: Invoice[];
  /** The day's customer receipts and refunds at this branch (Payment rows). */
  payments: Payment[];
  date: string;
  branchName: string;
}

type Cols = { hdfc: number; cash: number; gpay: number; credit: number };
const zero = (): Cols => ({ hdfc: 0, cash: 0, gpay: 0, credit: 0 });
const r2 = (n: number) => Math.round(n * 100) / 100;

/** The register column a receipt/refund mode lands in. */
const columnOf = (mode: string): keyof Cols | null => {
  const g = modeGroup(mode);
  if (g === 'Cash') return 'cash';
  if (g === 'GPay / UPI') return 'gpay';
  if (g === 'Bank / Card' || g === 'Other') return 'hdfc';
  return null; // store credit: no money moved today
};

/**
 * The day's money from customers, row by row, exactly as the drawer counts it
 * (E2E7-7 / SAL6-2): each bill shows what it took ON ITS DAY (its at-billing
 * split — a later return never rewrites it), each receipt is its own row under
 * the mode it was paid in, and each refund is its own (negative) row on the day
 * it was paid back. So the Cash column total is the drawer's
 * "cash sales + cash receipts − cash refunds".
 */
export const DailyCashSalesTable: React.FC<Props> = ({ invoices, payments, date, branchName }) => {
  const billTotals = zero();
  for (const inv of invoices) {
    for (const s of getInvoicePaymentSplits(inv)) {
      const amt = Number(s.amount) || 0;
      if (s.mode === 'HDFC') billTotals.hdfc += amt;
      else if (s.mode === 'Cash') billTotals.cash += amt;
      else if (s.mode === 'GPay') billTotals.gpay += amt;
      else if (s.mode === 'COD-Credit') billTotals.credit += amt;
    }
  }
  const ledgerRows = (payments || [])
    .filter((p) => p.partyType === 'customer' && columnOf(p.paymentMode))
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  const totals = { ...billTotals };
  for (const p of ledgerRows) {
    const col = columnOf(p.paymentMode)!;
    totals[col] += (p.type === 'in' ? 1 : -1) * (Number(p.amount) || 0);
  }
  const billsAll = r2(billTotals.hdfc + billTotals.cash + billTotals.gpay + billTotals.credit);

  const cell = (v: number, tone = 'text-slate-900') =>
    Math.abs(v) > 0.004 ? <span className={`font-bold ${v < 0 ? 'text-rose-700' : tone}`}>{formatCurrency(v)}</span> : <span className="text-slate-300">-</span>;

  return (
    <div className="bg-white border border-slate-300 rounded-none overflow-hidden shadow-xs flex flex-col h-full print:border-0 print:shadow-none">
      {/* Table Header */}
      <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-none bg-red-50 border border-red-200 flex items-center justify-center text-red-700 print:hidden">
            <Receipt className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900">Sales, Receipts &amp; Refunds</h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-none bg-slate-200 text-slate-800 border border-slate-300 print:hidden">
                Auto-Populated
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Bills dated {date} plus receipts and refunds paid that day ({branchName})
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="px-2.5 py-1 rounded-none bg-slate-100 text-slate-700 font-semibold border border-slate-300">
            {invoices.length} Bill{invoices.length === 1 ? '' : 's'}
            {ledgerRows.length > 0 && ` · ${ledgerRows.length} receipt/refund${ledgerRows.length === 1 ? '' : 's'}`}
          </span>
          {invoices.some((i) => i.isPartialPayment) && (
            <span className="px-2 py-0.5 rounded-none bg-amber-50 text-amber-800 border border-amber-300 font-bold text-[11px] flex items-center gap-1">
              <span>PP = Partial Payment</span>
            </span>
          )}
        </div>
      </div>

      {/* Table Body */}
      {invoices.length === 0 && ledgerRows.length === 0 ? (
        <div className="flex-1 py-12 px-4 text-center flex flex-col items-center justify-center">
          <div className="h-12 w-12 rounded-none bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 mb-2">
            <FileText className="h-6 w-6" />
          </div>
          <h4 className="text-xs font-bold text-slate-700">No Sales Recorded for this Date</h4>
          <p className="text-[11px] text-slate-400 max-w-sm mt-1">
            There are no sales invoices, receipts or refunds dated {date} for {branchName}.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto flex-1 max-h-[460px] print:max-h-none print:overflow-visible">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200 text-slate-600 uppercase text-[11px] font-bold tracking-wider print:static">
              <tr>
                <th className="py-3 px-4">Bill / Receipt &amp; Customer</th>
                <th className="py-3 px-3 text-right">HDFC / Bank</th>
                <th className="py-3 px-3 text-right bg-emerald-50/50 text-emerald-900 border-x border-emerald-100/60">
                  Cash (Drawer)
                </th>
                <th className="py-3 px-3 text-right">GPay / UPI</th>
                <th className="py-3 px-3 text-right">COD / Credit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.map((inv) => {
                const splits = getInvoicePaymentSplits(inv);
                const returned = inv.totalReturnedAmount || 0;
                const modeAmount = (mode: PaymentMode) =>
                  // Sum ALL splits of this mode — a bill can carry two splits of the
                  // same mode (CASH-3). Never netted by later returns (E2E7-7).
                  splits.filter((item) => item.mode === mode).reduce((sum, item) => sum + item.amount, 0);

                return (
                  <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-slate-900">{inv.invoiceNumber}</span>
                        {splits.length > 1 && (
                          <span
                            title={`Split Payment: ${splits.map((s) => `${s.mode}: ${formatCurrency(s.amount)}`).join(' + ')}`}
                            className="px-1.5 py-0.5 rounded font-bold font-mono text-[11px] bg-purple-100 text-purple-900 border border-purple-300 shadow-2xs cursor-help flex items-center gap-0.5"
                          >
                            <Split className="h-2.5 w-2.5" />
                            <span>Split</span>
                          </span>
                        )}
                        {inv.isPartialPayment && (
                          <span
                            title={`Collected at billing: ${formatCurrency(inv.partialAmount || 0)} of ${formatCurrency(inv.grandTotal)}. Balance due now: ${formatCurrency(inv.balanceDue || 0)}`}
                            className="px-1.5 py-0.5 rounded font-bold font-mono text-[11px] bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs cursor-help"
                          >
                            PP
                          </span>
                        )}
                        {returned > 0 && (
                          <span
                            title={`Goods returned later: ${formatCurrency(returned)}. Any money paid back shows as a refund row on the day it was paid.`}
                            className="px-1.5 py-0.5 rounded font-mono font-bold text-[11px] bg-rose-50 text-rose-800 border border-rose-200 shadow-2xs cursor-help"
                          >
                            returned {formatCurrency(returned)}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate max-w-xs mt-0.5">{inv.customerName}</div>
                    </td>
                    <td className="py-3 px-3 text-right font-mono">{cell(modeAmount('HDFC'))}</td>
                    <td className="py-3 px-3 text-right font-mono bg-emerald-50/30 border-x border-emerald-100/50">{cell(modeAmount('Cash'), 'text-emerald-800')}</td>
                    <td className="py-3 px-3 text-right font-mono">{cell(modeAmount('GPay'), 'text-slate-800')}</td>
                    <td className="py-3 px-3 text-right font-mono">{cell(modeAmount('COD-Credit'), 'text-amber-900')}</td>
                  </tr>
                );
              })}

              {ledgerRows.length > 0 && (
                <tr className="bg-slate-50 font-bold text-[11px] text-slate-700">
                  <td className="py-2 px-4 uppercase tracking-wider">Bills subtotal</td>
                  <td className="py-2 px-3 text-right font-mono">{formatCurrency(billTotals.hdfc)}</td>
                  <td className="py-2 px-3 text-right font-mono bg-emerald-50/40">{formatCurrency(billTotals.cash)}</td>
                  <td className="py-2 px-3 text-right font-mono">{formatCurrency(billTotals.gpay)}</td>
                  <td className="py-2 px-3 text-right font-mono">{formatCurrency(billTotals.credit)}</td>
                </tr>
              )}

              {ledgerRows.map((p) => {
                const col = columnOf(p.paymentMode)!;
                const v = (p.type === 'in' ? 1 : -1) * (Number(p.amount) || 0);
                const ref = (p.allocations || []).map((a) => a.refNumber).filter(Boolean).join(', ');
                return (
                  <tr key={p.id} className={p.type === 'in' ? 'bg-emerald-50/20' : 'bg-rose-50/30'}>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 border ${p.type === 'in' ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 'bg-rose-50 text-rose-800 border-rose-300'}`}>
                          {p.type === 'in' ? 'Receipt' : 'Refund'}
                        </span>
                        <span className="font-mono font-bold text-slate-800">{p.receiptNumber}</span>
                        <span className="text-[11px] text-slate-500">{p.paymentMode}{ref ? ` · ${ref}` : ''}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 truncate max-w-xs mt-0.5">{p.partyName}</div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">{col === 'hdfc' ? cell(v) : <span className="text-slate-300">-</span>}</td>
                    <td className="py-2.5 px-3 text-right font-mono bg-emerald-50/30 border-x border-emerald-100/50">{col === 'cash' ? cell(v, 'text-emerald-800') : <span className="text-slate-300">-</span>}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{col === 'gpay' ? cell(v, 'text-slate-800') : <span className="text-slate-300">-</span>}</td>
                    <td className="py-2.5 px-3 text-right font-mono"><span className="text-slate-300">-</span></td>
                  </tr>
                );
              })}
            </tbody>

            <tfoot className="sticky bottom-0 z-10 bg-slate-100 border-t-2 border-slate-300 font-bold text-xs print:static">
              <tr>
                <td className="py-3 px-4 text-slate-800 uppercase text-[11px] tracking-wider">
                  <div className="flex items-center gap-1.5">
                    <span>{ledgerRows.length ? 'Day total' : 'Total Sale'}</span>
                    <span className="text-[11px] text-slate-500 font-normal normal-case">
                      ({invoices.length} bills{ledgerRows.length ? ' + receipts − refunds' : ''})
                    </span>
                  </div>
                </td>
                <td className="py-3 px-3 text-right font-mono text-slate-900">{formatCurrency(totals.hdfc)}</td>
                <td className="py-3 px-3 text-right font-mono text-emerald-800 bg-emerald-100/60 border-x border-emerald-200">{formatCurrency(totals.cash)}</td>
                <td className="py-3 px-3 text-right font-mono text-slate-800">{formatCurrency(totals.gpay)}</td>
                <td className="py-3 px-3 text-right font-mono text-amber-900">{formatCurrency(totals.credit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Helper Footer */}
      <div className="p-3 border-t border-slate-100 bg-slate-50 text-[11px] text-slate-500 flex items-center justify-between">
        <span className="flex items-center gap-1">
          <AlertCircle className="h-3 w-3 text-slate-400" />
          <span>Read-only mirror of bills and the payment ledger</span>
        </span>
        <span className="font-bold text-slate-700">
          Bills total (all modes): {formatCurrency(billsAll)}
        </span>
      </div>
    </div>
  );
};
