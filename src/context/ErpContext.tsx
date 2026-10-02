import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { apiGet, apiPost, apiPut, apiDelete, API_BASE, setAuthToken, getAuthToken, getTokenSession, setUnauthorizedHandler } from '../lib/api';
import { readScoped, writeScoped, removeScoped } from '../lib/userPrefs';
import { getTodayDateString, formatCurrency, nameWithRole } from '../lib/utils';
import { reorderThresholdOf, stockStatusOf, ItemSales90d, StockStatus } from '../lib/stockThreshold';
import { makeOpeningLookup } from '../lib/cashClosing';

/**
 * Persists a collection to the backend whenever it changes, so Postgres always
 * mirrors the in-memory state after any mutation. Skips while bootstrapping and
 * skips the first post-bootstrap value (the freshly-loaded data) to avoid a
 * redundant write storm on page load.
 */
function useDbSync<T>(path: string, data: T, enabled: boolean) {
  // Track the last value we've seen/synced. Only PUT when the value ACTUALLY
  // changes (a genuine edit) — never when a bootstrap/live-refresh re-hydration
  // hands back the same config with a new object reference. This stops the
  // spurious write-back storm (and its 403/500 console spam) on every refresh.
  const lastSynced = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const serialized = JSON.stringify(data ?? null);
    if (lastSynced.current === null) {
      lastSynced.current = serialized; // baseline the first observed value; no write
      return;
    }
    if (serialized === lastSynced.current) return; // unchanged — skip
    lastSynced.current = serialized;
    apiPut(path, data).catch((e) => console.error(`DB sync failed for ${path}:`, e));
  }, [data, enabled, path]);
}
import {
  Item,
  ItemVendor,
  MarginCategoryCode,
  BranchStock,
  BranchId,
  BranchScope,
  Role,
  UserSession,
  Estimate,
  DeliveryChallan,
  Invoice,
  OnlineOrderStatus,
  OrderCommType,
  OrderIssueType,
  Enquiry,
  EnquiryStatus,
  PendingOrder,
  FollowUpReminder,
  EnquiryTimelineEvent,
  BRANCHES,
  getFinancialYear,
  getBranchCodeForEstimate,
  getBranchCodeForInvoice,
  getNextEnquirySequence,
  getNextPendingOrderSequence,
  DailyCashRegister,
  Vendor,
  CourierPartner,
  PurchaseOrder,
  PurchaseOrderAttachment,
  getNextPurchaseOrderSequence,
  Employee,
  GeoLocationCapture,
  AttendanceRecord,
  PayrollSettings,
  PayrollRecord,
  StockAdjustmentLog,
  StockAdjustmentReason,
  ComboItem,
  ComboComponent,
  RecurringExpenseTemplate,
  Customer,
  LoyaltySettings,
  StockTransfer,
  Payment,
  RecordPaymentInput,
  StaffUser,
  AuditEntry,
  InventorySettings,
  CustomerOutstandingInvoice,
  getCustomerOutstandingSummary,
  normalizePhone,
  AccessMatrix,
  Capability,
  computeMarginSalePrice,
} from '../types';
import { generateFullItemCode, resolvePrefix } from '../lib/itemCodeGenerator';
import { LoginScreen } from '../components/auth/LoginScreen';
import { toast } from 'sonner';

export const STORAGE_KEY = 'majestronicz_erp_v1_demo';

export type ActiveNavView =
  | 'dashboard'
  | 'items'
  | 'inventory'
  | 'customers'
  | 'parties'
  | 'enquiries'
  | 'pending-orders'
  | 'estimates'
  | 'challans'
  | 'invoices'
  | 'barcodes'
  | 'cash-register'
  | 'purchases'
  | 'hrm'
  | 'reports'
  | 'shopify'
  | 'flipkart'
  | 'ai-assistant'
  | 'access'
  | 'settings';

export interface ActiveSubTabState {
  view: ActiveNavView;
  tab: string;
  nonce: number;
}

interface StorageState {
  items: Item[];
  branchStocks: BranchStock[];
  combos?: ComboItem[];
  stockAdjustmentLogs?: StockAdjustmentLog[];
  estimates?: Estimate[];
  challans?: DeliveryChallan[];
  invoices?: Invoice[];
  enquiries?: Enquiry[];
  pendingOrders?: PendingOrder[];
  reminders?: FollowUpReminder[];
  cashRegisters?: DailyCashRegister[];
  recurringExpenses?: RecurringExpenseTemplate[];
  vendors?: Vendor[];
  purchaseOrders?: PurchaseOrder[];
  employees?: Employee[];
  attendanceRecords?: AttendanceRecord[];
  payrollSettings?: PayrollSettings;
  payrollRecords?: PayrollRecord[];
  customers?: Customer[];
  loyaltySettings?: LoyaltySettings;
  categories?: string[];
  subcategoriesByCategory?: Record<string, string[]>;
  categoryPrefixMap?: Record<string, string>;
  subcategoryPrefixMap?: Record<string, string>;
  unitsList?: { label: string; value: string }[];
  gstSlabsList?: { label: string; rate: number }[];
  paymentTermsOptions?: { label: string; value: string; days: number }[];
  currentBranch: BranchScope;
  currentUser: UserSession;
  currentView?: ActiveNavView;
}

interface ErpContextType {
  // Navigation View State
  currentView: ActiveNavView;
  setCurrentView: (view: ActiveNavView) => void;
  activeSubTab: ActiveSubTabState | null;
  navigateToTab: (view: ActiveNavView, tab: string) => void;

  // Branch Scope State (controls which branch's STOCK is viewed/edited or 'all' for aggregated)
  currentBranch: BranchScope;
  isAllBranches: boolean;
  currentBranchData?: typeof BRANCHES[0];
  switchBranch: (branch: BranchScope) => void;
  accessibleBranches: typeof BRANCHES;

  // Auth / Role State
  currentUser: UserSession;
  isAuthenticated: boolean;
  loginWithPin: (pin: string) => Promise<boolean>;
  logout: () => void;
  isAuthModalOpen: boolean;
  setAuthModalOpen: (open: boolean) => void;

  // Login UX + mandatory first-login PIN reset
  loginError: string | null;
  clearLoginError: () => void;
  mustResetPin: boolean;
  changeOwnPin: (newPin: string) => Promise<boolean>;

  // Staff account management (CEO/admin only)
  staffUsers: StaffUser[];
  refreshStaffUsers: () => Promise<void>;
  createStaffUser: (input: { name: string; role: Role; pin: string; assignedBranchId?: string; monthlySalary?: number; phone?: string }) => Promise<boolean>;
  updateStaffUser: (id: string, input: { name?: string; role?: Role; assignedBranchId?: string | null; status?: 'active' | 'disabled' }) => Promise<boolean>;
  resetStaffPin: (id: string, newPin: string) => Promise<boolean>;
  deleteStaffUser: (id: string) => Promise<boolean>;
  linkStaffLogin: (input: { employeeId: string; role: Role; name: string; assignedBranchId?: string; pin: string; status?: string }) => Promise<boolean>;
  unlinkStaffLogin: (employeeId: string) => Promise<boolean>;
  getAuditLog: (filter?: { entity?: string; action?: string; limit?: number }) => Promise<AuditEntry[]>;

  // Permissions
  canManageItems: boolean; // CEO & Manager can edit master item catalog & master pricing
  canEditActiveBranchStock: boolean; // CEO can edit all branches, Manager can edit assigned branch stock
  isReadOnly: boolean; // Billing role
  canViewDashboard: boolean; // CEO & Manager can view Dashboard, Billing cannot

  // Estimates & Quotations
  estimates: Estimate[];
  saveEstimate: (estimate: Estimate) => Promise<Estimate | undefined>;
  deleteEstimate: (estimateId: string) => Promise<boolean>;
  cancelEstimate: (estimateId: string, reason: string) => Promise<void>;
  getNextEstimateNumber: (branchId: BranchId, date?: string) => string;

  // Delivery Challans (Low-usage goods movement note)
  challans: DeliveryChallan[];
  saveChallan: (challan: DeliveryChallan) => Promise<DeliveryChallan | undefined>;
  deleteChallan: (challanId: string) => Promise<void>;
  markChallanReceived: (challanId: string, receiverName?: string) => Promise<void>;
  getNextChallanNumber: () => string;

  // Sales Invoices (Core Billing)
  invoices: Invoice[];
  saveInvoice: (invoice: Invoice) => Promise<Invoice | undefined>;
  deleteInvoice: (invoiceId: string) => void;
  voidInvoice: (invoiceId: string, reason: string) => void;
  updateOnlineOrderStatus: (
    invoiceId: string,
    status: OnlineOrderStatus,
    opts?: {
      trackingNumber?: string; courierName?: string; trackingUrl?: string;
      trayPhotoUrl?: string; parcelPhotoUrl?: string; note?: string;
    }
  ) => Promise<void>;
  addOrderCommunication: (invoiceId: string, type: OrderCommType, note?: string) => Promise<void>;
  saveOrderPacking: (
    invoiceId: string,
    patch: { parcelWeightKg?: number; boxCount?: number; addressLabelDone?: boolean; invoiceIncluded?: boolean }
  ) => Promise<void>;
  courierPartners: CourierPartner[];
  saveCourier: (courier: Partial<CourierPartner>) => Promise<void>;
  deleteCourier: (id: string) => Promise<void>;
  addOrderIssue: (invoiceId: string, type: OrderIssueType, description?: string) => Promise<void>;
  resolveOrderIssue: (invoiceId: string, issueId: string, resolution?: string) => Promise<void>;
  processSaleReturn: (
    invoiceId: string,
    returnLines: {
      itemId: string;
      itemCode: string;
      itemName: string;
      returnQty: number;
      unitPrice: number;
      taxRate: number;
      refundAmount: number;
      isCombo?: boolean;
      comboId?: string;
      comboComponents?: ComboComponent[];
    }[],
    reason: string,
    notes?: string,
    refundMode?: string
  ) => Promise<boolean>;
  reverseReturn: (invoiceId: string, returnId: string) => Promise<boolean>;
  getNextInvoiceNumber: (branchId: BranchId, date?: string) => string;
  estimateToConvert: Estimate | null;
  setEstimateToConvert: (estimate: Estimate | null) => void;
  // Pre-filled quotation (e.g. from an enquiry) to open in the Sales form in
  // Quotation mode — distinct from estimateToConvert which opens an invoice.
  quoteToPrefill: Estimate | null;
  setQuoteToPrefill: (estimate: Estimate | null) => void;
  inventoryFilterQuery: string;
  setInventoryFilterQuery: (query: string) => void;
  navigateToInventoryItem: (itemQuery: string) => void;
  enquiryFilterQuery: string;
  setEnquiryFilterQuery: (query: string) => void;
  navigateToEnquiry: (enquiryQuery: string) => void;
  pendingOrderFilterQuery: string;
  setPendingOrderFilterQuery: (query: string) => void;
  navigateToPendingOrder: (orderQuery: string) => void;

  // Customer Enquiries & Linked Pending Orders
  enquiries: Enquiry[];
  pendingOrders: PendingOrder[];
  saveEnquiry: (enquiry: Enquiry, initialExpectedRestockDate?: string) => void;
  linkItemToEnquiry: (enquiryId: string, item: Item) => void;
  updatePendingOrder: (orderId: string, updates: Partial<PendingOrder>) => void;
  recordPendingAdvance: (orderId: string, amount: number, mode: string) => Promise<boolean>;
  clearPendingAdvance: (orderId: string) => Promise<boolean>;
  cancelEnquiry: (enquiryId: string, reason: string) => void;
  cancelPendingOrder: (orderId: string, reason: string) => void;
  convertEnquiryToSale: (enquiryId: string, targetType: 'estimate' | 'invoice', enquiry?: Enquiry) => void;
  /** Record that a SAVED bill/quotation was made from an enquiry (closes it + its pending order). */
  markEnquiryConverted: (enquiryId: string, targetType: 'estimate' | 'invoice', docId: string, docNumber: string) => Promise<void>;
  getNextEnquiryNumber: (branchId: BranchId) => string;
  canCancelEnquiry: boolean;
  canEditRestockDate: boolean;

  // Follow-up Reminders & Detail Previews
  reminders: FollowUpReminder[];
  addFollowUpReminder: (enquiryId: string, dueDate: string, dueTime: string, notes?: string) => void;
  completeFollowUpReminder: (reminderId: string) => void;
  deleteFollowUpReminder: (reminderId: string) => void;
  updateEnquiryNotes: (enquiryId: string, notes: string) => void;
  updateEnquiryStatus: (enquiryId: string, status: EnquiryStatus, reason?: string) => void;
  selectedEnquiryForDetail: Enquiry | null;
  setSelectedEnquiryForDetail: (enq: Enquiry | null) => void;
  selectedPendingOrderForDetail: PendingOrder | null;
  setSelectedPendingOrderForDetail: (po: PendingOrder | null) => void;
  selectedPurchaseOrderForDetail: PurchaseOrder | null;
  setSelectedPurchaseOrderForDetail: (po: PurchaseOrder | null) => void;
  reminderModalEnquiry: Enquiry | null;
  setReminderModalEnquiry: (enq: Enquiry | null) => void;

  // Daily Cash Register
  cashRegisters: DailyCashRegister[];
  getDailyCashRegister: (branchId: BranchId, date: string) => DailyCashRegister;
  addCashExpense: (branchId: BranchId, date: string, expense: { reason: string; cashAmount: number; gpayAmount: number; category?: string; billUrl?: string }) => void;
  deleteCashExpense: (branchId: BranchId, date: string, expenseId: string) => void;
  approveCashExpense: (branchId: BranchId, date: string, expenseId: string, decision: 'approved' | 'rejected') => void;
  overrideOpeningAmount: (branchId: BranchId, date: string, amount: number, reason: string) => void;
  closeDailyRegister: (branchId: BranchId, date: string, notes?: string) => void;
  reopenDailyRegister: (branchId: BranchId, date: string) => void;
  isDayClosed: (branchId: BranchId, date: string) => boolean;
  canCloseDay: boolean;
  canOverrideOpening: boolean;

  // Recurring Expenses
  recurringExpenses: RecurringExpenseTemplate[];
  addRecurringExpenseTemplate: (template: Omit<RecurringExpenseTemplate, 'id' | 'createdAt'>) => void;
  updateRecurringExpenseTemplate: (id: string, updates: Partial<RecurringExpenseTemplate>) => void;
  deleteRecurringExpenseTemplate: (id: string) => void;
  approveRecurringExpense: (
    templateId: string,
    branchId: BranchId,
    date: string,
    amount: number,
    paymentMode: 'Cash' | 'GPay'
  ) => void;

  // Enquiries Tab Navigation
  enquiryActiveTab: 'all' | 'new-item-requests';
  setEnquiryActiveTab: (tab: 'all' | 'new-item-requests') => void;
  navigateToNewItemRequestsQueue: () => void;

  // Categories & Subcategories
  categories: string[];
  subcategoriesByCategory: Record<string, string[]>;
  categoryPrefixMap: Record<string, string>;
  subcategoryPrefixMap: Record<string, string>;
  addCategory: (category: string) => void;
  addSubcategory: (category: string, subcategory: string) => void;
  generateItemCode: (category: string, subcategory: string) => string;

  // Universal Dropdown Lists & + Add New
  unitsList: { label: string; value: string }[];
  addUnit: (unit: string) => void;
  gstSlabsList: { label: string; rate: number }[];
  addGstSlab: (rate: number, label?: string) => void;
  paymentTermsOptions: { label: string; value: string; days: number }[];
  addPaymentTerm: (term: string, days?: number) => void;

  // Items & Master Pricing Data
  /** Active items only — what every picker and list shows (archived items hidden, INV5-7). */
  items: Item[];
  /** Every item, archived ones included (Item Master "show archived"). */
  allItems: Item[];
  archiveItem: (itemId: string, archived: boolean) => Promise<boolean>;
  addItem: (
    itemData: Omit<Item, 'id' | 'createdAt' | 'updatedAt'>,
    initialStocks?: Partial<Record<BranchId, number>>,
    initialLocations?: Partial<Record<BranchId, string>>
  ) => Item;
  updateItem: (
    itemId: string,
    // Vendor fields accept null so they can be explicitly cleared on the server
    // (e.g. removing every vendor from an item); other fields keep their types.
    updates: Partial<Omit<Item, 'id' | 'createdAt' | 'updatedAt' | 'vendorId' | 'vendorCode' | 'vendors' | 'marginCategory' | 'subcategory' | 'description' | 'imageUrl'>> & {
      vendorId?: string | null;
      vendorCode?: string | null;
      vendors?: ItemVendor[] | null;
      marginCategory?: MarginCategoryCode | null;
      subcategory?: string | null;
      description?: string | null;
      imageUrl?: string | null;
    },
    opts?: { successMessage?: string; description?: string }
  ) => Promise<boolean>;
  deleteItem: (itemId: string) => Promise<void>;

  // Combo Items (Bundled offers with live computed availability, no independent stock)
  combos: ComboItem[];
  saveCombo: (combo: ComboItem) => void;
  deleteCombo: (comboId: string) => void;
  getNextComboCode: () => string;
  getComboAvailability: (combo: ComboItem, branchId: BranchId | 'all') => number;
  getComboBuyingSeparatelyPrice: (combo: ComboItem) => number;

  // Branch Stock Data (per-branch physical stock tracking)
  branchStocks: BranchStock[];
  getBranchStock: (itemId: string, branchId?: BranchScope) => BranchStock | undefined;
  getTotalStockAcrossBranches: (itemId: string) => number;
  updateBranchStock: (
    itemId: string,
    branchId: BranchId,
    quantity: number,
    minStockAlert?: number,
    location?: string
  ) => void;
  updateBranchStockLocation: (
    itemId: string,
    branchId: BranchId,
    location?: string
  ) => void;

  // Inventory & Stock Adjustments / Transfers
  stockAdjustmentLogs: StockAdjustmentLog[];
  adjustStock: (
    itemId: string,
    branchId: BranchId,
    quantityChange: number,
    reason: StockAdjustmentReason,
    notes?: string
  ) => void;
  transferStock: (
    itemId: string,
    fromBranch: BranchId,
    toBranch: BranchId,
    quantity: number,
    notes?: string,
    autoGenerateChallan?: boolean
  ) => { transferRef: string; challanNumber?: string };
  updateItemThreshold: (itemId: string, threshold: number) => void;
  canAdjustBranchStock: (branchId: BranchId) => boolean;
  canInitiateTransferFrom: (branchId: BranchId) => boolean;

