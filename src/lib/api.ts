/**
 * Thin fetch client for the Majestronicz backend (Express + Prisma + Postgres).
 * Base URL comes from VITE_API_URL, defaulting to the local dev backend.
 */
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000';

const TOKEN_KEY = 'majestronicz_token';
let authToken: string | null =
  typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;

export function setAuthToken(token: string | null) {
  authToken = token;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

function authHeaders(base: Record<string, string> = {}): Record<string, string> {
  return authToken ? { ...base, Authorization: `Bearer ${authToken}` } : base;
}

/** Decode the current token's payload and return it only if unexpired. Used to
 * restore a session across reloads without forcing re-login. The server still
 * cryptographically verifies the token on every request. */
export function getTokenSession(): { role: string; name: string; assignedBranchId?: string; userId?: string; exp: number } | null {
  if (!authToken) return null;
  try {
    const payload = authToken.split('.')[0];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const data = JSON.parse(json);
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

// Invoked when the server rejects auth (401) — lets the app force re-login.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    setAuthToken(null);
    onUnauthorized?.();
  }
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      // Prefer the human-readable message; fall back to the error code.
      detail = body?.message ? `: ${body.message}` : body?.error ? `: ${body.error}` : '';
    } catch {
      /* ignore parse errors */
    }
    throw new Error(`API ${res.status} ${res.statusText}${detail}`);
  }
  return res.json() as Promise<T>;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  return handle<T>(res);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handle<T>(res);
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handle<T>(res);
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE', headers: authHeaders() });
  return handle<T>(res);
}

export { API_BASE };
