import crypto from 'crypto';
import { prisma } from '../db.js';
import { nextInvoiceNumber } from '../lib/sequences.js';
import { nowIso } from '../lib/stockLedger.js';

/**
 * Shopify Admin API connector. ALL credentials come from environment variables
 * — never hard-coded or committed. Set these in Railway (backend service):
 *   SHOPIFY_STORE_DOMAIN   e.g. e2e087-09.myshopify.com
 *   SHOPIFY_ADMIN_TOKEN    Admin API access token (shpat_…) from a Custom App
 *   SHOPIFY_API_SECRET     API secret key (shpss_…) — used for webhook HMAC
 *   SHOPIFY_API_KEY        Client ID / API key (optional, for OAuth)
 *   SHOPIFY_API_VERSION    optional, defaults to 2024-07
 */

export interface ShopifyConfig {
  domain: string;
  adminToken: string;
  apiSecret: string;
  apiVersion: string;
}

export function getShopifyConfig(): ShopifyConfig | null {
  const domain = process.env.SHOPIFY_STORE_DOMAIN?.trim();
  const adminToken = process.env.SHOPIFY_ADMIN_TOKEN?.trim();
  if (!domain || !adminToken) return null;
  return {
    domain,
    adminToken,
    apiSecret: process.env.SHOPIFY_API_SECRET?.trim() || '',
    apiVersion: process.env.SHOPIFY_API_VERSION?.trim() || '2024-07',
  };
}

