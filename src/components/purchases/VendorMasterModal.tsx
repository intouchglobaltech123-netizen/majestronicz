import React, { useState, useEffect } from 'react';
import { X, Building2, MapPin, Hash, Check } from 'lucide-react';
import { Vendor } from '../../types';
import { useErp } from '../../context/ErpContext';
import { cleanPhoneDigits } from '../../lib/utils';
import { apiGet } from '../../lib/api';
import { PhoneInput } from '../common/PhoneInput';

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

  // GSTIN verification: checked on blur, never on every keystroke — a lookup
  // costs an API call, and a half-typed number is guaranteed to fail.
  type GstinCheck = {
    gstin: string; valid: boolean; source: 'offline' | 'api' | 'cache';
    legalName?: string; tradeName?: string; status?: string; message?: string;
  };
  const [gstinCheck, setGstinCheck] = useState<GstinCheck | null>(null);
  const [gstinChecking, setGstinChecking] = useState(false);

  const verifyGstin = async (value: string) => {
    const g = value.trim().toUpperCase();
    setGstinCheck(null);
    if (g.length !== 15) return;
    setGstinChecking(true);
    try {
      setGstinCheck(await apiGet<GstinCheck>(`/api/gstin/${g}`));
    } catch {
      // A failed check must never block saving a vendor — the field stays
      // usable and the form's own format rule still applies.
      setGstinCheck(null);
    } finally {
      setGstinChecking(false);
    }
  };

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
    const cleanPhone = cleanPhoneDigits(contactNo);
    if (!cleanPhone) {
      errs.contactNo = 'Contact phone number is required';
    } else if (cleanPhone.length !== 10) {
      errs.contactNo = 'Please enter a valid 10-digit phone number';
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
      contactNo: cleanPhoneDigits(contactNo),
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
      <div className="bg-white rounded-none shadow-xl border border-slate-300 w-full max-w-lg overflow-y-auto max-h-[90vh] flex flex-col">
        {/* Modal Header */}
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-none bg-red-50 text-red-700 flex items-center justify-center border border-red-200 shrink-0">
              <Building2 className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {vendorToEdit ? 'Edit Vendor Details' : 'Register New Vendor'}
              </h3>
              <p className="text-[11px] text-slate-500">
                {vendorToEdit ? 'Update supplier contact & tax credentials' : 'Add supplier to procurement directory'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-none transition-colors border border-transparent hover:border-slate-300 cursor-pointer"
          >
            <X className="h-4 w-4" />
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
          <PhoneInput
            label="Contact Number"
            required
            value={contactNo}
            onChange={setContactNo}
            error={errors.contactNo}
            placeholder="98421 00000"
          />

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
                onChange={(e) => { setGstin(e.target.value.toUpperCase()); setGstinCheck(null); }}
                onBlur={(e) => verifyGstin(e.target.value)}
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
            ) : gstinChecking ? (
              <p className="text-[11px] text-slate-400 mt-1">Checking GSTIN…</p>
            ) : gstinCheck && !gstinCheck.valid ? (
              <p className="text-xs text-rose-600 mt-1">{gstinCheck.message || 'This GSTIN is not valid.'}</p>
            ) : gstinCheck?.legalName ? (
              <p className="text-[11px] text-emerald-700 mt-1">
                {gstinCheck.legalName}
                {gstinCheck.status ? ` · ${gstinCheck.status}` : ''}
                {!vendorName.trim() && (
                  <button
                    type="button"
                    onClick={() => setVendorName(gstinCheck.legalName!)}
                    className="ml-2 underline hover:no-underline"
                  >
                    use as vendor name
                  </button>
                )}
              </p>
            ) : gstinCheck?.valid ? (
              <p className="text-[11px] text-slate-500 mt-1">{gstinCheck.message || 'Valid GSTIN.'}</p>
            ) : (
              <p className="text-[11px] text-slate-400 mt-1">15-digit alphanumeric Goods &amp; Services Tax Identification Number</p>
            )}
          </div>

          {/* Form Actions */}
          <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-none cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 active:bg-red-800 rounded-none border border-red-700 transition-colors shadow-2xs cursor-pointer"
            >
              <Check className="h-3.5 w-3.5" />
              <span>{vendorToEdit ? 'Save Changes' : 'Register Vendor'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
