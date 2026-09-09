import React, { useState, useMemo } from 'react';
import { Customer, Invoice, BRANCHES } from '../../types';
import { useErp } from '../../context/ErpContext';
import { isLoyaltyMilestoneEligible, getLoyaltyProgress } from '../../types/customer';
import { formatCurrency, cn } from '../../lib/utils';
import {
  X,
  Phone,
  MapPin,
  Calendar,
  Award,
  Sparkles,
  Receipt,
  FileText,
  ExternalLink,
  Edit2,
  Plus,
  Search,
  Building,
} from 'lucide-react';
import { InvoicePdfModal } from '../invoices/InvoicePdfModal';

interface CustomerDetailModalProps {
  customer: Customer | null;
  isOpen: boolean;
  onClose: () => void;
  onEditCustomer?: (customer: Customer) => void;
  onCreateSale?: (customer: Customer) => void;
}

export const CustomerDetailModal: React.FC<CustomerDetailModalProps> = ({
  customer,
  isOpen,
  onClose,
  onEditCustomer,
  onCreateSale,
}) => {
  const { invoices, loyaltySettings } = useErp();
  const [searchInvoiceQuery, setSearchInvoiceQuery] = useState('');
  const [selectedInvoiceForPdf, setSelectedInvoiceForPdf] = useState<Invoice | null>(null);

  // Filter this customer's invoices
  const customerInvoices = useMemo(() => {
    if (!customer) return [];
    const cleanPhone = (customer.phone || '').trim().replace(/\D/g, '');

    return invoices.filter((inv) => {
      if (inv.customerId && inv.customerId === customer.id) return true;
      if (cleanPhone && inv.customerPhone) {
        if (inv.customerPhone.trim().replace(/\D/g, '') === cleanPhone) return true;
      }
      if (customer.name && inv.customerName) {
        if (inv.customerName.trim().toLowerCase() === customer.name.trim().toLowerCase()) {
          return true;
        }
      }
      return false;
    });
  }, [invoices, customer]);

  // Filtered by search
  const filteredInvoices = useMemo(() => {
    if (!searchInvoiceQuery.trim()) return customerInvoices;
    const q = searchInvoiceQuery.toLowerCase().trim();
    return customerInvoices.filter(
      (inv) =>
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.paymentMode.toLowerCase().includes(q) ||
        inv.items.some((it) => it.itemName.toLowerCase().includes(q))
    );
  }, [customerInvoices, searchInvoiceQuery]);

  if (!isOpen || !customer) return null;

  const isEligible = isLoyaltyMilestoneEligible(customer, loyaltySettings);
  const progress = getLoyaltyProgress(customer, loyaltySettings);
  const nonVoidedInvoices = customerInvoices.filter((i) => !i.isVoided);
  const totalLifetimeSpent = nonVoidedInvoices.reduce((sum, i) => sum + i.grandTotal, 0);
  const avgOrderValue = nonVoidedInvoices.length > 0 ? Math.round(totalLifetimeSpent / nonVoidedInvoices.length) : 0;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
        <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
          {/* Header */}
          <div className="p-6 border-b border-slate-100 bg-slate-50/60 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center font-extrabold text-lg shadow-sm">
                {customer.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">
                    {customer.name}
                  </h2>
                  {isEligible ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-100 border border-amber-300 text-xs font-bold text-amber-900 animate-pulse">
                      <Sparkles className="h-3 w-3 text-amber-600" />
                      Milestone Reward Ready!
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                      <Award className="h-3 w-3 text-blue-600" />
                      {progress.label}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-4 text-xs text-slate-500 mt-1 flex-wrap">
                  <span className="flex items-center gap-1 font-mono font-semibold text-slate-700">
                    <Phone className="h-3.5 w-3.5 text-slate-400" />
                    {customer.phone}
                  </span>
                  {customer.address && (
                    <span className="flex items-center gap-1 text-slate-600">
                      <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span>{customer.address}</span>
                    </span>
                  )}
                  <span className="flex items-center gap-1 text-slate-400">
                    <Calendar className="h-3.5 w-3.5" />
                    Since {customer.firstPurchaseDate || 'N/A'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {onEditCustomer && (
                <button
                  type="button"
                  onClick={() => onEditCustomer(customer)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition-colors shadow-2xs"
                >
                  <Edit2 className="h-3.5 w-3.5 text-slate-500" />
                  <span>Edit</span>
                </button>
              )}
              {onCreateSale && (
                <button
                  type="button"
                  onClick={() => onCreateSale(customer)}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors shadow-xs"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>New Sale</span>
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Quick Metrics & Loyalty Card */}
          <div className="p-6 border-b border-slate-100 bg-white grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Purchase Count */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                Total Purchases
              </span>
              <div className="text-xl font-extrabold text-slate-900 mt-1">
                {customer.purchaseCount} <span className="text-xs text-slate-500 font-semibold">bills</span>
              </div>
              <span className="text-[11px] text-slate-400 mt-0.5 block">
                {nonVoidedInvoices.length} active invoices
              </span>
            </div>

            {/* Lifetime Revenue */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                Lifetime Revenue
              </span>
              <div className="text-xl font-extrabold text-slate-900 mt-1">
                {formatCurrency(totalLifetimeSpent)}
              </div>
              <span className="text-[11px] text-slate-400 mt-0.5 block">
                Avg order: {formatCurrency(avgOrderValue)}
              </span>
            </div>

            {/* Loyalty Milestone Status */}
            <div className="md:col-span-2 p-4 rounded-2xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/80 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-amber-600" />
                  <span className="text-xs font-bold text-amber-950 uppercase tracking-wider">
                    Loyalty Reward Engine
                  </span>
                </div>
                <span className="text-[11px] font-extrabold text-amber-900 bg-amber-200/70 px-2 py-0.5 rounded-full">
                  Every {loyaltySettings.purchaseThreshold} bills → {loyaltySettings.discountValue}
                  {loyaltySettings.discountType === 'percentage' ? '%' : '₹'} off
                </span>
              </div>

              <div className="space-y-1.5 mt-2">
                <div className="flex items-center justify-between text-xs font-semibold text-amber-900">
                  <span>Progress to Reward:</span>
                  <span className="font-bold">
                    {isEligible
                      ? '🎉 Milestone Ready to Redeem!'
                      : `${progress.currentCount} / ${progress.threshold} purchases (${progress.purchasesUntilNext} to next)`}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full h-2.5 bg-amber-200/70 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-300',
                      isEligible ? 'bg-amber-500 w-full animate-pulse' : 'bg-amber-600'
                    )}
                    style={{
                      width: isEligible
                        ? '100%'
                        : `${Math.min(100, (progress.currentCount / progress.threshold) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Notes Banner if present */}
          {customer.notes && (
            <div className="px-6 py-2.5 bg-amber-50/50 border-b border-amber-100 flex items-center gap-2 text-xs text-amber-900">
              <FileText className="h-4 w-4 text-amber-600 shrink-0" />
              <span className="font-semibold">Notes:</span>
              <span>{customer.notes}</span>
            </div>
          )}

          {/* Purchase History Ledger */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-blue-600" />
                  <span>Linked Purchase History ({customerInvoices.length})</span>
                </h3>
                <p className="text-xs text-slate-500">
                  Detailed ledger of all sales and items billed to this customer
                </p>
              </div>

              {/* Search Invoice Filter */}
              <div className="relative w-full sm:w-64">
                <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search invoice # or item..."
                  value={searchInvoiceQuery}
                  onChange={(e) => setSearchInvoiceQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600"
                />
              </div>
            </div>

            {/* Invoices Table */}
            {filteredInvoices.length > 0 ? (
              <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      <th className="p-3">Invoice #</th>
                      <th className="p-3">Date</th>
                      <th className="p-3">Branch</th>
                      <th className="p-3">Items Billed</th>
                      <th className="p-3">Payment</th>
                      <th className="p-3 text-right">Amount (₹)</th>
                      <th className="p-3 text-center">Reward</th>
                      <th className="p-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                    {filteredInvoices.map((inv) => {
                      const branch = BRANCHES.find((b) => b.id === inv.branchId);
                      return (
                        <tr
                          key={inv.id}
                          className={cn(
                            'hover:bg-slate-50/70 transition-colors',
                            inv.isVoided && 'bg-rose-50/40 opacity-75'
                          )}
                        >
                          {/* Invoice Number */}
                          <td className="p-3">
                            <button
                              type="button"
                              onClick={() => setSelectedInvoiceForPdf(inv)}
                              className="font-mono font-bold text-blue-600 hover:underline flex items-center gap-1"
                            >
                              <span>{inv.invoiceNumber}</span>
                              <ExternalLink className="h-3 w-3 opacity-60" />
                            </button>
                            {inv.isVoided && (
                              <span className="text-[10px] font-bold text-rose-600 bg-rose-100 px-1.5 py-0.2 rounded mt-0.5 inline-block">
                                Voided: {inv.voidReason}
                              </span>
                            )}
                          </td>

                          {/* Date */}
                          <td className="p-3 whitespace-nowrap text-slate-600">
                            {inv.date}
                            <span className="text-[10px] text-slate-400 block">{inv.time}</span>
                          </td>

                          {/* Branch */}
                          <td className="p-3">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[11px] font-medium">
                              <Building className="h-2.5 w-2.5 text-slate-400" />
                              {branch?.name || inv.branchId}
                            </span>
                          </td>

                          {/* Items Billed */}
                          <td className="p-3 max-w-xs truncate text-slate-600">
                            <span className="font-semibold text-slate-900">
                              {inv.items.length} item{inv.items.length > 1 ? 's' : ''}:
                            </span>{' '}
                            <span className="text-slate-500">
                              {inv.items.map((it) => `${it.itemName} (${it.quantity})`).join(', ')}
                            </span>
                          </td>

                          {/* Payment */}
                          <td className="p-3">
                            <span className="font-semibold text-slate-900">{inv.paymentMode}</span>
                            <span className="text-[10px] text-slate-400 block font-normal">
                              {inv.transactionType === 'Cash' ? 'Cash Sale' : 'Credit Bill'}
                            </span>
                          </td>

                          {/* Amount */}
                          <td className="p-3 text-right font-mono font-bold text-slate-900">
                            {formatCurrency(inv.grandTotal)}
                          </td>

                          {/* Loyalty Reward Flag */}
                          <td className="p-3 text-center">
                            {inv.isLoyaltyRewardApplied ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 border border-emerald-300 text-[10px] font-bold text-emerald-800">
                                <Sparkles className="h-2.5 w-2.5 text-emerald-600" />
                                Redeemed
                              </span>
                            ) : (
                              <span className="text-slate-300 text-xs">—</span>
                            )}
                          </td>

                          {/* Action */}
                          <td className="p-3 text-center">
                            <button
                              type="button"
                              onClick={() => setSelectedInvoiceForPdf(inv)}
                              className="px-2 py-1 text-[11px] font-semibold text-slate-600 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                              View Bill
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-12 text-center bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2">
                <Receipt className="h-8 w-8 text-slate-300 mx-auto" />
                <p className="text-xs font-semibold text-slate-600">
                  {searchInvoiceQuery
                    ? `No sales invoices matched "${searchInvoiceQuery}"`
                    : 'No sales recorded for this customer yet.'}
                </p>
                {onCreateSale && !searchInvoiceQuery && (
                  <button
                    type="button"
                    onClick={() => onCreateSale(customer)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors shadow-2xs mt-1"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Create First Bill</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Invoice PDF Modal */}
      <InvoicePdfModal
        invoice={selectedInvoiceForPdf}
        isOpen={Boolean(selectedInvoiceForPdf)}
        onClose={() => setSelectedInvoiceForPdf(null)}
      />
    </>
  );
};
