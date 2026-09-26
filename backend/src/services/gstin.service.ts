/**
 * GSTIN verification.
 *
 * Two layers, deliberately:
 *
 *   1. Offline validation — format plus the GSTIN check digit. This is real
 *      validation, not a regex rubber stamp: the 15th character is a checksum
 *      over the first 14, so a typo in any of them is caught here with no
 *      network call, no API credit and no latency. Most bad input is a typo,
 *      so most bad input never reaches the provider.
 *
 *   2. Remote lookup — only for input that already passes (1), and only when
 *      the provider is configured. It returns the registered legal/trade name
 *      and status, which is what makes the vendor record trustworthy.
 *
 * If the provider is not configured or is down, verification degrades to layer
 * 1 and says so (`source: 'offline'`). Vendor creation must never be blocked by
 * a third-party outage, so callers treat a degraded result as "format is good,
 * identity unconfirmed" rather than as a failure.
 */

export interface GstinResult {
  gstin: string;
  /** Format + checksum valid. False means the number itself is wrong. */
  valid: boolean;
  /** 'offline' = checksum only; 'api' = confirmed with the GST provider; 'cache' = a recent api result. */
  source: 'offline' | 'api' | 'cache';
  legalName?: string;
  tradeName?: string;
  /** e.g. Active, Cancelled, Suspended — as reported by the provider. */
  status?: string;
  address?: string;
  stateCode?: string;
  /** Present when the number is invalid, or when the lookup could not run. */
  message?: string;
  /** Provider credit balance after this call, when it reports one. */
  creditsRemaining?: number;
}

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const CODES = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * The GSTIN check digit: positions are weighted 1,2,1,2… and each product is
 * folded (quotient + remainder, base 36) before summing — the same scheme the
 * GST portal uses, so this agrees with it exactly.
 */
export function gstinChecksumValid(gstin: string): boolean {
  if (gstin.length !== 15) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = CODES.indexOf(gstin[i]);
    if (value < 0) return false;
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CODES[(36 - (sum % 36)) % 36] === gstin[14];
}

/** Offline-only verdict: shape, checksum and the state code. */
export function validateGstinOffline(raw: string): GstinResult {
  const gstin = String(raw || '').trim().toUpperCase();
  if (!GSTIN_RE.test(gstin)) {
    return { gstin, valid: false, source: 'offline', message: 'Not a GSTIN format (e.g. 33AABCD1234E1Z5).' };
  }
  if (!gstinChecksumValid(gstin)) {
    return { gstin, valid: false, source: 'offline', message: 'GSTIN check digit does not match — please re-type it.' };
  }
  const stateCode = gstin.substring(0, 2);
  if (Number(stateCode) < 1 || Number(stateCode) > 38) {
    return { gstin, valid: false, source: 'offline', message: `Unknown state code "${stateCode}".` };
  }
  return { gstin, valid: true, source: 'offline', stateCode };
}

// ── Remote lookup ────────────────────────────────────────────────────────────
//
// Provider-agnostic on purpose: the URL template and header name are
// configuration, so switching provider (or pointing at a sandbox) is an env
// change, not a code change.
//
//   GSTIN_API_URL          e.g. https://www.gstinapi.in/v1/gstin/{gstin}
//                          "{gstin}" is replaced with the number.
//   GSTIN_API_KEY          the key itself (backend/.env, never committed)
//   GSTIN_API_KEY_HEADER   header to send it in   (default: x-api-key)
//   GSTIN_API_AUTH_SCHEME  e.g. "Bearer" when the provider wants
//                          "Authorization: Bearer <key>" (default: none)
const API_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // a registration does not change hourly
const CACHE_MAX = 500;
/** Log a warning once the provider's credit balance drops to this. */
const LOW_CREDIT_WARN = 50;

const cache = new Map<string, { at: number; result: GstinResult }>();

export function gstinProviderConfigured(): boolean {
  return Boolean(process.env.GSTIN_API_KEY && process.env.GSTIN_API_URL);
}

/**
 * Maps the provider's response. Written against gstinapi.in's documented shape
 * — `{ success, gstin, credits_remaining, data: { legal_name, trade_name,
 * status, address, city, pincode } }` — while still accepting the GST portal's
 * own field names (`lgnm`, `tradeNam`, `sts`, `pradr.adr`) and plain camelCase,
 * so swapping provider is an env change rather than a code change.
 */
