import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DeviceSession } from '@zuvo/protocol';
import { describe, expect, it } from 'vitest';
import { axe } from '@/test/axe';
import { HttpResponse, http, server, sessionFixture } from '@/test/msw';
import { renderApp } from '@/test/render-app';

const now = Date.now();
const device = (id: string, overrides: Partial<DeviceSession> = {}): DeviceSession => ({
  id,
  current: false,
  browser: 'Firefox 140',
  os: 'Windows 11',
  deviceType: 'desktop',
  ipAddress: '103.201.140.•••',
  createdAt: new Date(now - 3_600_000).toISOString(),
  lastActiveAt: new Date(now - 60_000).toISOString(),
  expiresAt: new Date(now + 6 * 86_400_000).toISOString(),
  ...overrides,
});

describe('Settings → Devices', () => {
  it('lists sessions with this device marked, signs out one and all others', async () => {
    const user = userEvent.setup();
    let sessions = [
      device('s1', { current: true, browser: 'Chrome 141' }),
      device('s2'),
      device('s3', { deviceType: 'mobile', browser: 'Safari 18', os: 'iOS 18' }),
    ];
    server.use(
      http.get('*/v1/me/sessions', () => HttpResponse.json({ sessions })),
      http.delete('*/v1/me/sessions/:id', ({ params }) => {
        sessions = sessions.filter((s) => s.id !== params.id);
        return HttpResponse.json({ revoked: 1 });
      }),
      http.post('*/v1/me/sessions/revoke-others', () => {
        const revoked = sessions.filter((s) => !s.current).length;
        sessions = sessions.filter((s) => s.current);
        return HttpResponse.json({ revoked });
      }),
    );
    const { container } = await renderApp('/settings/devices');
    expect(await screen.findByText('This device')).toBeInTheDocument();
    expect(screen.getAllByText('103.201.140.•••')).toHaveLength(3);
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole('button', { name: 'Sign out Firefox 140 · Windows 11' }));
    await waitFor(() =>
      expect(screen.queryByText('Firefox 140 · Windows 11')).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: 'Sign out all other devices' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('1 other device will be signed out.');
    await user.click(within(dialog).getByRole('button', { name: 'Sign out all other devices' }));
    expect(await screen.findByText('You’re only signed in on this device.')).toBeInTheDocument();
  });

  it('shows loading and error states', async () => {
    server.use(http.get('*/v1/me/sessions', () => HttpResponse.json({}, { status: 500 })));
    await renderApp('/settings/devices');
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load your devices.');
  });
});

const adminSession = () => {
  const base = sessionFixture();
  return { ...base, user: { ...base.user, role: 'admin' as const } };
};

describe('Admin screens', () => {
  it('are hidden from and closed to non-admins', async () => {
    const { router } = await renderApp('/settings/admin/users');
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
    expect(screen.queryByRole('link', { name: /Users/ })).not.toBeInTheDocument();
  });

  it('lists users, searches, and deactivates after confirmation', async () => {
    const user = userEvent.setup();
    let status: 'active' | 'deactivated' = 'active';
    const queries: string[] = [];
    const meera = () => ({
      id: 'u-meera',
      email: 'meera@corremadvisory.com',
      displayName: 'Meera Nair',
      username: 'meera',
      role: 'user',
      status,
      lastLoginAt: null,
      createdAt: new Date(now).toISOString(),
    });
    server.use(
      http.get('*/v1/auth/me', () => HttpResponse.json(adminSession())),
      http.get('*/v1/admin/users', ({ request }) => {
        queries.push(new URL(request.url).searchParams.get('q') ?? '');
        return HttpResponse.json({ items: [meera()], nextCursor: null });
      }),
      http.post('*/v1/admin/users/:id/deactivate', () => {
        status = 'deactivated';
        return HttpResponse.json({
          user: { id: 'u-meera', email: 'meera@corremadvisory.com', status },
          revokedSessions: 2,
        });
      }),
    );
    const { container } = await renderApp('/settings/admin/users');
    expect(await screen.findByText('Meera Nair')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await user.type(screen.getByRole('searchbox', { name: /Search by name/ }), 'mee');
    await waitFor(() => expect(queries).toContain('mee'));

    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Deactivate Meera Nair?' });
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByText('Deactivated')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
  });

  it('shows the audit log (and its empty state)', async () => {
    server.use(
      http.get('*/v1/auth/me', () => HttpResponse.json(adminSession())),
      http.get('*/v1/admin/audit-log', () =>
        HttpResponse.json({
          items: [
            {
              id: 'a1',
              action: 'user.deactivate',
              actor: { id: 'u-test', email: 'kiran@corremadvisory.com' },
              target: { id: 'u-meera', email: 'meera@corremadvisory.com' },
              ipAddress: '127.0.0.1',
              at: new Date(now).toISOString(),
            },
          ],
          nextCursor: null,
        }),
      ),
    );
    const { container } = await renderApp('/settings/admin/audit');
    expect(
      await screen.findByText('kiran@corremadvisory.com deactivated meera@corremadvisory.com'),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    server.use(
      http.get('*/v1/admin/audit-log', () => HttpResponse.json({ items: [], nextCursor: null })),
    );
    await renderApp('/settings/admin/audit');
    expect(await screen.findByText('No admin actions yet.')).toBeInTheDocument();
  });

  it('links admins to the admin screens from Settings', async () => {
    server.use(http.get('*/v1/auth/me', () => HttpResponse.json(adminSession())));
    await renderApp('/settings');
    expect(screen.getByRole('navigation', { name: 'Administration' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Audit log/ })).toHaveAttribute(
      'href',
      '/settings/admin/audit',
    );
  });
});

describe('"This wasn’t me" page', () => {
  async function open(hash: string) {
    window.history.replaceState(null, '', `/security/not-me${hash}`);
    return renderApp(`/security/not-me${hash}`);
  }

  it('signs out everywhere once and removes the token from the address bar (axe clean)', async () => {
    const tokens: string[] = [];
    server.use(
      http.post('*/v1/auth/not-me', async ({ request }) => {
        tokens.push(((await request.json()) as { token: string }).token);
        return HttpResponse.json({ status: 'revoked', revokedSessions: 3 });
      }),
    );
    const { container } = await open('#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG');
    expect(await screen.findByText('All devices are signed out')).toBeInTheDocument();
    expect(screen.getByText(/3 sessions were ended/)).toBeInTheDocument();
    expect(tokens).toEqual(['abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG']);
    expect(window.location.hash).toBe('');
    expect(document.querySelector('meta[name="referrer"]')).toHaveAttribute(
      'content',
      'no-referrer',
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it.each([
    ['SECURITY_TOKEN_INVALID', 'already been used'],
    ['SECURITY_TOKEN_EXPIRED', 'has expired'],
  ])('explains %s', async (code, text) => {
    server.use(
      http.post('*/v1/auth/not-me', () =>
        HttpResponse.json({ code, message: code, requestId: 'r' }, { status: 400 }),
      ),
    );
    await open('#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG');
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });

  it('handles a link without a token', async () => {
    await open('');
    expect(await screen.findByRole('alert')).toHaveTextContent('This link is incomplete');
  });
});
