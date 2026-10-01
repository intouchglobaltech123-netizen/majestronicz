import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { AppError } from '../middleware/errorHandler.js';
import { StockLedger, nowIso, cleanPhone, rid } from '../lib/stockLedger.js';
import { nextInvoiceNumber } from '../lib/sequences.js';
import { serializableTx } from '../lib/tx.js';
import { calculateLineTax, calculateInvoiceTotals } from '../lib/taxCalc.js';
import { assertBranchAllowed } from '../lib/branchGuard.js';
import { recomputeInvoiceBalance, ensureCreditOriginal, invoiceReceiptsTotal } from './payment.service.js';
import { GST_RATES } from '../lib/constants.js';

/**
 * Recompute every line's tax and the invoice totals from raw inputs, overriding
 * whatever the client sent. Makes stored money values server-authoritative so a
 * tampered or buggy client can never persist incorrect amounts.
 */
const VALID_GST_RATES = new Set(GST_RATES.map((g: any) => Number(g.rate)));
const HOME_STATE_CODE = '33'; // Tamil Nadu — a supply to any other state is inter-state (IGST).

function recomputeInvoiceMoney(inv: any) {
  const withGst = !!inv.withGst;
  // Validate line inputs server-side (SAL-17 / SAL4-5).
  for (const li of (inv.items || []) as any[]) {
    if (Number(li.unitPrice) < 0) throw new AppError('BAD_PRICE', 'A unit price cannot be negative.', 400);
    const rate = Number(li.taxRate ?? li.gstRate ?? 0);
    if (withGst && !VALID_GST_RATES.has(rate)) {
      throw new AppError('BAD_GST', 'GST rate must be a valid slab (0, 5, 12, 18 or 28%).', 400);
    }
    if ((li.discountType || '%') === '%' && Number(li.discountValue || 0) > 100) {
      throw new AppError('BAD_DISCOUNT', 'A line discount cannot exceed 100%.', 400);
    }
  }
  if ((inv.overallDiscountType || '%') === '%' && Number(inv.overallDiscountValue || 0) > 100) {
    throw new AppError('BAD_DISCOUNT', 'The overall discount cannot exceed 100%.', 400);
  }

  inv.items = (inv.items || []).map((li: any) => {
    const calc = calculateLineTax(li.quantity, li.unitPrice, li.taxRate, withGst, li.discountType || '%', li.discountValue || 0);
    return { ...li, ...calc };
  });
  const totals = calculateInvoiceTotals(
    inv.items, withGst, inv.overallDiscountType || '%', inv.overallDiscountValue || 0,
    inv.shippingCharges || 0, !!inv.roundOffEnabled
  );
  inv.subtotal = totals.subtotal;
  inv.totalTax = totals.totalTax;
  inv.totalCgst = totals.totalCgst;
  inv.totalSgst = totals.totalSgst;
  // Inter-state supply is taxed as IGST, not CGST + SGST (RPT4-3). The total tax is
  // unchanged; it just isn't split into the two state halves.
  const supplyCode = String(inv.stateOfSupply || '').split('-')[0].trim();
  if (supplyCode && supplyCode !== HOME_STATE_CODE) {
    inv.totalCgst = 0;
    inv.totalSgst = 0;
    inv.items = inv.items.map((li: any) => ({ ...li, cgstAmount: 0, sgstAmount: 0, igstAmount: li.totalTax }));
  }
  inv.overallDiscountAmount = totals.overallDiscountAmount;
  inv.shippingCharges = totals.shippingCharges;
  inv.roundOff = totals.roundOff;
  inv.grandTotal = totals.grandTotal;
  inv.amountInWords = totals.amountInWords;
  return inv;
}

/**
 * Make the payment/credit fields server-authoritative against the recomputed
 * grand total (SAL-9). The client (InvoiceForm) already reconciles splits to the
 * total, but the server must guarantee it so a tampered or buggy client — or a
 * bill edited to a new total that leaves stale splits — can never record a
 * customer "amount due" that is less than what is actually owed, or claim more
 * cash collected than the bill is worth (which would inflate the drawer).
 *
 * Convention (mirrors src/types.ts computeInvoiceFinance / InvoiceForm):
 *   - A 'COD-Credit' split is money still OWED by the customer (the due).
 *   - Every other split (Cash / GPay / HDFC) is money actually collected.
 *   - balanceDue = the COD-Credit total; collected = grand − due.
 */
function reconcileInvoicePayment(inv: any) {
  const round = (n: number) => Math.round(n * 100) / 100;
  const grand = round(Number(inv.grandTotal) || 0);

  let splits: { mode: string; amount: number }[] = Array.isArray(inv.paymentSplits)
    ? inv.paymentSplits
        .map((s: any) => ({ mode: s?.mode, amount: Math.max(0, round(Number(s?.amount) || 0)) }))
        .filter((s: any) => s.mode)
    : [];

  // A Credit bill is money NOT collected yet. If it arrives as a single fully-
  // collected non-credit split (the old default booked a Credit bill as Cash, so
  // the drawer counted cash that was never received), treat the whole bill as
  // COD-Credit. A Credit bill with a real partial payment (multiple splits) is
  // left as sent.
  if (inv.transactionType === 'Credit' && splits.length <= 1 && !splits.some((s) => s.mode === 'COD-Credit')) {
    splits = [{ mode: 'COD-Credit', amount: grand }];
  }

  if (splits.length <= 1) {
    // Single-mode (or nothing) → one split covering the whole bill in that mode.
    const mode = splits[0]?.mode || inv.paymentMode || 'Cash';
    if (mode === 'COD-Credit') {
      const paid = inv.isPartialPayment
        ? Math.min(grand, Math.max(0, round(Number(inv.partialAmount) || 0)))
        : 0;
      splits = paid > 0
        ? [{ mode: 'Cash', amount: paid }, { mode: 'COD-Credit', amount: round(grand - paid) }]
        : [{ mode: 'COD-Credit', amount: grand }];
    } else {
      splits = [{ mode, amount: grand }];
    }
  } else {
    // Multi-split: the collected (non-credit) modes are taken as sent (clamped),
    // and the due is whatever the collection does not cover. If the client
    // over-stated collection (> grand), scale it down so cash can never exceed
    // the bill; the residual becomes the credit owed.
    const nonCredit = splits.filter((s) => s.mode !== 'COD-Credit');
    let collected = round(nonCredit.reduce((t, s) => t + s.amount, 0));
    if (collected > grand && collected > 0) {
      const f = grand / collected;
      nonCredit.forEach((s) => { s.amount = round(s.amount * f); });
      collected = grand;
    }
    const due = round(Math.max(0, grand - collected));
    splits = [...nonCredit];
    if (due > 0.001) splits.push({ mode: 'COD-Credit', amount: due });
  }

  const codDue = round(splits.filter((s) => s.mode === 'COD-Credit').reduce((t, s) => t + s.amount, 0));
  const collected = round(Math.max(0, grand - codDue));
  inv.paymentSplits = splits;
  inv.balanceDue = codDue;
  inv.isPartialPayment = codDue > 0 && collected > 0;
  inv.partialAmount = codDue > 0 ? collected : null;
  // Primary mode is the first collected mode, or COD-Credit when nothing was collected.
  inv.paymentMode = splits.find((s) => s.mode !== 'COD-Credit')?.mode || 'COD-Credit';
}

