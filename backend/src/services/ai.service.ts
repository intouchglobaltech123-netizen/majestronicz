import { prisma } from '../db.js';

/**
 * Beta AI service — PRIVATE, self-hosted.
 *
 * Engine   : Ollama (https://ollama.com). Runs on YOUR own server — the business
 *            data (sales, cash, customers, stock) is sent only to your local Ollama
 *            process and NEVER to any third-party cloud. Free and unlimited.
 *            Local dev: http://localhost:11434. On Railway: run Ollama as a service
 *            and point OLLAMA_URL at it.
 * Model    : lightweight instruct model (default llama3.2 ~3B; use llama3.2:1b or
 *            qwen2.5:1.5b on very small instances). Set via OLLAMA_MODEL.
 * Data      : this file builds an EXACT, role-scoped snapshot from the DB. The model
 *            answers only from that snapshot, so figures are real — never invented.
 * Guardrail : business-only. Off-topic questions are politely declined.
 *
 * If Ollama is unreachable the feature degrades gracefully and reports how to start it.
 *
 * (An optional GROQ_API_KEY path exists for teams that explicitly opt into the cloud
 *  engine by setting AI_PROVIDER=groq — off by default; Ollama is the private default.)
 */

const PROVIDER = (process.env.AI_PROVIDER || 'ollama').toLowerCase();
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
const MAX_RATELIMIT_WAIT_MS = 60_000; // groq only: respect Retry-After up to ~1 min

export type AiStatus = {
  engine: string;
  model: string;
  connected: boolean;
  private: boolean;
  message: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Report whether the configured engine is reachable and ready. */
export async function getAiStatus(): Promise<AiStatus> {
  if (PROVIDER === 'groq') {
    const connected = !!process.env.GROQ_API_KEY;
    return {
      engine: 'groq',
      model: GROQ_MODEL,
      connected,
      private: false,
      message: connected
        ? `Cloud AI engine ready (${GROQ_MODEL}). Note: data is sent to Groq's servers.`
        : 'Cloud AI engine selected but GROQ_API_KEY is not set.',
    };
  }
  // Ollama (private, default): ping the tags endpoint and confirm the model is pulled.
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(String(res.status));
    const data: any = await res.json().catch(() => ({}));
    const models: string[] = (data?.models || []).map((m: any) => m?.name || '');
    const base = OLLAMA_MODEL.includes(':') ? OLLAMA_MODEL : `${OLLAMA_MODEL}:`;
    const hasModel = models.some((m) => m === OLLAMA_MODEL || m.startsWith(base));
    return {
      engine: 'ollama',
      model: OLLAMA_MODEL,
      connected: hasModel,
      private: true,
      message: hasModel
        ? `Private AI engine ready (${OLLAMA_MODEL}). Your data never leaves this server.`
        : `Ollama is running but the model "${OLLAMA_MODEL}" isn't installed. Run: ollama pull ${OLLAMA_MODEL}`,
    };
  } catch {
    return {
      engine: 'ollama',
      model: OLLAMA_MODEL,
      connected: false,
      private: true,
      message: `Private AI engine not reachable at ${OLLAMA_URL}. Install from ollama.com, then run "ollama serve" and "ollama pull ${OLLAMA_MODEL}".`,
    };
  }
}

const has = (flags: string[], f: string) => flags.includes(f);
const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const todayStr = () => new Date().toISOString().slice(0, 10);
const monthStr = () => new Date().toISOString().slice(0, 7);

/** Safely read an array off a JSON column. */
function asRows(json: unknown): any[] {
  if (Array.isArray(json)) return json as any[];
  return [];
}

/**
 * Build a compact, EXACT business snapshot from the DB, scoped by the role's
 * ai.data.* flags. Only domains the role is allowed to see are included.
 */
