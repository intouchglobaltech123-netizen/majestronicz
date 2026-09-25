import { Request, Response } from 'express';
import * as enquiry from '../services/enquiry.service.js';
import { assertBranchAllowed } from '../lib/branchGuard.js';

export const save = async (req: Request, res: Response) => {
  const { enquiry: e, initialExpectedRestockDate, actor } = req.body;
  // A branch-locked user can only log enquiries for their own branch (SEC2-1/CRM-14).
  assertBranchAllowed((req as any).user, e?.branchId);
  res.json(await enquiry.saveEnquiry(e, initialExpectedRestockDate, actor));
};
export const linkItem = async (req: Request, res: Response) => {
  const { enquiryId, item, actor } = req.body;
  res.json(await enquiry.linkItemToEnquiry(enquiryId, item, actor));
};
export const updatePending = async (req: Request, res: Response) => {
  const { orderId, updates } = req.body;
  res.json(await enquiry.updatePendingOrder(orderId, updates));
};
export const cancel = async (req: Request, res: Response) => {
  const { enquiryId, reason, actor } = req.body;
  res.json(await enquiry.cancelEnquiry(enquiryId, reason, actor));
};
export const cancelPending = async (req: Request, res: Response) => {
  const { orderId, reason } = req.body;
  res.json(await enquiry.cancelPendingOrder(orderId, reason));
};
export const addReminder = async (req: Request, res: Response) => {
  const { enquiryId, dueDate, dueTime, notes, actor } = req.body;
  res.json(await enquiry.addReminder(enquiryId, dueDate, dueTime, notes, actor));
};
export const completeReminder = async (req: Request, res: Response) => {
  res.json(await enquiry.completeReminder(req.body.reminderId));
};
export const deleteReminder = async (req: Request, res: Response) => {
  res.json(await enquiry.deleteReminder(req.body.reminderId));
};
export const updateNotes = async (req: Request, res: Response) => {
  const { enquiryId, notes, actor } = req.body;
  res.json(await enquiry.updateNotes(enquiryId, notes, actor));
};
export const updateStatus = async (req: Request, res: Response) => {
  const { enquiryId, status, reason, actor } = req.body;
  res.json(await enquiry.updateStatus(enquiryId, status, reason, actor));
};
export const convert = async (req: Request, res: Response) => {
  const { enquiryId, targetType, docId, docNumber, actor } = req.body;
  res.json(await enquiry.convertEnquiry(enquiryId, targetType, docId, docNumber, actor));
};
