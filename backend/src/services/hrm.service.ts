import { prisma } from '../db.js';
import { AppError } from '../middleware/errorHandler.js';
import { nowIso, rid } from '../lib/stockLedger.js';
import { assertBranchAllowed } from '../lib/branchGuard.js';
import { serializableTx } from '../lib/tx.js';
import { hashPin, hashPinCandidates, isPinHashed } from '../lib/auth.js';
import { istToday, assertDayOpen } from '../lib/businessDate.js';
import { nextReceiptNumber } from './payment.service.js';

const snap = async (tx: any) => ({
  attendanceRecords: await tx.attendanceRecord.findMany(),
  payrollRecords: await tx.payrollRecord.findMany(),
});

/**
 * Verify a kiosk PIN on the SERVER (SEC2-2). The PIN is never sent to the
 * browser any more, so the attendance kiosk asks the server to check it instead
 * of comparing client-side against a PIN in the bootstrap payload.
 *
 * SEC6-2: this endpoint returns a plain match/no-match, so without a limit a
 * Manager (the whole /hrm router is behind hrm:write) could brute-force any
 * staff member's 4-digit PIN. Lock a given employee's PIN check after a few
 * wrong tries, mirroring the login lockout.
 */
const KIOSK_MAX_FAILS = 5;
const KIOSK_LOCK_MS = 60_000;
const kioskPinAttempts = new Map<string, { fails: number; lockUntil: number }>();

export async function verifyKioskPin(employeeId: string, pin: string, reqUser?: any): Promise<{ ok: boolean }> {
  const key = String(employeeId || '');
  const now = Date.now();
  const rec = kioskPinAttempts.get(key) ?? { fails: 0, lockUntil: 0 };
  if (rec.lockUntil > now) {
    const secs = Math.ceil((rec.lockUntil - now) / 1000);
    throw new AppError('LOCKED', `Too many PIN attempts. Try again in ${secs}s.`, 429);
  }

  const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
  // SEC6-2: a branch-locked Manager must not be able to test staff PINs in other
  // branches — only verify staff of a branch the caller is allowed to operate in.
  if (emp) assertBranchAllowed(reqUser, emp.branchId);
  // Stored PIN is hashed (SEC6-2); match the hash, or a legacy plaintext value.
  const entered = String(pin || '').trim();
  const stored = String(emp?.pin || '');
  const legacyPlain = !!emp && !!stored && !isPinHashed(stored) && stored === entered;
  const ok = !!emp && (hashPinCandidates(entered).includes(stored) || legacyPlain);
  // SEC10-2: a plaintext (older) PIN, or one hashed with a previous secret, is
  // re-stored hashed on its first successful check.
  if (ok && emp && stored !== hashPin(entered)) {
    await prisma.employee.update({ where: { id: emp.id }, data: { pin: hashPin(entered) } });
  }

  if (ok) {
    kioskPinAttempts.delete(key);
  } else {
    rec.fails += 1;
    if (rec.fails >= KIOSK_MAX_FAILS) {
      rec.lockUntil = now + KIOSK_LOCK_MS;
      rec.fails = 0;
    }
    kioskPinAttempts.set(key, rec);
  }
  return { ok };
}

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

// Duration of a shift in hours, correct across a midnight boundary — an overnight
// shift (e.g. in 22:00, out 06:00) has its check-out on a later calendar day than
// its check-in, so we add the whole-day gap between the two dates.
function shiftHours(inDate: string, inTime: string, outDate: string, outTime: string): number {
  const [inH, inM, inS] = inTime.split(':').map(Number);
  const [outH, outM, outS] = outTime.split(':').map(Number);
  const inMinutes = inH * 60 + inM + (inS || 0) / 60;
  const outMinutes = outH * 60 + outM + (outS || 0) / 60;
  const dayDiff = Math.max(0, Math.round((Date.parse(outDate) - Date.parse(inDate)) / 86400000));
  return Math.max(0, parseFloat(((dayDiff * 1440 + outMinutes - inMinutes) / 60).toFixed(2)));
}