  // Purchase Orders & Vendors (Supply side)
  vendors: Vendor[];
  purchaseOrders: PurchaseOrder[];
  saveVendor: (vendor: Omit<Vendor, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => Vendor;
  deleteVendor: (vendorId: string) => void;
  savePurchaseOrder: (po: Omit<PurchaseOrder, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => Promise<PurchaseOrder | null>;
  deletePurchaseOrder: (poId: string) => Promise<boolean>;
  cancelPurchaseOrder: (poId: string) => Promise<boolean>;
  receivePurchaseOrderStock: (
    poId: string,
    receipts: { itemId: string; quantityReceived: number; location?: string; purchasePrice?: number; damagedQuantity?: number; missingQuantity?: number; taxPercent?: number }[],
    notes?: string,
    payment?: { amount?: number; mode?: string },
    otherCharges?: number,
  ) => Promise<boolean>;
  recordPurchaseOrderPayment: (poId: string, amount: number, mode: string) => Promise<boolean>;
  applyVendorAdvance: (vendorId: string, poId: string, amount?: number) => Promise<boolean>;
  /** PUR9-4: move what a finished PO was overpaid into the supplier's advance. */
  releasePoOverpayment: (poId: string) => Promise<boolean>;
  recordPurchaseBill: (poId: string, bill: { id?: string; number: string; date: string; taxable: number; gst: number; attachmentId?: string | null }) => Promise<boolean>;
  deletePurchaseBill: (poId: string, billId: string) => Promise<boolean>;
  addPurchaseOrderAttachment: (
    poId: string,
    attachment: Omit<PurchaseOrderAttachment, 'id' | 'uploadedAt' | 'uploadedBy'>
  ) => Promise<boolean>;
  deletePurchaseOrderAttachment: (poId: string, attachmentId: string) => Promise<boolean>;
  getNextPoNumber: (branchId: BranchId) => string;
  canManagePurchases: boolean;

  // HRM: Employees, Attendance & Payroll
  employees: Employee[];
  attendanceRecords: AttendanceRecord[];
  payrollSettings: PayrollSettings;
  payrollRecords: PayrollRecord[];
  saveEmployee: (emp: Omit<Employee, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => Employee;
  deleteEmployee: (employeeId: string) => void;
  clockIn: (
    employeeId: string,
    photoDataUrl: string,
    location: GeoLocationCapture | null,
    customTime?: string
  ) => { success: boolean; message: string; record?: AttendanceRecord };
  clockOut: (
    employeeId: string,
    photoDataUrl: string,
    location: GeoLocationCapture | null,
    customTime?: string
  ) => { success: boolean; message: string; record?: AttendanceRecord };
  updatePayrollSettings: (settings: PayrollSettings) => void;
  updatePayrollAdjustment: (
    employeeId: string,
    month: string,
    adjustment: number,
    reason?: string
  ) => void;
  markPayrollPaid: (
    record: PayrollRecord,
    paymentMode: 'Cash' | 'Bank Transfer',
    paymentReference?: string
  ) => Promise<void>;
  canViewHrm: boolean;
  canEditSalaries: boolean;
  canMarkPayrollPaid: boolean;
  canAdjustPayroll: boolean;

  // Reports
  canViewReports: boolean;
  canAccessView: (view: ActiveNavView) => boolean;
  canConvertEnquiry: boolean;
  canApproveCatalogRequests: boolean;
  accessMatrix: AccessMatrix | null;
  updateAccessMatrix: (matrix: AccessMatrix) => Promise<void>;
  hasFlag: (flag: string) => boolean;
  /** The role may adjust/transfer stock (stock:write) — INV5-6. */
  canWriteStock: boolean;

  // Beta AI assistant
  askAi: (question: string) => Promise<{ answer: string; degraded?: boolean; retryAfterSec?: number }>;
  getAiStatus: () => Promise<{ engine: string; model: string; connected: boolean; private?: boolean; message: string }>;

  // Party ledger / payments
  payments: Payment[];
  recordPayment: (input: RecordPaymentInput) => Promise<Payment | null>;
  deletePayment: (id: string) => Promise<void>;
  /** CRM9-11: Manager/CEO grant or correct a customer's store credit. */
  adjustCustomerCredit: (customerId: string, amount: number, reason: string) => Promise<boolean>;
  canRecordPayment: boolean;

  // Multi-item transfers, dead-stock, outstanding balance, inventory config
  stockTransfers: StockTransfer[];
  transferStockBatch: (
    items: { itemId: string; quantity: number }[],
    fromBranch: BranchId,
    toBranch: BranchId,
    notes?: string,
    autoGenerateChallan?: boolean
  ) => { transferRef: string; challanNumber?: string };
  receiveStockTransfer: (transferId: string) => void;
  inventorySettings: InventorySettings;
  updateInventorySettings: (settings: Partial<InventorySettings>) => void;
  /** Net units sold per item per branch over the last 90 days (server-computed, every role). */
  itemSales90d: ItemSales90d;
  /** The one low-stock threshold for an item in a branch scope (INV2-10). */
  getReorderThreshold: (item: Item, branchScope?: BranchScope) => number;
  /** Stock on hand, threshold and status of an item in a branch scope (INV2-10). */
  getStockStatus: (item: Item, branchScope?: BranchScope) => { qty: number; threshold: number; status: StockStatus };
  getItemLastSaleInfo: (
    itemId: string,
    branchScope?: BranchScope
  ) => { lastSaleDate: string | null; daysSinceLastSale: number | null; hasSales: boolean; isDeadStock: boolean };
  getCustomerOutstandingBalance: (customer: Customer) => number;
  getCustomerUnpaidInvoices: (customer: Customer) => CustomerOutstandingInvoice[];
  inventoryMovementFilter: 'all' | 'not-moving' | 'active';
  setInventoryMovementFilter: (f: 'all' | 'not-moving' | 'active') => void;
  navigateToInventoryWithMovementFilter: (filter: 'all' | 'not-moving' | 'active') => void;
  canViewPayrollReport: boolean;

  // Customer Master & Loyalty
  customers: Customer[];
  loyaltySettings: LoyaltySettings;
  saveCustomer: (customer: Customer) => Promise<{ success: boolean; error?: string; customer?: Customer }>;
  deleteCustomer: (customerId: string) => void;
  updateLoyaltySettings: (settings: Partial<LoyaltySettings>) => void;
  canManageLoyalty: boolean;
  canManageCustomers: boolean;
  selectedCustomerForDetail: Customer | null;
  setSelectedCustomerForDetail: (customer: Customer | null) => void;

  // Demo helper
  resetToDemoData: () => void;
}

const ErpContext = createContext<ErpContextType | null>(null);

// Roles pinned to a single branch (cannot view/act across branches). Manager
// and Purchase are branch-locked; CEO/Billing/Sales are not.
const BRANCH_LOCKED_ROLES: Role[] = ['Manager', 'Purchase'];
/** The branch a user is locked to, or null if the role may span all branches. */
function lockedBranchFor(user: { role: Role; assignedBranchId?: string }): BranchId | null {
  if (!BRANCH_LOCKED_ROLES.includes(user.role)) return null;
  return (user.assignedBranchId as BranchId) || (user.role === 'Manager' ? 'coimbatore' : 'erode-hq');
}

export const ErpProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<UserSession>(() => {
    const session = getTokenSession();
    if (session) {
      return {
        role: session.role as Role,
        name: session.name,
        pin: '',
        assignedBranchId: session.assignedBranchId as BranchId | undefined,
        userId: session.userId,
        employeeId: session.employeeId,
      };
    }
    return {
      role: 'Sales',
      name: '',
      pin: '',
    };
  });

  const [currentView, setCurrentViewRaw] = useState<ActiveNavView>(() => {
    try {
      const saved = readScoped(STORAGE_KEY); // per-user (see userPrefs)
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.currentView) {
          if (currentUser.role === 'Billing' && parsed.currentView === 'dashboard') {
            return 'items';
          }
          return parsed.currentView;
        }
      }
    } catch (e) {
      console.error('Failed to load currentView from storage:', e);
    }
    return currentUser.role === 'Billing' ? 'items' : 'dashboard';
  });

  const SUBTAB_STORAGE_KEY = 'majestronicz_active_subtab';

  const [activeSubTab, setActiveSubTab] = useState<ActiveSubTabState | null>(() => {
    try {
      const saved = readScoped(SUBTAB_STORAGE_KEY); // per-user (see userPrefs)
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.view && parsed.tab) {
          // E2E9-11: a sub-tab that only OPENS a dialog (Register History, New
          // customer/supplier…) is not re-opened by a page reload.
          if (parsed.tab === 'history' && parsed.view === 'cash-register') return { view: parsed.view, tab: 'register', nonce: Date.now() };
          if (/^new-/.test(String(parsed.tab))) return null;
          return { view: parsed.view, tab: parsed.tab, nonce: Date.now() };
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  });

  const setCurrentView = useCallback((view: ActiveNavView) => {
    const target = view === 'customers' ? 'parties' : view;
    setCurrentViewRaw(target);
    removeScoped(SUBTAB_STORAGE_KEY);
    setActiveSubTab(null);
    try {
      if (window.history.state?.view !== target) {
        window.history.pushState({ view: target }, '');
      }
    } catch {
      /* history API unavailable — navigation still works, just no Back sync */
    }
  }, []);

  const navigateToTab = useCallback((view: ActiveNavView, tab: string) => {
    const target = view === 'customers' ? 'parties' : view;
    const subState = { view: target, tab, nonce: Date.now() };
    setActiveSubTab(subState);
    writeScoped(SUBTAB_STORAGE_KEY, JSON.stringify({ view: target, tab }));
    setCurrentViewRaw(target);
    try {
      if (window.history.state?.view !== target) {
        window.history.pushState({ view: target }, '');
      }
    } catch {
      /* history API unavailable — navigation still works, just no Back sync */
    }
  }, []);

  useEffect(() => {
    // Seed a baseline history entry for the initial view so the first Back
    // press has an in-app target rather than leaving the app.
    try {
      if (!window.history.state?.view) {
        window.history.replaceState({ view: currentView }, '');
      }
    } catch {
      /* ignore */
    }
    const onPop = (e: PopStateEvent) => {
      const view = (e.state as { view?: ActiveNavView } | null)?.view;
      if (view) setCurrentViewRaw(view);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [items, setItems] = useState<Item[]>([]);
  // Archived items keep their history but leave the sale/PO pickers and lists (INV5-7).
  const activeItems = useMemo(() => items.filter((i) => !i.isArchived), [items]);
  const [combos, setCombos] = useState<ComboItem[]>([]);
  const [branchStocks, setBranchStocks] = useState<BranchStock[]>([]);
  const [stockAdjustmentLogs, setStockAdjustmentLogs] = useState<StockAdjustmentLog[]>([]);
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [challans, setChallans] = useState<DeliveryChallan[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [reminders, setReminders] = useState<FollowUpReminder[]>([]);

  const [selectedEnquiryForDetail, setSelectedEnquiryForDetail] = useState<Enquiry | null>(null);
  const [selectedPendingOrderForDetail, setSelectedPendingOrderForDetail] = useState<PendingOrder | null>(null);
  const [selectedPurchaseOrderForDetail, setSelectedPurchaseOrderForDetail] = useState<PurchaseOrder | null>(null);
  const [reminderModalEnquiry, setReminderModalEnquiry] = useState<Enquiry | null>(null);

  const [cashRegisters, setCashRegisters] = useState<DailyCashRegister[]>([]);
  const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpenseTemplate[]>([]);

  const [enquiryActiveTab, setEnquiryActiveTab] = useState<'all' | 'new-item-requests'>('all');

  const navigateToNewItemRequestsQueue = () => {
    setEnquiryActiveTab('new-item-requests');
    setCurrentView('enquiries');
  };

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [courierPartners, setCourierPartners] = useState<CourierPartner[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [payrollSettings, setPayrollSettings] = useState<PayrollSettings>({ standardHoursPerMonth: 208 });
  const [payrollRecords, setPayrollRecords] = useState<PayrollRecord[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loyaltySettings, setLoyaltySettings] = useState<LoyaltySettings>({ purchaseThreshold: 10, discountType: 'percentage', discountValue: 0, isActive: false, updatedAt: '', updatedBy: '' });

  const [selectedCustomerForDetail, setSelectedCustomerForDetail] = useState<Customer | null>(null);

  const [estimateToConvert, setEstimateToConvert] = useState<Estimate | null>(null);
  const [quoteToPrefill, setQuoteToPrefill] = useState<Estimate | null>(null);
  const [inventoryFilterQuery, setInventoryFilterQuery] = useState<string>('');
  const [enquiryFilterQuery, setEnquiryFilterQuery] = useState<string>('');
  const [pendingOrderFilterQuery, setPendingOrderFilterQuery] = useState<string>('');
  const [inventoryMovementFilter, setInventoryMovementFilter] = useState<'all' | 'not-moving' | 'active'>('all');

  // Multi-item transfer history + inventory config (hydrated from backend).
  const [stockTransfers, setStockTransfers] = useState<StockTransfer[]>([]);
  const [itemSales90d, setItemSales90d] = useState<ItemSales90d>({});
  // INV2-10: last sale day per item and branch, from the server (roles without bills).
  const [itemLastSale, setItemLastSale] = useState<Record<string, Record<string, string>>>({});
  // Party-ledger payments (receipts from customers / payments to vendors).
  const [payments, setPayments] = useState<Payment[]>([]);
  // Login UX + staff accounts.
  const [loginError, setLoginError] = useState<string | null>(null);
  const [mustResetPin, setMustResetPin] = useState(false);
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [inventorySettings, setInventorySettings] = useState<InventorySettings>({ deadStockThresholdDays: 90 });
  // Dynamic role-based access matrix (managed by CEO, hydrated from backend).
  const [accessMatrix, setAccessMatrix] = useState<AccessMatrix | null>(null);

  const navigateToInventoryItem = (itemQuery: string) => {
    setInventoryFilterQuery(itemQuery);
    setCurrentView('inventory');
  };

  const navigateToInventoryWithMovementFilter = (filter: 'all' | 'not-moving' | 'active') => {
    setInventoryMovementFilter(filter);
    setCurrentView('inventory');
  };

  const navigateToEnquiry = (enquiryQuery: string) => {
    setEnquiryFilterQuery(enquiryQuery);
    setCurrentView('enquiries');
  };

  const navigateToPendingOrder = (orderQuery: string) => {
    setPendingOrderFilterQuery(orderQuery);
    setCurrentView('pending-orders');
  };

  // Categories & Subcategories State
  const [categories, setCategories] = useState<string[]>([]);
  const [subcategoriesByCategory, setSubcategoriesByCategory] = useState<Record<string, string[]>>({});
  const [categoryPrefixMap, setCategoryPrefixMap] = useState<Record<string, string>>({});
  const [subcategoryPrefixMap, setSubcategoryPrefixMap] = useState<Record<string, string>>({});
  const [unitsList, setUnitsList] = useState<{ label: string; value: string }[]>([]);
  const [gstSlabsList, setGstSlabsList] = useState<{ label: string; rate: number }[]>([]);
  const [paymentTermsOptions, setPaymentTermsOptions] = useState<{ label: string; value: string; days: number }[]>([]);

  const [currentBranch, setCurrentBranch] = useState<BranchScope>(() => {
    const locked = lockedBranchFor(currentUser);
    if (locked) return locked; // branch-locked roles ignore any saved scope
    try {
      const saved = readScoped(STORAGE_KEY); // per-user (see userPrefs)
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.currentBranch) return parsed.currentBranch;
      }
    } catch (e) {
      console.error('Failed to load currentBranch from storage:', e);
    }
    return 'all';
  });

  const [isAuthModalOpen, setAuthModalOpen] = useState(false);

  // Bootstrap: load all persisted data from the backend (Postgres) on mount.
  // This replaces localStorage as the source of truth for shared ERP data.
  // Per-session UI state (currentUser / currentBranch / currentView) still
  // comes from localStorage and is NOT overwritten here.
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  // Mandatory login: the app is usable only after a valid (unexpired) session.
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Hydrate all collections + config singletons from a /api/bootstrap payload.
  // Used for the initial load and for silent live refreshes (SSE).
  const hydrateState = (data: any) => {
    if (Array.isArray(data.items)) setItems(data.items);
    if (Array.isArray(data.branchStocks)) setBranchStocks(data.branchStocks);
    if (Array.isArray(data.combos)) setCombos(data.combos);
    if (Array.isArray(data.stockAdjustmentLogs)) setStockAdjustmentLogs(data.stockAdjustmentLogs);
    if (Array.isArray(data.estimates)) setEstimates(data.estimates);
    if (Array.isArray(data.challans)) setChallans(data.challans);
    if (Array.isArray(data.invoices)) setInvoices(data.invoices);
    if (Array.isArray(data.enquiries)) setEnquiries(data.enquiries);
    if (Array.isArray(data.pendingOrders)) setPendingOrders(data.pendingOrders);
    if (Array.isArray(data.reminders)) setReminders(data.reminders);
    if (Array.isArray(data.cashRegisters)) setCashRegisters(data.cashRegisters);
    if (Array.isArray(data.recurringExpenses)) setRecurringExpenses(data.recurringExpenses);
    if (Array.isArray(data.vendors)) setVendors(data.vendors);
    if (Array.isArray(data.purchaseOrders)) setPurchaseOrders(data.purchaseOrders);
    if (Array.isArray(data.employees)) setEmployees(data.employees);
    if (Array.isArray(data.attendanceRecords)) setAttendanceRecords(data.attendanceRecords);
    if (Array.isArray(data.payrollRecords)) setPayrollRecords(data.payrollRecords);
    if (Array.isArray(data.customers)) setCustomers(data.customers);
    if (Array.isArray(data.stockTransfers)) setStockTransfers(data.stockTransfers);
    if (Array.isArray(data.payments)) setPayments(data.payments);
    if (data.itemSales90d && typeof data.itemSales90d === 'object') setItemSales90d(data.itemSales90d);
    if (data.itemLastSale && typeof data.itemLastSale === 'object') setItemLastSale(data.itemLastSale);
    if (data.inventorySettings && typeof data.inventorySettings.deadStockThresholdDays === 'number') setInventorySettings(data.inventorySettings);
    if (data.accessMatrix && typeof data.accessMatrix === 'object') setAccessMatrix(data.accessMatrix);
    if (Array.isArray(data.categories)) setCategories(data.categories);
    if (data.subcategoriesByCategory) setSubcategoriesByCategory(data.subcategoriesByCategory);
    if (data.categoryPrefixMap) setCategoryPrefixMap(data.categoryPrefixMap);
    if (data.subcategoryPrefixMap) setSubcategoryPrefixMap(data.subcategoryPrefixMap);
    if (Array.isArray(data.unitsList)) setUnitsList(data.unitsList);
    if (Array.isArray(data.gstSlabsList)) setGstSlabsList(data.gstSlabsList);
    if (Array.isArray(data.paymentTermsOptions)) setPaymentTermsOptions(data.paymentTermsOptions);
    if (data.loyaltySettings) setLoyaltySettings(data.loyaltySettings);
    if (data.payrollSettings) setPayrollSettings(data.payrollSettings);
  };

  // If any request is rejected with 401 (expired/invalid token), force re-login.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuthToken(null);
      setIsAuthenticated(false);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Restore a prior session from a still-valid token (survives refresh);
        // otherwise the login gate is shown. No auto-login / default session.
        const session = getTokenSession();
        if (session) {
          setCurrentUser({
            role: session.role as Role,
            name: session.name,
            pin: '',
            assignedBranchId: session.assignedBranchId as BranchId | undefined,
            userId: session.userId,
        employeeId: session.employeeId,
          });
          setIsAuthenticated(true);
          const data = await apiGet<any>('/api/bootstrap');
          if (cancelled) return;
          hydrateState(data);
          // Courier partners load on their own endpoint (available to every role).
          void apiGet<CourierPartner[]>('/api/couriers').then((c) => { if (!cancelled) setCourierPartners(Array.isArray(c) ? c : []); }).catch(() => {});
          setBootstrapError(null);
        } else {
          setAuthToken(null);
          setIsAuthenticated(false);
        }
      } catch (e: any) {
        console.error('Bootstrap load failed:', e);
        if (!cancelled) setBootstrapError(e?.message ?? 'Failed to reach backend');
      } finally {
        if (!cancelled) setIsBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live cross-session sync: subscribe to the backend SSE stream. When ANY
  // role commits a change, silently refresh so it reflects here immediately.
  // Debounced so bursts collapse into one refresh (smooth, no flicker/splash).
  useEffect(() => {
    // Only subscribe while a session is active. Tying this to isAuthenticated
    // means logout tears the stream down and login re-opens it fresh — so a
    // debounced live-refresh can never fire /api/bootstrap without a token
    // during the logged-out/login-transition window (which 401'd and bounced
    // the just-submitted login back to the PIN screen — R03-02).
    if (isBootstrapping || !isAuthenticated) return;
    // The live-updates stream requires login; EventSource can't send an auth
    // header, so pass the token as a query param (the server verifies it).
    const tok = getAuthToken();
    const es = new EventSource(`${API_BASE}/api/events${tok ? `?token=${encodeURIComponent(tok)}` : ''}`);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let refreshing = false;
    let closed = false;

    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        // Guard against a refresh landing after teardown / logout.
        if (refreshing || closed || !getTokenSession()) return;
        refreshing = true;
        try {
          const data = await apiGet<any>('/api/bootstrap');
          if (!closed) hydrateState(data);
        } catch (e) {
          console.error('Live refresh failed:', e);
        } finally {
          refreshing = false;
        }
      }, 400);
    };

    es.onmessage = scheduleRefresh;
    es.onerror = () => {
      /* EventSource auto-reconnects; nothing to do */
    };
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      es.close();
    };
  }, [isBootstrapping, isAuthenticated]);

  // Data collections persist via granular per-operation endpoints (see the
  // mutation functions below) — concurrency-safe, no full-collection replace.
  // Only app-config singletons (low-frequency, admin-only) still sync by key.
  // These PUTs require the config:write capability — gate the sync on it so
  // roles without it (Sales/Billing/Purchase) never fire an unauthorized write
  // during bootstrap/live-refresh (was spamming API 403s — R03-03).
  const dbReady = !isBootstrapping;
  const canSyncConfig =
    dbReady &&
    (currentUser.role === 'CEO' || !!accessMatrix?.[currentUser.role]?.caps?.includes('config:write'));
  useDbSync('/api/config/categories', categories, canSyncConfig);
  useDbSync('/api/config/subcategoriesByCategory', subcategoriesByCategory, canSyncConfig);
  useDbSync('/api/config/categoryPrefixMap', categoryPrefixMap, canSyncConfig);
  useDbSync('/api/config/subcategoryPrefixMap', subcategoryPrefixMap, canSyncConfig);
  useDbSync('/api/config/unitsList', unitsList, canSyncConfig);
  useDbSync('/api/config/gstSlabsList', gstSlabsList, canSyncConfig);
  useDbSync('/api/config/paymentTermsOptions', paymentTermsOptions, canSyncConfig);
  useDbSync('/api/config/loyaltySettings', loyaltySettings, canSyncConfig);
  useDbSync('/api/config/payrollSettings', payrollSettings, canSyncConfig);

  // Persist ONLY non-sensitive per-session UI state to localStorage (active
  // branch, current view). User identity & credentials live in signed tokens & Postgres.
  useEffect(() => {
    if (isBootstrapping) return;
    // Scoped to the logged-in user so one person's last branch/view does not
    // become the default for whoever logs in next on a shared computer.
    writeScoped(STORAGE_KEY, JSON.stringify({ currentBranch, currentView }));
  }, [isBootstrapping, currentBranch, currentView]);

  // Built-in fallback (used before the backend matrix loads / if absent).
  const DEFAULT_ROLE_VIEWS: Record<Role, ActiveNavView[]> = {
    CEO: ['dashboard', 'items', 'customers', 'parties', 'enquiries', 'pending-orders', 'estimates', 'challans', 'inventory', 'invoices', 'barcodes', 'cash-register', 'purchases', 'hrm', 'reports', 'shopify', 'ai-assistant', 'access'],
    Manager: ['dashboard', 'items', 'customers', 'parties', 'enquiries', 'pending-orders', 'estimates', 'challans', 'inventory', 'invoices', 'barcodes', 'cash-register', 'purchases', 'hrm', 'reports', 'shopify', 'ai-assistant'],
    Billing: ['items', 'customers', 'parties', 'enquiries', 'pending-orders', 'estimates', 'challans', 'inventory', 'invoices', 'barcodes', 'cash-register'],
    Purchase: ['items', 'inventory', 'purchases', 'parties', 'enquiries', 'pending-orders'],
    Sales: ['items', 'enquiries'],
  };

