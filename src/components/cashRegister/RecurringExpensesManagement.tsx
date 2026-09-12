import React, { useState, useMemo } from 'react';
import {
  RecurringExpenseTemplate,
  BranchId,
  BRANCHES,
  ExpenseFrequency,
  isExpenseDueInMonth,
  isExpenseApprovedForMonth,
  formatExpenseSchedule,
  MONTH_NAMES,
} from '../../types';
import { useErp } from '../../context/ErpContext';
import { formatCurrency } from '../../lib/utils';
import {
  Plus,
  Edit2,
  Trash2,
  Calendar,
  Building,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Wallet,
  DollarSign,
  CreditCard,
  X,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  onQuickApprove: (template: RecurringExpenseTemplate) => void;
}

export const RecurringExpensesManagement: React.FC<Props> = ({ onQuickApprove }) => {
  const {
    recurringExpenses,
    addRecurringExpenseTemplate,
    updateRecurringExpenseTemplate,
    deleteRecurringExpenseTemplate,
    canManageItems,
    currentBranch,
    isAllBranches,
  } = useErp();

  // Branch filter within recurring templates
  const [selectedBranchFilter, setSelectedBranchFilter] = useState<string>(() => {
    if (!isAllBranches && currentBranch !== 'all') return currentBranch;
    return 'all';
  });

  // Modal states for Create / Edit
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<RecurringExpenseTemplate | null>(null);

  // Form fields
  const [formName, setFormName] = useState('');
  const [formAmount, setFormAmount] = useState<number>(0);
  const [formBranchId, setFormBranchId] = useState<BranchId>('erode-hq');
  const [formFrequency, setFormFrequency] = useState<ExpenseFrequency>('Monthly');
  const [formStartMonth, setFormStartMonth] = useState<number>(1); // 1 = Jan
  const [formDueDay, setFormDueDay] = useState<number>(5);
  const [formPaymentMode, setFormPaymentMode] = useState<'Cash' | 'GPay'>('Cash');

  // Today context for monthly status calculation
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const currentMonthKey = todayStr.substring(0, 7); // YYYY-MM
  const currentMonthNumber = parseInt(todayStr.split('-')[1], 10); // 1 to 12
  const currentDay = parseInt(todayStr.split('-')[2], 10);

  const filteredTemplates = useMemo(() => {
    return recurringExpenses.filter((t) => {
      if (selectedBranchFilter !== 'all' && t.branchId !== selectedBranchFilter) return false;
      return true;
    });
  }, [recurringExpenses, selectedBranchFilter]);

  // Overall statistics (frequency aware)
  const stats = useMemo(() => {
    let monthlyCommitment = 0;
    let approvedCount = 0;
    let pendingActionCount = 0;

    filteredTemplates.forEach((t) => {
      monthlyCommitment += t.defaultAmount;
      const isDueThisMonth = isExpenseDueInMonth(t, currentMonthNumber);
      const isApproved = isExpenseApprovedForMonth(t, currentMonthKey);

      if (isApproved) {
        approvedCount++;
      } else if (isDueThisMonth && currentDay >= t.dueDay) {
        pendingActionCount++;
      }
    });

    return {
      totalTemplates: filteredTemplates.length,
      monthlyCommitment,
      approvedCount,
      pendingActionCount,
    };
  }, [filteredTemplates, currentMonthKey, currentMonthNumber, currentDay]);

  const handleOpenAddModal = () => {
    setEditingTemplate(null);
    setFormName('');
    setFormAmount(0);
    setFormBranchId(selectedBranchFilter !== 'all' ? (selectedBranchFilter as BranchId) : 'erode-hq');
    setFormFrequency('Monthly');
    setFormStartMonth(1);
    setFormDueDay(5);
    setFormPaymentMode('Cash');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (template: RecurringExpenseTemplate) => {
    setEditingTemplate(template);
    setFormName(template.name);
    setFormAmount(template.defaultAmount);
    setFormBranchId(template.branchId);
    setFormFrequency(template.frequency || 'Monthly');
    setFormStartMonth(template.startMonth || 1);
    setFormDueDay(template.dueDay);
    setFormPaymentMode(template.paymentMode);
    setIsModalOpen(true);
  };

  const handleDelete = (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to delete scheduled amount "${name}"?`)) {
      deleteRecurringExpenseTemplate(id);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      toast.error('Please enter a template name.');
      return;
    }
    if (formAmount <= 0) {
      toast.error('Please enter a valid amount greater than ₹0.');
      return;
    }
    if (formDueDay < 1 || formDueDay > 31) {
      toast.error('Due day must be between 1 and 31.');
      return;
    }

    const templatePayload = {
      name: formName.trim(),
      defaultAmount: formAmount,
      branchId: formBranchId,
      frequency: formFrequency,
      startMonth: formFrequency !== 'Monthly' ? formStartMonth : undefined,
      dueDay: formDueDay,
      paymentMode: formPaymentMode,
    };

    if (editingTemplate) {
      updateRecurringExpenseTemplate(editingTemplate.id, templatePayload);
    } else {
      addRecurringExpenseTemplate(templatePayload);
    }

    setIsModalOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Top Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 block">Total Scheduled Amounts</span>
            <span className="text-2xl font-black font-mono text-slate-900 mt-1 block">
              {stats.totalTemplates}
            </span>
            <span className="text-[10px] text-slate-400">Configured expenses</span>
          </div>
          <div className="h-10 w-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700">
            <Wallet className="h-5 w-5" />
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 block">Monthly Commitment</span>
            <span className="text-2xl font-black font-mono text-slate-900 mt-1 block">
              {formatCurrency(stats.monthlyCommitment)}
            </span>
            <span className="text-[10px] text-slate-400">Sum of defaults</span>
          </div>
          <div className="h-10 w-10 rounded-xl bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-700">
            <DollarSign className="h-5 w-5" />
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 block">Approved for {currentMonthKey}</span>
            <span className="text-2xl font-black font-mono text-emerald-700 mt-1 block">
              {stats.approvedCount} / {stats.totalTemplates}
            </span>
            <span className="text-[10px] text-emerald-600 font-medium">Logged in Cash Register</span>
          </div>
          <div className="h-10 w-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700">
            <CheckCircle2 className="h-5 w-5" />
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 block">Action Due / Overdue</span>
            <span className={`text-2xl font-black font-mono mt-1 block ${
              stats.pendingActionCount > 0 ? 'text-amber-700' : 'text-slate-900'
            }`}>
              {stats.pendingActionCount}
            </span>
            <span className="text-[10px] text-slate-400">Needs approval this month</span>
          </div>
          <div className={`h-10 w-10 rounded-xl border flex items-center justify-center ${
            stats.pendingActionCount > 0
              ? 'bg-amber-50 border-amber-200 text-amber-700'
              : 'bg-slate-50 border-slate-200 text-slate-400'
          }`}>
            <AlertTriangle className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* Action & Filter Toolbar */}
      <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
            <Building className="h-3.5 w-3.5 text-blue-600" />
            <span>Filter Branch:</span>
          </span>
          <select
            value={selectedBranchFilter}
            onChange={(e) => setSelectedBranchFilter(e.target.value)}
            className="text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="all">All Branches (Consolidated)</option>
            {BRANCHES.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.shortCode})
              </option>
            ))}
          </select>
        </div>

        {canManageItems && (
          <button
            type="button"
            onClick={handleOpenAddModal}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
          >
            <Plus className="h-4 w-4" />
            <span>Add Scheduled Amount</span>
          </button>
        )}
      </div>

      {/* Templates Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div>
            <h3 className="text-sm font-extrabold text-slate-900">
              Scheduled Monthly Expenses
            </h3>
            <p className="text-xs text-slate-500">
              Scheduled overheads (Rent, Electricity, Telecom) with automated reminders and 1-click Cash Register approval.
            </p>
          </div>
          <span className="text-xs font-mono font-bold text-slate-500">
            {filteredTemplates.length} Scheduled
          </span>
        </div>

        {filteredTemplates.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Wallet className="h-10 w-10 mx-auto text-slate-300 mb-2" />
            <p className="font-bold text-sm text-slate-600">No scheduled amounts found</p>
            <p className="text-xs mt-1">Click "Add Scheduled Amount" above to set up rent, utility bills, or subscriptions.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-bold uppercase text-[10px] border-b border-slate-200">
                  <th className="py-3 px-4">Expense Name</th>
                  <th className="py-3 px-4">Branch Facility</th>
                  <th className="py-3 px-4">Schedule & Due Day</th>
                  <th className="py-3 px-4 text-right">Scheduled Amount</th>
                  <th className="py-3 px-4 text-center">Payment Mode</th>
                  <th className="py-3 px-4">Status for {currentMonthKey}</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTemplates.map((template) => {
                  const branchObj = BRANCHES.find((b) => b.id === template.branchId);
                  const isDueThisMonth = isExpenseDueInMonth(template, currentMonthNumber);
                  const isApproved = isExpenseApprovedForMonth(template, currentMonthKey);
                  const isOverdue = isDueThisMonth && !isApproved && currentDay > template.dueDay;
                  const isDueToday = isDueThisMonth && !isApproved && currentDay === template.dueDay;

                  return (
                    <tr key={template.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900">{template.name}</div>
                        <span className="text-[10px] font-mono text-slate-400">
                          {template.id}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 font-medium text-slate-700">
                        <div className="flex items-center gap-1.5">
                          <Building className="h-3 w-3 text-slate-400" />
                          <span>{branchObj?.name || template.branchId}</span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 font-medium text-slate-700">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                          <span className="font-semibold text-slate-800">
                            {formatExpenseSchedule(template)}
                          </span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-right font-mono font-black text-slate-900 text-sm">
                        {formatCurrency(template.defaultAmount)}
                      </td>

                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border ${
                            template.paymentMode === 'Cash'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-blue-50 text-blue-700 border-blue-200'
                          }`}
                        >
                          {template.paymentMode === 'Cash' ? (
                            <DollarSign className="h-2.5 w-2.5" />
                          ) : (
                            <CreditCard className="h-2.5 w-2.5" />
                          )}
                          <span>{template.paymentMode}</span>
                        </span>
                      </td>

                      <td className="py-3.5 px-4">
                        {isApproved ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                            <span>Approved for {currentMonthKey}</span>
                          </span>
                        ) : !isDueThisMonth ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-slate-100 text-slate-500 border border-slate-200">
                            <Clock className="h-3 w-3 text-slate-400" />
                            <span>Not due this month</span>
                          </span>
                        ) : isOverdue ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-50 text-rose-800 border border-rose-200">
                            <AlertTriangle className="h-3 w-3 text-rose-600" />
                            <span>Overdue (Day {template.dueDay})</span>
                          </span>
                        ) : isDueToday ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                            <Clock className="h-3 w-3 text-amber-600" />
                            <span>Due Today</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                            <Clock className="h-3 w-3 text-slate-400" />
                            <span>Upcoming on {template.dueDay}th</span>
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Approve Action if due this month and not yet approved */}
                          {!isApproved && isDueThisMonth && canManageItems && (
                            <button
                              type="button"
                              onClick={() => onQuickApprove(template)}
                              className="px-2.5 py-1 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors flex items-center gap-1 shadow-2xs"
                              title="Approve into today's Cash Register"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              <span>Approve</span>
                            </button>
                          )}


                          {/* Edit Template */}
                          {canManageItems && (
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(template)}
                              className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition-colors"
                              title="Edit Template"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                          )}

                          {/* Delete Template */}
                          {canManageItems && (
                            <button
                              type="button"
                              onClick={() => handleDelete(template.id, template.name)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                              title="Delete Template"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Scheduled Amount Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">
                    {editingTemplate ? 'Edit Scheduled Amount' : 'New Scheduled Amount'}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Configure monthly scheduled overheads & reminder triggers
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSave} className="p-6 space-y-4">
              {/* Template Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700">
                  Expense Name / Description *
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Showroom Rent, EB Electricity Bill, Airtel Internet"
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 text-slate-900"
                />
              </div>

              {/* Branch & Default Amount Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700">
                    Branch Facility *
                  </label>
                  <select
                    value={formBranchId}
                    onChange={(e) => setFormBranchId(e.target.value as BranchId)}
                    className="w-full px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  >
                    {BRANCHES.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700">
                    Default Amount (₹) *
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 font-mono text-xs">
                      ₹
                    </div>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      required
                      value={formAmount || ''}
                      onChange={(e) => setFormAmount(Math.max(0, Number(e.target.value)))}
                      placeholder="e.g. 15000"
                      className="w-full pl-8 pr-3 py-2 text-xs font-mono font-bold bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 text-slate-900"
                    />
                  </div>
                </div>
              </div>

              {/* Frequency & Cycle Grid */}
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700">
                      Frequency *
                    </label>
                    <select
                      value={formFrequency}
                      onChange={(e) => setFormFrequency(e.target.value as ExpenseFrequency)}
                      className="w-full px-3 py-2 text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 text-slate-900"
                    >
                      <option value="Monthly">Monthly</option>
                      <option value="Quarterly">Quarterly</option>
                      <option value="Half-Yearly">Half-Yearly</option>
                      <option value="Yearly">Yearly</option>
                    </select>
                  </div>

                  {formFrequency !== 'Monthly' && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-700">
                        Starting Month *
                      </label>
                      <select
                        value={formStartMonth}
                        onChange={(e) => setFormStartMonth(Number(e.target.value))}
                        className="w-full px-3 py-2 text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 text-slate-900"
                      >
                        {MONTH_NAMES.map((name, idx) => (
                          <option key={idx + 1} value={idx + 1}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className={`space-y-1.5 ${formFrequency === 'Monthly' ? '' : 'sm:col-span-2'}`}>
                    <label className="text-xs font-bold text-slate-700">
                      Due Day of Month (1–31) *
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min="1"
                        max="31"
                        required
                        value={formDueDay || ''}
                        onChange={(e) =>
                          setFormDueDay(Math.min(31, Math.max(1, Number(e.target.value))))
                        }
                        placeholder="e.g. 5 for 5th"
                        className="w-full px-3 py-2 text-xs font-mono font-bold bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 text-slate-900"
                      />
                      <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400 text-xs">
                        th of month
                      </div>
                    </div>
                  </div>
                </div>

                {/* Explanatory cycle pill for non-monthly */}
                {formFrequency !== 'Monthly' && (
                  <div className="p-2.5 rounded-xl bg-blue-50/70 border border-blue-200 text-xs text-blue-900 flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                    <span>
                      Cycle: Due on day {formDueDay} in{' '}
                      <strong>
                        {formFrequency === 'Quarterly'
                          ? [
                              MONTH_NAMES[formStartMonth - 1],
                              MONTH_NAMES[(formStartMonth - 1 + 3) % 12],
                              MONTH_NAMES[(formStartMonth - 1 + 6) % 12],
                              MONTH_NAMES[(formStartMonth - 1 + 9) % 12],
                            ].join(', ')
                          : formFrequency === 'Half-Yearly'
                          ? [
                              MONTH_NAMES[formStartMonth - 1],
                              MONTH_NAMES[(formStartMonth - 1 + 6) % 12],
                            ].join(' & ')
                          : MONTH_NAMES[formStartMonth - 1]}
                      </strong>
                    </span>
                  </div>
                )}
              </div>

              {/* Payment Mode Default */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700">
                  Default Payment Mode *
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormPaymentMode('Cash')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                      formPaymentMode === 'Cash'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-300 ring-2 ring-emerald-500/20 shadow-2xs'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <DollarSign className="h-3.5 w-3.5" />
                    <span>Cash</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormPaymentMode('GPay')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                      formPaymentMode === 'GPay'
                        ? 'bg-blue-50 text-blue-800 border-blue-300 ring-2 ring-blue-500/20 shadow-2xs'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <CreditCard className="h-3.5 w-3.5" />
                    <span>GPay / Digital</span>
                  </button>
                </div>
              </div>

              {/* Footer */}
              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-xs"
                >
                  {editingTemplate ? 'Update Scheduled Amount' : 'Save Scheduled Amount'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
