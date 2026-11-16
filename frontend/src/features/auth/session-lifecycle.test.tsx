import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpResponse, http, server, sessionFixture, signedOut } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { fakeSockets, lastSocket } from '@/test/socket-mock';
import { useAuthFlow } from './flow-store';
import { sessionQuery, sessionSnapshot } from './session';

afterEach(() => {
  useAuthFlow.setState({ pendingEmail: '', resendAvailableAt: 0, signedOutReason: null });
});

const meReturns = (overrides: Parameters<typeof sessionFixture>[0]) =>
  http.get('*/v1/auth/me', () => HttpResponse.json(sessionFixture(overrides)));

describe('route guards', () => {
  it('sends signed-out visitors from the app to the welcome screen', async () => {
    server.use(signedOut());
    const { router } = await renderApp('/chats');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('sends signed-in users from the welcome screen to the chats', async () => {
    const { router } = await renderApp('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats'));
  });

  it('sends first-time users to the name step until they pick a name', async () => {
    server.use(meReturns({ needsProfile: true }));
    const { router } = await renderApp('/settings');
    await waitFor(() => expect(router.state.location.pathname).toBe('/welcome/name'));
  });

  it('keeps users with a name out of the name step', async () => {
    const { router } = await renderApp('/welcome/name');
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats'));
  });

  it('needs an email before the code step', async () => {
    server.use(signedOut());
    const { router } = await renderApp('/verify');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('remembers an expired session for the welcome message', async () => {
    server.use(signedOut('SESSION_EXPIRED'));
    await renderApp('/chats');
    expect(
      await screen.findByText('Your session ended. Sign in again to continue.'),
    ).toBeInTheDocument();
  });

  it('opens offline from the last known session when the server is unreachable', async () => {
    sessionSnapshot.save(sessionFixture());
    server.use(http.get('*/v1/auth/me', () => HttpResponse.error()));
    const { router } = await renderApp('/chats');
    expect(router.state.location.pathname).toBe('/chats');
    expect(screen.getByRole('heading', { name: 'Chats' })).toBeInTheDocument();
  });
});

describe('session expiry', () => {
  it('warns during the last 24 hours', async () => {
    server.use(
      meReturns({
        session: {
          ...sessionFixture().session,
          expiresAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
        },
      }),
    );
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    expect(
      screen.getByText('Your session ends tomorrow — sign in again to continue.'),
    ).toBeInTheDocument();
  });

  it('does not warn earlier', async () => {
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    expect(screen.queryByText(/session ends tomorrow/)).not.toBeInTheDocument();
  });

  it('returns to the welcome screen when the session expires while open', async () => {
    server.use(
      meReturns({
        session: {
          ...sessionFixture().session,
          expiresAt: new Date(Date.now() + 300).toISOString(),
        },
      }),
    );
    const { router } = await renderApp('/chats', { width: DESKTOP_WIDTH });
    await waitFor(() => expect(router.state.location.pathname).toBe('/'), { timeout: 3000 });
    expect(screen.getByText('Your session ended. Sign in again to continue.')).toBeInTheDocument();
  });

  it('returns to the welcome screen when the server revokes the session', async () => {
    const { router, queryClient } = await renderApp('/chats', { width: DESKTOP_WIDTH });
    server.use(signedOut('SESSION_EXPIRED'));
    await act(() => queryClient.refetchQueries({ queryKey: sessionQuery.queryKey }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(screen.getByText('Your session ended. Sign in again to continue.')).toBeInTheDocument();
  });
});

describe('account settings', () => {
  it('shows the user, the session end and signs out', async () => {
    let loggedOut = false;
    server.use(
      http.post('*/v1/auth/logout', () => {
        loggedOut = true;
        return HttpResponse.json({ status: 'signed_out' });
      }),
      // Signed out only once the logout call came: a session refetch before the click must not
      // sign the app out by itself (then the click would never reach the server).
      http.get('*/v1/auth/me', () =>
        loggedOut
          ? HttpResponse.json(
              { code: 'UNAUTHENTICATED', message: 'Please sign in.', requestId: 'r' },
              { status: 401 },
            )
          : HttpResponse.json(sessionFixture()),
      ),
    );
    const user = userEvent.setup();
    const { router } = await renderApp('/settings', { width: DESKTOP_WIDTH });
    expect(screen.getByText('kiran@corremadvisory.com')).toBeInTheDocument();
    expect(screen.getByText('Session ends')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Account settings for Kiran Rao' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(loggedOut).toBe(true);
    expect(
      screen.queryByText('Your session ended. Sign in again to continue.'),
    ).not.toBeInTheDocument();
  });
});

describe('session push over the socket', () => {
  it('returns to the welcome screen at once when the server revokes the session', async () => {
    const { router } = await renderApp('/chats');
    await waitFor(() => expect(fakeSockets.length).toBeGreaterThan(0));
    act(() => lastSocket().receive('session:revoked', { reason: 'revoked' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(useAuthFlow.getState().signedOutReason).toBeNull();
  });

  it('says the session ended when it expired', async () => {
    const { router } = await renderApp('/chats');
    await waitFor(() => expect(fakeSockets.length).toBeGreaterThan(0));
    act(() => lastSocket().receive('session:revoked', { reason: 'expired' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(useAuthFlow.getState().signedOutReason).toBe('expired');
  });

  it('asks the API when a reconnect is refused, and closes the socket on leaving', async () => {
    let calls = 0;
    server.use(
      http.get('*/v1/auth/me', () => {
        calls += 1;
        return calls > 1
          ? HttpResponse.json(
              { code: 'SESSION_EXPIRED', message: 'x', requestId: 'r' },
              { status: 401 },
            )
          : HttpResponse.json(sessionFixture());
      }),
    );
    const { router } = await renderApp('/chats');
    await waitFor(() => expect(fakeSockets.length).toBeGreaterThan(0));
    const socket = lastSocket();
    act(() => socket.receive('connect_error'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await waitFor(() => expect(socket.disconnected).toBe(true));
  });
});
