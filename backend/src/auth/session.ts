import type { SessionResponse, SessionUser } from '@zuvo/protocol';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.ts';
import { CLIENT_IP_HEADER, COOKIE_PREFIX } from './auth.ts';

/** The user fields we read from Better Auth's user record (core + additional fields). */
export interface AuthUserRecord {
  id: string;
  email: string;
  createdAt: Date;
  displayName?: string | null;
  username?: string | null;
  avatarKey?: string | null;
  role?: string | null;
  status?: string | null;
}

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
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireSession`. */
    auth: RequestAuth | null;
  }
}

export function toSessionUser(user: AuthUserRecord): SessionUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName ?? null,
    username: user.username ?? null,
    avatarKey: user.avatarKey ?? null,
    role: user.role === 'admin' ? 'admin' : 'user',
    status: user.status === 'deactivated' ? 'deactivated' : 'active',
    createdAt: new Date(user.createdAt).toISOString(),
  };
}

export function toSessionResponse(
  session: AuthSessionRecord,
  user: AuthUserRecord,
): SessionResponse {
  const sessionUser = toSessionUser(user);
  return {
    user: sessionUser,
    session: {
      id: session.id,
      createdAt: new Date(session.createdAt).toISOString(),
      expiresAt: new Date(session.expiresAt).toISOString(),
    },
    needsProfile: !sessionUser.displayName,
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

/**
 * Resolves the current session and a fresh user record, or throws 401:
 * SESSION_EXPIRED when a session cookie was sent but is no longer valid (expired or revoked),
 * UNAUTHENTICATED when there is no session at all.
 */
export async function resolveSession(request: FastifyRequest): Promise<RequestAuth> {
  const { auth } = request.server;
  const result = await auth.api.getSession({ headers: toWebHeaders(request) });
  const context = await auth.$context;
  const user = result ? await context.internalAdapter.findUserById(result.user.id) : null;
  if (!result || !user || (user as AuthUserRecord).status === 'deactivated') {
    throw hasSessionCookie(request)
      ? new AppError('SESSION_EXPIRED', 'Your session has ended. Please sign in again.')
      : new AppError('UNAUTHENTICATED', 'Please sign in.');
  }
  const session = result.session as AuthSessionRecord;
  return { session, user: toSessionUser(user as AuthUserRecord) };
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
