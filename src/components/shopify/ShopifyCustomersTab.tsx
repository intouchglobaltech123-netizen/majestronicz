import React, { useEffect, useState, useMemo } from 'react';
import {
  Users,
  RefreshCw,
  Search,
  CheckCircle2,
  Phone,
  Mail,
  MapPin,
  TrendingUp,
} from 'lucide-react';
import { apiGet } from '../../lib/api';
import { ShopifyCustomerSummary } from '../../types/shopify';
import { formatCurrency } from '../../lib/utils';
import { toast } from 'sonner';

export const ShopifyCustomersTab: React.FC = () => {
  const [customers, setCustomers] = useState<ShopifyCustomerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'synced' | 'online_only'>('all');

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ configured: boolean; customers: ShopifyCustomerSummary[] }>('/api/shopify/customers?limit=150');
      setCustomers(res.customers || []);
    } catch (e: any) {
      toast.error('Could not fetch Shopify customers', { description: e?.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  const totalSpentAll = useMemo(() => {
    return customers.reduce((sum, c) => sum + (c.totalSpent || 0), 0);
  }, [customers]);

  const syncedCount = useMemo(() => {
    return customers.filter((c) => c.syncedToErp).length;
  }, [customers]);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return customers.filter((c) => {
      if (filter === 'synced' && !c.syncedToErp) return false;
      if (filter === 'online_only' && c.syncedToErp) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.email && c.email.toLowerCase().includes(q)) ||
        (c.phone && c.phone.includes(q)) ||
        (c.city && c.city.toLowerCase().includes(q))
      );
    });
  }, [customers, searchQuery, filter]);

  return (
    <div className="space-y-5">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white p-4 border border-slate-300 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Online Buyers</span>
            <Users className="h-4 w-4 text-slate-500" />
          </div>
          <div className="text-xl font-extrabold text-slate-900 mt-2 font-mono">{customers.length}</div>
          <p className="text-[10px] text-slate-400 mt-0.5">Shopify registered customers</p>
        </div>

        <div className="bg-white p-4 border border-emerald-300 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Matched to ERP Party</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="text-xl font-extrabold text-emerald-700 mt-2 font-mono">{syncedCount}</div>
          <p className="text-[10px] text-emerald-600/80 mt-0.5">Existing party in Customer Master</p>
        </div>

        <div className="bg-white p-4 border border-slate-300 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total Online Spend</span>
            <TrendingUp className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="text-xl font-extrabold text-slate-900 mt-2 font-mono">{formatCurrency(totalSpentAll)}</div>
          <p className="text-[10px] text-slate-400 mt-0.5">Cumulative lifetime customer value</p>
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
              placeholder="Search by name, phone, email, or city..."
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
            onClick={fetchCustomers}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-none bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-xs font-bold disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
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
          <span>All Customers</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full border border-slate-300 bg-slate-100 text-slate-700 font-mono">
            {customers.length}
          </span>
        </button>
        <button
          onClick={() => setFilter('synced')}
          className={`px-3 py-2 text-xs font-bold flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
            filter === 'synced'
              ? 'border-red-600 text-red-600'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
          }`}
        >
          <span>In ERP Customers</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full border border-emerald-300 bg-emerald-100 text-emerald-800 font-mono">
            {syncedCount}
          </span>
        </button>
        <button
          onClick={() => setFilter('online_only')}
          className={`px-3 py-2 text-xs font-bold flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
            filter === 'online_only'
              ? 'border-red-600 text-red-600'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
          }`}
        >
          <span>Online Only</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full border border-slate-300 bg-slate-100 text-slate-700 font-mono">
            {customers.length - syncedCount}
          </span>
        </button>
      </div>

      {/* Customers Table */}
      <div className="bg-white border border-slate-300 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-bold uppercase text-[11px] tracking-wider">
                <th className="py-3 px-4">Customer Name</th>
                <th className="py-3 px-4">Contact Info</th>
                <th className="py-3 px-4">Location</th>
                <th className="py-3 px-4 text-center">Orders</th>
                <th className="py-3 px-4 text-right">Lifetime Spend</th>
                <th className="py-3 px-4 text-center">ERP Party Match</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-slate-400" />
                    Loading Shopify customers directory…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    No customers found matching the criteria.
                  </td>
                </tr>
              ) : (
                filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 font-bold text-slate-900">
                      {c.name}
                    </td>

                    <td className="py-3 px-4">
                      {c.phone && (
                        <div className="flex items-center gap-1.5 text-slate-700 font-mono">
                          <Phone className="h-3 w-3 text-slate-400 shrink-0" />
                          <span>{c.phone}</span>
                        </div>
                      )}
                      {c.email && (
                        <div className="flex items-center gap-1.5 text-slate-500 font-mono text-[11px] mt-0.5">
                          <Mail className="h-3 w-3 text-slate-400 shrink-0" />
                          <span>{c.email}</span>
                        </div>
                      )}
                      {!c.phone && !c.email && (
                        <span className="text-slate-400 italic text-[11px]">No contact details</span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      {c.city || c.province ? (
                        <div className="flex items-center gap-1 text-slate-700">
                          <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
                          <span>{[c.city, c.province].filter(Boolean).join(', ')}</span>
                        </div>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-center font-mono font-bold">
                      <span className="bg-slate-100 text-slate-800 px-2 py-0.5 border border-slate-200">
                        {c.ordersCount}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                      {formatCurrency(c.totalSpent)}
                    </td>

                    <td className="py-3 px-4 text-center">
                      {c.syncedToErp ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-300">
                          <CheckCircle2 className="h-3 w-3" /> Party in ERP
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-600 border border-slate-300">
                          Online Only
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
        When an online order is imported into Sales, an ERP Customer entry is automatically linked or created with phone and address details.
      </p>
    </div>
  );
};