/** Low-level Admin REST call. Throws on non-2xx with a trimmed error body. */
export async function shopifyFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const cfg = getShopifyConfig();
  if (!cfg) throw new Error('Shopify is not configured (set SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN).');
  const url = `https://${cfg.domain}/admin/api/${cfg.apiVersion}/${path.replace(/^\//, '')}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'X-Shopify-Access-Token': cfg.adminToken,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Shopify API ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

/** Connection test — returns basic shop info if credentials are valid. */
export async function getShopInfo(): Promise<{ configured: boolean; connected: boolean; shop?: any; error?: string }> {
  const cfg = getShopifyConfig();
  if (!cfg) return { configured: false, connected: false };
  try {
    const data = await shopifyFetch<{ shop: any }>('shop.json');
    const s = data.shop || {};
    return {
      configured: true,
      connected: true,
      shop: {
        name: s.name,
        domain: s.domain,
        myshopifyDomain: s.myshopify_domain,
        email: s.email,
        currency: s.currency,
        country: s.country_name,
        plan: s.plan_display_name,
      },
    };
  } catch (e: any) {
    return { configured: true, connected: false, error: e?.message ?? 'Connection failed' };
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Which ERP branch imported online orders are booked into. */
function shopifyBranch(): string {
  return process.env.SHOPIFY_BRANCH_ID?.trim() || 'erode-hq';
}

export interface ShopifyOrderPreview {
  externalOrderId: string;
  orderName: string;
  date: string;
  createdAt: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  shippingAddress?: {
    name?: string;
    address1?: string;
    address2?: string;
    city?: string;
    province?: string;
    zip?: string;
    country?: string;
    phone?: string;
  };
  billingAddress?: {
    name?: string;
    address1?: string;
    city?: string;
    province?: string;
    zip?: string;
    country?: string;
    phone?: string;
  };
  total: number;
  subtotal: number;
  tax: number;
  shippingFee: number;
  discount: number;
  financialStatus: string;
  fulfillmentStatus: string;
  paymentGateway: string;
  fulfillments?: Array<{
    trackingCompany?: string;
    trackingNumber?: string;
    trackingUrl?: string;
    status?: string;
  }>;
  trackingNumber?: string;
  trackingCompany?: string;
  trackingUrl?: string;
  note?: string;
  alreadyImported: boolean;
  linkedInvoiceNumber?: string;
  linkedInvoiceId?: string;
  lines: {
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
  }[];
  unmatchedCount: number;
  shippingMethod?: string;
  discountCodes?: string;
  shopifyOrderUrl?: string;
  currency?: string;
  cancelReason?: string;
  cancelledAt?: string;
  tags?: string;
}

/** Pull recent orders from Shopify and match line items to ERP items by SKU with live ERP stock & images. */
export async function previewOrders(limit = 50): Promise<{ configured: boolean; orders: ShopifyOrderPreview[] }> {
  const cfg = getShopifyConfig();
  if (!cfg) return { configured: false, orders: [] };

  const data = await shopifyFetch<{ orders: any[] }>(`orders.json?status=any&limit=${Math.min(250, limit)}`);
  const orders = data.orders || [];

  const items = await prisma.item.findMany();
  const bySku = new Map<string, any>();
  for (const it of items) if (it.itemCode) bySku.set(String(it.itemCode).toLowerCase(), it);

  const allStocks = await prisma.branchStock.findMany();
  const stockMap = new Map<string, number>();
  for (const s of allStocks) {
    stockMap.set(s.itemId, (stockMap.get(s.itemId) || 0) + Number(s.quantity));
  }

  const existing = await prisma.invoice.findMany({ where: { sourceChannel: 'shopify' }, select: { id: true, invoiceNumber: true, externalOrderId: true } });
  const existingMap = new Map<string, { id: string; invoiceNumber: string }>();
  for (const inv of existing) {
    if (inv.externalOrderId) existingMap.set(inv.externalOrderId, inv);
  }

  // Pre-fetch Shopify product images to attach rich thumbnails
  const productImageMap = new Map<string, string>();
  try {
    const prodData = await shopifyFetch<{ products: any[] }>('products.json?limit=250&fields=id,images,image,variants');
    for (const p of prodData.products || []) {
      const mainImg = p.image?.src || p.images?.[0]?.src;
      if (mainImg) productImageMap.set(String(p.id), mainImg);
      for (const v of p.variants || []) {
        const vImg = p.images?.find((img: any) => img.id === v.image_id)?.src || mainImg;
        if (vImg) productImageMap.set(String(v.id), vImg);
      }
    }
  } catch {
    // Non-fatal if product images fail to pull
  }

  const previews: ShopifyOrderPreview[] = orders.map((o) => {
    const lines = (o.line_items || []).map((li: any) => {
      const sku = String(li.sku || '').toLowerCase();
      const match = sku ? bySku.get(sku) : undefined;
      const erpStockOnHand = match ? (stockMap.get(match.id) || 0) : undefined;
      const shopifyImg = productImageMap.get(String(li.variant_id)) || productImageMap.get(String(li.product_id));
      const imageUrl = shopifyImg || match?.imageUrl || undefined;

      return {
        id: String(li.id),
        sku: li.sku || '',
        title: li.title || li.name || '',
        variantTitle: li.variant_title || '',
        qty: Number(li.quantity) || 0,
        price: Number(li.price) || 0,
        matched: Boolean(match),
        itemName: match?.itemName,
        erpStockOnHand,
        imageUrl,
        vendor: li.vendor || '',
        discount: Number(li.total_discount) || 0,
        taxLines: (li.tax_lines || []).map((t: any) => ({
          title: t.title,
          price: Number(t.price) || 0,
          rate: t.rate,
        })),
        properties: (li.properties || []).map((prop: any) => ({
          name: String(prop.name || ''),
          value: String(prop.value || ''),
        })),
        grams: Number(li.grams) || 0,
      };
    });

    const linked = existingMap.get(String(o.id));
    const fulfillments = (o.fulfillments || []).map((f: any) => ({
      trackingCompany: f.tracking_company,
      trackingNumber: f.tracking_number,
      trackingUrl: f.tracking_url,
      status: f.status,
    }));

    return {
      externalOrderId: String(o.id),
      orderName: o.name || `#${o.order_number}`,
      date: (o.created_at || '').split('T')[0],
      createdAt: o.created_at || '',
      customerName: [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(' ') || o.email || 'Online Customer',
      customerEmail: o.customer?.email || o.email || '',
      customerPhone: o.customer?.phone || o.phone || o.shipping_address?.phone || '',
      shippingAddress: o.shipping_address ? {
        name: [o.shipping_address.first_name, o.shipping_address.last_name].filter(Boolean).join(' ') || o.shipping_address.name,
        address1: o.shipping_address.address1,
        address2: o.shipping_address.address2,
        city: o.shipping_address.city,
        province: o.shipping_address.province,
        zip: o.shipping_address.zip,
        country: o.shipping_address.country,
        phone: o.shipping_address.phone,
      } : undefined,
      billingAddress: o.billing_address ? {
        name: [o.billing_address.first_name, o.billing_address.last_name].filter(Boolean).join(' ') || o.billing_address.name,
        address1: o.billing_address.address1,
        city: o.billing_address.city,
        province: o.billing_address.province,
        zip: o.billing_address.zip,
        country: o.billing_address.country,
        phone: o.billing_address.phone,
      } : undefined,
      total: Number(o.total_price) || 0,
      subtotal: Number(o.subtotal_price) || 0,
      tax: Number(o.total_tax) || 0,
      shippingFee: Number(o.total_shipping_price_set?.shop_money?.amount) || 0,
      discount: Number(o.total_discounts) || 0,
      financialStatus: o.financial_status || 'unknown',
      fulfillmentStatus: o.fulfillment_status || 'unfulfilled',
      paymentGateway: (o.payment_gateway_names || []).join(', ') || 'Online',
      fulfillments,
      trackingNumber: fulfillments[0]?.trackingNumber,
      trackingCompany: fulfillments[0]?.trackingCompany,
      trackingUrl: fulfillments[0]?.trackingUrl,
      note: o.note || '',
      alreadyImported: Boolean(linked),
      linkedInvoiceNumber: linked?.invoiceNumber,
      linkedInvoiceId: linked?.id,
      lines,
      unmatchedCount: lines.filter((l: any) => !l.matched).length,
      shippingMethod: o.shipping_lines?.[0]?.title || '',
      discountCodes: (o.discount_codes || []).map((d: any) => d.code).join(', '),
      shopifyOrderUrl: cfg.domain ? `https://${cfg.domain}/admin/orders/${o.id}` : undefined,
      currency: o.currency || 'INR',
      cancelReason: o.cancel_reason || undefined,
      cancelledAt: o.cancelled_at || undefined,
      tags: o.tags || undefined,
    };
  });

  return { configured: true, orders: previews };
}

