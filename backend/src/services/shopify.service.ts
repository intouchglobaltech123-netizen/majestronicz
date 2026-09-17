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
  customerName: string;
  total: number;
  financialStatus: string;
  alreadyImported: boolean;
  lines: { sku: string; title: string; qty: number; price: number; matched: boolean; itemName?: string }[];
  unmatchedCount: number;
}

/** Pull recent orders from Shopify and match line items to ERP items by SKU. */
export async function previewOrders(limit = 50): Promise<{ configured: boolean; orders: ShopifyOrderPreview[] }> {
  const cfg = getShopifyConfig();
  if (!cfg) return { configured: false, orders: [] };

  const data = await shopifyFetch<{ orders: any[] }>(`orders.json?status=any&limit=${Math.min(250, limit)}`);
  const orders = data.orders || [];

  const items = await prisma.item.findMany();
  const bySku = new Map<string, any>();
  for (const it of items) if (it.itemCode) bySku.set(String(it.itemCode).toLowerCase(), it);

  const existing = await prisma.invoice.findMany({ where: { sourceChannel: 'shopify' }, select: { externalOrderId: true } });
  const importedIds = new Set(existing.map((i) => i.externalOrderId).filter(Boolean));

  const previews: ShopifyOrderPreview[] = orders.map((o) => {
    const lines = (o.line_items || []).map((li: any) => {
      const sku = String(li.sku || '').toLowerCase();
      const match = sku ? bySku.get(sku) : undefined;
      return {
        sku: li.sku || '',
        title: li.title || li.name || '',
        qty: Number(li.quantity) || 0,
        price: Number(li.price) || 0,
        matched: Boolean(match),
        itemName: match?.itemName,
      };
    });
    return {
      externalOrderId: String(o.id),
      orderName: o.name || `#${o.order_number}`,
      date: (o.created_at || '').split('T')[0],
      customerName: [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(' ') || o.email || 'Online Customer',
      total: Number(o.total_price) || 0,
      financialStatus: o.financial_status || 'unknown',
      alreadyImported: importedIds.has(String(o.id)),
      lines,
      unmatchedCount: lines.filter((l: any) => !l.matched).length,
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
