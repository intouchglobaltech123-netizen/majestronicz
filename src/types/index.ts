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
  employeeId?: string; // linked attendance/payroll employee (for self check-in)
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
  'dashboard', 'items', 'customers', 'parties', 'enquiries', 'pending-orders', 'estimates',
  'challans', 'inventory', 'invoices', 'barcodes', 'cash-register', 'purchases',
  'hrm', 'reports', 'shopify', 'flipkart', 'ai-assistant', 'access', 'settings',
];

export const ALL_CAPABILITIES: Capability[] = [
  'items:write', 'sales:write', 'stock:write', 'purchase:write', 'cash:write',
  'hrm:write', 'payroll:admin', 'enquiry:write', 'estimate:write', 'challan:write',
  'config:write', 'customer:write', 'payment:write', 'ai:use', 'admin',
];

export const VIEW_LABELS: Record<string, string> = {
  dashboard: 'Dashboard', items: 'Items Master', customers: 'Customers', parties: 'Parties', enquiries: 'Enquiries',
  'pending-orders': 'Pending Orders', estimates: 'Quotes', challans: 'Delivery Challan',
  inventory: 'Inventory', invoices: 'Sales', barcodes: 'Barcode', 'cash-register': 'Cash Register',
  purchases: 'Purchases', hrm: 'Attendance', reports: 'Reports', shopify: 'Online Store', 'ai-assistant': 'Beta AI', access: 'Access Control',
  settings: 'App Preferences',
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
export type MarginCategoryCode = 'A' | 'B' | 'C' | 'D';

/** Profit / margin bands used to classify items (second categorisation, with filter). */
export const MARGIN_CATEGORIES: { code: MarginCategoryCode; label: string; margin: number | null }[] = [
  { code: 'A', label: 'A — 35%', margin: 35 },
  { code: 'B', label: 'B — 25%', margin: 25 },
  { code: 'C', label: 'C — 15%', margin: 15 },
  { code: 'D', label: 'D — Custom', margin: null },
];

/** Markup multiplier for a margin band (A=+35%, B=+25%, C=+15%, D=custom → null). */
export function marginMultiplier(code?: MarginCategoryCode | string): number | null {
  const m = MARGIN_CATEGORIES.find((c) => c.code === code);
  return m && m.margin != null ? 1 + m.margin / 100 : null;
}

/** Sale price implied by a purchase price + margin band (null when band is D/custom/none). */
export function computeMarginSalePrice(purchasePrice: number, code?: MarginCategoryCode | string): number | null {
  const mult = marginMultiplier(code);
  if (mult == null || !(purchasePrice > 0)) return null;
  return Math.round(purchasePrice * mult * 100) / 100;
}

/** One supplier for a catalog item, with that supplier's own product code. */
export interface ItemVendor {
  vendorId: string;
  vendorName?: string; // denormalized for display; resolved from vendorId when missing
  vendorCode?: string; // the supplier's own product/SKU code for this item
}

export interface Item {
  id: string;
  itemName: string;
  itemHSN: string;
  category: string;
  subcategory?: string;
  marginCategory?: MarginCategoryCode; // Profit band: A(35%) / B(25%) / C(15%) / D(custom)
  itemCode: string;
  unit: string;

  // Master Static Pricing (Identical across all branches)
  salePrice: number;
  salePriceTaxMode: SalePriceTaxMode;
  wholesalePrice: number;
  minWholesaleQty: number;
  purchasePrice: number;
  gstTaxSlab: number; // e.g. 18 for 18%
  // Suppliers. An item can be bought from several vendors, each with their own
  // product code. `vendors` is the full list (first entry = primary). vendorId /
  // vendorCode mirror the primary and are kept for existing screens + the PO
  // default; when raising a PO to a specific vendor, the PO form looks that
  // vendor up in `vendors` to auto-fill the right code.
  vendorId?: string; // PRIMARY supplier (mirrors vendors[0])
  vendorCode?: string; // PRIMARY supplier's own product code (mirrors vendors[0])
  vendors?: ItemVendor[]; // all suppliers for this item, first = primary
  discountOnSalePrice?: number;
  discountType?: DiscountType;
  reorderThreshold?: number; // Threshold for Low Stock alerts (default 10)
  imageUrl?: string; // Optional product image URL
  description?: string; // Optional product description / specs / notes
  /** Archived (INV5-7): kept with its history, hidden from pickers and default lists. */
  isArchived?: boolean | null;
  archivedAt?: string | null;
  archivedBy?: string | null;

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
  /**
   * Per-branch GST override, set while receiving stock when the supplier bills
   * this item at a rate the catalog does not have. Undefined/null means the
   * item's own gstTaxSlab applies. Resolve it with effectiveTaxSlab() rather
   * than reading either field alone.
   */
  gstTaxSlab?: number | null;
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
  // Server-set at sale time: purchase cost of ONE unit of this line (a combo is
  // the sum of its parts). Profit costs a sale at this figure; older bills
  // without it fall back to the item's current cost (E2E5-5).
  unitCost?: number | null;
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
  // Server-set: the return call this line belongs to (one call = one batch, which
  // is what "Reverse return" undoes), whether it was a damaged write-off, and
  // what that batch paid back.
  batchId?: string;
  damaged?: boolean;
  batchRefundCash?: number;
  batchRefundPaymentId?: string | null;
  batchCreditIssued?: number;
}

/** A damaged return is written off — those units were never put back in stock. */
export const isDamagedReturn = (r: Pick<SaleReturnLineItem, 'damaged' | 'reason'>): boolean =>
  r.damaged ?? /damag/i.test(r.reason || '');

/** The return batch a return line belongs to (older lines: grouped by time). */
export const returnBatchKey = (r: Pick<SaleReturnLineItem, 'batchId' | 'returnedAt'>): string =>
  r.batchId || `at:${r.returnedAt}`;

/** True when this return line is part of the bill's newest return — the only one
 *  that can be reversed (returns are undone newest first). */
export const isLatestReturnBatch = (inv: Pick<Invoice, 'returns'>, r: SaleReturnLineItem): boolean => {
  const list = inv.returns || [];
  return list.length > 0 && returnBatchKey(list[list.length - 1]) === returnBatchKey(r);
};

/**
 * Fulfillment pipeline for online-store (Shopify) orders. Ordered progression;
 * 'Cancelled' is terminal and outside the linear flow.
 */
export type OnlineOrderStatus =
  | 'New'
  | 'Picking'
  | 'Tray Photo'
  | 'Confirmed'
  | 'Billed'
  | 'Packed'
  | 'Shipped'
  | 'In Transit'
  | 'Out for Delivery' // legacy — mapped into the flow at the 'In Transit' position
  | 'Delivered'
  | 'Completed'
  | 'Cancelled';

// The ERP fulfillment workflow, in order (from the client's workflow spec).
// Stage-gated: an order only ever advances one step at a time — no free jumps.
export const ONLINE_ORDER_PIPELINE: OnlineOrderStatus[] = [
  'New',
  'Picking',
  'Tray Photo',
  'Confirmed',
  'Billed',
  'Packed',
  'Shipped',
  'In Transit',
  'Delivered',
  'Completed',
];

/** What the staff should DO next at each stage (shown as "NEXT ACTION"). */
export const ONLINE_NEXT_ACTION: Record<OnlineOrderStatus, string> = {
  New: 'Start picking — collect the ordered products into one tray',
  Picking: 'Upload the tray photo and send it to the customer on WhatsApp',
  'Tray Photo': 'Get the customer to confirm the products before packing',
  Confirmed: 'Generate the final bill',
  Billed: 'Pack the order (attach address label + invoice)',
  Packed: 'Select courier and enter the tracking / AWB number',
  Shipped: 'Send tracking to the customer and track the shipment',
  'In Transit': 'Confirm delivery once the parcel reaches the customer',
  'Out for Delivery': 'Confirm delivery once the parcel reaches the customer',
  Delivered: 'Close the order as Completed',
  Completed: 'Order complete',
  Cancelled: 'Order cancelled',
};

/** A courier / delivery partner used to dispatch online orders. */
export interface CourierPartner {
  id: string;
  name: string;
  phone?: string;
  portalUrl?: string;
  states?: string[]; // supported states (names/codes); empty = all-India
  supportsCod: boolean;
  supportsPrepaid: boolean;
  maxWeightKg?: number;
  deliveryDays?: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Recommend courier partners for an order, in the spec's order of preference
 * (fastest first). Filters by: active, supports the order's payment type
 * (COD vs prepaid), serves the order's state (empty state list = all-India),
 * and can carry the parcel weight.
 */
export const recommendCouriers = (
  order: Pick<Invoice, 'stateOfSupply' | 'customerAddress' | 'paymentMode' | 'balanceDue' | 'parcelWeightKg'>,
  couriers: CourierPartner[],
): CourierPartner[] => {
  const isCod = order.paymentMode === 'COD-Credit' || (order.balanceDue || 0) > 0;
  const stateText = `${order.stateOfSupply || ''} ${order.customerAddress || ''}`.toLowerCase();
  const weight = order.parcelWeightKg || 0;
  const stateNum = (order.stateOfSupply || '').split('-')[0].trim(); // e.g. "33"
  return couriers
    .filter((c) => c.active)
    .filter((c) => (isCod ? c.supportsCod : c.supportsPrepaid))
    .filter((c) => !c.maxWeightKg || weight <= 0 || weight <= c.maxWeightKg)
    .filter((c) => {
      const st = c.states || [];
      if (st.length === 0) return true; // all-India
      return st.some((s) => {
        const v = String(s).trim().toLowerCase();
        return v && (stateText.includes(v) || (!!stateNum && v === stateNum.toLowerCase()));
      });
    })
    .sort((a, b) => (a.deliveryDays ?? 99) - (b.deliveryDays ?? 99));
};

/** Types of problem that can be raised on an online order (Issue Cases). */
export type OrderIssueType =
  | 'Delivery Delayed'
  | 'Customer Not Received'
  | 'Damaged'
  | 'Wrong Product'
  | 'Missing Product'
  | 'Not Working'
  | 'Other';

export const ORDER_ISSUE_TYPES: OrderIssueType[] = [
  'Delivery Delayed', 'Customer Not Received', 'Damaged', 'Wrong Product', 'Missing Product', 'Not Working', 'Other',
];

/** A logged problem / complaint on an online order. */
export interface OrderIssue {
  id: string;
  type: OrderIssueType;
  description?: string;
  status: 'open' | 'resolved';
  createdBy: string;
  createdAt: string;
  resolvedBy?: string;
  resolvedAt?: string;
  resolution?: string;
}

/** Kinds of customer contact recorded against an online order. */
export type OrderCommType = 'photo_sent' | 'tracking_sent' | 'call' | 'note';

export const ORDER_COMM_LABEL: Record<OrderCommType, string> = {
  photo_sent: 'Tray photo sent on WhatsApp',
  tracking_sent: 'Tracking sent to customer',
  call: 'Phone call',
  note: 'Note',
};

/** Map a stored status (incl. legacy) to its position in the current pipeline. */
export const onlinePipelineIndex = (status?: OnlineOrderStatus): number => {
  if (!status) return 0;
  if (status === 'Out for Delivery') return ONLINE_ORDER_PIPELINE.indexOf('In Transit');
  return ONLINE_ORDER_PIPELINE.indexOf(status);
};

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
  sourceChannel?: string; // 'shopify' for imported online orders
  externalOrderId?: string; // Shopify order id (dedupe)
  onlineStatus?: OnlineOrderStatus; // fulfillment pipeline for online orders
  onlineStatusUpdatedAt?: string;
  trackingNumber?: string;
  courierName?: string;
  trackingUrl?: string; // courier tracking link sent to the customer
  trayPhotoUrl?: string; // photo of the picked products in the tray (data URL)
  parcelPhotoUrl?: string; // photo of the packed parcel / dispatch (data URL)
  onlineStatusHistory?: { status: OnlineOrderStatus; at: string; by: string; note?: string }[];
  // Customer contact history (WhatsApp / call). WhatsApp is sent manually, but the
  // ERP records whether the tray photo / tracking was actually sent, and by whom.
  communicationLog?: { type: OrderCommType; by: string; at: string; note?: string }[];
  // Packing details captured at the Packed stage.
  packedBy?: string;
  packedAt?: string;
  parcelWeightKg?: number;
  boxCount?: number;
  addressLabelDone?: boolean;
  invoiceIncluded?: boolean;
  // Issue cases / complaints raised on the order (damage, wrong item, dispute…).
  issues?: OrderIssue[];
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

// The whole-unit / measured-unit rule lives in lib/units.ts (mirrors the server).
export { allowsFractionalQty } from '../lib/units';

export const GST_RATES = [
  { rate: 0, label: 'GST @ 0% (Exempt)' },
  { rate: 5, label: 'GST @ 5%' },
  { rate: 12, label: 'GST @ 12%' },
  { rate: 18, label: 'GST @ 18% (Standard)' },
  { rate: 28, label: 'GST @ 28% (High Tax)' },
];

// NOTE: real login PINs are NEVER shipped in the frontend bundle (SEC-4). PINs
// live only on the server (backend ROLE_DEFS / the users table). This table is
// used only for default role display names in the access-management screen; the
// `pin` field is intentionally blank.
export const PRESET_ROLES: { role: Role; pin: string; defaultName: string; defaultBranch?: BranchId }[] = [
  { role: 'CEO', pin: '', defaultName: 'Sathish Kumar (CEO)' },
  { role: 'Manager', pin: '', defaultName: 'Karthik Raja (Branch Manager)', defaultBranch: 'coimbatore' },
  { role: 'Billing', pin: '', defaultName: 'Praveen (Billing Desk)', defaultBranch: 'erode-hq' },
  { role: 'Sales', pin: '', defaultName: 'Vignesh (Sales Executive)', defaultBranch: 'erode-hq' },
  { role: 'Purchase', pin: '', defaultName: 'Ganesh (Purchase Desk)', defaultBranch: 'erode-hq' },
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
  taxType: 'SGST' | 'CGST' | 'IGST';
  rate: number; // Half of item's GST rate (e.g. 9 for 18% item); the full rate for IGST
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
  // Document-level adjustments (mirror Invoice) so quotations retain and
  // round-trip overall discount + freight + round-off through save/reopen/convert.
  overallDiscountType?: DiscountType;
  overallDiscountValue?: number;
  overallDiscountAmount?: number;
  shippingCharges?: number;
  roundOff?: number;
  roundOffEnabled?: boolean;
  grandTotal: number;
  amountInWords: string;
  termsAndConditions: string;
  sourceEnquiryId?: string; // If converted from an Enquiry
  sourceEnquiryNumber?: string;
  stateOfSupply?: string; // place of supply; empty = 33-Tamil Nadu (another state → IGST)
  createdAt: string;
  // Quotation lifecycle. 'Open' by default; a bill converted from it also marks
  // it Converted (derived from invoice.sourceEstimateId); Cancelled carries a
  // reason. There is no delete — a quote is cancelled with a reason instead.
  status?: 'Open' | 'Converted' | 'Cancelled';
  cancelReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
}

export type EstimateLifecycle = 'Open' | 'Converted' | 'Cancelled';

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
  /** HH:MM, IST — set by the server when the goods are marked received. */
  time?: string;
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
  // Delivery lifecycle: 'pending' (default) until the recipient acknowledges,
  // then 'received' with the timestamp.
  status?: 'pending' | 'received';
  receivedAt?: string;
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
  // Advance / token payment taken from the customer while they wait for stock.
  advanceAmount?: number;
  advanceMode?: string; // Cash / GPay / HDFC / etc.
  advancePaidAt?: string; // ISO timestamp
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
  vendorSku?: string; // Vendor's own SKU/part code for this item (captured at PO creation)
  unit: string;
  quantityOrdered: number;
  purchasePrice: number; // Pre-fills from Item.purchasePrice; confirmed/edited while receiving
  amount: number; // taxable value: purchasePrice x quantityOrdered, tax excluded
  receivedQuantity: number; // Tracks units actually received into physical stock
  damagedQuantity?: number; // Cumulative units received damaged (billed back to vendor)
  missingQuantity?: number; // Cumulative units short-shipped / never delivered (billed back)
  // Confirmed while receiving, against the supplier's bill. Absent on lines
  // created before this existed, and on POs not yet received — treat as 0.
  taxPercent?: number;
  taxAmount?: number;
  lineTotal?: number; // amount + taxAmount
  // Running value of the GOOD units received, each receipt at its own price and
  // GST (server-maintained) — what the vendor is owed for this line.
  receivedTaxable?: number;
  receivedTax?: number;
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
  damagedQuantity?: number;
  missingQuantity?: number;
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
  otherCharges?: number; // packing / freight billed on this receipt
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
  totalAmount: number; // taxable value of the order, tax excluded
  totalTax?: number;   // GST accumulated from the rates confirmed at receipt
  otherCharges?: number; // vendor-billed extras (packing/freight) added at receipt
  amountPaid?: number; // total paid to vendor against this PO (payables tracking)
  notes?: string;
  pendingOrderId?: string;
  pendingOrderNumber?: string;
  attachments?: PurchaseOrderAttachment[];
  receivingHistory?: PurchaseOrderReceivingEvent[];
  debitNotes?: PODebitNote[]; // Quality-check rejections billed back to the vendor
  payments?: POPayment[]; // Vendor payment history (each amount paid, with mode + who)
  // Supplier tax invoice (bill) captured as data — enables Input Tax Credit / GSTR-3B.
  supplierBillNumber?: string;
  supplierBillDate?: string; // YYYY-MM-DD
  supplierBillTaxable?: number; // taxable value on the supplier bill
  supplierBillGst?: number; // total GST on the supplier bill (eligible ITC)
  // Several supplier bills (one per delivery, E2E5-11). Absent on older POs —
  // read them through supplierBillsOf(), which falls back to the fields above.
  supplierBills?: SupplierBill[] | null;
  createdAt: string;
  updatedAt: string;
}

/** One supplier tax invoice (bill) recorded on a PO. */
export interface SupplierBill {
  id: string;
  number: string;
  date: string; // YYYY-MM-DD
  taxable: number;
  gst: number; // eligible ITC
  attachmentId?: string | null;
  recordedAt?: string;
  recordedBy?: string | null;
}

/**
 * The supplier bills on a PO: its list, or — on a PO saved before several bills
 * were allowed — its single bill. Mirrors supplierBillsOf in backend/src/lib/poMoney.ts.
 */
export const supplierBillsOf = (po: Pick<PurchaseOrder, 'supplierBills' | 'supplierBillNumber' | 'supplierBillDate' | 'supplierBillTaxable' | 'supplierBillGst' | 'date'>): SupplierBill[] => {
  if (Array.isArray(po.supplierBills)) return po.supplierBills;
  if (!po.supplierBillNumber && !((Number(po.supplierBillGst) || 0) > 0)) return [];
  return [{
    id: 'bill-legacy', number: po.supplierBillNumber || '', date: po.supplierBillDate || po.date,
    taxable: Number(po.supplierBillTaxable) || 0, gst: Number(po.supplierBillGst) || 0,
  }];
};

/** A single payment made to the vendor against a PO. */
export interface POPayment {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  mode: string; // Cash / GPay / HDFC / Bank Transfer / Cheque
  by: string;
  ledgerPaymentId?: string;
}

/** A debit note raised on the vendor for damaged / rejected goods found at receiving (QC). */
export interface PODebitNoteLine {
  itemId: string;
  itemName: string;
  itemCode?: string;
  damagedQuantity: number;
  missingQuantity?: number; // units short-shipped / not delivered, also billed back
  unitPrice: number;
  taxPercent?: number;
  taxableValue?: number; // (damaged + missing) x unitPrice
  taxAmount?: number; // GST on it (input tax reversed)
  amount: number; // taxableValue + taxAmount (older notes: taxable only)
}
export interface PODebitNote {
  id: string;
  noteNumber: string;
  date: string; // YYYY-MM-DD
  createdBy: string;
  lines: PODebitNoteLine[];
  totalTaxable?: number;
  totalTax?: number;
  totalAmount: number; // incl. GST
  notes?: string;
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
  incentivePercent?: number; // CEO-set sales incentive % applied per sale credited to this staff
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
  checkInLocation: GeoLocationCapture | null; // null when no GPS was captured
  checkOutTime?: string; // HH:mm:ss
  checkOutPhoto?: string; // Base64 data URL
  checkOutLocation?: GeoLocationCapture | null;
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
  status?: 'in_transit' | 'received'; // in_transit until the destination confirms receipt
  receivedAt?: string;
  receivedBy?: string;
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
  // 'staff' = a salary paid when payroll is marked Paid (E2E5-12).
  partyType: 'customer' | 'vendor' | 'staff';
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

export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  entity: string;
  entityId?: string | null;
  summary?: string | null;
  before?: unknown;
  after?: unknown;
  branchId?: string | null;
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
  // Compare per item, summed across lines (the same item can sit on two lines),
  // keyed the way the server keys returns: combo id, catalogue item id, or the
  // line id for a typed service line (SAL4-18).
  const lineKey = (li: InvoiceLineItem) => (li.isCombo && li.comboId ? `c:${li.comboId}` : li.itemId || li.id);
  const retKey = (r: SaleReturnLineItem) => (r.isCombo && r.comboId ? `c:${r.comboId}` : r.itemId);
  const sold = new Map<string, number>();
  for (const li of items) if ((li.quantity || 0) > 0) sold.set(lineKey(li), (sold.get(lineKey(li)) || 0) + (li.quantity || 0));
  const back = new Map<string, number>();
  for (const r of returns) back.set(retKey(r), (back.get(retKey(r)) || 0) + (r.returnedQuantity || 0));
  if (!sold.size) return false;
  return [...sold.entries()].every(([k, q]) => (back.get(k) || 0) >= q - 1e-9);
};

/**
 * Single source of truth for an invoice's money position. Every screen
 * (dashboard, ledger, customer balance, reports, cash register) must use THIS
 * so numbers reconcile. Returns are netted; over-collection becomes customer credit.
 */
export interface InvoiceFinance {
  gross: number;          // original grand total (incl. tax)
  returns: number;        // amount returned so far
  net: number;            // gross − returns (what the sale is now worth)
  received: number;       // actually collected at/after billing (pre-returns)
  due: number;            // remaining owed by the customer (>= 0)
  customerCredit: number; // amount owed BACK to the customer (refund/credit, >= 0)
}

export const computeInvoiceFinance = (
  inv: Pick<Invoice, 'grandTotal' | 'totalReturnedAmount' | 'paymentSplits' | 'paymentMode' | 'isPartialPayment' | 'partialAmount' | 'balanceDue' | 'transactionType'>
): InvoiceFinance => {
  const round = (n: number) => Math.round(n * 100) / 100;
  const gross = round(inv.grandTotal || 0);
  const returns = round(Math.min(gross, inv.totalReturnedAmount || 0));
  const net = round(Math.max(0, gross - returns));

  // ONE due, ONE source of truth (CRM6-1 / SAL4-4). `due` is the server-maintained
  // `balanceDue` = original credit − receipts − returns. Receipts are recorded as
  // separate Payment rows and NEVER mutate the bill, so we read the cached due
  // rather than shrinking the bill's COD-Credit split (which used to retroactively
  // rewrite a closed billing day and resurrect debt on an edit).
  // Fallback for older/partial records without a stored balanceDue: derive the
  // outstanding from the (synthesised) COD-Credit split, exactly as before.
  let due: number;
  if (inv.balanceDue != null) {
    due = Math.max(0, round(inv.balanceDue));
  } else {
    const splits = getInvoicePaymentSplits(inv);
    const codCredit = round(splits.filter((s) => s.mode === 'COD-Credit').reduce((t, s) => t + (Number(s.amount) || 0), 0));
    due = Math.max(0, round(codCredit - returns));
  }
  // received = everything collected & kept on this sale = net − due. On a paid
  // bill that's the full net; on a credit bill it's what was taken at billing plus
  // any later receipts (which live in the Payment ledger on their own dates).
  const received = round(Math.max(0, net - due));

  return {
    gross,
    returns,
    net,
    received,
    due,
    // Over-collection is prevented server-side (billing splits are scaled to the
    // total and receipts beyond the due are refused), so there is no residual
    // customer credit to surface here.
    customerCredit: 0,
  };
};

/**
 * What a vendor is owed on a PO — the ONE formula (PUR8-1), mirrored EXACTLY from
 * backend/src/lib/poMoney.ts (change both together):
 *
 *   owed    = Σ good units × price × (1 + GST at that receipt) + other charges
 *   balance = max(0, owed − paid)
 *   advance = max(0, paid − owed)
 *
 * Only units that arrived in good condition are owed. Damaged units are billed
 * back on a debit note that carries their GST, and missing units are never
 * charged — neither is subtracted again here. Each receipt adds to the line's
 * receivedTaxable / receivedTax at ITS price and rate (E2E8-5); older lines
 * without them fall back to good units × the line's price and rate. Used by the
 * PO list/detail, Receive, To Pay, Parties, Suppliers, statements, dashboard,
 * reports and notifications.
 */
const poR2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const poTax = (taxable: number, pct: number) => Math.round((Number(taxable) || 0) * ((Number(pct) || 0) / 100) * 100) / 100;

/** Units settled on a line (good + damaged + missing). */
export const poLineSettled = (l: Pick<POLineItem, 'receivedQuantity' | 'damagedQuantity' | 'missingQuantity'>): number =>
  (Number(l.receivedQuantity) || 0) + (Number(l.damagedQuantity) || 0) + (Number(l.missingQuantity) || 0);

/** Units still expected on a line. */
export const poLineOpen = (l: POLineItem): number => Math.max(0, (Number(l.quantityOrdered) || 0) - poLineSettled(l));

/** Taxable value and GST of the GOOD units received on a line. */
export const poLineGoodValue = (l: POLineItem): { taxable: number; tax: number } => {
  const good = Number(l.receivedQuantity) || 0;
  if (good <= 0) return { taxable: 0, tax: 0 };
  if (l.receivedTaxable != null && Number.isFinite(Number(l.receivedTaxable))) {
    return { taxable: poR2(Number(l.receivedTaxable)), tax: poR2(Number(l.receivedTax) || 0) };
  }
  const taxable = poR2((Number(l.purchasePrice) || 0) * good);
  return { taxable, tax: poTax(taxable, Number(l.taxPercent) || 0) };
};

export const purchaseOrderGrandOwed = (po: Pick<PurchaseOrder, 'items' | 'otherCharges'>): number => {
  let total = 0;
  for (const l of po.items || []) {
    const v = poLineGoodValue(l);
    total += v.taxable + v.tax;
  }
  return poR2(total + (Number(po.otherCharges) || 0));
};

/** Ordered value incl. GST at the line rates (what the whole order would cost). */
export const purchaseOrderOrderedTotal = (po: Pick<PurchaseOrder, 'items' | 'totalAmount' | 'totalTax'>): number => {
  const tax = po.totalTax ?? (po.items || []).reduce((s, l) => s + (Number(l.taxAmount) || 0), 0);
  return poR2((Number(po.totalAmount) || 0) + (Number(tax) || 0));
};

/** Value (incl. GST) of units not yet settled — what may still be prepaid. */
export const purchaseOrderOpenValue = (po: Pick<PurchaseOrder, 'items'>): number => {
  let total = 0;
  for (const l of po.items || []) {
    const open = poLineOpen(l);
    if (open <= 0) continue;
    const taxable = poR2((Number(l.purchasePrice) || 0) * open);
    total += taxable + poTax(taxable, Number(l.taxPercent) || 0);
  }
  return poR2(total);
};

export const purchaseOrderBalanceDue = (
  po: Pick<PurchaseOrder, 'items' | 'amountPaid' | 'status' | 'otherCharges'>,
): number => {
  if (po.status === 'Cancelled') return 0;
  return Math.max(0, poR2(purchaseOrderGrandOwed(po) - (Number(po.amountPaid) || 0)));
};

/** Paid beyond what has been delivered — an advance the vendor holds. */
export const purchaseOrderAdvance = (
  po: Pick<PurchaseOrder, 'items' | 'amountPaid' | 'status' | 'otherCharges'>,
): number => {
  const owed = po.status === 'Cancelled' ? 0 : purchaseOrderGrandOwed(po);
  return Math.max(0, poR2((Number(po.amountPaid) || 0) - owed));
};

/** Most that the server accepts as a payment on this PO (owed + still expected − paid). */
export const purchaseOrderPayCap = (
  po: Pick<PurchaseOrder, 'items' | 'amountPaid' | 'status' | 'otherCharges'>,
): number => {
  if (po.status === 'Cancelled') return 0;
  return Math.max(0, poR2(purchaseOrderGrandOwed(po) + purchaseOrderOpenValue(po) - (Number(po.amountPaid) || 0)));
};

/** Part of a vendor payment not applied to any PO — the supplier's advance. */
export const paymentUnapplied = (p: Pick<Payment, 'amount' | 'allocations'>): number =>
  Math.max(0, poR2((Number(p.amount) || 0) - (p.allocations || []).reduce((s, a) => s + (Number(a.amount) || 0), 0)));

export interface VendorPayableSummary {
  owed: number;     // Σ owed on the vendor's POs (received goods incl. GST + charges)
  paid: number;     // Σ paid on those POs
  due: number;      // Σ per-PO balances
  advance: number;  // Σ per-PO over-payments + unapplied vendor payments
  unapplied: number; // the part of the advance that can be applied to another PO
  net: number;      // due − advance: what is really owed (negative = vendor owes us)
}

/**
 * Per-vendor payables, netting advances (PUR6-3 / PUR8-4). `inScope` limits the
 * POs and payments (e.g. to the selected branch). Keyed by vendorId (or name for
 * legacy rows without one).
 */
export const vendorPayables = (
  purchaseOrders: PurchaseOrder[],
  payments: Payment[],
  inScope: (branchId: string) => boolean = () => true,
): Map<string, VendorPayableSummary> => {
  const map = new Map<string, VendorPayableSummary>();
  const get = (k: string) => {
    let v = map.get(k);
    if (!v) { v = { owed: 0, paid: 0, due: 0, advance: 0, unapplied: 0, net: 0 }; map.set(k, v); }
    return v;
  };
  for (const po of purchaseOrders) {
    if (po.status === 'Cancelled' || !inScope(po.branchId)) continue;
    const s = get(po.vendorId || po.vendorName);
    s.owed += purchaseOrderGrandOwed(po);
    s.paid += Number(po.amountPaid) || 0;
    s.due += purchaseOrderBalanceDue(po);
    s.advance += purchaseOrderAdvance(po);
  }
  for (const p of payments) {
    if (p.type !== 'out' || p.partyType !== 'vendor' || !inScope(p.branchId)) continue;
    const u = paymentUnapplied(p);
    if (u <= 0) continue;
    const s = get(p.partyId || p.partyName);
    s.advance += u;
    s.unapplied += u;
  }
  for (const s of map.values()) {
    s.owed = poR2(s.owed); s.paid = poR2(s.paid); s.due = poR2(s.due);
    s.advance = poR2(s.advance); s.unapplied = poR2(s.unapplied); s.net = poR2(s.due - s.advance);
  }
  return map;
};

/** Total really owed to suppliers (each vendor netted, never below zero). */
export const totalVendorPayable = (m: Map<string, VendorPayableSummary>): number =>
  poR2([...m.values()].reduce((t, s) => t + Math.max(0, s.net), 0));

/**
 * Normalize an Indian phone number for equality checks: strip non-digits, a
 * leading country code (91) and a leading trunk 0, so "09842…", "+91 9842…" and
 * "9842…" all compare equal. Does NOT merge different people — just matches formats.
 */
export const normalizePhone = (raw?: string): string => {
  let d = (raw || '').replace(/\D/g, '');
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 10);
};

