import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { AppError } from '../middleware/errorHandler.js';
import { StockLedger, nowIso, cleanPhone, rid } from '../lib/stockLedger.js';
import { nextInvoiceNumber, nextPersistent, financialYear } from '../lib/sequences.js';
import { lockedTx, lockInvoice, lockEstimate, lockCustomers, lockStockRows } from '../lib/tx.js';
import { calculateLineTax, calculateInvoiceTotals } from '../lib/taxCalc.js';
import { assertBranchAllowed } from '../lib/branchGuard.js';
import { recomputeInvoiceBalance, ensureCreditOriginal, invoiceReceiptsTotal, invoiceRefundsTotal, invoiceCreditBackTotal, invoiceDueRaw, applyPendingAdvanceToBill, nextReceiptNumber, allocatedTo } from './payment.service.js';
import { legacyRefundId, creditBackForBill } from '../lib/returnRefunds.js';
import { addCustomerCredit, applyCreditDelta, creditBalanceOf } from './customerCredit.service.js';
import { assertLineInputs, assertLinesAgainstCatalogue } from '../lib/lineValidation.js';
import { applySupplySplit } from '../lib/supply.js';
import { isValidBranch } from '../lib/constants.js';
import { isWholeUnit } from '../lib/units.js';
import { roleFlags } from '../lib/auth.js';
import { assertBusinessDate, assertDayOpen, closedDayFrom, istToday } from '../lib/businessDate.js';
import { collectedAtBilling, billingSplitsOf } from '../lib/billingSplit.js';
import { assertMode, REFUND_MODES } from '../lib/paymentModes.js';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Recompute every line's tax and the invoice totals from raw inputs, overriding
 * whatever the client sent. Makes stored money values server-authoritative so a
 * tampered or buggy client can never persist incorrect amounts.
 */
function recomputeInvoiceMoney(inv: any) {
  const withGst = !!inv.withGst;
  // Validate line inputs server-side (SAL-17 / SAL4-5): real numbers, price ≥ 0,
  // discount ≤ 100%, quantity > 0, a valid GST slab. Shared with quotes (SAL8-8).
  assertLineInputs(inv, 'bill');

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
  // unchanged; it just isn't split into the two state halves. "Tamil Nadu" with or
  // without its code is intra-state (SAL8-5).
  applySupplySplit(inv);
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
    // SAL10-6: a ₹0 part of a split bill is not a payment — it isn't stored.
    const nonCredit = splits.filter((s) => s.mode !== 'COD-Credit' && s.amount > 0.0049);
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
 * SAL10-1: what a sale-chain write changed. The reply carries ONLY these rows
 * (the bill, its customer(s), the stock rows it moved, the history rows it wrote,
 * the payments on the bill) and the live-update event names them, so other
 * screens fetch just those rows — a save used to answer with every bill,
 * customer, stock row and history row (14 MB at 5,000 bills).
 */
interface SaleChanges {
  invoiceIds: string[];
  customerIds: (string | null | undefined)[];
  branchId: string;
  itemIds: string[];
  logs: any[];
  removedInvoiceIds?: string[];
  removedPaymentIds?: string[];
}

async function saleDelta(tx: any, ch: SaleChanges) {
  const invoiceIds = [...new Set(ch.invoiceIds.filter(Boolean))];
  const customerIds = [...new Set(ch.customerIds.filter(Boolean).map(String))];
  const itemIds = [...new Set(ch.itemIds.filter(Boolean))];
  const invoices = invoiceIds.length ? await tx.invoice.findMany({ where: { id: { in: invoiceIds } } }) : [];
  const customers = customerIds.length ? await tx.customer.findMany({ where: { id: { in: customerIds } } }) : [];
  const branchStocks = itemIds.length ? await tx.branchStock.findMany({ where: { branchId: ch.branchId, itemId: { in: itemIds } } }) : [];
  const payments: any[] = [];
  for (const id of invoiceIds) payments.push(...(await tx.payment.findMany({ where: allocatedTo(id) })));
  const removed = { invoices: ch.removedInvoiceIds || [], payments: ch.removedPaymentIds || [] };
  return {
    delta: true,
    invoices, customers, branchStocks, stockAdjustmentLogs: ch.logs, payments, removed,
    // ids only — for the live-update event (lib/events)
    changes: {
      invoices: invoiceIds, customers: customerIds, stock: itemIds.map((i) => `${i}@${ch.branchId}`),
      logs: ch.logs.map((l: any) => l.id), payments: payments.map((p: any) => p.id), removed,
    },
  };
}

/** Item masters by id (SAL10-1: never the whole catalogue inside a save). */
async function itemsByIds(tx: any, ids: Iterable<string>): Promise<Map<string, any>> {
  const list = [...new Set([...ids].filter(Boolean).map(String))];
  const rows = list.length ? await tx.item.findMany({ where: { id: { in: list } } }) : [];
  return new Map(rows.map((i: any) => [i.id, i]));
}

/**
 * True when at least one customer receipt (a Payment 'in' row) is allocated to
 * this invoice. Voiding or deleting such a bill would strand the receipt against
 * a bill that no longer exists and silently change the customer's ledger and the
 * cash already banked (CRM6-4), so those actions are refused while a receipt
 * exists — the receipt must be deleted/reversed first, or a return issued.
 */
async function invoiceHasReceipts(tx: any, invoiceId: string, opts: { ignoreTakeBacks?: boolean } = {}): Promise<boolean> {
  const receipts = await tx.payment.findMany({ where: { type: 'in', ...allocatedTo(invoiceId) }, select: { allocations: true, notes: true } });
  return receipts.some(
    (p: any) =>
      !(opts.ignoreTakeBacks && isRefundTakeBack(p)) &&
      Array.isArray(p.allocations) &&
      p.allocations.some((a: any) => a?.refId === invoiceId && (Number(a?.amount) || 0) > 0)
  );
}

/** SAL9-12: the receipt a return reversal books when the refund it undoes was
 *  paid on a closed day ("Refund PAY-… taken back"). With its refund it nets
 *  to ₹0 — it is not a customer payment of the bill. */
const isRefundTakeBack = (p: any): boolean => /^Refund \S+ taken back/.test(String(p?.notes || ''));

/**
 * Remove the cash-refund ledger rows a RETURN booked against this invoice. When a
 * bill is voided or deleted the sale is reversed in full, so its return refunds
 * must go too — otherwise the drawer stays permanently down and an orphaned
 * Payment 'out' row points at a bill that no longer exists (money-model cleanup).
 */
async function purgeReturnRefunds(tx: any, invoiceId: string): Promise<string[]> {
  const outRows = await tx.payment.findMany({ where: { type: 'out', partyType: 'customer', ...allocatedTo(invoiceId) }, select: { id: true, branchId: true, date: true, allocations: true, receiptNumber: true } });
  // SAL9-12: a refund already taken back by a reversal (its take-back receipt
  // exists) is a settled pair that nets to ₹0 in the drawers — both stay as they
  // are (the refund's day may be closed) and the void goes ahead.
  const takeBacks = (await tx.payment.findMany({ where: { type: 'in', ...allocatedTo(invoiceId) }, select: { notes: true } })).filter(isRefundTakeBack);
  const takenBack = (p: any) => !!p.receiptNumber && takeBacks.some((t: any) => String(t.notes).startsWith(`Refund ${p.receiptNumber} taken back`));
  const targets = outRows.filter(
    (p: any) => Array.isArray(p.allocations) && p.allocations.some((a: any) => a?.refId === invoiceId) && !takenBack(p),
  );
  if (!targets.length) return [];
  // A refund was a cash payout on its own day. If that day's drawer is already
  // closed, deleting the refund would silently change a reconciled day — block the
  // void/delete and tell the user to reopen that day first (SAL8-6).
  for (const p of targets) {
    await assertDayOpen(tx, p.branchId, p.date, `void/delete this bill (a refund on it was paid on ${p.date})`);
  }
  await tx.payment.deleteMany({ where: { id: { in: targets.map((p: any) => p.id) } } });
  return targets.map((p: any) => p.id);
}

/** SAL8-10: a voided/deleted bill frees its source quote — Converted → Open. */
async function reopenSourceQuote(tx: any, inv: any): Promise<void> {
  if (!inv?.sourceEstimateId) return;
  await tx.estimate.updateMany({ where: { id: inv.sourceEstimateId, status: 'Converted' }, data: { status: 'Open' } });
}

/** Per-item units a bill SOLD, combos expanded to their components. Used by void
 *  and delete so the restore is aggregated per item, not per line (SAL5-3). */
function expandSoldUnits(items: any[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items || []) {
    const q = Number(it.quantity) || 0;
    if (q <= 0) continue;
    if (it.isCombo) {
      // A combo line moves only its stored parts — never the combo id itself.
      for (const c of (Array.isArray(it.comboComponents) ? it.comboComponents : [])) {
        const u = (Number(c?.quantity) || 0) * q;
        if (u > 0 && c.itemId) m.set(c.itemId, (m.get(c.itemId) || 0) + u);
      }
    } else if (it.itemId) {
      m.set(it.itemId, (m.get(it.itemId) || 0) + q);
    }
  }
  return m;
}

/** The combo line on this bill that a return (or request) refers to, matched by
 *  combo id, line id or the combo's item id. */
function soldComboLine(billItems: any[], ref: any): any | null {
  return (billItems || []).find(
    (it) => it.isCombo && ((ref.comboId && it.comboId === ref.comboId) || (ref.id && it.id === ref.id) || (ref.itemId && (it.itemId === ref.itemId || it.comboId === ref.itemId))),
  ) || null;
}

/** Per-item units RETURNED, combos expanded (damaged returns included — they
 *  aren't restocked, so they correctly reduce what a void/delete puts back).
 *  A combo return is expanded with the parts the BILL sold it with, not the
 *  parts stored on the return record — older builds stored the browser's parts
 *  there, so a void/delete after such a return restored stock twice (INV8-2). */
function expandReturnedUnits(returns: any[], billItems: any[] = []): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of returns || []) {
    const q = Number(r.returnedQuantity) || 0;
    if (q <= 0) continue;
    if (r.isCombo) {
      const sold = soldComboLine(billItems, r);
      const parts = Array.isArray(sold?.comboComponents) ? sold.comboComponents : (Array.isArray(r.comboComponents) ? r.comboComponents : []);
      for (const c of parts) {
        const u = (Number(c?.quantity) || 0) * q;
        if (u > 0 && c.itemId) m.set(c.itemId, (m.get(c.itemId) || 0) + u);
      }
    } else if (r.itemId) {
      m.set(r.itemId, (m.get(r.itemId) || 0) + q);
    }
  }
  return m;
}

