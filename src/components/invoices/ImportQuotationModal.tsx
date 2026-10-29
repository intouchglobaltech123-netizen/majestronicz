import React, { useMemo, useState } from 'react';
import { X, UploadCloud, FileSpreadsheet, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { useErp } from '../../context/ErpContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type Row = { sku: string; name: string; qty: number; price?: number };

/** Reads an uploaded .csv / .xlsx / .xls and turns it into a Quotation. The file
 *  can have 2 or 3 columns in any common order — with a header row it maps by
 *  the header names (SKU/Code, Item/Name, Qty/Quantity, Price/Rate); without a
 *  header it assumes column order: item (code or name), quantity, price. */
export const ImportQuotationModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { startQuotationFromLines, accessibleBranches, items } = useErp();
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [branchId, setBranchId] = useState<string>(accessibleBranches[0]?.id || '');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [parsing, setParsing] = useState(false);

  const codeSet = useMemo(() => new Set(items.map((i) => String(i.itemCode || '').trim().toUpperCase())), [items]);
  const nameSet = useMemo(() => new Set(items.map((i) => String(i.itemName || '').trim().toLowerCase())), [items]);
  const isMatched = (r: Row) =>
    (r.sku && codeSet.has(r.sku.toUpperCase())) || (r.name && nameSet.has(r.name.toLowerCase()));

  const interpret = (cells: any[][]): Row[] => {
    const grid = (cells || []).map((r) => (Array.isArray(r) ? r : [r])).filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
    if (!grid.length) return [];
    const header = grid[0].map((c) => String(c ?? '').trim().toLowerCase());
    const hasHeader = header.some((h) => /(sku|code|qty|quant|price|rate|item|name|product|descrip|mrp)/.test(h));
    let skuI = -1, nameI = -1, qtyI = -1, priceI = -1;
    if (hasHeader) {
      header.forEach((h, i) => {
        if (skuI < 0 && /(sku|code)/.test(h)) skuI = i;
        else if (nameI < 0 && /(name|item|product|descrip)/.test(h)) nameI = i;
        if (qtyI < 0 && /(qty|quant|nos|pcs|pieces)/.test(h)) qtyI = i;
        if (priceI < 0 && /(price|rate|amount|mrp)/.test(h)) priceI = i;
      });
    }
    const data = hasHeader ? grid.slice(1) : grid;
    const itemI = skuI >= 0 ? skuI : nameI >= 0 ? nameI : 0; // the product column
    const q = qtyI >= 0 ? qtyI : itemI === 0 ? 1 : 0;        // quantity column
    const p = priceI >= 0 ? priceI : Math.max(itemI, q) + 1; // price column (optional)
    const num = (v: any) => { const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : NaN; };
    const out: Row[] = [];
    for (const r of data) {
      const codeCol = skuI >= 0 ? String(r[skuI] ?? '').trim() : '';
      const nameCol = nameI >= 0 ? String(r[nameI] ?? '').trim() : '';
      let sku = codeCol, name = nameCol;
      if (!sku && !name) { // single product column — decide code vs name by catalog
        const v = String(r[itemI] ?? '').trim();
        if (codeSet.has(v.toUpperCase())) sku = v; else name = v;
      }
      const qty = Math.round(num(r[q])) || 0;
      const priceRaw = p >= 0 ? r[p] : undefined;
      const price = priceRaw != null && String(priceRaw).trim() !== '' && Number.isFinite(num(priceRaw)) ? num(priceRaw) : undefined;
      if ((sku || name) && qty > 0) out.push({ sku, name, qty, price });
    }
    return out;
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setParsing(true);
    setFileName(file.name);
    try {
      let cells: any[][] = [];
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        const XLSX = await import('xlsx');
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        cells = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' }) as any[][];
      } else {
        const text = await file.text();
        cells = text.split(/\r?\n/).filter((l) => l.trim() !== '').map((line) => {
          // comma / tab / semicolon separated, honouring simple "quoted,values"
          const m = line.match(/("([^"]*)"|[^,\t;]+)(?=[,\t;]|$)/g) || [];
          return m.map((c) => c.replace(/^"|"$/g, '').trim());
        });
      }
      const parsed = interpret(cells);
      setRows(parsed);
      if (!parsed.length) toast.error('No usable rows found', { description: 'Expected columns: item (SKU or name), quantity, and optionally price.' });
    } catch (e: any) {
      toast.error('Could not read the file', { description: e?.message || 'Use a .csv, .xlsx or .xls file.' });
      setRows([]);
    } finally {
      setParsing(false);
    }
  };

  const convert = () => {
    if (!branchId) { toast.error('Choose a branch'); return; }
    if (!rows.length) { toast.error('Upload a file with items first'); return; }
    startQuotationFromLines(rows, { branchId, customerName: customerName.trim(), customerPhone: customerPhone.replace(/\D/g, ''), note: fileName ? `from ${fileName}` : undefined });
    onClose();
    setRows([]); setFileName(''); setCustomerName(''); setCustomerPhone('');
  };

  if (!isOpen) return null;
  const matchedCount = rows.filter(isMatched).length;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div className="bg-white border border-slate-300 rounded-xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Import Excel / CSV → Quotation</h3>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-xl py-7 cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/40 transition-colors">
            <UploadCloud className="h-7 w-7 text-slate-400" />
            <span className="text-xs font-bold text-slate-700">{fileName || 'Click to choose an Excel (.xlsx) or CSV file'}</span>
            <span className="text-[11px] text-slate-500">Columns (2 or 3, any order): item (SKU or name), quantity, price — a header row is auto-detected.</span>
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="text-[11px] font-bold uppercase text-slate-500">Branch *</label>
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="w-full mt-1 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-900 bg-white">
                {accessibleBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Customer name (optional)" className="sm:mt-5 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-900" />
            <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="Phone (optional)" className="sm:mt-5 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-900" />
          </div>

          {parsing && <p className="text-xs text-slate-500">Reading file…</p>}
          {rows.length > 0 && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 flex items-center justify-between">
                <span>Preview — {rows.length} line(s), {matchedCount} in catalog{rows.length - matchedCount > 0 ? `, ${rows.length - matchedCount} not found (price starts at ₹0)` : ''}</span>
              </div>
              <div className="max-h-56 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0"><tr className="text-left text-[11px] text-slate-500"><th className="px-3 py-1.5">Item (SKU / name)</th><th className="px-3 py-1.5 text-right">Qty</th><th className="px-3 py-1.5 text-right">Price</th><th className="px-3 py-1.5">In catalog</th></tr></thead>
                  <tbody>
                    {rows.slice(0, 50).map((r, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-3 py-1.5 font-semibold text-slate-800">{r.sku || r.name}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{r.qty}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{r.price != null ? `₹${r.price}` : '—'}</td>
                        <td className="px-3 py-1.5">{isMatched(r) ? <span className="text-emerald-700 font-bold">✓</span> : <span className="text-amber-600 font-bold">not found</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-300">Cancel</button>
          <button type="button" onClick={convert} disabled={!rows.length} className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg border border-emerald-700 inline-flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" /> Create Quotation ({rows.length})
          </button>
        </div>
      </div>
    </div>
  );
};
