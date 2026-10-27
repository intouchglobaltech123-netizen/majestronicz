export type PrinterType = 'regular' | 'thermal';

export interface LabelSizePreset {
  id: string;
  name: string;
  description: string;
  widthMm: number;
  heightMm: number;
  columns: number;
  rows: number;
  labelsPerPage: number;
  pageMarginTopMm: number;
  pageMarginLeftMm: number;
  gapXmm: number;
  gapYmm: number;
}

// The three A4 sticker sheets the shop actually stocks (Trendz Paper die-cut
// sheets, codes 48L / 56L / 84L). Each preset's margins + gaps are solved so the
// grid fills a 210 × 297 mm A4 page EXACTLY — that way every printed label lands
// on its physical die-cut sticker and one sticker's text can never spill onto the
// next one. 48L is the default (the shop's main sheet). Client request 2026-10-27.
export const LABEL_SIZE_PRESETS: LabelSizePreset[] = [
  {
    id: 'a4-48',
    name: '48 × 24 mm (48 Labels / A4 — 48L)',
    description: 'Standard retail sticker sheet (4 columns × 12 rows) — Default',
    widthMm: 48,
    heightMm: 24,
    columns: 4,
    rows: 12,
    labelsPerPage: 48,
    // width: 4×48 + 3×2.5 + 2×5.25 = 210 mm; height: 12×24 + 2×4.5 = 297 mm.
    pageMarginTopMm: 4.5,
    pageMarginLeftMm: 5.25,
    gapXmm: 2.5,
    gapYmm: 0,
  },
  {
    id: 'a4-56',
    name: '46 × 20 mm (56 Labels / A4 — 56L)',
    description: 'Compact retail sticker sheet (4 columns × 14 rows)',
    widthMm: 46,
    heightMm: 20,
    columns: 4,
    rows: 14,
    labelsPerPage: 56,
    // width: 4×46 + 3×2.5 + 2×9.25 = 210 mm; height: 14×20 + 2×8.5 = 297 mm.
    pageMarginTopMm: 8.5,
    pageMarginLeftMm: 9.25,
    gapXmm: 2.5,
    gapYmm: 0,
  },
  {
    id: 'a4-84',
    name: '46 × 11 mm (84 Labels / A4 — 84L)',
    description: 'Small-item sticker sheet (4 columns × 21 rows)',
    widthMm: 46,
    heightMm: 11,
    columns: 4,
    rows: 21,
    labelsPerPage: 84,
    // width: 4×46 + 3×2.5 + 2×9.25 = 210 mm; height: 21×11 + 20×2.5 + 2×8 = 297 mm.
    pageMarginTopMm: 8,
    pageMarginLeftMm: 9.25,
    gapXmm: 2.5,
    gapYmm: 2.5,
  },
  {
    id: 'thermal-50x25',
    name: '50 × 25 mm (Single Thermal Roll)',
    description: 'Direct Thermal / Ribbon Roll continuous sticker',
    widthMm: 50,
    heightMm: 25,
    columns: 1,
    rows: 1,
    labelsPerPage: 1,
    pageMarginTopMm: 0,
    pageMarginLeftMm: 0,
    gapXmm: 0,
    gapYmm: 0,
  },
];

export interface QueuedBarcodeItem {
  id: string; // queue item id
  itemId: string;
  itemCode: string;
  itemName: string;
  salePrice: number;
  purchasePrice: number;
  stock: number;
  noOfLabels: number;
  header: string;
  line1: string;
  line2: string;
  line3: string;
  line4: string;
}

export interface BarcodeSettings {
  printerType: PrinterType;
  labelPresetId: string;
  showBorders: boolean;
  fontSize: 'small' | 'medium' | 'large';
}
