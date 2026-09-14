export type BranchId = 'erode-hq' | 'coimbatore' | 'chennai';
export type BranchScope = BranchId | 'all';

export interface Branch {
  id: BranchId;
  name: string;
  shortCode: string;
  location: string;
  isHq: boolean;
  tagline: string;
}

export type Role = 'CEO' | 'Manager' | 'Billing' | 'Purchase' | 'Sales';

export interface UserSession {
  role: Role;
  name: string;
  pin: string;
  assignedBranchId?: BranchId; // Only applicable for Manager
  userId?: string; // staff account id (for PIN reset targeting)
}

// ---- Dynamic role-based access control (managed by CEO) ----
export type Capability =
  | 'items:write' | 'sales:write' | 'stock:write' | 'purchase:write' | 'cash:write'
  | 'hrm:write' | 'payroll:admin' | 'enquiry:write' | 'estimate:write' | 'challan:write'
  | 'config:write' | 'customer:write' | 'payment:write' | 'ai:use' | 'admin';

export type AccessMatrix = Record<Role, { views: string[]; caps: Capability[]; flags: string[] }>;

// AI data-scope flags: which business domains a role's Beta AI may read.
export const AI_DATA_FLAGS: string[] = [
  'ai.data.sales', 'ai.data.cash', 'ai.data.inventory', 'ai.data.products',
  'ai.data.customers', 'ai.data.purchase', 'ai.data.hrm',
];

// Fine-grained field/data-visibility flags (keep in sync with backend ALL_FLAGS).
export const ALL_FLAGS: string[] = [
  'bill.editPrice', 'bill.giveDiscount', 'view.purchaseCost', 'view.customerBalance',
  ...AI_DATA_FLAGS,
];

export const FLAG_LABELS: Record<string, string> = {
  'bill.editPrice': 'Edit item price while billing',
  'bill.giveDiscount': 'Give discounts while billing',
  'view.purchaseCost': 'See purchase price / cost',
  'view.customerBalance': 'See customer outstanding balance',
  'ai.data.sales': 'AI can read sales & invoices',
  'ai.data.cash': 'AI can read cash register & balances',
  'ai.data.inventory': 'AI can read stock levels',
  'ai.data.products': 'AI can read product details & pricing',
  'ai.data.customers': 'AI can read customer info & balances',
  'ai.data.purchase': 'AI can read purchases & supplier costs',
  'ai.data.hrm': 'AI can read staff & payroll',
};

// Keep in sync with backend/src/lib/auth.ts (ALL_VIEWS / ALL_CAPS).
export const ALL_VIEWS: string[] = [
  'dashboard', 'items', 'customers', 'enquiries', 'pending-orders', 'estimates',
  'challans', 'inventory', 'invoices', 'barcodes', 'cash-register', 'purchases',
  'hrm', 'reports', 'ai-assistant', 'access',
];

export const ALL_CAPABILITIES: Capability[] = [
  'items:write', 'sales:write', 'stock:write', 'purchase:write', 'cash:write',
  'hrm:write', 'payroll:admin', 'enquiry:write', 'estimate:write', 'challan:write',
  'config:write', 'customer:write', 'payment:write', 'ai:use', 'admin',
];

export const VIEW_LABELS: Record<string, string> = {
  dashboard: 'Dashboard', items: 'Items Master', customers: 'Customers', enquiries: 'Enquiries',
  'pending-orders': 'Pending Orders', estimates: 'Quotes', challans: 'Delivery Challan',
  inventory: 'Inventory', invoices: 'Sales', barcodes: 'Barcode', 'cash-register': 'Cash Register',
  purchases: 'Purchases', hrm: 'Attendance', reports: 'Reports', 'ai-assistant': 'Beta AI', access: 'Access Control',
};

export const CAP_LABELS: Record<Capability, string> = {
  'items:write': 'Add / edit / delete items & combos',
  'sales:write': 'Create / void / return sales',
  'stock:write': 'Adjust & transfer stock',
  'purchase:write': 'Manage purchases & vendors',
  'cash:write': 'Cash register & expenses',
  'hrm:write': 'Attendance & employees',
  'payroll:admin': 'Payroll adjustments & disbursement (sensitive)',
  'enquiry:write': 'Manage enquiries & pending orders',
  'estimate:write': 'Create / edit quotations',
  'challan:write': 'Create / edit delivery challans',
  'config:write': 'Edit catalog config & loyalty settings',
  'customer:write': 'Add / edit customers',
  'payment:write': 'Record payments & receipts (party ledger)',
  'ai:use': 'Use Beta AI assistant',
  admin: 'Reset demo data & manage access control (CEO)',
};

