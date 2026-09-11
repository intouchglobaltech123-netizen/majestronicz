import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireCapability } from '../middleware/rbac.js';
import * as ctrl from '../controllers/catalog.controller.js';

const router = Router();
// Items (multi-table: item + branch stock) — CEO/Manager only
router.post('/item', requireCapability('items:write'), asyncHandler(ctrl.addItem));
router.delete('/item/:id', requireCapability('items:write'), asyncHandler(ctrl.deleteItem));
// Estimates / Quotes
router.post('/estimate', requireCapability('estimate:write'), asyncHandler(ctrl.saveEstimate));
router.delete('/estimate/:id', requireCapability('estimate:write'), asyncHandler(ctrl.deleteEstimate));
// Challans
router.post('/challan', requireCapability('challan:write'), asyncHandler(ctrl.saveChallan));
router.delete('/challan/:id', requireCapability('challan:write'), asyncHandler(ctrl.deleteChallan));
// Combos (part of catalog)
router.post('/combo', requireCapability('items:write'), asyncHandler(ctrl.saveCombo));
router.delete('/combo/:id', requireCapability('items:write'), asyncHandler(ctrl.deleteCombo));
// Customers
router.post('/customer', requireCapability('customer:write'), asyncHandler(ctrl.saveCustomer));
router.delete('/customer/:id', requireCapability('customer:write'), asyncHandler(ctrl.deleteCustomer));
export default router;
