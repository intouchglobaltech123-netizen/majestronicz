import { Request, Response } from 'express';
import * as stock from '../services/stock.service.js';
import { assertBranchAllowed } from '../lib/branchGuard.js';

export const adjust = async (req: Request, res: Response) => {
  const { itemId, branchId, quantityChange, reason, notes, actor } = req.body;
  assertBranchAllowed((req as any).user, branchId);
  res.json(await stock.adjustStock(itemId, branchId, quantityChange, reason, notes, actor));
};

export const transfer = async (req: Request, res: Response) => {
  const { itemId, fromBranch, toBranch, quantity, notes, autoGenerateChallan, actor } = req.body;
  // A branch-locked user may only move stock OUT OF their own branch.
  assertBranchAllowed((req as any).user, fromBranch);
  res.json(await stock.transferStock(itemId, fromBranch, toBranch, quantity, notes, autoGenerateChallan ?? true, actor));
};

export const transferBatch = async (req: Request, res: Response) => {
  const { items, fromBranch, toBranch, notes, autoGenerateChallan, actor } = req.body;
  assertBranchAllowed((req as any).user, fromBranch);
  res.json(await stock.transferStockBatch(items, fromBranch, toBranch, notes, autoGenerateChallan ?? true, actor));
};

export const receiveTransfer = async (req: Request, res: Response) => {
  const { transferId, actor } = req.body;
  res.json(await stock.receiveStockTransfer(transferId, actor, (req as any).user));
};

export const updateStock = async (req: Request, res: Response) => {
  const { itemId, branchId, quantity, minStockAlert, location } = req.body;
  assertBranchAllowed((req as any).user, branchId);
  res.json(await stock.updateBranchStock(itemId, branchId, quantity, minStockAlert, location));
};

export const updateLocation = async (req: Request, res: Response) => {
  const { itemId, branchId, location } = req.body;
  assertBranchAllowed((req as any).user, branchId);
  res.json(await stock.updateBranchStockLocation(itemId, branchId, location));
};
