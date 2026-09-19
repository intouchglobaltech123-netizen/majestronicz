import React from 'react';
import { FileText, FileSpreadsheet, FileDown } from 'lucide-react';
import type { ExportFormat } from '../../utils/exportHelpers';

/** CSV / Excel / PDF export buttons for report tabs. */
export const ReportExportButtons: React.FC<{ onExport: (fmt: ExportFormat) => void; disabled?: boolean }> = ({ onExport, disabled }) => {
  const base = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-none text-xs font-bold border border-slate-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-none cursor-pointer uppercase font-mono';
  return (
    <div className="flex items-center gap-1.5">
      <button onClick={() => onExport('csv')} disabled={disabled} className={`${base} bg-white text-slate-800 hover:bg-slate-100 hover:border-slate-400`}>
        <FileText className="h-3.5 w-3.5 text-slate-600" /> CSV
      </button>
      <button onClick={() => onExport('excel')} disabled={disabled} className={`${base} bg-white text-emerald-800 hover:bg-emerald-50 hover:border-emerald-500`}>
        <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" /> Excel
      </button>
      <button onClick={() => onExport('pdf')} disabled={disabled} className={`${base} bg-white text-red-800 hover:bg-red-50 hover:border-red-400`}>
        <FileDown className="h-3.5 w-3.5 text-red-700" /> PDF
      </button>
    </div>
  );
};
