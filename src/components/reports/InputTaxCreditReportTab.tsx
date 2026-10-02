import React, { useMemo } from 'react';
import { useErp } from '../../context/ErpContext';
import { BranchScope, BRANCHES } from '../../types';
import { inputTaxCredit } from '../../lib/reportMath';
import { formatCurrency } from '../../lib/utils';
import { exportToCsv } from '../../utils/csvExport';
import { exportToExcel, exportToPdf, ExportFormat } from '../../utils/exportHelpers';
import { ReportExportButtons } from './ReportExportButtons';
import { ReceiptText, AlertTriangle } from 'lucide-react';

interface Props {
  startDate: string;
  endDate: string;
  branchScope: BranchScope;
}

/** Purchase register / Input Tax Credit: supplier bills entered on POs, with claimable GST. */
export const InputTaxCreditReportTab: React.FC<Props> = ({ startDate, endDate, branchScope }) => {
  const { purchaseOrders } = useErp();

  // The ONE ITC function shared with GSTR-3B (PUR3-8 / E2E-4): supplier bills
  // less the GST reversed on damaged units billed back on debit notes.
  const { rows, totals, missingBills } = useMemo(() => {
    const itc = inputTaxCredit(
      purchaseOrders,
      (d) => !!d && (!startDate || d >= startDate) && (!endDate || d <= endDate),
      (b) => branchScope === 'all' || b === branchScope,
    );
    const rows = itc.rows.map((r) => ({
      billDate: r.date, billNo: r.kind === 'reversal' ? `${r.number} (debit note)` : r.number, vendor: r.vendor,
      gstin: r.gstin, poNumber: r.poNumber, taxable: r.taxable, gst: r.gst,
    }));
    return {
      rows,
      totals: { taxable: itc.billTaxable - itc.reversedTaxable, gst: itc.net, count: itc.rows.filter((r) => r.kind === 'bill').length, reversed: itc.reversedGst },
      missingBills: itc.missingBills,
    };
  }, [purchaseOrders, startDate, endDate, branchScope]);

  const handleExport = (fmt: ExportFormat) => {
    const headers = ['Bill Date', 'Bill No', 'Vendor', 'Vendor GSTIN', 'PO No', 'Taxable (₹)', 'GST / ITC (₹)'];
    const n2 = (v: number) => Math.round(v * 100) / 100;
    const data: (string | number)[][] = rows.map((r) => [r.billDate, r.billNo, r.vendor, r.gstin, r.poNumber, n2(r.taxable), n2(r.gst)]);
    data.push(['', '', '', '', 'TOTAL', n2(totals.taxable), n2(totals.gst)]);
    const name = `input-tax-credit_${startDate}_to_${endDate}`;
    if (fmt === 'csv') exportToCsv(name, headers, data);
    else if (fmt === 'excel') exportToExcel(name, headers, data);
    else exportToPdf(name, headers, data, 'Input Tax Credit Register');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <ReceiptText className="h-4 w-4 text-red-600" /> Input Tax Credit Register
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">Supplier bills entered on purchase orders — the GST here is your claimable ITC.</p>
        </div>
        <ReportExportButtons onExport={handleExport} disabled={rows.length === 0} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: 'Bills', value: String(totals.count), tone: 'text-slate-900' },
          { label: 'Taxable Value', value: formatCurrency(totals.taxable), tone: 'text-slate-900' },
          { label: totals.reversed > 0 ? `Input Tax Credit (after ₹${totals.reversed.toLocaleString('en-IN')} reversed)` : 'Input Tax Credit', value: formatCurrency(totals.gst), tone: 'text-emerald-700' },
        ].map((m) => (
          <div key={m.label} className="bg-white border border-slate-300 p-3 shadow-xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{m.label}</div>
            <div className={`text-lg font-bold font-mono mt-1 ${m.tone}`}>{m.value}</div>
          </div>
        ))}
      </div>

      {missingBills > 0 && (
        <div className="flex items-center gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-xs">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <span><strong>{missingBills}</strong> received PO(s) have no supplier bill entered yet — enter the bill in the PO to claim its ITC.</span>
        </div>
      )}

      <div className="bg-white border border-slate-300 shadow-xs overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse min-w-[760px]">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-bold uppercase text-[11px]">
              <th className="py-2.5 px-3">Bill Date</th>
              <th className="py-2.5 px-3">Bill No</th>
              <th className="py-2.5 px-3">Vendor</th>
              <th className="py-2.5 px-3">GSTIN</th>
              <th className="py-2.5 px-3">PO No</th>
              <th className="py-2.5 px-3 text-right">Taxable</th>
              <th className="py-2.5 px-3 text-right">GST / ITC</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="py-8 text-center text-slate-400">No supplier bills entered in this period.</td></tr>
            ) : rows.map((r, i) => (
              <tr key={i} className="hover:bg-slate-50/60">
                <td className="py-2 px-3 font-mono text-slate-600">{r.billDate}</td>
                <td className="py-2 px-3 font-mono">{r.billNo}</td>
                <td className="py-2 px-3">{r.vendor}</td>
                <td className="py-2 px-3 font-mono text-slate-500">{r.gstin || '—'}</td>
                <td className="py-2 px-3 font-mono text-slate-500">{BRANCHES.length ? r.poNumber : r.poNumber}</td>
                <td className="py-2 px-3 text-right font-mono">{formatCurrency(r.taxable)}</td>
                <td className="py-2 px-3 text-right font-mono font-bold text-emerald-700">{formatCurrency(r.gst)}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold font-mono">
                <td className="py-2.5 px-3 font-sans" colSpan={5}>Total ITC</td>
                <td className="py-2.5 px-3 text-right">{formatCurrency(totals.taxable)}</td>
                <td className="py-2.5 px-3 text-right text-emerald-700">{formatCurrency(totals.gst)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};
