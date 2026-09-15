import { Invoice, Estimate } from '../types';

/**
 * Local, per-user draft store for in-progress Sales / Quotations.
 *
 * Drafts are work-in-progress documents the user parks before finalizing.
 * They are intentionally NOT shared ERP data (never committed to stock or the
 * ledger until saved for real), so they live in browser localStorage scoped to
 * the current user — like an unsent email draft. Reads/writes are guarded so a
 * private window or blocked storage degrades gracefully.
 */

export interface SalesDraft {
  draftId: string;
  kind: 'Invoice' | 'Quotation';
  savedAt: string; // ISO timestamp
  customerName: string;
  number: string; // provisional invoice/estimate number
  grandTotal: number;
  branchId: string;
  /** The assembled document, reloadable into the form as an edit source. */
  data: Invoice | Estimate;
}

const KEY_PREFIX = 'majestronicz.salesDrafts.v1';

function keyFor(userId: string): string {
  return `${KEY_PREFIX}.${userId || 'default'}`;
}

export function loadDrafts(userId: string): SalesDraft[] {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as SalesDraft[];
  } catch {
    return [];
  }
}

function persist(userId: string, drafts: SalesDraft[]): void {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(drafts));
  } catch {
    /* storage unavailable — draft simply won't persist this session */
  }
}

/** Insert or replace a draft (by draftId), newest first. Returns the new list. */
export function upsertDraft(userId: string, draft: SalesDraft): SalesDraft[] {
  const existing = loadDrafts(userId).filter((d) => d.draftId !== draft.draftId);
  const next = [draft, ...existing];
  persist(userId, next);
  return next;
}

export function deleteDraft(userId: string, draftId: string): SalesDraft[] {
  const next = loadDrafts(userId).filter((d) => d.draftId !== draftId);
  persist(userId, next);
  return next;
}

export function newDraftId(): string {
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
