import { prisma } from '../db.js';
import { AppError } from '../middleware/errorHandler.js';
import { nowIso } from '../lib/stockLedger.js';
import { ROLE_DEFS, Role, SessionUser } from '../lib/auth.js';

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
        pin: def.pin,
        assignedBranchId: def.defaultBranch ?? null,
        status: 'active',
        mustResetPin: false,
        isSystem: def.role === 'CEO', // owner account is protected
        createdAt: nowIso(),
      },
    });
  }
}

export interface AuthResult {
  user: SessionUser;
  mustResetPin: boolean;
}

/** Verify a PIN against active staff accounts. */
export async function authenticateUser(pin: string, branchId?: string): Promise<AuthResult | null> {
  const account = await prisma.user.findFirst({ where: { pin: String(pin || ''), status: 'active' } });
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
      id: true, name: true, role: true, assignedBranchId: true,
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

  const clash = await prisma.user.findUnique({ where: { pin: input.pin } });
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
        pin: input.pin,
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
  const clash = await prisma.user.findFirst({ where: { pin: newPin, NOT: { id } } });
  if (clash) throw new AppError('CONFLICT', 'That PIN is already used by another account.', 409);
  await prisma.user.update({ where: { id }, data: { pin: newPin, mustResetPin: true, updatedAt: nowIso() } });
  await syncEmployeePin(existing.employeeId, newPin);
  return { ok: true };
}

/** The logged-in user sets their own new PIN (first-login mandatory reset). */
export async function changeOwnPin(userId: string, newPin: string) {
  if (!isValidPin(newPin)) throw new AppError('BAD_REQUEST', 'PIN must be exactly 4 digits', 400);
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) throw new AppError('NOT_FOUND', 'Account not found', 404);
  const clash = await prisma.user.findFirst({ where: { pin: newPin, NOT: { id: userId } } });
  if (clash) throw new AppError('CONFLICT', 'That PIN is already in use. Choose a different one.', 409);
  await prisma.user.update({ where: { id: userId }, data: { pin: newPin, mustResetPin: false, updatedAt: nowIso() } });
  await syncEmployeePin(existing.employeeId, newPin);
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
