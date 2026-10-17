import { Employee, AttendanceRecord, Invoice, PayrollRecord, attendanceDayWeight, daysInMonthOf } from '../types';

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
  /** Paid casual/sick-leave days allowed per month before LOP. Default 1. */
  casualLeaveQuota?: number;
}): PayrollRecord[] {
  const { employees, attendanceRecords, invoices, payrollRecords, month, standardHours, branchScope } = params;
  const quota = Math.max(0, Number(params.casualLeaveQuota ?? 1));
  const daysInMonth = daysInMonthOf(month);

  const targetEmployees = employees.filter((emp) => {
    if (branchScope && branchScope !== 'all' && emp.branchId !== branchScope) return false;
    return true;
  });

  return targetEmployees.map((emp) => {
    const empAttRaw = attendanceRecords.filter(
      (a) => a.employeeId === emp.id && a.date.startsWith(month)
    );
    // Defence against duplicate rows for the same calendar day (an older build
    // could create a register mark AND a clock-in row for one date, which
    // doubled payroll days — H1). Keep ONE record per date: prefer the one that
    // carries a real check-in / worked hours, else the latest-updated.
    const byDate = new Map<string, typeof empAttRaw[number]>();
    for (const a of empAttRaw) {
      const cur = byDate.get(a.date);
      if (!cur) { byDate.set(a.date, a); continue; }
      const aWorked = !!a.checkInTime || (a.hoursWorked || 0) > 0;
      const curWorked = !!cur.checkInTime || (cur.hoursWorked || 0) > 0;
      if (aWorked && !curWorked) byDate.set(a.date, a);
      else if (aWorked === curWorked && (a.updatedAt || '') > (cur.updatedAt || '')) byDate.set(a.date, a);
    }
    const empAtt = Array.from(byDate.values());
    // Count only days actually worked (Present = 1, Half-Day = 0.5); Absent /
    // Leave / Holiday / Week-Off register rows do not count as days present.
    const liveDaysPresent = empAtt.reduce((sum, a) => sum + attendanceDayWeight(a.status), 0);
    const liveHoursWorked = empAtt.reduce((sum, a) => sum + (a.hoursWorked || 0), 0);

    // Salary is stripped from the data non-CEO roles receive (SEC2-2), so
    // emp.monthlySalary is undefined for them — guard the division so the row
    // shows ₹0 rather than ₹NaN (HRM3-3).
    const salary = Number(emp.monthlySalary) || 0;
    const liveHourlyRate = standardHours > 0 ? parseFloat((salary / standardHours).toFixed(2)) : 0;

    // DAY-BASED Loss-of-Pay (client rule, Oct 2026): pay the FULL monthly salary
    // and deduct only for unpaid days — never hour-based. A day's worth of salary
    // is monthlySalary ÷ the real calendar days in that month (so 30- and 31-day
    // months, and 4- or 5-Sunday months, are handled automatically). Sundays
    // (Week Off) and Holidays are always free; Casual + Sick leave are free up to
    // the monthly quota, and anything beyond — plus Absent days and half of each
    // Half-Day — is Loss of Pay.
    const perDaySalary = daysInMonth > 0 ? salary / daysInMonth : 0;
    const absentDays = empAtt.filter((a) => a.status === 'Absent').length;
    const halfDays = empAtt.filter((a) => a.status === 'Half-Day').length;
    const leaveDays = empAtt.filter((a) => a.status === 'Casual Leave' || a.status === 'Sick Leave').length;
    const paidLeaveDays = Math.min(leaveDays, quota);
    const excessLeave = Math.max(0, leaveDays - quota);
    const liveLopDays = Math.round((absentDays + 0.5 * halfDays + excessLeave) * 100) / 100;
    const liveLopDeduction = Math.round(liveLopDays * perDaySalary);
    const liveComputedPay = Math.max(0, Math.round(salary - liveLopDeduction));

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
    // Day-based breakdown: use the stored values on a locked row; fall back to
    // deriving them so a row paid by an older (hour-based) build still shows a
    // sensible LOP breakdown instead of blanks.
    const lopDeduction = locked
      ? (existingRec!.lopDeduction ?? Math.max(0, Math.round((existingRec!.monthlySalary || 0) - existingRec!.computedPay)))
      : liveLopDeduction;
    const outDaysInMonth = locked ? (existingRec!.daysInMonth ?? daysInMonth) : daysInMonth;
    const outPerDaySalary = locked
      ? (existingRec!.perDaySalary ?? (outDaysInMonth > 0 ? (existingRec!.monthlySalary || 0) / outDaysInMonth : 0))
      : perDaySalary;
    const outLopDays = locked
      ? (existingRec!.lopDays ?? (outPerDaySalary > 0 ? Math.round((lopDeduction / outPerDaySalary) * 100) / 100 : 0))
      : liveLopDays;
    const outPaidLeaveDays = locked ? (existingRec!.paidLeaveDays ?? 0) : paidLeaveDays;

    return {
      id: existingRec?.id || `calc-${emp.id}-${month}`,
      employeeId: emp.id,
      employeeName: emp.name,
      designation: emp.designation,
      branchId: emp.branchId,
      month,
      monthlySalary: salary,
      standardHoursPerMonth: standardHours,
      hourlyRate,
      totalDaysPresent,
      totalHoursWorked,
      computedPay,
      daysInMonth: outDaysInMonth,
      perDaySalary: Math.round(outPerDaySalary * 100) / 100,
      lopDays: outLopDays,
      lopDeduction,
      paidLeaveDays: outPaidLeaveDays,
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

/** Employee status is 'Active' / 'Inactive'; rows saved by older builds carry the
 *  login's lowercase 'active' / 'disabled' (UPG9-9) — read both. */
export const isActiveEmployee = (e: { status?: string | null }) => String(e?.status || '').toLowerCase() === 'active';
