import React, { useState, useEffect, useMemo } from 'react';
import { useErp } from '../../context/ErpContext';
import {
  Item,
  DeliveryChallan,
  DeliveryChallanLineItem,
  DEFAULT_CHALLAN_TERMS,
} from '../../types';
import {
  Plus,
  Trash2,
  Save,
  Printer,
  Calendar,
  Clock,
  User,
  MapPin,
  Truck,
  RotateCcw,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { PhoneInput } from '../common/PhoneInput';

interface Props {
  initialChallan?: DeliveryChallan | null;
  onSaved?: (challan: DeliveryChallan) => void;
  onPreviewPdf?: (challan: DeliveryChallan) => void;
}

export const DeliveryChallanForm: React.FC<Props> = ({
  initialChallan,
  onSaved,
  onPreviewPdf,
}) => {
  const {
    items: masterItems,
    saveChallan,
    getNextChallanNumber,
  } = useErp();

  // Form State
  const [challanNumber, setChallanNumber] = useState<string>('');
  const [date, setDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [time, setTime] = useState<string>(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  });

  // "Delivery Challan For" Recipient fields
  const [recipientName, setRecipientName] = useState<string>('');
  const [location, setLocation] = useState<string>('');
  const [contactNo, setContactNo] = useState<string>('');

  // Line items
  const [lineItems, setLineItems] = useState<DeliveryChallanLineItem[]>([]);
  const [termsAndConditions, setTermsAndConditions] = useState<string>(DEFAULT_CHALLAN_TERMS);

  // Delivered By & Received By verification fields
  const [deliveredByName, setDeliveredByName] = useState<string>('');
  const [deliveredByComment, setDeliveredByComment] = useState<string>('');
  const [deliveredByDate, setDeliveredByDate] = useState<string>('');

  const [receivedByName, setReceivedByName] = useState<string>('');
  const [receivedByComment, setReceivedByComment] = useState<string>('');
  const [receivedByDate, setReceivedByDate] = useState<string>('');

  // Autocomplete UI state
  const [showItemAutocomplete, setShowItemAutocomplete] = useState<string | null>(null);
  const [itemSearchQuery, setItemSearchQuery] = useState<string>('');

  // Initialize or reset form
  useEffect(() => {
    if (initialChallan) {
      setChallanNumber(initialChallan.challanNumber);
      setDate(initialChallan.date);
      setTime(initialChallan.time);
      setRecipientName(initialChallan.recipientName);
      setLocation(initialChallan.location || '');
      setContactNo(initialChallan.contactNo || '');
      setLineItems(initialChallan.items);
      setTermsAndConditions(initialChallan.termsAndConditions || DEFAULT_CHALLAN_TERMS);

      setDeliveredByName(initialChallan.deliveredBy?.name || '');
      setDeliveredByComment(initialChallan.deliveredBy?.comment || '');
      setDeliveredByDate(initialChallan.deliveredBy?.date || initialChallan.date);

      setReceivedByName(initialChallan.receivedBy?.name || '');
      setReceivedByComment(initialChallan.receivedBy?.comment || '');
      setReceivedByDate(initialChallan.receivedBy?.date || '');
    } else {
      setChallanNumber(getNextChallanNumber());
      const today = new Date().toISOString().split('T')[0];
      setDate(today);
      const now = new Date();
      setTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
      setRecipientName('');
      setLocation('');
      setContactNo('');
      setTermsAndConditions(DEFAULT_CHALLAN_TERMS);

      setDeliveredByName('Dispatch Incharge');
      setDeliveredByComment('');
      setDeliveredByDate(today);

      setReceivedByName('');
      setReceivedByComment('');
      setReceivedByDate('');

      // Add one empty row
      const initialRowId = `dcli-${Date.now()}`;
      setLineItems([
        {
          id: initialRowId,
          itemName: '',
          itemHSN: '',
          quantity: 1,
          unit: 'PCS',
        },
      ]);
    }
  }, [initialChallan, getNextChallanNumber]);

  // Total Quantity Calculation (Sums Quantity only)
  const totalQuantity = useMemo(() => {
    return lineItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  }, [lineItems]);

  const addNewRow = (selectedItem?: Item) => {
    const newId = `dcli-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    let newRow: DeliveryChallanLineItem;

    if (selectedItem) {
      newRow = {
        id: newId,
        itemId: selectedItem.id,
        itemName: selectedItem.itemName,
        itemHSN: selectedItem.itemHSN,
        quantity: 1,
        unit: selectedItem.unit,
      };
    } else {
      newRow = {
        id: newId,
        itemName: '',
        itemHSN: '',
        quantity: 1,
        unit: 'PCS',
      };
    }

    setLineItems((prev) => [...prev, newRow]);
  };

  const updateLineItem = (id: string, updates: Partial<DeliveryChallanLineItem>) => {
    setLineItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        return { ...item, ...updates };
      })
    );
  };

  const removeLineItem = (id: string) => {
    if (lineItems.length === 1) {
      toast.error('At least one item line is required');
      return;
    }
    setLineItems((prev) => prev.filter((item) => item.id !== id));
  };

  const selectMasterItemForRow = (rowId: string, item: Item) => {
    updateLineItem(rowId, {
      itemId: item.id,
      itemName: item.itemName,
      itemHSN: item.itemHSN,
      unit: item.unit,
    });
    setShowItemAutocomplete(null);
    setItemSearchQuery('');
  };

  const assembleChallanObject = (): DeliveryChallan | null => {
    if (!recipientName.trim()) {
      toast.error('Recipient Name (e.g. Branch or Customer) is required');
      return null;
    }

    const validItems = lineItems.filter((i) => i.itemName.trim() && (Number(i.quantity) || 0) > 0);
    if (validItems.length === 0) {
      toast.error('Add at least one item with valid description and quantity');
      return null;
    }

    return {
      id: initialChallan?.id || `dc-${Date.now()}`,
      challanNumber: challanNumber.trim() || getNextChallanNumber(),
      recipientName: recipientName.trim(),
      location: location.trim() || undefined,
      contactNo: contactNo.trim() || undefined,
      date,
      time,
      items: validItems,
      totalQuantity,
      termsAndConditions,
      deliveredBy: deliveredByName.trim()
        ? {
            name: deliveredByName.trim(),
            comment: deliveredByComment.trim() || undefined,
            date: deliveredByDate.trim() || date,
          }
        : undefined,
      receivedBy: receivedByName.trim()
        ? {
            name: receivedByName.trim(),
            comment: receivedByComment.trim() || undefined,
            date: receivedByDate.trim() || undefined,
          }
        : undefined,
      createdAt: initialChallan?.createdAt || new Date().toISOString(),
    };
  };

  const handleSave = () => {
    const challan = assembleChallanObject();
    if (!challan) return;
    saveChallan(challan);
    if (onSaved) onSaved(challan);
  };

  const handlePreview = () => {
    const challan = assembleChallanObject();
    if (!challan) return;
    if (onPreviewPdf) onPreviewPdf(challan);
  };

  const handleReset = () => {
    setChallanNumber(getNextChallanNumber());
    setRecipientName('');
    setLocation('');
    setContactNo('');
    setTermsAndConditions(DEFAULT_CHALLAN_TERMS);
    setDeliveredByName('Dispatch Incharge');
    setDeliveredByComment('');
    setReceivedByName('');
    setReceivedByComment('');
    setLineItems([
      {
        id: `dcli-${Date.now()}`,
        itemName: '',
        itemHSN: '',
        quantity: 1,
        unit: 'PCS',
      },
    ]);
    toast.info('Form reset to new delivery challan');
  };

  return (
    <div className="space-y-6">
      {/* Form Action Header Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700 shrink-0">
            <Truck className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">
                {initialChallan ? `Edit Challan ${initialChallan.challanNumber}` : 'New Delivery Challan'}
              </h2>
              <span className="text-xs font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                {challanNumber || 'DC-NEW'}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Goods movement & dispatch note • Low-usage lean document (zero pricing)
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5 text-slate-500" />
            <span>Reset</span>
          </button>

          <button
            type="button"
            onClick={handlePreview}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl transition-colors"
          >
            <Printer className="h-3.5 w-3.5 text-blue-600" />
            <span>Preview & Print PDF</span>
          </button>

          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all shadow-xs"
          >
            <Save className="h-4 w-4" />
            <span>Save Delivery Challan</span>
          </button>
        </div>
      </div>

      {/* Main Form Fields */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-6">
        {/* Recipient & Document Metadata Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* Delivery Challan For (Span 7) */}
          <div className="md:col-span-7 bg-slate-50/60 p-4 rounded-xl border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Delivery Challan For (Recipient Details)
              </span>
              <span className="text-[11px] text-slate-400">
                Branch transfer OR customer delivery
              </span>
            </div>

            {/* Quick-fill pills for branches */}
            <div className="flex items-center gap-1.5 flex-wrap pb-1">
              <span className="text-[11px] text-slate-500 font-medium">Quick Branch:</span>
              <button
                type="button"
                onClick={() => {
                  setRecipientName('MAJESTRONICZ BRANCH-1 CBE');
                  setLocation('100 Feet Road, Gandhipuram, Coimbatore');
                  setContactNo('9842211002');
                }}
                className="px-2 py-0.5 text-[11px] font-bold rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 transition-colors"
              >
                + Coimbatore Branch
              </button>
              <button
                type="button"
                onClick={() => {
                  setRecipientName('MAJESTRONICZ BRANCH-2 CHN');
                  setLocation('Mount Road, Anna Salai, Chennai');
                  setContactNo('9842211003');
                }}
                className="px-2 py-0.5 text-[11px] font-bold rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 transition-colors"
              >
                + Chennai Branch
              </button>
              <button
                type="button"
                onClick={() => {
                  setRecipientName('MAJESTRONICZ ERODE HQ');
                  setLocation('10, Nachiappa 2nd St, Kottai, Erode');
                  setContactNo('6379560289');
                }}
                className="px-2 py-0.5 text-[11px] font-bold rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 transition-colors"
              >
                + Erode HQ
              </button>
            </div>

            <div className="space-y-2.5">
              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  Recipient Name <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <User className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    required
                    placeholder="e.g. MAJESTRONICZ BRANCH-1 CBE or Customer / Client Name"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 text-xs font-medium focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                    Location / Destination Line
                  </label>
                  <div className="relative">
                    <MapPin className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Destination address, city, site..."
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-white border border-slate-300 text-slate-900 text-xs font-medium focus:outline-none focus:border-blue-600"
                    />
                  </div>
                </div>

                <div>
                  <PhoneInput
                    label="Contact No."
                    placeholder="98421 00000"
                    value={contactNo}
                    onChange={setContactNo}
                    size="sm"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Challan Details (Span 5) */}
          <div className="md:col-span-5 bg-slate-50/60 p-4 rounded-xl border border-slate-200 space-y-2.5">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
              Challan Details
            </span>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-semibold text-slate-600 w-24">Challan No:</label>
                <input
                  type="text"
                  value={challanNumber}
                  onChange={(e) => setChallanNumber(e.target.value)}
                  className="flex-1 px-3 py-1.5 rounded-xl bg-white border border-slate-300 text-slate-900 font-mono text-xs font-bold focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="flex items-center gap-2">
                <label className="text-[11px] font-semibold text-slate-600 w-24">Date & Time:</label>
                <div className="flex items-center gap-2 flex-1">
                  <div className="relative flex-1">
                    <Calendar className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="w-full pl-8 pr-2 py-1.5 rounded-xl bg-white border border-slate-300 text-slate-900 text-xs font-medium focus:outline-none focus:border-blue-600"
                    />
                  </div>
                  <div className="relative w-24">
                    <Clock className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      className="w-full pl-8 pr-2 py-1.5 rounded-xl bg-white border border-slate-300 text-slate-900 text-xs font-medium focus:outline-none focus:border-blue-600"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200">
                <div className="p-2 rounded-lg bg-blue-50/60 border border-blue-200 text-blue-800 text-[11px] flex items-center justify-between">
                  <span>Numbering Sequence:</span>
                  <span className="font-mono font-bold">Sequential (DC-XXX)</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Line Items Table (NO PRICING - Goods Movement Only) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold uppercase tracking-wider text-slate-600">
              Goods Movement Items
            </span>
            <span className="text-[11px] text-slate-500">
              *Delivery Challan tracks item quantities only. No pricing columns per goods-movement rule.
            </span>
          </div>

          <div className="border border-slate-200 rounded-xl overflow-visible shadow-2xs">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100/90 border-b border-slate-200 text-slate-700 font-bold uppercase text-[11px] tracking-wider">
                  <th className="py-2.5 px-3 w-10 text-center">#</th>
                  <th className="py-2.5 px-3 min-w-[240px]">Item Description / Model</th>
                  <th className="py-2.5 px-3 w-32 text-center">HSN / SAC</th>
                  <th className="py-2.5 px-3 w-28 text-right">Quantity</th>
                  <th className="py-2.5 px-3 w-24 text-center">Unit</th>
                  <th className="py-2.5 px-2 w-10 text-center"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {lineItems.map((row, idx) => (
                  <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-2.5 px-3 text-center text-slate-400 font-mono font-bold">
                      {idx + 1}
                    </td>

                    {/* Item Autocomplete Search & Input */}
                    <td className="py-2 px-3 relative">
                      <input
                        type="text"
                        placeholder="Search item from master catalog..."
                        value={row.itemName}
                        onFocus={() => setShowItemAutocomplete(row.id)}
                        onChange={(e) => {
                          updateLineItem(row.id, { itemName: e.target.value });
                          setItemSearchQuery(e.target.value);
                          setShowItemAutocomplete(row.id);
                        }}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-900 text-xs font-semibold focus:outline-none focus:border-blue-600"
                      />

                      {/* Autocomplete Dropdown */}
                      {showItemAutocomplete === row.id && (
                        <div className="absolute top-full left-3 z-30 w-80 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-56 overflow-y-auto p-1.5 space-y-1">
                          <div className="text-[11px] font-bold uppercase text-slate-400 px-2 py-1 flex items-center justify-between border-b border-slate-100">
                            <span>Select Master Catalog Item:</span>
                            <button
                              type="button"
                              onClick={() => setShowItemAutocomplete(null)}
                              className="text-slate-400 hover:text-slate-700"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {masterItems
                            .filter(
                              (m) =>
                                !itemSearchQuery ||
                                m.itemName.toLowerCase().includes(itemSearchQuery.toLowerCase()) ||
                                m.itemCode.toLowerCase().includes(itemSearchQuery.toLowerCase())
                            )
                            .slice(0, 10)
                            .map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => selectMasterItemForRow(row.id, item)}
                                className="w-full text-left p-2 rounded-lg hover:bg-blue-50 text-xs text-slate-800 transition-colors flex justify-between items-center group/btn"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="font-bold text-slate-900 group-hover/btn:text-blue-700 truncate">
                                    {item.itemName}
                                  </p>
                                  <p className="text-[11px] text-slate-500">
                                    {item.itemCode} • {item.category} • HSN: {item.itemHSN}
                                  </p>
                                </div>
                                <div className="text-right pl-2">
                                  <span className="text-[11px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                                    {item.unit}
                                  </span>
                                </div>
                              </button>
                            ))}
                        </div>
                      )}
                    </td>

                    {/* HSN/SAC Code */}
                    <td className="py-2 px-3">
                      <input
                        type="text"
                        placeholder="HSN/SAC"
                        value={row.itemHSN}
                        onChange={(e) => updateLineItem(row.id, { itemHSN: e.target.value })}
                        className="w-full px-2 py-1.5 text-center rounded-lg border border-slate-200 text-slate-700 font-mono text-xs focus:outline-none focus:border-blue-600"
                      />
                    </td>

                    {/* Quantity */}
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={row.quantity}
                        onChange={(e) =>
                          updateLineItem(row.id, { quantity: Math.max(1, Number(e.target.value) || 1) })
                        }
                        className="w-full px-2 py-1.5 text-right font-bold font-mono rounded-lg border border-slate-200 text-slate-900 text-xs focus:outline-none focus:border-blue-600"
                      />
                    </td>

                    {/* Unit */}
                    <td className="py-2 px-3">
                      <select
                        value={row.unit}
                        onChange={(e) => updateLineItem(row.id, { unit: e.target.value })}
                        className="w-full px-2 py-1.5 text-center rounded-lg border border-slate-200 text-slate-800 text-xs font-semibold focus:outline-none focus:border-blue-600"
                      >
                        <option value="PCS">PCS</option>
                        <option value="NOS">NOS</option>
                        <option value="SET">SET</option>
                        <option value="BOX">BOX</option>
                        <option value="MTR">MTR</option>
                        <option value="ROLL">ROLL</option>
                      </select>
                    </td>

                    {/* Remove Row Button */}
                    <td className="py-2 px-2 text-center">
                      <button
                        type="button"
                        onClick={() => removeLineItem(row.id)}
                        className="p-1 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Remove Line"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>

              {/* Total Quantity Row */}
              <tfoot>
                <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold text-slate-900">
                  <td colSpan={3} className="py-2.5 px-3 text-right text-xs uppercase tracking-wider text-slate-600">
                    Total Quantity:
                  </td>
                  <td className="py-2.5 px-3 text-right text-sm font-bold font-mono text-blue-700">
                    {totalQuantity}
                  </td>
                  <td className="py-2.5 px-3 text-center text-xs text-blue-700 font-bold">
                    Units
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Add Line Button */}
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => addNewRow()}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-xl border border-blue-200 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Another Item Row</span>
            </button>

            <span className="text-xs font-semibold text-slate-500">
              Total Items in Challan: <strong className="text-slate-900">{lineItems.length}</strong>
            </span>
          </div>
        </div>

        {/* Verification Blocks: Delivered By & Received By */}
        <div className="pt-4 border-t border-slate-200 space-y-3">
          <span className="text-xs font-extrabold uppercase tracking-wider text-slate-600 block">
            Verification & Signatory Details
          </span>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Delivered By */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2 text-xs">
              <span className="text-[11px] font-bold text-blue-700 uppercase tracking-wide block">
                Delivered By (Sender Dispatch)
              </span>
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Dispatch Incharge Name"
                  value={deliveredByName}
                  onChange={(e) => setDeliveredByName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-800 text-xs font-medium focus:outline-none focus:border-blue-600"
                />
                <input
                  type="text"
                  placeholder="Dispatch Comment / Vehicle / Courier No..."
                  value={deliveredByComment}
                  onChange={(e) => setDeliveredByComment(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-800 text-xs font-medium focus:outline-none focus:border-blue-600"
                />
              </div>
            </div>

            {/* Received By */}
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2 text-xs">
              <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wide block">
                Received By (Recipient Acknowledgment)
              </span>
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Receiver / Store Incharge Name"
                  value={receivedByName}
                  onChange={(e) => setReceivedByName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-800 text-xs font-medium focus:outline-none focus:border-blue-600"
                />
                <input
                  type="text"
                  placeholder="Acknowledgment Comment (e.g. Received in Good Condition)"
                  value={receivedByComment}
                  onChange={(e) => setReceivedByComment(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-800 text-xs font-medium focus:outline-none focus:border-blue-600"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Terms and Conditions */}
        <div className="pt-2 border-t border-slate-200 space-y-2">
          <label className="text-xs font-extrabold uppercase tracking-wider text-slate-600 block">
            Terms & Conditions / Dispatch Note
          </label>
          <input
            type="text"
            value={termsAndConditions}
            onChange={(e) => setTermsAndConditions(e.target.value)}
            className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-800 text-xs font-medium focus:outline-none focus:border-blue-600"
          />
        </div>

        {/* Form Footer Actions */}
        <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            *Delivery Challan prints on standard A4 format matching the company profile layout.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePreview}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
            >
              <Printer className="h-4 w-4 text-blue-600" />
              <span>Preview PDF</span>
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all shadow-xs"
            >
              <Save className="h-4 w-4" />
              <span>Save Delivery Challan</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
