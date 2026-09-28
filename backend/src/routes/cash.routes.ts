import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireManagerOrCEO } from '../middleware/rbac.js';
import * as ctrl from '../controllers/cash.controller.js';

const router = Router();
router.post('/expense', asyncHandler(ctrl.addExpense));
router.post('/expense/delete', asyncHandler(ctrl.deleteExpense));
// Approving deposits and closing/reopening/overriding a day are Manager/CEO only
// (Billing must not, even though it holds cash:write) — CASH2-4.
router.post('/expense/approve', requireManagerOrCEO, asyncHandler(ctrl.approveExpense));
router.post('/override', requireManagerOrCEO, asyncHandler(ctrl.overrideOpening));
router.post('/close', requireManagerOrCEO, asyncHandler(ctrl.closeDay));
router.post('/reopen', requireManagerOrCEO, asyncHandler(ctrl.reopenDay));
router.post('/approve-recurring', requireManagerOrCEO, asyncHandler(ctrl.approveRecurring));

// Recurring expense templates. These replace the generic
// PUT/DELETE /api/recurring-expenses/:id routes that crud.ts removed while the
// Recurring Expenses screen was still calling them (every edit/delete 404'd,
// and the UI still said "updated").
router.put('/recurring/:id', asyncHandler(ctrl.updateRecurring));
router.delete('/recurring/:id', asyncHandler(ctrl.deleteRecurring));
export default router;
