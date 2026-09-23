import type { Request, Response, NextFunction } from 'express';
import { AppError, clientError } from '../utils/errors';
import logger from '../utils/logger';

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (!(err instanceof AppError)) {
    logger.error('Unhandled API error', { err: err instanceof Error ? err.message : String(err) });
  }
  const { status, body } = clientError(err);
  res.status(status).json(body);
}
