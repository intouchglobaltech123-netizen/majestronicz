import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireManagerOrCEO } from '../middleware/rbac.js';
import * as ctrl from '../controllers/invoice.controller.js';

// Transactional sale-chain endpoints (mounted at /api/tx, behind sales:write).
const router = Router();
router.post('/sale', asyncHandler(ctrl.createSale));
// SEC-6: voiding and permanently deleting a bill are reserved for a Manager/CEO
// — Billing can create and return, but not erase a bill from the record.
router.post('/void-invoice', requireManagerOrCEO, asyncHandler(ctrl.voidInvoice));
router.post('/sale-return', asyncHandler(ctrl.processReturn));
router.delete('/invoice/:id', requireManagerOrCEO, asyncHandler(ctrl.deleteInvoice));
export default router;
