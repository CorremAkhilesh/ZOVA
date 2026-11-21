import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminGroup } from '@zuvo/protocol';
import { describe, expect, it, vi } from 'vitest';
import { footerNotice } from '@/features/chats/components/ChatFooter';
import type { ChatSummary } from '@/features/chats/types';
import { axe } from '@/test/axe';
import { HttpResponse, http, server, sessionFixture } from '@/test/msw';
import { DESKTOP_WIDTH, MOBILE_WIDTH, renderApp } from '@/test/render-app';

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 15_000 };

const adminSession = () => {
  const base = sessionFixture();
  return { ...base, user: { ...base.user, role: 'admin' as const } };
};
const row = (overrides: Partial<AdminGroup> = {}): AdminGroup => ({
  id: 'g1',
  name: 'Design Guild',
  memberCount: 12,
  adminCount: 2,
  owner: { id: 'u1', email: 'asha@corremadvisory.com', name: 'Asha Verma' },
  createdAt: '2026-10-01T09:00:00.000Z',
  lastActivityAt: new Date(Date.now() - 3_600_000).toISOString(),
  storageBytes: 5 * 1024 ** 2,
  archived: false,
  ...overrides,
});

function serve(items: AdminGroup[]) {
  const posted: Array<{ url: string; body: unknown }> = [];
  const queries: URLSearchParams[] = [];
  const record = async ({ request }: { request: Request }) => {
    posted.push({ url: new URL(request.url).pathname, body: await request.json() });
  };
  server.use(
    http.get('*/v1/auth/me', () => HttpResponse.json(adminSession())),
    http.get('*/v1/admin/groups', ({ request }) => {
      queries.push(new URL(request.url).searchParams);
      return HttpResponse.json({ items, nextCursor: null });
    }),
    http.post('*/v1/admin/groups/:id/archive', async (info) => {
      await record(info);
      return HttpResponse.json({ group: row({ archived: true }) });
    }),
    http.post('*/v1/admin/groups/:id/delete', async (info) => {
      await record(info);
      return HttpResponse.json({ deleted: true, members: 12 });
    }),
  );
  return { posted, queries };
}

describe('Admin → Groups', () => {
  it('lists groups without their messages, searches and filters; no axe violations', async () => {
    const user = userEvent.setup();
    const { queries } = serve([row(), row({ id: 'g2', name: 'Old Club', archived: true })]);
    const { container } = await renderApp('/admin/groups', { width: DESKTOP_WIDTH });
    expect(await screen.findByText('Design Guild', {}, SLOW)).toBeInTheDocument();
    expect(screen.getAllByText('12 members · 2 admins · owner Asha Verma')).toHaveLength(2);
    expect(screen.getAllByText(/of files/)[0]).toHaveTextContent('5 MB of files');
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await user.type(screen.getByRole('searchbox'), 'design');
    await user.selectOptions(screen.getByLabelText('Show'), 'Archived');
    await waitFor(() => {
      expect(queries.at(-1)?.get('q')).toBe('design');
      expect(queries.at(-1)?.get('filter')).toBe('archived');
    });
  });

  it('archives with a reason', async () => {
    const user = userEvent.setup();
    const { posted } = serve([row()]);
    await renderApp('/admin/groups', { width: MOBILE_WIDTH });
    await user.click(await screen.findByRole('button', { name: 'Archive' }, SLOW));
    const dialog = await screen.findByRole('dialog', { name: 'Archive “Design Guild”?' });
    await user.type(within(dialog).getByLabelText('Reason'), 'Spam reports');
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));
    await waitFor(() =>
      expect(posted).toEqual([
        { url: '/v1/admin/groups/g1/archive', body: { reason: 'Spam reports' } },
      ]),
    );
  });

  it('deletes only after the name is typed again', async () => {
    const user = userEvent.setup();
    const { posted } = serve([row()]);
    await renderApp('/admin/groups', { width: DESKTOP_WIDTH });
    await user.click(await screen.findByRole('button', { name: 'Delete for everyone' }, SLOW));
    const dialog = await screen.findByRole('dialog', {
      name: 'Delete “Design Guild” for everyone?',
    });
    const confirm = within(dialog).getByRole('button', { name: 'Delete for everyone' });
    await user.type(within(dialog).getByLabelText('Reason'), 'Abuse');
    await user.type(within(dialog).getByLabelText(/Type the group’s name/), 'Design');
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Type the group’s name/), ' guild');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() =>
      expect(posted).toEqual([
        {
          url: '/v1/admin/groups/g1/delete',
          body: { confirmName: 'Design guild', reason: 'Abuse' },
        },
      ]),
    );
  });

  it('says when there are none', async () => {
    serve([]);
    await renderApp('/admin/groups', { width: DESKTOP_WIDTH });
    expect(await screen.findByText('No groups found.', {}, SLOW)).toBeInTheDocument();
  });
});

describe('an archived group in the chat', () => {
  it('has no composer, with the reason why', () => {
    const chat = {
      group: {
        name: 'x',
        description: '',
        photo: null,
        memberCount: 2,
        settings: {
          sendMessages: 'all',
          editInfo: 'all',
          addMembers: 'all',
          mentionEveryone: 'admins',
        },
        myRole: 'member',
        active: true,
        archivedByAdmin: true,
      },
    } as unknown as ChatSummary;
    expect(footerNotice(chat)).toBe('groups.archivedByAdmin');
  });
});