/** Create or edit an invoice: customer link/update + stock decrement, atomic.
 * New sales get a server-authoritative, collision-free invoice number. */
/**
 * Freeze each line's purchase cost AT THE TIME OF SALE into `unitCost` (cost of
 * one unit of the line; a combo is the sum of its parts). Profit reports cost a
 * sale at this figure, so a later change to an item's purchase price no longer
 * rewrites past days' profit (E2E5-5). On an edit, a line that is still the same
 * item keeps the cost it was sold at. Typed (non-catalogue) lines cost 0.
 * Older bills have no `unitCost`; the reports fall back to the current cost.
 */
async function snapshotLineCosts(tx: any, lines: any[], previous: any[]): Promise<void> {
  const ids = [...new Set(lines.flatMap((l: any) => [l?.itemId, ...(Array.isArray(l?.comboComponents) ? l.comboComponents.map((c: any) => c?.itemId) : [])]).filter(Boolean).map(String))];
  const items = ids.length ? await tx.item.findMany({ where: { id: { in: ids } }, select: { id: true, purchasePrice: true } }) : [];
  const cost = new Map<string, number>(items.map((i: any) => [i.id, Number(i.purchasePrice) || 0]));
  const before = new Map<string, any>(previous.map((l: any) => [l.id, l]));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  for (const li of lines) {
    const old = before.get(li.id);
    const same = old && old.unitCost != null && (old.itemId || '') === (li.itemId || '') && (old.comboId || '') === (li.comboId || '');
    if (same) { li.unitCost = old.unitCost; continue; }
    if (li.isCombo) {
      li.unitCost = r2(((li.comboComponents as any[]) || []).reduce((t, c) => t + (Number(c.quantity) || 0) * (cost.get(c.itemId) || 0), 0));
    } else {
      li.unitCost = li.itemId && cost.has(li.itemId) ? cost.get(li.itemId)! : 0;
    }
  }
}

/**
 * FIN-B-1: the salesperson's incentive flows into payroll, so the rate is the
 * one set on the Employee master (Staff Directory), never the client's
 * incentivePercent, and the salesperson must be an active employee of the
 * bill's branch. An edit that keeps the bill's salesperson keeps the rate it
 * was billed at (and may keep someone who has since left).
 */
async function applySalesperson(tx: any, inv: any, existing: any): Promise<void> {
  const spId = inv.salespersonId ? String(inv.salespersonId) : null;
  if (!spId) {
    inv.salespersonId = null; inv.salespersonName = null; inv.incentivePercent = null; inv.incentiveAmount = null;
    return;
  }
  const emp = await tx.employee.findUnique({ where: { id: spId }, select: { id: true, name: true, branchId: true, status: true, incentivePercent: true } });
  const kept = !!existing && existing.salespersonId === spId;
  if (!emp && !kept) throw new AppError('BAD_SALESPERSON', 'The salesperson on this bill is not in the Staff Directory.', 400);
  if (!kept && (emp.status !== 'Active' || emp.branchId !== inv.branchId)) {
    throw new AppError('BAD_SALESPERSON', `${String(emp.name).slice(0, 60)} is not an active employee of this branch and can't be the salesperson on its bill.`, 400);
  }
  const rate = kept && existing.incentivePercent != null ? Number(existing.incentivePercent) : Number(emp?.incentivePercent) || 0;
  inv.salespersonId = spId;
  inv.salespersonName = emp?.name ?? existing?.salespersonName ?? null;
  inv.incentivePercent = rate > 0 ? rate : null;
  inv.incentiveAmount = rate > 0 ? Math.round((inv.grandTotal || 0) * rate) / 100 : null;
}

/** CRM-8: a customer's purchase count is the number of their LIVE bills (not a
 *  running counter that drifted), so loyalty reads a true count. */
async function liveBillCount(tx: any, customerId: string, excludeId?: string): Promise<number> {
  return tx.invoice.count({
    where: { customerId, ...(excludeId ? { NOT: { id: excludeId } } : {}), OR: [{ isVoided: null }, { isVoided: false }] },
  });
}