/**
 * Keep only a real GPS fix: numeric latitude/longitude (plus optional accuracy
 * and a short label). Anything else is stored as "no location" — a location
 * object without coordinates crashed the Attendance screen (HRM8-1), and a
 * client must not be able to store a made-up "Verified" fix without GPS (HRM-7).
 */
function cleanLocation(loc: any): any {
  if (!loc || typeof loc !== 'object') return null;
  const lat = loc.latitude, lng = loc.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const out: any = { latitude: lat, longitude: lng };
  if (typeof loc.accuracy === 'number' && Number.isFinite(loc.accuracy)) out.accuracy = loc.accuracy;
  if (typeof loc.addressHint === 'string') out.addressHint = loc.addressHint.slice(0, 120);
  return out;
}

/** Employee status is 'Active'; older rows saved the login's lowercase 'active' (HRM6-4). */
const isActiveStatus = (s: unknown) => s === 'Active' || s === 'active';

/** A manual clock time must be HH:mm or HH:mm:ss (24-hour) — reject "banana" etc. */
const isValidClockTime = (t?: string): boolean => !t || /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(t).trim());

export function clockIn(employeeId: string, photoDataUrl: string, location: any, customTime?: string, reqUser?: any) {
  return prisma.$transaction(async (tx: any) => {
    const emp = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!emp) throw new AppError('NOT_FOUND', 'Employee not found', 404);
    if (!isActiveStatus(emp.status)) throw new AppError('INACTIVE', 'Employee profile is inactive', 409);
    // A branch-locked user can only clock in their own branch's staff, and a
    // manual time must be a real HH:mm — "banana" is rejected (VAL-1).
    assertBranchAllowed(reqUser, emp.branchId);
    if (!isValidClockTime(customTime)) throw new AppError('BAD_TIME', 'Clock-in time must be HH:mm (24-hour).', 400);

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
        id: rid('att'), employeeId: emp.id, employeeName: emp.name, branchId: emp.branchId || 'erode-hq', date: today,
        checkInTime: timeStr, checkInPhoto: photoDataUrl || null, checkInLocation: cleanLocation(location), status: 'Present',
        createdAt: now.toISOString(), updatedAt: now.toISOString(),
      },
    });
    return snap(tx);
  });
}

export function clockOut(employeeId: string, photoDataUrl: string, location: any, customTime?: string, reqUser?: any) {
  return prisma.$transaction(async (tx: any) => {
    const emp = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!emp) throw new AppError('NOT_FOUND', 'Employee not found', 404);
    assertBranchAllowed(reqUser, emp.branchId); // only this branch's staff
    if (!isValidClockTime(customTime)) throw new AppError('BAD_TIME', 'Clock-out time must be HH:mm (24-hour).', 400);

    const now = new Date();
    const ist = istParts(now);
    const today = ist.date;
    const timeStr = customTime || ist.time;

    // Close the most recent OPEN shift (a check-in with no check-out yet), even
    // if it was opened the previous day — otherwise an overnight shift can never
    // be clocked out because no record exists for "today".
    const existing = await tx.attendanceRecord.findFirst({
      where: { employeeId, checkOutTime: null },
      orderBy: [{ date: 'desc' }, { checkInTime: 'desc' }],
    });
    if (!existing) throw new AppError('NO_CHECKIN', `No open check-in found for ${emp.name}.`, 409);

    const diffHours = Math.min(16, shiftHours(existing.date, existing.checkInTime, today, timeStr)); // cap a stale open shift (HRM3-5)

    await tx.attendanceRecord.update({
      where: { id: existing.id },
      data: { checkOutTime: timeStr, checkOutPhoto: photoDataUrl, checkOutLocation: cleanLocation(location), hoursWorked: diffHours, updatedAt: now.toISOString() },
    });
    return snap(tx);
  });
}

/**
 * Self check-in/out for the CURRENTLY LOGGED-IN user's own linked employee.
 * Any authenticated role can call this (no hrm:write needed) but it can only
 * ever act on their own employeeId — the mode (in/out) is auto-detected.
 * Returns only that one record (no exposure of other staff).
 */
