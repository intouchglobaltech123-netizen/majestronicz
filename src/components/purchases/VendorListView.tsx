import React, { useState } from 'react';
import {
  Building2,
  Phone,
  MapPin,
  Hash,
  Search,
  Plus,
  Edit2,
  Trash2,
  ShoppingBag,
  ExternalLink,
  Wallet,
} from 'lucide-react';
import { Vendor } from '../../types';
import { formatCurrency } from '../../lib/utils';
import { useErp } from '../../context/ErpContext';
import { VendorMasterModal } from './VendorMasterModal';
import { RecordPaymentModal } from '../payments/RecordPaymentModal';

interface VendorListViewProps {
  onSelectVendorForPo?: (vendor: Vendor) => void;
}

export const VendorListView: React.FC<VendorListViewProps> = ({ onSelectVendorForPo }) => {
  const { vendors, deleteVendor, purchaseOrders, canManagePurchases, canRecordPayment, currentBranch } = useErp();

  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [vendorToEdit, setVendorToEdit] = useState<Vendor | null>(null);
  const [vendorToPay, setVendorToPay] = useState<Vendor | null>(null);

  // Unpaid purchase orders for a vendor (non-cancelled, balance > 0).
  const vendorUnpaidPOs = (vendorId: string) =>
    purchaseOrders
      .filter((po) => po.vendorId === vendorId && po.status !== 'Cancelled')
      .map((po) => ({ refId: po.id, refNumber: po.poNumber, date: po.date, balanceDue: Math.max(0, (po.totalAmount || 0) - (po.amountPaid || 0)) }))
      .filter((o) => o.balanceDue > 0.5);
  const vendorPayable = (vendorId: string) => vendorUnpaidPOs(vendorId).reduce((t, o) => t + o.balanceDue, 0);

  const filteredVendors = vendors.filter((v) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      v.vendorName.toLowerCase().includes(q) ||
      v.contactNo.toLowerCase().includes(q) ||
      v.address.toLowerCase().includes(q) ||
      (v.gstin && v.gstin.toLowerCase().includes(q))
    );
  });

  const getVendorPoCount = (vendorId: string) => {
    return purchaseOrders.filter((po) => po.vendorId === vendorId).length;
  };

  const handleEdit = (vendor: Vendor) => {
    setVendorToEdit(vendor);
    setIsModalOpen(true);
  };

  const handleAddNew = () => {
    setVendorToEdit(null);
    setIsModalOpen(true);
  };

  return (
    <div className="space-y-4">
      {/* Control Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search suppliers by name, phone, or GSTIN..."
            className="w-full pl-10 pr-4 py-2 text-xs font-semibold rounded-none border border-slate-300 focus:outline-hidden focus:border-red-600 bg-white"
          />
        </div>

        {canManagePurchases && (
          <button
            onClick={handleAddNew}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 active:bg-red-800 rounded-none border border-red-700 shadow-none transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>+ Add Supplier</span>
          </button>
        )}
      </div>

      {/* Vendors Table */}
      <div className="bg-white rounded-none border border-slate-300 shadow-none overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 text-xs font-bold uppercase tracking-wider">
                <th className="py-3 px-4">Supplier / Company</th>
                <th className="py-3 px-4">Contact</th>
                <th className="py-3 px-4">Location / Address</th>
                <th className="py-3 px-4">GSTIN</th>
                <th className="py-3 px-4 text-center">Linked POs</th>
                <th className="py-3 px-4 text-right">Payable</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredVendors.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <Building2 className="h-10 w-10 mx-auto text-slate-300 mb-2" />
                    <p className="text-sm font-medium text-slate-600">No suppliers found</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {searchQuery ? 'Try adjusting your search keyword' : 'Add your first supplier to start procurement'}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredVendors.map((vendor) => {
                  const poCount = getVendorPoCount(vendor.id);
                  const payable = vendorPayable(vendor.id);
                  return (
                    <tr key={vendor.id} className="hover:bg-slate-50/70 transition-colors group">
                      {/* Name & Badge */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-none bg-slate-100 text-slate-800 border border-slate-300 font-bold flex items-center justify-center shrink-0 text-xs">
                            {vendor.vendorName.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 group-hover:text-red-600 transition-colors">
                              {vendor.vendorName}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono">
                              ID: {vendor.id}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Contact */}
                      <td className="py-3.5 px-4 text-slate-600">
                        <div className="flex items-center gap-1.5">
                          <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          <span className="font-medium text-slate-800">{vendor.contactNo}</span>
                        </div>
                      </td>

                      {/* Address */}
                      <td className="py-3.5 px-4 text-slate-600 max-w-xs">
                        <div className="flex items-start gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
                          <span className="text-xs line-clamp-2 text-slate-600">{vendor.address}</span>
                        </div>
                      </td>

                      {/* GSTIN */}
                      <td className="py-3.5 px-4">
                        {vendor.gstin ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 font-mono text-xs font-medium">
                            <Hash className="h-3 w-3 text-slate-400" />
                            {vendor.gstin}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400 italic">Unregistered</span>
                        )}
                      </td>

                      {/* Linked PO count */}
                      <td className="py-3.5 px-4 text-center">
                        {poCount > 0 ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-xs font-semibold">
                            <ShoppingBag className="h-3 w-3" />
                            {poCount} PO{poCount === 1 ? '' : 's'}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">None</span>
                        )}
                      </td>

                      {/* Payable */}
                      <td className="py-3.5 px-4 text-right">
                        {payable > 0 ? (
                          <span className="font-bold font-mono text-rose-700 text-sm">{formatCurrency(payable)}</span>
                        ) : (
                          <span className="text-xs font-semibold text-emerald-600">Settled</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          {canRecordPayment && payable > 0 && (
                            <button
                              onClick={() => setVendorToPay(vendor)}
                              title="Record payment to this supplier"
                              className="p-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors"
                            >
                              <Wallet className="h-4 w-4" />
                            </button>
                          )}
                          {onSelectVendorForPo && (
                            <button
                              onClick={() => onSelectVendorForPo(vendor)}
                              title="Create Purchase Order for this supplier"
                              className="p-1.5 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </button>
                          )}
                          {canManagePurchases && (
                            <>
                              <button
                                onClick={() => handleEdit(vendor)}
                                title="Edit supplier details"
                                className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                              >
                                <Edit2 className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => {
                                  if (window.confirm(`Are you sure you want to delete supplier "${vendor.vendorName}"?`)) {
                                    deleteVendor(vendor.id);
                                  }
                                }}
                                disabled={poCount > 0}
                                title={poCount > 0 ? 'Cannot delete vendor with linked POs' : 'Delete supplier'}
                                className={`p-1.5 rounded-lg transition-colors ${
                                  poCount > 0
                                    ? 'text-slate-300 cursor-not-allowed'
                                    : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
                                }`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Vendor Add/Edit Modal */}
      <VendorMasterModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        vendorToEdit={vendorToEdit}
      />

      {/* Supplier Payment Modal */}
      {vendorToPay && (
        <RecordPaymentModal
          isOpen={Boolean(vendorToPay)}
          onClose={() => setVendorToPay(null)}
          type="out"
          partyType="vendor"
          partyId={vendorToPay.id}
          partyName={vendorToPay.vendorName}
          branchId={currentBranch && currentBranch !== 'all' ? currentBranch : 'erode-hq'}
          outstanding={vendorUnpaidPOs(vendorToPay.id)}
        />
      )}
    </div>
  );
};
