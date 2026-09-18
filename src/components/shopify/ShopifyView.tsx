import React, { useEffect, useState, useCallback } from 'react';
import {
  ShoppingCart,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  DownloadCloud,
  Link2,
  Store,
  PackageCheck,
  XCircle,
  TrendingUp,
  Receipt,
  Boxes,
} from 'lucide-react';
import { apiGet, apiPost } from '../../lib/api';
import { useErp } from '../../context/ErpContext';
import { formatCurrency } from '../../lib/utils';
import { toast } from 'sonner';

interface Status {
  configured: boolean;
  connected: boolean;
  shop?: { name?: string; myshopifyDomain?: string; currency?: string; country?: string; plan?: string };
  error?: string;
}
interface OrderLine { sku: string; title: string; qty: number; price: number; matched: boolean; itemName?: string }
interface OrderPreview {
  externalOrderId: string;
  orderName: string;
  date: string;
  customerName: string;
  total: number;
  financialStatus: string;
  alreadyImported: boolean;
  lines: OrderLine[];
  unmatchedCount: number;
}

export const ShopifyView: React.FC = () => {
  const { invoices, activeSubTab } = useErp();
  const [status, setStatus] = useState<Status | null>(null);
  const [orders, setOrders] = useState<OrderPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importingProducts, setImportingProducts] = useState(false);

  // Online sales metrics from already-imported orders (local, no API call).
  const month = new Date().toISOString().slice(0, 7);
  const online = invoices.filter((i) => i.sourceChannel === 'shopify' && !i.isVoided);
  const onlineRevenue = online.reduce((s, i) => s + (i.grandTotal || 0), 0);
  const onlineThisMonth = online.filter((i) => (i.date || '').startsWith(month));
  const avgOrder = online.length ? onlineRevenue / online.length : 0;

  const handleImportProducts = async () => {
    setImportingProducts(true);
    try {
      const res = await apiPost<{ created: number; skipped: number }>('/api/shopify/import-products', { limit: 100 });
      toast.success(`Imported ${res.created} product(s)`, { description: res.skipped ? `${res.skipped} already existed / no SKU` : 'Added to Items by SKU' });
    } catch (e: any) {
      toast.error('Product import failed', { description: e?.message });
    } finally {
      setImportingProducts(false);
    }
  };

  // Synchronize actions when triggered from secondary navbar flyout
  useEffect(() => {
    if (activeSubTab?.view === 'shopify') {
      const tab = activeSubTab.tab;
      if (tab === 'import-products') {
        handleImportProducts();
      }
    }
  }, [activeSubTab]);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const s = await apiGet<Status>('/api/shopify/status');
      setStatus(s);
      if (s.connected) await loadOrders();
    } catch (e: any) {
      setStatus({ configured: false, connected: false, error: e?.message });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOrders = async () => {
    setSyncing(true);
    try {
      const res = await apiGet<{ configured: boolean; orders: OrderPreview[] }>('/api/shopify/orders?limit=50');
      setOrders(res.orders || []);
    } catch (e: any) {
      toast.error('Could not fetch Shopify orders', { description: e?.message });
    } finally {
      setSyncing(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const res = await apiPost<{ imported: number; skipped: number }>('/api/shopify/import', { limit: 50 });
      toast.success(`Imported ${res.imported} order(s)`, {
        description: res.skipped ? `${res.skipped} already imported` : 'Added to Sales as online orders',
      });
      await loadOrders();
    } catch (e: any) {
      toast.error('Import failed', { description: e?.message });
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const newCount = orders.filter((o) => !o.alreadyImported && o.financialStatus === 'paid').length;

  return (
    <div className="p-4 sm:p-6 space-y-6 w-full">
      {/* Header */}
      <div>
        <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Online Store</h1>
        <p className="text-xs text-slate-500 mt-0.5">Sync your Shopify orders into Sales, matched by item code (SKU).</p>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-400">
          Checking Shopify connection…
        </div>
      ) : !status?.configured ? (
        <SetupGuide />
      ) : !status.connected ? (
        <div className="bg-white rounded-xl border border-rose-200 shadow-xs p-5">
          <div className="flex items-center gap-2 text-rose-700 font-bold text-sm">
            <XCircle className="h-5 w-5" /> Not connected
          </div>
          <p className="text-xs text-slate-500 mt-1">{status.error || 'Shopify rejected the credentials. Check the Admin API access token and store domain.'}</p>
          <button onClick={loadStatus} className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold">
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      ) : (
        <>
          {/* Connected banner + actions */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200/60 flex items-center justify-center">
                <Store className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-slate-900">{status.shop?.name || 'Shopify Store'}</p>
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <CheckCircle2 className="h-3 w-3" /> Connected
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {status.shop?.myshopifyDomain} • {status.shop?.currency} • {status.shop?.plan}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={loadOrders} disabled={syncing} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold disabled:opacity-50">
                <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} /> Refresh
              </button>
              <button
                onClick={handleImport}
                disabled={importing || newCount === 0}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <DownloadCloud className={`h-4 w-4 ${importing ? 'animate-pulse' : ''}`} />
                {importing ? 'Importing…' : `Import ${newCount || ''} new order${newCount === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>

          {/* Online sales metrics (from imported orders) */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard icon={<ShoppingCart className="h-5 w-5" />} tone="emerald" label="Online Orders" value={String(online.length)} />
            <MetricCard icon={<Receipt className="h-5 w-5" />} tone="blue" label="Online Revenue" value={formatCurrency(onlineRevenue)} />
            <MetricCard icon={<TrendingUp className="h-5 w-5" />} tone="purple" label="This Month" value={`${onlineThisMonth.length} • ${formatCurrency(onlineThisMonth.reduce((s, i) => s + (i.grandTotal || 0), 0))}`} />
            <MetricCard icon={<Receipt className="h-5 w-5" />} tone="slate" label="Avg Order" value={formatCurrency(avgOrder)} />
          </div>

          {/* Product sync */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-700 border border-blue-200/60 flex items-center justify-center">
                <Boxes className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">Product Catalog</p>
                <p className="text-[11px] text-slate-500">Import Shopify products as ERP items (by SKU). Existing item codes are skipped.</p>
              </div>
            </div>
            <button
              onClick={handleImportProducts}
              disabled={importingProducts}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs disabled:opacity-50"
            >
              <DownloadCloud className={`h-4 w-4 ${importingProducts ? 'animate-pulse' : ''}`} />
              {importingProducts ? 'Importing…' : 'Import Products'}
            </button>
          </div>

          {/* Orders table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <PackageCheck className="h-4 w-4 text-emerald-600" />
              <h3 className="text-sm font-bold text-slate-800">Recent Orders ({orders.length})</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[11px] tracking-wider">
                    <th className="py-3 px-4">Order</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Customer</th>
                    <th className="py-3 px-4">Items (matched)</th>
                    <th className="py-3 px-4 text-right">Total</th>
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {orders.length === 0 ? (
                    <tr><td colSpan={6} className="py-10 text-center text-slate-400 text-xs">No orders found. Click Refresh to pull from Shopify.</td></tr>
                  ) : (
                    orders.map((o) => (
                      <tr key={o.externalOrderId} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4 font-mono font-bold text-slate-700">{o.orderName}</td>
                        <td className="py-3 px-4 text-slate-600">{o.date}</td>
                        <td className="py-3 px-4 font-semibold text-slate-800">{o.customerName}</td>
                        <td className="py-3 px-4">
                          <span className={o.unmatchedCount > 0 ? 'text-amber-700' : 'text-emerald-700'}>
                            {o.lines.length - o.unmatchedCount}/{o.lines.length} by SKU
                          </span>
                          {o.unmatchedCount > 0 && (
                            <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-amber-700" title="Some SKUs don't match an item code">
                              <AlertTriangle className="h-3 w-3" />{o.unmatchedCount} unmatched
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">{formatCurrency(o.total)}</td>
                        <td className="py-3 px-4 text-center">
                          {o.alreadyImported ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                              <CheckCircle2 className="h-3 w-3" /> Imported
                            </span>
                          ) : o.financialStatus === 'paid' ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Ready</span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">{o.financialStatus}</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-[11px] text-slate-400">
            Imported orders appear in <strong>Sales</strong> tagged as online. Stock is not auto-decremented in this version — reconcile inventory separately.
          </p>
        </>
      )}
    </div>
  );
};

const TONES: Record<string, string> = {
  emerald: 'bg-emerald-50 text-emerald-600 border-emerald-200/60',
  blue: 'bg-blue-50 text-blue-600 border-blue-200/60',
  purple: 'bg-purple-50 text-purple-600 border-purple-200/60',
  slate: 'bg-slate-100 text-slate-600 border-slate-200',
};
const MetricCard: React.FC<{ icon: React.ReactNode; tone: string; label: string; value: string }> = ({ icon, tone, label, value }) => (
  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex items-center gap-3">
    <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 border ${TONES[tone] || TONES.slate}`}>{icon}</div>
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 truncate">{label}</p>
      <p className="text-base font-bold text-slate-900 truncate">{value}</p>
    </div>
  </div>
);

const SetupGuide: React.FC = () => (
  <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-3">
    <div className="flex items-center gap-2 text-slate-800 font-bold text-sm">
      <Link2 className="h-5 w-5 text-blue-600" /> Connect your Shopify store
    </div>
    <p className="text-xs text-slate-500">
      Shopify isn't configured yet. In Railway (backend service → Variables), set:
    </p>
    <pre className="text-[11px] bg-slate-900 text-slate-100 rounded-xl p-3 overflow-x-auto">
{`SHOPIFY_STORE_DOMAIN = your-store.myshopify.com
SHOPIFY_ADMIN_TOKEN  = shpat_…   (Admin API access token)
SHOPIFY_API_SECRET   = shpss_…   (API secret key)
SHOPIFY_BRANCH_ID    = erode-hq  (optional: branch for online sales)`}
    </pre>
    <p className="text-[11px] text-slate-400">
      Get the Admin API access token from Shopify admin → Settings → Apps and sales channels → Develop apps → your app →
      API credentials. Grant scopes: read_orders, read_products. Then reload this page.
    </p>
  </div>
);
