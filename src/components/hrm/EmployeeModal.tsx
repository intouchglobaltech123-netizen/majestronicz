import React, { useState, useEffect } from 'react';
import { X, User, KeyRound, Check, Lock, ShieldCheck } from 'lucide-react';
import { Employee, BranchId, Role } from '../../types';
import { useErp } from '../../context/ErpContext';

type LoginRole = '' | Extract<Role, 'Manager' | 'Billing' | 'Purchase' | 'Sales'>;
const LOGIN_ROLES: Exclude<LoginRole, ''>[] = ['Manager', 'Billing', 'Purchase', 'Sales'];

interface EmployeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  employeeToEdit?: Employee | null;
}

export const EmployeeModal: React.FC<EmployeeModalProps> = ({
  isOpen,
  onClose,
  employeeToEdit,
}) => {
  const {
    saveEmployee,
    currentBranch,
    currentUser,
    accessibleBranches,
    canEditSalaries,
    staffUsers,
    refreshStaffUsers,
    linkStaffLogin,
    unlinkStaffLogin,
  } = useErp();

  const isCEO = currentUser.role === 'CEO';
  const existingLogin = employeeToEdit ? staffUsers.find((u) => u.employeeId === employeeToEdit.id) : undefined;

  const [name, setName] = useState('');
  const [designation, setDesignation] = useState('');
  const [branchId, setBranchId] = useState<BranchId>('erode-hq');
  const [monthlySalary, setMonthlySalary] = useState<number>(20000);
  const [pin, setPin] = useState('1001');
  const [status, setStatus] = useState<'Active' | 'Inactive'>('Active');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [joinedDate, setJoinedDate] = useState(new Date().toISOString().split('T')[0]);
  const [loginRole, setLoginRole] = useState<LoginRole>('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // CEO needs the current staff-login list to know if this employee already has a login.
  useEffect(() => { if (isOpen && isCEO) refreshStaffUsers(); }, [isOpen, isCEO]);

  useEffect(() => {
    if (employeeToEdit) {
      setName(employeeToEdit.name);
      setDesignation(employeeToEdit.designation);
      setBranchId(employeeToEdit.branchId);
      setMonthlySalary(employeeToEdit.monthlySalary);
      setPin(employeeToEdit.pin);
      setStatus(employeeToEdit.status);
      setPhone(employeeToEdit.phone || '');
      setEmail(employeeToEdit.email || '');
      setJoinedDate(employeeToEdit.joinedDate);
      const linked = staffUsers.find((u) => u.employeeId === employeeToEdit.id);
      setLoginRole((linked?.role as LoginRole) || '');
    } else {
      setName('');
      setDesignation('');
      const defaultBranch =
        currentUser.role === 'Manager'
          ? currentUser.assignedBranchId || 'coimbatore'
          : currentBranch !== 'all'
          ? currentBranch
          : 'erode-hq';
      setBranchId(defaultBranch);
      setMonthlySalary(20000);
      setPin(String(Math.floor(1000 + Math.random() * 9000)));
      setStatus('Active');
      setPhone('');
      setEmail('');
      setJoinedDate(new Date().toISOString().split('T')[0]);
      setLoginRole('');
    }
    setErrors({});
  }, [employeeToEdit, isOpen]);

  if (!isOpen) return null;

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Full name is required';
    if (!designation.trim()) errs.designation = 'Role / Designation is required';
    if (!pin.trim() || pin.length < 4) errs.pin = '4-digit attendance PIN is required';
    // App login requires an exact 4-digit PIN (it doubles as the sign-in PIN).
    if (loginRole && !/^\d{4}$/.test(pin.trim())) errs.pin = 'App login needs an exact 4-digit PIN';
    if (monthlySalary <= 0) errs.salary = 'Monthly salary must be greater than 0';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || submitting) return;
    setSubmitting(true);

    const saved = saveEmployee({
      id: employeeToEdit?.id,
      name: name.trim(),
      designation: designation.trim(),
      branchId,
      monthlySalary: Number(monthlySalary),
      pin: pin.trim(),
      status,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      joinedDate,
    });

    // Attach / update / remove the app login (CEO only).
    if (isCEO) {
      if (loginRole) {
        const ok = await linkStaffLogin({
          employeeId: saved.id, role: loginRole, name: name.trim(),
          assignedBranchId: branchId, pin: pin.trim(), status,
        });
        if (!ok) { setSubmitting(false); return; } // keep modal open so PIN clash can be fixed
      } else if (existingLogin) {
        await unlinkStaffLogin(saved.id);
      }
    }

    setSubmitting(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-200/60">
              <User className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {employeeToEdit ? 'Edit Employee Profile' : 'Enroll New Employee'}
              </h3>
              <p className="text-xs text-slate-500">
                Staff credentials, branch allocation, and attendance access
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {/* Full Name */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Full Employee Name <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. K. Ramachandran"
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              autoFocus
            />
            {errors.name && <p className="text-xs text-rose-600 mt-1">{errors.name}</p>}
          </div>

          {/* Designation & Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Designation / Role <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                placeholder="e.g. Counter Staff"
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:border-blue-500"
              />
              {errors.designation && <p className="text-xs text-rose-600 mt-1">{errors.designation}</p>}
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Employment Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'Active' | 'Inactive')}
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:border-blue-500"
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
          </div>

          {/* Branch & Attendance PIN */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Branch Assignment <span className="text-rose-500">*</span>
              </label>
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value as BranchId)}
                disabled={currentUser.role === 'Manager'}
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
              >
                {accessibleBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Attendance PIN (4-digit) <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="1001"
                  className="w-full pl-9 pr-3 py-2 text-sm font-mono font-bold rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:border-blue-500"
                />
              </div>
              {errors.pin && <p className="text-xs text-rose-600 mt-1">{errors.pin}</p>}
            </div>
          </div>

          {/* Monthly Salary */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                Monthly Salary (₹ Fixed) <span className="text-rose-500">*</span>
              </label>
              {!canEditSalaries && (
                <span className="text-[11px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 flex items-center gap-1">
                  <Lock className="h-3 w-3" /> CEO Only
                </span>
              )}
            </div>
            <div className="relative">
              <span className="absolute left-3.5 top-2 text-sm font-bold text-slate-400">₹</span>
              <input
                type="number"
                min={0}
                step={1}
                value={monthlySalary}
                onChange={(e) => setMonthlySalary(Number(e.target.value))}
                disabled={!canEditSalaries}
                placeholder="20000"
                className="w-full pl-8 pr-3 py-2 text-sm font-bold font-mono rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Agreed full-month remuneration for 208 working hours (₹{(monthlySalary / 208).toFixed(2)}/hr)
            </p>
          </div>

          {/* Phone & Joined Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Contact Phone
              </label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 9842100000"
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Joined Date
              </label>
              <input
                type="date"
                value={joinedDate}
                onChange={(e) => setJoinedDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:border-blue-500"
              />
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Work Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. staff@majestronicz.com"
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:border-blue-500"
            />
          </div>

          {/* App Login Access (CEO only) — unifies staff creation with account access */}
          {isCEO && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-3.5">
              <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-blue-800 mb-1.5">
                <ShieldCheck className="h-3.5 w-3.5" /> App Login Access
              </label>
              <select
                value={loginRole}
                onChange={(e) => setLoginRole(e.target.value as LoginRole)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:border-blue-500"
              >
                <option value="">No app login (attendance only)</option>
                {LOGIN_ROLES.map((r) => (
                  <option key={r} value={r}>Can log in as {r}</option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 mt-1.5">
                {loginRole
                  ? `This staff member will sign in with the ${pin.length === 4 ? 'PIN above' : '4-digit PIN above'} and must reset it on first login. Manage access in Access Control.`
                  : existingLogin
                  ? 'Saving with “No app login” will remove this staff member’s ability to sign in.'
                  : 'Give this employee access to the app, or leave as attendance-only.'}
              </p>
            </div>
          )}

          {/* Footer Actions */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-xl shadow-xs transition-colors disabled:opacity-60"
            >
              <Check className="h-4 w-4" />
              <span>{submitting ? 'Saving…' : employeeToEdit ? 'Save Changes' : 'Enroll Employee'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
