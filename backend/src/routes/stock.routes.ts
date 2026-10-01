import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import * as ctrl from '../controllers/stock.controller.js';

const router = Router();
router.post('/adjust', asyncHandler(ctrl.adjust));
router.post('/transfer', asyncHandler(ctrl.transfer));
router.post('/transfer-batch', asyncHandler(ctrl.transferBatch));
router.post('/transfer-receive', asyncHandler(ctrl.receiveTransfer));
// REMOVED: POST /stock/update — it overwrote a branch's stock quantity to any
// value (−5, 2.5, …) with NO history row. No screen uses it; stock changes must
// go through /adjust (which validates and logs). Rack location is /location.
router.post('/location', asyncHandler(ctrl.updateLocation));
export default router;
