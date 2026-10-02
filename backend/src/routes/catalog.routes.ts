import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireCapability, requireManagerOrCEO } from '../middleware/rbac.js';
import * as ctrl from '../controllers/catalog.controller.js';

const router = Router();
// Items (multi-table: item + branch stock) — CEO/Manager only
router.post('/item', requireCapability('items:write'), asyncHandler(ctrl.addItem));
// Dedicated item update (replaces the generic PUT /api/items/:id that CRUD-1 removed).
router.put('/item/:id', requireCapability('items:write'), asyncHandler(ctrl.updateItem));
router.delete('/item/:id', requireCapability('items:write'), asyncHandler(ctrl.deleteItem));
// Archive / restore an item (INV5-7) — Manager/CEO.
router.post('/item/:id/archive', requireCapability('items:write'), requireManagerOrCEO, asyncHandler(ctrl.archiveItem));
// Estimates / Quotes
router.post('/estimate', requireCapability('estimate:write'), asyncHandler(ctrl.saveEstimate));
router.post('/estimate/:id/cancel', requireCapability('estimate:write'), asyncHandler(ctrl.cancelEstimate));
router.delete('/estimate/:id', requireCapability('estimate:write'), asyncHandler(ctrl.deleteEstimate));
// Challans
router.post('/challan', requireCapability('challan:write'), asyncHandler(ctrl.saveChallan));
router.post('/challan/:id/received', requireCapability('challan:write'), asyncHandler(ctrl.markChallanReceived));
router.delete('/challan/:id', requireCapability('challan:write'), asyncHandler(ctrl.deleteChallan));
// Combos (part of catalog)
router.post('/combo', requireCapability('items:write'), asyncHandler(ctrl.saveCombo));
router.delete('/combo/:id', requireCapability('items:write'), asyncHandler(ctrl.deleteCombo));
// Customers
router.post('/customer', requireCapability('customer:write'), asyncHandler(ctrl.saveCustomer));
router.delete('/customer/:id', requireCapability('customer:write'), asyncHandler(ctrl.deleteCustomer));
// Manually grant / correct a customer's store credit — CEO/Manager only.
router.post('/customer/:id/credit', requireManagerOrCEO, asyncHandler(ctrl.adjustCustomerCredit));
export default router;
