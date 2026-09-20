import React, { useState } from 'react';
import { ShopifyOrder } from '../../types/shopify';
import { formatCurrency } from '../../lib/utils';
import {
  X,
  Store,
  CheckCircle2,
  AlertTriangle,
  Truck,
  MapPin,
  User,
  Phone,
  Mail,
  Receipt,
  Printer,
  ExternalLink,
  Package,
  Send,
} from 'lucide-react';
import { apiPost } from '../../lib/api';
import { toast } from 'sonner';

interface Props {
  order: ShopifyOrder | null;
  onClose: () => void;
  onOrderUpdated?: () => void;
  onOpenInvoice?: (invoiceId: string) => void;
}

export const ShopifyOrderDetailModal: React.FC<Props> = ({
  order,
  onClose,
  onOrderUpdated,
  onOpenInvoice,
}) => {
  const [carrier, setCarrier] = useState<string>(order?.trackingCompany || 'Delhivery');
  const [trackingNumber, setTrackingNumber] = useState<string>(order?.trackingNumber || '');
  const [fulfilling, setFulfilling] = useState(false);
  const [showPackingSlip, setShowPackingSlip] = useState(false);

  if (!order) return null;

  const handleFulfill = async () => {
    if (!trackingNumber.trim()) {
      toast.error('Please enter a tracking / AWB number');
      return;
    }
    setFulfilling(true);
    try {
      await apiPost(`/api/shopify/orders/${order.externalOrderId}/fulfill`, {
        carrier,
        trackingNumber: trackingNumber.trim(),
      });
      toast.success(`Order ${order.orderName} fulfilled on Shopify`, {
        description: `Tracking ${trackingNumber.trim()} via ${carrier}`,
      });
      onOrderUpdated?.();
    } catch (e: any) {
      toast.error('Fulfillment update failed', { description: e?.message });
    } finally {
      setFulfilling(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl max-h-[90vh] bg-white border border-slate-300 shadow-2xl flex flex-col overflow-hidden text-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-300 bg-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 bg-emerald-50 border border-emerald-300 flex items-center justify-center text-emerald-700">
              <Store className="h-4.5 w-4.5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-extrabold font-mono text-slate-900">
                  {order.orderName}
                </h2>
                <span className="text-xs text-slate-500">•</span>
                <span className="text-xs text-slate-600 font-mono">
                  {order.date} {order.createdAt ? order.createdAt.slice(11, 16) : ''}
                </span>
                {order.alreadyImported ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-700 border border-slate-300">
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                    ERP Invoice: {order.linkedInvoiceNumber || 'Imported'}
                  </span>
                ) : (
                  <span className="text-[10px] font-bold px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-300">
                    Pending ERP Import
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Shopify Order ID: <span className="font-mono">{order.externalOrderId}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPackingSlip((s) => !s)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 transition-colors cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5 text-slate-600" />
              <span>{showPackingSlip ? 'Order View' : 'Packing Slip'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer"
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5">
          {showPackingSlip ? (
            /* Printable Packing Slip View */
            <div className="space-y-4 border border-slate-300 p-6 bg-white font-sans">
              <div className="flex items-start justify-between border-b border-slate-300 pb-4">
                <div>
                  <h1 className="text-xl font-extrabold uppercase tracking-wide text-slate-900">
                    MAJESTRONICZ
                  </h1>
                  <p className="text-xs text-slate-600">Packing Slip & Dispatch Memo</p>
                  <p className="text-xs text-slate-500 font-mono mt-1">
                    Order Ref: <strong>{order.orderName}</strong> • Date: {order.date}
                  </p>
                </div>
                <div className="text-right text-xs">
                  <p className="font-bold text-slate-800">Dispatch Hub: Erode HQ</p>
                  <p className="text-slate-500">Carrier: {order.trackingCompany || carrier}</p>
                  <p className="font-mono text-slate-700 font-bold">
                    AWB: {order.trackingNumber || 'Pending'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="p-3 bg-slate-50 border border-slate-200">
                  <p className="font-bold uppercase tracking-wider text-slate-500 text-[10px] mb-1">
                    Ship To
                  </p>
                  <p className="font-bold text-slate-900">{order.customerName}</p>
                  <p className="text-slate-600 mt-0.5">
                    {order.shippingAddress?.address1 || 'Address not provided'}
                    {order.shippingAddress?.address2 ? `, ${order.shippingAddress.address2}` : ''}
                  </p>
                  <p className="text-slate-600">
                    {order.shippingAddress?.city}, {order.shippingAddress?.province} - {order.shippingAddress?.zip}
                  </p>
                  <p className="text-slate-700 font-mono mt-1 font-bold">
                    Phone: {order.customerPhone || order.shippingAddress?.phone || '—'}
                  </p>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200">
                  <p className="font-bold uppercase tracking-wider text-slate-500 text-[10px] mb-1">
                    Order & Payment Details
                  </p>
                  <p className="text-slate-700">
                    Payment Gateway: <strong>{order.paymentGateway || 'Online'}</strong>
                  </p>
                  <p className="text-slate-700">
                    Financial Status: <strong className="uppercase">{order.financialStatus}</strong>
                  </p>
                  <p className="text-slate-700">
                    Fulfillment Status: <strong className="uppercase">{order.fulfillmentStatus}</strong>
                  </p>
                  {order.note && (
                    <p className="text-amber-800 bg-amber-50 p-1.5 mt-1 border border-amber-200 text-[11px]">
                      Note: {order.note}
                    </p>
                  )}
                </div>
              </div>

              {/* Items for Packing */}
              <table className="w-full text-left text-xs border-collapse border border-slate-300">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-300 font-bold text-slate-800 uppercase text-[11px]">
                    <th className="p-2.5 border-r border-slate-300">#</th>
                    <th className="p-2.5 border-r border-slate-300">Item Description</th>
                    <th className="p-2.5 border-r border-slate-300">SKU / Code</th>
                    <th className="p-2.5 text-center border-r border-slate-300">Qty</th>
                    <th className="p-2.5 text-right">Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {order.lines.map((li, idx) => (
                    <tr key={li.id || idx}>
                      <td className="p-2.5 border-r border-slate-300 text-center font-mono">
                        {idx + 1}
                      </td>
                      <td className="p-2.5 border-r border-slate-300">
                        <span className="font-bold text-slate-900">{li.title}</span>
                        {li.variantTitle && (
                          <span className="text-slate-500 block text-[11px]">{li.variantTitle}</span>
                        )}
                      </td>
                      <td className="p-2.5 border-r border-slate-300 font-mono text-slate-700">
                        {li.sku || '—'}
                      </td>
                      <td className="p-2.5 border-r border-slate-300 text-center font-bold font-mono">
                        {li.qty}
                      </td>
                      <td className="p-2.5 text-right font-mono text-slate-900">
                        {formatCurrency(li.price * li.qty)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={handlePrint}
                  className="px-4 py-2 bg-slate-900 hover:bg-black text-white font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="h-4 w-4" />
                  <span>Print Slip (Ctrl+P)</span>
                </button>
              </div>
            </div>
          ) : (
            /* Standard Complete Order View */
            <>
              {/* Customer & Address Overview Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Customer Dossier */}
                <div className="p-3.5 bg-slate-50 border border-slate-200 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-700">
                    <User className="h-3.5 w-3.5 text-red-600" />
                    <span>Customer Profile</span>
                  </div>
                  <div className="text-xs space-y-1">
                    <p className="font-bold text-slate-900 text-sm">{order.customerName}</p>
                    {order.customerPhone && (
                      <p className="text-slate-600 flex items-center gap-1.5 font-mono">
                        <Phone className="h-3 w-3 text-slate-400" />
                        <span>{order.customerPhone}</span>
                      </p>
                    )}
                    {order.customerEmail && (
                      <p className="text-slate-600 flex items-center gap-1.5">
                        <Mail className="h-3 w-3 text-slate-400" />
                        <span className="truncate">{order.customerEmail}</span>
                      </p>
                    )}
                  </div>
                </div>

                {/* Shipping Address */}
                <div className="p-3.5 bg-slate-50 border border-slate-200 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-700">
                    <MapPin className="h-3.5 w-3.5 text-blue-600" />
                    <span>Shipping Destination</span>
                  </div>
                  <div className="text-xs space-y-0.5 text-slate-700">
                    {order.shippingAddress ? (
                      <>
                        <p className="font-bold text-slate-900">{order.shippingAddress.name || order.customerName}</p>
                        <p>{order.shippingAddress.address1}</p>
                        {order.shippingAddress.address2 && <p>{order.shippingAddress.address2}</p>}
                        <p>
                          {order.shippingAddress.city}, {order.shippingAddress.province}{' '}
                          {order.shippingAddress.zip ? `- ${order.shippingAddress.zip}` : ''}
                        </p>
                        <p>{order.shippingAddress.country || 'India'}</p>
                      </>
                    ) : (
                      <p className="text-slate-400 italic">No separate shipping address provided</p>
                    )}
                  </div>
                </div>

                {/* Financial & Payment Summary */}
                <div className="p-3.5 bg-slate-50 border border-slate-200 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-700">
                    <Receipt className="h-3.5 w-3.5 text-emerald-600" />
                    <span>Payment & Billing</span>
                  </div>
                  <div className="text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Method:</span>
                      <span className="font-bold text-slate-900">{order.paymentGateway || 'Online'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Financial:</span>
                      <span
                        className={`font-bold uppercase text-[11px] px-1.5 py-0.2 ${
                          order.financialStatus === 'paid'
                            ? 'bg-emerald-100 text-emerald-800'
                            : order.financialStatus === 'refunded'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {order.financialStatus}
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-slate-200 pt-1 mt-1 font-bold">
                      <span>Order Total:</span>
                      <span className="font-mono text-slate-900">{formatCurrency(order.total)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Line Items Table with Live ERP Stock Levels */}
              <div className="border border-slate-300 bg-white overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-300 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-slate-700" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                      Ordered Line Items ({order.lines.length})
                    </h3>
                  </div>
                  <span className="text-[11px] text-slate-500">
                    Stock matched against ERP inventory by SKU
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-300 font-bold text-slate-700 uppercase text-[11px] tracking-wider">
                        <th className="py-2.5 px-3">Item / SKU</th>
                        <th className="py-2.5 px-3 text-center">Qty Ordered</th>
                        <th className="py-2.5 px-3 text-right">Price</th>
                        <th className="py-2.5 px-3 text-right">Total</th>
                        <th className="py-2.5 px-3 text-center">ERP Match Status</th>
                        <th className="py-2.5 px-3 text-center">ERP Stock Available</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {order.lines.map((li, i) => (
                        <tr key={li.id || i} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3">
                            <p className="font-bold text-slate-900">{li.title}</p>
                            <p className="font-mono text-[11px] text-slate-500">
                              SKU: {li.sku || 'No SKU'}
                              {li.variantTitle ? ` • ${li.variantTitle}` : ''}
                            </p>
                          </td>
                          <td className="py-2.5 px-3 text-center font-bold font-mono">
                            {li.qty}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                            {formatCurrency(li.price)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                            {formatCurrency(li.price * li.qty)}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            {li.matched ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-300">
                                <CheckCircle2 className="h-3 w-3" /> Matched
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-300">
                                <AlertTriangle className="h-3 w-3" /> Unlinked SKU
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono">
                            {li.erpStockOnHand !== undefined ? (
                              <span
                                className={`font-bold px-2 py-0.5 text-[11px] border ${
                                  li.erpStockOnHand >= li.qty
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                    : li.erpStockOnHand > 0
                                    ? 'bg-amber-50 text-amber-800 border-amber-300'
                                    : 'bg-rose-50 text-rose-800 border-rose-300'
                                }`}
                              >
                                {li.erpStockOnHand} in Stock
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Fulfillment & Shipping Update Section */}
              <div className="border border-slate-300 p-4 bg-slate-50 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Truck className="h-4 w-4 text-slate-700" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                      Logistics & Fulfillment
                    </h3>
                  </div>
                  <span
                    className={`text-xs font-bold px-2 py-0.5 uppercase border ${
                      order.fulfillmentStatus === 'fulfilled'
                        ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                        : order.fulfillmentStatus === 'in_transit'
                        ? 'bg-blue-100 text-blue-800 border-blue-300'
                        : 'bg-amber-100 text-amber-800 border-amber-300'
                    }`}
                  >
                    Status: {order.fulfillmentStatus}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                      Shipping Carrier
                    </label>
                    <select
                      value={carrier}
                      onChange={(e) => setCarrier(e.target.value)}
                      className="w-full h-8 px-2.5 text-xs bg-white border border-slate-300 rounded-none font-bold"
                    >
                      <option value="Delhivery">Delhivery Surface / Express</option>
                      <option value="BlueDart">BlueDart Apex</option>
                      <option value="DTDC">DTDC Express</option>
                      <option value="India Post">India Post Speed Post</option>
                      <option value="Shadowfax">Shadowfax Logistics</option>
                      <option value="Local Courier">Direct / Local Courier</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                      Tracking / AWB Number
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={trackingNumber}
                        onChange={(e) => setTrackingNumber(e.target.value)}
                        placeholder="e.g. DEL-9821039812"
                        className="flex-1 h-8 px-2.5 text-xs bg-white border border-slate-300 rounded-none font-mono"
                      />
                      <button
                        type="button"
                        onClick={handleFulfill}
                        disabled={fulfilling}
                        className="h-8 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer border border-emerald-700 disabled:opacity-50"
                      >
                        <Send className="h-3.5 w-3.5" />
                        <span>{fulfilling ? 'Updating…' : 'Update Shopify'}</span>
                      </button>
                    </div>
                  </div>
                </div>

                {order.trackingNumber && (
                  <p className="text-xs text-slate-600 flex items-center gap-1.5 pt-1">
                    <span>Active Tracking:</span>
                    <strong className="font-mono">{order.trackingCompany || 'Carrier'}: {order.trackingNumber}</strong>
                    {order.trackingUrl && (
                      <a
                        href={order.trackingUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline inline-flex items-center gap-0.5 ml-2"
                      >
                        <span>Track Online</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3 border-t border-slate-300 bg-slate-100 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-bold text-xs cursor-pointer"
          >
            Close
          </button>

          <div className="flex items-center gap-2">
            {order.linkedInvoiceId && onOpenInvoice && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenInvoice(order.linkedInvoiceId!);
                }}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs uppercase tracking-wider border border-slate-900 flex items-center gap-1.5 cursor-pointer"
              >
                <Receipt className="h-3.5 w-3.5" />
                <span>View ERP Invoice ({order.linkedInvoiceNumber})</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
