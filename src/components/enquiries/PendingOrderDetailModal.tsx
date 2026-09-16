import React, { useState } from 'react';
import { PendingOrder, COMPANY_PROFILE, BRANCHES } from '../../types';
import { useErp } from '../../context/ErpContext';
import { MajestroniczLogo } from '../common/MajestroniczLogo';
import {
  X,
  Printer,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  User,
  Phone,
  Building,
  Calendar,
  Layers,
  Sparkles,
  ExternalLink,
  Edit2,
  FileText,
  Receipt,
  Save,
  ShoppingBag,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { PurchaseOrderDetailModal } from '../purchases/PurchaseOrderDetailModal';

interface Props {
  pendingOrder: PendingOrder | null;
  isOpen: boolean;
  onClose: () => void;
  onConvert: (enquiryId: string, targetType: 'estimate' | 'invoice') => void;
  onCancel: (po: PendingOrder) => void;
  onEditRestockDate: (po: PendingOrder) => void;
  onCreatePurchaseOrder?: (po: PendingOrder) => void;
}

export const PendingOrderDetailModal: React.FC<Props> = ({
  pendingOrder,
  isOpen,
  onClose,
  onConvert,
  onCancel,
  onEditRestockDate,
  onCreatePurchaseOrder,
}) => {
  const {
    getBranchStock,
    enquiries,
    setSelectedEnquiryForDetail,
    setCurrentView,
    purchaseOrders,
    selectedPurchaseOrderForDetail,
    setSelectedPurchaseOrderForDetail,
    updatePendingOrder,
    canCancelEnquiry,
    canConvertEnquiry,
    canEditRestockDate,
  } = useErp();

  const [isEditingExpectedDate, setIsEditingExpectedDate] = useState(false);
  const [newDateVal, setNewDateVal] = useState('');

  React.useEffect(() => {
    if (pendingOrder) {
      setNewDateVal(pendingOrder.expectedRestockDate || '');
      setIsEditingExpectedDate(false);
    }
  }, [pendingOrder]);

  if (!isOpen || !pendingOrder) return null;

  const currentBranchStock = getBranchStock(pendingOrder.itemId, pendingOrder.branchId)?.quantity ?? 0;
  const canFulfillNow = currentBranchStock >= pendingOrder.quantityNeeded;
  const branchObj = BRANCHES.find((b) => b.id === pendingOrder.branchId);

  // Find linked original enquiry
  const originalEnquiry = enquiries.find(
    (e) => e.id === pendingOrder.enquiryId || e.enquiryNumber === pendingOrder.enquiryNumber
  );

  // Find linked purchase order
  const linkedPo = purchaseOrders.find(
    (p) =>
      p.id === pendingOrder.purchaseOrderId ||
      p.poNumber === pendingOrder.purchaseOrderNumber ||
      p.items.some((item) => item.itemId === pendingOrder.itemId && p.branchId === pendingOrder.branchId)
  );

  const calculateDaysWaiting = (createdAt: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const created = new Date(createdAt);
    created.setHours(0, 0, 0, 0);
    const diffMs = today.getTime() - created.getTime();
    return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  };

  const calculateRestockStatus = (expectedDate?: string) => {
    if (!expectedDate) return { text: 'No Date Set', isOverdue: false, days: 0 };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expected = new Date(expectedDate);
    expected.setHours(0, 0, 0, 0);
    const diffMs = expected.getTime() - today.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays > 0) {
      return { text: `Expected in ${diffDays} day${diffDays === 1 ? '' : 's'}`, isOverdue: false, days: diffDays };
    } else if (diffDays === 0) {
      return { text: 'Restock Due Today', isOverdue: false, days: 0 };
    } else {
      return { text: `Overdue by ${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'}`, isOverdue: true, days: Math.abs(diffDays) };
    }
  };

  const daysWaiting = calculateDaysWaiting(pendingOrder.createdAt);
  const restock = calculateRestockStatus(pendingOrder.expectedRestockDate);

  const handlePrint = () => {
    window.print();
  };

  const handleSaveExpectedDate = () => {
    updatePendingOrder(pendingOrder.id, { expectedRestockDate: newDateVal });
    setIsEditingExpectedDate(false);
  };

  const handleJumpToEnquiry = () => {
    if (originalEnquiry) {
      setSelectedEnquiryForDetail(originalEnquiry);
      setCurrentView('enquiries');
      onClose();
    }
  };

  const statusBadge = () => {
    if (pendingOrder.status === 'Stock Arrived' || canFulfillNow) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold text-xs shadow-2xs">
          <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
          Stock Arrived
        </span>
      );
    }
    if (pendingOrder.status === 'Fulfilled') {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-100 text-blue-800 border border-blue-300 font-bold text-xs">
          <CheckCircle2 className="h-3.5 w-3.5 text-blue-600" />
          Fulfilled
        </span>
      );
    }
    if (pendingOrder.status === 'Cancelled') {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-100 text-rose-800 border border-rose-300 font-bold text-xs">
          <XCircle className="h-3.5 w-3.5 text-rose-600" />
          Cancelled
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 font-bold text-xs">
        <Clock className="h-3.5 w-3.5 text-amber-600" />
        Waiting Restock
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/70 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto print:p-0 print:bg-white">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[96vh] print:max-h-none print:border-none print:shadow-none print:w-full print:rounded-none">
        {/* Top Header Bar */}
        <div className="px-6 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between print:hidden">
          <div className="flex items-center flex-wrap gap-2.5">
            <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
              Pending Stock Order Document Preview
            </span>
            <span className="text-xs font-mono font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
              {pendingOrder.orderNumber}
            </span>
            {statusBadge()}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors"
              title="Print Order Sheet"
            >
              <Printer className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
              title="Close (Esc)"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Printable Document Card */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-4 sm:p-6 space-y-6 print:p-0">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-xs print:border-none print:shadow-none space-y-6">
            {/* 1. Company Profile & Pending Order Meta Header */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6 pb-6 border-b border-slate-200">
              <div className="space-y-2">
                <MajestroniczLogo />
                <p className="text-xs text-slate-500 leading-relaxed max-w-sm">
                  {COMPANY_PROFILE.address}
                </p>
                <div className="text-[11px] text-slate-500 font-mono space-y-0.5">
                  <p>GSTIN: <span className="font-bold text-slate-800">{COMPANY_PROFILE.gstin}</span></p>
                  <p>Phone: <span className="font-bold text-slate-800">{COMPANY_PROFILE.phone}</span> • Email: {COMPANY_PROFILE.email}</p>
                </div>
              </div>

              <div className="sm:text-right space-y-1.5 shrink-0 bg-slate-50 sm:bg-transparent p-4 sm:p-0 rounded-xl">
                <span className="text-xs font-black uppercase tracking-widest text-slate-400 block">
                  Pending Stock Replenishment Order
                </span>
                <h2 className="text-2xl font-black font-mono text-purple-700">
                  {pendingOrder.orderNumber}
                </h2>
                <div className="text-xs text-slate-600 font-mono space-y-0.5">
                  <div className="flex sm:justify-end items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-slate-400" />
                    <span>Logged: <strong>{new Date(pendingOrder.createdAt).toLocaleDateString('en-IN')}</strong></span>
                  </div>
                  <div className="flex sm:justify-end items-center gap-1.5">
                    <Building className="h-3.5 w-3.5 text-slate-400" />
                    <span>Target Hub: <strong>{branchObj?.name || pendingOrder.branchId}</strong></span>
                  </div>
                  <div className="flex sm:justify-end items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-slate-400" />
                    <span>Waiting: <strong>{daysWaiting} days</strong></span>
                  </div>
                </div>
              </div>
            </div>

            {/* 2. Customer & Shortage Overview Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/80 space-y-2">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 block">
                  Customer Waiting for Fulfillment
                </span>
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                    <User className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">{pendingOrder.customerName}</h3>
                    {pendingOrder.customerPhone ? (
                      <div className="flex items-center gap-1 text-xs text-slate-600 font-mono mt-0.5">
                        <Phone className="h-3 w-3 text-slate-400" />
                        <span>{pendingOrder.customerPhone}</span>
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-400 italic">No contact number</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/80 space-y-2">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 block">
                  Restock Timeline & Monitoring
                </span>
                <div className="flex items-center justify-between">
                  <div>
                    <span className={cn(
                      'text-xs font-bold px-2 py-0.5 rounded-full border inline-flex items-center gap-1',
                      restock.isOverdue
                        ? 'bg-rose-50 text-rose-700 border-rose-200 animate-pulse'
                        : 'bg-blue-50 text-blue-700 border-blue-200'
                    )}>
                      {restock.isOverdue && <AlertTriangle className="h-3 w-3 text-rose-600" />}
                      {restock.text}
                    </span>
                    <p className="text-[11px] text-slate-500 font-mono mt-1">
                      Expected: <strong>{pendingOrder.expectedRestockDate || 'No date set'}</strong>
                    </p>
                  </div>
                  {canEditRestockDate && !isEditingExpectedDate && (
                    <button
                      type="button"
                      onClick={() => setIsEditingExpectedDate(true)}
                      className="px-2.5 py-1 text-xs font-semibold text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg border border-blue-200 transition-colors flex items-center gap-1"
                    >
                      <Edit2 className="h-3 w-3" />
                      <span>Change Date</span>
                    </button>
                  )}
                </div>

                {isEditingExpectedDate && (
                  <div className="mt-2 pt-2 border-t border-slate-200 flex items-center gap-2">
                    <input
                      type="date"
                      value={newDateVal}
                      onChange={(e) => setNewDateVal(e.target.value)}
                      className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-xs font-mono text-slate-900 focus:outline-none focus:border-blue-600"
                    />
                    <button
                      type="button"
                      onClick={handleSaveExpectedDate}
                      className="px-2.5 py-1 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-1 shadow-2xs"
                    >
                      <Save className="h-3 w-3" />
                      <span>Save</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEditingExpectedDate(false)}
                      className="px-2 py-1 text-xs text-slate-500 hover:bg-slate-200 rounded-lg"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* 3. Item & Shortage Breakdown Table */}
            <div>
              <div className="text-xs font-extrabold uppercase tracking-wider text-slate-500 mb-2">
                Item & Inventory Status
              </div>
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 font-bold uppercase text-[11px] border-b border-slate-200">
                      <th className="py-3 px-4">Item Name & Code</th>
                      <th className="py-3 px-4 text-center">Unit</th>
                      <th className="py-3 px-4 text-center">Needed Quantity</th>
                      <th className="py-3 px-4 text-center">Current Branch Stock</th>
                      <th className="py-3 px-4 text-right">Fulfillment Readiness</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr>
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900">{pendingOrder.itemName}</div>
                        {pendingOrder.itemCode && (
                          <span className="text-[11px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded border border-slate-200 mt-0.5 inline-block">
                            {pendingOrder.itemCode}
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-center font-mono font-bold text-slate-600">
                        {pendingOrder.unit}
                      </td>
                      <td className="py-3.5 px-4 text-center font-mono font-black text-sm text-rose-700">
                        {pendingOrder.quantityNeeded}
                      </td>
                      <td className="py-3.5 px-4 text-center font-mono font-bold text-slate-800">
                        {currentBranchStock}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {canFulfillNow ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            <Sparkles className="h-3 w-3 text-emerald-600" />
                            Stock In Hand ({currentBranchStock} available)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                            <Clock className="h-3 w-3 text-amber-600" />
                            Awaiting Stock Delivery
                          </span>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* 4. Related Records Section */}
            <div className="p-4 rounded-2xl bg-purple-50/40 border border-purple-100 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider text-purple-900 flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-purple-600" />
                  <span>Related Business Records</span>
                </span>
                <span className="text-[11px] text-purple-600">Cross-links & traceability</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Link to Original Customer Enquiry */}
                <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs flex items-center justify-between">
                  <div className="space-y-0.5">
                    <span className="text-[11px] font-bold uppercase text-slate-400 block">
                      Original Customer Enquiry
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-xs text-blue-700">
                        {pendingOrder.enquiryNumber}
                      </span>
                      {originalEnquiry && (
                        <span className="text-[11px] font-semibold px-1.5 py-0.2 rounded bg-blue-50 text-blue-700 border border-blue-200">
                          {originalEnquiry.status}
                        </span>
                      )}
                    </div>
                  </div>

                  {originalEnquiry && (
                    <button
                      type="button"
                      onClick={handleJumpToEnquiry}
                      className="px-2.5 py-1 text-xs font-bold text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 transition-colors flex items-center gap-1"
                    >
                      <span>View Enquiry</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  )}
                </div>

                {/* Link to Linked Purchase Order or Create PO Action */}
                <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs flex items-center justify-between">
                  <div className="space-y-0.5">
                    <span className="text-[11px] font-bold uppercase text-slate-400 block">
                      {linkedPo || pendingOrder.purchaseOrderNumber || pendingOrder.linkedPurchaseOrderId
                        ? 'Purchase Order Sent'
                        : 'Vendor Purchase Order'}
                    </span>
                    {linkedPo || pendingOrder.purchaseOrderNumber || pendingOrder.linkedPurchaseOrderId ? (
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs text-amber-800">
                          {linkedPo?.poNumber || pendingOrder.purchaseOrderNumber || 'Linked PO'}
                        </span>
                        {linkedPo && (
                          <span className="text-[11px] font-semibold px-1.5 py-0.2 rounded bg-amber-50 text-amber-800 border border-amber-200">
                            {linkedPo.status}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 italic">No vendor PO linked yet</span>
                    )}
                  </div>

                  {linkedPo ? (
                    <button
                      type="button"
                      onClick={() => setSelectedPurchaseOrderForDetail(linkedPo)}
                      className="px-2.5 py-1 text-xs font-bold text-amber-800 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 rounded-lg border border-amber-200 transition-colors flex items-center gap-1 shadow-2xs"
                      title="View Purchase Order Details & PDF"
                    >
                      <span>View PO</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  ) : pendingOrder.status === 'Waiting' && onCreatePurchaseOrder ? (
                    <button
                      type="button"
                      onClick={() => onCreatePurchaseOrder(pendingOrder)}
                      className="px-2.5 py-1 text-xs font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 rounded-lg border border-amber-300 transition-colors flex items-center gap-1 shadow-2xs"
                    >
                      <ShoppingBag className="h-3 w-3 text-amber-700" />
                      <span>Create PO</span>
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            {/* 5. Notes & Cancellation Detail */}
            {(pendingOrder.notes || pendingOrder.cancellationReason) && (
              <div className="p-4 rounded-xl border border-slate-200 space-y-1 bg-slate-50/60">
                <span className="text-xs font-bold text-slate-700 block">
                  Order Log Notes & Reasons:
                </span>
                {pendingOrder.notes && (
                  <p className="text-xs text-slate-600">
                    {pendingOrder.notes}
                  </p>
                )}
                {pendingOrder.cancellationReason && (
                  <p className="text-xs text-rose-700 font-semibold italic">
                    Cancellation Reason: {pendingOrder.cancellationReason}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Action Footer Toolbar */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 print:hidden">
          <div className="flex items-center gap-2">
            {canEditRestockDate && (
              <button
                type="button"
                onClick={() => onEditRestockDate(pendingOrder)}
                className="px-3.5 py-2 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors flex items-center gap-1.5 shadow-2xs"
              >
                <Edit2 className="h-3.5 w-3.5 text-slate-500" />
                <span>Edit Restock Date</span>
              </button>
            )}

            {pendingOrder.status === 'Waiting' && !linkedPo && onCreatePurchaseOrder && (
              <button
                type="button"
                onClick={() => onCreatePurchaseOrder(pendingOrder)}
                className="px-3.5 py-2 text-xs font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-xl transition-colors flex items-center gap-1.5 shadow-2xs"
              >
                <ShoppingBag className="h-3.5 w-3.5 text-amber-700" />
                <span>Create Purchase Order</span>
              </button>
            )}

            {canCancelEnquiry && pendingOrder.status !== 'Fulfilled' && pendingOrder.status !== 'Cancelled' && (
              <button
                type="button"
                onClick={() => onCancel(pendingOrder)}
                className="px-3 py-2 text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-xl border border-transparent hover:border-rose-200 transition-colors flex items-center gap-1"
              >
                <XCircle className="h-3.5 w-3.5" />
                <span>Cancel Order</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors"
            >
              Close
            </button>

            {canConvertEnquiry && pendingOrder.status !== 'Fulfilled' && pendingOrder.status !== 'Cancelled' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onConvert(pendingOrder.enquiryId, 'estimate');
                  }}
                  className="px-4 py-2 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl transition-colors flex items-center gap-1.5 shadow-2xs"
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span>Quote</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onConvert(pendingOrder.enquiryId, 'invoice');
                  }}
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors flex items-center gap-1.5 shadow-xs"
                >
                  <Receipt className="h-3.5 w-3.5" />
                  <span>Bill</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Linked Purchase Order Detail Modal */}
      {selectedPurchaseOrderForDetail && (
        <PurchaseOrderDetailModal
          isOpen={!!selectedPurchaseOrderForDetail}
          purchaseOrder={selectedPurchaseOrderForDetail}
          onClose={() => setSelectedPurchaseOrderForDetail(null)}
        />
      )}
    </div>
  );
};
