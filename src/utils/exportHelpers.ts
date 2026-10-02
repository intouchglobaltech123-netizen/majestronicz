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

/** jsPDF's built-in fonts have no ₹ glyph (it printed as garbage — RPT2-8):
 *  write "Rs." instead, and drop any other character the font can't draw. */
const pdfText = (c: Cell): string =>
  String(c ?? '')
    .replace(/₹\s?/g, 'Rs. ')
    .replace(/[−–—]/g, '-')
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '');

const isNumericCell = (c: Cell) => typeof c === 'number' || (typeof c === 'string' && /^-?[\d,]+(\.\d+)?%?$/.test(c.trim()));

/**
 * Export a tabular PDF via jsPDF (already a dependency). Landscape A4, paginated
 * with the header repeated on every page. Column widths follow their content
 * (so invoice numbers are not cut — V2), headers wrap instead of overlapping,
 * numbers are right-aligned with Indian grouping, and ₹ prints as "Rs.".
 */
export async function exportToPdf(filename: string, headers: string[], rows: Cell[][], title?: string): Promise<void> {
  // jsPDF loads only when a PDF is exported (PLT-12).
  const { default: JsPDF } = await import('jspdf');
  const doc = new JsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 28;
  const usable = pageW - margin * 2;
  const pad = 3;
  let fontSize = headers.length > 14 ? 6.5 : headers.length > 10 ? 7 : 8;
  let y = 40;

  if (title) {
    doc.setFontSize(14); doc.setFont('helvetica', 'bold');
    doc.text(pdfText(title), margin, y); y += 8;
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(120);
    doc.text(new Date().toLocaleString('en-IN'), margin, y + 8); y += 22;
    doc.setTextColor(0);
  }

  const cols = Math.max(1, headers.length);
  const show = (c: Cell): string => {
    if (typeof c === 'number' && Number.isFinite(c)) {
      return c.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(c) ? 0 : 2, maximumFractionDigits: 2 });
    }
    return pdfText(c);
  };
  // A row with text only in its first cell is a section label: it spans the page.
  const isLabelRow = (r: Cell[]) => r.length > 0 && r.slice(1).every((c) => c === '' || c == null);
  const bodyRows = rows.filter((r) => !isLabelRow(r));
  // V2: a column of numbers is never cut ("1,23,4..." lost the figure); text
  // wraps onto more lines instead of being truncated.
  const numericCol = Array.from({ length: cols }, (_, i) => bodyRows.some((r) => isNumericCell(r[i])) && bodyRows.every((r) => r[i] === '' || r[i] == null || isNumericCell(r[i]) || String(r[0]) === 'TOTAL'));
  const layout = () => {
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', 'bold');
    const headerOnly = headers.map((h) => Math.max(...pdfText(h).split(/\s+/).map((w) => doc.getTextWidth(w)), 14) + pad * 2);
    doc.setFont('helvetica', 'normal');
    // A word is never split across lines (a date, an invoice number, a branch
    // code): a text column is at least as wide as its longest word (capped).
    const headerWords = headerOnly.map((hw, i) => Math.max(hw, Math.min(120, bodyRows.reduce((m, r) => Math.max(m, ...show(r[i]).split(/\s+/).map((w) => doc.getTextWidth(w))), 0) + pad * 2)));
    // Numbers: their widest value. Text: its widest value up to a cap (it wraps).
    const need = Array.from({ length: cols }, (_, i) => {
      const body = bodyRows.reduce((m, r) => Math.max(m, doc.getTextWidth(show(r[i]))), 0) + pad * 2;
      return Math.max(headerWords[i], numericCol[i] ? body : Math.min(body, 160));
    });
    const fixed = need.reduce((t, w, i) => t + (numericCol[i] ? w : headerWords[i]), 0);
    return { headerWords, need, fixed };
  };
  let L = layout();
  // Shrink the type (down to 5 pt) until every number and every header word fits.
  while (L.fixed > usable && fontSize > 5) { fontSize = Math.max(5, fontSize - 0.5); L = layout(); }
  const totalNeed = L.need.reduce((t, w) => t + w, 0);
  let widths: number[];
  if (totalNeed <= usable) {
    widths = L.need.map((w) => (w / totalNeed) * usable);
  } else {
    // Numbers keep their full width; text columns share what is left.
    const textIdx = L.need.map((_, i) => i).filter((i) => !numericCol[i]);
    const numSum = L.need.reduce((t, w, i) => t + (numericCol[i] ? w : 0), 0);
    const left = Math.max(0, usable - numSum);
    const textMin = textIdx.reduce((t, i) => t + L.headerWords[i], 0);
    const textWant = textIdx.reduce((t, i) => t + L.need[i], 0);
    widths = L.need.map((w, i) => {
      if (numericCol[i]) return w;
      if (left <= textMin || textWant <= textMin) return L.headerWords[i];
      return L.headerWords[i] + ((w - L.headerWords[i]) / (textWant - textMin)) * (left - textMin);
    });
  }
  const xs = widths.map((_, i) => margin + widths.slice(0, i).reduce((t, w) => t + w, 0));
  const lineH = () => fontSize + 2;

  const drawHeader = () => {
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', 'bold');
    const wrapped = headers.map((h, i) => doc.splitTextToSize(pdfText(h), widths[i] - pad * 2) as string[]);
    const lines = Math.max(...wrapped.map((w) => w.length));
    wrapped.forEach((w, i) => w.forEach((t, k) => {
      if (numericCol[i]) doc.text(t, xs[i] + widths[i] - pad, y + k * lineH(), { align: 'right' });
      else doc.text(t, xs[i] + pad, y + k * lineH());
    }));
    y += lines * lineH() + 2;
    doc.setDrawColor(200); doc.line(margin, y - fontSize, pageW - margin, y - fontSize);
    y += 4;
    doc.setFont('helvetica', 'normal');
  };

  drawHeader();
  rows.forEach((r) => {
    const label = String(r[0] ?? '');
    doc.setFont('helvetica', /^(TOTAL|---)/.test(label) ? 'bold' : 'normal');
    if (isLabelRow(r)) {
      if (y > pageH - 24) { doc.addPage(); y = 40; drawHeader(); }
      const wrapped = doc.splitTextToSize(pdfText(label), usable - pad * 2) as string[];
      wrapped.forEach((t, k) => doc.text(t, margin + pad, y + k * lineH()));
      y += wrapped.length * lineH() + 3;
      return;
    }
    const cells = r.slice(0, cols).map((c, i) => (isNumericCell(c) ? [show(c)] : (doc.splitTextToSize(show(c), widths[i] - pad * 2) as string[]).slice(0, 4)));
    const lines = Math.max(1, ...cells.map((c) => c.length));
    if (y + (lines - 1) * lineH() > pageH - 24) { doc.addPage(); y = 40; drawHeader(); }
    cells.forEach((c, i) => c.forEach((t, k) => {
      if (isNumericCell(r[i])) doc.text(t, xs[i] + widths[i] - pad, y + k * lineH(), { align: 'right' });
      else doc.text(t, xs[i] + pad, y + k * lineH());
    }));
    y += lines * lineH() + 3;
  });

  doc.save(`${baseName(filename)}.pdf`);
}

export type ExportFormat = 'csv' | 'excel' | 'pdf';
