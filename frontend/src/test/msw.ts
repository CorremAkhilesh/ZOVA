import type { SessionResponse } from '@zuvo/protocol';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';

export const healthyResponse = () =>
  HttpResponse.json({
    status: 'ok',
    version: '0.0.0',
    uptime: 1,
    timestamp: new Date().toISOString(),
  });

/** A signed-in user with a display name; `overrides` adjust it per test. */
export function sessionFixture(overrides: Partial<SessionResponse> = {}): SessionResponse {
  const now = Date.now();
  return {
    user: {
      id: 'u-test',
      email: 'kiran@corremadvisory.com',
      displayName: 'Kiran Rao',
      username: null,
      avatarKey: null,
      role: 'user',
      status: 'active',
      createdAt: new Date(now - 86_400_000).toISOString(),
    },
    session: {
      id: 's-test',
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 7 * 86_400_000).toISOString(),
    },
    needsProfile: false,
    ...overrides,
  };
}

export const signedOut = (code = 'UNAUTHENTICATED') =>
  http.get('*/v1/auth/me', () =>
    HttpResponse.json({ code, message: 'Please sign in.', requestId: 'r' }, { status: 401 }),
  );

/** Default handlers: the API is healthy and the user is signed in. Tests override with `server.use(...)`. */
export const server = setupServer(
  http.get('*/v1/health', healthyResponse),
  http.get('*/v1/auth/me', () => HttpResponse.json(sessionFixture())),
);

export { HttpResponse, http };