export async function buildContext(flags: string[]): Promise<string> {
  const today = todayStr();
  const month = monthStr();
  const parts: string[] = [];
  parts.push(`Reference date (today): ${today}. Current month: ${month}.`);

  // ---- SALES / INVOICES ----
  if (has(flags, 'ai.data.sales')) {
    const invoices = await prisma.invoice.findMany({
      where: { isVoided: { not: true }, transactionType: 'sale' },
      orderBy: { date: 'desc' },
      take: 400,
    });
    const todayInv = invoices.filter((i) => i.date === today);
    const monthInv = invoices.filter((i) => (i.date || '').startsWith(month));
    const sum = (arr: typeof invoices) => arr.reduce((t, i) => t + (i.grandTotal || 0), 0);
    const byMode: Record<string, number> = {};
    for (const i of todayInv) byMode[i.paymentMode || 'unknown'] = (byMode[i.paymentMode || 'unknown'] || 0) + (i.grandTotal || 0);
    const recent = invoices.slice(0, 8).map(
      (i) => `  ${i.invoiceNumber} | ${i.date} | ${i.customerName} | ${money(i.grandTotal || 0)} | ${i.paymentMode}`
    );
    parts.push(
      [
        'SALES:',
        `  Today: ${todayInv.length} invoices, total ${money(sum(todayInv))}.`,
        `  Payment split today: ${Object.entries(byMode).map(([m, v]) => `${m} ${money(v)}`).join(', ') || 'none'}.`,
        `  This month: ${monthInv.length} invoices, total ${money(sum(monthInv))}.`,
        '  Recent invoices (number | date | customer | total | mode):',
        ...recent,
      ].join('\n')
    );
  }

  // ---- CASH REGISTER ----
  if (has(flags, 'ai.data.cash')) {
    const regs = await prisma.dailyCashRegister.findMany({ orderBy: { date: 'desc' }, take: 30 });
    const lines: string[] = ['CASH REGISTER:'];
    const seen = new Set<string>();
    for (const r of regs) {
      if (seen.has(r.branchId)) continue;
      seen.add(r.branchId);
      const expenses = asRows(r.expenses);
      const expTotal = expenses.reduce((t, e: any) => t + (Number(e?.amount) || 0), 0);
      lines.push(
        `  Branch ${r.branchId} (${r.date}): opening ${money(r.openingAmount || 0)}, ` +
          `expenses ${money(expTotal)} (${expenses.length} entries), ${r.isClosed ? 'CLOSED' : 'OPEN'}.`
      );
    }
    parts.push(lines.join('\n'));
  }

  // ---- PRODUCTS / ITEMS ----
  if (has(flags, 'ai.data.products')) {
    const items = await prisma.item.findMany({ take: 500 });
    const byCat: Record<string, number> = {};
    for (const it of items) byCat[it.category || 'Uncategorized'] = (byCat[it.category || 'Uncategorized'] || 0) + 1;
    const sample = items.slice(0, 30).map(
      (it) => `  ${it.itemName} [${it.itemCode}] | ${it.category} | sale ${money(it.salePrice || 0)} | GST ${it.gstTaxSlab}%`
    );
    parts.push(
      [
        `PRODUCTS: ${items.length} items total.`,
        `  By category: ${Object.entries(byCat).map(([c, n]) => `${c}: ${n}`).join(', ')}.`,
        '  Sample items (name [code] | category | sale price | GST):',
        ...sample,
      ].join('\n')
    );
  }

  // ---- INVENTORY / STOCK ----
  if (has(flags, 'ai.data.inventory')) {
    const stock = await prisma.branchStock.findMany({ take: 1000 });
    const items = await prisma.item.findMany({ take: 1000 });
    const nameOf = new Map(items.map((i) => [i.id, i.itemName]));
    const totalUnits = stock.reduce((t, s) => t + (s.quantity || 0), 0);
    const low = stock
      .filter((s) => s.minStockAlert != null && s.quantity <= (s.minStockAlert || 0))
      .slice(0, 20)
      .map((s) => `  ${nameOf.get(s.itemId) || s.itemId} @ ${s.branchId}: ${s.quantity} (alert ≤ ${s.minStockAlert})`);
    parts.push(
      [
        `INVENTORY: ${stock.length} stock rows, ${totalUnits} total units across branches.`,
        low.length ? '  Low / at-alert stock:' : '  No items at or below alert level.',
        ...low,
      ].join('\n')
    );
  }

  // ---- PURCHASE COST (sensitive; only with purchase scope) ----
  if (has(flags, 'ai.data.purchase')) {
    const pos = await prisma.purchaseOrder.findMany({ orderBy: { date: 'desc' }, take: 200 });
    const monthPos = pos.filter((p) => (p.date || '').startsWith(month));
    const pending = pos.filter((p) => p.status !== 'received' && p.status !== 'completed');
    const monthTotal = monthPos.reduce((t, p) => t + (p.totalAmount || 0), 0);
    const recent = pos.slice(0, 6).map((p) => `  ${p.poNumber} | ${p.date} | ${p.vendorName} | ${money(p.totalAmount || 0)} | ${p.status}`);
    parts.push(
      [
        `PURCHASES: ${pos.length} orders, ${pending.length} pending/open.`,
        `  This month: ${monthPos.length} POs, total ${money(monthTotal)}.`,
        '  Recent POs (number | date | vendor | total | status):',
        ...recent,
      ].join('\n')
    );
  }

  // ---- CUSTOMERS ----
  if (has(flags, 'ai.data.customers')) {
    const customers = await prisma.customer.findMany({ orderBy: { totalSpent: 'desc' }, take: 300 });
    const top = customers.slice(0, 10).map(
      (c) => `  ${c.name} (${c.phone}) | spent ${money(c.totalSpent || 0)} | ${c.purchaseCount} purchases`
    );
    parts.push(
      [
        `CUSTOMERS: ${customers.length} total.`,
        '  Top customers by spend (name (phone) | total spent | purchases):',
        ...top,
      ].join('\n')
    );
  }

  // ---- HRM / PAYROLL ----
  if (has(flags, 'ai.data.hrm')) {
    const emps = await prisma.employee.findMany({ take: 200 });
    const active = emps.filter((e) => e.status === 'active');
    const payroll = await prisma.payrollRecord.findMany({ where: { month }, take: 200 });
    const payTotal = payroll.reduce((t, p) => t + (p.finalPayable || 0), 0);
    parts.push(
      [
        `STAFF: ${emps.length} employees (${active.length} active).`,
        `  Payroll ${month}: ${payroll.length} records, total payable ${money(payTotal)}.`,
      ].join('\n')
    );
  }

  if (parts.length === 1) {
    parts.push('NOTE: This role has no data domains enabled for AI. You cannot answer data questions; tell the user their AI data access is restricted and to ask the CEO to enable domains.');
  }
  return parts.join('\n\n');
}