export type SalePriceTaxMode = 'with' | 'without';
export type DiscountType = '%' | 'amount';

/**
 * Item Entity (Core Master Catalog)
 * Static master pricing is shared across all branches and editable only via Item Master.
 */
export interface Item {
  id: string;
  itemName: string;
  itemHSN: string;
  category: string;
  subcategory?: string;
  itemCode: string;
  unit: string;

  // Master Static Pricing (Identical across all branches)
  salePrice: number;
  salePriceTaxMode: SalePriceTaxMode;
  wholesalePrice: number;
  minWholesaleQty: number;
  purchasePrice: number;
  gstTaxSlab: number; // e.g. 18 for 18%
  discountOnSalePrice?: number;
  discountType?: DiscountType;
  reorderThreshold?: number; // Threshold for Low Stock alerts (default 10)
  imageUrl?: string; // Optional product image URL
  description?: string; // Optional product description / specs / notes

  createdAt: string;
  updatedAt: string;
}

/**
 * BranchStock Entity
 * Tracks physical stock count separately per branch. Price is NOT stored here.
 */
export interface BranchStock {
  itemId: string;
  branchId: BranchId;
  quantity: number;
  location?: string; // Rack / Bin location (e.g. "RACK-A1", "BIN-04")
  minStockAlert?: number;
  updatedAt: string;
}

export type TransactionType = 'Credit' | 'Cash';
export type PaymentMode = 'HDFC' | 'Cash' | 'GPay' | 'COD-Credit';

export interface PaymentSplit {
  mode: PaymentMode;
  amount: number;
}

/**
 * Invoice Line Item Entity
 * CRITICAL RULE: When a bill/invoice line item's price is edited at billing time
 * (e.g. a wholesale discount given to one customer), that edited price must be stored
 * ONLY on this line item record (unitPrice / overriddenPrice), and must NEVER write back to or
 * mutate the master Item.salePrice. The master catalog price stays static regardless
 * of what price staff bill at.
 */
export interface InvoiceLineItem {
  id: string;
  itemId?: string;
  itemCode?: string;
  itemName: string;
  itemHSN: string;
  unit: string;
  quantity: number;
  unitPrice: number; // Pre-tax editable price override (stored ONLY on this line item)
  discountType?: DiscountType;
  discountValue?: number;
  discountAmount: number;
  taxRate: number; // e.g. 18 for 18%
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  totalTax: number;
  totalAmount: number;
  isCombo?: boolean;
  comboId?: string;
  comboComponents?: ComboComponent[];
}

export interface ComboComponent {
  itemId: string;
  quantity: number;
}

export interface ComboItem {
  id: string;
  comboName: string;
  comboCode: string; // Standard format: [Category prefix]-[Subcategory prefix]-[sequence]
  category?: string;
  subcategory?: string;
  comboPrice: number; // static, global
  components: ComboComponent[];
  description?: string;
  imageUrl?: string; // Optional combo image URL
  createdAt?: string;
  updatedAt?: string;
}

export interface InvoiceAttachment {
  name: string;
  size?: string;
  type?: string;
}

export interface SaleReturnLineItem {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  returnedQuantity: number;
  unitPrice: number;
  taxRate: number;
  refundAmount: number;
  returnedAt: string;
  reason?: string;
  notes?: string;
  processedBy?: string;
  isCombo?: boolean;
  comboId?: string;
  comboComponents?: ComboComponent[];
}

export interface Invoice {
  id: string;
  invoiceNumber: string; // e.g. MZERD26-27/7307
  branchId: BranchId;
  transactionType: TransactionType; // Credit vs Cash toggle at top
  customerId?: string;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  paymentTerms: string; // e.g. "Due on Receipt", "Net 15"
  dueDate: string; // YYYY-MM-DD
  stateOfSupply: string; // e.g. "33-Tamil Nadu"
  withGst: boolean;
  items: InvoiceLineItem[];
  subtotal: number;
  totalTax: number;
  totalCgst: number;
  totalSgst: number;
  overallDiscountType: DiscountType;
  overallDiscountValue: number;
  overallDiscountAmount: number;
  shippingCharges: number;
  roundOff: number;
  roundOffEnabled: boolean;
  grandTotal: number;
  amountInWords: string;
  termsAndConditions: string;
  description?: string;
  attachments?: InvoiceAttachment[];
  paymentMode: PaymentMode; // HDFC | Cash | GPay | COD-Credit (Primary mode)
  paymentSplits?: PaymentSplit[]; // Multi-mode payment splits (e.g. ₹100 Cash + ₹50 GPay)
  isPartialPayment?: boolean; // PP flag
  partialAmount?: number;
  balanceDue?: number;
  sourceEstimateId?: string; // If converted from an Estimate
  sourceEstimateNumber?: string;
  sourceEnquiryId?: string; // If converted from an Enquiry
  sourceEnquiryNumber?: string;
  createdById?: string;
  createdAt: string;
  updatedAt?: string;

