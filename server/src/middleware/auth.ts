import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import db from '../db';
import { getJwtSecret } from '../lib/secrets';

export interface AuthRequest extends Request {
  user?: {
    id: number;
    email: string;
    role: string;
    employee_id?: string;
    must_change_password?: boolean;
  };
}

interface UserState {
  email: string;
  role: string;
  employee_id?: string;
  is_active: boolean;
  must_change_password: boolean;
  password_changed_at: number | null;
}

// Role, deactivation and password changes take effect within this window without a DB hit per request.
const USER_STATE_TTL_MS = 30_000;
const userStateCache = new Map<number, { state: UserState | null; fetchedAt: number }>();

export const invalidateUserCache = (userId?: number) => {
  if (userId === undefined) userStateCache.clear();
  else userStateCache.delete(userId);
};

async function loadUserState(userId: number): Promise<UserState | null> {
  const cached = userStateCache.get(userId);
  if (cached && Date.now() - cached.fetchedAt < USER_STATE_TTL_MS) return cached.state;

  const row = await db('users')
    .where({ id: userId })
    .first('email', 'role', 'employee_id', 'is_active', 'must_change_password', 'password_changed_at');
  const state: UserState | null = row
    ? {
        email: row.email,
        role: row.role,
        employee_id: row.employee_id || undefined,
        is_active: row.is_active !== false,
        must_change_password: !!row.must_change_password,
        password_changed_at: row.password_changed_at ? new Date(row.password_changed_at).getTime() : null,
      }
    : null;
  userStateCache.set(userId, { state, fetchedAt: Date.now() });
  return state;
}

// Every auth failure carries a `code` so the client can tell "log in again" apart from other 401/403s.
export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: 'Please log in to continue.', code: 'NO_TOKEN' });

  let payload: any;
  try {
    payload = jwt.verify(token, getJwtSecret());
  } catch (err) {
    const expired = err instanceof jwt.TokenExpiredError;
    return res.status(401).json({
      message: expired ? 'Your session has expired. Please log in again.' : 'Your session is invalid. Please log in again.',
      code: expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
    });
  }

  let state: UserState | null | undefined;
  try {
    state = await loadUserState(Number(payload.id));
  } catch (error) {
    console.error('authenticateToken: could not load user state, falling back to token claims', error);
  }

  if (state === null) {
    return res.status(401).json({ message: 'This account no longer exists.', code: 'TOKEN_INVALID' });
  }

  if (state) {
    if (!state.is_active) {
      return res.status(401).json({ message: 'This account has been deactivated. Contact an administrator.', code: 'ACCOUNT_DISABLED' });
    }
    if (state.password_changed_at && payload.iat && payload.iat < Math.floor(state.password_changed_at / 1000)) {
      return res.status(401).json({ message: 'Your password was changed. Please log in again.', code: 'SESSION_REVOKED' });
    }
    req.user = {
      id: Number(payload.id),
      email: state.email,
      role: state.role,
      employee_id: state.employee_id,
      must_change_password: state.must_change_password,
    };
    if (state.must_change_password && !req.originalUrl.startsWith('/api/auth/')) {
      return res.status(403).json({ message: 'You must change your password before continuing.', code: 'PASSWORD_CHANGE_REQUIRED' });
    }
  } else {
    req.user = { id: Number(payload.id), email: payload.email, role: payload.role, employee_id: payload.employee_id };
  }

  next();
};

export const authorizeRole = (roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
    }
    next();
  };
};