const SYSTEM_PROMPT = (context: string, role: string) => `You are "Beta AI", the private business assistant built into the Majestronicz ERP.

RULES:
1. Answer ONLY business questions about this shop (sales, cash, stock, products, purchases, customers, staff/payroll, and general business advice for this shop). If asked anything unrelated to the business (general knowledge, coding, personal, jokes, world facts, etc.), politely refuse: say you can only help with Majestronicz business matters.
2. Use ONLY the DATA SNAPSHOT below for figures. Never invent numbers. If the answer is not in the snapshot, say the data isn't available to you (it may be outside this user's access) and suggest what to check.
3. The user's role is "${role}". The snapshot already reflects exactly what this role is allowed to see — do not reveal or guess data outside it.
4. Understand messy phrasing and grammar mistakes charitably; figure out what the user means.
5. Be concise and clear. Use ₹ for money and short bullet points or a tiny table when helpful. Do not show internal IDs unless asked.

DATA SNAPSHOT (live from the database):
${context}`;

export type AskResult = { answer: string; degraded?: boolean; retryAfterSec?: number };

/** Answer a business question, scoped to the role's AI data flags. */
export async function askAi(question: string, flags: string[], role: string): Promise<AskResult> {
  const q = (question || '').trim();
  if (!q) return { answer: 'Please type a business question — e.g. "what are today\'s sales?" or "which items are low in stock?".' };

  let context: string;
  try {
    context = await buildContext(flags);
  } catch {
    return { degraded: true, answer: 'I could not read the business data right now. Please try again in a moment.' };
  }
  const system = SYSTEM_PROMPT(context, role);

  return PROVIDER === 'groq' ? askGroq(system, q) : askOllama(system, q);
}

// ---- Private engine: Ollama ----
async function askOllama(system: string, question: string): Promise<AskResult> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        options: { temperature: 0.2, num_predict: 700 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: question },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    return {
      degraded: true,
      answer: `The private AI engine isn't reachable at ${OLLAMA_URL}. Make sure Ollama is running ("ollama serve"). Your data stays on this server.`,
    };
  }

  if (res.status === 404) {
    return { degraded: true, answer: `The model "${OLLAMA_MODEL}" isn't installed yet. Run: ollama pull ${OLLAMA_MODEL}` };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { degraded: true, answer: `The AI engine returned an error (${res.status}). ${detail ? detail.slice(0, 160) : 'Please try again.'}`.trim() };
  }
  try {
    const data: any = await res.json();
    const answer = data?.message?.content?.trim();
    if (!answer) return { degraded: true, answer: 'The AI returned an empty response. Please rephrase and try again.' };
    return { answer };
  } catch {
    return { degraded: true, answer: 'I got an unreadable response from the AI engine. Please try again.' };
  }
}

// ---- Optional cloud engine: Groq (only when AI_PROVIDER=groq) ----
async function askGroq(system: string, question: string): Promise<AskResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { degraded: true, answer: 'Cloud AI engine selected but GROQ_API_KEY is not set.' };

  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: GROQ_MODEL,
          temperature: 0.2,
          max_tokens: 700,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: question },
          ],
        }),
      });
    } catch {
      return { degraded: true, answer: 'I could not reach the AI engine (network issue). Please try again shortly.' };
    }

    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after'));
      const waitMs = Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 20_000, MAX_RATELIMIT_WAIT_MS);
      if (attempt === 0) { await sleep(waitMs); continue; }
      return { degraded: true, retryAfterSec: Math.ceil(waitMs / 1000), answer: 'The AI is busy right now (rate limit). Please try again in about a minute.' };
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { degraded: true, answer: `The AI engine returned an error (${res.status}). ${detail ? detail.slice(0, 160) : ''}`.trim() };
    }
    try {
      const data: any = await res.json();
      const answer = data?.choices?.[0]?.message?.content?.trim();
      if (!answer) return { degraded: true, answer: 'The AI returned an empty response. Please rephrase and try again.' };
      return { answer };
    } catch {
      return { degraded: true, answer: 'I got an unreadable response from the AI engine. Please try again.' };
    }
  }
  return { degraded: true, answer: 'The AI is busy right now. Please try again in about a minute.' };
}
