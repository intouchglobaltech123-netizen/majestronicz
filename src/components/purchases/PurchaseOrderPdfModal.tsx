import React, { useState } from 'react';
import { PurchaseOrder, COMPANY_PROFILE, BRANCHES } from '../../types';
import { MajestroniczLogo } from '../common/MajestroniczLogo';
import { formatCurrency } from '../../lib/utils';
import { numberToWordsIndian } from '../../lib/numberToWords';
import {
  X,
  Printer,
  Share2,
  Copy,
  Check,
  ExternalLink,
  Layers,
} from 'lucide-react';
import { toast } from 'sonner';
import { useErp } from '../../context/ErpContext';

interface Props {
  purchaseOrder: PurchaseOrder | null;
  isOpen: boolean;
  onClose: () => void;
}

export const PurchaseOrderPdfModal: React.FC<Props> = ({
  purchaseOrder,
  isOpen,
  onClose,
}) => {
  const { pendingOrders, setSelectedPendingOrderForDetail } = useErp();
  const [copied, setCopied] = useState(false);

  if (!isOpen || !purchaseOrder) return null;

  const linkedPendingOrder =
    purchaseOrder.pendingOrderId
      ? pendingOrders.find((p) => p.id === purchaseOrder.pendingOrderId)
      : pendingOrders.find(
          (p) => p.purchaseOrderId === purchaseOrder.id || p.linkedPurchaseOrderId === purchaseOrder.id
        );
  const pendingOrderRef = purchaseOrder.pendingOrderNumber || linkedPendingOrder?.orderNumber;

  const branchData = BRANCHES.find((b) => b.id === purchaseOrder.branchId);

  const handlePrint = () => {
    window.print();
  };

  const handleShareWhatsApp = () => {
    const text = `*PURCHASE ORDER — ${COMPANY_PROFILE.name}*\nPO No: ${purchaseOrder.poNumber}\nVendor: ${purchaseOrder.vendorName}\nDate: ${purchaseOrder.date}\nExpected: ${purchaseOrder.expectedDeliveryDate}\nDestination Branch: ${branchData?.name || purchaseOrder.branchId}\nTotal Amount: ${formatCurrency(purchaseOrder.totalAmount)}`;
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  const handleCopySummary = () => {
    const summary = `${COMPANY_PROFILE.name} Purchase Order: ${purchaseOrder.poNumber}\nVendor: ${purchaseOrder.vendorName}\nDate: ${purchaseOrder.date}\nExpected Delivery: ${purchaseOrder.expectedDeliveryDate}\nTotal Items: ${purchaseOrder.items.length}\nTotal Value: ${formatCurrency(purchaseOrder.totalAmount)}`;
    navigator.clipboard.writeText(summary);
    setCopied(true);
    toast.success('PO summary copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/70 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto print:p-0 print:bg-white">
      <div className="bg-white border border-slate-300 rounded-none w-full max-w-4xl shadow-xl overflow-hidden flex flex-col max-h-[96vh] print:max-h-none print:border-none print:shadow-none print:w-full print:rounded-none">
        {/* Action Header (Hidden during Print) */}
        <div className="px-6 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between print:hidden shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
              Purchase Order Preview
            </span>
            <span className="text-xs font-mono font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded-none border border-red-200">
              {purchaseOrder.poNumber}
            </span>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-none border ${
                purchaseOrder.status === 'Received'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : purchaseOrder.status === 'Partially Received'
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : purchaseOrder.status === 'Cancelled'
                  ? 'bg-slate-100 text-slate-600 border-slate-200'
                  : 'bg-slate-100 text-slate-800 border-slate-300'
              }`}
            >
              {purchaseOrder.status}
            </span>
          </div>

          {/* Document Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopySummary}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-none transition-colors"
              title="Copy Summary"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-slate-500" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>

            <button
              onClick={handleShareWhatsApp}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-none transition-colors"
              title="Share on WhatsApp"
            >
              <Share2 className="h-3.5 w-3.5 text-emerald-600" />
              <span>Share</span>
            </button>

            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-none border border-red-700 transition-colors shadow-none cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Print / PDF</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-none text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors ml-2"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Linked Pending Order Link-Back Bar */}
        {pendingOrderRef && (
          <div className="px-6 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs print:hidden shrink-0">
            <div className="flex items-center gap-2">
              <span className="h-6 w-6 rounded-none bg-slate-100 text-slate-700 flex items-center justify-center shrink-0 border border-slate-200">
                <Layers className="h-3.5 w-3.5" />
              </span>
              <span className="text-slate-800">
                Fulfills Pending Order: <strong className="font-mono font-bold text-red-700">{pendingOrderRef}</strong>
              </span>
              {linkedPendingOrder && (
                <span className="text-slate-500 hidden sm:inline">
                  • Customer: <strong className="text-slate-800">{linkedPendingOrder.customerName}</strong>
                </span>
              )}
            </div>
            {linkedPendingOrder && (
              <button
                type="button"
                onClick={() => {
                  setSelectedPendingOrderForDetail(linkedPendingOrder);
                  onClose();
                }}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-purple-700 hover:text-purple-900 bg-white hover:bg-purple-100 border border-purple-300 px-2.5 py-1 rounded-lg transition-colors shadow-2xs"
              >
                <span>View Pending Order</span>
                <ExternalLink className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        {/* Scrollable Printable A4 Area */}
        <div className="flex-1 overflow-y-auto p-6 sm:p-10 bg-white print:p-0 print:overflow-visible text-slate-900 font-sans">
          {/* Printable Linked Pending Order Badge */}
          {pendingOrderRef && (
            <div className="mb-4 p-2.5 bg-purple-50/70 border border-purple-200 rounded-xl flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <Layers className="h-3.5 w-3.5 text-purple-600" />
                <span className="text-purple-950 font-semibold">
                  Fulfills Pending Order:{' '}
                  <strong className="font-mono font-black text-purple-800">{pendingOrderRef}</strong>
                </span>
                {linkedPendingOrder && (
                  <span className="text-slate-600">
                    ({linkedPendingOrder.customerName} — {linkedPendingOrder.quantityNeeded} {linkedPendingOrder.unit})
                  </span>
                )}
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-purple-700 bg-purple-100/80 px-2 py-0.5 rounded border border-purple-200">
                Stock Fulfillment Linked
              </span>
            </div>
          )}
          {/* Company & Document Header */}
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
                <div className="inline-block bg-slate-900 text-white px-4 py-1 rounded-sm text-sm font-black tracking-widest uppercase mb-2">
                  PURCHASE ORDER
                </div>
                <div className="text-xs space-y-1 font-mono">
                  <p className="text-slate-500">
                    PO Number: <span className="font-bold text-slate-900 text-sm">{purchaseOrder.poNumber}</span>
                  </p>
                  <p className="text-slate-500 font-sans">
                    PO Date: <span className="font-semibold text-slate-800">{purchaseOrder.date}</span>
                  </p>
                  <p className="text-slate-500 font-sans">
                    Expected Delivery: <span className="font-semibold text-slate-900">{purchaseOrder.expectedDeliveryDate}</span>
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Parties Grid (Supplier Bill-To / Destination Delivery) */}
          <div className="grid grid-cols-2 gap-6 mb-6 p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs">
            {/* Vendor Details */}
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                SUPPLIER / VENDOR DETAILS
              </span>
              <p className="font-bold text-slate-900 text-sm">{purchaseOrder.vendorName}</p>
              {purchaseOrder.vendorAddress && (
                <p className="text-slate-600 mt-0.5 leading-relaxed">{purchaseOrder.vendorAddress}</p>
              )}
              {purchaseOrder.vendorContact && (
                <p className="text-slate-600 mt-1">
                  Contact: <span className="font-medium text-slate-800">{purchaseOrder.vendorContact}</span>
                </p>
              )}
              {purchaseOrder.vendorGstin && (
                <p className="text-slate-600 font-mono mt-0.5">
                  GSTIN: <span className="font-bold text-slate-800">{purchaseOrder.vendorGstin}</span>
                </p>
              )}
            </div>

            {/* Destination Branch */}
            <div className="border-l border-slate-200 pl-6">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                SHIP TO / DELIVERY DESTINATION
              </span>
              <p className="font-bold text-slate-900 text-sm">
                Majestronicz Automation — {branchData?.name || purchaseOrder.branchId}
              </p>
              <p className="text-slate-600 mt-0.5 leading-relaxed">
                {branchData?.location || COMPANY_PROFILE.address}
              </p>
              <p className="text-slate-600 mt-1">
                Contact: <span className="font-medium text-slate-800">{COMPANY_PROFILE.phone}</span>
              </p>
              <p className="text-slate-600 font-mono mt-0.5">
                GSTIN: <span className="font-bold text-slate-800">{COMPANY_PROFILE.gstin}</span>
              </p>
            </div>
          </div>

          {/* Line Items Table */}
          <table className="w-full border-collapse text-xs mb-6">
            <thead>
              <tr className="border-y-2 border-slate-800 bg-slate-100 text-slate-800 font-bold uppercase tracking-wider">
                <th className="py-2.5 px-3 text-center w-12">#</th>
                <th className="py-2.5 px-3 text-left">Item Description & Specifications</th>
                <th className="py-2.5 px-3 text-center w-24">HSN</th>
                <th className="py-2.5 px-3 text-center w-20">Qty</th>
                <th className="py-2.5 px-3 text-center w-16">Unit</th>
                <th className="py-2.5 px-3 text-right w-28">Rate (₹)</th>
                <th className="py-2.5 px-3 text-right w-32">Amount (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {purchaseOrder.items.map((line, idx) => (
                <tr key={line.id} className="border-b border-slate-200">
                  <td className="py-2.5 px-3 text-center text-slate-500 font-mono">{idx + 1}</td>
                  <td className="py-2.5 px-3">
                    <p className="font-bold text-slate-900">{line.itemName}</p>
                    <p className="text-[11px] text-slate-500 font-mono">Code: {line.itemCode}</p>
                  </td>
                  <td className="py-2.5 px-3 text-center font-mono text-slate-600">{line.itemHSN || '—'}</td>
                  <td className="py-2.5 px-3 text-center font-bold text-slate-900">{line.quantityOrdered}</td>
                  <td className="py-2.5 px-3 text-center text-slate-600 uppercase">{line.unit}</td>
                  <td className="py-2.5 px-3 text-right font-mono">{formatCurrency(line.purchasePrice)}</td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                    {formatCurrency(line.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals and Amount in Words */}
          <div className="grid grid-cols-2 gap-6 mb-8">
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                AMOUNT IN WORDS
              </span>
              <p className="font-medium text-slate-800 italic">
                {numberToWordsIndian(purchaseOrder.totalAmount)}
              </p>

              {purchaseOrder.notes && (
                <div className="mt-3 pt-3 border-t border-slate-200">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">
                    SUPPLIER NOTES & INSTRUCTIONS
                  </span>
                  <p className="text-slate-600 text-[11px] whitespace-pre-line">{purchaseOrder.notes}</p>
                </div>
              )}
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1.5 border-b border-slate-200 font-medium">
                <span className="text-slate-600">Subtotal</span>
                <span className="font-mono text-slate-900">{formatCurrency(purchaseOrder.totalAmount)}</span>
              </div>
              <div className="flex justify-between py-2 border-b-2 border-slate-900 font-bold text-sm">
                <span className="text-slate-900 uppercase">Total Order Value</span>
                <span className="font-mono text-slate-900 text-base">
                  {formatCurrency(purchaseOrder.totalAmount)}
                </span>
              </div>
            </div>
          </div>

          {/* Delivery & Signatures Section */}
          <div className="pt-8 border-t border-slate-300 grid grid-cols-2 gap-12 text-xs">
            <div>
              <p className="font-bold text-slate-800 mb-1">Terms & Conditions:</p>
              <ul className="list-disc list-inside text-[11px] text-slate-500 space-y-0.5">
                <li>Material must conform to specified technical codes and quality standards.</li>
                <li>Invoice and Delivery Challan must accompany physical delivery.</li>
                <li>Discrepancy in quantities must be notified within 48 hours of dispatch.</li>
              </ul>
            </div>

            <div className="flex flex-col justify-end items-end text-right">
              <div className="h-14" />
              <div className="border-t border-slate-400 w-56 pt-1">
                <p className="font-bold text-slate-900">For {COMPANY_PROFILE.name}</p>
                <p className="text-[11px] text-slate-500">Authorized Procurement Signatory</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
