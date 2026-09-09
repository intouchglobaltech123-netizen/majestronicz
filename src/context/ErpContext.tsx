import React, { createContext, useContext, useState, useEffect } from 'react';
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
  SaleReturnLineItem,
  Enquiry,
  EnquiryStatus,
  PendingOrder,
  FollowUpReminder,
  EnquiryTimelineEvent,
  BRANCHES,
  PRESET_ROLES,
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
  STANDARD_UNITS,
  GST_RATES,
  PAYMENT_TERMS_OPTIONS,
  ComboItem,
  ComboComponent,
  RecurringExpenseTemplate,
  RecurringExpenseApproval,
  Customer,
  LoyaltySettings,
} from '../types';
import {
  INITIAL_ITEMS,
  INITIAL_BRANCH_STOCKS,
  INITIAL_ESTIMATES,
  INITIAL_CHALLANS,
  INITIAL_INVOICES,
  INITIAL_ENQUIRIES,
  INITIAL_PENDING_ORDERS,
  INITIAL_REMINDERS,
  INITIAL_DAILY_CASH_REGISTERS,
  INITIAL_VENDORS,
  INITIAL_PURCHASE_ORDERS,
  INITIAL_EMPLOYEES,
  INITIAL_ATTENDANCE_RECORDS,
  INITIAL_PAYROLL_SETTINGS,
  INITIAL_PAYROLL_RECORDS,
  INITIAL_STOCK_ADJUSTMENT_LOGS,
  INITIAL_CATEGORIES,
  INITIAL_SUBCATEGORIES,
  INITIAL_COMBOS,
  INITIAL_RECURRING_EXPENSE_TEMPLATES,
  INITIAL_CUSTOMERS,
  INITIAL_LOYALTY_SETTINGS,
} from '../data/seedData';
import { generateFullItemCode, resolvePrefix } from '../lib/itemCodeGenerator';
import { toast } from 'sonner';

export const STORAGE_KEY = 'majestronicz_erp_v1_demo';

export type ActiveNavView =
  | 'dashboard'
  | 'items'
  | 'inventory'
  | 'customers'
  | 'enquiries'
  | 'pending-orders'
  | 'estimates'
  | 'challans'
  | 'invoices'
  | 'barcodes'
  | 'cash-register'
  | 'purchases'
  | 'hrm'
  | 'reports';

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

  // Branch Scope State (controls which branch's STOCK is viewed/edited or 'all' for aggregated)
  currentBranch: BranchScope;
  isAllBranches: boolean;
  currentBranchData?: typeof BRANCHES[0];
  switchBranch: (branch: BranchScope) => void;
  accessibleBranches: typeof BRANCHES;

  // Auth / Role State
  currentUser: UserSession;
  loginWithPin: (pin: string, customBranch?: BranchId) => boolean;
  switchRole: (role: Role, customBranch?: BranchId) => void;
  logout: () => void;
  isAuthModalOpen: boolean;
  setAuthModalOpen: (open: boolean) => void;

  // Permissions
  canManageItems: boolean; // CEO & Manager can edit master item catalog & master pricing
  canEditActiveBranchStock: boolean; // CEO can edit all branches, Manager can edit assigned branch stock
  isReadOnly: boolean; // Billing role
  canViewDashboard: boolean; // CEO & Manager can view Dashboard, Billing cannot

  // Estimates & Quotations
  estimates: Estimate[];
  saveEstimate: (estimate: Estimate) => void;
  deleteEstimate: (estimateId: string) => void;
  getNextEstimateNumber: (branchId: BranchId) => string;

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
  getNextInvoiceNumber: (branchId: BranchId) => string;
  estimateToConvert: Estimate | null;
  setEstimateToConvert: (estimate: Estimate | null) => void;
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
  addCashExpense: (branchId: BranchId, date: string, expense: { reason: string; cashAmount: number; gpayAmount: number }) => void;
  deleteCashExpense: (branchId: BranchId, date: string, expenseId: string) => void;
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
    receipts: { itemId: string; quantityReceived: number; location?: string }[],
    notes?: string
  ) => void;
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
    payrollId: string,
    paymentMode: 'Cash' | 'Bank Transfer',
    paymentReference?: string
  ) => void;
  canViewHrm: boolean;
  canEditSalaries: boolean;
  canMarkPayrollPaid: boolean;
  canAdjustPayroll: boolean;

  // Reports
  canViewReports: boolean;
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