/**
 * A closed cash day is final: its cash total is derived from the invoices and
 * payments dated to it, so voiding / returning / deleting one of those bills (or
 * a payment) would silently change a day that has already been reconciled and
 * signed off. Block it — the CEO/Manager must reopen the day first (CASH-2).
 */
async function assertDayOpen(tx: any, branchId: string, date: string, verb: string) {
  const closed = await tx.dailyCashRegister.findFirst({ where: { branchId, date, isClosed: true } });
  if (closed) {
    throw new AppError('DAY_CLOSED', `The cash day ${date} is closed. Reopen it before you ${verb}.`, 409);
  }
}

/** Affected collections returned so the frontend can sync in-memory state. */
async function snapshot(tx: any) {
  const [invoices, customers, branchStocks, stockAdjustmentLogs] = await Promise.all([
    tx.invoice.findMany(),
    tx.customer.findMany(),
    tx.branchStock.findMany(),
    tx.stockAdjustmentLog.findMany(),
  ]);
  return { invoices, customers, branchStocks, stockAdjustmentLogs };
}

/**
 * True when at least one customer receipt (a Payment 'in' row) is allocated to
 * this invoice. Voiding or deleting such a bill would strand the receipt against
 * a bill that no longer exists and silently change the customer's ledger and the
 * cash already banked (CRM6-4), so those actions are refused while a receipt
 * exists — the receipt must be deleted/reversed first, or a return issued.
 */
async function invoiceHasReceipts(tx: any, invoiceId: string): Promise<boolean> {
  const receipts = await tx.payment.findMany({ where: { type: 'in' }, select: { allocations: true } });
  return receipts.some(
    (p: any) =>
      Array.isArray(p.allocations) &&
      p.allocations.some((a: any) => a?.refId === invoiceId && (Number(a?.amount) || 0) > 0)
  );
}

/**
 * Remove the cash-refund ledger rows a RETURN booked against this invoice. When a
 * bill is voided or deleted the sale is reversed in full, so its return refunds
 * must go too — otherwise the drawer stays permanently down and an orphaned
 * Payment 'out' row points at a bill that no longer exists (money-model cleanup).
 */
async function purgeReturnRefunds(tx: any, invoiceId: string): Promise<void> {
  const outRows = await tx.payment.findMany({ where: { type: 'out', partyType: 'customer' }, select: { id: true, allocations: true } });
  const ids = outRows
    .filter((p: any) => Array.isArray(p.allocations) && p.allocations.some((a: any) => a?.refId === invoiceId))
    .map((p: any) => p.id);
  if (ids.length) await tx.payment.deleteMany({ where: { id: { in: ids } } });
}

/** Per-item units a bill SOLD, combos expanded to their components. Used by void
 *  and delete so the restore is aggregated per item, not per line (SAL5-3). */
function expandSoldUnits(items: any[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items || []) {
    const q = Number(it.quantity) || 0;
    if (q <= 0) continue;
    if (it.isCombo && Array.isArray(it.comboComponents)) {
      for (const c of it.comboComponents) {
        const u = (Number(c.quantity) || 0) * q;
        if (u > 0) m.set(c.itemId, (m.get(c.itemId) || 0) + u);
      }
    } else if (it.itemId) {
      m.set(it.itemId, (m.get(it.itemId) || 0) + q);
    }
  }
  return m;
}

/** Per-item units RETURNED, combos expanded (damaged returns included — they
 *  aren't restocked, so they correctly reduce what a void/delete puts back). */
function expandReturnedUnits(returns: any[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of returns || []) {
    const q = Number(r.returnedQuantity) || 0;
    if (q <= 0) continue;
    if (r.isCombo && Array.isArray(r.comboComponents)) {
      for (const c of r.comboComponents) {
        const u = (Number(c.quantity) || 0) * q;
        if (u > 0) m.set(c.itemId, (m.get(c.itemId) || 0) + u);
      }
    } else if (r.itemId) {
      m.set(r.itemId, (m.get(r.itemId) || 0) + q);
    }
  }
  return m;
}

/** Create or edit an invoice: customer link/update + stock decrement, atomic.
 * New sales get a server-authoritative, collision-free invoice number. */
