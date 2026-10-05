import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import * as ctrl from '../controllers/purchase.controller.js';

const router = Router();
router.post('/save', asyncHandler(ctrl.savePO));
// Direct purchase bill (no prior PO) — the "Bill" option on the main screen.
router.post('/direct-bill', asyncHandler(ctrl.createDirectBill));
router.delete('/:id', asyncHandler(ctrl.deletePO));
router.post('/:id/cancel', asyncHandler(ctrl.cancelPO));
router.post('/receive', asyncHandler(ctrl.receive));
router.post('/payment', asyncHandler(ctrl.recordPayment));
router.post('/bill', asyncHandler(ctrl.recordBill));
router.post('/bill/delete', asyncHandler(ctrl.deleteBill));
router.post('/attachment', asyncHandler(ctrl.addAttachment));
// PUR2-12: a file body on demand (the PO list carries only the file list).
router.get('/attachment/:poId/:attachmentId', asyncHandler(ctrl.getAttachment));
router.post('/attachment/delete', asyncHandler(ctrl.deleteAttachment));
export default router;