  // Dynamic access checks driven by the CEO-managed matrix (falls back to
  // built-in defaults). CEO always has everything and can never be locked out.
  const roleViews = (): string[] =>
    currentUser.role === 'CEO'
      ? DEFAULT_ROLE_VIEWS.CEO
      : accessMatrix?.[currentUser.role]?.views || DEFAULT_ROLE_VIEWS[currentUser.role] || [];
  const hasCap = (cap: Capability): boolean => {
    if (currentUser.role === 'CEO') return true;
    return !!accessMatrix?.[currentUser.role]?.caps?.includes(cap);
  };
  // Field/data-visibility flag check. Before the matrix loads, default to true
  // for CEO/Manager and false for others (safe, non-leaking default).
  const hasFlag = (flag: string): boolean => {
    if (currentUser.role === 'CEO') return true;
    const roleFlags = accessMatrix?.[currentUser.role]?.flags;
    if (roleFlags) return roleFlags.includes(flag);
    return currentUser.role === 'Manager';
  };
  const canAccessView = (view: ActiveNavView) => view === 'settings' || roleViews().includes(view);

  // ---- Beta AI ----
  const askAi = async (question: string) => {
    try {
      return await apiPost<{ answer: string; degraded?: boolean; retryAfterSec?: number }>(
        '/api/ai/ask',
        { question }
      );
    } catch (e: any) {
      return { answer: e?.message || 'AI request failed. Please try again.', degraded: true };
    }
  };
  const getAiStatus = async () => {
    try {
      return await apiGet<{ engine: string; model: string; connected: boolean; private?: boolean; message: string }>('/api/ai/status');
    } catch {
      return { engine: 'ollama', model: '', connected: false, private: true, message: 'Could not reach the AI service.' };
    }
  };

  // ---- Party ledger / payments ----
  const canRecordPayment = hasCap('payment:write');
  const recordPayment = async (input: RecordPaymentInput): Promise<Payment | null> => {
    try {
      const created = await apiPost<Payment>('/api/payments', input);
      setPayments((prev) => [created, ...prev]);
      // Refresh invoices so settled balances reflect immediately.
      void apiGet<any>('/api/bootstrap').then(hydrateState).catch(() => {});
      const credited = Number((created as any).storeCreditAdded) || 0;
      toast.success(
        `${input.type === 'in' ? 'Payment received' : 'Payment recorded'} — ${created.receiptNumber}` +
          (credited > 0 ? ` · ₹${credited.toLocaleString('en-IN')} kept as store credit` : ''),
      );
      return created;
    } catch (e: any) {
      toast.error(e?.message || 'Could not record payment');
      return null;
    }
  };
  const deletePayment = async (id: string): Promise<void> => {
    try {
      await apiDelete(`/api/payments/${id}`);
      setPayments((prev) => prev.filter((p) => p.id !== id));
      void apiGet<any>('/api/bootstrap').then(hydrateState).catch(() => {});
      toast.success('Payment deleted and balances restored');
    } catch (e: any) {
      toast.error(e?.message || 'Could not delete payment');
    }
  };

  const adjustCustomerCredit = async (customerId: string, amount: number, reason: string): Promise<boolean> => {
    try {
      const res = await apiPost<{ customers: Customer[] }>(`/api/catalog/customer/${encodeURIComponent(customerId)}/credit`, { amount, reason });
      if (Array.isArray(res?.customers)) setCustomers(res.customers);
      toast.success(amount > 0 ? `Store credit of ₹${amount.toLocaleString('en-IN')} added` : `Store credit reduced by ₹${(-amount).toLocaleString('en-IN')}`);
      return true;
    } catch (e: any) {
      toast.error(e?.message || 'Could not adjust store credit');
      return false;
    }
  };

  // Redirect out of a view the current role may not access — but only to a view
  // that IS accessible and different, so a misconfigured matrix can't cause an
  // infinite setState loop (which previously could crash the app to the login gate).
  useEffect(() => {
    if (!canAccessView(currentView)) {
      const target = landingViewFor(currentUser.role);
      if (target !== currentView && canAccessView(target)) {
        setCurrentView(target);
      }
    }
    const locked = lockedBranchFor(currentUser);
    if (locked && currentBranch !== locked) {
      setCurrentBranch(locked);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, currentView, currentBranch, accessMatrix]);

  const isAllBranches = currentBranch === 'all';
  const currentBranchData = isAllBranches ? undefined : BRANCHES.find((b) => b.id === currentBranch);

  // Accessible branches based on role — branch-locked roles (Manager, Purchase)
  // see only their own branch in the top-bar selector.
  const lockedBranch = lockedBranchFor(currentUser);
  const accessibleBranches = lockedBranch
    ? BRANCHES.filter((b) => b.id === lockedBranch)
    : BRANCHES;

  // Role permissions — derived from the dynamic capability matrix.
  const canManageItems = hasCap('items:write');
  const isReadOnly = !hasCap('items:write'); // read-only Item Master unless granted
  const canViewDashboard = canAccessView('dashboard');
  const canEditActiveBranchStock =
    hasCap('stock:write') &&
    (currentUser.role === 'CEO' || currentUser.assignedBranchId === currentBranch || currentUser.role === 'Manager');
  const canCancelEnquiry = hasCap('enquiry:write');
  const canEditRestockDate = hasCap('enquiry:write');
  // Closing, reopening and overriding a day are Manager/CEO only — the server
  // refuses Billing even though it holds cash:write, so don't offer it (CASH2-4).
  const isManagerOrCeo = currentUser.role === 'CEO' || currentUser.role === 'Manager';
  const canCloseDay = hasCap('cash:write') && isManagerOrCeo;
  const canOverrideOpening = hasCap('cash:write') && isManagerOrCeo;
  const canManagePurchases = hasCap('purchase:write');
  const canViewHrm = canAccessView('hrm');
  const canEditSalaries = hasCap('payroll:admin');
  const canMarkPayrollPaid = hasCap('payroll:admin');
  const canAdjustPayroll = hasCap('payroll:admin');
  const canViewReports = canAccessView('reports');
  const canViewPayrollReport = hasCap('payroll:admin');
  const canManageLoyalty = hasCap('config:write');
  const canManageCustomers = hasCap('customer:write');
  const canApproveCatalogRequests = hasCap('items:write');
  const canConvertEnquiry = hasCap('sales:write') || hasCap('estimate:write');

  // CEO-managed access matrix update (persists to backend; SSE refreshes all sessions).
  const updateAccessMatrix = async (matrix: AccessMatrix) => {
    setAccessMatrix(matrix); // optimistic
    try {
      const saved = await apiPut<AccessMatrix>('/api/access-matrix', matrix);
      setAccessMatrix(saved);
      toast.success('Access control updated', { description: 'Role permissions applied across all sessions.' });
    } catch (e: any) {
      toast.error('Could not update access control', { description: e?.message ?? 'Backend error' });
    }
  };

  const switchBranch = (branch: BranchScope) => {
    if (currentUser.role === 'Manager') {
      const managerBranch = currentUser.assignedBranchId || 'coimbatore';
      if (branch !== managerBranch) {
        toast.error('Permission restricted', {
          description: `Managers can only view their assigned branch (${BRANCHES.find(b => b.id === managerBranch)?.name})`,
        });
        return;
      }
    }

    setCurrentBranch(branch);
    if (branch === 'all') {
      toast.info('Viewing All Branches (Consolidated)', {
        description: 'Aggregating stock values across Erode, Coimbatore, and Chennai',
      });
    } else {
      const targetBranch = BRANCHES.find((b) => b.id === branch);
      toast.info(`Switched active branch to ${targetBranch?.name || branch}`, {
        description: `Scoped to ${targetBranch?.location}`,
      });
    }
  };

  // Landing view per role after login.
  // Views a role can open (matrix-driven, with built-in fallback).
  const viewsForRole = (role: Role): string[] =>
    role === 'CEO' ? DEFAULT_ROLE_VIEWS.CEO : (accessMatrix?.[role]?.views || DEFAULT_ROLE_VIEWS[role] || []);

  // The landing view MUST be one the role can actually access, otherwise the
  // redirect effect below would loop forever. Fall back to the first allowed view.
  const landingViewFor = (role: Role): ActiveNavView => {
    const preferred: ActiveNavView =
      role === 'CEO' || role === 'Manager' ? 'dashboard' : role === 'Purchase' ? 'purchases' : 'items';
    const views = viewsForRole(role);
    if (views.includes(preferred)) return preferred;
    return ((views[0] as ActiveNavView) || 'items');
  };

  // Authenticate against the backend (server verifies the PIN and issues a
  // signed token). The token is what actually authorizes writes server-side.
  const clearLoginError = () => setLoginError(null);

  const loginWithPin = async (pin: string): Promise<boolean> => {
    setLoginError(null);
    try {
      // Branch scope is assigned by the account server-side — not chosen here.
      const res = await apiPost<{ token: string; mustResetPin?: boolean; user: { role: Role; name: string; assignedBranchId?: BranchId; userId?: string; employeeId?: string } }>(
        '/api/auth/login',
        { pin }
      );
      setAuthToken(res.token);
      const assigned = res.user.assignedBranchId;
      setCurrentUser({ role: res.user.role, name: res.user.name, pin, assignedBranchId: assigned, userId: res.user.userId, employeeId: res.user.employeeId });
      setCurrentBranch(res.user.role === 'CEO' ? 'all' : assigned || 'erode-hq');
      setCurrentView(landingViewFor(res.user.role));
      setMustResetPin(Boolean(res.mustResetPin));
      setIsAuthenticated(true);
      try {
        const bootstrapData = await apiGet<any>('/api/bootstrap');
        hydrateState(bootstrapData);
      } catch (err) {
        console.error('Failed to load ERP state on login:', err);
      }
      // One-time dashboard "tour" auto-scroll after each fresh login.
      try { sessionStorage.setItem('mjz_dashboard_tour', '1'); } catch { /* ignore */ }
      if (res.mustResetPin) {
        // Do not greet — the app gate shows the mandatory PIN-reset screen.
        return true;
      }
      toast.success(`Signed in as ${res.user.role}`, {
        description: res.user.assignedBranchId
          ? `Branch: ${BRANCHES.find((b) => b.id === res.user.assignedBranchId)?.name}`
          : res.user.role === 'CEO'
          ? 'All branches'
          : 'Access granted',
      });
      return true;
    } catch (e: any) {
      // The server sends a precise message (attempts left / lockout). Extract it.
      const raw = String(e?.message || '');
      const afterColon = raw.split(': ').slice(1).join(': ').trim();
      const friendly = afterColon && !/^[A-Z_]+$/.test(afterColon)
        ? afterColon
        : raw.includes('429') || raw.toLowerCase().includes('too many')
        ? 'Too many attempts. Please wait a minute and try again.'
        : 'Incorrect PIN. Please try again.';
      setLoginError(friendly);
      return false;
    }
  };

  // Mandatory first-login PIN reset (and voluntary change).
  const changeOwnPin = async (newPin: string): Promise<boolean> => {
    if (!/^\d{4}$/.test(newPin)) {
      toast.error('PIN must be exactly 4 digits');
      return false;
    }
    try {
      await apiPost('/api/auth/change-pin', { newPin });
      setMustResetPin(false);
      setCurrentUser((u) => ({ ...u, pin: newPin }));
      toast.success('PIN updated', { description: 'Your new PIN is now active.' });
      return true;
    } catch (e: any) {
      const raw = String(e?.message || '');
      const afterColon = raw.split(': ').slice(1).join(': ').trim();
      toast.error(afterColon && !/^[A-Z_]+$/.test(afterColon) ? afterColon : 'Could not update PIN. Try a different one.');
      return false;
    }
  };

  // ---- Staff account management (CEO/admin) ----
  const refreshStaffUsers = async () => {
    try {
      setStaffUsers(await apiGet<StaffUser[]>('/api/users'));
    } catch {
      /* non-admins get 403; ignore */
    }
  };
  const createStaffUser = async (input: { name: string; role: Role; pin: string; assignedBranchId?: string; monthlySalary?: number; phone?: string }): Promise<boolean> => {
    try {
      await apiPost('/api/users', input);
      await refreshStaffUsers();
      // The linked employee/attendance record was created too — refresh state.
      void apiGet<any>('/api/bootstrap').then(hydrateState).catch(() => {});
      toast.success('Staff account created', { description: `${input.name} is added to Attendance and must reset the PIN on first login.` });
      return true;
    } catch (e: any) {
      const raw = String(e?.message || '');
      const afterColon = raw.split(': ').slice(1).join(': ').trim();
      toast.error(afterColon && !/^[A-Z_]+$/.test(afterColon) ? afterColon : 'Could not create account');
      return false;
    }
  };
  const updateStaffUser = async (id: string, input: { name?: string; role?: Role; assignedBranchId?: string | null; status?: 'active' | 'disabled' }): Promise<boolean> => {
    try {
      await apiPut(`/api/users/${id}`, input);
      await refreshStaffUsers();
      void apiGet<any>('/api/bootstrap').then(hydrateState).catch(() => {});
      toast.success('Account updated');
      return true;
    } catch (e: any) {
      const raw = String(e?.message || '');
      const afterColon = raw.split(': ').slice(1).join(': ').trim();
      toast.error(afterColon && !/^[A-Z_]+$/.test(afterColon) ? afterColon : 'Could not update account');
      return false;
    }
  };
  const resetStaffPin = async (id: string, newPin: string): Promise<boolean> => {
    try {
      await apiPost(`/api/users/${id}/reset-pin`, { newPin });
      await refreshStaffUsers();
      toast.success('PIN reset', { description: 'The staff member must set a new PIN on next login.' });
      return true;
    } catch (e: any) {
      const raw = String(e?.message || '');
      const afterColon = raw.split(': ').slice(1).join(': ').trim();
      toast.error(afterColon && !/^[A-Z_]+$/.test(afterColon) ? afterColon : 'Could not reset PIN');
      return false;
    }
  };
  const deleteStaffUser = async (id: string): Promise<boolean> => {
    try {
      await apiDelete(`/api/users/${id}`);
      await refreshStaffUsers();
      void apiGet<any>('/api/bootstrap').then(hydrateState).catch(() => {});
      toast.success('Account removed');
      return true;
    } catch (e: any) {
      const raw = String(e?.message || '');
      const afterColon = raw.split(': ').slice(1).join(': ').trim();
      toast.error(afterColon && !/^[A-Z_]+$/.test(afterColon) ? afterColon : 'Could not remove account');
      return false;
    }
  };
  // Attach/detach a login for an employee (used by the unified enroll form).
  const linkStaffLogin = async (input: { employeeId: string; role: Role; name: string; assignedBranchId?: string; pin: string; status?: string }): Promise<boolean> => {
    try {
      await apiPost('/api/staff/login', input);
      await refreshStaffUsers();
      toast.success('App login enabled', { description: 'This staff member can sign in and must reset the PIN on first login.' });
      return true;
    } catch (e: any) {
      const raw = String(e?.message || '');
      const afterColon = raw.split(': ').slice(1).join(': ').trim();
      toast.error(afterColon && !/^[A-Z_]+$/.test(afterColon) ? afterColon : 'Could not enable app login');
      return false;
    }
  };
  const getAuditLog = async (filter?: { entity?: string; action?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (filter?.entity) qs.set('entity', filter.entity);
    if (filter?.action) qs.set('action', filter.action);
    if (filter?.limit) qs.set('limit', String(filter.limit));
    try {
      return await apiGet<AuditEntry[]>(`/api/audit${qs.toString() ? `?${qs}` : ''}`);
    } catch {
      return [];
    }
  };
  const unlinkStaffLogin = async (employeeId: string): Promise<boolean> => {
    try {
      await apiDelete(`/api/staff/login/${employeeId}`);
      await refreshStaffUsers();
      toast.success('App login removed');
      return true;
    } catch (e: any) {
      const raw = String(e?.message || '');
      const afterColon = raw.split(': ').slice(1).join(': ').trim();
      toast.error(afterColon && !/^[A-Z_]+$/.test(afterColon) ? afterColon : 'Could not remove app login');
      return false;
    }
  };

  const logout = () => {
    // Revoke the token on the server too (SEC-5) — fire-and-forget, so signing
    // out never hangs on a slow or unreachable backend.
    if (getAuthToken()) void apiPost('/api/auth/logout', {}).catch(() => {});
    setAuthToken(null);
    setIsAuthenticated(false);
    setMustResetPin(false);
    setLoginError(null);
    toast.info('Logged out');
  };

  const getBranchStock = (itemId: string, branchId?: BranchScope): BranchStock | undefined => {
    if (branchId === 'all') return undefined;
    const targetBranch = branchId || (currentBranch === 'all' ? 'erode-hq' : currentBranch);
    return branchStocks.find((s) => s.itemId === itemId && s.branchId === targetBranch);
  };

  const getTotalStockAcrossBranches = (itemId: string): number => {
    return branchStocks
      .filter((s) => s.itemId === itemId)
      .reduce((sum, s) => sum + s.quantity, 0);
  };

  // Category & Subcategory Management
  const addCategory = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (categories.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      toast.info(`Category "${trimmed}" already exists`);
      return;
    }
    setCategories((prev) => [...prev, trimmed]);
    setSubcategoriesByCategory((prev) => ({
      ...prev,
      [trimmed]: prev[trimmed] || ['General'],
    }));

    // Pre-resolve category prefix
    const res = resolvePrefix(trimmed, categoryPrefixMap);
    setCategoryPrefixMap(res.updatedRegistry);

    toast.success(`Category "${trimmed}" added`);
  };

  const addSubcategory = (category: string, sub: string) => {
    const trimmedSub = sub.trim();
    const cat = category.trim();
    if (!trimmedSub || !cat) return;

    setSubcategoriesByCategory((prev) => {
      const existing = prev[cat] || [];
      if (existing.some((s) => s.toLowerCase() === trimmedSub.toLowerCase())) {
        return prev;
      }
      return {
        ...prev,
        [cat]: [...existing, trimmedSub],
      };
    });

    // Pre-resolve subcategory prefix
    const res = resolvePrefix(trimmedSub, subcategoryPrefixMap);
    setSubcategoryPrefixMap(res.updatedRegistry);

    toast.success(`Subcategory "${trimmedSub}" added under ${cat}`);
  };

  const generateItemCode = (category: string, subcategory: string): string => {
    const existingCodes = items.map((i) => i.itemCode);
    const result = generateFullItemCode(
      category,
      subcategory,
      categoryPrefixMap,
      subcategoryPrefixMap,
      existingCodes
    );

    setCategoryPrefixMap(result.updatedCategoryMap);
    setSubcategoryPrefixMap(result.updatedSubcategoryMap);

    return result.code;
  };

  // Universal Dropdown Options Management
  const addUnit = (unitStr: string) => {
    const trimmed = unitStr.trim().toUpperCase();
    if (!trimmed) return;
    if (unitsList.some((u) => u.value.toUpperCase() === trimmed)) {
      toast.info(`Unit "${trimmed}" already exists`);
      return;
    }
    const newUnit = { value: trimmed, label: trimmed };
    setUnitsList((prev) => [...prev, newUnit]);
    toast.success(`Unit "${trimmed}" added`);
  };

  const addGstSlab = (rate: number, label?: string) => {
    if (isNaN(rate) || rate < 0) return;
    if (gstSlabsList.some((g) => g.rate === rate)) {
      toast.info(`GST Slab ${rate}% already exists`);
      return;
    }
    const newSlab = {
      rate,
      label: label || `GST @ ${rate}%`,
    };
    setGstSlabsList((prev) => [...prev, newSlab].sort((a, b) => a.rate - b.rate));
    toast.success(`GST Slab of ${rate}% added`);
  };

  const addPaymentTerm = (term: string, days = 30) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    if (paymentTermsOptions.some((p) => p.value.toLowerCase() === trimmed.toLowerCase())) {
      toast.info(`Payment term "${trimmed}" already exists`);
      return;
    }
    const newTerm = {
      label: trimmed,
      value: trimmed,
      days,
    };
    setPaymentTermsOptions((prev) => [...prev, newTerm]);
    toast.success(`Payment term "${trimmed}" added`);
  };

  const addItem = (
    itemData: Omit<Item, 'id' | 'createdAt' | 'updatedAt'>,
    initialStocks?: Partial<Record<BranchId, number>>,
    initialLocations?: Partial<Record<BranchId, string>>
  ): Item => {
    const now = new Date().toISOString();
    const newId = `item-${Date.now()}`;

    // Guarantee a unique item code — prevents "Save & New" collisions and manually
    // typed duplicate codes (INV-1 / INV-2), which would otherwise break barcodes & search.
    const usedCodes = new Set(items.map((i) => (i.itemCode || '').trim().toUpperCase()));
    let code = (itemData.itemCode || '').trim() || 'ITEM';
    if (usedCodes.has(code.toUpperCase())) {
      const base = code.replace(/-\d+$/, '');
      let n = 2;
      while (usedCodes.has(`${base}-${n}`.toUpperCase())) n++;
      code = `${base}-${n}`;
      toast.info(`Item code already existed — saved as ${code}`);
    }

    const newItem: Item = {
      ...itemData,
      itemCode: code,
      id: newId,
      createdAt: now,
      updatedAt: now,
    };

    // Initialize physical stock rows for each branch including physical rack location
    const newStockRows: BranchStock[] = BRANCHES.map((b) => ({
      itemId: newId,
      branchId: b.id,
      quantity: initialStocks?.[b.id] ?? 0,
      location: initialLocations?.[b.id]?.trim() || '',
      minStockAlert: 5,
      updatedAt: now,
    }));

    setItems((prev) => [newItem, ...prev]);
    setBranchStocks((prev) => [...prev, ...newStockRows]);

    persist(apiPost('/api/catalog/item', { item: newItem, initialStocks, initialLocations }));

    toast.success(`Item "${newItem.itemName}" added to catalog`, {
      description: `Master price: ₹${newItem.salePrice.toLocaleString('en-IN')}`,
    });

    return newItem;
  };

