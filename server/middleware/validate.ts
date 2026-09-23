import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';
import { AppError } from '../utils/errors';

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return next(new AppError(400, 'invalid request body', 'validation_error'));
    }
    req.body = parsed.data;
    next();
  };
}
