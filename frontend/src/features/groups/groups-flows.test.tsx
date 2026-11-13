import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GroupInfo, GroupMember, PublicProfile } from '@zuvo/protocol';
import { describe, expect, it, vi } from 'vitest';
import { setTyping } from '@/features/sync/live-status';
import { axe } from '@/test/axe';
import { chatFixture, ME_ID, messageFixture, personFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { useNewGroup } from './rules';

const group = (overrides: Partial<GroupInfo> = {}): GroupInfo => ({
  name: 'Launch team',
  description: 'All about the launch',
  photo: null,
  memberCount: 3,
  settings: {
    editInfo: 'all',
    sendMessages: 'all',
    addMembers: 'admins',
    pinMessages: 'all',
    mentionEveryone: 'admins',
    disappearing: 'admins',
  },
  myRole: 'member',
  active: true,
  ...overrides,
});
const person = (id: string, displayName: string): PublicProfile =>
  personFixture({ id, displayName, username: displayName.toLowerCase() });
const riya = person('u-riya', 'Riya');
const vikram = person('u-vikram', 'Vikram');
const me = person(ME_ID, 'Kiran Rao');
const members = (myRole: GroupInfo['myRole']): GroupMember[] => [
  { user: me, role: myRole, joinedAt: '2026-11-01T10:00:00.000Z' },
  {
    user: riya,
    role: myRole === 'owner' ? 'admin' : 'owner',
    joinedAt: '2026-11-01T10:00:00.000Z',
  },
  { user: vikram, role: 'member', joinedAt: '2026-11-01T10:00:00.000Z' },
];

async function openGroup(info: GroupInfo, messages: Parameters<typeof seedLocal>[1] = []) {
  server.use(
    http.get('*/v1/chats/:id/members', () => HttpResponse.json({ members: members(info.myRole) })),
    http.get('*/v1/chats/:id/invite', () => HttpResponse.json({ code: null })),
    http.get('*/v1/chats/:id/media', () => HttpResponse.json({ items: [], hasMore: false })),
  );
  await seedLocal(
    [chatFixture({ type: 'group', otherUser: null, group: info, seq: messages?.length ?? 0 })],
    messages,
  );
  return renderApp('/chats/c1', { width: DESKTOP_WIDTH });
}

describe('creating a group', () => {
  it('picks people, then a name, then opens the group', async () => {
    const user = userEvent.setup();
    const created = vi.fn();
    server.use(
      http.get('*/v1/users/search', () =>
        HttpResponse.json({ items: [riya, vikram], nextCursor: null }),
      ),
      http.post('*/v1/groups', async ({ request }) => {
        created(await request.json());
        return HttpResponse.json({
          chat: chatFixture({
            id: 'c-new',
            type: 'group',
            otherUser: null,
            group: group({ myRole: 'owner', name: 'Launch' }),
          }),
        });
      }),
      http.get('*/v1/chats/:id/members', () => HttpResponse.json({ members: members('owner') })),
      http.get('*/v1/chats/:id/media', () => HttpResponse.json({ items: [], hasMore: false })),
    );
    const { container } = await renderApp('/chats', { width: DESKTOP_WIDTH });
    act(() => useNewGroup.getState().setOpen(true));
    const dialog = await screen.findByRole('dialog', { name: 'New group' });
    await user.type(within(dialog).getByRole('searchbox'), 'ri');
    await user.click(await within(dialog).findByRole('button', { name: /Riya/ }));
    await user.click(await within(dialog).findByRole('button', { name: /Vikram/ }));
    expect(within(dialog).getByText('2 people selected')).toBeInTheDocument();
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations();
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));

    const details = await screen.findByRole('dialog', { name: 'Name your group' });
    const create = within(details).getByRole('button', { name: 'Create group' });
    expect(create).toBeDisabled();
    await user.type(within(details).getByRole('textbox', { name: 'Group name' }), 'Launch');
    await user.click(create);
    await waitFor(() =>
      expect(created).toHaveBeenCalledWith({
        name: 'Launch',
        description: '',
        memberIds: ['u-riya', 'u-vikram'],
      }),
    );
    // Opening a chat loads its route and reads the local database.
    expect(
      await screen.findByRole('heading', { name: 'Launch' }, { timeout: 15_000 }),
    ).toBeInTheDocument();
  });

  it('shows a failure and keeps what was typed', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('*/v1/groups', () =>
        HttpResponse.json(
          { code: 'RATE_LIMITED', message: 'Too many', requestId: 'r' },
          { status: 429 },
        ),
      ),
    );
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    act(() => useNewGroup.getState().setOpen(true));
    const dialog = await screen.findByRole('dialog', { name: 'New group' });
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    const details = await screen.findByRole('dialog', { name: 'Name your group' });
    await user.type(within(details).getByRole('textbox', { name: 'Group name' }), 'Solo');
    await user.click(within(details).getByRole('button', { name: 'Create group' }));
    expect(await within(details).findByRole('alert')).toBeInTheDocument();
    expect(within(details).getByRole('textbox', { name: 'Group name' })).toHaveValue('Solo');
    act(() => useNewGroup.getState().setOpen(false));
  });

  it('the empty Groups chip offers to start one', async () => {
    const user = userEvent.setup();
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await user.click(await screen.findByRole('tab', { name: 'Groups' }));
    await user.click(await screen.findByRole('button', { name: 'New group' }));
    expect(await screen.findByRole('dialog', { name: 'New group' })).toBeInTheDocument();
    act(() => useNewGroup.getState().setOpen(false));
  });
});

