import React, { useEffect, useState } from 'react';
import { useErp } from '../../context/ErpContext';
import { QuotationPaymentTemplate } from '../../types';
import { Save, FileText, Plus, Trash2, Wallet } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Manage the reusable "payment information" blocks a quotation can pick from.
 * Each template carries payment terms + the bank/UPI account to show on the
 * quote PDF (e.g. "Advance 50% — HDFC", "Full advance — IOB"). CEO only — same
 * tab as the company bank details, since these also print bank account numbers.
 */
export const QuotationPaymentTemplatesSettings: React.FC = () => {
  const { quotationPaymentTemplates, saveQuotationPaymentTemplates, currentUser } = useErp();
  const canEdit = currentUser.role === 'CEO';
  const [rows, setRows] = useState<QuotationPaymentTemplate[]>(quotationPaymentTemplates);

  useEffect(() => { setRows(quotationPaymentTemplates); }, [quotationPaymentTemplates]);

  const update = (id: string, k: keyof QuotationPaymentTemplate, v: string) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [k]: v } : r)));

  const addRow = () =>
    setRows((prev) => [
      ...prev,
      { id: `qpt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: '', terms: '' },
    ]);

  const removeRow = (id: string) => setRows((prev) => prev.filter((r) => r.id !== id));

  const save = () => {
    if (!canEdit) { toast.error('Only the CEO can edit quotation payment templates'); return; }
    // Keep only templates that at least have a name; trim everything.
    const cleaned = rows
      .map((r) => ({
        ...r,
        name: (r.name || '').trim(),
        terms: (r.terms || '').trim() || undefined,
        bankName: (r.bankName || '').trim() || undefined,
        bankAccountName: (r.bankAccountName || '').trim() || undefined,
        bankAccountNumber: (r.bankAccountNumber || '').trim() || undefined,
        bankIfsc: (r.bankIfsc || '').trim() || undefined,
        bankBranch: (r.bankBranch || '').trim() || undefined,
        upiId: (r.upiId || '').trim() || undefined,
      }))
      .filter((r) => r.name);
    if (rows.some((r) => !(r.name || '').trim())) {
      toast.error('Give every payment template a name (e.g. "Advance 50% — HDFC")');
      return;
    }
    saveQuotationPaymentTemplates(cleaned);
    toast.success('Quotation payment templates saved');
  };

  const field = (
    r: QuotationPaymentTemplate,
    k: keyof QuotationPaymentTemplate,
    label: string,
    placeholder = '',
    mono = false,
  ) => (
    <div className="space-y-1">
      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</label>
      <input
        type="text"
        disabled={!canEdit}
        value={(r[k] as string) || ''}
        onChange={(e) => update(r.id, k, e.target.value)}
        placeholder={placeholder}
        className={`w-full px-2.5 py-1.5 rounded-none bg-white border border-slate-300 text-xs text-slate-900 focus:outline-none focus:border-red-600 disabled:opacity-70 ${mono ? 'font-mono' : ''}`}
      />
    </div>
  );

  return (
    <div className="max-w-3xl space-y-4">
      <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <FileText className="h-4 w-4 text-red-600" /> Quotation Payment Templates
          </h3>
          {canEdit && (
            <button
              type="button"
              onClick={addRow}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-none cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" /> Add Template
            </button>
          )}
        </div>
        <p className="text-[11px] text-slate-500">
          When raising a quotation, staff pick one of these as the Payment Information shown on the PDF
          (payment terms + the bank / UPI account to pay into). Leave the bank fields blank for a terms-only template.
        </p>

        {rows.length === 0 && (
          <div className="p-4 text-center text-xs text-slate-400 border border-dashed border-slate-300">
            No payment templates yet. {canEdit ? 'Click "Add Template" to create one.' : ''}
          </div>
        )}

        <div className="space-y-4">
          {rows.map((r) => (
            <div key={r.id} className="border border-slate-200 rounded-none p-3 space-y-3 bg-slate-50/50">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  {field(r, 'name', 'Template Name *', 'e.g. Advance 50% — HDFC')}
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => removeRow(r.id)}
                    title="Remove template"
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 border border-slate-200 rounded-none cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Payment Terms</label>
                <textarea
                  disabled={!canEdit}
                  value={r.terms || ''}
                  onChange={(e) => update(r.id, 'terms', e.target.value)}
                  placeholder="e.g. 50% advance, balance on delivery. Payment within 7 days."
                  rows={2}
                  className="w-full px-2.5 py-1.5 rounded-none bg-white border border-slate-300 text-xs text-slate-900 focus:outline-none focus:border-red-600 disabled:opacity-70 resize-y"
                />
              </div>

              <div className="pt-1 border-t border-slate-200">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2">
                  <Wallet className="h-3 w-3" /> Bank / UPI to pay into (optional)
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {field(r, 'bankAccountName', 'Account Holder')}
                  {field(r, 'bankName', 'Bank Name')}
                  {field(r, 'bankAccountNumber', 'Account Number', '', true)}
                  {field(r, 'bankIfsc', 'IFSC Code', '', true)}
                  {field(r, 'bankBranch', 'Branch')}
                  {field(r, 'upiId', 'UPI ID', 'name@bank', true)}
                </div>
              </div>
            </div>
          ))}
        </div>

        {canEdit && (
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={save}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold border border-red-700 cursor-pointer"
            >
              <Save className="h-4 w-4" /> Save Payment Templates
            </button>
          </div>
        )}
        {!canEdit && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 p-2">
            View only — only the CEO can change these templates.
          </p>
        )}
      </section>
    </div>
  );
};
