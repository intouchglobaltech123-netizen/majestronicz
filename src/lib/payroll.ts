import { Employee, AttendanceRecord, Invoice, PayrollRecord } from '../types';

/**
 * Single source of truth for monthly payroll rows — live from attendance +
 * salesperson incentives + any saved adjustments/paid status. Used by BOTH the
 * Attendance › Payroll screen and the Payroll Report so their figures agree
 * (previously the report read only sparse saved records and diverged).
 *
 * `branchScope`: a branch id to restrict to, or 'all' for every branch.
 */
export function computePayrollRows(params: {
  employees: Employee[];
  attendanceRecords: AttendanceRecord[];
  invoices: Invoice[];
  payrollRecords: PayrollRecord[];
  month: string; // YYYY-MM
  standardHours: number;
  branchScope: string; // branch id or 'all'
}): PayrollRecord[] {
  const { employees, attendanceRecords, invoices, payrollRecords, month, standardHours, branchScope } = params;

  const targetEmployees = employees.filter((emp) => {
    if (branchScope && branchScope !== 'all' && emp.branchId !== branchScope) return false;
    return true;
  });

  return targetEmployees.map((emp) => {
    const empAtt = attendanceRecords.filter(
      (a) => a.employeeId === emp.id && a.date.startsWith(month)
    );
    const totalDaysPresent = empAtt.length;
    const totalHoursWorked = empAtt.reduce((sum, a) => sum + (a.hoursWorked || 0), 0);

    const hourlyRate = parseFloat((emp.monthlySalary / standardHours).toFixed(2));
    const computedPay = Math.round(hourlyRate * totalHoursWorked);

    const existingRec = payrollRecords.find((p) => p.employeeId === emp.id && p.month === month);

    const incentiveEarned = Math.round(
      invoices
        .filter((inv) => !inv.isVoided && inv.salespersonId === emp.id && (inv.date || '').startsWith(month))
        .reduce((sum, inv) => {
          const amt = inv.incentiveAmount || 0;
          if (!amt) return sum;
          const gross = inv.grandTotal || 0;
          const netRatio = gross > 0 ? Math.max(0, gross - (inv.totalReturnedAmount || 0)) / gross : 0;
          return sum + amt * netRatio;
        }, 0)
    );

    const manualAdjustment = existingRec?.manualAdjustment || 0;
    const adjustmentReason = existingRec?.adjustmentReason;
    const finalPayable = Math.max(0, computedPay + incentiveEarned + manualAdjustment);
    const status = existingRec?.status || 'Draft';

    return {
      id: existingRec?.id || `calc-${emp.id}-${month}`,
      employeeId: emp.id,
      employeeName: emp.name,
      designation: emp.designation,
      branchId: emp.branchId,
      month,
      monthlySalary: emp.monthlySalary,
      standardHoursPerMonth: standardHours,
      hourlyRate,
      totalDaysPresent,
      totalHoursWorked,
      computedPay,
      incentiveEarned,
      manualAdjustment,
      adjustmentReason,
      finalPayable,
      status,
      paidAt: existingRec?.paidAt,
      paymentMode: existingRec?.paymentMode,
      paymentReference: existingRec?.paymentReference,
      updatedAt: existingRec?.updatedAt || new Date().toISOString(),
    } as PayrollRecord;
  });
}
