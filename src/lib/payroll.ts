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
    const liveDaysPresent = empAtt.length;
    const liveHoursWorked = empAtt.reduce((sum, a) => sum + (a.hoursWorked || 0), 0);

    const liveHourlyRate = parseFloat((emp.monthlySalary / standardHours).toFixed(2));
    const liveComputedPay = Math.round(liveHourlyRate * liveHoursWorked);

    const existingRec = payrollRecords.find((p) => p.employeeId === emp.id && p.month === month);

    const liveIncentive = Math.round(
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
    const liveFinalPayable = Math.max(0, liveComputedPay + liveIncentive + manualAdjustment);
    const status = existingRec?.status || 'Draft';

    // A disbursed (Paid) payroll is locked: show the STORED figures that were
    // actually paid out, not a live recomputation from current attendance /
    // incentives (which the backend also refuses to change).
    const locked = status === 'Paid' && !!existingRec;
    const totalDaysPresent = locked ? existingRec!.totalDaysPresent : liveDaysPresent;
    const totalHoursWorked = locked ? existingRec!.totalHoursWorked : liveHoursWorked;
    const hourlyRate = locked ? existingRec!.hourlyRate : liveHourlyRate;
    const computedPay = locked ? existingRec!.computedPay : liveComputedPay;
    const finalPayable = locked ? existingRec!.finalPayable : liveFinalPayable;
    const incentiveEarned = locked
      ? (existingRec!.incentiveEarned ??
          Math.max(0, existingRec!.finalPayable - existingRec!.computedPay - (existingRec!.manualAdjustment || 0)))
      : liveIncentive;

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
