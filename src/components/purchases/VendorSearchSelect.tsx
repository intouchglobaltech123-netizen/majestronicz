import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Vendor } from '../../types';
import { Search, ChevronDown, Plus, Check } from 'lucide-react';

interface Props {
  vendors: Vendor[];
  value: string; // selected vendor id
  onChange: (vendorId: string) => void;
  onAddNew?: (name: string) => string | void;
  placeholder?: string;
}

/**
 * Type-to-search supplier picker (replaces the plain dropdown) — with many
 * vendors, staff need to search by name rather than scroll a long list.
 */
export const VendorSearchSelect: React.FC<Props> = ({ vendors, value, onChange, onAddNew, placeholder = 'Search supplier…' }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Highlighted option for keyboard use (PUR5-12); the "add new" row is the
  // option after the last match.
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = vendors.find((v) => v.id === value) || null;

  // Close on outside click.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? vendors.filter((v) =>
          v.vendorName.toLowerCase().includes(q) ||
          (v.gstin || '').toLowerCase().includes(q) ||
          (v.contactNo || '').includes(q))
      : vendors;
    return list.slice(0, 30);
  }, [vendors, query]);

  const exact = vendors.some((v) => v.vendorName.trim().toLowerCase() === query.trim().toLowerCase());
  const canAdd = Boolean(onAddNew && query.trim() && !exact);
  const optionCount = filtered.length + (canAdd ? 1 : 0);

  useEffect(() => { setActive(0); }, [query, open]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-opt="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (v: Vendor) => { onChange(v.id); setOpen(false); setQuery(''); };
  const addNew = () => {
    if (!onAddNew) return;
    const id = onAddNew(query.trim());
    if (typeof id === 'string') onChange(id);
    setOpen(false);
    setQuery('');
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      if (optionCount) setActive((a) => (a + 1) % optionCount);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (optionCount) setActive((a) => (a - 1 + optionCount) % optionCount);
    } else if (e.key === 'Enter') {
      if (!open || !optionCount) return;
      e.preventDefault(); // never submit the surrounding PO form
      if (active < filtered.length) pick(filtered[active]);
      else if (canAdd) addNew();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <div className="relative" ref={boxRef}>
      <div
        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-white border border-slate-300 cursor-text focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100"
        onClick={() => setOpen(true)}
      >
        <Search className="h-4 w-4 text-slate-400 shrink-0" />
        <input
          value={open ? query : (selected?.vendorName || '')}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          placeholder={selected ? selected.vendorName : placeholder}
          className="flex-1 min-w-0 text-sm text-slate-900 bg-transparent focus:outline-none"
        />
        <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
      </div>

      {open && (
        <div ref={listRef} role="listbox" className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto rounded-lg bg-white border border-slate-200 shadow-lg">
          {filtered.length === 0 && !query.trim() && (
            <div className="px-3 py-2 text-xs text-slate-400">No suppliers yet.</div>
          )}
          {filtered.length === 0 && !!query.trim() && !onAddNew && (
            <div className="px-3 py-2 text-xs text-slate-500">No supplier matches — add it with its contact details under Parties → Suppliers.</div>
          )}
          {filtered.map((v, i) => (
            <button
              key={v.id}
              type="button"
              data-opt={i}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(v)}
              className={`w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between gap-2 ${i === active ? 'bg-blue-50' : ''}`}
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-800 truncate">{v.vendorName}</span>
                <span className="block text-[11px] text-slate-400 truncate">{v.gstin ? `GST: ${v.gstin}` : v.contactNo || ''}</span>
              </span>
              {v.id === value && <Check className="h-4 w-4 text-emerald-600 shrink-0" />}
            </button>
          ))}
          {canAdd && (
            <button
              type="button"
              data-opt={filtered.length}
              role="option"
              aria-selected={active === filtered.length}
              onMouseEnter={() => setActive(filtered.length)}
              onClick={addNew}
              className={`w-full text-left px-3 py-2 hover:bg-emerald-50 text-emerald-700 text-sm font-bold border-t border-slate-100 flex items-center gap-1.5 ${active === filtered.length ? 'bg-emerald-50' : ''}`}
            >
              <Plus className="h-4 w-4" /> Add new supplier “{query.trim()}”
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default VendorSearchSelect;