  // Audit-grade Void & Line-Item Return tracking
  isVoided?: boolean;
  voidReason?: string;
  voidedAt?: string;
  voidedBy?: string;
  returns?: SaleReturnLineItem[];
  totalReturnedAmount?: number;
  isLoyaltyRewardApplied?: boolean;
  loyaltyRewardDiscountAmount?: number;
  // Salesperson incentive — manually assigned per bill; ₹ stored at save time.
  salespersonId?: string;
  salespersonName?: string;
  incentivePercent?: number;
  incentiveAmount?: number;
}

export const BRANCHES: Branch[] = [
  {
    id: 'erode-hq',
    name: 'Erode HQ',
    shortCode: 'ERD-HQ',
    location: 'Perundurai Road, Erode',
    isHq: true,
    tagline: 'Central Warehouse & Hub',
  },
  {
    id: 'coimbatore',
    name: 'Coimbatore',
    shortCode: 'CBE',
    location: 'Gandhipuram, Coimbatore',
    isHq: false,
    tagline: 'Industrial & Robotics Center',
  },
  {
    id: 'chennai',
    name: 'Chennai',
    shortCode: 'CHE',
    location: 'Ambattur Industrial Estate, Chennai',
    isHq: false,
    tagline: 'Metro Regional Outlet',
  },
];

export const STANDARD_UNITS = [
  { value: 'PCS', label: 'PCS (Pieces)' },
  { value: 'BOX', label: 'BOX (Box)' },
  { value: 'NOS', label: 'NOS (Numbers)' },
  { value: 'SET', label: 'SET (Set)' },
  { value: 'MTR', label: 'MTR (Meters)' },
  { value: 'KGS', label: 'KGS (Kilograms)' },
  { value: 'PKT', label: 'PKT (Packets)' },
  { value: 'ROLL', label: 'ROLL (Rolls)' },
];

export const GST_RATES = [
  { rate: 0, label: 'GST @ 0% (Exempt)' },
  { rate: 5, label: 'GST @ 5%' },
  { rate: 12, label: 'GST @ 12%' },
  { rate: 18, label: 'GST @ 18% (Standard)' },
  { rate: 28, label: 'GST @ 28% (High Tax)' },
];

export const PRESET_ROLES: { role: Role; pin: string; defaultName: string; defaultBranch?: BranchId }[] = [
  { role: 'CEO', pin: '1111', defaultName: 'Sathish Kumar (CEO)' },
  { role: 'Manager', pin: '2222', defaultName: 'Karthik Raja (Branch Manager)', defaultBranch: 'coimbatore' },
  { role: 'Billing', pin: '3333', defaultName: 'Praveen (Billing Desk)', defaultBranch: 'erode-hq' },
  { role: 'Sales', pin: '4444', defaultName: 'Vignesh (Sales Executive)', defaultBranch: 'erode-hq' },
  { role: 'Purchase', pin: '5555', defaultName: 'Ganesh (Purchase Desk)', defaultBranch: 'erode-hq' },
];

/**
 * Company Profile Information (hardcoded for Majestronicz)
 */
export interface CompanyProfile {
  name: string;
  address: string;
  phone: string;
  email: string;
  gstin: string;
  state: string;
  ratingLink?: string; // customer review / rating URL shared on invoices
}

export const COMPANY_PROFILE: CompanyProfile = {
  name: 'MAJESTRONICZ',
  address: '10, Nachiappa 2nd St, Nachiyappa Colony, Kottai, Erode, Tamil Nadu 638001',
  phone: '6379560289',
  email: 'majestroniczonline@gmail.com',
  gstin: '33ABZFM5739L1ZD',
  state: '33-Tamil Nadu',
  // Replace with your Google review short-link (g.page/r/…/review) when available.
  ratingLink: 'https://www.google.com/search?q=Majestronicz+Erode',
};

export const DEFAULT_TERMS_AND_CONDITIONS = `**NO WARRANTY**
**NO EXCHANGE**
**NO RETURN**`;

