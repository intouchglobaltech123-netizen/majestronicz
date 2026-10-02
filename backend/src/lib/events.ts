import { Request, Response } from 'express';

/**
 * Minimal Server-Sent Events hub for live cross-session sync. Whenever any
 * mutation commits, the server broadcasts a lightweight "changed" ping; every
 * connected client (all 5 roles) then refreshes so edits by one user appear
 * for the others within a fraction of a second.
 */
const clients = new Set<Response>();
/** SEC9-1: whose stream each one is, so signing out can close it. */
const owners = new Map<Response, string>();

export function broadcastChange(reason = 'mutation') {
  const payload = `data: ${JSON.stringify({ type: 'data-changed', reason, at: Date.now() })}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

export function sseHandler(req: Request, res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable proxy buffering
  (res as any).flushHeaders?.();
  res.write('retry: 3000\n\n'); // client auto-reconnect hint

  clients.add(res);
  const owner = (res.locals as any)?.userId;
  if (owner) owners.set(res, String(owner));

  // Keep-alive comment every 25s so proxies/browsers don't drop the stream.
  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* ignore */
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    clients.delete(res);
    owners.delete(res);
  });
}

/** SEC9-1: end every open live-updates stream of this user (on sign-out), so a
 *  stream opened before the sign-out stops receiving events at once. */
export function closeUserStreams(userId: string): number {
  let n = 0;
  for (const [res, owner] of owners) {
    if (owner !== userId) continue;
    clients.delete(res);
    owners.delete(res);
    try { res.end(); } catch { /* already closed */ }
    n++;
  }
  return n;
}

export const liveClientCount = () => clients.size;
