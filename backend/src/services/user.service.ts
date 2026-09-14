import { prisma } from '../db.js';
import { AppError } from '../middleware/errorHandler.js';
import { nowIso } from '../lib/stockLedger.js';
import { ROLE_DEFS, Role, SessionUser, hashPin, isPinHashed } from '../lib/auth.js';

/**
 * Staff login accounts. Each user has their own PIN and an RBAC role.
 * New staff are created with mustResetPin=true and must set a fresh PIN on
 * first login. The 5 preset accounts are seeded once so existing logins work.
 */

const CREATABLE_ROLES: Role[] = ['Manager', 'Billing', 'Purchase', 'Sales'];
const isValidPin = (pin: string) => /^\d{4}$/.test(pin);

// A friendly job title for the linked attendance/employee record.
const DESIGNATION_BY_ROLE: Record<string, string> = {
  Manager: 'Branch Manager',
  Billing: 'Billing Executive',
  Purchase: 'Purchase Executive',
  Sales: 'Sales Executive',
  CEO: 'Proprietor',
};

/** Seed the 5 preset accounts once (idempotent). */
export async function ensureUsers(): Promise<void> {
  const count = await prisma.user.count();
  if (count > 0) return;
  for (const def of ROLE_DEFS) {
    await prisma.user.create({
      data: {
        id: `user-${def.role.toLowerCase()}`,
        name: def.defaultName,
        role: def.role,
        pin: hashPin(def.pin),
        assignedBranchId: def.defaultBranch ?? null,
        status: 'active',
        mustResetPin: false,
        isSystem: def.role === 'CEO', // owner account is protected
        createdAt: nowIso(),
      },
    });
  }
}

/** One-time upgrade of any legacy plaintext login PINs to hashed form. */
export async function migrateUserPins(): Promise<number> {
  const users = await prisma.user.findMany({ select: { id: true, pin: true } });
  let migrated = 0;
  for (const u of users) {
    if (!isPinHashed(u.pin)) {
      await prisma.user.update({ where: { id: u.id }, data: { pin: hashPin(u.pin) } });
      migrated++;
    }
  }
  return migrated;
}

export interface AuthResult {
  user: SessionUser;
  mustResetPin: boolean;
}

/** Verify a PIN against active staff accounts. */
export async function authenticateUser(pin: string, branchId?: string): Promise<AuthResult | null> {
  const account = await prisma.user.findFirst({ where: { pin: hashPin(String(pin || '')), status: 'active' } });
  if (!account) return null;
  const role = account.role as Role;
  const assignedBranchId =
    role === 'Manager' ? branchId || account.assignedBranchId || 'coimbatore' : account.assignedBranchId || undefined;
  return {
    user: { role, name: account.name, assignedBranchId: assignedBranchId ?? undefined, userId: account.id, exp: 0 },
    mustResetPin: account.mustResetPin,
  };
}

export function listUsers() {
  // Never expose PINs to the client; return account metadata only.
  return prisma.user.findMany({
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
    select: {
      id: true, name: true, role: true, assignedBranchId: true, employeeId: true,
      status: true, mustResetPin: true, isSystem: true, createdAt: true, updatedAt: true,
    },
  });
}

export interface CreateUserInput {
  name: string;
  role: Role;
  pin: string;
  assignedBranchId?: string;
  monthlySalary?: number;
  phone?: string;
}

