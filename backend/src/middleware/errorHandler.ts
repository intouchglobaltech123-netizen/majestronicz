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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  // Prisma unique-constraint violation
  if (err?.code === 'P2002') {
    return res.status(409).json({ error: 'UNIQUE_CONFLICT', message: err.meta?.target });
  }
  console.error(err);
  // Don't leak internal error detail to clients in production.
  const message = process.env.NODE_ENV === 'production' ? 'Something went wrong. Please try again.' : (err?.message ?? 'Internal error');
  return res.status(500).json({ error: 'INTERNAL', message });
}
