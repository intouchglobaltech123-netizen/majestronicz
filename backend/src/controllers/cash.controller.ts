import { Request, Response } from 'express';
import * as cash from '../services/cash.service.js';

export const addExpense = async (req: Request, res: Response) => {
  const { branchId, date, expense, actor } = req.body;
  res.json(await cash.addExpense(branchId, date, expense, actor));
};
export const deleteExpense = async (req: Request, res: Response) => {
  const { branchId, date, expenseId } = req.body;
  res.json(await cash.deleteExpense(branchId, date, expenseId));
};
export const overrideOpening = async (req: Request, res: Response) => {
  const { branchId, date, amount, reason } = req.body;
  res.json(await cash.overrideOpening(branchId, date, amount, reason));
};
export const closeDay = async (req: Request, res: Response) => {
  const { branchId, date, notes, actor } = req.body;
  res.json(await cash.closeDay(branchId, date, notes, actor));
};
export const reopenDay = async (req: Request, res: Response) => {
  const { branchId, date } = req.body;
  res.json(await cash.reopenDay(branchId, date));
};
export const approveRecurring = async (req: Request, res: Response) => {
  const { templateId, branchId, date, amount, paymentMode, actor } = req.body;
  res.json(await cash.approveRecurring(templateId, branchId, date, amount, paymentMode, actor));
};
