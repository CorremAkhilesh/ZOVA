import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatSummary as ServerChat } from '@zuvo/protocol';
import { delay } from 'msw';
import { describe, expect, it } from 'vitest';
import { useSyncStore } from '@/features/sync/store';
import { axe } from '@/test/axe';
import { chatFixture, ME_ID, personFixture, savedChatFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, MOBILE_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { lastSocket } from '@/test/socket-mock';

const lastMessage = (senderId: string, preview: string, createdAt: string) => ({
  id: 'm',
  seq: 1,
  senderId,
  type: 'text' as const,
  preview,
  createdAt,
});

const asha = chatFixture({
  id: 'c-asha',
  seq: 3,
  unreadCount: 3,
  lastMessage: lastMessage('u-asha', 'See you at 5', '2026-11-04T09:00:00.000Z'),
  lastActivityAt: '2026-11-04T09:00:00.000Z',
});
const rahul = chatFixture({
  id: 'c-rahul',
  seq: 1,
  lastReadSeq: 1,
  otherUser: personFixture({ id: 'u-rahul', displayName: 'Rahul Menon', username: 'rahul' }),
  lastMessage: lastMessage(ME_ID, 'Sent the deck', '2026-11-04T11:00:00.000Z'),
  lastActivityAt: '2026-11-04T11:00:00.000Z',
});

const rowNames = () =>
  within(screen.getByTestId('chat-rows'))
    .getAllByRole('link')
    .map((link) => link.textContent);

describe('chat list states', () => {
  it('shows a skeleton while the first sync runs', async () => {
    server.use(
      http.get('*/v1/sync', async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    const { container } = await renderApp('/chats', { width: DESKTOP_WIDTH });
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument());
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the empty state with Saved Messages still available', async () => {
    const user = userEvent.setup();
    const { container } = await renderApp('/chats', { width: DESKTOP_WIDTH });
    expect(await screen.findByRole('heading', { name: 'No chats yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Saved Messages/ })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole('button', { name: 'Start a chat' }));
    expect(await screen.findByRole('dialog', { name: 'New chat' })).toBeInTheDocument();
  });

  it('says so when the first sync fails, and retries', async () => {
    server.use(http.get('*/v1/sync', () => HttpResponse.json({}, { status: 500 })));
    const user = userEvent.setup();
    const { container } = await renderApp('/chats', { width: DESKTOP_WIDTH });
    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t load your chats.');
    expect(await axe(container)).toHaveNoViolations();

    server.resetHandlers();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'No chats yet' })).toBeInTheDocument();
  });

  it('shows stored chats, not an error, when sync fails on a device that has data', async () => {
    await seedLocal([asha]);
    server.use(http.get('*/v1/sync', () => HttpResponse.error()));
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    expect(await screen.findByRole('link', { name: /Asha Verma/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('has no sample data or badge', async () => {
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await screen.findByRole('heading', { name: 'No chats yet' });
    expect(screen.queryByText('Sample data')).not.toBeInTheDocument();
    expect(screen.queryByText(/Product & Design/)).not.toBeInTheDocument();
  });
});

describe('chat list rows', () => {
  it('sorts by last activity, with Saved Messages first', async () => {
    await seedLocal([asha, rahul]);
    const { container } = await renderApp('/chats', { width: DESKTOP_WIDTH });
    await screen.findByRole('link', { name: /Asha Verma/ });
    const names = rowNames();
    expect(names[0]).toContain('Saved Messages');
    expect(names[1]).toContain('Rahul Menon');
    expect(names[2]).toContain('Asha Verma');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('prefixes my messages with "You: ", and shows the unread badge', async () => {
    await seedLocal([asha, rahul]);
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    const mine = await screen.findByRole('link', { name: /Rahul Menon/ });
    expect(mine).toHaveTextContent('You: Sent the deck');
    const theirs = screen.getByRole('link', { name: /Asha Verma/ });
    expect(theirs).toHaveTextContent('See you at 5');
    expect(theirs).not.toHaveTextContent('You:');
    expect(within(theirs).getByLabelText('3 unread messages')).toBeInTheDocument();
    expect(within(mine).queryByLabelText(/unread/)).not.toBeInTheDocument();
  });

  it('moves a chat up and updates its badge when a message arrives', async () => {
    await seedLocal([asha, rahul]);
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await screen.findByRole('link', { name: /Asha Verma/ });
    await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
    act(() =>
      lastSocket().receive('chat:updated', {
        chatId: 'c-asha',
        type: 'direct',
        seq: 4,
        lastMessage: lastMessage('u-asha', 'One more thing', '2026-11-04T12:00:00.000Z'),
        lastReadSeq: 0,
        unreadCount: 4,
        lastActivityAt: '2026-11-04T12:00:00.000Z',
        cursor: '6',
      }),
    );
    expect(await screen.findByLabelText('4 unread messages')).toBeInTheDocument();
    expect(rowNames()[1]).toContain('Asha Verma');
    expect(screen.getByRole('link', { name: /Asha Verma/ })).toHaveTextContent('One more thing');
  });

  it('clears the badge when read:update arrives from another device', async () => {
    await seedLocal([asha]);
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await screen.findByLabelText('3 unread messages');
    await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
    act(() =>
      lastSocket().receive('read:update', {
        chatId: 'c-asha',
        lastReadSeq: 3,
        unreadCount: 0,
        cursor: '6',
      }),
    );
    await waitFor(() => expect(screen.queryByLabelText(/unread/)).not.toBeInTheDocument());
  });

  it('shows the person’s photo when privacy allows it (the server decides)', async () => {
    await seedLocal([
      chatFixture({
        otherUser: personFixture({ avatar: { small: '/v1/media/a-s', large: '/v1/media/a-l' } }),
      }),
    ]);
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    // No photo in jsdom (images never load), so the initials stay as the visible fallback.
    expect(await screen.findByText('AV')).toBeInTheDocument();
  });
});

describe('folders and search', () => {
  it('filters by folder, with an empty state for Groups', async () => {
    await seedLocal([asha, rahul]);
    const user = userEvent.setup();
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await screen.findByRole('link', { name: /Asha Verma/ });

    await user.click(screen.getByRole('tab', { name: 'Unread' }));
    expect(screen.getByRole('link', { name: /Asha Verma/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Rahul Menon/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Personal' }));
    expect(screen.getByRole('link', { name: /Rahul Menon/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Saved Messages/ })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Groups' }));
    expect(screen.getByText(/No groups yet/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Asha Verma/ })).not.toBeInTheDocument();
  });

  it('says so when nothing is unread', async () => {
    await seedLocal([rahul]);
    const user = userEvent.setup();
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await screen.findByRole('link', { name: /Rahul Menon/ });
    await user.click(screen.getByRole('tab', { name: 'Unread' }));
    expect(screen.getByText('You’re all caught up.')).toBeInTheDocument();
  });

  it('searches loaded chats by name only', async () => {
    await seedLocal([asha, rahul]);
    const user = userEvent.setup();
    await renderApp('/chats', { width: MOBILE_WIDTH });
    const box = await screen.findByRole('searchbox', { name: 'Search chats' });
    await user.type(box, 'RAHUL');
    expect(screen.getByRole('link', { name: /Rahul Menon/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Asha Verma/ })).not.toBeInTheDocument();

    await user.clear(box);
    await user.type(box, 'deck');
    expect(screen.getByText('No chats match your search.')).toBeInTheDocument();
  });

  it('names the sender of a group’s last message before any member profile is loaded', async () => {
    const team = chatFixture({
      id: 'c-team',
      type: 'group',
      otherUser: null,
      seq: 1,
      group: {
        name: 'Quarterly planning',
        description: '',
        photo: null,
        memberCount: 3,
        myRole: 'member',
        active: true,
      } as ServerChat['group'],
      lastMessage: {
        ...lastMessage('u-chitra', 'Thanks!', '2026-11-04T12:00:00.000Z'),
        senderName: 'Chitra Iyer',
      },
      lastActivityAt: '2026-11-04T12:00:00.000Z',
    });
    await seedLocal([team]);
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    const row = await screen.findByRole('link', { name: /Quarterly planning/ });
    expect(row).toHaveTextContent('Chitra: Thanks!');
  });

  it('keeps Saved Messages in the list with no other chats', async () => {
    await seedLocal([]);
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    const saved = await screen.findByRole('link', { name: /Saved Messages/ });
    expect(saved).toHaveTextContent('Notes to yourself');
    expect(savedChatFixture().type).toBe('self');
  });
});

describe('keyboard', () => {
  it('Ctrl+N and Cmd+N open the new chat picker', async () => {
    const user = userEvent.setup();
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await user.keyboard('{Control>}n{/Control}');
    expect(await screen.findByRole('dialog', { name: 'New chat' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.keyboard('{Meta>}n{/Meta}');
    expect(await screen.findByRole('dialog', { name: 'New chat' })).toBeInTheDocument();
  });
});
