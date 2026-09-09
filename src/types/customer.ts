export interface Customer {
  id: string;
  name: string;
  phone: string; // unique key - used to prevent duplicate customer records
  address: string;
  firstPurchaseDate: string; // auto (YYYY-MM-DD)
  purchaseCount: number; // auto-incremented on completed non-voided sale
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
 * Checks whether a customer is currently eligible for an unredeemed loyalty reward
 * based on the active rule threshold. Supports checking either current purchase count
 * or anticipating the upcoming milestone sale.
 */
export function isLoyaltyMilestoneEligible(
  customer: Customer,
  settings: LoyaltySettings,
  isCurrentSaleMilestoneCheck?: boolean
): boolean {
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
      label: '🎉 Reward available',
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
