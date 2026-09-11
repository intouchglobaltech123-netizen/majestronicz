import { Request, Response, NextFunction } from 'express';
import { verifyToken, roleCan, Capability, SessionUser } from '../lib/auth.js';
import { AppError } from './errorHandler.js';

// Attach the authenticated user (if a valid Bearer token is present) to req.
export function attachUser(req: Request & { user?: SessionUser | null }, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  req.user = verifyToken(token);
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
