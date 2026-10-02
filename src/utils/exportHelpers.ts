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
  const fontSize = headers.length > 14 ? 6.5 : headers.length > 10 ? 7 : 8;
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
  // Width each column by its widest content (header words count once), then
  // scale to the page.
  doc.setFontSize(fontSize);
  doc.setFont('helvetica', 'bold');
  const headerWords = headers.map((h) => Math.max(...pdfText(h).split(/\s+/).map((w) => doc.getTextWidth(w)), 20));
  doc.setFont('helvetica', 'normal');
  // A row with text only in its first cell is a section label: it spans the page.
  const isLabelRow = (r: Cell[]) => r.length > 0 && r.slice(1).every((c) => c === '' || c == null);
  const want = Array.from({ length: cols }, (_, i) => {
    const headerWord = headerWords[i];
    const body = rows.filter((r) => !isLabelRow(r)).reduce((m, r) => Math.max(m, Math.min(220, doc.getTextWidth(show(r[i])))), 0);
    return Math.max(headerWord, body) + pad * 2;
  });
  // Too wide for the page: keep every column at least as wide as its longest
  // header word and take the room from the long text columns.
  const base = headerWords.map((w) => w + pad * 2);
  const total = want.reduce((t, w) => t + w, 0);
  const baseSum = base.reduce((t, w) => t + w, 0);
  const extra = want.map((w, i) => Math.max(0, w - base[i]));
  const extraSum = extra.reduce((t, w) => t + w, 0);
  const widths = total <= usable
    ? want.map((w) => (w / total) * usable)
    : baseSum < usable && extraSum > 0
      ? base.map((b, i) => b + (extra[i] / extraSum) * (usable - baseSum))
      : want.map((w) => (w / total) * usable);
  const xs = widths.map((_, i) => margin + widths.slice(0, i).reduce((t, w) => t + w, 0));
  const fit = (t: string, w: number) => {
    if (doc.getTextWidth(t) <= w) return t;
    let s = t;
    while (s.length > 1 && doc.getTextWidth(s + '...') > w) s = s.slice(0, -1);
    return s + '...';
  };

  const drawHeader = () => {
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', 'bold');
    const wrapped = headers.map((h, i) => doc.splitTextToSize(pdfText(h), widths[i] - pad * 2) as string[]);
    const lines = Math.max(...wrapped.map((w) => w.length));
    wrapped.forEach((w, i) => w.forEach((t, k) => doc.text(t, xs[i] + pad, y + k * (fontSize + 2))));
    y += lines * (fontSize + 2) + 2;
    doc.setDrawColor(200); doc.line(margin, y - fontSize, pageW - margin, y - fontSize);
    y += 4;
    doc.setFont('helvetica', 'normal');
  };

  drawHeader();
  rows.forEach((r) => {
    if (y > pageH - 24) { doc.addPage(); y = 40; drawHeader(); }
    const label = String(r[0] ?? '');
    doc.setFont('helvetica', /^(TOTAL|---)/.test(label) ? 'bold' : 'normal');
    if (isLabelRow(r)) {
      if (label) doc.text(fit(pdfText(label), usable), margin + pad, y);
      y += fontSize + 5;
      return;
    }
    r.forEach((c, i) => {
      if (i >= cols) return;
      const t = fit(show(c), widths[i] - pad * 2);
      if (isNumericCell(c)) doc.text(t, xs[i] + widths[i] - pad, y, { align: 'right' });
      else doc.text(t, xs[i] + pad, y);
    });
    y += fontSize + 5;
  });

  doc.save(`${baseName(filename)}.pdf`);
}

export type ExportFormat = 'csv' | 'excel' | 'pdf';
