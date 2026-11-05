import type { MyProfile, PrivacySettings, SessionResponse } from '@zuvo/protocol';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';

const SAVED_CHAT = {
  id: 'c-saved',
  type: 'self',
  seq: 0,
  otherUser: null,
  lastMessage: null,
  lastReadSeq: 0,
  unreadCount: 0,
  peerDeliveredSeq: 0,
  peerReadSeq: 0,
  lastActivityAt: '2026-11-01T10:00:00.000Z',
  createdAt: '2026-11-01T10:00:00.000Z',
};

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
      username: 'kiran',
      about: "Hey there! I'm using Zuvo",
      avatar: null,
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

/** The signed-in user's own profile (matches sessionFixture). */
export function profileFixture(overrides: Partial<MyProfile> = {}): MyProfile {
  const { user } = sessionFixture();
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    username: user.username,
    usernameChangedAt: null,
    about: user.about,
    avatar: null,
    role: user.role,
    status: user.status,
    ...overrides,
  };
}

export const privacyFixture: PrivacySettings = {
  lastSeen: 'everyone',
  profilePhoto: 'everyone',
  about: 'everyone',
  readReceipts: true,
};

/** Username availability: "taken" is taken; everything that passes the rules is free. */
const availability = http.get('*/v1/users/username-availability', ({ request }) => {
  const username = new URL(request.url).searchParams.get('username') ?? '';
  const taken = username === 'taken';
  return HttpResponse.json({ username, available: !taken, reason: taken ? 'taken' : null });
});

/** Default handlers: the API is healthy and the user is signed in. Tests override with `server.use(...)`. */
export const server = setupServer(
  http.get('*/v1/health', healthyResponse),
  http.get('*/v1/auth/me', () => HttpResponse.json(sessionFixture())),
  http.get('*/v1/me/profile', () => HttpResponse.json({ profile: profileFixture() })),
  http.get('*/v1/me/username-suggestion', () => HttpResponse.json({ username: 'kiran' })),
  http.get('*/v1/me/privacy', () => HttpResponse.json({ privacy: privacyFixture })),
  http.get('*/v1/users/search', () => HttpResponse.json({ items: [], nextCursor: null })),
  availability,
  // A new device with no chats yet; only Saved Messages exists.
  http.get('*/v1/sync', ({ request }) => {
    const since = new URL(request.url).searchParams.get('since');
    return HttpResponse.json({
      cursor: since ?? '0',
      reset: since === null,
      hasMore: false,
      chats: [],
      messages: [],
    });
  }),
  http.get('*/v1/chats', () => HttpResponse.json({ items: [SAVED_CHAT], nextCursor: null })),
  http.get('*/v1/chats/self', () => HttpResponse.json({ chat: SAVED_CHAT })),
);

export { HttpResponse, http };