  const updateItem = async (
    itemId: string,
    updates: Partial<Omit<Item, 'id' | 'createdAt' | 'updatedAt' | 'vendorId' | 'vendorCode' | 'vendors' | 'marginCategory' | 'subcategory' | 'description' | 'imageUrl'>> & {
      vendorId?: string | null;
      vendorCode?: string | null;
      vendors?: ItemVendor[] | null;
      marginCategory?: MarginCategoryCode | null;
      subcategory?: string | null;
      description?: string | null;
      imageUrl?: string | null;
    },
    opts: { successMessage?: string; description?: string } = {}
  ): Promise<boolean> => {
    // Reject editing an item's code to one already used by another item (INV-2).
    if (updates.itemCode != null) {
      const newCode = updates.itemCode.trim().toUpperCase();
      if (!newCode) { toast.error('Item code cannot be blank'); return false; }
      if (items.some((i) => i.id !== itemId && (i.itemCode || '').trim().toUpperCase() === newCode)) {
        toast.error(`Item code "${updates.itemCode}" is already used by another item`);
        return false;
      }
    }
    // Server first (TOAST-1): one toast, after the server has saved it; a
    // refusal shows the server's reason and keeps the form open.
    const now = new Date().toISOString();
    try {
      applySnapshot(await apiPut(`/api/catalog/item/${itemId}`, { ...updates, updatedAt: now }));
      toast.success(opts.successMessage || 'Item details updated', opts.description ? { description: opts.description } : undefined);
      return true;
    } catch (e: any) {
      toast.error('Could not update the item', { description: serverMessage(e) });
      return false;
    }
  };

