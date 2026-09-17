import React, { useState } from 'react';
import { Enquiry, COMPANY_PROFILE, BRANCHES } from '../../types';
import { useErp } from '../../context/ErpContext';
import { MajestroniczLogo } from '../common/MajestroniczLogo';
import {
  X,
  Printer,
  FileText,
  Receipt,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  User,
  Phone,
  Building,
  Calendar,
  Save,
  Bell,
  ExternalLink,
  Layers,
  Edit2,
  PlusCircle,
  Sparkles,
} from 'lucide-react';
import { cn } from '../../lib/utils';

interface Props {
  enquiry: Enquiry | null;
  isOpen: boolean;
  onClose: () => void;
  onConvertToQuote: (enquiryId: string) => void;
  onConvertToInvoice: (enquiryId: string) => void;
  onCancelEnquiry: (enquiry: Enquiry) => void;
  onOpenScheduleReminder: (enquiry: Enquiry) => void;
  onAddToCatalog?: (enquiry: Enquiry) => void;
}

export const EnquiryDetailModal: React.FC<Props> = ({
  enquiry,
  isOpen,
  onClose,
  onConvertToQuote,
  onConvertToInvoice,
  onCancelEnquiry,
  onOpenScheduleReminder,
  onAddToCatalog,
}) => {
  const {
    getBranchStock,
    updateEnquiryNotes,
    pendingOrders,
    setSelectedPendingOrderForDetail,
    setCurrentView,
    canCancelEnquiry,
    canConvertEnquiry,
    canApproveCatalogRequests,
  } = useErp();

  const [notes, setNotes] = useState('');
  const [isEditingNotes, setIsEditingNotes] = useState(false);

  React.useEffect(() => {
    if (enquiry) {
      setNotes(enquiry.notes || '');
      setIsEditingNotes(false);
    }
  }, [enquiry]);

  if (!isOpen || !enquiry) return null;

  const currentStock = enquiry.itemId ? (getBranchStock(enquiry.itemId, enquiry.branchId)?.quantity ?? 0) : 0;
  const hasSufficientStock = enquiry.itemId ? currentStock >= enquiry.quantity : false;
  const branchObj = BRANCHES.find((b) => b.id === enquiry.branchId);

  // Linked Pending Order
  const linkedPo = pendingOrders.find(
    (po) =>
      (enquiry.pendingOrderId && po.id === enquiry.pendingOrderId) ||
      po.enquiryId === enquiry.id ||
      po.enquiryNumber === enquiry.enquiryNumber
  );

  const handlePrint = () => {
    window.print();
  };

  const handleSaveNotes = () => {
    updateEnquiryNotes(enquiry.id, notes.trim());
    setIsEditingNotes(false);
  };

  const handleJumpToPendingOrder = () => {
    if (linkedPo) {
      setSelectedPendingOrderForDetail(linkedPo);
      setCurrentView('pending-orders');
      onClose();
    }
  };

  const handleJumpToConvertedRecord = () => {
    if (enquiry.convertedTo?.type === 'invoice') {
      setCurrentView('invoices');
      onClose();
    } else if (enquiry.convertedTo?.type === 'estimate') {
      setCurrentView('estimates');
      onClose();
    }
  };

  const statusBadge = () => {
    if (enquiry.isNewItemRequest && !enquiry.itemId) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-100 text-purple-900 border border-purple-300 font-bold text-xs">
          <Sparkles className="h-3.5 w-3.5 text-purple-600" />
          New Item Request (Awaiting Catalog)
        </span>
      );
    }
    if (enquiry.status === 'Converted') {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold text-xs">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          Converted
        </span>
      );
    }
    if (enquiry.status === 'Cancelled') {
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
        Follow-up Active
        {enquiry.isNewItemRequest && (
          <span className="ml-1 text-[11px] bg-purple-200 text-purple-800 px-1.5 py-0.5 rounded-full font-semibold">New Item</span>
        )}
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/70 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto print:p-0 print:bg-white">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[96vh] print:max-h-none print:border-none print:shadow-none print:w-full print:rounded-none">
        {/* Top Header Bar (Matching Sales PDF Modal pattern) */}
        <div className="px-6 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between print:hidden">
          <div className="flex items-center flex-wrap gap-2.5">
            <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
              Customer Enquiry Detail Preview
            </span>
            <span className="text-xs font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
              {enquiry.enquiryNumber}
            </span>
            {statusBadge()}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors"
              title="Print Enquiry Sheet"
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

        {/* Scrollable Printable Document Container */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-4 sm:p-6 space-y-6 print:p-0">
          <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 shadow-xs print:border-none print:shadow-none space-y-6">
            {/* 1. Header with Company Profile & Document Meta */}
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
                <span className="text-xs font-bold uppercase tracking-widest text-slate-400 block">
                  Customer Requirement Record
                </span>
                <h2 className="text-xl sm:text-2xl font-bold font-mono text-blue-700">
                  {enquiry.enquiryNumber}
                </h2>
                <div className="text-xs text-slate-600 font-mono space-y-0.5">
                  <div className="flex sm:justify-end items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-slate-400" />
                    <span>Date: <strong>{enquiry.date}</strong></span>
                  </div>
                  <div className="flex sm:justify-end items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-slate-400" />
                    <span>Time: <strong>{enquiry.time}</strong></span>
                  </div>
                  <div className="flex sm:justify-end items-center gap-1.5">
                    <Building className="h-3.5 w-3.5 text-slate-400" />
                    <span>Hub: <strong>{branchObj?.name || enquiry.branchId}</strong></span>
                  </div>
                </div>
              </div>
            </div>

            {/* 2. Customer & Branch Information Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/80 space-y-2">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 block">
                  Prospective Buyer / Customer
                </span>
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                    <User className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">{enquiry.customerName}</h3>
                    {enquiry.customerPhone ? (
                      <div className="flex items-center gap-1 text-xs text-slate-600 font-mono mt-0.5">
                        <Phone className="h-3 w-3 text-slate-400" />
                        <span>{enquiry.customerPhone}</span>
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-400 italic">No phone logged</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/80 space-y-2">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 block">
                  Fulfillment Location & Live Stock Status
                </span>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-1.5 font-bold text-sm text-slate-900">
                      <Building className="h-4 w-4 text-blue-600" />
                      <span>{branchObj?.name || enquiry.branchId}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {branchObj?.location || 'Central Facility'}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] uppercase font-bold text-slate-400 block">
                      Hub Inventory
                    </span>
                    {!enquiry.itemId ? (
                      <span className="text-xs font-bold font-mono px-2 py-0.5 rounded border inline-block mt-0.5 bg-purple-50 text-purple-700 border-purple-200">
                        Not in Catalog
                      </span>
                    ) : (
                      <span className={cn(
                        'text-sm font-bold font-mono px-2 py-0.5 rounded border inline-block mt-0.5',
                        hasSufficientStock
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-rose-50 text-rose-700 border-rose-200'
                      )}>
                        {currentStock} {enquiry.unit} Available
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* New Item Request Banner if not in catalog */}
            {enquiry.isNewItemRequest && !enquiry.itemId && (
              <div className="p-4 rounded-xl bg-purple-50 border border-purple-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center shrink-0 mt-0.5">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-purple-950 uppercase tracking-wide">
                      New Item Request — Not in Catalog
                    </h4>
                    <p className="text-xs text-purple-800 mt-0.5">
                      This item was requested by the customer but does not exist in the inventory catalog yet.
                      {canApproveCatalogRequests
                        ? ' Click "Add to Catalog" to register the master product specifications and assign pricing.'
                        : ' Awaiting Manager/CEO review to add this item to the catalog.'}
                    </p>
                  </div>
                </div>
                {canApproveCatalogRequests && onAddToCatalog && enquiry.status !== 'Cancelled' && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onAddToCatalog(enquiry);
                    }}
                    className="px-4 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-xs transition-colors shrink-0 flex items-center gap-1.5 self-start sm:self-auto"
                  >
                    <PlusCircle className="h-3.5 w-3.5" />
                    <span>Add to Catalog</span>
                  </button>
                )}
              </div>
            )}

            {/* 3. Item Requested Specification Table */}
            <div>
              <div className="text-xs font-extrabold uppercase tracking-wider text-slate-500 mb-2">
                Item Requested Details
              </div>
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 font-bold uppercase text-[11px] border-b border-slate-200">
                      <th className="py-3 px-4">Item Name & Code</th>
                      <th className="py-3 px-4 text-center">Unit</th>
                      <th className="py-3 px-4 text-center">Required Qty</th>
                      <th className="py-3 px-4 text-center">Branch Stock</th>
                      <th className="py-3 px-4 text-right">Shortage Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          {enquiry.itemImageUrl && (
                            <img
                              src={enquiry.itemImageUrl}
                              alt={enquiry.itemName}
                              className="h-12 w-12 rounded-lg object-cover border border-slate-200 shrink-0 bg-slate-50 shadow-2xs"
                            />
                          )}
                          <div>
                            <div className="font-bold text-slate-900 flex items-center gap-2">
                              <span>{enquiry.itemName}</span>
                              {enquiry.isNewItemRequest && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold bg-purple-100 text-purple-800 border border-purple-200">
                                  <Sparkles className="h-2.5 w-2.5" />
                                  New Item Request
                                </span>
                              )}
                            </div>
                            {enquiry.itemCode ? (
                              <span className="text-[11px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded border border-slate-200 mt-0.5 inline-block">
                                {enquiry.itemCode}
                              </span>
                            ) : (
                              <span className="text-[11px] text-purple-700 bg-purple-50 px-1.5 py-0.2 rounded border border-purple-200 mt-0.5 inline-block italic font-semibold">
                                Awaiting Catalog Registration
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-center font-mono font-bold text-slate-600">
                        {enquiry.unit}
                      </td>
                      <td className="py-3.5 px-4 text-center font-mono font-bold text-sm text-slate-900">
                        {enquiry.quantity}
                      </td>
                      <td className="py-3.5 px-4 text-center font-mono font-bold text-slate-700">
                        {!enquiry.itemId ? '—' : currentStock}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {!enquiry.itemId ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                            <Sparkles className="h-3 w-3" />
                            Not in Catalog
                          </span>
                        ) : hasSufficientStock ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            <CheckCircle2 className="h-3 w-3" />
                            Sufficient Stock
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                            <AlertTriangle className="h-3 w-3" />
                            Shortage ({enquiry.quantity - currentStock} {enquiry.unit})
                          </span>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* 4. Related Records Section (Clean, dedicated cross-links) */}
            <div className="p-4 rounded-xl bg-blue-50/40 border border-blue-100 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider text-blue-900 flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-blue-600" />
                  <span>Related Business Records</span>
                </span>
                <span className="text-[11px] text-blue-600">Cross-module traceability</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Linked Pending Order */}
                <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs flex items-center justify-between">
                  <div className="space-y-0.5">
                    <span className="text-[11px] font-bold uppercase text-slate-400 block">
                      Linked Pending Stock Order
                    </span>
                    {linkedPo || enquiry.hasPendingOrder ? (
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs text-purple-700">
                          {linkedPo ? linkedPo.orderNumber : `PO-WAIT-${enquiry.enquiryNumber}`}
                        </span>
                        <span className="text-[11px] font-semibold px-1.5 py-0.2 rounded bg-purple-50 text-purple-700 border border-purple-200">
                          {linkedPo?.status || 'Waiting'}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 italic">No backlog order needed</span>
                    )}
                  </div>

                  {linkedPo && (
                    <button
                      type="button"
                      onClick={handleJumpToPendingOrder}
                      className="px-2.5 py-1 text-xs font-bold text-purple-700 hover:text-purple-900 bg-purple-50 hover:bg-purple-100 rounded-lg border border-purple-200 transition-colors flex items-center gap-1"
                    >
                      <span>View Order</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  )}
                </div>

                {/* Converted Quote / Invoice */}
                <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs flex items-center justify-between">
                  <div className="space-y-0.5">
                    <span className="text-[11px] font-bold uppercase text-slate-400 block">
                      Resulting Sales Document
                    </span>
                    {enquiry.convertedTo ? (
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs text-emerald-700">
                          {enquiry.convertedTo.number}
                        </span>
                        <span className="text-[11px] font-semibold px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase">
                          {enquiry.convertedTo.type}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 italic">Not converted yet</span>
                    )}
                  </div>

                  {enquiry.convertedTo && (
                    <button
                      type="button"
                      onClick={handleJumpToConvertedRecord}
                      className="px-2.5 py-1 text-xs font-bold text-emerald-700 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 rounded-lg border border-emerald-200 transition-colors flex items-center gap-1"
                    >
                      <span>Open {enquiry.convertedTo.type === 'invoice' ? 'Sale' : 'Quote'}</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* 5. Editable Staff Notes Section */}
            <div className="p-4 rounded-xl border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700">
                  Staff Notes & Customer Instructions
                </span>
                {!isEditingNotes && (
                  <button
                    type="button"
                    onClick={() => setIsEditingNotes(true)}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1"
                  >
                    <Edit2 className="h-3 w-3" />
                    <span>Edit Notes</span>
                  </button>
                )}
              </div>

              {isEditingNotes ? (
                <div className="space-y-2">
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Enter notes about customer requirements, discounts agreed, or follow-up feedback..."
                    className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-blue-600"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setNotes(enquiry.notes || '');
                        setIsEditingNotes(false);
                      }}
                      className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveNotes}
                      className="px-3.5 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-1 shadow-2xs"
                    >
                      <Save className="h-3.5 w-3.5" />
                      <span>Save Notes</span>
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-600 italic bg-slate-50 p-3 rounded-lg border border-slate-100">
                  {enquiry.notes || 'No customer notes recorded yet. Click "Edit Notes" to add.'}
                </p>
              )}
            </div>

            {/* 6. Activity Timeline: Created -> Status Changes/Reminders -> Converted/Cancelled */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-slate-400" />
                  <span>Activity & Status Timeline</span>
                </span>
                {enquiry.reminderDate && (
                  <span className="text-[11px] font-mono font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                    Next Reminder: {enquiry.reminderDate} {enquiry.reminderTime ? `at ${enquiry.reminderTime}` : ''}
                  </span>
                )}
              </div>

              <div className="relative pl-6 border-l-2 border-slate-200 space-y-4 py-1">
                {enquiry.timeline && enquiry.timeline.length > 0 ? (
                  enquiry.timeline.map((event) => (
                    <div key={event.id} className="relative group">
                      {/* Timeline Node Dot */}
                      <div className={cn(
                        'absolute -left-[31px] top-0.5 h-4 w-4 rounded-full border-2 border-white shadow-2xs',
                        event.type === 'converted' && 'bg-emerald-500',
                        event.type === 'cancelled' && 'bg-rose-500',
                        event.type === 'reminder_set' && 'bg-amber-500',
                        event.type === 'created' && 'bg-blue-500',
                        event.type === 'status_change' && 'bg-purple-500',
                        event.type === 'note_updated' && 'bg-slate-400'
                      )} />

                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-slate-900">
                            {event.title}
                          </span>
                          <span className="text-[11px] text-slate-400 font-mono">
                            {new Date(event.timestamp).toLocaleString('en-IN', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </span>
                          {event.actor && (
                            <span className="text-[11px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded font-medium">
                              By {event.actor}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 mt-0.5">
                          {event.description}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-slate-400 italic">
                    Created on {enquiry.date} at {enquiry.time}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Action Footer Toolbar */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 print:hidden">
          <div className="flex items-center gap-2">
            {/* Schedule Follow-up Reminder Prompt */}
            {enquiry.status !== 'Converted' && enquiry.status !== 'Cancelled' && (
              <button
                type="button"
                onClick={() => onOpenScheduleReminder(enquiry)}
                className="px-3.5 py-2 text-xs font-bold text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-xl border border-amber-300 transition-colors flex items-center gap-1.5 shadow-2xs"
              >
                <Bell className="h-3.5 w-3.5 text-amber-700" />
                <span>{enquiry.reminderDate ? 'Reschedule Reminder' : 'Set Follow-up Reminder'}</span>
              </button>
            )}

            {/* Cancel Enquiry */}
            {canCancelEnquiry && enquiry.status !== 'Converted' && enquiry.status !== 'Cancelled' && (
              <button
                type="button"
                onClick={() => onCancelEnquiry(enquiry)}
                className="px-3 py-2 text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-xl border border-transparent hover:border-rose-200 transition-colors flex items-center gap-1"
              >
                <XCircle className="h-3.5 w-3.5" />
                <span>Cancel Enquiry</span>
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

            {/* Conversion / Catalog Actions */}
            {enquiry.status !== 'Converted' && enquiry.status !== 'Cancelled' && (
              <>
                {canApproveCatalogRequests && !enquiry.itemId && onAddToCatalog && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onAddToCatalog(enquiry);
                    }}
                    className="px-4 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-xl transition-colors flex items-center gap-1.5 shadow-xs"
                  >
                    <PlusCircle className="h-3.5 w-3.5" />
                    <span>Add to Catalog</span>
                  </button>
                )}

                {canConvertEnquiry && enquiry.itemId && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onConvertToQuote(enquiry.id);
                      }}
                      className="px-4 py-2 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl transition-colors flex items-center gap-1.5 shadow-2xs"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      <span>To Quote</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onConvertToInvoice(enquiry.id);
                      }}
                      className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors flex items-center gap-1.5 shadow-xs"
                    >
                      <Receipt className="h-3.5 w-3.5" />
                      <span>To Invoice</span>
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
