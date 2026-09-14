import jsPDF from 'jspdf';

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

/**
 * Export to a real Excel-openable file (.xls) using an HTML table — no library,
 * opens directly in Excel / Google Sheets with basic formatting.
 */
export function exportToExcel(filename: string, headers: string[], rows: Cell[][]): void {
  const esc = (v: Cell) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const thead = `<tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>`;
  const tbody = rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
  const html =
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">` +
    `<head><meta charset="utf-8"><style>` +
    `table{border-collapse:collapse}td,th{border:1px solid #cbd5e1;padding:5px 8px;font-family:Arial,sans-serif;font-size:12px}` +
    `th{background:#e2e8f0;font-weight:bold;text-align:left}</style></head>` +
    `<body><table>${thead}${tbody}</table></body></html>`;
  triggerDownload(new Blob(['﻿' + html], { type: 'application/vnd.ms-excel' }), `${baseName(filename)}.xls`);
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
