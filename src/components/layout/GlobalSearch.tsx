import React, { useMemo, useRef, useState, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import { Search, X, Receipt, FileText, Users, Building2, Boxes } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';

/**
 * Vyapar-style global search in the top bar. Searches across sales invoices,
 * quotations, customers, suppliers and items, and jumps to the right section.
 */
export const GlobalSearch: React.FC = () => {
  const {
    invoices,
    estimates,
    customers,
    vendors,
    items,
    navigateToTab,
    setCurrentView,
  } = useErp();

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return null;
    const cap = 5;
    const inv = invoices
      .filter((i) => !i.isVoided && (
        i.invoiceNumber.toLowerCase().includes(q) ||
        i.customerName.toLowerCase().includes(q) ||
        (i.customerPhone || '').includes(q)
      ))
      .slice(0, cap);
    const est = estimates
      .filter((e) => e.estimateNumber.toLowerCase().includes(q) || e.customerName.toLowerCase().includes(q))
      .slice(0, cap);
    const cust = customers
      .filter((c) => c.name.toLowerCase().includes(q) || (c.phone || '').includes(q))
      .slice(0, cap);
    const vend = vendors
      .filter((v) => v.vendorName.toLowerCase().includes(q) || (v.contactNo || '').includes(q))
      .slice(0, cap);
    const it = items
      .filter((i) => i.itemName.toLowerCase().includes(q) || i.itemCode.toLowerCase().includes(q))
      .slice(0, cap);
    return { inv, est, cust, vend, it, total: inv.length + est.length + cust.length + vend.length + it.length };
  }, [query, invoices, estimates, customers, vendors, items]);

  const go = (fn: () => void) => {
    fn();
    setQuery('');
    setOpen(false);
  };

  const rowCls = 'w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-100 transition-colors cursor-pointer';

  return (
    <div ref={boxRef} className="relative flex-1 max-w-md hidden md:block">
      <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
      <input
        id="global-search-input"
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search invoices, customers, items…"
        className="w-full pl-9 pr-8 py-1.5 rounded-none bg-slate-50 border border-slate-300 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-red-600 focus:bg-white transition-colors"
      />
      {query && (
        <button
          type="button"
          onClick={() => { setQuery(''); setOpen(false); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {open && results && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-300 rounded-none shadow-xl z-50 max-h-[70vh] overflow-y-auto">
          {results.total === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-slate-400">
              No matches for “{query.trim()}”
            </div>
          ) : (
            <>
              {results.inv.length > 0 && (
                <Group label="Sales Invoices" icon={Receipt}>
                  {results.inv.map((i) => (
                    <button key={i.id} type="button" className={rowCls} onClick={() => go(() => navigateToTab('invoices', 'ledger'))}>
                      <Receipt className="h-3.5 w-3.5 text-red-600 shrink-0" />
                      <span className="font-mono font-bold text-[11px] text-slate-700 shrink-0">{i.invoiceNumber}</span>
                      <span className="text-xs text-slate-700 truncate">{i.customerName}</span>
                      <span className="ml-auto text-[11px] font-mono text-slate-500 shrink-0">{formatCurrency(i.grandTotal || 0)}</span>
                    </button>
                  ))}
                </Group>
              )}
              {results.est.length > 0 && (
                <Group label="Quotations" icon={FileText}>
                  {results.est.map((e) => (
                    <button key={e.id} type="button" className={rowCls} onClick={() => go(() => navigateToTab('invoices', 'estimates'))}>
                      <FileText className="h-3.5 w-3.5 text-slate-600 shrink-0" />
                      <span className="font-mono font-bold text-[11px] text-slate-700 shrink-0">{e.estimateNumber}</span>
                      <span className="text-xs text-slate-700 truncate">{e.customerName}</span>
                    </button>
                  ))}
                </Group>
              )}
              {results.cust.length > 0 && (
                <Group label="Customers" icon={Users}>
                  {results.cust.map((c) => (
                    <button key={c.id} type="button" className={rowCls} onClick={() => go(() => navigateToTab('parties', 'customers'))}>
                      <Users className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span className="text-xs font-semibold text-slate-800 truncate">{c.name}</span>
                      <span className="ml-auto text-[11px] font-mono text-slate-500 shrink-0">{c.phone}</span>
                    </button>
                  ))}
                </Group>
              )}
              {results.vend.length > 0 && (
                <Group label="Suppliers" icon={Building2}>
                  {results.vend.map((v) => (
                    <button key={v.id} type="button" className={rowCls} onClick={() => go(() => navigateToTab('parties', 'suppliers'))}>
                      <Building2 className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                      <span className="text-xs font-semibold text-slate-800 truncate">{v.vendorName}</span>
                      <span className="ml-auto text-[11px] font-mono text-slate-500 shrink-0">{v.contactNo}</span>
                    </button>
                  ))}
                </Group>
              )}
              {results.it.length > 0 && (
                <Group label="Items" icon={Boxes}>
                  {results.it.map((i) => (
                    <button key={i.id} type="button" className={rowCls} onClick={() => go(() => setCurrentView('items'))}>
                      <Boxes className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                      <span className="text-xs font-semibold text-slate-800 truncate">{i.itemName}</span>
                      <span className="ml-auto font-mono text-[11px] text-slate-500 shrink-0">{i.itemCode}</span>
                    </button>
                  ))}
                </Group>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

const Group: React.FC<{ label: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }> = ({ label, icon: Icon, children }) => (
  <div className="border-b border-slate-100 last:border-b-0">
    <div className="px-3 py-1.5 bg-slate-50 text-[11px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
      <Icon className="h-3 w-3" />
      {label}
    </div>
    {children}
  </div>
);
