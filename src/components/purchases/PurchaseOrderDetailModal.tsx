import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Printer,
  PackageCheck,
  Clock,
  Paperclip,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Building2,
  Calendar,
  Download,
  ExternalLink,
  Trash2,
  Eye,
  Upload,
  Layers,
  FileText,
  ShoppingBag,
  Info,
} from 'lucide-react';
import {
  PurchaseOrder,
  PurchaseOrderAttachment,
  PODebitNote,
  COMPANY_PROFILE,
  BRANCHES,
  poLineOpen,
  purchaseOrderGrandOwed,
  purchaseOrderBalanceDue,
  purchaseOrderAdvance,
  purchaseOrderOpenValue,
  purchaseOrderPayCap,
  purchaseOrderTotalValue,
  SupplierBill,
  supplierBillsOf,
} from '../../types';
import { useErp } from '../../context/ErpContext';
import { formatCurrency, formatDate, cn, getTodayDateString } from '../../lib/utils';
import { resizeAndCompressImage } from '../../lib/imageUtils';
import { toast } from 'sonner';
import { apiGet } from '../../lib/api';
import { ReceiveStockModal } from './ReceiveStockModal';
import { PurchaseOrderPdfModal } from './PurchaseOrderPdfModal';

// An attachment's dataUrl is opened, downloaded and rendered as an <img>/href.
// A stored value like `javascript:...` would execute when that href/window.open
// runs, so only ever trust a real base64 image/PDF data URL (PUR4-4). Anything
// else resolves to '' — the link/preview simply does nothing.
const safeAttachmentDataUrl = (raw: unknown): string => {
  const s = typeof raw === 'string' ? raw.trim() : '';
  // UPG10-8: a file the server could not confirm is a real image/PDF comes back
  // as application/octet-stream — it can only be downloaded, never shown inline.
  return /^data:(image\/[a-z0-9.+-]+|application\/pdf|application\/octet-stream);base64,/i.test(s) ? s : '';
};

/** PUR2-12: the PO list carries only the file list — a file's body is loaded
 *  when it is opened, downloaded or shown as a thumbnail. */
const attachmentBodyCache = new Map<string, string>();
async function loadAttachmentBody(poId: string, att: PurchaseOrderAttachment): Promise<string> {
  if (att.dataUrl) return safeAttachmentDataUrl(att.dataUrl);
  const key = `${poId}/${att.id}`;
  if (!attachmentBodyCache.has(key)) {
    const res = await apiGet<{ dataUrl: string }>(`/api/purchase/attachment/${encodeURIComponent(poId)}/${encodeURIComponent(att.id)}`);
    attachmentBodyCache.set(key, safeAttachmentDataUrl(res?.dataUrl));
  }
  return attachmentBodyCache.get(key) || '';
}

const AttachmentThumb: React.FC<{ poId: string; att: PurchaseOrderAttachment }> = ({ poId, att }) => {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let live = true;
    loadAttachmentBody(poId, att).then((u) => { if (live) setSrc(u); }).catch(() => {});
    return () => { live = false; };
  }, [poId, att]);
  return src ? <img src={src} alt={att.name} className="h-full w-full object-cover" /> : <FileText className="h-7 w-7 text-slate-400" />;
};

/** "2 damaged · 1 missing" — never "× 0 damaged" for a short shipment (PUR4-5). */
const debitNoteQtyLabel = (l: { damagedQuantity?: number; missingQuantity?: number }): string =>
  [l.damagedQuantity ? `${l.damagedQuantity} damaged` : '', l.missingQuantity ? `${l.missingQuantity} missing` : '']
    .filter(Boolean)
    .join(' · ') || '0';

interface PurchaseOrderDetailModalProps {
  purchaseOrder: PurchaseOrder | null;
  isOpen: boolean;
  onClose: () => void;
  onReceiveStock?: (po: PurchaseOrder) => void;
}

type TabType = 'overview' | 'history' | 'bills' | 'linked';

