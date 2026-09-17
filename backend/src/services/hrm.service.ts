import { prisma } from '../db.js';
import { AppError } from '../middleware/errorHandler.js';
import { nowIso, rid } from '../lib/stockLedger.js';

const snap = async (tx: any) => ({
  attendanceRecords: await tx.attendanceRecord.findMany(),
  payrollRecords: await tx.payrollRecord.findMany(),
});

// Attendance date/time are recorded in India Standard Time (Asia/Kolkata), not
// the server's UTC — otherwise check-in/out times show a ~5:30h offset.
function istParts(now = new Date()): { date: string; time: string } {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(now);
  return { date, time };
}

export function clockIn(employeeId: string, photoDataUrl: string, location: any, customTime?: string) {
  return prisma.$transaction(async (tx: any) => {
    const emp = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!emp) throw new AppError('NOT_FOUND', 'Employee not found', 404);
    if (emp.status !== 'Active') throw new AppError('INACTIVE', 'Employee profile is inactive', 409);

    const now = new Date();
    const ist = istParts(now);
    const today = ist.date;
    const timeStr = customTime || ist.time;

    const existing = await tx.attendanceRecord.findFirst({ where: { employeeId, date: today } });
    if (existing && existing.checkInTime) {
      throw new AppError('ALREADY_IN', `${emp.name} has already checked in today at ${existing.checkInTime}`, 409);
    }

    await tx.attendanceRecord.create({
      data: {
        id: rid('att'), employeeId: emp.id, employeeName: emp.name, branchId: emp.branchId, date: today,
        checkInTime: timeStr, checkInPhoto: photoDataUrl, checkInLocation: location, status: 'Present',
        createdAt: now.toISOString(), updatedAt: now.toISOString(),
      },
    });
    return snap(tx);
  });
}

export function clockOut(employeeId: string, photoDataUrl: string, location: any, customTime?: string) {
  return prisma.$transaction(async (tx: any) => {
    const emp = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!emp) throw new AppError('NOT_FOUND', 'Employee not found', 404);

    const now = new Date();
    const ist = istParts(now);
    const today = ist.date;
    const timeStr = customTime || ist.time;

    const existing = await tx.attendanceRecord.findFirst({ where: { employeeId, date: today } });
    if (!existing) throw new AppError('NO_CHECKIN', `No check-in found for ${emp.name} today.`, 409);
    if (existing.checkOutTime) throw new AppError('ALREADY_OUT', `${emp.name} has already checked out at ${existing.checkOutTime}`, 409);

    const [inH, inM, inS] = existing.checkInTime.split(':').map(Number);
    const [outH, outM, outS] = timeStr.split(':').map(Number);
    const inMinutes = inH * 60 + inM + (inS || 0) / 60;
    const outMinutes = outH * 60 + outM + (outS || 0) / 60;
    const diffHours = Math.max(0, parseFloat(((outMinutes - inMinutes) / 60).toFixed(2)));

    await tx.attendanceRecord.update({
      where: { id: existing.id },
      data: { checkOutTime: timeStr, checkOutPhoto: photoDataUrl, checkOutLocation: location, hoursWorked: diffHours, updatedAt: now.toISOString() },
    });
    return snap(tx);
  });
}

export function updatePayrollAdjustment(employeeId: string, month: string, adjustment: number, reason: string | undefined, standardHoursPerMonth: number) {
  return prisma.$transaction(async (tx: any) => {
    const existing = await tx.payrollRecord.findFirst({ where: { employeeId, month } });
    if (existing) {
      // A disbursed payroll is locked — its paid amount can't be silently edited.
      if (existing.status === 'Paid') {
        throw new AppError('PAYROLL_PAID_LOCKED', 'This payroll is already disbursed (Paid) and cannot be adjusted.', 409);
      }
      const finalPayable = Math.max(0, Math.round(existing.computedPay + adjustment));
      await tx.payrollRecord.update({
        where: { id: existing.id },
        data: { manualAdjustment: adjustment, adjustmentReason: reason ?? null, finalPayable, updatedAt: nowIso() },
      });
    } else {
      const emp = await tx.employee.findUnique({ where: { id: employeeId } });
      if (!emp) throw new AppError('NOT_FOUND', 'Employee not found', 404);
      const hourlyRate = parseFloat((emp.monthlySalary / standardHoursPerMonth).toFixed(2));
      await tx.payrollRecord.create({
        data: {
          id: rid('pay'), employeeId: emp.id, employeeName: emp.name, designation: emp.designation, branchId: emp.branchId,
          month, monthlySalary: emp.monthlySalary, standardHoursPerMonth, hourlyRate, totalDaysPresent: 0,
          totalHoursWorked: 0, computedPay: 0, manualAdjustment: adjustment, adjustmentReason: reason ?? null,
          finalPayable: Math.max(0, adjustment), status: 'Draft', updatedAt: nowIso(),
        },
      });
    }
    return snap(tx);
  });
}

export function markPayrollPaid(payrollId: string, paymentMode: string, paymentReference?: string, record?: any) {
  return prisma.$transaction(async (tx: any) => {
    const ts = nowIso();
    // Match an existing persisted record: first by id, else by employee+month
    // (computed rows carry a synthetic "calc-…" id with no DB row yet).
    let existing = payrollId ? await tx.payrollRecord.findUnique({ where: { id: payrollId } }) : null;
    if (!existing && record?.employeeId && record?.month) {
      existing = await tx.payrollRecord.findFirst({ where: { employeeId: record.employeeId, month: record.month } });
    }

    if (existing) {
      await tx.payrollRecord.update({
        where: { id: existing.id },
        data: { status: 'Paid', paidAt: ts, paymentMode, paymentReference: paymentReference ?? null, updatedAt: ts },
      });
    } else if (record?.employeeId && record?.month) {
      // No persisted record yet — create one straight into Paid state using the
      // client's computed figures so the disbursement actually sticks.
      await tx.payrollRecord.create({
        data: {
          id: rid('pay'),
          employeeId: record.employeeId,
          employeeName: record.employeeName ?? '',
          designation: record.designation ?? '',
          branchId: record.branchId ?? '',
          month: record.month,
          monthlySalary: Number(record.monthlySalary) || 0,
          standardHoursPerMonth: Number(record.standardHoursPerMonth) || 0,
          hourlyRate: Number(record.hourlyRate) || 0,
          totalDaysPresent: Number(record.totalDaysPresent) || 0,
          totalHoursWorked: Number(record.totalHoursWorked) || 0,
          computedPay: Number(record.computedPay) || 0,
          manualAdjustment: Number(record.manualAdjustment) || 0,
          adjustmentReason: record.adjustmentReason ?? null,
          finalPayable: Number(record.finalPayable) || 0,
          status: 'Paid',
          paidAt: ts,
          paymentMode,
          paymentReference: paymentReference ?? null,
          updatedAt: ts,
        },
      });
    } else {
      // Legacy fallback: best-effort update by id.
      await tx.payrollRecord.updateMany({
        where: { id: payrollId },
        data: { status: 'Paid', paidAt: ts, paymentMode, paymentReference: paymentReference ?? null, updatedAt: ts },
      });
    }
    return snap(tx);
  });
}
