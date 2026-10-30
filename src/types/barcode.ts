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
    // 65-up is the universal A4 label grid (Avery L7651 / Trendz 65L). Its die-cut
    // pitch is 38.1 × 21.2 mm (NOT a round 38 × 21) — using the exact pitch is what
    // keeps every row/column landing on its sticker instead of drifting onto the
    // cut line over 13 rows. The shop uses 48L + 65L, so this sits second.
    id: 'a4-65',
    name: '38 × 21 mm (65 Labels / A4 — 65L)',
    description: 'Common small sticker sheet (5 columns × 13 rows)',
    widthMm: 38.1,
    heightMm: 21.2,
    columns: 5,
    rows: 13,
    labelsPerPage: 65,
    // width: 5×38.1 + 4×2.54 + 2×4.675 = 210 mm; height: 13×21.2 + 2×10.7 = 297 mm.
    pageMarginTopMm: 10.7,
    pageMarginLeftMm: 4.675,
    gapXmm: 2.54,
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

// Label text sizes (in px; the print CSS px→mm maps at ~0.265 mm/px). One shared
// scale so the on-screen preview and the printed sticker use identical sizing,
// and the shop can bump everything up/down with the Label Text Size setting.
// Client 2026-10-30: wanted the product details bigger + bold and the barcode
// easier/faster to scan.
export interface LabelTextScale {
  header: number;
  code: number;
  name: number;   // line1 — product name, the most important line
  line: number;   // line2 (e.g. MRP)
  lineSmall: number; // line3 / line4
}

// Sizes kept modest so header + barcode + code + name + MRP all fit INSIDE a
// small label (even 38×21 mm / 65L) with margin to spare — an over-tall stack
// was overflowing the sticker and pushing the barcode onto the die-cut line.
export const LABEL_TEXT_SCALES: Record<BarcodeSettings['fontSize'], LabelTextScale> = {
  small:  { header: 7,   code: 6.5, name: 7,   line: 6.5, lineSmall: 6 },
  medium: { header: 8,   code: 7,   name: 8.5, line: 7.5, lineSmall: 6.5 },
  large:  { header: 9,   code: 8,   name: 10,  line: 8.5, lineSmall: 7.5 },
};

export function labelTextScale(fontSize: BarcodeSettings['fontSize'] | undefined): LabelTextScale {
  return LABEL_TEXT_SCALES[fontSize || 'medium'] || LABEL_TEXT_SCALES.medium;
}