export function selfClock(employeeId: string, photoDataUrl: string, location: any) {
  return prisma.$transaction(async (tx: any) => {
    const emp = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!emp) throw new AppError('NO_PROFILE', 'No attendance profile is linked to your account.', 404);
    if (!isActiveStatus(emp.status)) throw new AppError('INACTIVE', 'Your attendance profile is inactive.', 409);

    const now = new Date();
    const ist = istParts(now);
    const today = ist.date;

    // An open shift (check-in without a check-out) is clocked out first — it may
    // have been opened yesterday for an overnight shift, so we don't restrict to
    // today's record.
    const openShift = await tx.attendanceRecord.findFirst({
      where: { employeeId, checkOutTime: null },
      orderBy: [{ date: 'desc' }, { checkInTime: 'desc' }],
    });
    if (openShift) {
      const diffHours = Math.min(16, shiftHours(openShift.date, openShift.checkInTime, today, ist.time)); // cap a stale open shift (HRM3-5)
      const record = await tx.attendanceRecord.update({
        where: { id: openShift.id },
        data: { checkOutTime: ist.time, checkOutPhoto: photoDataUrl, checkOutLocation: cleanLocation(location), hoursWorked: diffHours, updatedAt: now.toISOString() },
      });
      return { action: 'out', record };
    }

    // No open shift: if today's shift is already complete there's nothing to do.
    const todayRecord = await tx.attendanceRecord.findFirst({ where: { employeeId, date: today } });
    if (todayRecord?.checkOutTime) {
      return { action: 'done', record: todayRecord };
    }
    const record = await tx.attendanceRecord.create({
      data: {
        id: rid('att'), employeeId: emp.id, employeeName: emp.name, branchId: emp.branchId || 'erode-hq', date: today,
        checkInTime: ist.time, checkInPhoto: photoDataUrl || null, checkInLocation: cleanLocation(location), status: 'Present',
        createdAt: now.toISOString(), updatedAt: now.toISOString(),
      },
    });
    return { action: 'in', record };
  });
}

/** The current user's own attendance record for today (or null). */
export async function getSelfToday(employeeId: string) {
  const ist = istParts();
  const record = await prisma.attendanceRecord.findFirst({ where: { employeeId, date: ist.date } });
  return { record: record || null, today: ist.date };
}

/**
 * Payroll writes act on one employee: a branch-locked user (a Manager granted
 * payroll rights) may only touch their own branch's staff; the CEO acts on all.
 * Checked against the employee's stored branch, and the payroll row's branch.
 */
async function assertPayrollBranch(tx: any, reqUser: any, employeeId: string | undefined, rowBranchId?: string | null) {
  if (!reqUser || reqUser.role === 'CEO') return;
  const emp = employeeId ? await tx.employee.findUnique({ where: { id: String(employeeId) }, select: { branchId: true } }) : null;
  assertBranchAllowed(reqUser, emp?.branchId ?? null);
  assertBranchAllowed(reqUser, rowBranchId ?? null);
}

/** HRM10-3: a payroll month is a real YYYY-MM. */
const assertPayrollMonth = (month: unknown): string => {
  const m = String(month ?? '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m) || m < '2010-01') throw new AppError('BAD_MONTH', 'The payroll month must be a real month (YYYY-MM).', 400);
  return m;
};
/** HRM10-3: a money figure on a payroll row — a real number within reason. */
const assertPayrollAmount = (v: unknown, what: string, { min = 0 } = {}): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || Math.abs(n) > 10_000_000) throw new AppError('BAD_AMOUNT', `${what} must be a number${min >= 0 ? ' of zero or more' : ''}, at most ₹1 crore.`, 400);
  return Math.round(n * 100) / 100;
};
export const PAYROLL_MODES = ['Cash', 'Bank Transfer'] as const;