function mapProviderResponse(gstin: string, body: any): GstinResult {
  const d = body?.data ?? body?.result ?? body ?? {};
  const legalName = d.legal_name ?? d.lgnm ?? d.legalName ?? d.name;
  const tradeName = d.trade_name ?? d.tradeNam ?? d.tradeName;
  const status = d.status ?? d.sts ?? d.gstinStatus;
  const addr = d.address ?? d.pradr?.adr ?? d.principalAddress;
  // city/pincode come separately from this provider; fold them in so the
  // vendor form can show one usable line.
  const parts = [typeof addr === 'string' ? addr : undefined, d.city, d.pincode].filter(Boolean);
  return {
    gstin,
    valid: true,
    source: 'api',
    legalName: legalName || undefined,
    tradeName: tradeName || undefined,
    status: status || undefined,
    address: parts.length ? parts.join(', ') : undefined,
    stateCode: gstin.substring(0, 2),
    creditsRemaining: typeof body?.credits_remaining === 'number' ? body.credits_remaining : undefined,
  };
}

export async function verifyGstin(raw: string): Promise<GstinResult> {
  const offline = validateGstinOffline(raw);
  // A number that fails its own checksum is wrong no matter what any API says,
  // and asking costs money — so stop here.
  if (!offline.valid) return offline;

  const gstin = offline.gstin;

  const hit = cache.get(gstin);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { ...hit.result, source: 'cache' };
  }

  if (!gstinProviderConfigured()) {
    return { ...offline, message: 'Format and check digit are valid. Registered name not verified (GSTIN lookup not configured).' };
  }

  const url = String(process.env.GSTIN_API_URL).replace('{gstin}', encodeURIComponent(gstin));
  const headers: Record<string, string> = { Accept: 'application/json' };
  const scheme = process.env.GSTIN_API_AUTH_SCHEME;
  if (scheme) headers.Authorization = `${scheme} ${process.env.GSTIN_API_KEY}`;
  else headers[process.env.GSTIN_API_KEY_HEADER || 'x-api-key'] = String(process.env.GSTIN_API_KEY);

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(API_TIMEOUT_MS) });

    if (res.status === 400) {
      // The provider charges nothing for a malformed number. Our checksum pass
      // should have caught it already, so reaching here means the provider is
      // stricter than we are — believe it.
      const bad: GstinResult = { gstin, valid: false, source: 'api', message: 'This GSTIN is not valid.' };
      remember(gstin, bad);
      return bad;
    }
    if (res.status === 402) {
      // Out of credits: an account problem, never the user's fault.
      console.error('[gstin] provider reports insufficient credits — top up the GSTIN API account');
      return { ...offline, message: 'Format is valid. Registered name not verified (GSTIN lookup credits exhausted).' };
    }
    if (res.status === 502) {
      return { ...offline, message: 'Format is valid. Registered name not verified (GST portal unavailable).' };
    }
    if (res.status === 404) {
      const notFound: GstinResult = { gstin, valid: false, source: 'api', message: 'This GSTIN is not registered with the GST portal.' };
      remember(gstin, notFound);
      return notFound;
    }
    if (res.status === 401 || res.status === 403) {
      // Our problem, not the user's: do not tell them their GSTIN is bad.
      console.error('[gstin] provider rejected the API key', res.status);
      return { ...offline, message: 'Format is valid. Registered name not verified (GSTIN service rejected our key).' };
    }
    if (res.status === 429) {
      return { ...offline, message: 'Format is valid. Registered name not verified (GSTIN service rate limit reached).' };
    }
    if (!res.ok) {
      console.error('[gstin] provider error', res.status);
      return { ...offline, message: 'Format is valid. Registered name not verified (GSTIN service unavailable).' };
    }

    const body = await res.json();
    // Providers commonly answer 200 with a failure flag in the body.
    if (body?.error || body?.success === false || body?.valid === false) {
      const msg = String(body?.message || body?.error || '').slice(0, 200);
      const bad: GstinResult = { gstin, valid: false, source: 'api', message: msg || 'GST portal does not recognise this GSTIN.' };
      remember(gstin, bad);
      return bad;
    }

    const mapped = mapProviderResponse(gstin, body);
    // Surfaced in the server log rather than to the user: credits run out
    // quietly, and the first symptom is otherwise every vendor showing
    // "not verified".
    if (typeof mapped.creditsRemaining === 'number' && mapped.creditsRemaining <= LOW_CREDIT_WARN) {
      console.warn(`[gstin] only ${mapped.creditsRemaining} lookup credits left`);
    }
    remember(gstin, mapped);
    return mapped;
  } catch (err: any) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    console.error('[gstin] lookup failed:', timedOut ? `timeout after ${API_TIMEOUT_MS}ms` : err?.message);
    return { ...offline, message: 'Format is valid. Registered name not verified (GSTIN service did not respond).' };
  }
}

function remember(gstin: string, result: GstinResult) {
  // Bounded: oldest entry out first, so a long-running server cannot grow this
  // map without limit.
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(gstin, { at: Date.now(), result });
}
