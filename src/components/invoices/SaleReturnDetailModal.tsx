import React, { useState } from 'react';
import { Invoice, COMPANY_PROFILE, BRANCHES } from '../../types';
import { MajestroniczLogo } from '../common/MajestroniczLogo';
import { formatCurrency } from '../../lib/utils';
import { numberToWordsIndian } from '../../lib/numberToWords';
import {
  X,
  Printer,
  Copy,
  Check,
  RotateCcw,
  ExternalLink,
  PackageCheck,
  User,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  invoice: Invoice | null;
  isOpen: boolean;
  onClose: () => void;
  onViewOriginalSale?: (invoice: Invoice) => void;
}

export const SaleReturnDetailModal: React.FC<Props> = ({
  invoice,
  isOpen,
  onClose,
  onViewOriginalSale,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen || !invoice) return null;

  const branchData = BRANCHES.find((b) => b.id === invoice.branchId);
  const returns = invoice.returns || [];
  const totalRefund = invoice.totalReturnedAmount || returns.reduce((sum, r) => sum + r.refundAmount, 0);
  const totalUnitsReturned = returns.reduce((sum, r) => sum + r.returnedQuantity, 0);

  // Latest return timestamp & staff
  const latestReturn = returns[returns.length - 1];
  const returnDate = latestReturn?.returnedAt
    ? new Date(latestReturn.returnedAt).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : invoice.date;
  const returnTime = latestReturn?.returnedAt
    ? new Date(latestReturn.returnedAt).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : invoice.time;

  const processedByStaff = latestReturn?.processedBy || 'Store Staff';

  const handlePrint = () => {
    window.print();
  };

  const handleCopySummary = () => {
    const summary = `${COMPANY_PROFILE.name} - Sales Return Voucher\nOriginal Sale: ${invoice.invoiceNumber}\nCustomer: ${invoice.customerName}\nBranch: ${branchData?.name || invoice.branchId}\nDate of Return: ${returnDate}\nUnits Returned: ${totalUnitsReturned}\nTotal Refund: ${formatCurrency(totalRefund)}\nProcessed By: ${processedByStaff}`;
    navigator.clipboard.writeText(summary);
    setCopied(true);
    toast.success('Return summary copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/70 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto print:p-0 print:bg-white">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[96vh] print:max-h-none print:border-none print:shadow-none print:w-full print:rounded-none">
        {/* Top Header Bar (Hidden in Print) */}
        <div className="px-6 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between print:hidden shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 border border-amber-200">
              <RotateCcw className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-600">
                  Sales Return Credit Voucher
                </span>
                <span className="text-xs font-mono font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                  Return on #{invoice.invoiceNumber}
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Audited stock restoration & customer refund voucher
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopySummary}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors shadow-2xs"
              title="Copy Summary"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-slate-500" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>

            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-xs"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Print / PDF</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors ml-2"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Printable Voucher Body */}
        <div className="flex-1 overflow-y-auto p-6 sm:p-10 bg-white print:p-0 print:overflow-visible text-slate-900 font-sans">
          {/* Header */}
          <div className="border-b-2 border-slate-900 pb-5 mb-6">
            <div className="flex justify-between items-start">
              <div>
                <MajestroniczLogo />
                <div className="mt-3 text-xs text-slate-600 space-y-0.5">
                  <p className="font-bold text-slate-900">{COMPANY_PROFILE.name}</p>
                  <p>{COMPANY_PROFILE.address}</p>
                  <p>
                    Phone: <span className="font-medium text-slate-800">{COMPANY_PROFILE.phone}</span> • Email: {COMPANY_PROFILE.email}
                  </p>
                  <p className="font-mono">GSTIN: <span className="font-bold text-slate-900">{COMPANY_PROFILE.gstin}</span></p>
                </div>
              </div>

              <div className="text-right">
                <div className="inline-block bg-amber-600 text-white px-3.5 py-1 rounded-sm text-sm font-black tracking-widest uppercase mb-2">
                  SALES RETURN VOUCHER
                </div>
                <div className="text-xs space-y-1 font-mono">
                  <p className="text-slate-500">
                    Original Sale No:{' '}
                    <span className="font-bold text-blue-700">{invoice.invoiceNumber}</span>
                  </p>
                  <p className="text-slate-500 font-sans">
                    Date of Return: <span className="font-semibold text-slate-800">{returnDate} {returnTime}</span>
                  </p>
                  <p className="text-slate-500 font-sans">
                    Branch: <span className="font-semibold uppercase text-slate-800">{branchData?.name || invoice.branchId}</span>
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Related Sale & Customer Banner */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs">
            {/* Customer Details */}
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                CUSTOMER DETAILS
              </span>
              <p className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-slate-500" />
                <span>{invoice.customerName}</span>
              </p>
              {invoice.customerPhone && (
                <p className="text-slate-600 mt-0.5 font-mono pl-5">
                  Phone: {invoice.customerPhone}
                </p>
              )}
              {invoice.customerAddress && (
                <p className="text-slate-600 mt-0.5 pl-5">
                  {invoice.customerAddress}
                </p>
              )}
            </div>

            {/* Original Sale Reference */}
            <div className="md:border-l md:border-slate-200 md:pl-4 flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                  ORIGINAL SALE INFORMATION
                </span>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-mono font-bold text-blue-700 text-sm">
                      {invoice.invoiceNumber}
                    </p>
                    <p className="text-slate-500 text-[11px]">
                      Issued on: {invoice.date} • Total Sale: {formatCurrency(invoice.grandTotal)}
                    </p>
                  </div>

                  {onViewOriginalSale && (
                    <button
                      type="button"
                      onClick={() => onViewOriginalSale(invoice)}
                      className="px-2.5 py-1 text-xs font-bold text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors flex items-center gap-1 shadow-2xs print:hidden"
                    >
                      <span>View Sale Slip</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-2 pt-2 border-t border-slate-200/80 flex items-center gap-2 text-slate-600 text-[11px]">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                <span>Processed by: <strong className="text-slate-800">{processedByStaff}</strong></span>
              </div>
            </div>
          </div>

          {/* Returned Items Breakdown Table */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Returned Line Items Breakdown ({returns.length})
              </span>
              <span className="text-xs text-slate-500">
                {totalUnitsReturned} unit{totalUnitsReturned === 1 ? '' : 's'} returned into physical inventory
              </span>
            </div>

            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 border-y border-slate-300 font-bold uppercase text-[10px] text-slate-700">
                  <th className="py-2.5 px-3 text-center w-10">#</th>
                  <th className="py-2.5 px-3 text-left">Item Description</th>
                  <th className="py-2.5 px-3 text-center w-24">Qty Returned</th>
                  <th className="py-2.5 px-3 text-right w-24">Unit Rate</th>
                  <th className="py-2.5 px-3 text-center w-20">GST %</th>
                  <th className="py-2.5 px-3 text-right w-28">Refund Amount</th>
                  <th className="py-2.5 px-3 text-left w-48">Reason & Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {returns.map((ret, idx) => (
                  <tr key={ret.id || idx} className="border-b border-slate-200 hover:bg-slate-50/50">
                    <td className="py-2.5 px-3 text-center text-slate-500 font-mono">{idx + 1}</td>
                    <td className="py-2.5 px-3">
                      <p className="font-bold text-slate-900">{ret.itemName}</p>
                      <p className="text-[11px] text-slate-500 font-mono">Code: {ret.itemCode}</p>
                    </td>
                    <td className="py-2.5 px-3 text-center font-bold text-amber-900 font-mono">
                      <span className="bg-amber-50 text-amber-800 px-2 py-0.5 rounded border border-amber-200">
                        {ret.returnedQuantity}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                      {formatCurrency(ret.unitPrice)}
                    </td>
                    <td className="py-2.5 px-3 text-center font-mono text-slate-600">
                      {ret.taxRate}%
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-black text-slate-900">
                      {formatCurrency(ret.refundAmount)}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 text-[11px]">
                      <p className="font-medium text-slate-800">{ret.reason || 'General Return'}</p>
                      {ret.notes && (
                        <p className="text-slate-500 italic mt-0.5">{ret.notes}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals & Stock Verification Summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="p-4 bg-emerald-50/60 rounded-xl border border-emerald-200 text-xs space-y-2">
              <div className="flex items-center gap-2 text-emerald-800 font-bold">
                <PackageCheck className="h-4 w-4 text-emerald-600" />
                <span>Warehouse Stock Replenished</span>
              </div>
              <p className="text-slate-600 text-[11px] leading-relaxed">
                Returned items have been incremented back into the{' '}
                <strong className="text-slate-900">{branchData?.name || invoice.branchId}</strong> active branch stock.
                Stock adjustment audit logs recorded.
              </p>
              <div className="pt-2 border-t border-emerald-200/80">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">
                  REFUND IN WORDS
                </span>
                <p className="font-medium text-slate-800 italic">
                  {numberToWordsIndian(totalRefund)}
                </p>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1.5 border-b border-slate-200 font-medium text-slate-600">
                <span>Original Invoice Grand Total:</span>
                <span className="font-mono font-bold text-slate-900">{formatCurrency(invoice.grandTotal)}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-200 font-medium text-slate-600">
                <span>Total Units Returned:</span>
                <span className="font-mono font-bold text-amber-800">{totalUnitsReturned} units</span>
              </div>
              <div className="flex justify-between py-2 border-b-2 border-slate-900 font-bold text-sm">
                <span className="text-slate-900 uppercase">Total Refund Issued:</span>
                <span className="font-mono text-amber-700 text-base">
                  {formatCurrency(totalRefund)}
                </span>
              </div>
            </div>
          </div>

          {/* Signatures */}
          <div className="pt-8 border-t border-slate-300 grid grid-cols-2 gap-12 text-xs">
            <div>
              <p className="font-bold text-slate-800 mb-1">Return & Refund Terms:</p>
              <ul className="list-disc list-inside text-[11px] text-slate-500 space-y-0.5">
                <li>Goods verified for unbroken seal, technical integrity, and working condition.</li>
                <li>Refund amount adjusted against customer ledger or cash counter.</li>
                <li>Original sale receipt voucher marked with this return record.</li>
              </ul>
            </div>

            <div className="flex flex-col justify-end items-end text-right">
              <div className="h-12" />
              <div className="border-t border-slate-400 w-56 pt-1">
                <p className="font-bold text-slate-900">Authorized Officer</p>
                <p className="text-[11px] text-slate-500">{processedByStaff} • {COMPANY_PROFILE.name}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