export const isInvoiceForCustomer = (inv: Invoice, customer: Customer): boolean => {
  if (inv.customerId && inv.customerId === customer.id) return true;
  // A bill linked to a customer account belongs to that account only — matching
  // it by phone as well could count one bill under two customers (RPT7-1).
  // Older bills with no customer id are matched by normalised phone.
  if (inv.customerId) return false;
  const cleanCustomerPhone = normalizePhone(customer.phone);
  const cleanInvPhone = normalizePhone(inv.customerPhone);
  if (cleanCustomerPhone && cleanInvPhone && cleanCustomerPhone === cleanInvPhone) return true;
  return false;
};

/**
 * A customer's live bills, purchase count and lifetime spent (net of returns) —
 * one rule for the Customers list, the detail view and the POS popup (CRM3-5 /
 * CRM-8 / CRM6-8): bills matched by customer id (or normalised phone for older
 * unlinked bills, never by name), voided bills left out.
 */
export const customerSalesSummary = (customer: Customer, invoices: Invoice[]): { bills: Invoice[]; count: number; spent: number } => {
  const bills = invoices.filter((inv) => !inv.isVoided && isInvoiceForCustomer(inv, customer));
  const spent = Math.round(bills.reduce((t, inv) => t + computeInvoiceFinance(inv).net, 0) * 100) / 100;
  return { bills, count: bills.length, spent };
};

