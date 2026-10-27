import React, { useEffect, useMemo } from 'react';
import {
  Invoice,
  Payment,
  CompanyProfile,
  BRANCHES,
  getInvoicePaymentSplits,
  computeInvoiceFinance,
} from '../../types';
import { formatCurrency, formatDate } from '../../lib/utils';
import { toast } from 'sonner';
import {
  X,
  Wallet,
  History,
  Truck,
  FileJson,
  Printer,
  Download,
  Copy as CopyIcon,
  Plus,
  Pencil,
  RotateCcw,
  Ban,
  CheckCircle2,
} from 'lucide-react';

type EmployeeLite = { id: string; name?: string };

const resolveName = (idOrName: string | undefined, employees: EmployeeLite[]): string => {
  if (!idOrName) return 'Staff';
  const hit = employees.find((e) => e.id === idOrName);
  return hit?.name || idOrName;
};

const Shell: React.FC<{
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxW?: string;
}> = ({ title, subtitle, icon, onClose, children, footer, maxW = 'max-w-2xl' }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className={`bg-white rounded-xl ${maxW} w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]`}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3 bg-slate-50/70 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700 shrink-0">
              {icon}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900 truncate">{title}</h3>
              {subtitle && <p className="text-[11px] text-slate-500 truncate">{subtitle}</p>}
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-5">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2 shrink-0">{footer}</div>}
      </div>
    </div>
  );
};

