import React, { useState, useEffect } from 'react';
import { Customer, CustomerType, cleanCustomerName } from '../../types';
import { useErp } from '../../context/ErpContext';
import { X, User, MapPin, FileText, Building2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { PhoneInput } from '../common/PhoneInput';

interface CustomerFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerToEdit?: Customer | null;
  onSaved?: (customer: Customer) => void;
}

export const CustomerFormModal: React.FC<CustomerFormModalProps> = ({
  isOpen,
  onClose,
  customerToEdit,
  onSaved,
}) => {
  const { saveCustomer } = useErp();
  const [customerType, setCustomerType] = useState<CustomerType | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (customerToEdit) {
      setCustomerType(customerToEdit.customerType || 'Retail');
      setName(customerToEdit.name);
      setPhone(customerToEdit.phone);
      setAddress(customerToEdit.address || '');
      setNotes(customerToEdit.notes || '');
    } else {
      setCustomerType(null);
      setName('');
      setPhone('');
      setAddress('');
      setNotes('');
    }
    setErrorMessage('');
  }, [customerToEdit, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    const cleanPhone = phone.trim().replace(/\D/g, '');
    const cleanName = cleanCustomerName(name, notes);

    if (!customerType) {
      setErrorMessage('Please explicitly select Customer Type (Retail or Wholesale)');
      return;
    }
    if (!cleanPhone) {
      setErrorMessage('Phone number is required');
      return;
    }
    // Normalize like the backend (strip 91 / leading 0) then require 10 digits.
    let normalizedPhone = cleanPhone;
    if (normalizedPhone.length === 12 && normalizedPhone.startsWith('91')) normalizedPhone = normalizedPhone.slice(2);
    if (normalizedPhone.length === 11 && normalizedPhone.startsWith('0')) normalizedPhone = normalizedPhone.slice(1);
    if (normalizedPhone.length !== 10) {
      setErrorMessage('Enter a valid 10-digit phone number');
      return;
    }
    if (!cleanName) {
      setErrorMessage('Customer name is required');
      return;
    }

    const payload: Customer = {
      id: customerToEdit ? customerToEdit.id : `cust-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: cleanName,
      customerType,
      phone: normalizedPhone,
      address: address.trim(),
      notes: notes.trim() || undefined,
      firstPurchaseDate: customerToEdit?.firstPurchaseDate || new Date().toISOString().split('T')[0],
      purchaseCount: customerToEdit?.purchaseCount ?? 0,
      totalSpent: customerToEdit?.totalSpent ?? 0,
      lastRewardRedeemedPurchaseCount: customerToEdit?.lastRewardRedeemedPurchaseCount,
      createdAt: customerToEdit?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const res = saveCustomer(payload);
    if (!res.success) {
      setErrorMessage(res.error || 'Failed to save customer');
      return;
    }

    if (onSaved && res.customer) {
      onSaved(res.customer);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-none border border-slate-300 shadow-xl max-w-lg w-full p-5 space-y-4 animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-none bg-red-50 text-red-700 border border-red-200 flex items-center justify-center">
              <User className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                {customerToEdit ? 'Edit Customer Master' : 'Add New Customer'}
              </h2>
              <p className="text-[11px] text-slate-500">
                {customerToEdit
                  ? `Update contact and address details for ${customerToEdit.name}`
                  : 'Register a new customer profile in Majestronicz'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-none text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors border border-transparent hover:border-slate-300 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="p-2.5 bg-rose-50 border border-rose-300 rounded-none text-xs font-semibold text-rose-700">
            {errorMessage}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5">
          {/* Customer Type Selector */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
              Customer Type <span className="text-red-600">*</span>
              {!customerType && <span className="text-amber-700 font-semibold ml-2 normal-case tracking-normal">(Required — click to choose)</span>}
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setCustomerType('Retail')}
                className={cn(
                  'p-2.5 rounded-none border text-left flex items-start gap-2.5 transition-all cursor-pointer',
                  customerType === 'Retail'
                    ? 'bg-red-50/80 border-red-600 text-red-950 font-bold shadow-2xs'
                    : 'border-slate-300 hover:bg-slate-50 text-slate-700'
                )}
              >
                <div
                  className={cn(
                    'w-7 h-7 rounded-none flex items-center justify-center shrink-0',
                    customerType === 'Retail' ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-500 border border-slate-200'
                  )}
                >
                  <User className="h-3.5 w-3.5" />
                </div>
                <div>
                  <div className="text-xs font-bold flex items-center gap-1.5">
                    <span>Retail</span>
                    {customerType === 'Retail' && <span className="w-1.5 h-1.5 rounded-none bg-red-600"></span>}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                    Individual walk-in buyers, small purchases (loyalty rewards)
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setCustomerType('Organization')}
                className={cn(
                  'p-2.5 rounded-none border text-left flex items-start gap-2.5 transition-all cursor-pointer',
                  customerType === 'Organization'
                    ? 'bg-slate-100 border-slate-700 text-slate-950 font-bold shadow-2xs'
                    : 'border-slate-300 hover:bg-slate-50 text-slate-700'
                )}
              >
                <div
                  className={cn(
                    'w-7 h-7 rounded-none flex items-center justify-center shrink-0',
                    customerType === 'Organization' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 border border-slate-200'
                  )}
                >
                  <Building2 className="h-3.5 w-3.5" />
                </div>
                <div>
                  <div className="text-xs font-bold flex items-center gap-1.5">
                    <span>Wholesale</span>
                    {customerType === 'Organization' && <span className="w-1.5 h-1.5 rounded-none bg-slate-800"></span>}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                    Institutional bulk buyers (colleges, schools, companies)
                  </div>
                </div>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
              Customer / Wholesale Name <span className="text-red-600">*</span>
            </label>
            <div className="relative">
              <input
                type="text"
                required
                placeholder="e.g. Ramesh Kumar or Lakshmi Textile Mills"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full pl-8 pr-3 py-2 rounded-none bg-white border border-slate-300 text-xs font-semibold text-slate-900 focus:outline-none focus:border-red-600 transition-all"
              />
              <User className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          <PhoneInput
            label="Phone Number (Unique Identifier)"
            required
            placeholder="98421 00000"
            value={phone}
            onChange={setPhone}
            helperText="Used to match customers in Sales and prevent duplicate master records."
          />

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
              Billing Address (Optional)
            </label>
            <div className="relative">
              <textarea
                rows={2}
                placeholder="Street address, locality, city, pincode..."
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 rounded-none bg-white border border-slate-300 text-xs font-medium text-slate-900 focus:outline-none focus:border-red-600 transition-all resize-none"
              />
              <MapPin className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-slate-400" />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
              Internal Notes (Optional)
            </label>
            <div className="relative">
              <textarea
                rows={2}
                placeholder="e.g. Preferred delivery timings, reference contact, preferred payment mode..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 rounded-none bg-white border border-slate-300 text-xs font-medium text-slate-900 focus:outline-none focus:border-red-600 transition-all resize-none"
              />
              <FileText className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-slate-400" />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-none cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-none border border-red-700 cursor-pointer shadow-2xs transition-colors"
            >
              {customerToEdit ? 'Save Changes' : 'Create Customer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
