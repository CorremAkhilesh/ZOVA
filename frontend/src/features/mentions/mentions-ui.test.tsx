import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GroupInfo, GroupMember, PublicProfile } from '@zuvo/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMessageUi } from '@/features/messages/store';
import { getUserDb } from '@/features/sync/local-db';
import { useSyncStore } from '@/features/sync/store';
import { axe } from '@/test/axe';
import { chatFixture, ME_ID, messageFixture, personFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { lastSocket } from '@/test/socket-mock';
import { useMentionProfile } from './mention-marks';

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 10_000 };

const group = (myRole: GroupInfo['myRole'] = 'member'): GroupInfo => ({
  name: 'Launch team',
  description: '',
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
  myRole,
  active: true,
});
const person = (id: string, displayName: string): PublicProfile =>
  personFixture({ id, displayName, username: displayName.toLowerCase() });
const riya = person('u-riya', 'Riya Sen');
const vikram = person('u-vikram', 'Vikram');
const members: GroupMember[] = [
  { user: person(ME_ID, 'Kiran Rao'), role: 'owner', joinedAt: '2026-11-01T10:00:00.000Z' },
  { user: riya, role: 'member', joinedAt: '2026-11-01T10:00:00.000Z' },
  { user: vikram, role: 'member', joinedAt: '2026-11-01T10:00:00.000Z' },
];

async function openGroup(
  myRole: GroupInfo['myRole'],
  messages: Parameters<typeof seedLocal>[1] = [],
  extra: Parameters<typeof chatFixture>[0] = {},
) {
  server.use(
    http.get('*/v1/chats/:id/members', () => HttpResponse.json({ members })),
    http.get('*/v1/users/:id', ({ params }) =>
      HttpResponse.json({ user: members.find((m) => m.user.id === params.id)?.user }),
    ),
  );
  await seedLocal(
    [
      chatFixture({
        type: 'group',
        otherUser: null,
        group: group(myRole),
        seq: messages?.length ?? 0,
        ...extra,
      }),
    ],
    messages,
  );
  const result = await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
  const input = await screen.findByRole('textbox', { name: 'Write a message' }, SLOW);
  await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
  act(() => lastSocket().receive('connect'));
  return { ...result, input };
}

/** The name without the avatar's initials. */
const nameOf = (element: HTMLElement) =>
  element.querySelector('[data-name]')?.textContent ?? element.textContent;
const sent = () =>
  lastSocket()
    .emitted.filter((entry) => entry.event === 'message:send')
    .map((entry) => entry.payload);

beforeEach(() => {
  useMentionProfile.getState().close();
  useMessageUi.setState({ jump: null });
});

describe('mentioning in a group', () => {
  it('"@" lists members to pick with the keyboard, and the mention goes with the message', async () => {
    const { input, container } = await openGroup('member');
    const user = userEvent.setup();
    input.focus();
    await user.keyboard('ask @');
    const list = await screen.findByRole('listbox', { name: 'Mention someone' }, SLOW);
    expect(within(list).getAllByRole('option').map(nameOf)).toEqual(['Riya Sen', 'Vikram']);
    expect(within(list).queryByText(/everyone/)).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(input).toHaveValue('ask @Vikram ');
    expect(screen.queryByRole('listbox', { name: 'Mention someone' })).toBeNull();
    await user.keyboard('please');
    // Enter only once the text is in, so a slow runner sends the whole of it.
    await waitFor(() => expect(input).toHaveValue('ask @Vikram please'));
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(sent().at(-1)).toMatchObject({
        text: 'ask @Vikram please',
        mentions: [{ userId: 'u-vikram', offset: 4, length: 7 }],
      }),
    );
  });

  it('keeps what I type after picking a mention in order, even when frames lag', async () => {
    // A slow machine: animation frames run late, after the next keys.
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    try {
      const { input } = await openGroup('member');
      const user = userEvent.setup();
      input.focus();
      await user.keyboard('ask @');
      await screen.findByRole('listbox', { name: 'Mention someone' }, SLOW);
      await user.keyboard('{ArrowDown}{Enter}');
      await user.keyboard('p');
      for (const frame of frames.splice(0)) frame(performance.now());
      await user.keyboard('lease');
      expect(input).toHaveValue('ask @Vikram please');
    } finally {
      raf.mockRestore();
    }
  });

  it('filters as I type, closes on Esc, and offers @everyone to admins', async () => {
    const { input } = await openGroup('owner');
    const user = userEvent.setup();
    input.focus();
    await user.keyboard('@');
    expect(await screen.findByRole('option', { name: /everyone/ }, SLOW)).toBeInTheDocument();
    await user.keyboard('ri');
    expect(screen.getAllByRole('option').map(nameOf)).toEqual(['Riya Sen']);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox', { name: 'Mention someone' })).toBeNull();
    await user.clear(input);
    input.focus();
    await user.keyboard('@everyone meeting{Enter}');
    await waitFor(() => expect(sent().at(-1)).toMatchObject({ mentionsEveryone: true }));
  });

  it('shows mentions as names that open a profile, and people who left as plain text', async () => {
    const text = 'thanks @Riya Sen and @Gone Person';
    await openGroup('member', [
      messageFixture(1, {
        chatId: 'c1',
        senderId: 'u-vikram',
        text,
        mentions: [
          { userId: 'u-riya', offset: 7, length: 9 },
          { userId: 'u-gone', offset: 21, length: 12 },
        ],
      }),
    ]);
    const mention = await screen.findByRole('button', { name: '@Riya Sen' }, SLOW);
    expect(screen.queryByRole('button', { name: '@Gone Person' })).toBeNull();
    expect(screen.getByText(/@Gone Person/)).toBeInTheDocument();
    fireEvent.click(mention);
    const dialog = await screen.findByRole('dialog', { name: 'Profile' }, SLOW);
    await waitFor(() => expect(dialog).toHaveTextContent('Riya Sen'), SLOW);
  });

  it('an "@" in the list, and a button in the chat that goes through my mentions', async () => {
    await openGroup(
      'member',
      [messageFixture(1, { chatId: 'c1' }), messageFixture(2, { chatId: 'c1' })],
      { mentionSeqs: [1, 2], lastReadSeq: 0, unreadCount: 2 },
    );
    expect(await screen.findByLabelText('2 messages mention you', {}, SLOW)).toHaveTextContent('@');
    // Opening the chat at the bottom reads it, and the server clears the mentions: the button stays.
    const jumpName = { name: 'Go to the message that mentions you' };
    await screen.findByRole('button', jumpName, SLOW);
    await getUserDb(ME_ID).chats.update('c1', { lastReadSeq: 2, mentionSeqs: [], unreadCount: 0 });
    await waitFor(() => expect(screen.queryByLabelText('2 messages mention you')).toBeNull());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', jumpName));
    await waitFor(
      () => expect(document.querySelector('[data-seq="1"]')).toHaveClass(/bg-brand/),
      SLOW,
    );
    await user.click(screen.getByRole('button', jumpName));
    await waitFor(
      () => expect(document.querySelector('[data-seq="2"]')).toHaveClass(/bg-brand/),
      SLOW,
    );
    expect(screen.queryByRole('button', jumpName)).toBeNull();
  });
});
