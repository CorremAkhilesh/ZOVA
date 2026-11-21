import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminDashboard } from '@zuvo/protocol';
import { delay } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '@/test/axe';
import { HttpResponse, http, server, sessionFixture } from '@/test/msw';
import { DESKTOP_WIDTH, MOBILE_WIDTH, renderApp } from '@/test/render-app';
import { shortDate } from './components/BarChart';

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 15_000 };
const GB = 1024 ** 3;

const adminSession = () => {
  const base = sessionFixture();
  return { ...base, user: { ...base.user, role: 'admin' as const } };
};

const days = Array.from({ length: 30 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 9, 23 + index)).toISOString().slice(0, 10);
  return { date, activeUsers: index % 5, messages: index * 3, calls: index % 2 };
});

function dashboard(overrides: Partial<AdminDashboard> = {}): AdminDashboard {
  return {
    generatedAt: '2026-11-21T09:30:00.000Z',
    users: { total: 42, active: 40, deactivated: 2, admins: 3, activeToday: 17, active7d: 31 },
    today: { messages: 1234, calls: 9 },
    notifications: { usersWithPush: 30, percent: 75 },
    series: days,
    storage: {
      disk: { totalBytes: 1000 * GB, usedBytes: 862 * GB, percent: 86.2, guardPercent: 85 },
      filesBytes: 120 * GB,
      topUsers: [
        {
          id: 'u1',
          email: 'asha@corremadvisory.com',
          displayName: 'Asha Verma',
          username: 'asha',
          usedBytes: 2.9 * GB,
          quotaBytes: 3 * GB,
        },
      ],
    },
    health: {
      mongodb: 'ok',
      redis: 'ok',
      storage: 'ok',
      emailQueue: { status: 'ok', waiting: 0, failed: 2 },
    },
    build: { version: '0.19.0', commit: 'be97496', builtAt: '2026-11-21T08:00:00.000Z' },
    lastBackupAt: null,
    ...overrides,
  };
}

function serve(body: () => Response | Promise<Response>) {
  server.use(
    http.get('*/v1/auth/me', () => HttpResponse.json(adminSession())),
    http.get('*/v1/admin/dashboard', body),
  );
}

describe('Admin → Dashboard', () => {
  it('shows the numbers, charts, storage and health; no axe violations', async () => {
    serve(() => HttpResponse.json(dashboard()));
    const { container } = await renderApp('/admin', { width: DESKTOP_WIDTH });
    expect(await screen.findByRole('heading', { name: 'Dashboard', level: 1 }, SLOW)).toBeVisible();
    expect(await screen.findByText('1,234', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText('40 active · 2 deactivated · 3 admins')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    // Storage: the disk is past the guard, and the top person is nearly full.
    expect(screen.getByRole('meter', { name: 'Server disk' })).toHaveAttribute(
      'aria-valuenow',
      '86',
    );
    expect(screen.getByText(/New uploads stop at 85%/)).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: /Asha Verma/ })).toBeInTheDocument();
    // Health: a word with every icon, the build and the backup not yet reported.
    expect(screen.getByText('0.19.0 (be97496)')).toBeInTheDocument();
    expect(screen.getByText('0 waiting · 2 failed', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Not reported yet')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('switches the charts between 7 and 30 days; the numbers are in a table too', async () => {
    serve(() => HttpResponse.json(dashboard()));
    await renderApp('/admin', { width: DESKTOP_WIDTH });
    const messages = await screen.findByRole('figure', { name: /Messages sent/ }, SLOW);
    const last7 = days.slice(-7).reduce((sum, day) => sum + day.messages, 0);
    expect(within(messages).getByText(`${last7} in 7 days`)).toBeInTheDocument();
    expect(within(messages).getAllByRole('row')).toHaveLength(8);
    await userEvent.setup().click(screen.getByRole('button', { name: '30 days' }));
    expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(messages).getAllByRole('row')).toHaveLength(31);
    const first = days[0]?.date ?? '';
    expect(
      within(messages).getByRole('cell', { name: shortDate(first, 'en') }),
    ).toBeInTheDocument();
  });

  it('shows a day’s value on hover', async () => {
    serve(() => HttpResponse.json(dashboard()));
    const { container } = await renderApp('/admin', { width: DESKTOP_WIDTH });
    const calls = await screen.findByRole('figure', { name: /Calls/ }, SLOW);
    const targets = calls.querySelectorAll('[data-chart-column]');
    expect(targets).toHaveLength(7);
    fireEvent.mouseEnter(targets[6] as Element);
    const today = days.at(-1);
    expect(
      within(calls).getByText(`${shortDate(today?.date ?? '', 'en')}: ${today?.calls}`),
    ).toBeInTheDocument();
    expect(container).toBeTruthy();
  });

  it('says when the disk can’t be read and nobody stores files yet', async () => {
    serve(() =>
      HttpResponse.json(
        dashboard({
          storage: { disk: null, filesBytes: 0, topUsers: [] },
          health: { mongodb: 'ok', redis: 'skipped', storage: 'error', emailQueue: null },
        }),
      ),
    );
    await renderApp('/admin', { width: DESKTOP_WIDTH });
    expect(
      await screen.findByText('The disk size can’t be read right now.', {}, SLOW),
    ).toBeInTheDocument();
    expect(screen.getByText('Nobody has stored files yet.')).toBeInTheDocument();
    expect(screen.getByText('Problem')).toBeInTheDocument();
  });

  it('shows a loading state, then an error with a retry that works', async () => {
    let calls = 0;
    serve(async () => {
      calls += 1;
      await delay(50);
      return calls === 1
        ? HttpResponse.json(
            { code: 'INTERNAL_ERROR', message: 'x', requestId: 'r' },
            { status: 500 },
          )
        : HttpResponse.json(dashboard());
    });
    await renderApp('/admin', { width: DESKTOP_WIDTH });
    expect(await screen.findByRole('status', { name: 'Loading' }, SLOW)).toBeInTheDocument();
    const alert = await screen.findByRole('alert', {}, SLOW);
    expect(alert).toHaveTextContent('Couldn’t load the dashboard.');
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('1,234', {}, SLOW)).toBeInTheDocument();
  });

  it('on a phone: the sections are tabs under the title; no axe violations', async () => {
    serve(() => HttpResponse.json(dashboard()));
    const { container } = await renderApp('/admin', { width: MOBILE_WIDTH });
    const sections = await screen.findByRole('navigation', { name: 'Admin sections' }, SLOW);
    expect(within(sections).getAllByRole('link')).toHaveLength(5);
    expect(within(sections).getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'data-status',
      'active',
    );
    await screen.findByText('1,234', {}, SLOW);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('is closed to non-admins, who never ask the server for it', async () => {
    let asked = false;
    server.use(
      http.get('*/v1/admin/dashboard', () => {
        asked = true;
        return HttpResponse.json({}, { status: 403 });
      }),
    );
    const { router } = await renderApp('/admin');
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
    expect(screen.queryByRole('link', { name: /Admin panel/ })).not.toBeInTheDocument();
    expect(asked).toBe(false);
  });

  it('admins reach it from Settings and from the side rail', async () => {
    serve(() => HttpResponse.json(dashboard()));
    await renderApp('/settings', { width: DESKTOP_WIDTH });
    const links = await screen.findAllByRole('link', { name: /Admin panel/ }, SLOW);
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const link of links) expect(link).toHaveAttribute('href', '/admin');
  });
});
