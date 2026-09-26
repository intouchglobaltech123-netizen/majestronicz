import React, { useMemo, useState } from 'react';
import { X, Phone, MapPin, Hash, Wallet, ShoppingBag, Trash2, Edit2 } from 'lucide-react';
import { Vendor } from '../../types';
import { formatCurrency } from '../../lib/utils';
import { useErp } from '../../context/ErpContext';
import { RecordPaymentModal } from '../payments/RecordPaymentModal';

interface Props {
  vendor: Vendor | null;
  isOpen: boolean;
  onClose: () => void;
  onEditVendor?: (vendor: Vendor) => void;
}

/** Supplier statement — purchase bills (POs), payments made, and payable balance. */
export const VendorStatementModal: React.FC<Props> = ({ vendor, isOpen, onClose, onEditVendor }) => {
  const { purchaseOrders, payments, canRecordPayment, deletePayment, currentBranch, isAllBranches } = useErp();
  const [isPayOpen, setIsPayOpen] = useState(false);

  // Debit notes billed back to the supplier reduce what we still owe on a PO.
  const poDebit = (po: { debitNotes?: { totalAmount: number }[] }): number =>
    (po.debitNotes || []).reduce((s, dn) => s + (dn.totalAmount || 0), 0);
  // Remaining owed on a PO = total − paid − debit notes.
  const poBalance = (po: { totalAmount?: number; amountPaid?: number; debitNotes?: { totalAmount: number }[] }): number =>
    Math.max(0, (po.totalAmount || 0) - (po.amountPaid || 0) - poDebit(po));

  const vendorPOs = useMemo(
    () =>
      vendor
        ? purchaseOrders
            .filter((po) => po.vendorId === vendor.id && po.status !== 'Cancelled')
            // Branch-scope: locked roles only see their own branch's POs.
            .filter((po) => isAllBranches || po.branchId === currentBranch)
            .sort((a, b) => (a.date < b.date ? 1 : -1))
        : [],
    [purchaseOrders, vendor, isAllBranches, currentBranch]
  );

  const unpaidPOs = useMemo(
    () =>
      vendorPOs
        .map((po) => ({
          refId: po.id,
          refNumber: po.poNumber,
          date: po.date,
          balanceDue: poBalance(po),
        }))
        .filter((o) => o.balanceDue > 0.5),
    [vendorPOs]
  );

  // POs the supplier is still owed on — the detailed "what's owed" breakdown.
  const outstandingPOs = useMemo(
    () => vendorPOs.filter((po) => poBalance(po) > 0.5),
    [vendorPOs]
  );

  const totalPayable = unpaidPOs.reduce((t, o) => t + o.balanceDue, 0);

  const vendorPayments = useMemo(
    () =>
      vendor
        ? payments
            .filter((p) => p.type === 'out' && p.partyType === 'vendor' && (p.partyId === vendor.id || p.partyName === vendor.vendorName))
            .filter((p) => isAllBranches || p.branchId === currentBranch)
            .sort((a, b) => (a.date < b.date ? 1 : -1))
        : [],
    [payments, vendor, isAllBranches, currentBranch]
  );

  if (!isOpen || !vendor) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-11 w-11 rounded-xl bg-blue-50 text-blue-700 border border-blue-200/60 font-bold flex items-center justify-center shrink-0">
              {vendor.vendorName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 truncate">{vendor.vendorName}</h3>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">Supplier</span>
              </div>
              <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-[11px] text-slate-500">
                {vendor.contactNo && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{vendor.contactNo}</span>}
                {vendor.gstin && <span className="inline-flex items-center gap-1"><Hash className="h-3 w-3" />{vendor.gstin}</span>}
                {vendor.address && <span className="inline-flex items-center gap-1 truncate max-w-[220px]"><MapPin className="h-3 w-3" />{vendor.address}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onEditVendor && (
              <button onClick={() => onEditVendor(vendor)} title="Edit supplier" className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg">
                <Edit2 className="h-4 w-4" />
              </button>
            )}
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Payable summary */}
        <div className={`px-6 py-3 border-b flex items-center justify-between gap-3 shrink-0 ${totalPayable > 0 ? 'bg-rose-50/60 border-rose-100' : 'bg-emerald-50/50 border-emerald-100'}`}>
          <div>
            <p className={`text-[11px] font-bold uppercase tracking-wider ${totalPayable > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>To Pay</p>
            <p className={`text-xl sm:text-2xl font-bold font-mono ${totalPayable > 0 ? 'text-rose-800' : 'text-emerald-700'}`}>
              {totalPayable > 0 ? formatCurrency(totalPayable) : 'Settled'}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">{unpaidPOs.length} unpaid bill(s)</p>
          </div>
          {canRecordPayment && totalPayable > 0 && (
            <button
              onClick={() => setIsPayOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-xs"
            >
              <Wallet className="h-4 w-4" />
              <span>Record Payment</span>
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Purchase bills */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Purchase Bills (POs)</p>
              {outstandingPOs.length > 0 && (
                <span className="text-[11px] font-bold text-rose-700">
                  {outstandingPOs.length} unpaid · {formatCurrency(totalPayable)} owed
                </span>
              )}
            </div>
            {vendorPOs.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">No purchase orders for this supplier.</p>
            ) : (
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[11px] tracking-wider">
                      <th className="py-2 px-3">PO No</th>
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3 text-right">Total</th>
                      <th className="py-2 px-3 text-right">Paid</th>
                      <th className="py-2 px-3 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {vendorPOs.map((po) => {
                      const debit = poDebit(po);
                      const bal = poBalance(po);
                      return (
                        <tr key={po.id} className={`hover:bg-slate-50/70 ${bal > 0.5 ? 'bg-rose-50/30' : ''}`}>
                          <td className="py-2 px-3 font-mono font-bold text-blue-700">{po.poNumber}</td>
                          <td className="py-2 px-3 text-slate-600">{po.date}</td>
                          <td className="py-2 px-3 text-right font-mono text-slate-800">{formatCurrency(po.totalAmount || 0)}</td>
                          <td className="py-2 px-3 text-right font-mono text-emerald-700">
                            {formatCurrency(po.amountPaid || 0)}
                            {debit > 0 && (
                              <div className="text-[10px] font-medium text-slate-400" title="Debit note billed back to the supplier">
                                −{formatCurrency(debit)} debit
                              </div>
                            )}
                          </td>
                          <td className={`py-2 px-3 text-right font-mono font-bold ${bal > 0.5 ? 'text-rose-700' : 'text-slate-400'}`}>
                            {bal > 0.5 ? formatCurrency(bal) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {totalPayable > 0.5 && (
                    <tfoot>
                      <tr className="bg-rose-50/60 border-t border-rose-100 text-rose-800 font-bold">
                        <td className="py-2 px-3 uppercase text-[11px] tracking-wider" colSpan={4}>
                          Total Remaining ({outstandingPOs.length} PO{outstandingPOs.length === 1 ? '' : 's'})
                        </td>
                        <td className="py-2 px-3 text-right font-mono">{formatCurrency(totalPayable)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </div>

          {/* Payments made */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Payments Made</p>
            {vendorPayments.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">No payments recorded yet.</p>
            ) : (
              <div className="space-y-1.5">
                {vendorPayments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl border border-slate-200 bg-white">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] font-bold text-slate-700">{p.receiptNumber}</span>
                        <span className="text-[11px] text-slate-400">{p.date} · {p.paymentMode}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 truncate">
                        {p.reference ? `Ref: ${p.reference}` : ''}
                        {p.allocations && p.allocations.length ? ` · ${p.allocations.length} bill(s)` : ' · advance'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono font-bold text-rose-700 text-sm">{formatCurrency(p.amount)}</span>
                      {canRecordPayment && (
                        <button
                          onClick={() => { if (confirm(`Delete payment ${p.receiptNumber}? This restores the bill balances.`)) deletePayment(p.id); }}
                          title="Delete payment"
                          className="p-1 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {vendorPOs.length === 0 && vendorPayments.length === 0 && (
            <div className="py-8 text-center text-slate-400">
              <ShoppingBag className="h-8 w-8 mx-auto text-slate-300 mb-2" />
              <p className="text-xs">No transactions with this supplier yet.</p>
            </div>
          )}
        </div>
      </div>

      {isPayOpen && (
        <RecordPaymentModal
          isOpen={isPayOpen}
          onClose={() => setIsPayOpen(false)}
          type="out"
          partyType="vendor"
          partyId={vendor.id}
          partyName={vendor.vendorName}
          branchId={currentBranch && currentBranch !== 'all' ? currentBranch : 'erode-hq'}
          outstanding={unpaidPOs}
        />
      )}
    </div>
  );
};
