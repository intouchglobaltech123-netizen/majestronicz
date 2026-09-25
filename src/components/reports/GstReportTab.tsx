import React, { useMemo, useState } from 'react';
import { useErp } from '../../context/ErpContext';
import { BranchScope } from '../../types';
import { exportToCsv } from '../../utils/csvExport';
import { exportToExcel, exportToPdf, ExportFormat } from '../../utils/exportHelpers';
import { ReportExportButtons } from './ReportExportButtons';
import { formatCurrency, cn } from '../../lib/utils';
import { FileSpreadsheet, Landmark, Percent, Hash, Users, Calculator } from 'lucide-react';

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
interface B2BRow {
  gstin: string;
  name: string;
  invoices: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export const GstReportTab: React.FC<Props> = ({ startDate, endDate, branchScope }) => {
  const { invoices, customers, purchaseOrders } = useErp();
  const [view, setView] = useState<'rate' | 'hsn' | 'b2b' | '3b'>('rate');

  // Input Tax Credit from supplier bills entered on POs (date-filtered by bill date).
  const itc = useMemo(() => {
    let total = 0;
    for (const po of purchaseOrders) {
      if (po.status === 'Cancelled') continue;
      if (branchScope !== 'all' && po.branchId !== branchScope) continue;
      const g = po.supplierBillGst || 0;
      if (g <= 0) continue;
      const d = po.supplierBillDate || po.date;
      if (startDate && d < startDate) continue;
      if (endDate && d > endDate) continue;
      total += g;
    }
    return Math.round(total * 100) / 100;
  }, [purchaseOrders, startDate, endDate, branchScope]);

  // Resolve a buyer's GSTIN from the customer master (invoices don't store it directly).
  const buyerGstin = (inv: any): string => {
    const phone = (inv.customerPhone || '').replace(/\D/g, '');
    const c = customers.find(
      (x) => (inv.customerId && x.id === inv.customerId) || (phone && (x.phone || '').replace(/\D/g, '') === phone)
    );
    return (c?.gstin || '').trim().toUpperCase();
  };

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

  const { rateRows, hsnRows, b2bRows, b2cs, totals } = useMemo(() => {
    const rateMap = new Map<number, RateRow>();
    const hsnMap = new Map<string, HsnRow>();
    const b2bMap = new Map<string, B2BRow>();
    const b2cs = { invoices: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
    const totals = { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0, invoices: filtered.length };

    for (const inv of filtered) {
      const inter = isInterState(inv.stateOfSupply);
      const gstin = buyerGstin(inv);
      let invTaxable = 0, invCgst = 0, invSgst = 0, invIgst = 0, invTotal = 0;
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
        invTaxable += taxable; invCgst += cgst; invSgst += sgst; invIgst += igst; invTotal += compTax;
      }
      // B2B (registered buyer, has GSTIN) vs B2CS (unregistered / consumer)
      if (gstin && gstin.length >= 15) {
        const b = b2bMap.get(gstin) || { gstin, name: inv.customerName || '', invoices: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
        b.invoices += 1; b.taxable += invTaxable; b.cgst += invCgst; b.sgst += invSgst; b.igst += invIgst; b.total += invTotal;
        b.name = inv.customerName || b.name;
        b2bMap.set(gstin, b);
      } else {
        b2cs.invoices += 1; b2cs.taxable += invTaxable; b2cs.cgst += invCgst; b2cs.sgst += invSgst; b2cs.igst += invIgst; b2cs.total += invTotal;
      }
    }
    return {
      rateRows: [...rateMap.values()].sort((a, b) => a.rate - b.rate),
      hsnRows: [...hsnMap.values()].sort((a, b) => b.taxable - a.taxable),
      b2bRows: [...b2bMap.values()].sort((a, b) => b.taxable - a.taxable),
      b2cs,
      totals,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

  const handleExport = (format: ExportFormat = 'csv') => {
    let filename = '', title = '', headers: string[] = [], rows: (string | number)[][] = [];
    if (view === 'rate') {
      filename = `gstr1-rate-summary_${startDate}_to_${endDate}`; title = `GSTR-1 Rate Summary ${startDate} to ${endDate}`;
      headers = ['GST Rate (%)', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Total Tax'];
      rows = rateRows.map((r) => [r.rate, r.taxable.toFixed(2), r.cgst.toFixed(2), r.sgst.toFixed(2), r.igst.toFixed(2), r.total.toFixed(2)]);
    } else if (view === 'hsn') {
      filename = `hsn-summary_${startDate}_to_${endDate}`; title = `HSN Summary ${startDate} to ${endDate}`;
      headers = ['HSN/SAC', 'Total Qty', 'GST Rates', 'Taxable Value', 'Tax Amount'];
      rows = hsnRows.map((h) => [h.hsn, h.qty, [...h.rates].sort().join('/'), h.taxable.toFixed(2), h.tax.toFixed(2)]);
    } else if (view === 'b2b') {
      filename = `gstr1-b2b_${startDate}_to_${endDate}`; title = `GSTR-1 B2B (by GSTIN) ${startDate} to ${endDate}`;
      headers = ['GSTIN', 'Party', 'Invoices', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Total Tax'];
      rows = b2bRows.map((b) => [b.gstin, b.name, b.invoices, b.taxable.toFixed(2), b.cgst.toFixed(2), b.sgst.toFixed(2), b.igst.toFixed(2), b.total.toFixed(2)]);
      rows.push(['', 'B2C (unregistered)', b2cs.invoices, b2cs.taxable.toFixed(2), b2cs.cgst.toFixed(2), b2cs.sgst.toFixed(2), b2cs.igst.toFixed(2), b2cs.total.toFixed(2)]);
    } else {
      filename = `gstr3b-worksheet_${startDate}_to_${endDate}`; title = `GSTR-3B Working Sheet ${startDate} to ${endDate}`;
      headers = ['Line', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Total Tax'];
      rows = [
        ['Outward taxable supplies (output tax)', totals.taxable.toFixed(2), totals.cgst.toFixed(2), totals.sgst.toFixed(2), totals.igst.toFixed(2), totals.total.toFixed(2)],
        ['Less: Input Tax Credit (from purchase bills)', '', '', '', '', itc.toFixed(2)],
        ['Net Tax Payable', '', '', '', '', Math.max(0, totals.total - itc).toFixed(2)],
      ];
    }
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
        <button
          onClick={() => setView('b2b')}
          className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors', view === 'b2b' ? 'bg-white text-blue-700 shadow-2xs' : 'hover:text-slate-800')}
        >
          <Users className="h-3.5 w-3.5" /> B2B / B2C
        </button>
        <button
          onClick={() => setView('3b')}
          className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors', view === '3b' ? 'bg-white text-blue-700 shadow-2xs' : 'hover:text-slate-800')}
        >
          <Calculator className="h-3.5 w-3.5" /> GSTR-3B sheet
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
          ) : view === 'hsn' ? (
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
          ) : view === 'b2b' ? (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[11px] tracking-wider">
                  <th className="py-3 px-4">GSTIN</th>
                  <th className="py-3 px-4">Party</th>
                  <th className="py-3 px-4 text-right">Inv</th>
                  <th className="py-3 px-4 text-right">Taxable</th>
                  <th className="py-3 px-4 text-right">CGST</th>
                  <th className="py-3 px-4 text-right">SGST</th>
                  <th className="py-3 px-4 text-right">IGST</th>
                  <th className="py-3 px-4 text-right">Total Tax</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800 font-mono">
                {b2bRows.map((b) => (
                  <tr key={b.gstin} className="hover:bg-slate-50/60">
                    <td className="py-3 px-4 font-bold">{b.gstin}</td>
                    <td className="py-3 px-4 font-sans">{b.name}</td>
                    <td className="py-3 px-4 text-right">{b.invoices}</td>
                    <td className="py-3 px-4 text-right">{formatCurrency(b.taxable)}</td>
                    <td className="py-3 px-4 text-right">{formatCurrency(b.cgst)}</td>
                    <td className="py-3 px-4 text-right">{formatCurrency(b.sgst)}</td>
                    <td className="py-3 px-4 text-right">{formatCurrency(b.igst)}</td>
                    <td className="py-3 px-4 text-right font-bold text-emerald-700">{formatCurrency(b.total)}</td>
                  </tr>
                ))}
                {/* B2C (unregistered / consumer) aggregate */}
                <tr className="bg-amber-50/40 border-t border-amber-100">
                  <td className="py-3 px-4 text-slate-400 font-sans">—</td>
                  <td className="py-3 px-4 font-sans font-bold text-amber-800">B2C (unregistered)</td>
                  <td className="py-3 px-4 text-right">{b2cs.invoices}</td>
                  <td className="py-3 px-4 text-right">{formatCurrency(b2cs.taxable)}</td>
                  <td className="py-3 px-4 text-right">{formatCurrency(b2cs.cgst)}</td>
                  <td className="py-3 px-4 text-right">{formatCurrency(b2cs.sgst)}</td>
                  <td className="py-3 px-4 text-right">{formatCurrency(b2cs.igst)}</td>
                  <td className="py-3 px-4 text-right font-bold text-emerald-700">{formatCurrency(b2cs.total)}</td>
                </tr>
                {b2bRows.length === 0 && b2cs.invoices === 0 && (
                  <tr><td colSpan={8} className="py-10 text-center text-slate-400 font-sans">No GST invoices in this period.</td></tr>
                )}
              </tbody>
            </table>
          ) : (
            /* GSTR-3B working sheet */
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[11px] tracking-wider">
                  <th className="py-3 px-4">Line</th>
                  <th className="py-3 px-4 text-right">Taxable</th>
                  <th className="py-3 px-4 text-right">CGST</th>
                  <th className="py-3 px-4 text-right">SGST</th>
                  <th className="py-3 px-4 text-right">IGST</th>
                  <th className="py-3 px-4 text-right">Total Tax</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800 font-mono">
                <tr>
                  <td className="py-3 px-4 font-sans font-bold">Outward taxable supplies (output tax)</td>
                  <td className="py-3 px-4 text-right">{formatCurrency(totals.taxable)}</td>
                  <td className="py-3 px-4 text-right">{formatCurrency(totals.cgst)}</td>
                  <td className="py-3 px-4 text-right">{formatCurrency(totals.sgst)}</td>
                  <td className="py-3 px-4 text-right">{formatCurrency(totals.igst)}</td>
                  <td className="py-3 px-4 text-right font-bold">{formatCurrency(totals.total)}</td>
                </tr>
                <tr className="text-slate-600">
                  <td className="py-3 px-4 font-sans">Less: Input Tax Credit (from purchase bills)</td>
                  <td className="py-3 px-4 text-right">—</td>
                  <td className="py-3 px-4 text-right">—</td>
                  <td className="py-3 px-4 text-right">—</td>
                  <td className="py-3 px-4 text-right">—</td>
                  <td className="py-3 px-4 text-right font-bold text-blue-700">(−) {formatCurrency(itc)}</td>
                </tr>
                <tr className="bg-emerald-50/50 border-t-2 border-emerald-200 font-bold">
                  <td className="py-3 px-4 font-sans">Net Tax Payable</td>
                  <td className="py-3 px-4 text-right">—</td>
                  <td className="py-3 px-4 text-right">—</td>
                  <td className="py-3 px-4 text-right">—</td>
                  <td className="py-3 px-4 text-right">—</td>
                  <td className="py-3 px-4 text-right text-emerald-700">{formatCurrency(Math.max(0, totals.total - itc))}</td>
                </tr>
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
