import React, { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useErp } from '../../context/ErpContext';
import { Invoice, COMPANY_PROFILE, GstBreakdownRow, getInvoicePaymentSplits, gstStateInfo, BRANCHES, isInterStateSupply } from '../../types';
import { cn } from '../../lib/utils';
import { supplyTaxRows, hsnRateSummary, quantityByUnit, termsLines } from '../../lib/printTax';
import { numberToWordsIndian } from '../../lib/numberToWords';
import {
  X,
  Printer,
  Share2,
  Copy,
  Check,
  Building,
  AlertCircle,
  Download,
} from 'lucide-react';
import { toast } from 'sonner';
import { exportElementToPdfFile, printDocument } from '../../utils/pdfExport';
import { useFitScale } from '../../lib/useFitScale';

interface Props {
  invoice: Invoice | null;
  isOpen: boolean;
  onClose: () => void;
  onCreateNew?: () => void;
}

export const InvoicePdfModal: React.FC<Props> = ({ invoice, isOpen, onClose }) => {
  const { customers } = useErp();

  // Resolve the buyer's master record to surface GSTIN + State on the tax invoice.
  const buyerPhone = (invoice?.customerPhone || '').replace(/\D/g, '');
  const buyer = customers.find(
    (c) =>
      (invoice?.customerId && c.id === invoice.customerId) ||
      (buyerPhone && (c.phone || '').replace(/\D/g, '') === buyerPhone)
  );
  const buyerGstin = buyer?.gstin;
  const buyerState = gstStateInfo(buyerGstin);
  const [copied, setCopied] = React.useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = React.useState(false);
  // The preview zooms to fit narrow screens instead of clipping (V8 / INV4-14).
  const docRef = React.useRef<HTMLDivElement>(null);
  const fit = useFitScale(docRef, isOpen && !!invoice);

  // Inter-state supply prints IGST; intra-state prints CGST + SGST (SAL8-5).
  const interState = isInterStateSupply(invoice?.stateOfSupply);

  // Tax lines per distinct GST rate (SGST + CGST pairs, or one IGST line)
  const gstBreakdown = useMemo((): GstBreakdownRow[] => {
    if (!invoice || !invoice.withGst) return [];
    return supplyTaxRows(invoice.items, invoice.overallDiscountAmount || 0, invoice.subtotal || 0, interState);
  }, [invoice, interState]);

  // SAL6-10: Esc closes the preview (the close button says so).
  React.useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen || !invoice) return null;


  // Indian-style 2-decimal money formatter (e.g. 5,01,049.28) for the Tally layout.
  const n2 = (v: number) =>
    v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Quantities are totalled per unit, never across units (SAL4-15).
  const qtyTotalLabel = quantityByUnit(invoice.items);

  // HSN/SAC-wise tax summary: one row per HSN + rate (SAL4-8), net of overall discount.
  const hsnSummary = hsnRateSummary(invoice.items, invoice.overallDiscountAmount || 0, invoice.subtotal || 0, interState);

  // Every payment mode of a split bill, not just the first (SAL4-15).
  const paySplits = getInvoicePaymentSplits(invoice).filter((sp) => (Number(sp.amount) || 0) > 0);
  const modeLabel = (m: string) => (m === 'COD-Credit' ? 'Credit (due)' : m);
  const paymentSummary = paySplits.length > 1
    ? paySplits.map((sp) => `${modeLabel(sp.mode)} ₹${n2(Number(sp.amount) || 0)}`).join(' + ')
    : modeLabel(paySplits[0]?.mode || invoice.paymentMode || 'Cash');

  // Seller (dispatching branch) block resolved from the invoice branch.
  const sellerBranch = BRANCHES.find((b) => b.id === invoice.branchId);
  const companyState = gstStateInfo(COMPANY_PROFILE.gstin);

  // Print and "Save as PDF" share one layout: the browser's print pipeline
  // (#root hidden, the document flowing across A4 pages — SAL4-7, E2E5-17).
  const handlePrint = () => printDocument('invoice-printing');
  const handleSavePdf = () => printDocument('invoice-printing', { saveAsPdf: `${invoice.invoiceNumber}.pdf` });

  // Normalise an Indian mobile number for wa.me (expects country code, no +/spaces).
  const waNumber = (phone?: string | null): string => {
    const digits = (phone || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length === 10) return `91${digits}`;
    if (digits.length === 12 && digits.startsWith('91')) return digits;
    if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
    return digits;
  };

  const buildShareMessage = (): string => {
    const splits = getInvoicePaymentSplits(invoice);
    const splitSummary = splits.length > 1
      ? splits.map((s) => `${s.mode}: ₹${s.amount.toLocaleString('en-IN')}`).join(' + ')
      : invoice.paymentMode;
    const ratingLine = COMPANY_PROFILE.ratingLink
      ? `\n\nLoved our service? Please rate us here:\n${COMPANY_PROFILE.ratingLink}`
      : '';
    return `*TAX INVOICE — ${COMPANY_PROFILE.name}*\nInvoice No: ${invoice.invoiceNumber}\nDate: ${invoice.date}\nCustomer: ${invoice.customerName}\nGrand Total: ₹${invoice.grandTotal.toLocaleString('en-IN')}\nPayment: ${splitSummary}${invoice.isPartialPayment ? ` (Paid: ₹${invoice.partialAmount}, Balance Due: ₹${invoice.balanceDue})` : ''}\n\nThank you for doing business with ${COMPANY_PROFILE.name}!${ratingLine}`;
  };

  const openWhatsAppText = () => {
    const num = waNumber(invoice.customerPhone);
    const text = encodeURIComponent(buildShareMessage());
    const url = num
      ? `https://wa.me/${num}?text=${text}`
      : `https://api.whatsapp.com/send?text=${text}`;
    window.open(url, '_blank');
  };

  const handleShareWhatsApp = async () => {
    // On supported devices (mobile), attach the actual PDF via the Web Share API.
    const canShareFiles = typeof navigator !== 'undefined' && !!navigator.canShare;
    if (canShareFiles) {
      try {
        setIsDownloadingPdf(true);
        toast.loading('Preparing invoice PDF to share…', { id: 'invoice-share' });
        const file = await exportElementToPdfFile('printable-invoice-doc', `${invoice.invoiceNumber}.pdf`);
        toast.dismiss('invoice-share');
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: `Invoice ${invoice.invoiceNumber}`,
            text: buildShareMessage(),
          });
          return;
        }
      } catch (err: any) {
        // User cancelled the share sheet — do nothing further.
        if (err?.name === 'AbortError') { toast.dismiss('invoice-share'); return; }
        toast.dismiss('invoice-share');
      } finally {
        setIsDownloadingPdf(false);
      }
    }
    // Fallback (desktop / unsupported): open WhatsApp with the text + rating link.
    openWhatsAppText();
    toast.info('Opening WhatsApp with invoice details. Use “Save as PDF” to attach the bill.', { duration: 5000 });
  };

  const handleCopySummary = () => {
    if (!invoice) return;
    const splits = getInvoicePaymentSplits(invoice);
    const splitSummary = splits.length > 1
      ? splits.map((s) => `${s.mode}: ₹${s.amount.toLocaleString('en-IN')}`).join(' + ')
      : invoice.paymentMode;
    const summary = `${COMPANY_PROFILE.name} Invoice: ${invoice.invoiceNumber}\nDate: ${invoice.date}\nCustomer: ${invoice.customerName}\nTotal: ₹${invoice.grandTotal.toLocaleString('en-IN')}\nPayment: ${splitSummary} (${invoice.transactionType})\nItems: ${invoice.items.length}`;
    navigator.clipboard.writeText(summary);
    setCopied(true);
    toast.success('Invoice details copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  // One labelled cell of the Tally-style meta grid (right side of the header).
  const MetaCell: React.FC<{ label: string; value?: string; strong?: boolean }> = ({ label, value, strong }) => (
    <div className="px-2 py-1 border-b border-r border-black">
      <span className="text-[9px] text-black/60 block leading-none mb-0.5">{label}</span>
      <span className={cn('block leading-tight', strong ? 'font-bold' : 'font-medium')}>{value || ' '}</span>
    </div>
  );

  return createPortal(
    <div id="invoice-print-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/70 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto print:p-0 print:bg-white">
      <div className="bg-white border border-slate-300 rounded-none w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[96vh] print:max-h-none print:border-none print:shadow-none print:w-full print:rounded-none">
        {/* Top Metadata Header (Clean document metadata, No action buttons) */}
        <div className="px-6 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between print:hidden">
          <div className="flex items-center flex-wrap gap-2">
            <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
              Tax Invoice Document Preview
            </span>
            <span className="text-xs font-mono font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded-none border border-red-200">
              {invoice.invoiceNumber}
            </span>
            {invoice.isVoided ? (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-none bg-rose-100 text-rose-700 border border-rose-300 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                <span>VOIDED SALE</span>
              </span>
            ) : (
              <span
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded-none border ${
                  invoice.transactionType === 'Cash'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}
              >
                {invoice.transactionType} Sale
              </span>
            )}
            <span className="text-[10px] font-bold text-slate-600 bg-slate-200 px-1.5 py-0.5 rounded-none">
              Mode: {paymentSummary}
            </span>
            {invoice.withGst ? (
              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-none border border-emerald-200">
                GST Invoice
              </span>
            ) : (
              <span className="text-[10px] font-bold text-slate-600 bg-slate-200 px-1.5 py-0.5 rounded-none">
                Non-GST
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            title="Close Preview (Esc)"
            className="p-1.5 rounded-none text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Printable Document Body */}
        <div id="printable-invoice-doc" ref={docRef} className="p-3 sm:p-8 overflow-y-auto flex-1 bg-white text-slate-900 font-sans print:p-6 print:overflow-visible">
          <div className="doc-fit" style={fit.style}>
          {/* Voided Alert Banner */}
          {invoice.isVoided && (
            <div className="mb-4 p-3 rounded-none bg-rose-50 border border-rose-300 text-rose-800 text-xs flex items-center justify-between font-bold print:border-2 print:border-rose-600">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                <span>THIS SALE HAS BEEN VOIDED — REVERSED FROM WAREHOUSE STOCK</span>
              </div>
              {invoice.voidReason && (
                <span className="text-[11px] font-normal text-rose-700">
                  Reason: {invoice.voidReason}
                </span>
              )}
            </div>
          )}

          {/* ===== Classic Tally-style Tax Invoice document ===== */}
          {/* Title row */}
          <div className="flex items-center justify-between mb-1 text-black">
            <span className="text-[11px] font-semibold w-1/3">{invoice.transactionType === 'Credit' ? 'Credit' : 'Cash'}</span>
            <h1 className="text-base font-bold text-center w-1/3">{invoice.withGst ? 'Tax Invoice' : 'Bill of Supply'}</h1>
            <span className="text-[11px] font-semibold w-1/3 text-right">ORIGINAL FOR RECIPIENT</span>
          </div>

          {/* Outer bordered document */}
          <div className="border border-black text-black text-[11px] leading-tight">
            {/* Seller (left) + meta grid (right) */}
            <div className="grid grid-cols-2">
              {/* Seller / dispatching branch */}
              <div className="p-2 border-r border-black">
                <p className="text-sm font-bold uppercase">{COMPANY_PROFILE.name}</p>
                <p>{COMPANY_PROFILE.address}</p>
                <p className="mt-0.5">GSTIN/UIN: <span className="font-semibold">{COMPANY_PROFILE.gstin}</span></p>
                {companyState && <p>State Name : {companyState.state}, Code : {companyState.code}</p>}
                <p>Contact : {COMPANY_PROFILE.phone}</p>
                <p>E-Mail : {COMPANY_PROFILE.email}</p>
                {sellerBranch && <p className="mt-0.5 text-[10px] text-black/70">Dispatch Branch : {sellerBranch.name} ({sellerBranch.location})</p>}
              </div>
              {/* Document meta grid */}
              <div className="grid grid-cols-2">
                <MetaCell label="Invoice No." value={invoice.invoiceNumber} strong />
                <MetaCell label="Dated" value={invoice.date} strong />
                <MetaCell label="Delivery Note" value="" />
                <MetaCell label="Mode/Terms of Payment" value={paymentSummary} />
                <MetaCell label="Reference No. & Date." value="" />
                <MetaCell label="Other References" value={invoice.sourceEstimateNumber || ''} />
                <MetaCell label="Buyer's Order No." value="" />
                <MetaCell label="Dated" value="" />
                <MetaCell label="Dispatched through" value={sellerBranch?.name || ''} />
                <MetaCell label="Place of Supply" value={invoice.stateOfSupply || buyerState?.state || ''} />
                <div className="col-span-2 px-2 py-1">
                  <span className="text-[9px] text-black/60 block leading-none mb-0.5">Terms of Delivery</span>
                  <span className="block leading-tight">&nbsp;</span>
                </div>
              </div>
            </div>

            {/* Buyer (Bill to) */}
            <div className="border-t border-black p-2">
              <p className="text-[9px] text-black/60">Buyer (Bill to)</p>
              <p className="text-sm font-bold">{invoice.customerName}</p>
              {invoice.customerAddress && <p>{invoice.customerAddress}</p>}
              {buyerGstin && <p className="mt-0.5">GSTIN/UIN&nbsp;: <span className="font-semibold">{buyerGstin}</span></p>}
              {buyerState && <p>State Name : {buyerState.state}, Code : {buyerState.code}</p>}
              {invoice.customerPhone && <p>Contact&nbsp;&nbsp;&nbsp;: {invoice.customerPhone}</p>}
            </div>

            {/* Items table */}
            <table className="w-full border-collapse border-t border-black">
              <thead>
                <tr className="border-b border-black text-[10px]">
                  <th className="border-r border-black px-1 py-1 w-9 text-center align-middle">Sl<br/>No.</th>
                  <th className="border-r border-black px-2 py-1 text-left align-middle">Description of Goods</th>
                  <th className="border-r border-black px-1 py-1 w-16 text-center align-middle">HSN/SAC</th>
                  <th className="border-r border-black px-1 py-1 w-20 text-right align-middle">Quantity</th>
                  <th className="border-r border-black px-1 py-1 w-16 text-right align-middle">Rate</th>
                  <th className="border-r border-black px-1 py-1 w-10 text-center align-middle">per</th>
                  {invoice.withGst && <th className="border-r border-black px-1 py-1 w-10 text-center align-middle">GST</th>}
                  <th className="px-2 py-1 w-24 text-right align-middle">Amount</th>
                </tr>
              </thead>
              <tbody className="align-top">
                {invoice.items.map((item, idx) => (
                  <tr key={item.id}>
                    <td className="border-r border-black px-1 py-0.5 text-center">{idx + 1}</td>
                    <td className="border-r border-black px-2 py-0.5">
                      <span className="font-semibold">{item.itemName}</span>
                      {item.itemCode && <span className="text-black/60"> ({item.itemCode})</span>}
                      {(() => {
                        // Show the per-line discount so Amount visibly reconciles to
                        // qty × rate − discount (SAL2-13).
                        const gross = (item.quantity || 0) * (item.unitPrice || 0);
                        const shown = invoice.withGst ? (item.taxableAmount || 0) : (item.totalAmount || 0);
                        const disc = Math.round((gross - shown) * 100) / 100;
                        return disc > 0.01 ? (
                          <span className="block text-[9px] italic text-black/60">Less line discount: (-) {n2(disc)}</span>
                        ) : null;
                      })()}
                    </td>
                    <td className="border-r border-black px-1 py-0.5 text-center">{item.itemHSN || '—'}</td>
                    <td className="border-r border-black px-1 py-0.5 text-right whitespace-nowrap">{item.quantity} {item.unit}</td>
                    <td className="border-r border-black px-1 py-0.5 text-right">{n2(item.unitPrice)}</td>
                    <td className="border-r border-black px-1 py-0.5 text-center">{item.unit}</td>
                    {invoice.withGst && <td className="border-r border-black px-1 py-0.5 text-center">{item.taxRate}%</td>}
                    <td className="px-2 py-0.5 text-right">{n2(invoice.withGst ? item.taxableAmount : item.totalAmount)}</td>
                  </tr>
                ))}

                {/* Sub-total (taxable) */}
                <tr>
                  <td className="border-r border-black" />
                  <td className="border-r border-black px-2 py-0.5" />
                  <td className="border-r border-black" />
                  <td className="border-r border-black" />
                  <td className="border-r border-black" />
                  <td className="border-r border-black" />
                  {invoice.withGst && <td className="border-r border-black" />}
                  <td className="px-2 py-0.5 text-right font-semibold border-t border-black">{n2(invoice.subtotal)}</td>
                </tr>

                {/* Less: overall discount */}
                {invoice.overallDiscountAmount > 0 && (
                  <tr>
                    <td className="border-r border-black" />
                    <td className="border-r border-black px-2 py-0.5 text-right italic">Less : Discount</td>
                    <td className="border-r border-black" />
                    <td className="border-r border-black" />
                    <td className="border-r border-black" />
                    <td className="border-r border-black" />
                    {invoice.withGst && <td className="border-r border-black" />}
                    <td className="px-2 py-0.5 text-right">(-) {n2(invoice.overallDiscountAmount)}</td>
                  </tr>
                )}

                {/* Shipping / freight */}
                {invoice.shippingCharges > 0 && (
                  <tr>
                    <td className="border-r border-black" />
                    <td className="border-r border-black px-2 py-0.5 text-right">Shipping Charges</td>
                    <td className="border-r border-black" />
                    <td className="border-r border-black" />
                    <td className="border-r border-black" />
                    <td className="border-r border-black" />
                    {invoice.withGst && <td className="border-r border-black" />}
                    <td className="px-2 py-0.5 text-right">{n2(invoice.shippingCharges)}</td>
                  </tr>
                )}

                {/* SGST / CGST lines (per rate), or IGST for an inter-state bill */}
                {invoice.withGst && gstBreakdown.map((row, i) => (
                  <tr key={`tax-${i}`}>
                    <td className="border-r border-black" />
                    <td className="border-r border-black px-2 py-0.5 text-right">{row.taxType}@{row.rate}%</td>
                    <td className="border-r border-black" />
                    <td className="border-r border-black" />
                    <td className="border-r border-black px-1 py-0.5 text-right">{row.rate}</td>
                    <td className="border-r border-black px-1 py-0.5 text-center">%</td>
                    {invoice.withGst && <td className="border-r border-black" />}
                    <td className="px-2 py-0.5 text-right">{n2(row.taxAmount)}</td>
                  </tr>
                ))}

                {/* Round off */}
                {invoice.roundOffEnabled && invoice.roundOff !== 0 && (
                  <tr>
                    <td className="border-r border-black" />
                    <td className="border-r border-black px-2 py-0.5 text-right italic">Round Off</td>
                    <td className="border-r border-black" />
                    <td className="border-r border-black" />
                    <td className="border-r border-black" />
                    <td className="border-r border-black" />
                    {invoice.withGst && <td className="border-r border-black" />}
                    <td className="px-2 py-0.5 text-right">{invoice.roundOff > 0 ? '' : '(-) '}{n2(Math.abs(invoice.roundOff))}</td>
                  </tr>
                )}

                {/* Grand total */}
                <tr className="border-t border-black font-bold">
                  <td className="border-r border-black" />
                  <td className="border-r border-black px-2 py-1 text-right">Total</td>
                  <td className="border-r border-black" />
                  <td className="border-r border-black px-1 py-1 text-right whitespace-nowrap">{qtyTotalLabel}</td>
                  <td className="border-r border-black" />
                  <td className="border-r border-black" />
                  {invoice.withGst && <td className="border-r border-black" />}
                  <td className="px-2 py-1 text-right">{'₹'} {n2(invoice.grandTotal)}</td>
                </tr>
              </tbody>
            </table>

            {/* Amount chargeable in words */}
            <div className="border-t border-black px-2 py-1 flex items-start justify-between">
              <div>
                <span className="text-[9px] text-black/60 block">Amount Chargeable (in words)</span>
                <span className="font-bold">{invoice.amountInWords}</span>
              </div>
              <span className="text-[10px] italic">E. &amp; O.E.</span>
            </div>

            {/* HSN/SAC-wise tax summary */}
            {invoice.withGst && hsnSummary.length > 0 && (
              <table
                className="w-full border-collapse border-t border-black text-[10px]"
                // Fixed layout + explicit column widths so the PDF export
                // (html2canvas) renders the columns aligned and full-width, the
                // same way the items table does; keep it from splitting a page.
                style={{ tableLayout: 'fixed', breakInside: 'avoid', WebkitColumnBreakInside: 'avoid' } as React.CSSProperties}
              >
                {interState ? (
                  <colgroup>
                    <col style={{ width: '25%' }} />
                    <col style={{ width: '25%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '18%' }} />
                    <col style={{ width: '20%' }} />
                  </colgroup>
                ) : (
                  <colgroup>
                    <col style={{ width: '19%' }} />
                    <col style={{ width: '17%' }} />
                    <col style={{ width: '9%' }} />
                    <col style={{ width: '14%' }} />
                    <col style={{ width: '9%' }} />
                    <col style={{ width: '14%' }} />
                    <col style={{ width: '18%' }} />
                  </colgroup>
                )}
                <thead>
                  <tr className="border-b border-black">
                    <th className="border-r border-black px-2 py-1 text-left" rowSpan={2}>HSN/SAC</th>
                    <th className="border-r border-black px-2 py-1 text-right" rowSpan={2}>Taxable<br/>Value</th>
                    {interState ? (
                      <th className="border-r border-black px-1 py-0.5 text-center" colSpan={2}>IGST</th>
                    ) : (
                      <>
                        <th className="border-r border-black px-1 py-0.5 text-center" colSpan={2}>CGST</th>
                        <th className="border-r border-black px-1 py-0.5 text-center" colSpan={2}>SGST/UTGST</th>
                      </>
                    )}
                    <th className="px-2 py-1 text-right" rowSpan={2}>Total<br/>Tax Amount</th>
                  </tr>
                  <tr className="border-b border-black">
                    <th className="border-r border-black px-1 py-0.5 text-center">Rate</th>
                    <th className="border-r border-black px-1 py-0.5 text-right">Amount</th>
                    {!interState && (
                      <>
                        <th className="border-r border-black px-1 py-0.5 text-center">Rate</th>
                        <th className="border-r border-black px-1 py-0.5 text-right">Amount</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {hsnSummary.map((h, i) => (
                    <tr key={`hsn-${i}`}>
                      <td className="border-r border-black px-2 py-0.5">{h.hsn}</td>
                      <td className="border-r border-black px-2 py-0.5 text-right">{n2(h.taxable)}</td>
                      {interState ? (
                        <>
                          <td className="border-r border-black px-1 py-0.5 text-center">{h.rate}%</td>
                          <td className="border-r border-black px-1 py-0.5 text-right">{n2(h.igst)}</td>
                        </>
                      ) : (
                        <>
                          <td className="border-r border-black px-1 py-0.5 text-center">{h.rate / 2}%</td>
                          <td className="border-r border-black px-1 py-0.5 text-right">{n2(h.cgst)}</td>
                          <td className="border-r border-black px-1 py-0.5 text-center">{h.rate / 2}%</td>
                          <td className="border-r border-black px-1 py-0.5 text-right">{n2(h.sgst)}</td>
                        </>
                      )}
                      <td className="px-2 py-0.5 text-right">{n2(h.tax)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-black font-bold">
                    <td className="border-r border-black px-2 py-0.5 text-right">Total</td>
                    <td className="border-r border-black px-2 py-0.5 text-right">{n2(hsnSummary.reduce((s, h) => s + h.taxable, 0))}</td>
                    {interState ? (
                      <>
                        <td className="border-r border-black" />
                        <td className="border-r border-black px-1 py-0.5 text-right">{n2(hsnSummary.reduce((s, h) => s + h.igst, 0))}</td>
                      </>
                    ) : (
                      <>
                        <td className="border-r border-black" />
                        <td className="border-r border-black px-1 py-0.5 text-right">{n2(hsnSummary.reduce((s, h) => s + h.cgst, 0))}</td>
                        <td className="border-r border-black" />
                        <td className="border-r border-black px-1 py-0.5 text-right">{n2(hsnSummary.reduce((s, h) => s + h.sgst, 0))}</td>
                      </>
                    )}
                    <td className="px-2 py-0.5 text-right">{n2(hsnSummary.reduce((s, h) => s + h.tax, 0))}</td>
                  </tr>
                </tbody>
              </table>
            )}

            {/* Tax amount in words */}
            {invoice.withGst && invoice.totalTax > 0 && (
              <div className="border-t border-black px-2 py-1">
                <span className="text-[9px] text-black/60">Tax Amount (in words) : </span>
                <span className="font-semibold">{numberToWordsIndian(invoice.totalTax)}</span>
              </div>
            )}

            {/* Declaration + signatory */}
            <div className="border-t border-black grid grid-cols-2">
              <div className="p-2 border-r border-black">
                <span className="text-[9px] text-black/60 block underline">Declaration</span>
                <p className="text-[10px] leading-snug">
                  We declare that this invoice shows the actual price of the goods
                  described and that all particulars are true and correct.
                </p>
                <div className="mt-2 text-[10px] text-black/70">
                  {termsLines(invoice.termsAndConditions).map((l, i) => (
                    <div key={i} className={l.bold ? 'font-bold text-black' : undefined}>{l.text || '\u00a0'}</div>
                  ))}
                </div>
              </div>
              <div className="p-2 flex flex-col items-end justify-between">
                <span className="font-bold uppercase">for {COMPANY_PROFILE.name}</span>
                <span className="text-[10px] mt-10">Authorised Signatory</span>
              </div>
            </div>
          </div>

          {/* Computer-generated note */}
          <p className="text-center text-[10px] text-black/60 mt-2">This is a Computer Generated Invoice</p>

          {/* Voided / partial-payment note (kept for internal clarity) */}
          {invoice.isPartialPayment && (
            <p className="text-center text-[10px] font-bold text-rose-700 mt-1">
              Partial Paid: {'₹'}{n2(invoice.partialAmount || 0)} &nbsp;|&nbsp; Balance Due: {'₹'}{n2(invoice.balanceDue || 0)}
            </p>
          )}
          </div>
        </div>

        {/* Single Unified Bottom Action Bar (Hidden during Print) */}
        <div className="p-4 sm:px-6 sm:py-3.5 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 print:hidden">
          <div className="hidden md:flex items-center gap-2 text-xs text-slate-500">
            <Building className="h-4 w-4 text-red-600 shrink-0" />
            <span className="font-medium">
              A4 Format &bull; {invoice.invoiceNumber}
            </span>
          </div>

          <div className="flex items-center flex-wrap justify-center sm:justify-end gap-2.5 w-full sm:w-auto">
            {/* 1. Copy */}
            <button
              type="button"
              onClick={handleCopySummary}
              className="h-10 px-4 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 hover:text-slate-900 border border-slate-300 rounded-none transition-colors shadow-none flex items-center justify-center gap-2 cursor-pointer"
            >
              {copied ? (
                <Check className="h-4 w-4 text-emerald-600" />
              ) : (
                <Copy className="h-4 w-4 text-slate-500" />
              )}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>

            {/* 2. Share on WhatsApp (PDF + rating link) */}
            <button
              type="button"
              onClick={handleShareWhatsApp}
              disabled={isDownloadingPdf}
              title={invoice.customerPhone ? `Send to ${invoice.customerPhone} on WhatsApp` : 'Share on WhatsApp'}
              className="h-10 px-4 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 hover:text-emerald-800 border border-emerald-300 rounded-none transition-colors shadow-none flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70"
            >
              <Share2 className="h-4 w-4 text-emerald-600" />
              <span>WhatsApp</span>
            </button>

            {/* 3. Print */}
            <button
              type="button"
              onClick={handlePrint}
              className="h-10 px-4 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 hover:text-slate-900 border border-slate-300 rounded-none transition-colors shadow-none flex items-center justify-center gap-2 cursor-pointer"
            >
              <Printer className="h-4 w-4 text-slate-600" />
              <span>Print</span>
            </button>

            {/* 4. Save as PDF (Primary) */}
            <button
              type="button"
              onClick={handleSavePdf}
              title='Opens the print window — choose "Save as PDF" as the destination'
              className="h-10 px-5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 border border-red-700 rounded-none transition-all shadow-none flex items-center justify-center gap-2 disabled:opacity-70 cursor-pointer"
            >
              <Download className="h-4 w-4 text-white" />
              <span>Save as PDF</span>
            </button>

            {/* 5. Close */}
            <button
              type="button"
              onClick={onClose}
              className="h-10 px-4 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 border border-slate-300 rounded-none transition-colors shadow-none flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <X className="h-4 w-4 text-slate-500" />
              <span>Close</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