export function createSale(inv: any, reqUser?: any) {
  if (reqUser && reqUser.role !== 'CEO' && reqUser.assignedBranchId && inv.branchId !== reqUser.assignedBranchId) {
    throw new AppError('FORBIDDEN', `You are only authorized to bill for branch ${reqUser.assignedBranchId}`, 403);
  }
  recomputeInvoiceMoney(inv); // server-authoritative totals
  // Salesperson incentive: store the ₹ computed from the authoritative grand total.
  if (inv.salespersonId && Number(inv.incentivePercent) > 0) {
    inv.incentiveAmount = Math.round((inv.grandTotal || 0) * Number(inv.incentivePercent)) / 100;
  } else {
    inv.salespersonId = inv.salespersonId || null;
    inv.salespersonName = inv.salespersonName || null;
    inv.incentivePercent = inv.incentivePercent ?? null;
    inv.incentiveAmount = inv.incentiveAmount ?? null;
  }
  return serializableTx(async (tx: any) => {
    const reg = await tx.dailyCashRegister.findFirst({
      where: { branchId: inv.branchId, date: inv.date, isClosed: true },
    });
    if (reg) throw new AppError('DAY_CLOSED', 'Cash register for this day is closed', 409);

    // Reject nonsensical line quantities: a zero or negative quantity produced a
    // ₹0 bill and, worse, a negative quantity *added* stock instead of selling it
    // (SAL2-8).
    for (const li of (inv.items as any[]) || []) {
      const q = Number(li.quantity);
      if (!Number.isFinite(q) || q <= 0) {
        throw new AppError('INVALID_QTY', 'Every line must have a quantity greater than zero.', 400);
      }
    }

    const existing = await tx.invoice.findUnique({ where: { id: inv.id } });
    const isNewSale = !existing;
    const oldInvoice = existing;
    if (existing) {
      // A voided bill is final — it must not be edited back into a live sale that
      // adds phantom stock (SAL2-7).
      if (existing.isVoided) throw new AppError('VOIDED', 'A voided bill cannot be edited.', 400);
      // SAL3-2: a bill that already has returns must not be edited. The edit path
      // below restores the FULL sold quantity of the old bill before applying the
      // new lines, but the returned units were already put back into stock when
      // the return was recorded — so editing double-restores them and fabricates
      // stock (and the returned amount can exceed the new bill). Reverse/delete the
      // return first.
      const existingReturns = ((existing.returns as any[]) || []);
      if (existingReturns.some((r: any) => (r.returnedQuantity || 0) > 0)) {
        throw new AppError(
          'HAS_RETURNS',
          'This bill has returns recorded against it and cannot be edited. Reverse the return first.',
          409
        );
      }
      // Branch and invoice number are immutable on edit: changing the branch
      // orphans the original branch's stock, and changing the number breaks the
      // sequence (SAL2-6).
      inv.branchId = existing.branchId;
      inv.invoiceNumber = existing.invoiceNumber;
      // Moving a bill off a date whose drawer is already closed would change that
      // reconciled day's totals after the fact (the new date's closed-day check
      // above already blocks moving it ONTO a closed day) — CASH-2.
      if (existing.date !== inv.date) {
        const oldClosed = await tx.dailyCashRegister.findFirst({
          where: { branchId: existing.branchId, date: existing.date, isClosed: true },
        });
        if (oldClosed) {
          throw new AppError('DAY_CLOSED', `This bill is dated ${existing.date}, a closed cash day. Reopen that day before changing the bill's date.`, 409);
        }
      }
      // SEC5-2: the guard at the top of this function ran against the client's
      // inv.branchId. On an edit, authorize against the STORED bill's branch too,
      // so a branch-locked user can't edit another branch's bill by putting their
      // own branch in the request body.
      if (reqUser && reqUser.role !== 'CEO' && reqUser.assignedBranchId && existing.branchId !== reqUser.assignedBranchId) {
        throw new AppError('FORBIDDEN', `You are only authorized to edit bills for branch ${reqUser.assignedBranchId}`, 403);
      }
    }
    if (isNewSale) {
      // SAL3-1: a quotation can only become ONE live invoice. The client hides
      // the Convert button once converted, but that is bypassable and races, so
      // reject a second conversion of the same estimate on the server. A voided
      // conversion frees the estimate to be converted again.
      if (inv.sourceEstimateId) {
        // isVoided is optional (Boolean?) — a live bill stores NULL, not false.
        // `NOT: { isVoided: true }` looks right but in SQL `NOT(NULL = true)` is
        // NULL, so it excludes every NULL row too and the guard matched nothing.
        // Match "voided is null OR false" explicitly so any existing non-voided
        // conversion blocks a second one (SAL3-1).
        const already = await tx.invoice.findFirst({
          where: {
            sourceEstimateId: inv.sourceEstimateId,
            OR: [{ isVoided: null }, { isVoided: false }],
          },
        });
        if (already) {
          throw new AppError('ALREADY_CONVERTED', `This quotation was already converted to invoice ${already.invoiceNumber}.`, 409);
        }
      }
      inv.invoiceNumber = await nextInvoiceNumber(tx, inv.branchId, inv.date);
      // SAL2-1/NUM-1: the browser mints the id as `inv-${Date.now()}`, so two
      // bills saved in the same millisecond collide — the second would be seen
      // as an edit of the first and overwrite it. Assign a collision-proof id
      // server-side. The client rebuilds its list from the returned snapshot, so
      // it adopts this id transparently.
      inv.id = `inv-${randomUUID()}`;
    }
    // SAL-9: on a NEW bill the frontend guarantees the splits sum to the total,
    // so the server can (and must) derive the authoritative paid/due/drawer split
    // here — this is where a tampered client that understates the due or the cash
    // collected is corrected. On an EDIT we deliberately do NOT recompute the due
    // from the splits: a payment recorded via /api/payments reduces the stored
    // COD-Credit split without touching the collected split, so the stored splits
    // no longer sum to the total, and recomputing would resurrect already-settled
    // debt.
    if (isNewSale) {
      reconcileInvoicePayment(inv);
    } else {
      // On an EDIT, does the bill have receipts recorded through /api/payments?
      const existingReceipts = await tx.payment.findMany({ where: { type: 'in' }, select: { allocations: true } });
      const hasReceipts = existingReceipts.some((p: any) =>
        Array.isArray(p.allocations) && p.allocations.some((a: any) => a?.refId === existing!.id && (Number(a?.amount) || 0) > 0),
      );
      if (hasReceipts) {
        // CRM6-1 / SAL6-2: a bill that has receipts keeps its server-settled payment
        // state — accepting the client's (often stale) splits would resurrect the
        // settled debt. Receipts remain the only way to change its due.
        inv.paymentSplits = existing!.paymentSplits ?? inv.paymentSplits;
        inv.balanceDue = existing!.balanceDue ?? 0;
        inv.isPartialPayment = existing!.isPartialPayment ?? false;
        inv.partialAmount = existing!.partialAmount ?? null;
        inv.paymentMode = existing!.paymentMode ?? inv.paymentMode;
        inv.creditOriginal = existing!.creditOriginal ?? undefined;
      } else {
        // No receipts yet: the payment is entirely at-billing, so re-reconcile the
        // client's new splits to the new total (QA8-1 — editing a paid cash bill to
        // a higher total records the new payment, not a hidden due). Re-anchor the
        // credit from the fresh split.
        reconcileInvoicePayment(inv);
        inv.creditOriginal = null;
      }
    }
    const phoneClean = cleanPhone(inv.customerPhone);
    const ts = nowIso();

    // Customer link / update (never match by name alone to prevent merging distinct customers)
    const customers = await tx.customer.findMany();
    const cust =
      (inv.customerId && customers.find((c: any) => c.id === inv.customerId)) ||
      (phoneClean && customers.find((c: any) => cleanPhone(c.phone) === phoneClean)) ||
      null;

    // Customer this bill was previously linked to (edit path). If the edit moves
    // the bill to a different customer, the old one's totals must be reversed
    // (CRM2-12) — handled after the new link is applied below.
    const oldCustomerId = oldInvoice ? (oldInvoice.customerId || null) : null;

    if (cust) {
      inv.customerId = cust.id;
      // A reassigned edit is a fresh purchase for the newly-linked customer: don't
      // back out an old spend they never had, and do bump their purchase count.
      const movedFromAnother = !!oldInvoice && oldCustomerId !== cust.id;
      const oldSpent = oldInvoice && !movedFromAnother ? oldInvoice.grandTotal : 0;
      const newCount = isNewSale || movedFromAnother ? (cust.purchaseCount || 0) + 1 : cust.purchaseCount;
      const newSpent = Math.max(0, (cust.totalSpent || 0) - oldSpent + inv.grandTotal);
      await tx.customer.update({
        where: { id: cust.id },
        data: {
          // Do not silently overwrite customer master details with invoice inputs
          name: cust.name || inv.customerName || '',
          phone: cust.phone || inv.customerPhone || '',
          address: cust.address || inv.customerAddress || '',
          purchaseCount: newCount,
          totalSpent: newSpent,
          firstPurchaseDate: cust.firstPurchaseDate || inv.date,
          lastRewardRedeemedPurchaseCount: inv.isLoyaltyRewardApplied
            ? newCount
            : cust.lastRewardRedeemedPurchaseCount,
          updatedAt: ts,
        },
      });
    } else if (phoneClean || inv.customerId) {
      // Only create/link a customer master when there is a real phone or an explicit
      // customerId. A walk-in with no phone must NOT create a phone:'' record — the
      // phone column is unique, so the second such walk-in would 409 (SAL2-2). The
      // invoice still keeps customerName for display.
      const newCustId = inv.customerId || rid('cust');
      inv.customerId = newCustId;
      await tx.customer.create({
        data: {
          id: newCustId,
          name: (inv.customerName || 'Customer').trim(),
          phone: inv.customerPhone || '',
          address: inv.customerAddress || '',
          firstPurchaseDate: inv.date,
          purchaseCount: 1,
          totalSpent: inv.grandTotal,
          lastRewardRedeemedPurchaseCount: inv.isLoyaltyRewardApplied ? 1 : null,
          notes: 'Auto-created from Sale',
          createdAt: ts,
          updatedAt: ts,
        },
      });
    } else {
      // Walk-in with no phone / no customerId: no customer master, display-only name.
      inv.customerId = null;
    }

    // Editing a bill onto a different customer: back the old invoice's contribution
    // off the previously-linked customer so its totals don't stay inflated (CRM2-12).
    if (oldCustomerId && oldCustomerId !== inv.customerId) {
      const oldCust = customers.find((c: any) => c.id === oldCustomerId);
      if (oldCust) {
        await tx.customer.update({
          where: { id: oldCustomerId },
          data: {
            purchaseCount: Math.max(0, (oldCust.purchaseCount || 1) - 1),
            totalSpent: Math.max(0, (oldCust.totalSpent || 0) - (oldInvoice.grandTotal || 0)),
            updatedAt: ts,
          },
        });
      }
    }

    // A combo's components come from the STORED combo master, never the browser —
    // a tampered request (claiming the kit uses 0 of item A) must not change what
    // stock is taken (INV3-3). Normalise each combo line's stored components too,
    // so later void/return restock from the real parts.
    const comboMasters = await tx.comboItem.findMany();
    const comboById = new Map(comboMasters.map((c: any) => [c.id, c]));
    const componentsOf = (line: any): any[] => {
      const master: any = line.comboId ? comboById.get(line.comboId) : null;
      const comps = (master?.components as any[]) || (line.comboComponents as any[]) || [];
      // Never trust a negative component quantity.
      return comps.map((c: any) => ({ ...c, quantity: Math.max(0, Number(c.quantity) || 0) }));
    };
    for (const li of inv.items as any[]) {
      if (li.isCombo) li.comboComponents = componentsOf(li);
    }

    // Build demand maps (combo-expanded via the stored master) for the NEW bill and
    // the OLD bill (edit). Stock change per item = restored(old) − sold(new).
    const expand = (items: any[], into: Map<string, { qty: number; name: string; code: string }>) => {
      for (const it of items || []) {
        if (it.isCombo) {
          for (const comp of componentsOf(it)) {
            const needed = (Number(comp.quantity) || 0) * (Number(it.quantity) || 0);
            const cur = into.get(comp.itemId) || { qty: 0, name: comp.itemName || 'Combo component', code: comp.itemCode || '' };
            into.set(comp.itemId, { qty: cur.qty + needed, name: cur.name, code: cur.code });
          }
        } else if (it.itemId) {
          const needed = Number(it.quantity) || 0;
          const cur = into.get(it.itemId) || { qty: 0, name: it.itemName || 'Item', code: it.itemCode || '' };
          into.set(it.itemId, { qty: cur.qty + needed, name: cur.name, code: cur.code });
        }
      }
    };
    const demand = new Map<string, { qty: number; name: string; code: string }>();
    const oldDemand = new Map<string, { qty: number; name: string; code: string }>();
    expand(inv.items as any[], demand);
    if (oldInvoice) expand(oldInvoice.items as any[], oldDemand);

    const allStocks = await tx.branchStock.findMany();
    const ledger = new StockLedger(allStocks, inv.branchId);
    // Restore the old bill's units first (edit), so the shortage check sees stock
    // as if this bill never happened.
    for (const [itemId, req] of oldDemand.entries()) ledger.apply(itemId, req.qty);

    for (const [itemId, req] of demand.entries()) {
      const available = ledger.qty(itemId);
      if (available < req.qty) {
        throw new AppError(
          'INSUFFICIENT_STOCK',
          `Insufficient stock for "${req.name}" at this branch. Available: ${available}, Requested: ${req.qty}`,
          400
        );
      }
    }

    // Decrement the new demand.
    for (const [itemId, req] of demand.entries()) {
      if (req.qty > 0) ledger.apply(itemId, -req.qty, false);
    }
    // Record ONE stock-history row per item for the NET change (restored − sold),
    // so an edit's history reconciles to actual stock, not just the raw new qty.
    const saleLogs: any[] = [];
    const allItemIds = new Set<string>([...oldDemand.keys(), ...demand.keys()]);
    for (const itemId of allItemIds) {
      const sold = demand.get(itemId)?.qty || 0;
      const restored = oldDemand.get(itemId)?.qty || 0;
      const net = Math.round((restored - sold) * 100) / 100; // stock change
      if (net === 0) continue;
      const meta = demand.get(itemId) || oldDemand.get(itemId)!;
      const newQty = ledger.qty(itemId);
      saleLogs.push({
        id: rid('adj'), itemId, itemName: meta.name, itemCode: meta.code, branchId: inv.branchId,
        previousQuantity: Math.round((newQty - net) * 100) / 100, quantityChange: net, newQuantity: newQty,
        reason: isNewSale ? 'Sale' : 'Sale (edited)',
        notes: `Sale #${inv.invoiceNumber}${inv.customerName ? ` · ${inv.customerName}` : ''}`,
        adjustedBy: (reqUser?.name) || 'System', timestamp: ts,
      });
    }
    await ledger.flush(tx);
    if (saleLogs.length) await tx.stockAdjustmentLog.createMany({ data: saleLogs });

    const { id, ...rest } = inv;
    // New sales use create with the freshly-minted unique id (never overwrite an
    // existing bill on an id collision); edits update the found row (SAL2-1).
    if (isNewSale) await tx.invoice.create({ data: inv });
    else await tx.invoice.update({ where: { id }, data: rest });
    // Recompute the cached due from the (immutable) split, any receipts and any
    // returns — the single source of truth. On a new bill this equals the credit
    // just billed; on an edit it re-derives the due from the new total while
    // keeping receipts applied, so an edit can neither resurrect settled debt nor
    // miss a total change (CRM6-1 / SAL6-2).
    await recomputeInvoiceBalance(tx, inv.id);
    // Return the authoritative saved row alongside the snapshot so the client can
    // preview/print the bill exactly as stored — server invoice number, server id,
    // reconciled payment split — instead of its provisional client object (SAL4-1).
    const savedInvoice = await tx.invoice.findUnique({ where: { id: inv.id } });
    return { ...(await snapshot(tx)), savedInvoice };
  });
}

