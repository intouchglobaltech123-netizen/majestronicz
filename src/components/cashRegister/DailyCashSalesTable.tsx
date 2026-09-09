import React from 'react';
import { Invoice } from '../../types';
import { formatCurrency } from '../../lib/utils';
import { Receipt, AlertCircle, FileText } from 'lucide-react';

interface Props {
  invoices: Invoice[];
  date: string;
  branchName: string;
}

export const DailyCashSalesTable: React.FC<Props> = ({ invoices, date, branchName }) => {
  // Compute column totals
  const totals = invoices.reduce(
    (acc, inv) => {
      // Amount collected for this invoice (if PP, use partialAmount collected)
      const rawAmount = inv.isPartialPayment && inv.partialAmount ? inv.partialAmount : inv.grandTotal;
      const returned = inv.totalReturnedAmount || 0;
      const amount = Math.max(0, rawAmount - returned);

      if (inv.paymentMode === 'HDFC') acc.hdfc += amount;
      else if (inv.paymentMode === 'Cash') acc.cash += amount;
      else if (inv.paymentMode === 'GPay') acc.gpay += amount;
      else if (inv.paymentMode === 'COD-Credit') acc.codCredit += amount;

      acc.allTotal += amount;
      return acc;
    },
    { hdfc: 0, cash: 0, gpay: 0, codCredit: 0, allTotal: 0 }
  );

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs flex flex-col h-full">
      {/* Table Header */}
      <div className="p-4 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700">
            <Receipt className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900">Sales Invoices Log</h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                Auto-Populated
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Sourced directly from billed invoices for {date} ({branchName})
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 font-semibold border border-slate-200">
            {invoices.length} Bill{invoices.length === 1 ? '' : 's'}
          </span>
          {invoices.some((i) => i.isPartialPayment) && (
            <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-300 font-bold text-[10px] flex items-center gap-1">
              <span>PP = Partial Payment</span>
            </span>
          )}
        </div>
      </div>

      {/* Table Body */}
      {invoices.length === 0 ? (
        <div className="flex-1 py-12 px-4 text-center flex flex-col items-center justify-center">
          <div className="h-12 w-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-2">
            <FileText className="h-6 w-6" />
          </div>
          <h4 className="text-xs font-bold text-slate-700">No Sales Recorded for this Date</h4>
          <p className="text-[11px] text-slate-400 max-w-sm mt-1">
            There are no sales invoices dated {date} for {branchName}. Invoices generated in the Sales Invoices desk will automatically appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto flex-1 max-h-[460px]">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-xs border-b border-slate-200 text-slate-600 uppercase text-[10px] font-bold tracking-wider">
              <tr>
                <th className="py-3 px-4">Bill No. & Customer</th>
                <th className="py-3 px-3 text-right">HDFC</th>
                <th className="py-3 px-3 text-right bg-emerald-50/50 text-emerald-900 border-x border-emerald-100/60">
                  Cash (Drawer)
                </th>
                <th className="py-3 px-3 text-right">GPay</th>
                <th className="py-3 px-3 text-right">COD / Credit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.map((inv) => {
                const rawAmount =
                  inv.isPartialPayment && inv.partialAmount ? inv.partialAmount : inv.grandTotal;
                const returned = inv.totalReturnedAmount || 0;
                const collectedAmount = Math.max(0, rawAmount - returned);

                return (
                  <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                    {/* Bill No. & Customer Details with PP badge */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-slate-900">
                          {inv.invoiceNumber}
                        </span>

                        {/* Partial Payment (PP) badge */}
                        {inv.isPartialPayment && (
                          <span
                            title={`Partial Payment collected: ₹${inv.partialAmount} of ₹${inv.grandTotal}. Balance due: ₹${inv.balanceDue}`}
                            className="px-1.5 py-0.5 rounded font-black font-mono text-[9px] bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs cursor-help"
                          >
                            PP
                          </span>
                        )}

                        {/* Returned Items badge */}
                        {returned > 0 && (
                          <span
                            title={`Item returned amount: ₹${returned.toLocaleString('en-IN')}`}
                            className="px-1.5 py-0.5 rounded font-mono font-bold text-[9px] bg-rose-100 text-rose-800 border border-rose-300 shadow-2xs cursor-help"
                          >
                            -₹{returned.toLocaleString('en-IN')} ret
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] text-slate-500 truncate max-w-xs mt-0.5 flex items-center gap-1.5">
                        <span className="truncate">{inv.customerName}</span>
                        {inv.isPartialPayment && (
                          <span className="text-[10px] text-amber-700 font-medium">
                            (Bal: ₹{inv.balanceDue?.toLocaleString('en-IN')})
                          </span>
                        )}
                      </div>
                    </td>

                    {/* HDFC Bank Column */}
                    <td className="py-3 px-3 text-right font-mono">
                      {inv.paymentMode === 'HDFC' ? (
                        <span className="font-bold text-slate-900">
                          {formatCurrency(collectedAmount)}
                        </span>
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                    </td>

                    {/* Cash (Drawer) Column */}
                    <td className="py-3 px-3 text-right font-mono bg-emerald-50/30 border-x border-emerald-100/50">
                      {inv.paymentMode === 'Cash' ? (
                        <span className="font-extrabold text-emerald-800">
                          {formatCurrency(collectedAmount)}
                        </span>
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                    </td>

                    {/* GPay Digital Column */}
                    <td className="py-3 px-3 text-right font-mono">
                      {inv.paymentMode === 'GPay' ? (
                        <span className="font-bold text-blue-700">
                          {formatCurrency(collectedAmount)}
                        </span>
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                    </td>

                    {/* COD / Credit Column */}
                    <td className="py-3 px-3 text-right font-mono">
                      {inv.paymentMode === 'COD-Credit' ? (
                        <div className="flex flex-col items-end">
                          <span className="font-bold text-indigo-900">
                            {formatCurrency(collectedAmount)}
                          </span>
                          {inv.isPartialPayment && (
                            <span className="text-[9px] text-indigo-500">
                              Partially Paid
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>

            {/* TOTAL SALE ROW */}
            <tfoot className="sticky bottom-0 z-10 bg-slate-100/95 backdrop-blur-xs border-t-2 border-slate-300 font-bold text-xs">
              <tr>
                <td className="py-3 px-4 text-slate-800 uppercase text-[11px] tracking-wider">
                  <div className="flex items-center gap-1.5">
                    <span>Total Sale</span>
                    <span className="text-[10px] text-slate-500 font-normal">
                      ({invoices.length} Bills)
                    </span>
                  </div>
                </td>
                {/* HDFC Total */}
                <td className="py-3 px-3 text-right font-mono text-slate-900">
                  {formatCurrency(totals.hdfc)}
                </td>
                {/* Cash Total */}
                <td className="py-3 px-3 text-right font-mono text-emerald-800 bg-emerald-100/60 border-x border-emerald-200">
                  {formatCurrency(totals.cash)}
                </td>
                {/* GPay Total */}
                <td className="py-3 px-3 text-right font-mono text-blue-700">
                  {formatCurrency(totals.gpay)}
                </td>
                {/* COD / Credit Total */}
                <td className="py-3 px-3 text-right font-mono text-indigo-900">
                  {formatCurrency(totals.codCredit)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Helper Footer */}
      <div className="p-3 border-t border-slate-100 bg-slate-50 text-[11px] text-slate-500 flex items-center justify-between">
        <span className="flex items-center gap-1">
          <AlertCircle className="h-3 w-3 text-slate-400" />
          <span>Read-only invoice mirror</span>
        </span>
        <span className="font-bold text-slate-700">
          Combined Sales Total: {formatCurrency(totals.allTotal)}
        </span>
      </div>
    </div>
  );
};