export function updatePayrollAdjustment(employeeId: string, month: string, adjustment: number, reason: string | undefined, standardHoursPerMonth: number, reqUser?: any) {
  month = assertPayrollMonth(month);
  adjustment = assertPayrollAmount(adjustment, 'The adjustment', { min: -10_000_000 });
  const hours = Number(standardHoursPerMonth);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 744) throw new AppError('BAD_HOURS', 'Standard hours per month must be between 1 and 744.', 400);
  return prisma.$transaction(async (tx: any) => {
    // HRM10-3: only a real employee has a payroll.
    if (!(await tx.employee.findUnique({ where: { id: String(employeeId || '') }, select: { id: true } }))) throw new AppError('NOT_FOUND', 'Employee not found', 404);
    const existing = await tx.payrollRecord.findFirst({ where: { employeeId, month } });
    await assertPayrollBranch(tx, reqUser, employeeId, existing?.branchId);
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

export function markPayrollPaid(payrollId: string, paymentMode: string, paymentReference?: string, record?: any, actorName?: string, reqUser?: any) {
  // E2E7-6: a call without a payrollId used to fall through to a legacy
  // `updateMany({ where: { id: undefined } })`, which Prisma reads as "no
  // filter" — every payroll row became Paid and paid rows lost their payment
  // reference. Require the row being paid.
  const id = typeof payrollId === 'string' ? payrollId.trim() : '';
  if (!id) throw new AppError('PAYROLL_ID_REQUIRED', 'Choose the payroll row to mark as paid.', 400);
  if (!String(paymentMode || '').trim()) throw new AppError('PAYMENT_MODE_REQUIRED', 'Choose how the salary was paid.', 400);
  // HRM10-3: a salary is paid in Cash or by Bank Transfer (not "Bitcoin"), and
  // the figures sent with the row are real (no negative final pay).
  const asked = String(paymentMode).trim().toLowerCase();
  const mode = PAYROLL_MODES.find((m) => m.toLowerCase() === asked) ?? (asked === 'bank' ? 'Bank Transfer' : undefined);
  if (!mode) throw new AppError('BAD_MODE', "A salary is paid in Cash or by Bank Transfer.", 400);
  paymentMode = mode;
  if (record) {
    if (record.month !== undefined) assertPayrollMonth(record.month);
    for (const k of ['monthlySalary', 'computedPay', 'finalPayable', 'totalHoursWorked', 'totalDaysPresent', 'hourlyRate', 'standardHoursPerMonth']) {
      if (record[k] !== undefined && record[k] !== null) assertPayrollAmount(record[k], k);
    }
    if (record.manualAdjustment !== undefined && record.manualAdjustment !== null) assertPayrollAmount(record.manualAdjustment, 'manualAdjustment', { min: -10_000_000 });
  }
  // Serializable + retry so two people pressing "Mark Paid" at the same moment
  // can't both pay the row — the second serialises after the first and sees it as
  // already Paid (HRM6-3).
  return serializableTx(async (tx: any) => {
    const ts = nowIso();
    // Match an existing persisted record: first by id, else by employee+month
    // (computed rows carry a synthetic "calc-…" id with no DB row yet).
    let existing = await tx.payrollRecord.findUnique({ where: { id } });
    if (!existing && record?.employeeId && record?.month) {
      existing = await tx.payrollRecord.findFirst({ where: { employeeId: record.employeeId, month: record.month } });
    }
    await assertPayrollBranch(tx, reqUser, existing?.employeeId ?? record?.employeeId, existing?.branchId ?? record?.branchId);
    // FIN-B-10: a month that hasn't started can't be paid (nothing is earned yet).
    const payMonth = String(existing?.month ?? record?.month ?? '');
    if (payMonth && payMonth > istToday().slice(0, 7)) {
      throw new AppError('FUTURE_MONTH', `Salary for ${payMonth} can't be paid before that month.`, 400);
    }

    if (existing) {
      // HRM6-2: a disbursed payroll row is final. Without this, re-posting "Mark
      // Paid" (a duplicated/stale client row, or a direct API call — the UI only
      // hides the button) overwrote finalPayable with a new client figure and
      // reset paidAt, i.e. paid the same row again for a different amount. Same
      // lock as updatePayrollAdjustment.
      if (existing.status === 'Paid') {
        throw new AppError('PAYROLL_PAID_LOCKED', 'This payroll is already disbursed (Paid) and cannot be paid again.', 409);
      }
      // HRM3-4: freeze the disbursed figures at what was actually computed and
      // shown when Pay was clicked. computePayrollRows locks a Paid row to its
      // STORED amount, so if we only flipped the status the row would lock to a
      // stale/zero finalPayable (e.g. a prior Draft) instead of the sum paid out.
      const frozen = record
        ? {
            monthlySalary: Number(record.monthlySalary) || 0,
            standardHoursPerMonth: Number(record.standardHoursPerMonth) || 0,
            hourlyRate: Number(record.hourlyRate) || 0,
            totalDaysPresent: Number(record.totalDaysPresent) || 0,
            totalHoursWorked: Number(record.totalHoursWorked) || 0,
            computedPay: Number(record.computedPay) || 0,
            manualAdjustment: Number(record.manualAdjustment) || 0,
            adjustmentReason: record.adjustmentReason ?? existing.adjustmentReason ?? null,
            finalPayable: Number(record.finalPayable) || 0,
          }
        : {};
      await tx.payrollRecord.update({
        where: { id: existing.id },
        data: { ...frozen, status: 'Paid', paidAt: ts, paymentMode, paymentReference: paymentReference ?? null, updatedAt: ts },
      });
    } else if (record?.employeeId && record?.month) {
      // No persisted record yet — create one straight into Paid state using the
      // client's computed figures so the disbursement actually sticks.
      // HRM10-3: only for a real employee; name and branch from the master.
      const emp = await tx.employee.findUnique({ where: { id: String(record.employeeId) } });
      if (!emp) throw new AppError('NOT_FOUND', 'Employee not found', 404);
      await tx.payrollRecord.create({
        data: {
          id: rid('pay'),
          employeeId: emp.id,
          employeeName: emp.name,
          designation: emp.designation ?? '',
          branchId: emp.branchId,
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
      // No such payroll row and no computed figures to create one from.
      throw new AppError('NOT_FOUND', 'Payroll row not found.', 404);
    }
    await recordSalaryPayment(tx, existing?.id, record, paymentMode, paymentReference, ts, actorName);
    return { ...(await snap(tx)), payments: await tx.payment.findMany() };
  });
}

/**
 * E2E5-12: a salary paid is money out. Mark Paid writes a Payment 'out' row
 * (partyType 'staff') on TODAY's IST date at the employee's branch, so it
 * reaches the drawer (when paid in cash), the Payments Log, the Expense Report
 * and the P&L like any other payment. Today's cash day must be open — a closed
 * day's figures never change (same rule as refunds and vendor payments).
 */
async function recordSalaryPayment(tx: any, existingId: string | undefined, record: any, paymentMode: string, paymentReference: string | undefined, ts: string, actorName?: string) {
  const row = existingId
    ? await tx.payrollRecord.findUnique({ where: { id: existingId } })
    : await tx.payrollRecord.findFirst({ where: { employeeId: record?.employeeId, month: record?.month } });
  if (!row) return;
  const amount = Math.round((Number(row.finalPayable) || 0) * 100) / 100;
  if (amount <= 0) return;
  const emp = await tx.employee.findUnique({ where: { id: row.employeeId } });
  const branchId = emp?.branchId || row.branchId;
  if (!branchId) return;
  const date = istToday();
  await assertDayOpen(tx, branchId, date, 'pay a salary');
  await tx.payment.create({
    data: {
      id: rid('pay'),
      receiptNumber: await nextReceiptNumber(tx, 'out', date),
      type: 'out', partyType: 'staff', partyId: row.employeeId, partyName: row.employeeName || emp?.name || 'Staff',
      branchId, date, amount,
      paymentMode: /cash/i.test(paymentMode) ? 'Cash' : paymentMode,
      reference: paymentReference || null,
      notes: `Salary for ${row.month}`,
      allocations: [{ refId: row.id, refNumber: row.month, amount }] as any,
      createdById: null, createdByName: actorName ?? null, createdAt: ts,
    },
  });
}
