import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminAnnouncement } from '@zuvo/protocol';
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
const BANNER = {
  id: 'a1',
  title: 'Maintenance tonight',
  body: 'The app is down from 10 to 11 pm.',
  level: 'warning' as const,
  endsAt: '2026-11-21T17:30:00.000Z',
};
const made = (overrides: Partial<AdminAnnouncement> = {}): AdminAnnouncement => ({
  ...BANNER,
  audience: 'all',
  recipients: 42,
  banner: true,
  message: false,
  createdAt: '2026-11-21T09:00:00.000Z',
  createdBy: 'kiran@corremadvisory.com',
  endedAt: null,
  state: 'active',
  ...overrides,
});

describe('the banner at the top of the app', () => {
  it('shows a banner with its end, closes it for me, and has no axe violations', async () => {
    const user = userEvent.setup();
    let items = [BANNER];
    const closed: string[] = [];
    server.use(
      http.get('*/v1/announcements', () => HttpResponse.json({ items })),
      http.post('*/v1/announcements/:id/dismiss', ({ params }) => {
        closed.push(String(params.id));
        items = [];
        return HttpResponse.json({ ok: true });
      }),
    );
    const { container } = await renderApp('/chats', { width: MOBILE_WIDTH });
    const region = await screen.findByRole(
      'region',
      { name: 'Announcements from the admins' },
      SLOW,
    );
    expect(region).toHaveTextContent('Maintenance tonight');
    expect(region).toHaveTextContent('The app is down from 10 to 11 pm.');
    expect(region).toHaveTextContent(/Until Nov 21, 2026/);
    expect(await axe(container)).toHaveNoViolations();
    await user.click(within(region).getByRole('button', { name: 'Close “Maintenance tonight”' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: /Announcements/ })).not.toBeInTheDocument(),
    );
    expect(closed).toEqual(['a1']);
  });

  it('shows nothing when there is nothing', async () => {
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await screen.findByRole('link', { name: 'Chats' }, SLOW);
    expect(screen.queryByRole('region', { name: /Announcements/ })).not.toBeInTheDocument();
  });
});

describe('Admin → Announcements', () => {
  function serve(items: AdminAnnouncement[] = []) {
    const posted: Array<{ url: string; body: unknown }> = [];
    server.use(
      http.get('*/v1/auth/me', () => HttpResponse.json(adminSession())),
      http.get('*/v1/admin/announcements', () => HttpResponse.json({ items, nextCursor: null })),
      http.post('*/v1/admin/announcements', async ({ request }) => {
        posted.push({ url: '/v1/admin/announcements', body: await request.json() });
        return HttpResponse.json({ announcement: made() });
      }),
      http.post('*/v1/admin/announcements/:id/end', async ({ request, params }) => {
        posted.push({ url: `end/${params.id}`, body: await request.json() });
        return HttpResponse.json({ announcement: made({ state: 'ended' }) });
      }),
    );
    return posted;
  }

  it('starts empty, then sends one to everyone as a banner and a message, with a reason', async () => {
    const user = userEvent.setup();
    const posted = serve();
    const { container } = await renderApp('/admin/announcements', { width: DESKTOP_WIDTH });
    expect(await screen.findByText('No announcements yet.', {}, SLOW)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole('button', { name: 'New announcement' }));
    const dialog = await screen.findByRole('dialog', { name: 'New announcement' });
    const send = within(dialog).getByRole('button', { name: 'Send' });
    await user.type(within(dialog).getByLabelText('Title'), 'Holiday');
    await user.type(within(dialog).getByLabelText('Message'), 'Office closed Friday.');
    await user.click(within(dialog).getByRole('radio', { name: 'Important' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Chat message from me' }));
    expect(send).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Reason'), 'Company holiday');
    expect(await axe(dialog)).toHaveNoViolations();
    await user.click(send);
    await waitFor(() =>
      expect(posted[0]?.body).toEqual({
        title: 'Holiday',
        body: 'Office closed Friday.',
        level: 'warning',
        audience: { kind: 'all' },
        banner: true,
        endsAt: null,
        message: true,
        reason: 'Company holiday',
      }),
    );
    expect(await screen.findByText('Sent to 42 people.')).toBeInTheDocument();
  });

  it('cannot send without a banner or a message', async () => {
    const user = userEvent.setup();
    serve();
    await renderApp('/admin/announcements', { width: MOBILE_WIDTH });
    await user.click(await screen.findByRole('button', { name: 'New announcement' }, SLOW));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Title'), 'x');
    await user.type(within(dialog).getByLabelText('Message'), 'y');
    await user.type(within(dialog).getByLabelText('Reason'), 'why not');
    await user.click(
      within(dialog).getByRole('checkbox', { name: 'Banner at the top of the app' }),
    );
    expect(within(dialog).getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('lists what went out and ends a banner early with a reason', async () => {
    const user = userEvent.setup();
    const posted = serve([made(), made({ id: 'a2', title: 'Old news', state: 'ended' })]);
    await renderApp('/admin/announcements', { width: DESKTOP_WIDTH });
    expect(await screen.findByText('Old news', {}, SLOW)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'End now' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'End now' }));
    const dialog = await screen.findByRole('dialog', { name: 'End “Maintenance tonight”?' });
    await user.type(within(dialog).getByLabelText('Reason'), 'Done early');
    await user.click(within(dialog).getByRole('button', { name: 'End now' }));
    await waitFor(() =>
      expect(posted).toEqual([{ url: 'end/a1', body: { reason: 'Done early' } }]),
    );
  });
});
