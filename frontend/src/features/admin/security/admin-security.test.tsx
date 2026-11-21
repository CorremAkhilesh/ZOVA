import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminSecurity, AuditLogEntry } from '@zuvo/protocol';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '@/test/axe';
import { HttpResponse, http, server, sessionFixture } from '@/test/msw';
import { DESKTOP_WIDTH, MOBILE_WIDTH, renderApp } from '@/test/render-app';

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 15_000 };

const adminSession = () => {
  const base = sessionFixture();
  return { ...base, user: { ...base.user, role: 'admin' as const } };
};
const AT = new Date(Date.now() - 600_000).toISOString();
const STATE: AdminSecurity = {
  sessions: { active: 57, people: 41 },
  locks: [
    {
      id: 'l1',
      email: 'ravi@corremadvisory.com',
      ip: '203.0.113.*',
      lockedAt: AT,
      until: new Date(Date.now() + 20 * 3600_000).toISOString(),
    },
  ],
  failures: [{ email: 'ravi@corremadvisory.com', ip: '203.0.113.*', at: AT }],
};

describe('Admin → Security', () => {
  it('shows devices, people, locks and wrong codes; unlocks with a reason; no axe violations', async () => {
    const user = userEvent.setup();
    const unlocked: unknown[] = [];
    server.use(
      http.get('*/v1/auth/me', () => HttpResponse.json(adminSession())),
      http.get('*/v1/admin/security', () => HttpResponse.json(STATE)),
      http.post('*/v1/admin/security/locks/:id/unlock', async ({ request, params }) => {
        unlocked.push({ id: params.id, body: await request.json() });
        return HttpResponse.json({ unlocked: true });
      }),
    );
    const { container } = await renderApp('/admin/security', { width: DESKTOP_WIDTH });
    expect(await screen.findByText('57', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText('41')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '203.0.113.*' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    const dialog = await screen.findByRole('dialog', { name: 'Unlock ravi@corremadvisory.com?' });
    await user.type(within(dialog).getByLabelText('Reason'), 'Called him');
    await user.click(within(dialog).getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(unlocked).toEqual([{ id: 'l1', body: { reason: 'Called him' } }]));
  });

  it('says when nothing is locked and nothing failed', async () => {
    server.use(
      http.get('*/v1/auth/me', () => HttpResponse.json(adminSession())),
      http.get('*/v1/admin/security', () =>
        HttpResponse.json({ sessions: { active: 1, people: 1 }, locks: [], failures: [] }),
      ),
    );
    await renderApp('/admin/security', { width: MOBILE_WIDTH });
    expect(await screen.findByText('No email is locked.', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText('No wrong codes lately.')).toBeInTheDocument();
  });
});

const entry = (overrides: Partial<AuditLogEntry> = {}): AuditLogEntry => ({
  id: 'a1',
  action: 'user.suspend',
  actor: { id: 'u1', email: 'kiran@corremadvisory.com' },
  target: { id: 'u2', email: 'ravi@corremadvisory.com' },
  ipAddress: null,
  at: AT,
  reason: 'Policy review',
  details: { until: '2026-11-28T10:00:00.000Z' },
  ...overrides,
});

describe('Admin → Audit log', () => {
  it('shows each action with its reason and details, and filters; no axe violations', async () => {
    const user = userEvent.setup();
    const queries: URLSearchParams[] = [];
    server.use(
      http.get('*/v1/auth/me', () => HttpResponse.json(adminSession())),
      http.get('*/v1/admin/audit-log', ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return HttpResponse.json({ items: [entry()], nextCursor: null });
      }),
    );
    const { container } = await renderApp('/admin/audit', { width: DESKTOP_WIDTH });
    expect(
      await screen.findByText(
        'kiran@corremadvisory.com suspended ravi@corremadvisory.com',
        {},
        SLOW,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Reason: “Policy review”')).toBeInTheDocument();
    expect(screen.getByText('until: 2026-11-28T10:00:00.000Z')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await user.selectOptions(screen.getByLabelText('Action'), 'Suspend');
    await user.type(screen.getByLabelText('Person'), 'ravi@corremadvisory.com');
    await waitFor(() => {
      expect(queries.at(-1)?.get('action')).toBe('user.suspend');
      expect(queries.at(-1)?.get('target')).toBe('ravi@corremadvisory.com');
    });
  });

  it('downloads the filtered log as CSV', async () => {
    const user = userEvent.setup();
    const asked: string[] = [];
    server.use(
      http.get('*/v1/auth/me', () => HttpResponse.json(adminSession())),
      http.get('*/v1/admin/audit-log', () => HttpResponse.json({ items: [], nextCursor: null })),
      http.get('*/v1/admin/audit-log/export', ({ request }) => {
        asked.push(new URL(request.url).search);
        return new HttpResponse('"When"\r\n', {
          headers: {
            'content-type': 'text/csv',
            'content-disposition': 'attachment; filename="audit-log-2026-11-21.csv"',
          },
        });
      }),
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    await renderApp('/admin/audit', { width: MOBILE_WIDTH });
    expect(await screen.findByText('No admin actions yet.', {}, SLOW)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Action'), 'Settings');
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));
    await waitFor(() => expect(asked).toEqual(['?action=settings.change']));
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });
});
