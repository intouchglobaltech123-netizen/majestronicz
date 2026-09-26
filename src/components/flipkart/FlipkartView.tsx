import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, AlertTriangle, CheckCircle2, Store, ExternalLink, Info } from 'lucide-react';
import { apiGet } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';

/**
 * Flipkart marketplace view.
 *
 * Deliberately read-only for now: the seller account's Developer Access is
 * still "Pending" approval, so no call can succeed yet and nothing should be
 * written into stock or invoices on the strength of data we have never seen.
 * What this screen does do is make the connection state legible — the failure
 * mode to avoid is a blank page that leaves "is it broken or just not approved
 * yet?" unanswered.
 */

type FlipkartFailure = 'not_configured' | 'pending_approval' | 'bad_credentials' | 'network' | 'unknown';

interface FlipkartStatus {
  configured: boolean;
  connected: boolean;
  appId?: string;
  branchId?: string;
  error?: string;
  reason?: FlipkartFailure;
}

interface FlipkartOrder {
  orderId: string;
  orderItemId: string;
  shipmentId?: string;
  sku?: string;
  title?: string;
  quantity: number;
  price?: number;
  status?: string;
  orderDate?: string;
}

export const FlipkartView: React.FC = () => {
  const [status, setStatus] = useState<FlipkartStatus | null>(null);
  const [orders, setOrders] = useState<FlipkartOrder[]>([]);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const st = await apiGet<FlipkartStatus>('/api/flipkart/status');
      setStatus(st);
      if (st.connected) {
        const res = await apiGet<{ orders: FlipkartOrder[]; error?: string }>('/api/flipkart/orders?limit=50');
        setOrders(res.orders || []);
        setOrdersError(res.error || null);
      } else {
        setOrders([]);
        setOrdersError(null);
      }
    } catch (e: any) {
      setStatus({ configured: false, connected: false, error: e?.message || 'Could not reach the server.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The server classifies the failure, because Flipkart's 401 means two very
  // different things: waiting on their approval (nothing to do here) versus a
  // wrong Application ID (ours to fix). Telling them apart is the difference
  // between "wait" and "go and change a setting".
  const reason = status?.reason;
  const pendingApproval = reason === 'pending_approval';

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="h-9 w-9 bg-amber-100 border border-amber-200 flex items-center justify-center">
            <Store className="h-4.5 w-4.5 text-amber-700" />
          </span>
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-tight">Flipkart</h1>
            <p className="text-xs text-slate-500">Seller Hub orders awaiting dispatch</p>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 text-xs font-bold text-slate-700 hover:border-slate-400 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Connection state */}
      {status && (
        <div
          className={`p-4 border ${
            status.connected
              ? 'bg-emerald-50 border-emerald-200'
              : pendingApproval
                ? 'bg-amber-50 border-amber-200'
                : 'bg-rose-50 border-rose-200'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {status.connected ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
            ) : pendingApproval ? (
              <Info className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-rose-600 mt-0.5 shrink-0" />
            )}
            <div className="min-w-0">
              <p
                className={`text-sm font-bold ${
                  status.connected ? 'text-emerald-800' : pendingApproval ? 'text-amber-800' : 'text-rose-800'
                }`}
              >
                {status.connected
                  ? 'Connected to Flipkart'
                  : pendingApproval
                    ? 'Waiting for Flipkart to approve the developer access'
                    : status.configured
                      ? 'Flipkart rejected the connection'
                      : 'Flipkart is not configured'}
              </p>
              {status.error && <p className="text-xs text-slate-600 mt-1">{status.error}</p>}
              {pendingApproval && (
                <p className="text-xs text-slate-600 mt-1.5">
                  The credentials are saved and working on our side. Flipkart shows this access as{' '}
                  <span className="font-semibold">Pending</span> — orders will appear here automatically once it
                  becomes <span className="font-semibold">Active</span>, with no further changes needed.
                  <a
                    href="https://seller.flipkart.com/index.html#dashboard/developer-access"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 ml-1 text-amber-800 underline hover:no-underline"
                  >
                    Check status <ExternalLink className="h-3 w-3" />
                  </a>
                </p>
              )}
              {status.configured && (
                <p className="text-[11px] text-slate-500 mt-1.5 font-mono">
                  App {status.appId} · orders post to branch {status.branchId}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Orders */}
      {status?.connected && (
        <div className="bg-white border border-slate-200">
          <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Orders to dispatch</h2>
            <span className="text-xs text-slate-500">{orders.length} item{orders.length === 1 ? '' : 's'}</span>
          </div>

          {ordersError ? (
            <p className="px-4 py-6 text-sm text-rose-700">{ordersError}</p>
          ) : orders.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500">No orders waiting to be dispatched.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="py-2.5 px-4 text-left">Order</th>
                    <th className="py-2.5 px-3 text-left">Product</th>
                    <th className="py-2.5 px-3 text-left">SKU</th>
                    <th className="py-2.5 px-3 text-center">Qty</th>
                    <th className="py-2.5 px-3 text-right">Price</th>
                    <th className="py-2.5 px-3 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {orders.map((o) => (
                    <tr key={`${o.orderItemId}-${o.shipmentId ?? ''}`} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-mono text-xs text-slate-700">
                        {o.orderId}
                        {o.orderDate && (
                          <span className="block text-[11px] text-slate-400">{o.orderDate.split('T')[0]}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-800">{o.title || '—'}</td>
                      <td className="py-2.5 px-3 font-mono text-xs text-slate-600">{o.sku || '—'}</td>
                      <td className="py-2.5 px-3 text-center font-semibold text-slate-800">{o.quantity}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-800">
                        {o.price != null ? formatCurrency(o.price) : '—'}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-[11px] font-bold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5">
                          {o.status || 'APPROVED'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
