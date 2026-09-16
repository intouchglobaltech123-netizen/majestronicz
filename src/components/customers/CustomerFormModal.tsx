import React, { useState, useEffect } from 'react';
import { Customer, CustomerType, cleanCustomerName } from '../../types';
import { useErp } from '../../context/ErpContext';
import { X, User, Phone, MapPin, FileText, Building2 } from 'lucide-react';
import { cn } from '../../lib/utils';

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
      setErrorMessage('Please explicitly select Customer Type (Retail or Organization)');
      return;
    }
    if (!cleanPhone) {
      setErrorMessage('Phone number is required');
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
      phone: phone.trim(),
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
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-5 animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3.5">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600">
              <User className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {customerToEdit ? 'Edit Customer Master' : 'Add New Customer'}
              </h2>
              <p className="text-xs text-slate-500">
                {customerToEdit
                  ? `Update contact and address details for ${customerToEdit.name}`
                  : 'Register a new customer profile in Majestronicz'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-semibold text-rose-700">
            {errorMessage}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Customer Type Selector */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Customer Type <span className="text-rose-500">*</span>
              {!customerType && <span className="text-amber-600 font-semibold ml-2 normal-case tracking-normal">(Required — click to choose)</span>}
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setCustomerType('Retail')}
                className={cn(
                  'p-3 rounded-2xl border text-left flex items-start gap-3 transition-all cursor-pointer',
                  customerType === 'Retail'
                    ? 'bg-blue-50/80 border-blue-500 ring-2 ring-blue-100 text-blue-950 shadow-xs'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                )}
              >
                <div
                  className={cn(
                    'w-8 h-8 rounded-xl flex items-center justify-center shrink-0',
                    customerType === 'Retail' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'
                  )}
                >
                  <User className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs font-extrabold flex items-center gap-1.5">
                    <span>Retail</span>
                    {customerType === 'Retail' && <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                    Individual walk-in buyers, small purchases (loyalty rewards enabled)
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setCustomerType('Organization')}
                className={cn(
                  'p-3 rounded-2xl border text-left flex items-start gap-3 transition-all cursor-pointer',
                  customerType === 'Organization'
                    ? 'bg-purple-50/80 border-purple-500 ring-2 ring-purple-100 text-purple-950 shadow-xs'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                )}
              >
                <div
                  className={cn(
                    'w-8 h-8 rounded-xl flex items-center justify-center shrink-0',
                    customerType === 'Organization' ? 'bg-purple-600 text-white' : 'bg-slate-100 text-slate-500'
                  )}
                >
                  <Building2 className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs font-extrabold flex items-center gap-1.5">
                    <span>Organization</span>
                    {customerType === 'Organization' && <span className="w-1.5 h-1.5 rounded-full bg-purple-600"></span>}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                    Institutional bulk buyers (colleges, schools, companies)
                  </div>
                </div>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Customer / Organization Name <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <input
                type="text"
                required
                placeholder="e.g. Ramesh Kumar or Lakshmi Textile Mills"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
              />
              <User className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Phone Number (Unique Identifier) <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <input
                type="tel"
                required
                placeholder="e.g. 9842100000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono font-semibold text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
              />
              <Phone className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Used to match customers in Sales and prevent duplicate master records.
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Billing Address (Optional)
            </label>
            <div className="relative">
              <textarea
                rows={2}
                placeholder="Street address, locality, city, pincode..."
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
              />
              <MapPin className="h-4 w-4 absolute left-3 top-3 text-slate-400" />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Internal Notes (Optional)
            </label>
            <div className="relative">
              <textarea
                rows={2}
                placeholder="e.g. Preferred delivery timings, reference contact, preferred payment mode..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
              />
              <FileText className="h-4 w-4 absolute left-3 top-3 text-slate-400" />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs transition-colors"
            >
              {customerToEdit ? 'Save Changes' : 'Create Customer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
