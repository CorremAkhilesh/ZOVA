import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setPresence } from '@/features/sync/live-status';
import { useSyncStore } from '@/features/sync/store';
import { axe } from '@/test/axe';
import { chatFixture, ME_ID, messageFixture, personFixture } from '@/test/chat-fixtures';
import { DESKTOP_WIDTH, MOBILE_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { lastSocket } from '@/test/socket-mock';

const USER = personFixture().id;

describe('on screen', () => {
  const mine = (seq: number) => messageFixture(seq, { senderId: ME_ID, text: `mine ${seq}` });
  const lastMine = {
    id: 'm1',
    seq: 1,
    senderId: ME_ID,
    type: 'text' as const,
    preview: 'mine 1',
    createdAt: '2026-11-05T10:00:00.000Z',
  };

  async function connected() {
    await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
    act(() => lastSocket().receive('connect'));
  }

  it('moves a bubble and the list preview through the ticks as receipts arrive', async () => {
    await seedLocal([chatFixture({ seq: 1, lastReadSeq: 1, lastMessage: lastMine })], [mine(1)]);
    const { container } = await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    const thread = await screen.findByRole('list', { name: 'Asha Verma' });
    expect(await within(thread).findByRole('img', { name: 'Sent' })).toBeInTheDocument();
    const row = screen.getByRole('link', { name: /Asha Verma/ });
    expect(within(row).getByRole('img', { name: 'Sent' })).toBeInTheDocument();
    await connected();

    const receipt = (lastDeliveredSeq: number, lastReadSeq: number, cursor: string) =>
      act(() =>
        lastSocket().receive('receipt:update', {
          chatId: 'c1',
          userId: USER,
          lastDeliveredSeq,
          lastReadSeq,
          cursor,
        }),
      );
    receipt(1, 0, '6');
    expect(await within(thread).findByRole('img', { name: 'Delivered' })).toBeInTheDocument();
    expect(await within(row).findByRole('img', { name: 'Delivered' })).toBeInTheDocument();

    receipt(1, 1, '7');
    const read = await within(thread).findByRole('img', { name: 'Read' });
    expect(read.getAttribute('class')).toContain('text-bubble-outgoing-read');
    // The list's dark teal on the indigo bubble would be close to invisible in the light theme.
    expect(read.getAttribute('class')).not.toContain('text-accent-text');
    expect(await within(row).findByRole('img', { name: 'Read' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    // Read stays read, whatever arrives later.
    receipt(1, 0, '8');
    expect(await within(thread).findByRole('img', { name: 'Read' })).toBeInTheDocument();
  });

  it('acknowledges what this device stored, once, in one batch', async () => {
    const theirs = { ...lastMine, senderId: USER, preview: 'hi' };
    await seedLocal([chatFixture({ seq: 3, lastMessage: { ...theirs, seq: 3 }, unreadCount: 3 })]);
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await screen.findByRole('link', { name: /Asha Verma/ });
    await connected();
    const acks = () => lastSocket().emitted.filter((entry) => entry.event === 'delivered:update');
    await waitFor(() => expect(acks()).toHaveLength(1));
    expect(acks()[0]?.payload).toEqual({ chatId: 'c1', seq: 3 });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(acks()).toHaveLength(1);
  });

  it('does not acknowledge my own last message, or Saved Messages', async () => {
    await seedLocal([chatFixture({ seq: 1, lastReadSeq: 1, lastMessage: lastMine })]);
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await screen.findByRole('link', { name: /Asha Verma/ });
    await connected();
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(lastSocket().emitted.filter((entry) => entry.event === 'delivered:update')).toEqual([]);
  });

  it('shows typing in the header and the list, and the online dot', async () => {
    await seedLocal([chatFixture()]);
    const { container } = await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    await connected();
    expect(await screen.findByText('@asha')).toBeInTheDocument();

    act(() => setPresence({ userId: USER, online: true, lastSeenAt: null }));
    expect(await screen.findByText('online')).toBeInTheDocument();
    expect(container.querySelector('.bg-accent.rounded-full')).toBeInTheDocument();

    act(() => lastSocket().receive('typing:update', { chatId: 'c1', userId: USER, typing: true }));
    expect(await screen.findAllByText('typing…')).toHaveLength(2);
    expect(await axe(container)).toHaveNoViolations();
    act(() => lastSocket().receive('typing:update', { chatId: 'c1', userId: USER, typing: false }));
    await waitFor(() => expect(screen.queryByText('typing…')).not.toBeInTheDocument());

    const seen = new Date();
    act(() => setPresence({ userId: USER, online: false, lastSeenAt: seen.toISOString() }));
    expect(await screen.findByText(/last seen today at/)).toBeInTheDocument();
  });

  it('shows the @username, and no dot, when presence is hidden', async () => {
    await seedLocal([chatFixture()]);
    const { container } = await renderApp('/chats/c1', { width: MOBILE_WIDTH });
    await connected();
    act(() => setPresence({ userId: USER, online: false, lastSeenAt: null }));
    expect(await screen.findByText('@asha')).toBeInTheDocument();
    expect(container.querySelector('.bg-accent.rounded-full')).not.toBeInTheDocument();
  });

  it('asks about the open chat, and asks again when told privacy changed', async () => {
    await seedLocal([chatFixture()]);
    await renderApp('/chats/c1', { width: MOBILE_WIDTH });
    await connected();
    const asks = () => lastSocket().emitted.filter((entry) => entry.event === 'presence:subscribe');
    await waitFor(() => expect(asks().at(-1)?.payload).toEqual({ userIds: [USER] }));
    const before = asks().length;
    act(() => lastSocket().receive('presence:resubscribe', {}));
    await waitFor(() => expect(asks().length).toBe(before + 1));
  });

  it('tells the server when typing starts and stops', async () => {
    await seedLocal([chatFixture()]);
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    const box = await screen.findByRole('textbox', { name: 'Write a message' });
    await connected();
    const typing = () =>
      lastSocket()
        .emitted.filter((entry) => entry.event.startsWith('typing:'))
        .map((entry) => entry.event);
    fireEvent.change(box, { target: { value: 'h' } });
    fireEvent.change(box, { target: { value: 'he' } });
    expect(typing()).toEqual(['typing:start']);
    fireEvent.blur(box);
    expect(typing()).toEqual(['typing:start', 'typing:stop']);
  });
});
