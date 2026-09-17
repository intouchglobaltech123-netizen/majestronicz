import React, { useMemo, useState } from 'react';
import {
  Users,
  Search,
  Plus,
  UserRound,
  Building2,
  Phone,
  Hash,
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
} from 'lucide-react';
import { useErp } from '../../context/ErpContext';
import { Customer, Vendor, getCustomerOutstandingSummary, computeInvoiceFinance } from '../../types';
import { formatCurrency } from '../../lib/utils';
import { CustomerFormModal } from '../customers/CustomerFormModal';
import { CustomerDetailModal } from '../customers/CustomerDetailModal';
import { VendorMasterModal } from '../purchases/VendorMasterModal';
import { VendorStatementModal } from './VendorStatementModal';

type PartyFilter = 'all' | 'customers' | 'suppliers';

interface UnifiedParty {
  key: string;
  kind: 'customer' | 'supplier';
  name: string;
  phone: string;
  gstin?: string;
  /** Positive = receivable (To Collect); we track collect/pay separately below. */
  toCollect: number;
  toPay: number;
  customer?: Customer;
  vendor?: Vendor;
}

/**
 * Vyapar-style unified Parties directory: all customers + suppliers in one list
 * with To Collect (receivable) / To Pay (payable) balances, search & type filter,
 * add-party, and click-in to a per-party statement.
 */