async function buildSkuMap(): Promise<Map<string, any>> {
  const items = await prisma.item.findMany();
  const m = new Map<string, any>();
  for (const it of items) if (it.itemCode) m.set(String(it.itemCode).toLowerCase(), it);
  return m;
}

/**
 * Import ONE Shopify order as a sales invoice (deduped by order id). Online
 * totals are treated as final (no GST re-computation) so the ERP total matches
 * Shopify. Stock is NOT auto-decremented (avoids overselling failures).
 * Returns 'imported' | 'skipped'.
 */
/**
 * Map a raw Shopify order's real fulfillment/shipment state into our pipeline, so
 * imported orders land at their true stage (not all "New") with any tracking info.
 */
function mapShopifyFulfillment(o: any): { status: string; trackingNumber?: string; courierName?: string } {
  const fulfillments: any[] = o.fulfillments || [];
  const f = fulfillments[0];
  const trackingNumber = f?.tracking_number || f?.tracking_numbers?.[0] || undefined;
  const courierName = f?.tracking_company || undefined;
  const shipment = String(f?.shipment_status || '').toLowerCase();
  const fs = String(o.fulfillment_status || '').toLowerCase();

  let status = 'Confirmed'; // paid orders are at least confirmed
  if (shipment === 'delivered') status = 'Delivered';
  else if (shipment === 'out_for_delivery') status = 'Out for Delivery';
  else if (shipment === 'in_transit' || shipment === 'attempted_delivery' || shipment === 'confirmed' || shipment === 'ready_for_pickup') status = 'Shipped';
  else if (fs === 'fulfilled') status = 'Shipped';
  else if (fs === 'partial') status = 'Packed';
  return { status, trackingNumber, courierName };
}

