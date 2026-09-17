import React, { useState, useMemo, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import { BranchId, BRANCHES, isExpenseDueInMonth, isExpenseApprovedForMonth, getInvoicePaymentSplits } from '../../types';
import { getTodayDateString, getYesterdayDateString } from '../../lib/utils';
import { DailyCashSummaryCards } from './DailyCashSummaryCards';
import { DailyCashSalesTable } from './DailyCashSalesTable';
import { DailyCashExpensesTable } from './DailyCashExpensesTable';
import { OverrideOpeningModal } from './OverrideOpeningModal';
import { CloseDayConfirmModal } from './CloseDayConfirmModal';
import { DailyCashHistoryModal } from './DailyCashHistoryModal';
import { RecurringExpenseBanner } from './RecurringExpenseBanner';
import { ApproveRecurringExpenseModal } from './ApproveRecurringExpenseModal';
import { RecurringExpensesManagement } from './RecurringExpensesManagement';
import { RecurringExpenseTemplate } from '../../types';
import {
  WalletCards,
  Calendar,
  Building,
  Lock,
  Unlock,
  History,
  RotateCcw,
  Printer,
} from 'lucide-react';
import { toast } from 'sonner';

export const DailyCashRegisterView: React.FC = () => {
  const {
    currentUser,
    currentBranch,
    isAllBranches,
    switchBranch,
    invoices,
    cashRegisters,
    getDailyCashRegister,
    addCashExpense,
    deleteCashExpense,
    overrideOpeningAmount,
    closeDailyRegister,
    reopenDailyRegister,
    canCloseDay,
    canOverrideOpening,
    canManageItems,
    recurringExpenses,
  } = useErp();

  // Dynamic system dates
  const todayStr = useMemo(() => getTodayDateString(), []);
  const yesterdayStr = useMemo(() => getYesterdayDateString(), []);

  // Date selection (Defaults to live dynamic today)
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

  // Specific branch for the cash register drawer
  const [activeBranchId, setActiveBranchId] = useState<BranchId>(() => {
    if (!isAllBranches && currentBranch !== 'all') return currentBranch as BranchId;
    return 'erode-hq';
  });

  // Keep branch in sync if global branch switcher is toggled to a specific branch
  useEffect(() => {
    if (!isAllBranches && currentBranch !== 'all') {
      setActiveBranchId(currentBranch as BranchId);
    }
  }, [currentBranch, isAllBranches]);

  // Modals state
  const [isOverrideModalOpen, setIsOverrideModalOpen] = useState(false);
  const [isCloseDayModalOpen, setIsCloseDayModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);

  // Sub-view: 'register' (Daily Drawer) | 'recurring' (Recurring Expense Templates Setup)
  const [activeSubView, setActiveSubView] = useState<'register' | 'recurring'>('register');
  const [approvingTemplate, setApprovingTemplate] = useState<RecurringExpenseTemplate | null>(null);

  // Pending scheduled expenses count for badge (frequency aware)
  const pendingRecurringCount = useMemo(() => {
    const monthKey = selectedDate.substring(0, 7);
    const monthNumber = parseInt(selectedDate.split('-')[1], 10);
    const day = parseInt(selectedDate.split('-')[2], 10);
    return recurringExpenses.filter((t) => {
      if (t.branchId !== activeBranchId) return false;
      if (!isExpenseDueInMonth(t, monthNumber)) return false;
      if (isExpenseApprovedForMonth(t, monthKey)) return false;
      return day >= t.dueDay;
    }).length;
  }, [recurringExpenses, activeBranchId, selectedDate]);

  // Current Register Record for (activeBranchId, selectedDate)
  const currentRegister = useMemo(() => {
    return getDailyCashRegister(activeBranchId, selectedDate);
  }, [getDailyCashRegister, activeBranchId, selectedDate, cashRegisters]);

  // Invoices for selected branch and date (excluding voided sales)
  const dayInvoices = useMemo(() => {
    return invoices.filter(
      (inv) => inv.branchId === activeBranchId && inv.date === selectedDate && !inv.isVoided
    );
  }, [invoices, activeBranchId, selectedDate]);

  // Sales Totals — Reconcile Per Split Entry
  const salesBreakdown = useMemo(() => {
    return dayInvoices.reduce(
      (acc, inv) => {
        const splits = getInvoicePaymentSplits(inv);
        const returned = inv.totalReturnedAmount || 0;
        const netTotal = Math.max(0, inv.grandTotal - returned);
        const ratio = inv.grandTotal > 0 ? netTotal / inv.grandTotal : 1;

        splits.forEach((split) => {
          const amt = split.amount * ratio;
          if (split.mode === 'HDFC') acc.hdfc += amt;
          else if (split.mode === 'Cash') acc.cash += amt;
          else if (split.mode === 'GPay') acc.gpay += amt;
          else if (split.mode === 'COD-Credit') acc.codCredit += amt;
          acc.totalRevenue += amt;
        });

        return acc;
      },
      { hdfc: 0, cash: 0, gpay: 0, codCredit: 0, totalRevenue: 0 }
    );
  }, [dayInvoices]);

  // Expenses Totals
  const expenseBreakdown = useMemo(() => {
    return currentRegister.expenses.reduce(
      (acc, exp) => {
        acc.cash += exp.cashAmount || 0;
        acc.gpay += exp.gpayAmount || 0;
        acc.total += (exp.cashAmount || 0) + (exp.gpayAmount || 0);
        return acc;
      },
      { cash: 0, gpay: 0, total: 0 }
    );
  }, [currentRegister.expenses]);

  // CLOSING BALANCE FORMULA:
  // Opening Amount + Cash Sales (from Sales section) - Cash Expenses (Cash portion only)
  const closingBalance = useMemo(() => {
    return currentRegister.openingAmount + salesBreakdown.cash - expenseBreakdown.cash;
  }, [currentRegister.openingAmount, salesBreakdown.cash, expenseBreakdown.cash]);

  const activeBranchObj = BRANCHES.find((b) => b.id === activeBranchId) || BRANCHES[0];

  // Quick Date Helpers
  const handleSetToday = () => setSelectedDate(todayStr);
  const handleSetYesterday = () => setSelectedDate(yesterdayStr);

  return (
    <div className="p-4 sm:p-6 space-y-6 w-full">
      {/* Top Banner Header */}
      <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="h-12 w-12 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700 shrink-0">
            <WalletCards className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
                Cash Register
              </h1>
              <span
                className={`text-[11px] uppercase font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                  currentRegister.isClosed
                    ? 'bg-slate-100 text-slate-700 border-slate-300'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                }`}
              >
                {currentRegister.isClosed ? (
                  <>
                    <Lock className="h-3 w-3" />
                    <span>Day Closed</span>
                  </>
                ) : (
                  <>
                    <Unlock className="h-3 w-3" />
                    <span>Register Open</span>
                  </>
                )}
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              Live automated cash-drawer tally from Sales Invoices with petty expense tracking.
            </p>
          </div>
        </div>

        {/* Header Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Sub-view switcher for CEO / Manager */}
          {canManageItems && (
            <div className="flex flex-wrap items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setActiveSubView('register')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeSubView === 'register'
                    ? 'bg-white text-blue-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <WalletCards className="h-3.5 w-3.5" />
                <span>Daily Register</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveSubView('recurring')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeSubView === 'recurring'
                    ? 'bg-white text-purple-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Calendar className="h-3.5 w-3.5" />
                <span>Scheduled Amounts</span>
                {pendingRecurringCount > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.2 text-[11px] font-bold rounded-full bg-amber-500 text-white">
                    {pendingRecurringCount}
                  </span>
                )}
              </button>
            </div>
          )}

          {/* History Button */}
          <button
            type="button"
            onClick={() => setIsHistoryModalOpen(true)}
            className="px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-semibold shadow-xs transition-colors flex items-center gap-1.5"
          >
            <History className="h-3.5 w-3.5 text-slate-500" />
            <span>Audit History</span>
          </button>

          {/* Print Day Summary */}
          <button
            type="button"
            onClick={() => window.print()}
            className="px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-semibold shadow-xs transition-colors flex items-center gap-1.5"
            title="Print daily register sheet"
          >
            <Printer className="h-3.5 w-3.5 text-slate-500" />
            <span className="hidden sm:inline">Print Sheet</span>
          </button>

          {/* Close Day Action or Reopen */}
          {!currentRegister.isClosed ? (
            <button
              type="button"
              onClick={() => {
                if (!canCloseDay) {
                  toast.error('Restricted action: Only CEO or Manager can close the day register.');
                  return;
                }
                setIsCloseDayModalOpen(true);
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
            >
              <Lock className="h-3.5 w-3.5" />
              <span>Close Day</span>
            </button>
          ) : (
            canCloseDay && (
              <button
                type="button"
                onClick={() => reopenDailyRegister(activeBranchId, selectedDate)}
                className="px-3.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5 text-amber-700" />
                <span>Reopen Day</span>
              </button>
            )
          )}
        </div>
      </div>

      {/* SUB-VIEW 1: RECURRING EXPENSE SETUP */}
      {activeSubView === 'recurring' && canManageItems ? (
        <RecurringExpensesManagement
          onQuickApprove={(template) => setApprovingTemplate(template)}
        />
      ) : (
        <>
          {/* Recurring Expense Due / Overdue Banner for this Day & Branch */}
          <RecurringExpenseBanner
            branchId={activeBranchId}
            registerDate={selectedDate}
            onApprove={(template) => setApprovingTemplate(template)}
          />

          {/* Date & Branch Filter Bar */}
          <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              {/* Date Picker Input */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-blue-600" />
                  <span>Date:</span>
                </span>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="text-xs font-bold font-mono bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              {/* Quick Date Shortcuts */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleSetYesterday}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors ${
                    selectedDate === yesterdayStr
                      ? 'bg-blue-50 text-blue-700 border-blue-200 font-bold'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  Yesterday
                </button>
                <button
                  type="button"
                  onClick={handleSetToday}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors ${
                    selectedDate === todayStr
                      ? 'bg-blue-50 text-blue-700 border-blue-200 font-bold'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  Today
                </button>
              </div>
            </div>

            {/* Branch Drawer Selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                <Building className="h-3.5 w-3.5 text-emerald-600" />
                <span>Branch Drawer:</span>
              </span>
              {currentUser.role === 'Manager' && currentUser.assignedBranchId ? (
                <span className="text-xs font-bold px-2.5 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg">
                  {BRANCHES.find((b) => b.id === currentUser.assignedBranchId)?.name}
                </span>
              ) : (
                <select
                  value={activeBranchId}
                  onChange={(e) => setActiveBranchId(e.target.value as BranchId)}
                  className="text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  {BRANCHES.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.shortCode})
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

      {/* Hero Summary Cards (Highlighting prominent Physical Closing Balance) */}
      <DailyCashSummaryCards
        openingAmount={currentRegister.openingAmount}
        isOpeningOverridden={currentRegister.isOpeningOverridden}
        overrideReason={currentRegister.overrideReason}
        cashSales={salesBreakdown.cash}
        cashExpenses={expenseBreakdown.cash}
        gpayExpenses={expenseBreakdown.gpay}
        closingBalance={closingBalance}
        totalDayRevenue={salesBreakdown.totalRevenue}
        bankDigitalTotal={salesBreakdown.hdfc + salesBreakdown.gpay}
        creditTotal={salesBreakdown.codCredit}
        isClosed={currentRegister.isClosed}
        canOverrideOpening={canOverrideOpening}
        onOpenOverrideModal={() => setIsOverrideModalOpen(true)}
        branchName={activeBranchObj.name}
      />

      {/* Main Two-Column Workflow (Sales on Left, Expenses on Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Sales Invoices Auto-Populated Table (7 cols) */}
        <div className="lg:col-span-7">
          <DailyCashSalesTable
            invoices={dayInvoices}
            date={selectedDate}
            branchName={activeBranchObj.name}
          />
        </div>

        {/* Right Column: Daily Expenses Log (5 cols) */}
        <div className="lg:col-span-5">
          <DailyCashExpensesTable
            expenses={currentRegister.expenses}
            isClosed={currentRegister.isClosed}
            onAddExpense={(expense) =>
              addCashExpense(activeBranchId, selectedDate, expense)
            }
            onDeleteExpense={(expId) =>
              deleteCashExpense(activeBranchId, selectedDate, expId)
            }
          />
        </div>
      </div>

      {/* Closed Day Information Box */}
      {currentRegister.isClosed && (
        <div className="p-4 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-between text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-slate-500 shrink-0" />
            <div>
              <span className="font-bold text-slate-800">
                Register closed by {currentRegister.closedBy || 'Manager'}
              </span>
              {currentRegister.closedAt && (
                <span className="text-slate-500 text-[11px] ml-1">
                  at {new Date(currentRegister.closedAt).toLocaleTimeString('en-IN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })} on {new Date(currentRegister.closedAt).toLocaleDateString('en-IN')}
                </span>
              )}
              {currentRegister.closingNotes && (
                <p className="text-[11px] text-slate-500 italic mt-0.5">
                  Notes: "{currentRegister.closingNotes}"
                </p>
              )}
            </div>
          </div>

          <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
            Next Day Opening: ₹{closingBalance.toLocaleString('en-IN')}
          </span>
        </div>
      )}

      {/* Override Opening Cash Modal */}
      <OverrideOpeningModal
        isOpen={isOverrideModalOpen}
        onClose={() => setIsOverrideModalOpen(false)}
        currentOpeningAmount={currentRegister.openingAmount}
        date={selectedDate}
        branchName={activeBranchObj.name}
        onSaveOverride={(amount, reason) =>
          overrideOpeningAmount(activeBranchId, selectedDate, amount, reason)
        }
      />

      {/* Day Close Confirmation Modal */}
      <CloseDayConfirmModal
        isOpen={isCloseDayModalOpen}
        onClose={() => setIsCloseDayModalOpen(false)}
        date={selectedDate}
        branchName={activeBranchObj.name}
        openingAmount={currentRegister.openingAmount}
        cashSales={salesBreakdown.cash}
        cashExpenses={expenseBreakdown.cash}
        closingBalance={closingBalance}
        onConfirmClose={(notes) =>
          closeDailyRegister(activeBranchId, selectedDate, notes)
        }
      />

      {/* Past Closed Registers History Modal */}
      <DailyCashHistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        registers={cashRegisters}
        invoices={invoices}
        onSelectDateAndBranch={(date, branchId) => {
          setSelectedDate(date);
          switchBranch(branchId);
        }}
      />

      {/* Approve Recurring Expense Modal */}
      {approvingTemplate && (
        <ApproveRecurringExpenseModal
          isOpen={!!approvingTemplate}
          onClose={() => setApprovingTemplate(null)}
          template={approvingTemplate}
          targetBranchId={activeBranchId}
          targetDate={selectedDate}
        />
      )}
        </>
      )}
    </div>
  );
};
