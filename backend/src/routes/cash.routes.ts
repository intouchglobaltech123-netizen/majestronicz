import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import * as ctrl from '../controllers/cash.controller.js';

const router = Router();
router.post('/expense', asyncHandler(ctrl.addExpense));
router.post('/expense/delete', asyncHandler(ctrl.deleteExpense));
router.post('/override', asyncHandler(ctrl.overrideOpening));
router.post('/close', asyncHandler(ctrl.closeDay));
router.post('/reopen', asyncHandler(ctrl.reopenDay));
router.post('/approve-recurring', asyncHandler(ctrl.approveRecurring));
export default router;
