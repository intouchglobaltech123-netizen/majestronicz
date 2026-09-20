import React, { useState } from 'react';
import { ShopifyOrder, ShopifyOrderLineItem } from '../../types/shopify';
import { formatCurrency, cleanPhoneDigits } from '../../lib/utils';
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
  Copy,
  MessageSquare,
  Sparkles,
} from 'lucide-react';
import { apiPost } from '../../lib/api';
import { toast } from 'sonner';
import { ShopifySimilarProductsModal } from './ShopifySimilarProductsModal';

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

  // Similar products search modal state
  const [similarItemTarget, setSimilarItemTarget] = useState<ShopifyOrderLineItem | null>(null);

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

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`Copied ${label} to clipboard`);
  };

  const fullShippingAddressString = order.shippingAddress
    ? [
        order.shippingAddress.name || order.customerName,
        order.shippingAddress.address1,
        order.shippingAddress.address2,
        order.shippingAddress.city,
        order.shippingAddress.province,
        order.shippingAddress.zip,
        order.shippingAddress.country || 'India',
        order.shippingAddress.phone || order.customerPhone,
      ]
        .filter(Boolean)
        .join(', ')
    : '';

  // WhatsApp quick notification link
  const rawPhone = order.customerPhone || order.shippingAddress?.phone || '';
  const digits = cleanPhoneDigits(rawPhone);
  const phoneForWhatsApp = digits.length === 10 ? `91${digits}` : digits;

  const waMessage = order.trackingNumber
    ? `Hello ${order.customerName}, your Majestronicz order ${order.orderName} has been dispatched via ${order.trackingCompany || carrier} with AWB Tracking: ${order.trackingNumber}. Thank you for shopping with us!`
    : `Hello ${order.customerName}, greetings from Majestronicz! Your order ${order.orderName} (Total: ${formatCurrency(order.total)}) is confirmed and currently being packed for dispatch.`;

  const waUrl = phoneForWhatsApp
    ? `https://wa.me/${phoneForWhatsApp}?text=${encodeURIComponent(waMessage)}`
    : '';

  const isCod =
    (order.paymentGateway || '').toLowerCase().includes('cod') ||
    (order.paymentGateway || '').toLowerCase().includes('cash on delivery');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl max-h-[92vh] bg-white border border-slate-300 shadow-2xl flex flex-col overflow-hidden text-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-300 bg-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-red-600 text-white flex items-center justify-center font-bold">
              <Store className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-extrabold font-mono text-slate-900">
                  {order.orderName}
                </h2>
                <span className="text-xs text-slate-400">•</span>
                <span className="text-xs text-slate-600 font-mono">
                  {order.date} {order.createdAt ? order.createdAt.slice(11, 16) : ''}
                </span>

                {isCod ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 uppercase">
                    Cash On Delivery (COD)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-300 uppercase">
                    Prepaid ({order.paymentGateway || 'Online'})
                  </span>
                )}

                {order.alreadyImported ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-800 border border-slate-300">
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                    ERP Invoice: {order.linkedInvoiceNumber || 'Imported'}
                  </span>
                ) : (
                  <span className="text-[10px] font-bold px-2 py-0.5 bg-blue-50 text-blue-800 border border-blue-300">
                    Pending ERP Invoice
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                <span>
                  Shopify Order ID: <strong className="font-mono text-slate-700">{order.externalOrderId}</strong>
                </span>
                {order.shopifyOrderUrl && (
                  <>
                    <span>•</span>
                    <a
                      href={order.shopifyOrderUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:text-blue-800 font-semibold inline-flex items-center gap-0.5"
                    >
                      <span>Open in Shopify Admin</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPackingSlip((s) => !s)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 transition-colors cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5 text-slate-600" />
              <span>{showPackingSlip ? 'Standard View' : 'Packing Slip'}</span>
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
            <div className="space-y-5 border border-slate-300 p-6 bg-white font-sans">
              <div className="flex items-start justify-between border-b border-slate-300 pb-4">
                <div>
                  <h1 className="text-xl font-extrabold uppercase tracking-wide text-slate-900">
                    MAJESTRONICZ
                  </h1>
                  <p className="text-xs text-slate-600 font-semibold">Warehouse Dispatch & Packing Slip</p>
                  <p className="text-xs text-slate-500 font-mono mt-1">
                    Order Ref: <strong>{order.orderName}</strong> • Date: {order.date}
                  </p>
                </div>
                <div className="text-right text-xs">
                  <p className="font-bold text-slate-800">Dispatch Hub: Erode HQ</p>
                  <p className="text-slate-600">Carrier: {order.trackingCompany || carrier}</p>
                  <p className="font-mono text-slate-800 font-bold">
                    AWB: {order.trackingNumber || 'Pending'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-xs border border-slate-200 p-3 bg-slate-50">
                <div>
                  <p className="font-bold uppercase text-[10px] text-slate-500 mb-1">Shipping To</p>
                  <p className="font-bold text-slate-900">{order.shippingAddress?.name || order.customerName}</p>
                  <p>{order.shippingAddress?.address1}</p>
                  {order.shippingAddress?.address2 && <p>{order.shippingAddress?.address2}</p>}
                  <p>
                    {order.shippingAddress?.city}, {order.shippingAddress?.province}{' '}
                    {order.shippingAddress?.zip ? `- ${order.shippingAddress?.zip}` : ''}
                  </p>
                  <p className="font-mono text-slate-700">Tel: {order.shippingAddress?.phone || order.customerPhone}</p>
                </div>
                <div>
                  <p className="font-bold uppercase text-[10px] text-slate-500 mb-1">Order Details</p>
                  <p>Payment: <strong className="uppercase">{order.paymentGateway || 'Online'}</strong></p>
                  <p>Total Items: <strong>{order.lines.length} lines</strong></p>
                  <p>Grand Total: <strong className="font-mono">{formatCurrency(order.total)}</strong></p>
                  {order.note && <p className="text-amber-800 font-medium mt-1">Note: {order.note}</p>}
                </div>
              </div>

              <table className="w-full text-xs border border-slate-300 border-collapse">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-300 font-bold text-slate-700 uppercase text-[11px]">
                    <th className="p-2.5 text-center border-r border-slate-300 w-12">#</th>
                    <th className="p-2.5 text-left border-r border-slate-300">Item & Description</th>
                    <th className="p-2.5 text-left border-r border-slate-300">SKU Code</th>
                    <th className="p-2.5 text-center border-r border-slate-300 w-16">Qty</th>
                    <th className="p-2.5 text-right w-24">Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {order.lines.map((li, idx) => (
                    <tr key={li.id || idx}>
                      <td className="p-2.5 border-r border-slate-300 text-center font-mono">
                        {idx + 1}
                      </td>
                      <td className="p-2.5 border-r border-slate-300">
                        <div className="flex items-center gap-2.5">
                          {li.imageUrl && (
                            <img
                              src={li.imageUrl}
                              alt={li.title}
                              className="h-9 w-9 object-cover border border-slate-200 bg-slate-50 shrink-0"
                            />
                          )}
                          <div>
                            <span className="font-bold text-slate-900">{li.title}</span>
                            {li.variantTitle && (
                              <span className="text-slate-500 block text-[11px] font-mono">{li.variantTitle}</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="p-2.5 border-r border-slate-300 font-mono font-semibold text-slate-700">
                        {li.sku || '—'}
                      </td>
                      <td className="p-2.5 border-r border-slate-300 text-center font-bold font-mono text-sm">
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
                  <span>Print Slip</span>
                </button>
              </div>
            </div>
          ) : (
            /* Standard Complete Order View */
            <>
              {/* Customer & Address Overview Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Customer Dossier */}
                <div className="p-3.5 bg-slate-50 border border-slate-200 space-y-2.5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-700">
                        <User className="h-3.5 w-3.5 text-red-600" />
                        <span>Customer Profile</span>
                      </div>
                      {phoneForWhatsApp && (
                        <a
                          href={waUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-0.5 transition-colors cursor-pointer"
                          title="Chat with customer on WhatsApp"
                        >
                          <MessageSquare className="h-3 w-3" />
                          <span>WhatsApp</span>
                        </a>
                      )}
                    </div>
                    <div className="text-xs space-y-1.5 mt-2">
                      <p className="font-bold text-slate-900 text-sm">{order.customerName}</p>
                      {order.customerPhone && (
                        <div className="flex items-center justify-between text-slate-600 font-mono">
                          <span className="flex items-center gap-1.5">
                            <Phone className="h-3 w-3 text-slate-400" />
                            <span>{order.customerPhone}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(order.customerPhone!, 'Phone number')}
                            className="text-[10px] text-slate-400 hover:text-slate-700 cursor-pointer"
                            title="Copy Phone"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                      {order.customerEmail && (
                        <div className="flex items-center justify-between text-slate-600">
                          <span className="flex items-center gap-1.5 truncate max-w-[200px]">
                            <Mail className="h-3 w-3 text-slate-400 shrink-0" />
                            <span className="truncate">{order.customerEmail}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(order.customerEmail!, 'Email address')}
                            className="text-[10px] text-slate-400 hover:text-slate-700 cursor-pointer shrink-0 ml-1"
                            title="Copy Email"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {order.note && (
                    <div className="mt-2 p-2 bg-amber-50 border border-amber-200 text-amber-900 text-[11px] rounded-none">
                      <strong className="block text-[10px] uppercase font-bold text-amber-700">Customer Note:</strong>
                      {order.note}
                    </div>
                  )}
                </div>

                {/* Shipping Address */}
                <div className="p-3.5 bg-slate-50 border border-slate-200 space-y-2 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-700">
                        <MapPin className="h-3.5 w-3.5 text-blue-600" />
                        <span>Shipping Destination</span>
                      </div>
                      {fullShippingAddressString && (
                        <button
                          type="button"
                          onClick={() => copyToClipboard(fullShippingAddressString, 'Full address')}
                          className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 px-1.5 py-0.5 cursor-pointer"
                          title="Copy Full Address"
                        >
                          <Copy className="h-2.5 w-2.5" />
                          <span>Copy</span>
                        </button>
                      )}
                    </div>
                    <div className="text-xs space-y-0.5 text-slate-700 mt-2">
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

                  {order.shippingAddress?.zip && (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullShippingAddressString)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-blue-600 hover:text-blue-800 font-semibold inline-flex items-center gap-1 mt-2"
                    >
                      <span>Locate on Google Maps</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>

                {/* Financial & Payment Summary */}
                <div className="p-3.5 bg-slate-50 border border-slate-200 space-y-2 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-700">
                      <Receipt className="h-3.5 w-3.5 text-emerald-600" />
                      <span>Payment Breakdown</span>
                    </div>

                    <div className="text-xs space-y-1 mt-2">
                      <div className="flex justify-between text-slate-600">
                        <span>Items Subtotal:</span>
                        <span className="font-mono font-semibold">{formatCurrency(order.subtotal || order.total)}</span>
                      </div>
                      {order.discount !== undefined && order.discount > 0 && (
                        <div className="flex justify-between text-emerald-700">
                          <span>
                            Discount {order.discountCodes ? `(${order.discountCodes})` : ''}:
                          </span>
                          <span className="font-mono font-semibold">-{formatCurrency(order.discount)}</span>
                        </div>
                      )}
                      {order.shippingFee !== undefined && order.shippingFee > 0 && (
                        <div className="flex justify-between text-slate-600">
                          <span>Shipping ({order.shippingMethod || 'Standard'}):</span>
                          <span className="font-mono font-semibold">{formatCurrency(order.shippingFee)}</span>
                        </div>
                      )}
                      {order.tax !== undefined && order.tax > 0 && (
                        <div className="flex justify-between text-slate-600">
                          <span>Taxes / GST:</span>
                          <span className="font-mono font-semibold">{formatCurrency(order.tax)}</span>
                        </div>
                      )}

                      <div className="flex justify-between border-t border-slate-200 pt-1.5 mt-1 font-extrabold text-sm">
                        <span>Total Paid / Due:</span>
                        <span className="font-mono text-slate-900">{formatCurrency(order.total)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">Gateway:</span>
                    <span className="font-bold text-slate-800">{order.paymentGateway || 'Online'}</span>
                  </div>
                </div>
              </div>

              {/* Line Items Table with Images & Live ERP Stock */}
              <div className="border border-slate-300 bg-white overflow-hidden shadow-xs">
                <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-300 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-slate-700" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                      Ordered Line Items ({order.lines.length})
                    </h3>
                  </div>
                  <span className="text-[11px] text-slate-500">
                    Live branch stock reconciliation matching by SKU
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-300 font-bold text-slate-700 uppercase text-[11px] tracking-wider">
                        <th className="py-2.5 px-3">Item / Product</th>
                        <th className="py-2.5 px-3">SKU Code</th>
                        <th className="py-2.5 px-3 text-center">Qty Ordered</th>
                        <th className="py-2.5 px-3 text-right">Price</th>
                        <th className="py-2.5 px-3 text-right">Total</th>
                        <th className="py-2.5 px-3 text-center">ERP Match</th>
                        <th className="py-2.5 px-3 text-center">ERP On-Hand Stock</th>
                        <th className="py-2.5 px-3 text-right">Alternative</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {order.lines.map((li, i) => {
                        const inStock = li.erpStockOnHand !== undefined && li.erpStockOnHand >= li.qty;
                        const lowStock = li.erpStockOnHand !== undefined && li.erpStockOnHand > 0 && li.erpStockOnHand < li.qty;

                        return (
                          <tr key={li.id || i} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-2.5 px-3">
                              <div className="flex items-start gap-3">
                                {/* Product Image Thumbnail */}
                                {li.imageUrl ? (
                                  <img
                                    src={li.imageUrl}
                                    alt={li.title}
                                    className="h-12 w-12 object-cover border border-slate-200 bg-slate-50 shrink-0"
                                    onError={(e) => {
                                      (e.target as HTMLElement).style.display = 'none';
                                    }}
                                  />
                                ) : (
                                  <div className="h-12 w-12 border border-slate-200 bg-slate-100 text-slate-400 flex items-center justify-center shrink-0">
                                    <Package className="h-5 w-5" />
                                  </div>
                                )}

                                <div className="min-w-0">
                                  <p className="font-bold text-slate-900">{li.title}</p>
                                  {li.variantTitle && (
                                    <span className="text-[11px] text-slate-500 font-mono block">
                                      Option: {li.variantTitle}
                                    </span>
                                  )}
                                  {li.vendor && (
                                    <span className="text-[10px] text-slate-400 block">
                                      Brand: {li.vendor}
                                    </span>
                                  )}
                                  {li.properties && li.properties.length > 0 && (
                                    <div className="mt-1 space-y-0.5">
                                      {li.properties.map((p, pIdx) => (
                                        <span key={pIdx} className="inline-block text-[10px] bg-slate-100 text-slate-700 px-1 border border-slate-200 mr-1">
                                          {p.name}: {p.value}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>

                            <td className="py-2.5 px-3 font-mono font-bold text-slate-800">
                              <span className="bg-slate-100 px-2 py-0.5 border border-slate-200">
                                {li.sku || 'No SKU'}
                              </span>
                            </td>

                            <td className="py-2.5 px-3 text-center font-bold font-mono text-sm">
                              {li.qty}
                            </td>

                            <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                              {formatCurrency(li.price)}
                              {li.discount ? (
                                <span className="block text-[10px] text-emerald-700">
                                  Disc: -{formatCurrency(li.discount)}
                                </span>
                              ) : null}
                            </td>

                            <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                              {formatCurrency(li.price * li.qty - (li.discount || 0))}
                            </td>

                            <td className="py-2.5 px-3 text-center">
                              {li.matched ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-300">
                                  <CheckCircle2 className="h-3 w-3" /> Matched
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-300">
                                  <AlertTriangle className="h-3 w-3" /> Unlinked
                                </span>
                              )}
                            </td>

                            <td className="py-2.5 px-3 text-center font-mono">
                              {li.erpStockOnHand !== undefined ? (
                                <span
                                  className={`font-bold px-2 py-0.5 text-[11px] border ${
                                    inStock
                                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                      : lowStock
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

                            <td className="py-2.5 px-3 text-right">
                              <button
                                type="button"
                                onClick={() => setSimilarItemTarget(li)}
                                className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 cursor-pointer"
                                title="Search similar / alternate items in ERP"
                              >
                                <Sparkles className="h-3 w-3 text-amber-600" />
                                <span>Similar Items</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
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
                      Courier Logistics & Dispatch
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
                    Fulfillment Status: {order.fulfillmentStatus}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                      Shipping Courier Partner
                    </label>
                    <select
                      value={carrier}
                      onChange={(e) => setCarrier(e.target.value)}
                      className="w-full h-8 px-2.5 text-xs bg-white border border-slate-300 rounded-none font-bold"
                    >
                      <option value="Delhivery">Delhivery Surface / Express</option>
                      <option value="BlueDart">Blue Dart Express</option>
                      <option value="DTDC">DTDC Courier</option>
                      <option value="India Post">India Post Speed Post</option>
                      <option value="Shiprocket">Shiprocket Logistics</option>
                      <option value="Shadowfax">Shadowfax Technologies</option>
                      <option value="Xpressbees">Xpressbees Logistics</option>
                      <option value="Ekart">Ekart Logistics</option>
                      <option value="Ecom Express">Ecom Express</option>
                      <option value="Local Courier">Local Store Dispatch</option>
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
                        placeholder="e.g. DEL-9821039812 or 123456789"
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
                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600 flex-wrap gap-2">
                    <div className="flex items-center gap-1.5">
                      <span>Active Tracking:</span>
                      <strong className="font-mono text-slate-900">
                        {order.trackingCompany || 'Carrier'}: {order.trackingNumber}
                      </strong>
                    </div>

                    {order.trackingUrl && (
                      <a
                        href={order.trackingUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline inline-flex items-center gap-1 font-semibold"
                      >
                        <span>Open Live Tracking URL</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
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

      {/* Similar / Alternate Products Modal */}
      {similarItemTarget && (
        <ShopifySimilarProductsModal
          sourceItemTitle={similarItemTarget.title}
          sourceItemSku={similarItemTarget.sku}
          category={similarItemTarget.itemName}
          isOpen={Boolean(similarItemTarget)}
          onClose={() => setSimilarItemTarget(null)}
        />
      )}
    </div>
  );
};
