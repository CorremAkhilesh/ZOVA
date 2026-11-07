import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReportSummary } from '@zuvo/protocol';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '@/test/axe';
import { HttpResponse, http, server, sessionFixture } from '@/test/msw';
import { renderApp } from '@/test/render-app';

const SLOW = { timeout: 15_000 };
vi.setConfig({ testTimeout: 30_000 });

const adminSession = () => {
  const base = sessionFixture();
  return { ...base, user: { ...base.user, role: 'admin' as const } };
};

const report = (overrides: Partial<ReportSummary> = {}): ReportSummary => ({
  id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  status: 'open',
  kind: 'message',
  reason: 'harassment',
  note: 'please look',
  blocked: true,
  reporter: {
    id: 'u-asha',
    displayName: 'Asha Verma',
    email: 'asha@corremadvisory.com',
    status: 'active',
  },
  reported: {
    id: 'u-ravi',
    displayName: 'Ravi Kumar',
    email: 'ravi@corremadvisory.com',
    status: 'active',
  },
  group: null,
  evidenceCount: 2,
  createdAt: '2026-11-06T10:00:00.000Z',
  resolvedAt: null,
  resolution: null,
  ...overrides,
});

const evidence = [
  {
    messageId: 'm1',
    chatId: 'c1',
    seq: 1,
    senderId: 'u-ravi',
    senderName: 'Ravi Kumar',
    type: 'text',
    text: '<b>you will regret</b>',
    fileName: null,
    selected: true,
    createdAt: '2026-11-06T09:59:00.000Z',
  },
];

describe('Admin → Reports', () => {
  it('is closed to non-admins', async () => {
    const { router } = await renderApp('/settings/admin/reports');
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
  });

  it('lists open reports, opens one with its evidence as plain text, and resolves it', async () => {
    const asked: string[] = [];
    const resolved: unknown[] = [];
    server.use(
      http.get('*/v1/auth/me', () => HttpResponse.json(adminSession())),
      http.get('*/v1/admin/reports', ({ request }) => {
        const status = new URL(request.url).searchParams.get('status') ?? 'all';
        asked.push(status);
        const items = status === 'resolved' ? [] : [report()];
        return HttpResponse.json({ items, nextCursor: null });
      }),
      http.get('*/v1/admin/reports/:id', () =>
        HttpResponse.json({ report: { ...report(), evidence } }),
      ),
      http.post('*/v1/admin/reports/:id/resolve', async ({ request }) => {
        resolved.push(await request.json());
        return HttpResponse.json({ report: report({ status: 'resolved' }) });
      }),
    );
    const user = userEvent.setup();
    const { container } = await renderApp('/settings/admin/reports');
    const list = await screen.findByRole('list', { name: 'Reports' }, SLOW);
    expect(asked[0]).toBe('open');
    expect(within(list).getByText('Messages from Ravi Kumar')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await user.click(within(list).getByRole('button', { name: /Messages from Ravi Kumar/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Report' });
    const picked = await within(dialog).findByText('<b>you will regret</b>');
    expect(picked.querySelector('b')).toBeNull();
    expect(dialog).toHaveTextContent('Asha Verma (asha@corremadvisory.com)');
    expect(dialog).toHaveTextContent('The reporter also blocked them');
    await user.type(within(dialog).getByRole('textbox', { name: /audit log/ }), 'warned');
    await user.click(
      within(dialog).getByRole('button', { name: 'Deactivate Ravi Kumar and resolve' }),
    );
    await waitFor(() => expect(resolved).toEqual([{ action: 'deactivate', note: 'warned' }]));

    await user.click(screen.getByRole('radio', { name: 'Resolved' }));
    expect(await screen.findByText('No reports here.')).toBeInTheDocument();
  });

  it('shows an error when reports cannot load', async () => {
    server.use(
      http.get('*/v1/auth/me', () => HttpResponse.json(adminSession())),
      http.get('*/v1/admin/reports', () => HttpResponse.json({}, { status: 500 })),
    );
    await renderApp('/settings/admin/reports');
    expect(await screen.findByRole('alert', {}, SLOW)).toHaveTextContent('Couldn’t load reports.');
  });

  it('is in the admin menu', async () => {
    server.use(http.get('*/v1/auth/me', () => HttpResponse.json(adminSession())));
    await renderApp('/settings');
    expect(await screen.findByRole('link', { name: /What people reported/ }, SLOW)).toHaveAttribute(
      'href',
      '/settings/admin/reports',
    );
  });
});
