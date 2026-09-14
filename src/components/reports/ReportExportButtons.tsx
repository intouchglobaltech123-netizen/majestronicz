import React from 'react';
import { FileText, FileSpreadsheet, FileDown } from 'lucide-react';
import type { ExportFormat } from '../../utils/exportHelpers';

/** CSV / Excel / PDF export buttons for report tabs. */
export const ReportExportButtons: React.FC<{ onExport: (fmt: ExportFormat) => void; disabled?: boolean }> = ({ onExport, disabled }) => {
  const base = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs';
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onExport('csv')} disabled={disabled} className={`${base} bg-white border-slate-200 text-slate-700 hover:bg-slate-50`}>
        <FileText className="h-3.5 w-3.5 text-slate-500" /> CSV
      </button>
      <button onClick={() => onExport('excel')} disabled={disabled} className={`${base} bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100`}>
        <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
      </button>
      <button onClick={() => onExport('pdf')} disabled={disabled} className={`${base} bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100`}>
        <FileDown className="h-3.5 w-3.5" /> PDF
      </button>
    </div>
  );
};