export const PartiesView: React.FC = () => {
  const {
    customers,
    vendors,
    invoices,
    purchaseOrders,
    canManageCustomers,
    canManagePurchases,
    currentBranch,
    isAllBranches,
  } = useErp();

  // Branch scope: when locked to a branch (e.g. Manager), only that branch's
  // invoices/POs count toward balances so parties don't expose other branches.
  const scopedInvoices = useMemo(
    () => (isAllBranches ? invoices : invoices.filter((i) => i.branchId === currentBranch)),
    [invoices, isAllBranches, currentBranch]
  );
  const scopedPOs = useMemo(
    () => (isAllBranches ? purchaseOrders : purchaseOrders.filter((p) => p.branchId === currentBranch)),
    [purchaseOrders, isAllBranches, currentBranch]
  );

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<PartyFilter>('all');
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  // Modals
  const [customerFormOpen, setCustomerFormOpen] = useState(false);
  const [customerToEdit, setCustomerToEdit] = useState<Customer | null>(null);
  const [vendorFormOpen, setVendorFormOpen] = useState(false);
  const [vendorToEdit, setVendorToEdit] = useState<Vendor | null>(null);
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);
  const [detailVendor, setDetailVendor] = useState<Vendor | null>(null);

  // Vendor payable = sum of unpaid PO balances (non-cancelled).
  const vendorPayable = useMemo(() => {
    const map = new Map<string, number>();
    for (const po of scopedPOs) {
      if (po.status === 'Cancelled') continue;
      const bal = Math.max(0, (po.totalAmount || 0) - (po.amountPaid || 0));
      if (bal <= 0.5) continue;
      map.set(po.vendorId, (map.get(po.vendorId) || 0) + bal);
    }
    return map;
  }, [scopedPOs]);

  const parties: UnifiedParty[] = useMemo(() => {
    const list: UnifiedParty[] = [];
    for (const c of customers) {
      const toCollect = getCustomerOutstandingSummary(c, scopedInvoices).totalOutstanding;
      list.push({
        key: `c-${c.id}`,
        kind: 'customer',
        name: c.name,
        phone: c.phone,
        toCollect,
        toPay: 0,
        customer: c,
      });
    }
    for (const v of vendors) {
      list.push({
        key: `v-${v.id}`,
        kind: 'supplier',
        name: v.vendorName,
        phone: v.contactNo,
        gstin: v.gstin,
        toCollect: 0,
        toPay: vendorPayable.get(v.id) || 0,
        vendor: v,
      });
    }
    return list;
  }, [customers, vendors, scopedInvoices, vendorPayable]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return parties
      .filter((p) => (filter === 'all' ? true : filter === 'customers' ? p.kind === 'customer' : p.kind === 'supplier'))
      .filter((p) =>
        q
          ? p.name.toLowerCase().includes(q) ||
            (p.phone || '').toLowerCase().includes(q) ||
            (p.gstin || '').toLowerCase().includes(q)
          : true
      )
      .sort((a, b) => {
        // Outstanding first (largest absolute balance), then by name
        const balA = a.toCollect + a.toPay;
        const balB = b.toCollect + b.toPay;
        if (balB !== balA) return balB - balA;
        return a.name.localeCompare(b.name);
      });
  }, [parties, filter, search]);

  // Headline receivable uses the SAME single finance-truth as the dashboard &
  // Customers page (sum of every non-voided invoice's due), so the numbers
  // reconcile. Per-customer rows only attribute dues to a matched customer
  // record; any remainder is receivable on invoices not linked to a party.
  const totalReceivable = useMemo(
    () => scopedInvoices.filter((i) => !i.isVoided).reduce((s, i) => s + computeInvoiceFinance(i).due, 0),
    [scopedInvoices]
  );
  const attributedReceivable = parties.reduce((s, p) => s + p.toCollect, 0);
  const unassignedReceivable = Math.max(0, totalReceivable - attributedReceivable);
  const totalPayable = parties.reduce((s, p) => s + p.toPay, 0);
  const customerCount = parties.filter((p) => p.kind === 'customer').length;
  const supplierCount = parties.filter((p) => p.kind === 'supplier').length;

  const openParty = (p: UnifiedParty) => {
    if (p.kind === 'customer' && p.customer) setDetailCustomer(p.customer);
    else if (p.kind === 'supplier' && p.vendor) setDetailVendor(p.vendor);
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="h-10 w-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700 shrink-0 shadow-2xs">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Parties</h1>
            <p className="text-xs text-slate-500">Customers &amp; suppliers in one place — balances, statements, and payments.</p>
          </div>
        </div>

        {/* Add Party */}
        {(canManageCustomers || canManagePurchases) && (
          <div className="relative">
            <button
              onClick={() => setAddMenuOpen((o) => !o)}
              onBlur={() => setTimeout(() => setAddMenuOpen(false), 150)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span>Add Party</span>
              <ChevronDown className="h-3.5 w-3.5 opacity-80" />
            </button>
            {addMenuOpen && (
              <div className="absolute right-0 mt-1.5 w-52 bg-white border border-slate-200 rounded-xl shadow-lg z-20 overflow-hidden">
                {canManageCustomers && (
                  <button
                    onMouseDown={() => { setCustomerToEdit(null); setCustomerFormOpen(true); }}
                    className="w-full text-left px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                  >
                    <UserRound className="h-4 w-4 text-blue-600" /> Add Customer
                  </button>
                )}
                {canManagePurchases && (
                  <button
                    onMouseDown={() => { setVendorToEdit(null); setVendorFormOpen(true); }}
                    className="w-full text-left px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2 border-t border-slate-100"
                  >
                    <Building2 className="h-4 w-4 text-blue-600" /> Add Supplier
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* KPI summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50/50 shadow-2xs flex items-center gap-3.5">
          <div className="h-11 w-11 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-200/60">
            <ArrowDownLeft className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total To Collect</p>
            <p className="text-xl sm:text-2xl font-black font-mono text-emerald-700 truncate mt-0.5">{formatCurrency(totalReceivable)}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {unassignedReceivable > 0.5
                ? `${formatCurrency(unassignedReceivable)} on unlinked bills`
                : 'Receivable from customers'}
            </p>
          </div>
        </div>
        <div className="p-4 rounded-2xl border border-rose-200 bg-rose-50/50 shadow-2xs flex items-center gap-3.5">
          <div className="h-11 w-11 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0 border border-rose-200/60">
            <ArrowUpRight className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total To Pay</p>
            <p className="text-xl sm:text-2xl font-black font-mono text-rose-700 truncate mt-0.5">{formatCurrency(totalPayable)}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Payable to suppliers</p>
          </div>
        </div>
        <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-2xs flex items-center gap-3.5">
          <div className="h-11 w-11 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0 border border-blue-200/60">
            <Users className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Parties</p>
            <p className="text-xl sm:text-2xl font-black font-mono text-slate-900 truncate mt-0.5">{parties.length}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{customerCount} customers · {supplierCount} suppliers</p>
          </div>
        </div>
      </div>

      {/* Search + filter */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shadow-xs">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search party by name, phone, or GSTIN..."
            className="w-full pl-10 pr-4 py-2 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:border-blue-500"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs shrink-0">
          {([['all', 'All'], ['customers', 'Customers'], ['suppliers', 'Suppliers']] as const).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setFilter(val)}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                filter === val ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-xs font-bold uppercase tracking-wider">
                <th className="py-3 px-4">Party</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Contact</th>
                <th className="py-3 px-4">GSTIN</th>
                <th className="py-3 px-4 text-right">Balance</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <Users className="h-8 w-8 mx-auto text-slate-300 mb-2" />
                    <p className="font-bold text-sm text-slate-700">No parties found</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {search || filter !== 'all' ? 'Try clearing your search or filter.' : 'Add a customer or supplier to get started.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((p) => {
                  const isCustomer = p.kind === 'customer';
                  const balance = isCustomer ? p.toCollect : p.toPay;
                  return (
                    <tr
                      key={p.key}
                      onClick={() => openParty(p)}
                      className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                      title="View party statement"
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 text-sm font-bold border ${
                            isCustomer ? 'bg-blue-50 text-blue-700 border-blue-200/60' : 'bg-purple-50 text-purple-700 border-purple-200/60'
                          }`}>
                            {p.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors">{p.name}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                          isCustomer ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-purple-50 text-purple-700 border-purple-200'
                        }`}>
                          {isCustomer ? <UserRound className="h-3 w-3" /> : <Building2 className="h-3 w-3" />}
                          {isCustomer ? 'Customer' : 'Supplier'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">
                        {p.phone ? (
                          <span className="inline-flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-slate-400" />{p.phone}</span>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        {p.gstin ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 font-mono text-xs">
                            <Hash className="h-3 w-3 text-slate-400" />{p.gstin}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {balance > 0 ? (
                          <div>
                            <span className={`font-black font-mono text-sm ${isCustomer ? 'text-emerald-700' : 'text-rose-700'}`}>
                              {formatCurrency(balance)}
                            </span>
                            <div className={`text-[11px] font-semibold ${isCustomer ? 'text-emerald-600' : 'text-rose-600'}`}>
                              {isCustomer ? 'To Collect' : 'To Pay'}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs font-semibold text-slate-400">Settled</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => openParty(p)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-[11px] font-bold transition-colors"
                        >
                          <Wallet className="h-3.5 w-3.5" />
                          <span>Statement</span>
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

      {/* Add / Edit modals */}
      <CustomerFormModal
        isOpen={customerFormOpen}
        onClose={() => setCustomerFormOpen(false)}
        customerToEdit={customerToEdit}
      />
      <VendorMasterModal
        isOpen={vendorFormOpen}
        onClose={() => setVendorFormOpen(false)}
        vendorToEdit={vendorToEdit}
      />

      {/* Statements */}
      <CustomerDetailModal
        customer={detailCustomer}
        isOpen={Boolean(detailCustomer)}
        onClose={() => setDetailCustomer(null)}
        onEditCustomer={(c) => { setDetailCustomer(null); setCustomerToEdit(c); setCustomerFormOpen(true); }}
      />
      <VendorStatementModal
        vendor={detailVendor}
        isOpen={Boolean(detailVendor)}
        onClose={() => setDetailVendor(null)}
        onEditVendor={(v) => { setDetailVendor(null); setVendorToEdit(v); setVendorFormOpen(true); }}
      />
    </div>
  );
};