/**
 * The payment split of a bill AS IT WAS AT BILLING — what was collected in each
 * mode on the bill's own day plus the 'COD-Credit' part left owing. Mirrors the
 * backend lib/billingSplit.ts billingSplitsOf exactly, so the screen and the
 * server count the same billing-day cash (E2E8-6).
 *
 * Legacy shape: a bill with no stored split that was part-paid keeps its
 * part-payment in `partialAmount`; that is what was
 * collected at billing — in cash on a 'COD-Credit' bill. Receipts never change
 * it (they are Payment rows on their own dates), so the bill's day never moves.
 */
export const getInvoicePaymentSplits = (
  inv: Pick<Invoice, 'paymentSplits' | 'paymentMode' | 'grandTotal' | 'isPartialPayment' | 'partialAmount' | 'balanceDue'>
): PaymentSplit[] => {
  const grand = Number(inv.grandTotal) || 0;
  const partial = Math.min(grand, Math.max(0, Number(inv.partialAmount) || 0));
  const legacyPartial = (): PaymentSplit[] => [
    { mode: !inv.paymentMode || inv.paymentMode === 'COD-Credit' ? 'Cash' : inv.paymentMode, amount: partial },
    { mode: 'COD-Credit', amount: Math.round((grand - partial) * 100) / 100 },
  ];
  if (inv.paymentSplits && inv.paymentSplits.length > 0) return inv.paymentSplits;
  if (inv.isPartialPayment && partial > 0) return legacyPartial();
  return [{ mode: inv.paymentMode || 'Cash', amount: grand }];
};

export const getCustomerOutstandingSummary = (
  customer: Customer,
  invoices: Invoice[]
): CustomerOutstandingSummary => {
  const customerInvoices = invoices.filter((inv) => !inv.isVoided && isInvoiceForCustomer(inv, customer));
  const unpaidInvoices: CustomerOutstandingInvoice[] = [];
  let totalOutstanding = 0;

  customerInvoices.forEach((inv) => {
    // Single source of truth — nets returns and handles over-collection consistently.
    const fin = computeInvoiceFinance(inv);
    if (fin.due > 0) {
      totalOutstanding += fin.due;
      unpaidInvoices.push({
        invoice: inv,
        billedAmount: fin.gross,
        paidAmount: fin.received,
        balanceDue: fin.due,
      });
    }
  });

  return {
    totalOutstanding,
    unpaidInvoices,
  };
};
