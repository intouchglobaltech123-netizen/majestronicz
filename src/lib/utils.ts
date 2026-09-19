import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(amount);
}

/**
 * Returns today's date in YYYY-MM-DD format using local time to prevent UTC timezone offset issues.
 */
export function getTodayDateString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns yesterday's date in YYYY-MM-DD format using local time.
 */
export function getYesterdayDateString(d: Date = new Date()): string {
  const prev = new Date(d);
  prev.setDate(prev.getDate() - 1);
  return getTodayDateString(prev);
}

/**
 * Normalizes an Indian phone number to 10 digits:
 * - Strips all non-digit characters
 * - If length > 10 and starts with "91", removes the "91"
 * - If length === 11 and starts with "0", removes the "0"
 * - Slices to max 10 digits
 */
export function cleanPhoneDigits(raw?: string): string {
  if (!raw) return '';
  let digits = raw.replace(/\D/g, '');
  if (digits.length > 10 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return digits.slice(0, 10);
}

/**
 * Checks if a string is a complete 10-digit Indian phone number.
 */
export function isValid10DigitPhone(raw?: string): boolean {
  const digits = cleanPhoneDigits(raw);
  return digits.length === 10;
}

/**
 * Formats a 10-digit phone number with +91 country prefix for display (e.g. "+91 98421 00000").
 */
export function formatPhoneWithCountryCode(raw?: string): string {
  const digits = cleanPhoneDigits(raw);
  if (!digits) return '';
  if (digits.length <= 5) return `+91 ${digits}`;
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

/**
 * Cross-browser check for native HTML5 fullscreen mode (supports macOS Safari webkit prefix,
 * standard HTML5 fullscreen, and mobile).
 */
export function getIsFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  const doc = document as any;
  return Boolean(
    doc.fullscreenElement ||
    doc.webkitFullscreenElement ||
    doc.webkitCurrentFullScreenElement ||
    doc.mozFullScreenElement ||
    doc.msFullscreenElement ||
    doc.webkitIsFullScreen
  );
}

/**
 * Cross-browser request for native fullscreen.
 */
export async function enterNativeFullscreen(): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  const elem = (document.documentElement || document.body) as any;

  // Ordered list of browser fullscreen entry methods
  const methods = [
    () => (elem.requestFullscreen ? elem.requestFullscreen() : null),
    () => (elem.webkitRequestFullscreen ? elem.webkitRequestFullscreen() : null),
    () => (elem.webkitRequestFullScreen ? elem.webkitRequestFullScreen() : null),
    () => (elem.mozRequestFullScreen ? elem.mozRequestFullScreen() : null),
    () => (elem.msRequestFullscreen ? elem.msRequestFullscreen() : null),
  ];

  for (const fn of methods) {
    try {
      const res = fn();
      if (res && typeof res.then === 'function') {
        await res;
        return true;
      } else if (res !== null && res !== false) {
        return true;
      }
    } catch {
      // Try next vendor method
    }
  }
  return false;
}

/**
 * Cross-browser exit from native fullscreen (supports macOS Safari webkitExitFullscreen without throwing).
 */
export async function exitNativeFullscreen(): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  const doc = document as any;

  // Prioritize active fullscreen element exit if available
  const methods = [
    () => (doc.exitFullscreen ? doc.exitFullscreen() : null),
    () => (doc.webkitExitFullscreen ? doc.webkitExitFullscreen() : null),
    () => (doc.webkitCancelFullScreen ? doc.webkitCancelFullScreen() : null),
    () => (doc.mozCancelFullScreen ? doc.mozCancelFullScreen() : null),
    () => (doc.msExitFullscreen ? doc.msExitFullscreen() : null),
  ];

  for (const fn of methods) {
    try {
      const res = fn();
      if (res && typeof res.then === 'function') {
        await res;
        return true;
      } else if (res !== null && res !== false) {
        return true;
      }
    } catch {
      // Try next vendor method if this one failed
    }
  }
  return false;
}
