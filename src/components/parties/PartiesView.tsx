import React, { useMemo, useState, useEffect } from 'react';
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
  MapPin,
  Award,
  Edit2,
  Receipt,
  ArrowUpDown,
  AlertCircle,
  User,
  ShoppingBag,
} from 'lucide-react';
import { useErp } from '../../context/ErpContext';
import { Customer, Vendor, getCustomerOutstandingSummary, computeInvoiceFinance } from '../../types';
import { isLoyaltyMilestoneEligible, getLoyaltyProgress } from '../../types/customer';
import { formatCurrency, cn } from '../../lib/utils';
import { CustomerFormModal } from '../customers/CustomerFormModal';
import { CustomerDetailModal } from '../customers/CustomerDetailModal';
import { VendorMasterModal } from '../purchases/VendorMasterModal';
import { VendorStatementModal } from './VendorStatementModal';
import { LoyaltySettingsTab } from '../customers/LoyaltySettingsTab';

export type PartyTab = 'customers' | 'suppliers' | 'all' | 'loyalty';

export interface PartiesViewProps {
  initialTab?: PartyTab;
}

interface UnifiedParty {
  key: string;
  kind: 'customer' | 'supplier';
  name: string;
  phone: string;
  gstin?: string;
  toCollect: number;
  toPay: number;
  customer?: Customer;
  vendor?: Vendor;
}

/**
 * Unified Parties & Customers Management View:
 * Combines Customer CRM, Supplier Directory, Unified Parties Ledger, and Loyalty Program
 * under one comprehensive, professional module.
 */
