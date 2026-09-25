/**
 * Server-authoritative money math. Mirrors the frontend lib/taxCalculations +
 * numberToWords so the backend recomputes every line tax and invoice/estimate
 * total from the raw inputs (qty, price, rate, discount) — the client's totals
 * are never trusted. Keep this in sync with the frontend's live-calc logic.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

export function calculateLineTax(
  quantity: number,
  unitPrice: number,
  taxRate = 18,
  withGst = true,
  discountType: '%' | 'amount' = '%',
  discountValue = 0
) {
  const qty = Number(quantity) || 0;
  const price = Number(unitPrice) || 0;
  const rate = Number(taxRate) || 0;
  const dVal = Number(discountValue) || 0;

  const grossAmount = r2(qty * price);
  let discountAmount = 0;
  if (dVal > 0) {
    // Cap percentage discount at 100% so it can never exceed the gross value.
    discountAmount = discountType === '%' ? r2((grossAmount * Math.min(100, dVal)) / 100) : Math.min(grossAmount, r2(dVal));
  }
  const taxableAmount = Math.max(0, r2(grossAmount - discountAmount));

  let totalTax = 0;
  let cgstAmount = 0;
  let sgstAmount = 0;
  if (withGst && rate > 0) {
    totalTax = r2((taxableAmount * rate) / 100);
    // Split so the two halves ALWAYS sum exactly to totalTax (SGST rounded
    // half, CGST the residual) — avoids odd-paisa CGST+SGST != totalTax.
    sgstAmount = r2(totalTax / 2);
    cgstAmount = r2(totalTax - sgstAmount);
  }
  const totalAmount = withGst ? r2(taxableAmount + totalTax) : taxableAmount;

  return { taxableAmount, discountAmount, cgstAmount, sgstAmount, totalTax, totalAmount };
}

export function calculateInvoiceTotals(
  items: Array<{ taxableAmount: number; cgstAmount?: number; sgstAmount?: number; totalTax?: number }>,
  withGst: boolean,
  overallDiscountType: '%' | 'amount' = '%',
  overallDiscountValue = 0,
  shippingCharges = 0,
  roundOffEnabled = true
) {
  let subtotal = 0, totalTax = 0, totalCgst = 0, totalSgst = 0;
  for (const item of items) {
    subtotal += Number(item.taxableAmount) || 0;
    if (withGst) {
      totalTax += Number(item.totalTax) || 0;
      totalCgst += Number(item.cgstAmount) || (Number(item.totalTax) || 0) / 2;
      totalSgst += Number(item.sgstAmount) || (Number(item.totalTax) || 0) / 2;
    }
  }
  subtotal = r2(subtotal); totalTax = r2(totalTax); totalCgst = r2(totalCgst); totalSgst = r2(totalSgst);

  let overallDiscountAmount = 0;
  const dVal = Number(overallDiscountValue) || 0;
  if (dVal > 0) {
    overallDiscountAmount = overallDiscountType === '%' ? r2((subtotal * dVal) / 100) : Math.min(subtotal, r2(dVal));
  }
  const shipping = Math.max(0, Number(shippingCharges) || 0);
  const netTaxable = Math.max(0, subtotal - overallDiscountAmount);

  // GST on the DISCOUNTED taxable value: scale line taxes by the discount ratio;
  // CGST/SGST split by residual so the halves sum exactly to the total.
  if (withGst && overallDiscountAmount > 0 && subtotal > 0) {
    const netRatio = netTaxable / subtotal;
    totalTax = r2(totalTax * netRatio);
    totalSgst = r2(totalTax / 2);
    totalCgst = r2(totalTax - totalSgst);
  }

  const unroundedTotal = netTaxable + (withGst ? totalTax : 0) + shipping;

  let grandTotal = unroundedTotal, roundOff = 0;
  if (roundOffEnabled) {
    grandTotal = Math.round(unroundedTotal);
    roundOff = r2(grandTotal - unroundedTotal);
  } else {
    grandTotal = r2(unroundedTotal);
  }

  return {
    subtotal, totalTax, totalCgst, totalSgst, overallDiscountAmount,
    shippingCharges: shipping, roundOff, grandTotal, amountInWords: numberToWordsIndian(grandTotal),
  };
}

// ---- Indian number-to-words (ported) ----
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (n: number): string => (n === 0 ? '' : n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : ''));
const three = (n: number): string => {
  const h = Math.floor(n / 100), rem = n % 100;
  let s = h > 0 ? ONES[h] + ' Hundred' : '';
  if (rem > 0) s += (s ? ' ' : '') + two(rem);
  return s;
};
export function numberToWordsIndian(num: number): string {
  if (num === 0) return 'Rupees Zero only';
  const rounded = r2(num);
  const intPart = Math.floor(rounded);
  const dec = Math.round((rounded - intPart) * 100);
  let rem = intPart;
  const cr = Math.floor(rem / 10000000); rem %= 10000000;
  const lk = Math.floor(rem / 100000); rem %= 100000;
  const th = Math.floor(rem / 1000); rem %= 1000;
  const parts: string[] = [];
  // Crores can exceed 99 (e.g. 141 crore) — `two()` only covered 0–99 and emitted
  // "undefined" (PLT-14). Use three-digit words up to 999 crore, split beyond.
  if (cr > 0) {
    if (cr >= 1000) {
      const cTh = Math.floor(cr / 1000); const cRest = cr % 1000;
      parts.push((three(cTh) + ' Thousand ' + (cRest > 0 ? three(cRest) : '')).trim() + ' Crore');
    } else {
      parts.push(three(cr) + ' Crore');
    }
  }
  if (lk > 0) parts.push(two(lk) + ' Lakh');
  if (th > 0) parts.push(two(th) + ' Thousand');
  if (rem > 0) parts.push(three(rem));
  let words = parts.join(' ').trim() || 'Zero';
  let result = `Rupees ${words}`;
  if (dec > 0) result += ` and ${two(dec)} Paise`;
  return result + ' only';
}
