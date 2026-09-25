import { AppError } from '../middleware/errorHandler.js';

/**
 * Enforce that a branch-scoped user only acts on their own branch (SEC2-1).
 * CEO (no assignedBranchId) is cross-branch and always allowed. Any other role
 * may only touch the branch stored on their account — the branch in a request
 * body is never trusted for authorization.
 */
export function assertBranchAllowed(reqUser: any, branchId: string | undefined | null): void {
  if (!reqUser) return; // unauthenticated requests are handled by RBAC middleware
  if (reqUser.role === 'CEO') return;
  const own = reqUser.assignedBranchId;
  if (!own) return; // no branch on the account → treat as cross-branch (legacy accounts)
  if (branchId && branchId !== own) {
    throw new AppError('FORBIDDEN', `You are only authorized for branch ${own}`, 403);
  }
}
