import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatSummary, GroupInfo, GroupMember, Message } from '@zuvo/protocol';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '@/test/axe';
import { chatFixture, ME_ID, messageFixture, personFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, privacyFixture, server } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 10_000 };
const soon = (ms: number) => new Date(Date.now() + ms).toISOString();

const group = (overrides: Partial<GroupInfo> = {}, audience: 'all' | 'admins' = 'admins') => ({
  name: 'Launch team',
  description: '',
  photo: null,
  memberCount: 2,
  settings: {
    editInfo: 'all' as const,
    sendMessages: 'all' as const,
    addMembers: 'admins' as const,
    pinMessages: 'all' as const,
    mentionEveryone: 'admins' as const,
    disappearing: audience,
  },
  myRole: 'member' as const,
  active: true,
  ...overrides,
});

const members = (myRole: GroupInfo['myRole']): GroupMember[] => [
  { user: personFixture({ id: ME_ID, displayName: 'Kiran Rao' }), role: myRole, joinedAt: soon(0) },
  { user: personFixture(), role: myRole === 'owner' ? 'admin' : 'owner', joinedAt: soon(0) },
];

async function openChat(chat: Partial<ChatSummary> = {}, messages: Message[] = []) {
  const myRole = chat.group?.myRole ?? 'member';
  server.use(
    http.get('*/v1/chats/:id/members', () => HttpResponse.json({ members: members(myRole) })),
    http.get('*/v1/chats/:id/invite', () => HttpResponse.json({ code: null })),
    http.get('*/v1/chats/:id/media', () => HttpResponse.json({ items: [], hasMore: false })),
  );
  await seedLocal([chatFixture({ seq: messages.length, ...chat })], messages);
  return renderApp('/chats/c1', { width: DESKTOP_WIDTH });
}

async function openTimerDialog(user: ReturnType<typeof userEvent.setup>, current = 'Off') {
  await user.click(await screen.findByRole('button', { name: 'Chat info', pressed: false }, SLOW));
  const pane = await screen.findByRole('complementary', { name: 'Chat info' });
  await user.click(
    await within(pane).findByRole('button', { name: `Disappearing messages: ${current}` }, SLOW),
  );
  return screen.findByRole('dialog', { name: 'Disappearing messages' });
}

describe('the disappearing-messages timer', () => {
  it('in a 1:1 chat anyone sets it: PUT, the header badge, and no axe violations', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.put('*/v1/chats/:id/disappearing', async ({ request }) => {
        const body = (await request.json()) as { timer: string };
        bodies.push(body);
        return HttpResponse.json({ timer: body.timer });
      }),
    );
    const { container } = await openChat();
    const user = userEvent.setup();
    expect(screen.queryByRole('img', { name: /Disappearing messages:/ })).toBeNull();
    const dialog = await openTimerDialog(user);
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations();
    expect(within(dialog).getByRole('radio', { name: 'Off' })).toBeChecked();
    await user.click(within(dialog).getByRole('radio', { name: '7 days' }));
    await waitFor(() => expect(bodies).toEqual([{ timer: '7d' }]));
    expect(within(dialog).getByRole('radio', { name: '7 days' })).toBeChecked();
    await user.keyboard('{Escape}');
    expect(
      await screen.findByRole('img', { name: 'Disappearing messages: 7 days' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disappearing messages: 7 days' })).toBeVisible();
  });

  it('shows the change at once and puts it back when the server says no', async () => {
    server.use(
      http.put('*/v1/chats/:id/disappearing', () => HttpResponse.json({}, { status: 500 })),
    );
    await openChat({ disappearing: '24h' });
    expect(
      await screen.findByRole('img', { name: 'Disappearing messages: 24 hours' }, SLOW),
    ).toBeInTheDocument();
    const user = userEvent.setup();
    const dialog = await openTimerDialog(user, '24 hours');
    await user.click(within(dialog).getByRole('radio', { name: 'Off' }));
    expect(await screen.findByText('Couldn’t change the timer. Try again.')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(dialog).getByRole('radio', { name: '24 hours' })).toBeChecked(),
    );
    await user.keyboard('{Escape}');
    expect(
      await screen.findByRole('img', { name: 'Disappearing messages: 24 hours' }),
    ).toBeInTheDocument();
  });

  it('in a group set to "Only admins", a member sees it but cannot change it', async () => {
    await openChat({ type: 'group', otherUser: null, group: group() });
    const user = userEvent.setup();
    const dialog = await openTimerDialog(user);
    expect(dialog).toHaveTextContent('Only admins can change this.');
    expect(within(dialog).getByRole('radio', { name: '7 days' })).toBeDisabled();
  });

  it('in a group set to "All members", a member can change it', async () => {
    await openChat({ type: 'group', otherUser: null, group: group({}, 'all') });
    const dialog = await openTimerDialog(userEvent.setup());
    expect(within(dialog).getByRole('radio', { name: '7 days' })).toBeEnabled();
  });

  it('an admin can change it, and can set who may in the group settings', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.put('*/v1/chats/:id/group/settings', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({
          chat: chatFixture({ type: 'group', otherUser: null, group: group({ myRole: 'admin' }) }),
        });
      }),
    );
    await openChat({ type: 'group', otherUser: null, group: group({ myRole: 'admin' }) });
    const user = userEvent.setup();
    const dialog = await openTimerDialog(user);
    expect(within(dialog).getByRole('radio', { name: '90 days' })).toBeEnabled();
    await user.keyboard('{Escape}');
    const settings = await screen.findByRole('region', { name: 'Group settings' });
    await user.selectOptions(
      within(settings).getByRole('combobox', { name: 'Disappearing messages' }),
      'all',
    );
    await waitFor(() => expect(bodies).toEqual([{ disappearing: 'all' }]));
  });

  it('is not offered in Saved Messages', async () => {
    await seedLocal([]);
    await renderApp('/chats/c-saved', { width: DESKTOP_WIDTH });
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Chat info', pressed: false }, SLOW),
    );
    const pane = await screen.findByRole('complementary', { name: 'Chat info' });
    expect(within(pane).queryByRole('button', { name: /Disappearing messages/ })).toBeNull();
  });
});

