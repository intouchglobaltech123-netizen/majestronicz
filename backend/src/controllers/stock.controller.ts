import { Request, Response } from 'express';
import * as stock from '../services/stock.service.js';
import { assertBranchAllowed } from '../lib/branchGuard.js';

/**
 * Who performed the action, taken from the authenticated token — NOT the request
 * body. A client could otherwise stamp any name onto a stock movement's history,
 * so the ledger's "adjusted by" was untrustworthy (ACT-1). Falls back to the body
 * only when there is no logged-in user (e.g. a system/QA call without a token).
 */
const actorOf = (req: Request): string =>
  ((req as any).user?.name as string | undefined)?.trim() || String((req.body as any)?.actor || 'System');

export const adjust = async (req: Request, res: Response) => {
  const { itemId, branchId, quantityChange, reason, notes } = req.body;
  assertBranchAllowed((req as any).user, branchId);
  res.json(await stock.adjustStock(itemId, branchId, quantityChange, reason, notes, actorOf(req)));
};

export const transfer = async (req: Request, res: Response) => {
  const { itemId, fromBranch, toBranch, quantity, notes, autoGenerateChallan } = req.body;
  // A branch-locked user may only move stock OUT OF their own branch.
  assertBranchAllowed((req as any).user, fromBranch);
  res.json(await stock.transferStock(itemId, fromBranch, toBranch, quantity, notes, autoGenerateChallan ?? true, actorOf(req)));
};

export const transferBatch = async (req: Request, res: Response) => {
  const { items, fromBranch, toBranch, notes, autoGenerateChallan } = req.body;
  assertBranchAllowed((req as any).user, fromBranch);
  res.json(await stock.transferStockBatch(items, fromBranch, toBranch, notes, autoGenerateChallan ?? true, actorOf(req)));
};

export const receiveTransfer = async (req: Request, res: Response) => {
  const { transferId } = req.body;
  res.json(await stock.receiveStockTransfer(transferId, actorOf(req), (req as any).user));
};

export const updateStock = async (req: Request, res: Response) => {
  const { itemId, branchId, quantity, minStockAlert, location } = req.body;
  assertBranchAllowed((req as any).user, branchId);
  res.json(await stock.updateBranchStock(itemId, branchId, quantity, minStockAlert, location, actorOf(req)));
};

export const updateLocation = async (req: Request, res: Response) => {
  const { itemId, branchId, location } = req.body;
  assertBranchAllowed((req as any).user, branchId);
  res.json(await stock.updateBranchStockLocation(itemId, branchId, location));
};
