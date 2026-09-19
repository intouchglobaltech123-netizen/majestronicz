import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useErp } from '../../context/ErpContext';
import { BRANCHES, BranchScope } from '../../types';
import {
  MapPin,
  Bell,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ExternalLink,
  PackageCheck,
  Check,
  User,
  Wallet,
  Maximize2,
  Minimize2,
  Menu,
} from 'lucide-react';
import { cn, formatCurrency } from '../../lib/utils';
import { RecurringExpenseTemplate } from '../../types';
import { UniversalDropdown } from '../common/UniversalDropdown';
import { SelfAttendanceModal } from '../hrm/SelfAttendanceModal';

interface TopBarProps {
  /** Opens the mobile navigation drawer (< lg). */
  onOpenNav?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({ onOpenNav }) => {
  const {
    currentBranch,
    isAllBranches,
    switchBranch,
    currentUser,
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
  const [isSelfAttendanceOpen, setIsSelfAttendanceOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

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
    <header className="h-13 bg-white border-b border-slate-300 px-3 sm:px-4 flex items-center justify-between gap-2 sticky top-0 z-30 shadow-none">
      {/* Left: Hamburger (mobile) + Global Branch Switcher */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        {/* Mobile nav toggle */}
        <button
          type="button"
          onClick={onOpenNav}
          aria-label="Open menu"
          className="lg:hidden h-8 w-8 shrink-0 rounded-none border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
        >
          <Menu className="h-4 w-4" />
        </button>

        <div className="hidden sm:flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 mr-1">
          <MapPin className="h-3.5 w-3.5 text-red-700" />
          <span>Branch:</span>
        </div>

        {/* Branch Selector Dropdown */}
        <div className="w-36 sm:w-56 min-w-0">
          <UniversalDropdown
            value={isAllBranches ? 'all' : currentBranch}
            onChange={(v) => switchBranch(v as BranchScope)}
            options={[
              ...(currentUser.role === 'CEO' ? [{ value: 'all', label: 'All Branches', sublabel: 'Erode · Coimbatore · Chennai' }] : []),
              ...BRANCHES.filter((b) =>
                currentUser.role === 'CEO' ? true : b.id === (currentUser.assignedBranchId || 'coimbatore')
              ).map((b) => ({ value: b.name + (b.isHq ? ' (HQ)' : ''), label: b.name + (b.isHq ? ' (HQ)' : ''), sublabel: b.location })),
            ]}
            buttonClassName="w-full px-2.5 py-1.5 rounded-none bg-white border border-slate-300 text-xs font-bold text-slate-800"
          />
        </div>
      </div>

      {/* Right: Notifications Bell & Role Profile */}
      <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
        {/* My Attendance — self check-in/out */}
        <button
          type="button"
          onClick={() => setIsSelfAttendanceOpen(true)}
          title="My Attendance — check in / out"
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-none border border-slate-300 bg-slate-50 text-slate-800 hover:bg-slate-100 font-bold text-xs transition-colors cursor-pointer"
        >
          <Clock className="h-3.5 w-3.5 text-slate-600" />
          <span className="hidden md:inline">My Attendance</span>
        </button>

        {/* Fullscreen toggle (desktop only) */}
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label="Toggle full screen"
          title={isFullscreen ? 'Exit full screen' : 'Full screen'}
          className="hidden sm:flex h-8 w-8 rounded-none border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900 items-center justify-center transition-all cursor-pointer"
        >
          {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>

        {/* Notification Bell Dropdown Container */}
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            onClick={() => setIsNotificationsOpen((prev) => !prev)}
            aria-label="Notification alerts"
            className={cn(
              'relative h-8 w-8 rounded-none border flex items-center justify-center transition-all cursor-pointer',
              totalAlertCount > 0
                ? 'bg-amber-50 border-amber-400 text-amber-800'
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
            )}
            title={totalAlertCount > 0 ? `${totalAlertCount} action items due` : 'No new notifications'}
          >
            <Bell className="h-3.5 w-3.5" />
            {totalAlertCount > 0 && (
              <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 bg-red-600 text-white font-mono font-bold text-[10px] rounded-none flex items-center justify-center">
                {totalAlertCount}
              </span>
            )}
          </button>

          {/* Interactive Notifications Popover — full-width sheet on mobile,
              anchored dropdown on >= sm */}
          {isNotificationsOpen && (
            <div className="fixed left-3 right-3 top-[3.75rem] w-auto sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-1 sm:w-96 sm:max-w-[calc(100vw-2rem)] bg-white border border-slate-300 rounded-none shadow-lg z-50 overflow-hidden">
              {/* Popover Header */}
              <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-300 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-none bg-amber-100 text-amber-800 flex items-center justify-center">
                    <Bell className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-slate-900">Follow-up Reminders & Alerts</h3>
                    <p className="text-[11px] text-slate-500">
                      {totalAlertCount > 0 ? `${totalAlertCount} requires attention` : 'All clear for now'}
                    </p>
                  </div>
                </div>
                {totalAlertCount > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-none bg-red-100 text-red-800 border border-red-200">
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
                        <div className="px-2 py-1 text-[11px] font-extrabold uppercase tracking-wider text-purple-800 flex items-center gap-1">
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
                                      className={`text-[11px] font-bold px-1.5 py-0.2 rounded uppercase ${
                                        isOverdue
                                          ? 'bg-rose-100 text-rose-700 border border-rose-300'
                                          : 'bg-purple-100 text-purple-700 border border-purple-300'
                                      }`}
                                    >
                                      {isOverdue ? 'Overdue' : 'Due Today'}
                                    </span>
                                    <span className="text-[11px] font-mono text-slate-500">
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
                                  className="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-[11px] font-bold transition-colors shrink-0 shadow-2xs flex items-center gap-1"
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
                        <div className="px-2 py-1 text-[11px] font-extrabold uppercase tracking-wider text-emerald-700 flex items-center gap-1">
                          <PackageCheck className="h-3 w-3" />
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
                                <p className="text-[11px] text-slate-500">
                                  {po.quantityNeeded} {po.unit} arrived at {po.branchId} for {po.customerName}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleOpenPendingOrder(po.id)}
                                className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold transition-colors shrink-0 shadow-2xs flex items-center gap-1"
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
                        <div className="px-2 py-1 text-[11px] font-extrabold uppercase tracking-wider text-amber-800 flex items-center gap-1">
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
                                        'text-[11px] font-bold px-1.5 py-0.2 rounded uppercase',
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
                                      <span className="text-[11px] font-mono text-slate-500 font-normal">
                                        ({rem.customerPhone})
                                      </span>
                                    )}
                                  </div>

                                  <p className="text-[11px] text-slate-600 font-medium truncate">
                                    Item: {rem.itemName}
                                  </p>

                                  {rem.notes && (
                                    <p className="text-[11px] text-slate-500 italic bg-white/70 p-1.5 rounded border border-slate-100">
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
                                  className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold transition-colors flex items-center gap-1 shadow-2xs"
                                >
                                  <span>View Enquiry</span>
                                  <ExternalLink className="h-2.5 w-2.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => completeFollowUpReminder(rem.id)}
                                  className="px-2.5 py-1 bg-slate-100 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 border border-slate-200 hover:border-emerald-300 rounded-lg text-[11px] font-semibold transition-colors flex items-center gap-1"
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
                        <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
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
                                  <span className="font-mono text-[11px] font-bold text-slate-700">
                                    {rem.enquiryNumber}
                                  </span>
                                  <span className="text-[11px] text-slate-400">•</span>
                                  <span className="text-[11px] font-medium text-slate-600">
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
      </div>

      {/* Self attendance (My Attendance) */}
      <SelfAttendanceModal isOpen={isSelfAttendanceOpen} onClose={() => setIsSelfAttendanceOpen(false)} />
    </header>
  );
};

