import { Request, Response, NextFunction } from 'express';
import { verifyToken, roleCan, Capability, SessionUser } from '../lib/auth.js';
import { AppError } from './errorHandler.js';
import { prisma } from '../db.js';

// Attach the authenticated user (if a valid Bearer token is present) to req.
// Also enforces live session revocation: a token is rejected the moment its
// account is disabled or its role no longer matches (role change / disable takes
// effect on the very next request — no waiting for the 12h token to expire).
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
    try {
      const account = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { status: true, role: true },
      });
      if (!account || account.status !== 'active' || account.role !== session.role) {
        req.user = null; // revoked → treated as unauthenticated
        return next();
      }
    } catch {
      /* on a DB hiccup, fall back to the (already cryptographically valid) token */
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
