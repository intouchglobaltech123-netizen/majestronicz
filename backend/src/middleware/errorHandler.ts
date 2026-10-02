import { Request, Response, NextFunction } from 'express';

/** Domain error carrying an HTTP status + stable code the frontend can switch on. */
export class AppError extends Error {
  status: number;
  code: string;
  constructor(code: string, message?: string, status = 400) {
    super(message ?? code);
    this.code = code;
    this.status = status;
  }
}

// Prisma request errors caused by the client's values (too long, wrong type,
// invalid id, out of range) rather than by the server.
const PRISMA_BAD_INPUT = new Set(['P2000', 'P2005', 'P2006', 'P2007', 'P2009', 'P2019', 'P2020', 'P2023']);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  // Prisma unique-constraint violation
  if (err?.code === 'P2002') {
    return res.status(409).json({ error: 'UNIQUE_CONFLICT', message: 'A record with that unique value already exists.' });
  }
  // Prisma: record to update/delete not found → 404 (not 500).
  if (err?.code === 'P2025') {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Record not found.' });
  }
  // Prisma: foreign-key / relation constraint.
  if (err?.code === 'P2003') {
    return res.status(409).json({ error: 'RELATION_CONFLICT', message: 'This record is referenced by other data.' });
  }
  // Prisma: a required field was null / missing on write — a data problem, not a
  // server crash, so surface it clearly instead of an opaque 500.
  if (err?.code === 'P2011' || err?.code === 'P2012' || err?.code === 'P2013') {
    console.error(err);
    return res.status(400).json({ error: 'MISSING_FIELD', message: 'A required value was missing. Please retry with all fields filled.' });
  }
  // Prisma rejected the shape/type of the data (a wrong type, an unknown field,
  // a value out of range). That is a bad request, not a server crash — and its
  // message quotes the query, so never send it to the client (ERR-1 / INV4-6).
  if (err?.name === 'PrismaClientValidationError' || PRISMA_BAD_INPUT.has(err?.code)) {
    console.error(err);
    return res.status(400).json({ error: 'BAD_REQUEST', message: 'Some of the values sent are not valid. Please check the form and try again.' });
  }
  // Malformed JSON body / body too large (body-parser errors carry a status).
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'BAD_JSON', message: 'The request body is not valid JSON.' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'TOO_LARGE', message: 'The request is too large.' });
  }
  console.error(err);
  // Don't leak internal error detail to clients in production.
  const message = process.env.NODE_ENV === 'production' ? 'Something went wrong. Please try again.' : (err?.message ?? 'Internal error');
  return res.status(500).json({ error: 'INTERNAL', message });
}