export const PartiesView: React.FC<PartiesViewProps> = ({ initialTab = 'customers' }) => {
  const {
    customers,
    vendors,
    invoices,
    purchaseOrders,
    canManageCustomers,
    canManagePurchases,
    currentBranch,
    isAllBranches,
    activeSubTab,
    loyaltySettings,
    selectedCustomerForDetail,
    setSelectedCustomerForDetail,
    getCustomerOutstandingBalance,
    setCurrentView,
  } = useErp();

  // Active top-level tab: Customers, Suppliers, All Parties, or Loyalty
  const [activeTab, setActiveTab] = useState<PartyTab>(initialTab);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [customerTypeFilter, setCustomerTypeFilter] = useState<'all' | 'Retail' | 'Organization'>('all');
  const [customerStatusFilter, setCustomerStatusFilter] = useState<'all' | 'milestone-ready' | 'in-progress'>('all');
  const [customerSortBy, setCustomerSortBy] = useState<'purchases' | 'spent' | 'name' | 'recent'>('purchases');

  // Modals state
  const [customerFormOpen, setCustomerFormOpen] = useState(false);
  const [customerToEdit, setCustomerToEdit] = useState<Customer | null>(null);
  const [vendorFormOpen, setVendorFormOpen] = useState(false);
  const [vendorToEdit, setVendorToEdit] = useState<Vendor | null>(null);
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);
  const [detailVendor, setDetailVendor] = useState<Vendor | null>(null);

  // Synchronize view tab and actions when triggered from secondary navbar flyout or router
  useEffect(() => {
    if (activeSubTab?.view === 'parties') {
      const tab = activeSubTab.tab;
      if (tab === 'customers' || tab === 'suppliers' || tab === 'all' || tab === 'loyalty') {
        setActiveTab(tab as PartyTab);
      } else if (tab === 'new-customer') {
        setActiveTab('customers');
        setCustomerToEdit(null);
        setCustomerFormOpen(true);
      } else if (tab === 'new-supplier') {
        setActiveTab('suppliers');
        setVendorToEdit(null);
        setVendorFormOpen(true);
      }
    } else if (activeSubTab?.view === 'customers') {
      const tab = activeSubTab.tab;
      if (tab === 'directory' || tab === 'customers') {
        setActiveTab('customers');
      } else if (tab === 'loyalty') {
        setActiveTab('loyalty');
      } else if (tab === 'new-customer') {
        setActiveTab('customers');
        setCustomerToEdit(null);
        setCustomerFormOpen(true);
      }
    }
  }, [activeSubTab]);

  // Sync with selectedCustomerForDetail from context (e.g. from invoices or search)
  useEffect(() => {
    if (selectedCustomerForDetail) {
      setDetailCustomer(selectedCustomerForDetail);
      setActiveTab('customers');
    }
  }, [selectedCustomerForDetail]);

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

  // Unified Parties List
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

  // Filtered Parties for the "All Parties" tab
  const filteredAllParties = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return parties
      .filter((p) =>
        q
          ? p.name.toLowerCase().includes(q) ||
            (p.phone || '').toLowerCase().includes(q) ||
            (p.gstin || '').toLowerCase().includes(q)
          : true
      )
      .sort((a, b) => {
        const balA = a.toCollect + a.toPay;
        const balB = b.toCollect + b.toPay;
        if (balB !== balA) return balB - balA;
        return a.name.localeCompare(b.name);
      });
  }, [parties, searchQuery]);

  // Filtered & Sorted Customers
  const filteredCustomers = useMemo(() => {
    let result = [...customers];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const qDigits = q.replace(/\D/g, '');
      result = result.filter((c) => {
        const nameMatch = c.name.toLowerCase().includes(q);
        const phoneMatch = qDigits && c.phone.replace(/\D/g, '').includes(qDigits);
        const addressMatch = (c.address || '').toLowerCase().includes(q);
        return nameMatch || phoneMatch || addressMatch;
      });
    }

    if (customerTypeFilter !== 'all') {
      result = result.filter((c) => (c.customerType || 'Retail') === customerTypeFilter);
    }

    if (customerStatusFilter === 'milestone-ready') {
      result = result.filter((c) => isLoyaltyMilestoneEligible(c, loyaltySettings));
    } else if (customerStatusFilter === 'in-progress') {
      result = result.filter((c) => !isLoyaltyMilestoneEligible(c, loyaltySettings));
    }

    result.sort((a, b) => {
      if (customerSortBy === 'purchases') return (b.purchaseCount || 0) - (a.purchaseCount || 0);
      if (customerSortBy === 'spent') return (b.totalSpent || 0) - (a.totalSpent || 0);
      if (customerSortBy === 'name') return a.name.localeCompare(b.name);
      if (customerSortBy === 'recent') {
        return new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime();
      }
      return 0;
    });

    return result;
  }, [customers, searchQuery, customerTypeFilter, customerStatusFilter, customerSortBy, loyaltySettings]);

  // Filtered Suppliers
  const filteredSuppliers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return vendors
      .filter((v) => {
        if (!q) return true;
        return (
          v.vendorName.toLowerCase().includes(q) ||
          (v.contactNo || '').toLowerCase().includes(q) ||
          (v.gstin || '').toLowerCase().includes(q) ||
          (v.address || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const payA = vendorPayable.get(a.id) || 0;
        const payB = vendorPayable.get(b.id) || 0;
        if (payB !== payA) return payB - payA;
        return a.vendorName.localeCompare(b.vendorName);
      });
  }, [vendors, searchQuery, vendorPayable]);

  // Overall Financial & CRM Metrics
  const totalReceivable = useMemo(
    () => scopedInvoices.filter((i) => !i.isVoided).reduce((s, i) => s + computeInvoiceFinance(i).due, 0),
    [scopedInvoices]
  );
  const attributedReceivable = parties.reduce((s, p) => s + p.toCollect, 0);
  const unassignedDues = Math.max(0, Math.round((totalReceivable - attributedReceivable) * 100) / 100);
  const totalPayable = parties.reduce((s, p) => s + p.toPay, 0);
  const totalCustomers = customers.length;
  const totalSuppliers = vendors.length;

  const milestoneReadyCount = useMemo(() => {
    return customers.filter((c) => isLoyaltyMilestoneEligible(c, loyaltySettings)).length;
  }, [customers, loyaltySettings]);

  const totalCustomerSales = useMemo(() => {
    return customers.reduce((sum, c) => sum + (c.totalSpent || 0), 0);
  }, [customers]);

  const customersWithDueCount = useMemo(() => {
    return customers.filter((c) => getCustomerOutstandingBalance(c) > 0).length;
  }, [customers, getCustomerOutstandingBalance]);

  const avgPurchases = useMemo(() => {
    if (totalCustomers === 0) return 0;
    const totalPurchases = customers.reduce((sum, c) => sum + (c.purchaseCount || 0), 0);
    return Math.round((totalPurchases / totalCustomers) * 10) / 10;
  }, [customers, totalCustomers]);

  const orgCount = useMemo(
    () => customers.filter((c) => (c.customerType || 'Retail') === 'Organization').length,
    [customers]
  );

  const activePOsCount = useMemo(() => {
    return scopedPOs.filter((p) => p.status === 'Ordered' || p.status === 'Partially Received').length;
  }, [scopedPOs]);

  const handleStartSaleForCustomer = (_customer: Customer) => {
    setDetailCustomer(null);
    setSelectedCustomerForDetail(null);
    setCurrentView('invoices');
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 w-full animate-in fade-in duration-150">
      {/* Top Banner & Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
            {activeTab === 'customers'
              ? 'Customers Directory'
              : activeTab === 'suppliers'
              ? 'Suppliers Directory'
              : activeTab === 'all'
              ? 'All Parties Ledger'
              : 'Loyalty Program & Reward Rules'}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {activeTab === 'customers'
              ? 'Customer CRM, purchase frequency tracker, and receivables directory.'
              : activeTab === 'suppliers'
              ? 'Vendor accounts, purchase orders, and payable balances.'
              : activeTab === 'all'
              ? 'Unified parties ledger — combined receivables (To Collect) & payables (To Pay).'
              : 'Configure tier milestones, reward thresholds, and customer loyalty perks.'}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {canManageCustomers && (
            <button
              type="button"
              onClick={() => {
                setCustomerToEdit(null);
                setCustomerFormOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-none border border-red-700 shadow-none transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>+ Add Customer</span>
            </button>
          )}
          {canManagePurchases && (
            <button
              type="button"
              onClick={() => {
                setVendorToEdit(null);
                setVendorFormOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-none shadow-none transition-colors cursor-pointer"
            >
              <Building2 className="h-4 w-4 text-slate-500" />
              <span>+ Add Supplier</span>
            </button>
          )}
        </div>
      </div>

      {/* Segmented Navigation Tabs (Classic Desktop ERP) */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar -mx-1 px-1">
        <button
          type="button"
          onClick={() => setActiveTab('customers')}
          className={cn(
            'flex items-center gap-2 px-3.5 py-2 rounded-none text-xs font-bold whitespace-nowrap transition-all cursor-pointer shrink-0 border',
            activeTab === 'customers'
              ? 'bg-red-600 text-white border-red-700 shadow-none'
              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50 hover:text-slate-900'
          )}
        >
          <UserRound className="h-4 w-4" />
          <span>Customers</span>
          <span className={cn(
            'px-1.5 py-0.2 rounded-none text-[10px]',
            activeTab === 'customers' ? 'bg-red-700 text-white font-bold' : 'bg-slate-100 text-slate-700 border border-slate-200'
          )}>
            {totalCustomers}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('suppliers')}
          className={cn(
            'flex items-center gap-2 px-3.5 py-2 rounded-none text-xs font-bold whitespace-nowrap transition-all cursor-pointer shrink-0 border',
            activeTab === 'suppliers'
              ? 'bg-red-600 text-white border-red-700 shadow-none'
              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50 hover:text-slate-900'
          )}
        >
          <Building2 className="h-4 w-4" />
          <span>Suppliers</span>
          <span className={cn(
            'px-1.5 py-0.2 rounded-none text-[10px]',
            activeTab === 'suppliers' ? 'bg-red-700 text-white font-bold' : 'bg-slate-100 text-slate-700 border border-slate-200'
          )}>
            {totalSuppliers}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('all')}
          className={cn(
            'flex items-center gap-2 px-3.5 py-2 rounded-none text-xs font-bold whitespace-nowrap transition-all cursor-pointer shrink-0 border',
            activeTab === 'all'
              ? 'bg-red-600 text-white border-red-700 shadow-none'
              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50 hover:text-slate-900'
          )}
        >
          <Users className="h-4 w-4" />
          <span>All Parties Ledger</span>
          <span className={cn(
            'px-1.5 py-0.2 rounded-none text-[10px]',
            activeTab === 'all' ? 'bg-red-700 text-white font-bold' : 'bg-slate-100 text-slate-700 border border-slate-200'
          )}>
            {parties.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('loyalty')}
          className={cn(
            'flex items-center gap-2 px-3.5 py-2 rounded-none text-xs font-bold whitespace-nowrap transition-all cursor-pointer shrink-0 border',
            activeTab === 'loyalty'
              ? 'bg-slate-800 text-white border-slate-900 shadow-none'
              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50 hover:text-slate-900'
          )}
        >
          <Award className="h-4 w-4" />
          <span>Loyalty Program</span>
        </button>
      </div>

      {/* TAB CONTENT */}

      {/* 1. LOYALTY PROGRAM TAB */}
      {activeTab === 'loyalty' && <LoyaltySettingsTab />}

      {/* 2. CUSTOMERS TAB */}
      {activeTab === 'customers' && (
        <>
          {/* Customer KPI Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                Total Customers
              </span>
              <div className="text-xl sm:text-2xl font-bold text-slate-900 mt-1 font-mono">{totalCustomers}</div>
              <span className="text-[11px] text-slate-400 mt-0.5 block">Active accounts</span>
            </div>

            <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-900 block">
                  Outstanding Dues
                </span>
                <AlertCircle className="h-4 w-4 text-amber-600" />
              </div>
              <div className="text-xl sm:text-2xl font-bold text-amber-950 mt-1 font-mono">
                {formatCurrency(totalReceivable)}
              </div>
              <span className="text-[11px] text-amber-800 mt-0.5 block font-semibold">
                {customersWithDueCount} customer{customersWithDueCount === 1 ? '' : 's'} with balance due
              </span>
            </div>

            <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-900 block">
                  Reward Ready
                </span>
                <Award className="h-4 w-4 text-amber-600" />
              </div>
              <div className="text-xl sm:text-2xl font-bold text-amber-950 mt-1 font-mono">
                {milestoneReadyCount}{' '}
                <span className="text-xs font-bold text-amber-700">customers</span>
              </div>
              <span className="text-[11px] text-amber-800 mt-0.5 block">
                Eligible for discount
              </span>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                Total Customer Sales
              </span>
              <div className="text-xl sm:text-2xl font-bold text-slate-900 mt-1 font-mono">
                {formatCurrency(totalCustomerSales)}
              </div>
              <span className="text-[11px] text-slate-400 mt-0.5 block">Lifetime aggregate</span>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                Avg Frequency
              </span>
              <div className="text-xl sm:text-2xl font-bold text-slate-900 mt-1 font-mono">
                {avgPurchases} <span className="text-xs font-bold text-slate-500">bills / cust</span>
              </div>
              <span className="text-[11px] text-slate-400 mt-0.5 block">Purchase retention</span>
            </div>

            <div className="bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-200 rounded-xl p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-purple-900 block">
                  Institutional
                </span>
                <Building2 className="h-4 w-4 text-purple-600" />
              </div>
              <div className="text-xl sm:text-2xl font-bold text-purple-950 mt-1 font-mono">
                {orgCount} <span className="text-xs font-bold text-purple-700">orgs</span>
              </div>
              <span className="text-[11px] text-purple-800 mt-0.5 block">
                {totalCustomers - orgCount} retail
              </span>
            </div>
          </div>

          {/* Search, Filter & Sort Toolbar */}
          <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search customers by name, phone, or address..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 placeholder-slate-400 focus:outline-hidden focus:border-blue-600 focus:bg-white transition-all"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Type filter */}
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl text-xs font-bold text-slate-600">
                <button
                  type="button"
                  onClick={() => setCustomerTypeFilter('all')}
                  className={cn(
                    'px-2.5 py-1.5 rounded-lg transition-all cursor-pointer',
                    customerTypeFilter === 'all' ? 'bg-white text-slate-900 shadow-2xs' : 'hover:text-slate-900'
                  )}
                >
                  All Types
                </button>
                <button
                  type="button"
                  onClick={() => setCustomerTypeFilter('Retail')}
                  className={cn(
                    'px-2.5 py-1.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer',
                    customerTypeFilter === 'Retail' ? 'bg-blue-600 text-white shadow-2xs' : 'hover:text-slate-900'
                  )}
                >
                  <User className="h-3 w-3" />
                  <span>Retail</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCustomerTypeFilter('Organization')}
                  className={cn(
                    'px-2.5 py-1.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer',
                    customerTypeFilter === 'Organization' ? 'bg-purple-600 text-white shadow-2xs' : 'hover:text-slate-900'
                  )}
                >
                  <Building2 className="h-3 w-3" />
                  <span>Organization</span>
                </button>
              </div>

              {/* Status filter */}
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl text-xs font-bold text-slate-600">
                <button
                  type="button"
                  onClick={() => setCustomerStatusFilter('all')}
                  className={cn(
                    'px-2.5 py-1.5 rounded-lg transition-all cursor-pointer',
                    customerStatusFilter === 'all' ? 'bg-white text-slate-900 shadow-2xs' : 'hover:text-slate-900'
                  )}
                >
                  All Status
                </button>
                <button
                  type="button"
                  onClick={() => setCustomerStatusFilter('milestone-ready')}
                  className={cn(
                    'px-2.5 py-1.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer',
                    customerStatusFilter === 'milestone-ready' ? 'bg-amber-100 text-amber-900 shadow-2xs' : 'hover:text-amber-900'
                  )}
                >
                  <Award className="h-3 w-3 text-amber-600" />
                  <span>Reward Ready</span>
                </button>
              </div>

              {/* Sort selector */}
              <div className="flex items-center gap-1 text-xs font-semibold text-slate-500">
                <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
                <select
                  value={customerSortBy}
                  onChange={(e) => setCustomerSortBy(e.target.value as any)}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-800 focus:outline-hidden focus:border-blue-600"
                >
                  <option value="purchases">Most Purchases</option>
                  <option value="spent">Highest Revenue</option>
                  <option value="name">Customer Name</option>
                  <option value="recent">Recently Added</option>
                </select>
              </div>
            </div>
          </div>

          {/* Customers Directory Table */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
            {filteredCustomers.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      <th className="p-4">Customer</th>
                      <th className="p-4">Type</th>
                      <th className="p-4">Phone / Contact</th>
                      <th className="p-4">Address</th>
                      <th className="p-4 text-center">Purchases</th>
                      <th className="p-4 text-right">Lifetime Spent</th>
                      <th className="p-4 text-right">Balance Due</th>
                      <th className="p-4">Loyalty Status</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                    {filteredCustomers.map((cust) => {
                      const isOrg = (cust.customerType || 'Retail') === 'Organization';
                      const isEligible = !isOrg && isLoyaltyMilestoneEligible(cust, loyaltySettings);
                      const progress = getLoyaltyProgress(cust, loyaltySettings);
                      const bal = getCustomerOutstandingBalance(cust);

                      return (
                        <tr
                          key={cust.id}
                          className={cn(
                            'hover:bg-slate-50/80 transition-colors',
                            isEligible && 'bg-amber-50/30'
                          )}
                        >
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <div className={cn(
                                'w-9 h-9 rounded-xl font-extrabold flex items-center justify-center shrink-0',
                                isOrg ? 'bg-purple-100 text-purple-700' : 'bg-blue-600/10 text-blue-700'
                              )}>
                                {isOrg ? <Building2 className="h-4 w-4" /> : cust.name.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <button
                                  type="button"
                                  onClick={() => setDetailCustomer(cust)}
                                  className="font-bold text-slate-900 hover:text-blue-600 hover:underline transition-colors text-left block"
                                >
                                  {cust.name}
                                </button>
                                <span className="text-[11px] text-slate-400">
                                  Customer since {cust.firstPurchaseDate || 'N/A'}
                                </span>
                              </div>
                            </div>
                          </td>

                          <td className="p-4 whitespace-nowrap">
                            {isOrg ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-50 border border-purple-200 text-purple-700 font-bold text-[11px]">
                                <Building2 className="h-3 w-3 text-purple-600" />
                                Organization
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 border border-blue-200 text-blue-700 font-bold text-[11px]">
                                <User className="h-3 w-3 text-blue-600" />
                                Retail
                              </span>
                            )}
                          </td>

                          <td className="p-4 whitespace-nowrap">
                            <span className="font-mono font-semibold text-slate-700 flex items-center gap-1.5">
                              <Phone className="h-3.5 w-3.5 text-slate-400" />
                              {cust.phone}
                            </span>
                          </td>

                          <td className="p-4 max-w-xs truncate text-slate-600">
                            {cust.address ? (
                              <span className="flex items-center gap-1.5 truncate">
                                <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                <span className="truncate">{cust.address}</span>
                              </span>
                            ) : (
                              <span className="text-slate-400 text-[11px]">—</span>
                            )}
                          </td>

                          <td className="p-4 text-center">
                            <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-900 font-extrabold text-xs">
                              {cust.purchaseCount}
                            </span>
                          </td>

                          <td className="p-4 text-right font-mono font-bold text-slate-900">
                            {formatCurrency(cust.totalSpent || 0)}
                          </td>

                          <td className="p-4 text-right">
                            {bal > 0 ? (
                              <button
                                type="button"
                                onClick={() => setDetailCustomer(cust)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 hover:bg-amber-100 border border-amber-300 text-xs font-mono font-bold text-amber-900 shadow-2xs transition-colors cursor-pointer"
                                title="Click to view breakdown of unpaid bills"
                              >
                                <AlertCircle className="h-3 w-3 text-amber-600" />
                                <span>{formatCurrency(bal)}</span>
                              </button>
                            ) : (
                              <span className="text-slate-400 font-mono text-xs">₹0</span>
                            )}
                          </td>

                          <td className="p-4">
                            {isOrg ? (
                              <span
                                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px] font-medium"
                                title="Organizations receive bulk partner tracking without loyalty milestones"
                              >
                                <Building2 className="h-3 w-3 text-purple-600" />
                                <span>Bulk Partner</span>
                              </span>
                            ) : isEligible ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 border border-amber-300 text-amber-900 font-bold text-[11px] animate-pulse">
                                <Award className="h-3 w-3 text-amber-600" />
                                <span>
                                  Reward Ready ({loyaltySettings.discountValue}
                                  {loyaltySettings.discountType === 'percentage' ? '%' : '₹'})
                                </span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px] font-medium">
                                <Award className="h-3 w-3 text-blue-600" />
                                <span>{progress.label}</span>
                              </span>
                            )}
                          </td>

                          <td className="p-4 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => setDetailCustomer(cust)}
                                className="px-2 py-1 rounded-lg text-slate-600 hover:text-blue-600 hover:bg-slate-100 text-xs font-bold transition-colors cursor-pointer"
                              >
                                History
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setCustomerToEdit(cust);
                                  setCustomerFormOpen(true);
                                }}
                                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                                title="Edit Customer"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleStartSaleForCustomer(cust)}
                                className="p-1 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
                                title="New Sale"
                              >
                                <Receipt className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-16 text-center space-y-3">
                <Users className="h-10 w-10 text-slate-300 mx-auto" />
                <h3 className="text-sm font-bold text-slate-700">No customers found</h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  {searchQuery
                    ? `No customers match your search "${searchQuery}".`
                    : 'Start registering customers during billing or add them directly.'}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setCustomerToEdit(null);
                    setCustomerFormOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors shadow-2xs cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  <span>Add New Customer</span>
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* 3. SUPPLIERS TAB */}
      {activeTab === 'suppliers' && (
        <>
          {/* Supplier KPI Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                Total Suppliers
              </span>
              <div className="text-xl sm:text-2xl font-bold text-slate-900 mt-1 font-mono">{totalSuppliers}</div>
              <span className="text-[11px] text-slate-400 mt-0.5 block">Registered vendors</span>
            </div>

            <div className="bg-gradient-to-br from-rose-50 to-pink-50 border border-rose-200 rounded-xl p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-rose-900 block">
                  Total Payables
                </span>
                <ArrowUpRight className="h-4 w-4 text-rose-600" />
              </div>
              <div className="text-xl sm:text-2xl font-bold text-rose-950 mt-1 font-mono">
                {formatCurrency(totalPayable)}
              </div>
              <span className="text-[11px] text-rose-800 mt-0.5 block font-semibold">
                Owed across active POs
              </span>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                  Active Purchase Orders
                </span>
                <ShoppingBag className="h-4 w-4 text-blue-600" />
              </div>
              <div className="text-xl sm:text-2xl font-bold text-slate-900 mt-1 font-mono">
                {activePOsCount}
              </div>
              <span className="text-[11px] text-slate-400 mt-0.5 block">
                Inward delivery pipeline
              </span>
            </div>
          </div>

          {/* Supplier Search Toolbar */}
          <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs">
            <div className="relative w-full max-w-md">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search suppliers by name, phone, GSTIN, or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 placeholder-slate-400 focus:outline-hidden focus:border-blue-600 focus:bg-white transition-all"
              />
            </div>
          </div>

          {/* Suppliers Directory Table */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
            {filteredSuppliers.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      <th className="p-4">Supplier / Vendor</th>
                      <th className="p-4">Contact Phone</th>
                      <th className="p-4">Address</th>
                      <th className="p-4">GSTIN</th>
                      <th className="p-4 text-right">Balance (To Pay)</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                    {filteredSuppliers.map((vendor) => {
                      const payable = vendorPayable.get(vendor.id) || 0;
                      return (
                        <tr
                          key={vendor.id}
                          className="hover:bg-slate-50/80 transition-colors"
                        >
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-xl font-extrabold flex items-center justify-center shrink-0 bg-purple-100 text-purple-700">
                                <Building2 className="h-4 w-4" />
                              </div>
                              <div>
                                <button
                                  type="button"
                                  onClick={() => setDetailVendor(vendor)}
                                  className="font-bold text-slate-900 hover:text-blue-600 hover:underline transition-colors text-left block"
                                >
                                  {vendor.vendorName}
                                </button>
                                <span className="text-[11px] text-slate-400">
                                  {vendor.address || 'Vendor'}
                                </span>
                              </div>
                            </div>
                          </td>

                          <td className="p-4 whitespace-nowrap">
                            {vendor.contactNo ? (
                              <span className="font-mono font-semibold text-slate-700 flex items-center gap-1.5">
                                <Phone className="h-3.5 w-3.5 text-slate-400" />
                                {vendor.contactNo}
                              </span>
                            ) : (
                              <span className="text-slate-400 text-[11px]">—</span>
                            )}
                          </td>

                          <td className="p-4 max-w-xs truncate text-slate-600">
                            {vendor.address ? (
                              <span className="flex items-center gap-1.5 truncate">
                                <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                <span className="truncate">{vendor.address}</span>
                              </span>
                            ) : (
                              <span className="text-slate-400 text-[11px]">—</span>
                            )}
                          </td>

                          <td className="p-4 whitespace-nowrap">
                            {vendor.gstin ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 font-mono text-xs">
                                <Hash className="h-3 w-3 text-slate-400" />
                                {vendor.gstin}
                              </span>
                            ) : (
                              <span className="text-slate-400 text-[11px]">—</span>
                            )}
                          </td>

                          <td className="p-4 text-right">
                            {payable > 0 ? (
                              <div>
                                <span className="font-bold font-mono text-sm text-rose-700">
                                  {formatCurrency(payable)}
                                </span>
                                <div className="text-[10px] font-semibold text-rose-600">To Pay</div>
                              </div>
                            ) : (
                              <span className="text-xs font-semibold text-slate-400">Settled</span>
                            )}
                          </td>

                          <td className="p-4 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => setDetailVendor(vendor)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-xs font-bold transition-colors cursor-pointer"
                              >
                                <Wallet className="h-3.5 w-3.5" />
                                <span>Statement</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setVendorToEdit(vendor);
                                  setVendorFormOpen(true);
                                }}
                                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                                title="Edit Supplier"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-16 text-center space-y-3">
                <Building2 className="h-10 w-10 text-slate-300 mx-auto" />
                <h3 className="text-sm font-bold text-slate-700">No suppliers found</h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  {searchQuery
                    ? `No suppliers match your search "${searchQuery}".`
                    : 'Register suppliers to issue purchase orders and track inward goods.'}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setVendorToEdit(null);
                    setVendorFormOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors shadow-2xs cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  <span>Add New Supplier</span>
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* 4. ALL PARTIES LEDGER TAB */}
      {activeTab === 'all' && (
        <>
          {/* All Parties Financial KPI Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/50 shadow-2xs flex items-center gap-3.5">
              <div className="h-11 w-11 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-200/60">
                <ArrowDownLeft className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total To Collect</p>
                <p className="text-xl sm:text-2xl font-bold font-mono text-emerald-700 truncate mt-0.5">
                  {formatCurrency(totalReceivable)}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {unassignedDues > 0.5
                    ? `${formatCurrency(unassignedDues)} on unlinked bills`
                    : 'Customer receivables'}
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-rose-200 bg-rose-50/50 shadow-2xs flex items-center gap-3.5">
              <div className="h-11 w-11 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0 border border-rose-200/60">
                <ArrowUpRight className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total To Pay</p>
                <p className="text-xl sm:text-2xl font-bold font-mono text-rose-700 truncate mt-0.5">
                  {formatCurrency(totalPayable)}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">Supplier payables</p>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs flex items-center gap-3.5">
              <div className="h-11 w-11 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0 border border-blue-200/60">
                <Users className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Parties</p>
                <p className="text-xl sm:text-2xl font-bold font-mono text-slate-900 truncate mt-0.5">
                  {parties.length}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {totalCustomers} customers · {totalSuppliers} suppliers
                </p>
              </div>
            </div>
          </div>

          {/* Search Bar */}
          <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs">
            <div className="relative w-full max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search party by name, phone, or GSTIN..."
                className="w-full pl-9 pr-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 focus:outline-hidden focus:border-blue-500"
              />
            </div>
          </div>

          {/* Unified Ledger Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-[11px] font-bold uppercase tracking-wider">
                    <th className="py-3 px-4">Party</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Contact</th>
                    <th className="py-3 px-4">GSTIN</th>
                    <th className="py-3 px-4 text-right">Balance</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {filteredAllParties.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-400">
                        <Users className="h-8 w-8 mx-auto text-slate-300 mb-2" />
                        <p className="font-bold text-sm text-slate-700">No parties found</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {searchQuery ? 'Try clearing your search query.' : 'Add a customer or supplier to get started.'}
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filteredAllParties.map((p) => {
                      const isCustomer = p.kind === 'customer';
                      const balance = isCustomer ? p.toCollect : p.toPay;
                      return (
                        <tr
                          key={p.key}
                          onClick={() => {
                            if (isCustomer && p.customer) setDetailCustomer(p.customer);
                            else if (!isCustomer && p.vendor) setDetailVendor(p.vendor);
                          }}
                          className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                        >
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-3">
                              <div className={cn(
                                'h-9 w-9 rounded-xl flex items-center justify-center shrink-0 text-sm font-bold border',
                                isCustomer ? 'bg-blue-50 text-blue-700 border-blue-200/60' : 'bg-purple-50 text-purple-700 border-purple-200/60'
                              )}>
                                {p.name.charAt(0).toUpperCase()}
                              </div>
                              <span className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                                {p.name}
                              </span>
                            </div>
                          </td>

                          <td className="py-3.5 px-4">
                            <span className={cn(
                              'inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border',
                              isCustomer ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-purple-50 text-purple-700 border-purple-200'
                            )}>
                              {isCustomer ? <UserRound className="h-3 w-3" /> : <Building2 className="h-3 w-3" />}
                              {isCustomer ? 'Customer' : 'Supplier'}
                            </span>
                          </td>

                          <td className="py-3.5 px-4 text-slate-600">
                            {p.phone ? (
                              <span className="inline-flex items-center gap-1.5 font-mono font-semibold">
                                <Phone className="h-3.5 w-3.5 text-slate-400" />
                                {p.phone}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>

                          <td className="py-3.5 px-4">
                            {p.gstin ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 font-mono text-xs">
                                <Hash className="h-3 w-3 text-slate-400" />
                                {p.gstin}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-right">
                            {balance > 0 ? (
                              <div>
                                <span className={cn(
                                  'font-bold font-mono text-sm',
                                  isCustomer ? 'text-emerald-700' : 'text-rose-700'
                                )}>
                                  {formatCurrency(balance)}
                                </span>
                                <div className={cn(
                                  'text-[10px] font-semibold',
                                  isCustomer ? 'text-emerald-600' : 'text-rose-600'
                                )}>
                                  {isCustomer ? 'To Collect' : 'To Pay'}
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs font-semibold text-slate-400">Settled</span>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => {
                                if (isCustomer && p.customer) setDetailCustomer(p.customer);
                                else if (!isCustomer && p.vendor) setDetailVendor(p.vendor);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-xs font-bold transition-colors cursor-pointer"
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
        </>
      )}

      {/* Modals */}
      <CustomerFormModal
        isOpen={customerFormOpen}
        onClose={() => {
          setCustomerFormOpen(false);
          setCustomerToEdit(null);
        }}
        customerToEdit={customerToEdit}
      />

      <VendorMasterModal
        isOpen={vendorFormOpen}
        onClose={() => {
          setVendorFormOpen(false);
          setVendorToEdit(null);
        }}
        vendorToEdit={vendorToEdit}
      />

      <CustomerDetailModal
        customer={detailCustomer}
        isOpen={Boolean(detailCustomer)}
        onClose={() => {
          setDetailCustomer(null);
          setSelectedCustomerForDetail(null);
        }}
        onEditCustomer={(c) => {
          setDetailCustomer(null);
          setSelectedCustomerForDetail(null);
          setCustomerToEdit(c);
          setCustomerFormOpen(true);
        }}
        onCreateSale={handleStartSaleForCustomer}
      />

      <VendorStatementModal
        vendor={detailVendor}
        isOpen={Boolean(detailVendor)}
        onClose={() => setDetailVendor(null)}
        onEditVendor={(v) => {
          setDetailVendor(null);
          setVendorToEdit(v);
          setVendorFormOpen(true);
        }}
      />
    </div>
  );
};
