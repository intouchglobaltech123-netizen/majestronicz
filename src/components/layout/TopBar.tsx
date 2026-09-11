import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useErp } from '../../context/ErpContext';
import { BRANCHES, BranchScope } from '../../types';
import {
  Building,
  MapPin,
  ShieldCheck,
  Building2,
  Lock,
  Layers,
  Bell,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ExternalLink,
  Sparkles,
  Check,
  User,
  Wallet,
} from 'lucide-react';
import { cn, formatCurrency } from '../../lib/utils';
import { RecurringExpenseTemplate } from '../../types';

export const TopBar: React.FC = () => {
  const {
    currentBranch,
    isAllBranches,
    switchBranch,
    currentUser,
    logout,
    reminders,
    pendingOrders,
    enquiries,
    recurringExpenses,
    completeFollowUpReminder,
    setSelectedEnquiryForDetail,
    setSelectedPendingOrderForDetail,
    setCurrentView,
  } = useErp();

  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setIsNotificationsOpen(false);
      }
    };
    if (isNotificationsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isNotificationsOpen]);

  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);

  // Filter branch-scoped or all reminders based on current branch
  const activeReminders = useMemo(() => {
    return reminders.filter((r) => {
      if (r.isCompleted) return false;
      if (!isAllBranches && r.branchId !== currentBranch) return false;
      return true;
    });
  }, [reminders, isAllBranches, currentBranch]);

  // Reminders due today or overdue
  const dueReminders = useMemo(() => {
    return activeReminders.filter((r) => r.dueDate <= todayStr);
  }, [activeReminders, todayStr]);

  // Upcoming reminders
  const upcomingReminders = useMemo(() => {
    return activeReminders.filter((r) => r.dueDate > todayStr);
  }, [activeReminders, todayStr]);

  // Stock arrived pending orders
  const stockArrivedOrders = useMemo(() => {
    return pendingOrders.filter((po) => {
      if (po.status !== 'Stock Arrived') return false;
      if (!isAllBranches && po.branchId !== currentBranch) return false;
      return true;
    });
  }, [pendingOrders, isAllBranches, currentBranch]);

  // Recurring Expenses due today or overdue for this month
  const activeRecurringAlerts = useMemo(() => {
    const monthKey = todayStr.substring(0, 7);
    const day = parseInt(todayStr.split('-')[2], 10);

    return recurringExpenses.filter((template) => {
      if (!isAllBranches && template.branchId !== currentBranch) return false;
      const isApproved =
        template.lastApprovedMonth === monthKey ||
        template.approvalHistory?.some((a) => a.month === monthKey);
      if (isApproved) return false;
      return day >= template.dueDay;
    });
  }, [recurringExpenses, isAllBranches, currentBranch, todayStr]);

  const totalAlertCount =
    dueReminders.length + stockArrivedOrders.length + activeRecurringAlerts.length;

  const handleOpenEnquiry = (enquiryId: string) => {
    const enq = enquiries.find((e) => e.id === enquiryId);
    if (enq) {
      setSelectedEnquiryForDetail(enq);
      setCurrentView('enquiries');
      setIsNotificationsOpen(false);
    }
  };

  const handleOpenPendingOrder = (orderId: string) => {
    const po = pendingOrders.find((p) => p.id === orderId);
    if (po) {
      setSelectedPendingOrderForDetail(po);
      setCurrentView('pending-orders');
      setIsNotificationsOpen(false);
    }
  };

  const handleOpenRecurringExpense = (template: RecurringExpenseTemplate) => {
    if (!isAllBranches && currentBranch !== template.branchId) {
      switchBranch(template.branchId);
    }
    setCurrentView('cash-register');
    setIsNotificationsOpen(false);
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between sticky top-0 z-30 shadow-xs">
      {/* Left: Global Branch Switcher */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 mr-1">
          <MapPin className="h-3.5 w-3.5 text-blue-600" />
          <span>Branch:</span>
        </div>

        {/* Segmented Branch Selector Pills */}
        <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 shadow-inner">
          {/* "All Branches" Option — Visible only for CEO as per role visibility requirement */}
          {currentUser.role === 'CEO' && (
            <button
              onClick={() => switchBranch('all')}
              className={cn(
                'relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200',
                isAllBranches
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/80'
              )}
            >
              <Layers className={cn('h-3.5 w-3.5', isAllBranches ? 'text-white' : 'text-slate-500')} />
              <span>All Branches</span>
            </button>
          )}

          {/* Individual Branches: For CEO show all; For Manager show ONLY their assigned branch */}
          {BRANCHES.filter((b) =>
            currentUser.role === 'CEO'
              ? true
              : b.id === (currentUser.assignedBranchId || 'coimbatore')
          ).map((b) => {
            const isActive = !isAllBranches && currentBranch === b.id;
            return (
              <button
                key={b.id}
                onClick={() => switchBranch(b.id as BranchScope)}
                className={cn(
                  'relative flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200',
                  isActive
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/80'
                )}
              >
                <Building className={cn('h-3.5 w-3.5', isActive ? 'text-white' : 'text-slate-500')} />
                <span>{b.name}</span>
                {b.isHq && (
                  <span
                    className={cn(
                      'text-[9px] uppercase font-extrabold px-1.5 py-0.2 rounded',
                      isActive ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                    )}
                  >
                    HQ
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: Notifications Bell & Role Profile */}
      <div className="flex items-center gap-3">
        {/* Notification Bell Dropdown Container */}
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            onClick={() => setIsNotificationsOpen((prev) => !prev)}
            aria-label="Notification alerts"
            className={cn(
              'relative h-9 w-9 rounded-xl border flex items-center justify-center transition-all shadow-xs',
              totalAlertCount > 0
                ? 'bg-amber-50/70 border-amber-300 text-amber-700 hover:bg-amber-100/70'
                : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            )}
            title={totalAlertCount > 0 ? `${totalAlertCount} action items due` : 'No new notifications'}
          >
            <Bell className="h-4 w-4" />
            {totalAlertCount > 0 && (
              <span className="absolute -top-1 -right-1 h-5 min-w-[20px] px-1 bg-rose-600 text-white font-mono font-black text-[10px] rounded-full flex items-center justify-center shadow-xs animate-pulse">
                {totalAlertCount}
              </span>
            )}
          </button>

          {/* Interactive Notifications Popover */}
          {isNotificationsOpen && (
            <div className="absolute right-0 mt-2 w-96 max-w-[calc(100vw-2rem)] bg-white border border-slate-200 rounded-2xl shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
              {/* Popover Header */}
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
                    <Bell className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-slate-900">Follow-up Reminders & Alerts</h3>
                    <p className="text-[10px] text-slate-500">
                      {totalAlertCount > 0 ? `${totalAlertCount} requires attention` : 'All clear for now'}
                    </p>
                  </div>
                </div>
                {totalAlertCount > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200">
                    {totalAlertCount} Due
                  </span>
                )}
              </div>

              {/* Notification List Container */}
              <div className="max-h-[70vh] overflow-y-auto divide-y divide-slate-100">
                {totalAlertCount === 0 && upcomingReminders.length === 0 ? (
                  <div className="p-8 text-center text-slate-400">
                    <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-500 mb-2 opacity-80" />
                    <p className="text-xs font-bold text-slate-700">All caught up!</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      No customer follow-up reminders are due today.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Section 0: Recurring Expenses Due Today / Overdue */}
                    {activeRecurringAlerts.length > 0 && (
                      <div className="p-2 bg-purple-50/50 border-b border-purple-100">
                        <div className="px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-purple-800 flex items-center gap-1">
                          <Wallet className="h-3 w-3 text-purple-600" />
                          <span>Recurring Overhead Due ({activeRecurringAlerts.length})</span>
                        </div>
                        {activeRecurringAlerts.map((template) => {
                          const day = parseInt(todayStr.split('-')[2], 10);
                          const isOverdue = day > template.dueDay;
                          const branchObj = BRANCHES.find((b) => b.id === template.branchId);

                          return (
                            <div
                              key={template.id}
                              className={`p-2.5 rounded-xl border shadow-2xs transition-all mt-1 ${
                                isOverdue
                                  ? 'bg-rose-50/80 border-rose-200 text-rose-950'
                                  : 'bg-white border-purple-200 text-slate-900'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span
                                      className={`text-[9px] font-bold px-1.5 py-0.2 rounded uppercase ${
                                        isOverdue
                                          ? 'bg-rose-100 text-rose-700 border border-rose-300'
                                          : 'bg-purple-100 text-purple-700 border border-purple-300'
                                      }`}
                                    >
                                      {isOverdue ? 'Overdue' : 'Due Today'}
                                    </span>
                                    <span className="text-[10px] font-mono text-slate-500">
                                      Due {template.dueDay}th
                                    </span>
                                  </div>
                                  <p className="text-xs font-bold text-slate-900 mt-1">
                                    {template.name} {formatCurrency(template.defaultAmount)}{' '}
                                    {isOverdue
                                      ? `overdue for ${branchObj?.name || template.branchId}`
                                      : `due today for ${branchObj?.name || template.branchId}`}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleOpenRecurringExpense(template)}
                                  className="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-[10px] font-bold transition-colors shrink-0 shadow-2xs flex items-center gap-1"
                                >
                                  <span>Register</span>
                                  <ExternalLink className="h-2.5 w-2.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Section 1: Stock Arrived Backlog Alerts */}
                    {stockArrivedOrders.length > 0 && (
                      <div className="p-2 bg-emerald-50/40">
                        <div className="px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-emerald-700 flex items-center gap-1">
                          <Sparkles className="h-3 w-3" />
                          <span>Restock Arrived ({stockArrivedOrders.length})</span>
                        </div>
                        {stockArrivedOrders.map((po) => (
                          <div
                            key={po.id}
                            className="p-2.5 rounded-xl bg-white border border-emerald-200 shadow-2xs hover:shadow-xs transition-all mt-1"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <span className="font-mono font-bold text-[11px] text-emerald-800">
                                  {po.orderNumber}
                                </span>
                                <p className="text-xs font-bold text-slate-900 mt-0.5">
                                  {po.itemName}
                                </p>
                                <p className="text-[10px] text-slate-500">
                                  {po.quantityNeeded} {po.unit} arrived at {po.branchId} for {po.customerName}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleOpenPendingOrder(po.id)}
                                className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold transition-colors shrink-0 shadow-2xs flex items-center gap-1"
                              >
                                <span>Bill / Convert</span>
                                <ExternalLink className="h-2.5 w-2.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Section 2: Due & Overdue Follow-up Reminders */}
                    {dueReminders.length > 0 && (
                      <div className="p-2 bg-amber-50/40">
                        <div className="px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-amber-800 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3 text-amber-600" />
                          <span>Action Due Today / Overdue ({dueReminders.length})</span>
                        </div>
                        {dueReminders.map((rem) => {
                          const isOverdue = rem.dueDate < todayStr;
                          return (
                            <div
                              key={rem.id}
                              className={cn(
                                'p-3 rounded-xl border shadow-2xs transition-all mt-1.5',
                                isOverdue
                                  ? 'bg-rose-50/70 border-rose-200'
                                  : 'bg-white border-amber-200'
                              )}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="space-y-1 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-mono font-bold text-[11px] text-blue-700 bg-blue-50 px-1.5 py-0.2 rounded border border-blue-200">
                                      {rem.enquiryNumber}
                                    </span>
                                    <span
                                      className={cn(
                                        'text-[9px] font-bold px-1.5 py-0.2 rounded uppercase',
                                        isOverdue
                                          ? 'bg-rose-100 text-rose-700 border border-rose-300'
                                          : 'bg-amber-100 text-amber-800 border border-amber-300'
                                      )}
                                    >
                                      {isOverdue ? 'Overdue' : 'Due Today'} • {rem.dueTime}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-1 font-bold text-xs text-slate-900">
                                    <User className="h-3 w-3 text-slate-400 shrink-0" />
                                    <span className="truncate">{rem.customerName}</span>
                                    {rem.customerPhone && (
                                      <span className="text-[10px] font-mono text-slate-500 font-normal">
                                        ({rem.customerPhone})
                                      </span>
                                    )}
                                  </div>

                                  <p className="text-[11px] text-slate-600 font-medium truncate">
                                    Item: {rem.itemName}
                                  </p>

                                  {rem.notes && (
                                    <p className="text-[10px] text-slate-500 italic bg-white/70 p-1.5 rounded border border-slate-100">
                                      "{rem.notes}"
                                    </p>
                                  )}
                                </div>
                              </div>

                              {/* Action Buttons */}
                              <div className="mt-2.5 pt-2 border-t border-slate-200/60 flex items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleOpenEnquiry(rem.enquiryId)}
                                  className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-bold transition-colors flex items-center gap-1 shadow-2xs"
                                >
                                  <span>View Enquiry</span>
                                  <ExternalLink className="h-2.5 w-2.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => completeFollowUpReminder(rem.id)}
                                  className="px-2.5 py-1 bg-slate-100 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 border border-slate-200 hover:border-emerald-300 rounded-lg text-[10px] font-semibold transition-colors flex items-center gap-1"
                                >
                                  <Check className="h-3 w-3 text-emerald-600" />
                                  <span>Mark Done</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Section 3: Upcoming Reminders */}
                    {upcomingReminders.length > 0 && (
                      <div className="p-2">
                        <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          <span>Upcoming Follow-ups ({upcomingReminders.length})</span>
                        </div>
                        {upcomingReminders.map((rem) => (
                          <div
                            key={rem.id}
                            className="p-2.5 rounded-xl bg-slate-50/60 border border-slate-200/80 hover:bg-slate-50 transition-all mt-1"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono text-[10px] font-bold text-slate-700">
                                    {rem.enquiryNumber}
                                  </span>
                                  <span className="text-[10px] text-slate-400">•</span>
                                  <span className="text-[10px] font-medium text-slate-600">
                                    {rem.dueDate} at {rem.dueTime}
                                  </span>
                                </div>
                                <p className="text-xs font-semibold text-slate-800 mt-0.5">
                                  {rem.customerName} — {rem.itemName}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleOpenEnquiry(rem.enquiryId)}
                                className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                                title="Open Enquiry"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Current user + logout */}
        <button
          onClick={logout}
          title="Logout"
          className="flex items-center gap-2.5 px-3 py-1.5 bg-slate-50 hover:bg-rose-50 text-slate-900 border border-slate-200 hover:border-rose-200 rounded-xl transition-all shadow-xs group"
        >
          <div className="h-7 w-7 rounded-lg bg-blue-100 flex items-center justify-center text-blue-700 group-hover:bg-blue-200 transition-colors">
            {currentUser.role === 'CEO' ? (
              <ShieldCheck className="h-4 w-4 text-amber-600" />
            ) : currentUser.role === 'Manager' ? (
              <Building2 className="h-4 w-4 text-blue-600" />
            ) : (
              <Lock className="h-4 w-4 text-slate-600" />
            )}
          </div>
          <div className="text-left">
            <span className="text-xs font-bold block leading-tight">{currentUser.role}</span>
            <span className="text-[10px] text-slate-500 block leading-tight group-hover:text-rose-600">
              Logout
            </span>
          </div>
        </button>
      </div>
    </header>
  );
};

