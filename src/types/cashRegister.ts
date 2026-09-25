import { BranchId } from './index';

export interface CashExpense {
  id: string;
  reason: string;
  category?: string; // Expense category (built-in list + custom)
  billUrl?: string; // Uploaded bill/receipt (data URL) — optional proof of expense
  cashAmount: number;
  gpayAmount: number;
  // Approval workflow — used for categories like "Deposit to Bank". A pending entry
  // does NOT reduce the cash drawer until a Manager/CEO approves it.
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  approvedBy?: string;
  approvedAt?: string;
  createdBy: string;
  createdAt: string;
}

/** Category name for cash taken out of the drawer and deposited to the bank. */
export const BANK_DEPOSIT_CATEGORY = 'Deposit to Bank';

/** Expense categories that require Manager/CEO approval before they hit the drawer. */
export const APPROVAL_REQUIRED_CATEGORIES: string[] = [BANK_DEPOSIT_CATEGORY];

export const expenseNeedsApproval = (category?: string): boolean =>
  !!category && APPROVAL_REQUIRED_CATEGORIES.includes(category);

/** An expense reduces the drawer only when it is NOT waiting on / rejected by approval. */
export const expenseIsEffective = (e: CashExpense): boolean =>
  e.approvalStatus == null || e.approvalStatus === 'approved';

/** Built-in daily-expense categories (staff can also type a custom one). */
export const EXPENSE_CATEGORIES: string[] = [
  'Rent',
  'Salary / Wages',
  'Electricity',
  'Water',
  'Internet / Phone',
  'Transport / Fuel',
  'Packing / Supplies',
  'Tea / Snacks',
  'Repairs / Maintenance',
  'Stationery / Printing',
  'Marketing',
  'Bank / Charges',
  BANK_DEPOSIT_CATEGORY,
  'Miscellaneous',
];

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

export type ExpenseFrequency = 'Monthly' | 'Quarterly' | 'Half-Yearly' | 'Yearly';

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
  frequency: ExpenseFrequency;
  startMonth?: number; // 1 to 12 (Jan=1, ..., Dec=12) for Quarterly, Half-Yearly, Yearly
  dueDay: number; // 1 to 31 (e.g. 5 for 5th of month)
  paymentMode: 'Cash' | 'GPay';
  createdAt: string;
  lastApprovedMonth?: string; // e.g. "2026-09"
  approvalHistory?: RecurringExpenseApproval[];
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const MONTH_SHORT_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export function getOrdinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'th';
  switch (day % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

/**
 * Checks if a scheduled expense is due in the specified month (1-12).
 * - Monthly: every month
 * - Quarterly: starting at startMonth, every 3 months
 * - Half-Yearly: starting at startMonth, every 6 months
 * - Yearly: only in startMonth
 */
export function isExpenseDueInMonth(
  template: RecurringExpenseTemplate,
  monthNumber: number // 1 to 12
): boolean {
  const freq = template.frequency || 'Monthly';
  const startMonth = template.startMonth || 1;

  switch (freq) {
    case 'Monthly':
      return true;
    case 'Quarterly':
      return ((monthNumber - startMonth) % 3 + 12) % 3 === 0;
    case 'Half-Yearly':
      return ((monthNumber - startMonth) % 6 + 12) % 6 === 0;
    case 'Yearly':
      return monthNumber === startMonth;
    default:
      return true;
  }
}

/**
 * Checks if a template was already approved for a given monthKey ("YYYY-MM").
 */
export function isExpenseApprovedForMonth(
  template: RecurringExpenseTemplate,
  monthKey: string
): boolean {
  return (
    template.lastApprovedMonth === monthKey ||
    Boolean(template.approvalHistory?.some((a) => a.month === monthKey))
  );
}

/**
 * Formats the schedule description for display in tables and cards.
 * E.g.: "Yearly — due every March 5th", "Monthly — due every 5th"
 */
export function formatExpenseSchedule(template: RecurringExpenseTemplate): string {
  const freq = template.frequency || 'Monthly';
  const startMonth = template.startMonth || 1;
  const monthName = MONTH_NAMES[startMonth - 1] || 'January';
  const day = template.dueDay;
  const suffix = getOrdinalSuffix(day);

  switch (freq) {
    case 'Monthly':
      return `Monthly — due every ${day}${suffix}`;
    case 'Quarterly': {
      const m1 = MONTH_NAMES[startMonth - 1]?.slice(0, 3);
      const m2 = MONTH_NAMES[((startMonth - 1 + 3) % 12)]?.slice(0, 3);
      const m3 = MONTH_NAMES[((startMonth - 1 + 6) % 12)]?.slice(0, 3);
      const m4 = MONTH_NAMES[((startMonth - 1 + 9) % 12)]?.slice(0, 3);
      return `Quarterly — due ${m1}, ${m2}, ${m3}, ${m4} ${day}${suffix}`;
    }
    case 'Half-Yearly': {
      const m1 = MONTH_NAMES[startMonth - 1]?.slice(0, 3);
      const m2 = MONTH_NAMES[((startMonth - 1 + 6) % 12)]?.slice(0, 3);
      return `Half-Yearly — due ${m1} & ${m2} ${day}${suffix}`;
    }
    case 'Yearly':
      return `Yearly — due every ${monthName} ${day}${suffix}`;
    default:
      return `Monthly — due every ${day}${suffix}`;
  }
}


