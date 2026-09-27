/**
 * Phone-number OTP via MSG91 (https://msg91.com) — the OTP provider for India.
 *
 * MSG91's OTP API generates, stores AND verifies the code on their side, so we
 * never persist an OTP ourselves (nothing to leak). India requires DLT: register
 * a Sender ID (header) + OTP template on your operator's DLT portal, create the
 * matching OTP template in MSG91, then set these env vars:
 *   MSG91_AUTHKEY         — your MSG91 auth key
 *   MSG91_OTP_TEMPLATE_ID — the approved OTP template id
 *   MSG91_SENDER_ID       — (optional) the 6-char DLT header, if the template needs it
 *   OTP_DEFAULT_COUNTRY   — (optional) country code digits, default "91" (India)
 *
 * If unset, the feature degrades gracefully and reports that it isn't configured
 * (mirrors how Shopify / the AI assistant behave without keys).
 */

const AUTHKEY = process.env.MSG91_AUTHKEY || '';
const TEMPLATE_ID = process.env.MSG91_OTP_TEMPLATE_ID || '';
const SENDER_ID = process.env.MSG91_SENDER_ID || '';
const COUNTRY = process.env.OTP_DEFAULT_COUNTRY || '91';
const BASE = 'https://control.msg91.com/api/v5/otp';

export const isOtpConfigured = (): boolean => !!AUTHKEY && !!TEMPLATE_ID;

export function getOtpStatus() {
  return {
    provider: 'MSG91',
    configured: isOtpConfigured(),
    message: isOtpConfigured()
      ? 'OTP service is configured.'
      : 'OTP not configured — set MSG91_AUTHKEY and MSG91_OTP_TEMPLATE_ID (and complete DLT registration).',
  };
}

/** Normalise an Indian mobile to MSG91's "<country><10 digits>" form, e.g. 919876543210. */
function normalizeMobile(raw: string): string | null {
  const digits = String(raw || '').replace(/\D/g, '');
  // Already has a country code (11–15 digits)?
  if (digits.length >= 11 && digits.length <= 15) return digits;
  // Bare 10-digit Indian mobile → prefix the default country code.
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `${COUNTRY}${digits}`;
  return null;
}

// Simple anti-abuse throttle: cap OTP sends per mobile so a public endpoint can't
// burn SMS credits. (Verification is throttled by MSG91's own attempt limits.)
const sendLog = new Map<string, number[]>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_SENDS = 5;
function withinRateLimit(mobile: string): boolean {
  const now = Date.now();
  const hits = (sendLog.get(mobile) || []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_SENDS) return false;
  hits.push(now);
  sendLog.set(mobile, hits);
  return true;
}

interface OtpResult { ok: boolean; code: string; message: string; }

export async function sendOtp(phone: string): Promise<OtpResult> {
  if (!isOtpConfigured()) return { ok: false, code: 'NOT_CONFIGURED', message: 'OTP service is not set up yet.' };
  const mobile = normalizeMobile(phone);
  if (!mobile) return { ok: false, code: 'BAD_PHONE', message: 'Enter a valid mobile number.' };
  if (!withinRateLimit(mobile)) return { ok: false, code: 'RATE_LIMITED', message: 'Too many OTP requests. Try again in a few minutes.' };

  const params = new URLSearchParams({ template_id: TEMPLATE_ID, mobile, authkey: AUTHKEY, otp_length: '6' });
  if (SENDER_ID) params.set('sender', SENDER_ID);
  try {
    const res = await fetch(`${BASE}?${params.toString()}`, { method: 'POST' });
    const data: any = await res.json().catch(() => ({}));
    if (res.ok && (data?.type === 'success' || data?.request_id)) {
      return { ok: true, code: 'SENT', message: 'OTP sent.' };
    }
    return { ok: false, code: 'SEND_FAILED', message: data?.message || 'Could not send OTP.' };
  } catch {
    return { ok: false, code: 'PROVIDER_UNREACHABLE', message: 'OTP provider unreachable. Try again.' };
  }
}

export async function verifyOtp(phone: string, otp: string): Promise<OtpResult> {
  if (!isOtpConfigured()) return { ok: false, code: 'NOT_CONFIGURED', message: 'OTP service is not set up yet.' };
  const mobile = normalizeMobile(phone);
  if (!mobile) return { ok: false, code: 'BAD_PHONE', message: 'Enter a valid mobile number.' };
  const clean = String(otp || '').replace(/\D/g, '');
  if (!clean) return { ok: false, code: 'BAD_OTP', message: 'Enter the OTP.' };

  const params = new URLSearchParams({ authkey: AUTHKEY, mobile, otp: clean });
  try {
    const res = await fetch(`${BASE}/verify?${params.toString()}`, { method: 'GET' });
    const data: any = await res.json().catch(() => ({}));
    if (res.ok && data?.type === 'success') return { ok: true, code: 'VERIFIED', message: 'Verified.' };
    return { ok: false, code: 'INVALID_OTP', message: data?.message || 'Incorrect or expired OTP.' };
  } catch {
    return { ok: false, code: 'PROVIDER_UNREACHABLE', message: 'OTP provider unreachable. Try again.' };
  }
}