export async function createUser(input: CreateUserInput) {
  const name = (input.name || '').trim();
  if (!name) throw new AppError('BAD_REQUEST', 'Staff name is required', 400);
  if (!CREATABLE_ROLES.includes(input.role)) {
    throw new AppError('BAD_REQUEST', 'Role must be Manager, Billing, Purchase or Sales', 400);
  }
  if (!isValidPin(input.pin)) throw new AppError('BAD_REQUEST', 'Default PIN must be exactly 4 digits', 400);

  const clash = await prisma.user.findUnique({ where: { pin: hashPin(input.pin) } });
  if (clash) throw new AppError('CONFLICT', 'That PIN is already used by another account. Choose a different one.', 409);

  const branchId = input.role === 'Manager' ? input.assignedBranchId || 'coimbatore' : input.assignedBranchId || 'erode-hq';
  const ts = nowIso();

  // Create the staff login AND a linked attendance/employee record together, so
  // the new staff member shows up on the Attendance page and shares one PIN.
  return prisma.$transaction(async (tx) => {
    const employeeId = `emp-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    await tx.employee.create({
      data: {
        id: employeeId,
        name,
        designation: DESIGNATION_BY_ROLE[input.role] || input.role,
        branchId,
        monthlySalary: Number(input.monthlySalary) || 0,
        pin: input.pin,
        status: 'active',
        phone: input.phone?.trim() || null,
        joinedDate: ts.slice(0, 10),
        createdAt: ts,
        updatedAt: ts,
      },
    });
    const created = await tx.user.create({
      data: {
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        role: input.role,
        pin: hashPin(input.pin),
        assignedBranchId: input.role === 'Manager' ? branchId : input.assignedBranchId ?? null,
        status: 'active',
        mustResetPin: true, // must change the default PIN on first login
        isSystem: false,
        employeeId,
        createdAt: ts,
      },
    });
    const { pin, ...safe } = created;
    return safe;
  });
}

export interface UpdateUserInput {
  name?: string;
  role?: Role;
  assignedBranchId?: string | null;
  status?: 'active' | 'disabled';
}

export async function updateUser(id: string, input: UpdateUserInput) {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw new AppError('NOT_FOUND', 'Account not found', 404);
  if (existing.isSystem && input.role && input.role !== existing.role) {
    throw new AppError('FORBIDDEN', 'The owner (CEO) role cannot be changed', 403);
  }
  if (input.role && !CREATABLE_ROLES.includes(input.role) && !existing.isSystem) {
    throw new AppError('BAD_REQUEST', 'Role must be Manager, Billing, Purchase or Sales', 400);
  }
  const data: any = { updatedAt: nowIso() };
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.role !== undefined) data.role = input.role;
  if (input.assignedBranchId !== undefined) data.assignedBranchId = input.assignedBranchId;
  if (input.status !== undefined) {
    if (existing.isSystem && input.status === 'disabled') {
      throw new AppError('FORBIDDEN', 'The owner account cannot be disabled', 403);
    }
    data.status = input.status;
  }
  const updated = await prisma.user.update({ where: { id }, data });

  // Keep the linked attendance/employee record in sync (name, branch, status).
  if (existing.employeeId) {
    const empData: any = { updatedAt: nowIso() };
    if (input.name !== undefined) empData.name = input.name.trim();
    if (input.assignedBranchId !== undefined && input.assignedBranchId) empData.branchId = input.assignedBranchId;
    if (input.role !== undefined) empData.designation = DESIGNATION_BY_ROLE[input.role] || input.role;
    if (input.status !== undefined) empData.status = input.status;
    await prisma.employee.updateMany({ where: { id: existing.employeeId }, data: empData });
  }

  const { pin, ...safe } = updated;
  return safe;
}

/** Sync a new PIN onto the linked employee so login & attendance stay one PIN. */
async function syncEmployeePin(employeeId: string | null | undefined, newPin: string) {
  if (!employeeId) return;
  await prisma.employee.updateMany({ where: { id: employeeId }, data: { pin: newPin, updatedAt: nowIso() } });
}

/** CEO resets a staff member's PIN to a new default; forces reset on next login. */
export async function adminResetPin(id: string, newPin: string) {
  if (!isValidPin(newPin)) throw new AppError('BAD_REQUEST', 'PIN must be exactly 4 digits', 400);
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw new AppError('NOT_FOUND', 'Account not found', 404);
  const clash = await prisma.user.findFirst({ where: { pin: hashPin(newPin), NOT: { id } } });
  if (clash) throw new AppError('CONFLICT', 'That PIN is already used by another account.', 409);
  await prisma.user.update({ where: { id }, data: { pin: hashPin(newPin), mustResetPin: true, updatedAt: nowIso() } });
  await syncEmployeePin(existing.employeeId, newPin);
  return { ok: true };
}

/** The logged-in user sets their own new PIN (first-login mandatory reset). */
export async function changeOwnPin(userId: string, newPin: string) {
  if (!isValidPin(newPin)) throw new AppError('BAD_REQUEST', 'PIN must be exactly 4 digits', 400);
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) throw new AppError('NOT_FOUND', 'Account not found', 404);
  const clash = await prisma.user.findFirst({ where: { pin: hashPin(newPin), NOT: { id: userId } } });
  if (clash) throw new AppError('CONFLICT', 'That PIN is already in use. Choose a different one.', 409);
  await prisma.user.update({ where: { id: userId }, data: { pin: hashPin(newPin), mustResetPin: false, updatedAt: nowIso() } });
  await syncEmployeePin(existing.employeeId, newPin);
  return { ok: true };
}

/**
 * Attach (or update) a login account for an EXISTING employee — used by the
 * unified "Enroll Employee" form so staff are added in one place. If a login
 * already exists for the employee it is updated; otherwise one is created
 * (mustResetPin=true). The employee's PIN is kept in sync.
 */
export async function linkLoginToEmployee(input: {
  employeeId: string; role: Role; name: string; assignedBranchId?: string; pin: string; status?: string;
}) {
  if (!CREATABLE_ROLES.includes(input.role)) {
    throw new AppError('BAD_REQUEST', 'Role must be Manager, Billing, Purchase or Sales', 400);
  }
  if (!isValidPin(input.pin)) throw new AppError('BAD_REQUEST', 'Login PIN must be exactly 4 digits', 400);

  // The employee may still be committing (created moments earlier from the enroll
  // form), so its absence here is not fatal — we link by id regardless.
  const emp = await prisma.employee.findUnique({ where: { id: input.employeeId } });

  const hashed = hashPin(input.pin);
  const existing = await prisma.user.findFirst({ where: { employeeId: input.employeeId } });
  const clash = await prisma.user.findFirst({
    where: existing ? { pin: hashed, NOT: { id: existing.id } } : { pin: hashed },
  });
  if (clash) throw new AppError('CONFLICT', 'That PIN is already used by another login. Choose a different one.', 409);

  const status = input.status === 'Inactive' ? 'disabled' : 'active';
  const assignedBranchId = input.role === 'Manager' ? (input.assignedBranchId || emp?.branchId || 'coimbatore') : (input.assignedBranchId ?? null);
  // Employee attendance PIN stays PLAINTEXT (used by the kiosk); only the login PIN is hashed.
  await prisma.employee.updateMany({ where: { id: input.employeeId }, data: { pin: input.pin, updatedAt: nowIso() } });

  if (existing) {
    const pinChanged = existing.pin !== hashed;
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        role: input.role, name: input.name.trim(), assignedBranchId, pin: hashed, status,
        mustResetPin: pinChanged ? true : existing.mustResetPin, updatedAt: nowIso(),
      },
    });
    const { pin, ...safe } = updated;
    return safe;
  }
  const created = await prisma.user.create({
    data: {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: input.name.trim(), role: input.role, pin: hashed, assignedBranchId,
      status, mustResetPin: true, isSystem: false, employeeId: input.employeeId, createdAt: nowIso(),
    },
  });
  const { pin, ...safe } = created;
  return safe;
}

/** Remove the login account attached to an employee (keeps the employee). */
export async function unlinkLogin(employeeId: string) {
  const existing = await prisma.user.findFirst({ where: { employeeId } });
  if (!existing) return { ok: true };
  if (existing.isSystem) throw new AppError('FORBIDDEN', 'The owner account cannot be removed', 403);
  await prisma.user.delete({ where: { id: existing.id } });
  return { ok: true };
}

export async function deleteUser(id: string) {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw new AppError('NOT_FOUND', 'Account not found', 404);
  if (existing.isSystem) throw new AppError('FORBIDDEN', 'The owner account cannot be deleted', 403);
  await prisma.user.delete({ where: { id } });
  // Preserve the employee's attendance/payroll history but disable the record.
  if (existing.employeeId) {
    await prisma.employee.updateMany({ where: { id: existing.employeeId }, data: { status: 'disabled', updatedAt: nowIso() } });
  }
  return { ok: true };
}
