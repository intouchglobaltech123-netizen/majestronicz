import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import * as ctrl from '../controllers/cash.controller.js';

const router = Router();
router.post('/expense', asyncHandler(ctrl.addExpense));
router.post('/expense/delete', asyncHandler(ctrl.deleteExpense));
router.post('/expense/approve', asyncHandler(ctrl.approveExpense));
router.post('/override', asyncHandler(ctrl.overrideOpening));
router.post('/close', asyncHandler(ctrl.closeDay));
router.post('/reopen', asyncHandler(ctrl.reopenDay));
router.post('/approve-recurring', asyncHandler(ctrl.approveRecurring));

// Recurring expense templates. These replace the generic
// PUT/DELETE /api/recurring-expenses/:id routes that crud.ts removed while the
// Recurring Expenses screen was still calling them (every edit/delete 404'd,
// and the UI still said "updated").
router.put('/recurring/:id', asyncHandler(ctrl.updateRecurring));
router.delete('/recurring/:id', asyncHandler(ctrl.deleteRecurring));
export default router;
