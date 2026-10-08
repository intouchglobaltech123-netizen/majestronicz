import React, { useEffect, useState } from 'react';
import { useErp } from '../../context/ErpContext';
import { CompanyProfile } from '../../types';
import { Save, Building2, Landmark, QrCode as QrIcon } from 'lucide-react';
import { toast } from 'sonner';
import { QrCode } from '../common/QrCode';

/**
 * #6 — edit the company + invoice details printed on the GST bill: website and
 * Google-review links (shown as QR codes) and bank/UPI details (shown as a
 * payment block). CEO / Manager only.
 */
export const CompanyProfileSettings: React.FC = () => {
  const { companyProfile, updateCompanyProfile, currentUser } = useErp();
  const canEdit = currentUser.role === 'CEO' || currentUser.role === 'Manager';
  const [form, setForm] = useState<CompanyProfile>(companyProfile);

  useEffect(() => { setForm(companyProfile); }, [companyProfile]);

  const set = (k: keyof CompanyProfile, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) { toast.error('Only CEO or Manager can edit company details'); return; }
    if (!form.name.trim()) { toast.error('Company name is required'); return; }
    updateCompanyProfile(form);
  };

  const field = (label: string, k: keyof CompanyProfile, placeholder = '', mono = false) => (
    <div className="space-y-1">
      <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600">{label}</label>
      <input
        type="text" disabled={!canEdit}
        value={(form[k] as string) || ''}
        onChange={(e) => set(k, e.target.value)}
        placeholder={placeholder}
        className={`w-full px-3 py-2 rounded-none bg-white border border-slate-300 text-sm text-slate-900 focus:outline-none focus:border-red-600 disabled:opacity-70 ${mono ? 'font-mono' : ''}`}
      />
    </div>
  );

  const upiLink = form.upiId ? `upi://pay?pa=${encodeURIComponent(form.upiId)}&pn=${encodeURIComponent(form.name)}&cu=INR` : '';

  return (
    <form onSubmit={save} className="max-w-3xl space-y-6">
      {!canEdit && (
        <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-none">
          View only — only the CEO or a Manager can change these details.
        </div>
      )}

      {/* Identity */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Building2 className="h-4 w-4 text-red-600" /> Company Details</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field('Company Name', 'name', 'MAJESTRONICZ')}
          {field('GSTIN', 'gstin', '33ABZFM5739L1ZD', true)}
          {field('PAN No.', 'pan', 'ABZFM5739L', true)}
          {field('UDYAM / MSME Reg. No.', 'udyamReg', 'UDYAM-TN-00-0000000', true)}
          {field('Phone', 'phone', '')}
          {field('Email', 'email', '')}
        </div>
        {field('Address', 'address', '')}
      </section>

      {/* Links -> QR codes */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><QrIcon className="h-4 w-4 text-red-600" /> Invoice QR Codes</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field('Website URL', 'website', 'https://majestronicz.com')}
          {field('Google Review URL', 'ratingLink', 'https://g.page/r/…/review')}
        </div>
        <div className="flex flex-wrap gap-5 pt-1">
          {[
            { label: 'Website', value: form.website },
            { label: 'Google Review', value: form.ratingLink },
            { label: 'UPI Pay', value: upiLink },
          ].filter((q) => q.value && String(q.value).trim()).map((q) => (
            <div key={q.label} className="flex flex-col items-center gap-1">
              <div className="border border-slate-200 p-1"><QrCode value={q.value as string} size={80} /></div>
              <span className="text-[10px] text-slate-500">{q.label}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-500">These QR codes are printed in the footer of the GST invoice.</p>
      </section>

      {/* Bank / payment */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Landmark className="h-4 w-4 text-red-600" /> Bank &amp; Payment Details</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field('Account Holder Name', 'bankAccountName', '')}
          {field('Bank Name', 'bankName', '')}
          {field('Account Number', 'bankAccountNumber', '', true)}
          {field('IFSC Code', 'bankIfsc', '', true)}
          {field('Branch', 'bankBranch', '')}
          {field('UPI ID', 'upiId', 'name@bank', true)}
        </div>
        <p className="text-[11px] text-slate-500">Shown as a payment block (and the UPI QR above) on the GST invoice.</p>
      </section>

      {canEdit && (
        <div className="flex justify-end">
          <button type="submit" className="inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold border border-red-700 cursor-pointer">
            <Save className="h-4 w-4" /> Save Company &amp; Invoice Details
          </button>
        </div>
      )}
    </form>
  );
};
