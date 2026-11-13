import type { SessionResponse, SessionUser } from '@zuvo/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { registerAuthModels } from '../db/auth-models.ts';
import { AppError } from '../lib/errors.ts';
import { loadUser, toSessionUser, type UserDoc } from '../users/user-record.ts';
import { CLIENT_IP_HEADER, COOKIE_PREFIX } from './auth.ts';

export interface AuthSessionRecord {
  id: string;
  token: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface RequestAuth {
  session: AuthSessionRecord;
  user: SessionUser;
  record: UserDoc;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireSession`. */
    auth: RequestAuth | null;
  }
}

/** "Last active" is written at most this often per session — and never moves the expiry. */
export const ACTIVITY_THROTTLE_SECONDS = 5 * 60;

export function toSessionResponse(session: AuthSessionRecord, user: UserDoc): SessionResponse {
  const sessionUser = toSessionUser(user);
  return {
    user: sessionUser,
    session: {
      id: session.id,
      createdAt: new Date(session.createdAt).toISOString(),
      expiresAt: new Date(session.expiresAt).toISOString(),
    },
    needsProfile: !sessionUser.displayName || !sessionUser.username,
  };
}

/** Web Headers for Better Auth, with our proxy-aware client IP (client-sent values overwritten). */
export function toWebHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else headers.set(name, String(value));
  }
  headers.set(CLIENT_IP_HEADER, request.ip);
  return headers;
}

/** True when the request carries one of our session cookies (secure-prefixed or not). */
export function hasSessionCookie(request: FastifyRequest): boolean {
  return (request.headers.cookie ?? '').includes(`${COOKIE_PREFIX}.session_token=`);
}

/** Copies Set-Cookie headers from a Better Auth Response onto the Fastify reply. */
export function forwardCookies(response: Response, reply: FastifyReply): void {
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) reply.header('set-cookie', cookies);
}

/** Records activity at most once per 5 minutes (Redis lock, then MongoDB). Never extends expiry. */
export async function trackActivity(
  app: FastifyInstance,
  session: AuthSessionRecord,
): Promise<void> {
  if (!(await app.counterStore.setIfAbsent(`zuvo:active:${session.id}`, ACTIVITY_THROTTLE_SECONDS)))
    return;
  await registerAuthModels(app.mongo).AuthSession.updateOne(
    { token: session.token },
    { $set: { lastActiveAt: new Date() } },
  );
}

/**
 * Resolves the current session and a fresh user record, or throws 401:
 * SESSION_EXPIRED when a session cookie was sent but is no longer valid (expired or revoked),
 * UNAUTHENTICATED when there is no session at all.
 */
export async function resolveSession(request: FastifyRequest): Promise<RequestAuth> {
  const app = request.server;
  const result = await app.auth.api.getSession({ headers: toWebHeaders(request) });
  const record = result ? await loadUser(app, result.user.id) : null;
  if (!result || !record || record.status === 'deactivated') {
    throw hasSessionCookie(request)
      ? new AppError('SESSION_EXPIRED', 'Your session has ended. Please sign in again.')
      : new AppError('UNAUTHENTICATED', 'Please sign in.');
  }
  const session = result.session as AuthSessionRecord;
  void trackActivity(app, session).catch((error: unknown) =>
    request.log.warn({ err: error }, 'could not record session activity'),
  );
  return { session, user: toSessionUser(record), record };
}

/** preHandler: rejects unauthenticated requests and sets `request.auth`. */
export async function requireSession(request: FastifyRequest): Promise<void> {
  request.auth = await resolveSession(request);
}

/** preHandler: signed in AND admin. */
export async function requireAdmin(request: FastifyRequest): Promise<void> {
  await requireSession(request);
  if (request.auth?.user.role !== 'admin') {
    throw new AppError('FORBIDDEN', 'Only administrators can do this.');
  }
}

/** The signed-in user's id (after `requireSession`). */
export function currentUserId(request: FastifyRequest): string {
  if (!request.auth) throw new AppError('UNAUTHENTICATED', 'Please sign in.');
  return request.auth.user.id;
}
