import type { Request, RequestHandler, Response } from 'express';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { Role } from '@mathsuivi/shared';
import type { AppDeps } from '../../deps.js';
import { authSessions, users } from '../../db/schema.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { forbidden, unauthorized } from '../../lib/http.js';

export const SESSION_COOKIE = 'ms_session';
const LAST_SEEN_REFRESH_MS = 5 * 60 * 1000;

export async function startSession({ db, env }: AppDeps, res: Response, userId: string) {
  const token = randomToken();
  const ttlMs = env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
  await db.insert(authSessions).values({
    userId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + ttlMs),
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.COOKIE_SECURE,
    maxAge: ttlMs,
    path: '/',
  });
}

export async function endSession({ db, env }: AppDeps, req: Request, res: Response) {
  if (req.sessionId) await db.delete(authSessions).where(eq(authSessions.id, req.sessionId));
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: env.COOKIE_SECURE, path: '/' });
}

/** Charge l'utilisateur connecté (si cookie valide) dans req.user. */
export function loadSession({ db }: AppDeps): RequestHandler {
  return async (req, _res, next) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || token.length > 100) return next();

    const now = new Date();
    const [row] = await db
      .select({ sessionId: authSessions.id, user: users })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .where(and(eq(authSessions.tokenHash, sha256(token)), gt(authSessions.expiresAt, now)))
      .limit(1);
    if (!row) return next();

    req.user = row.user;
    req.sessionId = row.sessionId;
    if (!row.user.lastSeenAt || now.getTime() - row.user.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS) {
      await db.update(users).set({ lastSeenAt: now }).where(eq(users.id, row.user.id));
    }
    next();
  };
}

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (roles.length && !roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

export async function purgeExpiredSessions({ db }: AppDeps) {
  await db.delete(authSessions).where(lt(authSessions.expiresAt, new Date()));
}
