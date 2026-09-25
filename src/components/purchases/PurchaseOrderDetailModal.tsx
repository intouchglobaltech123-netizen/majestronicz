import React, { useState, useRef } from 'react';
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
  BRANCHES,
} from '../../types';
import { useErp } from '../../context/ErpContext';
import { formatCurrency, cn } from '../../lib/utils';
import { resizeAndCompressImage } from '../../lib/imageUtils';
import { toast } from 'sonner';
import { ReceiveStockModal } from './ReceiveStockModal';
import { PurchaseOrderPdfModal } from './PurchaseOrderPdfModal';

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
    cancelPurchaseOrder,
    addPurchaseOrderAttachment,
    deletePurchaseOrderAttachment,
    pendingOrders,
    setSelectedPendingOrderForDetail,
    setCurrentView,
  } = useErp();

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
  const todayStr = new Date().toISOString().split('T')[0];
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

    // Client-side storage size cap: Max 2.5MB to protect browser localStorage
    const MAX_BYTES = 2.5 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      toast.error('File size exceeds the 2.5MB cap for client storage.');
      return;
    }

    setIsUploading(true);

    try {
      if (isImg) {
        // Compress client-side (longest edge 1200px for invoice text legibility, 85% quality JPEG)
        const processed = await resizeAndCompressImage(file, 1200, 0.85);
        addPurchaseOrderAttachment(purchaseOrder.id, {
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

  const handleDownloadAttachment = (attachment: PurchaseOrderAttachment) => {
    try {
      const link = document.createElement('a');
      link.href = attachment.dataUrl;
      link.download = attachment.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      toast.error('Download failed. Unable to extract file.');
    }
  };

  const handleOpenAttachment = (attachment: PurchaseOrderAttachment) => {
    if (attachment.fileType === 'image') {
      setPreviewImage({ src: attachment.dataUrl, title: attachment.name });
    } else {
      // PDF: convert base64 to Blob URL to open reliably in a new tab
      try {
        const arr = attachment.dataUrl.split(',');
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
        window.open(attachment.dataUrl, '_blank');
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

            {purchaseOrder.status === 'Ordered' && canManagePurchases && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Are you sure you want to cancel Purchase Order ${purchaseOrder.poNumber}?`)) {
                    cancelPurchaseOrder(purchaseOrder.id);
                    onClose();
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
                    {formatCurrency(purchaseOrder.totalAmount)}
                  </div>
                  <span className="text-[11px] text-slate-500 mt-0.5 block">
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

              {/* Quality-check debit notes raised on the vendor for damaged goods */}
              {debitNotes.length > 0 && (
                <div className="bg-white rounded-xl border border-rose-200 shadow-2xs overflow-hidden">
                  <div className="px-4 py-2.5 bg-rose-50 border-b border-rose-200 flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-rose-800">
                      Vendor Debit Notes (Damaged / QC Rejects)
                    </span>
                    <span className="text-xs font-bold text-rose-700 font-mono">Total: {formatCurrency(debitNotesTotal)}</span>
                  </div>
                  <div className="divide-y divide-rose-100">
                    {debitNotes.map((dn) => (
                      <div key={dn.id} className="p-3 text-xs">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-bold text-slate-900 font-mono">{dn.noteNumber}</span>
                          <span className="text-slate-500">{dn.date} · by {dn.createdBy}</span>
                        </div>
                        <div className="space-y-0.5">
                          {dn.lines.map((l, i) => (
                            <div key={i} className="flex items-center justify-between text-slate-600">
                              <span>{l.itemName} <span className="text-rose-600 font-bold">× {l.damagedQuantity} damaged</span></span>
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
                  <span className="text-xs text-slate-500">
                    Total Qty: <strong>{totalOrdered}</strong> • Received: <strong>{totalReceived}</strong>
                  </span>
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
                        <th className="py-2.5 px-4 text-right">Line Total</th>
                        <th className="py-2.5 px-4 text-center">Fulfillment</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {purchaseOrder.items.map((item) => {
                        const rec = item.receivedQuantity || 0;
                        const pending = Math.max(0, item.quantityOrdered - rec);
                        const isDone = pending === 0;

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
                              {formatCurrency(item.purchasePrice)}
                            </td>
                            <td className="py-3 px-3 text-center font-bold text-slate-800">
                              {item.quantityOrdered} <span className="text-[11px] font-normal text-slate-400">{item.unit}</span>
                            </td>
                            <td className="py-3 px-3 text-center font-bold text-emerald-700">
                              {rec} <span className="text-[11px] font-normal text-slate-400">{item.unit}</span>
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
                            <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                              {formatCurrency(item.amount)}
                            </td>
                            <td className="py-3 px-4 text-center">
                              {isDone ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Fulfilled
                                </span>
                              ) : rec > 0 ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                                  <Clock className="h-3 w-3" />
                                  Partial ({rec}/{item.quantityOrdered})
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
                          {Math.max(0, totalOrdered - totalReceived)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-base text-slate-900">
                          {formatCurrency(purchaseOrder.totalAmount)}
                        </td>
                        <td className="py-3 px-4 text-center text-xs text-slate-500">
                          {progressPct}% Inwarded
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
                          <img
                            src={att.dataUrl}
                            alt={att.name}
                            className="h-full w-full object-cover"
                          />
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
