export type CustomerType = 'Retail' | 'Organization';

export interface Customer {
  id: string;
  name: string;
  phone: string; // unique key - used to prevent duplicate customer records
  address: string;
  customerType?: CustomerType; // 'Retail' (walk-in/small buyer, loyalty enabled) or 'Organization' (bulk institutional buyer)
  firstPurchaseDate: string; // auto (YYYY-MM-DD)
  purchaseCount: number; // auto-incremented on completed non-voided sale (Retail only)
  totalSpent: number; // auto-accumulated from completed sales
  notes?: string;
  createdAt: string;
  updatedAt: string;
  lastRewardRedeemedPurchaseCount?: number; // tracks when milestone reward was last applied
}

export interface LoyaltySettings {
  purchaseThreshold: number; // "every N purchases", default e.g. 10
  discountType: 'percentage' | 'flat'; // Percentage or Flat ₹ Amount
  discountValue: number; // e.g. 10 (%) or 500 (₹)
  isActive: boolean;
  updatedAt: string;
  updatedBy: string;
}

/**
 * Sanitizes customer name ensuring ONLY clean name string is stored.
 * Strips any accidentally appended notes, remarks, purchase counts, or reward status strings.
 */
export function cleanCustomerName(rawName: string, notes?: string): string {
  if (!rawName) return '';
  let cleaned = rawName.trim();

  // If notes string is provided and was appended to name, remove it
  if (notes && notes.trim() && cleaned.includes(notes.trim())) {
    cleaned = cleaned.replace(notes.trim(), '').trim();
  }

  // Remove common accidental concatenations:
  // e.g. " • Note: ...", " - Note: ...", " (Note: ...)", "\nNote: ..."
  // e.g. " • 8 purchases", " - 8 purchases", "#8 purchases", "8/10 to next reward"
  // e.g. " - Purchase History: ..."
  cleaned = cleaned
    .replace(/\s*[-•|]\s*(?:#?\d+\s*purchases?|\d+\/\d+\s*to\s*next\s*reward|Reward\s*Ready!?|Milestone!?).*/i, '')
    .replace(/\s*[-•|]\s*Purchase History:?.*/i, '')
    .replace(/\s*\(?(?:#?\d+\s*purchases?|\d+\/\d+\s*to\s*next\s*reward)\)?/gi, '')
    .replace(/\s*[-•|]\s*(?:Notes?|Remarks?):?.*/i, '')
    .trim();

  // Remove any trailing dashes, bullets, colons, or orphaned opening/closing punctuation
  cleaned = cleaned.replace(/[-•:,(\s]+$/, '').trim();

  return cleaned;
}

/**
 * Checks whether a customer is currently eligible for an unredeemed loyalty reward
 * based on the active rule threshold.
 * IMPORTANT: Loyalty milestones ONLY apply to Retail customers. Organization customers never trigger loyalty rewards.
 */
export function isLoyaltyMilestoneEligible(
  customer: Customer,
  settings: LoyaltySettings,
  isCurrentSaleMilestoneCheck?: boolean
): boolean {
  // Organizations get bulk relationships, not loyalty milestones
  if (customer.customerType === 'Organization') return false;
  if (!settings.isActive || settings.purchaseThreshold <= 0) return false;

  const countToCheck = isCurrentSaleMilestoneCheck
    ? customer.purchaseCount + 1
    : customer.purchaseCount;

  if (countToCheck < settings.purchaseThreshold) return false;

  const milestonesReached = Math.floor(countToCheck / settings.purchaseThreshold);
  const lastRedeemedMilestone = Math.floor(
    (customer.lastRewardRedeemedPurchaseCount || 0) / settings.purchaseThreshold
  );

  return milestonesReached > lastRedeemedMilestone;
}

/**
 * Returns formatted loyalty progress information for a customer.
 */
export function getLoyaltyProgress(
  customer: Customer,
  settings: LoyaltySettings
): {
  isMilestoneReached: boolean;
  currentCount: number;
  threshold: number;
  purchasesUntilNext: number;
  label: string;
} {
  const threshold = Math.max(1, settings.purchaseThreshold || 10);

  if (customer.customerType === 'Organization') {
    return {
      isMilestoneReached: false,
      currentCount: 0,
      threshold,
      purchasesUntilNext: 0,
      label: 'Bulk Account (Loyalty N/A)',
    };
  }

  const isEligible = isLoyaltyMilestoneEligible(customer, settings);

  const remainder = customer.purchaseCount % threshold;
  const purchasesUntilNext =
    remainder === 0 && customer.purchaseCount > 0 && !isEligible
      ? threshold
      : threshold - remainder;

  if (isEligible) {
    return {
      isMilestoneReached: true,
      currentCount: customer.purchaseCount,
      threshold,
      purchasesUntilNext: 0,
      label: 'Reward available',
    };
  }

  return {
    isMilestoneReached: false,
    currentCount: remainder,
    threshold,
    purchasesUntilNext,
    label: `${remainder}/${threshold} to next reward`,
  };
}
