import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useErp } from '../../context/ErpContext';
import { Customer, CustomerType, cleanCustomerName, isLoyaltyMilestoneEligible, getLoyaltyProgress, getCustomerOutstandingSummary } from '../../types';
import {
  Search,
  User,
  Phone,
  MapPin,
  Plus,
  Check,
  X,
  Award,
  ChevronDown,
  Building2,
  History,
  ReceiptText,
  Calendar,
  AlertCircle,
} from 'lucide-react';
import { cn, formatCurrency, cleanPhoneDigits } from '../../lib/utils';
import { PhoneInput } from './PhoneInput';

export interface CustomerSearchSelectProps {
  label?: React.ReactNode;
  selectedCustomerId?: string;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  onSelectCustomer: (customer: Customer) => void;
  onClearCustomer?: () => void;
  onCustomerNameChange?: (name: string) => void;
  onCustomerPhoneChange?: (phone: string) => void;
  onCustomerAddressChange?: (address: string) => void;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

export const CustomerSearchSelect: React.FC<CustomerSearchSelectProps> = ({
  label,
  selectedCustomerId,
  customerName,
  customerPhone,
  customerAddress: _customerAddress,
  onSelectCustomer,
  onClearCustomer,
  required = false,
  disabled = false,
  className = '',
}) => {
  const { customers, loyaltySettings, saveCustomer, invoices, hasFlag } = useErp();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);

  // Quick Add form state
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<CustomerType | null>(null);
  const [newPhone, setNewPhone] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [quickAddError, setQuickAddError] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Selected customer object if any
  const selectedCustomer = useMemo(() => {
    if (selectedCustomerId) {
      return customers.find((c) => c.id === selectedCustomerId);
    }
    if (customerPhone) {
      const clean = customerPhone.replace(/\D/g, '');
      if (clean) {
        return customers.find((c) => c.phone.replace(/\D/g, '') === clean);
      }
    }
    if (customerName) {
      return customers.find(
        (c) => c.name.trim().toLowerCase() === customerName.trim().toLowerCase()
      );
    }
    return null;
  }, [customers, selectedCustomerId, customerPhone, customerName]);

  // Customer Invoices & stats calculation for selected customer
  const selectedCustomerInvoices = useMemo(() => {
    if (!selectedCustomer) return [];
    const cleanPhone = (selectedCustomer.phone || '').trim().replace(/\D/g, '');
    return invoices.filter((inv) => {
      if (inv.customerId && inv.customerId === selectedCustomer.id) return true;
      if (cleanPhone && inv.customerPhone) {
        if (inv.customerPhone.trim().replace(/\D/g, '') === cleanPhone) return true;
      }
      if (selectedCustomer.name && inv.customerName) {
        if (inv.customerName.trim().toLowerCase() === selectedCustomer.name.trim().toLowerCase()) {
          return true;
        }
      }
      return false;
    });
  }, [invoices, selectedCustomer]);

  const selectedCustomerTotalSpent = useMemo(() => {
    if (!selectedCustomer) return 0;
    const nonVoided = selectedCustomerInvoices.filter((i) => !i.isVoided);
    if (nonVoided.length > 0) {
      return nonVoided.reduce((sum, i) => sum + i.grandTotal, 0);
    }
    return selectedCustomer.totalSpent || 0;
  }, [selectedCustomer, selectedCustomerInvoices]);

  // Selected customer total outstanding balance across Credit/Partial sales
  const selectedCustomerOutstanding = useMemo(() => {
    if (!selectedCustomer) return { totalOutstanding: 0, unpaidInvoices: [] };
    return getCustomerOutstandingSummary(selectedCustomer, invoices);
  }, [selectedCustomer, invoices]);

  // Filtered customer options matching both Name and Phone
  const filteredCustomers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return customers.slice(0, 15);