export function createSale(inv: any, reqUser?: any) {
  if (reqUser && reqUser.role !== 'CEO' && reqUser.assignedBranchId && inv.branchId !== reqUser.assignedBranchId) {
    throw new AppError('FORBIDDEN', `You are only authorized to bill for branch ${reqUser.assignedBranchId}`, 403);
  }
  if (!inv || typeof inv !== 'object' || !Array.isArray(inv.items)) {
    throw new AppError('BAD_REQUEST', 'A sale needs its line items.', 400);
  }
  if (!inv.items.length) throw new AppError('NO_LINES', 'A bill needs at least one line.', 400); // SAL10-7
  // E2E8-12: "Skip" on the sale form's new-customer prompt bills the number as a
  // walk-in — no customer master is created for it. Not a bill column.
  const skipCustomerSave = inv.skipCustomerSave === true;
  delete inv.skipCustomerSave;
  // CASH8-7: a bill must carry a real date that is not in the future (IST).
  // An edit sent without a date keeps the stored bill's own date (SEC7-1,
  // filled in inside the transaction below).
  if (inv.date || !inv.id) assertBusinessDate(inv.date, 'A sale');
  recomputeInvoiceMoney(inv); // server-authoritative totals
  return lockedTx(async (tx: any) => {
    // SAL10-1: row locks, not Serializable — an edit locks its bill first.
    await lockInvoice(tx, inv.id);
    // SEC7-1: without a date, `date: undefined` below matched ANY closed day of
    // the branch (spurious DAY_CLOSED). An edit keeps the stored bill's date; a
    // new sale must state one.
    const stored = inv.id ? await tx.invoice.findUnique({ where: { id: inv.id } }) : null;
    if (!inv.date) {
      if (!stored) throw new AppError('DATE_REQUIRED', 'The bill date is required.', 400);
      inv.date = stored.date;
    }
    // CASH9-1: an edit keeps the STORED bill's branch, and the closed-day checks
    // (the new date here, the old date below) run against that branch — sending
    // another branchId must not dodge a closed day.
    if (stored) inv.branchId = stored.branchId;
    // CASH10-1: not on a closed day, nor on any day before the latest closed one.
    await assertDayOpen(tx, inv.branchId, inv.date, stored ? 'edit this bill' : 'save a bill on that date');

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
        await assertDayOpen(tx, existing.branchId, existing.date, `change the date of this bill (dated ${existing.date})`);
      }
      // FIN-A-3: once a bill's month has ended its sales and GST are reported, so
      // it can't be edited at all (same rule as void/delete), nor can an edit move
      // a bill INTO an ended month.
      assertMonthOpen(existing, 'edit');
      if (String(inv.date).slice(0, 7) < istToday().slice(0, 7)) {
        throw new AppError('MONTH_CLOSED', `Bill ${existing.invoiceNumber} can't be moved to ${inv.date}: that month has ended and its sales and GST are already reported.`, 409);
      }
      // SAL3-4: the bill's number belongs to its financial year's series, so a
      // date edit may not move the bill into another financial year.
      if (financialYear(existing.date) !== financialYear(inv.date)) {
        throw new AppError(
          'FY_CHANGE',
          `Bill ${existing.invoiceNumber} belongs to financial year ${financialYear(existing.date)}. Its date can't be moved into ${financialYear(inv.date)} — keep the bill in its own year.`,
          400,
        );
      }
      // SEC5-2: the guard at the top of this function ran against the client's
      // inv.branchId. On an edit, authorize against the STORED bill's branch too,
      // so a branch-locked user can't edit another branch's bill by putting their
      // own branch in the request body.
      if (reqUser && reqUser.role !== 'CEO' && reqUser.assignedBranchId && existing.branchId !== reqUser.assignedBranchId) {
        throw new AppError('FORBIDDEN', `You are only authorized to edit bills for branch ${reqUser.assignedBranchId}`, 403);
      }
    }
    await applySalesperson(tx, inv, existing);
    // INV6-4: a new bill must be for a real branch — a bill for 'mars' was saved
    // and took stock from a branch that doesn't exist.
    if (isNewSale && !isValidBranch(inv.branchId)) throw new AppError('BAD_BRANCH', `Unknown branch: ${String(inv.branchId).slice(0, 40)}`, 400);
    // Catalogue rate, ₹0 free-text lines and whole units (SAL4-5, SAL8-9, SAL2-8).
    const flags = reqUser ? roleFlags(reqUser.role) : null;
    await assertLinesAgainstCatalogue(tx, inv, inv.branchId, {
      previousItems: (existing?.items as any[]) || [],
      // SAL4-5: the billing rights of the access matrix, enforced here too.
      canEditPrice: flags ? flags.includes('bill.editPrice') : undefined,
      canDiscount: flags ? flags.includes('bill.giveDiscount') : undefined,
    });
    if (isNewSale) {
      // SAL8-2: a bill made from a quotation must point at a real, live quote of
      // the same branch — not a made-up id, a cancelled quote or another branch's.
      if (inv.sourceEstimateId) {
        await lockEstimate(tx, String(inv.sourceEstimateId)); // SAL3-1: one conversion at a time
        const est = await tx.estimate.findUnique({ where: { id: String(inv.sourceEstimateId) } });
        if (!est) throw new AppError('QUOTE_NOT_FOUND', 'The quotation this bill is made from does not exist.', 400);
        if (est.status === 'Cancelled') {
          throw new AppError('QUOTE_CANCELLED', `Quotation ${est.estimateNumber} was cancelled and can't be billed.`, 409);
        }
        if (est.branchId !== inv.branchId) {
          throw new AppError('QUOTE_OTHER_BRANCH', `Quotation ${est.estimateNumber} belongs to another branch.`, 400);
        }
        inv.sourceEstimateNumber = est.estimateNumber;
      }
      // CRM10-6: a bill made from an enquiry must name a real enquiry of its
      // branch (the link can close the enquiry and spend its advance).
      if (inv.sourceEnquiryId) {
        const enq = await tx.enquiry.findUnique({ where: { id: String(inv.sourceEnquiryId) } });
        if (!enq) throw new AppError('ENQUIRY_NOT_FOUND', 'The enquiry this bill is made from does not exist.', 400);
        if (enq.branchId !== inv.branchId) throw new AppError('ENQUIRY_OTHER_BRANCH', `Enquiry ${enq.enquiryNumber} belongs to another branch.`, 400);
      }
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
    // CRM9-3 / CRM9-5: on an edit, what the customer has already paid on this
    // bill (own-day split + receipts − refunds − credit given back). An edit to a
    // total below that keeps the collected split as it is (the drawer never
    // shrinks silently) and gives the excess back as store credit after save.
    let editExcess = 0;
    let creditBackSoFar = 0;
    // SAL9-2: a bill is collected in Cash, GPay or HDFC, or left owing
    // (COD-Credit). "Store Credit", "Bitcoin" or anything else is refused — store
    // credit is applied with a receipt after billing. An edit may keep a mode the
    // stored bill already had (older data).
    const allowedModes = new Set<string>(['Cash', 'GPay', 'HDFC', 'COD-Credit']);
    if (existing) for (const sp of billingSplitsOf(existing)) if (sp?.mode) allowedModes.add(String(sp.mode));
    const sentModes = [
      ...(Array.isArray(inv.paymentSplits) ? inv.paymentSplits.filter((sp: any) => sp && (Number(sp.amount) || 0) > 0).map((sp: any) => sp.mode) : []),
      ...(inv.paymentMode && !(Array.isArray(inv.paymentSplits) && inv.paymentSplits.some((sp: any) => (Number(sp?.amount) || 0) > 0)) ? [inv.paymentMode] : []),
    ];
    const badMode = sentModes.find((m: any) => !allowedModes.has(String(m)));
    if (badMode !== undefined) {
      throw new AppError('BAD_MODE', `"${String(badMode).slice(0, 30)}" is not a payment mode for a bill. Use Cash, GPay, HDFC or Credit (owed).`, 400);
    }
    if (isNewSale) {
      reconcileInvoicePayment(inv);
    } else {
      // On an EDIT, does the bill have receipts recorded through /api/payments?
      const existingReceipts = await tx.payment.findMany({ where: { type: 'in', ...allocatedTo(existing.id) }, select: { allocations: true } });
      const hasReceipts = existingReceipts.some((p: any) =>
        Array.isArray(p.allocations) && p.allocations.some((a: any) => a?.refId === existing!.id && (Number(a?.amount) || 0) > 0),
      );
      creditBackSoFar = await invoiceCreditBackTotal(tx, existing);
      const r2e = (n: number) => Math.round(n * 100) / 100;
      const paidSoFar = r2e(collectedAtBilling(existing) + (await invoiceReceiptsTotal(tx, existing!.id)) - (await invoiceRefundsTotal(tx, existing!.id)) - creditBackSoFar);
      editExcess = Math.max(0, r2e(paidSoFar - (Number(inv.grandTotal) || 0))); // a bill with returns can't be edited (SAL3-2)
      if (editExcess <= 0.009) editExcess = 0;
      // FIN-A-1: a bill whose earlier edit below the amount paid gave store credit
      // back keeps its collected split too — that credit is applied back to the
      // higher total after save (CRM10-2), so taking the client's single-mode split
      // (reset to the full total) would put money in the drawer nobody collected.
      if (hasReceipts || editExcess > 0 || creditBackSoFar > 0.009) {
        // CRM6-1 / SAL6-2: a bill that has receipts keeps its server-settled payment
        // SPLIT — accepting the client's (often stale) splits would resurrect the
        // settled debt. Receipts remain the only way to pay it down.
        // What was collected at billing stays exactly as it was (a legacy bill with
        // no stored split gets it made explicit); only the owed COD-Credit part
        // follows the new total.
        const kept = billingSplitsOf(existing).filter((sp) => sp.mode !== 'COD-Credit');
        const owedAtBilling = Math.max(0, Math.round(((inv.grandTotal || 0) - collectedAtBilling(existing)) * 100) / 100);
        inv.paymentSplits = owedAtBilling > 0.009 ? [...kept, { mode: 'COD-Credit', amount: owedAtBilling }] : kept;
        inv.isPartialPayment = existing!.isPartialPayment ?? false;
        inv.partialAmount = existing!.partialAmount ?? null;
        inv.paymentMode = existing!.paymentMode ?? inv.paymentMode;
        // SAL8-1: but DO re-anchor the owed-at-billing credit to the (possibly new)
        // total. Keep what was collected at billing from the immutable original
        // split; the credit is newTotal − that. recomputeInvoiceBalance (end of this
        // fn) then derives the due from this anchor, the receipts and the returns —
        // so changing a billed-and-received bill's total updates what's owed instead
        // of freezing the old amount.
        const collected = collectedAtBilling(existing);
        inv.creditOriginal = Math.max(0, Math.round(((inv.grandTotal || 0) - collected) * 100) / 100);
        inv.balanceDue = inv.creditOriginal; // provisional — refreshed from the ledger after save
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
    // SAL10-1: look the customer up (by id, else by normalised phone) and lock
    // their row — never read every customer inside the save.
    let custId: string | null = null;
    if (inv.customerId && (await tx.customer.findUnique({ where: { id: String(inv.customerId) }, select: { id: true } }))) custId = String(inv.customerId);
    if (!custId && phoneClean) {
      const phones = await tx.customer.findMany({ select: { id: true, phone: true } });
      custId = phones.find((c: any) => cleanPhone(c.phone) === phoneClean)?.id ?? null;
    }
    await lockCustomers(tx, [custId, oldInvoice?.customerId]);
    const cust = custId ? await tx.customer.findUnique({ where: { id: custId } }) : null;

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
      const newCount = (await liveBillCount(tx, cust.id, inv.id)) + 1;
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
    } else if (skipCustomerSave && !inv.customerId) {
      // The cashier chose Skip: bill the typed number as a walk-in (E2E8-12).
      inv.customerId = null;
    } else if (phoneClean || inv.customerId) {
      // Only create/link a customer master when there is a real phone or an explicit
      // customerId. A walk-in with no phone must NOT create a phone:'' record — the
      // phone column is unique, so the second such walk-in would 409 (SAL2-2). The
      // invoice still keeps customerName for display.
      // E2E-13: a new customer needs a real 10-digit Indian mobile — a mistyped
      // 9-digit number created a second "Lakshmi Tex Mills" and put the bill on it.
      if (phoneClean && !/^[6-9]\d{9}$/.test(phoneClean)) {
        throw new AppError('BAD_PHONE', `"${String(inv.customerPhone).slice(0, 20)}" is not a 10-digit mobile number. Correct it, pick the customer from the list, or clear the phone for a walk-in.`, 400);
      }
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

    if (oldInvoice) {
      // CRM9-9: receipts and credit given back on this bill belong to its
      // customer's ledger — moving the bill to someone else would leave that
      // money on the wrong account. Delete the receipts first.
      const moved = (oldCustomerId || null) !== (inv.customerId || null);
      if (moved && ((await invoiceReceiptsTotal(tx, oldInvoice.id)) > 0.009 || Math.abs(creditBackSoFar) > 0.009)) {
        throw new AppError('HAS_RECEIPTS', `Bill ${oldInvoice.invoiceNumber} has receipts or store credit on ${oldInvoice.customerName || 'its customer'}'s account, so it can't be moved to another customer. Delete the receipt(s) first.`, 409);
      }
      // CRM9-3: an edit below what was already paid gives the excess back as
      // store credit — a walk-in bill has no account to hold it.
      if (editExcess > 0 && !inv.customerId) {
        throw new AppError('PAID_MORE_THAN_BILL', `₹${editExcess.toFixed(2)} has already been paid on this bill, more than its new total. A walk-in bill can't keep the difference as store credit — record a return (refund) instead, or add the customer.`, 409);
      }
    }

    // Editing a bill onto a different customer: back the old invoice's contribution
    // off the previously-linked customer so its totals don't stay inflated (CRM2-12).
    if (oldCustomerId && oldCustomerId !== inv.customerId) {
      const oldCust = await tx.customer.findUnique({ where: { id: oldCustomerId } });
      if (oldCust) {
        await tx.customer.update({
          where: { id: oldCustomerId },
          data: {
            purchaseCount: await liveBillCount(tx, oldCustomerId, oldInvoice.id),
            totalSpent: Math.max(0, (oldCust.totalSpent || 0) - (oldInvoice.grandTotal || 0)),
            updatedAt: ts,
          },
        });
      }
    }

    // A combo's components come from the STORED combo master, never the browser —
    // a tampered request (claiming the kit uses 0 of item A) must not change what
    // stock is taken (INV3-3). A combo line must name a combo that exists; a
    // made-up or missing comboId is refused instead of falling back to the
    // browser's parts. On an EDIT, a combo line already on the bill keeps the
    // parts it was sold with, even if the combo master changed since (INV8-3).
    // Each line's normalised parts are stored, so later void/return/delete
    // restock exactly what the sale took.
    // SAL10-1: only the combos and items this bill (and the stored bill) uses.
    const oldLinesAll: any[] = oldInvoice ? ((oldInvoice.items as any[]) || []) : [];
    const lineComboIds = [...new Set((inv.items as any[]).filter((l) => l?.isCombo && l.comboId).map((l) => String(l.comboId)))];
    const comboMasters = lineComboIds.length ? await tx.comboItem.findMany({ where: { id: { in: lineComboIds } } }) : [];
    const comboById = new Map(comboMasters.map((c: any) => [c.id, c]));
    const partIds = (lines: any[]) => lines.flatMap((l: any) => (Array.isArray(l?.comboComponents) ? l.comboComponents.map((c: any) => c?.itemId) : []));
    const neededItemIds = [...new Set([
      ...(inv.items as any[]).map((l) => l?.itemId), ...oldLinesAll.map((l) => l?.itemId),
      ...partIds(inv.items as any[]), ...partIds(oldLinesAll), ...partIds(comboMasters.map((c: any) => ({ comboComponents: c.components }))),
    ].filter(Boolean).map(String))];
    const catalogItems = neededItemIds.length ? await tx.item.findMany({ where: { id: { in: neededItemIds } }, select: { id: true, itemName: true, itemCode: true, isArchived: true } }) : [];
    const catalogById = new Map<string, any>(catalogItems.map((i: any) => [i.id, i]));
    // Positive parts only, named from the item master (INV6-8).
    const cleanParts = (comps: any[]): any[] =>
      (Array.isArray(comps) ? comps : [])
        .filter((c: any) => c && c.itemId && Number(c.quantity) > 0)
        .map((c: any) => ({
          itemId: c.itemId,
          itemName: catalogById.get(c.itemId)?.itemName || c.itemName || 'Combo component',
          itemCode: catalogById.get(c.itemId)?.itemCode || c.itemCode || '',
          quantity: Number(c.quantity),
        }));
    const oldLines: any[] = oldInvoice ? ((oldInvoice.items as any[]) || []) : [];
    for (const li of inv.items as any[]) {
      if (!li.isCombo) continue;
      const kept = oldLines.find(
        (o) => o.isCombo && Array.isArray(o.comboComponents) && o.comboComponents.length &&
          ((li.id && o.id === li.id) || (li.comboId && o.comboId === li.comboId)),
      );
      if (kept) {
        li.comboId = kept.comboId ?? li.comboId;
        li.comboComponents = cleanParts(kept.comboComponents);
        continue;
      }
      const master: any = li.comboId ? comboById.get(li.comboId) : null;
      if (!master) {
        throw new AppError('UNKNOWN_COMBO', `"${String(li.itemName || 'This combo').slice(0, 80)}" is not a combo in the catalog. Pick the combo again from the list.`, 400);
      }
      li.comboComponents = cleanParts(master.components as any[]);
      if (!li.comboComponents.length) {
        throw new AppError('EMPTY_COMBO', `The combo "${master.comboName}" has no valid parts. Fix the combo in Items first.`, 400);
      }
    }

    // Build demand maps (combo-expanded) for the NEW bill and the OLD bill (edit).
    // The old bill is expanded from ITS OWN stored parts — what that sale really
    // took — not today's combo master (INV8-3). Stock change per item =
    // restored(old) − sold(new).
    const expand = (items: any[], into: Map<string, { qty: number; name: string; code: string }>) => {
      for (const it of items || []) {
        if (it.isCombo) {
          for (const comp of (Array.isArray(it.comboComponents) ? it.comboComponents : [])) {
            const needed = Math.max(0, Number(comp?.quantity) || 0) * (Number(it.quantity) || 0);
            if (!comp?.itemId || needed <= 0) continue;
            const ci = catalogById.get(comp.itemId);
            const cur = into.get(comp.itemId) || { qty: 0, name: ci?.itemName || comp.itemName || 'Combo component', code: ci?.itemCode || comp.itemCode || '' };
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

    // SAL10-1: lock and read only this branch's rows of the items involved.
    const ledger = new StockLedger(await lockStockRows(tx, inv.branchId, [...oldDemand.keys(), ...demand.keys()]), inv.branchId);
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
    // SAL10-1: the bill number is taken now, at the end of the checks — its
    // counter row is the last lock and is held only until this save commits.
    if (isNewSale) inv.invoiceNumber = await nextInvoiceNumber(tx, inv.branchId, inv.date);
    // Record ONE stock-history row per item for the NET change (restored − sold),
    // so an edit's history reconciles to actual stock, not just the raw new qty.
    const saleLogs: any[] = [];
    const allItemIds = new Set<string>([...oldDemand.keys(), ...demand.keys()]);
    for (const itemId of allItemIds) {
      const sold = demand.get(itemId)?.qty || 0;
      const restored = oldDemand.get(itemId)?.qty || 0;
      const net = Math.round((restored - sold) * 100) / 100; // stock change
      if (net === 0) continue;
      if (net > 0) assertRestockable(catalogById.get(itemId), 'edit the bill'); // INV10-1
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

    await snapshotLineCosts(tx, inv.items as any[], (oldInvoice?.items as any[]) || []);

    const { id, ...rest } = inv;
    // New sales use create with the freshly-minted unique id (never overwrite an
    // existing bill on an id collision); edits update the found row (SAL2-1).
    if (isNewSale) await tx.invoice.create({ data: inv });
    else await tx.invoice.update({ where: { id }, data: rest });
    // SAL8-10: the quote this bill came from is now Converted (stored, not just
    // worked out on screen). A void puts it back to Open.
    if (isNewSale && inv.sourceEstimateId) {
      await tx.estimate.update({ where: { id: inv.sourceEstimateId }, data: { status: 'Converted' } });
    }
    // CRM9-3 / CRM9-5: the part already paid beyond the new total is the
    // customer's store credit, linked to this bill (it counts against the due
    // like a refund, so a later receipt delete brings the right debt back).
    if (editExcess > 0 && inv.customerId) {
      await addCustomerCredit(tx, inv.customerId, editExcess, {
        type: 'issued',
        reason: `Bill ${inv.invoiceNumber} edited below the amount paid — excess kept as store credit`,
        refId: inv.id,
        refNumber: inv.invoiceNumber ?? undefined,
        by: reqUser?.name,
      });
    }
    // CRM10-2: a bill edited back UP after an edit below what was paid had its
    // excess handed back as store credit; that credit now pays the higher total
    // again (taken back off the customer's balance) instead of leaving both a
    // due and the credit.
    if (!isNewSale && creditBackSoFar > 0.009 && inv.customerId) {
      const fresh = await tx.invoice.findUnique({ where: { id: inv.id } });
      const owing = await invoiceDueRaw(tx, fresh);
      const take = round2(Math.min(creditBackSoFar, owing, await creditBalanceOf(tx, inv.customerId)));
      if (take > 0.009) {
        await applyCreditDelta(tx, inv.customerId, -take, {
          type: 'adjust', reason: `Bill ${inv.invoiceNumber} edited up — store credit given on it applied back to the bill`,
          refId: inv.id, refNumber: inv.invoiceNumber ?? undefined, by: reqUser?.name,
        });
      }
    }
    // Recompute the cached due from the (immutable) split, any receipts and any
    // returns — the single source of truth. On a new bill this equals the credit
    // just billed; on an edit it re-derives the due from the new total while
    // keeping receipts applied, so an edit can neither resurrect settled debt nor
    // miss a total change (CRM6-1 / SAL6-2).
    await recomputeInvoiceBalance(tx, inv.id);
    // CRM2-8: a bill made from an enquiry settles its unpaid part from the advance
    // already taken on that enquiry's pending order (kept as store credit).
    if (isNewSale) await applyPendingAdvanceToBill(tx, inv.id, reqUser?.name);
    // Return the authoritative saved row alongside the snapshot so the client can
    // preview/print the bill exactly as stored — server invoice number, server id,
    // reconciled payment split — instead of its provisional client object (SAL4-1).
    const savedInvoice = await tx.invoice.findUnique({ where: { id: inv.id } });
    const delta = await saleDelta(tx, {
      invoiceIds: [inv.id], customerIds: [inv.customerId, oldCustomerId], branchId: inv.branchId,
      itemIds: ledger.touchedIds(), logs: saleLogs,
    });
    return { ...delta, savedInvoice };
  });
}

/**
 * INV10-1: an archived item is hidden from the stock screens, so units put back
 * on it (a return, void, delete or a bill edit that lowers its quantity) would
 * vanish from Inventory and Valuation. Those actions are refused until the item
 * is restored in the item master.
 */
function assertRestockable(item: any, verb: string): void {
  if (item?.isArchived) {
    throw new AppError('ITEM_ARCHIVED', `"${String(item.itemName || 'This item').slice(0, 80)}" is archived, so its units can't be put back into stock. Restore the item first (Items → Archived → Restore), then ${verb}.`, 409);
  }
}

/**
 * CRM10-1: store credit given back AGAINST a bill (a credit-note return, the
 * excess of an edit below what was paid, the one-time script's rows) belongs to
 * that bill. When the bill is voided or deleted the sale is undone in full, so
 * the credit is taken back too — refused when the customer already spent it.
 */
async function takeBackBillCredit(tx: any, inv: any, verb: 'void' | 'delete', actor?: string): Promise<number> {
  if (!inv?.customerId) return 0;
  const cust = await tx.customer.findUnique({ where: { id: inv.customerId } });
  if (!cust) return 0;
  const credit = creditBackForBill(cust.creditHistory, inv);
  if (credit <= 0.005) return 0;
  const balance = round2(Math.max(0, Number(cust.creditBalance) || 0));
  if (balance + 0.005 < credit) {
    throw new AppError('CREDIT_SPENT', `₹${credit.toFixed(2)} of store credit was given on bill ${inv.invoiceNumber} and the customer has already used some of it (₹${balance.toFixed(2)} left). The bill can't be ${verb === 'void' ? 'voided' : 'deleted'} — record a return instead.`, 409);
  }
  await applyCreditDelta(tx, inv.customerId, -credit, {
    type: 'adjust', reason: `Bill ${inv.invoiceNumber} ${verb === 'void' ? 'voided' : 'deleted'} — store credit given on it taken back`,
    refId: inv.id, refNumber: inv.invoiceNumber ?? undefined, by: actor,
  });
  return credit;
}

/**
 * RPT10-4 (client decision): once a bill's month has ended, its sales and GST
 * are reported (GSTR-1/3B, P&L). Voiding or deleting it would silently rewrite
 * that month, so both are refused for every role, CEO included — goods coming
 * back are recorded as a return (credit note) in the current month instead.
 */
function assertMonthOpen(inv: any, verb: 'void' | 'delete' | 'edit'): void {
  const month = String(inv?.date || '').slice(0, 7);
  if (month && month < istToday().slice(0, 7)) {
    throw new AppError('MONTH_CLOSED', `Bill ${inv.invoiceNumber} is dated ${inv.date}, in a month that has ended — it can't be ${verb === 'void' ? 'voided' : verb === 'delete' ? 'deleted' : 'edited'} because that month's sales and GST are already reported. Use a return / credit note instead.`, 409);
  }
}

/** Void an invoice: restore remaining stock, log, mark voided, decrement customer. */
export function voidInvoice(invoiceId: string, reason: string, actor: string, reqUser?: any) {
  if (!invoiceId || typeof invoiceId !== 'string') throw new AppError('BAD_REQUEST', 'Which bill is being voided? invoiceId is required.', 400); // SAL7-4
  return lockedTx(async (tx: any) => {
    await lockInvoice(tx, invoiceId); // SAL10-1
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new AppError('NOT_FOUND', 'Sale not found', 404);
    assertBranchAllowed(reqUser, inv.branchId); // SEC2-1
    if (inv.isVoided) throw new AppError('ALREADY_VOIDED', 'Sale already voided', 409);
    assertMonthOpen(inv, 'void');
    if (await invoiceHasReceipts(tx, invoiceId, { ignoreTakeBacks: true })) {
      throw new AppError('HAS_RECEIPTS', 'This bill has customer receipts recorded against it. Delete/reverse the receipt(s) first, or issue a return instead of voiding.', 409); // CRM6-4
    }
    await assertDayOpen(tx, inv.branchId, inv.date, 'void this bill'); // CASH-2
    await lockCustomers(tx, [inv.customerId]);
    await takeBackBillCredit(tx, inv, 'void', actor); // CRM10-1

    const ts = nowIso();
    // Restore (sold − already-returned) PER ITEM, aggregated across all lines and
    // combos — restoring per line double-counted the returns when the same item
    // appeared on two lines and left stock behind on a void (SAL5-3).
    const sold = expandSoldUnits(inv.items as any[]);
    const returned = expandReturnedUnits((inv.returns as any[]) || [], inv.items as any[]);
    const itemById = await itemsByIds(tx, sold.keys());
    const ledger = new StockLedger(await lockStockRows(tx, inv.branchId, sold.keys()), inv.branchId);
    const newLogs: any[] = [];
    for (const [itemId, soldQty] of sold.entries()) {
      const restore = Math.max(0, Math.round((soldQty - (returned.get(itemId) || 0)) * 100) / 100);
      if (restore <= 0) continue;
      assertRestockable(itemById.get(itemId), 'void the bill'); // INV10-1
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
    const removedPayments = await purgeReturnRefunds(tx, invoiceId);
    await reopenSourceQuote(tx, inv);

    // Reverse the customer's totals for exactly the bill's own linked customer.
    // Matching by phone/name could hit a different customer who happens to share a
    // phone and wrongly shrink their totals (CRM2-11), so key strictly on customerId.
    if (inv.customerId) {
      const cust = await tx.customer.findUnique({ where: { id: inv.customerId } });
      if (cust) {
        await tx.customer.update({
          where: { id: cust.id },
          data: {
            purchaseCount: await liveBillCount(tx, cust.id, invoiceId),
            totalSpent: Math.max(0, (cust.totalSpent || 0) - inv.grandTotal),
            updatedAt: ts,
          },
        });
      }
    }
    return saleDelta(tx, { invoiceIds: [invoiceId], customerIds: [inv.customerId], branchId: inv.branchId, itemIds: ledger.touchedIds(), logs: newLogs, removedPaymentIds: removedPayments });
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
  // SAL7-4: a malformed request is a 400, never a 500 with database details.
  if (!invoiceId || typeof invoiceId !== 'string') throw new AppError('BAD_REQUEST', 'Which bill is being returned? invoiceId is required.', 400);
  if (!Array.isArray(returnLines)) throw new AppError('BAD_REQUEST', 'returnLines must be a list.', 400);
  return lockedTx(async (tx: any) => {
    await lockInvoice(tx, invoiceId); // SAL10-1: returns on one bill queue here (SAL2-4)
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new AppError('NOT_FOUND', 'Sale not found', 404);
    assertBranchAllowed(reqUser, inv.branchId); // SEC2-1
    if (inv.isVoided) throw new AppError('VOIDED', 'Cannot return on a voided sale', 409);
    await lockCustomers(tx, [inv.customerId]);
    // E2E9-9 / CASH10-1: a return is booked TODAY (its refund, credit note or
    // due reduction), so it is refused while today's cash day is closed at the
    // bill's branch.
    await assertDayOpen(tx, inv.branchId, istToday(), 'record a return today');
    // Resolve every requested line against the BILL's own line and take its
    // identity (name, code, price, tax, combo parts) from there and the item
    // master — never from the request (SAL7-4 / INV8-8; a request that flags a
    // plain line as a combo can't bring its own parts either).
    const billLines: any[] = (inv.items as any[]) || [];
    // SAL10-1: only the masters of the bill's own items and kit parts.
    const billItemIds = billLines.flatMap((l: any) => [l?.itemId, ...(Array.isArray(l?.comboComponents) ? l.comboComponents.map((c: any) => c?.itemId) : [])]);
    const masterById = await itemsByIds(tx, billItemIds);
    returnLines = returnLines.map((l: any) => {
      const qty = Number(l?.returnQty) || 0;
      if (qty <= 0) return { ...l, returnQty: 0 };
      let bl: any = null;
      if (l?.comboId) bl = billLines.find((i) => i.isCombo && i.comboId === l.comboId);
      if (!bl && l?.isCombo) bl = billLines.find((i) => i.isCombo && ((l.id && i.id === l.id) || (l.itemId && (i.itemId === l.itemId || i.comboId === l.itemId))));
      if (!bl && !l?.isCombo) bl = billLines.find((i) => !i.isCombo && (i.itemId || i.id) === l?.itemId);
      if (!bl) {
        throw new AppError('NOT_ON_BILL', `"${String(l?.itemName || l?.itemId || 'This item').slice(0, 80)}" was not sold on this bill and cannot be returned.`, 400);
      }
      const master: any = masterById.get(bl.itemId);
      // INV9-1: a whole-unit item (and any kit) comes back in whole units, like
      // it was sold (SAL2-8) — 0.5 of a PCS item is not a return.
      if (!Number.isInteger(qty)) {
        const unit = master?.unit || bl.unit;
        if (bl.isCombo || (unit && isWholeUnit(unit)) || (!unit && master)) {
          throw new AppError('WHOLE_UNITS', `"${String(bl.itemName || master?.itemName || 'This item').slice(0, 80)}" is returned in whole ${bl.isCombo ? 'sets' : String(unit || 'NOS').toUpperCase()} — ${qty} is not a whole number.`, 400);
        }
      }
      return {
        returnQty: qty,
        id: bl.id,
        itemId: bl.isCombo ? (bl.itemId || bl.comboId) : (bl.itemId || bl.id),
        itemName: bl.itemName || master?.itemName || 'Item',
        itemCode: bl.itemCode || master?.itemCode || '',
        unitPrice: Number(bl.unitPrice) || 0,
        taxRate: Number(bl.taxRate ?? bl.gstRate ?? 0) || 0,
        isCombo: !!bl.isCombo,
        comboId: bl.isCombo ? bl.comboId : undefined,
        comboComponents: bl.isCombo ? bl.comboComponents : undefined,
      };
    });
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
    const itemById = masterById;
    const ledger = new StockLedger(await lockStockRows(tx, inv.branchId, billItemIds), inv.branchId);
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
    // RPT10-3: the bill-level discount comes off the TAXABLE value and GST is
    // charged on what is left (taxCalc scales every line's tax by the same net
    // ratio), so a line's share of the bill is its value incl. GST times that
    // ratio. Taking the discount off the GST-inclusive value refunded the GST on
    // the discount too (₹2,053.50 instead of ₹2,030.19).
    const netRatio = subtotalTaxable > 0 ? Math.max(0, subtotalTaxable - overallDisc) / subtotalTaxable : 1;
    // Net-of-discount, tax-inclusive value a single stored line contributed per unit.
    const lineUnitValue = (li: any): number => {
      const q = Number(li.quantity) || 1;
      const lineTaxable = Number(li.taxableAmount) || 0;
      const lineNetWithTax = Number(li.totalAmount) || lineTaxable + (Number(li.totalTax) || 0);
      return (lineNetWithTax * netRatio) / q;
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
    // E2E9-5: a return that takes back EVERYTHING still on the bill returns the
    // whole remaining bill value — its round-off and paisa included — so no
    // ₹0.01 is left owing or unrefunded on a fully returned bill.
    const takesAll = [...soldByKey.entries()].every(([k, sold]) => (returnedByKey.get(k) || 0) + (batchByKey.get(k) || 0) >= sold - 1e-9)
      && !(Number(inv.shippingCharges) > 0);
    const refundScale = rawBatchTotal > 0 && (rawBatchTotal > refundCeiling || (takesAll && Math.abs(rawBatchTotal - refundCeiling) < 1))
      ? refundCeiling / rawBatchTotal : 1;
    const refundFor = (line: any): number => Math.round(rawRefundFor(line) * refundScale * 100) / 100;

    // For a combo, restock from the SOLD line's component list (what the sale
    // actually consumed), never the client's request — otherwise a request with
    // inflated component quantities could restore more than was ever sold and
    // create stock from nothing (STK-1).
    const soldComboComponents = (line: any): any[] => {
      const sold = soldComboLine(inv.items as any[], { comboId: line.comboId, id: line.id });
      const parts = Array.isArray(sold?.comboComponents) ? sold.comboComponents : [];
      return parts.filter((c: any) => c?.itemId && Number(c.quantity) > 0);
    };

    for (const line of validLines) {
      if (line.isCombo) {
        const parts = soldComboComponents(line);
        for (const comp of parts) {
          // Damaged returns restore 0 units (write-off); others restock normally.
          const qtyToRestore = isDamaged ? 0 : Number(comp.quantity) * line.returnQty;
          if (qtyToRestore > 0) assertRestockable(itemById.get(comp.itemId), 'record the return'); // INV10-1
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
          // The SOLD line's parts, so a later void/delete subtracts exactly what
          // this return put back (INV8-2).
          isCombo: true, comboId: line.comboId, comboComponents: parts,
        });
      } else {
        // Only restore stock for real catalogue items. A typed service line (e.g.
        // "Installation Service Charge") has no catalogue item, so restocking it would
        // create phantom stock and a bogus log entry (SAL-14) — skip it.
        const isCatalogItem = itemById.has(line.itemId);
        const qtyToRestore = isDamaged || !isCatalogItem ? 0 : line.returnQty;
        if (isCatalogItem) {
          if (qtyToRestore > 0) assertRestockable(itemById.get(line.itemId), 'record the return'); // INV10-1
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

    // E2E9-5: the paisa left by per-line rounding goes on the last line, so a
    // full return equals the remaining bill value exactly.
    if (takesAll && refundScale !== 1 && returnRecords.length) {
      const sum = returnRecords.reduce((t, r) => t + r.refundAmount, 0);
      const last = returnRecords[returnRecords.length - 1];
      last.refundAmount = Math.round((last.refundAmount + (refundCeiling - sum)) * 100) / 100;
    }
    const totalRefund = returnRecords.reduce((s, r) => s + r.refundAmount, 0);
    const existingReturns = (inv.returns as any[]) || [];
    // One id for this return batch, so it can be reversed as a unit later (SAL3-2).
    const batchId = rid('rtb');
    for (const r of returnRecords) { r.batchId = batchId; r.damaged = isDamaged; }
    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        returns: [...existingReturns, ...returnRecords],
        totalReturnedAmount: (inv.totalReturnedAmount || 0) + totalRefund,
        updatedAt: ts,
      },
    });
    // How much to pay back (UPG9-5). A return credits the customer the goods
    // value, which FIRST reduces what they still owe; only what they have paid
    // beyond the (reduced) net bill goes back — less what was ALREADY paid back
    // on this bill (earlier cash refunds and credit given back). So a return on
    // an unpaid credit bill refunds ₹0, a return on a fully-paid bill refunds its
    // full value, and a customer who still owes money (e.g. a receipt was
    // deleted after an earlier refund) gets nothing back. It is the due formula
    // itself (payment.service invoiceDueRaw) with this return included:
    //   refund = max(0, −(owed at billing − collected beyond the total − receipts
    //                     − returns after + refunds + credit given back))
    // (creditOriginal was anchored from the PRE-return state above.)
    const returnsAfter = round2((Number(inv.totalReturnedAmount) || 0) + totalRefund);
    const cashRefund = Math.max(0, round2(-(await invoiceDueRaw(tx, inv, { returns: returnsAfter }))));

    // 'Adjust to credit note' means: don't pay cash now. The goods value already
    // reduced the due above; the over-paid portion (what would otherwise be cash
    // back) is banked as STORE CREDIT the customer can spend on a future bill.
    const isCreditNote = /credit|adjust/i.test(String(refundMode || ''));
    let refundPaymentId: string | null = null;
    let refundModeUsed: string | null = null;
    if (cashRefund > 0.001 && isCreditNote && !inv.customerId) {
      // A credit note is kept on a customer's account — a walk-in bill has none,
      // so the over-paid amount would simply vanish. Refund it instead.
      throw new AppError('NO_CUSTOMER', 'This bill has no customer account to hold a credit note. Choose a refund mode (Cash / GPay / Bank) instead.', 400);
    }
    if (cashRefund > 0.001 && isCreditNote && inv.customerId) {
      await addCustomerCredit(tx, inv.customerId, cashRefund, {
        type: 'issued',
        reason: `Credit note on return #${inv.invoiceNumber}${reason ? ` — ${reason}` : ''}`,
        refId: inv.id,
        refNumber: inv.invoiceNumber ?? undefined,
        by: actor,
      });
    }
    if (cashRefund > 0.001 && !isCreditNote) {
      // CASH8-6: with no explicit choice, refund the way the bill was paid (its
      // first collected mode), not always Cash.
      const billMode = billingSplitsOf(inv).find((sp) => sp.mode !== 'COD-Credit' && (Number(sp.amount) || 0) > 0)?.mode;
      // SAL10-6: a refund goes back as Cash, GPay or HDFC (or a credit note) —
      // the bill's own mode when none is chosen, Cash if that isn't one of them.
      const mode = String(refundMode || '').trim()
        ? assertMode(REFUND_MODES, refundMode, 'a refund')
        : (REFUND_MODES as readonly string[]).find((m) => m.toLowerCase() === String(billMode || '').trim().toLowerCase()) || 'Cash';
      // The refund is paid out TODAY in IST — the shop's cash day (CASH7-11 / CRM8-8).
      const today = istToday();
      // The refund is a cash payout dated TODAY. If today's drawer is already
      // closed, paying it out would change a reconciled day — block it (the caller
      // can reopen today or choose 'Adjust to credit note'). CASH-2 / SAL4-12.
      await assertDayOpen(tx, inv.branchId, today, 'pay out a cash refund today (or use \'Adjust to credit note\')');
      const like = `PAY-${today.slice(0, 7).replace('-', '')}-`;
      const rows = await tx.payment.findMany({ where: { receiptNumber: { startsWith: like }, type: 'out' }, select: { receiptNumber: true } });
      let maxNo = 0;
      for (const r of rows) {
        const n = parseInt(String(r.receiptNumber).slice(like.length), 10);
        if (!Number.isNaN(n)) maxNo = Math.max(maxNo, n);
      }
      // Same persistent high-water mark as every other PAY- number, so a refund
      // voucher number is never reissued (SAL8-7).
      const refundNo = await nextPersistent(tx, `seq:pay:${like}`, maxNo);
      const paymentId = rid('pay');
      await tx.payment.create({
        data: {
          id: paymentId, receiptNumber: `${like}${String(refundNo).padStart(4, '0')}`,
          type: 'out', partyType: 'customer', partyId: inv.customerId ?? null, partyName: inv.customerName || 'Customer',
          branchId: inv.branchId, date: today, amount: cashRefund, paymentMode: mode,
          reference: inv.invoiceNumber ?? null, notes: `Refund on sale #${inv.invoiceNumber}${reason ? ` — ${reason}` : ''}`,
          allocations: [{ refId: inv.id, refNumber: inv.invoiceNumber, amount: cashRefund }] as any,
          createdById: null, createdByName: actor, createdAt: ts,
        },
      });
      refundPaymentId = paymentId;
      refundModeUsed = mode;
    }
    // The refund row raises what the customer owes back to what they really
    // hold: refresh the cached due only now, after it exists (UPG9-5).
    await recomputeInvoiceBalance(tx, invoiceId);
    // Remember what this batch paid back, so a reversal undoes exactly that (SAL3-2).
    const paidBack = cashRefund > 0.001 ? cashRefund : 0;
    if (paidBack > 0) {
      const tagged = ((await tx.invoice.findUnique({ where: { id: invoiceId }, select: { returns: true } }))?.returns as any[]) || [];
      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          returns: tagged.map((r: any) => (r.batchId === batchId
            ? { ...r, batchRefundCash: refundPaymentId ? paidBack : 0, batchRefundPaymentId: refundPaymentId, batchCreditIssued: refundPaymentId ? 0 : paidBack }
            : r)) as any,
        },
      });
    }
    // What the screen should say: money paid back (cash or credit note) vs. the
    // due that was simply reduced, and units actually put back on the shelf
    // (damaged units are written off — E2E8-13, E2E-15).
    const restockedUnits = isDamaged ? 0 : validLines.reduce((t: number, l: any) => t + ((l.isCombo || itemById.has(l.itemId)) ? Number(l.returnQty) || 0 : 0), 0);
    const returnSummary = {
      batchId,
      value: Math.round(totalRefund * 100) / 100,
      cashRefund: refundPaymentId ? paidBack : 0,
      refundMode: refundPaymentId ? refundModeUsed : null,
      creditIssued: refundPaymentId ? 0 : paidBack,
      dueReduced: Math.max(0, Math.round((totalRefund - paidBack) * 100) / 100),
      damaged: isDamaged,
      restockedUnits,
      writtenOffUnits: isDamaged ? validLines.reduce((t: number, l: any) => t + (Number(l.returnQty) || 0), 0) : 0,
    };
    const delta = await saleDelta(tx, { invoiceIds: [invoiceId], customerIds: [inv.customerId], branchId: inv.branchId, itemIds: ledger.touchedIds(), logs: newLogs });
    return { ...delta, returnSummary };
  });
}

/** Hard delete + restore stock. */
export function deleteInvoice(invoiceId: string, reqUser?: any) {
  return lockedTx(async (tx: any) => {
    await lockInvoice(tx, invoiceId); // SAL10-1
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
    let touched: string[] = [];
    let delLogs: any[] = [];
    let removedPayments: string[] = [];
    if (inv) {
      assertBranchAllowed(reqUser, inv.branchId); // SEC2-1
      assertMonthOpen(inv, 'delete');
      if (await invoiceHasReceipts(tx, invoiceId)) {
        throw new AppError('HAS_RECEIPTS', 'This bill has customer receipts recorded against it. Delete/reverse the receipt(s) first.', 409); // CRM6-4
      }
      await assertDayOpen(tx, inv.branchId, inv.date, 'delete this bill'); // CASH-2
      // CRM10-1 (nets to ₹0 when a void already took it back).
      await lockCustomers(tx, [inv.customerId]);
      await takeBackBillCredit(tx, inv, 'delete', reqUser?.name);
      const sold = expandSoldUnits(inv.items as any[]);
      const ledger = new StockLedger(inv.isVoided ? [] : await lockStockRows(tx, inv.branchId, sold.keys()), inv.branchId);
      // Only restore stock that is still OUT because of this bill. A voided bill
      // already had its stock restored on void, and a returned bill already
      // restored the returned units — restoring the full sold quantity here
      // double-counts them (STK-2). Skip voided bills; for the rest restore
      // sold − already-returned, AGGREGATED per item (not per line — SAL5-3), and
      // write a history row so the ledger reconciles (INV2-4).
      if (!inv.isVoided) {
        const itemById = await itemsByIds(tx, sold.keys());
        const returned = expandReturnedUnits((inv.returns as any[]) || [], inv.items as any[]);
        const ts = nowIso();
        for (const [itemId, soldQty] of sold.entries()) {
          const restore = Math.max(0, Math.round((soldQty - (returned.get(itemId) || 0)) * 100) / 100);
          if (restore <= 0) continue;
          assertRestockable(itemById.get(itemId), 'delete the bill'); // INV10-1
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
        touched = ledger.touchedIds();
      }
      // Drop any return refund booked against this bill before erasing it, so the
      // drawer isn't left short by an 'out' row pointing at a deleted invoice.
      removedPayments = await purgeReturnRefunds(tx, invoiceId);
      await tx.invoice.delete({ where: { id: invoiceId } });
      if (!inv.isVoided) await reopenSourceQuote(tx, inv);
      // CRM-8: a deleted live bill no longer counts for its customer.
      if (inv.customerId && !inv.isVoided) {
        const cust = await tx.customer.findUnique({ where: { id: inv.customerId } });
        if (cust) {
          await tx.customer.update({
            where: { id: cust.id },
            data: {
              purchaseCount: await liveBillCount(tx, cust.id),
              totalSpent: Math.max(0, (cust.totalSpent || 0) - (inv.grandTotal || 0)),
              updatedAt: nowIso(),
            },
          });
        }
      }
    }
    // SAL4-9: hand back what was deleted so the audit row can name it.
    const deleted = inv ? { invoiceNumber: inv.invoiceNumber, grandTotal: inv.grandTotal, branchId: inv.branchId, date: inv.date, customerName: inv.customerName, wasVoided: !!inv.isVoided } : null;
    const delta = await saleDelta(tx, {
      invoiceIds: [], customerIds: [inv?.customerId], branchId: inv?.branchId || '', itemIds: touched, logs: delLogs,
      removedInvoiceIds: inv ? [invoiceId] : [], removedPaymentIds: removedPayments,
    });
    return { ...delta, deleted };
  });
}

/**
 * Reverse a return (SAL3-2, client-approved): undo exactly what the return did.
 *  - Stock goes back out for the units that were restocked; damaged units were
 *    written off, so they cause no stock change now either.
 *  - Money: a cash refund 'out' row is deleted when it was paid today (open),
 *    otherwise the customer pays it back as an 'in' row dated TODAY (today must
 *    be open). A credit note is taken back off the customer's store credit —
 *    refused if they already spent it.
 *  - The bill's returns, returned total and due are restored; history rows and
 *    an audit row (in the controller) are written.
 * Returns are undone newest-first: each return's refund was worked out from the
 * bill as it stood after the earlier ones, so only the latest can be undone
 * exactly. Once every return is reversed the bill can be edited again.
 */
export function reverseReturn(invoiceId: string, returnId: string, actor: string, reqUser?: any) {
  if (!invoiceId || typeof invoiceId !== 'string') throw new AppError('BAD_REQUEST', 'invoiceId is required.', 400);
  if (!returnId || typeof returnId !== 'string') throw new AppError('BAD_REQUEST', 'returnId is required.', 400);
  if (reqUser && reqUser.role !== 'CEO' && reqUser.role !== 'Manager') {
    throw new AppError('FORBIDDEN', 'Only a Manager or CEO can reverse a return.', 403);
  }
  return lockedTx(async (tx: any) => {
    await lockInvoice(tx, invoiceId); // SAL10-1
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new AppError('NOT_FOUND', 'Sale not found', 404);
    assertBranchAllowed(reqUser, inv.branchId);
    if (inv.isVoided) throw new AppError('VOIDED', 'This bill is voided — its returns can no longer be reversed.', 409);
    await lockCustomers(tx, [inv.customerId]);
    const returns: any[] = ((inv.returns as any[]) || []).filter(Boolean);
    const target = returns.find((r) => r.id === returnId);
    if (!target) throw new AppError('RETURN_NOT_FOUND', 'That return is not on this bill.', 404);
    // Returns made before batches were tagged are grouped by their timestamp
    // (one return call stamps all its lines with the same time).
    const batchOf = (r: any) => r.batchId || `at:${r.returnedAt}`;
    const key = batchOf(target);
    if (batchOf(returns[returns.length - 1]) !== key) {
      throw new AppError('NOT_LATEST_RETURN', 'Reverse the later return(s) on this bill first — returns are undone newest first.', 409);
    }
    const batch = returns.filter((r) => batchOf(r) === key);
    const remaining = returns.filter((r) => batchOf(r) !== key);
    const damaged = batch.some((r) => r.damaged === true || (r.damaged == null && /damag/i.test(String(r.reason || ''))));
    const ts = nowIso();
    const today = istToday();

    // ---- money ---------------------------------------------------------------
    let refundPaymentId: string | null = target.batchRefundPaymentId ?? null;
    let creditIssued = Number(target.batchCreditIssued) || 0;
    if (!target.batchId) {
      // Legacy return: its refund is the row an older build stamped with the
      // return's own time, or the one the one-time script / demo seed recorded
      // for it later under a fixed id (UPG9-10 / CRM9-14).
      const forBill = (p: any) => !!p && Array.isArray(p.allocations) && p.allocations.some((a: any) => a?.refId === inv.id);
      const outs = await tx.payment.findMany({ where: { type: 'out', partyType: 'customer', createdAt: target.returnedAt } });
      refundPaymentId = outs.find(forBill)?.id ?? null;
      if (!refundPaymentId) {
        const backfilled = await tx.payment.findUnique({ where: { id: legacyRefundId(inv.id, target.returnedAt) } });
        if (forBill(backfilled) && backfilled.type === 'out') refundPaymentId = backfilled.id;
      }
      if (!refundPaymentId && inv.customerId) {
        const cust = await tx.customer.findUnique({ where: { id: inv.customerId } });
        const t0 = Date.parse(target.returnedAt);
        const entry = ((cust?.creditHistory as any[]) || []).find((h: any) =>
          h?.type === 'issued' && (
            (h?.refId === inv.id && Math.abs(Date.parse(h.date) - t0) < 10_000) ||
            // an older 'Adjust' refund the one-time script turned into store credit
            (h?.billId === inv.id && h?.batchAt === target.returnedAt)));
        creditIssued = Number(entry?.amount) || 0;
      }
      // SAL9-8: an older build's return that left no refund row was paid back in
      // cash that only the one-time data fix records. Reversing it before that
      // runs would take the goods back and never take that money back.
      if (!refundPaymentId && !(creditIssued > 0) && !(await tx.appConfig.findUnique({ where: { key: 'migration:fix-existing-bills' } }))) {
        throw new AppError('MIGRATION_PENDING', 'This return was made by an older version of the app and its refund is not recorded yet. Run the one-time data fix first (fix-existing-bills, see docs/DEPLOY_EXISTING_DATA.md), then reverse it.', 409);
      }
    }
    let refundReversal: { kind: 'deleted' | 'collected'; amount: number; mode: string; date: string } | null = null;
    const removedPayments: string[] = [];
    if (refundPaymentId) {
      const pay = await tx.payment.findUnique({ where: { id: refundPaymentId } });
      if (pay) {
        // UPG10-4: only a refund paid out TODAY (on an open day) is simply
        // removed. A refund on any earlier day is history — that day's cash was
        // counted (and may be carried into a later closed day) — so the customer
        // hands the money back today instead.
        const refundDayClosed = pay.date !== today || !!(await closedDayFrom(tx, pay.branchId, pay.date));
        if (!refundDayClosed) {
          // The refund was paid today and today is open — take the payout off.
          await tx.payment.delete({ where: { id: pay.id } });
          removedPayments.push(pay.id);
          refundReversal = { kind: 'deleted', amount: pay.amount, mode: pay.paymentMode, date: pay.date };
        } else {
          // That day is reconciled: the customer hands the refund back today.
          await assertDayOpen(tx, pay.branchId, today, 'take back the refund of this return');
          await tx.payment.create({
            data: {
              id: rid('pay'), receiptNumber: await nextReceiptNumber(tx, 'in', today),
              type: 'in', partyType: 'customer', partyId: inv.customerId ?? null, partyName: inv.customerName || 'Customer',
              branchId: pay.branchId, date: today, amount: pay.amount, paymentMode: pay.paymentMode,
              reference: inv.invoiceNumber ?? null,
              notes: `Refund ${pay.receiptNumber} taken back — return on #${inv.invoiceNumber} reversed`,
              allocations: [{ refId: inv.id, refNumber: inv.invoiceNumber, amount: pay.amount }] as any,
              createdById: reqUser?.userId ?? null, createdByName: actor, createdAt: ts,
            },
          });
          refundReversal = { kind: 'collected', amount: pay.amount, mode: pay.paymentMode, date: today };
        }
      }
    }
    if (creditIssued > 0.001 && inv.customerId) {
      const balance = await creditBalanceOf(tx, inv.customerId);
      if (balance + 0.001 < creditIssued) {
        throw new AppError('CREDIT_SPENT', `The ₹${creditIssued} credit note from this return was already used (store credit left ₹${balance}). It can't be reversed.`, 409);
      }
      await applyCreditDelta(tx, inv.customerId, -creditIssued, {
        type: 'adjust', reason: `Credit note taken back — return on #${inv.invoiceNumber} reversed`,
        refId: inv.id, refNumber: inv.invoiceNumber ?? undefined, by: actor,
      });
    }

    // ---- stock ---------------------------------------------------------------
    const batchUnits = expandReturnedUnits(batch, inv.items as any[]);
    const itemById = await itemsByIds(tx, batchUnits.keys());
    // Exactly the units the return put back: a combo return is expanded with the
    // parts the bill sold it with — the same parts processReturn restocked and
    // stored on the return (INV8-2) — so reversing a kit takes back its parts,
    // never the combo id or the browser's idea of the kit.
    const out = new Map<string, number>();
    if (!damaged) {
      for (const [itemId, qty] of batchUnits.entries()) {
        if (itemById.has(itemId)) out.set(itemId, Math.round(qty * 1000) / 1000);
      }
    }
    const ledger = new StockLedger(await lockStockRows(tx, inv.branchId, out.keys()), inv.branchId);
    const logs: any[] = [];
    for (const [itemId, qty] of out.entries()) {
      const ci: any = itemById.get(itemId);
      if (ledger.qty(itemId) < qty) {
        throw new AppError('INSUFFICIENT_STOCK', `"${ci?.itemName || itemId}": only ${ledger.qty(itemId)} in stock — the returned units were already sold or moved, so the return can't be reversed.`, 409);
      }
      const { prevQty, newQty } = ledger.apply(itemId, -qty, false);
      logs.push({
        id: rid('adj'), itemId, itemName: ci?.itemName || 'Item', itemCode: ci?.itemCode || '', branchId: inv.branchId,
        previousQuantity: prevQty, quantityChange: -qty, newQuantity: newQty, reason: 'Sales Return Reversed',
        notes: `Return on #${inv.invoiceNumber} reversed`, adjustedBy: actor, timestamp: ts,
      });
    }
    await ledger.flush(tx);
    if (logs.length) await tx.stockAdjustmentLog.createMany({ data: logs });

    // ---- bill ----------------------------------------------------------------
    const value = Math.round(batch.reduce((t, r) => t + (Number(r.refundAmount) || 0), 0) * 100) / 100;
    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        returns: remaining as any,
        totalReturnedAmount: Math.max(0, Math.round(((Number(inv.totalReturnedAmount) || 0) - value) * 100) / 100),
        updatedAt: ts,
      },
    });
    await recomputeInvoiceBalance(tx, invoiceId);
    const reversed = {
      invoiceNumber: inv.invoiceNumber, branchId: inv.branchId, value, damaged,
      units: batch.reduce((t, r) => t + (Number(r.returnedQuantity) || 0), 0),
      stockOut: [...out.values()].reduce((t, q) => t + q, 0),
      refund: refundReversal, creditTakenBack: creditIssued > 0.001 ? creditIssued : 0,
    };
    const delta = await saleDelta(tx, { invoiceIds: [invoiceId], customerIds: [inv.customerId], branchId: inv.branchId, itemIds: ledger.touchedIds(), logs, removedPaymentIds: removedPayments });
    return { ...delta, reversed };
  });
}
