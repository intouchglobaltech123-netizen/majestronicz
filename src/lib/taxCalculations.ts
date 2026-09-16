import { GstBreakdownRow, DiscountType } from '../types';
import { numberToWordsIndian } from './numberToWords';

export interface CalculatedLineTax {
  taxableAmount: number;
  discountAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  totalTax: number;
  totalAmount: number;
}

/**
 * Calculates line-level tax and amounts for an item.
 * Supports pre-tax unit price, per-line discount (% or amount), and GST tax rate.
 */
export function calculateLineTax(
  quantity: number,
  unitPrice: number,
  taxRate: number = 18,
  withGst: boolean = true,
  discountType: DiscountType = '%',
  discountValue: number = 0
): CalculatedLineTax {
  const qty = Number(quantity) || 0;
  const price = Number(unitPrice) || 0;
  const rate = Number(taxRate) || 0;
  const dVal = Number(discountValue) || 0;

  const grossAmount = Math.round(qty * price * 100) / 100;

  let discountAmount = 0;
  if (dVal > 0) {
    if (discountType === '%') {
      // Cap percentage discount at 100% so it can never exceed the gross value.
      const pct = Math.min(100, dVal);
      discountAmount = Math.round(((grossAmount * pct) / 100) * 100) / 100;
    } else {
      discountAmount = Math.min(grossAmount, Math.round(dVal * 100) / 100);
    }
  }

  const taxableAmount = Math.max(0, Math.round((grossAmount - discountAmount) * 100) / 100);

  let totalTax = 0;
  let cgstAmount = 0;
  let sgstAmount = 0;

  if (withGst && rate > 0) {
    totalTax = Math.round(((taxableAmount * rate) / 100) * 100) / 100;
    // Split so the two halves ALWAYS sum exactly to totalTax (avoids the
    // odd-paisa case where round(t/2)*2 != t). SGST takes the rounded half,
    // CGST takes the residual.
    sgstAmount = Math.round((totalTax / 2) * 100) / 100;
    cgstAmount = Math.round((totalTax - sgstAmount) * 100) / 100;
  }

  const totalAmount = withGst
    ? Math.round((taxableAmount + totalTax) * 100) / 100
    : taxableAmount;

  return {
    taxableAmount,
    discountAmount,
    cgstAmount,
    sgstAmount,
    totalTax,
    totalAmount,
  };
}

/**
 * Generates GST Breakdown rows (CGST + SGST pairs) from an array of items having taxable amounts and GST rates.
 */
export function calculateTaxBreakdown(
  items: Array<{ taxableAmount: number; gstRate?: number; taxRate?: number }>
): GstBreakdownRow[] {
  const rateMap = new Map<number, number>();

  items.forEach((item) => {
    const rate = Number(item.taxRate ?? item.gstRate ?? 0);
    const taxable = Number(item.taxableAmount) || 0;
    if (taxable > 0 && rate > 0) {
      const current = rateMap.get(rate) || 0;
      rateMap.set(rate, current + taxable);
    }
  });

  const rows: GstBreakdownRow[] = [];
  const sortedRates = Array.from(rateMap.keys()).sort((a, b) => a - b);

  sortedRates.forEach((rate) => {
    const taxable = rateMap.get(rate) || 0;
    const halfRate = rate / 2;
    // Split by residual (SGST rounded half, CGST the remainder) so SGST+CGST
    // always equals the total tax for this rate — matching the summary panel.
    const totalTax = Math.round(((taxable * rate) / 100) * 100) / 100;
    const sgst = Math.round((totalTax / 2) * 100) / 100;
    const cgst = Math.round((totalTax - sgst) * 100) / 100;

    // SGST
    rows.push({
      taxType: 'SGST',
      rate: halfRate,
      taxableAmount: taxable,
      taxAmount: sgst,
    });

    // CGST
    rows.push({
      taxType: 'CGST',
      rate: halfRate,
      taxableAmount: taxable,
      taxAmount: cgst,
    });
  });

  return rows;
}

export interface InvoiceCalculatedTotals {
  subtotal: number;
  totalTax: number;
  totalCgst: number;
  totalSgst: number;
  overallDiscountAmount: number;
  shippingCharges: number;
  roundOff: number;
  grandTotal: number;
  amountInWords: string;
}

/**
 * Calculates aggregated invoice totals including line items, overall discount,
 * shipping charges, optional rounding off, and Indian currency words.
 */
export function calculateInvoiceTotals(
  items: Array<{
    taxableAmount: number;
    cgstAmount?: number;
    sgstAmount?: number;
    totalTax?: number;
  }>,
  withGst: boolean,
  overallDiscountType: DiscountType = '%',
  overallDiscountValue: number = 0,
  shippingCharges: number = 0,
  roundOffEnabled: boolean = true
): InvoiceCalculatedTotals {
  let subtotal = 0;
  let totalTax = 0;
  let totalCgst = 0;
  let totalSgst = 0;

  items.forEach((item) => {
    subtotal += Number(item.taxableAmount) || 0;
    if (withGst) {
      totalTax += Number(item.totalTax) || 0;
      totalCgst += Number(item.cgstAmount) || (Number(item.totalTax) || 0) / 2;
      totalSgst += Number(item.sgstAmount) || (Number(item.totalTax) || 0) / 2;
    }
  });

  subtotal = Math.round(subtotal * 100) / 100;
  totalTax = Math.round(totalTax * 100) / 100;
  totalCgst = Math.round(totalCgst * 100) / 100;
  totalSgst = Math.round(totalSgst * 100) / 100;

  // Calculate overall discount
  let overallDiscountAmount = 0;
  const dVal = Number(overallDiscountValue) || 0;
  if (dVal > 0) {
    if (overallDiscountType === '%') {
      overallDiscountAmount = Math.round(((subtotal * dVal) / 100) * 100) / 100;
    } else {
      overallDiscountAmount = Math.min(subtotal, Math.round(dVal * 100) / 100);
    }
  }

  const shipping = Math.max(0, Number(shippingCharges) || 0);

  // Net taxable subtotal after overall discount
  const netTaxable = Math.max(0, subtotal - overallDiscountAmount);

  // GST is charged on the DISCOUNTED taxable value (Section 15): scale the line
  // taxes down by the overall-discount ratio. CGST/SGST split by residual so
  // the two halves always sum exactly to the total tax.
  if (withGst && overallDiscountAmount > 0 && subtotal > 0) {
    const netRatio = netTaxable / subtotal;
    totalTax = Math.round(totalTax * netRatio * 100) / 100;
    totalSgst = Math.round((totalTax / 2) * 100) / 100;
    totalCgst = Math.round((totalTax - totalSgst) * 100) / 100;
  }

  const unroundedTotal = netTaxable + (withGst ? totalTax : 0) + shipping;

  let grandTotal = unroundedTotal;
  let roundOff = 0;

  if (roundOffEnabled) {
    grandTotal = Math.round(unroundedTotal);
    roundOff = Math.round((grandTotal - unroundedTotal) * 100) / 100;
  } else {
    grandTotal = Math.round(unroundedTotal * 100) / 100;
  }

  const amountInWords = numberToWordsIndian(grandTotal);

  return {
    subtotal,
    totalTax,
    totalCgst,
    totalSgst,
    overallDiscountAmount,
    shippingCharges: shipping,
    roundOff,
    grandTotal,
    amountInWords,
  };
}
