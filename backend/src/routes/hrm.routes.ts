import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireCapability } from '../middleware/rbac.js';
import * as ctrl from '../controllers/hrm.controller.js';

// Mounted behind requireCapability('hrm:write') (CEO/Manager).
const router = Router();
router.post('/clock-in', asyncHandler(ctrl.clockIn));
router.post('/clock-out', asyncHandler(ctrl.clockOut));
// Payroll adjustments & disbursement are CEO-only.
router.post('/payroll-adjustment', requireCapability('payroll:admin'), asyncHandler(ctrl.payrollAdjustment));
router.post('/payroll-paid', requireCapability('payroll:admin'), asyncHandler(ctrl.markPaid));
export default router;
