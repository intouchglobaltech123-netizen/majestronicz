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
  | 'config:write' | 'customer:write' | 'payment:write' | 'ai:use' | 'admin';

const ALL: Capability[] = [
  'items:write', 'sales:write', 'stock:write', 'purchase:write', 'cash:write',
  'hrm:write', 'payroll:admin', 'enquiry:write', 'estimate:write', 'challan:write',
  'config:write', 'customer:write', 'payment:write', 'ai:use', 'admin',
];

export const ALL_CAPS = ALL;

export const ROLE_CAPS: Record<Role, Capability[]> = {
  CEO: ALL,
  Manager: [
    'items:write', 'sales:write', 'stock:write', 'purchase:write', 'cash:write',
    'hrm:write', 'enquiry:write', 'estimate:write', 'challan:write', 'config:write', 'customer:write', 'payment:write', 'ai:use',
  ],
  Billing: ['sales:write', 'cash:write', 'enquiry:write', 'estimate:write', 'challan:write', 'customer:write', 'payment:write'],
  Purchase: ['purchase:write', 'enquiry:write', 'payment:write'],
  Sales: ['enquiry:write'],
};

// Sidebar modules (views). Drives what each role can navigate to.
export const ALL_VIEWS = [
  'dashboard', 'items', 'customers', 'parties', 'enquiries', 'pending-orders', 'estimates',
  'challans', 'inventory', 'invoices', 'barcodes', 'cash-register', 'purchases',
  'hrm', 'reports', 'shopify', 'ai-assistant', 'access',
];

export const DEFAULT_ROLE_VIEWS: Record<Role, string[]> = {
  CEO: [...ALL_VIEWS],
  Manager: ['dashboard', 'items', 'customers', 'parties', 'enquiries', 'pending-orders', 'estimates', 'challans', 'inventory', 'invoices', 'barcodes', 'cash-register', 'purchases', 'hrm', 'reports', 'ai-assistant'],
  Billing: ['items', 'customers', 'parties', 'enquiries', 'pending-orders', 'estimates', 'challans', 'inventory', 'invoices', 'barcodes', 'cash-register'],
  Purchase: ['items', 'inventory', 'purchases', 'parties', 'enquiries', 'pending-orders'],
  Sales: ['items', 'enquiries'],
};

// Fine-grained field/data-visibility flags (Vyapar-style). Enforced in the UI
// to show/hide sensitive fields; caps remain the server-enforced action layer.
export const ALL_FLAGS = [
  'bill.editPrice',       // edit item price while billing
  'bill.giveDiscount',    // apply line/overall discounts while billing
  'view.purchaseCost',    // see purchase price / cost of items
  'view.customerBalance', // see customer outstanding / credit due
  // ---- Beta AI data scopes: which business domains this role's AI may read ----
  'ai.data.sales',        // AI can read sales / invoices figures
  'ai.data.cash',         // AI can read cash register / balances
  'ai.data.inventory',    // AI can read stock levels
  'ai.data.products',     // AI can read product/item details & pricing
  'ai.data.customers',    // AI can read customer info & balances
  'ai.data.purchase',     // AI can read purchases / supplier costs
  'ai.data.hrm',          // AI can read staff / payroll
];

// AI data-scope flags, isolated for context-building & UI grouping.
export const AI_DATA_FLAGS = [
  'ai.data.sales', 'ai.data.cash', 'ai.data.inventory', 'ai.data.products',
  'ai.data.customers', 'ai.data.purchase', 'ai.data.hrm',
];