export async function importOneOrder(o: any, bySku?: Map<string, any>): Promise<'imported' | 'skipped'> {
  const map = bySku || (await buildSkuMap());
  const externalOrderId = String(o.id);
  const dup = await prisma.invoice.findFirst({ where: { sourceChannel: 'shopify', externalOrderId } });
  if (dup) return 'skipped';

  await prisma.$transaction(async (tx: any) => {
    const branchId = shopifyBranch();
    const date = (o.created_at || nowIso()).split('T')[0];
    const invLines = (o.line_items || []).map((li: any) => {
      const sku = String(li.sku || '').toLowerCase();
      const match = sku ? map.get(sku) : undefined;
      const qty = Number(li.quantity) || 0;
      const price = Number(li.price) || 0;
      const taxable = r2(qty * price);
      return {
        id: `sli-${externalOrderId}-${li.id}`,
        itemId: match?.id || '',
        itemCode: match?.itemCode || li.sku || '',
        itemName: match?.itemName || li.title || li.name || 'Online item',
        itemHSN: match?.itemHSN || '',
        unit: match?.unit || 'PCS',
        quantity: qty,
        unitPrice: price,
        discountType: '%', discountValue: 0, discountAmount: 0,
        taxRate: 0, taxableAmount: taxable, cgstAmount: 0, sgstAmount: 0, totalTax: 0, totalAmount: taxable,
      };
    });
    const subtotal = r2(invLines.reduce((s: number, l: any) => s + l.taxableAmount, 0));
    const shipping = Number(o.total_shipping_price_set?.shop_money?.amount) || 0;
    const grandTotal = Number(o.total_price) || r2(subtotal + shipping);
    const invoiceNumber = await nextInvoiceNumber(tx, branchId, date);
    const ts = nowIso();
    const initialFulfillment = mapShopifyFulfillment(o);

    await tx.invoice.create({
      data: {
        id: `inv-shopify-${externalOrderId}`,
        invoiceNumber, branchId, transactionType: 'Cash',
        customerName: [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(' ') || o.email || 'Online Customer',
        customerPhone: o.customer?.phone || o.phone || null,
        customerAddress: [o.shipping_address?.address1, o.shipping_address?.city].filter(Boolean).join(', ') || null,
        date, time: (o.created_at || ts).slice(11, 19) || '00:00:00',
        paymentTerms: 'Paid', dueDate: date, stateOfSupply: '33-Tamil Nadu', withGst: false,
        items: invLines, subtotal, totalTax: 0, totalCgst: 0, totalSgst: 0,
        overallDiscountType: '%', overallDiscountValue: 0, overallDiscountAmount: 0,
        shippingCharges: shipping, roundOff: 0, roundOffEnabled: false,
        grandTotal, amountInWords: '',
        paymentMode: 'Online', paymentSplits: [{ mode: 'Online', amount: grandTotal }],
        sourceChannel: 'shopify', externalOrderId,
        onlineStatus: initialFulfillment.status,
        onlineStatusUpdatedAt: ts,
        trackingNumber: initialFulfillment.trackingNumber || null,
        courierName: initialFulfillment.courierName || null,
        onlineStatusHistory: [{ status: initialFulfillment.status, at: ts, by: 'shopify-sync', note: 'Imported from Shopify' }],
        createdById: 'shopify-sync', createdAt: ts, updatedAt: ts,
      },
    });
  });
  return 'imported';
}

/** Bulk-import recent PAID Shopify orders. */
export async function importOrders(limit = 50): Promise<{ configured: boolean; imported: number; skipped: number; results: { order: string; status: string }[] }> {
  const cfg = getShopifyConfig();
  if (!cfg) return { configured: false, imported: 0, skipped: 0, results: [] };

  const data = await shopifyFetch<{ orders: any[] }>(`orders.json?status=any&financial_status=paid&limit=${Math.min(250, limit)}`);
  const orders = data.orders || [];
  const bySku = await buildSkuMap();

  const results: { order: string; status: string }[] = [];
  let imported = 0;
  let skipped = 0;

  for (const o of orders) {
    const orderName = o.name || `#${o.order_number}`;
    try {
      const r = await importOneOrder(o, bySku);
      if (r === 'imported') { imported++; results.push({ order: orderName, status: 'imported' }); }
      else { skipped++; results.push({ order: orderName, status: 'already imported' }); }
    } catch (e: any) {
      results.push({ order: orderName, status: `error: ${e?.message?.slice(0, 80) || 'failed'}` });
    }
  }

  return { configured: true, imported, skipped, results };
}

// ---- Product catalog sync ----
export interface ShopifyProductPreview {
  sku: string;
  title: string;
  price: number;
  matched: boolean;
  itemName?: string;
}

/** Pull Shopify product variants and match to ERP items by SKU (=item code). */
export async function previewProducts(limit = 100): Promise<{ configured: boolean; products: ShopifyProductPreview[] }> {
  const cfg = getShopifyConfig();
  if (!cfg) return { configured: false, products: [] };
  const data = await shopifyFetch<{ products: any[] }>(`products.json?limit=${Math.min(250, limit)}`);
  const bySku = await buildSkuMap();
  const rows: ShopifyProductPreview[] = [];
  for (const p of data.products || []) {
    for (const v of p.variants || []) {
      const sku = String(v.sku || '').trim();
      if (!sku) continue;
      const match = bySku.get(sku.toLowerCase());
      rows.push({
        sku,
        title: p.variants.length > 1 ? `${p.title} — ${v.title}` : p.title,
        price: Number(v.price) || 0,
        matched: Boolean(match),
        itemName: match?.itemName,
      });
    }
  }
  return { configured: true, products: rows };
}

/** Create ERP items for Shopify variants whose SKU isn't already an item code. */
export async function importProducts(limit = 100): Promise<{ configured: boolean; created: number; skipped: number }> {
  const cfg = getShopifyConfig();
  if (!cfg) return { configured: false, created: 0, skipped: 0 };
  const data = await shopifyFetch<{ products: any[] }>(`products.json?limit=${Math.min(250, limit)}`);
  const bySku = await buildSkuMap();
  let created = 0;
  let skipped = 0;
  const ts = nowIso();
  for (const p of data.products || []) {
    for (const v of p.variants || []) {
      const sku = String(v.sku || '').trim();
      if (!sku) { skipped++; continue; }
      if (bySku.has(sku.toLowerCase())) { skipped++; continue; }
      await prisma.item.create({
        data: {
          id: `item-shopify-${v.id}`,
          itemName: p.variants.length > 1 ? `${p.title} — ${v.title}` : p.title,
          itemHSN: '', category: 'Shopify', subcategory: 'Imported', itemCode: sku, unit: 'PCS',
          salePrice: Number(v.price) || 0, salePriceTaxMode: 'without', wholesalePrice: Number(v.price) || 0,
          minWholesaleQty: 1, purchasePrice: 0, gstTaxSlab: 0, reorderThreshold: 10,
          createdAt: ts, updatedAt: ts,
        },
      });
      bySku.set(sku.toLowerCase(), { itemCode: sku });
      created++;
    }
  }
  return { configured: true, created, skipped };
}

/** Handle an orders/paid webhook: verify HMAC, then import the order. */
export async function handleOrderWebhook(rawBody: Buffer | string, hmac: string | undefined, order: any): Promise<{ ok: boolean; status?: string }> {
  if (!verifyWebhookHmac(rawBody, hmac)) return { ok: false };
  if (!order?.id) return { ok: true, status: 'ignored' };
  try {
    const status = await importOneOrder(order);
    return { ok: true, status };
  } catch {
    return { ok: true, status: 'error' };
  }
}

/**
 * Verify a Shopify webhook HMAC (base64 SHA-256 of the RAW request body keyed
 * with the API secret). Requires the raw, unparsed body.
 */
export function verifyWebhookHmac(rawBody: Buffer | string, hmacHeader?: string): boolean {
  const cfg = getShopifyConfig();
  if (!cfg || !cfg.apiSecret || !hmacHeader) return false;
  const digest = crypto.createHmac('sha256', cfg.apiSecret).update(rawBody).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
  } catch {
    return false;
  }
}

