import { Request, Response, NextFunction } from 'express';
import { verifyToken, roleCan, Capability, SessionUser } from '../lib/auth.js';
import { AppError } from './errorHandler.js';
import { prisma } from '../db.js';

// Tokens live 12h (lib/auth.ts issueToken) and carry only their expiry, so the
// issue time is exp − 12h unless the token states it (`iat`).
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
export const tokenIssuedAt = (session: SessionUser): number =>
  typeof (session as any).iat === 'number' ? (session as any).iat : session.exp - TOKEN_TTL_MS;

/**
 * True when a cryptographically valid session is still live: the account is
 * active, its role unchanged, and the token was issued after the user's last
 * sign-out (SEC-5). On a DB hiccup the (already verified) token is trusted.
 */
export async function sessionIsLive(session: SessionUser): Promise<boolean> {
  return (await sessionState(session)).live;
}

/** Live check plus whether the account must still set its own PIN (SEC10-5). */
async function sessionState(session: SessionUser): Promise<{ live: boolean; mustResetPin: boolean }> {
  if (!session.userId) return { live: false, mustResetPin: false };
  try {
    const account = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { status: true, role: true, tokensValidAfter: true, mustResetPin: true },
    });
    if (!account || account.status !== 'active' || account.role !== session.role) return { live: false, mustResetPin: false };
    if (account.tokensValidAfter != null && tokenIssuedAt(session) < account.tokensValidAfter) return { live: false, mustResetPin: false };
    return { live: true, mustResetPin: !!account.mustResetPin };
  } catch {
    /* on a DB hiccup, fall back to the (already cryptographically valid) token */
  }
  return { live: true, mustResetPin: false };
}

/** SEC10-5: what an account that must still set its own PIN may call. */
const PIN_RESET_ALLOWED = new Set(['/api/auth/change-pin', '/api/auth/logout', '/api/health', '/api/events']);

// Attach the authenticated user (if a valid Bearer token is present) to req.
// Also enforces live session revocation: a token is rejected the moment its
// account is disabled or its role no longer matches (role change / disable takes
// effect on the very next request — no waiting for the 12h token to expire), or
// once the user has signed out (SEC-5).
export async function attachUser(req: Request & { user?: SessionUser | null }, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  const session = verifyToken(token);
  // SEC3-3: every token issued by /auth/login carries a userId. A validly-signed
  // token WITHOUT one can only be forged or legacy, and it would slip past the
  // live disabled-account / role-change revocation check below. Reject it.
  if (session && !session.userId) {
    req.user = null;
    return next();
  }
  if (session?.userId) {
    const state = await sessionState(session);
    if (!state.live) {
      req.user = null; // revoked → treated as unauthenticated
      return next();
    }
    // SEC10-5: a new staff login with a default PIN can do nothing until it sets
    // its own PIN — enforced here, not only by the browser's reset screen.
    if (state.mustResetPin && !PIN_RESET_ALLOWED.has(req.path.replace(/\/+$/, ''))) {
      return next(new AppError('PIN_RESET_REQUIRED', 'Set your own PIN first (Change PIN), then continue.', 403));
    }
  }
  req.user = session;
  next();
}

// Guard: the request must come from a logged-in user (any role), else 401.
// Used on reads that carry sensitive data but aren't tied to one capability
// (payments ledger, branch stock, the access matrix) which were previously
// answerable with no token at all (SEC2-3).
export function requireAuth(req: Request & { user?: SessionUser | null }, _res: Response, next: NextFunction) {
  if (!req.user) throw new AppError('UNAUTHENTICATED', 'Login required', 401);
  next();
}

// Guard: only a Manager or CEO — used for cash-day close/reopen/override and
// deposit/recurring approval, which Billing must not do (CASH2-4).
export function requireManagerOrCEO(req: Request & { user?: SessionUser | null }, _res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role === 'CEO' || role === 'Manager') return next();
  throw new AppError('FORBIDDEN', 'Only a Manager or CEO can perform this action.', 403);
}

// Guard: the request's role must hold the given capability, else 403.
export function requireCapability(cap: Capability) {
  return (req: Request & { user?: SessionUser | null }, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) throw new AppError('UNAUTHENTICATED', 'Login required', 401);
    if (!roleCan(user.role, cap)) {
      throw new AppError('FORBIDDEN', `Role ${user.role} is not permitted to perform this action`, 403);
    }
    next();
  };
}
