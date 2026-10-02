import type { Item, ComboComponent } from '../types';

/** GST rate a combo is billed at (InvoiceForm adds it on top of the combo price). */
export const COMBO_GST_RATE = 18;

/** An item's sale price including GST, whichever way it is stored. */
export const salePriceInclTax = (it: Pick<Item, 'salePrice' | 'salePriceTaxMode' | 'gstTaxSlab'>): number =>
  it.salePriceTaxMode === 'with' ? it.salePrice || 0 : (it.salePrice || 0) * (1 + (it.gstTaxSlab || 0) / 100);

/**
 * The one "buying separately vs combo" comparison (INV3-6). Both sides are
 * tax-inclusive: the parts at their GST-inclusive sale prices, and the combo
 * price plus the 18% GST it is billed with. The catalogue and the combo editor
 * showed different savings (23% vs 9.1%) because one compared an inclusive
 * total with the pre-tax combo price and the other mixed pre-tax part prices.
 */
export function comboSavings(
  components: Pick<ComboComponent, 'itemId' | 'quantity'>[],
  items: Pick<Item, 'id' | 'salePrice' | 'salePriceTaxMode' | 'gstTaxSlab'>[],
  comboPrice: number,
): { separate: number; comboInclusive: number; savings: number; percent: number } {
  const separate = (components || []).reduce((sum, c) => {
    const it = items.find((i) => i.id === c.itemId);
    return it ? sum + salePriceInclTax(it) * (Number(c.quantity) || 0) : sum;
  }, 0);
  const comboInclusive = (Number(comboPrice) || 0) * (1 + COMBO_GST_RATE / 100);
  const savings = separate - comboInclusive;
  const percent = separate > 0 ? (savings / separate) * 100 : 0;
  return { separate, comboInclusive, savings, percent };
}