// ---- Inventory Sync & Push ----
export interface ShopifyInventoryRow {
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

export async function previewInventory(limit = 100): Promise<{ configured: boolean; items: ShopifyInventoryRow[] }> {
  const cfg = getShopifyConfig();
  if (!cfg) return { configured: false, items: [] };

  const data = await shopifyFetch<{ products: any[] }>(`products.json?limit=${Math.min(250, limit)}`);
  const bySku = await buildSkuMap();
  const allStocks = await prisma.branchStock.findMany();
  const stockMap = new Map<string, number>();
  for (const s of allStocks) {
    stockMap.set(s.itemId, (stockMap.get(s.itemId) || 0) + Number(s.quantity));
  }

  const rows: ShopifyInventoryRow[] = [];
  for (const p of data.products || []) {
    for (const v of p.variants || []) {
      const sku = String(v.sku || '').trim();
      if (!sku) continue;
      const match = bySku.get(sku.toLowerCase());
      const erpStock = match ? (stockMap.get(match.id) || 0) : 0;
      const shopifyQty = Number(v.inventory_quantity) || 0;

      let status: 'synced' | 'mismatch' | 'out_of_stock' | 'unlinked' = 'unlinked';
      if (match) {
        if (erpStock === 0 && shopifyQty === 0) status = 'out_of_stock';
        else if (erpStock === shopifyQty) status = 'synced';
        else status = 'mismatch';
      }

      rows.push({
        sku,
        title: p.title,
        variantTitle: v.title !== 'Default Title' ? v.title : undefined,
        productId: String(p.id),
        variantId: String(v.id),
        inventoryItemId: String(v.inventory_item_id || ''),
        shopifyPrice: Number(v.price) || 0,
        compareAtPrice: v.compare_at_price ? Number(v.compare_at_price) : undefined,
        shopifyInventory: shopifyQty,
        matched: Boolean(match),
        erpItemId: match?.id,
        erpItemName: match?.itemName,
        erpPrice: match?.salePrice,
        erpStockOnHand: erpStock,
        status,
      });
    }
  }

  return { configured: true, items: rows };
}

export async function pushInventoryToShopify(inventoryItemId: string, availableQuantity: number): Promise<{ success: boolean; error?: string }> {
  const cfg = getShopifyConfig();
  if (!cfg) return { success: false, error: 'Shopify not configured' };
  try {
    const locData = await shopifyFetch<{ locations: any[] }>('locations.json');
    const loc = locData.locations?.find((l) => l.active) || locData.locations?.[0];
    if (!loc) return { success: false, error: 'No active location found in Shopify' };

    await shopifyFetch('inventory_levels/set.json', {
      method: 'POST',
      body: JSON.stringify({
        location_id: loc.id,
        inventory_item_id: Number(inventoryItemId),
        available: Math.max(0, Math.floor(availableQuantity)),
      }),
    });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Inventory update failed' };
  }
}

export async function pushAllErpStockToShopify(): Promise<{ updated: number; failed: number; errors: string[] }> {
  const cfg = getShopifyConfig();
  if (!cfg) return { updated: 0, failed: 0, errors: ['Shopify not configured'] };

  const { items } = await previewInventory(250);
  let updated = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const item of items) {
    if (!item.matched || !item.inventoryItemId || item.status === 'synced') continue;
    const res = await pushInventoryToShopify(item.inventoryItemId, item.erpStockOnHand);
    if (res.success) {
      updated++;
    } else {
      failed++;
      errors.push(`${item.sku}: ${res.error}`);
    }
  }