/** Void an invoice: restore remaining stock, log, mark voided, decrement customer. */
export function voidInvoice(invoiceId: string, reason: string, actor: string, reqUser?: any) {
  return serializableTx(async (tx: any) => {
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new AppError('NOT_FOUND', 'Sale not found', 404);
    assertBranchAllowed(reqUser, inv.branchId); // SEC2-1
    if (inv.isVoided) throw new AppError('ALREADY_VOIDED', 'Sale already voided', 409);
    if (await invoiceHasReceipts(tx, invoiceId)) {
      throw new AppError('HAS_RECEIPTS', 'This bill has customer receipts recorded against it. Delete/reverse the receipt(s) first, or issue a return instead of voiding.', 409); // CRM6-4
    }
    await assertDayOpen(tx, inv.branchId, inv.date, 'void this bill'); // CASH-2

    const ts = nowIso();
    const items = await tx.item.findMany();
    const itemById = new Map(items.map((i: any) => [i.id, i]));
    const ledger = new StockLedger(await tx.branchStock.findMany(), inv.branchId);
    const newLogs: any[] = [];

    // Restore (sold − already-returned) PER ITEM, aggregated across all lines and
    // combos — restoring per line double-counted the returns when the same item
    // appeared on two lines and left stock behind on a void (SAL5-3).
    const sold = expandSoldUnits(inv.items as any[]);
    const returned = expandReturnedUnits((inv.returns as any[]) || []);
    for (const [itemId, soldQty] of sold.entries()) {
      const restore = Math.max(0, Math.round((soldQty - (returned.get(itemId) || 0)) * 100) / 100);
      if (restore <= 0) continue;
      const { prevQty, newQty } = ledger.apply(itemId, restore);
      const ci: any = itemById.get(itemId);
      newLogs.push({
        id: rid('adj'), itemId, itemName: ci?.itemName || 'Item', itemCode: ci?.itemCode || '',
        branchId: inv.branchId, previousQuantity: prevQty, quantityChange: restore, newQuantity: newQty,
        reason: 'Voided Sale', notes: `Voided Sale #${inv.invoiceNumber} - Reason: ${reason || 'Cancellation'}`,
        adjustedBy: actor, timestamp: ts,
      });
    }
    await ledger.flush(tx);
    if (newLogs.length) await tx.stockAdjustmentLog.createMany({ data: newLogs });

    await tx.invoice.update({
      where: { id: invoiceId },
      data: { isVoided: true, voidReason: reason || 'Cancelled / Voided', voidedAt: ts, voidedBy: actor, updatedAt: ts },
    });
    // The sale is reversed in full — drop any return refund booked against it so
    // the drawer isn't left permanently short by an orphaned 'out' row.
    await purgeReturnRefunds(tx, invoiceId);

    // Reverse the customer's totals for exactly the bill's own linked customer.
    // Matching by phone/name could hit a different customer who happens to share a
    // phone and wrongly shrink their totals (CRM2-11), so key strictly on customerId.
    if (inv.customerId) {
      const cust = await tx.customer.findUnique({ where: { id: inv.customerId } });
      if (cust) {
        await tx.customer.update({
          where: { id: cust.id },
          data: {
            purchaseCount: Math.max(0, (cust.purchaseCount || 1) - 1),
            totalSpent: Math.max(0, (cust.totalSpent || 0) - inv.grandTotal),
            updatedAt: ts,
          },
        });
      }
    }
    return snapshot(tx);
  });
}

