import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ShoppingCart,
  Boxes,
  Package,
  Users,
  Settings,
  CheckCircle2,
  RefreshCw,
  DownloadCloud,
  Store,
  XCircle,
  TrendingUp,
  Receipt,
  Search,
  Truck,
  Eye,
} from 'lucide-react';
import { apiGet, apiPost } from '../../lib/api';
import { useErp } from '../../context/ErpContext';
import { formatCurrency } from '../../lib/utils';
import { toast } from 'sonner';
import { ShopifyOrder, ShopifyShopStatus } from '../../types/shopify';
import { ShopifyOrderDetailModal } from './ShopifyOrderDetailModal';
import { ShopifyInventorySyncTab } from './ShopifyInventorySyncTab';
import { ShopifyProductsTab } from './ShopifyProductsTab';
import { ShopifyCustomersTab } from './ShopifyCustomersTab';
import { ShopifySettingsTab } from './ShopifySettingsTab';

export type ShopifyTab = 'orders' | 'inventory' | 'products' | 'customers' | 'settings';

export const ShopifyView: React.FC = () => {
  const { invoices, activeSubTab, navigateToTab, setCurrentView } = useErp();
  const [activeTab, setActiveTab] = useState<ShopifyTab>('orders');
  const [status, setStatus] = useState<ShopifyShopStatus | null>(null);
  const [orders, setOrders] = useState<ShopifyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingOrders, setSyncingOrders] = useState(false);
  const [importingOrders, setImportingOrders] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<ShopifyOrder | null>(null);

  // Filter state for orders tab
  const [orderSearch, setOrderSearch] = useState('');
  const [financialFilter, setFinancialFilter] = useState<'all' | 'paid' | 'pending' | 'refunded'>('all');
  const [fulfillmentFilter, setFulfillmentFilter] = useState<'all' | 'unfulfilled' | 'fulfilled' | 'partial'>('all');
  const [importFilter, setImportFilter] = useState<'all' | 'ready' | 'imported'>('all');

  // Sync tab with sidebar sub-menu navigation
  useEffect(() => {
    if (activeSubTab?.view === 'shopify' && activeSubTab.tab) {
      const target = activeSubTab.tab as ShopifyTab;
      if (['orders', 'inventory', 'products', 'customers', 'settings'].includes(target)) {
        setActiveTab(target);
      }
    }
  }, [activeSubTab]);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const s = await apiGet<ShopifyShopStatus>('/api/shopify/status');
      setStatus(s);
      if (s.connected) {
        await loadOrders();
      }
    } catch (e: any) {
      setStatus({ configured: false, connected: false, error: e?.message });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOrders = async () => {
    setSyncingOrders(true);
    try {
      const res = await apiGet<{ configured: boolean; orders: ShopifyOrder[] }>('/api/shopify/orders?limit=100');
      setOrders(res.orders || []);
    } catch (e: any) {
      toast.error('Could not fetch Shopify orders', { description: e?.message });
    } finally {
      setSyncingOrders(false);
    }
  };

  const handleImportOrders = async () => {
    setImportingOrders(true);
    try {
      const res = await apiPost<{ imported: number; skipped: number }>('/api/shopify/import', { limit: 50 });
      if (res.imported > 0) {
        toast.success(`Imported ${res.imported} order(s) into ERP Sales`, {
          description: res.skipped ? `${res.skipped} already imported` : 'Created sales invoices and linked customer parties',
        });
      } else {
        toast.info('No new paid orders to import', {
          description: res.skipped ? 'All paid Shopify orders are already imported.' : 'No eligible paid orders found.',
        });
      }
      await loadOrders();
    } catch (e: any) {
      toast.error('Order import failed', { description: e?.message });
    } finally {
      setImportingOrders(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Real calculations
  const onlineInvoices = useMemo(
    () => invoices.filter((i) => i.sourceChannel === 'shopify' && !i.isVoided),
    [invoices]
  );
  const totalImportedRevenue = useMemo(
    () => onlineInvoices.reduce((sum, inv) => sum + (inv.grandTotal || 0), 0),
    [onlineInvoices]
  );
  const readyToImportCount = useMemo(
    () => orders.filter((o) => !o.alreadyImported && o.financialStatus === 'paid').length,
    [orders]
  );
  const unfulfilledCount = useMemo(
    () => orders.filter((o) => o.fulfillmentStatus !== 'fulfilled').length,
    [orders]
  );

  // Filtered orders list
  const filteredOrders = useMemo(() => {
    const q = orderSearch.toLowerCase().trim();
    return orders.filter((o) => {
      if (financialFilter !== 'all' && o.financialStatus !== financialFilter) return false;
      if (fulfillmentFilter !== 'all') {
        if (fulfillmentFilter === 'unfulfilled' && o.fulfillmentStatus === 'fulfilled') return false;
        if (fulfillmentFilter === 'fulfilled' && o.fulfillmentStatus !== 'fulfilled') return false;
        if (fulfillmentFilter === 'partial' && o.fulfillmentStatus !== 'partial') return false;
      }
      if (importFilter === 'ready' && (o.alreadyImported || o.financialStatus !== 'paid')) return false;
      if (importFilter === 'imported' && !o.alreadyImported) return false;

      if (!q) return true;
      return (
        o.orderName.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        (o.customerPhone && o.customerPhone.includes(q)) ||
        (o.customerEmail && o.customerEmail.toLowerCase().includes(q)) ||
        o.lines.some((l) => l.sku.toLowerCase().includes(q) || l.title.toLowerCase().includes(q))
      );
    });
  }, [orders, orderSearch, financialFilter, fulfillmentFilter, importFilter]);

  const handleOpenLinkedInvoice = (_invoiceId: string) => {
    setSelectedOrder(null);
    setCurrentView('invoices');
    navigateToTab('invoices', 'ledger');
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 w-full max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 bg-red-600 text-white flex items-center justify-center font-bold">
              <Store className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-slate-900 tracking-tight uppercase flex items-center gap-2">
                <span>Online Store</span>
                <span className="text-slate-400 font-normal">|</span>
                <span className="text-sm font-semibold text-slate-600 font-mono">
                  {status?.shop?.name || 'Shopify'}
                </span>
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Real-time Shopify orders, live stock reconciliation, product catalog & online customer directory
              </p>
            </div>
          </div>
        </div>

        {/* Connection status badge & quick refresh */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {loading ? (
            <span className="text-xs text-slate-400 flex items-center gap-1.5 bg-slate-100 px-3 py-1.5 border border-slate-200">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Checking store…
            </span>
          ) : status?.connected ? (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-300">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                {status.shop?.myshopifyDomain || 'Connected'}
              </span>
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 bg-rose-50 text-rose-700 border border-rose-300">
              <XCircle className="h-3.5 w-3.5" /> Disconnected
            </span>
          )}
        </div>
      </div>

      {/* Main Tab Navigation */}
      <div className="flex items-center gap-1 border-b border-slate-300 bg-white px-2 pt-2 overflow-x-auto">
        <TabButton
          active={activeTab === 'orders'}
          label="Orders & Shipments"
          icon={<ShoppingCart className="h-4 w-4" />}
          badge={unfulfilledCount > 0 ? `${unfulfilledCount} open` : undefined}
          badgeColor="red"
          onClick={() => setActiveTab('orders')}
        />
        <TabButton
          active={activeTab === 'inventory'}
          label="Stock & Inventory Sync"
          icon={<Boxes className="h-4 w-4" />}
          onClick={() => setActiveTab('inventory')}
        />
        <TabButton
          active={activeTab === 'products'}
          label="Product Catalog"
          icon={<Package className="h-4 w-4" />}
          onClick={() => setActiveTab('products')}
        />
        <TabButton
          active={activeTab === 'customers'}
          label="Online Customers"
          icon={<Users className="h-4 w-4" />}
          onClick={() => setActiveTab('customers')}
        />
        <TabButton
          active={activeTab === 'settings'}
          label="Connection & Settings"
          icon={<Settings className="h-4 w-4" />}
          onClick={() => setActiveTab('settings')}
        />
      </div>

      {/* Tab Contents */}
      {activeTab === 'orders' && (
        <div className="space-y-5">
          {/* Metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white p-4 border border-slate-300 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Shopify Orders</span>
                <ShoppingCart className="h-4 w-4 text-slate-400" />
              </div>
              <div className="text-xl font-extrabold text-slate-900 mt-2 font-mono">{orders.length}</div>
              <p className="text-[10px] text-slate-400 mt-0.5">Recent orders retrieved</p>
            </div>

            <div className="bg-white p-4 border border-emerald-300 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Ready to Import</span>
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="text-xl font-extrabold text-emerald-700 mt-2 font-mono">{readyToImportCount}</div>
              <p className="text-[10px] text-emerald-600/80 mt-0.5">Paid & ready for Sales invoice</p>
            </div>

            <div className="bg-white p-4 border border-blue-300 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700">Imported to ERP</span>
                <Receipt className="h-4 w-4 text-blue-600" />
              </div>
              <div className="text-xl font-extrabold text-blue-800 mt-2 font-mono">{onlineInvoices.length}</div>
              <p className="text-[10px] text-blue-600/80 mt-0.5">Active ERP sales invoices</p>
            </div>

            <div className="bg-white p-4 border border-slate-300 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Imported Revenue</span>
                <TrendingUp className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="text-xl font-extrabold text-slate-900 mt-2 font-mono">{formatCurrency(totalImportedRevenue)}</div>
              <p className="text-[10px] text-slate-400 mt-0.5">Total online sales in ERP</p>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="bg-white border border-slate-300 shadow-xs p-4 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
            <div className="flex flex-1 flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  placeholder="Search order #, customer, phone, SKU..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-none focus:bg-white focus:outline-none focus:ring-1 focus:ring-red-600 text-slate-900"
                />
              </div>

              {/* Filters */}
              <div className="flex items-center gap-2">
                <select
                  value={financialFilter}
                  onChange={(e: any) => setFinancialFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 text-slate-700 font-semibold cursor-pointer"
                >
                  <option value="all">Payment: All</option>
                  <option value="paid">Paid</option>
                  <option value="pending">Pending</option>
                  <option value="refunded">Refunded</option>
                </select>

                <select
                  value={fulfillmentFilter}
                  onChange={(e: any) => setFulfillmentFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 text-slate-700 font-semibold cursor-pointer"
                >
                  <option value="all">Fulfillment: All</option>
                  <option value="unfulfilled">Unfulfilled / Open</option>
                  <option value="fulfilled">Fulfilled</option>
                </select>

                <select
                  value={importFilter}
                  onChange={(e: any) => setImportFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 text-slate-700 font-semibold cursor-pointer"
                >
                  <option value="all">ERP Sync: All</option>
                  <option value="ready">Ready to Import</option>
                  <option value="imported">Already in ERP</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={loadOrders}
                disabled={syncingOrders}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-none bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-xs font-bold disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncingOrders ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                onClick={handleImportOrders}
                disabled={importingOrders || readyToImportCount === 0}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-none bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-xs font-bold uppercase tracking-wider shadow-none border border-red-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <DownloadCloud className={`h-4 w-4 ${importingOrders ? 'animate-pulse' : ''}`} />
                {importingOrders ? 'Importing…' : `Import ${readyToImportCount || ''} Paid Orders`}
              </button>
            </div>
          </div>

          {/* Orders Table */}
          <div className="bg-white border border-slate-300 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-bold uppercase text-[11px] tracking-wider">
                    <th className="py-3 px-4">Order</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Customer</th>
                    <th className="py-3 px-4">Items & Stock</th>
                    <th className="py-3 px-4 text-right">Total</th>
                    <th className="py-3 px-4 text-center">Payment</th>
                    <th className="py-3 px-4 text-center">Fulfillment</th>
                    <th className="py-3 px-4 text-center">ERP Status</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {syncingOrders ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400">
                        <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-slate-400" />
                        Fetching live orders from Shopify…
                      </td>
                    </tr>
                  ) : filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400">
                        No orders found matching the selected filters.
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map((order) => {
                      const isFulfilled = order.fulfillmentStatus === 'fulfilled';
                      const isPaid = order.financialStatus === 'paid';

                      return (
                        <tr
                          key={order.externalOrderId}
                          onClick={() => setSelectedOrder(order)}
                          className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                        >
                          <td className="py-3 px-4">
                            <div className="font-mono font-extrabold text-slate-900 flex items-center gap-1.5">
                              <span>{order.orderName}</span>
                            </div>
                            <span className="text-[10px] text-slate-400 font-mono block">
                              ID: {order.externalOrderId}
                            </span>
                          </td>

                          <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                            {order.date}
                          </td>

                          <td className="py-3 px-4">
                            <div className="font-semibold text-slate-900">{order.customerName}</div>
                            {order.customerPhone && (
                              <div className="text-[11px] text-slate-500 font-mono">{order.customerPhone}</div>
                            )}
                          </td>

                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1">
                              <span
                                className={`text-[11px] font-bold ${
                                  order.unmatchedCount > 0 ? 'text-amber-700' : 'text-slate-800'
                                }`}
                              >
                                {order.lines.length} item{order.lines.length === 1 ? '' : 's'}
                              </span>
                              {order.unmatchedCount > 0 && (
                                <span className="text-[10px] text-amber-700 bg-amber-50 px-1 border border-amber-200 font-semibold">
                                  {order.unmatchedCount} unlinked
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400 truncate max-w-[200px]">
                              {order.lines.map((l) => `${l.qty}x ${l.sku || l.title}`).join(', ')}
                            </div>
                          </td>

                          <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 whitespace-nowrap">
                            {formatCurrency(order.total)}
                          </td>

                          <td className="py-3 px-4 text-center">
                            {isPaid ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-300">
                                Paid
                              </span>
                            ) : order.financialStatus === 'refunded' ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-rose-50 text-rose-700 border border-rose-300">
                                Refunded
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-300 capitalize">
                                {order.financialStatus}
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-4 text-center">
                            {isFulfilled ? (
                              <div>
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-300">
                                  <Truck className="h-3 w-3" /> Fulfilled
                                </span>
                                {order.trackingNumber && (
                                  <span className="block text-[10px] font-mono text-slate-500 mt-0.5">
                                    {order.trackingCompany || 'AWB'}: {order.trackingNumber}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-300">
                                Unfulfilled
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-4 text-center">
                            {order.alreadyImported ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-700 border border-slate-300">
                                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                                {order.linkedInvoiceNumber || 'Imported'}
                              </span>
                            ) : isPaid ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-300">
                                Ready
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400 font-semibold">
                                Pending Payment
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedOrder(order);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 cursor-pointer"
                            >
                              <Eye className="h-3 w-3" />
                              View
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'inventory' && <ShopifyInventorySyncTab />}
      {activeTab === 'products' && <ShopifyProductsTab />}
      {activeTab === 'customers' && <ShopifyCustomersTab />}
      {activeTab === 'settings' && <ShopifySettingsTab status={status} onRefresh={loadStatus} />}

      {/* Detailed Order Modal */}
      {selectedOrder && (
        <ShopifyOrderDetailModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onOrderUpdated={() => {
            loadOrders();
            loadStatus();
          }}
          onOpenInvoice={handleOpenLinkedInvoice}
        />
      )}
    </div>
  );
};

interface TabButtonProps {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  badge?: string;
  badgeColor?: 'red' | 'slate';
  onClick: () => void;
}

const TabButton: React.FC<TabButtonProps> = ({ active, label, icon, badge, badgeColor, onClick }) => (
  <button
    onClick={onClick}
    className={`px-4 py-2.5 text-xs font-bold flex items-center gap-2 border-b-2 transition-colors shrink-0 cursor-pointer ${
      active
        ? 'border-red-600 text-red-600 bg-red-50/20'
        : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
    }`}
  >
    {icon}
    <span>{label}</span>
    {badge && (
      <span
        className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold uppercase tracking-wider ${
          badgeColor === 'red'
            ? 'bg-red-100 text-red-700 border border-red-300'
            : 'bg-slate-100 text-slate-700 border border-slate-300'
        }`}
      >
        {badge}
      </span>
    )}
  </button>
);