export interface EstimateLineItem {
  id: string;
  itemId?: string;
  itemCode?: string;
  itemName: string;
  itemHSN: string;
  quantity: number;
  unit: string;
  unitPrice: number; // Pre-tax editable price override (never mutates Item.salePrice)
  gstRate: number; // e.g. 18 for 18%
  taxRate?: number;
  discount?: number;
  discountType?: DiscountType;
  discountValue?: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  totalTax: number;
  totalAmount: number;
  isCombo?: boolean;
  comboId?: string;
  comboComponents?: ComboComponent[];
}

export interface GstBreakdownRow {
  taxType: 'SGST' | 'CGST';
  rate: number; // Half of item's GST rate (e.g. 9 for 18% item)
  taxableAmount: number;
  taxAmount: number;
}

export interface Estimate {
  id: string;
  estimateNumber: string;
  branchId: BranchId;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  customerId?: string;
  customerName: string;
  customerContact?: string;
  customerAddress?: string;
  withGst: boolean;
  items: EstimateLineItem[];
  subtotal: number;
  totalCgst: number;
  totalSgst: number;
  totalTax: number;
  grandTotal: number;
  amountInWords: string;
  termsAndConditions: string;
  sourceEnquiryId?: string; // If converted from an Enquiry
  sourceEnquiryNumber?: string;
  createdAt: string;
}

/**
 * Calculate Indian Financial Year from date (e.g., 2026-09-07 -> "26-27", 2027-04-01 -> "27-28")
 * Indian FY runs April 1 (month index 3) through March 31 (month index 2).
 */
export function getFinancialYear(date: Date | string = new Date()): string {
  let d: Date;
  if (typeof date === 'string') {
    const parts = date.split('T')[0].split('-').map(Number);
    if (parts.length >= 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      d = new Date(parts[0], parts[1] - 1, parts[2]);
    } else {
      d = new Date(date);
    }
  } else {
    d = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
  }

  const month = d.getMonth(); // 0 is January, 2 is March, 3 is April
  const fullYear = d.getFullYear();
  const startYear = month >= 3 ? fullYear : fullYear - 1;
  const endYear = startYear + 1;
  return `${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`;
}

export function getBranchCodeForEstimate(branchId: BranchId): string {
  switch (branchId) {
    case 'erode-hq':
      return 'ERD';
    case 'coimbatore':
      return 'CBE';
    case 'chennai':
      return 'CHN';
    default:
      return 'ERD';
  }
}

export function getBranchCodeForInvoice(branchId: BranchId): string {
  switch (branchId) {
    case 'erode-hq':
      return 'ERD';
    case 'coimbatore':
      return 'CBE';
    case 'chennai':
      return 'CHN';
    default:
      return 'ERD';
  }
}

export const INDIAN_STATES = [
  '33-Tamil Nadu',
  '29-Karnataka',
  '32-Kerala',
  '37-Andhra Pradesh',
  '36-Telangana',
  '27-Maharashtra',
  '07-Delhi',
  '24-Gujarat',
  '09-Uttar Pradesh',
  '19-West Bengal',
  '08-Rajasthan',
  '23-Madhya Pradesh',
  '03-Punjab',
  '06-Haryana',
  '21-Odisha',
  '10-Bihar',
  '34-Puducherry',
];

export const PAYMENT_TERMS_OPTIONS = [
  { value: 'Due on Receipt', label: 'Due on Receipt', days: 0 },
  { value: 'Immediate', label: 'Immediate / Spot Cash', days: 0 },
  { value: 'Net 7', label: 'Net 7 Days', days: 7 },
  { value: 'Net 15', label: 'Net 15 Days', days: 15 },
  { value: 'Net 30', label: 'Net 30 Days', days: 30 },
  { value: 'Custom', label: 'Custom Due Date', days: 0 },
];

export const INVOICE_TERMS_PRESETS = [
  {
    id: 'sale-invoice-default',
    name: 'Sale Invoice (Default)',
    terms: `**NO WARRANTY**\n**NO EXCHANGE**\n**NO RETURN**\n1. Goods once sold will not be taken back or exchanged.\n2. Interest @ 18% p.a. will be charged if payment is not made within due date.\n3. Subject to Erode jurisdiction only.`,
  },
  {
    id: 'strict-counter',
    name: 'Counter Sale / Strict',
    terms: `**NO WARRANTY**\n**NO EXCHANGE**\nThanks for doing business with MAJESTRONICZ!`,
  },
  {
    id: 'commercial-project',
    name: 'Commercial / Industrial Order',
    terms: `1. Standard OEM manufacturer warranty applies where indicated.\n2. Dispatch against confirmed advance or agreed credit terms.\n3. Subject to Erode jurisdiction only.`,
  },
];

/**
 * Delivery Challan Definitions
 * Low-usage goods movement document (no pricing columns)
 */