/** Partial line-item return: restore stock, log, append return records. */
export function processReturn(
  invoiceId: string,
  returnLines: any[],
  reason: string,
  notes: string | undefined,
  actor: string,
  reqUser?: any,
  refundMode?: string,
) {
  return serializableTx(async (tx: any) => {
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new AppError('NOT_FOUND', 'Sale not found', 404);
    assertBranchAllowed(reqUser, inv.branchId); // SEC2-1
    if (inv.isVoided) throw new AppError('VOIDED', 'Cannot return on a voided sale', 409);
    // Anchor the owed-at-billing credit from the PRE-return state so the cash
    // refund below (over-paid portion only) and the due are computed correctly.
    await ensureCreditOriginal(tx, invoiceId);
    inv.creditOriginal = (await tx.invoice.findUnique({ where: { id: invoiceId }, select: { creditOriginal: true } }))?.creditOriginal ?? inv.creditOriginal;
    // SAL4-12: a return is ALLOWED even after the bill's day is closed — the
    // refund is booked on the RETURN day (see the Payment 'out' row below), so a
    // closed, reconciled day is never changed after the fact. (No assertDayOpen.)
    const validLines = (returnLines || []).filter((l: any) => l.returnQty > 0);
    if (!validLines.length) throw new AppError('NO_LINES', 'No return quantity specified', 400);

    // Cap each return to what was actually sold and not already returned, keyed by
    // item (or combo). Without this, returning more than sold — or an item never on
    // the bill — created stock from nothing (SAL2-4).
    const keyOf = (x: any) => (x.isCombo && x.comboId ? `combo:${x.comboId}` : (x.itemId || x.id));
    const soldByKey = new Map<string, number>();
    for (const it of (inv.items as any[]) || []) {
      soldByKey.set(keyOf(it), (soldByKey.get(keyOf(it)) || 0) + (Number(it.quantity) || 0));
    }
    const returnedByKey = new Map<string, number>();
    for (const r of (inv.returns as any[]) || []) {
      returnedByKey.set(keyOf(r), (returnedByKey.get(keyOf(r)) || 0) + (Number(r.returnedQuantity) || 0));
    }
    const batchByKey = new Map<string, number>();
    for (const line of validLines) {
      const key = keyOf(line);
      const sold = soldByKey.get(key) || 0;
      const already = returnedByKey.get(key) || 0;
      const batch = batchByKey.get(key) || 0;
      const want = Number(line.returnQty) || 0;
      if (sold <= 0) {
        throw new AppError('NOT_ON_BILL', `"${line.itemName || key}" was not sold on this bill and cannot be returned.`, 400);
      }
      if (already + batch + want > sold) {
        const remaining = Math.max(0, sold - already - batch);
        throw new AppError('OVER_RETURN', `Cannot return ${want} of "${line.itemName}" — only ${remaining} remaining to return.`, 400);
      }
      batchByKey.set(key, batch + want);
    }

    const ts = nowIso();
    // Business rule: damaged goods are written off, NOT added back to stock.
    const isDamaged = /damag/i.test(reason || '');
    const stockReason = isDamaged ? 'Sales Return (Damaged - Written Off)' : 'Sales Return';
    const items = await tx.item.findMany();
    const itemById = new Map(items.map((i: any) => [i.id, i]));
    const ledger = new StockLedger(await tx.branchStock.findMany(), inv.branchId);
    const newLogs: any[] = [];
    const returnRecords: any[] = [];

    // Server-authoritative refund per unit = the customer's actual per-unit
    // contribution to the bill: line value (after LINE discount, incl. tax)
    // minus this line's proportional share of the OVERALL discount. This makes
    // returns reflect discounts instead of refunding the raw undiscounted price.
    const invItems: any[] = (inv.items as any[]) || [];
    const subtotalTaxable =
      Number(inv.subtotal) || invItems.reduce((s, i) => s + (Number(i.taxableAmount) || 0), 0);
    const overallDisc = Number(inv.overallDiscountAmount) || 0;
    // Net-of-discount, tax-inclusive value a single stored line contributed per unit.
    const lineUnitValue = (li: any): number => {
      const q = Number(li.quantity) || 1;
      const lineTaxable = Number(li.taxableAmount) || 0;
      const lineNetWithTax = Number(li.totalAmount) || lineTaxable + (Number(li.totalTax) || 0);
      const overallShare = subtotalTaxable > 0 ? overallDisc * (lineTaxable / subtotalTaxable) : 0;
      return (lineNetWithTax - overallShare) / q;
    };
    // Per-unit refund for an item. When the same item sits on more than one line at
    // different prices we can't know which physical unit came back, so refund the
    // AVERAGE per-unit value across all of that item's (non-combo) lines — it's
    // order-independent and a full return still refunds exactly the lines' total
    // (SAL2-11: the old code took the first line's price, arbitrarily the higher one).
    const perUnitRefund = (itemId: string, taxRate: number, fallbackUnitPrice: number): number => {
      const lines = invItems.filter((i) => !i.isCombo && (i.itemId || i.id) === itemId);
      if (!lines.length) {
        // No stored catalogue line — fall back to unit price + tax (legacy behavior).
        return Math.round(fallbackUnitPrice * (1 + (Number(taxRate) || 0) / 100) * 100) / 100;
      }
      const totalQty = lines.reduce((s, li) => s + (Number(li.quantity) || 0), 0);
      const totalValue = lines.reduce((s, li) => s + lineUnitValue(li) * (Number(li.quantity) || 0), 0);
      const perUnit = totalQty > 0 ? totalValue / totalQty : 0;
      return Math.max(0, Math.round(perUnit * 100) / 100);
    };
    // A combo refunds from its own stored line (combos never share with item lines).
    const perUnitComboRefund = (line: any): number => {
      const li = invItems.find(
        (i) => i.isCombo && ((line.comboId && i.comboId === line.comboId) || i.id === line.id),
      );
      return li ? Math.max(0, Math.round(lineUnitValue(li) * 100) / 100)
        : Math.round((Number(line.unitPrice) || 0) * (1 + (Number(line.taxRate) || 0) / 100) * 100) / 100;
    };
    const rawRefundFor = (line: any): number => {
      const per = line.isCombo ? perUnitComboRefund(line) : perUnitRefund(line.itemId, line.taxRate, line.unitPrice);
      return Math.round(per * line.returnQty * 100) / 100;
    };

    // Ceiling: total refunds across ALL returns can never exceed the invoice's
    // grand total. If historical returns used a different (looser) calc, cap the
    // remaining refund and scale this batch's lines proportionally to fit.
    const refundCeiling = Math.max(0, (Number(inv.grandTotal) || 0) - (Number(inv.totalReturnedAmount) || 0));
    const rawBatchTotal = validLines.reduce((s: number, l: any) => s + rawRefundFor(l), 0);
    const refundScale = rawBatchTotal > refundCeiling && rawBatchTotal > 0 ? refundCeiling / rawBatchTotal : 1;
    const refundFor = (line: any): number => Math.round(rawRefundFor(line) * refundScale * 100) / 100;

    // For a combo, restock from the SOLD line's component list (what the sale
    // actually consumed), never the client's request — otherwise a request with
    // inflated component quantities could restore more than was ever sold and
    // create stock from nothing (STK-1).
    const soldComboComponents = (line: any): any[] => {
      const sold = (inv.items as any[]).find(
        (it) => it.isCombo && ((line.comboId && it.comboId === line.comboId) || it.id === line.id),
      );
      return (sold?.comboComponents as any[]) || line.comboComponents || [];
    };

    for (const line of validLines) {
      if (line.isCombo && (soldComboComponents(line).length || line.comboComponents?.length)) {
        for (const comp of soldComboComponents(line)) {
          // Damaged returns restore 0 units (write-off); others restock normally.
          const qtyToRestore = isDamaged ? 0 : comp.quantity * line.returnQty;
          const { prevQty, newQty } = ledger.apply(comp.itemId, qtyToRestore);
          const ci: any = itemById.get(comp.itemId);
          newLogs.push({
            id: rid('adj'), itemId: comp.itemId, itemName: ci?.itemName || 'Component Item',
            itemCode: ci?.itemCode || '', branchId: inv.branchId, previousQuantity: prevQty,
            quantityChange: qtyToRestore, newQuantity: newQty, reason: stockReason,
            notes: `Sales Return on #${inv.invoiceNumber} (Component of Combo: ${line.itemName}) - ${reason}${notes ? ` (${notes})` : ''}${isDamaged ? ' [damaged — not restocked]' : ''}`,
            adjustedBy: actor, timestamp: ts,
          });
        }
        returnRecords.push({
          id: rid('ret'), itemId: line.itemId, itemCode: line.itemCode, itemName: line.itemName,
          returnedQuantity: line.returnQty, unitPrice: line.unitPrice, taxRate: line.taxRate,
          refundAmount: refundFor(line), returnedAt: ts, reason, notes, processedBy: actor,
          isCombo: true, comboId: line.comboId, comboComponents: line.comboComponents,
        });
      } else {
        // Only restore stock for real catalogue items. A typed service line (e.g.
        // "Installation Service Charge") has no catalogue item, so restocking it would
        // create phantom stock and a bogus log entry (SAL-14) — skip it.
        const isCatalogItem = itemById.has(line.itemId);
        const qtyToRestore = isDamaged || !isCatalogItem ? 0 : line.returnQty;
        if (isCatalogItem) {
          const { prevQty, newQty } = ledger.apply(line.itemId, qtyToRestore);
          newLogs.push({
            id: rid('adj'), itemId: line.itemId, itemName: line.itemName, itemCode: line.itemCode,
            branchId: inv.branchId, previousQuantity: prevQty, quantityChange: qtyToRestore,
            newQuantity: newQty, reason: stockReason,
            notes: `Sales Return on #${inv.invoiceNumber} - ${reason}${notes ? ` (${notes})` : ''}${isDamaged ? ' [damaged — not restocked]' : ''}`,
            adjustedBy: actor, timestamp: ts,
          });
        }
        returnRecords.push({
          id: rid('ret'), itemId: line.itemId, itemCode: line.itemCode, itemName: line.itemName,
          returnedQuantity: line.returnQty, unitPrice: line.unitPrice, taxRate: line.taxRate,
          refundAmount: refundFor(line), returnedAt: ts, reason, notes, processedBy: actor,
        });
      }
    }
    await ledger.flush(tx);
    if (newLogs.length) await tx.stockAdjustmentLog.createMany({ data: newLogs });

    const totalRefund = returnRecords.reduce((s, r) => s + r.refundAmount, 0);
    const existingReturns = (inv.returns as any[]) || [];
    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        returns: [...existingReturns, ...returnRecords],
        totalReturnedAmount: (inv.totalReturnedAmount || 0) + totalRefund,
        updatedAt: ts,
      },
    });
    // A return reduces what the customer still owes — refresh the cached due.
    await recomputeInvoiceBalance(tx, invoiceId);

    // How much CASH to actually pay back. A return credits the customer the
    // goods value, which FIRST reduces what they still owe; only the portion by
    // which their payments now EXCEED the (reduced) net bill is refunded. So a
    // return on an unpaid credit bill refunds ₹0 (it just cuts the debt), while a
    // return on a fully-paid bill refunds the full value. Caps the refund at what
    // was actually paid — the drawer never pays out money the customer never gave.
    const grandR = Number(inv.grandTotal) || 0;
    const creditOrig = Math.max(0, Number(inv.creditOriginal) || 0);
    const receipts = await invoiceReceiptsTotal(tx, invoiceId);
    const paid = Math.max(0, Math.round(((grandR - creditOrig) + receipts) * 100) / 100); // collected-at-billing + receipts
    const returnsBefore = Number(inv.totalReturnedAmount) || 0;
    const returnsAfter = returnsBefore + totalRefund;
    const overBefore = Math.max(0, Math.round((paid - (grandR - returnsBefore)) * 100) / 100);
    const overAfter = Math.max(0, Math.round((paid - (grandR - returnsAfter)) * 100) / 100);
    const cashRefund = Math.max(0, Math.round((overAfter - overBefore) * 100) / 100);

    // 'Adjust to credit note' means: don't pay cash now — the due reduction above
    // is the adjustment. (A standalone store-credit balance isn't tracked yet, so
    // any over-paid amount on a credit-note return isn't bankable later.)
    const isCreditNote = /credit|adjust/i.test(String(refundMode || ''));
    if (cashRefund > 0.001 && !isCreditNote) {
      const mode = refundMode || 'Cash';
      const today = nowIso().slice(0, 10);
      // The refund is a cash payout dated TODAY. If today's drawer is already
      // closed, paying it out would change a reconciled day — block it (the caller
      // can reopen today or choose 'Adjust to credit note'). CASH-2 / SAL4-12.
      const closedToday = await tx.dailyCashRegister.findFirst({
        where: { branchId: inv.branchId, date: today, isClosed: true },
      });
      if (closedToday) {
        throw new AppError('DAY_CLOSED', `Today's cash day (${today}) is closed, so a cash refund can't be paid out. Reopen today's register, or use 'Adjust to credit note'.`, 409);
      }
      const like = `PAY-${today.slice(0, 7).replace('-', '')}-`;
      const rows = await tx.payment.findMany({ where: { receiptNumber: { startsWith: like }, type: 'out' }, select: { receiptNumber: true } });
      let maxNo = 0;
      for (const r of rows) {
        const n = parseInt(String(r.receiptNumber).slice(like.length), 10);
        if (!Number.isNaN(n)) maxNo = Math.max(maxNo, n);
      }
      await tx.payment.create({
        data: {
          id: rid('pay'), receiptNumber: `${like}${String(maxNo + 1).padStart(4, '0')}`,
          type: 'out', partyType: 'customer', partyId: inv.customerId ?? null, partyName: inv.customerName || 'Customer',
          branchId: inv.branchId, date: today, amount: cashRefund, paymentMode: mode,
          reference: inv.invoiceNumber ?? null, notes: `Refund on sale #${inv.invoiceNumber}${reason ? ` — ${reason}` : ''}`,
          allocations: [{ refId: inv.id, refNumber: inv.invoiceNumber, amount: cashRefund }] as any,
          createdById: null, createdByName: actor, createdAt: ts,
        },
      });
    }
    return snapshot(tx);
  });
}

