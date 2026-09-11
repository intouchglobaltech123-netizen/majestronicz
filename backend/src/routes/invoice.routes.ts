import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import * as ctrl from '../controllers/invoice.controller.js';

// Transactional sale-chain endpoints (mounted at /api/tx).
const router = Router();
router.post('/sale', asyncHandler(ctrl.createSale));
router.post('/void-invoice', asyncHandler(ctrl.voidInvoice));
router.post('/sale-return', asyncHandler(ctrl.processReturn));
router.delete('/invoice/:id', asyncHandler(ctrl.deleteInvoice));
export default router;
