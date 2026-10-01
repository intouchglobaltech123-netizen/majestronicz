import { getTokenSession } from './api';

/**
 * Per-user, per-device preference storage.
 *
 * UI customizations — theme, fonts, keyboard shortcuts, remembered dropdowns /
 * filters, the last active view/tab, sidebar layout — must belong to the person
 * who set them, NOT to the browser. On a shared computer, one staff member's
 * choices used to carry over to whoever logged in next because they were kept
 * under fixed localStorage keys. Scoping every key by the logged-in user fixes
 * that: each login sees only its own settings, and defaults otherwise.
 *
 * This is deliberately LOCAL (per device). Preferences do not follow a user to
 * another computer — that would need a server-side user-preferences store.
 * Mirrors the existing salesDrafts / open-bills convention.
 */

type UserLike = { userId?: string; name?: string; role?: string } | null | undefined;

/** The stable key for a user. Prefers the account id; falls back to name/role,
 *  then 'guest' before anyone has logged in. Pass the current user, or omit to
 *  derive it from the signed token at call time (safe inside stale closures). */
export function prefUserKey(user?: UserLike): string {
  if (user) return String(user.userId || user.name || user.role || 'guest');
  const s = getTokenSession();
  return String(s?.userId || s?.name || 'guest');
}

/** Namespace a base key to the given (or current) user. */
export function scopedKey(base: string, userKey: string = prefUserKey()): string {
  return `${base}__u_${userKey}`;
}

export function readScoped(base: string, userKey: string = prefUserKey()): string | null {
  try {
    return localStorage.getItem(scopedKey(base, userKey));
  } catch {
    return null;
  }
}

export function writeScoped(base: string, value: string, userKey: string = prefUserKey()): void {
  try {
    localStorage.setItem(scopedKey(base, userKey), value);
  } catch {
    /* storage unavailable (private window / blocked) — pref simply won't persist */
  }
}

export function removeScoped(base: string, userKey: string = prefUserKey()): void {
  try {
    localStorage.removeItem(scopedKey(base, userKey));
  } catch {
    /* ignore */
  }
}