  return { updated, failed, errors };
}

// ---- Order Fulfillment & Tracking ----
export async function fulfillShopifyOrder(
  orderId: string,
  trackingNumber?: string,
  carrier?: string
): Promise<{ success: boolean; error?: string }> {
  const cfg = getShopifyConfig();
  if (!cfg) return { success: false, error: 'Shopify not configured' };
  try {
    const foData = await shopifyFetch<{ fulfillment_orders: any[] }>(`orders/${orderId}/fulfillment_orders.json`);
    const openFo = (foData.fulfillment_orders || []).find((fo) => fo.status === 'open');

    if (openFo) {
      await shopifyFetch('fulfillments.json', {
        method: 'POST',
        body: JSON.stringify({
          fulfillment: {
            line_items_by_fulfillment_order: [
              {
                fulfillment_order_id: openFo.id,
              },
            ],
            tracking_info: trackingNumber ? {
              number: trackingNumber,
              company: carrier || 'Delhivery',
            } : undefined,
            notify_customer: true,
          },
        }),
      });
      return { success: true };
    }

    await shopifyFetch(`orders/${orderId}/fulfillments.json`, {
      method: 'POST',
      body: JSON.stringify({
        fulfillment: {
          tracking_number: trackingNumber,
          tracking_company: carrier || 'Delhivery',
          notify_customer: true,
        },
      }),
    });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Fulfillment failed' };
  }
}

// ---- Online-order fulfillment pipeline (ERP-side status tracking) ----
const ONLINE_PIPELINE = ['New', 'Confirmed', 'Packed', 'Shipped', 'Out for Delivery', 'Delivered'];

/**
 * Advance/set an online (Shopify) order's fulfillment status in the ERP. Records
 * a status-history trail. When the order reaches "Shipped" and it is linked to a
 * Shopify order, it best-effort pushes a fulfillment (with tracking) to Shopify.
 * Returns the fresh invoice snapshot so the client can reconcile.
 */
