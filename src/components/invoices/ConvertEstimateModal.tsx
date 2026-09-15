import React, { useState, useMemo } from 'react';
import { Estimate } from '../../types';
import { formatCurrency } from '../../lib/utils';
import {
  X,
  Search,
  FileText,
  ArrowRight,
  ReceiptText,
  Calendar,
  Building,
} from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  estimates: Estimate[];
  onSelectEstimate: (estimate: Estimate) => void;
}

export const ConvertEstimateModal: React.FC<Props> = ({
  isOpen,
  onClose,
  estimates,
  onSelectEstimate,
}) => {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    return estimates.filter((e) => {
      const q = search.toLowerCase();
      return (
        e.estimateNumber.toLowerCase().includes(q) ||
        e.customerName.toLowerCase().includes(q) ||
        (e.customerContact && e.customerContact.includes(q))
      );
    });
  }, [estimates, search]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700">
              <ReceiptText className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Convert from Estimate</h2>
              <p className="text-xs text-slate-500">
                Select an existing estimate quotation to populate customer and line items into a new Sales Invoice
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search Filter */}
        <div className="p-4 border-b border-slate-200 bg-white">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by customer name, estimate number, or phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 text-xs focus:outline-none focus:border-blue-600"
              autoFocus
            />
          </div>
        </div>

        {/* Estimate List */}
        <div className="p-4 overflow-y-auto flex-1 space-y-2.5">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              <FileText className="h-8 w-8 mx-auto text-slate-300 mb-2" />
              <p className="font-semibold text-sm text-slate-700">No estimates found</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {search ? 'Try adjusting your search criteria' : 'No saved estimates available yet'}
              </p>
            </div>
          ) : (
            filtered.map((est) => (
              <div
                key={est.id}
                onClick={() => {
                  onSelectEstimate(est);
                  onClose();
                }}
                className="p-3.5 rounded-xl border border-slate-200 hover:border-blue-500 hover:bg-blue-50/40 cursor-pointer transition-all flex items-center justify-between group shadow-2xs"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                      {est.estimateNumber}
                    </span>
                    <span className="text-[11px] uppercase font-bold text-slate-500 flex items-center gap-1">
                      <Building className="h-3 w-3 text-slate-400" />
                      {est.branchId}
                    </span>
                    {est.withGst ? (
                      <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                        With GST
                      </span>
                    ) : (
                      <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-1.5 py-0.2 rounded">
                        Without GST
                      </span>
                    )}
                  </div>

                  <p className="text-sm font-bold text-slate-900 truncate">{est.customerName}</p>

                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3 text-slate-400" />
                      {est.date}
                    </span>
                    <span>{est.items.length} line item{est.items.length === 1 ? '' : 's'}</span>
                    {est.customerContact && <span>Phone: {est.customerContact}</span>}
                  </div>
                </div>

                <div className="flex items-center gap-3 pl-4 shrink-0 text-right">
                  <div>
                    <span className="text-[11px] uppercase font-semibold text-slate-400 block">Total</span>
                    <span className="font-mono font-black text-sm text-slate-900">
                      {formatCurrency(est.grandTotal)}
                    </span>
                  </div>
                  <div className="h-8 w-8 rounded-lg bg-slate-100 group-hover:bg-blue-600 group-hover:text-white flex items-center justify-center text-slate-400 transition-colors">
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <span>{filtered.length} estimate{filtered.length === 1 ? '' : 's'} available to convert</span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
