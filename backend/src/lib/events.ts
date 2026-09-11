import { Request, Response } from 'express';

/**
 * Minimal Server-Sent Events hub for live cross-session sync. Whenever any
 * mutation commits, the server broadcasts a lightweight "changed" ping; every
 * connected client (all 5 roles) then refreshes so edits by one user appear
 * for the others within a fraction of a second.
 */
const clients = new Set<Response>();

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
  });
}

export const liveClientCount = () => clients.size;
