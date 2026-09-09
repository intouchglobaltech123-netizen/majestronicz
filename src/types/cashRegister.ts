import { BranchId } from './index';

export interface CashExpense {
  id: string;
  reason: string;
  cashAmount: number;
  gpayAmount: number;
  createdBy: string;
  createdAt: string;
}

export interface DailyCashRegister {
  id: string;
  branchId: BranchId;
  date: string; // YYYY-MM-DD
  openingAmount: number;
  isOpeningOverridden?: boolean;
  overrideReason?: string;
  expenses: CashExpense[];
  isClosed: boolean;
  closedAt?: string;
  closedBy?: string;
  closingNotes?: string;
}

export interface DailyCashSalesSummary {
  hdfcTotal: number;
  cashTotal: number;
  gpayTotal: number;
  codCreditTotal: number;
  grandTotalSales: number;
  invoiceCount: number;
  partialPaymentCount: number;
}

export interface DailyCashExpenseSummary {
  cashExpensesTotal: number;
  gpayExpensesTotal: number;
  totalExpenses: number;
  expenseCount: number;
}

export interface DailyCashClosingCalculation {
  openingAmount: number;
  cashSales: number;
  cashExpenses: number;
  closingBalance: number; // Opening + cashSales - cashExpenses (Physical drawer count)
  totalDayRevenue: number; // All payment modes combined
  bankDigitalTotal: number; // HDFC + GPay sales
  creditTotal: number; // COD/Credit sales
}

export interface RecurringExpenseApproval {
  id: string;
  month: string; // e.g. "2026-09"
  date: string; // Register date, e.g. "2026-09-09"
  approvedAt: string; // ISO string
  approvedBy: string;
  actualAmount: number;
  paymentMode: 'Cash' | 'GPay';
  cashExpenseId: string;
}

export interface RecurringExpenseTemplate {
  id: string;
  name: string; // e.g. "Showroom Rent", "EB Electricity Bill"
  defaultAmount: number;
  branchId: BranchId;
  frequency: 'Monthly';
  dueDay: number; // 1 to 31 (e.g. 5 for 5th of each month)
  paymentMode: 'Cash' | 'GPay';
  createdAt: string;
  lastApprovedMonth?: string; // e.g. "2026-09"
  approvalHistory?: RecurringExpenseApproval[];
}

