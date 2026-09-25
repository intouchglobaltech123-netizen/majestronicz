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
  PackageCheck,
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
  const [advanceInput, setAdvanceInput] = useState<string>('');
  const [advanceModeInput, setAdvanceModeInput] = useState<string>('Cash');

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

  const handleRecordAdvance = () => {
    const amt = Math.max(0, Number(advanceInput) || 0);
    if (amt <= 0) return;
    updatePendingOrder(pendingOrder.id, {
      advanceAmount: (pendingOrder.advanceAmount || 0) + amt,
      advanceMode: advanceModeInput,
      advancePaidAt: new Date().toISOString(),
    });
    setAdvanceInput('');
  };

  const handleClearAdvance = () => {
    updatePendingOrder(pendingOrder.id, {
      advanceAmount: 0,
      advanceMode: undefined,
      advancePaidAt: undefined,
    });
  };

  const handleJumpToEnquiry = () => {
    if (originalEnquiry) {
      setSelectedEnquiryForDetail(originalEnquiry);
      setCurrentView('enquiries');
      onClose();
    }
  };

  const statusBadge = () => {
    // Terminal states (Fulfilled / Cancelled) take precedence over the
    // "stock is available" hint — a completed order must never read "Stock
    // Arrived" just because stock happens to be on hand.
    if (pendingOrder.status === 'Fulfilled') {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-none bg-slate-100 text-slate-800 border border-slate-300 font-bold text-xs">
          <CheckCircle2 className="h-3.5 w-3.5 text-slate-600" />
          Fulfilled
        </span>
      );
    }
    if (pendingOrder.status !== 'Cancelled' && (pendingOrder.status === 'Stock Arrived' || canFulfillNow)) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-none bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold text-xs shadow-none">
          <PackageCheck className="h-3.5 w-3.5 text-emerald-600" />
          Stock Arrived
        </span>
      );
    }
    if (pendingOrder.status === 'Cancelled') {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-none bg-rose-100 text-rose-800 border border-rose-300 font-bold text-xs">
          <XCircle className="h-3.5 w-3.5 text-rose-600" />
          Cancelled
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-none bg-amber-100 text-amber-900 border border-amber-300 font-bold text-xs">
        <Clock className="h-3.5 w-3.5 text-amber-600" />
        Waiting Restock
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/70 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto print:p-0 print:bg-white">
      <div className="bg-white border border-slate-300 rounded-none w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[96vh] print:max-h-none print:border-none print:shadow-none print:w-full print:rounded-none">
        {/* Top Header Bar */}
        <div className="px-6 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between print:hidden">
          <div className="flex items-center flex-wrap gap-2.5">
            <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
              Pending Stock Order Document Preview
            </span>
            <span className="text-xs font-mono font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded-none border border-red-200">
              {pendingOrder.orderNumber}
            </span>
            {statusBadge()}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-200 rounded-none transition-colors cursor-pointer"
              title="Print Order Sheet"
            >
              <Printer className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-none transition-colors cursor-pointer"
              title="Close (Esc)"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Printable Document Card */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-4 sm:p-6 space-y-6 print:p-0">
          <div className="bg-white border border-slate-300 rounded-none p-6 sm:p-8 shadow-none print:border-none print:shadow-none space-y-6">
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

              <div className="sm:text-right space-y-1.5 shrink-0 bg-slate-50 sm:bg-transparent p-4 sm:p-0 rounded-none">
                <span className="text-xs font-bold uppercase tracking-widest text-slate-400 block">
                  Pending Stock Replenishment Order
                </span>
                <h2 className="text-xl sm:text-2xl font-bold font-mono text-red-700">
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
              <div className="p-4 rounded-none bg-slate-50 border border-slate-200 space-y-2">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 block">
                  Customer Waiting for Fulfillment
                </span>
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-none bg-red-50 text-red-700 border border-red-200 flex items-center justify-center shrink-0">
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

              <div className="p-4 rounded-none bg-slate-50 border border-slate-200 space-y-2">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 block">
                  Restock Timeline & Monitoring
                </span>
                <div className="flex items-center justify-between">
                  <div>
                    <span className={cn(
                      'text-xs font-bold px-2 py-0.5 rounded-none border inline-flex items-center gap-1',
                      restock.isOverdue
                        ? 'bg-rose-50 text-rose-700 border-rose-200 animate-pulse'
                        : 'bg-slate-100 text-slate-800 border-slate-300'
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
                      className="px-2.5 py-1 text-xs font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-none border border-slate-300 transition-colors flex items-center gap-1 cursor-pointer"
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
                      className="px-2 py-1 rounded-none bg-white border border-slate-300 text-xs font-mono text-slate-900 focus:outline-none focus:border-red-600"
                    />
                    <button
                      type="button"
                      onClick={handleSaveExpectedDate}
                      className="px-2.5 py-1 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-none border border-red-700 flex items-center gap-1 shadow-none cursor-pointer"
                    >
                      <Save className="h-3 w-3" />
                      <span>Save</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEditingExpectedDate(false)}
                      className="px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 rounded-none border border-slate-300 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Advance / token payment taken while the customer waits for stock */}
            <div>
              <div className="text-xs font-extrabold uppercase tracking-wider text-slate-500 mb-2">
                Advance Payment
              </div>
              <div className="border border-slate-300 rounded-none p-3 bg-emerald-50/40">
                {pendingOrder.advanceAmount && pendingOrder.advanceAmount > 0 ? (
                  <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                    <div className="text-sm">
                      <span className="font-bold text-emerald-800 font-mono text-base">₹{(pendingOrder.advanceAmount).toLocaleString('en-IN')}</span>
                      <span className="text-slate-500 text-xs"> advance received{pendingOrder.advanceMode ? ` · ${pendingOrder.advanceMode}` : ''}{pendingOrder.advancePaidAt ? ` · ${pendingOrder.advancePaidAt.slice(0, 10)}` : ''}</span>
                    </div>
                    <button type="button" onClick={handleClearAdvance} className="text-[11px] font-bold text-rose-600 hover:text-rose-800 cursor-pointer">Clear</button>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 mb-2">No advance recorded yet.</p>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">₹</span>
                    <input
                      type="number" min={0} value={advanceInput}
                      onChange={(e) => setAdvanceInput(e.target.value)}
                      placeholder="Advance amount"
                      className="w-32 pl-5 pr-2 py-1.5 rounded-none bg-white border border-slate-300 text-xs font-bold font-mono text-slate-900 focus:outline-none focus:border-emerald-600"
                    />
                  </div>
                  <select
                    value={advanceModeInput}
                    onChange={(e) => setAdvanceModeInput(e.target.value)}
                    className="px-2 py-1.5 rounded-none bg-white border border-slate-300 text-xs font-bold text-slate-800 focus:outline-none focus:border-emerald-600"
                  >
                    <option>Cash</option>
                    <option>GPay</option>
                    <option>HDFC</option>
                    <option>Card</option>
                    <option>Bank Transfer</option>
                  </select>
                  <button
                    type="button"
                    onClick={handleRecordAdvance}
                    disabled={!(Number(advanceInput) > 0)}
                    className="px-3 py-1.5 rounded-none bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold border border-emerald-700 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {pendingOrder.advanceAmount ? 'Add More' : 'Record Advance'}
                  </button>
                </div>
              </div>
            </div>

            {/* 3. Item & Shortage Breakdown Table */}
            <div>
              <div className="text-xs font-extrabold uppercase tracking-wider text-slate-500 mb-2">
                Item & Inventory Status
              </div>
              <div className="border border-slate-300 rounded-none overflow-hidden">
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
                      <td className="py-3.5 px-4 text-center font-mono font-bold text-sm text-rose-700">
                        {pendingOrder.quantityNeeded}
                      </td>
                      <td className="py-3.5 px-4 text-center font-mono font-bold text-slate-800">
                        {currentBranchStock}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {pendingOrder.status === 'Fulfilled' || pendingOrder.status === 'Cancelled' ? (
                          // Terminal order: the live "stock in hand" hint no longer
                          // applies — showing it read as if the order were still
                          // actionable (CRM-12).
                          <span className="text-[11px] font-semibold text-slate-400">—</span>
                        ) : canFulfillNow ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            <PackageCheck className="h-3 w-3 text-emerald-600" />
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
            <div className="p-4 rounded-none bg-slate-50 border border-slate-300 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-slate-600" />
                  <span>Related Business Records</span>
                </span>
                <span className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Cross-links & traceability</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Link to Original Customer Enquiry */}
                <div className="p-3 rounded-none bg-white border border-slate-300 shadow-none flex items-center justify-between">
                  <div className="space-y-0.5">
                    <span className="text-[11px] font-bold uppercase text-slate-400 block">
                      Original Customer Enquiry
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-xs text-red-700">
                        {pendingOrder.enquiryNumber}
                      </span>
                      {originalEnquiry && (
                        <span className="text-[11px] font-semibold px-1.5 py-0.2 rounded-none bg-red-50 text-red-700 border border-red-200">
                          {originalEnquiry.status}
                        </span>
                      )}
                    </div>
                  </div>

                  {originalEnquiry && (
                    <button
                      type="button"
                      onClick={handleJumpToEnquiry}
                      className="px-2.5 py-1 text-xs font-bold text-slate-800 hover:text-slate-950 bg-slate-100 hover:bg-slate-200 rounded-none border border-slate-300 transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <span>View Enquiry</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  )}
                </div>

                {/* Link to Linked Purchase Order or Create PO Action */}
                <div className="p-3 rounded-none bg-white border border-slate-300 shadow-none flex items-center justify-between">
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
                          <span className="text-[11px] font-semibold px-1.5 py-0.2 rounded-none bg-amber-50 text-amber-800 border border-amber-200">
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
                      className="px-2.5 py-1 text-xs font-bold text-amber-800 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 rounded-none border border-amber-300 transition-colors flex items-center gap-1 shadow-none cursor-pointer"
                      title="View Purchase Order Details & PDF"
                    >
                      <span>View PO</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  ) : pendingOrder.status === 'Waiting' && onCreatePurchaseOrder ? (
                    <button
                      type="button"
                      onClick={() => onCreatePurchaseOrder(pendingOrder)}
                      className="px-2.5 py-1 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-none border border-red-700 transition-colors flex items-center gap-1 shadow-none cursor-pointer"
                    >
                      <ShoppingBag className="h-3 w-3 text-white" />
                      <span>Create PO</span>
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            {/* 5. Notes & Cancellation Detail */}
            {(pendingOrder.notes || pendingOrder.cancellationReason) && (
              <div className="p-4 rounded-none border border-slate-300 space-y-1 bg-slate-50">
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
                className="px-3.5 py-2 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-none transition-colors flex items-center gap-1.5 shadow-none cursor-pointer uppercase tracking-wider"
              >
                <Edit2 className="h-3.5 w-3.5 text-slate-500" />
                <span>Edit Restock Date</span>
              </button>
            )}

            {pendingOrder.status === 'Waiting' && !linkedPo && onCreatePurchaseOrder && (
              <button
                type="button"
                onClick={() => onCreatePurchaseOrder(pendingOrder)}
                className="px-3.5 py-2 text-xs font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-none transition-colors flex items-center gap-1.5 shadow-none cursor-pointer uppercase tracking-wider"
              >
                <ShoppingBag className="h-3.5 w-3.5 text-amber-700" />
                <span>Create Purchase Order</span>
              </button>
            )}

            {canCancelEnquiry && pendingOrder.status !== 'Fulfilled' && pendingOrder.status !== 'Cancelled' && (
              <button
                type="button"
                onClick={() => onCancel(pendingOrder)}
                className="px-3 py-2 text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-none border border-slate-200 hover:border-rose-300 transition-colors flex items-center gap-1 cursor-pointer"
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
              className="px-4 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-300 rounded-none transition-colors cursor-pointer"
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
                  className="px-4 py-2 text-xs font-bold text-slate-800 bg-white hover:bg-slate-100 border border-slate-300 rounded-none transition-colors flex items-center gap-1.5 shadow-none cursor-pointer"
                >
                  <FileText className="h-3.5 w-3.5 text-slate-500" />
                  <span>+ Quote</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onConvert(pendingOrder.enquiryId, 'invoice');
                  }}
                  className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 border border-red-700 rounded-none transition-colors flex items-center gap-1.5 shadow-none cursor-pointer"
                >
                  <Receipt className="h-3.5 w-3.5" />
                  <span>+ Bill</span>
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
