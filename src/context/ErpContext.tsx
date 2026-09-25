import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { apiGet, apiPost, apiPut, apiDelete, API_BASE, setAuthToken, getTokenSession, setUnauthorizedHandler } from '../lib/api';

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
  BranchStock,
  BranchId,
  BranchScope,
  Role,
  UserSession,
  Estimate,
  DeliveryChallan,
  Invoice,
  OnlineOrderStatus,
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
  PurchaseOrder,
  PurchaseOrderStatus,
  PurchaseOrderAttachment,
  POReceiptLineItem,
  PurchaseOrderReceivingEvent,
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
  RecurringExpenseApproval,
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
  expenseNeedsApproval,
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
  saveEstimate: (estimate: Estimate) => Promise<Estimate>;
  deleteEstimate: (estimateId: string) => void;
  getNextEstimateNumber: (branchId: BranchId, date?: string) => string;

  // Delivery Challans (Low-usage goods movement note)
  challans: DeliveryChallan[];
  saveChallan: (challan: DeliveryChallan) => void;
  deleteChallan: (challanId: string) => void;
  getNextChallanNumber: () => string;

  // Sales Invoices (Core Billing)
  invoices: Invoice[];
  saveInvoice: (invoice: Invoice) => void;
  deleteInvoice: (invoiceId: string) => void;
  voidInvoice: (invoiceId: string, reason: string) => void;
  updateOnlineOrderStatus: (
    invoiceId: string,
    status: OnlineOrderStatus,
    opts?: { trackingNumber?: string; courierName?: string; note?: string }
  ) => Promise<void>;
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
    notes?: string
  ) => void;
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
  cancelEnquiry: (enquiryId: string, reason: string) => void;
  cancelPendingOrder: (orderId: string, reason: string) => void;
  convertEnquiryToSale: (enquiryId: string, targetType: 'estimate' | 'invoice') => void;
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
  items: Item[];
  addItem: (
    itemData: Omit<Item, 'id' | 'createdAt' | 'updatedAt'>,
    initialStocks?: Partial<Record<BranchId, number>>,
    initialLocations?: Partial<Record<BranchId, string>>
  ) => Item;
  updateItem: (
    itemId: string,
    updates: Partial<Omit<Item, 'id' | 'createdAt' | 'updatedAt'>>
  ) => void;
  deleteItem: (itemId: string) => void;

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
  savePurchaseOrder: (po: Omit<PurchaseOrder, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => PurchaseOrder;
  deletePurchaseOrder: (poId: string) => void;
  cancelPurchaseOrder: (poId: string) => void;
  receivePurchaseOrderStock: (
    poId: string,
    receipts: { itemId: string; quantityReceived: number; location?: string; purchasePrice?: number; damagedQuantity?: number }[],
    notes?: string,
    payment?: { amount?: number; mode?: string }
  ) => void;
  recordPurchaseOrderPayment: (poId: string, amount: number, mode: string) => void;
  addPurchaseOrderAttachment: (
    poId: string,
    attachment: Omit<PurchaseOrderAttachment, 'id' | 'uploadedAt' | 'uploadedBy'>
  ) => void;
  deletePurchaseOrderAttachment: (poId: string, attachmentId: string) => void;
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
    location: GeoLocationCapture,
    customTime?: string
  ) => { success: boolean; message: string; record?: AttendanceRecord };
  clockOut: (
    employeeId: string,
    photoDataUrl: string,
    location: GeoLocationCapture,
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

  // Beta AI assistant
  askAi: (question: string) => Promise<{ answer: string; degraded?: boolean; retryAfterSec?: number }>;
  getAiStatus: () => Promise<{ engine: string; model: string; connected: boolean; private?: boolean; message: string }>;

  // Party ledger / payments
  payments: Payment[];
  recordPayment: (input: RecordPaymentInput) => Promise<Payment | null>;
  deletePayment: (id: string) => Promise<void>;
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
  saveCustomer: (customer: Customer) => { success: boolean; error?: string; customer?: Customer };
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
      const saved = localStorage.getItem(STORAGE_KEY);
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
      const saved = localStorage.getItem(SUBTAB_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.view && parsed.tab) {
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
    try {
      localStorage.removeItem(SUBTAB_STORAGE_KEY);
    } catch {}
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
    try {
      localStorage.setItem(SUBTAB_STORAGE_KEY, JSON.stringify({ view: target, tab }));
    } catch {}
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
      const saved = localStorage.getItem(STORAGE_KEY);
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
    const es = new EventSource(`${API_BASE}/api/events`);
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
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ currentBranch, currentView })
      );
    } catch (e) {
      console.error('Failed to persist UI state to localStorage:', e);
    }
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
      toast.success(`${input.type === 'in' ? 'Payment received' : 'Payment recorded'} — ${created.receiptNumber}`);
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
  const canCloseDay = hasCap('cash:write');
  const canOverrideOpening = hasCap('cash:write');
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
    const newItem: Item = {
      ...itemData,
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

  const updateItem = (
    itemId: string,
    updates: Partial<Omit<Item, 'id' | 'createdAt' | 'updatedAt'>>
  ) => {
    const now = new Date().toISOString();
    setItems((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, ...updates, updatedAt: now } : item))
    );
    persist(apiPut(`/api/items/${itemId}`, { ...updates, updatedAt: now }));
    toast.success('Master catalog item updated');
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

  const deleteItem = (itemId: string) => {
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    setBranchStocks((prev) => prev.filter((s) => s.itemId !== itemId));
    setStockAdjustmentLogs((prev) => prev.filter((l) => l.itemId !== itemId));
    persist(apiDelete(`/api/catalog/item/${itemId}`));
    toast.success('Item removed from catalog');
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
    let minAvail = Infinity;

    for (const comp of combo.components) {
      if (!comp.quantity || comp.quantity <= 0) continue;
      let compStock = 0;
      if (branchId === 'all') {
        compStock = branchStocks
          .filter((s) => s.itemId === comp.itemId)
          .reduce((sum, s) => sum + s.quantity, 0);
      } else {
        const s = branchStocks.find(
          (stock) => stock.itemId === comp.itemId && stock.branchId === branchId
        );
        compStock = s?.quantity ?? 0;
      }

      if (compStock <= 0) {
        return 0; // Any component at 0 stock -> combo availability = 0
      }

      const possible = Math.floor(compStock / comp.quantity);
      if (possible < minAvail) {
        minAvail = possible;
      }
    }

    return minAvail === Infinity ? 0 : minAvail;
  };

  const getComboBuyingSeparatelyPrice = (combo: ComboItem): number => {
    if (!combo.components) return 0;
    return combo.components.reduce((sum, comp) => {
      const it = items.find((i) => i.id === comp.itemId);
      return sum + (it ? it.salePrice * comp.quantity : 0);
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
    updateItem(itemId, { reorderThreshold: safeThreshold });
    toast.success('Low stock alert threshold updated', {
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
      adjustedBy: `${currentUser.name} (${currentUser.role})`,
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
    const todayStr = new Date().toISOString().split('T')[0];
    const timeStr = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    let generatedChallanNo: string | undefined = undefined;

    // 2. Optional Auto-Generate Delivery Challan
    if (autoGenerateChallan) {
      const seq = (challans.length + 1).toString().padStart(3, '0');
      generatedChallanNo = `DC-TRF-${seq}`;

      const newChallan: DeliveryChallan = {
        id: `dc-${Date.now()}`,
        challanNumber: generatedChallanNo,
        recipientName: `Majestronicz ${toBranchName}`,
        location: BRANCHES.find((b) => b.id === toBranch)?.location || toBranchName,
        contactNo: '94433-28955',
        date: todayStr,
        time: timeStr,
        items: [
          {
            id: `dci-${Date.now()}-1`,
            itemId: targetItem.id,
            itemName: targetItem.itemName,
            itemHSN: targetItem.itemHSN,
            quantity,
            unit: targetItem.unit,
          },
        ],
        totalQuantity: quantity,
        termsAndConditions:
          'Goods dispatched for internal inter-branch transit and stock replenishment. Strictly not for commercial sale.',
        deliveredBy: {
          name: `${fromBranchName} Dispatch / ${currentUser.name}`,
          comment: `Stock transit dispatched by ${currentUser.name} (${currentUser.role})`,
          date: todayStr,
        },
        receivedBy: {
          name: `${toBranchName} Inventory Store`,
          comment: 'Awaiting physical transit arrival and intake verification',
          date: todayStr,
        },
        createdAt: now,
      };

      setChallans((prev) => [newChallan, ...prev]);
    }

    // 3. Record the in-transit transfer so it shows in history and can be received.
    const userLabel = `${currentUser.name} (${currentUser.role})`;
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

    persist(apiPost('/api/stock/transfer', { itemId, fromBranch, toBranch, quantity, notes, autoGenerateChallan, actor: actorLabel() }));

    toast.success(`Stock dispatched — awaiting receipt`, {
      description: `${quantity} × ${targetItem.itemName} sent ${fromBranchName} → ${toBranchName}. Destination confirms via Receive.${generatedChallanNo ? ` • Challan ${generatedChallanNo}` : ''}`,
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
    const todayStr = now.split('T')[0];
    const timeStr = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const transferRef = `TRF-${Date.now().toString(36).toUpperCase()}`;
    const userLabel = `${currentUser.name} (${currentUser.role})`;

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

    let generatedChallanNo: string | undefined;
    if (autoGenerateChallan) {
      generatedChallanNo = `DC-TRF-${(challans.length + 1).toString().padStart(3, '0')}`;
      const totalQty = validatedLines.reduce((s, l) => s + l.quantity, 0);
      const newChallan: DeliveryChallan = {
        id: `dc-${Date.now()}`, challanNumber: generatedChallanNo, recipientName: `Majestronicz ${toBranchName}`,
        location: BRANCHES.find((b) => b.id === toBranch)?.location || toBranchName, contactNo: '94433-28955',
        date: todayStr, time: timeStr,
        items: validatedLines.map((l, i) => ({ id: `dci-${Date.now()}-${i + 1}`, itemId: l.targetItem.id, itemName: l.targetItem.itemName, itemHSN: l.targetItem.itemHSN, quantity: l.quantity, unit: l.targetItem.unit })),
        totalQuantity: totalQty,
        termsAndConditions: 'Goods dispatched for internal inter-branch transit and stock replenishment. Strictly not for commercial sale.',
        deliveredBy: { name: `${fromBranchName} Dispatch / ${currentUser.name}`, comment: `Stock transit dispatched by ${userLabel}`, date: todayStr },
        receivedBy: { name: `${toBranchName} Inventory Store`, comment: 'Awaiting physical transit arrival and intake verification', date: todayStr },
        createdAt: now,
      };
      setChallans((prev) => [newChallan, ...prev]);
    }

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
    persist(apiPost('/api/stock/transfer-batch', { items: itemsToTransfer, fromBranch, toBranch, notes, autoGenerateChallan, actor: userLabel }));

    toast.success('Stock dispatched — awaiting receipt', {
      description: `${validatedLines.length} item(s) • ${totalTransferQty} units sent ${fromBranchName} → ${toBranchName}. Destination confirms via Receive.${generatedChallanNo ? ` • Challan ${generatedChallanNo}` : ''}`,
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
    const userLabel = `${currentUser.name} (${currentUser.role})`;
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
    if (matchingDates.length === 0) return { lastSaleDate: null, daysSinceLastSale: null, hasSales: false, isDeadStock: true };
    matchingDates.sort((a, b) => b.localeCompare(a));
    const latestDate = matchingDates[0];
    const todayMs = new Date(new Date().toISOString().split('T')[0]).getTime();
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

  const saveEstimate = async (newEstimate: Estimate): Promise<Estimate> => {
    // Optimistic insert (shows a provisional number instantly).
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
      toast.error('Could not save estimate to server', { description: e?.message ?? 'Backend error' });
      return newEstimate;
    }
    toast.success(`Quotation ${saved.estimateNumber} saved`, {
      description: `For ${saved.customerName} (₹${saved.grandTotal.toLocaleString('en-IN')})`,
    });
    return saved;
  };

  const deleteEstimate = (estimateId: string) => {
    setEstimates((prev) => prev.filter((e) => e.id !== estimateId));
    persist(apiDelete(`/api/catalog/estimate/${estimateId}`));
    toast.success('Estimate removed');
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

  const saveChallan = (newChallan: DeliveryChallan) => {
    setChallans((prev) => {
      const existingIdx = prev.findIndex((c) => c.id === newChallan.id);
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = newChallan;
        return updated;
      }
      return [newChallan, ...prev];
    });
    persist(apiPost('/api/catalog/challan', newChallan));
    toast.success(`Delivery Challan ${newChallan.challanNumber} saved`, {
      description: `For ${newChallan.recipientName} (${newChallan.totalQuantity} items)`,
    });
  };

  const deleteChallan = (challanId: string) => {
    setChallans((prev) => prev.filter((c) => c.id !== challanId));
    persist(apiDelete(`/api/catalog/challan/${challanId}`));
    toast.success('Delivery Challan removed');
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
  const isDayClosed = (branchId: BranchId, date: string): boolean => {
    const reg = cashRegisters.find((r) => r.branchId === branchId && r.date === date);
    return !!reg?.isClosed;
  };

  const getPreviousDayClosingBalance = (branchId: BranchId, date: string): number => {
    const pastClosed = cashRegisters
      .filter((r) => r.branchId === branchId && r.date < date && r.isClosed)
      .sort((a, b) => b.date.localeCompare(a.date));

    if (pastClosed.length > 0) {
      const last = pastClosed[0];
      const dayInvoices = invoices.filter((i) => i.branchId === branchId && i.date === last.date && !i.isVoided);
      const cashSales = dayInvoices
        .filter((i) => i.paymentMode === 'Cash')
        .reduce((sum, i) => {
          const amount = i.isPartialPayment && i.partialAmount ? i.partialAmount : i.grandTotal;
          const returned = i.totalReturnedAmount || 0;
          return sum + Math.max(0, amount - returned);
        }, 0);
      const cashExpenses = last.expenses.reduce((sum, e) => sum + (e.cashAmount || 0), 0);
      return last.openingAmount + cashSales - cashExpenses;
    }

    return branchId === 'erode-hq' ? 12000 : 8000;
  };

  const getDailyCashRegister = (branchId: BranchId, date: string): DailyCashRegister => {
    const existing = cashRegisters.find((r) => r.branchId === branchId && r.date === date);
    if (existing) return existing;

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
    const newExpense = {
      id: `exp-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      reason: expense.reason.trim(),
      category,
      billUrl: expense.billUrl || undefined,
      cashAmount: Number(expense.cashAmount) || 0,
      gpayAmount: Number(expense.gpayAmount) || 0,
      // Bank deposits (and other approval categories) start pending; they only hit
      // the drawer once a Manager/CEO approves.
      approvalStatus: expenseNeedsApproval(category) ? ('pending' as const) : undefined,
      createdBy: currentUser.name,
      createdAt: new Date().toISOString(),
    };

    setCashRegisters((prev) => {
      const existingIdx = prev.findIndex((r) => r.branchId === branchId && r.date === date);
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = {
          ...updated[existingIdx],
          expenses: [...updated[existingIdx].expenses, newExpense],
        };
        return updated;
      } else {
        const opening = getPreviousDayClosingBalance(branchId, date);
        const newRecord: DailyCashRegister = {
          id: `dcr-${branchId}-${date}`,
          branchId,
          date,
          openingAmount: opening,
          isOpeningOverridden: false,
          expenses: [newExpense],
          isClosed: false,
        };
        return [newRecord, ...prev];
      }
    });

    persist(apiPost('/api/cash/expense', { branchId, date, expense, actor: currentUser.name }));
    toast.success('Expense recorded successfully', {
      description: `${expense.reason} • Cash: ₹${expense.cashAmount} / GPay: ₹${expense.gpayAmount}`,
    });
  };

  const deleteCashExpense = (branchId: BranchId, date: string, expenseId: string) => {
    if (isDayClosed(branchId, date)) {
      toast.error('Cannot delete expense: Day register is already closed.');
      return;
    }

    setCashRegisters((prev) =>
      prev.map((r) =>
        r.branchId === branchId && r.date === date
          ? { ...r, expenses: r.expenses.filter((e) => e.id !== expenseId) }
          : r
      )
    );
    persist(apiPost('/api/cash/expense/delete', { branchId, date, expenseId }));
    toast.success('Expense entry deleted');
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
    const stamp = new Date().toISOString();
    setCashRegisters((prev) =>
      prev.map((r) =>
        r.branchId === branchId && r.date === date
          ? {
              ...r,
              expenses: r.expenses.map((e) =>
                e.id === expenseId
                  ? { ...e, approvalStatus: decision, approvedBy: currentUser.name, approvedAt: stamp }
                  : e
              ),
            }
          : r
      )
    );
    persist(apiPost('/api/cash/expense/approve', { branchId, date, expenseId, decision, actor: currentUser.name }));
    toast.success(decision === 'approved' ? 'Bank deposit approved — cash deducted' : 'Bank deposit rejected');
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

    setCashRegisters((prev) => {
      const existingIdx = prev.findIndex((r) => r.branchId === branchId && r.date === date);
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = {
          ...updated[existingIdx],
          openingAmount: amount,
          isOpeningOverridden: true,
          overrideReason: reason,
        };
        return updated;
      } else {
        const newRecord: DailyCashRegister = {
          id: `dcr-${branchId}-${date}`,
          branchId,
          date,
          openingAmount: amount,
          isOpeningOverridden: true,
          overrideReason: reason,
          expenses: [],
          isClosed: false,
        };
        return [newRecord, ...prev];
      }
    });

    persist(apiPost('/api/cash/override', { branchId, date, amount, reason }));
    toast.success('Opening cash amount updated', {
      description: `New Opening: ₹${amount.toLocaleString('en-IN')} (Override recorded)`,
    });
  };

  const closeDailyRegister = (branchId: BranchId, date: string, notes?: string) => {
    if (!canCloseDay) {
      toast.error('Only CEO or Manager can close the daily register.');
      return;
    }

    setCashRegisters((prev) => {
      const existingIdx = prev.findIndex((r) => r.branchId === branchId && r.date === date);
      const closeStamp = new Date().toISOString();
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = {
          ...updated[existingIdx],
          isClosed: true,
          closedAt: closeStamp,
          closedBy: currentUser.name,
          closingNotes: notes,
        };
        return updated;
      } else {
        const opening = getPreviousDayClosingBalance(branchId, date);
        const newRecord: DailyCashRegister = {
          id: `dcr-${branchId}-${date}`,
          branchId,
          date,
          openingAmount: opening,
          isOpeningOverridden: false,
          expenses: [],
          isClosed: true,
          closedAt: closeStamp,
          closedBy: currentUser.name,
          closingNotes: notes,
        };
        return [newRecord, ...prev];
      }
    });

    persist(apiPost('/api/cash/close', { branchId, date, notes, actor: currentUser.name }));
    toast.success(`Day Closed for ${date}`, {
      description: `Register locked by ${currentUser.name}. Opening balance will carry forward to next day.`,
    });
  };

  const reopenDailyRegister = (branchId: BranchId, date: string) => {
    if (!canCloseDay) {
      toast.error('Only CEO or Manager can reopen a closed register.');
      return;
    }

    setCashRegisters((prev) =>
      prev.map((r) =>
        r.branchId === branchId && r.date === date
          ? { ...r, isClosed: false }
          : r
      )
    );
    persist(apiPost('/api/cash/reopen', { branchId, date }));
    toast.info(`Register reopened for ${date}`, {
      description: 'You can now modify expenses or add invoices.',
    });
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
    setRecurringExpenses((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
    persist(apiPut(`/api/recurring-expenses/${id}`, updates));
    toast.success('Recurring expense template updated');
  };

  const deleteRecurringExpenseTemplate = (id: string) => {
    if (!canManageItems) {
      toast.error('Only CEO or Manager can delete recurring expense templates.');
      return;
    }
    setRecurringExpenses((prev) => prev.filter((t) => t.id !== id));
    persist(apiDelete(`/api/recurring-expenses/${id}`));
    toast.success('Recurring expense template deleted');
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

    if (isDayClosed(branchId, date)) {
      toast.error('Cannot approve expense: Cash register for this day is already closed.');
      return;
    }

    const cashAmount = paymentMode === 'Cash' ? amount : 0;
    const gpayAmount = paymentMode === 'GPay' ? amount : 0;

    const expenseId = `exp-rec-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`;
    const newExpense = {
      id: expenseId,
      reason: template.name,
      cashAmount,
      gpayAmount,
      createdBy: currentUser.name,
      createdAt: new Date().toISOString(),
    };

    setCashRegisters((prev) => {
      const existingIdx = prev.findIndex((r) => r.branchId === branchId && r.date === date);
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = {
          ...updated[existingIdx],
          expenses: [...updated[existingIdx].expenses, newExpense],
        };
        return updated;
      } else {
        const opening = getPreviousDayClosingBalance(branchId, date);
        const newRecord: DailyCashRegister = {
          id: `dcr-${branchId}-${date}`,
          branchId,
          date,
          openingAmount: opening,
          isOpeningOverridden: false,
          expenses: [newExpense],
          isClosed: false,
        };
        return [newRecord, ...prev];
      }
    });

    const monthKey = date.substring(0, 7); // e.g. "2026-09"
    const approvalRecord: RecurringExpenseApproval = {
      id: `appr-${Date.now()}`,
      month: monthKey,
      date,
      approvedAt: new Date().toISOString(),
      approvedBy: currentUser.name,
      actualAmount: amount,
      paymentMode,
      cashExpenseId: expenseId,
    };

    setRecurringExpenses((prev) =>
      prev.map((t) =>
        t.id === templateId
          ? {
              ...t,
              lastApprovedMonth: monthKey,
              approvalHistory: [approvalRecord, ...(t.approvalHistory || [])],
            }
          : t
      )
    );

    persist(apiPost('/api/cash/approve-recurring', { templateId, branchId, date, amount, paymentMode, actor: currentUser.name }));
    toast.success(`Approved "${template.name}" (₹${amount.toLocaleString('en-IN')}) into ${branchId} register`, {
      description: `Added to ${date} register via ${paymentMode}. Total expenses and closing balance updated.`,
    });
  };

  const saveCustomer = (customerData: Customer): { success: boolean; error?: string; customer?: Customer } => {
    // Normalize (country code / leading 0) so equivalent formats are caught as duplicates.
    const cleanPhone = normalizePhone(customerData.phone);
    if (!cleanPhone) {
      toast.error('Phone number is required');
      return { success: false, error: 'Phone number is required' };
    }
    if (!customerData.name.trim()) {
      toast.error('Customer name is required');
      return { success: false, error: 'Customer name is required' };
    }

    // Phone uniqueness check (normalized — prevents duplicate master records)
    const duplicate = customers.find(
      (c) => c.id !== customerData.id && normalizePhone(c.phone) === cleanPhone
    );
    if (duplicate) {
      toast.error(`A customer with phone ${customerData.phone} already exists (${duplicate.name})`);
      return {
        success: false,
        error: `Customer with phone ${customerData.phone} already exists (${duplicate.name})`,
      };
    }

    let savedCust: Customer;
    const now = new Date().toISOString();
    const existingIdx = customers.findIndex((c) => c.id === customerData.id);

    if (existingIdx >= 0) {
      savedCust = {
        ...customers[existingIdx],
        ...customerData,
        updatedAt: now,
      };
      setCustomers((prev) => {
        const next = [...prev];
        next[existingIdx] = savedCust;
        return next;
      });
      toast.success(`Customer "${savedCust.name}" updated`);
    } else {
      savedCust = {
        ...customerData,
        id: customerData.id || `cust-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        purchaseCount: customerData.purchaseCount ?? 0,
        totalSpent: customerData.totalSpent ?? 0,
        createdAt: now,
        updatedAt: now,
      };
      setCustomers((prev) => [savedCust, ...prev]);
      toast.success(`Customer "${savedCust.name}" added`);
    }
    persist(apiPost('/api/catalog/customer', savedCust));
    return { success: true, customer: savedCust };
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

  const actorLabel = () => `${currentUser.name} (${currentUser.role})`;

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
      toast.success(`Invoice ${newInvoice.invoiceNumber} saved & stock decremented`, {
        description: `${newInvoice.customerName} • ₹${newInvoice.grandTotal.toLocaleString('en-IN')} [${newInvoice.paymentMode}]`,
      });
    } catch (e: any) {
      if (String(e?.message || '').includes('DAY_CLOSED')) {
        toast.error('Cannot save invoice on a closed day', {
          description: `Daily cash register for ${newInvoice.date} at this branch is already closed. Please select an open date.`,
        });
      } else {
        toast.error('Failed to save invoice', { description: e?.message ?? 'Backend error' });
      }
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
    opts?: { trackingNumber?: string; courierName?: string; note?: string }
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
    notes?: string
  ) => {
    const inv = invoices.find((i) => i.id === invoiceId);
    if (!inv) {
      toast.error('Sale record not found.');
      return;
    }
    if (inv.isVoided) {
      toast.error('Cannot process return on a voided sale.');
      return;
    }
    const validLines = returnLines.filter((l) => l.returnQty > 0);
    if (validLines.length === 0) {
      toast.error('Please specify at least 1 unit to return.');
      return;
    }

    try {
      const snap = await apiPost<any>('/api/tx/sale-return', {
        invoiceId,
        returnLines: validLines,
        reason,
        notes,
        actor: currentUser.name,
      });
      applySaleSnapshot(snap);
      const totalUnitsReturned = validLines.reduce((sum, l) => sum + l.returnQty, 0);
      const totalRefund = validLines.reduce((sum, l) => sum + l.refundAmount, 0);
      toast.success(`Return processed for ${totalUnitsReturned} unit(s)`, {
        description: `Refund value ₹${totalRefund.toLocaleString('en-IN')}. Stock incremented in ${inv.branchId}.`,
      });
    } catch (e: any) {
      toast.error('Failed to process return', { description: e?.message ?? 'Backend error' });
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

    persist(apiPost('/api/enquiry/save', { enquiry: newEnquiry, initialExpectedRestockDate, actor: currentUser.name }));

    if (updatedEnquiry.isNewItemRequest && !updatedEnquiry.itemId) {
      toast.success(`New Item Request ${updatedEnquiry.enquiryNumber} Logged`, {
        description: `Sent to Manager/CEO queue for catalog review and procurement.`,
      });
    } else if (!isOutOfStock) {
      toast.success(`Enquiry ${updatedEnquiry.enquiryNumber} Saved`, {
        description: `${updatedEnquiry.customerName} • Stock available (${availableQty} in branch)`,
      });
    }
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

  const convertEnquiryToSale = (enquiryId: string, targetType: 'estimate' | 'invoice') => {
    const enq = enquiries.find((e) => e.id === enquiryId);
    if (!enq) return;

    const item = items.find((i) => i.id === enq.itemId);
    const preTaxPrice = item
      ? item.salePriceTaxMode === 'with'
        ? Math.round((item.salePrice / (1 + item.gstTaxSlab / 100)) * 100) / 100
        : item.salePrice
      : 0;
    const gstRate = item?.gstTaxSlab ?? 18;

    const preFilledEstimate: Estimate = {
      id: `est-conv-${Date.now()}`,
      estimateNumber: targetType === 'estimate' ? getNextEstimateNumber(enq.branchId) : `ENQ-${enq.enquiryNumber}`,
      branchId: enq.branchId,
      date: new Date().toISOString().split('T')[0],
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

    const convTimelineEvent: EnquiryTimelineEvent = {
      id: `tl-conv-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'converted',
      title: `Converted to ${targetType === 'estimate' ? 'Quotation / Estimate' : 'Sales Invoice'}`,
      description: `Generated document #${preFilledEstimate.estimateNumber}.`,
      actor: currentUser.name,
    };

    // Mark enquiry as Converted
    setEnquiries((prev) =>
      prev.map((e) =>
        e.id === enquiryId
          ? {
              ...e,
              status: 'Converted' as const,
              convertedTo: {
                type: targetType,
                id: preFilledEstimate.id,
                number: preFilledEstimate.estimateNumber,
                convertedAt: new Date().toISOString(),
              },
              timeline: [convTimelineEvent, ...(e.timeline || [])],
              updatedAt: new Date().toISOString(),
            }
          : e
      )
    );

    setSelectedEnquiryForDetail((prev) =>
      prev && prev.id === enquiryId
        ? {
            ...prev,
            status: 'Converted' as const,
            convertedTo: {
              type: targetType,
              id: preFilledEstimate.id,
              number: preFilledEstimate.estimateNumber,
              convertedAt: new Date().toISOString(),
            },
            timeline: [convTimelineEvent, ...(prev.timeline || [])],
            updatedAt: new Date().toISOString(),
          }
        : prev
    );

    // If linked pending order exists, mark Fulfilled
    setPendingOrders((prev) =>
      prev.map((po) =>
        po.enquiryId === enquiryId
          ? {
              ...po,
              status: 'Fulfilled' as const,
              fulfilledAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
          : po
      )
    );

    setSelectedPendingOrderForDetail((prev) =>
      prev && prev.enquiryId === enquiryId
        ? {
            ...prev,
            status: 'Fulfilled' as const,
            fulfilledAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
        : prev
    );

    persist(apiPost('/api/enquiry/convert', { enquiryId, targetType, docId: preFilledEstimate.id, docNumber: preFilledEstimate.estimateNumber, actor: currentUser.name }));
    toast.success(`Converting Enquiry ${enq.enquiryNumber} to ${targetType === 'estimate' ? 'Estimate' : 'Sales Invoice'}`, {
      description: `Customer & line items pre-filled. Review and save.`,
    });
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
      setVendors((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
      persist(apiPost('/api/vendors', updated));
      toast.success(`Vendor "${updated.vendorName}" updated`);
      return updated;
    } else {
      const newVendor: Vendor = {
        ...vendorData,
        id: `vnd-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        createdAt: now,
        updatedAt: now,
      };
      setVendors((prev) => [newVendor, ...prev]);
      persist(apiPost('/api/vendors', newVendor));
      toast.success(`Vendor "${newVendor.vendorName}" registered`);
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

  const savePurchaseOrder = (poData: Omit<PurchaseOrder, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): PurchaseOrder => {
    const now = new Date().toISOString();
    if (poData.id) {
      const updated: PurchaseOrder = {
        ...(purchaseOrders.find((p) => p.id === poData.id) as PurchaseOrder),
        ...poData,
        id: poData.id,
        updatedAt: now,
      };
      setPurchaseOrders((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      if (updated.pendingOrderId) {
        const pOrderId = updated.pendingOrderId;
        setPendingOrders((prev) =>
          prev.map((po) =>
            po.id === pOrderId
              ? {
                  ...po,
                  linkedPurchaseOrderId: updated.id,
                  purchaseOrderId: updated.id,
                  purchaseOrderNumber: updated.poNumber,
                  updatedAt: now,
                }
              : po
          )
        );
      }
      persist(apiPost('/api/purchase/save', { po: updated, actor: currentUser.name }));
      toast.success(`Purchase Order ${updated.poNumber} updated`);
      return updated;
    } else {
      const newPo: PurchaseOrder = {
        ...poData,
        id: `po-order-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        createdAt: now,
        updatedAt: now,
      };
      setPurchaseOrders((prev) => [newPo, ...prev]);
      if (newPo.pendingOrderId) {
        const pOrderId = newPo.pendingOrderId;
        setPendingOrders((prev) =>
          prev.map((po) =>
            po.id === pOrderId
              ? {
                  ...po,
                  linkedPurchaseOrderId: newPo.id,
                  purchaseOrderId: newPo.id,
                  purchaseOrderNumber: newPo.poNumber,
                  updatedAt: now,
                }
              : po
          )
        );
        setSelectedPendingOrderForDetail((prev) =>
          prev && prev.id === pOrderId
            ? {
                ...prev,
                linkedPurchaseOrderId: newPo.id,
                purchaseOrderId: newPo.id,
                purchaseOrderNumber: newPo.poNumber,
                updatedAt: now,
              }
            : prev
        );
      }
      persist(apiPost('/api/purchase/save', { po: newPo, actor: currentUser.name }));
      toast.success(`Purchase Order ${newPo.poNumber} created (${newPo.items.length} items)`);
      return newPo;
    }
  };

  const deletePurchaseOrder = (poId: string) => {
    const po = purchaseOrders.find((p) => p.id === poId);
    if (po && (po.status === 'Received' || po.status === 'Partially Received')) {
      toast.error('Cannot delete a Purchase Order that has received stock. You can cancel it instead.');
      return;
    }
    setPurchaseOrders((prev) => prev.filter((p) => p.id !== poId));
    persist(apiDelete(`/api/purchase/${poId}`));
    toast.success(`Purchase Order ${po?.poNumber || poId} deleted`);
  };

  const cancelPurchaseOrder = (poId: string) => {
    setPurchaseOrders((prev) =>
      prev.map((po) => {
        if (po.id === poId) {
          return {
            ...po,
            status: 'Cancelled',
            updatedAt: new Date().toISOString(),
          };
        }
        return po;
      })
    );
    persist(apiPost(`/api/purchase/${poId}/cancel`, {}));
    toast.info(`Purchase Order marked Cancelled`);
  };

  const receivePurchaseOrderStock = (
    poId: string,
    receipts: { itemId: string; quantityReceived: number; location?: string; purchasePrice?: number; damagedQuantity?: number }[],
    notes?: string,
    payment?: { amount?: number; mode?: string }
  ) => {
    const po = purchaseOrders.find((p) => p.id === poId);
    if (!po) {
      toast.error('Purchase order not found');
      return;
    }

    const validReceipts = receipts.filter((r) => r.quantityReceived > 0 || (r.damagedQuantity || 0) > 0);
    if (validReceipts.length === 0) {
      toast.error('No items to receive (quantity must be greater than 0)');
      return;
    }

    // 1. Update PO items receivedQuantity + confirm the purchase price captured at
    //    receiving (refresh the line amount so the PO total reflects the real cost).
    const updatedLines = po.items.map((line) => {
      const rec = validReceipts.find((r) => r.itemId === line.itemId);
      if (!rec) return line;
      const nextPrice =
        rec.purchasePrice != null && rec.purchasePrice >= 0 ? rec.purchasePrice : line.purchasePrice || 0;
      return {
        ...line,
        receivedQuantity: (line.receivedQuantity || 0) + rec.quantityReceived,
        purchasePrice: nextPrice,
        amount: Math.round(nextPrice * (line.quantityOrdered || 0) * 100) / 100,
      };
    });
    const newTotalAmount = updatedLines.reduce((s, l) => s + (l.amount || 0), 0);

    // 2. Build structured receiving event log
    const receiptEventLines: POReceiptLineItem[] = validReceipts.map((rec) => {
      const line = po.items.find((l) => l.itemId === rec.itemId);
      const prevReceived = line?.receivedQuantity || 0;
      return {
        itemId: rec.itemId,
        itemName: line?.itemName || rec.itemId,
        itemCode: line?.itemCode || '',
        quantityOrdered: line?.quantityOrdered || 0,
        quantityReceivedThisEvent: rec.quantityReceived,
        totalReceivedSoFar: prevReceived + rec.quantityReceived,
        location: rec.location?.trim() || undefined,
      };
    });

    const newReceivingEvent: PurchaseOrderReceivingEvent = {
      id: `rec-evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      date: new Date().toISOString().split('T')[0],
      timestamp: new Date().toISOString(),
      receivedBy: currentUser.name || currentUser.role,
      notes: notes?.trim() || undefined,
      lines: receiptEventLines,
    };

    // Determine status: are all items fully received?
    const allFullyReceived = updatedLines.every((l) => (l.receivedQuantity || 0) >= l.quantityOrdered);
    const anyReceived = updatedLines.some((l) => (l.receivedQuantity || 0) > 0);
    const newStatus: PurchaseOrderStatus = allFullyReceived
      ? 'Received'
      : anyReceived
      ? 'Partially Received'
      : po.status;

    // Quality check: damaged/rejected units raise a vendor debit note.
    const existingNotes = po.debitNotes || [];
    const damagedReceipts = validReceipts.filter((r) => (r.damagedQuantity || 0) > 0);
    let debitNotes = existingNotes;
    if (damagedReceipts.length > 0) {
      const dnLines = damagedReceipts.map((rec) => {
        const line = updatedLines.find((l) => l.itemId === rec.itemId);
        const unitPrice = line?.purchasePrice || 0;
        const dq = rec.damagedQuantity || 0;
        return {
          itemId: rec.itemId,
          itemName: line?.itemName || rec.itemId,
          itemCode: line?.itemCode,
          damagedQuantity: dq,
          unitPrice,
          amount: Math.round(unitPrice * dq * 100) / 100,
        };
      });
      const dnTotal = Math.round(dnLines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
      debitNotes = [
        {
          id: `dn-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          noteNumber: `${po.poNumber}-DN${existingNotes.length + 1}`,
          date: new Date().toISOString().split('T')[0],
          createdBy: currentUser.name || currentUser.role,
          lines: dnLines,
          totalAmount: dnTotal,
          notes: notes?.trim() || undefined,
        },
        ...existingNotes,
      ];
    }

    const payNow = Math.max(0, Number(payment?.amount) || 0);
    const newAmountPaid = Math.round(((po.amountPaid || 0) + payNow) * 100) / 100;
    const payments = [...(po.payments || [])];
    if (payNow > 0) {
      payments.unshift({
        id: `pay-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        date: new Date().toISOString().split('T')[0],
        amount: payNow,
        mode: payment?.mode || 'Cash',
        by: currentUser.name || currentUser.role,
      });
    }

    const updatedPo: PurchaseOrder = {
      ...po,
      items: updatedLines,
      status: newStatus,
      totalAmount: newTotalAmount,
      amountPaid: newAmountPaid,
      receivingHistory: [newReceivingEvent, ...(po.receivingHistory || [])],
      debitNotes,
      payments,
      updatedAt: new Date().toISOString(),
    };

    setPurchaseOrders((prev) => prev.map((p) => (p.id === poId ? updatedPo : p)));

    // Sync selected PO for detail if open
    setSelectedPurchaseOrderForDetail((current) => {
      if (!current || current.id !== poId) return current;
      return updatedPo;
    });

    // 3. Increment physical stock in branchStocks for po.branchId
    // Reflect the confirmed purchase price on the item master + re-price from margin band.
    setItems((prev) =>
      prev.map((it) => {
        const rec = validReceipts.find((r) => r.itemId === it.id && r.purchasePrice != null && (r.purchasePrice as number) >= 0);
        if (!rec) return it;
        const sp = computeMarginSalePrice(rec.purchasePrice as number, it.marginCategory);
        return {
          ...it,
          purchasePrice: rec.purchasePrice as number,
          ...(sp != null ? { salePrice: sp } : {}),
          updatedAt: new Date().toISOString(),
        };
      })
    );

    setBranchStocks((prevStocks) => {
      const nextStocks = [...prevStocks];
      validReceipts.forEach((rec) => {
        const stockIndex = nextStocks.findIndex(
          (s) => s.itemId === rec.itemId && s.branchId === po.branchId
        );
        if (stockIndex >= 0) {
          nextStocks[stockIndex] = {
            ...nextStocks[stockIndex],
            quantity: nextStocks[stockIndex].quantity + rec.quantityReceived,
            ...(rec.location ? { location: rec.location.trim() } : {}),
            updatedAt: new Date().toISOString(),
          };
        } else {
          nextStocks.push({
            itemId: rec.itemId,
            branchId: po.branchId,
            quantity: rec.quantityReceived,
            location: rec.location ? rec.location.trim() : '',
            minStockAlert: 5,
            updatedAt: new Date().toISOString(),
          });
        }
      });
      return nextStocks;
    });

    persist(apiPost('/api/purchase/receive', { poId, receipts, notes, payment, actor: currentUser.name }));

    const totalQty = validReceipts.reduce((sum, r) => sum + r.quantityReceived, 0);
    toast.success(`Received ${totalQty} units into ${po.branchId.toUpperCase()} stock`, {
      description: `Physical stock updated. PO status is now ${newStatus}.`,
    });
  };

  const recordPurchaseOrderPayment = (poId: string, amount: number, mode: string) => {
    const po = purchaseOrders.find((p) => p.id === poId);
    if (!po) { toast.error('Purchase order not found'); return; }
    const pay = Math.max(0, Number(amount) || 0);
    if (pay <= 0) { toast.error('Enter a payment amount greater than 0'); return; }
    const entry = {
      id: `pay-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      date: new Date().toISOString().split('T')[0],
      amount: pay, mode: mode || 'Cash', by: currentUser.name || currentUser.role,
    };
    const updatedPo: PurchaseOrder = {
      ...po,
      amountPaid: Math.round(((po.amountPaid || 0) + pay) * 100) / 100,
      payments: [entry, ...(po.payments || [])],
      updatedAt: new Date().toISOString(),
    };
    setPurchaseOrders((prev) => prev.map((p) => (p.id === poId ? updatedPo : p)));
    setSelectedPurchaseOrderForDetail((cur) => (cur && cur.id === poId ? updatedPo : cur));
    persist(apiPost('/api/purchase/payment', { poId, amount: pay, mode: mode || 'Cash', actor: currentUser.name }));
    toast.success(`Recorded ₹${pay.toLocaleString('en-IN')} paid to ${po.vendorName}`);
  };

  const addPurchaseOrderAttachment = (
    poId: string,
    attachmentData: Omit<PurchaseOrderAttachment, 'id' | 'uploadedAt' | 'uploadedBy'>
  ) => {
    const newAttachment: PurchaseOrderAttachment = {
      ...attachmentData,
      id: `po-att-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      uploadedAt: new Date().toISOString(),
      uploadedBy: currentUser.name || currentUser.role,
    };

    setPurchaseOrders((prev) =>
      prev.map((po) => {
        if (po.id !== poId) return po;
        return {
          ...po,
          attachments: [newAttachment, ...(po.attachments || [])],
          updatedAt: new Date().toISOString(),
        };
      })
    );

    setSelectedPurchaseOrderForDetail((current) => {
      if (!current || current.id !== poId) return current;
      return {
        ...current,
        attachments: [newAttachment, ...(current.attachments || [])],
        updatedAt: new Date().toISOString(),
      };
    });

    persist(apiPost('/api/purchase/attachment', { poId, attachment: attachmentData, actor: currentUser.name }));
    toast.success(`Attached "${attachmentData.name}" to PO`);
  };

  const deletePurchaseOrderAttachment = (poId: string, attachmentId: string) => {
    setPurchaseOrders((prev) =>
      prev.map((po) => {
        if (po.id !== poId) return po;
        return {
          ...po,
          attachments: (po.attachments || []).filter((a) => a.id !== attachmentId),
          updatedAt: new Date().toISOString(),
        };
      })
    );

    setSelectedPurchaseOrderForDetail((current) => {
      if (!current || current.id !== poId) return current;
      return {
        ...current,
        attachments: (current.attachments || []).filter((a) => a.id !== attachmentId),
        updatedAt: new Date().toISOString(),
      };
    });

    persist(apiPost('/api/purchase/attachment/delete', { poId, attachmentId }));
    toast.info('Vendor bill attachment removed');
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
      persist(apiPost('/api/employees', updated));
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
    location: GeoLocationCapture,
    customTime?: string
  ): { success: boolean; message: string; record?: AttendanceRecord } => {
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp) return { success: false, message: 'Employee not found' };
    if (emp.status !== 'Active') return { success: false, message: 'Employee profile is inactive' };

    const now = new Date();
    const today = now.toISOString().split('T')[0];
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
      description: `Time: ${timeStr} • GPS Accuracy: ±${location.accuracy || 10}m`,
    });
    persist(apiPost('/api/hrm/clock-in', { employeeId, photoDataUrl, location, customTime }));
    return { success: true, message: 'Check-in successful', record: newRecord };
  };

  const clockOut = (
    employeeId: string,
    photoDataUrl: string,
    location: GeoLocationCapture,
    customTime?: string
  ): { success: boolean; message: string; record?: AttendanceRecord } => {
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp) return { success: false, message: 'Employee not found' };

    const now = new Date();
    const today = now.toISOString().split('T')[0];
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
    const now = new Date().toISOString();
    // Optimistic upsert: computed rows (id "calc-…") have no persisted record
    // yet, so match by employee+month and create one if missing — otherwise the
    // status never flips to Paid and the Pay button stays clickable.
    setPayrollRecords((prev) => {
      const idx = prev.findIndex(
        (p) => p.id === record.id || (p.employeeId === record.employeeId && p.month === record.month)
      );
      const paid: PayrollRecord = {
        ...record,
        status: 'Paid',
        paidAt: now,
        paymentMode,
        paymentReference,
        updatedAt: now,
      };
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...prev[idx], ...paid };
        return next;
      }
      return [paid, ...prev];
    });
    toast.success('Payroll disbursement marked as Paid', {
      description: `Mode: ${paymentMode} ${paymentReference ? `(${paymentReference})` : ''}`,
    });
    // Await so the caller's submit-guard stays locked until the server responds
    // (backend upserts by employee+month and returns authoritative records).
    await persist(
      apiPost('/api/hrm/payroll-paid', {
        payrollId: record.id,
        paymentMode,
        paymentReference,
        record,
      })
    );
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
        isReadOnly,
        canViewDashboard,
        estimates,
        saveEstimate,
        deleteEstimate,
        getNextEstimateNumber,
        challans,
        saveChallan,
        deleteChallan,
        getNextChallanNumber,
        invoices,
        saveInvoice,
        updateOnlineOrderStatus,
        deleteInvoice,
        voidInvoice,
        processSaleReturn,
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
        cancelEnquiry,
        cancelPendingOrder,
        convertEnquiryToSale,
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
        items,
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