  const updateBranchStock = (
    itemId: string,
    branchId: BranchId,
    quantity: number,
    minStockAlert?: number,
    location?: string
  ) => {
    const now = new Date().toISOString();
    setBranchStocks((prev) => {
      const existingIndex = prev.findIndex((s) => s.itemId === itemId && s.branchId === branchId);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantity,
          minStockAlert: minStockAlert ?? updated[existingIndex].minStockAlert ?? 5,
          location: location !== undefined ? location.trim() : updated[existingIndex].location,
          updatedAt: now,
        };
        return updated;
      } else {
        const newRow: BranchStock = {
          itemId,
          branchId,
          quantity,
          location: location ? location.trim() : '',
          minStockAlert: minStockAlert ?? 5,
          updatedAt: now,
        };
        return [...prev, newRow];
      }
    });

    persist(apiPost('/api/stock/update', { itemId, branchId, quantity, minStockAlert, location }));

    const targetBranch = BRANCHES.find((b) => b.id === branchId);
    toast.success(`Stock updated for ${targetBranch?.name || branchId}`, {
      description: `New count: ${quantity} units`,
    });
  };

  const updateBranchStockLocation = (
    itemId: string,
    branchId: BranchId,
    location?: string
  ) => {
    const now = new Date().toISOString();
    const trimmed = location?.trim() || undefined;
    setBranchStocks((prev) => {
      const existingIndex = prev.findIndex((s) => s.itemId === itemId && s.branchId === branchId);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          location: trimmed,
          updatedAt: now,
        };
        return updated;
      } else {
        const newRow: BranchStock = {
          itemId,
          branchId,
          quantity: 0,
          location: trimmed,
          minStockAlert: 5,
          updatedAt: now,
        };
        return [...prev, newRow];
      }
    });

    persist(apiPost('/api/stock/location', { itemId, branchId, location }));

    const targetBranch = BRANCHES.find((b) => b.id === branchId);
    toast.success(`Shelf location updated to "${trimmed || 'Unassigned'}"`, {
      description: `Updated for ${targetBranch?.name || branchId}`,
    });
  };

  // Delete only once the server agrees — a used item is refused (its history is
  // kept, INV5-7) and a Manager/CEO is offered Archive instead.
  const deleteItem = async (itemId: string) => {
    try {
      const snap = await apiDelete<any>(`/api/catalog/item/${itemId}`);
      applySnapshot(snap);
      toast.success('Item removed from catalog');
    } catch (e: any) {
      const msg = String(e?.message || '');
      const canArchive = currentUser.role === 'CEO' || currentUser.role === 'Manager';
      if (msg.includes('ITEM_IN_USE') || /archive/i.test(msg)) {
        toast.error('This item has history and cannot be deleted', {
          description: canArchive ? 'Archive it instead: it keeps its stock history and leaves the pickers.' : 'Ask a Manager or the CEO to archive it.',
          ...(canArchive ? { action: { label: 'Archive', onClick: () => { void archiveItem(itemId, true); } } } : {}),
        });
      } else {
        toast.error('Could not delete the item', { description: msg || 'Backend error' });
      }
    }
  };

  const archiveItem = async (itemId: string, archived: boolean): Promise<boolean> => {
    try {
      const snap = await apiPost<any>(`/api/catalog/item/${itemId}/archive`, { archived });
      applySnapshot(snap);
      toast.success(archived ? 'Item archived' : 'Item restored', {
        description: archived ? 'Its stock history is kept; it no longer appears in sale or purchase pickers.' : 'It is back in the pickers and lists.',
      });
      return true;
    } catch (e: any) {
      toast.error(archived ? 'Could not archive the item' : 'Could not restore the item', { description: e?.message ?? 'Backend error' });
      return false;
    }
  };

  const getNextComboCode = (): string => {
    let maxNum = 0;
    combos.forEach((c) => {
      const match = c.comboCode.match(/^CB-(\d{4})$/);
      if (match) {
        const n = parseInt(match[1], 10);
        if (!isNaN(n) && n > maxNum) maxNum = n;
      }
    });
    return `CB-${String(maxNum + 1).padStart(4, '0')}`;
  };

  const getComboAvailability = (combo: ComboItem, branchId: BranchId | 'all'): number => {
    if (!combo.components || combo.components.length === 0) return 0;

    // A kit can only be assembled where ALL its components physically sit. For
    // 'all', sum each branch's own kit count — never pool components across
    // branches (that showed 36 kits when no single branch could build one) (INV-8).
    const branchesToCheck: BranchId[] = branchId === 'all' ? BRANCHES.map((b) => b.id) : [branchId];
    let totalKits = 0;
    for (const bId of branchesToCheck) {
      let minAvail = Infinity;
      for (const comp of combo.components) {
        if (!comp.quantity || comp.quantity <= 0) continue;
        const s = branchStocks.find((stock) => stock.itemId === comp.itemId && stock.branchId === bId);
        const compStock = s?.quantity ?? 0;
        const possible = Math.floor(compStock / comp.quantity);
        if (possible < minAvail) minAvail = possible;
      }
      totalKits += minAvail === Infinity ? 0 : minAvail;
    }
    return totalKits;
  };

  const getComboBuyingSeparatelyPrice = (combo: ComboItem): number => {
    if (!combo.components) return 0;
    // Use ONE consistent tax basis (tax-inclusive) for every component so the
    // "buying separately" figure isn't a mix of with-/without-tax prices (INV-20).
    return combo.components.reduce((sum, comp) => {
      const it = items.find((i) => i.id === comp.itemId);
      if (!it) return sum;
      const inclusive = it.salePriceTaxMode === 'with'
        ? it.salePrice
        : it.salePrice * (1 + (it.gstTaxSlab || 0) / 100);
      return sum + inclusive * comp.quantity;
    }, 0);
  };

  const saveCombo = (combo: ComboItem) => {
    const now = new Date().toISOString();
    setCombos((prev) => {
      const existingIdx = prev.findIndex((c) => c.id === combo.id);
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = {
          ...combo,
          updatedAt: now,
        };
        return updated;
      }
      return [
        {
          ...combo,
          createdAt: combo.createdAt || now,
          updatedAt: now,
        },
        ...prev,
      ];
    });
    persist(apiPost('/api/catalog/combo', combo));
    toast.success(`Combo bundle "${combo.comboName}" saved`);
  };

  const deleteCombo = (comboId: string) => {
    setCombos((prev) => prev.filter((c) => c.id !== comboId));
    persist(apiDelete(`/api/catalog/combo/${comboId}`));
    toast.success('Combo bundle deleted');
  };

  const updateItemThreshold = (itemId: string, threshold: number) => {
    const safeThreshold = Math.max(0, Math.floor(threshold));
    void updateItem(itemId, { reorderThreshold: safeThreshold }, {
      successMessage: 'Low stock alert threshold updated',
      description: `New threshold: ${safeThreshold} units across all branches`,
    });
  };

  const canAdjustBranchStock = (branchId: BranchId): boolean => {
    if (currentUser.role === 'CEO') return true;
    if (currentUser.role === 'Manager') {
      const managerBranch = currentUser.assignedBranchId || 'erode-hq';
      return managerBranch === branchId;
    }
    return false; // Billing has no adjustment rights
  };

  const canInitiateTransferFrom = (branchId: BranchId): boolean => {
    if (currentUser.role === 'CEO') return true;
    if (currentUser.role === 'Manager') {
      const managerBranch = currentUser.assignedBranchId || 'erode-hq';
      return managerBranch === branchId;
    }
    return false; // Billing has no transfer rights
  };

  const adjustStock = (
    itemId: string,
    branchId: BranchId,
    quantityChange: number,
    reason: StockAdjustmentReason,
    notes?: string
  ) => {
    const targetItem = items.find((i) => i.id === itemId);
    if (!targetItem) {
      toast.error('Item not found');
      return;
    }

    const now = new Date().toISOString();
    const existingStock = branchStocks.find((s) => s.itemId === itemId && s.branchId === branchId);
    const prevQty = existingStock?.quantity ?? 0;
    const newQty = Math.max(0, prevQty + quantityChange);

    setBranchStocks((prev) => {
      const existingIndex = prev.findIndex((s) => s.itemId === itemId && s.branchId === branchId);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantity: newQty,
          updatedAt: now,
        };
        return updated;
      } else {
        const newRow: BranchStock = {
          itemId,
          branchId,
          quantity: newQty,
          minStockAlert: targetItem.reorderThreshold ?? 10,
          updatedAt: now,
        };
        return [...prev, newRow];
      }
    });

    const branchObj = BRANCHES.find((b) => b.id === branchId);
    const logEntry: StockAdjustmentLog = {
      id: `adj-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      itemId,
      itemName: targetItem.itemName,
      itemCode: targetItem.itemCode,
      branchId,
      previousQuantity: prevQty,
      quantityChange,
      newQuantity: newQty,
      reason,
      notes: notes?.trim() || undefined,
      adjustedBy: nameWithRole(currentUser.name, currentUser.role),
      timestamp: now,
    };

    setStockAdjustmentLogs((prev) => [logEntry, ...prev]);

    persist(apiPost('/api/stock/adjust', { itemId, branchId, quantityChange, reason, notes, actor: actorLabel() }));

    toast.success(`Stock adjusted for ${targetItem.itemName}`, {
      description: `${branchObj?.name || branchId}: ${prevQty} → ${newQty} (${quantityChange > 0 ? '+' : ''}${quantityChange}) • ${reason}`,
    });
  };

  const transferStock = (
    itemId: string,
    fromBranch: BranchId,
    toBranch: BranchId,
    quantity: number,
    notes?: string,
    autoGenerateChallan: boolean = true
  ): { transferRef: string; challanNumber?: string } => {
    if (fromBranch === toBranch) {
      toast.error('Source and destination branches cannot be the same');
      throw new Error('Source and destination branches cannot be the same');
    }

    if (quantity <= 0) {
      toast.error('Transfer quantity must be greater than 0');
      throw new Error('Transfer quantity must be greater than 0');
    }

    const targetItem = items.find((i) => i.id === itemId);
    if (!targetItem) {
      toast.error('Item not found');
      throw new Error('Item not found');
    }

    const fromStockRow = branchStocks.find((s) => s.itemId === itemId && s.branchId === fromBranch);
    const fromPrevQty = fromStockRow?.quantity ?? 0;

    if (fromPrevQty < quantity) {
      const fromName = BRANCHES.find((b) => b.id === fromBranch)?.name || fromBranch;
      toast.error(`Insufficient stock in ${fromName}`, {
        description: `Available: ${fromPrevQty} units, Requested: ${quantity} units`,
      });
      throw new Error('Insufficient stock for transfer');
    }

    const now = new Date().toISOString();
    const transferRef = `TRF-${Date.now().toString(36).toUpperCase()}`;

    // 1. Dispatch: debit the source only. The destination is credited when the
    // receiving branch confirms intake via receiveStockTransfer (in-transit flow).
    setBranchStocks((prev) => {
      const updated = [...prev];
      const fromIdx = updated.findIndex((s) => s.itemId === itemId && s.branchId === fromBranch);
      if (fromIdx >= 0) {
        updated[fromIdx] = {
          ...updated[fromIdx],
          quantity: Math.max(0, updated[fromIdx].quantity - quantity),
          updatedAt: now,
        };
      } else {
        updated.push({
          itemId,
          branchId: fromBranch,
          quantity: 0,
          minStockAlert: targetItem.reorderThreshold ?? 10,
          updatedAt: now,
        });
      }
      return updated;
    });

    const fromBranchName = BRANCHES.find((b) => b.id === fromBranch)?.name || fromBranch;
    const toBranchName = BRANCHES.find((b) => b.id === toBranch)?.name || toBranch;

    const generatedChallanNo: string | undefined = undefined;

    // 2. The delivery challan (if asked for) is created and numbered by the server;
    //    the toast names the number it actually saved (E2E7-9 / INV-3).

    // 3. Record the in-transit transfer so it shows in history and can be received.
    const userLabel = nameWithRole(currentUser.name, currentUser.role);
    const newTransfer: StockTransfer = {
      id: `trf-${Date.now()}`, transferNumber: transferRef, fromBranch, toBranch,
      items: [{ itemId: targetItem.id, itemName: targetItem.itemName, itemCode: targetItem.itemCode, itemHSN: targetItem.itemHSN, quantity, unit: targetItem.unit }],
      totalQuantity: quantity, notes: notes?.trim() || undefined, transferredBy: userLabel, timestamp: now, challanNumber: generatedChallanNo,
      status: 'in_transit',
    };
    setStockTransfers((prev) => [newTransfer, ...prev]);

    // Only the dispatch ("out") log is written now; the "in" log lands on receipt.
    const logFrom: StockAdjustmentLog = {
      id: `adj-${Date.now()}-out`,
      itemId,
      itemName: targetItem.itemName,
      itemCode: targetItem.itemCode,
      branchId: fromBranch,
      previousQuantity: fromPrevQty,
      quantityChange: -quantity,
      newQuantity: fromPrevQty - quantity,
      reason: 'Inter-branch Transfer',
      notes: `Dispatched to ${toBranchName} (in transit)${notes ? ` • ${notes}` : ''}`,
      adjustedBy: userLabel,
      timestamp: now,
      transferRef,
      linkedChallanNumber: generatedChallanNo,
    };

    setStockAdjustmentLogs((prev) => [logFrom, ...prev]);

    persistTransfer(apiPost('/api/stock/transfer', { itemId, fromBranch, toBranch, quantity, notes, autoGenerateChallan, actor: actorLabel() }));

    toast.success(`Stock dispatched — awaiting receipt`, {
      description: `${quantity} × ${targetItem.itemName} sent ${fromBranchName} → ${toBranchName}. Destination confirms via Receive.`,
    });

    return { transferRef, challanNumber: generatedChallanNo };
  };

  // Multi-item inter-branch transfer. Optimistic local update for instant UI +
  // sync return, then persists to the backend which reconciles authoritatively.
  const transferStockBatch = (
    itemsToTransfer: { itemId: string; quantity: number }[],
    fromBranch: BranchId,
    toBranch: BranchId,
    notes?: string,
    autoGenerateChallan: boolean = true
  ): { transferRef: string; challanNumber?: string } => {
    if (fromBranch === toBranch) {
      toast.error('Source and destination branches cannot be the same');
      throw new Error('Source and destination branches cannot be the same');
    }
    if (!itemsToTransfer || itemsToTransfer.length === 0) {
      toast.error('At least one item must be included in the transfer');
      throw new Error('At least one item must be included in the transfer');
    }

    const fromBranchName = BRANCHES.find((b) => b.id === fromBranch)?.name || fromBranch;
    const toBranchName = BRANCHES.find((b) => b.id === toBranch)?.name || toBranch;

    const validatedLines: { targetItem: Item; quantity: number; fromPrevQty: number; toPrevQty: number }[] = [];
    for (let idx = 0; idx < itemsToTransfer.length; idx++) {
      const row = itemsToTransfer[idx];
      const rowNum = idx + 1;
      if (!row.itemId) { toast.error(`Row #${rowNum}: Please select an item`); throw new Error('missing item'); }
      if (row.quantity <= 0) { toast.error(`Row #${rowNum}: Quantity must be > 0`); throw new Error('bad qty'); }
      const targetItem = items.find((i) => i.id === row.itemId);
      if (!targetItem) { toast.error(`Row #${rowNum}: Item not found`); throw new Error('item not found'); }
      const fromPrevQty = branchStocks.find((s) => s.itemId === row.itemId && s.branchId === fromBranch)?.quantity ?? 0;
      if (fromPrevQty < row.quantity) {
        toast.error(`Row #${rowNum} shortage in ${fromBranchName}`, { description: `${targetItem.itemName}: have ${fromPrevQty}, need ${row.quantity}` });
        throw new Error('insufficient stock');
      }
      const toPrevQty = branchStocks.find((s) => s.itemId === row.itemId && s.branchId === toBranch)?.quantity ?? 0;
      validatedLines.push({ targetItem, quantity: row.quantity, fromPrevQty, toPrevQty });
    }

    const now = new Date().toISOString();
    const transferRef = `TRF-${Date.now().toString(36).toUpperCase()}`;
    const userLabel = nameWithRole(currentUser.name, currentUser.role);

    // Dispatch debits the source only; the destination is credited when the
    // receiving branch confirms intake (receiveStockTransfer).
    setBranchStocks((prev) => {
      const updated = [...prev];
      validatedLines.forEach(({ targetItem, quantity }) => {
        const fromIdx = updated.findIndex((s) => s.itemId === targetItem.id && s.branchId === fromBranch);
        if (fromIdx >= 0) updated[fromIdx] = { ...updated[fromIdx], quantity: Math.max(0, updated[fromIdx].quantity - quantity), updatedAt: now };
        else updated.push({ itemId: targetItem.id, branchId: fromBranch, quantity: 0, minStockAlert: targetItem.reorderThreshold ?? 10, updatedAt: now });
      });
      return updated;
    });

    // The challan is created and numbered by the server (E2E7-9 / INV-3).
    const generatedChallanNo: string | undefined = undefined;

    const totalTransferQty = validatedLines.reduce((s, l) => s + l.quantity, 0);
    const newTransfer: StockTransfer = {
      id: `trf-${Date.now()}`, transferNumber: transferRef, fromBranch, toBranch,
      items: validatedLines.map((l) => ({ itemId: l.targetItem.id, itemName: l.targetItem.itemName, itemCode: l.targetItem.itemCode, itemHSN: l.targetItem.itemHSN, quantity: l.quantity, unit: l.targetItem.unit })),
      totalQuantity: totalTransferQty, notes: notes?.trim() || undefined, transferredBy: userLabel, timestamp: now, challanNumber: generatedChallanNo,
      status: 'in_transit',
    };
    setStockTransfers((prev) => [newTransfer, ...prev]);

    // Only the dispatch ("out") log is written now; the "in" log lands on receipt.
    const newLogs: StockAdjustmentLog[] = [];
    validatedLines.forEach(({ targetItem, quantity, fromPrevQty }, i) => {
      newLogs.push({ id: `adj-${Date.now()}-${i}-out`, itemId: targetItem.id, itemName: targetItem.itemName, itemCode: targetItem.itemCode, branchId: fromBranch, previousQuantity: fromPrevQty, quantityChange: -quantity, newQuantity: fromPrevQty - quantity, reason: 'Inter-branch Transfer', notes: `Dispatched to ${toBranchName} (in transit)${notes ? ` • ${notes}` : ''}`, adjustedBy: userLabel, timestamp: now, transferRef, linkedChallanNumber: generatedChallanNo });
    });
    setStockAdjustmentLogs((prev) => [...newLogs, ...prev]);

    // Persist to backend (authoritative) and reconcile.
    persistTransfer(apiPost('/api/stock/transfer-batch', { items: itemsToTransfer, fromBranch, toBranch, notes, autoGenerateChallan, actor: userLabel }));

    toast.success('Stock dispatched — awaiting receipt', {
      description: `${validatedLines.length} item(s) • ${totalTransferQty} units sent ${fromBranchName} → ${toBranchName}. Destination confirms via Receive.`,
    });
    return { transferRef, challanNumber: generatedChallanNo };
  };

  // Confirm receipt of an in-transit transfer: credit destination stock, append
  // the "in" audit logs, and mark the transfer received. Backend is authoritative.
  const receiveStockTransfer = (transferId: string) => {
    const transfer = stockTransfers.find((t) => t.id === transferId);
    if (!transfer) { toast.error('Transfer not found'); return; }
    if (transfer.status === 'received') { toast.info('This transfer is already received'); return; }

    const now = new Date().toISOString();
    const userLabel = nameWithRole(currentUser.name, currentUser.role);
    const fromBranchName = BRANCHES.find((b) => b.id === transfer.fromBranch)?.name || transfer.fromBranch;
    const toBranchName = BRANCHES.find((b) => b.id === transfer.toBranch)?.name || transfer.toBranch;

    // Optimistic: credit destination stock + audit logs, flip status.
    setBranchStocks((prev) => {
      const updated = [...prev];
      transfer.items.forEach((line) => {
        const toIdx = updated.findIndex((s) => s.itemId === line.itemId && s.branchId === transfer.toBranch);
        if (toIdx >= 0) updated[toIdx] = { ...updated[toIdx], quantity: updated[toIdx].quantity + line.quantity, updatedAt: now };
        else updated.push({ itemId: line.itemId, branchId: transfer.toBranch, quantity: line.quantity, minStockAlert: 10, updatedAt: now });
      });
      return updated;
    });

    const inLogs: StockAdjustmentLog[] = transfer.items.map((line, i) => {
      const toPrevQty = branchStocks.find((s) => s.itemId === line.itemId && s.branchId === transfer.toBranch)?.quantity ?? 0;
      return { id: `adj-${Date.now()}-${i}-in`, itemId: line.itemId, itemName: line.itemName, itemCode: line.itemCode, branchId: transfer.toBranch, previousQuantity: toPrevQty, quantityChange: line.quantity, newQuantity: toPrevQty + line.quantity, reason: 'Inter-branch Transfer', notes: `Received from ${fromBranchName}`, adjustedBy: userLabel, timestamp: now, transferRef: transfer.transferNumber, linkedChallanNumber: transfer.challanNumber };
    });
    setStockAdjustmentLogs((prev) => [...inLogs, ...prev]);

    setStockTransfers((prev) => prev.map((t) => t.id === transferId ? { ...t, status: 'received', receivedAt: now, receivedBy: userLabel } : t));

    persist(apiPost('/api/stock/transfer-receive', { transferId, actor: userLabel }));

    toast.success('Transfer received', { description: `${transfer.totalQuantity} units added to ${toBranchName} stock.` });
  };

  // One low-stock rule for every screen and role (INV2-10).
  const getReorderThreshold = (item: Item, branchScope: BranchScope = currentBranch): number =>
    reorderThresholdOf(itemSales90d, item.id, branchScope === 'all' ? undefined : branchScope, item.reorderThreshold ?? 10);
  const getStockStatus = (item: Item, branchScope: BranchScope = currentBranch) => {
    const qty = branchScope === 'all'
      ? branchStocks.filter((s) => s.itemId === item.id).reduce((t, s) => t + (s.quantity || 0), 0)
      : branchStocks.find((s) => s.itemId === item.id && s.branchId === branchScope)?.quantity ?? 0;
    const threshold = getReorderThreshold(item, branchScope);
    return { qty, threshold, status: stockStatusOf(qty, threshold) };
  };

  // Dead-stock detection: last sale date for an item (client-side derivation).
  const getItemLastSaleInfo = (
    itemId: string,
    branchScope: BranchScope = currentBranch
  ): { lastSaleDate: string | null; daysSinceLastSale: number | null; hasSales: boolean; isDeadStock: boolean } => {
    const threshold = inventorySettings.deadStockThresholdDays || 90;
    const matchingDates: string[] = [];
    invoices.forEach((inv) => {
      if (inv.isVoided) return;
      if (branchScope !== 'all' && inv.branchId !== branchScope) return;
      const hasItem = inv.items.some((line) => line.itemId === itemId || (line.isCombo && line.comboComponents?.some((c) => c.itemId === itemId)));
      if (hasItem && inv.date) matchingDates.push(inv.date);
    });
    // INV2-10: the server's last-sale days cover bills this login doesn't load.
    const known = itemLastSale[itemId] || {};
    for (const [b, d] of Object.entries(known)) if (branchScope === 'all' || b === branchScope) matchingDates.push(d);
    if (matchingDates.length === 0) return { lastSaleDate: null, daysSinceLastSale: null, hasSales: false, isDeadStock: true };
    matchingDates.sort((a, b) => b.localeCompare(a));
    const latestDate = matchingDates[0];
    const todayMs = new Date(getTodayDateString()).getTime();
    const daysSinceLastSale = Math.max(0, Math.floor((todayMs - new Date(latestDate).getTime()) / 86400000));
    return { lastSaleDate: latestDate, daysSinceLastSale, hasSales: true, isDeadStock: daysSinceLastSale >= threshold };
  };

  const updateInventorySettings = (newSettings: Partial<InventorySettings>) => {
    setInventorySettings((prev) => {
      const merged = { ...prev, ...newSettings };
      persist(apiPut('/api/config/inventorySettings', merged));
      return merged;
    });
    toast.success('Inventory settings updated');
  };

  const getCustomerOutstandingBalance = (customer: Customer): number =>
    getCustomerOutstandingSummary(customer, invoices).totalOutstanding;
  const getCustomerUnpaidInvoices = (customer: Customer): CustomerOutstandingInvoice[] =>
    getCustomerOutstandingSummary(customer, invoices).unpaidInvoices;

  const getNextEstimateNumber = (branchId: BranchId, date?: string): string => {
    const branchCode = getBranchCodeForEstimate(branchId);
    const fy = getFinancialYear(date || new Date());
    const prefix = `MZ${branchCode}${fy}EST/`;

    const branchEstimates = estimates.filter((e) => e.estimateNumber.startsWith(prefix));
    let nextSeq = 1;
    if (branchEstimates.length > 0) {
      const sequences = branchEstimates.map((e) => {
        const seqPart = e.estimateNumber.replace(prefix, '');
        const num = parseInt(seqPart, 10);
        return isNaN(num) ? 0 : num;
      });
      nextSeq = Math.max(...sequences) + 1;
    }

    return `${prefix}${String(nextSeq).padStart(3, '0')}`;
  };

  const saveEstimate = async (newEstimate: Estimate): Promise<Estimate | undefined> => {
    // Optimistic insert (shows a provisional number instantly).
    const before = estimates.find((e) => e.id === newEstimate.id);
    setEstimates((prev) => {
      const existingIdx = prev.findIndex((e) => e.id === newEstimate.id);
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = newEstimate;
        return updated;
      }
      return [newEstimate, ...prev];
    });
    // Await the server so we can surface the AUTHORITATIVE number it assigned
    // (the estimate number is generated server-side and may differ from the
    // provisional one under concurrency) — fixes the stale success/preview number.
    let saved = newEstimate;
    try {
      const snap = await apiPost<any>('/api/catalog/estimate', newEstimate);
      if (snap && Array.isArray(snap.estimates)) {
        setEstimates(snap.estimates);
        saved = snap.estimates.find((e: Estimate) => e.id === newEstimate.id) || newEstimate;
      }
    } catch (e: any) {
      // SAL8-4: a refused save returns nothing (as for invoices), so the form
      // stays open with the draft — no printable quote for a save that failed.
      setEstimates((prev) => (before ? prev.map((x) => (x.id === before.id ? before : x)) : prev.filter((x) => x.id !== newEstimate.id)));
      toast.error('Could not save quotation', { description: e?.message ?? 'Backend error' });
      return undefined;
    }
    toast.success(`Quotation ${saved.estimateNumber} saved`, {
      description: `For ${saved.customerName} (₹${saved.grandTotal.toLocaleString('en-IN')})`,
    });
    return saved;
  };

  // SAL8-3: deleting a quote is a CEO clean-up; the server decides and the list
  // changes only after it agrees (no "deleted" toast for a refused delete).
  const deleteEstimate = async (estimateId: string): Promise<boolean> => {
    try {
      const snap = await apiDelete<any>(`/api/catalog/estimate/${estimateId}`);
      if (snap && Array.isArray(snap.estimates)) setEstimates(snap.estimates);
      toast.success('Quotation deleted');
      return true;
    } catch (e: any) {
      toast.error('Could not delete quotation', { description: e?.message ?? 'Backend error' });
      return false;
    }
  };

  // Cancel a quotation with a reason (the delete action is retired — a quote is
  // Open, then Converted to a sale or Cancelled with a reason). Server is
  // authoritative; it refuses to cancel a converted quote.
  const cancelEstimate = async (estimateId: string, reason: string) => {
    // The list changes only once the server agreed (it refuses a converted quote).
    try {
      const snap = await apiPost<any>(`/api/catalog/estimate/${estimateId}/cancel`, { reason });
      if (snap && Array.isArray(snap.estimates)) setEstimates(snap.estimates);
      toast.success('Quotation cancelled');
    } catch (e: any) {
      toast.error('Could not cancel quotation', { description: e?.message ?? 'Backend error' });
    }
  };

  const getNextChallanNumber = (): string => {
    const prefix = 'DC-';
    const relevant = challans.filter((c) => c.challanNumber.startsWith(prefix));
    let nextSeq = 1;
    if (relevant.length > 0) {
      const sequences = relevant.map((c) => {
        const num = parseInt(c.challanNumber.replace(prefix, ''), 10);
        return isNaN(num) ? 0 : num;
      });
      nextSeq = Math.max(...sequences) + 1;
    }
    return `${prefix}${String(nextSeq).padStart(3, '0')}`;
  };

  // The server assigns the challan number (never the typed or list-length one)
  // and the toast names the SAVED number (INV-12 / INV-3).
  const saveChallan = async (newChallan: DeliveryChallan): Promise<DeliveryChallan | undefined> => {
    try {
      const snap = await apiPost<any>('/api/catalog/challan', newChallan);
      applySnapshot(snap);
      const saved: DeliveryChallan = snap?.savedChallan || newChallan;
      toast.success(`Delivery Challan ${saved.challanNumber} saved`, {
        description: `For ${saved.recipientName} (${saved.totalQuantity} items)`,
      });
      return saved;
    } catch (e: any) {
      toast.error('Could not save challan', { description: e?.message ?? 'Backend error' });
      return undefined;
    }
  };

  const deleteChallan = async (challanId: string) => {
    try {
      const snap = await apiDelete<any>(`/api/catalog/challan/${challanId}`);
      applySnapshot(snap);
      toast.success('Delivery Challan removed');
    } catch (e: any) {
      toast.error('Could not delete challan', { description: e?.message ?? 'Backend error' });
    }
  };

  // Mark a delivery as received by the recipient (pending → received). A stock-
  // transfer challan is received through its transfer on the server, which also
  // credits the destination stock — so apply the whole snapshot (INV8-5).
  const markChallanReceived = async (challanId: string, receiverName?: string) => {
    try {
      const snap = await apiPost<any>(`/api/catalog/challan/${challanId}/received`, { receiverName });
      applySnapshot(snap);
      toast.success('Delivery marked as received');
    } catch (e: any) {
      toast.error('Could not mark the challan received', { description: e?.message ?? 'Backend error' });
    }
  };

  const getNextInvoiceNumber = (branchId: BranchId, date?: string): string => {
    const branchCode = getBranchCodeForInvoice(branchId);
    const fy = getFinancialYear(date || new Date());
    const prefix = `MZ${branchCode}${fy}/`;

    const branchInvoices = invoices.filter((inv) => inv.invoiceNumber.startsWith(prefix));
    let nextSeq = 7307; // Starting range seen in their Daily Cash sheet (7307-7325 style)
    if (branchInvoices.length > 0) {
      const sequences = branchInvoices.map((inv) => {
        const seqPart = inv.invoiceNumber.replace(prefix, '');
        const num = parseInt(seqPart, 10);
        return isNaN(num) ? 0 : num;
      });
      nextSeq = Math.max(...sequences, 7306) + 1;
    }

    return `${prefix}${nextSeq}`;
  };

  // Daily Cash Register Engine
  // CASH10-1: a day is closed when it, or any LATER day of the branch, is closed —
  // the latest closed day's frozen opening already carries every earlier day's
  // cash (same rule as the server's assertDayOpen).
  const isDayClosed = (branchId: BranchId, date: string): boolean =>
    cashRegisters.some((r) => r.branchId === branchId && r.isClosed && r.date >= date);

  // ONE carry-forward rule with the server (lib/cashClosing makeOpeningLookup ↔
  // backend cash.service branchOpenings): register-less days carry, a branch's
  // first register includes earlier cash, and an OPEN day's opening is always
  // live — a stale stored figure never sticks (CASH-1 / CASH-5 / CASH8-4).
  const getPreviousDayClosingBalance = (branchId: BranchId, date: string): number =>
    makeOpeningLookup(branchId, cashRegisters, invoices, payments)(date);

  const getDailyCashRegister = (branchId: BranchId, date: string): DailyCashRegister => {
    const existing = cashRegisters.find((r) => r.branchId === branchId && r.date === date);
    if (existing) {
      // Closed / overridden days keep their own stored opening.
      if (existing.isClosed || existing.isOpeningOverridden) return existing;
      return { ...existing, openingAmount: getPreviousDayClosingBalance(branchId, date) };
    }

    const opening = getPreviousDayClosingBalance(branchId, date);
    return {
      id: `dcr-${branchId}-${date}`,
      branchId,
      date,
      openingAmount: opening,
      isOpeningOverridden: false,
      expenses: [],
      isClosed: false,
    };
  };

  // Cash-register actions are SERVER-FIRST (CASH2-4 / CASH-12): the screen shows
  // "closed", "saved" or "approved" only after the server accepted it, and the
  // server's own reason when it refused (a role without the right, a closed day,
  // a pending deposit). Who did it comes from the login on the server.
  const cashCall = async (path: string, body: any, success: () => void): Promise<boolean> => {
    try {
      applySnapshot(await apiPost<any>(path, body));
      success();
      return true;
    } catch (e: any) {
      toast.error(String(e?.message || 'The server refused this change.').replace(/^API \d+[^:]*: /, ''));
      return false;
    }
  };

  const addCashExpense = (
    branchId: BranchId,
    date: string,
    expense: { reason: string; cashAmount: number; gpayAmount: number; category?: string; billUrl?: string }
  ) => {
    if (isDayClosed(branchId, date)) {
      toast.error('Cannot add expense: Cash register for this day is already closed.');
      return;
    }
    const category = expense.category?.trim() || undefined;
    void cashCall('/api/cash/expense', { branchId, date, expense: { ...expense, category } }, () =>
      toast.success('Expense recorded successfully', {
        description: `${expense.reason} • Cash: ${formatCurrency(Number(expense.cashAmount) || 0)} / GPay: ${formatCurrency(Number(expense.gpayAmount) || 0)}`,
      }));
  };

  const deleteCashExpense = (branchId: BranchId, date: string, expenseId: string) => {
    if (isDayClosed(branchId, date)) {
      toast.error('Cannot delete expense: Day register is already closed.');
      return;
    }
    void cashCall('/api/cash/expense/delete', { branchId, date, expenseId }, () => toast.success('Expense entry deleted'));
  };

  // Manager/CEO decision on a pending (e.g. bank-deposit) expense. Approving lets it
  // hit the cash drawer; rejecting keeps it off the drawer.
  const approveCashExpense = (
    branchId: BranchId,
    date: string,
    expenseId: string,
    decision: 'approved' | 'rejected'
  ) => {
    if (!(currentUser.role === 'CEO' || currentUser.role === 'Manager')) {
      toast.error('Only a Manager or CEO can approve bank deposits.');
      return;
    }
    void cashCall('/api/cash/expense/approve', { branchId, date, expenseId, decision }, () =>
      toast.success(decision === 'approved' ? 'Bank deposit approved — cash deducted' : 'Bank deposit rejected'));
  };

  const overrideOpeningAmount = (
    branchId: BranchId,
    date: string,
    amount: number,
    reason: string
  ) => {
    if (!canOverrideOpening) {
      toast.error('Only CEO or Manager can override opening cash balance.');
      return;
    }
    if (isDayClosed(branchId, date)) {
      toast.error('Cannot override: Day register is already closed.');
      return;
    }
    void cashCall('/api/cash/override', { branchId, date, amount, reason }, () =>
      toast.success('Opening cash amount updated', {
        description: `New Opening: ${formatCurrency(amount)} (Override recorded)`,
      }));
  };

  const closeDailyRegister = (branchId: BranchId, date: string, notes?: string) => {
    if (!canCloseDay) {
      toast.error('Only CEO or Manager can close the daily register.');
      return;
    }
    void cashCall('/api/cash/close', { branchId, date, notes }, () =>
      toast.success(`Day Closed for ${date}`, {
        description: `Register locked by ${currentUser.name}. Opening balance will carry forward to next day.`,
      }));
  };

  const reopenDailyRegister = (branchId: BranchId, date: string) => {
    if (!canCloseDay) {
      toast.error('Only CEO or Manager can reopen a closed register.');
      return;
    }
    void cashCall('/api/cash/reopen', { branchId, date }, () =>
      toast.info(`Register reopened for ${date}`, {
        description: 'You can now modify expenses or add invoices.',
      }));
  };

  const addRecurringExpenseTemplate = (
    template: Omit<RecurringExpenseTemplate, 'id' | 'createdAt'>
  ) => {
    if (!canManageItems) {
      toast.error('Only CEO or Manager can create recurring expense templates.');
      return;
    }
    const newTemplate: RecurringExpenseTemplate = {
      ...template,
      id: `rec-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      createdAt: new Date().toISOString(),
    };
    setRecurringExpenses((prev) => [newTemplate, ...prev]);
    persist(apiPost('/api/recurring-expenses', newTemplate));
    toast.success(`Recurring template "${template.name}" created`);
  };

  const updateRecurringExpenseTemplate = (
    id: string,
    updates: Partial<RecurringExpenseTemplate>
  ) => {
    if (!canManageItems) {
      toast.error('Only CEO or Manager can edit recurring expense templates.');
      return;
    }
    const before = recurringExpenses;
    setRecurringExpenses((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
    // Success is announced only once the server has actually accepted it, and
    // the optimistic edit is rolled back if it has not. Announcing up front is
    // what let a removed route go unnoticed: the screen said "updated" while
    // every save 404'd and the change vanished on reload.
    apiPut(`/api/cash/recurring/${id}`, updates)
      .then((snapshot) => {
        applySnapshot(snapshot);
        toast.success('Recurring expense template updated');
      })
      .catch((e) => {
        setRecurringExpenses(before);
        toast.error('Could not update recurring expense', {
          description: e?.message || 'The change was not saved — please try again.',
        });
      });
  };

  const deleteRecurringExpenseTemplate = (id: string) => {
    if (!canManageItems) {
      toast.error('Only CEO or Manager can delete recurring expense templates.');
      return;
    }
    const before = recurringExpenses;
    setRecurringExpenses((prev) => prev.filter((t) => t.id !== id));
    apiDelete(`/api/cash/recurring/${id}`)
      .then((snapshot) => {
        applySnapshot(snapshot);
        toast.success('Recurring expense template deleted');
      })
      .catch((e) => {
        setRecurringExpenses(before);
        toast.error('Could not delete recurring expense', {
          description: e?.message || 'The template was not deleted — please try again.',
        });
      });
  };

  const approveRecurringExpense = (
    templateId: string,
    branchId: BranchId,
    date: string,
    amount: number,
    paymentMode: 'Cash' | 'GPay'
  ) => {
    const template = recurringExpenses.find((t) => t.id === templateId);
    if (!template) {
      toast.error('Recurring template not found.');
      return;
    }
    // The expense posts to the TEMPLATE's branch (CASH-6), whatever drawer is on screen.
    const target = (template.branchId || branchId) as BranchId;
    if (isDayClosed(target, date)) {
      toast.error('Cannot approve expense: Cash register for this day is already closed.');
      return;
    }
    const branchName = BRANCHES.find((b) => b.id === target)?.name || target;
    void cashCall('/api/cash/approve-recurring', { templateId, branchId: target, date, amount, paymentMode }, () =>
      toast.success(`Approved "${template.name}" (${formatCurrency(amount)}) into the ${branchName} register`, {
        description: `Added to ${date} register via ${paymentMode}. Total expenses and closing balance updated.`,
      }));
  };

  const saveCustomer = async (customerData: Customer): Promise<{ success: boolean; error?: string; customer?: Customer }> => {
    // Normalize (country code / leading 0) so equivalent formats are caught as duplicates.
    const cleanPhone = normalizePhone(customerData.phone);
    if (!cleanPhone) {
      return { success: false, error: 'Phone number is required' };
    }
    if (!customerData.name.trim()) {
      return { success: false, error: 'Customer name is required' };
    }

    // Phone uniqueness check (normalized — prevents duplicate master records)
    const duplicate = customers.find(
      (c) => c.id !== customerData.id && normalizePhone(c.phone) === cleanPhone
    );
    if (duplicate) {
      return {
        success: false,
        error: `Customer with phone ${customerData.phone} already exists (${duplicate.name})`,
      };
    }

    // Server first (TOAST-1): one toast, after the server has saved it — the
    // server checks the GSTIN check digit and phone uniqueness too.
    const isEdit = customers.some((c) => c.id === customerData.id);
    const id = customerData.id || `cust-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    try {
      const snap = await apiPost<any>('/api/catalog/customer', { ...customerData, id });
      applySnapshot(snap);
      const savedCust: Customer = (Array.isArray(snap?.customers) ? (snap.customers as Customer[]).find((c) => c.id === id) : null)
        || { ...customerData, id };
      toast.success(`Customer "${savedCust.name}" ${isEdit ? 'updated' : 'added'}`);
      return { success: true, customer: savedCust };
    } catch (e: any) {
      return { success: false, error: serverMessage(e) || 'Could not save the customer' };
    }
  };

  const deleteCustomer = (customerId: string) => {
    setCustomers((prev) => prev.filter((c) => c.id !== customerId));
    persist(apiDelete(`/api/catalog/customer/${customerId}`));
    toast.success('Customer removed from records');
  };

  const updateLoyaltySettings = (newSettings: Partial<LoyaltySettings>) => {
    if (!canManageLoyalty) {
      toast.error('Permission denied: Only CEO or Manager can configure loyalty rules');
      return;
    }
    setLoyaltySettings((prev) => ({
      ...prev,
      ...newSettings,
      updatedAt: new Date().toISOString(),
    }));
    toast.success('Loyalty settings updated successfully');
  };

  // Apply the collections returned by a tier-1 transactional endpoint to local
  // state so the UI reflects the server-committed result without a reload.
  // Applies whatever collections a backend endpoint returns to local state so
  // the UI reflects the server-committed, authoritative result.
  const applySnapshot = (snap: any) => {
    if (!snap || typeof snap !== 'object') return;
    if (Array.isArray(snap.items)) setItems(snap.items);
    if (Array.isArray(snap.combos)) setCombos(snap.combos);
    if (Array.isArray(snap.branchStocks)) setBranchStocks(snap.branchStocks);
    if (Array.isArray(snap.stockAdjustmentLogs)) setStockAdjustmentLogs(snap.stockAdjustmentLogs);
    if (Array.isArray(snap.estimates)) setEstimates(snap.estimates);
    if (Array.isArray(snap.challans)) setChallans(snap.challans);
    if (Array.isArray(snap.invoices)) setInvoices(snap.invoices);
    if (Array.isArray(snap.enquiries)) setEnquiries(snap.enquiries);
    if (Array.isArray(snap.pendingOrders)) setPendingOrders(snap.pendingOrders);
    if (Array.isArray(snap.reminders)) setReminders(snap.reminders);
    if (Array.isArray(snap.cashRegisters)) setCashRegisters(snap.cashRegisters);
    if (Array.isArray(snap.recurringExpenses)) setRecurringExpenses(snap.recurringExpenses);
    if (Array.isArray(snap.vendors)) setVendors(snap.vendors);
    if (Array.isArray(snap.purchaseOrders)) setPurchaseOrders(snap.purchaseOrders);
    if (Array.isArray(snap.employees)) setEmployees(snap.employees);
    if (Array.isArray(snap.attendanceRecords)) setAttendanceRecords(snap.attendanceRecords);
    if (Array.isArray(snap.payrollRecords)) setPayrollRecords(snap.payrollRecords);
    if (Array.isArray(snap.customers)) setCustomers(snap.customers);
    if (Array.isArray(snap.stockTransfers)) setStockTransfers(snap.stockTransfers);
    if (Array.isArray(snap.payments)) setPayments(snap.payments);
  };
  const applySaleSnapshot = applySnapshot;

  // Fire a granular persistence call to the backend and reconcile local state
  // with the server-committed (authoritative) result. Optimistic local updates
  // still run first for instant UI; this replaces them with server truth.
  const persist = (p: Promise<any>) =>
    p.then(applySnapshot).catch((e) => {
      console.error('Backend persist failed:', e);
      toast.error('Could not save to server', {
        description: 'Your change is local only — check the backend connection.',
      });
    });

  // A transfer persists like any other change, then names the challan number
  // the SERVER saved — never a guess from the local list (E2E7-9).
  const persistTransfer = (p: Promise<any>) =>
    p.then((snap) => {
      applySnapshot(snap);
      if (snap?.challanNumber) {
        toast('Delivery Challan generated', {
          description: `Challan #${snap.challanNumber} was auto-created for this transit.`,
          action: { label: 'View Challans', onClick: () => setCurrentView('challans') },
        });
      }
    }).catch((e) => {
      console.error('Backend persist failed:', e);
      toast.error('Could not save the transfer', { description: e?.message ?? 'Backend error' });
    });

  const actorLabel = () => nameWithRole(currentUser.name, currentUser.role);

  const saveInvoice = async (newInvoice: Invoice) => {
    // Prevent backdating into a closed register
    if (isDayClosed(newInvoice.branchId, newInvoice.date)) {
      toast.error('Cannot save invoice on a closed day', {
        description: `Daily cash register for ${newInvoice.date} at this branch is already closed. Please select an open date.`,
      });
      return;
    }

    try {
      const snap = await apiPost<any>('/api/tx/sale', newInvoice);
      applySaleSnapshot(snap);
      // The server assigns the authoritative id, invoice number and reconciled
      // payment split — use that saved row for the toast and the preview (SAL4-1).
      const saved: Invoice = (snap?.savedInvoice as Invoice) || newInvoice;
      // TOAST-1: an edit is "updated" (the stock moves only by the difference, if any).
      const wasEdit = invoices.some((i) => i.id === newInvoice.id);
      toast.success(`Invoice ${saved.invoiceNumber} ${wasEdit ? 'updated' : 'saved'}`, {
        description: `${saved.customerName} • ₹${(saved.grandTotal || 0).toLocaleString('en-IN')} [${saved.paymentMode}]`,
      });
      return saved;
    } catch (e: any) {
      if (String(e?.message || '').includes('DAY_CLOSED')) {
        toast.error('Cannot save invoice on a closed day', {
          description: `Daily cash register for ${newInvoice.date} at this branch is already closed. Please select an open date.`,
        });
      } else {
        toast.error('Failed to save invoice', { description: e?.message ?? 'Backend error' });
      }
      return undefined;
    }
  };

  const deleteInvoice = async (invoiceId: string) => {
    try {
      const snap = await apiDelete<any>(`/api/tx/invoice/${invoiceId}`);
      applySaleSnapshot(snap);
      toast.success('Invoice deleted & stock restored');
    } catch (e: any) {
      toast.error('Failed to delete invoice', { description: e?.message ?? 'Backend error' });
    }
  };

  const voidInvoice = async (invoiceId: string, reason: string) => {
    const inv = invoices.find((i) => i.id === invoiceId);
    if (!inv) {
      toast.error('Sale record not found.');
      return;
    }
    if (inv.isVoided) {
      toast.error('This sale is already voided.');
      return;
    }
    try {
      const snap = await apiPost<any>('/api/tx/void-invoice', {
        invoiceId,
        reason,
        actor: currentUser.name,
      });
      applySaleSnapshot(snap);
      const branchObj = BRANCHES.find((b) => b.id === inv.branchId);
      toast.success(`Sale #${inv.invoiceNumber} has been voided`, {
        description: `Physical stock reversed to ${branchObj?.name || 'warehouse'}. Excluded from cash tallies & reports.`,
      });
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('ALREADY_VOIDED')) toast.error('This sale is already voided.');
      else if (msg.includes('NOT_FOUND')) toast.error('Sale record not found.');
      else toast.error('Failed to void sale', { description: e?.message ?? 'Backend error' });
    }
  };

  // Advance an online (Shopify) order through its fulfillment pipeline. The
  // backend records the status trail and pushes a Shopify fulfillment on "Shipped".
  const updateOnlineOrderStatus = async (
    invoiceId: string,
    status: OnlineOrderStatus,
    opts?: {
      trackingNumber?: string; courierName?: string; trackingUrl?: string;
      trayPhotoUrl?: string; parcelPhotoUrl?: string; note?: string;
    }
  ) => {
    try {
      const res = await apiPost<{ invoice: Invoice; shopify?: { success: boolean; error?: string } }>(
        '/api/shopify/order-status',
        { invoiceId, status, ...opts, actor: currentUser.name }
      );
      if (res?.invoice) {
        setInvoices((prev) => prev.map((i) => (i.id === invoiceId ? { ...i, ...res.invoice } : i)));
      }
      toast.success(`Order marked "${status}"`);
      if (res?.shopify && !res.shopify.success && res.shopify.error) {
        toast.warning('Shopify fulfillment not pushed', { description: res.shopify.error });
      }
    } catch (e: any) {
      toast.error('Failed to update order status', { description: e?.message ?? 'Backend error' });
    }
  };

  const addOrderCommunication = async (invoiceId: string, type: OrderCommType, note?: string) => {
    try {
      const res = await apiPost<{ invoice: Invoice }>(
        '/api/shopify/order-comm',
        { invoiceId, type, note, actor: currentUser.name }
      );
      if (res?.invoice) {
        setInvoices((prev) => prev.map((i) => (i.id === invoiceId ? { ...i, ...res.invoice } : i)));
      }
      toast.success('Contact recorded');
    } catch (e: any) {
      toast.error('Failed to record contact', { description: e?.message ?? 'Backend error' });
    }
  };

  const saveOrderPacking = async (
    invoiceId: string,
    patch: { parcelWeightKg?: number; boxCount?: number; addressLabelDone?: boolean; invoiceIncluded?: boolean }
  ) => {
    try {
      const res = await apiPost<{ invoice: Invoice }>(
        '/api/shopify/order-packing',
        { invoiceId, ...patch, actor: currentUser.name }
      );
      if (res?.invoice) {
        setInvoices((prev) => prev.map((i) => (i.id === invoiceId ? { ...i, ...res.invoice } : i)));
      }
      toast.success('Packing details saved');
    } catch (e: any) {
      toast.error('Failed to save packing details', { description: e?.message ?? 'Backend error' });
    }
  };

  const addOrderIssue = async (invoiceId: string, type: OrderIssueType, description?: string) => {
    try {
      const res = await apiPost<{ invoice: Invoice }>('/api/shopify/order-issue', { invoiceId, type, description, actor: currentUser.name });
      if (res?.invoice) setInvoices((prev) => prev.map((i) => (i.id === invoiceId ? { ...i, ...res.invoice } : i)));
      toast.success('Issue logged');
    } catch (e: any) {
      toast.error('Failed to log issue', { description: e?.message ?? 'Backend error' });
    }
  };

  const resolveOrderIssue = async (invoiceId: string, issueId: string, resolution?: string) => {
    try {
      const res = await apiPost<{ invoice: Invoice }>('/api/shopify/order-issue-resolve', { invoiceId, issueId, resolution, actor: currentUser.name });
      if (res?.invoice) setInvoices((prev) => prev.map((i) => (i.id === invoiceId ? { ...i, ...res.invoice } : i)));
      toast.success('Issue resolved');
    } catch (e: any) {
      toast.error('Failed to resolve issue', { description: e?.message ?? 'Backend error' });
    }
  };

  const saveCourier = async (courier: Partial<CourierPartner>) => {
    try {
      const res = await apiPost<{ couriers: CourierPartner[] }>('/api/couriers', courier);
      if (Array.isArray(res?.couriers)) setCourierPartners(res.couriers);
      toast.success('Courier saved');
    } catch (e: any) {
      toast.error('Failed to save courier', { description: e?.message ?? 'Backend error' });
    }
  };

  const deleteCourier = async (id: string) => {
    try {
      const res = await apiDelete<{ couriers: CourierPartner[] }>(`/api/couriers/${id}`);
      if (Array.isArray(res?.couriers)) setCourierPartners(res.couriers);
      toast.success('Courier removed');
    } catch (e: any) {
      toast.error('Failed to remove courier', { description: e?.message ?? 'Backend error' });
    }
  };

  const processSaleReturn = async (
    invoiceId: string,
    returnLines: {
      itemId: string;
      itemCode: string;
      itemName: string;
      returnQty: number;
      unitPrice: number;
      taxRate: number;
      refundAmount: number;
      isCombo?: boolean;
      comboId?: string;
      comboComponents?: ComboComponent[];
    }[],
    reason: string,
    notes?: string,
    refundMode?: string
  ) => {
    const inv = invoices.find((i) => i.id === invoiceId);
    if (!inv) {
      toast.error('Sale record not found.');
      return false;
    }
    if (inv.isVoided) {
      toast.error('Cannot process return on a voided sale.');
      return false;
    }
    const validLines = returnLines.filter((l) => l.returnQty > 0);
    if (validLines.length === 0) {
      toast.error('Please specify at least 1 unit to return.');
      return false;
    }

    try {
      const snap = await apiPost<any>('/api/tx/sale-return', {
        invoiceId,
        returnLines: validLines,
        reason,
        notes,
        // Empty = the server refunds the way the bill was paid (CASH8-6).
        refundMode: refundMode || undefined,
        actor: currentUser.name,
      });
      applySaleSnapshot(snap);
      // The refund (a Payment row) and any credit note live outside the sale
      // snapshot — refresh so the drawer and the customer's credit show them now.
      void apiGet<any>('/api/bootstrap').then(hydrateState).catch(() => {});
      const totalUnitsReturned = validLines.reduce((sum, l) => sum + l.returnQty, 0);
      // Say what really happened, from the server's own summary: money paid back
      // vs. the due that was just reduced (E2E8-13), and units restocked vs.
      // written off as damaged (E2E-15).
      const sum = snap?.returnSummary;
      const inr = (n: number) => `₹${(Number(n) || 0).toLocaleString('en-IN')}`;
      const parts: string[] = [];
      if (sum) {
        if (sum.cashRefund > 0) parts.push(`Refunded ${inr(sum.cashRefund)}${sum.refundMode ? ` (${sum.refundMode})` : ''}`);
        if (sum.creditIssued > 0) parts.push(`Credit note ${inr(sum.creditIssued)} added to the customer's store credit`);
        if (sum.dueReduced > 0) parts.push(`Due reduced by ${inr(sum.dueReduced)}`);
        if (sum.damaged) parts.push(`${sum.writtenOffUnits} damaged unit(s) written off — not restocked`);
        else if (sum.restockedUnits > 0) parts.push(`${sum.restockedUnits} unit(s) back in stock at ${BRANCHES.find((b) => b.id === inv.branchId)?.name || inv.branchId}`);
      }
      toast.success(`Return processed for ${totalUnitsReturned} unit(s)`, { description: parts.join('. ') || undefined });
      return true;
    } catch (e: any) {
      toast.error('Failed to process return', { description: e?.message ?? 'Backend error' });
      return false;
    }
  };

  // SAL3-2: undo a return (Manager/CEO). The server reverses the stock, the
  // refund or credit note and the bill's returned total in one go.
  const reverseReturn = async (invoiceId: string, returnId: string): Promise<boolean> => {
    try {
      const snap = await apiPost<any>('/api/tx/reverse-return', { invoiceId, returnId });
      applySaleSnapshot(snap);
      void apiGet<any>('/api/bootstrap').then(hydrateState).catch(() => {});
      const r = snap?.reversed;
      const inr = (n: number) => `₹${(Number(n) || 0).toLocaleString('en-IN')}`;
      const money = r?.refund
        ? r.refund.kind === 'deleted'
          ? `Refund of ${inr(r.refund.amount)} cancelled.`
          : `Refund of ${inr(r.refund.amount)} taken back from the customer today (${r.refund.mode}).`
        : r?.creditTakenBack
        ? `Credit note of ${inr(r.creditTakenBack)} taken back.`
        : 'The due is back on the bill.';
      toast.success(`Return on #${r?.invoiceNumber || ''} reversed`, {
        description: `${r?.damaged ? 'Damaged units were written off — no stock change.' : `${r?.stockOut ?? 0} unit(s) taken back out of stock.`} ${money}`,
      });
      return true;
    } catch (e: any) {
      toast.error('Could not reverse the return', { description: e?.message ?? 'Backend error' });
      return false;
    }
  };

  // Restock Monitoring: when branch stock rises to satisfy a Waiting pending
  // order, flip it to "Stock Arrived" — persisted server-side (authoritative)
  // and notified once per order (ref-deduped) so it never re-fires on refresh.
  const restockNotifiedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    pendingOrders.forEach((order) => {
      if (order.status !== 'Waiting') return;
      if (restockNotifiedRef.current.has(order.id)) return;
      const currentQty =
        branchStocks.find((s) => s.itemId === order.itemId && s.branchId === order.branchId)?.quantity ?? 0;
      if (currentQty < order.quantityNeeded) return;

      restockNotifiedRef.current.add(order.id);
      toast.success(`Stock Arrived for Pending Order ${order.orderNumber}!`, {
        description: `${order.itemName} now has ${currentQty} ${order.unit} at ${order.branchId}. Ready to convert for ${order.customerName}!`,
      });
      persist(apiPost('/api/enquiry/pending/update', { orderId: order.id, updates: { status: 'Stock Arrived' } }));
    });
  }, [branchStocks, pendingOrders]);

  const getNextEnquiryNumber = (branchId: BranchId): string => {
    return getNextEnquirySequence(enquiries, branchId);
  };

  const saveEnquiry = (newEnquiry: Enquiry, initialExpectedRestockDate?: string) => {
    let updatedEnquiry = { ...newEnquiry };

    // Initial timeline entry if none present
    if (!updatedEnquiry.timeline || updatedEnquiry.timeline.length === 0) {
      updatedEnquiry.timeline = [
        {
          id: `tl-init-${Date.now()}`,
          timestamp: new Date().toISOString(),
          type: 'created',
          title: updatedEnquiry.isNewItemRequest ? 'New Item Enquiry Created' : 'Customer Enquiry Created',
          description: updatedEnquiry.isNewItemRequest
            ? `New item request logged for ${updatedEnquiry.quantity} ${updatedEnquiry.unit || 'Units'} of "${updatedEnquiry.itemName}" at ${updatedEnquiry.branchId}.`
            : `Requirement logged for ${updatedEnquiry.quantity} ${updatedEnquiry.unit} of ${updatedEnquiry.itemName} at ${updatedEnquiry.branchId}.`,
          actor: currentUser.name,
        },
      ];
    }

    let isOutOfStock = false;
    let availableQty = 0;

    // Only process stock shortage / pending orders if the item exists in the catalog
    if (newEnquiry.itemId) {
      const stockRow = branchStocks.find(
        (s) => s.itemId === newEnquiry.itemId && s.branchId === newEnquiry.branchId
      );
      availableQty = stockRow?.quantity ?? 0;
      isOutOfStock = availableQty < newEnquiry.quantity;

      if (isOutOfStock && !newEnquiry.pendingOrderId) {
        const newPoNumber = getNextPendingOrderSequence(pendingOrders);
        const newPo: PendingOrder = {
          id: `po-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          orderNumber: newPoNumber,
          enquiryId: newEnquiry.id,
          enquiryNumber: newEnquiry.enquiryNumber,
          itemId: newEnquiry.itemId,
          itemName: newEnquiry.itemName,
          itemCode: newEnquiry.itemCode,
          unit: newEnquiry.unit,
          branchId: newEnquiry.branchId,
          customerName: newEnquiry.customerName,
          customerPhone: newEnquiry.customerPhone,
          quantityNeeded: newEnquiry.quantity,
          expectedRestockDate: initialExpectedRestockDate || undefined,
          status: 'Waiting',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        updatedEnquiry.hasPendingOrder = true;
        updatedEnquiry.pendingOrderId = newPo.id;

        // Add timeline event for pending order linkage
        updatedEnquiry.timeline = [
          {
            id: `tl-po-${Date.now()}`,
            timestamp: new Date().toISOString(),
            type: 'status_change',
            title: 'Linked Pending Order Created',
            description: `Logged backlog order ${newPoNumber} due to inventory shortage at ${newEnquiry.branchId}.`,
            actor: 'System',
          },
          ...updatedEnquiry.timeline,
        ];

        setPendingOrders((prev) => [newPo, ...prev]);
        toast.warning(`Stock Shortage: Pending Order ${newPoNumber} Logged`, {
          description: `Only ${availableQty} in stock at ${newEnquiry.branchId} (needed: ${newEnquiry.quantity}). Staff pending order created.`,
        });
      }
    }

    // If initial reminder date & time were supplied, save linked reminder
    if (updatedEnquiry.reminderDate && updatedEnquiry.reminderTime) {
      const newRem: FollowUpReminder = {
        id: `rem-${Date.now()}`,
        enquiryId: updatedEnquiry.id,
        enquiryNumber: updatedEnquiry.enquiryNumber,
        customerName: updatedEnquiry.customerName,
        customerPhone: updatedEnquiry.customerPhone,
        itemName: updatedEnquiry.itemName,
        branchId: updatedEnquiry.branchId,
        dueDate: updatedEnquiry.reminderDate,
        dueTime: updatedEnquiry.reminderTime,
        notes: updatedEnquiry.reminderNotes,
        isCompleted: false,
        createdAt: new Date().toISOString(),
      };

      setReminders((prev) => [newRem, ...prev]);

      updatedEnquiry.timeline = [
        {
          id: `tl-rem-${Date.now()}`,
          timestamp: new Date().toISOString(),
          type: 'reminder_set',
          title: 'Follow-up Reminder Set',
          description: `Reminder scheduled for ${updatedEnquiry.reminderDate} at ${updatedEnquiry.reminderTime}.`,
          actor: currentUser.name,
        },
        ...updatedEnquiry.timeline,
      ];
    }

    setEnquiries((prev) => {
      const idx = prev.findIndex((e) => e.id === updatedEnquiry.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = updatedEnquiry;
        return updated;
      }
      return [updatedEnquiry, ...prev];
    });

    // CRM9-12: a NEW enquiry's number is allocated by the server; the toast
    // names the number the server saved.
    persist(apiPost<any>('/api/enquiry/save', { enquiry: newEnquiry, initialExpectedRestockDate, actor: currentUser.name }).then((snap) => {
      const number = (snap?.enquiries as Enquiry[] | undefined)?.find((e) => e.id === newEnquiry.id)?.enquiryNumber || updatedEnquiry.enquiryNumber;
      if (updatedEnquiry.isNewItemRequest && !updatedEnquiry.itemId) {
        toast.success(`New Item Request ${number} Logged`, {
          description: `Sent to Manager/CEO queue for catalog review and procurement.`,
        });
      } else if (!isOutOfStock) {
        toast.success(`Enquiry ${number} Saved`, {
          description: `${updatedEnquiry.customerName} • Stock available (${availableQty} in branch)`,
        });
      }
      return snap;
    }));
  };

  const linkItemToEnquiry = (enquiryId: string, newItem: Item) => {
    const targetEnquiry = enquiries.find((e) => e.id === enquiryId);
    if (!targetEnquiry) return;

    // Since the new item has 0 stock at every branch, it automatically qualifies for out-of-stock path
    const newPoNumber = getNextPendingOrderSequence(pendingOrders);
    const newPo: PendingOrder = {
      id: `po-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      orderNumber: newPoNumber,
      enquiryId: targetEnquiry.id,
      enquiryNumber: targetEnquiry.enquiryNumber,
      itemId: newItem.id,
      itemName: newItem.itemName,
      itemCode: newItem.itemCode,
      unit: newItem.unit,
      branchId: targetEnquiry.branchId,
      customerName: targetEnquiry.customerName,
      customerPhone: targetEnquiry.customerPhone,
      quantityNeeded: targetEnquiry.quantity,
      status: 'Waiting',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const updatedTimeline: EnquiryTimelineEvent[] = [
      {
        id: `tl-po-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'status_change',
        title: 'Linked Pending Order Created',
        description: `Logged backlog order ${newPoNumber} due to 0 catalog stock at ${targetEnquiry.branchId}.`,
        actor: 'System',
      },
      {
        id: `tl-cat-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'status_change',
        title: 'Item Added to Master Catalog',
        description: `Added "${newItem.itemName}" (${newItem.itemCode}) to master catalog and linked to this enquiry.`,
        actor: currentUser.name,
      },
      ...(targetEnquiry.timeline || []),
    ];

    const updatedEnquiry: Enquiry = {
      ...targetEnquiry,
      itemId: newItem.id,
      itemName: newItem.itemName,
      itemCode: newItem.itemCode,
      unit: newItem.unit,
      hasPendingOrder: true,
      pendingOrderId: newPo.id,
      timeline: updatedTimeline,
      updatedAt: new Date().toISOString(),
    };

    setEnquiries((prev) =>
      prev.map((e) => (e.id === enquiryId ? updatedEnquiry : e))
    );
    setPendingOrders((prev) => [newPo, ...prev]);

    persist(apiPost('/api/enquiry/link-item', { enquiryId, item: newItem, actor: currentUser.name }));
    toast.success(`Item "${newItem.itemName}" added to catalog & linked to Enquiry ${targetEnquiry.enquiryNumber}`);
    toast.warning(`Backlog Pending Order ${newPoNumber} automatically created for procurement.`);
  };

  const updatePendingOrder = (orderId: string, updates: Partial<PendingOrder>) => {
    setPendingOrders((prev) =>
      prev.map((po) =>
        po.id === orderId ? { ...po, ...updates, updatedAt: new Date().toISOString() } : po
      )
    );
    setSelectedPendingOrderForDetail((prev) =>
      prev && prev.id === orderId
        ? { ...prev, ...updates, updatedAt: new Date().toISOString() }
        : prev
    );
    persist(apiPost('/api/enquiry/pending/update', { orderId, updates }));
    toast.success('Pending order updated');
  };

  // CRM2-8: an advance is a real receipt (kept as the customer's store credit and
  // applied to the bill made from the order), never just a number on the order.
  const syncPendingSelection = (orders: PendingOrder[]) => {
    setPendingOrders(orders);
    setSelectedPendingOrderForDetail((prev) => (prev ? orders.find((o) => o.id === prev.id) || prev : prev));
  };
  const recordPendingAdvance = async (orderId: string, amount: number, mode: string): Promise<boolean> => {
    try {
      const res = await apiPost<any>('/api/payments/advance', { orderId, amount, mode });
      if (Array.isArray(res.pendingOrders)) syncPendingSelection(res.pendingOrders);
      void apiGet<any>('/api/bootstrap').then(hydrateState).catch(() => {});
      toast.success(`Advance received — ${res.payment?.receiptNumber || ''}`, { description: 'Kept as the customer\'s store credit until the order is billed.' });
      return true;
    } catch (e: any) {
      toast.error(e?.message || 'Could not record the advance');
      return false;
    }
  };
  const clearPendingAdvance = async (orderId: string): Promise<boolean> => {
    try {
      const res = await apiPost<any>('/api/payments/advance/clear', { orderId });
      if (Array.isArray(res.pendingOrders)) syncPendingSelection(res.pendingOrders);
      void apiGet<any>('/api/bootstrap').then(hydrateState).catch(() => {});
      toast.success('Advance given back');
      return true;
    } catch (e: any) {
      toast.error(e?.message || 'Could not clear the advance');
      return false;
    }
  };

  const cancelEnquiry = (enquiryId: string, reason: string) => {
    const timelineEvent: EnquiryTimelineEvent = {
      id: `tl-canc-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'cancelled',
      title: 'Enquiry Cancelled',
      description: `Reason: ${reason}`,
      actor: currentUser.name,
    };

    setEnquiries((prev) =>
      prev.map((e) =>
        e.id === enquiryId
          ? {
              ...e,
              status: 'Cancelled' as const,
              cancellationReason: reason,
              timeline: [timelineEvent, ...(e.timeline || [])],
              updatedAt: new Date().toISOString(),
            }
          : e
      )
    );

    setSelectedEnquiryForDetail((prev) =>
      prev && prev.id === enquiryId
        ? {
            ...prev,
            status: 'Cancelled' as const,
            cancellationReason: reason,
            timeline: [timelineEvent, ...(prev.timeline || [])],
            updatedAt: new Date().toISOString(),
          }
        : prev
    );

    setPendingOrders((prev) =>
      prev.map((po) =>
        po.enquiryId === enquiryId
          ? {
              ...po,
              status: 'Cancelled' as const,
              cancellationReason: reason,
              updatedAt: new Date().toISOString(),
            }
          : po
      )
    );

    // A cancelled enquiry must stop nagging: mark its open follow-up reminders
    // completed so they drop off the active reminders list (CRM-9).
    setReminders((prev) =>
      prev.map((r) =>
        r.enquiryId === enquiryId && !r.isCompleted
          ? { ...r, isCompleted: true, completedAt: new Date().toISOString() }
          : r
      )
    );

    persist(apiPost('/api/enquiry/cancel', { enquiryId, reason, actor: currentUser.name }));
    toast.info('Enquiry marked as Cancelled', {
      description: `Reason: ${reason}`,
    });
  };

  const cancelPendingOrder = (orderId: string, reason: string) => {
    setPendingOrders((prev) =>
      prev.map((po) =>
        po.id === orderId
          ? {
              ...po,
              status: 'Cancelled' as const,
              cancellationReason: reason,
              updatedAt: new Date().toISOString(),
            }
          : po
      )
    );

    setSelectedPendingOrderForDetail((prev) =>
      prev && prev.id === orderId
        ? {
            ...prev,
            status: 'Cancelled' as const,
            cancellationReason: reason,
            updatedAt: new Date().toISOString(),
          }
        : prev
    );

    persist(apiPost('/api/enquiry/pending/cancel', { orderId, reason }));
    toast.info('Pending order cancelled', {
      description: `Reason: ${reason}`,
    });
  };

  const addFollowUpReminder = (
    enquiryId: string,
    dueDate: string,
    dueTime: string,
    notes?: string
  ) => {
    const enq = enquiries.find((e) => e.id === enquiryId);
    if (!enq) return;

    const newReminder: FollowUpReminder = {
      id: `rem-${Date.now()}`,
      enquiryId: enq.id,
      enquiryNumber: enq.enquiryNumber,
      customerName: enq.customerName,
      customerPhone: enq.customerPhone,
      itemName: enq.itemName,
      branchId: enq.branchId,
      dueDate,
      dueTime,
      notes,
      isCompleted: false,
      createdAt: new Date().toISOString(),
    };

    setReminders((prev) => [newReminder, ...prev.filter((r) => r.enquiryId !== enquiryId || r.isCompleted)]);

    const timelineEvent: EnquiryTimelineEvent = {
      id: `tl-rem-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'reminder_set',
      title: 'Follow-up Reminder Scheduled',
      description: `Reminder set for ${dueDate} at ${dueTime}${notes ? ` — "${notes}"` : ''}`,
      actor: currentUser.name,
    };

    setEnquiries((prev) =>
      prev.map((e) =>
        e.id === enquiryId
          ? {
              ...e,
              status: 'Follow-up',
              reminderDate: dueDate,
              reminderTime: dueTime,
              reminderNotes: notes,
              timeline: [timelineEvent, ...(e.timeline || [])],
              updatedAt: new Date().toISOString(),
            }
          : e
      )
    );

    setSelectedEnquiryForDetail((prev) =>
      prev && prev.id === enquiryId
        ? {
            ...prev,
            status: 'Follow-up',
            reminderDate: dueDate,
            reminderTime: dueTime,
            reminderNotes: notes,
            timeline: [timelineEvent, ...(prev.timeline || [])],
            updatedAt: new Date().toISOString(),
          }
        : prev
    );

    persist(apiPost('/api/enquiry/reminder', { enquiryId, dueDate, dueTime, notes, actor: currentUser.name }));
    toast.success(`Follow-up Reminder Set for ${enq.enquiryNumber}`, {
      description: `Scheduled for ${dueDate} at ${dueTime}. Notification bell will alert on due date.`,
    });
  };

  const completeFollowUpReminder = (reminderId: string) => {
    setReminders((prev) =>
      prev.map((r) =>
        r.id === reminderId
          ? { ...r, isCompleted: true, completedAt: new Date().toISOString() }
          : r
      )
    );
    persist(apiPost('/api/enquiry/reminder/complete', { reminderId }));
    toast.success('Reminder marked as completed');
  };

  const deleteFollowUpReminder = (reminderId: string) => {
    setReminders((prev) => prev.filter((r) => r.id !== reminderId));
    persist(apiPost('/api/enquiry/reminder/delete', { reminderId }));
    toast.info('Reminder removed');
  };

  const updateEnquiryNotes = (enquiryId: string, notes: string) => {
    const timelineEvent: EnquiryTimelineEvent = {
      id: `tl-note-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'note_updated',
      title: 'Notes Updated',
      description: notes,
      actor: currentUser.name,
    };

    setEnquiries((prev) =>
      prev.map((e) =>
        e.id === enquiryId
          ? {
              ...e,
              notes,
              timeline: [timelineEvent, ...(e.timeline || [])],
              updatedAt: new Date().toISOString(),
            }
          : e
      )
    );

    setSelectedEnquiryForDetail((prev) =>
      prev && prev.id === enquiryId
        ? {
            ...prev,
            notes,
            timeline: [timelineEvent, ...(prev.timeline || [])],
            updatedAt: new Date().toISOString(),
          }
        : prev
    );

    persist(apiPost('/api/enquiry/notes', { enquiryId, notes, actor: currentUser.name }));
    toast.success('Enquiry notes updated');
  };

  const updateEnquiryStatus = (enquiryId: string, status: EnquiryStatus, reason?: string) => {
    const timelineEvent: EnquiryTimelineEvent = {
      id: `tl-stat-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: status === 'Cancelled' ? 'cancelled' : 'status_change',
      title: `Status Changed to ${status}`,
      description: reason || `Status set to ${status}`,
      actor: currentUser.name,
    };

    persist(apiPost('/api/enquiry/status', { enquiryId, status, reason, actor: currentUser.name }));

    setEnquiries((prev) =>
      prev.map((e) =>
        e.id === enquiryId
          ? {
              ...e,
              status,
              cancellationReason: status === 'Cancelled' ? reason : e.cancellationReason,
              timeline: [timelineEvent, ...(e.timeline || [])],
              updatedAt: new Date().toISOString(),
            }
          : e
      )
    );

    setSelectedEnquiryForDetail((prev) =>
      prev && prev.id === enquiryId
        ? {
            ...prev,
            status,
            cancellationReason: status === 'Cancelled' ? reason : prev.cancellationReason,
            timeline: [timelineEvent, ...(prev.timeline || [])],
            updatedAt: new Date().toISOString(),
          }
        : prev
    );
  };

  // Open the quotation / bill form pre-filled from an enquiry. Nothing is marked
  // Converted here: that happens only once the document is actually saved
  // (markEnquiryConverted) — leaving the form, or "+ Bill" without billing, used
  // to close the enquiry and fulfil its pending order anyway (CRM-2 / PLT7-1).
  // `enquiry` is passed by "Save & Convert", whose just-saved enquiry is not in
  // this render's list yet (CRM-1).
  const convertEnquiryToSale = (enquiryId: string, targetType: 'estimate' | 'invoice', enquiry?: Enquiry) => {
    const enq = enquiry && enquiry.id === enquiryId ? enquiry : enquiries.find((e) => e.id === enquiryId);
    if (!enq) return;
    if (enq.status === 'Converted' || enq.status === 'Cancelled') {
      toast.error(`Enquiry ${enq.enquiryNumber} is already ${enq.status}.`);
      return;
    }

    const item = items.find((i) => i.id === enq.itemId);
    const preTaxPrice = item
      ? item.salePriceTaxMode === 'with'
        ? Math.round((item.salePrice / (1 + item.gstTaxSlab / 100)) * 100) / 100
        : item.salePrice
      : 0;
    const gstRate = item?.gstTaxSlab ?? 18;

    const preFilledEstimate: Estimate = {
      id: `est-conv-${Date.now()}`,
      estimateNumber: targetType === 'estimate' ? getNextEstimateNumber(enq.branchId) : enq.enquiryNumber,
      branchId: enq.branchId,
      date: getTodayDateString(),
      time: `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`,
      customerName: enq.customerName,
      customerContact: enq.customerPhone,
      withGst: true,
      sourceEnquiryId: enq.id,
      sourceEnquiryNumber: enq.enquiryNumber,
      items: [
        {
          id: `li-${Date.now()}`,
          itemId: enq.itemId,
          itemName: enq.itemName,
          itemHSN: item?.itemHSN ?? '',
          quantity: enq.quantity,
          unit: enq.unit || item?.unit || 'PCS',
          unitPrice: preTaxPrice,
          gstRate,
          taxableAmount: Math.round(enq.quantity * preTaxPrice * 100) / 100,
          cgstAmount: Math.round(((enq.quantity * preTaxPrice * (gstRate / 2)) / 100) * 100) / 100,
          sgstAmount: Math.round(((enq.quantity * preTaxPrice * (gstRate / 2)) / 100) * 100) / 100,
          totalTax: Math.round(((enq.quantity * preTaxPrice * gstRate) / 100) * 100) / 100,
          totalAmount: Math.round((enq.quantity * preTaxPrice * (1 + gstRate / 100)) * 100) / 100,
        },
      ],
      subtotal: Math.round(enq.quantity * preTaxPrice * 100) / 100,
      totalCgst: Math.round(((enq.quantity * preTaxPrice * (gstRate / 2)) / 100) * 100) / 100,
      totalSgst: Math.round(((enq.quantity * preTaxPrice * (gstRate / 2)) / 100) * 100) / 100,
      totalTax: Math.round(((enq.quantity * preTaxPrice * gstRate) / 100) * 100) / 100,
      grandTotal: Math.round(enq.quantity * preTaxPrice * (1 + gstRate / 100)),
      amountInWords: '',
      termsAndConditions: `**NO WARRANTY**\n**NO EXCHANGE**\n**NO RETURN**`,
      createdAt: new Date().toISOString(),
    };

    if (targetType === 'estimate') {
      // Open the Sales form in Quotation mode, pre-filled (NOT an invoice draft).
      setQuoteToPrefill(preFilledEstimate);
      setEstimateToConvert(null);
      setCurrentView('estimates');
    } else {
      setEstimateToConvert(preFilledEstimate);
      setQuoteToPrefill(null);
      setCurrentView('invoices');
    }

    toast.info(`Enquiry ${enq.enquiryNumber}: review and save the ${targetType === 'estimate' ? 'quotation' : 'bill'}`, {
      description: 'Customer & line items pre-filled. The enquiry is closed once you save.',
    });
  };

  const markEnquiryConverted = async (enquiryId: string, targetType: 'estimate' | 'invoice', docId: string, docNumber: string) => {
    const enq = enquiries.find((e) => e.id === enquiryId);
    if (enq && enq.status !== 'Follow-up') return; // already converted / cancelled
    try {
      const snap = await apiPost<any>('/api/enquiry/convert', { enquiryId, targetType, docId, docNumber, actor: currentUser.name });
      applySnapshot(snap);
      const now = new Date().toISOString();
      const isOpenPo = (st: string) => st === 'Waiting' || st === 'Stock Arrived';
      setSelectedEnquiryForDetail((prev) =>
        prev && prev.id === enquiryId
          ? { ...prev, status: 'Converted' as const, convertedTo: { type: targetType, id: docId, number: docNumber, convertedAt: now } }
          : prev
      );
      setSelectedPendingOrderForDetail((prev) =>
        prev && prev.enquiryId === enquiryId && isOpenPo(prev.status) ? { ...prev, status: 'Fulfilled' as const, fulfilledAt: now } : prev
      );
    } catch (e: any) {
      toast.error('The document was saved, but the enquiry could not be marked converted', { description: e?.message });
    }
  };

  // Vendor Management Actions
  const saveVendor = (vendorData: Omit<Vendor, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Vendor => {
    const now = new Date().toISOString();
    if (vendorData.id) {
      const updated: Vendor = {
        ...(vendors.find((v) => v.id === vendorData.id) as Vendor),
        ...vendorData,
        id: vendorData.id,
        updatedAt: now,
      };
      const before = vendors;
      setVendors((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
      apiPost('/api/vendors', updated)
        .then((snap) => { applySnapshot(snap); toast.success(`Vendor "${updated.vendorName}" updated`); })
        .catch((e) => { setVendors(before); toast.error('Could not save the supplier', { description: serverMessage(e) }); });
      return updated;
    } else {
      const newVendor: Vendor = {
        ...vendorData,
        id: `vnd-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        createdAt: now,
        updatedAt: now,
      };
      setVendors((prev) => [newVendor, ...prev]);
      // PUR6-5: a duplicate supplier is refused by the server — undo and say why.
      apiPost('/api/vendors', newVendor)
        .then((snap) => { applySnapshot(snap); toast.success(`Vendor "${newVendor.vendorName}" registered`); })
        .catch((e) => {
          setVendors((prev) => prev.filter((v) => v.id !== newVendor.id));
          toast.error('Could not register the supplier', { description: serverMessage(e) });
        });
      return newVendor;
    }
  };

  const deleteVendor = (vendorId: string) => {
    const hasLinkedPos = purchaseOrders.some((po) => po.vendorId === vendorId);
    if (hasLinkedPos) {
      toast.error('Cannot delete vendor with linked Purchase Orders');
      return;
    }
    const ven = vendors.find((v) => v.id === vendorId);
    setVendors((prev) => prev.filter((v) => v.id !== vendorId));
    persist(apiDelete(`/api/vendors/${vendorId}`));
    toast.success(`Vendor "${ven?.vendorName || vendorId}" deleted`);
  };

  // Purchase Order Actions
  const getNextPoNumber = (branchId: BranchId): string => {
    return getNextPurchaseOrderSequence(purchaseOrders, branchId);
  };

  // Purchase actions wait for the server and only then update the screen, so a
  // refused action (cancel a paid PO, pay on a closed day, over-receipt …) is
  // never shown as done (PUR8-6). The server's own message is shown on refusal.
  const serverMessage = (e: any): string =>
    String(e?.message || 'The server refused this action.').replace(/^API \d+[^:]*:\s*/, '');
  const refreshVendorPayments = () => {
    if (!hasCap('payment:write')) return;
    void apiGet<Payment[]>('/api/payments').then((rows) => { if (Array.isArray(rows)) setPayments(rows); }).catch(() => {});
  };
  const runPurchase = async (call: () => Promise<any>, failTitle: string): Promise<any | null> => {
    try {
      const snap = await call();
      applySnapshot(snap);
      setSelectedPurchaseOrderForDetail((cur) => {
        if (!cur || !Array.isArray(snap?.purchaseOrders)) return cur;
        return (snap.purchaseOrders as PurchaseOrder[]).find((p) => p.id === cur.id) || cur;
      });
      return snap ?? {};
    } catch (e: any) {
      console.error(`${failTitle}:`, e);
      toast.error(failTitle, { description: serverMessage(e) });
      return null;
    }
  };

  const savePurchaseOrder = async (poData: Omit<PurchaseOrder, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<PurchaseOrder | null> => {
    const isEdit = Boolean(poData.id);
    const body = isEdit
      ? { ...(purchaseOrders.find((p) => p.id === poData.id) as PurchaseOrder), ...poData }
      : poData;
    const snap = await runPurchase(
      () => apiPost('/api/purchase/save', { po: body, actor: currentUser.name }),
      isEdit ? 'Could not update the purchase order' : 'Could not create the purchase order',
    );
    if (!snap) return null;
    const saved: PurchaseOrder = snap.saved || body;
    if (saved.pendingOrderId) {
      const link = { linkedPurchaseOrderId: saved.id, purchaseOrderId: saved.id, purchaseOrderNumber: saved.poNumber };
      setSelectedPendingOrderForDetail((prev) => (prev && prev.id === saved.pendingOrderId ? { ...prev, ...link } : prev));
    }
    toast.success(isEdit ? `Purchase Order ${saved.poNumber} updated` : `Purchase Order ${saved.poNumber} created (${saved.items.length} items)`);
    return saved;
  };

  const deletePurchaseOrder = async (poId: string): Promise<boolean> => {
    const po = purchaseOrders.find((p) => p.id === poId);
    const snap = await runPurchase(() => apiDelete(`/api/purchase/${poId}`), 'Could not delete the purchase order');
    if (!snap) return false;
    toast.success(`Purchase Order ${po?.poNumber || poId} deleted`);
    return true;
  };

  const cancelPurchaseOrder = async (poId: string): Promise<boolean> => {
    const po = purchaseOrders.find((p) => p.id === poId);
    const snap = await runPurchase(() => apiPost(`/api/purchase/${poId}/cancel`, {}), 'Could not cancel the purchase order');
    if (!snap) return false;
    toast.info(`Purchase Order ${po?.poNumber || ''} cancelled`.trim());
    return true;
  };

  const receivePurchaseOrderStock = async (
    poId: string,
    receipts: { itemId: string; quantityReceived: number; location?: string; purchasePrice?: number; damagedQuantity?: number; missingQuantity?: number; taxPercent?: number }[],
    notes?: string,
    payment?: { amount?: number; mode?: string },
    otherCharges?: number,
  ): Promise<boolean> => {
    const po = purchaseOrders.find((p) => p.id === poId);
    if (!po) {
      toast.error('Purchase order not found');
      return false;
    }
    // PUR4-3: a delivery where nothing usable arrived (0 good + N missing, or all
    // damaged) is still a receipt — the server settles those units.
    const validReceipts = receipts.filter(
      (r) => r.quantityReceived > 0 || (r.damagedQuantity || 0) > 0 || (r.missingQuantity || 0) > 0,
    );
    if (validReceipts.length === 0) {
      toast.error('Nothing to receive — enter an inward, damaged or missing quantity.');
      return false;
    }
    const extraCharge = Math.max(0, Number(otherCharges) || 0);
    const snap = await runPurchase(
      () => apiPost('/api/purchase/receive', { poId, receipts: validReceipts, notes, payment, actor: currentUser.name, otherCharges: extraCharge }),
      'Could not receive stock',
    );
    if (!snap) return false;
    // Reflect the confirmed purchase price on the item master + re-price from the
    // margin band, as the server just did (its receipt snapshot has no items).
    setItems((prev) =>
      prev.map((it) => {
        const rec = validReceipts.find((r) => r.itemId === it.id && (r.purchasePrice || 0) > 0 && r.quantityReceived > 0);
        if (!rec) return it;
        const sp = computeMarginSalePrice(rec.purchasePrice as number, it.marginCategory);
        return { ...it, purchasePrice: rec.purchasePrice as number, ...(sp != null ? { salePrice: sp } : {}), updatedAt: new Date().toISOString() };
      })
    );
    if ((Number(payment?.amount) || 0) > 0) refreshVendorPayments();
    const good = validReceipts.reduce((s, r) => s + (r.quantityReceived || 0), 0);
    const dmg = validReceipts.reduce((s, r) => s + (r.damagedQuantity || 0), 0);
    const missing = validReceipts.reduce((s, r) => s + (r.missingQuantity || 0), 0);
    toast.success(`Received ${good} unit${good === 1 ? '' : 's'} into ${po.branchId.toUpperCase()} stock`, {
      description: dmg || missing ? `${dmg ? `${dmg} damaged` : ''}${dmg && missing ? ', ' : ''}${missing ? `${missing} missing` : ''} — debit note raised.` : 'Physical stock updated.',
    });
    return true;
  };

  const recordPurchaseBill = async (
    poId: string,
    bill: { id?: string; number: string; date: string; taxable: number; gst: number; attachmentId?: string | null }
  ): Promise<boolean> => {
    const snap = await runPurchase(() => apiPost('/api/purchase/bill', { poId, bill }), 'Could not save the supplier bill');
    if (!snap) return false;
    toast.success('Supplier bill saved — input tax credit updated');
    return true;
  };

  const deletePurchaseBill = async (poId: string, billId: string): Promise<boolean> => {
    const snap = await runPurchase(() => apiPost('/api/purchase/bill/delete', { poId, billId }), 'Could not remove the supplier bill');
    if (!snap) return false;
    toast.success('Supplier bill removed');
    return true;
  };

  const recordPurchaseOrderPayment = async (poId: string, amount: number, mode: string): Promise<boolean> => {
    const po = purchaseOrders.find((p) => p.id === poId);
    if (!po) { toast.error('Purchase order not found'); return false; }
    const pay = Math.round(Math.max(0, Number(amount) || 0) * 100) / 100;
    if (pay <= 0) { toast.error('Enter a payment amount greater than 0'); return false; }
    const snap = await runPurchase(
      () => apiPost('/api/purchase/payment', { poId, amount: pay, mode: mode || 'Cash', actor: currentUser.name }),
      'Could not record the payment',
    );
    if (!snap) return false;
    refreshVendorPayments();
    toast.success(`Recorded ₹${pay.toLocaleString('en-IN')} paid to ${po.vendorName}`);
    return true;
  };

  // Apply a supplier's unapplied advance to one of its POs (PUR6-3).
  const applyVendorAdvance = async (vendorId: string, poId: string, amount?: number): Promise<boolean> => {
    try {
      const res = await apiPost<{ applied: number }>('/api/payments/vendor-advance/apply', { vendorId, poId, amount });
      void apiGet<any>('/api/bootstrap').then(hydrateState).catch(() => {});
      refreshVendorPayments();
      toast.success(`Applied ₹${(res?.applied || 0).toLocaleString('en-IN')} of advance to the PO`);
      return true;
    } catch (e: any) {
      toast.error('Could not apply the advance', { description: serverMessage(e) });
      return false;
    }
  };

  const releasePoOverpayment = async (poId: string): Promise<boolean> => {
    try {
      const res = await apiPost<{ moved: number }>('/api/payments/vendor-advance/release', { poId });
      void apiGet<any>('/api/bootstrap').then(hydrateState).catch(() => {});
      refreshVendorPayments();
      toast.success(`₹${(res?.moved || 0).toLocaleString('en-IN')} moved to the supplier's advance`);
      return true;
    } catch (e: any) {
      toast.error('Could not move the overpayment', { description: serverMessage(e) });
      return false;
    }
  };

  const addPurchaseOrderAttachment = async (
    poId: string,
    attachmentData: Omit<PurchaseOrderAttachment, 'id' | 'uploadedAt' | 'uploadedBy'>
  ): Promise<boolean> => {
    const snap = await runPurchase(
      () => apiPost('/api/purchase/attachment', { poId, attachment: attachmentData, actor: currentUser.name }),
      'Could not attach the file',
    );
    if (!snap) return false;
    toast.success(`Attached "${attachmentData.name}" to PO`);
    return true;
  };

  const deletePurchaseOrderAttachment = async (poId: string, attachmentId: string): Promise<boolean> => {
    const snap = await runPurchase(() => apiPost('/api/purchase/attachment/delete', { poId, attachmentId }), 'Could not remove the attachment');
    if (!snap) return false;
    toast.info('Vendor bill attachment removed');
    return true;
  };

  // HRM & Attendance Actions
  const saveEmployee = (empData: Omit<Employee, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Employee => {
    const now = new Date().toISOString();
    if (empData.id) {
      const updated: Employee = {
        ...(employees.find((e) => e.id === empData.id) as Employee),
        ...empData,
        id: empData.id,
        updatedAt: now,
      };
      setEmployees((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      // Never send a blank PIN on edit — the client no longer holds the PIN
      // (SEC2-2), and a blank would overwrite the stored one. Omitting it makes
      // the server keep the existing PIN.
      const payload: any = { ...updated };
      if (!payload.pin) delete payload.pin;
      persist(apiPost('/api/employees', payload));
      toast.success(`Employee "${updated.name}" updated`);
      return updated;
    } else {
      const newEmp: Employee = {
        ...empData,
        id: `emp-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        createdAt: now,
        updatedAt: now,
      };
      setEmployees((prev) => [newEmp, ...prev]);
      persist(apiPost('/api/employees', newEmp));
      toast.success(`Employee "${newEmp.name}" enrolled`);
      return newEmp;
    }
  };

  const deleteEmployee = (employeeId: string) => {
    const emp = employees.find((e) => e.id === employeeId);
    setEmployees((prev) => prev.filter((e) => e.id !== employeeId));
    persist(apiDelete(`/api/employees/${employeeId}`));
    toast.success(`Employee "${emp?.name || employeeId}" removed`);
  };

  const clockIn = (
    employeeId: string,
    photoDataUrl: string,
    location: GeoLocationCapture | null,
    customTime?: string
  ): { success: boolean; message: string; record?: AttendanceRecord } => {
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp) return { success: false, message: 'Employee not found' };
    if (emp.status !== 'Active') return { success: false, message: 'Employee profile is inactive' };

    const now = new Date();
    const today = getTodayDateString(now);
    const timeStr = customTime || now.toTimeString().split(' ')[0];

    // Check duplicate check-in today
    const existing = attendanceRecords.find(
      (a) => a.employeeId === employeeId && a.date === today
    );
    if (existing && existing.checkInTime) {
      return {
        success: false,
        message: `${emp.name} has already checked in today at ${existing.checkInTime}`,
      };
    }

    const newRecord: AttendanceRecord = {
      id: `att-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      employeeId: emp.id,
      employeeName: emp.name,
      branchId: emp.branchId,
      date: today,
      checkInTime: timeStr,
      checkInPhoto: photoDataUrl,
      checkInLocation: location,
      status: 'Present',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    setAttendanceRecords((prev) => [newRecord, ...prev]);
    toast.success(`Check-In Recorded: ${emp.name}`, {
      description: `Time: ${timeStr} • ${location ? `GPS Accuracy: ±${location.accuracy || 10}m` : 'No GPS'}`,
    });
    persist(apiPost('/api/hrm/clock-in', { employeeId, photoDataUrl, location, customTime }));
    return { success: true, message: 'Check-in successful', record: newRecord };
  };

  const clockOut = (
    employeeId: string,
    photoDataUrl: string,
    location: GeoLocationCapture | null,
    customTime?: string
  ): { success: boolean; message: string; record?: AttendanceRecord } => {
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp) return { success: false, message: 'Employee not found' };

    const now = new Date();
    const today = getTodayDateString(now);
    const timeStr = customTime || now.toTimeString().split(' ')[0];

    // Find today's check-in
    const existingIndex = attendanceRecords.findIndex(
      (a) => a.employeeId === employeeId && a.date === today
    );
    if (existingIndex === -1) {
      return {
        success: false,
        message: `No check-in found for ${emp.name} today. Must check in first.`,
      };
    }

    const existing = attendanceRecords[existingIndex];
    if (existing.checkOutTime) {
      return {
        success: false,
        message: `${emp.name} has already checked out today at ${existing.checkOutTime}`,
      };
    }

    // Compute hours worked
    const [inH, inM, inS] = existing.checkInTime.split(':').map(Number);
    const [outH, outM, outS] = timeStr.split(':').map(Number);
    const inMinutes = inH * 60 + inM + (inS || 0) / 60;
    const outMinutes = outH * 60 + outM + (outS || 0) / 60;
    const diffHours = Math.max(0, parseFloat(((outMinutes - inMinutes) / 60).toFixed(2)));

    const updatedRecord: AttendanceRecord = {
      ...existing,
      checkOutTime: timeStr,
      checkOutPhoto: photoDataUrl,
      checkOutLocation: location,
      hoursWorked: diffHours,
      updatedAt: now.toISOString(),
    };

    setAttendanceRecords((prev) => {
      const next = [...prev];
      next[existingIndex] = updatedRecord;
      return next;
    });

    toast.success(`Check-Out Recorded: ${emp.name}`, {
      description: `Total Shift: ${diffHours} hrs • Time: ${timeStr}`,
    });
    persist(apiPost('/api/hrm/clock-out', { employeeId, photoDataUrl, location, customTime }));
    return { success: true, message: 'Check-out successful', record: updatedRecord };
  };

  const updatePayrollSettings = (settings: PayrollSettings) => {
    setPayrollSettings(settings);
    toast.success('Payroll settings updated', {
      description: `Standard working hours set to ${settings.standardHoursPerMonth} hrs/month`,
    });
  };

  const updatePayrollAdjustment = (
    employeeId: string,
    month: string,
    adjustment: number,
    reason?: string
  ) => {
    setPayrollRecords((prev) => {
      const existing = prev.find((p) => p.employeeId === employeeId && p.month === month);
      if (existing) {
        return prev.map((p) => {
          if (p.employeeId === employeeId && p.month === month) {
            const finalPayable = Math.max(0, Math.round(p.computedPay + adjustment));
            return {
              ...p,
              manualAdjustment: adjustment,
              adjustmentReason: reason,
              finalPayable,
              updatedAt: new Date().toISOString(),
            };
          }
          return p;
        });
      } else {
        const emp = employees.find((e) => e.id === employeeId);
        if (!emp) return prev;
        const hourlyRate = parseFloat((emp.monthlySalary / payrollSettings.standardHoursPerMonth).toFixed(2));
        const finalPayable = Math.max(0, adjustment);
        const newRecord: PayrollRecord = {
          id: `pay-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          employeeId: emp.id,
          employeeName: emp.name,
          designation: emp.designation,
          branchId: emp.branchId,
          month,
          monthlySalary: emp.monthlySalary,
          standardHoursPerMonth: payrollSettings.standardHoursPerMonth,
          hourlyRate,
          totalDaysPresent: 0,
          totalHoursWorked: 0,
          computedPay: 0,
          manualAdjustment: adjustment,
          adjustmentReason: reason,
          finalPayable,
          status: 'Draft',
          updatedAt: new Date().toISOString(),
        };
        return [newRecord, ...prev];
      }
    });
    persist(apiPost('/api/hrm/payroll-adjustment', { employeeId, month, adjustment, reason, standardHoursPerMonth: payrollSettings.standardHoursPerMonth }));
    toast.success(`Adjustment of ₹${adjustment > 0 ? '+' : ''}${adjustment} applied`);
  };

  const markPayrollPaid = async (
    record: PayrollRecord,
    paymentMode: 'Cash' | 'Bank Transfer',
    paymentReference?: string
  ) => {
    // Server first (E2E5-12): Mark Paid now also books the salary as money out
    // (a Payment row on today's cash day), which the server can refuse — e.g.
    // today's register is closed. Only show Paid once the server agreed.
    try {
      const snap = await apiPost<any>('/api/hrm/payroll-paid', {
        payrollId: record.id,
        paymentMode,
        paymentReference,
        record,
      });
      applySnapshot(snap);
      toast.success('Payroll disbursement marked as Paid', {
        description: `Mode: ${paymentMode} ${paymentReference ? `(${paymentReference})` : ''}`,
      });
    } catch (e: any) {
      toast.error('Could not mark payroll as paid', { description: String(e?.message ?? 'Backend error').replace(/^API \d+[^:]*: /, '') });
    }
  };

  const resetToDemoData = async () => {
    try {
      // The demo dataset lives on the backend; this rebuilds Postgres and
      // rehydrates from the fresh data (all connected sessions also refresh
      // via the live SSE broadcast).
      const data = await apiPost<any>('/api/admin/reseed');
      hydrateState(data);
      setCurrentBranch('all');
      setCurrentView('dashboard');
      toast.success('Demo data restored to initial state');
    } catch (e: any) {
      toast.error('Failed to reset demo data', { description: e?.message ?? 'Backend error' });
    }
  };

  // While loading initial data from the backend, show a lightweight splash so
  // components never render against empty/placeholder collections.
  if (isBootstrapping) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
          <p className="text-sm font-semibold text-slate-600">Loading Majestronicz ERP…</p>
        </div>
      </div>
    );
  }

  if (bootstrapError) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-bold text-rose-700">Cannot reach the backend</p>
          <p className="mt-2 text-xs text-slate-600">{bootstrapError}</p>
          <p className="mt-3 text-xs text-slate-500">
            Trying to reach API at:
          </p>
          <p className="mt-1 text-xs font-mono break-all text-slate-800 bg-slate-100 rounded-lg px-2 py-1.5">
            {API_BASE || '(same origin)'}/api/bootstrap
          </p>
          <p className="mt-3 text-[11px] text-slate-500">
            {API_BASE.includes('localhost')
              ? 'This build has no VITE_API_URL set — it is pointing at localhost. Set VITE_API_URL to your backend URL and redeploy.'
              : 'Open that URL in a new tab: if it does not return JSON, the backend is down or the URL is wrong.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <ErpContext.Provider
      value={{
        currentView,
        setCurrentView,
        activeSubTab,
        navigateToTab,
        currentBranch,
        isAllBranches,
        currentBranchData,
        switchBranch,
        accessibleBranches,
        currentUser,
        isAuthenticated,
        loginWithPin,
        logout,
        isAuthModalOpen,
        setAuthModalOpen,
        canManageItems,
        canEditActiveBranchStock,
        canWriteStock: hasCap('stock:write'),
        isReadOnly,
        canViewDashboard,
        estimates,
        saveEstimate,
        deleteEstimate,
        cancelEstimate,
        getNextEstimateNumber,
        challans,
        saveChallan,
        deleteChallan,
        markChallanReceived,
        getNextChallanNumber,
        invoices,
        saveInvoice,
        updateOnlineOrderStatus,
        addOrderCommunication,
        saveOrderPacking,
        courierPartners,
        saveCourier,
        deleteCourier,
        addOrderIssue,
        resolveOrderIssue,
        deleteInvoice,
        voidInvoice,
        processSaleReturn,
        reverseReturn,
        getNextInvoiceNumber,
        estimateToConvert,
        setEstimateToConvert,
        quoteToPrefill,
        setQuoteToPrefill,
        inventoryFilterQuery,
        setInventoryFilterQuery,
        navigateToInventoryItem,
        enquiryFilterQuery,
        setEnquiryFilterQuery,
        navigateToEnquiry,
        pendingOrderFilterQuery,
        setPendingOrderFilterQuery,
        navigateToPendingOrder,
        enquiries,
        pendingOrders,
        saveEnquiry,
        linkItemToEnquiry,
        updatePendingOrder,
        recordPendingAdvance,
        clearPendingAdvance,
        cancelEnquiry,
        cancelPendingOrder,
        convertEnquiryToSale,
        markEnquiryConverted,
        getNextEnquiryNumber,
        canCancelEnquiry,
        canEditRestockDate,
        reminders,
        addFollowUpReminder,
        completeFollowUpReminder,
        deleteFollowUpReminder,
        updateEnquiryNotes,
        updateEnquiryStatus,
        selectedEnquiryForDetail,
        setSelectedEnquiryForDetail,
        selectedPendingOrderForDetail,
        setSelectedPendingOrderForDetail,
        selectedPurchaseOrderForDetail,
        setSelectedPurchaseOrderForDetail,
        reminderModalEnquiry,
        setReminderModalEnquiry,
        cashRegisters,
        getDailyCashRegister,
        addCashExpense,
        deleteCashExpense,
        approveCashExpense,
        overrideOpeningAmount,
        closeDailyRegister,
        reopenDailyRegister,
        isDayClosed,
        canCloseDay,
        canOverrideOpening,
        recurringExpenses,
        addRecurringExpenseTemplate,
        updateRecurringExpenseTemplate,
        deleteRecurringExpenseTemplate,
        approveRecurringExpense,
        enquiryActiveTab,
        setEnquiryActiveTab,
        navigateToNewItemRequestsQueue,
        vendors,
        purchaseOrders,
        saveVendor,
        deleteVendor,
        savePurchaseOrder,
        deletePurchaseOrder,
        cancelPurchaseOrder,
        receivePurchaseOrderStock,
        recordPurchaseOrderPayment,
        applyVendorAdvance,
        releasePoOverpayment,
        recordPurchaseBill,
        deletePurchaseBill,
        addPurchaseOrderAttachment,
        deletePurchaseOrderAttachment,
        getNextPoNumber,
        canManagePurchases,
        employees,
        attendanceRecords,
        payrollSettings,
        payrollRecords,
        saveEmployee,
        deleteEmployee,
        clockIn,
        clockOut,
        updatePayrollSettings,
        updatePayrollAdjustment,
        markPayrollPaid,
        canViewHrm,
        canEditSalaries,
        canMarkPayrollPaid,
        canAdjustPayroll,
        items: activeItems,
        allItems: items,
        archiveItem,
        addItem,
        updateItem,
        deleteItem,
        combos,
        saveCombo,
        deleteCombo,
        getNextComboCode,
        getComboAvailability,
        getComboBuyingSeparatelyPrice,
        branchStocks,
        getBranchStock,
        getTotalStockAcrossBranches,
        updateBranchStock,
        updateBranchStockLocation,
        categories,
        subcategoriesByCategory,
        categoryPrefixMap,
        subcategoryPrefixMap,
        addCategory,
        addSubcategory,
        generateItemCode,
        unitsList,
        addUnit,
        gstSlabsList,
        addGstSlab,
        paymentTermsOptions,
        addPaymentTerm,
        stockAdjustmentLogs,
        adjustStock,
        transferStock,
        updateItemThreshold,
        canAdjustBranchStock,
        canInitiateTransferFrom,
        canViewReports,
        canAccessView,
        canConvertEnquiry,
        canApproveCatalogRequests,
        accessMatrix,
        updateAccessMatrix,
        hasFlag,
        askAi,
        getAiStatus,
        payments,
        recordPayment,
        deletePayment,
        adjustCustomerCredit,
        canRecordPayment,
        loginError,
        clearLoginError,
        mustResetPin,
        changeOwnPin,
        staffUsers,
        refreshStaffUsers,
        createStaffUser,
        updateStaffUser,
        resetStaffPin,
        deleteStaffUser,
        linkStaffLogin,
        unlinkStaffLogin,
        getAuditLog,
        stockTransfers,
        transferStockBatch,
        receiveStockTransfer,
        inventorySettings,
        updateInventorySettings,
        getItemLastSaleInfo,
        getReorderThreshold,
        getStockStatus,
        itemSales90d,
        getCustomerOutstandingBalance,
        getCustomerUnpaidInvoices,
        inventoryMovementFilter,
        setInventoryMovementFilter,
        navigateToInventoryWithMovementFilter,
        canViewPayrollReport,
        customers,
        loyaltySettings,
        saveCustomer,
        deleteCustomer,
        updateLoyaltySettings,
        canManageLoyalty,
        canManageCustomers,
        selectedCustomerForDetail,
        setSelectedCustomerForDetail,
        resetToDemoData,
      }}
    >
      {isAuthenticated && !mustResetPin ? children : <LoginScreen />}
    </ErpContext.Provider>
  );
};

export const useErp = () => {
  const context = useContext(ErpContext);
  if (!context) {
    throw new Error('useErp must be used within an ErpProvider');
  }
  return context;
};
