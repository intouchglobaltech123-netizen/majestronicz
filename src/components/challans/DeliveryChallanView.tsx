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
import { cn } from '../../lib/utils';

interface DeliveryChallanViewProps {
  /** Which tab to open first when embedded (e.g. inside the Sales screen). */
  initialTab?: 'new' | 'history';
}

export const DeliveryChallanView: React.FC<DeliveryChallanViewProps> = ({ initialTab = 'new' }) => {
  const { challans, deleteChallan, activeSubTab } = useErp();

  const [activeTab, setActiveTab] = useState<'new' | 'history'>(initialTab);
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
      {/* Top Banner & Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
            {activeTab === 'new' ? 'Create Delivery Challan' : 'Delivery Challan History'}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {activeTab === 'new'
              ? 'Issue new goods dispatch note and transport proof document.'
              : 'Past delivery challans, printed dispatch slips, and transport logs.'}
          </p>
        </div>
      </div>

      {/* Segmented View Tabs (Classic Desktop ERP) */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar -mx-1 px-1">
        <button
          type="button"
          onClick={handleStartNew}
          className={cn(
            'flex items-center gap-2 px-3.5 py-2 rounded-none text-xs font-bold whitespace-nowrap transition-all cursor-pointer shrink-0 border',
            activeTab === 'new'
              ? 'bg-red-600 text-white border-red-700 shadow-none'
              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50 hover:text-slate-900'
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          <span>+ New Challan</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className={cn(
            'flex items-center gap-2 px-3.5 py-2 rounded-none text-xs font-bold whitespace-nowrap transition-all cursor-pointer shrink-0 border',
            activeTab === 'history'
              ? 'bg-slate-800 text-white border-slate-900 shadow-none'
              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50 hover:text-slate-900'
          )}
        >
          <Truck className="h-3.5 w-3.5" />
          <span>Challan History</span>
          <span className={cn(
            'px-1.5 py-0.2 rounded-none text-[10px]',
            activeTab === 'history' ? 'bg-slate-900 text-white font-bold' : 'bg-slate-100 text-slate-700 border border-slate-200'
          )}>
            {challans.length}
          </span>
        </button>
      </div>

      {/* Dispatch metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-none bg-white border border-slate-300 shadow-none">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total Challans</span>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">{challanStats.count}</p>
          <span className="text-[11px] text-slate-400">Dispatch notes issued</span>
        </div>
        <div className="p-4 rounded-none bg-white border border-slate-300 shadow-none">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">This Month</span>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">{challanStats.monthCount}</p>
          <span className="text-[11px] text-slate-400">Dispatched this month</span>
        </div>
        <div className="p-4 rounded-none bg-white border border-slate-300 shadow-none">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Units Dispatched</span>
          <p className="text-xl sm:text-2xl font-bold text-emerald-800 mt-1 font-mono">{challanStats.totalUnits.toLocaleString('en-IN')}</p>
          <span className="text-[11px] text-slate-400">Across all challans</span>
        </div>
        <div className="p-4 rounded-none bg-white border border-slate-300 shadow-none">
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
          <div className="bg-white p-4 rounded-none border border-slate-300 shadow-none flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="relative w-full sm:w-80">
              <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search recipient, challan no, location..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-none border border-slate-300 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-red-600"
              />
            </div>

            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span>
                Showing <strong>{filteredChallans.length}</strong> of {challans.length} challans
              </span>
              <button
                onClick={handleStartNew}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-none border border-red-700 transition-colors shadow-none cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>+ Create Challan</span>
              </button>
            </div>
          </div>

          {/* Challans Table */}
          <div className="bg-white border border-slate-300 rounded-none shadow-none overflow-hidden">
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
                        <Truck className="h-8 w-8 mx-auto mb-2 opacity-40 text-red-600" />
                        <p className="font-semibold text-slate-600 text-sm">No delivery challans found</p>
                        <p className="text-xs text-slate-400 mt-1">
                          Click below to issue your first goods dispatch note.
                        </p>
                        <div className="mt-4">
                          <button
                            type="button"
                            onClick={handleStartNew}
                            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-none border border-red-700 font-bold text-xs shadow-none transition-colors cursor-pointer"
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
                          <span className="font-mono font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded-none border border-red-200">
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
