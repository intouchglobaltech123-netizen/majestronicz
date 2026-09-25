import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import * as ctrl from '../controllers/purchase.controller.js';

const router = Router();
router.post('/save', asyncHandler(ctrl.savePO));
router.delete('/:id', asyncHandler(ctrl.deletePO));
router.post('/:id/cancel', asyncHandler(ctrl.cancelPO));
router.post('/receive', asyncHandler(ctrl.receive));
router.post('/payment', asyncHandler(ctrl.recordPayment));
router.post('/bill', asyncHandler(ctrl.recordBill));
router.post('/attachment', asyncHandler(ctrl.addAttachment));
router.post('/attachment/delete', asyncHandler(ctrl.deleteAttachment));
export default router;
