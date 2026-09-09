import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useErp } from '../../context/ErpContext';
import { Customer, isLoyaltyMilestoneEligible, getLoyaltyProgress } from '../../types';
import {
  Search,
  User,
  Phone,
  MapPin,
  Plus,
  Check,
  X,
  Sparkles,
  Award,
  ChevronDown,
} from 'lucide-react';
import { cn } from '../../lib/utils';

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
  const { customers, loyaltySettings, saveCustomer } = useErp();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);

  // Quick Add form state
  const [newName, setNewName] = useState('');
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
    onSelectCustomer(customer);
    setIsOpen(false);
    setSearchQuery('');
  };

  const handleOpenQuickAdd = () => {
    const query = searchQuery.trim();
    const isDigitsOnly = /^[0-9+\s()-]+$/.test(query);

    setNewName(isDigitsOnly ? '' : query);
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

    const cleanPhone = newPhone.trim().replace(/\D/g, '');
    if (!cleanPhone) {
      setQuickAddError('Phone number is required');
      return;
    }
    if (!newName.trim()) {
      setQuickAddError('Customer name is required');
      return;
    }

    const now = new Date().toISOString();
    const res = saveCustomer({
      id: `cust-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: newName.trim(),
      phone: newPhone.trim(),
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
            <span className="text-[10px] font-semibold text-blue-600">
              #{selectedCustomer.purchaseCount} purchases
            </span>
          )}
        </label>
      )}

      {/* Main Selected Input / Search Trigger */}
      {selectedCustomer ? (
        <div className="flex items-center justify-between p-2.5 bg-blue-50/70 border border-blue-200 rounded-xl transition-all">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0 font-bold text-xs">
              {selectedCustomer.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-slate-900 truncate">
                  {selectedCustomer.name}
                </span>
                {isLoyaltyMilestoneEligible(selectedCustomer, loyaltySettings) ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-100 border border-amber-300 text-[10px] font-bold text-amber-800 animate-pulse">
                    <Sparkles className="h-3 w-3 text-amber-600" />
                    Milestone! ({loyaltySettings.discountValue}{loyaltySettings.discountType === 'percentage' ? '%' : '₹'} Off)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 text-[10px] font-medium text-slate-600">
                    <Award className="h-2.5 w-2.5 text-blue-600" />
                    {getLoyaltyProgress(selectedCustomer, loyaltySettings).label}
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
              className="px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 rounded-lg transition-colors"
            >
              Change
            </button>
            {onClearCustomer && (
              <button
                type="button"
                onClick={onClearCustomer}
                className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
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
              'w-full flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 border text-left text-xs font-semibold transition-all',
              isOpen ? 'border-blue-600 ring-2 ring-blue-100 bg-white' : 'border-slate-200 hover:border-slate-300',
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
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100 max-h-80 flex flex-col">
          {/* Search Header inside dropdown */}
          <div className="p-2 border-b border-slate-100 bg-slate-50/60 flex items-center gap-2">
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
                className="p-1 text-slate-400 hover:text-slate-600 rounded-md"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Quick Add Button Banner */}
          <div className="p-2 border-b border-slate-100 bg-blue-50/40 flex items-center justify-between">
            <span className="text-[11px] text-slate-600 font-medium">
              {searchQuery ? `Looking for "${searchQuery}"` : 'Select from Customer Master'}
            </span>
            <button
              type="button"
              onClick={handleOpenQuickAdd}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors shadow-2xs"
            >
              <Plus className="h-3 w-3" />
              <span>+ Add New Customer</span>
            </button>
          </div>

          {/* List of Results */}
          <div className="overflow-y-auto flex-1 p-1 divide-y divide-slate-50">
            {filteredCustomers.length > 0 ? (
              filteredCustomers.map((cust) => {
                const isSelected = selectedCustomer?.id === cust.id;
                const isEligible = isLoyaltyMilestoneEligible(cust, loyaltySettings);
                const progress = getLoyaltyProgress(cust, loyaltySettings);

                return (
                  <button
                    key={cust.id}
                    type="button"
                    onClick={() => handleSelect(cust)}
                    className={cn(
                      'w-full text-left p-2.5 rounded-xl transition-colors flex items-center justify-between gap-3 group',
                      isSelected ? 'bg-blue-50/80 text-blue-900' : 'hover:bg-slate-50'
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                          {cust.name}
                        </span>
                        {isEligible ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">
                            <Sparkles className="h-2.5 w-2.5 text-amber-600" />
                            Reward Ready!
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-500 font-medium">
                            ({progress.label})
                          </span>
                        )}
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
                          {cust.purchaseCount} bills
                        </span>
                      </div>
                    </div>

                    {isSelected && (
                      <Check className="h-4 w-4 text-blue-600 shrink-0" />
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
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors shadow-2xs"
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
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
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
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
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
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Customer / Company Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Kumar or Lakshmi Tex"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Phone Number (Unique Key) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="tel"
                  required
                  placeholder="e.g. 9842100000"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono font-semibold text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white"
                />
                <p className="text-[10px] text-slate-400 mt-1">Used to prevent duplicates & track loyalty purchases</p>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Billing Address (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Street, City, Postal Code"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Notes (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Referred by Kumar, prefers GPay"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsQuickAddOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors shadow-xs"
                >
                  Save & Select Customer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
