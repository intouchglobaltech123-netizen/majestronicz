import React, { useMemo } from 'react';
import { useErp } from '../../context/ErpContext';
import { Invoice, COMPANY_PROFILE, GstBreakdownRow } from '../../types';
import { formatCurrency, cn } from '../../lib/utils';
import { calculateTaxBreakdown } from '../../lib/taxCalculations';
import { MajestroniczLogo } from '../common/MajestroniczLogo';
import {
  X,
  Printer,
  Share2,
  Copy,
  Check,
  Building,
  AlertCircle,
  RotateCcw,
  Download,
} from 'lucide-react';
import { toast } from 'sonner';
import { exportElementToPdf } from '../../utils/pdfExport';

interface Props {
  invoice: Invoice | null;
  isOpen: boolean;
  onClose: () => void;
  onCreateNew?: () => void;
}

export const InvoicePdfModal: React.FC<Props> = ({ invoice, isOpen, onClose }) => {
  const { items } = useErp();
  const [copied, setCopied] = React.useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = React.useState(false);

  // Compute SGST & CGST breakdown pairs per distinct GST rate
  const gstBreakdown = useMemo((): GstBreakdownRow[] => {
    if (!invoice || !invoice.withGst) return [];
    return calculateTaxBreakdown(invoice.items);
  }, [invoice]);

  if (!isOpen || !invoice) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleSavePdf = async () => {
    try {
      setIsDownloadingPdf(true);
      toast.loading('Generating PDF document...', { id: 'invoice-pdf' });
      await exportElementToPdf('printable-invoice-doc', `${invoice.invoiceNumber}.pdf`);
      toast.success('PDF saved successfully', {
        id: 'invoice-pdf',
        description: `Downloaded ${invoice.invoiceNumber}.pdf`,
      });
    } catch (err) {
      console.error('Failed to export PDF:', err);
      toast.error('Failed to generate PDF', {
        id: 'invoice-pdf',
        description: 'Please try using the Print button to save as PDF.',
      });
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const handleShareWhatsApp = () => {
    const text = `*TAX INVOICE — ${COMPANY_PROFILE.name}*\nInvoice No: ${invoice.invoiceNumber}\nDate: ${invoice.date}\nCustomer: ${invoice.customerName}\nGrand Total: ₹${invoice.grandTotal.toLocaleString('en-IN')}\nPayment Mode: ${invoice.paymentMode}${invoice.isPartialPayment ? ` (Partial Paid: ₹${invoice.partialAmount}, Balance Due: ₹${invoice.balanceDue})` : ''}\n\nThank you for doing business with Majestronicz!`;
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  const handleCopySummary = () => {
    const summary = `${COMPANY_PROFILE.name} Invoice: ${invoice.invoiceNumber}\nDate: ${invoice.date}\nCustomer: ${invoice.customerName}\nTotal: ₹${invoice.grandTotal.toLocaleString('en-IN')}\nPayment: ${invoice.paymentMode} (${invoice.transactionType})\nItems: ${invoice.items.length}`;
    navigator.clipboard.writeText(summary);
    setCopied(true);
    toast.success('Invoice details copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/70 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto print:p-0 print:bg-white">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[96vh] print:max-h-none print:border-none print:shadow-none print:w-full print:rounded-none">
        {/* Top Metadata Header (Clean document metadata, No action buttons) */}
        <div className="px-6 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between print:hidden">
          <div className="flex items-center flex-wrap gap-2">
            <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
              Tax Invoice Document Preview
            </span>
            <span className="text-xs font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
              {invoice.invoiceNumber}
            </span>
            {invoice.isVoided ? (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-300 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                <span>VOIDED SALE</span>
              </span>
            ) : (
              <span
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                  invoice.transactionType === 'Cash'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}
              >
                {invoice.transactionType} Sale
              </span>
            )}
            <span className="text-[10px] font-bold text-slate-600 bg-slate-200 px-1.5 py-0.5 rounded">
              Mode: {invoice.paymentMode}
            </span>
            {invoice.withGst ? (
              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                GST Invoice
              </span>
            ) : (
              <span className="text-[10px] font-bold text-slate-600 bg-slate-200 px-1.5 py-0.5 rounded">
                Non-GST
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            title="Close Preview (Esc)"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Printable Document Body */}
        <div id="printable-invoice-doc" className="p-8 overflow-y-auto flex-1 bg-white text-slate-900 font-sans print:p-6 print:overflow-visible">
          {/* Voided Alert Banner */}
          {invoice.isVoided && (
            <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-300 text-rose-800 text-xs flex items-center justify-between font-bold print:border-2 print:border-rose-600">
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

          {/* Header Block with Blue Bar Accent */}
          <div className="border border-slate-200 rounded-xl overflow-hidden mb-5">
            {/* Top Blue Accent Title Strip */}
            <div className={cn(
              "text-white px-6 py-2.5 flex items-center justify-between",
              invoice.isVoided ? "bg-slate-700" : "bg-blue-600"
            )}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-black uppercase tracking-widest">
                  {invoice.withGst ? 'TAX INVOICE' : 'COMMERCIAL INVOICE / CASH MEMO'}
                </span>
                <span className="text-xs bg-white/20 px-2 py-0.5 rounded font-mono">
                  {invoice.withGst ? 'GST REGULAR' : 'NON-GST BILL OF SUPPLY'}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs font-mono font-bold tracking-wider">
                <span className="bg-white/20 px-2 py-0.5 rounded uppercase">
                  {invoice.transactionType}
                </span>
                <span>ORIGINAL FOR RECIPIENT</span>
              </div>
            </div>

            {/* Company & Document Meta Section */}
            <div className="p-6 bg-white flex flex-col md:flex-row justify-between gap-6 border-b border-slate-200">
              {/* Left: Company Details */}
              <div className="flex-1 space-y-2">
                <MajestroniczLogo />
                <div className="text-xs text-slate-600 space-y-0.5 pt-1">
                  <p className="font-semibold text-slate-800">{COMPANY_PROFILE.address}</p>
                  <p>
                    <strong>Phone:</strong> {COMPANY_PROFILE.phone} &nbsp;|&nbsp; <strong>Email:</strong> {COMPANY_PROFILE.email}
                  </p>
                  <p className="pt-0.5">
                    <strong>GSTIN:</strong> <span className="font-mono font-bold text-slate-900">{COMPANY_PROFILE.gstin}</span>
                    &nbsp;|&nbsp; <strong>State:</strong> {COMPANY_PROFILE.state}
                  </p>
                </div>
              </div>

              {/* Right: Invoice Meta Box */}
              <div className="w-full md:w-80 bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1.5 text-xs">
                <div className="flex justify-between border-b border-slate-200 pb-1.5">
                  <span className="text-slate-500 font-medium">Invoice No:</span>
                  <span className="font-mono font-black text-blue-700 text-sm">{invoice.invoiceNumber}</span>
                </div>
                <div className="flex justify-between border-b border-slate-200 pb-1.5">
                  <span className="text-slate-500 font-medium">Invoice Date & Time:</span>
                  <span className="font-semibold text-slate-800">{invoice.date} {invoice.time}</span>
                </div>
                <div className="flex justify-between border-b border-slate-200 pb-1.5">
                  <span className="text-slate-500 font-medium">Payment Terms:</span>
                  <span className="font-semibold text-slate-800">{invoice.paymentTerms}</span>
                </div>
                <div className="flex justify-between border-b border-slate-200 pb-1.5">
                  <span className="text-slate-500 font-medium">Due Date:</span>
                  <span className="font-bold text-slate-900">{invoice.dueDate}</span>
                </div>
                <div className="flex justify-between border-b border-slate-200 pb-1.5">
                  <span className="text-slate-500 font-medium">State of Supply:</span>
                  <span className="font-semibold text-slate-800">{invoice.stateOfSupply}</span>
                </div>
                <div className="flex justify-between pt-0.5">
                  <span className="text-slate-500 font-medium">Payment Received As:</span>
                  <span className="font-mono font-bold text-blue-700 uppercase bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                    {invoice.paymentMode}
                  </span>
                </div>
                {invoice.isPartialPayment && (
                  <div className="flex justify-between text-[11px] pt-1 text-amber-700 font-bold bg-amber-50 p-1.5 rounded border border-amber-200">
                    <span>Partial Paid (PP): ₹{Number(invoice.partialAmount || 0).toLocaleString('en-IN')}</span>
                    <span>Bal Due: ₹{Number(invoice.balanceDue || 0).toLocaleString('en-IN')}</span>
                  </div>
                )}
                {invoice.sourceEstimateNumber && (
                  <div className="flex justify-between border-t border-slate-200 pt-1 text-[11px] text-blue-700">
                    <span className="font-medium">From Estimate:</span>
                    <span className="font-mono font-bold">{invoice.sourceEstimateNumber}</span>
                  </div>
                )}
                {invoice.sourceEnquiryNumber && (
                  <div className="flex justify-between border-t border-slate-200 pt-1 text-[11px] text-purple-700">
                    <span className="font-medium">From Enquiry:</span>
                    <span className="font-mono font-bold">#{invoice.sourceEnquiryNumber}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Customer Information Block */}
            <div className="p-5 bg-slate-50/50 flex flex-col md:flex-row justify-between gap-4 text-xs">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                  Billed To (Customer Details)
                </span>
                <p className="text-base font-extrabold text-slate-900">{invoice.customerName}</p>
                {invoice.customerPhone && (
                  <p className="text-slate-600 mt-0.5">
                    <strong>Phone / Mobile:</strong> {invoice.customerPhone}
                  </p>
                )}
                {invoice.customerAddress && (
                  <p className="text-slate-600 mt-0.5 max-w-md">
                    <strong>Billing Address:</strong> {invoice.customerAddress}
                  </p>
                )}
              </div>

              <div className="text-right flex flex-col justify-end">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Dispatched Branch
                </span>
                <span className="text-xs font-bold text-slate-800 uppercase font-mono">
                  {invoice.branchId} HUB
                </span>
                <span className="text-[11px] text-slate-500 mt-1">
                  {invoice.withGst ? 'GST Breakdown itemized below' : 'Exempt / Non-GST Total'}
                </span>
              </div>
            </div>
          </div>

          {/* Line Items Table with Blue Header Bar */}
          <div className="border border-slate-200 rounded-xl overflow-hidden mb-5">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-blue-600 text-white font-bold uppercase text-[10px] tracking-wider">
                  <th className="py-2.5 px-3 w-10 text-center">#</th>
                  <th className="py-2.5 px-3">Item Description</th>
                  <th className="py-2.5 px-3 w-24">HSN / SAC</th>
                  <th className="py-2.5 px-3 w-16 text-right">Qty</th>
                  <th className="py-2.5 px-3 w-14">Unit</th>
                  <th className="py-2.5 px-3 text-right w-24">Price/Unit (₹)</th>
                  <th className="py-2.5 px-3 text-right w-18">Disc</th>
                  {invoice.withGst && (
                    <>
                      <th className="py-2.5 px-3 text-right w-16">GST %</th>
                      <th className="py-2.5 px-3 text-right w-22">GST Tax (₹)</th>
                    </>
                  )}
                  <th className="py-2.5 px-3 text-right w-28">Amount (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-800">
                {invoice.items.map((item, idx) => (
                  <tr key={item.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                    <td className="py-2.5 px-3 text-center text-slate-400 font-mono">{idx + 1}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-slate-900">{item.itemName}</span>
                        {item.isCombo && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-purple-50 text-purple-700 border border-purple-200 uppercase print:border-purple-300">
                            Combo
                          </span>
                        )}
                      </div>
                      {item.itemCode && (
                        <span className="text-[10px] text-slate-500 font-mono">Code: {item.itemCode}</span>
                      )}
                      {(() => {
                        const master = items.find((i) => i.id === item.itemId || i.itemCode === item.itemCode);
                        return master?.description ? (
                          <p className="text-[10px] text-slate-500 italic mt-0.5 line-clamp-2">
                            {master.description}
                          </p>
                        ) : null;
                      })()}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-600">{item.itemHSN || '—'}</td>
                    <td className="py-2.5 px-3 text-right font-bold text-slate-900">{item.quantity}</td>
                    <td className="py-2.5 px-3 text-slate-600 uppercase font-mono">{item.unit}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-medium">
                      {item.unitPrice.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                      {item.discountAmount > 0 ? `₹${item.discountAmount.toFixed(2)}` : '—'}
                    </td>
                    {invoice.withGst && (
                      <>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-600">{item.taxRate}%</td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                          {item.totalTax.toFixed(2)}
                        </td>
                      </>
                    )}
                    <td className="py-2.5 px-3 text-right font-mono font-extrabold text-slate-900">
                      {item.totalAmount.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Bottom Grid: Tax Breakdown / Words & Amounts Summary */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5 mb-5 items-start">
            {/* Left Column (Span 7): Tax Table + Amount in words + Terms */}
            <div className="md:col-span-7 space-y-4">
              {/* WITH GST TAX BREAKDOWN TABLE */}
              {invoice.withGst && gstBreakdown.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="bg-slate-100 px-3 py-1.5 text-[10px] font-bold uppercase text-slate-700 border-b border-slate-200">
                    GST Tax Breakdown (SGST + CGST)
                  </div>
                  <table className="w-full text-left text-[11px]">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                        <th className="py-1.5 px-3">Tax Type</th>
                        <th className="py-1.5 px-3 text-right">Taxable Amount (₹)</th>
                        <th className="py-1.5 px-3 text-right">Rate (%)</th>
                        <th className="py-1.5 px-3 text-right">Tax Amount (₹)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-slate-700 font-mono">
                      {gstBreakdown.map((row, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="py-1.5 px-3 font-semibold text-slate-900">{row.taxType}</td>
                          <td className="py-1.5 px-3 text-right">{row.taxableAmount.toFixed(2)}</td>
                          <td className="py-1.5 px-3 text-right">{row.rate}%</td>
                          <td className="py-1.5 px-3 text-right font-bold text-slate-900">{row.taxAmount.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Invoice Amount in Words (Indian Numbering) */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">
                  Invoice Amount In Words:
                </span>
                <p className="font-bold text-slate-900 italic">
                  {invoice.amountInWords}
                </p>
              </div>

              {/* Terms & Conditions */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                  Terms and Conditions:
                </span>
                <div className="text-[11px] text-slate-700 whitespace-pre-line font-medium leading-relaxed">
                  {invoice.termsAndConditions}
                </div>
              </div>

              {/* Processed Returns Log */}
              {invoice.returns && invoice.returns.length > 0 && (
                <div className="p-3.5 rounded-xl bg-amber-50/80 border border-amber-200 text-xs space-y-2">
                  <div className="flex items-center gap-1.5 text-amber-900 font-bold">
                    <RotateCcw className="h-3.5 w-3.5 text-amber-700" />
                    <span>Processed Sales Returns</span>
                  </div>
                  <div className="space-y-1 divide-y divide-amber-100">
                    {invoice.returns.map((ret) => (
                      <div key={ret.id} className="pt-1 first:pt-0 flex justify-between items-center text-[11px]">
                        <div>
                          <strong className="text-slate-900">{ret.returnedQuantity}x</strong>{' '}
                          <span className="text-slate-700">{ret.itemName}</span>
                          {ret.reason && <span className="text-slate-400 ml-1">({ret.reason})</span>}
                        </div>
                        <span className="font-mono font-bold text-amber-900">
                          -₹{ret.refundAmount.toLocaleString('en-IN')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right Column (Span 5): Amounts Summary Panel */}
            <div className="md:col-span-5 bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2 text-xs">
              <div className="flex justify-between py-1 text-slate-600">
                <span>Taxable Subtotal:</span>
                <span className="font-mono font-bold text-slate-900 text-sm">
                  {formatCurrency(invoice.subtotal)}
                </span>
              </div>

              {invoice.overallDiscountAmount > 0 && (
                <div className="flex justify-between py-1 text-emerald-600 border-t border-slate-200">
                  <span>Overall Discount ({invoice.overallDiscountValue}{invoice.overallDiscountType}):</span>
                  <span className="font-mono font-semibold">
                    - {formatCurrency(invoice.overallDiscountAmount)}
                  </span>
                </div>
              )}

              {invoice.shippingCharges > 0 && (
                <div className="flex justify-between py-1 text-slate-600 border-t border-slate-200">
                  <span>Shipping & Delivery Charges:</span>
                  <span className="font-mono font-semibold text-slate-800">
                    {formatCurrency(invoice.shippingCharges)}
                  </span>
                </div>
              )}

              {invoice.withGst && (
                <>
                  <div className="flex justify-between py-1 text-slate-600 border-t border-slate-200">
                    <span>Total SGST:</span>
                    <span className="font-mono font-semibold text-slate-800">
                      {formatCurrency(invoice.totalSgst)}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 text-slate-600 border-t border-slate-200">
                    <span>Total CGST:</span>
                    <span className="font-mono font-semibold text-slate-800">
                      {formatCurrency(invoice.totalCgst)}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 text-slate-600 border-t border-slate-200">
                    <span>Total Tax Amount:</span>
                    <span className="font-mono font-bold text-blue-700">
                      {formatCurrency(invoice.totalTax)}
                    </span>
                  </div>
                </>
              )}

              {invoice.roundOffEnabled && invoice.roundOff !== 0 && (
                <div className="flex justify-between py-1 text-slate-600 border-t border-slate-200">
                  <span>Round Off:</span>
                  <span className="font-mono font-semibold text-slate-800">
                    {invoice.roundOff > 0 ? `+${invoice.roundOff.toFixed(2)}` : invoice.roundOff.toFixed(2)}
                  </span>
                </div>
              )}

              {/* Grand Total Bar */}
              <div className="mt-3 p-3.5 rounded-xl bg-blue-600 text-white flex items-baseline justify-between shadow-xs">
                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider block text-blue-100">
                    Grand Total
                  </span>
                  <span className="text-[10px] text-blue-200">
                    {invoice.withGst ? '(Inclusive of all GST taxes)' : '(Net Invoice Total)'}
                  </span>
                </div>
                <div className="text-xl font-black font-mono">
                  {formatCurrency(invoice.grandTotal)}
                </div>
              </div>

              {/* Daily Cash Register Reconciled Details */}
              <div className="mt-3 pt-3 border-t border-slate-200 space-y-1.5">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500 font-medium">Settlement Mode:</span>
                  <span className="font-mono font-bold text-slate-900 px-2 py-0.5 bg-white rounded border border-slate-200">
                    {invoice.paymentMode} ({invoice.transactionType})
                  </span>
                </div>

                {invoice.isPartialPayment ? (
                  <div className="space-y-1 bg-amber-50/80 p-2 rounded-lg border border-amber-200 text-xs">
                    <div className="flex justify-between text-amber-900 font-semibold">
                      <span>Partial Paid Amount (PP):</span>
                      <span className="font-mono font-bold text-emerald-700">
                        {formatCurrency(invoice.partialAmount || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between text-amber-900 font-bold border-t border-amber-200 pt-1">
                      <span>Remaining Balance Due:</span>
                      <span className="font-mono text-rose-700">
                        {formatCurrency(invoice.balanceDue || 0)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-between text-xs text-emerald-700 font-semibold bg-emerald-50/80 p-2 rounded-lg border border-emerald-200">
                    <span>Payment Status:</span>
                    <span>Paid in Full</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer Signature Box */}
          <div className="mt-8 pt-6 border-t border-slate-200 flex flex-col sm:flex-row items-end justify-between gap-6 text-xs">
            <div className="text-slate-500 text-[10px] space-y-1">
              <p>This is a computer-generated official sales tax invoice.</p>
              <p>For inquiries, please contact: <strong>{COMPANY_PROFILE.phone}</strong> or <strong>{COMPANY_PROFILE.email}</strong></p>
            </div>

            <div className="text-center w-56 space-y-12">
              <p className="font-bold text-slate-900 uppercase">
                For : {COMPANY_PROFILE.name}
              </p>
              <div className="border-t border-slate-400 pt-1">
                <span className="text-xs font-semibold text-slate-700 block">
                  Authorized Signatory
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Single Unified Bottom Action Bar (Hidden during Print) */}
        <div className="p-4 sm:px-6 sm:py-3.5 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 print:hidden">
          <div className="hidden md:flex items-center gap-2 text-xs text-slate-500">
            <Building className="h-4 w-4 text-blue-600 shrink-0" />
            <span className="font-medium">
              A4 Format &bull; {invoice.invoiceNumber}
            </span>
          </div>

          <div className="flex items-center flex-wrap justify-center sm:justify-end gap-2.5 w-full sm:w-auto">
            {/* 1. Copy */}
            <button
              type="button"
              onClick={handleCopySummary}
              className="h-10 px-4 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 hover:text-slate-900 border border-slate-200 rounded-xl transition-colors shadow-2xs flex items-center justify-center gap-2 cursor-pointer"
            >
              {copied ? (
                <Check className="h-4 w-4 text-emerald-600" />
              ) : (
                <Copy className="h-4 w-4 text-slate-500" />
              )}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>

            {/* 2. Share */}
            <button
              type="button"
              onClick={handleShareWhatsApp}
              className="h-10 px-4 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 hover:text-emerald-800 border border-emerald-200 rounded-xl transition-colors shadow-2xs flex items-center justify-center gap-2 cursor-pointer"
            >
              <Share2 className="h-4 w-4 text-emerald-600" />
              <span>Share</span>
            </button>

            {/* 3. Print */}
            <button
              type="button"
              onClick={handlePrint}
              className="h-10 px-4 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 hover:text-slate-900 border border-slate-200 rounded-xl transition-colors shadow-2xs flex items-center justify-center gap-2 cursor-pointer"
            >
              <Printer className="h-4 w-4 text-slate-600" />
              <span>Print</span>
            </button>

            {/* 4. Save as PDF (Primary) */}
            <button
              type="button"
              onClick={handleSavePdf}
              disabled={isDownloadingPdf}
              className="h-10 px-5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 border border-blue-600 rounded-xl transition-all shadow-xs flex items-center justify-center gap-2 disabled:opacity-70 cursor-pointer"
            >
              {isDownloadingPdf ? (
                <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Download className="h-4 w-4 text-white" />
              )}
              <span>{isDownloadingPdf ? 'Generating PDF...' : 'Save as PDF'}</span>
            </button>

            {/* 5. Close */}
            <button
              type="button"
              onClick={onClose}
              className="h-10 px-4 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 rounded-xl transition-colors shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <X className="h-4 w-4 text-slate-500" />
              <span>Close</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