export const DEFAULT_CHALLAN_TERMS = 'Thanks for doing business with us!';

export interface DeliveryChallanLineItem {
  id: string;
  itemId?: string;
  itemName: string;
  itemHSN: string;
  quantity: number;
  unit: string;
}

export interface ChallanPartyBlock {
  name?: string;
  comment?: string;
  date?: string;
}

export interface DeliveryChallan {
  id: string;
  challanNumber: string; // e.g. "DC-001"
  recipientName: string; // Plain text: branch name or customer name
  location?: string;
  contactNo?: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  items: DeliveryChallanLineItem[];
  totalQuantity: number;
  termsAndConditions: string;
  receivedBy?: ChallanPartyBlock;
  deliveredBy?: ChallanPartyBlock;
  createdAt: string;
}

/**
 * Customer Enquiry & Pending Order Definitions
 */
export type EnquiryStatus = 'Follow-up' | 'Converted' | 'Cancelled';
export type PendingOrderStatus = 'Waiting' | 'Stock Arrived' | 'Fulfilled' | 'Cancelled';

export interface FollowUpReminder {
  id: string;
  enquiryId: string;
  enquiryNumber: string;
  customerName: string;
  customerPhone?: string;
  itemName: string;
  branchId: BranchId;
  dueDate: string; // YYYY-MM-DD
  dueTime: string; // HH:mm
  notes?: string;
  isCompleted: boolean;
  completedAt?: string;
  createdAt: string;
}

export interface EnquiryTimelineEvent {
  id: string;
  timestamp: string; // ISO string
  type: 'created' | 'status_change' | 'reminder_set' | 'note_updated' | 'converted' | 'cancelled';
  title: string;
  description: string;
  actor?: string;
}

export interface Enquiry {
  id: string;
  enquiryNumber: string; // e.g. "ENQ-ERD-001"
  customerName: string;
  customerPhone?: string;
  itemId?: string; // Optional when isNewItemRequest is true (item not in catalog yet)
  itemName: string;
  itemCode?: string;
  unit: string;
  quantity: number;
  branchId: BranchId;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  notes?: string;
  status: EnquiryStatus;
  cancellationReason?: string;
  convertedTo?: {
    type: 'estimate' | 'invoice';
    id: string;
    number: string;
    convertedAt: string;
  };
  hasPendingOrder?: boolean;
  pendingOrderId?: string;
  reminderDate?: string; // YYYY-MM-DD
  reminderTime?: string; // HH:mm
  reminderNotes?: string;
  timeline?: EnquiryTimelineEvent[];
  createdAt: string;
  updatedAt: string;
  isNewItemRequest?: boolean;
  itemImageUrl?: string;
}