/** Hard delete + restore stock. */
export function deleteInvoice(invoiceId: string, reqUser?: any) {
  return serializableTx(async (tx: any) => {
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (inv) {
      assertBranchAllowed(reqUser, inv.branchId); // SEC2-1
      if (await invoiceHasReceipts(tx, invoiceId)) {
        throw new AppError('HAS_RECEIPTS', 'This bill has customer receipts recorded against it. Delete/reverse the receipt(s) first.', 409); // CRM6-4
      }
      await assertDayOpen(tx, inv.branchId, inv.date, 'delete this bill'); // CASH-2
      const ledger = new StockLedger(await tx.branchStock.findMany(), inv.branchId);
      // Only restore stock that is still OUT because of this bill. A voided bill
      // already had its stock restored on void, and a returned bill already
      // restored the returned units — restoring the full sold quantity here
      // double-counts them (STK-2). Skip voided bills; for the rest restore
      // sold − already-returned, AGGREGATED per item (not per line — SAL5-3), and
      // write a history row so the ledger reconciles (INV2-4).
      if (!inv.isVoided) {
        const items = await tx.item.findMany();
        const itemById = new Map(items.map((i: any) => [i.id, i]));
        const sold = expandSoldUnits(inv.items as any[]);
        const returned = expandReturnedUnits((inv.returns as any[]) || []);
        const ts = nowIso();
        const delLogs: any[] = [];
        for (const [itemId, soldQty] of sold.entries()) {
          const restore = Math.max(0, Math.round((soldQty - (returned.get(itemId) || 0)) * 100) / 100);
          if (restore <= 0) continue;
          const { prevQty, newQty } = ledger.apply(itemId, restore);
          const ci: any = itemById.get(itemId);
          delLogs.push({
            id: rid('adj'), itemId, itemName: ci?.itemName || 'Item', itemCode: ci?.itemCode || '',
            branchId: inv.branchId, previousQuantity: prevQty, quantityChange: restore, newQuantity: newQty,
            reason: 'Deleted Sale', notes: `Deleted Sale #${inv.invoiceNumber}`,
            adjustedBy: (reqUser?.name) || 'System', timestamp: ts,
          });
        }
        await ledger.flush(tx);
        if (delLogs.length) await tx.stockAdjustmentLog.createMany({ data: delLogs });
      }
      // Drop any return refund booked against this bill before erasing it, so the
      // drawer isn't left short by an 'out' row pointing at a deleted invoice.
      await purgeReturnRefunds(tx, invoiceId);
      await tx.invoice.delete({ where: { id: invoiceId } });
    }
    return snapshot(tx);
  });
}
