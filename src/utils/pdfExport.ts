import jsPDF from 'jspdf';
import { toast } from 'sonner';
// html2canvas-pro (drop-in fork) understands CSS Color 4 functions like oklch()
// and lab(), which Tailwind v4 emits. The legacy html2canvas 1.4.1 throws
// "unsupported color function 'oklch'" and aborts the whole export (SAL-3).
import html2canvas from 'html2canvas-pro';

interface ExportPdfOptions {
  scale?: number;
  filename?: string;
}

/**
 * Captures an HTML element and returns the rendered A4 PDF as a jsPDF document.
 * Shared by the download and share flows.
 */
async function renderElementToPdf(elementId: string, options: ExportPdfOptions = {}): Promise<jsPDF> {
  const element = document.getElementById(elementId);
  if (!element) {
    throw new Error(`Element with id "${elementId}" not found`);
  }

  const scale = options.scale || 2; // Crisp resolution

  // Render the document at a FIXED A4 width during capture. Without this, the
  // element was captured at whatever width the modal happened to be, so the
  // aspect ratio wasn't A4 — the table rendered misaligned and the page had a big
  // blank strip. 794px = 210mm at 96dpi. We also let it grow to its full height
  // (the modal normally scrolls it) so the whole invoice is captured.
  const A4_WIDTH_PX = 794;
  const saved = {
    width: element.style.width,
    maxWidth: element.style.maxWidth,
    height: element.style.height,
    maxHeight: element.style.maxHeight,
    overflow: element.style.overflow,
    flex: element.style.flex,
  };
  element.style.width = `${A4_WIDTH_PX}px`;
  element.style.maxWidth = `${A4_WIDTH_PX}px`;
  element.style.height = 'auto';
  element.style.maxHeight = 'none';
  element.style.overflow = 'visible';
  element.style.flex = 'none';

  let canvas: HTMLCanvasElement;
  try {
    canvas = await html2canvas(element, {
      scale,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      windowWidth: A4_WIDTH_PX,
      width: A4_WIDTH_PX,
      // Never paint an on-screen toast into the document (E2E6-10).
      ignoreElements: (el) => el.hasAttribute?.('data-sonner-toaster') || el.hasAttribute?.('data-sonner-toast'),
    });
  } finally {
    // Always restore the on-screen layout, even if capture threw.
    element.style.width = saved.width;
    element.style.maxWidth = saved.maxWidth;
    element.style.height = saved.height;
    element.style.maxHeight = saved.maxHeight;
    element.style.overflow = saved.overflow;
    element.style.flex = saved.flex;
  }

  const imgData = canvas.toDataURL('image/jpeg', 0.98);

  // Standard A4 dimensions in mm
  const pdfWidth = 210;
  const pageHeight = 297;
  const imgHeight = (canvas.height * pdfWidth) / canvas.width;

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  let heightLeft = imgHeight;
  let position = 0;

  // Add first page
  pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, imgHeight, undefined, 'FAST');
  heightLeft -= pageHeight;

  // Add subsequent pages if document is longer than single A4 page
  while (heightLeft > 0) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, imgHeight, undefined, 'FAST');
    heightLeft -= pageHeight;
  }

  return pdf;
}

const ensurePdfExt = (filename: string) => (filename.endsWith('.pdf') ? filename : `${filename}.pdf`);

/**
 * Print a document through the browser's own print pipeline (E2E5-17 / SAL4-6).
 * `bodyClass` is the print scope in index.css that hides the app and lets the
 * document flow across A4 pages — selectable text, the goods-table header
 * repeated on every page and no row cut in half.
 *
 * With `saveAsPdf`, the same layout is what "Save as PDF" produces: the print
 * dialog opens with the file name preset (Chromium names the PDF after the
 * page title) and a hint to choose "Save as PDF" as the destination. That
 * replaces the old image capture, which sliced one screenshot into pages.
 */
export function printDocument(bodyClass: string, opts: { saveAsPdf?: string } = {}): void {
  const previousTitle = document.title;
  if (opts.saveAsPdf) {
    document.title = opts.saveAsPdf.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '-');
    toast.info('Choose "Save as PDF" as the destination in the print window.', { id: 'save-as-pdf', duration: 6000 });
  }
  document.body.classList.add(bodyClass);
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    document.body.classList.remove(bodyClass);
    document.title = previousTitle;
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => {
    window.print();
    setTimeout(cleanup, 1000);
  }, 50);
}

/**
 * Captures an HTML element and returns the PDF as a File, for use with the Web
 * Share API (e.g. sharing the invoice PDF to WhatsApp on mobile).
 */
export async function exportElementToPdfFile(
  elementId: string,
  filename: string,
  options: ExportPdfOptions = {}
): Promise<File> {
  const pdf = await renderElementToPdf(elementId, options);
  const safeFilename = ensurePdfExt(filename);
  const blob = pdf.output('blob');
  return new File([blob], safeFilename, { type: 'application/pdf' });
}