describe('the join page', () => {
  const preview = {
    chatId: 'c1',
    name: 'Launch team',
    photo: null,
    memberCount: 12,
    alreadyMember: false,
  };

  it('shows the group, and only joins when asked', async () => {
    const user = userEvent.setup();
    const joined = vi.fn();
    server.use(
      http.get('*/v1/invites/:code', () => HttpResponse.json(preview)),
      http.post('*/v1/invites/:code/join', () => {
        joined();
        return HttpResponse.json({
          chat: chatFixture({ type: 'group', otherUser: null, group: group() }),
        });
      }),
      http.get('*/v1/chats/:id/members', () => HttpResponse.json({ members: members('member') })),
      http.get('*/v1/chats/:id/media', () => HttpResponse.json({ items: [], hasMore: false })),
    );
    const { container } = await renderApp('/join/abcdefghijklmnopqr', { width: DESKTOP_WIDTH });
    expect(await screen.findByText('Launch team')).toBeInTheDocument();
    expect(screen.getByText('12 members')).toBeInTheDocument();
    expect(joined).not.toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() => expect(joined).toHaveBeenCalled());
    // Opening a chat loads its route and reads the local database.
    expect(
      await screen.findByRole('heading', { name: 'Launch team' }, { timeout: 30_000 }),
    ).toBeInTheDocument();
    // Longer than the wait above: on CI the whole suite runs at once, and this test loads a route.
  }, 45_000);

  it('says so when the link no longer works', async () => {
    server.use(
      http.get('*/v1/invites/:code', () =>
        HttpResponse.json(
          { code: 'INVITE_INVALID', message: 'No.', requestId: 'r' },
          { status: 404 },
        ),
      ),
    );
    await renderApp('/join/abcdefghijklmnopqr', { width: DESKTOP_WIDTH });
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer valid');
  });

  it('offers to open a group I am already in', async () => {
    server.use(
      http.get('*/v1/invites/:code', () => HttpResponse.json({ ...preview, alreadyMember: true })),
    );
    await renderApp('/join/abcdefghijklmnopqr', { width: DESKTOP_WIDTH });
    expect(await screen.findByRole('button', { name: 'Open group' })).toBeInTheDocument();
  });
});

describe('message info', () => {
  it('lists who read and who received, with loading and failure states', async () => {
    const user = userEvent.setup();
    let fail = true;
    server.use(
      http.get('*/v1/chats/:id/messages/:messageId/info', () =>
        fail
          ? HttpResponse.json(
              { code: 'INTERNAL_ERROR', message: 'x', requestId: 'r' },
              { status: 500 },
            )
          : HttpResponse.json({
              readBy: [{ user: riya, at: '2026-11-05T10:00:00.000Z' }],
              deliveredTo: [{ user: vikram, at: null }],
              waiting: 1,
            }),
      ),
    );
    await openGroup(group(), [messageFixture(1, { id: 'm-mine', senderId: ME_ID, text: 'Mine' })]);
    await user.click(await screen.findByRole('button', { name: 'Message info' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load');
    await user.keyboard('{Escape}');
    fail = false;
    await user.click(await screen.findByRole('button', { name: 'Message info' }));
    const dialog = await screen.findByRole('dialog', { name: 'Message info' });
    expect(await within(dialog).findByText('Read by')).toBeInTheDocument();
    expect(within(dialog).getByText('Riya')).toBeInTheDocument();
    expect(within(dialog).getByText('Delivered to')).toBeInTheDocument();
    expect(within(dialog).getByText('Vikram')).toBeInTheDocument();
    expect(within(dialog).getByText('Waiting for 1 person')).toBeInTheDocument();
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

describe('the group header', () => {
  it('shows the group name and its people, with me last', async () => {
    await openGroup(group());
    // Opening a chat loads its route and reads the local database.
    expect(
      await screen.findByRole('heading', { name: 'Launch team' }, { timeout: 15_000 }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Riya, Vikram, You')).toBeInTheDocument();
  });

  it('says who is typing, by name', async () => {
    await openGroup(group());
    await screen.findByText('Riya, Vikram, You');
    act(() => setTyping('c1', 'u-riya', true));
    expect(await screen.findByText('Riya is typing…')).toBeInTheDocument();
    act(() => setTyping('c1', 'u-vikram', true));
    expect(await screen.findByText('Riya and Vikram are typing…')).toBeInTheDocument();
    act(() => {
      setTyping('c1', 'u-riya', false);
      setTyping('c1', 'u-vikram', false);
    });
    await waitFor(() => expect(screen.queryByText(/typing/)).not.toBeInTheDocument());
  });
});