export interface PendingOrder {
  id: string;
  orderNumber: string; // e.g. "PO-WAIT-001"
  enquiryId: string;
  enquiryNumber: string;
  itemId: string;
  itemName: string;
  itemCode?: string;
  unit: string;
  branchId: BranchId;
  customerName: string;
  customerPhone?: string;
  quantityNeeded: number;
  expectedRestockDate?: string; // YYYY-MM-DD, staff-entered, editable
  status: PendingOrderStatus;
  cancellationReason?: string;
  fulfilledAt?: string;
  convertedTo?: {
    type: 'estimate' | 'invoice';
    id: string;
    number: string;
  };
  purchaseOrderId?: string;
  purchaseOrderNumber?: string;
  linkedPurchaseOrderId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export function getNextEnquirySequence(enquiries: Enquiry[], branchId: BranchId): string {
  const branchCode = branchId === 'erode-hq' ? 'ERD' : branchId === 'coimbatore' ? 'CBE' : 'CHE';
  const prefix = `ENQ-${branchCode}-`;
  const relevant = enquiries.filter((e) => e.enquiryNumber.startsWith(prefix));
  let nextSeq = 1;
  if (relevant.length > 0) {
    const sequences = relevant.map((e) => {
      const num = parseInt(e.enquiryNumber.replace(prefix, ''), 10);
      return isNaN(num) ? 0 : num;
    });
    nextSeq = Math.max(...sequences) + 1;
  }
  return `${prefix}${String(nextSeq).padStart(3, '0')}`;
}

export function getNextPendingOrderSequence(pendingOrders: PendingOrder[]): string {
  const prefix = 'PO-WAIT-';
  const relevant = pendingOrders.filter((p) => p.orderNumber.startsWith(prefix));
  let nextSeq = 1;
  if (relevant.length > 0) {
    const sequences = relevant.map((p) => {
      const num = parseInt(p.orderNumber.replace(prefix, ''), 10);
      return isNaN(num) ? 0 : num;
    });
    nextSeq = Math.max(...sequences) + 1;
  }
  return `${prefix}${String(nextSeq).padStart(3, '0')}`;
}

export * from './cashRegister';
export * from './customer';
import { Customer } from './customer';

/**
 * Vendor Master Entity
 */
export interface Vendor {
  id: string;
  vendorName: string;
  contactNo: string;
  address: string;
  gstin?: string;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Purchase Order Status
 */
export type PurchaseOrderStatus = 'Ordered' | 'Partially Received' | 'Received' | 'Cancelled';

/**
 * Purchase Order Line Item
 */
export interface POLineItem {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  itemHSN: string;
  unit: string;
  quantityOrdered: number;
  purchasePrice: number; // Pre-fills from Item.purchasePrice, editable per PO
  amount: number;
  receivedQuantity: number; // Tracks units actually received into physical stock
}

/**
 * Purchase Order Vendor Bill Attachment
 * 
 * STOPGAP ARCHITECTURE NOTE:
 * Storing bill attachments as base64 data URLs in localStorage is a temporary stopgap.
 * Once migrated to Postgres/Railway backend, this should move to real object storage
 * (S3-compatible, e.g. AWS S3, Cloudflare R2, MinIO) with object URLs stored in the DB.
 */
export interface PurchaseOrderAttachment {
  id: string;
  name: string;
  fileType: 'image' | 'pdf';
  fileSize?: string;
  dataUrl: string; // Base64 data URL stopgap
  uploadedAt: string;
  uploadedBy: string;
}

/**
 * Line item breakdown for an individual receiving event
 */
export interface POReceiptLineItem {
  itemId: string;
  itemName: string;
  itemCode: string;
  quantityOrdered: number;
  quantityReceivedThisEvent: number;
  totalReceivedSoFar: number;
  location?: string;
}

/**
 * Historical log of a specific physical stock receipt event against a PO
 */
export interface PurchaseOrderReceivingEvent {
  id: string;
  date: string;
  timestamp: string;
  receivedBy: string;
  notes?: string;
  lines: POReceiptLineItem[];
}

/**
 * Purchase Order Entity
 */
export interface PurchaseOrder {
  id: string;
  poNumber: string; // e.g. PO-ERD-2026-001
  vendorId: string;
  vendorName: string;
  vendorContact?: string;
  vendorAddress?: string;
  vendorGstin?: string;
  branchId: BranchId;
  date: string;
  expectedDeliveryDate: string;
  status: PurchaseOrderStatus;
  items: POLineItem[];
  totalAmount: number;
  amountPaid?: number; // total paid to vendor against this PO (payables tracking)
  notes?: string;
  pendingOrderId?: string;
  pendingOrderNumber?: string;
  attachments?: PurchaseOrderAttachment[];
  receivingHistory?: PurchaseOrderReceivingEvent[];
  createdAt: string;
  updatedAt: string;
}

export function getNextPurchaseOrderSequence(purchaseOrders: PurchaseOrder[], branchId: BranchId): string {
  const branchCode = branchId === 'erode-hq' ? 'ERD' : branchId === 'coimbatore' ? 'CBE' : 'CHE';
  const prefix = `PO-${branchCode}-2026-`;
  const relevant = purchaseOrders.filter((p) => p.poNumber.startsWith(prefix));
  let nextSeq = 1;
  if (relevant.length > 0) {
    const sequences = relevant.map((p) => {
      const num = parseInt(p.poNumber.replace(prefix, ''), 10);
      return isNaN(num) ? 0 : num;
    });
    nextSeq = Math.max(...sequences) + 1;
  }
  return `${prefix}${String(nextSeq).padStart(3, '0')}`;
}

/**
 * HRM & Employee Master Entity
 */
export interface Employee {
  id: string;
  name: string;
  designation: string; // e.g. "Counter Staff", "Inventory Manager", "Robotics Technician"
  branchId: BranchId;
  monthlySalary: number; // Agreed fixed monthly salary in INR
  pin: string; // 4-digit PIN for kiosk check-in/out
  status: 'Active' | 'Inactive';
  phone?: string;
  email?: string;
  joinedDate: string; // YYYY-MM-DD
  createdAt: string;
  updatedAt: string;
}

/**
 * Geolocation Capture for Attendance
 */
export interface GeoLocationCapture {
  latitude: number;
  longitude: number;
  accuracy?: number; // Accuracy in meters
  addressHint?: string;
}

/**
 * Attendance Record with Selfie & Geolocation
 */
export interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  branchId: BranchId;
  date: string; // YYYY-MM-DD
  checkInTime: string; // HH:mm:ss
  checkInPhoto: string; // Base64 data URL
  checkInLocation: GeoLocationCapture;
  checkOutTime?: string; // HH:mm:ss
  checkOutPhoto?: string; // Base64 data URL
  checkOutLocation?: GeoLocationCapture;
  hoursWorked?: number; // In hours (e.g. 8.5)
  status: 'Present' | 'Half-Day' | 'Absent';
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Configurable Payroll Settings
 */
export interface PayrollSettings {
  standardHoursPerMonth: number; // Default: 208 hours (26 days * 8 hours)
}

/**
 * Monthly Computed Payroll Record
 */
export interface PayrollRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  designation: string;
  branchId: BranchId;
  month: string; // YYYY-MM e.g. "2026-09"
  monthlySalary: number;
  standardHoursPerMonth: number;
  hourlyRate: number; // monthlySalary / standardHoursPerMonth
  totalDaysPresent: number;
  totalHoursWorked: number;
  computedPay: number; // hourlyRate * totalHoursWorked
  incentiveEarned?: number; // salesperson incentives credited this month
  manualAdjustment: number; // Bonus (+) or Deduction (-)
  adjustmentReason?: string;
  finalPayable: number; // Math.max(0, computedPay + incentiveEarned + manualAdjustment)
  status: 'Draft' | 'Approved' | 'Paid';
  paidAt?: string;
  paymentMode?: 'Cash' | 'Bank Transfer';
  paymentReference?: string;
  updatedAt: string;
}

/**
 * Stock Adjustment & Audit Logging Entity
 */
export type StockAdjustmentReason =
  | 'Damage'
  | 'Loss / Theft'
  | 'Stock Audit Correction'
  | 'Return to Vendor'
  | 'Inter-branch Transfer'
  | 'Sales Return'
  | 'Voided Sale'
  | 'Other';

export interface StockAdjustmentLog {
  id: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  branchId: BranchId;
  previousQuantity: number;
  quantityChange: number; // e.g. +10 or -3
  newQuantity: number;
  reason: StockAdjustmentReason;
  notes?: string;
  adjustedBy: string; // e.g. "Arunachalam (CEO)" or "Dinesh (Manager)"
  timestamp: string; // ISO string
  transferRef?: string; // Cross-reference ID for inter-branch transfer pairs
  linkedChallanNumber?: string; // e.g. "DC-TRF-001"
}

/**
 * Multi-Item Inter-Branch Stock Transfer Entity
 */
export interface StockTransferLineItem {
  itemId: string;
  itemName: string;
  itemCode: string;
  itemHSN?: string;
  quantity: number;
  unit: string;
}

export interface StockTransfer {
  id: string; // e.g. "trf-1726000000"
  transferNumber: string; // e.g. "TRF-SEP-001"
  fromBranch: BranchId;
  toBranch: BranchId;
  items: StockTransferLineItem[];
  totalQuantity: number;
  notes?: string;
  transferredBy: string;
  timestamp: string; // ISO string
  challanNumber?: string;
}

/**
 * Inventory Configuration & Dead-Stock Threshold Settings
 */
export interface InventorySettings {
  deadStockThresholdDays: number; // default 90 days
}

/**
 * Customer Outstanding Balance Tracking (Credit / Partial Sales)
 */
export interface CustomerOutstandingInvoice {
  invoice: Invoice;
  billedAmount: number;
  paidAmount: number;
  balanceDue: number;
}

export interface CustomerOutstandingSummary {
  totalOutstanding: number;
  unpaidInvoices: CustomerOutstandingInvoice[];
}

/**
 * Party ledger payment — money received from a customer ("in") or paid to a
 * vendor ("out"). May be allocated across the specific invoices it settles.
 */
export interface PaymentAllocation {
  refId: string;
  refNumber?: string;
  amount: number;
}

export interface Payment {
  id: string;
  receiptNumber: string;
  type: 'in' | 'out';
  partyType: 'customer' | 'vendor';
  partyId?: string | null;
  partyName: string;
  branchId: string;
  date: string;
  amount: number;
  paymentMode: string;
  reference?: string | null;
  notes?: string | null;
  allocations?: PaymentAllocation[] | null;
  createdById?: string | null;
  createdByName?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

/** A staff login account (PIN never sent to the client). */
export interface StaffUser {
  id: string;
  name: string;
  role: Role;
  assignedBranchId?: string | null;
  status: 'active' | 'disabled';
  mustResetPin: boolean;
  isSystem: boolean;
  employeeId?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface RecordPaymentInput {
  type: 'in' | 'out';
  partyType: 'customer' | 'vendor';
  partyId?: string;
  partyName: string;
  branchId: string;
  date?: string;
  amount: number;
  paymentMode: string;
  reference?: string;
  notes?: string;
  allocations?: PaymentAllocation[];
}

/**
 * Whether a sale is FULLY returned — decided by quantity (every sold unit
 * returned), not by amount (tax/rounding can make refund < grand total even on a
 * complete return). Used for the Full vs Partial return label.
 */
export const isInvoiceFullyReturned = (
  inv: Pick<Invoice, 'items' | 'returns'>
): boolean => {
  const items = inv.items || [];
  const returns = inv.returns || [];
  if (!items.length || !returns.length) return false;
  return items.every((li) => {
    const sold = li.quantity || 0;
    if (sold <= 0) return true;
    const returned = returns
      .filter((r) => (r.itemId && r.itemId === li.itemId) || (r.isCombo && li.comboId && r.comboId === li.comboId))
      .reduce((s, r) => s + (r.returnedQuantity || 0), 0);
    return returned >= sold;
  });
};

export const isInvoiceForCustomer = (inv: Invoice, customer: Customer): boolean => {
  if (inv.customerId && inv.customerId === customer.id) return true;
  const cleanCustomerPhone = (customer.phone || '').trim().replace(/\D/g, '');
  const cleanInvPhone = (inv.customerPhone || '').trim().replace(/\D/g, '');
  if (cleanCustomerPhone && cleanInvPhone && cleanCustomerPhone === cleanInvPhone) return true;
  if (
    customer.name &&
    inv.customerName &&
    customer.name.trim().toLowerCase() === inv.customerName.trim().toLowerCase()
  ) {
    return true;
  }
  return false;
};

/**
 * Helper to get payment splits for an invoice, supporting backwards compatibility
 * for legacy single-mode invoices.
 */
export const getInvoicePaymentSplits = (
  inv: Pick<Invoice, 'paymentSplits' | 'paymentMode' | 'grandTotal' | 'isPartialPayment' | 'partialAmount' | 'balanceDue'>
): PaymentSplit[] => {
  if (inv.paymentSplits && inv.paymentSplits.length > 0) {
    return inv.paymentSplits;
  }
  // Backwards compatibility migration for legacy single-mode invoices with partial payment
  if (inv.isPartialPayment && inv.partialAmount && inv.balanceDue) {
    return [
      { mode: inv.paymentMode === 'COD-Credit' ? 'Cash' : inv.paymentMode, amount: inv.partialAmount },
      { mode: 'COD-Credit', amount: inv.balanceDue },
    ];
  }
  return [{ mode: inv.paymentMode || 'Cash', amount: inv.grandTotal || 0 }];
};

export const getCustomerOutstandingSummary = (
  customer: Customer,
  invoices: Invoice[]
): CustomerOutstandingSummary => {
  const customerInvoices = invoices.filter((inv) => !inv.isVoided && isInvoiceForCustomer(inv, customer));
  const unpaidInvoices: CustomerOutstandingInvoice[] = [];
  let totalOutstanding = 0;

  customerInvoices.forEach((inv) => {
    const billed = inv.grandTotal;
    let paid = 0;
    let due = 0;

    const splits = getInvoicePaymentSplits(inv);
    const hasCodCreditSplit = splits.some((s) => s.mode === 'COD-Credit');

    if (splits.length > 1 && hasCodCreditSplit) {
      // Split payment containing COD-Credit portion
      due = splits.filter((s) => s.mode === 'COD-Credit').reduce((sum, s) => sum + s.amount, 0);
      paid = Math.max(0, billed - due);
    } else if (inv.isPartialPayment) {
      paid = inv.partialAmount || 0;
      due = inv.balanceDue !== undefined ? inv.balanceDue : Math.max(0, billed - paid);
    } else if (inv.transactionType === 'Credit' || inv.paymentMode === 'COD-Credit') {
      paid = 0;
      due = inv.balanceDue !== undefined ? inv.balanceDue : billed;
    } else if (inv.balanceDue && inv.balanceDue > 0) {
      due = inv.balanceDue;
      paid = Math.max(0, billed - due);
    }

    if (inv.totalReturnedAmount) {
      due = Math.max(0, due - inv.totalReturnedAmount);
    }

    if (due > 0) {
      totalOutstanding += due;
      unpaidInvoices.push({
        invoice: inv,
        billedAmount: billed,
        paidAmount: paid,
        balanceDue: due,
      });
    }
  });

  return {
    totalOutstanding,
    unpaidInvoices,
  };
};
