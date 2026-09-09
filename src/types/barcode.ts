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
    id: '50x25',
    name: '50 × 25 mm (40 Labels / A4 Sheet)',
    description: 'Medium retail barcode sheet (4 columns × 10 rows)',
    widthMm: 50,
    heightMm: 25,
    columns: 4,
    rows: 10,
    labelsPerPage: 40,
    pageMarginTopMm: 15,
    pageMarginLeftMm: 5,
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
