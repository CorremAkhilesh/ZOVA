import { screen, waitFor } from '@testing-library/react';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { chatFixture, personFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server, sessionFixture, signedOut } from '@/test/msw';
import { MOBILE_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { useAuthFlow } from './flow-store';
import { sessionQuery, sessionSnapshot } from './session';

/** GET /v1/auth/me that answers only when the test says so. */
function slowMe(answer: () => Response) {
  let release: () => void = () => undefined;
  const answered = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.get('*/v1/auth/me', async () => {
      await answered;
      return answer();
    }),
  );
  return release;
}

let releaseMe: () => void = () => undefined;

afterEach(() => {
  releaseMe();
  useAuthFlow.setState({ signedOutReason: null });
});

const localDatabases = async () =>
  (await Dexie.getDatabaseNames()).filter((name) => name.startsWith('zuvo-'));

describe('returning user: the stored session opens the app at once', () => {
  it('shows the chats stored on the device before the server has answered', async () => {
    sessionSnapshot.save(sessionFixture());
    await seedLocal([chatFixture({ otherUser: personFixture({ displayName: 'Meera Iyer' }) })]);
    releaseMe = slowMe(() => HttpResponse.json(sessionFixture()));

    const { router, queryClient } = await renderApp('/chats', { width: MOBILE_WIDTH });
    expect(router.state.location.pathname).toBe('/chats');
    expect(await screen.findByText('Meera Iyer')).toBeInTheDocument();
    // Still waiting for the server: the snapshot is standing in.
    expect(queryClient.getQueryData(sessionQuery.queryKey)).toMatchObject({ unverified: true });

    releaseMe();
    await waitFor(() =>
      expect(queryClient.getQueryData(sessionQuery.queryKey)).toEqual({
        status: 'signed-in',
        data: expect.objectContaining({ user: expect.objectContaining({ id: 'u-test' }) }),
      }),
    );
    expect(router.state.location.pathname).toBe('/chats');
  });

  it('signs out and wipes the device when the background check says the session ended', async () => {
    sessionSnapshot.save(sessionFixture());
    await seedLocal([chatFixture()]);
    releaseMe = slowMe(() =>
      HttpResponse.json(
        { code: 'SESSION_EXPIRED', message: 'Please sign in.', requestId: 'r' },
        { status: 401 },
      ),
    );

    const { router } = await renderApp('/chats', { width: MOBILE_WIDTH });
    expect(router.state.location.pathname).toBe('/chats');

    releaseMe();
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(
      await screen.findByText('Your session ended. Sign in again to continue.'),
    ).toBeInTheDocument();
    expect(sessionSnapshot.load()).toBeNull();
    await waitFor(async () => expect(await localDatabases()).toEqual([]));
  });

  it('signs out a revoked or deactivated session too, without the "ended" message', async () => {
    sessionSnapshot.save(sessionFixture());
    server.use(signedOut());
    const { router } = await renderApp('/chats', { width: MOBILE_WIDTH });
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(screen.queryByText(/Your session ended/)).not.toBeInTheDocument();
    expect(sessionSnapshot.load()).toBeNull();
  });

  it('ignores an expired snapshot and waits for the server', async () => {
    sessionSnapshot.save(
      sessionFixture({
        session: { ...sessionFixture().session, expiresAt: new Date(Date.now() - 1).toISOString() },
      }),
    );
    server.use(signedOut());
    const { router } = await renderApp('/chats', { width: MOBILE_WIDTH });
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});