export const PurchaseOrderDetailModal: React.FC<PurchaseOrderDetailModalProps> = ({
  purchaseOrder,
  isOpen,
  onClose,
}) => {
  const {
    canManagePurchases,
    releasePoOverpayment,
    cancelPurchaseOrder,
    addPurchaseOrderAttachment,
    deletePurchaseOrderAttachment,
    recordPurchaseOrderPayment,
    recordPurchaseBill,
    deletePurchaseBill,
    savePurchaseOrder,
    pendingOrders,
    setSelectedPendingOrderForDetail,
    setCurrentView,
  } = useErp();
  // Edit-prices mode: only before any goods are received (status 'Ordered'), so
  // we never rewrite the cost of stock already taken in.
  const [isEditingPrices, setIsEditingPrices] = useState(false);
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});

  const startEditPrices = () => {
    if (!purchaseOrder) return;
    const seed: Record<string, string> = {};
    purchaseOrder.items.forEach((it) => { seed[it.id] = String(it.purchasePrice ?? 0); });
    setPriceEdits(seed);
    setIsEditingPrices(true);
  };
  const saveEditedPrices = async () => {
    if (!purchaseOrder) return;
    const newItems = purchaseOrder.items.map((it) => {
      const raw = priceEdits[it.id];
      const price = raw != null && raw !== '' ? Math.max(0, Number(raw) || 0) : (it.purchasePrice || 0);
      const amount = Math.round(price * (it.quantityOrdered || 0) * 100) / 100;
      const taxPercent = it.taxPercent || 0;
      const taxAmount = Math.round((amount * taxPercent) / 100 * 100) / 100;
      return { ...it, purchasePrice: price, amount, taxAmount, lineTotal: Math.round((amount + taxAmount) * 100) / 100 };
    });
    const totalAmount = Math.round(newItems.reduce((s, i) => s + (i.amount || 0), 0) * 100) / 100;
    const totalTax = Math.round(newItems.reduce((s, i) => s + (i.taxAmount || 0), 0) * 100) / 100;
    const saved = await savePurchaseOrder({ ...purchaseOrder, items: newItems, totalAmount, totalTax });
    if (saved) setIsEditingPrices(false);
  };
  const [payAmt, setPayAmt] = React.useState<string>('');
  const [paying, setPaying] = React.useState(false);
  const [payMode, setPayMode] = React.useState<string>('Cash');
  // Supplier bills (E2E5-11): a PO can carry one bill per delivery. The form
  // adds a new bill, or edits the one picked from the list.
  const [billNo, setBillNo] = React.useState<string>('');
  const [billDate, setBillDate] = React.useState<string>('');
  const [billTaxable, setBillTaxable] = React.useState<string>('');
  const [billGst, setBillGst] = React.useState<string>('');
  const [billAttachmentId, setBillAttachmentId] = React.useState<string>('');
  const [editingBillId, setEditingBillId] = React.useState<string | null>(null);
  const [savingBill, setSavingBill] = React.useState(false);
  const resetBillForm = () => {
    setBillNo(''); setBillDate(''); setBillTaxable(''); setBillGst(''); setBillAttachmentId(''); setEditingBillId(null);
  };
  React.useEffect(() => { resetBillForm(); }, [purchaseOrder?.id]);
  const editBill = (b: SupplierBill) => {
    setEditingBillId(b.id);
    setBillNo(b.number || '');
    setBillDate(b.date || '');
    setBillTaxable(b.taxable ? String(b.taxable) : '');
    setBillGst(b.gst ? String(b.gst) : '');
    setBillAttachmentId(b.attachmentId || '');
  };

  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [isUploading, setIsUploading] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ src: string; title: string } | null>(null);
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen || !purchaseOrder) return null;

  const branchData = BRANCHES.find((b) => b.id === purchaseOrder.branchId);
  const totalOrdered = purchaseOrder.items.reduce((s, it) => s + it.quantityOrdered, 0);
  const totalReceived = purchaseOrder.items.reduce((s, it) => s + (it.receivedQuantity || 0), 0);
  const progressPct = totalOrdered > 0 ? Math.round((totalReceived / totalOrdered) * 100) : 0;
  const todayStr = getTodayDateString();
  const isOverdue =
    (purchaseOrder.status === 'Ordered' || purchaseOrder.status === 'Partially Received') &&
    purchaseOrder.expectedDeliveryDate < todayStr;

  // Cross-linked Pending Order (Prompt 23)
  const linkedPendingOrder =
    purchaseOrder.pendingOrderId
      ? pendingOrders.find((p) => p.id === purchaseOrder.pendingOrderId)
      : pendingOrders.find(
          (p) =>
            p.purchaseOrderId === purchaseOrder.id ||
            p.linkedPurchaseOrderId === purchaseOrder.id ||
            p.purchaseOrderNumber === purchaseOrder.poNumber
        );

  const attachments = purchaseOrder.attachments || [];
  const receivingHistory = purchaseOrder.receivingHistory || [];
  const debitNotes = purchaseOrder.debitNotes || [];
  const debitNotesTotal = debitNotes.reduce((s, dn) => s + (dn.totalAmount || 0), 0);
  // Units settled (good + damaged + missing) — a line is done when nothing is
  // still expected, even if part of it was damaged or short-shipped (E2E-5).
  const totalSettled = purchaseOrder.items.reduce((s, it) => s + (it.quantityOrdered - poLineOpen(it)), 0);

  // GST at the line rates. `totalTax` is absent on orders created before tax was
  // captured, so fall back to summing the lines (purchaseOrderOrderedTotal).
  const poTotalTax =
    purchaseOrder.totalTax ??
    purchaseOrder.items.reduce((sum, l) => sum + (l.taxAmount || 0), 0);
  // PUR9-5: received at receipt rates + still expected + charges.
  const poGrandTotal = purchaseOrderTotalValue(purchaseOrder);

  // File Upload Handler (PDF or Image, base64 stopgap)
  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isImg =
      file.type.startsWith('image/') ||
      /\.(jpe?g|png|webp)$/i.test(file.name.toLowerCase());

    if (!isPdf && !isImg) {
      toast.error('Unsupported file format. Please upload a PDF or an Image (JPG, PNG, WEBP).');
      return;
    }

    // PUR-12: the server accepts up to 5 MB per file (10 MB per PO). A photo is
    // compressed first, so only its compressed size counts; a PDF is sent as is.
    const MAX_BYTES = 5 * 1024 * 1024;
    if (isPdf && file.size > MAX_BYTES) {
      toast.error('The PDF is larger than 5 MB.');
      return;
    }
    if (!isPdf && file.size > 40 * 1024 * 1024) {
      toast.error('The photo is too large to process (over 40 MB).');
      return;
    }

    setIsUploading(true);

    try {
      if (isImg) {
        // Compress client-side (longest edge 1200px for invoice text legibility, 85% quality JPEG)
        const processed = await resizeAndCompressImage(file, 1200, 0.85);
        if (processed.sizeKb * 1024 > MAX_BYTES) {
          toast.error('The photo is still larger than 5 MB after compression.');
          return;
        }
        await addPurchaseOrderAttachment(purchaseOrder.id, {
          name: file.name,
          fileType: 'image',
          fileSize: `${processed.sizeKb} KB`,
          dataUrl: processed.dataUrl,
        });
      } else {
        // PDF processing via FileReader
        const reader = new FileReader();
        reader.onerror = () => {
          toast.error('Failed to read PDF file.');
          setIsUploading(false);
        };
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            const sizeKb = Math.round(file.size / 1024);
            addPurchaseOrderAttachment(purchaseOrder.id, {
              name: file.name,
              fileType: 'pdf',
              fileSize: `${sizeKb} KB`,
              dataUrl: reader.result,
            });
            setIsUploading(false);
          } else {
            toast.error('Invalid PDF file content.');
            setIsUploading(false);
          }
        };
        reader.readAsDataURL(file);
        return; // reader callback completes it
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to process file upload.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDownloadAttachment = async (attachment: PurchaseOrderAttachment) => {
    const safe = await loadAttachmentBody(purchaseOrder.id, attachment).catch(() => '');
    if (!safe) {
      toast.error('This attachment is not a valid file and cannot be opened.');
      return;
    }
    try {
      const link = document.createElement('a');
      link.href = safe;
      link.download = attachment.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      toast.error('Download failed. Unable to extract file.');
    }
  };

  const handleOpenAttachment = async (attachment: PurchaseOrderAttachment) => {
    const safe = await loadAttachmentBody(purchaseOrder.id, attachment).catch(() => '');
    if (!safe) {
      toast.error('This attachment is not a valid file and cannot be opened.');
      return;
    }
    // UPG10-8: not a confirmed image/PDF — offered as a download only.
    if (/^data:application\/octet-stream/i.test(safe)) {
      toast.warning('This older file is not a recognised image or PDF, so it is downloaded instead of opened.');
      await handleDownloadAttachment(attachment);
      return;
    }
    if (attachment.fileType === 'image') {
      setPreviewImage({ src: safe, title: attachment.name });
    } else {
      // PDF: convert base64 to Blob URL to open reliably in a new tab. Never
      // fall back to window.open(dataUrl) with an untrusted string (PUR4-4).
      try {
        const arr = safe.split(',');
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
          u8arr[n] = bstr.charCodeAt(n);
        }
        const blob = new Blob([u8arr], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
      } catch (err) {
        toast.error('Unable to open this attachment.');
      }
    }
  };

  const handleJumpToPendingOrder = () => {
    if (linkedPendingOrder) {
      setSelectedPendingOrderForDetail(linkedPendingOrder);
      setCurrentView('pending-orders');
      onClose();
    }
  };

  // Print the damaged-goods debit note as a standalone bill for the vendor.
  const handlePrintDebitNote = (dn: PODebitNote) => {
    const esc = (s: any) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
    const inr = (n: number) => `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const td = 'border:1px solid #333;padding:6px 8px';
    // Older notes carry no GST split — their amount is the taxable value.
    const taxableOf = (l: PODebitNote['lines'][number]) => l.taxableValue ?? (l.amount || 0) - (l.taxAmount || 0);
    const rows = dn.lines
      .map(
        (l, i) => `<tr>
          <td style="${td};text-align:center">${i + 1}</td>
          <td style="${td}">${esc(l.itemName)}${l.itemCode ? ` <span style="color:#666">(${esc(l.itemCode)})</span>` : ''}</td>
          <td style="${td};text-align:right">${l.damagedQuantity || 0}</td>
          <td style="${td};text-align:right">${l.missingQuantity || 0}</td>
          <td style="${td};text-align:right">${inr(l.unitPrice || 0)}</td>
          <td style="${td};text-align:right">${inr(taxableOf(l))}</td>
          <td style="${td};text-align:right">${l.taxPercent != null ? `${l.taxPercent}%<br/>` : ''}${inr(l.taxAmount || 0)}</td>
          <td style="${td};text-align:right">${inr(l.amount || 0)}</td>
        </tr>`
      )
      .join('');
    const totalTaxable = dn.totalTaxable ?? dn.lines.reduce((s, l) => s + taxableOf(l), 0);
    const totalTax = dn.totalTax ?? dn.lines.reduce((s, l) => s + (l.taxAmount || 0), 0);
    const html = `<!doctype html><html><head><title>${esc(dn.noteNumber)}</title>
      <style>body{font:13px/1.5 system-ui,Arial,sans-serif;color:#111;margin:28px}h1{font-size:20px;margin:0}table{border-collapse:collapse;width:100%;margin-top:12px}th{border:1px solid #333;padding:6px 8px;background:#f3f3f3;text-align:left}.noprint{position:fixed;top:12px;right:12px;padding:8px 14px;background:#b91c1c;color:#fff;border:none;border-radius:6px;font:bold 13px system-ui;cursor:pointer}@media print{.noprint{display:none!important}}</style>
      </head><body><button class="noprint" onclick="window.print()">Print / Save PDF</button>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #b91c1c;padding-bottom:10px">
        <div><h1>${esc(COMPANY_PROFILE.name)}</h1><div style="color:#555">${esc(COMPANY_PROFILE.address)}</div>
        <div style="color:#555">GSTIN: ${esc(COMPANY_PROFILE.gstin)} · ${esc(COMPANY_PROFILE.phone)}</div></div>
        <div style="text-align:right"><h2 style="margin:0;color:#b91c1c">DEBIT NOTE</h2>
        <div><strong>${esc(dn.noteNumber)}</strong></div><div>Date: ${esc(dn.date)}</div></div>
      </div>
      <div style="margin-top:12px"><strong>Vendor:</strong> ${esc(purchaseOrder.vendorName)}${purchaseOrder.vendorGstin ? ` · GSTIN: ${esc(purchaseOrder.vendorGstin)}` : ''}</div>
      <div><strong>Against PO:</strong> ${esc(purchaseOrder.poNumber)} · <strong>Reason:</strong> Damaged / rejected or short-shipped (missing) goods</div>
      <table><thead><tr><th style="text-align:center">#</th><th>Item</th><th style="text-align:right">Damaged</th><th style="text-align:right">Missing</th><th style="text-align:right">Rate</th><th style="text-align:right">Taxable</th><th style="text-align:right">GST</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="5" style="${td};text-align:right;font-weight:bold">Total Debit</td>
      <td style="${td};text-align:right;font-weight:bold">${inr(totalTaxable)}</td>
      <td style="${td};text-align:right;font-weight:bold">${inr(totalTax)}</td>
      <td style="${td};text-align:right;font-weight:bold">${inr(dn.totalAmount || 0)}</td></tr></tfoot></table>
      <p style="margin-top:14px;color:#555">This debit note is raised on the vendor for goods received damaged or not delivered (short shipment), including the GST on them (input tax credit reversed). Only goods received in good condition are payable on this PO.</p>
      <div style="margin-top:40px;text-align:right">For ${esc(COMPANY_PROFILE.name)}<br/><br/>Authorised Signatory</div>
      
      </body></html>`;
    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) { toast.error('Allow pop-ups to print the debit note'); return; }
    w.document.write(html);
    w.document.close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white border border-slate-300 rounded-none w-full max-w-5xl shadow-xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Top Header Bar */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-none bg-red-50 text-red-700 flex items-center justify-center border border-red-200 shrink-0">
              <ShoppingBag className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-base font-bold text-slate-900">
                  Purchase Order Detail
                </h2>
                <span className="font-mono text-xs font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded-none border border-red-200">
                  {purchaseOrder.poNumber}
                </span>
                {/* Status Badge */}
                <span
                  className={cn(
                    'inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-none border',
                    purchaseOrder.status === 'Received'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : purchaseOrder.status === 'Partially Received'
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : purchaseOrder.status === 'Cancelled'
                      ? 'bg-slate-100 text-slate-500 border-slate-200'
                      : 'bg-slate-100 text-slate-800 border-slate-300'
                  )}
                >
                  {purchaseOrder.status === 'Received' && <CheckCircle2 className="h-3 w-3" />}
                  {purchaseOrder.status === 'Partially Received' && <Clock className="h-3 w-3" />}
                  {purchaseOrder.status === 'Cancelled' && <XCircle className="h-3 w-3" />}
                  <span>{purchaseOrder.status}</span>
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Vendor: <strong className="text-slate-800">{purchaseOrder.vendorName}</strong> • Hub:{' '}
                <strong className="text-slate-800">{branchData?.name || purchaseOrder.branchId}</strong>
              </p>
            </div>
          </div>

          {/* Header Quick Actions */}
          <div className="flex items-center gap-2">
            {(purchaseOrder.status === 'Ordered' || purchaseOrder.status === 'Partially Received') &&
              canManagePurchases && (
                <button
                  type="button"
                  onClick={() => setIsReceiveModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 shadow-xs transition-colors"
                >
                  <PackageCheck className="h-3.5 w-3.5" />
                  <span>Receive Stock</span>
                </button>
              )}

            <button
              type="button"
              onClick={() => setIsPdfModalOpen(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-xl text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 transition-colors shadow-2xs"
              title="View Official Purchase Order PDF"
            >
              <Printer className="h-3.5 w-3.5 text-slate-500" />
              <span className="hidden sm:inline">PO Document</span>
            </button>

            {purchaseOrder.status === 'Ordered' && canManagePurchases && !((purchaseOrder.amountPaid || 0) > 0) && (
              <button
                type="button"
                onClick={async () => {
                  if (window.confirm(`Are you sure you want to cancel Purchase Order ${purchaseOrder.poNumber}?`)) {
                    if (await cancelPurchaseOrder(purchaseOrder.id)) onClose();
                  }
                }}
                className="px-2.5 py-1.5 text-xs font-semibold rounded-xl text-rose-600 bg-rose-50 border border-rose-200 hover:bg-rose-100 transition-colors"
                title="Cancel this order"
              >
                Cancel PO
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors ml-1"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation Strip */}
        <div className="px-6 border-b border-slate-200 bg-white flex items-center gap-6 text-xs font-bold shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={cn(
              'py-3 border-b-2 -mb-[1px] flex items-center gap-2 transition-colors cursor-pointer',
              activeTab === 'overview'
                ? 'border-red-600 text-red-700 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            )}
          >
            <FileText className="h-3.5 w-3.5" />
            <span>Overview</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={cn(
              'py-3 border-b-2 -mb-[1px] flex items-center gap-2 transition-colors cursor-pointer',
              activeTab === 'history'
                ? 'border-red-600 text-red-700 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            )}
          >
            <Clock className="h-3.5 w-3.5" />
            <span>Receiving History</span>
            <span
              className={cn(
                'px-1.5 py-0.2 rounded-none text-[11px] font-mono',
                receivingHistory.length > 0
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-slate-100 text-slate-500'
              )}
            >
              {receivingHistory.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('bills')}
            className={cn(
              'py-3 border-b-2 -mb-[1px] flex items-center gap-2 transition-colors cursor-pointer',
              activeTab === 'bills'
                ? 'border-red-600 text-red-700 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            )}
          >
            <Paperclip className="h-3.5 w-3.5" />
            <span>Vendor Bills</span>
            <span
              className={cn(
                'px-1.5 py-0.2 rounded-none text-[11px] font-mono',
                attachments.length > 0
                  ? 'bg-slate-100 text-slate-800 font-bold'
                  : 'bg-slate-100 text-slate-500'
              )}
            >
              {attachments.length}
            </span>
          </button>

          {linkedPendingOrder && (
            <button
              type="button"
              onClick={() => setActiveTab('linked')}
              className={cn(
                'py-3 border-b-2 -mb-[1px] flex items-center gap-2 transition-colors cursor-pointer',
                activeTab === 'linked'
                  ? 'border-red-600 text-red-700 font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              )}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>Linked Records</span>
              <span className="px-1.5 py-0.2 rounded-none bg-slate-100 text-slate-800 font-mono">
                1
              </span>
            </button>
          )}
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 space-y-6">
          {/* ================= TAB 1: OVERVIEW ================= */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* KPI Summary Banner */}
              <div className="grid grid-cols-1 sm:grid-cols-2 sm:grid-cols-4 gap-3">
                {/* Total Value */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                    Order Value
                  </span>
                  <div className="text-lg font-mono font-bold text-slate-900 mt-1">
                    {formatCurrency(poGrandTotal)}
                  </div>
                  {/* Goods and GST shown separately: "order value" alone hid
                      whether tax was included, so the payable never matched the
                      supplier's bill. */}
                  <span className="text-[11px] text-slate-500 mt-0.5 block font-mono">
                    {formatCurrency(purchaseOrder.totalAmount)} goods
                    {poTotalTax > 0 ? ` + ${formatCurrency(poTotalTax)} GST` : ''}
                  </span>
                  <span className="text-[11px] text-slate-500 block">
                    {purchaseOrder.items.length} line {purchaseOrder.items.length === 1 ? 'item' : 'items'}
                  </span>
                </div>

                {/* Units Fulfillment */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                    Fulfillment Progress
                  </span>
                  <div className="text-lg font-mono font-bold text-slate-900 mt-1">
                    {totalReceived} / {totalOrdered} <span className="text-xs text-slate-400 font-normal">units</span>
                  </div>
                  {/* Progress bar */}
                  <div className="w-full bg-slate-100 rounded-full h-1.5 mt-2 overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        progressPct === 100
                          ? 'bg-emerald-500'
                          : progressPct > 0
                          ? 'bg-amber-500'
                          : 'bg-slate-300'
                      )}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>

                {/* Expected Delivery Date */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                    Expected Delivery
                  </span>
                  <div className="text-sm font-bold text-slate-900 mt-1 flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-slate-400" />
                    <span>{purchaseOrder.expectedDeliveryDate}</span>
                  </div>
                  {isOverdue ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded mt-1 border border-rose-200">
                      <AlertTriangle className="h-3 w-3 text-rose-600" />
                      Delivery Overdue
                    </span>
                  ) : (
                    <span className="text-[11px] text-emerald-600 font-medium mt-1 block">
                      Ordered on {purchaseOrder.date}
                    </span>
                  )}
                </div>

                {/* Vendor Bills Attached */}
                <div
                  onClick={() => setActiveTab('bills')}
                  className="bg-white p-4 rounded-none border border-slate-200 shadow-none cursor-pointer hover:border-red-600 hover:bg-red-50/20 transition-all group"
                >
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block group-hover:text-red-700">
                    Vendor Bills
                  </span>
                  <div className="text-lg font-mono font-bold text-slate-900 mt-1 flex items-center justify-between">
                    <span>{attachments.length} attached</span>
                    <Paperclip className="h-4 w-4 text-slate-400 group-hover:text-red-700" />
                  </div>
                  <span className="text-[11px] text-red-700 font-semibold mt-0.5 block group-hover:underline">
                    {attachments.length > 0 ? 'Click to view bills' : '+ Upload bill'}
                  </span>
                </div>
              </div>

              {/* Vendor & Delivery Meta */}
              <div className="bg-white p-4 rounded-none border border-slate-200 shadow-none grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Vendor Info */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                    Vendor / Supplier Information
                  </h4>
                  <div className="text-sm font-bold text-slate-900">{purchaseOrder.vendorName}</div>
                  {purchaseOrder.vendorAddress && (
                    <p className="text-xs text-slate-500 mt-1">{purchaseOrder.vendorAddress}</p>
                  )}
                  <div className="text-xs text-slate-600 mt-2 space-y-0.5 font-mono">
                    {purchaseOrder.vendorGstin && (
                      <p>
                        GSTIN: <strong className="text-slate-800">{purchaseOrder.vendorGstin}</strong>
                      </p>
                    )}
                    {purchaseOrder.vendorContact && (
                      <p>
                        Contact: <strong className="text-slate-800">{purchaseOrder.vendorContact}</strong>
                      </p>
                    )}
                  </div>
                </div>

                {/* Delivery & Hub Info */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                    Receiving Hub & Destination
                  </h4>
                  <div className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                    <Building2 className="h-4 w-4 text-slate-600" />
                    <span>{branchData?.name || purchaseOrder.branchId}</span>
                  </div>
                  {branchData?.location && (
                    <p className="text-xs text-slate-500 mt-1">{branchData.location}</p>
                  )}
                  <div className="mt-3 p-2.5 bg-slate-50 rounded-none border border-slate-200 text-xs text-slate-600">
                    <span className="font-bold text-slate-700">Remarks / PO Notes:</span>{' '}
                    {purchaseOrder.notes || 'No special notes specified.'}
                  </div>
                </div>
              </div>

              {/* Supplier tax invoices (bills) → Input Tax Credit. One per delivery (E2E5-11). */}
              {(() => {
                const bills = supplierBillsOf(purchaseOrder);
                const itcTotal = Math.round(bills.reduce((t, b) => t + (Number(b.gst) || 0), 0) * 100) / 100;
                const fileName = (id?: string | null) => (id ? attachments.find((a) => a.id === id)?.name : undefined);
                return (
              <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-slate-700">Supplier Bills (Input Tax Credit)</span>
                  {bills.length ? (
                    <span className="text-[11px] font-bold text-emerald-700">{bills.length} bill{bills.length > 1 ? 's' : ''} · ITC: {formatCurrency(itcTotal)}</span>
                  ) : (
                    <span className="text-[11px] font-bold text-amber-700">No bill entered</span>
                  )}
                </div>
                {bills.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs" data-testid="supplier-bills">
                      <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                        <tr>
                          <th className="px-3 py-1.5 text-left">Bill No.</th>
                          <th className="px-3 py-1.5 text-left">Date</th>
                          <th className="px-3 py-1.5 text-right">Taxable</th>
                          <th className="px-3 py-1.5 text-right">GST / ITC</th>
                          <th className="px-3 py-1.5 text-left">File</th>
                          {canManagePurchases && <th className="px-3 py-1.5" />}
                        </tr>
                      </thead>
                      <tbody>
                        {bills.map((b) => (
                          <tr key={b.id} className={cn('border-t border-slate-100', editingBillId === b.id && 'bg-amber-50')}>
                            <td className="px-3 py-1.5 font-semibold text-slate-900">{b.number}</td>
                            <td className="px-3 py-1.5 text-slate-700">{formatDate(b.date)}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{formatCurrency(b.taxable)}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-emerald-800">{formatCurrency(b.gst)}</td>
                            <td className="px-3 py-1.5 text-slate-600 truncate max-w-[140px]">{fileName(b.attachmentId) || '—'}</td>
                            {canManagePurchases && (
                              <td className="px-3 py-1.5 text-right whitespace-nowrap">
                                <button type="button" onClick={() => editBill(b)} className="text-[11px] font-bold text-slate-700 hover:text-red-700 mr-2 cursor-pointer">Edit</button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    if (!window.confirm(`Remove supplier bill ${b.number}?`)) return;
                                    if (await deletePurchaseBill(purchaseOrder.id, b.id) && editingBillId === b.id) resetBillForm();
                                  }}
                                  className="text-[11px] font-bold text-red-700 hover:text-red-800 cursor-pointer"
                                >
                                  Remove
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {canManagePurchases && (
                <div className="p-4 grid grid-cols-2 sm:grid-cols-5 gap-2.5 items-end border-t border-slate-100">
                  <div>
                    <label htmlFor="po-bill-no" className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Bill No.</label>
                    <input id="po-bill-no" value={billNo} onChange={(e) => setBillNo(e.target.value)} placeholder="INV-1234"
                      className="w-full px-2.5 py-1.5 rounded-none border border-slate-300 text-xs font-semibold text-slate-900 focus:outline-none focus:border-red-600" />
                  </div>
                  <div>
                    <label htmlFor="po-bill-date" className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Bill Date</label>
                    <input id="po-bill-date" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)}
                      className="w-full px-2 py-1.5 rounded-none border border-slate-300 text-xs font-semibold text-slate-900 focus:outline-none focus:border-red-600" />
                  </div>
                  <div>
                    <label htmlFor="po-bill-taxable" className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Taxable (₹)</label>
                    <input id="po-bill-taxable" type="number" min={0} value={billTaxable} onChange={(e) => setBillTaxable(e.target.value)} placeholder="0"
                      className="w-full px-2.5 py-1.5 rounded-none border border-slate-300 text-xs font-bold font-mono text-slate-900 focus:outline-none focus:border-red-600" />
                  </div>
                  <div>
                    <label htmlFor="po-bill-gst" className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">GST / ITC (₹)</label>
                    <input id="po-bill-gst" type="number" min={0} value={billGst} onChange={(e) => setBillGst(e.target.value)} placeholder="0"
                      className="w-full px-2.5 py-1.5 rounded-none border border-slate-300 text-xs font-bold font-mono text-emerald-800 focus:outline-none focus:border-red-600" />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label htmlFor="po-bill-file" className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Bill file</label>
                    <select id="po-bill-file" value={billAttachmentId} onChange={(e) => setBillAttachmentId(e.target.value)}
                      className="w-full px-2 py-1.5 rounded-none border border-slate-300 text-xs font-semibold text-slate-900 focus:outline-none focus:border-red-600">
                      <option value="">{attachments.length ? 'None' : 'No files attached'}</option>
                      {attachments.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                    <div className="col-span-2 sm:col-span-5">
                      <button
                        type="button"
                        disabled={savingBill}
                        onClick={async () => {
                          // PUR3-8: same rules as the server, with a message before sending.
                          const t = Number(billTaxable) || 0;
                          const g = Number(billGst) || 0;
                          if (!billNo.trim()) { toast.error('Enter the supplier bill number.'); return; }
                          if (!billDate) { toast.error('Enter the bill date.'); return; }
                          if (billDate > getTodayDateString()) { toast.error('A supplier bill cannot be dated in the future.'); return; }
                          if (t < 0 || g < 0) { toast.error('Taxable value and GST cannot be negative.'); return; }
                          if (g > Math.round(t * 0.28 * 100) / 100 + 1) { toast.error('GST cannot be more than 28% of the taxable value.'); return; }
                          setSavingBill(true);
                          const saved = await recordPurchaseBill(purchaseOrder.id, {
                            ...(editingBillId ? { id: editingBillId } : {}),
                            number: billNo.trim(), date: billDate, taxable: t, gst: g, attachmentId: billAttachmentId || null,
                          });
                          setSavingBill(false);
                          if (saved) resetBillForm();
                        }}
                        className="px-3 py-1.5 rounded-none bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-xs font-bold border border-red-700 transition-colors cursor-pointer"
                      >
                        {editingBillId ? 'Save Changes' : bills.length ? 'Add Another Bill' : 'Save Bill'}
                      </button>
                      {editingBillId && (
                        <button type="button" onClick={resetBillForm} className="ml-2 px-3 py-1.5 rounded-none border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer">Cancel</button>
                      )}
                      <span className="text-[11px] text-slate-500 ml-2">Enter each supplier tax invoice (one per delivery) so its GST counts as input tax credit in GSTR‑3B.</span>
                    </div>
                </div>
                )}
              </div>
                );
              })()}

              {/* Vendor payments — how much paid to the vendor, how much still due */}
              {(() => {
                // PUR8-1: one formula, the server's — owed for the GOOD units
                // received (incl. the GST of their receipt) + charges. Damaged and
                // missing units are never owed, so debit notes aren't subtracted.
                const total = purchaseOrderGrandOwed(purchaseOrder);
                const paid = purchaseOrder.amountPaid || 0;
                const remaining = purchaseOrderBalanceDue(purchaseOrder);
                const advance = purchaseOrderAdvance(purchaseOrder);
                // The most the server accepts now: the balance plus a prepayment
                // for units still expected (that part shows as an advance).
                const payCap = purchaseOrderPayCap(purchaseOrder);
                const payments = purchaseOrder.payments || [];
                return (
                  <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
                    <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                      <span className="text-xs font-extrabold uppercase tracking-wider text-slate-700">Vendor Payments</span>
                    </div>
                    <div className="p-4 space-y-3">
                      {/* Total / Paid / Remaining */}
                      <div className="grid grid-cols-3 gap-2">
                        <div className="p-2.5 rounded-none bg-slate-50 border border-slate-200 text-center">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400" title="Good units received incl. GST + charges">Owed (received)</div>
                          <div className="text-sm font-bold font-mono text-slate-900 mt-0.5">{formatCurrency(total)}</div>
                        </div>
                        <div className="p-2.5 rounded-none bg-emerald-50 border border-emerald-200 text-center">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Paid</div>
                          <div className="text-sm font-bold font-mono text-emerald-800 mt-0.5">{formatCurrency(paid)}</div>
                        </div>
                        <div className={`p-2.5 rounded-none text-center border ${remaining > 0 ? 'bg-rose-50 border-rose-200' : 'bg-emerald-50 border-emerald-200'}`}>
                          <div className={`text-[10px] font-bold uppercase tracking-wider ${remaining > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>Remaining</div>
                          <div className={`text-sm font-bold font-mono mt-0.5 ${remaining > 0 ? 'text-rose-800' : 'text-emerald-800'}`}>{formatCurrency(remaining)}</div>
                        </div>
                      </div>
                      {advance > 0.005 && (
                        purchaseOrder.status !== 'Cancelled' && purchaseOrderOpenValue(purchaseOrder) > 0.005 ? (
                          <p className="text-[11px] font-semibold text-indigo-700">
                            {formatCurrency(advance)} paid ahead of delivery — held as an advance with the supplier.
                          </p>
                        ) : (
                          // PUR9-4: nothing more is coming on this PO — the overpayment
                          // can become the supplier's advance (to apply to another PO).
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <p className="text-[11px] font-semibold text-indigo-700">
                              {formatCurrency(advance)} paid beyond what this PO owes.
                            </p>
                            {canManagePurchases && (
                              <button
                                type="button"
                                onClick={() => void releasePoOverpayment(purchaseOrder.id)}
                                className="px-2.5 py-1 text-[11px] font-bold text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-300 cursor-pointer"
                              >
                                Move to supplier advance
                              </button>
                            )}
                          </div>
                        )
                      )}

                      {/* Record a payment — PUR2-9: not on a cancelled PO, and never
                          more than the remaining balance (overpayment is blocked). */}
                      {canManagePurchases && payCap > 0 && purchaseOrder.status !== 'Cancelled' && (() => {
                        const entered = Number(payAmt) || 0;
                        const isOverpayment = entered > payCap + 0.005;
                        const pay = async (amt: number) => {
                          if (paying || !(amt > 0)) return;
                          setPaying(true);
                          const ok = await recordPurchaseOrderPayment(purchaseOrder.id, amt, payMode);
                          setPaying(false);
                          if (ok) setPayAmt('');
                        };
                        return (
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">₹</span>
                            <input
                              type="number" min={0} max={payCap} value={payAmt}
                              onChange={(e) => setPayAmt(e.target.value)}
                              placeholder="Amount paid"
                              className={`w-32 pl-5 pr-2 py-1.5 rounded-none bg-white border text-xs font-bold font-mono text-slate-900 focus:outline-none ${isOverpayment ? 'border-rose-400 focus:border-rose-600' : 'border-slate-300 focus:border-emerald-600'}`}
                            />
                          </div>
                          <select
                            value={payMode}
                            onChange={(e) => setPayMode(e.target.value)}
                            className="px-2 py-1.5 rounded-none bg-white border border-slate-300 text-xs font-bold text-slate-800 focus:outline-none focus:border-emerald-600"
                          >
                            <option>Cash</option><option>GPay</option><option>HDFC</option><option>Bank Transfer</option><option>Cheque</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => { if (entered > 0 && !isOverpayment) void pay(entered); }}
                            disabled={paying || !(entered > 0) || isOverpayment}
                            className="px-3 py-1.5 rounded-none bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold border border-emerald-700 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            Record Payment
                          </button>
                          {remaining > 0 && (
                            <button
                              type="button"
                              disabled={paying}
                              onClick={() => void pay(remaining)}
                              className="px-3 py-1.5 rounded-none bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold border border-slate-300 transition-colors cursor-pointer disabled:opacity-40"
                              title="Pay the full remaining amount (goods received so far)"
                            >
                              Pay Full ({formatCurrency(remaining)})
                            </button>
                          )}
                          </div>
                          {isOverpayment && (
                            <p className="text-[11px] font-semibold text-rose-600">
                              Amount exceeds the {formatCurrency(payCap)} that can still be paid on this PO.
                            </p>
                          )}
                          {remaining <= 0 && (
                            <p className="text-[11px] text-slate-500">
                              Nothing received is unpaid — a payment now is an advance for goods still expected (up to {formatCurrency(payCap)}).
                            </p>
                          )}
                        </div>
                        );
                      })()}

                      {/* Payment history */}
                      {payments.length > 0 ? (
                        <div className="divide-y divide-slate-100 border-t border-slate-100 pt-1">
                          {payments.map((p) => (
                            <div key={p.id} className="flex items-center justify-between py-1.5 text-xs">
                              <span className="text-slate-500">{p.date} · <span className="font-semibold text-slate-700">{p.mode}</span> · by {p.by}</span>
                              <span className="font-mono font-bold text-emerald-700">{formatCurrency(p.amount)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-400">No payments recorded yet.</p>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Quality-check debit notes raised on the vendor for damaged goods */}
              {debitNotes.length > 0 && (
                <div className="bg-white rounded-xl border border-rose-200 shadow-2xs overflow-hidden">
                  <div className="px-4 py-2.5 bg-rose-50 border-b border-rose-200 flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-rose-800">
                      Vendor Debit Notes (Damaged / Missing)
                    </span>
                    <span className="text-xs font-bold text-rose-700 font-mono">Total: {formatCurrency(debitNotesTotal)}</span>
                  </div>
                  <div className="divide-y divide-rose-100">
                    {debitNotes.map((dn) => (
                      <div key={dn.id} className="p-3 text-xs">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-bold text-slate-900 font-mono">{dn.noteNumber}</span>
                          <span className="flex items-center gap-2">
                            <span className="text-slate-500">{dn.date} · by {dn.createdBy}</span>
                            <button
                              type="button"
                              onClick={() => handlePrintDebitNote(dn)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-none bg-white border border-rose-300 text-rose-700 text-[10px] font-bold hover:bg-rose-50 cursor-pointer"
                              title="Print this debit note as a bill for the vendor"
                            >
                              <Printer className="h-3 w-3" /> Print Bill
                            </button>
                          </span>
                        </div>
                        <div className="space-y-0.5">
                          {dn.lines.map((l, i) => (
                            <div key={i} className="flex items-center justify-between text-slate-600">
                              <span>
                                {l.itemName}{' '}
                                <span className="text-rose-600 font-bold">× {debitNoteQtyLabel(l)}</span>
                                {l.taxAmount ? <span className="text-slate-400"> · incl. {formatCurrency(l.taxAmount)} GST @ {l.taxPercent}%</span> : null}
                              </span>
                              <span className="font-mono">{formatCurrency(l.amount)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-rose-100 font-bold text-rose-800">
                          <span>Debit Note Total</span>
                          <span className="font-mono">{formatCurrency(dn.totalAmount)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Line Items Table */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Line Items Ordered ({purchaseOrder.items.length})
                  </h4>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500">
                      Total Qty: <strong>{totalOrdered}</strong> • Received: <strong>{totalReceived}</strong>
                    </span>
                    {/* Edit prices — only before any receipt (status Ordered) so we
                        don't rewrite the cost of stock already taken in. */}
                    {canManagePurchases && purchaseOrder.status === 'Ordered' && (
                      isEditingPrices ? (
                        <span className="flex items-center gap-1.5">
                          <button type="button" onClick={saveEditedPrices}
                            className="px-2.5 py-1 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded border border-emerald-700 cursor-pointer">Save Prices</button>
                          <button type="button" onClick={() => setIsEditingPrices(false)}
                            className="px-2.5 py-1 text-xs font-bold text-slate-600 bg-white hover:bg-slate-100 rounded border border-slate-300 cursor-pointer">Cancel</button>
                        </span>
                      ) : (
                        <button type="button" onClick={startEditPrices}
                          className="px-2.5 py-1 text-xs font-bold text-slate-800 bg-white hover:bg-slate-100 rounded border border-slate-300 cursor-pointer">Edit Prices</button>
                      )
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/40 text-slate-500 text-[11px] font-bold uppercase tracking-wider">
                        <th className="py-2.5 px-4">Item & Code</th>
                        <th className="py-2.5 px-3">HSN</th>
                        <th className="py-2.5 px-3 text-right">Unit Price</th>
                        <th className="py-2.5 px-3 text-center">Ordered</th>
                        <th className="py-2.5 px-3 text-center">Received</th>
                        <th className="py-2.5 px-3 text-center">Pending</th>
                        <th className="py-2.5 px-3 text-right">GST</th>
                        <th className="py-2.5 px-4 text-right">Line Total</th>
                        <th className="py-2.5 px-4 text-center">Fulfillment</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {purchaseOrder.items.map((item) => {
                        const rec = item.receivedQuantity || 0;
                        // Damaged and missing units settle the line too (E2E-5).
                        const pending = poLineOpen(item);
                        const isDone = pending === 0;
                        const billedBack = (item.damagedQuantity || 0) + (item.missingQuantity || 0);

                        return (
                          <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                            <td className="py-3 px-4">
                              <div className="font-semibold text-slate-900">{item.itemName}</div>
                              <div className="text-xs font-mono text-slate-400">{item.itemCode}</div>
                            </td>
                            <td className="py-3 px-3 text-xs font-mono text-slate-500">
                              {item.itemHSN || '—'}
                            </td>
                            <td className="py-3 px-3 text-right font-mono text-slate-700">
                              {isEditingPrices ? (
                                <input
                                  type="number"
                                  min={0}
                                  step="any"
                                  value={priceEdits[item.id] ?? ''}
                                  onChange={(e) => setPriceEdits((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                  className="w-24 text-right px-2 py-1 text-sm font-mono border border-slate-300 rounded focus:outline-none focus:border-red-500"
                                />
                              ) : (
                                formatCurrency(item.purchasePrice)
                              )}
                            </td>
                            <td className="py-3 px-3 text-center font-bold text-slate-800">
                              {item.quantityOrdered} <span className="text-[11px] font-normal text-slate-400">{item.unit}</span>
                            </td>
                            <td className="py-3 px-3 text-center font-bold text-emerald-700">
                              {rec} <span className="text-[11px] font-normal text-slate-400">{item.unit}</span>
                              {billedBack > 0 && (
                                <div className="text-[10px] font-semibold text-rose-600">
                                  {[item.damagedQuantity ? `${item.damagedQuantity} damaged` : '', item.missingQuantity ? `${item.missingQuantity} missing` : ''].filter(Boolean).join(' · ')}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-3 text-center font-bold text-slate-600">
                              {pending > 0 ? (
                                <span className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 text-xs">
                                  {pending} {item.unit}
                                </span>
                              ) : (
                                <span className="text-slate-400">0</span>
                              )}
                            </td>
                            {/* Per-product GST as confirmed at receipt. A dash
                                means this line has not been received yet, so no
                                rate has been agreed with the supplier. */}
                            <td className="py-3 px-3 text-right font-mono text-slate-600">
                              {item.taxPercent ? (
                                <>
                                  <div className="text-xs font-semibold text-slate-700">{item.taxPercent}%</div>
                                  <div className="text-[11px] text-slate-500">{formatCurrency(item.taxAmount || 0)}</div>
                                </>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                              {formatCurrency(item.lineTotal ?? item.amount)}
                              {item.taxAmount ? (
                                <div className="text-[11px] font-normal text-slate-500">
                                  {formatCurrency(item.amount)} + tax
                                </div>
                              ) : null}
                            </td>
                            <td className="py-3 px-4 text-center">
                              {isDone ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                                  <CheckCircle2 className="h-3 w-3" />
                                  {billedBack > 0 ? 'Settled' : 'Fulfilled'}
                                </span>
                              ) : rec + billedBack > 0 ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                                  <Clock className="h-3 w-3" />
                                  Partial ({rec + billedBack}/{item.quantityOrdered})
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-none border border-slate-300">
                                  Awaiting
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50/80 border-t border-slate-200 font-bold">
                        <td colSpan={3} className="py-3 px-4 text-slate-700">
                          Total Order Summary
                        </td>
                        <td className="py-3 px-3 text-center font-mono text-slate-900">
                          {totalOrdered}
                        </td>
                        <td className="py-3 px-3 text-center font-mono text-emerald-700">
                          {totalReceived}
                        </td>
                        <td className="py-3 px-3 text-center font-mono text-amber-700">
                          {Math.max(0, totalOrdered - totalSettled)}
                        </td>
                        <td className="py-3 px-3" />
                        <td className="py-3 px-4 text-right font-mono text-base text-slate-900">
                          {formatCurrency(poGrandTotal)}
                          {poTotalTax > 0 && (
                            <div className="text-[11px] font-normal text-slate-500">{formatCurrency(purchaseOrder.totalAmount)} + {formatCurrency(poTotalTax)} GST</div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center text-xs text-slate-500">
                          {totalOrdered > 0 ? Math.round((totalSettled / totalOrdered) * 100) : 0}% settled
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Quick Cross-Link Preview Card if linked to pending order */}
              {linkedPendingOrder && (
                <div className="bg-purple-50/60 border border-purple-200 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
                      <Layers className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-purple-900">
                          Originating Customer Pending Order
                        </span>
                        <span className="font-mono text-xs font-bold text-purple-700 bg-purple-100 px-1.5 py-0.2 rounded">
                          {linkedPendingOrder.orderNumber}
                        </span>
                      </div>
                      <p className="text-xs text-purple-700 mt-0.5">
                        Customer: <strong>{linkedPendingOrder.customerName}</strong> • Item:{' '}
                        <strong>{linkedPendingOrder.itemName}</strong> ({linkedPendingOrder.quantityNeeded}{' '}
                        {linkedPendingOrder.unit})
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleJumpToPendingOrder}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-purple-800 bg-white hover:bg-purple-100 border border-purple-300 rounded-lg shadow-2xs transition-colors"
                  >
                    <span>View Pending Order</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ================= TAB 2: RECEIVING HISTORY ================= */}
          {activeTab === 'history' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Physical Stock Receiving Event Log
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Individual consignments and partial shipments are logged here. Progress accumulates across events.
                  </p>
                </div>

                {(purchaseOrder.status === 'Ordered' || purchaseOrder.status === 'Partially Received') &&
                  canManagePurchases && (
                    <button
                      type="button"
                      onClick={() => setIsReceiveModalOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl text-white bg-emerald-600 hover:bg-emerald-700 shadow-xs transition-colors shrink-0"
                    >
                      <PackageCheck className="h-4 w-4" />
                      <span>Receive Inward Delivery</span>
                    </button>
                  )}
              </div>

              {receivingHistory.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-2xs">
                  <PackageCheck className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                  <h4 className="text-sm font-bold text-slate-800">No Inward Events Recorded Yet</h4>
                  <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                    When the physical shipment arrives at {branchData?.name || purchaseOrder.branchId}, click
                    "Receive Inward Delivery" above to log quantities and rack locations.
                  </p>
                  {canManagePurchases && (
                    <button
                      type="button"
                      onClick={() => setIsReceiveModalOpen(true)}
                      className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl transition-colors"
                    >
                      <PackageCheck className="h-4 w-4" />
                      <span>Receive First Shipment</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {receivingHistory.map((evt, idx) => {
                    const eventTotalQty = evt.lines.reduce(
                      (sum, l) => sum + (l.quantityReceivedThisEvent || 0),
                      0
                    );

                    return (
                      <div
                        key={evt.id || idx}
                        className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden"
                      >
                        {/* Event Header Banner */}
                        <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <span className="flex items-center justify-center h-6 w-6 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold font-mono">
                              #{receivingHistory.length - idx}
                            </span>
                            <div>
                              <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                                <span>Inward Date: {evt.date}</span>
                                <span className="text-slate-300">•</span>
                                <span className="text-slate-500 font-normal">
                                  Received by: <strong className="text-slate-700">{evt.receivedBy}</strong>
                                </span>
                              </div>
                              {evt.notes && (
                                <p className="text-xs text-slate-600 mt-0.5 italic">
                                  "{evt.notes}"
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="text-xs text-right">
                            <span className="font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200 font-mono">
                              +{eventTotalQty} Units Inwarded
                            </span>
                          </div>
                        </div>

                        {/* Event Breakdown Table */}
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="bg-slate-50/40 text-slate-400 font-bold uppercase tracking-wider border-b border-slate-100">
                                <th className="py-2 px-4">Item & Code</th>
                                <th className="py-2 px-3 text-center">Ordered Qty</th>
                                <th className="py-2 px-3 text-center">Received This Batch</th>
                                <th className="py-2 px-3 text-center">Running Total So Far</th>
                                <th className="py-2 px-4 text-left">Shelf / Location</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {evt.lines.map((l, lIdx) => (
                                <tr key={l.itemId || lIdx} className="hover:bg-slate-50/40">
                                  <td className="py-2.5 px-4 font-semibold text-slate-900">
                                    <div>{l.itemName}</div>
                                    <div className="font-mono text-[11px] text-slate-400">{l.itemCode}</div>
                                  </td>
                                  <td className="py-2.5 px-3 text-center font-mono text-slate-600">
                                    {l.quantityOrdered}
                                  </td>
                                  <td className="py-2.5 px-3 text-center font-mono font-bold text-emerald-700 bg-emerald-50/40">
                                    +{l.quantityReceivedThisEvent}
                                  </td>
                                  <td className="py-2.5 px-3 text-center">
                                    <span className="font-mono font-bold text-slate-800">
                                      {l.totalReceivedSoFar} / {l.quantityOrdered}
                                    </span>
                                    <div className="w-16 bg-slate-100 rounded-full h-1 mx-auto mt-1 overflow-hidden">
                                      <div
                                        className="bg-emerald-500 h-full rounded-full"
                                        style={{
                                          width: `${Math.min(
                                            100,
                                            Math.round((l.totalReceivedSoFar / l.quantityOrdered) * 100)
                                          )}%`,
                                        }}
                                      />
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-4 font-mono text-slate-700">
                                    {l.location ? (
                                      <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-800 border border-slate-200">
                                        {l.location}
                                      </span>
                                    ) : (
                                      <span className="text-slate-400 italic">Default</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ================= TAB 3: VENDOR BILLS (ATTACHMENTS) ================= */}
          {activeTab === 'bills' && (
            <div className="space-y-6">
              {/* Header with Explanatory Notice */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-none border border-slate-300 shadow-none">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <span>Vendor Bills & Invoices</span>
                    <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-none bg-slate-100 text-slate-800 border border-slate-300">
                      {attachments.length} attached
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Attach scanned supplier invoices, delivery challans, or lorry receipts (PDF or JPG/PNG/WEBP).
                  </p>
                </div>

                {canManagePurchases && (
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => handleFileUpload(e.target.files)}
                    />
                    <button
                      type="button"
                      disabled={isUploading}
                      onClick={() => fileInputRef.current?.click()}
                      className={cn(
                        'inline-flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-none text-white transition-colors cursor-pointer border border-red-700 shadow-none',
                        isUploading
                          ? 'bg-red-400 cursor-not-allowed'
                          : 'bg-red-600 hover:bg-red-700 active:bg-red-800'
                      )}
                    >
                      <Upload className="h-3.5 w-3.5" />
                      <span>{isUploading ? 'Uploading...' : 'Attach Vendor Bill'}</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Stopgap Architecture Reminder */}
              <div className="px-4 py-2.5 bg-amber-50/70 border border-amber-200 rounded-none text-xs text-amber-800 flex items-center gap-2">
                <Info className="h-4 w-4 text-amber-600 shrink-0" />
                <span>
                  <strong>Client Storage Architecture:</strong> Bills are stored client-side in local storage
                  (Max 2.5MB per PDF, images compressed to 1200px max). Once migrated to backend Postgres, files
                  will stream directly into S3 object storage.
                </span>
              </div>

              {/* Upload Dropzone (if no attachments or staff wants drag-drop) */}
              {canManagePurchases && (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleFileUpload(e.dataTransfer.files);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-300 hover:border-red-600 hover:bg-red-50/20 rounded-none p-6 text-center cursor-pointer transition-all bg-white"
                >
                  <Upload className="h-8 w-8 mx-auto text-slate-400 mb-2" />
                  <p className="text-xs font-bold text-slate-700">
                    Click to browse or drag & drop vendor bill here
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Supports PDF documents or Scanned Photos (JPG, PNG, WEBP) up to 2.5MB
                  </p>
                </div>
              )}

              {/* Attachment Cards Grid */}
              {attachments.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 p-8 text-center shadow-2xs">
                  <Paperclip className="h-10 w-10 text-slate-300 mx-auto mb-2" />
                  <h4 className="text-sm font-semibold text-slate-700">No Bills Attached to this Order</h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Vendors often send invoices separately or revised copies upon partial delivery. Attach them here.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {attachments.map((att) => (
                    <div
                      key={att.id}
                      className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs flex items-start gap-3.5 hover:border-slate-300 transition-all"
                    >
                      {/* Thumbnail / File Icon */}
                      <div
                        onClick={() => handleOpenAttachment(att)}
                        className="h-16 w-16 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 cursor-pointer overflow-hidden hover:opacity-90 transition-opacity"
                        title="Click to preview"
                      >
                        {att.fileType === 'image' ? (
                          <AttachmentThumb poId={purchaseOrder.id} att={att} />
                        ) : (
                          <div className="flex flex-col items-center justify-center text-rose-600">
                            <FileText className="h-7 w-7" />
                            <span className="text-[11px] font-bold uppercase tracking-wider font-mono">
                              PDF
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Info & Actions */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-1">
                          <h4
                            onClick={() => handleOpenAttachment(att)}
                            className="text-xs font-bold text-slate-900 truncate hover:text-red-700 cursor-pointer"
                            title={att.name}
                          >
                            {att.name}
                          </h4>
                          {canManagePurchases && (
                            <button
                              type="button"
                              onClick={() => {
                                if (window.confirm(`Remove attachment "${att.name}"?`)) {
                                  deletePurchaseOrderAttachment(purchaseOrder.id, att.id);
                                }
                              }}
                              className="text-slate-400 hover:text-rose-600 p-1 hover:bg-rose-50 rounded-none transition-colors"
                              title="Delete attachment"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>

                        <div className="text-[11px] text-slate-500 mt-1 space-y-0.5">
                          <p className="flex items-center gap-1 font-mono">
                            <span>{att.fileSize || 'Standard'}</span>
                            <span>•</span>
                            <span className="uppercase">{att.fileType}</span>
                          </p>
                          <p>
                            Uploaded on <span className="font-semibold text-slate-700">{att.uploadedAt.split('T')[0]}</span>
                          </p>
                          <p className="text-[11px] text-slate-400">By {att.uploadedBy}</p>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-2 mt-3 pt-2 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => handleOpenAttachment(att)}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-red-700 px-2 py-1 rounded-none bg-slate-100 hover:bg-slate-200 border border-slate-300 transition-colors cursor-pointer"
                          >
                            <Eye className="h-3 w-3" />
                            <span>Preview</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDownloadAttachment(att)}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-slate-900 px-2 py-1 rounded-none bg-white hover:bg-slate-100 border border-slate-300 transition-colors cursor-pointer"
                          >
                            <Download className="h-3 w-3" />
                            <span>Download</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ================= TAB 4: LINKED RECORDS ================= */}
          {activeTab === 'linked' && (
            <div className="space-y-4">
              {linkedPendingOrder ? (
                <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center border border-purple-200">
                        <Layers className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">
                          Linked Customer Pending Order (Prompt 23 Cross-Link)
                        </h4>
                        <p className="text-xs text-slate-500">
                          This PO was raised specifically to fulfill out-of-stock customer demand.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleJumpToPendingOrder}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-purple-800 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-xl transition-colors shadow-2xs"
                    >
                      <span>Open Pending Order</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                      <span className="text-slate-400 font-bold block mb-1">Order Identifier</span>
                      <span className="font-mono font-bold text-slate-800 text-sm">
                        {linkedPendingOrder.orderNumber}
                      </span>
                    </div>

                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                      <span className="text-slate-400 font-bold block mb-1">Customer Name</span>
                      <span className="font-bold text-slate-800 text-sm">
                        {linkedPendingOrder.customerName}
                      </span>
                      {linkedPendingOrder.customerPhone && (
                        <p className="font-mono text-slate-500 mt-0.5">{linkedPendingOrder.customerPhone}</p>
                      )}
                    </div>

                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                      <span className="text-slate-400 font-bold block mb-1">Waiting Item & Qty</span>
                      <span className="font-bold text-slate-800 text-sm">
                        {linkedPendingOrder.quantityNeeded} {linkedPendingOrder.unit}
                      </span>
                      <p className="text-slate-500 truncate mt-0.5">{linkedPendingOrder.itemName}</p>
                    </div>
                  </div>

                  <div className="p-3 bg-purple-50/60 rounded-xl border border-purple-100 text-xs text-purple-900 flex items-center gap-2">
                    <PackageCheck className="h-4 w-4 text-purple-600 shrink-0" />
                    <span>
                      When physical stock is inwarded for this PO, the waiting pending order automatically flips
                      to <strong>"Stock Arrived"</strong> and triggers follow-up notifications.
                    </span>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-slate-200 p-8 text-center shadow-2xs">
                  <Layers className="h-10 w-10 text-slate-300 mx-auto mb-2" />
                  <h4 className="text-sm font-semibold text-slate-700">No Customer Back-Order Linked</h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    This PO was created as a standard warehouse restocking order directly from Item Master or Reorder Alerts.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Bottom Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50/80 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-500">
            PO Created: <strong className="text-slate-700">{purchaseOrder.createdAt.split('T')[0]}</strong>
            {purchaseOrder.updatedAt && (
              <span> • Last Updated: <strong className="text-slate-700">{purchaseOrder.updatedAt.split('T')[0]}</strong></span>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl shadow-2xs transition-colors"
          >
            Close View
          </button>
        </div>
      </div>

      {/* Lightbox Image Preview Modal */}
      {previewImage && (
        <div
          className="fixed inset-0 z-60 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="bg-white rounded-xl overflow-hidden max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <span className="text-xs font-bold text-slate-700 truncate">
                {previewImage.title}
              </span>
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 flex-1 overflow-auto flex items-center justify-center bg-slate-900/5">
              <img
                src={previewImage.src}
                alt={previewImage.title}
                className="max-h-[75vh] max-w-full object-contain rounded-lg shadow-xs"
              />
            </div>
          </div>
        </div>
      )}

      {/* Inward Stock Modal */}
      <ReceiveStockModal
        isOpen={isReceiveModalOpen}
        onClose={() => setIsReceiveModalOpen(false)}
        purchaseOrder={purchaseOrder}
      />

      {/* Official PO Document PDF Modal */}
      <PurchaseOrderPdfModal
        isOpen={isPdfModalOpen}
        onClose={() => setIsPdfModalOpen(false)}
        purchaseOrder={purchaseOrder}
      />
    </div>
  );
};
