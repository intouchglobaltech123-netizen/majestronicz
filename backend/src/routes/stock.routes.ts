import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import * as ctrl from '../controllers/stock.controller.js';

const router = Router();
router.post('/adjust', asyncHandler(ctrl.adjust));
router.post('/transfer', asyncHandler(ctrl.transfer));
router.post('/transfer-batch', asyncHandler(ctrl.transferBatch));
router.post('/transfer-receive', asyncHandler(ctrl.receiveTransfer));
// POST /stock/update sets a branch's stock to an exact quantity; it now validates
// the branch/quantity and writes a history row so the ledger reconciles (INV2-4).
router.post('/update', asyncHandler(ctrl.updateStock));
router.post('/location', asyncHandler(ctrl.updateLocation));
export default router;
