import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { usersRepo } from '../repositories/usersRepo';

export type AuthUser = {
  id: string;
  username: string;
  role: 'modify' | 'monitor';
  mustChangePassword: boolean;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const JWT_SECRET = () => process.env.JWT_SECRET || 'dev-jwt-secret-change-me';

export function signToken(user: AuthUser): string {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET(),
    { expiresIn: '7d' },
  );
}

export function authRequired(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const cookie = (req as Request & { cookies?: Record<string, string> }).cookies?.token;
  const raw = header?.startsWith('Bearer ') ? header.slice(7) : cookie;
  if (!raw) return res.status(401).json({ error: 'unauthorized' });
  try {
    const payload = jwt.verify(raw, JWT_SECRET()) as { id: string };
    const row = usersRepo.findById(payload.id);
    if (!row) return res.status(401).json({ error: 'unauthorized' });
    req.user = {
      id: row.id,
      username: row.username,
      role: row.role as 'modify' | 'monitor',
      mustChangePassword: Boolean(row.mustChangePassword),
    };
    next();
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
}

/** Blocks API use until the user changes the default/forced password. */
export function requirePasswordOk(req: Request, res: Response, next: NextFunction) {
  if (req.user?.mustChangePassword) {
    return res.status(403).json({
      error: 'password change required',
      code: 'password_change_required',
    });
  }
  next();
}

export function requireModify(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  if (req.user.role !== 'modify') return res.status(403).json({ error: 'forbidden' });
  next();
}
