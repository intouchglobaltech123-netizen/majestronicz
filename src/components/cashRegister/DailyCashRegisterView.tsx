import React, { useState, useMemo, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import { BranchId, BRANCHES, isExpenseDueInMonth, isExpenseApprovedForMonth, getInvoicePaymentSplits, expenseIsEffective, dueDayInMonth } from '../../types';
import { collectionsByMode } from '../../lib/paymentModes';
import { getTodayDateString, getYesterdayDateString, cn, formatCurrency, formatDate } from '../../lib/utils';
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
import { computeDayCashClosing, DEFAULT_OPENING } from '../../lib/cashClosing';
import {
  Calendar,
  Building,
  Lock,
  Unlock,
  History,
  RotateCcw,
  Printer,
  Wallet,
  Clock,
} from 'lucide-react';
import { toast } from 'sonner';

export const DailyCashRegisterView: React.FC = () => {
  const {
    currentUser,
    currentBranch,
    isAllBranches,
    switchBranch,
    invoices,
    payments,
    cashRegisters,
    getDailyCashRegister,
    addCashExpense,
    deleteCashExpense,
    approveCashExpense,
    overrideOpeningAmount,
    closeDailyRegister,
    reopenDailyRegister,
    canCloseDay,
    canOverrideOpening,
    canManageItems,
    recurringExpenses,
    activeSubTab,
    isDayClosed,
  } = useErp();

  // Dynamic system dates. Recompute on an interval so a drawer left open past
  // midnight rolls over to the new day instead of staying stuck on the old date
  // (CASH-13).
  const [todayStr, setTodayStr] = useState<string>(() => getTodayDateString());
  useEffect(() => {
    const id = setInterval(() => {
      const d = getTodayDateString();
      setTodayStr((prev) => (prev !== d ? d : prev));
    }, 60_000);
    return () => clearInterval(id);
  }, []);
  const yesterdayStr = useMemo(() => getYesterdayDateString(), [todayStr]);

  // Date selection (Defaults to live dynamic today)
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  // CASH-13: a drawer that was showing TODAY follows the date across midnight;
  // one deliberately set to another day stays where it is.
  const prevToday = React.useRef(todayStr);
  useEffect(() => {
    if (prevToday.current !== todayStr) {
      // Capture the old day BEFORE updating the ref: the setter callback runs
      // later, when the ref already holds the new day (the bug left the drawer
      // on yesterday after midnight).
      const oldToday = prevToday.current;
      prevToday.current = todayStr;
      setSelectedDate((d) => (d === oldToday ? todayStr : d));
    }
  }, [todayStr]);

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

  // Synchronize view tab and modals when triggered from secondary navbar flyout
  useEffect(() => {
    if (activeSubTab?.view === 'cash-register') {
      const tab = activeSubTab.tab;
      if (tab === 'register') {
        setActiveSubView('register');
      } else if (tab === 'recurring') {
        // Only a login that can manage templates gets the recurring screen (E2E8-14).
        setActiveSubView(canManageItems ? 'recurring' : 'register');
      } else if (tab === 'history') {
        setIsHistoryModalOpen(true);
      }
    }
  }, [activeSubTab, canManageItems]);

  // Pending scheduled expenses count for badge (frequency aware)
  const pendingRecurringCount = useMemo(() => {
    const monthKey = selectedDate.substring(0, 7);
    const monthNumber = parseInt(selectedDate.split('-')[1], 10);
    const day = parseInt(selectedDate.split('-')[2], 10);
    return recurringExpenses.filter((t) => {
      if (t.branchId !== activeBranchId) return false;
      if (!isExpenseDueInMonth(t, monthNumber)) return false;
      if (isExpenseApprovedForMonth(t, monthKey)) return false;
      return day >= dueDayInMonth(t, monthKey); // CASH-8: 31st → last day of a short month
    }).length;
  }, [recurringExpenses, activeBranchId, selectedDate]);

  // Current Register Record for (activeBranchId, selectedDate)
  const currentRegister = useMemo(() => {
    return getDailyCashRegister(activeBranchId, selectedDate);
  }, [getDailyCashRegister, activeBranchId, selectedDate, cashRegisters]);
  // CASH10-1: an open day before a later CLOSED day is locked too — the closed
  // day's opening already carries its cash.
  const lockedByLaterClose = !currentRegister.isClosed && isDayClosed(activeBranchId, selectedDate);

  // Invoices for selected branch and date (excluding voided sales)
  const dayInvoices = useMemo(() => {
    return invoices.filter(
      (inv) => inv.branchId === activeBranchId && inv.date === selectedDate && !inv.isVoided
    );
  }, [invoices, activeBranchId, selectedDate]);

  // Sales Totals — Reconcile Per Split Entry with 2-decimal accuracy
  const salesBreakdown = useMemo(() => {
    const raw = dayInvoices.reduce(
      (acc, inv) => {
        const splits = getInvoicePaymentSplits(inv);
        // Returns are NOT netted into the billing day any more — a refund is a
        // separate cash-out on the RETURN day — so this per-mode breakdown must
        // match the un-netted day closing (SAL4-12).
        splits.forEach((split) => {
          const amt = Math.round(split.amount * 100) / 100;
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
    return {
      hdfc: Math.round(raw.hdfc * 100) / 100,
      cash: Math.round(raw.cash * 100) / 100,
      gpay: Math.round(raw.gpay * 100) / 100,
      codCredit: Math.round(raw.codCredit * 100) / 100,
      totalRevenue: Math.round(raw.totalRevenue * 100) / 100,
    };
  }, [dayInvoices]);

  // Expenses Totals — only EFFECTIVE expenses hit the drawer. A bank deposit that
  // is still pending (or rejected) approval is excluded until a Manager/CEO approves.
  const expenseBreakdown = useMemo(() => {
    const raw = currentRegister.expenses.reduce(
      (acc, exp) => {
        if (!expenseIsEffective(exp)) return acc;
        const cashPart = Math.round((exp.cashAmount || 0) * 100) / 100;
        const gpayPart = Math.round((exp.gpayAmount || 0) * 100) / 100;
        acc.cash += cashPart;
        acc.gpay += gpayPart;
        acc.total += cashPart + gpayPart;
        return acc;
      },
      { cash: 0, gpay: 0, total: 0 }
    );
    return {
      cash: Math.round(raw.cash * 100) / 100,
      gpay: Math.round(raw.gpay * 100) / 100,
      total: Math.round(raw.total * 100) / 100,
    };
  }, [currentRegister.expenses]);

  // The day's customer receipts and refunds at this branch — shown as their own
  // rows in the bills table and counted by their own mode (SAL6-2 / E2E7-7).
  const dayPayments = useMemo(
    () => payments.filter((p) => p.branchId === activeBranchId && p.date === selectedDate),
    [payments, activeBranchId, selectedDate],
  );
  const dayCollection = useMemo(() => {
    const m = collectionsByMode(dayInvoices, dayPayments, () => true, () => true);
    return { cash: m.byGroup.Cash, digital: m.total - m.byGroup.Cash, credit: m.creditGiven };
  }, [dayInvoices, dayPayments]);
  // CASH4-7: "carried from the previous day" only when there is one.
  const hasPreviousRegister = useMemo(
    () => cashRegisters.some((r) => r.branchId === activeBranchId && r.date < selectedDate),
    [cashRegisters, activeBranchId, selectedDate],
  );
  // CASH6-3: items still waiting for a Manager/CEO decision block the close.
  const pendingApprovals = useMemo(
    () => currentRegister.expenses.filter((e) => e.approvalStatus === 'pending'),
    [currentRegister.expenses],
  );

  // Closing balance via the ONE shared formula (CASH2-3/CASH-4), so the card, the
  // next-day opening carry-forward and the history modal all agree. It also folds
  // in cash receipts / vendor cash payments from the Payment ledger (CASH2-6).
  const dayClosing = useMemo(
    () => computeDayCashClosing(
      activeBranchId, selectedDate, currentRegister.openingAmount || 0, invoices, payments, currentRegister.expenses,
    ),
    [activeBranchId, selectedDate, currentRegister.openingAmount, currentRegister.expenses, invoices, payments],
  );
  const closingBalance = dayClosing.closing;
  const cashLedger = { in: dayClosing.cashReceipts, out: dayClosing.cashPaid };

  const activeBranchObj = BRANCHES.find((b) => b.id === activeBranchId) || BRANCHES[0];

  // Print Sheet (CASH4-5 / E2E8-16): the register only — no buttons, banners or
  // filter bar, every bill (no scroll box) and one column so nothing overlaps.
  const printSheet = () => {
    if (activeSubView !== 'register') setActiveSubView('register');
    document.body.classList.add('register-printing');
    const done = () => { document.body.classList.remove('register-printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => { window.print(); setTimeout(done, 1000); }, 50);
  };

  // Quick Date Helpers
  const handleSetToday = () => setSelectedDate(todayStr);
  const handleSetYesterday = () => setSelectedDate(yesterdayStr);

  return (
    <div className="p-4 sm:p-6 space-y-6 w-full print:p-0 print:space-y-3">
      {/* Printed sheet heading (print only) */}
      <div className="hidden print:block border-b border-slate-400 pb-2">
        <h1 className="text-base font-bold text-slate-900">Daily Cash Register — {activeBranchObj.name}</h1>
        <p className="text-xs text-slate-700">
          {formatDate(selectedDate)} · {currentRegister.isClosed ? `Closed by ${currentRegister.closedBy || 'Manager'}` : 'Open'} · printed {formatDate(new Date().toISOString())}, {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
      {/* Top Banner Header */}
      <div className="print:hidden p-5 rounded-xl bg-white border border-slate-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
              {activeSubView === 'recurring' ? 'Scheduled & Recurring Expenses' : 'Daily Cash Register Drawer'}
            </h1>
            <span
              className={`text-[11px] uppercase font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                currentRegister.isClosed || lockedByLaterClose
                  ? 'bg-slate-100 text-slate-700 border-slate-300'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}
            >
              {currentRegister.isClosed ? (
                <>
                  <Lock className="h-3 w-3" />
                  <span>Day Closed</span>
                </>
              ) : lockedByLaterClose ? (
                <>
                  <Lock className="h-3 w-3" />
                  <span>Locked · later day closed</span>
                </>
              ) : (
                <>
                  <Unlock className="h-3 w-3" />
                  <span>Register Open</span>
                </>
              )}
            </span>
            {activeSubView === 'recurring' && pendingRecurringCount > 0 && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                {pendingRecurringCount} Due
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 mt-0.5">
            {activeSubView === 'recurring'
              ? 'Monthly fixed expense templates (rent, electricity, salaries, vendor retainers).'
              : 'Live automated cash-drawer tally from Sales Invoices with petty expense tracking.'}
          </p>
        </div>

        {/* Header Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 print:hidden">

          {/* History Button */}
          <button
            type="button"
            onClick={() => setIsHistoryModalOpen(true)}
            className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-none text-xs font-semibold shadow-none transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <History className="h-3.5 w-3.5 text-slate-500" />
            <span>Audit History</span>
          </button>

          {/* Print Day Summary */}
          <button
            type="button"
            onClick={printSheet}
            className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-none text-xs font-semibold shadow-none transition-colors flex items-center gap-1.5 cursor-pointer"
            title="Print daily register sheet"
          >
            <Printer className="h-3.5 w-3.5 text-slate-500" />
            <span className="hidden sm:inline">Print Sheet</span>
          </button>

          {/* Close Day Action or Reopen */}
          {!currentRegister.isClosed ? (
            canCloseDay && (
            <button
              type="button"
              onClick={() => {
                // A day in the future has no transactions yet and must not be
                // closable — closing it would lock a date that hasn't happened
                // and break the opening-balance chain (CASH-9).
                if (selectedDate > todayStr) {
                  toast.error("You can't close a future day. Select today or an earlier date.");
                  return;
                }
                setIsCloseDayModalOpen(true);
              }}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white rounded-none border border-red-700 text-xs font-bold transition-all shadow-none flex items-center gap-1.5 cursor-pointer"
            >
              <Lock className="h-3.5 w-3.5" />
              <span>Close Day</span>
            </button>
            )
          ) : (
            canCloseDay && (
              <button
                type="button"
                onClick={() => reopenDailyRegister(activeBranchId, selectedDate)}
                className="px-3.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-none text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5 text-amber-700" />
                <span>Reopen Day</span>
              </button>
            )
          )}
        </div>
      </div>

      {/* Segmented View Tabs — mobile only (desktop uses the secondary sidebar) */}
      <div className="print:hidden lg:hidden flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar -mx-1 px-1">
        <button
          type="button"
          onClick={() => setActiveSubView('register')}
          className={cn(
            'flex items-center gap-2 px-3.5 py-2 rounded-none text-xs font-bold whitespace-nowrap transition-all cursor-pointer shrink-0 border',
            activeSubView === 'register'
              ? 'bg-red-600 text-white border-red-700 shadow-none'
              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50 hover:text-slate-900'
          )}
        >
          <Wallet className="h-3.5 w-3.5" />
          <span>Daily Cash Drawer</span>
        </button>

        {canManageItems && (
          <button
            type="button"
            onClick={() => setActiveSubView('recurring')}
            className={cn(
              'flex items-center gap-2 px-3.5 py-2 rounded-none text-xs font-bold whitespace-nowrap transition-all cursor-pointer shrink-0 border',
              activeSubView === 'recurring'
                ? 'bg-slate-800 text-white border-slate-900 shadow-none'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50 hover:text-slate-900'
            )}
          >
            <Clock className="h-3.5 w-3.5" />
            <span>Scheduled Expenses</span>
            {pendingRecurringCount > 0 && (
              <span className={cn(
                'px-1.5 py-0.2 rounded-none text-[10px] font-bold border',
                activeSubView === 'recurring' ? 'bg-amber-400 text-slate-900 border-amber-500' : 'bg-amber-100 text-amber-800 border-amber-200'
              )}>
                {pendingRecurringCount} Due
              </span>
            )}
          </button>
        )}
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
          <div className="print:hidden p-4 bg-white border border-slate-300 rounded-none shadow-xs flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              {/* Date Picker Input */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-red-700" />
                  <span>Date:</span>
                </span>
                <input
                  type="date"
                  aria-label="Register date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="text-xs font-bold font-mono bg-slate-50 border border-slate-300 rounded-none px-3 py-1.5 focus:outline-none focus:border-red-600"
                />
              </div>

              {/* Quick Date Shortcuts */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleSetYesterday}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-none border transition-colors cursor-pointer ${
                    selectedDate === yesterdayStr
                      ? 'bg-red-600 text-white border-red-700 font-bold'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  Yesterday
                </button>
                <button
                  type="button"
                  onClick={handleSetToday}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-none border transition-colors cursor-pointer ${
                    selectedDate === todayStr
                      ? 'bg-red-600 text-white border-red-700 font-bold'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
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
              {currentUser.role !== 'CEO' && currentUser.assignedBranchId ? (
                <span className="text-xs font-bold px-2.5 py-1 bg-emerald-50 text-emerald-800 border border-emerald-300 rounded-none">
                  {BRANCHES.find((b) => b.id === currentUser.assignedBranchId)?.name}
                </span>
              ) : (
                <select
                  aria-label="Branch drawer"
                  value={activeBranchId}
                  onChange={(e) => setActiveBranchId(e.target.value as BranchId)}
                  className="text-xs font-bold bg-slate-50 border border-slate-300 rounded-none px-3 py-1.5 focus:outline-none focus:border-red-600 cursor-pointer"
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
        cashReceipts={cashLedger.in}
        cashPaid={cashLedger.out}
        cashRefunds={dayClosing.cashRefunds}
        cashVendorPaid={dayClosing.cashVendorPaid}
        cashSalaries={dayClosing.cashSalaries}
        collection={dayCollection}
        hasPreviousRegister={hasPreviousRegister}
        defaultFloat={DEFAULT_OPENING(activeBranchId)}
        cashExpenses={expenseBreakdown.cash}
        gpayExpenses={expenseBreakdown.gpay}
        closingBalance={closingBalance}
        totalDayRevenue={salesBreakdown.totalRevenue}
        bankDigitalTotal={salesBreakdown.hdfc + salesBreakdown.gpay}
        creditTotal={salesBreakdown.codCredit}
        isClosed={currentRegister.isClosed || lockedByLaterClose}
        canOverrideOpening={canOverrideOpening}
        onOpenOverrideModal={() => setIsOverrideModalOpen(true)}
        branchName={activeBranchObj.name}
      />

      {/* Main Two-Column Workflow (Sales on Left, Expenses on Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start print:block print:space-y-4">
        {/* Left Column: Sales Invoices Auto-Populated Table (7 cols) */}
        <div className="lg:col-span-7">
          <DailyCashSalesTable
            invoices={dayInvoices}
            payments={dayPayments}
            date={selectedDate}
            branchName={activeBranchObj.name}
          />
        </div>

        {/* Right Column: Daily Expenses Log (5 cols) */}
        <div className="lg:col-span-5">
          <DailyCashExpensesTable
            expenses={currentRegister.expenses}
            isClosed={currentRegister.isClosed || lockedByLaterClose}
            drawerCash={closingBalance}
            onAddExpense={(expense) =>
              addCashExpense(activeBranchId, selectedDate, expense)
            }
            onDeleteExpense={(expId) =>
              deleteCashExpense(activeBranchId, selectedDate, expId)
            }
            canApprove={currentUser.role === 'CEO' || currentUser.role === 'Manager'}
            onApprove={(expId, decision) =>
              approveCashExpense(activeBranchId, selectedDate, expId, decision)
            }
          />
        </div>
      </div>

      {lockedByLaterClose && (
        <div className="p-4 rounded-none bg-amber-50 border border-amber-300 flex items-center gap-2 text-xs text-amber-900" data-testid="locked-by-later-close">
          <Lock className="h-4 w-4 shrink-0" />
          <span>
            A later cash day of this branch is closed, so this day is locked too — its cash is already carried into
            that closed day. Reopen the later closed day(s) to change anything here.
          </span>
        </div>
      )}

      {/* Closed Day Information Box */}
      {currentRegister.isClosed && (
        <div className="p-4 rounded-none bg-slate-100 border border-slate-300 flex items-center justify-between text-xs text-slate-600">
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

          <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-none border border-emerald-300 font-mono">
            Next Day Opening: {formatCurrency(closingBalance)}
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
        cashReceipts={dayClosing.cashReceipts}
        cashRefunds={dayClosing.cashRefunds}
        cashVendorPaid={dayClosing.cashVendorPaid}
        cashSalaries={dayClosing.cashSalaries}
        cashExpenses={expenseBreakdown.cash}
        closingBalance={closingBalance}
        pendingApprovals={pendingApprovals.map((e) => e.reason || e.category || 'Pending item')}
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
        payments={payments}
        onSelectDateAndBranch={(date, branchId) => {
          setSelectedDate(date);
          // Also switch the drawer's own branch, not just the global branch, so
          // opening an Erode history row from a Chennai drawer shows Erode (CASH-14).
          setActiveBranchId(branchId);
          switchBranch(branchId);
        }}
      />

        </>
      )}

      {/* Approve Recurring Expense Modal — outside the view switch, so Approve on
          the Recurring Expenses page opens it right there (CASH3-8). */}
      {approvingTemplate && (
        <ApproveRecurringExpenseModal
          isOpen={!!approvingTemplate}
          onClose={() => setApprovingTemplate(null)}
          template={approvingTemplate}
          targetBranchId={activeBranchId}
          targetDate={selectedDate}
        />
      )}
    </div>
  );
};
