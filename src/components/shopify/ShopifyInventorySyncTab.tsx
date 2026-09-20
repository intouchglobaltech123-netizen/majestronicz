import React, { useEffect, useState, useMemo } from 'react';
import {
  RefreshCw,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Search,
  TrendingDown,
  Layers,
  Sparkles,
} from 'lucide-react';
import { apiGet, apiPost } from '../../lib/api';
import { ShopifyInventoryItem } from '../../types/shopify';
import { formatCurrency } from '../../lib/utils';
import { toast } from 'sonner';

export const ShopifyInventorySyncTab: React.FC = () => {
  const [items, setItems] = useState<ShopifyInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncingItemId, setSyncingItemId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'mismatch' | 'out_of_stock' | 'unlinked' | 'synced'>('all');

  const fetchInventory = async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ configured: boolean; items: ShopifyInventoryItem[] }>('/api/shopify/inventory?limit=150');
      setItems(res.items || []);
    } catch (e: any) {
      toast.error('Could not fetch Shopify inventory', { description: e?.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInventory();
  }, []);

  const counts = useMemo(() => {
    let synced = 0;
    let mismatch = 0;
    let outOfStock = 0;
    let unlinked = 0;
    for (const it of items) {
      if (it.status === 'synced') synced++;
      else if (it.status === 'mismatch') mismatch++;
      else if (it.status === 'out_of_stock') outOfStock++;
      else if (it.status === 'unlinked') unlinked++;
    }
    return { total: items.length, synced, mismatch, outOfStock, unlinked };
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return items.filter((it) => {
      if (statusFilter !== 'all' && it.status !== statusFilter) return false;
      if (!q) return true;
      return (
        it.sku.toLowerCase().includes(q) ||
        it.title.toLowerCase().includes(q) ||
        (it.variantTitle && it.variantTitle.toLowerCase().includes(q)) ||
        (it.erpItemName && it.erpItemName.toLowerCase().includes(q))
      );
    });
  }, [items, searchQuery, statusFilter]);

  const handleSyncSingle = async (item: ShopifyInventoryItem) => {
    if (!item.inventoryItemId) {
      toast.error('No inventory item ID found for this variant in Shopify');
      return;
    }
    setSyncingItemId(item.variantId);
    try {
      const res = await apiPost<{ success: boolean; error?: string }>('/api/shopify/inventory/sync', {
        inventoryItemId: item.inventoryItemId,
        availableQuantity: item.erpStockOnHand,
      });

      if (res.success) {
        toast.success(`Updated Shopify stock for SKU ${item.sku}`, {
          description: `Inventory level set to ${item.erpStockOnHand} units`,
        });
        setItems((prev) =>
          prev.map((it) =>
            it.variantId === item.variantId
              ? {
                  ...it,
                  shopifyInventory: it.erpStockOnHand,
                  status: it.erpStockOnHand === 0 ? 'out_of_stock' : 'synced',
                }
              : it
          )
        );
      } else {
        toast.error(`Sync failed for ${item.sku}`, { description: res.error });
      }
    } catch (e: any) {
      toast.error('Sync failed', { description: e?.message });
    } finally {
      setSyncingItemId(null);
    }
  };

  const handleSyncAll = async () => {
    if (counts.mismatch === 0) {
      toast.info('All matched products are already in sync!');
      return;
    }
    setSyncingAll(true);
    try {
      const res = await apiPost<{ updated: number; failed: number; errors: string[] }>('/api/shopify/inventory/sync-all', {});
      if (res.failed === 0) {
        toast.success(`Successfully synced ${res.updated} SKU(s) to Shopify`, {
          description: 'Shopify inventory matches ERP on-hand stocks',
        });
      } else {
        toast.warning(`Synced ${res.updated} SKU(s), ${res.failed} failed`, {
          description: res.errors.slice(0, 3).join(', '),
        });
      }
      await fetchInventory();
    } catch (e: any) {
      toast.error('Bulk inventory sync failed', { description: e?.message });
    } finally {
      setSyncingAll(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white p-4 border border-slate-300 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total Items</span>
            <Layers className="h-4 w-4 text-slate-500" />
          </div>
          <div className="text-xl font-extrabold text-slate-900 mt-2 font-mono">{counts.total}</div>
          <p className="text-[10px] text-slate-400 mt-0.5">Shopify variants</p>
        </div>

        <div className="bg-white p-4 border border-emerald-300 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">In Sync</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="text-xl font-extrabold text-emerald-700 mt-2 font-mono">{counts.synced}</div>
          <p className="text-[10px] text-emerald-600/80 mt-0.5">Stock matches 1:1</p>
        </div>

        <div className="bg-white p-4 border border-amber-300 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Discrepancy</span>
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </div>
          <div className="text-xl font-extrabold text-amber-700 mt-2 font-mono">{counts.mismatch}</div>
          <p className="text-[10px] text-amber-600/80 mt-0.5">Stock mismatch</p>
        </div>

        <div className="bg-white p-4 border border-rose-300 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-rose-700">Out of Stock</span>
            <TrendingDown className="h-4 w-4 text-rose-600" />
          </div>
          <div className="text-xl font-extrabold text-rose-700 mt-2 font-mono">{counts.outOfStock}</div>
          <p className="text-[10px] text-rose-600/80 mt-0.5">Zero stock both sides</p>
        </div>

        <div className="bg-white p-4 border border-slate-300 shadow-xs col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Unlinked</span>
            <HelpCircle className="h-4 w-4 text-slate-400" />
          </div>
          <div className="text-xl font-extrabold text-slate-700 mt-2 font-mono">{counts.unlinked}</div>
          <p className="text-[10px] text-slate-400 mt-0.5">SKU not in ERP</p>
        </div>
      </div>

      {/* Action Toolbar */}
      <div className="bg-white border border-slate-300 shadow-xs p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2 max-w-md">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by SKU, product name, or ERP item..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-none focus:bg-white focus:outline-none focus:ring-1 focus:ring-red-600 text-slate-900"
            />
          </div>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-xs text-slate-500 hover:text-slate-800 px-2 py-1 cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={fetchInventory}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-none bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-xs font-bold disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={handleSyncAll}
            disabled={syncingAll || counts.mismatch === 0}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-none bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-xs font-bold uppercase tracking-wider shadow-none border border-red-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <UploadCloud className={`h-4 w-4 ${syncingAll ? 'animate-pulse' : ''}`} />
            {syncingAll ? 'Pushing All…' : `Push ${counts.mismatch} Mismatch${counts.mismatch === 1 ? '' : 'es'} to Shopify`}
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-300 bg-white px-2 pt-2">
        <FilterTab
          active={statusFilter === 'all'}
          label="All Products"
          count={counts.total}
          onClick={() => setStatusFilter('all')}
        />
        <FilterTab
          active={statusFilter === 'mismatch'}
          label="Discrepancies"
          count={counts.mismatch}
          badgeColor="amber"
          onClick={() => setStatusFilter('mismatch')}
        />
        <FilterTab
          active={statusFilter === 'out_of_stock'}
          label="Out of Stock"
          count={counts.outOfStock}
          badgeColor="rose"
          onClick={() => setStatusFilter('out_of_stock')}
        />
        <FilterTab
          active={statusFilter === 'unlinked'}
          label="Unlinked SKU"
          count={counts.unlinked}
          badgeColor="slate"
          onClick={() => setStatusFilter('unlinked')}
        />
        <FilterTab
          active={statusFilter === 'synced'}
          label="Synced"
          count={counts.synced}
          badgeColor="emerald"
          onClick={() => setStatusFilter('synced')}
        />
      </div>

      {/* Inventory Table */}
      <div className="bg-white border border-slate-300 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-bold uppercase text-[11px] tracking-wider">
                <th className="py-3 px-4">Product & Variant</th>
                <th className="py-3 px-4">SKU / Item Code</th>
                <th className="py-3 px-4">ERP Item & Price</th>
                <th className="py-3 px-4 text-center">ERP Stock</th>
                <th className="py-3 px-4 text-center">Shopify Stock</th>
                <th className="py-3 px-4 text-center">Variance</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-slate-400" />
                    Fetching inventory and stock levels from Shopify & ERP…
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    No products match the selected filters.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const diff = item.erpStockOnHand - item.shopifyInventory;
                  const isSyncing = syncingItemId === item.variantId;

                  return (
                    <tr key={item.variantId} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{item.title}</div>
                        {item.variantTitle && (
                          <span className="text-[11px] text-slate-500 font-mono">
                            Option: {item.variantTitle}
                          </span>
                        )}
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          Shopify Price: {formatCurrency(item.shopifyPrice)}
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <span className="font-mono font-bold text-slate-800 bg-slate-100 px-2 py-0.5 border border-slate-200">
                          {item.sku}
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        {item.matched ? (
                          <div>
                            <div className="font-semibold text-slate-800">{item.erpItemName}</div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              ERP Price: {formatCurrency(item.erpPrice || 0)}
                            </div>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 border border-amber-200">
                            <AlertTriangle className="h-3 w-3" /> SKU not found in ERP
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-center font-mono font-bold">
                        {item.matched ? (
                          <span className={`px-2 py-0.5 border text-xs ${item.erpStockOnHand > 0 ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
                            {item.erpStockOnHand}
                          </span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-center font-mono font-bold">
                        <span className={`px-2 py-0.5 border text-xs ${item.shopifyInventory > 0 ? 'bg-blue-50 text-blue-800 border-blue-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                          {item.shopifyInventory}
                        </span>
                      </td>

                      <td className="py-3 px-4 text-center font-mono font-bold">
                        {item.matched ? (
                          diff === 0 ? (
                            <span className="text-slate-400">0</span>
                          ) : diff > 0 ? (
                            <span className="text-emerald-700">+{diff}</span>
                          ) : (
                            <span className="text-rose-700">{diff}</span>
                          )
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-center">
                        {item.status === 'synced' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-300">
                            <CheckCircle2 className="h-3 w-3" /> Synced
                          </span>
                        ) : item.status === 'mismatch' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-300">
                            <AlertTriangle className="h-3 w-3" /> Mismatch
                          </span>
                        ) : item.status === 'out_of_stock' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-rose-50 text-rose-700 border border-rose-300">
                            <XCircle className="h-3 w-3" /> Out of Stock
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-600 border border-slate-300">
                            <HelpCircle className="h-3 w-3" /> Unlinked
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right">
                        {item.matched && item.status === 'mismatch' ? (
                          <button
                            onClick={() => handleSyncSingle(item)}
                            disabled={isSyncing}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold bg-red-600 hover:bg-red-700 active:bg-red-800 text-white uppercase tracking-wider border border-red-700 disabled:opacity-50 cursor-pointer"
                          >
                            <UploadCloud className={`h-3 w-3 ${isSyncing ? 'animate-pulse' : ''}`} />
                            {isSyncing ? 'Pushing…' : 'Push Stock'}
                          </button>
                        ) : item.matched && item.status === 'synced' ? (
                          <button
                            onClick={() => handleSyncSingle(item)}
                            disabled={isSyncing}
                            title="Force re-push ERP stock to Shopify"
                            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold bg-white hover:bg-slate-100 text-slate-600 border border-slate-300 cursor-pointer"
                          >
                            <RefreshCw className={`h-2.5 w-2.5 ${isSyncing ? 'animate-spin' : ''}`} />
                            Force Sync
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">No action</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="p-3 bg-slate-50 border border-slate-200 text-slate-600 text-[11px] flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-amber-600" />
          ERP On-Hand Stock is computed dynamically across all your branch warehouses.
        </span>
        <span className="text-slate-500 font-mono">
          Pushing stock updates Shopify inventory levels for that SKU in real-time.
        </span>
      </div>
    </div>
  );
};

interface FilterTabProps {
  active: boolean;
  label: string;
  count: number;
  badgeColor?: 'amber' | 'rose' | 'slate' | 'emerald';
  onClick: () => void;
}

const FilterTab: React.FC<FilterTabProps> = ({ active, label, count, badgeColor, onClick }) => {
  const badgeClasses = {
    amber: 'bg-amber-100 text-amber-800 border-amber-300',
    rose: 'bg-rose-100 text-rose-800 border-rose-300',
    slate: 'bg-slate-100 text-slate-700 border-slate-300',
    emerald: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  }[badgeColor || 'slate'];

  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-xs font-bold flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
        active
          ? 'border-red-600 text-red-600'
          : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
      }`}
    >
      <span>{label}</span>
      <span className={`text-[10px] px-1.5 py-0.2 rounded-full border font-mono ${badgeClasses}`}>
        {count}
      </span>
    </button>
  );
};