const DEFAULT_ROLE_FLAGS: Record<Role, string[]> = {
  CEO: [...ALL_FLAGS],
  Manager: [...ALL_FLAGS],
  Billing: ['bill.editPrice', 'bill.giveDiscount', 'view.customerBalance', 'ai.data.sales', 'ai.data.products', 'ai.data.customers'],
  Purchase: ['view.purchaseCost', 'ai.data.inventory', 'ai.data.purchase', 'ai.data.products'],
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

/** The live field/data flags for a role (CEO always has all). */
export const roleFlags = (role: Role): string[] => {
  if (role === 'CEO') return [...ALL_FLAGS];
  return liveMatrix[role]?.flags || DEFAULT_ROLE_FLAGS[role] || [];
};

// ---- Signed token (dependency-free HMAC) ----
// In production AUTH_SECRET MUST be set to a strong value. Falling back to a
// secret written in the repo would let anyone forge a CEO token (SEC2-4), so we
// refuse to start rather than run with the public default. The dev fallback is
// kept only for local development (NODE_ENV !== 'production').
const SECRET = (() => {
  const fromEnv = process.env.AUTH_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'AUTH_SECRET is missing or too short. Set a strong AUTH_SECRET (>= 16 chars) in the environment before starting the server.'
    );
  }
  return 'majestronicz-dev-secret-change-in-prod';
})();

// Optional PREVIOUS secret, used only during a rotation grace period. When you
// move AUTH_SECRET to a new strong value, set AUTH_SECRET_PREV to the old one:
// tokens and PIN hashes made under the old secret keep verifying, and each PIN
// is transparently re-hashed to the new secret on the owner's next login
// (see re-hash logic in user.service.authenticateUser). Once every active user
// has logged in, remove AUTH_SECRET_PREV. This lets you rotate to a real secret
// without locking anyone out (Option B for SEC2-4).
const SECRET_PREV = process.env.AUTH_SECRET_PREV || '';

// Deterministic keyed hash for login PINs so plaintext is never stored in the DB.
// Keyed by AUTH_SECRET (an attacker without it can't precompute), and deterministic
// so PIN uniqueness (@unique) and lookup-by-hash keep working.
const hashPinWith = (pin: string, secret: string) =>
  crypto.createHmac('sha256', secret + ':pin').update(String(pin)).digest('hex');
export const hashPin = (pin: string) => hashPinWith(pin, SECRET);
/**
 * All hashes a given plaintext PIN could be stored as right now: the current
 * secret first, then the previous secret during a rotation grace period. Used
 * for login lookup so an old-secret hash still matches.
 */
export const hashPinCandidates = (pin: string): string[] => {
  const list = [hashPin(pin)];
  if (SECRET_PREV) list.push(hashPinWith(pin, SECRET_PREV));
  return list;
};
/** True when a PIN's stored hash is NOT the current-secret hash but does match the
 *  previous-secret hash — i.e. it should be lazily re-hashed to the current secret. */
export const pinNeedsRehash = (pin: string, storedHash: string): boolean =>
  !!SECRET_PREV && storedHash !== hashPin(pin) && storedHash === hashPinWith(pin, SECRET_PREV);
/** True if a stored value is already a hash (64 hex chars) rather than a plaintext PIN. */
export const isPinHashed = (v: string) => /^[0-9a-f]{64}$/.test(v);
const b64 = (s: string) => Buffer.from(s).toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8');
const sign = (payload: string) => crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
const signPrev = (payload: string) => crypto.createHmac('sha256', SECRET_PREV).update(payload).digest('base64url');

export interface SessionUser {
  role: Role;
  name: string;
  assignedBranchId?: string;
  userId?: string;
  employeeId?: string;
  exp: number;
}

export function issueToken(user: Omit<SessionUser, 'exp'>): string {
  const payload = b64(JSON.stringify({ ...user, exp: Date.now() + 12 * 60 * 60 * 1000 })); // 12h
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token?: string): SessionUser | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  // Accept a signature from the current secret, or (during a rotation grace
  // period) from the previous secret, so already-issued tokens survive the swap.
  const sigOk = !!payload && !!sig && (sign(payload) === sig || (!!SECRET_PREV && signPrev(payload) === sig));
  if (!sigOk) return null;
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
