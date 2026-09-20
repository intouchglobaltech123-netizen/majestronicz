import React, { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  Copy,
  Zap,
  Store,
  Terminal,
} from 'lucide-react';
import { ShopifyShopStatus } from '../../types/shopify';
import { toast } from 'sonner';

interface Props {
  status: ShopifyShopStatus | null;
  onRefresh: () => Promise<void>;
}

export const ShopifySettingsTab: React.FC<Props> = ({ status, onRefresh }) => {
  const [testing, setTesting] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    try {
      await onRefresh();
      toast.success('Connection verified successfully');
    } catch (e: any) {
      toast.error('Connection test failed', { description: e?.message });
    } finally {
      setTesting(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`Copied ${label} to clipboard`);
  };

  const webhookUrl = `${window.location.origin}/api/shopify/webhook/orders`;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Current Connection Status */}
      <div className="bg-white border border-slate-300 shadow-xs p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3">
            <div className={`h-12 w-12 border flex items-center justify-center shrink-0 ${
              status?.connected
                ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                : 'bg-rose-50 text-rose-700 border-rose-300'
            }`}>
              <Store className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-extrabold text-slate-900">
                  {status?.shop?.name || 'Shopify Store'}
                </h3>
                {status?.connected ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-300">
                    <CheckCircle2 className="h-3 w-3" /> Connected & Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 bg-rose-50 text-rose-700 border border-rose-300">
                    <XCircle className="h-3 w-3" /> Offline / Disconnected
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 font-mono mt-0.5">
                {status?.shop?.myshopifyDomain || 'No domain configured'}
              </p>
            </div>
          </div>

          <button
            onClick={handleTest}
            disabled={testing}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-xs font-bold disabled:opacity-50 cursor-pointer self-start sm:self-auto"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${testing ? 'animate-spin' : ''}`} />
            {testing ? 'Testing Connection…' : 'Test Connection'}
          </button>
        </div>

        {status?.connected && status.shop && (
          <div className="mt-5 pt-4 border-t border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Currency</span>
              <span className="font-mono font-bold text-slate-800">{status.shop.currency || 'INR'}</span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Plan</span>
              <span className="font-semibold text-slate-800 capitalize">{status.shop.plan || 'Shopify'}</span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Country</span>
              <span className="font-semibold text-slate-800">{status.shop.country || 'India'}</span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Contact Email</span>
              <span className="font-mono text-slate-700 truncate block">{status.shop.email || 'N/A'}</span>
            </div>
          </div>
        )}

        {status?.error && (
          <div className="mt-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <XCircle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>{status.error}</span>
          </div>
        )}
      </div>

      {/* Railway & Backend Configuration */}
      <div className="bg-white border border-slate-300 shadow-xs p-5 space-y-4">
        <div className="flex items-center gap-2 text-slate-900 font-bold text-sm uppercase tracking-wide">
          <Terminal className="h-4 w-4 text-red-600" />
          Backend Environment Variables
        </div>
        <p className="text-xs text-slate-600">
          To connect your store or update credentials, set these variables in your deployment environment (Railway backend service &rarr; Variables, or backend <code className="bg-slate-100 px-1 py-0.5 border border-slate-200 font-mono">.env</code>):
        </p>

        <div className="relative">
          <pre className="text-xs bg-slate-900 text-slate-100 p-4 overflow-x-auto border border-slate-800 font-mono leading-relaxed">
{`SHOPIFY_STORE_DOMAIN = your-store.myshopify.com
SHOPIFY_ADMIN_TOKEN  = shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SHOPIFY_API_SECRET   = shpss_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SHOPIFY_BRANCH_ID    = erode-hq   # Branch where Shopify online sales are recorded`}
          </pre>
          <button
            onClick={() =>
              copyToClipboard(
                `SHOPIFY_STORE_DOMAIN=your-store.myshopify.com\nSHOPIFY_ADMIN_TOKEN=shpat_...\nSHOPIFY_API_SECRET=shpss_...\nSHOPIFY_BRANCH_ID=erode-hq`,
                'Environment Variables'
              )
            }
            className="absolute top-3 right-3 p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-semibold cursor-pointer flex items-center gap-1"
            title="Copy template"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
          </button>
        </div>

        <div className="space-y-2 text-xs text-slate-600">
          <div className="font-bold text-slate-800">Required Shopify Admin API Scopes:</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px]">
            <span className="p-1.5 bg-slate-50 border border-slate-200 text-slate-700">read_orders</span>
            <span className="p-1.5 bg-slate-50 border border-slate-200 text-slate-700">write_orders</span>
            <span className="p-1.5 bg-slate-50 border border-slate-200 text-slate-700">read_products</span>
            <span className="p-1.5 bg-slate-50 border border-slate-200 text-slate-700">write_products</span>
            <span className="p-1.5 bg-slate-50 border border-slate-200 text-slate-700">read_inventory</span>
            <span className="p-1.5 bg-slate-50 border border-slate-200 text-slate-700">write_inventory</span>
            <span className="p-1.5 bg-slate-50 border border-slate-200 text-slate-700">read_customers</span>
            <span className="p-1.5 bg-slate-50 border border-slate-200 text-slate-700">read_locations</span>
          </div>
        </div>
      </div>

      {/* Real-time Order Webhook Card */}
      <div className="bg-white border border-slate-300 shadow-xs p-5 space-y-4">
        <div className="flex items-center gap-2 text-slate-900 font-bold text-sm uppercase tracking-wide">
          <Zap className="h-4 w-4 text-amber-600" />
          Real-Time Order Webhook
        </div>
        <p className="text-xs text-slate-600">
          Configure a webhook in Shopify to automatically push orders into your ERP the moment a customer pays online:
        </p>

        <div className="space-y-2">
          <label className="text-[11px] font-bold text-slate-700 uppercase">Webhook Delivery URL</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={webhookUrl}
              className="flex-1 px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 text-slate-800 select-all"
            />
            <button
              onClick={() => copyToClipboard(webhookUrl, 'Webhook URL')}
              className="px-3 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-xs font-bold cursor-pointer flex items-center gap-1"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy
            </button>
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-200 p-4 space-y-2 text-xs text-slate-600">
          <p className="font-bold text-slate-800">How to register this in Shopify Admin:</p>
          <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-600">
            <li>Open Shopify Admin &rarr; <strong>Settings</strong> &rarr; <strong>Notifications</strong>.</li>
            <li>Scroll down to the <strong>Webhooks</strong> section and click <strong>Create webhook</strong>.</li>
            <li>Select Event: <strong>Order payment</strong> (or <strong>Order creation</strong>).</li>
            <li>Select Format: <strong>JSON</strong>.</li>
            <li>Paste the Delivery URL above and save.</li>
          </ol>
        </div>
      </div>
    </div>
  );
};
