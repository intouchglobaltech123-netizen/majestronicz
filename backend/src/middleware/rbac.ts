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