    const queryDigits = query.replace(/\D/g, '');
    return customers.filter((c) => {
      const nameMatch = c.name.toLowerCase().includes(query);
      const phoneMatch = queryDigits && c.phone.replace(/\D/g, '').includes(queryDigits);
      const addressMatch = c.address.toLowerCase().includes(query);
      return nameMatch || phoneMatch || addressMatch;
    }).slice(0, 15);
  }, [customers, searchQuery]);

  const handleOpenDropdown = () => {
    if (disabled) return;
    setIsOpen(true);
    setSearchQuery('');
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 50);
  };

  const handleSelect = (customer: Customer) => {
    const cleanName = cleanCustomerName(customer.name, customer.notes);
    onSelectCustomer({
      ...customer,
      name: cleanName,
    });
    setIsOpen(false);
    setSearchQuery('');
  };

  const handleOpenQuickAdd = () => {
    const query = searchQuery.trim();
    const isDigitsOnly = /^[0-9+\s()-]+$/.test(query);

    setNewName(isDigitsOnly ? '' : query);
    setNewType(null);
    setNewPhone(isDigitsOnly ? query : '');
    setNewAddress('');
    setNewNotes('');
    setQuickAddError('');
    setIsQuickAddOpen(true);
    setIsOpen(false);
  };

  const handleSaveQuickAdd = (e: React.FormEvent) => {
    e.preventDefault();
    setQuickAddError('');

    const cleanPhone = cleanPhoneDigits(newPhone);
    const cleanName = cleanCustomerName(newName, newNotes);
    if (!newType) {
      setQuickAddError('Please select Customer Type (Retail or Organization)');
      return;
    }
    if (!cleanPhone) {
      setQuickAddError('Phone number is required');
      return;
    }
    if (cleanPhone.length !== 10) {
      setQuickAddError('Please enter a valid 10-digit mobile number');
      return;
    }
    if (!cleanName) {
      setQuickAddError('Customer name is required');
      return;
    }

    const now = new Date().toISOString();
    const res = saveCustomer({
      id: `cust-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: cleanName,
      customerType: newType,
      phone: cleanPhone,
      address: newAddress.trim(),
      notes: newNotes.trim() || undefined,
      firstPurchaseDate: now.split('T')[0],
      purchaseCount: 0,
      totalSpent: 0,
      createdAt: now,
      updatedAt: now,
    });

    if (!res.success) {
      setQuickAddError(res.error || 'Failed to create customer');
      return;
    }

    if (res.customer) {
      onSelectCustomer(res.customer);
    }
    setIsQuickAddOpen(false);
  };

  return (
    <div ref={containerRef} className={cn('relative w-full space-y-1.5', className)}>
      {label && (
        <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
          <span>
            {label} {required && <span className="text-rose-500">*</span>}
          </span>
          {selectedCustomer && (
            (selectedCustomer.customerType || 'Retail') === 'Organization' ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-none bg-slate-100 border border-slate-300 text-[11px] font-bold text-slate-800">
                <Building2 className="h-3 w-3 text-slate-700" />
                Organization Account
              </span>
            ) : (
              <span className="text-[11px] font-bold text-red-700 font-mono">
                #{selectedCustomer.purchaseCount} purchases
              </span>
            )
          )}
        </label>
      )}

      {/* Main Selected Input / Search Trigger */}
      {selectedCustomer ? (
        <div className="flex items-center justify-between p-2 bg-red-50/60 border border-red-200 rounded-none transition-all">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={cn(
              "w-7 h-7 rounded-none text-white flex items-center justify-center shrink-0 font-bold text-xs shadow-2xs border",
              (selectedCustomer.customerType || 'Retail') === 'Organization' ? "bg-slate-800 border-slate-900" : "bg-red-600 border-red-700"
            )}>
              {(selectedCustomer.customerType || 'Retail') === 'Organization' ? (
                <Building2 className="h-3.5 w-3.5" />
              ) : (
                selectedCustomer.name.charAt(0).toUpperCase()
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-slate-900 truncate">
                  {cleanCustomerName(selectedCustomer.name)}
                </span>
                {(selectedCustomer.customerType || 'Retail') === 'Organization' ? (
                  /* Organization: show purchase history ledger link */
                  <div className="inline-flex items-center gap-1.5 flex-wrap">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-none bg-slate-100 border border-slate-300 text-[10px] font-bold text-slate-800">
                      <Building2 className="h-2.5 w-2.5 text-slate-600" />
                      Organization
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsHistoryModalOpen(true)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-none bg-white hover:bg-slate-100 border border-slate-300 text-[10px] font-bold text-slate-800 transition-colors shadow-2xs cursor-pointer"
                      title="Click to view full purchase history orders & invoices"
                    >
                      <History className="h-3 w-3 text-slate-600" />
                      <span>
                        Purchase History ({selectedCustomerInvoices.length} orders • {formatCurrency(selectedCustomerTotalSpent)})
                      </span>
                    </button>
                  </div>
                ) : (
                  /* Retail: show existing loyalty elements — "#N purchases" and "X/10 to next reward" badge, exactly as currently built */
                  isLoyaltyMilestoneEligible(selectedCustomer, loyaltySettings) ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-100 border border-amber-300 text-[11px] font-bold text-amber-800 animate-pulse">
                      <Award className="h-3 w-3 text-amber-600" />
                      Milestone! ({loyaltySettings.discountValue}{loyaltySettings.discountType === 'percentage' ? '%' : '₹'} Off)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 text-[11px] font-medium text-slate-600">
                      <Award className="h-2.5 w-2.5 text-blue-600" />
                      {getLoyaltyProgress(selectedCustomer, loyaltySettings).label}
                    </span>
                  )
                )}

                {/* Outstanding Balance Indicator — gated by view.customerBalance flag */}
                {!hasFlag('view.customerBalance') ? null : selectedCustomerOutstanding.totalOutstanding > 0 ? (
                  <button
                    type="button"
                    onClick={() => setIsHistoryModalOpen(true)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 hover:bg-amber-100 border border-amber-300 text-[11px] font-extrabold text-amber-900 shadow-2xs transition-colors cursor-pointer"
                    title={`Click to view breakdown of ${selectedCustomerOutstanding.unpaidInvoices.length} unpaid / partial bill(s)`}
                  >
                    <AlertCircle className="h-3 w-3 text-amber-600 shrink-0" />
                    <span>Balance Due: {formatCurrency(selectedCustomerOutstanding.totalOutstanding)}</span>
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-[11px] font-bold text-emerald-700">
                    <Check className="h-2.5 w-2.5 text-emerald-600" />
                    <span>No Balance Due</span>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-0.5 truncate">
                <span className="flex items-center gap-1 font-mono font-medium text-slate-700">
                  <Phone className="h-3 w-3 text-slate-400" />
                  {selectedCustomer.phone}
                </span>
                {selectedCustomer.address && (
                  <span className="flex items-center gap-1 truncate text-slate-500">
                    <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
                    <span className="truncate">{selectedCustomer.address}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0 ml-2">
            <button
              type="button"
              onClick={handleOpenDropdown}
              className="px-2 py-0.5 text-[11px] font-bold text-red-700 hover:bg-red-100 rounded-none border border-red-200 bg-white transition-colors cursor-pointer"
            >
              Change
            </button>
            {onClearCustomer && (
              <button
                type="button"
                onClick={onClearCustomer}
                className="p-1 text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded-none transition-colors cursor-pointer"
                title="Deselect Customer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="relative">
          <button
            type="button"
            onClick={handleOpenDropdown}
            disabled={disabled}
            className={cn(
              'w-full flex items-center justify-between px-3 py-2 rounded-none bg-white border text-left text-xs font-semibold transition-all cursor-pointer',
              isOpen ? 'border-red-600 ring-1 ring-red-600 bg-white' : 'border-slate-300 hover:border-slate-400',
              disabled && 'opacity-60 cursor-not-allowed bg-slate-100'
            )}
          >
            <div className="flex items-center gap-2 text-slate-500 min-w-0">
              <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className={cn('truncate', customerName ? 'text-slate-900 font-bold' : 'text-slate-400 font-normal')}>
                {customerName || 'Search customer by name or phone...'}
              </span>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0 ml-2" />
          </button>
        </div>
      )}

      {/* Dropdown Popup */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-slate-300 rounded-none shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100 max-h-80 flex flex-col">
          {/* Search Header inside dropdown */}
          <div className="p-2 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
            <Search className="h-4 w-4 text-slate-400 shrink-0 ml-1" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Type customer name, phone number, or address..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-transparent text-xs font-semibold text-slate-900 placeholder-slate-400 focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-none cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Quick Add Button Banner */}
          <div className="p-2 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <span className="text-[11px] text-slate-600 font-medium">
              {searchQuery ? `Looking for "${searchQuery}"` : 'Select from Customer Master'}
            </span>
            <button
              type="button"
              onClick={handleOpenQuickAdd}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-none bg-red-600 hover:bg-red-700 text-white text-xs font-bold border border-red-700 transition-colors shadow-2xs cursor-pointer"
            >
              <Plus className="h-3 w-3" />
              <span>Add New Customer</span>
            </button>
          </div>

          {/* List of Results */}
          <div className="overflow-y-auto flex-1 p-1 divide-y divide-slate-100">
            {filteredCustomers.length > 0 ? (
              filteredCustomers.map((cust) => {
                const isSelected = selectedCustomer?.id === cust.id;
                const isOrg = (cust.customerType || 'Retail') === 'Organization';
                const isEligible = !isOrg && isLoyaltyMilestoneEligible(cust, loyaltySettings);
                const progress = getLoyaltyProgress(cust, loyaltySettings);

                return (
                  <button
                    key={cust.id}
                    type="button"
                    onClick={() => handleSelect(cust)}
                    className={cn(
                      'w-full text-left p-2 rounded-none transition-colors flex items-center justify-between gap-3 group cursor-pointer',
                      isSelected ? 'bg-red-50 text-red-950 font-bold' : 'hover:bg-slate-50'
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-slate-900 group-hover:text-red-700 transition-colors">
                          {cleanCustomerName(cust.name, cust.notes)}
                        </span>
                        {isOrg ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-none bg-slate-100 border border-slate-300 text-slate-800 text-[10px] font-bold">
                            <Building2 className="h-2.5 w-2.5 text-slate-600" />
                            Organization
                          </span>
                        ) : isEligible ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-none bg-amber-100 border border-amber-300 text-amber-900 text-[10px] font-bold">
                            <Award className="h-2.5 w-2.5 text-amber-600" />
                            Reward Ready!
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-500 font-medium">
                            ({progress.label})
                          </span>
                        )}

                        {(() => {
                          const custBal = getCustomerOutstandingSummary(cust, invoices).totalOutstanding;
                          if (custBal > 0) {
                            return (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[11px] font-extrabold">
                                <AlertCircle className="h-2.5 w-2.5 text-amber-600" />
                                Due: {formatCurrency(custBal)}
                              </span>
                            );
                          }
                          return null;
                        })()}
                      </div>

                      <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-1">
                        <span className="font-mono font-medium text-slate-700 flex items-center gap-1">
                          <Phone className="h-3 w-3 text-slate-400" />
                          {cust.phone}
                        </span>
                        {cust.address && (
                          <span className="truncate flex items-center gap-1 text-slate-500 max-w-xs">
                            <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
                            <span className="truncate">{cust.address}</span>
                          </span>
                        )}
                        <span className="text-slate-400 ml-auto shrink-0 font-medium">
                          {isOrg ? `${cust.purchaseCount || 0} orders` : `${cust.purchaseCount} bills`}
                        </span>
                      </div>
                    </div>

                    {isSelected && (
                      <Check className="h-4 w-4 text-red-600 shrink-0" />
                    )}
                  </button>
                );
              })
            ) : (
              <div className="py-6 text-center space-y-2">
                <p className="text-xs text-slate-500">No existing customer found matching "{searchQuery}"</p>
                <button
                  type="button"
                  onClick={handleOpenQuickAdd}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-none bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors border border-red-700 shadow-none cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Register "{searchQuery || 'New Customer'}"</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Inline Quick Add Customer Modal */}
      {isQuickAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-none border border-slate-300 shadow-xl max-w-md w-full p-4 sm:p-6 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-none bg-red-50 text-red-700 border border-red-200">
                  <User className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Add New Customer</h3>
                  <p className="text-[11px] text-slate-500">Quickly add to master without leaving this screen</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsQuickAddOpen(false)}
                className="p-1 rounded-none text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {quickAddError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-semibold text-rose-700">
                {quickAddError}
              </div>
            )}

            <form onSubmit={handleSaveQuickAdd} className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Customer Type <span className="text-rose-500">*</span>
                  {!newType && <span className="text-amber-600 font-semibold ml-2 normal-case tracking-normal">(Required — click to choose)</span>}
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewType('Retail')}
                    className={cn(
                      'p-2.5 rounded-none border text-left flex items-start gap-2 transition-all cursor-pointer',
                      newType === 'Retail'
                        ? 'bg-red-50/80 border-red-600 text-red-950 font-bold shadow-2xs'
                        : 'border-slate-300 hover:bg-slate-50 text-slate-700'
                    )}
                  >
                    <User className={cn('h-4 w-4 mt-0.5 shrink-0', newType === 'Retail' ? 'text-red-600' : 'text-slate-400')} />
                    <div>
                      <div className="text-xs font-bold">Retail</div>
                      <div className="text-[11px] text-slate-500 leading-tight">Walk-in buyers, loyalty enabled</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNewType('Organization')}
                    className={cn(
                      'p-2.5 rounded-none border text-left flex items-start gap-2 transition-all cursor-pointer',
                      newType === 'Organization'
                        ? 'bg-slate-100 border-slate-700 text-slate-950 font-bold shadow-2xs'
                        : 'border-slate-300 hover:bg-slate-50 text-slate-700'
                    )}
                  >
                    <Building2 className={cn('h-4 w-4 mt-0.5 shrink-0', newType === 'Organization' ? 'text-slate-700' : 'text-slate-400')} />
                    <div>
                      <div className="text-xs font-bold">Organization</div>
                      <div className="text-[11px] text-slate-500 leading-tight">Colleges, companies, bulk buyer</div>
                    </div>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                  Customer / Company Name <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Kumar or Lakshmi Tex"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-none bg-white border border-slate-300 text-xs font-semibold text-slate-900 focus:outline-none focus:border-red-600"
                />
              </div>

              <PhoneInput
                label="Phone Number (Unique Key)"
                required
                placeholder="98421 00000"
                value={newPhone}
                onChange={setNewPhone}
                helperText="Used to prevent duplicates & track order history"
              />

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                  Billing Address (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Street, City, Postal Code"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-none bg-white border border-slate-300 text-xs font-medium text-slate-900 focus:outline-none focus:border-red-600 resize-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                  Notes (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Referred by Kumar, prefers GPay"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-none bg-white border border-slate-300 text-xs font-medium text-slate-900 focus:outline-none focus:border-red-600"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsQuickAddOpen(false)}
                  className="px-3.5 py-1.5 rounded-none text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-none bg-red-600 hover:bg-red-700 text-white text-xs font-bold border border-red-700 transition-colors shadow-2xs cursor-pointer"
                >
                  Save & Select Customer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Organization Purchase History Modal */}
      {isHistoryModalOpen && selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-none border border-slate-300 shadow-xl max-w-2xl w-full p-4 sm:p-6 space-y-4 animate-in zoom-in-95 duration-150 max-h-[85vh] flex flex-col">
            <div className="flex items-start justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-none bg-slate-100 text-slate-800 border border-slate-300">
                  <Building2 className="h-6 w-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-extrabold text-slate-900">{cleanCustomerName(selectedCustomer.name)}</h3>
                    <span className="px-2 py-0.5 rounded-none bg-slate-800 text-white font-bold text-[11px]">
                      Organization
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Institutional Relationship • Phone: {selectedCustomer.phone}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsHistoryModalOpen(false)}
                className="p-1 rounded-none text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Quick summary cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="p-3 rounded-none bg-slate-50 border border-slate-200">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Total Orders</span>
                <span className="text-lg font-extrabold text-slate-900">{selectedCustomerInvoices.length}</span>
              </div>
              <div className="p-3 rounded-none bg-slate-50 border border-slate-200">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Total Billed</span>
                <span className="text-lg font-extrabold text-slate-900 font-mono">{formatCurrency(selectedCustomerTotalSpent)}</span>
              </div>
              <div className="p-3 rounded-none bg-amber-50/70 border border-amber-200">
                <span className="text-[11px] font-bold text-amber-800 uppercase tracking-wider block">Balance Due</span>
                <span className={cn(
                  "text-lg font-bold font-mono block",
                  selectedCustomerOutstanding.totalOutstanding > 0 ? "text-amber-900" : "text-emerald-700"
                )}>
                  {formatCurrency(selectedCustomerOutstanding.totalOutstanding)}
                </span>
              </div>
              <div className="p-3 rounded-none bg-slate-50 border border-slate-200">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Account Type</span>
                <span className="text-xs font-bold text-slate-800 mt-1 block truncate">
                  {(selectedCustomer.customerType || 'Retail') === 'Organization' ? 'Organization' : 'Retail Customer'}
                </span>
              </div>
            </div>

            {/* Invoices List */}
            <div className="flex-1 overflow-y-auto space-y-2 border border-slate-200 rounded-none p-2 bg-slate-50">
              {selectedCustomerInvoices.length > 0 ? (
                selectedCustomerInvoices.map((inv) => (
                  <div
                    key={inv.id}
                    className="p-3 bg-white rounded-none border border-slate-200 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs text-red-700">#{inv.invoiceNumber}</span>
                        <span className="text-[11px] text-slate-400 flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {inv.date}
                        </span>
                        {inv.isVoided && (
                          <span className="px-1.5 py-0.2 rounded bg-rose-100 text-rose-700 text-[11px] font-bold">
                            Voided
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1 truncate max-w-sm">
                        {inv.items.map((it) => `${it.quantity}x ${it.itemName}`).join(', ')}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-extrabold text-xs text-slate-900">
                        {formatCurrency(inv.grandTotal)}
                      </div>
                      <span className="text-[11px] text-slate-400 font-medium block">{inv.paymentMode}</span>
                      {(() => {
                        let due = 0;
                        let paid = inv.grandTotal;
                        if (inv.isPartialPayment) {
                          paid = inv.partialAmount || 0;
                          due = inv.balanceDue !== undefined ? inv.balanceDue : Math.max(0, inv.grandTotal - paid);
                        } else if (inv.transactionType === 'Credit' || inv.paymentMode === 'COD-Credit') {
                          paid = 0;
                          due = inv.balanceDue !== undefined ? inv.balanceDue : inv.grandTotal;
                        } else if (inv.balanceDue && inv.balanceDue > 0) {
                          due = inv.balanceDue;
                          paid = Math.max(0, inv.grandTotal - due);
                        }
                        if (due > 0) {
                          return (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300 mt-0.5">
                              Due: {formatCurrency(due)}
                            </span>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-8 text-center text-slate-400">
                  <ReceiptText className="h-8 w-8 mx-auto text-slate-300 mb-1" />
                  <p className="text-xs font-semibold text-slate-600">No prior sales invoices recorded yet</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Completing this sale will establish their order history</p>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsHistoryModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
