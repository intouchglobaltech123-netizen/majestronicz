import React, { useState } from 'react';
import { Download, FileSpreadsheet, FileText, Calendar } from 'lucide-react';
import { exportToCsv } from '../../utils/csvExport';
import { getTodayDateString } from '../../lib/utils';
import { exportToExcel, exportToPdf } from '../../utils/exportHelpers';

export type ExportRows = { headers: string[]; rows: (string | number)[][]; title: string; filename: string };

interface Props {
  /** Build the export dataset for the chosen date range (inclusive YYYY-MM-DD, '' = unbounded). */
  build: (from: string, to: string) => ExportRows;
  /** Whether the underlying records carry a date to range-filter on (hides date inputs if false). */
  withDateRange?: boolean;
  className?: string;
}

/**
 * Reusable "take the report out" bar for any list page: pick a date range and
 * download the current list as PDF / Excel / CSV. Each page supplies `build`.
 */
export const ListExportBar: React.FC<Props> = ({ build, withDateRange = true, className }) => {
  const today = getTodayDateString();
  const monthAgo = getTodayDateString(new Date(Date.now() - 30 * 864e5));
  const [from, setFrom] = useState(withDateRange ? monthAgo : '');
  const [to, setTo] = useState(withDateRange ? today : '');

  const run = (fmt: 'pdf' | 'excel' | 'csv') => {
    const data = build(from, to);
    if (fmt === 'pdf') exportToPdf(data.filename, data.headers, data.rows, data.title);
    else if (fmt === 'excel') exportToExcel(data.filename, data.headers, data.rows);
    else exportToCsv(data.filename, data.headers, data.rows);
  };

  const btn = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-none border text-xs font-bold transition-colors cursor-pointer';

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className || ''}`}>
      {withDateRange && (
        <div className="flex items-center gap-1.5 text-xs text-slate-600">
          <Calendar className="h-3.5 w-3.5 text-slate-400" />
          <input
            type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="px-2 py-1 rounded-none border border-slate-300 bg-white text-xs font-semibold text-slate-800 focus:outline-none focus:border-red-600"
          />
          <span className="text-slate-400">to</span>
          <input
            type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="px-2 py-1 rounded-none border border-slate-300 bg-white text-xs font-semibold text-slate-800 focus:outline-none focus:border-red-600"
          />
        </div>
      )}
      <button type="button" onClick={() => run('pdf')} className={`${btn} text-red-800 bg-white border-red-300 hover:bg-red-50`} title="Download as PDF">
        <FileText className="h-3.5 w-3.5" /> PDF
      </button>
      <button type="button" onClick={() => run('excel')} className={`${btn} text-emerald-800 bg-white border-emerald-300 hover:bg-emerald-50`} title="Download as Excel">
        <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
      </button>
      <button type="button" onClick={() => run('csv')} className={`${btn} text-slate-700 bg-white border-slate-300 hover:bg-slate-100`} title="Download as CSV">
        <Download className="h-3.5 w-3.5" /> CSV
      </button>
    </div>
  );
};
