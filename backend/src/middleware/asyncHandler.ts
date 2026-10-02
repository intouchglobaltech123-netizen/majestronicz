import { Request, Response, NextFunction, RequestHandler } from 'express';
import { broadcastChange } from '../lib/events.js';

/**
 * Wraps an async controller so thrown/rejected errors flow to the error
 * middleware. After a successful mutating request (non-GET), broadcasts a live
 * "data-changed" event so every connected session refreshes immediately.
 */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next))
      .then(() => {
        // SAL10-1: a handler that knows exactly what it changed sets
        // res.locals.changes; one that already broadcast sets res.locals.broadcast.
        if (req.method !== 'GET' && res.statusCode < 400 && !res.locals.broadcast) broadcastChange(`${req.method} ${req.path}`, res.locals.changes);
      })
      .catch(next);
  };
