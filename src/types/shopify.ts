export interface ShopifyAddress {
  name?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  zip?: string;
  country?: string;
  phone?: string;
}

export interface ShopifyOrderLineItem {
  id?: string;
  sku: string;
  title: string;
  variantTitle?: string;
  qty: number;
  price: number;
  matched: boolean;
  itemName?: string;
  erpStockOnHand?: number;
  imageUrl?: string;
  vendor?: string;
  discount?: number;
  taxLines?: { title: string; price: number; rate?: number }[];
  properties?: { name: string; value: string }[];
  grams?: number;
}

export interface ShopifyOrderFulfillment {
  trackingCompany?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  status?: string;
}

export interface ShopifyOrder {
  externalOrderId: string;
  orderName: string;
  date: string;
  createdAt?: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  shippingAddress?: ShopifyAddress;
  billingAddress?: ShopifyAddress;
  total: number;
  subtotal?: number;
  tax?: number;
  shippingFee?: number;
  discount?: number;
  financialStatus: string;
  fulfillmentStatus: string;
  paymentGateway?: string;
  fulfillments?: ShopifyOrderFulfillment[];
  trackingNumber?: string;
  trackingCompany?: string;
  trackingUrl?: string;
  note?: string;
  alreadyImported: boolean;
  linkedInvoiceNumber?: string;
  linkedInvoiceId?: string;
  lines: ShopifyOrderLineItem[];
  unmatchedCount: number;
  shippingMethod?: string;
  discountCodes?: string;
  shopifyOrderUrl?: string;
  currency?: string;
  cancelReason?: string;
  cancelledAt?: string;
  tags?: string;
}

export interface ShopifySimilarItem {
  id: string;
  itemName: string;
  itemCode: string;
  category: string;
  salePrice: number;
  imageUrl?: string;
  unit: string;
  stockOnHand: number;
}

export interface ShopifyInventoryItem {
  sku: string;
  title: string;
  variantTitle?: string;
  productId: string;
  variantId: string;
  inventoryItemId?: string;
  shopifyPrice: number;
  compareAtPrice?: number;
  shopifyInventory: number;
  matched: boolean;
  erpItemId?: string;
  erpItemName?: string;
  erpPrice?: number;
  erpStockOnHand: number;
  status: 'synced' | 'mismatch' | 'out_of_stock' | 'unlinked';
}

export interface ShopifyProductItem {
  sku: string;
  title: string;
  price: number;
  matched: boolean;
  itemName?: string;
}

export interface ShopifyCustomerSummary {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  city?: string;
  province?: string;
  ordersCount: number;
  totalSpent: number;
  lastOrderDate?: string;
  syncedToErp: boolean;
}

export interface ShopifyShopStatus {
  configured: boolean;
  connected: boolean;
  shop?: {
    name?: string;
    domain?: string;
    myshopifyDomain?: string;
    currency?: string;
    country?: string;
    plan?: string;
    email?: string;
  };
  error?: string;
}