const changed = (seq: number, value: string, actor = { id: 'u-asha', name: 'Asha' }) =>
  messageFixture(seq, {
    type: 'system',
    senderId: null,
    text: null,
    clientMsgId: null,
    system: { kind: 'disappearing_changed', actor, targets: [], value },
  });

describe('timer system messages', () => {
  it('say who turned it on or off, in a 1:1 chat', async () => {
    const { container } = await openChat({}, [changed(1, '7d'), changed(2, 'off')]);
    expect(
      await screen.findByText(
        'Asha turned on disappearing messages. New messages will disappear 7 days after they’re sent.',
        {},
        SLOW,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Asha turned off disappearing messages.')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('and in a group, with "You" for me', async () => {
    await openChat({ type: 'group', otherUser: null, group: group() }, [
      changed(1, '24h', { id: ME_ID, name: 'Kiran Rao' }),
      changed(2, 'off'),
    ]);
    expect(
      await screen.findByText(
        'You turned on disappearing messages. New messages will disappear 24 hours after they’re sent.',
        {},
        SLOW,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Asha turned off disappearing messages.')).toBeInTheDocument();
  });
});

describe('disappearing messages in the conversation', () => {
  it('carry a timer mark, and leave the moment they expire', async () => {
    const { container } = await openChat({ disappearing: '24h' }, [
      messageFixture(1, { text: 'stays here' }),
      messageFixture(2, { text: 'going soon', expiresAt: soon(2_500) }),
    ]);
    const going = await screen.findByText('going soon', {}, SLOW);
    const bubble = going.closest('[data-seq]') as HTMLElement;
    expect(within(bubble).getByRole('img', { name: 'Disappearing message' })).toBeInTheDocument();
    const staying = screen.getByText('stays here').closest('[data-seq]') as HTMLElement;
    expect(within(staying).queryByRole('img', { name: 'Disappearing message' })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
    await waitFor(() => expect(screen.queryByText('going soon')).toBeNull(), { timeout: 6_000 });
    expect(screen.getByText('stays here')).toBeInTheDocument();
  });
});

describe('Settings → Privacy → Default message timer', () => {
  it('saves the whole privacy object with the new timer', async () => {
    const saved: unknown[] = [];
    server.use(
      http.put('*/v1/me/privacy', async ({ request }) => {
        const body = await request.json();
        saved.push(body);
        return HttpResponse.json({ privacy: body });
      }),
    );
    const { container } = await renderApp('/settings/privacy');
    const timer = await screen.findByRole('radiogroup', { name: 'Default message timer' }, SLOW);
    expect(within(timer).getByRole('radio', { name: 'Off' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.setup().click(within(timer).getByRole('radio', { name: '90 days' }));
    await waitFor(() => expect(saved).toEqual([{ ...privacyFixture, defaultDisappearing: '90d' }]));
    expect(within(timer).getByRole('radio', { name: '90 days' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
