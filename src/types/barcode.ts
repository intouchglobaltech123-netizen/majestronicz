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

export const LABEL_SIZE_PRESETS: LabelSizePreset[] = [
  {
    id: '38x21',
    name: '38 × 21 mm (65 Labels / A4 Sheet)',
    description: 'Standard retail sticker sheet (5 columns × 13 rows) — Default',
    widthMm: 38,
    heightMm: 21.2,
    columns: 5,
    rows: 13,
    labelsPerPage: 65,
    pageMarginTopMm: 10.7,
    pageMarginLeftMm: 4.5,
    gapXmm: 2.5,
    gapYmm: 0,
  },
  {
    id: 'a4-48',
    name: '48 × 22 mm (48 Labels / A4 Sheet)',
    description: 'Retail sticker sheet (4 columns × 12 rows)',
    widthMm: 48,
    heightMm: 22,
    columns: 4,
    rows: 12,
    labelsPerPage: 48,
    // 4 + 4×48 + 3×2 = 202 mm wide; 10 + 12×22 + 11×2 = 296 mm tall → fits A4.
    pageMarginTopMm: 10,
    pageMarginLeftMm: 4,
    gapXmm: 2,
    gapYmm: 2,
  },
  {
    id: 'a4-56',
    name: '48 × 19 mm (56 Labels / A4 Sheet)',
    description: 'Compact retail sticker sheet (4 columns × 14 rows)',
    widthMm: 48,
    heightMm: 19,
    columns: 4,
    rows: 14,
    labelsPerPage: 56,
    // 4 + 4×48 + 3×2 = 202 mm wide; 8 + 14×19 + 13×1.5 = 293.5 mm tall → fits A4.
    pageMarginTopMm: 8,
    pageMarginLeftMm: 4,
    gapXmm: 2,
    gapYmm: 1.5,
  },
  {
    id: 'a4-84',
    name: '32 × 19 mm (84 Labels / A4 Sheet)',
    description: 'Small-item sticker sheet (6 columns × 14 rows)',
    widthMm: 32,
    heightMm: 19,
    columns: 6,
    rows: 14,
    labelsPerPage: 84,
    // 4 + 6×32 + 5×2 = 206 mm wide; 8 + 14×19 + 13×1.5 = 293.5 mm tall → fits A4.
    pageMarginTopMm: 8,
    pageMarginLeftMm: 4,
    gapXmm: 2,
    gapYmm: 1.5,
  },
  {
    id: '50x25',
    name: '50 × 25 mm (40 Labels / A4 Sheet)',
    description: 'Medium retail barcode sheet (4 columns × 10 rows)',
    widthMm: 50,
    heightMm: 25,
    columns: 4,
    rows: 10,
    labelsPerPage: 40,
    pageMarginTopMm: 15,
    // 2 + 4×50 + 3×2 = 208 mm: fits the 210 mm A4 width (5 mm overflowed it).
    pageMarginLeftMm: 2,
    gapXmm: 2,
    gapYmm: 2,
  },
  {
    id: '63.5x38.1',
    name: '63.5 × 38.1 mm (21 Labels / A4 Sheet)',
    description: 'Large shipping / package label sheet (3 columns × 7 rows)',
    widthMm: 63.5,
    heightMm: 38.1,
    columns: 3,
    rows: 7,
    labelsPerPage: 21,
    pageMarginTopMm: 15.1,
    pageMarginLeftMm: 7.2,
    gapXmm: 2.5,
    gapYmm: 0,
  },
  {
    id: '100x50',
    name: '100 × 50 mm (10 Labels / A4 Sheet)',
    description: 'Pallet / Warehouse master carton label (2 columns × 5 rows)',
    widthMm: 100,
    heightMm: 50,
    columns: 2,
    rows: 5,
    labelsPerPage: 10,
    pageMarginTopMm: 15,
    pageMarginLeftMm: 5,
    gapXmm: 2,
    gapYmm: 5,
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
