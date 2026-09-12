import crypto from 'node:crypto';

/**
 * Server-side authentication + RBAC. PINs live here (not in the shipped
 * frontend), login issues an HMAC-signed token carrying the role, and the
 * capability matrix is the single source of truth for who can do what —
 * enforced on every mutating endpoint regardless of what the UI shows.
 */

export type Role = 'CEO' | 'Manager' | 'Billing' | 'Purchase' | 'Sales';

interface RoleDef {
  role: Role;
  pin: string;
  defaultName: string;
  defaultBranch?: string;
}

export const ROLE_DEFS: RoleDef[] = [
  { role: 'CEO', pin: '1111', defaultName: 'Sathish Kumar (CEO)' },
  { role: 'Manager', pin: '2222', defaultName: 'Karthik Raja (Branch Manager)', defaultBranch: 'coimbatore' },
  { role: 'Billing', pin: '3333', defaultName: 'Praveen (Billing Desk)', defaultBranch: 'erode-hq' },
  { role: 'Sales', pin: '4444', defaultName: 'Vignesh (Sales Executive)', defaultBranch: 'erode-hq' },
  { role: 'Purchase', pin: '5555', defaultName: 'Ganesh (Purchase Desk)', defaultBranch: 'erode-hq' },
];

// Capabilities required by mutating endpoints. A role may perform an action
// only if the capability is in its set. Reads (GET) are open to any logged-in
// user — the UI decides what each role sees; the server decides what it can DO.
export type Capability =
  | 'items:write' | 'sales:write' | 'stock:write' | 'purchase:write' | 'cash:write'
  | 'hrm:write' | 'payroll:admin' | 'enquiry:write' | 'estimate:write' | 'challan:write'
  | 'config:write' | 'customer:write' | 'admin';

const ALL: Capability[] = [
  'items:write', 'sales:write', 'stock:write', 'purchase:write', 'cash:write',
  'hrm:write', 'payroll:admin', 'enquiry:write', 'estimate:write', 'challan:write',
  'config:write', 'customer:write', 'admin',
];

export const ALL_CAPS = ALL;

export const ROLE_CAPS: Record<Role, Capability[]> = {
  CEO: ALL,
  Manager: [
    'items:write', 'sales:write', 'stock:write', 'purchase:write', 'cash:write',
    'hrm:write', 'enquiry:write', 'estimate:write', 'challan:write', 'config:write', 'customer:write',
  ],
  Billing: ['sales:write', 'cash:write', 'enquiry:write', 'estimate:write', 'challan:write', 'customer:write'],
  Purchase: ['purchase:write', 'enquiry:write'],
  Sales: ['enquiry:write'],
};

// Sidebar modules (views). Drives what each role can navigate to.
export const ALL_VIEWS = [
  'dashboard', 'items', 'customers', 'enquiries', 'pending-orders', 'estimates',
  'challans', 'inventory', 'invoices', 'barcodes', 'cash-register', 'purchases',
  'hrm', 'reports', 'access',
];

export const DEFAULT_ROLE_VIEWS: Record<Role, string[]> = {
  CEO: [...ALL_VIEWS],
  Manager: ['dashboard', 'items', 'customers', 'enquiries', 'pending-orders', 'estimates', 'challans', 'inventory', 'invoices', 'barcodes', 'cash-register', 'purchases', 'hrm', 'reports'],
  Billing: ['items', 'customers', 'enquiries', 'pending-orders', 'estimates', 'challans', 'inventory', 'invoices', 'barcodes', 'cash-register'],
  Purchase: ['items', 'inventory', 'purchases', 'enquiries', 'pending-orders'],
  Sales: ['items', 'enquiries'],
};

// Fine-grained field/data-visibility flags (Vyapar-style). Enforced in the UI
// to show/hide sensitive fields; caps remain the server-enforced action layer.
export const ALL_FLAGS = [
  'bill.editPrice',       // edit item price while billing
  'bill.giveDiscount',    // apply line/overall discounts while billing
  'view.purchaseCost',    // see purchase price / cost of items
  'view.customerBalance', // see customer outstanding / credit due
];

const DEFAULT_ROLE_FLAGS: Record<Role, string[]> = {
  CEO: [...ALL_FLAGS],
  Manager: [...ALL_FLAGS],
  Billing: ['bill.editPrice', 'bill.giveDiscount', 'view.customerBalance'],
  Purchase: ['view.purchaseCost'],
  Sales: [],
};

export type AccessMatrix = Record<Role, { views: string[]; caps: Capability[]; flags: string[] }>;

export function buildDefaultMatrix(): AccessMatrix {
  return (Object.keys(ROLE_CAPS) as Role[]).reduce((m, role) => {
    m[role] = { views: [...DEFAULT_ROLE_VIEWS[role]], caps: [...ROLE_CAPS[role]], flags: [...DEFAULT_ROLE_FLAGS[role]] };
    return m;
  }, {} as AccessMatrix);
}

// Live, DB-backed matrix. Loaded at startup, refreshed when the CEO edits it.
let liveMatrix: AccessMatrix = buildDefaultMatrix();
export const setLiveMatrix = (m: AccessMatrix) => {
  // CEO is always locked to full access — can never be locked out.
  liveMatrix = { ...m, CEO: { views: [...ALL_VIEWS], caps: [...ALL], flags: [...ALL_FLAGS] } };
};
export const getLiveMatrix = (): AccessMatrix => liveMatrix;

export const roleCan = (role: Role, cap: Capability) => {
  if (role === 'CEO') return true;
  return (liveMatrix[role]?.caps || ROLE_CAPS[role] || []).includes(cap);
};

// ---- Signed token (dependency-free HMAC) ----
const SECRET = process.env.AUTH_SECRET || 'majestronicz-dev-secret-change-in-prod';
const b64 = (s: string) => Buffer.from(s).toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8');
const sign = (payload: string) => crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');

export interface SessionUser {
  role: Role;
  name: string;
  assignedBranchId?: string;
  exp: number;
}

export function issueToken(user: Omit<SessionUser, 'exp'>): string {
  const payload = b64(JSON.stringify({ ...user, exp: Date.now() + 12 * 60 * 60 * 1000 })); // 12h
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token?: string): SessionUser | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig || sign(payload) !== sig) return null;
  try {
    const user = JSON.parse(unb64(payload)) as SessionUser;
    if (!user.exp || user.exp < Date.now()) return null;
    return user;
  } catch {
    return null;
  }
}

/** Verify a PIN and return the session user (no token yet). */
export function authenticatePin(pin: string, branchId?: string): SessionUser | null {
  const match = ROLE_DEFS.find((r) => r.pin === pin);
  if (!match) return null;
  const assignedBranchId =
    match.role === 'Manager' ? branchId || match.defaultBranch || 'coimbatore' : undefined;
  return { role: match.role, name: match.defaultName, assignedBranchId, exp: 0 };
}