export async function updateOnlineOrderStatus(
  invoiceId: string,
  status: string,
  opts: { trackingNumber?: string; courierName?: string; note?: string; actor: string }
): Promise<{ invoice: any; shopify?: { success: boolean; error?: string } }> {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv) throw new Error('Order not found');
  if (![...ONLINE_PIPELINE, 'Cancelled'].includes(status)) throw new Error(`Invalid status: ${status}`);

  const now = nowIso();
  const history = Array.isArray((inv as any).onlineStatusHistory) ? (inv as any).onlineStatusHistory : [];
  history.push({ status, at: now, by: opts.actor, note: opts.note || undefined });

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      onlineStatus: status,
      onlineStatusUpdatedAt: now,
      ...(opts.trackingNumber !== undefined ? { trackingNumber: opts.trackingNumber } : {}),
      ...(opts.courierName !== undefined ? { courierName: opts.courierName } : {}),
      onlineStatusHistory: history,
    },
  });

  // Push a Shopify fulfillment when the order ships (linked orders only).
  let shopify: { success: boolean; error?: string } | undefined;
  if (status === 'Shipped' && inv.externalOrderId && getShopifyConfig()) {
    shopify = await fulfillShopifyOrder(inv.externalOrderId, opts.trackingNumber, opts.courierName);
  }

  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  return { invoice, shopify };
}

// ---- Online Customers ----
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

export async function getShopifyCustomers(limit = 100): Promise<{ configured: boolean; customers: ShopifyCustomerSummary[] }> {
  const cfg = getShopifyConfig();
  if (!cfg) return { configured: false, customers: [] };

  const data = await shopifyFetch<{ customers: any[] }>(`customers.json?limit=${Math.min(250, limit)}`);
  const erpCustomers = await prisma.customer.findMany();
  const erpPhones = new Set(erpCustomers.map((c) => (c.phone || '').trim()).filter(Boolean));

  const list: ShopifyCustomerSummary[] = (data.customers || []).map((c: any) => {
    const email = c.email?.trim().toLowerCase() || '';
    const phone = c.phone?.trim() || c.default_address?.phone?.trim() || '';
    const synced = Boolean(phone && erpPhones.has(phone));

    return {
      id: String(c.id),
      name: [c.first_name, c.last_name].filter(Boolean).join(' ') || email || 'Online Customer',
      email,
      phone,
      city: c.default_address?.city || '',
      province: c.default_address?.province || '',
      ordersCount: Number(c.orders_count) || 0,
      totalSpent: Number(c.total_spent) || 0,
      lastOrderDate: c.updated_at ? c.updated_at.split('T')[0] : undefined,
      syncedToErp: Boolean(synced),
    };
  });

  return { configured: true, customers: list };
}

/** Find similar or alternate ERP items by search term or category, including on-hand stock */
export async function findSimilarErpItems(query?: string, category?: string, limit = 8) {
  const q = (query || '').trim();
  const cat = (category || '').trim();

  const whereClause: any = {};
  if (cat && q) {
    whereClause.OR = [
      { category: { contains: cat } },
      { itemName: { contains: q } },
      { itemCode: { contains: q } },
    ];
  } else if (cat) {
    whereClause.category = { contains: cat };
  } else if (q) {
    whereClause.OR = [
      { itemName: { contains: q } },
      { itemCode: { contains: q } },
    ];
  }

  const items = await prisma.item.findMany({
    where: Object.keys(whereClause).length ? whereClause : undefined,
    take: 30,
  });

  const stocks = await prisma.branchStock.findMany({
    where: { itemId: { in: items.map((i) => i.id) } },
  });

  const stockMap = new Map<string, number>();
  for (const s of stocks) {
    stockMap.set(s.itemId, (stockMap.get(s.itemId) || 0) + Number(s.quantity));
  }

  return items.slice(0, limit).map((it) => ({
    id: it.id,
    itemName: it.itemName,
    itemCode: it.itemCode,
    category: it.category,
    salePrice: it.salePrice,
    imageUrl: it.imageUrl,
    unit: it.unit,
    stockOnHand: stockMap.get(it.id) || 0,
  }));
}
