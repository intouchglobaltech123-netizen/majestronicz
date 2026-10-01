import { Request, Response } from 'express';
import * as item from '../services/item.service.js';
import * as catalog from '../services/catalog.service.js';

// Items
export const addItem = async (req: Request, res: Response) => {
  const { item: itemData, initialStocks, initialLocations } = req.body;
  res.json(await item.addItem(itemData, initialStocks, initialLocations, (req as any).user));
};
export const updateItem = async (req: Request, res: Response) => {
  const updates = req.body?.item ?? req.body;
  res.json(await item.updateItem(req.params.id, updates));
};
export const deleteItem = async (req: Request, res: Response) => {
  res.json(await item.deleteItem(req.params.id));
};

// Estimates / Challans / Combos / Customers
export const saveEstimate = async (req: Request, res: Response) => res.json(await catalog.saveEstimate(req.body, (req as any).user));
export const cancelEstimate = async (req: Request, res: Response) => {
  const actor = (req as any).user ? `${(req as any).user.name} [${(req as any).user.role}]` : (req.body?.actor || undefined);
  res.json(await catalog.cancelEstimate(req.params.id, String(req.body?.reason || ''), actor, (req as any).user));
};
export const deleteEstimate = async (req: Request, res: Response) => res.json(await catalog.deleteEstimate(req.params.id));
export const saveChallan = async (req: Request, res: Response) => res.json(await catalog.saveChallan(req.body));
export const markChallanReceived = async (req: Request, res: Response) =>
  res.json(await catalog.markChallanReceived(req.params.id, req.body?.receiverName ? String(req.body.receiverName) : undefined));
export const deleteChallan = async (req: Request, res: Response) => res.json(await catalog.deleteChallan(req.params.id));
export const saveCombo = async (req: Request, res: Response) => res.json(await catalog.saveCombo(req.body));
export const deleteCombo = async (req: Request, res: Response) => res.json(await catalog.deleteCombo(req.params.id));
export const saveCustomer = async (req: Request, res: Response) => res.json(await catalog.saveCustomer(req.body));
export const deleteCustomer = async (req: Request, res: Response) => res.json(await catalog.deleteCustomer(req.params.id));
