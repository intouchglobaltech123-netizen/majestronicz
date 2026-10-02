import { Request, Response } from 'express';
import * as hrm from '../services/hrm.service.js';
import { recordAudit } from '../services/audit.service.js';

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
  const user = (req as any).user;
  const result: any = await hrm.markPayrollPaid(payrollId, paymentMode, paymentReference, record, user?.name);
  const row = (result.payrollRecords || []).find((p: any) => p.id === payrollId || (record?.employeeId && p.employeeId === record.employeeId && p.month === record.month));
  await recordAudit({
    actor: user ? `${user.name} [${user.role}]` : 'unknown', action: 'payroll.paid', entity: 'payroll', entityId: row?.id || String(payrollId || ''),
    summary: `Salary paid for ${row?.month || record?.month || ''} (${paymentMode}${paymentReference ? ` · ${paymentReference}` : ''})`,
    branchId: row?.branchId ?? null,
  });
  res.json(result);
};
