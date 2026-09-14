import React, { useState } from 'react';
import { useErp } from '../../context/ErpContext';
import { PendingOrder } from '../../types';
import { cn } from '../../lib/utils';
import { EditRestockDateModal } from './EditRestockDateModal';
import { PendingOrderDetailModal } from './PendingOrderDetailModal';
import { CancelReasonModal } from './CancelReasonModal';
import {
  Clock,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Receipt,
  Edit2,
  XCircle,
  Building,
  User,
  Sparkles,
  ShoppingBag,
} from 'lucide-react';
import { PurchaseOrderFormModal } from '../purchases/PurchaseOrderFormModal';
import { PurchaseOrderDetailModal } from '../purchases/PurchaseOrderDetailModal';

interface Props {
  pendingOrders: PendingOrder[];
  onConvert: (enquiryId: string, targetType: 'estimate' | 'invoice') => void;
}

export const PendingOrderList: React.FC<Props> = ({
  pendingOrders,
  onConvert,
}) => {
  const {
    canCancelEnquiry,
    canConvertEnquiry,
    canEditRestockDate,
    updatePendingOrder,
    cancelPendingOrder,
    getBranchStock,
    selectedPendingOrderForDetail,
    setSelectedPendingOrderForDetail,
    purchaseOrders,
    selectedPurchaseOrderForDetail,
    setSelectedPurchaseOrderForDetail,
  } = useErp();

  const [editingDateOrder, setEditingDateOrder] = useState<PendingOrder | null>(null);
  const [cancellingOrder, setCancellingOrder] = useState<PendingOrder | null>(null);
  const [creatingPoForOrder, setCreatingPoForOrder] = useState<PendingOrder | null>(null);

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

  if (pendingOrders.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-400 shadow-xs">
        <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-400 mb-2" />
        <p className="font-bold text-slate-700 text-sm">No Pending Orders</p>
        <p className="text-xs text-slate-400 mt-1">
          All customer enquiries have sufficient inventory or have been fulfilled.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Table of Pending Orders */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
              Pending Orders Backlog ({pendingOrders.length})
            </span>
            <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-200 font-bold">
              Restock Monitoring Active
            </span>
          </div>
          <span className="text-[11px] text-slate-500">
            Automatically notifies staff when inventory is replenished. Click row for details.
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                <th className="py-3.5 px-4">Order Ref</th>
                <th className="py-3.5 px-4">Item & Needed Qty</th>
                <th className="py-3.5 px-4">Customer</th>
                <th className="py-3.5 px-4">Branch</th>
                <th className="py-3.5 px-4">Waiting Period</th>
                <th className="py-3.5 px-4">Restock Schedule</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {pendingOrders.map((po) => {
                const daysWaiting = calculateDaysWaiting(po.createdAt);
                const restock = calculateRestockStatus(po.expectedRestockDate);
                const currentBranchStock = getBranchStock(po.itemId, po.branchId)?.quantity ?? 0;
                const canFulfillNow = currentBranchStock >= po.quantityNeeded;

                return (
                  <tr
                    key={po.id}
                    onClick={() => setSelectedPendingOrderForDetail(po)}
                    className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                    title="Click to view full pending order detail & PDF preview"
                  >
                    {/* 1. Order Reference (Clean, no inline cross-link chips) */}
                    <td className="py-3.5 px-4">
                      <div className="font-mono font-bold text-blue-700 group-hover:underline">
                        {po.orderNumber}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                        Enq #{po.enquiryNumber}
                      </div>
                    </td>

                    {/* 2. Item & Needed Qty */}
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900">{po.itemName}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs font-mono font-black text-rose-700 bg-rose-50 px-1.5 py-0.2 rounded border border-rose-200">
                          Need: {po.quantityNeeded} {po.unit}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          In Branch: {currentBranchStock} {po.unit}
                        </span>
                      </div>
                    </td>

                    {/* 3. Customer */}
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900 flex items-center gap-1.5">
                        <User className="h-3 w-3 text-slate-400 shrink-0" />
                        <span>{po.customerName}</span>
                      </div>
                      {po.customerPhone && (
                        <div className="text-[11px] text-slate-500 font-mono pl-4.5">
                          {po.customerPhone}
                        </div>
                      )}
                    </td>

                    {/* 4. Branch */}
                    <td className="py-3.5 px-4">
                      <span className="uppercase font-mono font-bold text-[11px] text-slate-600 flex items-center gap-1">
                        <Building className="h-3 w-3 text-slate-400" />
                        {po.branchId}
                      </span>
                    </td>

                    {/* 5. Waiting Period */}
                    <td className="py-3.5 px-4">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-mono text-[11px] font-bold border border-slate-200">
                        <Clock className="h-3 w-3 text-slate-400" />
                        Waiting {daysWaiting} {daysWaiting === 1 ? 'day' : 'days'}
                      </span>
                    </td>

                    {/* 6. Restock Schedule */}
                    <td className="py-3.5 px-4 space-y-1">
                      <div className="flex items-center gap-1.5">
                        {po.status === 'Waiting' ? (
                          // Only pending (waiting) orders can be "overdue for restock".
                          <span
                            className={cn(
                              'text-[10px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1',
                              restock.isOverdue
                                ? 'bg-rose-50 text-rose-700 border-rose-200 animate-pulse'
                                : 'bg-blue-50 text-blue-700 border-blue-200'
                            )}
                          >
                            {restock.isOverdue && <AlertTriangle className="h-3 w-3 text-rose-600" />}
                            {restock.text}
                          </span>
                        ) : po.status === 'Stock Arrived' ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200 flex items-center gap-1">
                            Stock arrived — ready to fulfil
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-slate-100 text-slate-600 border-slate-200">
                            {po.status}
                          </span>
                        )}
                        {canEditRestockDate && po.status === 'Waiting' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingDateOrder(po);
                            }}
                            className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                            title="Edit expected arrival date"
                          >
                            <Edit2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      {po.expectedRestockDate && (
                        <div className="text-[10px] text-slate-400 font-mono">
                          Target: {po.expectedRestockDate}
                        </div>
                      )}
                    </td>

                    {/* 7. Status (Single clean badge) */}
                    <td className="py-3.5 px-4">
                      {po.status === 'Stock Arrived' || canFulfillNow ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold text-[10px] shadow-2xs">
                          <Sparkles className="h-3 w-3 text-emerald-600" />
                          Stock Arrived
                        </span>
                      ) : po.status === 'Fulfilled' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-bold">
                          <CheckCircle2 className="h-3 w-3" />
                          Fulfilled
                        </span>
                      ) : po.status === 'Cancelled' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold">
                          <XCircle className="h-3 w-3" />
                          Cancelled
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold">
                          <Clock className="h-3 w-3" />
                          Waiting Restock
                        </span>
                      )}
                    </td>

                    {/* 8. Action Buttons */}
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                        {/* Purchase Order direct actions for Waiting status */}
                        {po.status === 'Waiting' && (() => {
                          const linkedPo = purchaseOrders.find(
                            (p) => p.id === (po.linkedPurchaseOrderId || po.purchaseOrderId)
                          );
                          const poNumber = po.purchaseOrderNumber || linkedPo?.poNumber;

                          if (linkedPo || poNumber) {
                            return (
                              <button
                                type="button"
                                onClick={() => linkedPo && setSelectedPurchaseOrderForDetail(linkedPo)}
                                className="px-2 py-1 text-[11px] font-bold rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 transition-colors flex items-center gap-1 shadow-2xs"
                                title="View Linked Vendor Purchase Order"
                              >
                                <ShoppingBag className="h-3 w-3 text-amber-600" />
                                <span className="hidden sm:inline">PO: {poNumber}</span>
                              </button>
                            );
                          }

                          return (
                            <button
                              type="button"
                              onClick={() => setCreatingPoForOrder(po)}
                              className="px-2 py-1 text-[11px] font-bold rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 transition-colors flex items-center gap-1 shadow-2xs"
                              title="Create Linked Purchase Order"
                            >
                              <ShoppingBag className="h-3 w-3 text-amber-700" />
                              <span className="hidden sm:inline">Create PO</span>
                            </button>
                          );
                        })()}

                        {/* 1-Click Convert buttons */}
                        {canConvertEnquiry && po.status !== 'Fulfilled' && po.status !== 'Cancelled' && (
                          <>
                            <button
                              type="button"
                              onClick={() => onConvert(po.enquiryId, 'estimate')}
                              className="px-2 py-1 text-[11px] font-bold rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition-colors flex items-center gap-1 shadow-2xs"
                              title="Convert to Estimate"
                            >
                              <FileText className="h-3 w-3" />
                              <span className="hidden sm:inline">Quote</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onConvert(po.enquiryId, 'invoice')}
                              className="px-2 py-1 text-[11px] font-bold rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 transition-colors flex items-center gap-1 shadow-2xs"
                              title="Convert to Sales Invoice"
                            >
                              <Receipt className="h-3 w-3" />
                              <span className="hidden sm:inline">Bill</span>
                            </button>
                          </>
                        )}

                        {/* Cancel button (CEO/Manager only) */}
                        {canCancelEnquiry && po.status !== 'Fulfilled' && po.status !== 'Cancelled' && (
                          <button
                            type="button"
                            onClick={() => setCancellingOrder(po)}
                            className="p-1 rounded-lg text-slate-300 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                            title="Cancel pending order"
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pending Order Detail Modal (PDF-style full preview matching Sales pattern) */}
      <PendingOrderDetailModal
        isOpen={!!selectedPendingOrderForDetail}
        pendingOrder={selectedPendingOrderForDetail}
        onClose={() => setSelectedPendingOrderForDetail(null)}
        onConvert={(enquiryId, targetType) => onConvert(enquiryId, targetType)}
        onCancel={(po) => setCancellingOrder(po)}
        onEditRestockDate={(po) => setEditingDateOrder(po)}
        onCreatePurchaseOrder={(po) => setCreatingPoForOrder(po)}
      />

      {/* Edit Restock Date Modal */}
      {editingDateOrder && (
        <EditRestockDateModal
          isOpen={!!editingDateOrder}
          onClose={() => setEditingDateOrder(null)}
          orderNumber={editingDateOrder.orderNumber}
          itemName={editingDateOrder.itemName}
          currentDate={editingDateOrder.expectedRestockDate}
          onSave={(newDate) => {
            updatePendingOrder(editingDateOrder.id, { expectedRestockDate: newDate });
          }}
        />
      )}

      {/* Cancel Reason Modal */}
      {cancellingOrder && (
        <CancelReasonModal
          isOpen={!!cancellingOrder}
          onClose={() => setCancellingOrder(null)}
          title={`Cancel Pending Order ${cancellingOrder.orderNumber}`}
          targetName={`${cancellingOrder.itemName} for ${cancellingOrder.customerName}`}
          onConfirm={(reason) => {
            cancelPendingOrder(cancellingOrder.id, reason);
          }}
        />
      )}

      {/* Pre-filled Purchase Order Form Modal */}
      {creatingPoForOrder && (
        <PurchaseOrderFormModal
          isOpen={!!creatingPoForOrder}
          onClose={() => setCreatingPoForOrder(null)}
          preFilledBranchId={creatingPoForOrder.branchId}
          preFilledItems={[
            {
              itemId: creatingPoForOrder.itemId,
              quantity: creatingPoForOrder.quantityNeeded,
            },
          ]}
          linkedPendingOrderId={creatingPoForOrder.id}
          linkedPendingOrderNumber={creatingPoForOrder.orderNumber}
        />
      )}

      {/* Purchase Order Detail Modal */}
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

