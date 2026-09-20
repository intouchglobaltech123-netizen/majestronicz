import React, { useEffect, useState, useMemo } from 'react';
import {
  RefreshCw,
  DownloadCloud,
  CheckCircle2,
  AlertTriangle,
  Search,
  Layers,
} from 'lucide-react';
import { apiGet, apiPost } from '../../lib/api';
import { ShopifyProductItem } from '../../types/shopify';
import { formatCurrency } from '../../lib/utils';
import { toast } from 'sonner';

export const ShopifyProductsTab: React.FC = () => {
  const [products, setProducts] = useState<ShopifyProductItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'matched' | 'unmatched'>('all');

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ configured: boolean; products: ShopifyProductItem[] }>('/api/shopify/products?limit=150');
      setProducts(res.products || []);
    } catch (e: any) {
      toast.error('Could not fetch Shopify product catalog', { description: e?.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const counts = useMemo(() => {
    let matched = 0;
    let unmatched = 0;
    for (const p of products) {
      if (p.matched) matched++;
      else unmatched++;
    }
    return { total: products.length, matched, unmatched };
  }, [products]);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return products.filter((p) => {
      if (filter === 'matched' && !p.matched) return false;
      if (filter === 'unmatched' && p.matched) return false;
      if (!q) return true;
      return (
        p.sku.toLowerCase().includes(q) ||
        p.title.toLowerCase().includes(q) ||
        (p.itemName && p.itemName.toLowerCase().includes(q))
      );
    });
  }, [products, searchQuery, filter]);

  const handleImportToErp = async () => {
    setImporting(true);
    try {
      const res = await apiPost<{ created: number; skipped: number }>('/api/shopify/import-products', { limit: 100 });
      if (res.created > 0) {
        toast.success(`Imported ${res.created} new product(s) into ERP`, {
          description: res.skipped ? `${res.skipped} skipped (already existed or missing SKU)` : 'Added to Items directory',
        });
      } else {
        toast.info('No new products to import', {
          description: 'All Shopify variants with SKUs are already in your ERP items master.',
        });
      }
      await fetchProducts();
    } catch (e: any) {
      toast.error('Product import failed', { description: e?.message });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white p-4 border border-slate-300 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total Variants</span>
            <Layers className="h-4 w-4 text-slate-400" />
          </div>
          <div className="text-xl font-extrabold text-slate-900 mt-2 font-mono">{counts.total}</div>
          <p className="text-[10px] text-slate-400 mt-0.5">Variants available on Shopify store</p>
        </div>

        <div className="bg-white p-4 border border-emerald-300 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Mapped to ERP</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="text-xl font-extrabold text-emerald-700 mt-2 font-mono">{counts.matched}</div>
          <p className="text-[10px] text-emerald-600/80 mt-0.5">Matching Item Code in ERP</p>
        </div>

        <div className="bg-white p-4 border border-amber-300 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Unmapped / New</span>
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </div>
          <div className="text-xl font-extrabold text-amber-700 mt-2 font-mono">{counts.unmatched}</div>
          <p className="text-[10px] text-amber-600/80 mt-0.5">Can be imported into ERP items</p>
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
              placeholder="Search by SKU, product title, or ERP item..."
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
            onClick={fetchProducts}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-none bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-xs font-bold disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={handleImportToErp}
            disabled={importing || counts.unmatched === 0}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-none bg-slate-900 hover:bg-black active:bg-slate-950 text-white text-xs font-bold uppercase tracking-wider shadow-none border border-slate-900 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <DownloadCloud className={`h-4 w-4 ${importing ? 'animate-pulse' : ''}`} />
            {importing ? 'Importing…' : `Import ${counts.unmatched} to ERP Master`}
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-300 bg-white px-2 pt-2">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-2 text-xs font-bold flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
            filter === 'all'
              ? 'border-red-600 text-red-600'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
          }`}
        >
          <span>All Products</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full border border-slate-300 bg-slate-100 text-slate-700 font-mono">
            {counts.total}
          </span>
        </button>
        <button
          onClick={() => setFilter('matched')}
          className={`px-3 py-2 text-xs font-bold flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
            filter === 'matched'
              ? 'border-red-600 text-red-600'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
          }`}
        >
          <span>Mapped to ERP</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full border border-emerald-300 bg-emerald-100 text-emerald-800 font-mono">
            {counts.matched}
          </span>
        </button>
        <button
          onClick={() => setFilter('unmatched')}
          className={`px-3 py-2 text-xs font-bold flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
            filter === 'unmatched'
              ? 'border-red-600 text-red-600'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
          }`}
        >
          <span>Unmapped</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full border border-amber-300 bg-amber-100 text-amber-800 font-mono">
            {counts.unmatched}
          </span>
        </button>
      </div>

      {/* Products Table */}
      <div className="bg-white border border-slate-300 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-bold uppercase text-[11px] tracking-wider">
                <th className="py-3 px-4">Shopify Product / Variant</th>
                <th className="py-3 px-4">SKU / Item Code</th>
                <th className="py-3 px-4 text-right">Shopify Price</th>
                <th className="py-3 px-4">ERP Item Mapping</th>
                <th className="py-3 px-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-slate-400" />
                    Fetching Shopify product catalog…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    No products found matching the criteria.
                  </td>
                </tr>
              ) : (
                filtered.map((item, idx) => (
                  <tr key={`${item.sku}-${idx}`} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      {item.title}
                    </td>

                    <td className="py-3 px-4 font-mono font-bold text-slate-800">
                      <span className="bg-slate-100 px-2 py-0.5 border border-slate-200">
                        {item.sku}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                      {formatCurrency(item.price)}
                    </td>

                    <td className="py-3 px-4">
                      {item.matched ? (
                        <div className="flex items-center gap-1.5 text-emerald-700 font-semibold">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          <span>{item.itemName}</span>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-[11px] italic">
                          No matching ERP item code
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-center">
                      {item.matched ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-300">
                          Active & Mapped
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-300">
                          Unlinked
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-slate-500">
        SKU matching is case-insensitive. When an online order arrives with a matched SKU, the ERP will automatically link the invoice line to the exact ERP item master record and calculate profit & tax.
      </p>
    </div>
  );
};
