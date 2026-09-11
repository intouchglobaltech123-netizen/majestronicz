import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import * as ctrl from '../controllers/enquiry.controller.js';

const router = Router();
router.post('/save', asyncHandler(ctrl.save));
router.post('/link-item', asyncHandler(ctrl.linkItem));
router.post('/pending/update', asyncHandler(ctrl.updatePending));
router.post('/pending/cancel', asyncHandler(ctrl.cancelPending));
router.post('/cancel', asyncHandler(ctrl.cancel));
router.post('/reminder', asyncHandler(ctrl.addReminder));
router.post('/reminder/complete', asyncHandler(ctrl.completeReminder));
router.post('/reminder/delete', asyncHandler(ctrl.deleteReminder));
router.post('/notes', asyncHandler(ctrl.updateNotes));
router.post('/status', asyncHandler(ctrl.updateStatus));
router.post('/convert', asyncHandler(ctrl.convert));
export default router;
