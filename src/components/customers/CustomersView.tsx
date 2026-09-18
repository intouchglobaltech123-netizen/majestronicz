import React, { useState, useMemo, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import { Customer, computeInvoiceFinance } from '../../types';
import { isLoyaltyMilestoneEligible, getLoyaltyProgress } from '../../types/customer';
import { formatCurrency, cn } from '../../lib/utils';
import {
  Users,
  Search,
  Plus,
  Phone,
  MapPin,
  Award,
  Edit2,
  Receipt,
  ArrowUpDown,
  Building2,
  User,
  AlertCircle,
} from 'lucide-react';
import { CustomerDetailModal } from './CustomerDetailModal';
import { CustomerFormModal } from './CustomerFormModal';
import { LoyaltySettingsTab } from './LoyaltySettingsTab';

export const CustomersView: React.FC = () => {
  const {
    customers,
    invoices,
    loyaltySettings,
    setCurrentView,
    selectedCustomerForDetail,
    setSelectedCustomerForDetail,
    getCustomerOutstandingBalance,
    activeSubTab,
  } = useErp();

  // Navigation tab: directory vs loyalty
  const [activeTab, setActiveTab] = useState<'directory' | 'loyalty'>('directory');

  // Synchronize view tab and actions when triggered from secondary navbar flyout
  useEffect(() => {
    if (activeSubTab?.view === 'customers') {
      const tab = activeSubTab.tab;
      if (tab === 'directory' || tab === 'loyalty') {
        setActiveTab(tab);
      } else if (tab === 'new-customer') {
        setIsAddModalOpen(true);
      }
    }
  }, [activeSubTab]);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'Retail' | 'Organization'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'milestone-ready' | 'in-progress'>('all');
  const [sortBy, setSortBy] = useState<'purchases' | 'spent' | 'name' | 'recent'>('purchases');

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [customerToEdit, setCustomerToEdit] = useState<Customer | null>(null);

  // Statistics
  const totalCustomers = customers.length;
  const milestoneReadyCount = useMemo(() => {
    return customers.filter((c) => isLoyaltyMilestoneEligible(c, loyaltySettings)).length;
  }, [customers, loyaltySettings]);

  const totalSalesRevenue = useMemo(() => {
    return customers.reduce((sum, c) => sum + (c.totalSpent || 0), 0);
  }, [customers]);

  const assignedOutstandingDues = useMemo(() => {
    return customers.reduce((sum, c) => sum + getCustomerOutstandingBalance(c), 0);
  }, [customers, getCustomerOutstandingBalance]);

  // Total receivables across ALL non-voided invoices (single finance-truth) — this
  // is the authoritative figure the Dashboard/Reports show. Anything not attributable
  // to a customer record is "unassigned" and flagged so the numbers reconcile.
  const totalReceivables = useMemo(
    () => invoices.filter((i) => !i.isVoided).reduce((sum, i) => sum + computeInvoiceFinance(i).due, 0),
    [invoices]
  );
  const unassignedDues = Math.max(0, Math.round((totalReceivables - assignedOutstandingDues) * 100) / 100);
  const totalOutstandingDues = assignedOutstandingDues;

  const customersWithDueCount = useMemo(() => {
    return customers.filter((c) => getCustomerOutstandingBalance(c) > 0).length;
  }, [customers, getCustomerOutstandingBalance]);

  const avgPurchases = useMemo(() => {
    if (totalCustomers === 0) return 0;
    const totalPurchases = customers.reduce((sum, c) => sum + (c.purchaseCount || 0), 0);
    return Math.round((totalPurchases / totalCustomers) * 10) / 10;
  }, [customers, totalCustomers]);

  // Segmentation: institutional accounts vs walk-in retail.
  const orgCount = useMemo(
    () => customers.filter((c) => (c.customerType || 'Retail') === 'Organization').length,
    [customers]
  );

  // Filtered & Sorted Customers
  const filteredCustomers = useMemo(() => {
    let result = [...customers];

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const qDigits = q.replace(/\D/g, '');
      result = result.filter((c) => {
        const nameMatch = c.name.toLowerCase().includes(q);
        const phoneMatch = qDigits && c.phone.replace(/\D/g, '').includes(qDigits);
        const addressMatch = c.address.toLowerCase().includes(q);
        return nameMatch || phoneMatch || addressMatch;
      });
    }

    // Type Filter (Retail vs Organization)
    if (typeFilter !== 'all') {
      result = result.filter((c) => (c.customerType || 'Retail') === typeFilter);
    }

    // Status Filter
    if (statusFilter === 'milestone-ready') {
      result = result.filter((c) => isLoyaltyMilestoneEligible(c, loyaltySettings));
    } else if (statusFilter === 'in-progress') {
      result = result.filter((c) => !isLoyaltyMilestoneEligible(c, loyaltySettings));
    }

    // Sort
    result.sort((a, b) => {
      if (sortBy === 'purchases') {
        return (b.purchaseCount || 0) - (a.purchaseCount || 0);
      }
      if (sortBy === 'spent') {
        return (b.totalSpent || 0) - (a.totalSpent || 0);
      }
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name);
      }
      if (sortBy === 'recent') {
        return new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime();
      }
      return 0;
    });

    return result;
  }, [customers, searchQuery, typeFilter, statusFilter, sortBy, loyaltySettings]);

  const handleStartSaleForCustomer = (_customer: Customer) => {
    setSelectedCustomerForDetail(null);
    setCurrentView('invoices');
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* Top Header Card */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
            {activeTab === 'loyalty' ? 'Loyalty Program & Reward Rules' : 'Customer Directory'}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {activeTab === 'loyalty'
              ? 'Configure tier milestones, reward thresholds, and loyalty perks.'
              : 'Customer CRM, purchase frequency tracker, and receivables directory.'}
          </p>
        </div>

        {/* Action Button */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => {
              setCustomerToEdit(null);
              setIsAddModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>Add Customer</span>
          </button>
        </div>
      </div>

      {activeTab === 'loyalty' ? (
        <LoyaltySettingsTab />
      ) : (
        <>
          {/* KPI Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            {/* Total Customers */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                Total Customers
              </span>
              <div className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">{totalCustomers}</div>
              <span className="text-[11px] text-slate-400 mt-0.5 block">Unique verified phones</span>
            </div>

            {/* Total Outstanding Dues */}
            <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-900 block">
                  Total Outstanding Dues
                </span>
                <AlertCircle className="h-4 w-4 text-amber-600" />
              </div>
              <div className="text-xl sm:text-2xl font-bold text-amber-950 mt-1 font-mono">
                {formatCurrency(totalOutstandingDues)}
              </div>
              <span className="text-[11px] text-amber-800 mt-0.5 block font-semibold">
                {customersWithDueCount} customer{customersWithDueCount === 1 ? '' : 's'} with balance due
              </span>
              {unassignedDues > 0 && (
                <span className="text-[11px] text-rose-700 mt-1 block font-bold bg-rose-50 border border-rose-200 rounded px-1.5 py-0.5">
                  + {formatCurrency(unassignedDues)} on invoices not linked to a customer — review &amp; assign
                </span>
              )}
            </div>

            {/* Milestone Ready */}
            <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-900 block">
                  Reward Eligible Now
                </span>
                <Award className="h-4 w-4 text-amber-600" />
              </div>
              <div className="text-xl sm:text-2xl font-bold text-amber-950 mt-1">
                {milestoneReadyCount}{' '}
                <span className="text-xs font-bold text-amber-700">customers</span>
              </div>
              <span className="text-[11px] text-amber-800 mt-0.5 block">
                Eligible for {loyaltySettings.discountValue}
                {loyaltySettings.discountType === 'percentage' ? '%' : '₹'} off
              </span>
            </div>

            {/* Lifetime Revenue */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                Total Customer Sales
              </span>
              <div className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">
                {formatCurrency(totalSalesRevenue)}
              </div>
              <span className="text-[11px] text-slate-400 mt-0.5 block">
                Aggregated non-voided sales
              </span>
            </div>

            {/* Average Purchases */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                Average Frequency
              </span>
              <div className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">
                {avgPurchases} <span className="text-xs font-bold text-slate-500">bills / cust</span>
              </div>
              <span className="text-[11px] text-slate-400 mt-0.5 block">
                Rule: Every {loyaltySettings.purchaseThreshold} gives reward
              </span>
            </div>

            {/* Segmentation: Organizations vs Retail */}
            <div className="bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-200 rounded-xl p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-purple-900 block">
                  Institutional
                </span>
                <Building2 className="h-4 w-4 text-purple-600" />
              </div>
              <div className="text-xl sm:text-2xl font-bold text-purple-950 mt-1">
                {orgCount} <span className="text-xs font-bold text-purple-700">orgs</span>
              </div>
              <span className="text-[11px] text-purple-800 mt-0.5 block">
                {totalCustomers - orgCount} retail · {totalCustomers} total
              </span>
            </div>
          </div>

          {/* Search, Filter & Sort Toolbar */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
            {/* Search input */}
            <div className="relative flex-1 max-w-md">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search customers by name, phone, or address..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
              />
            </div>

            {/* Filters */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Type filter */}
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl text-xs font-bold text-slate-600">
                <button
                  type="button"
                  onClick={() => setTypeFilter('all')}
                  className={cn(
                    'px-3 py-1.5 rounded-lg transition-all cursor-pointer',
                    typeFilter === 'all' ? 'bg-white text-slate-900 shadow-2xs' : 'hover:text-slate-900'
                  )}
                >
                  All Types
                </button>
                <button
                  type="button"
                  onClick={() => setTypeFilter('Retail')}
                  className={cn(
                    'px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer',
                    typeFilter === 'Retail'
                      ? 'bg-blue-600 text-white shadow-2xs'
                      : 'hover:text-slate-900'
                  )}
                >
                  <User className="h-3 w-3" />
                  <span>Retail ({customers.filter((c) => (c.customerType || 'Retail') === 'Retail').length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTypeFilter('Organization')}
                  className={cn(
                    'px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer',
                    typeFilter === 'Organization'
                      ? 'bg-purple-600 text-white shadow-2xs'
                      : 'hover:text-slate-900'
                  )}
                >
                  <Building2 className="h-3 w-3" />
                  <span>Organization ({customers.filter((c) => (c.customerType || 'Retail') === 'Organization').length})</span>
                </button>
              </div>

              {/* Status filter */}
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl text-xs font-bold text-slate-600">
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className={cn(
                    'px-3 py-1.5 rounded-lg transition-all cursor-pointer',
                    statusFilter === 'all' ? 'bg-white text-slate-900 shadow-2xs' : 'hover:text-slate-900'
                  )}
                >
                  All Status
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('milestone-ready')}
                  className={cn(
                    'px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer',
                    statusFilter === 'milestone-ready'
                      ? 'bg-amber-100 text-amber-900 shadow-2xs'
                      : 'hover:text-amber-900'
                  )}
                >
                  <Award className="h-3 w-3 text-amber-600" />
                  <span>Reward Ready ({milestoneReadyCount})</span>
                </button>
              </div>

              {/* Sort selector */}
              <div className="flex items-center gap-1 text-xs font-semibold text-slate-500">
                <ArrowUpDown className="h-3.5 w-3.5 text-slate-400 ml-2" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-600"
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

                      return (
                        <tr
                          key={cust.id}
                          className={cn(
                            'hover:bg-slate-50/80 transition-colors',
                            isEligible && 'bg-amber-50/30'
                          )}
                        >
                          {/* Customer Name */}
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <div className={cn(
                                "w-9 h-9 rounded-xl font-extrabold flex items-center justify-center shrink-0",
                                isOrg ? "bg-purple-100 text-purple-700" : "bg-blue-600/10 text-blue-700"
                              )}>
                                {isOrg ? <Building2 className="h-4 w-4" /> : cust.name.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <button
                                  type="button"
                                  onClick={() => setSelectedCustomerForDetail(cust)}
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

                          {/* Type */}
                          <td className="p-4 whitespace-nowrap">
                            {isOrg ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-purple-50 border border-purple-200 text-purple-700 font-bold text-[11px]">
                                <Building2 className="h-3 w-3 text-purple-600" />
                                Organization
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-blue-50 border border-blue-200 text-blue-700 font-bold text-[11px]">
                                <User className="h-3 w-3 text-blue-600" />
                                Retail
                              </span>
                            )}
                          </td>

                          {/* Phone */}
                          <td className="p-4 whitespace-nowrap">
                            <span className="font-mono font-semibold text-slate-700 flex items-center gap-1.5">
                              <Phone className="h-3.5 w-3.5 text-slate-400" />
                              {cust.phone}
                            </span>
                          </td>

                          {/* Address */}
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

                          {/* Purchase Count */}
                          <td className="p-4 text-center">
                            <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-900 font-extrabold text-xs">
                              {cust.purchaseCount}
                            </span>
                          </td>

                          {/* Lifetime Spent */}
                          <td className="p-4 text-right font-mono font-bold text-slate-900">
                            {formatCurrency(cust.totalSpent || 0)}
                          </td>

                          {/* Balance Due */}
                          <td className="p-4 text-right">
                            {(() => {
                              const bal = getCustomerOutstandingBalance(cust);
                              if (bal > 0) {
                                return (
                                  <button
                                    type="button"
                                    onClick={() => setSelectedCustomerForDetail(cust)}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 hover:bg-amber-100 border border-amber-300 text-xs font-mono font-bold text-amber-900 shadow-2xs transition-colors cursor-pointer"
                                    title="Click to view breakdown of unpaid bills"
                                  >
                                    <AlertCircle className="h-3 w-3 text-amber-600" />
                                    <span>{formatCurrency(bal)}</span>
                                  </button>
                                );
                              }
                              return <span className="text-slate-400 font-mono text-xs">₹0</span>;
                            })()}
                          </td>

                          {/* Loyalty Status Badge */}
                          <td className="p-4">
                            {isOrg ? (
                              <span
                                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px] font-medium"
                                title="Organizations receive bulk partner tracking without loyalty milestones"
                              >
                                <Building2 className="h-3 w-3 text-purple-600" />
                                <span>Bulk Relationship (No Loyalty Rules)</span>
                              </span>
                            ) : isEligible ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-100 border border-amber-300 text-amber-900 font-bold text-[11px] animate-pulse">
                                <Award className="h-3 w-3 text-amber-600" />
                                <span>
                                  Reward Available ({loyaltySettings.discountValue}
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

                          {/* Actions */}
                          <td className="p-4 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => setSelectedCustomerForDetail(cust)}
                                className="px-2.5 py-1.5 rounded-lg text-slate-600 hover:text-blue-600 hover:bg-slate-100 text-xs font-bold transition-colors"
                              >
                                History
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setCustomerToEdit(cust);
                                  setIsAddModalOpen(true);
                                }}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                                title="Edit Customer"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleStartSaleForCustomer(cust)}
                                className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
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
                    setIsAddModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors shadow-2xs"
                >
                  <Plus className="h-4 w-4" />
                  <span>Add New Customer</span>
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Customer Detail Modal */}
      <CustomerDetailModal
        customer={selectedCustomerForDetail}
        isOpen={Boolean(selectedCustomerForDetail)}
        onClose={() => setSelectedCustomerForDetail(null)}
        onEditCustomer={(cust) => {
          setSelectedCustomerForDetail(null);
          setCustomerToEdit(cust);
          setIsAddModalOpen(true);
        }}
        onCreateSale={handleStartSaleForCustomer}
      />

      {/* Customer Form Modal */}
      <CustomerFormModal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          setCustomerToEdit(null);
        }}
        customerToEdit={customerToEdit}
      />
    </div>
  );
};
