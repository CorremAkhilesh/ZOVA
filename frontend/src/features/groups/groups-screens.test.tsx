import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GroupInfo, GroupMember, PublicProfile } from '@zuvo/protocol';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '@/test/axe';
import { chatFixture, ME_ID, messageFixture, personFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';

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

const openInfo = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: 'Chat info', pressed: false }));
  return screen.findByRole('complementary', { name: 'Chat info' });
};

describe('the composer in a group', () => {
  it('is there for a member when everyone can send', async () => {
    await openGroup(group());
    expect(await screen.findByRole('textbox', { name: 'Write a message' })).toBeInTheDocument();
  });

  it('becomes a notice for a member in announcement mode', async () => {
    const { container } = await openGroup(
      group({
        settings: {
          editInfo: 'all',
          sendMessages: 'admins',
          addMembers: 'admins',
          pinMessages: 'all',
          mentionEveryone: 'admins',
          disappearing: 'admins',
        },
      }),
    );
    expect(await screen.findByText('Only admins can send messages')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Write a message' })).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('stays for an admin in announcement mode', async () => {
    await openGroup(
      group({
        myRole: 'admin',
        settings: {
          editInfo: 'all',
          sendMessages: 'admins',
          addMembers: 'admins',
          pinMessages: 'all',
          mentionEveryone: 'admins',
          disappearing: 'admins',
        },
      }),
    );
    expect(await screen.findByRole('textbox', { name: 'Write a message' })).toBeInTheDocument();
  });

  it('becomes a notice for someone no longer in the group', async () => {
    await openGroup(group({ active: false }));
    expect(await screen.findByText('You’re no longer a member of this group')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Write a message' })).not.toBeInTheDocument();
  });
});

describe('messages in a group', () => {
  const system = {
    kind: 'added' as const,
    actor: { id: 'u-riya', name: 'Riya' },
    targets: [{ id: ME_ID, name: 'Kiran Rao' }],
    value: null,
  };

  it('shows system messages as pills, and senders by name', async () => {
    const { container } = await openGroup(group(), [
      messageFixture(1, { type: 'system', senderId: null, text: null, clientMsgId: null, system }),
      messageFixture(2, { senderId: 'u-riya', text: 'Welcome', clientMsgId: null }),
    ]);
    expect(await screen.findByText('Riya added you')).toBeInTheDocument();
    expect(await screen.findByText('Welcome')).toBeInTheDocument();
    expect(await screen.findByText('Riya')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('the chat list shows the sender, and system messages in italics', async () => {
    server.use(
      http.get('*/v1/chats/:id/members', () => HttpResponse.json({ members: members('member') })),
    );
    await seedLocal([
      chatFixture({
        id: 'c1',
        type: 'group',
        otherUser: null,
        group: group(),
        seq: 1,
        lastMessage: {
          id: 'm1',
          seq: 1,
          senderId: null,
          type: 'system',
          preview: '',
          system,
          createdAt: '2026-11-05T10:00:00.000Z',
        },
      }),
    ]);
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    const preview = await screen.findByText('Riya added you');
    expect(preview).toHaveClass('italic');
  });
});

describe('the info pane', () => {
  it('a member sees people and can leave, but cannot manage', async () => {
    const user = userEvent.setup();
    await openGroup(group());
    const pane = await openInfo(user);
    expect(await within(pane).findByText('Riya')).toBeInTheDocument();
    expect(within(pane).getByRole('button', { name: 'Exit group' })).toBeInTheDocument();
    expect(within(pane).queryByRole('region', { name: 'Invite link' })).not.toBeInTheDocument();
    expect(within(pane).queryByRole('region', { name: 'Group settings' })).not.toBeInTheDocument();
    expect(within(pane).queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    await user.click(within(pane).getByRole('button', { name: 'Actions for Vikram' }));
    expect(within(pane).getByRole('button', { name: 'Message Vikram' })).toBeInTheDocument();
    expect(within(pane).queryByRole('button', { name: 'Make admin' })).not.toBeInTheDocument();
    expect(
      within(pane).queryByRole('button', { name: 'Remove from group' }),
    ).not.toBeInTheDocument();
  });

  it('an owner can manage everything, with no axe violations', async () => {
    const user = userEvent.setup();
    const { container } = await openGroup(group({ myRole: 'owner' }));
    const pane = await openInfo(user);
    expect(await within(pane).findByRole('region', { name: 'Invite link' })).toBeInTheDocument();
    expect(within(pane).getByRole('region', { name: 'Group settings' })).toBeInTheDocument();
    expect(within(pane).getByRole('button', { name: 'Add' })).toBeInTheDocument();
    await user.click(await within(pane).findByRole('button', { name: 'Actions for Vikram' }));
    expect(within(pane).getByRole('button', { name: 'Make admin' })).toBeInTheDocument();
    expect(within(pane).getByRole('button', { name: 'Make owner' })).toBeInTheDocument();
    expect(within(pane).getByRole('button', { name: 'Remove from group' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('an admin cannot change roles, or remove another admin', async () => {
    const user = userEvent.setup();
    await openGroup(group({ myRole: 'admin' }));
    const pane = await openInfo(user);
    await user.click(await within(pane).findByRole('button', { name: 'Actions for Vikram' }));
    expect(within(pane).queryByRole('button', { name: 'Make admin' })).not.toBeInTheDocument();
    expect(within(pane).getByRole('button', { name: 'Remove from group' })).toBeInTheDocument();
  });

  it('removing someone asks the server', async () => {
    const user = userEvent.setup();
    const removed = vi.fn();
    server.use(
      http.delete('*/v1/chats/:id/members/:userId', ({ params }) => {
        removed(params.userId);
        return HttpResponse.json({ members: members('owner').slice(0, 2) });
      }),
    );
    await openGroup(group({ myRole: 'owner' }));
    const pane = await openInfo(user);
    await user.click(await within(pane).findByRole('button', { name: 'Actions for Vikram' }));
    await user.click(within(pane).getByRole('button', { name: 'Remove from group' }));
    await waitFor(() => expect(removed).toHaveBeenCalledWith('u-vikram'));
  });

  it('edits the name inline only when allowed', async () => {
    const user = userEvent.setup();
    const saved = vi.fn();
    server.use(
      http.patch('*/v1/chats/:id/group', async ({ request }) => {
        saved(await request.json());
        return HttpResponse.json({
          chat: chatFixture({ type: 'group', otherUser: null, group: group({ name: 'Renamed' }) }),
        });
      }),
    );
    await openGroup(group());
    const pane = await openInfo(user);
    await user.click(within(pane).getByRole('button', { name: 'Edit Group name' }));
    const field = within(pane).getByRole('textbox', { name: 'Group name' });
    fireEvent.change(field, { target: { value: 'Renamed' } });
    await user.click(within(pane).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith({ name: 'Renamed' }));
  });

  it('no editing when only admins may', async () => {
    const user = userEvent.setup();
    await openGroup(
      group({
        settings: {
          editInfo: 'admins',
          sendMessages: 'all',
          addMembers: 'admins',
          pinMessages: 'all',
          mentionEveryone: 'admins',
          disappearing: 'admins',
        },
      }),
    );
    const pane = await openInfo(user);
    expect(within(pane).queryByRole('button', { name: 'Edit Group name' })).not.toBeInTheDocument();
    expect(within(pane).queryByText('Change group photo')).not.toBeInTheDocument();
  });

  it('the invite link can be created, shown as a QR code, and turned off', async () => {
    const user = userEvent.setup();
    let code: string | null = null;
    const answer = () => HttpResponse.json({ code });
    await openGroup(group({ myRole: 'admin' }));
    server.use(
      http.get('*/v1/chats/:id/invite', answer),
      http.post('*/v1/chats/:id/invite', () => {
        code = 'abcdefghijklmnopqr';
        return answer();
      }),
      http.delete('*/v1/chats/:id/invite', () => {
        code = null;
        return answer();
      }),
    );
    const pane = await openInfo(user);
    await user.click(await within(pane).findByRole('button', { name: 'Create invite link' }));
    expect(await within(pane).findByText(/\/join\/abcdefghijklmnopqr$/)).toBeInTheDocument();
    await user.click(within(pane).getByRole('button', { name: 'QR code' }));
    expect(
      await within(pane).findByRole('img', { name: 'QR code for the invite link' }),
    ).toBeInTheDocument();
    await user.click(within(pane).getByRole('button', { name: 'Turn off' }));
    expect(
      await within(pane).findByRole('button', { name: 'Create invite link' }),
    ).toBeInTheDocument();
  });

  it('turning on announcement mode goes to the server', async () => {
    const user = userEvent.setup();
    const saved = vi.fn();
    server.use(
      http.put('*/v1/chats/:id/group/settings', async ({ request }) => {
        saved(await request.json());
        return HttpResponse.json({
          chat: chatFixture({ type: 'group', otherUser: null, group: group({ myRole: 'owner' }) }),
        });
      }),
    );
    await openGroup(group({ myRole: 'owner' }));
    const pane = await openInfo(user);
    fireEvent.change(within(pane).getByRole('combobox', { name: 'Send messages' }), {
      target: { value: 'admins' },
    });
    await waitFor(() => expect(saved).toHaveBeenCalledWith({ sendMessages: 'admins' }));
  });

  it('says why an owner cannot leave yet', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('*/v1/chats/:id/leave', () =>
        HttpResponse.json(
          { code: 'OWNER_MUST_TRANSFER', message: 'Make someone else the owner.', requestId: 'r' },
          { status: 409 },
        ),
      ),
    );
    await openGroup(group({ myRole: 'owner' }));
    const pane = await openInfo(user);
    await user.click(within(pane).getByRole('button', { name: 'Exit group' }));
    const dialog = await screen.findByRole('dialog', { name: 'Exit this group?' });
    await user.click(within(dialog).getByRole('button', { name: 'Exit group' }));
    expect(
      await screen.findByText(/owner/i, { selector: '[data-sonner-toast] *' }),
    ).toBeInTheDocument();
  });
});
