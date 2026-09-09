import React, { useState } from 'react';
import {
  Users,
  Search,
  Plus,
  Edit2,
  Trash2,
  Building2,
  KeyRound,
  Phone,
  CheckCircle2,
  XCircle,
  Lock,
  LogIn,
} from 'lucide-react';
import { Employee, BranchScope, BRANCHES } from '../../types';
import { useErp } from '../../context/ErpContext';
import { EmployeeModal } from './EmployeeModal';
import { AttendanceKioskModal } from './AttendanceKioskModal';
import { formatCurrency } from '../../lib/utils';

interface EmployeeMasterViewProps {
  onQuickClockIn?: (employeeId: string) => void;
}

export const EmployeeMasterView: React.FC<EmployeeMasterViewProps> = () => {
  const {
    employees,
    deleteEmployee,
    currentBranch,
    currentUser,
    canEditSalaries,
  } = useErp();

  const [searchQuery, setSearchQuery] = useState('');
  const [branchFilter, setBranchFilter] = useState<BranchScope>(currentBranch);
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [employeeToEdit, setEmployeeToEdit] = useState<Employee | null>(null);

  // Quick kiosk clock-in trigger
  const [kioskEmployeeId, setKioskEmployeeId] = useState<string | null>(null);

  // Filter employees
  const filteredEmployees = employees.filter((emp) => {
    // Branch scope filter
    const effectiveScope = branchFilter === 'all' ? null : branchFilter;
    if (effectiveScope && emp.branchId !== effectiveScope) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchName = emp.name.toLowerCase().includes(q);
      const matchDesig = emp.designation.toLowerCase().includes(q);
      const matchPhone = emp.phone?.toLowerCase().includes(q) || false;
      if (!matchName && !matchDesig && !matchPhone) return false;
    }

    return true;
  });

  const handleEdit = (emp: Employee) => {
    setEmployeeToEdit(emp);
    setIsEmployeeModalOpen(true);
  };

  const handleAddNew = () => {
    setEmployeeToEdit(null);
    setIsEmployeeModalOpen(true);
  };

  return (
    <div className="space-y-4">
      {/* Control Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search employees by name, role, or phone..."
            className="w-full pl-10 pr-4 py-2 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-100 bg-white"
          />
        </div>

        {/* Filters & Actions */}
        <div className="flex items-center gap-2.5">
          {currentUser.role !== 'Manager' && (
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value as BranchScope)}
              className="px-3 py-2 text-xs font-semibold rounded-xl border border-slate-300 bg-white text-slate-700 focus:outline-hidden focus:border-blue-500"
            >
              <option value="all">All Branches</option>
              {BRANCHES.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={handleAddNew}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-xl shadow-xs transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>Enroll Employee</span>
          </button>
        </div>
      </div>

      {/* Employee Directory Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 text-xs font-bold uppercase tracking-wider">
                <th className="py-3 px-4">Employee</th>
                <th className="py-3 px-4">Role & Designation</th>
                <th className="py-3 px-3">Branch</th>
                <th className="py-3 px-4 text-right">Monthly Salary (₹)</th>
                <th className="py-3 px-3 text-center">PIN</th>
                <th className="py-3 px-3 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <Users className="h-10 w-10 mx-auto text-slate-300 mb-2" />
                    <p className="text-sm font-medium text-slate-600">No employees found</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {searchQuery ? 'Adjust your search filters' : 'Enroll your first employee to enable attendance'}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredEmployees.map((emp) => {
                  const branchObj = BRANCHES.find((b) => b.id === emp.branchId);

                  return (
                    <tr key={emp.id} className="hover:bg-slate-50/70 transition-colors group">
                      {/* Name & ID */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-xl bg-blue-50 text-blue-700 border border-blue-200/60 font-bold flex items-center justify-center shrink-0 text-sm">
                            {emp.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">
                              {emp.name}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono">
                              Joined {emp.joinedDate}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Designation */}
                      <td className="py-3.5 px-4 text-slate-700">
                        <span className="font-medium text-slate-800">{emp.designation}</span>
                        {emp.phone && (
                          <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                            <Phone className="h-3 w-3" />
                            <span>{emp.phone}</span>
                          </div>
                        )}
                      </td>

                      {/* Branch */}
                      <td className="py-3.5 px-3">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-xs font-semibold">
                          <Building2 className="h-3 w-3 text-slate-400" />
                          {branchObj?.name || emp.branchId}
                        </span>
                      </td>

                      {/* Monthly Salary */}
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900">
                        {canEditSalaries ? (
                          formatCurrency(emp.monthlySalary)
                        ) : (
                          <span className="text-slate-400 font-sans text-xs italic flex items-center justify-end gap-1">
                            <Lock className="h-3 w-3" /> Confidential
                          </span>
                        )}
                      </td>

                      {/* Attendance PIN */}
                      <td className="py-3.5 px-3 text-center font-mono">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold">
                          <KeyRound className="h-3 w-3 text-slate-400" />
                          {emp.pin}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-3 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                            emp.status === 'Active'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-slate-100 text-slate-500 border-slate-200'
                          }`}
                        >
                          {emp.status === 'Active' ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : (
                            <XCircle className="h-3 w-3" />
                          )}
                          <span>{emp.status}</span>
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {/* Quick Clock-in shortcut */}
                          <button
                            onClick={() => setKioskEmployeeId(emp.id)}
                            title="Clock-In / Clock-Out for this employee"
                            className="p-1.5 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            <LogIn className="h-4 w-4" />
                          </button>

                          <button
                            onClick={() => handleEdit(emp)}
                            title="Edit profile"
                            className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>

                          {currentUser.role === 'CEO' && (
                            <button
                              onClick={() => {
                                if (window.confirm(`Delete employee profile "${emp.name}"?`)) {
                                  deleteEmployee(emp.id);
                                }
                              }}
                              title="Remove employee"
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Employee Edit/Create Modal */}
      <EmployeeModal
        isOpen={isEmployeeModalOpen}
        onClose={() => setIsEmployeeModalOpen(false)}
        employeeToEdit={employeeToEdit}
      />

      {/* Quick Attendance Kiosk for this employee */}
      {kioskEmployeeId && (
        <AttendanceKioskModal
          isOpen={Boolean(kioskEmployeeId)}
          onClose={() => setKioskEmployeeId(null)}
          preSelectedEmployeeId={kioskEmployeeId}
        />
      )}
    </div>
  );
};
