import jsPDF from 'jspdf';
import { buildXlsx } from './xlsxWriter';

type Cell = string | number | boolean | null | undefined;

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const baseName = (filename: string) => filename.replace(/\.(csv|xls|xlsx|pdf)$/i, '');

/** Export to Excel as a real .xlsx workbook (text stays text — never a formula). */
export function exportToExcel(filename: string, headers: string[], rows: Cell[][]): void {
  // A real .xlsx workbook (SAL6-9 / RPT-4) — the old HTML-table ".xls" made
  // Excel warn that the file format and extension don't match.
  const bytes = buildXlsx(headers, rows, baseName(filename).slice(0, 31) || 'Sheet1');
  triggerDownload(
    new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${baseName(filename)}.xlsx`,
  );
}

/**
 * Export a simple tabular PDF via jsPDF (already a dependency). Landscape A4,
 * auto-paginates, truncates over-long cells to keep columns readable.
 */
export function exportToPdf(filename: string, headers: string[], rows: Cell[][], title?: string): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 28;
  let y = 40;

  if (title) {
    doc.setFontSize(14); doc.setFont('helvetica', 'bold');
    doc.text(title, margin, y); y += 8;
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(120);
    doc.text(new Date().toLocaleString('en-IN'), margin, y + 8); y += 22;
    doc.setTextColor(0);
  }

  const cols = Math.max(1, headers.length);
  const colW = (pageW - margin * 2) / cols;
  const maxChars = Math.max(6, Math.floor(colW / 4.2));
  const fit = (c: Cell) => {
    const t = String(c ?? '');
    return t.length > maxChars ? t.slice(0, maxChars - 1) + '…' : t;
  };

  const drawRow = (cells: Cell[], bold: boolean) => {
    doc.setFontSize(8);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    cells.forEach((c, i) => doc.text(fit(c), margin + i * colW + 2, y));
    y += 13;
    if (y > pageH - 24) { doc.addPage(); y = 40; }
  };

  drawRow(headers, true);
  doc.setDrawColor(200); doc.line(margin, y - 9, pageW - margin, y - 9);
  rows.forEach((r) => drawRow(r, false));

  doc.save(`${baseName(filename)}.pdf`);
}

export type ExportFormat = 'csv' | 'excel' | 'pdf';
