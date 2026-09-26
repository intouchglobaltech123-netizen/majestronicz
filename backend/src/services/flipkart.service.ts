/**
 * Flipkart Seller API — connection + order preview.
 *
 * Mirrors shopify.service.ts so the two marketplaces behave the same way from
 * the app's side: configuration lives in the environment, nothing is thrown at
 * the caller for a missing config (the UI asks "are you configured?" and shows
 * how to fix it), and a preview never writes anything.
 *
 * Auth is OAuth2 client-credentials: the Application ID and Secret from Seller
 * Hub → Manage Profile → Developer Access are exchanged for a bearer token,
 * which is cached until shortly before it expires. Flipkart rate-limits token
 * issuance, so fetching one per request would itself become the outage.
 */

const TOKEN_URL =
  'https://api.flipkart.net/oauth-service/oauth/token?grant_type=client_credentials&scope=Seller_Api';
const API_BASE = 'https://api.flipkart.net/sellers';
const TIMEOUT_MS = 15_000;
/** Refresh this long before actual expiry, so an in-flight call cannot straddle it. */
const TOKEN_SKEW_MS = 60_000;

export interface FlipkartConfig {
  appId: string;
  appSecret: string;
  /** Which branch Flipkart orders belong to; defaults to the same branch Shopify uses. */
  branchId: string;
}

export function getFlipkartConfig(): FlipkartConfig | null {
  const appId = process.env.FLIPKART_APP_ID?.trim();
  const appSecret = process.env.FLIPKART_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;
  return {
    appId,
    appSecret,
    branchId: process.env.FLIPKART_BRANCH_ID?.trim() || process.env.SHOPIFY_BRANCH_ID?.trim() || 'erode-hq',
  };
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(cfg: FlipkartConfig): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - TOKEN_SKEW_MS) {
    return cachedToken.token;
  }
  const basic = Buffer.from(`${cfg.appId}:${cfg.appSecret}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'GET',
    headers: { Authorization: `Basic ${basic}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // Flipkart returns 401 for two very different situations, and they need
    // different actions from different people. Verified against the live API:
    //   "Self Access Application is not in Approved state" -> credentials are
    //       correct and recognised; Flipkart has not approved the access yet,
    //       and nothing on our side can change that.
    //   "No client with requested id: …"                   -> the Application ID
    //       is wrong (or swapped with the Secret), which IS ours to fix.
    // Collapsing both into "rejected" sends someone hunting the wrong problem.
    const err: any = new Error(
      /not in Approved state/i.test(detail)
        ? 'Flipkart has not approved this Developer Access yet. The credentials are correct — the access shows as Pending in Seller Hub and must become Active before any API call succeeds.'
        : /No client with requested id/i.test(detail)
          ? 'Flipkart does not recognise this Application ID. Check FLIPKART_APP_ID is the API Key from Seller Hub, and that the ID and Secret are not swapped.'
          : res.status === 401
            ? 'Flipkart rejected the credentials.'
            : `Flipkart token request failed (${res.status}) ${detail.slice(0, 120)}`,
    );
    err.reason = /not in Approved state/i.test(detail)
      ? 'pending_approval'
      : /No client with requested id/i.test(detail)
        ? 'bad_credentials'
        : 'unknown';
    throw err;
  }
  const body: any = await res.json();
  const ttlMs = (Number(body.expires_in) || 3600) * 1000;
  cachedToken = { token: body.access_token, expiresAt: Date.now() + ttlMs };
  return cachedToken.token;
}

async function flipkartFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const cfg = getFlipkartConfig();
  if (!cfg) throw new Error('Flipkart is not configured (FLIPKART_APP_ID / FLIPKART_APP_SECRET).');
  const token = await getAccessToken(cfg);
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Flipkart API ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Connection check for the Online Stores screen.
 *
 * Never throws: the screen needs to distinguish "no credentials yet" from
 * "credentials present but rejected", and an exception collapses both into a
 * red box that says nothing useful.
 */
export type FlipkartFailure = 'not_configured' | 'pending_approval' | 'bad_credentials' | 'network' | 'unknown';

export async function getFlipkartStatus(): Promise<{
  configured: boolean;
  connected: boolean;
  appId?: string;
  branchId?: string;
  error?: string;
  /** Why it is not connected — drives what the screen tells the operator to do. */
  reason?: FlipkartFailure;
}> {
  const cfg = getFlipkartConfig();
  if (!cfg) {
    return {
      configured: false,
      connected: false,
      error: 'Add FLIPKART_APP_ID and FLIPKART_APP_SECRET to the server environment.',
      reason: 'not_configured',
    };
  }
  try {
    await getAccessToken(cfg);
    return {
      configured: true,
      connected: true,
      // Only the tail, so the screen can confirm which access is in use without
      // printing a credential.
      appId: `…${cfg.appId.slice(-6)}`,
      branchId: cfg.branchId,
    };
  } catch (err: any) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return {
      configured: true,
      connected: false,
      appId: `…${cfg.appId.slice(-6)}`,
      branchId: cfg.branchId,
      error: timedOut ? 'Flipkart did not respond.' : err?.message || 'Could not reach Flipkart.',
      reason: timedOut ? 'network' : (err?.reason as FlipkartFailure) || 'unknown',
    };
  }
}

export interface FlipkartOrderPreview {
  orderId: string;
  orderItemId: string;
  shipmentId?: string;
  sku?: string;
  title?: string;
  quantity: number;
  price?: number;
  status?: string;
  orderDate?: string;
}

/**
 * Orders awaiting action, read-only.
 *
 * Flipkart models orders as shipments, filtered by state; APPROVED is the
 * "accepted, not yet packed" queue a seller actually works from.
 */
export async function previewFlipkartOrders(limit = 50): Promise<{
  configured: boolean;
  orders: FlipkartOrderPreview[];
  error?: string;
}> {
  if (!getFlipkartConfig()) return { configured: false, orders: [] };
  try {
    const body = await flipkartFetch<any>('/v3/shipments/filter', {
      method: 'POST',
      body: JSON.stringify({
        filter: { type: 'preDispatch', states: ['APPROVED'] },
        pagination: { pageSize: Math.min(Math.max(limit, 1), 100) },
      }),
    });
    const shipments: any[] = body?.shipments || [];
    const orders: FlipkartOrderPreview[] = [];
    for (const s of shipments) {
      for (const it of s.orderItems || []) {
        orders.push({
          orderId: it.orderId ?? s.orderId ?? '',
          orderItemId: it.orderItemId ?? '',
          shipmentId: s.shipmentId,
          sku: it.sku,
          title: it.title ?? it.productTitle,
          quantity: Number(it.quantity) || 1,
          price: Number(it.priceComponents?.sellingPrice ?? it.sellingPrice) || undefined,
          status: it.status ?? s.status,
          orderDate: it.orderDate ?? s.orderDate,
        });
      }
    }
    return { configured: true, orders: orders.slice(0, limit) };
  } catch (err: any) {
    // Configured but unreachable is a real state the screen must show, not a 500.
    return { configured: true, orders: [], error: err?.message || 'Could not load Flipkart orders.' };
  }
}
