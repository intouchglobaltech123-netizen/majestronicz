import React, { useState, useEffect } from 'react';
import {
  X,
  Search,
  Package,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { apiGet } from '../../lib/api';
import { ShopifySimilarItem } from '../../types/shopify';
import { formatCurrency } from '../../lib/utils';
import { toast } from 'sonner';

interface Props {
  sourceItemTitle: string;
  sourceItemSku?: string;
  category?: string;
  isOpen: boolean;
  onClose: () => void;
  onSelectAlternative?: (item: ShopifySimilarItem) => void;
}

export const ShopifySimilarProductsModal: React.FC<Props> = ({
  sourceItemTitle,
  sourceItemSku: _sourceItemSku,
  category,
  isOpen,
  onClose,
  onSelectAlternative,
}) => {
  const [query, setQuery] = useState(sourceItemTitle.split(' ')[0] || '');
  const [items, setItems] = useState<ShopifySimilarItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchSimilar = async (searchTerm: string, cat?: string) => {
    setLoading(true);
    try {
      const q = encodeURIComponent(searchTerm || '');
      const c = encodeURIComponent(cat || '');
      const res = await apiGet<ShopifySimilarItem[]>(`/api/shopify/similar-items?query=${q}&category=${c}`);
      setItems(res || []);
    } catch (e: any) {
      toast.error('Could not find similar products', { description: e?.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      const initialTerm = sourceItemTitle.replace(/[^a-zA-Z0-9 ]/g, ' ').split(' ').filter(Boolean)[0] || '';
      setQuery(initialTerm);
      fetchSimilar(initialTerm, category);
    }
  }, [isOpen, sourceItemTitle, category]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-white border border-slate-300 shadow-2xl flex flex-col overflow-hidden max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 bg-slate-100 border-b border-slate-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 bg-amber-500 text-white flex items-center justify-center font-bold">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-wide">
                Similar Products & ERP Alternatives
              </h3>
              <p className="text-[11px] text-slate-500">
                Finding available in-stock warehouse items for:{' '}
                <strong className="text-slate-800">{sourceItemTitle}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-3 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchSimilar(query, category)}
              placeholder="Search similar ERP items by name, SKU, or keyword..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-none focus:outline-none focus:ring-1 focus:ring-red-600"
            />
          </div>
          <button
            onClick={() => fetchSimilar(query, category)}
            disabled={loading}
            className="px-3 py-1.5 bg-slate-900 hover:bg-black text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 cursor-pointer"
          >
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>

        {/* Items List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="py-12 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
              <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
              <span>Searching warehouse stock for similar items…</span>
            </div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              <Package className="h-8 w-8 mx-auto text-slate-300 mb-2" />
              <span>No matching alternative items found in ERP inventory.</span>
              <p className="text-[11px] text-slate-400 mt-1">Try a different search keyword above.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {items.map((item) => {
                const inStock = item.stockOnHand > 0;

                return (
                  <div
                    key={item.id}
                    className="p-3 bg-white border border-slate-300 shadow-xs flex flex-col justify-between hover:border-red-400 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.itemName}
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

                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-slate-900 truncate" title={item.itemName}>
                          {item.itemName}
                        </p>
                        <p className="text-[10px] font-mono text-slate-500 mt-0.5">
                          SKU: <strong className="text-slate-700">{item.itemCode}</strong>
                        </p>
                        <p className="text-[10px] text-slate-400 truncate">
                          Category: {item.category}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                      <div>
                        <span className="text-[10px] text-slate-400 block uppercase font-semibold">ERP Price</span>
                        <span className="text-xs font-mono font-bold text-slate-900">
                          {formatCurrency(item.salePrice)}
                        </span>
                      </div>

                      <div className="text-right">
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 border ${
                            inStock
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                              : 'bg-rose-50 text-rose-700 border-rose-300'
                          }`}
                        >
                          {inStock ? (
                            <>
                              <CheckCircle2 className="h-3 w-3" />
                              {item.stockOnHand} in Stock
                            </>
                          ) : (
                            <>
                              <AlertTriangle className="h-3 w-3" />
                              Out of Stock
                            </>
                          )}
                        </span>
                      </div>
                    </div>

                    {onSelectAlternative && inStock && (
                      <button
                        onClick={() => {
                          onSelectAlternative(item);
                          onClose();
                        }}
                        className="mt-2.5 w-full py-1 text-[11px] font-bold uppercase tracking-wider bg-slate-800 hover:bg-slate-900 text-white flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <span>Select Alternate</span>
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-100 border-t border-slate-300 flex justify-between items-center text-[11px] text-slate-500">
          <span>{items.length} ERP item(s) found</span>
          <button
            onClick={onClose}
            className="px-3 py-1 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-bold cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
