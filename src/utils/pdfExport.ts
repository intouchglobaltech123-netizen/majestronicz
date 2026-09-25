import jsPDF from 'jspdf';
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

  // Store original scroll position and style adjustments if any
  const scale = options.scale || 2; // Crisp resolution

  const canvas = await html2canvas(element, {
    scale,
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff',
    windowWidth: element.scrollWidth || 1024,
  });

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
 * Captures an HTML element and triggers a direct PDF file download in the browser
 * without opening the native print dialog.
 */
export async function exportElementToPdf(
  elementId: string,
  filename: string,
  options: ExportPdfOptions = {}
): Promise<void> {
  const pdf = await renderElementToPdf(elementId, options);
  pdf.save(ensurePdfExt(filename));
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
