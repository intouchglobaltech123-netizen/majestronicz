import React from 'react';
import { DeliveryChallan, COMPANY_PROFILE } from '../../types';
import { MajestroniczLogo } from '../common/MajestroniczLogo';
import {
  X,
  Printer,
  Share2,
  Copy,
  Check,
  Building,
  Truck,
} from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  challan: DeliveryChallan | null;
  isOpen: boolean;
  onClose: () => void;
  onCreateNew?: () => void;
}

export const DeliveryChallanPdfModal: React.FC<Props> = ({
  challan,
  isOpen,
  onClose,
  onCreateNew,
}) => {
  const [copied, setCopied] = React.useState(false);

  if (!isOpen || !challan) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleShareWhatsApp = () => {
    const text = `*DELIVERY CHALLAN — ${COMPANY_PROFILE.name}*\nChallan No: ${challan.challanNumber}\nDate: ${challan.date}\nDelivered To: ${challan.recipientName}\nTotal Qty: ${challan.totalQuantity} items\n\nGoods Movement Verification Note.`;
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  const handleCopySummary = () => {
    const summary = `${COMPANY_PROFILE.name} Delivery Challan: ${challan.challanNumber}\nDate: ${challan.date}\nRecipient: ${challan.recipientName}\nTotal Quantity: ${challan.totalQuantity} items\nItems: ${challan.items.length}`;
    navigator.clipboard.writeText(summary);
    setCopied(true);
    toast.success('Challan details copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/70 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto print:p-0 print:bg-white">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[96vh] print:max-h-none print:border-none print:shadow-none print:w-full print:rounded-none">
        {/* Action Header (Hidden during Print) */}
        <div className="px-6 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2">
            <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
              Delivery Challan Preview
            </span>
            <span className="text-xs font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
              {challan.challanNumber}
            </span>
            <span className="text-[10px] font-bold text-slate-600 bg-slate-200/70 px-1.5 py-0.5 rounded">
              Goods Movement Note
            </span>
          </div>

          {/* Document Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopySummary}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
              title="Copy Summary"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-slate-500" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>

            <button
              onClick={handleShareWhatsApp}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
              title="Share on WhatsApp"
            >
              <Share2 className="h-3.5 w-3.5 text-emerald-600" />
              <span>Share</span>
            </button>

            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-xs"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Print / Save as PDF</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors ml-2"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Printable PDF Document Body */}
        <div id="printable-challan-doc" className="p-8 overflow-y-auto flex-1 bg-white text-slate-900 font-sans print:p-6 print:overflow-visible">
          {/* Header Block with Blue Bar Accent */}
          <div className="border border-slate-200 rounded-xl overflow-hidden mb-5">
            {/* Top Blue Accent Title Strip */}
            <div className="bg-blue-600 text-white px-6 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4" />
                <span className="text-sm font-black uppercase tracking-widest">
                  DELIVERY CHALLAN
                </span>
                <span className="text-xs bg-white/20 px-2 py-0.5 rounded font-mono">
                  GOODS DISPATCH NOTE
                </span>
              </div>
              <div className="text-xs font-mono font-bold tracking-wider">
                ORIGINAL COPY
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

              {/* Right: Challan Meta Box */}
              <div className="w-full md:w-72 bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-xs">
                <div className="flex justify-between border-b border-slate-200 pb-1.5">
                  <span className="text-slate-500 font-medium">Challan No:</span>
                  <span className="font-mono font-black text-blue-700 text-sm">{challan.challanNumber}</span>
                </div>
                <div className="flex justify-between border-b border-slate-200 pb-1.5">
                  <span className="text-slate-500 font-medium">Date:</span>
                  <span className="font-semibold text-slate-800">{challan.date}</span>
                </div>
                <div className="flex justify-between border-b border-slate-200 pb-1.5">
                  <span className="text-slate-500 font-medium">Time:</span>
                  <span className="font-semibold text-slate-800">{challan.time}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-medium">Nature of Goods:</span>
                  <span className="font-semibold text-slate-800">Dispatch / Movement</span>
                </div>
              </div>
            </div>

            {/* Recipient Information Block: "Delivery Challan For" */}
            <div className="p-5 bg-slate-50/50 text-xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                Delivery Challan For (Recipient Details)
              </span>
              <p className="text-base font-extrabold text-slate-900">{challan.recipientName}</p>
              {challan.location && (
                <p className="text-slate-600 mt-0.5 max-w-xl">
                  <strong>Location / Destination:</strong> {challan.location}
                </p>
              )}
              {challan.contactNo && (
                <p className="text-slate-600 mt-0.5">
                  <strong>Contact No:</strong> {challan.contactNo}
                </p>
              )}
            </div>
          </div>

          {/* Line Items Table (NO PRICING - Goods Movement Only) */}
          <div className="border border-slate-200 rounded-xl overflow-hidden mb-6">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-slate-100 text-slate-700 border-b border-slate-200 font-bold">
                  <th className="py-2.5 px-3 w-10 text-center">#</th>
                  <th className="py-2.5 px-3">Item Description / Model</th>
                  <th className="py-2.5 px-3 w-28 text-center">HSN / SAC</th>
                  <th className="py-2.5 px-3 w-28 text-right">Quantity</th>
                  <th className="py-2.5 px-3 w-24 text-center">Unit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {challan.items.map((item, index) => (
                  <tr key={item.id || index} className="hover:bg-slate-50/50">
                    <td className="py-2.5 px-3 text-center text-slate-500 font-mono">
                      {index + 1}
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-slate-900">
                      {item.itemName}
                    </td>
                    <td className="py-2.5 px-3 text-center text-slate-600 font-mono">
                      {item.itemHSN || '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-black text-slate-900 font-mono text-sm">
                      {item.quantity}
                    </td>
                    <td className="py-2.5 px-3 text-center font-bold text-slate-600">
                      {item.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Total Quantity Row */}
              <tfoot>
                <tr className="bg-blue-50/70 border-t-2 border-slate-300 font-bold text-slate-900">
                  <td colSpan={3} className="py-3 px-3 text-right text-xs uppercase tracking-wider text-slate-700">
                    Total Quantity Dispatched:
                  </td>
                  <td className="py-3 px-3 text-right text-sm font-black font-mono text-blue-700">
                    {challan.totalQuantity}
                  </td>
                  <td className="py-3 px-3 text-center text-xs text-blue-700 font-bold">
                    Units / Items
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Terms and Conditions */}
          {challan.termsAndConditions && (
            <div className="mb-6 p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                Terms & Conditions / Dispatch Note
              </span>
              <p className="text-slate-700 whitespace-pre-line font-medium leading-relaxed">
                {challan.termsAndConditions}
              </p>
            </div>
          )}

          {/* Dual Verification Blocks: Delivered By & Received By */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            {/* Delivered By Block */}
            <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-2.5 text-xs">
              <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                <span className="text-[10px] font-black uppercase tracking-wider text-blue-700">
                  Delivered By (Sender Verification)
                </span>
                <span className="text-[10px] text-slate-400">Dispatch Check</span>
              </div>
              <div className="space-y-1.5 text-slate-700">
                <div className="flex gap-2">
                  <span className="text-slate-400 font-medium w-16 shrink-0">Name:</span>
                  <span className="font-semibold text-slate-800">
                    {challan.deliveredBy?.name || '________________________'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="text-slate-400 font-medium w-16 shrink-0">Comment:</span>
                  <span className="text-slate-700">
                    {challan.deliveredBy?.comment || '________________________'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="text-slate-400 font-medium w-16 shrink-0">Date:</span>
                  <span className="font-mono text-slate-800">
                    {challan.deliveredBy?.date || challan.date}
                  </span>
                </div>
              </div>
              <div className="pt-6 border-t border-dashed border-slate-200 text-center">
                <span className="text-[10px] text-slate-400 block">Sender / Dispatch Signature</span>
              </div>
            </div>

            {/* Received By Block */}
            <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-2.5 text-xs">
              <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700">
                  Received By (Recipient Verification)
                </span>
                <span className="text-[10px] text-slate-400">Acknowledgment</span>
              </div>
              <div className="space-y-1.5 text-slate-700">
                <div className="flex gap-2">
                  <span className="text-slate-400 font-medium w-16 shrink-0">Name:</span>
                  <span className="font-semibold text-slate-800">
                    {challan.receivedBy?.name || '________________________'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="text-slate-400 font-medium w-16 shrink-0">Comment:</span>
                  <span className="text-slate-700">
                    {challan.receivedBy?.comment || '________________________'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="text-slate-400 font-medium w-16 shrink-0">Date:</span>
                  <span className="font-mono text-slate-800">
                    {challan.receivedBy?.date || '____/____/________'}
                  </span>
                </div>
              </div>
              <div className="pt-6 border-t border-dashed border-slate-200 text-center">
                <span className="text-[10px] text-slate-400 block">Recipient Signature & Stamp</span>
              </div>
            </div>
          </div>

          {/* Footer Signature Box */}
          <div className="pt-6 border-t border-slate-200 flex flex-col sm:flex-row items-end justify-between gap-6 text-xs">
            <div className="text-slate-500 text-[10px] space-y-1">
              <p>This goods delivery challan accompanies merchandise in transit.</p>
              <p>For inquiries, please contact: <strong>6379560289</strong> or <strong>majestroniczonline@gmail.com</strong></p>
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

        {/* Modal Bottom Footer (Hidden during Print) */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Building className="h-4 w-4 text-blue-600" />
            <span>Standard Goods Movement Note • Majestronicz ERP</span>
          </div>
          <div className="flex items-center gap-2">
            {onCreateNew && (
              <button
                onClick={() => {
                  onClose();
                  onCreateNew();
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-xs"
              >
                + Create New Challan
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition-colors"
            >
              Close Preview
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