export const ErpProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<UserSession>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.currentUser) return parsed.currentUser;
      }
    } catch (e) {
      console.error('Failed to load currentUser from storage:', e);
    }
    return {
      role: 'CEO',
      name: 'Sathish Kumar (CEO)',
      pin: '1111',
    };
  });

  const [currentView, setCurrentView] = useState<ActiveNavView>(() => {
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

  const [items, setItems] = useState<Item[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.items && Array.isArray(parsed.items) && parsed.items[0]?.salePrice !== undefined) {
          return parsed.items;
        }
      }
    } catch (e) {
      console.error('Failed to load items from storage:', e);
    }
    return INITIAL_ITEMS;
  });

  const [combos, setCombos] = useState<ComboItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.combos && Array.isArray(parsed.combos)) {
          return parsed.combos;
        }
      }
    } catch (e) {
      console.error('Failed to load combos from storage:', e);
    }
    return INITIAL_COMBOS;
  });

  const [branchStocks, setBranchStocks] = useState<BranchStock[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.branchStocks && Array.isArray(parsed.branchStocks)) {
          return parsed.branchStocks;
        }
      }
    } catch (e) {
      console.error('Failed to load branch stocks from storage:', e);
    }
    return INITIAL_BRANCH_STOCKS;
  });

  const [stockAdjustmentLogs, setStockAdjustmentLogs] = useState<StockAdjustmentLog[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.stockAdjustmentLogs && Array.isArray(parsed.stockAdjustmentLogs)) {
          return parsed.stockAdjustmentLogs;
        }
      }
    } catch (e) {
      console.error('Failed to load stock adjustment logs from storage:', e);
    }
    return INITIAL_STOCK_ADJUSTMENT_LOGS;
  });

  const [estimates, setEstimates] = useState<Estimate[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.estimates && Array.isArray(parsed.estimates)) {
          return parsed.estimates;
        }
      }
    } catch (e) {
      console.error('Failed to load estimates from storage:', e);
    }
    return INITIAL_ESTIMATES;
  });

  const [challans, setChallans] = useState<DeliveryChallan[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.challans && Array.isArray(parsed.challans)) {
          return parsed.challans;
        }
      }
    } catch (e) {
      console.error('Failed to load challans from storage:', e);
    }
    return INITIAL_CHALLANS;
  });

  const [invoices, setInvoices] = useState<Invoice[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.invoices && Array.isArray(parsed.invoices)) {
          return parsed.invoices;
        }
      }
    } catch (e) {
      console.error('Failed to load invoices from storage:', e);
    }
    return INITIAL_INVOICES;
  });

  const [enquiries, setEnquiries] = useState<Enquiry[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.enquiries && Array.isArray(parsed.enquiries)) {
          return parsed.enquiries;
        }
      }
    } catch (e) {
      console.error('Failed to load enquiries from storage:', e);
    }
    return INITIAL_ENQUIRIES;
  });

  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.pendingOrders && Array.isArray(parsed.pendingOrders)) {
          return parsed.pendingOrders;
        }
      }
    } catch (e) {
      console.error('Failed to load pendingOrders from storage:', e);
    }
    return INITIAL_PENDING_ORDERS;
  });

  const [reminders, setReminders] = useState<FollowUpReminder[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.reminders && Array.isArray(parsed.reminders)) {
          return parsed.reminders;
        }
      }
    } catch (e) {
      console.error('Failed to load reminders from storage:', e);
    }
    return INITIAL_REMINDERS;
  });

  const [selectedEnquiryForDetail, setSelectedEnquiryForDetail] = useState<Enquiry | null>(null);
  const [selectedPendingOrderForDetail, setSelectedPendingOrderForDetail] = useState<PendingOrder | null>(null);
  const [selectedPurchaseOrderForDetail, setSelectedPurchaseOrderForDetail] = useState<PurchaseOrder | null>(null);
  const [reminderModalEnquiry, setReminderModalEnquiry] = useState<Enquiry | null>(null);

  const [cashRegisters, setCashRegisters] = useState<DailyCashRegister[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.cashRegisters && Array.isArray(parsed.cashRegisters)) {
          return parsed.cashRegisters;
        }
      }
    } catch (e) {
      console.error('Failed to load cashRegisters from storage:', e);
    }
    return INITIAL_DAILY_CASH_REGISTERS;
  });

  const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpenseTemplate[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.recurringExpenses && Array.isArray(parsed.recurringExpenses)) {
          return parsed.recurringExpenses;
        }
      }
    } catch (e) {
      console.error('Failed to load recurringExpenses from storage:', e);
    }
    return INITIAL_RECURRING_EXPENSE_TEMPLATES;
  });

  const [enquiryActiveTab, setEnquiryActiveTab] = useState<'all' | 'new-item-requests'>('all');

  const navigateToNewItemRequestsQueue = () => {
    setEnquiryActiveTab('new-item-requests');
    setCurrentView('enquiries');
  };

  const [vendors, setVendors] = useState<Vendor[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.vendors && Array.isArray(parsed.vendors) && parsed.vendors.length > 0) {
          return parsed.vendors;
        }
      }
    } catch (e) {
      console.error('Failed to load vendors from storage:', e);
    }
    return INITIAL_VENDORS;
  });

  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.purchaseOrders && Array.isArray(parsed.purchaseOrders) && parsed.purchaseOrders.length > 0) {
          return parsed.purchaseOrders;
        }
      }
    } catch (e) {
      console.error('Failed to load purchase orders from storage:', e);
    }
    return INITIAL_PURCHASE_ORDERS;
  });

  const [employees, setEmployees] = useState<Employee[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.employees && Array.isArray(parsed.employees) && parsed.employees.length > 0) {
          return parsed.employees;
        }
      }
    } catch (e) {
      console.error('Failed to load employees from storage:', e);
    }
    return INITIAL_EMPLOYEES;
  });

  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.attendanceRecords && Array.isArray(parsed.attendanceRecords)) {
          return parsed.attendanceRecords;
        }
      }
    } catch (e) {
      console.error('Failed to load attendanceRecords from storage:', e);
    }
    return INITIAL_ATTENDANCE_RECORDS;
  });

  const [payrollSettings, setPayrollSettings] = useState<PayrollSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.payrollSettings && parsed.payrollSettings.standardHoursPerMonth) {
          return parsed.payrollSettings;
        }
      }
    } catch (e) {
      console.error('Failed to load payrollSettings from storage:', e);
    }
    return INITIAL_PAYROLL_SETTINGS;
  });

  const [payrollRecords, setPayrollRecords] = useState<PayrollRecord[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.payrollRecords && Array.isArray(parsed.payrollRecords)) {
          return parsed.payrollRecords;
        }
      }
    } catch (e) {
      console.error('Failed to load payrollRecords from storage:', e);
    }
    return INITIAL_PAYROLL_RECORDS;
  });

  const [customers, setCustomers] = useState<Customer[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.customers && Array.isArray(parsed.customers) && parsed.customers.length > 0) {
          return parsed.customers;
        }
      }
    } catch (e) {
      console.error('Failed to load customers from storage:', e);
    }
    return INITIAL_CUSTOMERS;
  });

  const [loyaltySettings, setLoyaltySettings] = useState<LoyaltySettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.loyaltySettings && typeof parsed.loyaltySettings.purchaseThreshold === 'number') {
          return parsed.loyaltySettings;
        }
      }
    } catch (e) {
      console.error('Failed to load loyaltySettings from storage:', e);
    }
    return INITIAL_LOYALTY_SETTINGS;
  });

  const [selectedCustomerForDetail, setSelectedCustomerForDetail] = useState<Customer | null>(null);

  const [estimateToConvert, setEstimateToConvert] = useState<Estimate | null>(null);
  const [inventoryFilterQuery, setInventoryFilterQuery] = useState<string>('');
  const [enquiryFilterQuery, setEnquiryFilterQuery] = useState<string>('');
  const [pendingOrderFilterQuery, setPendingOrderFilterQuery] = useState<string>('');

  const navigateToInventoryItem = (itemQuery: string) => {
    setInventoryFilterQuery(itemQuery);
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
  const [categories, setCategories] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.categories && Array.isArray(parsed.categories)) {
          return parsed.categories;
        }
      }
    } catch (e) {
      console.error('Failed to load categories:', e);
    }
    return INITIAL_CATEGORIES;
  });

  const [subcategoriesByCategory, setSubcategoriesByCategory] = useState<Record<string, string[]>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.subcategoriesByCategory && typeof parsed.subcategoriesByCategory === 'object') {
          return parsed.subcategoriesByCategory;
        }
      }
    } catch (e) {
      console.error('Failed to load subcategories:', e);
    }
    return INITIAL_SUBCATEGORIES;
  });

  const [categoryPrefixMap, setCategoryPrefixMap] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.categoryPrefixMap) {
          return parsed.categoryPrefixMap;
        }
      }
    } catch (e) {
      console.error('Failed to load category prefix map:', e);
    }
    return {};
  });

  const [subcategoryPrefixMap, setSubcategoryPrefixMap] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.subcategoryPrefixMap) {
          return parsed.subcategoryPrefixMap;
        }
      }
    } catch (e) {
      console.error('Failed to load subcategory prefix map:', e);
    }
    return {};
  });

  const [unitsList, setUnitsList] = useState<{ label: string; value: string }[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.unitsList && Array.isArray(parsed.unitsList)) {
          return parsed.unitsList;
        }
      }
    } catch (e) {
      console.error('Failed to load units list:', e);
    }
    return STANDARD_UNITS;
  });

  const [gstSlabsList, setGstSlabsList] = useState<{ label: string; rate: number }[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.gstSlabsList && Array.isArray(parsed.gstSlabsList)) {
          return parsed.gstSlabsList;
        }
      }
    } catch (e) {
      console.error('Failed to load gst slabs:', e);
    }
    return GST_RATES;
  });

  const [paymentTermsOptions, setPaymentTermsOptions] = useState<{ label: string; value: string; days: number }[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.paymentTermsOptions && Array.isArray(parsed.paymentTermsOptions)) {
          return parsed.paymentTermsOptions;
        }
      }
    } catch (e) {
      console.error('Failed to load payment terms:', e);
    }
    return PAYMENT_TERMS_OPTIONS;
  });

  const [currentBranch, setCurrentBranch] = useState<BranchScope>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: StorageState = JSON.parse(saved);
        if (parsed.currentBranch) {
          if (currentUser.role === 'Manager') {
            return currentUser.assignedBranchId || 'coimbatore';
          }
          return parsed.currentBranch;
        }
      }
    } catch (e) {
      console.error('Failed to load currentBranch from storage:', e);
    }
    return currentUser.role === 'Manager' ? (currentUser.assignedBranchId || 'coimbatore') : 'all';
  });

  const [isAuthModalOpen, setAuthModalOpen] = useState(false);

  // Sync to localStorage
  useEffect(() => {
    try {
      const stateToSave: StorageState = {
        items,
        branchStocks,
        combos,
        stockAdjustmentLogs,
        estimates,
        challans,
        invoices,
        enquiries,
        pendingOrders,
        reminders,
        cashRegisters,
        recurringExpenses,
        vendors,
        purchaseOrders,
        employees,
        attendanceRecords,
        payrollSettings,
        payrollRecords,
        customers,
        loyaltySettings,
        categories,
        subcategoriesByCategory,
        categoryPrefixMap,
        subcategoryPrefixMap,
        unitsList,
        gstSlabsList,
        paymentTermsOptions,
        currentBranch,
        currentUser,
        currentView,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
    } catch (e) {
      console.error('Failed to persist to localStorage:', e);
    }
  }, [items, branchStocks, combos, stockAdjustmentLogs, estimates, challans, invoices, enquiries, pendingOrders, reminders, cashRegisters, recurringExpenses, vendors, purchaseOrders, employees, attendanceRecords, payrollSettings, payrollRecords, customers, loyaltySettings, categories, subcategoriesByCategory, categoryPrefixMap, subcategoryPrefixMap, unitsList, gstSlabsList, paymentTermsOptions, currentBranch, currentUser, currentView]);

  // Handle role-specific view constraints
  useEffect(() => {
    if (currentUser.role === 'Billing' && (currentView === 'dashboard' || currentView === 'purchases' || currentView === 'hrm' || currentView === 'reports')) {
      setCurrentView('items');
    }
    if (currentUser.role === 'Manager') {
      const managerBranch = currentUser.assignedBranchId || 'coimbatore';
      if (currentBranch !== managerBranch) {
        setCurrentBranch(managerBranch);
      }
    }
  }, [currentUser, currentView, currentBranch]);

  const isAllBranches = currentBranch === 'all';
  const currentBranchData = isAllBranches ? undefined : BRANCHES.find((b) => b.id === currentBranch);

  // Accessible branches based on role
  const accessibleBranches = currentUser.role === 'Manager'
    ? BRANCHES.filter((b) => b.id === (currentUser.assignedBranchId || 'coimbatore'))
    : BRANCHES;

  // Role Permissions
  const isReadOnly = currentUser.role === 'Billing';
  const canViewDashboard = currentUser.role === 'CEO' || currentUser.role === 'Manager';
  const canManageItems = currentUser.role === 'CEO' || currentUser.role === 'Manager';
  const canEditActiveBranchStock =
    currentUser.role === 'CEO' ||
    (currentUser.role === 'Manager' && currentUser.assignedBranchId === currentBranch);
  const canCancelEnquiry = currentUser.role === 'CEO' || currentUser.role === 'Manager';
  const canEditRestockDate = currentUser.role === 'CEO' || currentUser.role === 'Manager';
  const canCloseDay = currentUser.role === 'CEO' || currentUser.role === 'Manager';
  const canOverrideOpening = currentUser.role === 'CEO' || currentUser.role === 'Manager';
  const canManagePurchases = currentUser.role === 'CEO' || currentUser.role === 'Manager';
  const canViewHrm = currentUser.role === 'CEO' || currentUser.role === 'Manager';
  const canEditSalaries = currentUser.role === 'CEO';
  const canMarkPayrollPaid = currentUser.role === 'CEO';
  const canAdjustPayroll = currentUser.role === 'CEO';
  const canViewReports = currentUser.role === 'CEO' || currentUser.role === 'Manager';
  const canViewPayrollReport = currentUser.role === 'CEO';
  const canManageLoyalty = currentUser.role === 'CEO' || currentUser.role === 'Manager';
  const canManageCustomers = currentUser.role === 'CEO' || currentUser.role === 'Manager';

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

  const loginWithPin = (pin: string, customBranch?: BranchId): boolean => {
    const matched = PRESET_ROLES.find((r) => r.pin === pin);
    if (!matched) {
      toast.error('Invalid PIN code', {
        description: 'Try 1111 (CEO), 2222 (Manager), or 3333 (Billing)',
      });
      return false;
    }

    const assigned = matched.role === 'Manager' ? (customBranch || matched.defaultBranch || 'coimbatore') : undefined;
    const newSession: UserSession = {
      role: matched.role,
      name: matched.defaultName,
      pin: matched.pin,
      assignedBranchId: assigned,
    };
    setCurrentUser(newSession);

    if (matched.role === 'CEO') {
      setCurrentBranch('all');
      setCurrentView('dashboard');
    } else if (matched.role === 'Manager') {
      setCurrentBranch(assigned || 'coimbatore');
      setCurrentView('dashboard');
    } else {
      setCurrentBranch(assigned || 'erode-hq');
      setCurrentView('items'); // Billing lands on Item Master / Sales
    }

    toast.success(`Logged in as ${matched.role}`, {
      description: assigned ? `Assigned to: ${BRANCHES.find(b => b.id === assigned)?.name}` : 'Full access granted',
    });
    setAuthModalOpen(false);
    return true;
  };

  const switchRole = (role: Role, customBranch?: BranchId) => {
    const matched = PRESET_ROLES.find((r) => r.role === role);
    if (!matched) return;
    const assigned = role === 'Manager' ? (customBranch || matched.defaultBranch || 'coimbatore') : undefined;
    const newSession: UserSession = {
      role: matched.role,
      name: matched.defaultName,
      pin: matched.pin,
      assignedBranchId: assigned,
    };
    setCurrentUser(newSession);

    if (role === 'CEO') {
      setCurrentBranch('all');
      setCurrentView('dashboard');
    } else if (role === 'Manager') {
      setCurrentBranch(assigned || 'coimbatore');
      setCurrentView('dashboard');
    } else {
      setCurrentBranch(assigned || 'erode-hq');
      setCurrentView('items');
    }

    toast.success(`Role switched to ${role}`, {
      description: assigned ? `Assigned to ${BRANCHES.find(b => b.id === assigned)?.name}` : undefined,
    });
  };

  const logout = () => {
    setAuthModalOpen(true);
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

    const targetBranch = BRANCHES.find((b) => b.id === branchId);
    toast.success(`Shelf location updated to "${trimmed || 'Unassigned'}"`, {
      description: `Updated for ${targetBranch?.name || branchId}`,
    });
  };

  const deleteItem = (itemId: string) => {
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    setBranchStocks((prev) => prev.filter((s) => s.itemId !== itemId));
    setStockAdjustmentLogs((prev) => prev.filter((l) => l.itemId !== itemId));
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
    toast.success(`Combo bundle "${combo.comboName}" saved`);
  };

  const deleteCombo = (comboId: string) => {
    setCombos((prev) => prev.filter((c) => c.id !== comboId));
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

    const toStockRow = branchStocks.find((s) => s.itemId === itemId && s.branchId === toBranch);
    const toPrevQty = toStockRow?.quantity ?? 0;
    const now = new Date().toISOString();
    const transferRef = `TRF-${Date.now().toString(36).toUpperCase()}`;

    // 1. Atomic branch stock update: decrement fromBranch and increment toBranch
    setBranchStocks((prev) => {
      let updated = [...prev];

      // Decrement source
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

      // Increment destination
      const toIdx = updated.findIndex((s) => s.itemId === itemId && s.branchId === toBranch);
      if (toIdx >= 0) {
        updated[toIdx] = {
          ...updated[toIdx],
          quantity: updated[toIdx].quantity + quantity,
          updatedAt: now,
        };
      } else {
        updated.push({
          itemId,
          branchId: toBranch,
          quantity,
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

    // 3. Create Paired StockAdjustmentLog records with shared transferRef
    const userLabel = `${currentUser.name} (${currentUser.role})`;
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
      notes: `Transferred to ${toBranchName}${notes ? ` • ${notes}` : ''}`,
      adjustedBy: userLabel,
      timestamp: now,
      transferRef,
      linkedChallanNumber: generatedChallanNo,
    };

    const logTo: StockAdjustmentLog = {
      id: `adj-${Date.now()}-in`,
      itemId,
      itemName: targetItem.itemName,
      itemCode: targetItem.itemCode,
      branchId: toBranch,
      previousQuantity: toPrevQty,
      quantityChange: quantity,
      newQuantity: toPrevQty + quantity,
      reason: 'Inter-branch Transfer',
      notes: `Received from ${fromBranchName}${notes ? ` • ${notes}` : ''}`,
      adjustedBy: userLabel,
      timestamp: now,
      transferRef,
      linkedChallanNumber: generatedChallanNo,
    };

    setStockAdjustmentLogs((prev) => [logFrom, logTo, ...prev]);

    toast.success(`Inter-branch transfer completed`, {
      description: `${quantity} × ${targetItem.itemName} (${fromBranchName} → ${toBranchName})${generatedChallanNo ? ` • Challan ${generatedChallanNo} generated` : ''}`,
    });

    return { transferRef, challanNumber: generatedChallanNo };
  };

  const getNextEstimateNumber = (branchId: BranchId): string => {
    const branchCode = getBranchCodeForEstimate(branchId);
    const fy = getFinancialYear(new Date());
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

  const saveEstimate = (newEstimate: Estimate) => {
    setEstimates((prev) => {
      const existingIdx = prev.findIndex((e) => e.id === newEstimate.id);
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = newEstimate;
        return updated;
      }
      return [newEstimate, ...prev];
    });
    toast.success(`Estimate ${newEstimate.estimateNumber} saved`, {
      description: `For ${newEstimate.customerName} (₹${newEstimate.grandTotal.toLocaleString('en-IN')})`,
    });
  };

  const deleteEstimate = (estimateId: string) => {
    setEstimates((prev) => prev.filter((e) => e.id !== estimateId));
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
    toast.success(`Delivery Challan ${newChallan.challanNumber} saved`, {
      description: `For ${newChallan.recipientName} (${newChallan.totalQuantity} items)`,
    });
  };

  const deleteChallan = (challanId: string) => {
    setChallans((prev) => prev.filter((c) => c.id !== challanId));
    toast.success('Delivery Challan removed');
  };

  const getNextInvoiceNumber = (branchId: BranchId): string => {
    const branchCode = getBranchCodeForInvoice(branchId);
    const fy = getFinancialYear(new Date());
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
    expense: { reason: string; cashAmount: number; gpayAmount: number }
  ) => {
    if (isDayClosed(branchId, date)) {
      toast.error('Cannot add expense: Cash register for this day is already closed.');
      return;
    }

    const newExpense = {
      id: `exp-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      reason: expense.reason.trim(),
      cashAmount: Number(expense.cashAmount) || 0,
      gpayAmount: Number(expense.gpayAmount) || 0,
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
    toast.success('Expense entry deleted');
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
    toast.success('Recurring expense template updated');
  };

  const deleteRecurringExpenseTemplate = (id: string) => {
    if (!canManageItems) {
      toast.error('Only CEO or Manager can delete recurring expense templates.');
      return;
    }
    setRecurringExpenses((prev) => prev.filter((t) => t.id !== id));
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

    toast.success(`Approved "${template.name}" (₹${amount.toLocaleString('en-IN')}) into ${branchId} register`, {
      description: `Added to ${date} register via ${paymentMode}. Total expenses and closing balance updated.`,
    });
  };

  const saveCustomer = (customerData: Customer): { success: boolean; error?: string; customer?: Customer } => {
    const cleanPhone = (customerData.phone || '').trim().replace(/\D/g, '');
    if (!cleanPhone) {
      toast.error('Phone number is required');
      return { success: false, error: 'Phone number is required' };
    }
    if (!customerData.name.trim()) {
      toast.error('Customer name is required');
      return { success: false, error: 'Customer name is required' };
    }

    // Phone uniqueness check (prevent duplicate customer records)
    const duplicate = customers.find(
      (c) => c.id !== customerData.id && c.phone.trim().replace(/\D/g, '') === cleanPhone
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
    return { success: true, customer: savedCust };
  };

  const deleteCustomer = (customerId: string) => {
    setCustomers((prev) => prev.filter((c) => c.id !== customerId));
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

  const saveInvoice = (newInvoice: Invoice) => {
    // Prevent backdating into a closed register
    if (isDayClosed(newInvoice.branchId, newInvoice.date)) {
      toast.error('Cannot save invoice on a closed day', {
        description: `Daily cash register for ${newInvoice.date} at this branch is already closed. Please select an open date.`,
      });
      return;
    }

    const isNewSale = !invoices.some((inv) => inv.id === newInvoice.id);
    const invoicePhoneClean = (newInvoice.customerPhone || '').trim().replace(/\D/g, '');
    const now = new Date().toISOString();

    // Link / Update Customer Master
    setCustomers((prevCustomers) => {
      let custIdx = -1;
      if (newInvoice.customerId) {
        custIdx = prevCustomers.findIndex((c) => c.id === newInvoice.customerId);
      }
      if (custIdx === -1 && invoicePhoneClean) {
        custIdx = prevCustomers.findIndex(
          (c) => c.phone.trim().replace(/\D/g, '') === invoicePhoneClean
        );
      }
      if (custIdx === -1 && newInvoice.customerName.trim()) {
        custIdx = prevCustomers.findIndex(
          (c) => c.name.trim().toLowerCase() === newInvoice.customerName.trim().toLowerCase()
        );
      }

      const updatedCusts = [...prevCustomers];
      if (custIdx >= 0) {
        const existing = updatedCusts[custIdx];
        newInvoice.customerId = existing.id;
        const oldInvoice = invoices.find((inv) => inv.id === newInvoice.id);
        const oldSpent = oldInvoice ? oldInvoice.grandTotal : 0;
        const newCount = isNewSale ? (existing.purchaseCount || 0) + 1 : existing.purchaseCount;
        const newSpent = Math.max(0, (existing.totalSpent || 0) - oldSpent + newInvoice.grandTotal);

        updatedCusts[custIdx] = {
          ...existing,
          name: newInvoice.customerName || existing.name,
          phone: newInvoice.customerPhone || existing.phone,
          address: newInvoice.customerAddress || existing.address,
          purchaseCount: newCount,
          totalSpent: newSpent,
          firstPurchaseDate: existing.firstPurchaseDate || newInvoice.date,
          lastRewardRedeemedPurchaseCount: newInvoice.isLoyaltyRewardApplied
            ? newCount
            : existing.lastRewardRedeemedPurchaseCount,
          updatedAt: now,
        };
      } else if (newInvoice.customerName.trim()) {
        const newCustId = `cust-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        newInvoice.customerId = newCustId;
        const newCust: Customer = {
          id: newCustId,
          name: newInvoice.customerName.trim(),
          phone: newInvoice.customerPhone || '',
          address: newInvoice.customerAddress || '',
          firstPurchaseDate: newInvoice.date,
          purchaseCount: 1,
          totalSpent: newInvoice.grandTotal,
          lastRewardRedeemedPurchaseCount: newInvoice.isLoyaltyRewardApplied ? 1 : undefined,
          notes: 'Auto-created from Sale',
          createdAt: now,
          updatedAt: now,
        };
        updatedCusts.unshift(newCust);
      }
      return updatedCusts;
    });

    setInvoices((prevInvoices) => {
      const existingIdx = prevInvoices.findIndex((inv) => inv.id === newInvoice.id);
      const oldInvoice = existingIdx >= 0 ? prevInvoices[existingIdx] : null;

      // Decrement BranchStock for the invoice's branch by the billed quantity
      setBranchStocks((prevStocks) => {
        const updatedStocks = [...prevStocks];

        // If editing an existing invoice, restore previous quantities first
        if (oldInvoice) {
          oldInvoice.items.forEach((oldItem) => {
            if (oldItem.isCombo && oldItem.comboComponents && oldItem.comboComponents.length > 0) {
              // Restore each component of the old combo
              oldItem.comboComponents.forEach((comp) => {
                const compQtyToRestore = comp.quantity * (oldItem.quantity || 0);
                const idx = updatedStocks.findIndex(
                  (s) => s.itemId === comp.itemId && s.branchId === oldInvoice.branchId
                );
                if (idx >= 0) {
                  updatedStocks[idx] = {
                    ...updatedStocks[idx],
                    quantity: updatedStocks[idx].quantity + compQtyToRestore,
                    updatedAt: new Date().toISOString(),
                  };
                }
              });
            } else if (oldItem.itemId) {
              const idx = updatedStocks.findIndex(
                (s) => s.itemId === oldItem.itemId && s.branchId === oldInvoice.branchId
              );
              if (idx >= 0) {
                updatedStocks[idx] = {
                  ...updatedStocks[idx],
                  quantity: updatedStocks[idx].quantity + (oldItem.quantity || 0),
                  updatedAt: new Date().toISOString(),
                };
              }
            }
          });
        }

        // Decrement physical stock for current invoice items
        newInvoice.items.forEach((newItem) => {
          if (newItem.isCombo && newItem.comboComponents && newItem.comboComponents.length > 0) {
            // Combo item: decrement EACH component's BranchStock by componentQty × comboQtySold
            newItem.comboComponents.forEach((comp) => {
              const compQtyToDeduct = comp.quantity * (newItem.quantity || 0);
              const idx = updatedStocks.findIndex(
                (s) => s.itemId === comp.itemId && s.branchId === newInvoice.branchId
              );
              if (idx >= 0) {
                updatedStocks[idx] = {
                  ...updatedStocks[idx],
                  quantity: Math.max(0, updatedStocks[idx].quantity - compQtyToDeduct),
                  updatedAt: new Date().toISOString(),
                };
              } else {
                updatedStocks.push({
                  itemId: comp.itemId,
                  branchId: newInvoice.branchId,
                  quantity: 0,
                  updatedAt: new Date().toISOString(),
                });
              }
            });
          } else if (newItem.itemId) {
            const idx = updatedStocks.findIndex(
              (s) => s.itemId === newItem.itemId && s.branchId === newInvoice.branchId
            );
            if (idx >= 0) {
              updatedStocks[idx] = {
                ...updatedStocks[idx],
                quantity: Math.max(0, updatedStocks[idx].quantity - (newItem.quantity || 0)),
                updatedAt: new Date().toISOString(),
              };
            } else {
              updatedStocks.push({
                itemId: newItem.itemId,
                branchId: newInvoice.branchId,
                quantity: 0,
                updatedAt: new Date().toISOString(),
              });
            }
          }
        });

        return updatedStocks;
      });

      if (existingIdx >= 0) {
        const updated = [...prevInvoices];
        updated[existingIdx] = newInvoice;
        return updated;
      }
      return [newInvoice, ...prevInvoices];
    });

    toast.success(`Invoice ${newInvoice.invoiceNumber} saved & stock decremented`, {
      description: `${newInvoice.customerName} • ₹${newInvoice.grandTotal.toLocaleString('en-IN')} [${newInvoice.paymentMode}]`,
    });
  };

  const deleteInvoice = (invoiceId: string) => {
    const inv = invoices.find((i) => i.id === invoiceId);
    if (inv) {
      // Restore physical stock when deleting an invoice
      setBranchStocks((prevStocks) => {
        const updatedStocks = [...prevStocks];
        inv.items.forEach((item) => {
          if (item.isCombo && item.comboComponents && item.comboComponents.length > 0) {
            item.comboComponents.forEach((comp) => {
              const compQtyToRestore = comp.quantity * (item.quantity || 0);
              const idx = updatedStocks.findIndex(
                (s) => s.itemId === comp.itemId && s.branchId === inv.branchId
              );
              if (idx >= 0) {
                updatedStocks[idx] = {
                  ...updatedStocks[idx],
                  quantity: updatedStocks[idx].quantity + compQtyToRestore,
                  updatedAt: new Date().toISOString(),
                };
              }
            });
          } else if (item.itemId) {
            const idx = updatedStocks.findIndex(
              (s) => s.itemId === item.itemId && s.branchId === inv.branchId
            );
            if (idx >= 0) {
              updatedStocks[idx] = {
                ...updatedStocks[idx],
                quantity: updatedStocks[idx].quantity + (item.quantity || 0),
                updatedAt: new Date().toISOString(),
              };
            }
          }
        });
        return updatedStocks;
      });
    }

    setInvoices((prev) => prev.filter((i) => i.id !== invoiceId));
    toast.success('Invoice deleted & stock restored');
  };

  const voidInvoice = (invoiceId: string, reason: string) => {
    const inv = invoices.find((i) => i.id === invoiceId);
    if (!inv) {
      toast.error('Sale record not found.');
      return;
    }
    if (inv.isVoided) {
      toast.error('This sale is already voided.');
      return;
    }

    const timestamp = new Date().toISOString();
    const newLogs: StockAdjustmentLog[] = [];

    // 1. Calculate remaining items to restore (accounting for any partial returns already processed)
    setBranchStocks((prevStocks) => {
      const updatedStocks = [...prevStocks];

      inv.items.forEach((item) => {
        if (item.isCombo && item.comboComponents && item.comboComponents.length > 0) {
          // Calculate already returned qty for this combo line
          const alreadyReturnedQty = (inv.returns || [])
            .filter((r) => r.id === item.id || (item.comboId && r.comboId === item.comboId))
            .reduce((sum, r) => sum + (r.returnedQuantity || 0), 0);

          const comboQtyToRestore = Math.max(0, item.quantity - alreadyReturnedQty);
          if (comboQtyToRestore <= 0) return;

          item.comboComponents.forEach((comp) => {
            const qtyToRestore = comp.quantity * comboQtyToRestore;
            if (qtyToRestore <= 0) return;

            const idx = updatedStocks.findIndex(
              (s) => s.itemId === comp.itemId && s.branchId === inv.branchId
            );
            const prevQty = idx >= 0 ? updatedStocks[idx].quantity : 0;
            const newQty = prevQty + qtyToRestore;

            if (idx >= 0) {
              updatedStocks[idx] = {
                ...updatedStocks[idx],
                quantity: newQty,
                updatedAt: timestamp,
              };
            } else {
              updatedStocks.push({
                itemId: comp.itemId,
                branchId: inv.branchId,
                quantity: newQty,
                updatedAt: timestamp,
              });
            }

            const compItem = items.find((i) => i.id === comp.itemId);

            newLogs.push({
              id: `adj-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              itemId: comp.itemId,
              itemName: compItem?.itemName || 'Component Item',
              itemCode: compItem?.itemCode || '',
              branchId: inv.branchId,
              previousQuantity: prevQty,
              quantityChange: qtyToRestore,
              newQuantity: newQty,
              reason: 'Voided Sale',
              notes: `Voided Sale #${inv.invoiceNumber} (Component of Combo: ${item.itemName}) - Reason: ${reason || 'Cancellation'}`,
              adjustedBy: currentUser.name,
              timestamp,
            });
          });
        } else if (item.itemId) {
          // Regular line item
          const alreadyReturnedQty = (inv.returns || [])
            .filter((r) => r.itemId === item.itemId)
            .reduce((sum, r) => sum + (r.returnedQuantity || 0), 0);

          const qtyToRestore = Math.max(0, item.quantity - alreadyReturnedQty);
          if (qtyToRestore <= 0) return;

          const idx = updatedStocks.findIndex(
            (s) => s.itemId === item.itemId && s.branchId === inv.branchId
          );
          const prevQty = idx >= 0 ? updatedStocks[idx].quantity : 0;
          const newQty = prevQty + qtyToRestore;

          if (idx >= 0) {
            updatedStocks[idx] = {
              ...updatedStocks[idx],
              quantity: newQty,
              updatedAt: timestamp,
            };
          } else {
            updatedStocks.push({
              itemId: item.itemId,
              branchId: inv.branchId,
              quantity: newQty,
              updatedAt: timestamp,
            });
          }

          newLogs.push({
            id: `adj-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            itemId: item.itemId,
            itemName: item.itemName,
            itemCode: item.itemCode || '',
            branchId: inv.branchId,
            previousQuantity: prevQty,
            quantityChange: qtyToRestore,
            newQuantity: newQty,
            reason: 'Voided Sale',
            notes: `Voided Sale #${inv.invoiceNumber} - Reason: ${reason || 'Cancellation'}`,
            adjustedBy: currentUser.name,
            timestamp,
          });
        }
      });

      return updatedStocks;
    });

    // 2. Add logs
    if (newLogs.length > 0) {
      setStockAdjustmentLogs((prev) => [...newLogs, ...prev]);
    }

    // 3. Mark the sale record as voided (do NOT delete!)
    setInvoices((prev) =>
      prev.map((i) =>
        i.id === invoiceId
          ? {
              ...i,
              isVoided: true,
              voidReason: reason || 'Cancelled / Voided',
              voidedAt: timestamp,
              voidedBy: currentUser.name,
              updatedAt: timestamp,
            }
          : i
      )
    );

    // 4. Decrement Customer purchase count & total spent
    if (inv.customerId || inv.customerPhone) {
      const phoneClean = (inv.customerPhone || '').trim().replace(/\D/g, '');
      setCustomers((prev) =>
        prev.map((c) => {
          if (c.id === inv.customerId || (phoneClean && c.phone.trim().replace(/\D/g, '') === phoneClean)) {
            return {
              ...c,
              purchaseCount: Math.max(0, (c.purchaseCount || 1) - 1),
              totalSpent: Math.max(0, (c.totalSpent || 0) - inv.grandTotal),
              updatedAt: timestamp,
            };
          }
          return c;
        })
      );
    }

    const branchObj = BRANCHES.find((b) => b.id === inv.branchId);
    toast.success(`Sale #${inv.invoiceNumber} has been voided`, {
      description: `Physical stock reversed to ${branchObj?.name || 'warehouse'}. Excluded from cash tallies & reports.`,
    });
  };

  const processSaleReturn = (
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

    const timestamp = new Date().toISOString();
    const newLogs: StockAdjustmentLog[] = [];
    const returnRecords: SaleReturnLineItem[] = [];

    // 1. Restore stock for returned lines
    setBranchStocks((prevStocks) => {
      const updatedStocks = [...prevStocks];

      validLines.forEach((line) => {
        if (line.isCombo && line.comboComponents && line.comboComponents.length > 0) {
          // Restore EACH component proportionally by comp.quantity * line.returnQty
          line.comboComponents.forEach((comp) => {
            const compQtyToRestore = comp.quantity * line.returnQty;
            const idx = updatedStocks.findIndex(
              (s) => s.itemId === comp.itemId && s.branchId === inv.branchId
            );
            const prevQty = idx >= 0 ? updatedStocks[idx].quantity : 0;
            const newQty = prevQty + compQtyToRestore;

            if (idx >= 0) {
              updatedStocks[idx] = {
                ...updatedStocks[idx],
                quantity: newQty,
                updatedAt: timestamp,
              };
            } else {
              updatedStocks.push({
                itemId: comp.itemId,
                branchId: inv.branchId,
                quantity: newQty,
                updatedAt: timestamp,
              });
            }

            const compItem = items.find((i) => i.id === comp.itemId);

            newLogs.push({
              id: `adj-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              itemId: comp.itemId,
              itemName: compItem?.itemName || 'Component Item',
              itemCode: compItem?.itemCode || '',
              branchId: inv.branchId,
              previousQuantity: prevQty,
              quantityChange: compQtyToRestore,
              newQuantity: newQty,
              reason: 'Sales Return',
              notes: `Sales Return on #${inv.invoiceNumber} (Component of Combo: ${line.itemName}) - ${reason}${notes ? ` (${notes})` : ''}`,
              adjustedBy: currentUser.name,
              timestamp,
            });
          });

          returnRecords.push({
            id: `ret-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            itemId: line.itemId,
            itemCode: line.itemCode,
            itemName: line.itemName,
            returnedQuantity: line.returnQty,
            unitPrice: line.unitPrice,
            taxRate: line.taxRate,
            refundAmount: line.refundAmount,
            returnedAt: timestamp,
            reason,
            notes,
            processedBy: currentUser.name,
            isCombo: true,
            comboId: line.comboId,
            comboComponents: line.comboComponents,
          });
        } else {
          // Regular product line
          const idx = updatedStocks.findIndex(
            (s) => s.itemId === line.itemId && s.branchId === inv.branchId
          );
          const prevQty = idx >= 0 ? updatedStocks[idx].quantity : 0;
          const newQty = prevQty + line.returnQty;

          if (idx >= 0) {
            updatedStocks[idx] = {
              ...updatedStocks[idx],
              quantity: newQty,
              updatedAt: timestamp,
            };
          } else {
            updatedStocks.push({
              itemId: line.itemId,
              branchId: inv.branchId,
              quantity: newQty,
              updatedAt: timestamp,
            });
          }

          newLogs.push({
            id: `adj-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            itemId: line.itemId,
            itemName: line.itemName,
            itemCode: line.itemCode,
            branchId: inv.branchId,
            previousQuantity: prevQty,
            quantityChange: line.returnQty,
            newQuantity: newQty,
            reason: 'Sales Return',
            notes: `Sales Return on #${inv.invoiceNumber} - ${reason}${notes ? ` (${notes})` : ''}`,
            adjustedBy: currentUser.name,
            timestamp,
          });

          returnRecords.push({
            id: `ret-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            itemId: line.itemId,
            itemCode: line.itemCode,
            itemName: line.itemName,
            returnedQuantity: line.returnQty,
            unitPrice: line.unitPrice,
            taxRate: line.taxRate,
            refundAmount: line.refundAmount,
            returnedAt: timestamp,
            reason,
            notes,
            processedBy: currentUser.name,
          });
        }
      });

      return updatedStocks;
    });

    // 2. Append adjustment logs
    if (newLogs.length > 0) {
      setStockAdjustmentLogs((prev) => [...newLogs, ...prev]);
    }

    // 3. Update invoice with return details
    const totalRefund = returnRecords.reduce((sum, r) => sum + r.refundAmount, 0);
    const totalUnitsReturned = returnRecords.reduce((sum, r) => sum + r.returnedQuantity, 0);

    setInvoices((prev) =>
      prev.map((i) => {
        if (i.id !== invoiceId) return i;
        const existingReturns = i.returns || [];
        const newTotalReturned = (i.totalReturnedAmount || 0) + totalRefund;
        return {
          ...i,
          returns: [...existingReturns, ...returnRecords],
          totalReturnedAmount: newTotalReturned,
          updatedAt: timestamp,
        };
      })
    );

    toast.success(`Return processed for ${totalUnitsReturned} unit(s)`, {
      description: `Refund value ₹${totalRefund.toLocaleString('en-IN')}. Stock incremented in ${inv.branchId}.`,
    });
  };

  // Restock Monitoring: Detect when branch stock increases to satisfy Waiting pending orders
  useEffect(() => {
    setPendingOrders((prevOrders) => {
      let hasUpdates = false;
      const updated = prevOrders.map((order) => {
        if (order.status !== 'Waiting') return order;
        const stockRow = branchStocks.find(
          (s) => s.itemId === order.itemId && s.branchId === order.branchId
        );
        const currentQty = stockRow?.quantity ?? 0;
        if (currentQty >= order.quantityNeeded) {
          hasUpdates = true;
          toast.success(`Stock Arrived for Pending Order ${order.orderNumber}!`, {
            description: `${order.itemName} now has ${currentQty} ${order.unit} at ${order.branchId}. Ready to convert for ${order.customerName}!`,
          });
          return {
            ...order,
            status: 'Stock Arrived' as const,
            updatedAt: new Date().toISOString(),
          };
        }
        return order;
      });
      return hasUpdates ? updated : prevOrders;
    });
  }, [branchStocks]);

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
    toast.success('Reminder marked as completed');
  };

  const deleteFollowUpReminder = (reminderId: string) => {
    setReminders((prev) => prev.filter((r) => r.id !== reminderId));
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

    setEstimateToConvert(preFilledEstimate);
    if (targetType === 'estimate') {
      setCurrentView('estimates');
    } else {
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
    toast.info(`Purchase Order marked Cancelled`);
  };

  const receivePurchaseOrderStock = (
    poId: string,
    receipts: { itemId: string; quantityReceived: number; location?: string }[],
    notes?: string
  ) => {
    const po = purchaseOrders.find((p) => p.id === poId);
    if (!po) {
      toast.error('Purchase order not found');
      return;
    }

    const validReceipts = receipts.filter((r) => r.quantityReceived > 0);
    if (validReceipts.length === 0) {
      toast.error('No items to receive (quantity must be greater than 0)');
      return;
    }

    // 1. Update PO items receivedQuantity
    const updatedLines = po.items.map((line) => {
      const rec = validReceipts.find((r) => r.itemId === line.itemId);
      if (!rec) return line;
      return {
        ...line,
        receivedQuantity: (line.receivedQuantity || 0) + rec.quantityReceived,
      };
    });

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

    const updatedPo: PurchaseOrder = {
      ...po,
      items: updatedLines,
      status: newStatus,
      receivingHistory: [newReceivingEvent, ...(po.receivingHistory || [])],
      updatedAt: new Date().toISOString(),
    };

    setPurchaseOrders((prev) => prev.map((p) => (p.id === poId ? updatedPo : p)));

    // Sync selected PO for detail if open
    setSelectedPurchaseOrderForDetail((current) => {
      if (!current || current.id !== poId) return current;
      return updatedPo;
    });

    // 3. Increment physical stock in branchStocks for po.branchId
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

    const totalQty = validReceipts.reduce((sum, r) => sum + r.quantityReceived, 0);
    toast.success(`Received ${totalQty} units into ${po.branchId.toUpperCase()} stock`, {
      description: `Physical stock updated. PO status is now ${newStatus}.`,
    });
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
      toast.success(`Employee "${newEmp.name}" enrolled`);
      return newEmp;
    }
  };

  const deleteEmployee = (employeeId: string) => {
    const emp = employees.find((e) => e.id === employeeId);
    setEmployees((prev) => prev.filter((e) => e.id !== employeeId));
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
    toast.success(`Adjustment of ₹${adjustment > 0 ? '+' : ''}${adjustment} applied`);
  };

  const markPayrollPaid = (
    payrollId: string,
    paymentMode: 'Cash' | 'Bank Transfer',
    paymentReference?: string
  ) => {
    setPayrollRecords((prev) =>
      prev.map((p) => {
        if (p.id === payrollId) {
          return {
            ...p,
            status: 'Paid',
            paidAt: new Date().toISOString(),
            paymentMode,
            paymentReference,
            updatedAt: new Date().toISOString(),
          };
        }
        return p;
      })
    );
    toast.success('Payroll disbursement marked as Paid', {
      description: `Mode: ${paymentMode} ${paymentReference ? `(${paymentReference})` : ''}`,
    });
  };

  const resetToDemoData = () => {
    setItems(INITIAL_ITEMS);
    setBranchStocks(INITIAL_BRANCH_STOCKS);
    setEstimates(INITIAL_ESTIMATES);
    setChallans(INITIAL_CHALLANS);
    setInvoices(INITIAL_INVOICES);
    setEnquiries(INITIAL_ENQUIRIES);
    setPendingOrders(INITIAL_PENDING_ORDERS);
    setCashRegisters(INITIAL_DAILY_CASH_REGISTERS);
    setVendors(INITIAL_VENDORS);
    setPurchaseOrders(INITIAL_PURCHASE_ORDERS);
    setEmployees(INITIAL_EMPLOYEES);
    setAttendanceRecords(INITIAL_ATTENDANCE_RECORDS);
    setPayrollSettings(INITIAL_PAYROLL_SETTINGS);
    setPayrollRecords(INITIAL_PAYROLL_RECORDS);
    setStockAdjustmentLogs(INITIAL_STOCK_ADJUSTMENT_LOGS);
    setReminders(INITIAL_REMINDERS);
    setRecurringExpenses(INITIAL_RECURRING_EXPENSE_TEMPLATES);
    setCategories(INITIAL_CATEGORIES);
    setSubcategoriesByCategory(INITIAL_SUBCATEGORIES);
    setCategoryPrefixMap({});
    setSubcategoryPrefixMap({});
    setUnitsList(STANDARD_UNITS);
    setGstSlabsList(GST_RATES);
    setPaymentTermsOptions(PAYMENT_TERMS_OPTIONS);
    setCombos(INITIAL_COMBOS);
    setCustomers(INITIAL_CUSTOMERS);
    setLoyaltySettings(INITIAL_LOYALTY_SETTINGS);
    setCurrentBranch('all');
    setCurrentView('dashboard');
    setCurrentUser({
      role: 'CEO',
      name: 'Sathish Kumar (CEO)',
      pin: '1111',
    });
    localStorage.removeItem(STORAGE_KEY);
    toast.success('Demo data restored to initial state');
  };

  return (
    <ErpContext.Provider
      value={{
        currentView,
        setCurrentView,
        currentBranch,
        isAllBranches,
        currentBranchData,
        switchBranch,
        accessibleBranches,
        currentUser,
        loginWithPin,
        switchRole,
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
        deleteInvoice,
        voidInvoice,
        processSaleReturn,
        getNextInvoiceNumber,
        estimateToConvert,
        setEstimateToConvert,
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
      {children}
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
