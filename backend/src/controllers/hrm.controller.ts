import { Request, Response } from 'express';
import * as hrm from '../services/hrm.service.js';

export const verifyPin = async (req: Request, res: Response) => {
  const { employeeId, pin } = req.body;
  res.json(await hrm.verifyKioskPin(String(employeeId || ''), String(pin || ''), (req as any).user));
};

export const clockIn = async (req: Request, res: Response) => {
  const { employeeId, photoDataUrl, location, customTime } = req.body;
  res.json(await hrm.clockIn(employeeId, photoDataUrl, location, customTime, (req as any).user));
};
export const clockOut = async (req: Request, res: Response) => {
  const { employeeId, photoDataUrl, location, customTime } = req.body;
  res.json(await hrm.clockOut(employeeId, photoDataUrl, location, customTime, (req as any).user));
};
export const payrollAdjustment = async (req: Request, res: Response) => {
  const { employeeId, month, adjustment, reason, standardHoursPerMonth } = req.body;
  res.json(await hrm.updatePayrollAdjustment(employeeId, month, adjustment, reason, standardHoursPerMonth));
};
export const markPaid = async (req: Request, res: Response) => {
  const { payrollId, paymentMode, paymentReference, record } = req.body;
  res.json(await hrm.markPayrollPaid(payrollId, paymentMode, paymentReference, record, (req as any).user?.name));
};
