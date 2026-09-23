import type { Request } from 'express';

export function param(req: Request, key = 'id'): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : String(v);
}
