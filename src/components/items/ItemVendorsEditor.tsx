import React from 'react';
import { Plus, Trash2, Star } from 'lucide-react';
import { ItemVendor, Vendor } from '../../types';
import { UniversalDropdown } from '../common/UniversalDropdown';

interface Props {
  /** Current supplier list for the item. First entry is the primary. */
  value: ItemVendor[];
  onChange: (next: ItemVendor[]) => void;
  /** Master vendor list to pick from. */
  vendorMaster: Vendor[];
  /** Read-only (e.g. a role without item-management rights). */
  disabled?: boolean;
}

/**
 * Edits the multiple vendors an item can be purchased from, each with that
 * vendor's own product code. The first row is the PRIMARY supplier — it drives
 * the default purchase cost and is what existing screens show; a Purchase Order
 * raised to any of these vendors auto-fills that vendor's code from this list.
 */
export const ItemVendorsEditor: React.FC<Props> = ({ value, onChange, vendorMaster, disabled }) => {
  const rows = value.length ? value : [{ vendorId: '', vendorCode: '' }];

  const nameOf = (id: string) => vendorMaster.find((v) => v.id === id)?.vendorName || '';

  const update = (idx: number, patch: Partial<ItemVendor>) => {
    const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    onChange(next);
  };

  const addRow = () => onChange([...rows, { vendorId: '', vendorCode: '' }]);

  const removeRow = (idx: number) => {
    const next = rows.filter((_, i) => i !== idx);
    onChange(next.length ? next : [{ vendorId: '', vendorCode: '' }]);
  };

  const makePrimary = (idx: number) => {
    if (idx === 0) return;
    const next = [...rows];
    const [row] = next.splice(idx, 1);
    onChange([row, ...next]);
  };

  return (
    <div className="md:col-span-2 space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold uppercase tracking-wider text-slate-700">
          Vendors / Suppliers
        </label>
        <span className="text-[11px] text-slate-400 normal-case">
          First = primary • each with its own product code
        </span>
      </div>

      <div className="space-y-2">
        {rows.map((row, idx) => {
          // Vendors already chosen on other rows can't be picked again.
          const takenElsewhere = new Set(
            rows.filter((_, i) => i !== idx).map((r) => r.vendorId).filter(Boolean)
          );
          const options = [
            { value: '', label: '— Select vendor —' },
            ...vendorMaster
              .filter((v) => !takenElsewhere.has(v.id))
              .map((v) => ({ value: v.id, label: v.vendorName })),
          ];
          return (
            <div
              key={idx}
              className="flex items-end gap-2 rounded-none border border-slate-200 bg-slate-50/60 p-2"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    {idx === 0 ? 'Primary' : `Vendor ${idx + 1}`}
                  </span>
                  {idx === 0 && <Star className="h-3 w-3 fill-amber-400 text-amber-400" />}
                </div>
                <UniversalDropdown
                  value={row.vendorId}
                  onChange={(val) => update(idx, { vendorId: String(val), vendorName: nameOf(String(val)) })}
                  options={options}
                  disabled={disabled}
                />
              </div>
              <div className="flex-1 min-w-0">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                  Vendor Code
                </label>
                <input
                  type="text"
                  placeholder="e.g. DVP-14SS211R"
                  value={row.vendorCode || ''}
                  onChange={(e) => update(idx, { vendorCode: e.target.value })}
                  disabled={disabled}
                  className="w-full px-3 py-2 rounded-none bg-white border border-slate-300 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 transition-colors font-mono disabled:bg-slate-100 disabled:text-slate-500"
                />
              </div>
              <div className={`flex items-center gap-1 pb-1.5 ${disabled ? 'hidden' : ''}`}>
                {idx !== 0 && (
                  <button
                    type="button"
                    onClick={() => makePrimary(idx)}
                    title="Make primary"
                    className="p-1.5 rounded-none text-slate-400 hover:text-amber-500 hover:bg-amber-50 border border-transparent hover:border-amber-200 transition-colors"
                  >
                    <Star className="h-4 w-4" />
                  </button>
                )}
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(idx)}
                    title="Remove vendor"
                    className="p-1.5 rounded-none text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!disabled && (
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-red-700 hover:text-red-800"
        >
          <Plus className="h-3.5 w-3.5" /> Add another vendor
        </button>
      )}
    </div>
  );
};

/**
 * Normalize an item's supplier list before saving: drop rows with no vendor,
 * trim codes, and keep each vendor once (first wins). Returns the cleaned list
 * plus the primary's id/code to mirror onto Item.vendorId / Item.vendorCode.
 */
export function normalizeItemVendors(rows: ItemVendor[]): {
  vendors: ItemVendor[];
  primaryVendorId?: string;
  primaryVendorCode?: string;
} {
  const seen = new Set<string>();
  const vendors: ItemVendor[] = [];
  for (const r of rows || []) {
    const vendorId = (r.vendorId || '').trim();
    if (!vendorId || seen.has(vendorId)) continue;
    seen.add(vendorId);
    vendors.push({
      vendorId,
      vendorName: r.vendorName?.trim() || undefined,
      vendorCode: (r.vendorCode || '').trim() || undefined,
    });
  }
  return {
    vendors,
    primaryVendorId: vendors[0]?.vendorId,
    primaryVendorCode: vendors[0]?.vendorCode,
  };
}
