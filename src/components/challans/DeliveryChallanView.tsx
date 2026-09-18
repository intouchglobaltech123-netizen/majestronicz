import React, { useState, useMemo, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import { DeliveryChallan } from '../../types';
import { DeliveryChallanForm } from './DeliveryChallanForm';
import { DeliveryChallanPdfModal } from './DeliveryChallanPdfModal';
import {
  Truck,
  Plus,
  Search,
  Printer,
  Trash2,
  Edit2,
  Calendar,
  Building,
} from 'lucide-react';

export const DeliveryChallanView: React.FC = () => {
  const { challans, deleteChallan, activeSubTab } = useErp();

  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
  const [editingChallan, setEditingChallan] = useState<DeliveryChallan | null>(null);

  // Synchronize view tab when triggered from secondary navbar flyout
  useEffect(() => {
    if (activeSubTab?.view === 'challans') {
      const tab = activeSubTab.tab;
      if (tab === 'new') {
        setEditingChallan(null);
        setActiveTab('new');
      } else if (tab === 'history') {
        setActiveTab('history');
      }
    }
  }, [activeSubTab]);
  const [previewChallan, setPreviewChallan] = useState<DeliveryChallan | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Filter challans by search
  const filteredChallans = useMemo(() => {
    return challans.filter((c) => {
      const q = searchQuery.toLowerCase();
      return (
        c.recipientName.toLowerCase().includes(q) ||
        c.challanNumber.toLowerCase().includes(q) ||
        (c.location && c.location.toLowerCase().includes(q)) ||
        (c.contactNo && c.contactNo.includes(q))
      );
    });
  }, [challans, searchQuery]);

  // Dispatch metrics.
  const challanStats = useMemo(() => {
    const month = new Date().toISOString().slice(0, 7);
    const monthList = challans.filter((c) => (c.date || '').startsWith(month));
    const totalUnits = challans.reduce((t, c) => t + ((c.items as any[]) || []).reduce((s, it) => s + (it.quantity || 0), 0), 0);
    return {
      count: challans.length,
      monthCount: monthList.length,
      totalUnits,
      recipients: new Set(challans.map((c) => c.recipientName)).size,
    };
  }, [challans]);

  const handleSaved = (ch?: DeliveryChallan) => {
    setEditingChallan(null);
    setActiveTab('history');
    if (ch) {
      setPreviewChallan(ch);
    }
  };

  const handleStartNew = () => {
    setEditingChallan(null);
    setActiveTab('new');
  };

  const handleEdit = (challan: DeliveryChallan) => {
    setEditingChallan(challan);
    setActiveTab('new');
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 w-full">
      {/* Top Banner & Tab Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700 shrink-0">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
                Delivery Challan
              </h1>
              <p className="text-xs text-slate-500">
                Goods dispatch notes and transport delivery documentation.
              </p>
            </div>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-2 bg-slate-200/70 p-1 rounded-xl">
          <button
            onClick={handleStartNew}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg transition-all ${
              activeTab === 'new' && !editingChallan
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New Challan</span>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg transition-all ${
              activeTab === 'history'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Truck className="h-3.5 w-3.5" />
            <span>Challan History</span>
            <span className="ml-1 text-[11px] px-1.5 py-0.2 rounded-full bg-blue-100 text-blue-700 font-mono">
              {challans.length}
            </span>
          </button>
        </div>
      </div>

      {/* Dispatch metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total Challans</span>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">{challanStats.count}</p>
          <span className="text-[11px] text-slate-400">Dispatch notes issued</span>
        </div>
        <div className="p-4 rounded-xl bg-gradient-to-br from-blue-50/60 to-white border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">This Month</span>
          <p className="text-xl sm:text-2xl font-bold text-blue-700 mt-1">{challanStats.monthCount}</p>
          <span className="text-[11px] text-slate-400">Dispatched this month</span>
        </div>
        <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-50/60 to-white border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Units Dispatched</span>
          <p className="text-xl sm:text-2xl font-bold text-emerald-700 mt-1 font-mono">{challanStats.totalUnits.toLocaleString('en-IN')}</p>
          <span className="text-[11px] text-slate-400">Across all challans</span>
        </div>
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Recipients</span>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">{challanStats.recipients}</p>
          <span className="text-[11px] text-slate-400">Unique delivery parties</span>
        </div>
      </div>

      {/* View Content */}
      {activeTab === 'new' ? (
        <DeliveryChallanForm
          initialChallan={editingChallan}
          onSaved={handleSaved}
          onPreviewPdf={(ch) => setPreviewChallan(ch)}
        />
      ) : (
        <div className="space-y-4">
          {/* History Search & Filters Bar */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="relative w-full sm:w-80">
              <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search recipient, challan no, location..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
              />
            </div>

            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span>
                Showing <strong>{filteredChallans.length}</strong> of {challans.length} challans
              </span>
              <button
                onClick={handleStartNew}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Create Challan</span>
              </button>
            </div>
          </div>

          {/* Challans Table */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[11px] tracking-wider">
                    <th className="py-3 px-4">Challan No.</th>
                    <th className="py-3 px-4">Date & Time</th>
                    <th className="py-3 px-4">Recipient / Destination</th>
                    <th className="py-3 px-4 text-center">Items</th>
                    <th className="py-3 px-4 text-right">Total Qty</th>
                    <th className="py-3 px-4">Delivered By</th>
                    <th className="py-3 px-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredChallans.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400">
                        <Truck className="h-8 w-8 mx-auto mb-2 opacity-40 text-blue-600" />
                        <p className="font-semibold text-slate-600 text-sm">No delivery challans found</p>
                        <p className="text-xs text-slate-400 mt-1">
                          Click below to issue your first goods dispatch note.
                        </p>
                        <div className="mt-4">
                          <button
                            type="button"
                            onClick={handleStartNew}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs shadow-xs transition-colors"
                          >
                            + Create First Delivery Challan
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredChallans.map((ch) => (
                      <tr key={ch.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-4">
                          <span className="font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                            {ch.challanNumber}
                          </span>
                        </td>

                        <td className="py-3 px-4 text-slate-600">
                          <div className="flex items-center gap-1.5">
                            <Calendar className="h-3 w-3 text-slate-400" />
                            <span className="font-medium">{ch.date}</span>
                            <span className="text-[11px] text-slate-400">({ch.time})</span>
                          </div>
                        </td>

                        <td className="py-3 px-4">
                          <p className="font-bold text-slate-900">{ch.recipientName}</p>
                          {ch.location && (
                            <p className="text-[11px] text-slate-500 truncate max-w-xs">{ch.location}</p>
                          )}
                          {ch.contactNo && (
                            <p className="text-[11px] text-slate-400">Ph: {ch.contactNo}</p>
                          )}
                        </td>

                        <td className="py-3 px-4 text-center">
                          <span className="font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                            {ch.items.length} {ch.items.length === 1 ? 'Item' : 'Items'}
                          </span>
                        </td>

                        <td className="py-3 px-4 text-right">
                          <span className="font-mono font-bold text-slate-900 text-sm">
                            {ch.totalQuantity}
                          </span>
                          <span className="text-[11px] text-slate-400 ml-1">Units</span>
                        </td>

                        <td className="py-3 px-4 text-slate-600">
                          <p className="font-medium text-slate-800 text-[11px]">
                            {ch.deliveredBy?.name || '—'}
                          </p>
                          {ch.deliveredBy?.comment && (
                            <p className="text-[11px] text-slate-400 truncate max-w-xs">
                              {ch.deliveredBy.comment}
                            </p>
                          )}
                        </td>

                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => setPreviewChallan(ch)}
                              className="p-1.5 rounded-lg text-slate-600 hover:text-blue-700 hover:bg-blue-50 transition-colors"
                              title="Preview & Print PDF"
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </button>

                            <button
                              onClick={() => handleEdit(ch)}
                              className="p-1.5 rounded-lg text-slate-600 hover:text-blue-700 hover:bg-blue-50 transition-colors"
                              title="Edit Challan"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>

                            <button
                              onClick={() => {
                                if (window.confirm(`Delete Delivery Challan ${ch.challanNumber}?`)) {
                                  deleteChallan(ch.id);
                                }
                              }}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                              title="Delete Challan"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Table Footer */}
            <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
              <div className="flex items-center gap-2">
                <Building className="h-3.5 w-3.5 text-slate-400" />
                <span>Low-usage goods movement register for inter-branch and customer dispatch.</span>
              </div>
              <span>
                Total Dispatched: <strong>{challans.reduce((sum, c) => sum + c.totalQuantity, 0)} Units</strong>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* PDF Modal */}
      <DeliveryChallanPdfModal
        challan={previewChallan}
        isOpen={!!previewChallan}
        onClose={() => setPreviewChallan(null)}
        onCreateNew={handleStartNew}
      />
    </div>
  );
};
