import React, { useMemo, useState } from 'react';
import { useErp } from '../../context/ErpContext';
import { BranchScope } from '../../types';
import { exportToCsv } from '../../utils/csvExport';
import { exportToExcel, exportToPdf, ExportFormat } from '../../utils/exportHelpers';
import { ReportExportButtons } from './ReportExportButtons';
import { formatCurrency, cn } from '../../lib/utils';
import { FileSpreadsheet, Landmark, Percent, Hash } from 'lucide-react';

interface Props {
  startDate: string;
  endDate: string;
  branchScope: BranchScope;
}

const HOME_STATE = '33-Tamil Nadu';
const isInterState = (stateOfSupply?: string) => !!stateOfSupply && stateOfSupply !== HOME_STATE;

interface RateRow {
  rate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}
interface HsnRow {
  hsn: string;
  qty: number;
  taxable: number;
  tax: number;
  rates: Set<number>;
}

export const GstReportTab: React.FC<Props> = ({ startDate, endDate, branchScope }) => {
  const { invoices } = useErp();
  const [view, setView] = useState<'rate' | 'hsn'>('rate');

  const filtered = useMemo(
    () =>
      invoices.filter((inv) => {
        if (inv.isVoided) return false;
        if (!inv.withGst) return false; // GST report covers taxable (GST) invoices only
        if (startDate && inv.date < startDate) return false;
        if (endDate && inv.date > endDate) return false;
        if (branchScope !== 'all' && inv.branchId !== branchScope) return false;
        return true;
      }),
    [invoices, startDate, endDate, branchScope]
  );

  const { rateRows, hsnRows, totals } = useMemo(() => {
    const rateMap = new Map<number, RateRow>();
    const hsnMap = new Map<string, HsnRow>();
    const totals = { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0, invoices: filtered.length };

    for (const inv of filtered) {
      const inter = isInterState(inv.stateOfSupply);
      for (const li of inv.items || []) {
        const rate = li.taxRate || 0;
        const taxable = li.taxableAmount || 0;
        const tax = li.totalTax || 0;
        const cgst = inter ? 0 : li.cgstAmount || tax / 2;
        const sgst = inter ? 0 : li.sgstAmount || tax / 2;
        const igst = inter ? tax : 0;
        // Derive Total Tax from the components so the displayed CGST+SGST+IGST
        // always equals Total Tax (legacy lines can have a 0.01 half-split drift).
        const compTax = cgst + sgst + igst;

        const r = rateMap.get(rate) || { rate, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
        r.taxable += taxable; r.cgst += cgst; r.sgst += sgst; r.igst += igst; r.total += compTax;
        rateMap.set(rate, r);

        const hsnKey = li.itemHSN || '—';
        const h = hsnMap.get(hsnKey) || { hsn: hsnKey, qty: 0, taxable: 0, tax: 0, rates: new Set<number>() };
        h.qty += li.quantity || 0; h.taxable += taxable; h.tax += compTax; h.rates.add(rate);
        hsnMap.set(hsnKey, h);

        totals.taxable += taxable; totals.cgst += cgst; totals.sgst += sgst; totals.igst += igst; totals.total += compTax;
      }
    }
    return {
      rateRows: [...rateMap.values()].sort((a, b) => a.rate - b.rate),
      hsnRows: [...hsnMap.values()].sort((a, b) => b.taxable - a.taxable),
      totals,
    };
  }, [filtered]);

  const handleExport = (format: ExportFormat = 'csv') => {
    const isRate = view === 'rate';
    const filename = isRate ? `gstr1-rate-summary_${startDate}_to_${endDate}` : `hsn-summary_${startDate}_to_${endDate}`;
    const title = isRate ? `GSTR-1 Rate Summary ${startDate} to ${endDate}` : `HSN Summary ${startDate} to ${endDate}`;
    const headers = isRate
      ? ['GST Rate (%)', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Total Tax']
      : ['HSN/SAC', 'Total Qty', 'GST Rates', 'Taxable Value', 'Tax Amount'];
    const rows = isRate
      ? rateRows.map((r) => [r.rate, r.taxable.toFixed(2), r.cgst.toFixed(2), r.sgst.toFixed(2), r.igst.toFixed(2), r.total.toFixed(2)])
      : hsnRows.map((h) => [h.hsn, h.qty, [...h.rates].sort().join('/'), h.taxable.toFixed(2), h.tax.toFixed(2)]);
    if (format === 'excel') exportToExcel(filename, headers, rows);
    else if (format === 'pdf') exportToPdf(filename, headers, rows, title);
    else exportToCsv(`${filename}.csv`, headers, rows);
  };

  const kpis = [
    { label: 'Taxable Value', value: totals.taxable, tone: 'text-slate-900' },
    { label: 'CGST', value: totals.cgst, tone: 'text-blue-700' },
    { label: 'SGST', value: totals.sgst, tone: 'text-indigo-700' },
    { label: 'IGST', value: totals.igst, tone: 'text-violet-700' },
    { label: 'Total Tax', value: totals.total, tone: 'text-emerald-700' },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700">
            <Landmark className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-extrabold text-slate-900">GST Summary (GSTR-1 / GSTR-3B basis)</h3>
            <p className="text-xs text-slate-500">
              {totals.invoices} GST invoice(s) · {startDate} → {endDate} · outward tax liability
            </p>
          </div>
        </div>
        <ReportExportButtons onExport={handleExport} />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{k.label}</span>
            <div className={cn('text-lg font-bold mt-1 font-mono', k.tone)}>{formatCurrency(k.value)}</div>
          </div>
        ))}
      </div>

      {/* View toggle */}
      <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-xl w-fit text-xs font-bold text-slate-600">
        <button
          onClick={() => setView('rate')}
          className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors', view === 'rate' ? 'bg-white text-blue-700 shadow-2xs' : 'hover:text-slate-800')}
        >
          <Percent className="h-3.5 w-3.5" /> Rate-wise
        </button>
        <button
          onClick={() => setView('hsn')}
          className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors', view === 'hsn' ? 'bg-white text-blue-700 shadow-2xs' : 'hover:text-slate-800')}
        >
          <Hash className="h-3.5 w-3.5" /> HSN-wise
        </button>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          {view === 'rate' ? (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[11px] tracking-wider">
                  <th className="py-3 px-4">GST Rate</th>
                  <th className="py-3 px-4 text-right">Taxable Value</th>
                  <th className="py-3 px-4 text-right">CGST</th>
                  <th className="py-3 px-4 text-right">SGST</th>
                  <th className="py-3 px-4 text-right">IGST</th>
                  <th className="py-3 px-4 text-right">Total Tax</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800 font-mono">
                {rateRows.length === 0 ? (
                  <tr><td colSpan={6} className="py-10 text-center text-slate-400 font-sans">No GST invoices in this period.</td></tr>
                ) : (
                  rateRows.map((r) => (
                    <tr key={r.rate} className="hover:bg-slate-50/60">
                      <td className="py-3 px-4 font-bold font-sans">{r.rate}%</td>
                      <td className="py-3 px-4 text-right">{formatCurrency(r.taxable)}</td>
                      <td className="py-3 px-4 text-right">{formatCurrency(r.cgst)}</td>
                      <td className="py-3 px-4 text-right">{formatCurrency(r.sgst)}</td>
                      <td className="py-3 px-4 text-right">{formatCurrency(r.igst)}</td>
                      <td className="py-3 px-4 text-right font-bold text-emerald-700">{formatCurrency(r.total)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {rateRows.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold font-mono">
                    <td className="py-3 px-4 font-sans">Total</td>
                    <td className="py-3 px-4 text-right">{formatCurrency(totals.taxable)}</td>
                    <td className="py-3 px-4 text-right">{formatCurrency(totals.cgst)}</td>
                    <td className="py-3 px-4 text-right">{formatCurrency(totals.sgst)}</td>
                    <td className="py-3 px-4 text-right">{formatCurrency(totals.igst)}</td>
                    <td className="py-3 px-4 text-right text-emerald-700">{formatCurrency(totals.total)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[11px] tracking-wider">
                  <th className="py-3 px-4">HSN / SAC</th>
                  <th className="py-3 px-4 text-right">Qty</th>
                  <th className="py-3 px-4">GST Rate(s)</th>
                  <th className="py-3 px-4 text-right">Taxable Value</th>
                  <th className="py-3 px-4 text-right">Tax Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800 font-mono">
                {hsnRows.length === 0 ? (
                  <tr><td colSpan={5} className="py-10 text-center text-slate-400 font-sans">No GST invoices in this period.</td></tr>
                ) : (
                  hsnRows.map((h) => (
                    <tr key={h.hsn} className="hover:bg-slate-50/60">
                      <td className="py-3 px-4 font-bold">{h.hsn}</td>
                      <td className="py-3 px-4 text-right">{h.qty}</td>
                      <td className="py-3 px-4 font-sans">{[...h.rates].sort((a, b) => a - b).map((r) => `${r}%`).join(', ')}</td>
                      <td className="py-3 px-4 text-right">{formatCurrency(h.taxable)}</td>
                      <td className="py-3 px-4 text-right font-bold text-emerald-700">{formatCurrency(h.tax)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
        <FileSpreadsheet className="h-3.5 w-3.5" />
        Intra-state supplies ({HOME_STATE}) split into CGST + SGST; other states shown as IGST. Non-GST bills are excluded. For filing, reconcile against your GST portal.
      </p>
    </div>
  );
};