/* ─────────────────────────── Payment History ─────────────────────────── */
export const PaymentHistoryModal: React.FC<{
  invoice: Invoice;
  payments: Payment[];
  onClose: () => void;
}> = ({ invoice, payments, onClose }) => {
  const rows = useMemo(() => {
    const out: { date: string; label: string; mode: string; amount: number; dir: 'in' | 'out' }[] = [];
    // What the bill itself collected on its own day (skip the unpaid credit part).
    for (const s of getInvoicePaymentSplits(invoice)) {
      if (!s.amount || s.mode === 'COD-Credit') continue;
      out.push({ date: invoice.date, label: 'Collected at billing', mode: s.mode, amount: s.amount, dir: 'in' });
    }
    // Later receipts / refunds recorded against this bill.
    for (const p of payments) {
      if (p.partyType !== 'customer') continue;
      const linked = (p.allocations || []).some((a) => a.refId === invoice.id || a.refNumber === invoice.invoiceNumber);
      if (!linked) continue;
      out.push({
        date: (p.date || p.createdAt || '').slice(0, 10),
        label: p.type === 'in' ? `Receipt ${p.receiptNumber || ''}`.trim() : `Refund ${p.receiptNumber || ''}`.trim(),
        mode: p.paymentMode || 'Cash',
        amount: Number(p.amount) || 0,
        dir: p.type,
      });
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [invoice, payments]);

  const fin = computeInvoiceFinance(invoice);

  return (
    <Shell
      title="Payment History"
      subtitle={`${invoice.invoiceNumber} • ${invoice.customerName || 'Walk-in'}`}
      icon={<Wallet className="h-4 w-4" />}
      onClose={onClose}
      footer={<button type="button" onClick={onClose} className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">Close</button>}
    >
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[
          { label: 'Grand Total', value: formatCurrency(invoice.grandTotal || 0), tone: 'text-slate-900' },
          { label: 'Received', value: formatCurrency(fin.received), tone: 'text-emerald-700' },
          { label: fin.customerCredit > 0 ? 'Credit to customer' : 'Balance Due', value: formatCurrency(fin.customerCredit > 0 ? fin.customerCredit : fin.due), tone: fin.customerCredit > 0 ? 'text-blue-700' : 'text-amber-700' },
        ].map((m) => (
          <div key={m.label} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{m.label}</div>
            <div className={`text-base font-bold font-mono mt-0.5 ${m.tone}`}>{m.value}</div>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="py-10 text-center text-xs text-slate-400">
          No payments recorded yet{fin.due > 0 ? ' — this bill is on credit.' : '.'}
        </div>
      ) : (
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[11px]">
              <th className="py-2 px-3">Date</th>
              <th className="py-2 px-3">Entry</th>
              <th className="py-2 px-3">Mode</th>
              <th className="py-2 px-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-slate-50/60">
                <td className="py-2 px-3 font-mono text-slate-600 whitespace-nowrap">{formatDate(r.date)}</td>
                <td className="py-2 px-3 text-slate-700">{r.label}</td>
                <td className="py-2 px-3"><span className="font-mono font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">{r.mode}</span></td>
                <td className={`py-2 px-3 text-right font-mono font-bold ${r.dir === 'out' ? 'text-rose-700' : 'text-emerald-700'}`}>
                  {r.dir === 'out' ? '−' : '+'}{formatCurrency(r.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
};

/* ─────────────────────────── View History (audit) ─────────────────────── */
export const InvoiceHistoryModal: React.FC<{
  invoice: Invoice;
  employees: EmployeeLite[];
  onClose: () => void;
}> = ({ invoice, employees, onClose }) => {
  const events = useMemo(() => {
    const out: { at: string; who: string; what: string; tone: string; icon: React.ReactNode }[] = [];
    if (invoice.createdAt) out.push({ at: invoice.createdAt, who: resolveName(invoice.createdById, employees), what: 'Bill created', tone: 'text-emerald-700', icon: <Plus className="h-3.5 w-3.5" /> });
    if (invoice.updatedAt && invoice.updatedAt.slice(0, 16) !== (invoice.createdAt || '').slice(0, 16))
      out.push({ at: invoice.updatedAt, who: 'Staff', what: 'Bill edited', tone: 'text-blue-700', icon: <Pencil className="h-3.5 w-3.5" /> });
    for (const rv of invoice.revisions || [])
      out.push({ at: rv.at, who: resolveName(rv.by, employees), what: `${rv.change}${rv.deltaAmount ? ` (${rv.deltaAmount > 0 ? '+' : ''}${formatCurrency(rv.deltaAmount)})` : ''}`, tone: 'text-blue-700', icon: <Pencil className="h-3.5 w-3.5" /> });
    for (const rt of invoice.returns || [])
      if ((rt.returnedQuantity || 0) > 0)
        out.push({ at: rt.returnedAt, who: resolveName(rt.processedBy, employees), what: `Returned ${rt.returnedQuantity} × ${rt.itemName} (refund ${formatCurrency(rt.refundAmount || 0)})`, tone: 'text-amber-700', icon: <RotateCcw className="h-3.5 w-3.5" /> });
    if (invoice.isVoided)
      out.push({ at: invoice.voidedAt || invoice.updatedAt || '', who: resolveName(invoice.voidedBy, employees), what: `Voided — ${invoice.voidReason || 'no reason given'}`, tone: 'text-rose-700', icon: <Ban className="h-3.5 w-3.5" /> });
    return out.sort((a, b) => (String(a.at) < String(b.at) ? -1 : 1));
  }, [invoice, employees]);

  const when = (iso: string) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <Shell
      title="Bill History"
      subtitle={`${invoice.invoiceNumber} • who created / edited / returned / voided this bill`}
      icon={<History className="h-4 w-4" />}
      onClose={onClose}
      footer={<button type="button" onClick={onClose} className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">Close</button>}
    >
      {invoice.salespersonName && (
        <div className="mb-3 text-[11px] text-slate-600 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">
          Salesperson: <strong className="text-violet-800">{invoice.salespersonName}</strong>
          {invoice.incentiveAmount ? ` • Incentive ${formatCurrency(invoice.incentiveAmount)}` : ''}
        </div>
      )}
      <ol className="relative border-l-2 border-slate-200 ml-2 space-y-4">
        {events.map((e, i) => (
          <li key={i} className="ml-4">
            <span className={`absolute -left-[9px] flex items-center justify-center h-4 w-4 rounded-full bg-white border-2 border-slate-200 ${e.tone}`}>
              <span className="scale-[0.55]">{e.icon}</span>
            </span>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className={`text-xs font-bold ${e.tone}`}>{e.what}</span>
              <span className="text-[11px] font-mono text-slate-400">{when(e.at)}</span>
            </div>
            <div className="text-[11px] text-slate-500">by {e.who}</div>
          </li>
        ))}
      </ol>
    </Shell>
  );
};

/* ─────────────────────────── Delivery Challan preview ──────────────────── */
const printDocHtml = (html: string) => {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) { document.body.removeChild(iframe); return; }
  doc.open();
  doc.write(html);
  doc.close();
  const cleanup = () => setTimeout(() => { try { document.body.removeChild(iframe); } catch { /* ignore */ } }, 500);
  iframe.contentWindow?.addEventListener('afterprint', cleanup);
  setTimeout(() => { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); setTimeout(cleanup, 1500); }, 250);
};

const buildChallanHtml = (inv: Invoice, company: CompanyProfile): string => {
  const branch = BRANCHES.find((b) => b.id === inv.branchId);
  const challanNo = `DC-${inv.invoiceNumber}`;
  const rows = inv.items.map((it, i) => `
    <tr>
      <td style="text-align:center">${i + 1}</td>
      <td>${it.itemName}${it.itemCode ? ` <span style="color:#666">(${it.itemCode})</span>` : ''}</td>
      <td style="text-align:center">${it.itemHSN || '-'}</td>
      <td style="text-align:center">${it.quantity}</td>
      <td style="text-align:center">${it.unit || 'PCS'}</td>
    </tr>`).join('');
  const totalQty = inv.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${challanNo}</title>
  <style>
    @page { size: A4 portrait; margin: 14mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color:#111; font-size:12px; margin:0; }
    .hd { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #111; padding-bottom:8px; }
    .title { text-align:center; font-weight:800; font-size:18px; letter-spacing:2px; margin:14px 0 4px; }
    .sub { text-align:center; color:#666; font-size:11px; margin-bottom:14px; }
    .meta { display:flex; justify-content:space-between; gap:16px; margin-bottom:12px; }
    .box { border:1px solid #bbb; padding:8px 10px; border-radius:4px; flex:1; }
    .lbl { font-size:10px; text-transform:uppercase; color:#888; font-weight:700; letter-spacing:.5px; }
    table { width:100%; border-collapse:collapse; margin-top:4px; }
    th,td { border:1px solid #ccc; padding:6px 8px; font-size:11px; }
    th { background:#f3f4f6; text-transform:uppercase; font-size:10px; letter-spacing:.5px; }
    .foot { display:flex; justify-content:space-between; margin-top:40px; }
    .sign { border-top:1px solid #111; padding-top:4px; width:180px; text-align:center; font-size:11px; }
    .note { margin-top:10px; font-size:10px; color:#777; }
  </style></head><body>
    <div class="hd">
      <div>
        <div style="font-weight:800;font-size:16px">${company.name || 'MAJESTRONICZ'}</div>
        <div style="color:#555;max-width:300px">${(branch?.location || company.address || '')}</div>
        ${company.gstin ? `<div style="color:#555">GSTIN: ${company.gstin}</div>` : ''}
        ${company.phone ? `<div style="color:#555">Ph: ${company.phone}</div>` : ''}
      </div>
      <div style="text-align:right">
        <div class="lbl">Branch</div>
        <div style="font-weight:700">${branch?.name || inv.branchId}</div>
      </div>
    </div>

    <div class="title">DELIVERY CHALLAN</div>
    <div class="sub">(Not a tax invoice — for delivery / transport of goods)</div>

    <div class="meta">
      <div class="box">
        <div class="lbl">Deliver To</div>
        <div style="font-weight:700">${inv.customerName || '-'}</div>
        ${inv.customerAddress ? `<div>${inv.customerAddress}</div>` : ''}
        ${inv.customerPhone ? `<div>Ph: ${inv.customerPhone}</div>` : ''}
        ${inv.buyerGstin ? `<div>GSTIN: ${inv.buyerGstin}</div>` : ''}
      </div>
      <div class="box" style="max-width:220px">
        <div class="lbl">Challan No</div><div style="font-weight:700">${challanNo}</div>
        <div class="lbl" style="margin-top:6px">Date</div><div>${formatDate(inv.date)}</div>
        <div class="lbl" style="margin-top:6px">Against Invoice</div><div>${inv.invoiceNumber}</div>
      </div>
    </div>

    <table>
      <thead><tr><th style="width:36px">#</th><th>Description of Goods</th><th style="width:90px">HSN</th><th style="width:60px">Qty</th><th style="width:60px">Unit</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="3" style="text-align:right;font-weight:700">Total Qty</td><td style="text-align:center;font-weight:700">${totalQty}</td><td></td></tr></tfoot>
    </table>

    <div class="note">Received the above goods in good condition.</div>
    <div class="foot">
      <div class="sign">Receiver's Signature</div>
      <div class="sign">For ${company.name || 'MAJESTRONICZ'}</div>
    </div>
  </body></html>`;
};

export const ChallanPreviewModal: React.FC<{
  invoice: Invoice;
  company: CompanyProfile;
  onClose: () => void;
}> = ({ invoice, company, onClose }) => {
  const branch = BRANCHES.find((b) => b.id === invoice.branchId);
  const totalQty = invoice.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
  return (
    <Shell
      title="Delivery Challan"
      subtitle={`DC-${invoice.invoiceNumber} • ${invoice.customerName || 'Walk-in'}`}
      icon={<Truck className="h-4 w-4" />}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">Close</button>
          <button type="button" onClick={() => printDocHtml(buildChallanHtml(invoice, company))} className="px-4 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-1.5">
            <Printer className="h-3.5 w-3.5" /> Print / Save PDF
          </button>
        </>
      }
    >
      <div className="border border-slate-200 rounded-lg p-4">
        <div className="flex items-start justify-between border-b border-slate-200 pb-2">
          <div>
            <div className="font-bold text-slate-900">{company.name || 'MAJESTRONICZ'}</div>
            <div className="text-[11px] text-slate-500 max-w-xs">{branch?.location || company.address}</div>
          </div>
          <div className="text-right text-[11px] text-slate-600"><span className="font-bold">{branch?.name || invoice.branchId}</span></div>
        </div>
        <div className="text-center font-extrabold tracking-widest text-slate-800 mt-3">DELIVERY CHALLAN</div>
        <div className="text-center text-[11px] text-slate-400 mb-3">(For delivery / transport of goods — not a tax invoice)</div>
        <div className="grid grid-cols-2 gap-3 text-xs mb-3">
          <div className="bg-slate-50 border border-slate-200 rounded p-2.5">
            <div className="text-[10px] font-bold uppercase text-slate-400">Deliver To</div>
            <div className="font-bold text-slate-800">{invoice.customerName || '-'}</div>
            {invoice.customerAddress && <div className="text-slate-600">{invoice.customerAddress}</div>}
            {invoice.customerPhone && <div className="text-slate-600">Ph: {invoice.customerPhone}</div>}
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded p-2.5">
            <div className="text-[10px] font-bold uppercase text-slate-400">Challan No</div>
            <div className="font-bold text-slate-800">DC-{invoice.invoiceNumber}</div>
            <div className="text-[10px] font-bold uppercase text-slate-400 mt-1">Date</div>
            <div className="text-slate-700">{formatDate(invoice.date)}</div>
          </div>
        </div>
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-100 text-slate-600 font-bold uppercase text-[10px]">
              <th className="py-1.5 px-2 border border-slate-200 w-8">#</th>
              <th className="py-1.5 px-2 border border-slate-200">Description</th>
              <th className="py-1.5 px-2 border border-slate-200 w-20">HSN</th>
              <th className="py-1.5 px-2 border border-slate-200 w-14 text-center">Qty</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((it, i) => (
              <tr key={it.id || i}>
                <td className="py-1.5 px-2 border border-slate-200 text-center">{i + 1}</td>
                <td className="py-1.5 px-2 border border-slate-200">{it.itemName}</td>
                <td className="py-1.5 px-2 border border-slate-200 text-center font-mono">{it.itemHSN || '-'}</td>
                <td className="py-1.5 px-2 border border-slate-200 text-center font-bold">{it.quantity}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td colSpan={3} className="py-1.5 px-2 border border-slate-200 text-right">Total Qty</td>
              <td className="py-1.5 px-2 border border-slate-200 text-center">{totalQty}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Shell>
  );
};

/* ─────────────────────────── Generate e-Invoice (NIC JSON) ─────────────── */
const extractPin = (addr?: string): string => {
  const m = String(addr || '').match(/\b(\d{6})\b/);
  return m ? m[1] : '';
};

const buildEInvoiceJson = (inv: Invoice, company: CompanyProfile) => {
  const sellerStateCode = (company.gstin || '').slice(0, 2) || '33';
  const buyerStateCode = (inv.buyerGstin || '').slice(0, 2) || (String(inv.stateOfSupply || '').match(/^(\d{2})/)?.[1] ?? sellerStateCode);
  const dt = (() => { const [y, m, d] = inv.date.split('-'); return d && m && y ? `${d}/${m}/${y}` : inv.date; })();
  const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

  return {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
    DocDtls: { Typ: 'INV', No: inv.invoiceNumber, Dt: dt },
    SellerDtls: {
      Gstin: company.gstin || '',
      LglNm: company.name || 'MAJESTRONICZ',
      Addr1: company.address || '',
      Loc: company.state || '',
      Pin: extractPin(company.address),
      Stcd: sellerStateCode,
      Ph: company.phone || undefined,
    },
    BuyerDtls: {
      Gstin: inv.buyerGstin || '',
      LglNm: inv.customerName || '',
      Pos: buyerStateCode,
      Addr1: inv.customerAddress || '',
      Loc: inv.stateOfSupply || '',
      Pin: extractPin(inv.customerAddress),
      Stcd: buyerStateCode,
    },
    ItemList: inv.items.map((it, i) => ({
      SlNo: String(i + 1),
      PrdDesc: it.itemName,
      IsServc: 'N',
      HsnCd: it.itemHSN || '',
      Qty: r2(it.quantity),
      Unit: (it.unit || 'PCS').toUpperCase().slice(0, 3),
      UnitPrice: r2(it.unitPrice),
      TotAmt: r2((it.unitPrice || 0) * (it.quantity || 0)),
      Discount: r2(it.discountAmount),
      AssAmt: r2(it.taxableAmount),
      GstRt: r2(it.taxRate),
      CgstAmt: r2(it.cgstAmount),
      SgstAmt: r2(it.sgstAmount),
      IgstAmt: 0,
      TotItemVal: r2(it.totalAmount),
    })),
    ValDtls: {
      AssVal: r2(inv.subtotal - (inv.overallDiscountAmount || 0)),
      CgstVal: r2(inv.totalCgst),
      SgstVal: r2(inv.totalSgst),
      IgstVal: 0,
      Discount: r2(inv.overallDiscountAmount),
      OthChrg: r2(inv.shippingCharges),
      RndOffAmt: r2(inv.roundOff),
      TotInvVal: r2(inv.grandTotal),
    },
  };
};

export const EInvoiceModal: React.FC<{
  invoice: Invoice;
  company: CompanyProfile;
  onClose: () => void;
}> = ({ invoice, company, onClose }) => {
  const applicable = invoice.withGst && !!invoice.buyerGstin;
  const json = useMemo(() => (applicable ? JSON.stringify(buildEInvoiceJson(invoice, company), null, 2) : ''), [invoice, company, applicable]);
  const missing: string[] = [];
  if (applicable) {
    if (!company.gstin) missing.push('your company GSTIN (Settings → Company)');
    if (!extractPin(company.address)) missing.push('your company PIN code (in the address)');
    if (!extractPin(invoice.customerAddress)) missing.push("the buyer's PIN code (in their address)");
  }

  const download = () => {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `einvoice-${invoice.invoiceNumber.replace(/[^\w-]/g, '_')}.json`;
    a.click(); URL.revokeObjectURL(url);
    toast.success('e-Invoice JSON downloaded');
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(json); toast.success('e-Invoice JSON copied'); }
    catch { toast.error('Copy failed — use Download instead'); }
  };

  return (
    <Shell
      title="Generate e-Invoice"
      subtitle={`${invoice.invoiceNumber} • Government e-invoice (IRN) JSON`}
      icon={<FileJson className="h-4 w-4" />}
      onClose={onClose}
      maxW="max-w-2xl"
      footer={applicable ? (
        <>
          <button type="button" onClick={onClose} className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">Close</button>
          <button type="button" onClick={copy} className="px-4 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1.5"><CopyIcon className="h-3.5 w-3.5" /> Copy</button>
          <button type="button" onClick={download} className="px-4 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-1.5"><Download className="h-3.5 w-3.5" /> Download JSON</button>
        </>
      ) : (
        <button type="button" onClick={onClose} className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">Close</button>
      )}
    >
      {!applicable ? (
        <div className="text-xs text-slate-700 space-y-3">
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <Ban className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-amber-900 mb-1">e-Invoice does not apply to this bill.</p>
              {!invoice.withGst
                ? <p>This is a <strong>non-GST bill</strong>. e-Invoice (IRN) is only for GST tax invoices.</p>
                : <p>This is a <strong>B2C sale</strong> (buyer has no GSTIN). An IRN / e-invoice is required only for <strong>B2B</strong> (a GST-registered buyer) and exports. B2C bills don't need one.</p>}
            </div>
          </div>
          <p className="text-slate-500">To make a B2B e-invoice, open the bill, add the buyer's GSTIN, keep GST ON, and save — then this option will generate the JSON.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-slate-700">
            <CheckCircle2 className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-blue-900 mb-1">This is the official e-invoice JSON (NIC schema 1.1).</p>
              <p>Upload it on the government portal <strong>einvoice1.gst.gov.in</strong> (Bulk Upload) to get the <strong>IRN + signed QR code</strong>. Fully automatic IRN (no portal step) needs a paid GSP/API key — tell us if you want that set up.</p>
            </div>
          </div>
          {missing.length > 0 && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
              <Ban className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div>The portal may ask you to fill: <strong>{missing.join(', ')}</strong>. The rest is filled from the bill.</div>
            </div>
          )}
          <pre className="text-[10.5px] leading-snug bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto max-h-72 overflow-y-auto font-mono">{json}</pre>
        </div>
      )}
    </Shell>
  );
};
