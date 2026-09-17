import React, { useState, useEffect } from 'react';
import { X, Building2, Phone, MapPin, Hash, Check } from 'lucide-react';
import { Vendor } from '../../types';
import { useErp } from '../../context/ErpContext';

interface VendorMasterModalProps {
  isOpen: boolean;
  onClose: () => void;
  vendorToEdit?: Vendor | null;
  onVendorSaved?: (savedVendor: Vendor) => void;
}

export const VendorMasterModal: React.FC<VendorMasterModalProps> = ({
  isOpen,
  onClose,
  vendorToEdit,
  onVendorSaved,
}) => {
  const { saveVendor } = useErp();

  const [vendorName, setVendorName] = useState('');
  const [contactNo, setContactNo] = useState('');
  const [address, setAddress] = useState('');
  const [gstin, setGstin] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (vendorToEdit) {
      setVendorName(vendorToEdit.vendorName || '');
      setContactNo(vendorToEdit.contactNo || '');
      setAddress(vendorToEdit.address || '');
      setGstin(vendorToEdit.gstin || '');
    } else {
      setVendorName('');
      setContactNo('');
      setAddress('');
      setGstin('');
    }
    setErrors({});
  }, [vendorToEdit, isOpen]);

  if (!isOpen) return null;

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!vendorName.trim()) {
      errs.vendorName = 'Vendor name is required';
    }
    if (!contactNo.trim()) {
      errs.contactNo = 'Contact phone number is required';
    }
    if (!address.trim()) {
      errs.address = 'Office / warehouse address is required';
    }
    if (gstin.trim() && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/i.test(gstin.trim())) {
      errs.gstin = 'Invalid GSTIN format (e.g. 33AABCD1234E1Z5)';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const saved = saveVendor({
      id: vendorToEdit?.id,
      vendorName: vendorName.trim(),
      contactNo: contactNo.trim(),
      address: address.trim(),
      gstin: gstin.trim().toUpperCase() || undefined,
    });

    if (onVendorSaved) {
      onVendorSaved(saved);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-200/60">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {vendorToEdit ? 'Edit Vendor Details' : 'Register New Vendor'}
              </h3>
              <p className="text-xs text-slate-500">
                {vendorToEdit ? 'Update supplier contact & tax credentials' : 'Add supplier to procurement directory'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
          {/* Vendor Name */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Vendor / Company Name <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <Building2 className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                placeholder="e.g. Delta Electronics India Pvt Ltd"
                className={`w-full pl-9.5 pr-3 py-2 text-sm rounded-xl border bg-white focus:outline-hidden focus:ring-2 transition-all ${
                  errors.vendorName
                    ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-100 text-rose-900'
                    : 'border-slate-300 focus:border-blue-500 focus:ring-blue-100 text-slate-900'
                }`}
                autoFocus
              />
            </div>
            {errors.vendorName && (
              <p className="text-xs text-rose-600 mt-1">{errors.vendorName}</p>
            )}
          </div>

          {/* Contact Number */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Contact Number <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <Phone className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={contactNo}
                onChange={(e) => setContactNo(e.target.value)}
                placeholder="e.g. 044-42898000 or 9842100000"
                className={`w-full pl-9.5 pr-3 py-2 text-sm rounded-xl border bg-white focus:outline-hidden focus:ring-2 transition-all ${
                  errors.contactNo
                    ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-100 text-rose-900'
                    : 'border-slate-300 focus:border-blue-500 focus:ring-blue-100 text-slate-900'
                }`}
              />
            </div>
            {errors.contactNo && (
              <p className="text-xs text-rose-600 mt-1">{errors.contactNo}</p>
            )}
          </div>

          {/* Office Address */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Office / Warehouse Address <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <MapPin className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <textarea
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                rows={2}
                placeholder="Plot / Door No., Street, City, State, PIN"
                className={`w-full pl-9.5 pr-3 py-2 text-sm rounded-xl border bg-white focus:outline-hidden focus:ring-2 transition-all resize-none ${
                  errors.address
                    ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-100 text-rose-900'
                    : 'border-slate-300 focus:border-blue-500 focus:ring-blue-100 text-slate-900'
                }`}
              />
            </div>
            {errors.address && (
              <p className="text-xs text-rose-600 mt-1">{errors.address}</p>
            )}
          </div>

          {/* GSTIN (Optional) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                GSTIN / Tax ID
              </label>
              <span className="text-[11px] text-slate-400 font-medium">Optional</span>
            </div>
            <div className="relative">
              <Hash className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={gstin}
                onChange={(e) => setGstin(e.target.value.toUpperCase())}
                placeholder="e.g. 33AABCD1234E1Z5"
                maxLength={15}
                className={`w-full pl-9.5 pr-3 py-2 text-sm font-mono uppercase rounded-xl border bg-white focus:outline-hidden focus:ring-2 transition-all ${
                  errors.gstin
                    ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-100 text-rose-900'
                    : 'border-slate-300 focus:border-blue-500 focus:ring-blue-100 text-slate-900'
                }`}
              />
            </div>
            {errors.gstin ? (
              <p className="text-xs text-rose-600 mt-1">{errors.gstin}</p>
            ) : (
              <p className="text-[11px] text-slate-400 mt-1">15-digit alphanumeric Goods & Services Tax Identification Number</p>
            )}
          </div>

          {/* Form Actions */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-xl shadow-xs transition-colors"
            >
              <Check className="h-4 w-4" />
              {vendorToEdit ? 'Save Changes' : 'Register Vendor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
