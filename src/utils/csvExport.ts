import { toast } from 'sonner';

/**
 * Universal CSV Export Utility for Majestronicz ERP Reports
 * Formats tabular data with UTF-8 BOM encoding for seamless Excel & Google Sheets compatibility.
 */
export const exportToCsv = (
  filename: string,
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][]
): void => {
  try {
    const escapeCell = (cell: string | number | boolean | null | undefined): string => {
      if (cell === null || cell === undefined) return '""';
      let str = String(cell);
      // Neutralize spreadsheet formula injection (=, +, -, @ prefixes) — but NOT
      // genuine numbers. A negative number like -53998.00 is data, not a formula,
      // and must not be turned into the text "'-53998.00" (RPT2-6).
      const isNumeric = typeof cell === 'number' || /^-?\d+(\.\d+)?$/.test(str.trim());
      // A section label such as "--- SUMMARY BREAKDOWN ---" (letters, digits,
      // spaces and & only between the dashes) is not a formula either (RPT2-6).
      const isSectionLabel = /^-{3} [A-Z0-9 &/()]+ -{3}$/.test(str.trim());
      if (!isNumeric && !isSectionLabel && /^[=+\-@\t\r]/.test(str)) str = `'${str}`;
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return `"${str}"`;
    };

    const headerLine = headers.map(escapeCell).join(',');
    const rowLines = rows.map((row) => row.map(escapeCell).join(','));
    const csvContent = [headerLine, ...rowLines].join('\r\n');

    // Prepend UTF-8 BOM so Microsoft Excel correctly displays UTF-8 characters and currency symbols
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const safeFilename = filename.endsWith('.csv') ? filename : `${filename}.csv`;
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', safeFilename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success('Report exported to CSV', {
      description: `Downloaded file: ${safeFilename}`,
    });
  } catch (err) {
    console.error('Failed to export CSV:', err);
    toast.error('Failed to export CSV report');
  }
};
