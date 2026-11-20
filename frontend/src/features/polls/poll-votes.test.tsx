import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatSummary, GroupMember, Poll } from '@zuvo/protocol';
import { describe, expect, it, vi } from 'vitest';
import { useSyncStore } from '@/features/sync/store';
import { axe } from '@/test/axe';
import { ME_ID, personFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { lastSocket } from '@/test/socket-mock';
import { pollChat, pollFixture, pollMessage, servePolls } from './test-server';

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 15_000 };

const people = ['Asha Verma', 'Ravi Shah', 'Meera Nair', 'Dev Rao', 'Isha Paul', 'Kabir Das'];
const ids = people.map((_, index) => `u-p${index}`);
const groupInfo = (myRole: 'member' | 'admin') => ({
  name: 'Lunch club',
  description: '',
  photo: null,
  memberCount: people.length + 1,
  settings: {
    editInfo: 'all' as const,
    sendMessages: 'all' as const,
    addMembers: 'admins' as const,
    pinMessages: 'all' as const,
    mentionEveryone: 'admins' as const,
    disappearing: 'admins' as const,
  },
  myRole,
  active: true,
});
const members: GroupMember[] = [
  {
    user: personFixture({ id: ME_ID, displayName: 'Kiran Rao' }),
    role: 'member',
    joinedAt: '2026-11-01T10:00:00.000Z',
  },
  ...people.map((displayName, index) => ({
    user: personFixture({ id: ids[index] ?? '', displayName, username: `p${index}` }),
    role: 'member' as const,
    joinedAt: '2026-11-01T10:00:00.000Z',
  })),
];

async function openGroupPoll(poll: Poll, myRole: 'member' | 'admin' = 'member', senderId = 'u-p0') {
  server.use(
    http.get('*/v1/chats/:id/members', () => HttpResponse.json({ members })),
    http.get('*/v1/chats/:id/invite', () => HttpResponse.json({ code: null })),
  );
  const chat = pollChat({
    type: 'group',
    otherUser: null,
    group: groupInfo(myRole),
  } as Partial<ChatSummary>);
  await seedLocal([chat], [pollMessage(poll, { senderId })]);
  const result = await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
  const group = await screen.findByRole('group', { name: 'Lunch?' }, SLOW);
  await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
  act(() => lastSocket().receive('connect'));
  return { ...result, group };
}

describe('View votes', () => {
  it('the question, each option with its count, and who voted when; long lists show all on request', async () => {
    const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    const poll = pollFixture({
      options: [
        { id: '0', text: 'Pizza', voterIds: [...ids, ME_ID] },
        { id: '1', text: 'Dosa', voterIds: [] },
      ],
      votedAt: Object.fromEntries([...ids, ME_ID].map((id, index) => [id, at(index + 1)])),
    });
    const user = userEvent.setup();
    await openGroupPoll(poll);
    const view = screen.getByRole('button', { name: /^View votes/ });
    // Touch screens give it 44×44 px to tap (globals.css, .tap-target).
    expect(view).toHaveClass('tap-target');
    await user.click(view);
    const sheet = await screen.findByRole('dialog', { name: 'Lunch?' }, SLOW);
    expect(sheet).toHaveTextContent('7 people voted');
    expect(
      within(sheet).getByRole('heading', { name: /Pizza.*Your vote.*7 votes/ }),
    ).toBeInTheDocument();
    expect(within(sheet).getByText('No votes yet')).toBeInTheDocument();
    const list = within(sheet).getByRole('list', { name: 'Who voted for Pizza' });
    // Newest first, five at once, each with a time.
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(5));
    // Named from the group's members, once they have loaded.
    await waitFor(() =>
      expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Asha Verma'),
    );
    expect(within(list).getAllByRole('listitem')[0]?.querySelector('time')?.textContent).not.toBe(
      '',
    );
    expect(await axe(sheet)).toHaveNoViolations();
    await user.click(within(sheet).getByRole('button', { name: 'Show all (7)' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(7);
    expect(within(list).getByText('You')).toBeInTheDocument();
  });
});

describe('voting offline', () => {
  it('shows my vote at once and sends it when the connection is back', async () => {
    const state = servePolls(pollFixture(), { senderId: 'u-p0' });
    const user = userEvent.setup();
    const { group } = await openGroupPoll(pollFixture());
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    await user.click(within(group).getByRole('radio', { name: /^Salad/ }));
    await waitFor(() =>
      expect(within(group).getByRole('radio', { name: /^Salad, 1 vote/ })).toBeChecked(),
    );
    expect(state.votes).toEqual([]);
    onLine.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
      lastSocket().receive('connect');
    });
    await waitFor(() => expect(state.votes).toEqual([['2']]), SLOW);
    onLine.mockRestore();
  });
});

describe('closing', () => {
  it('a group admin may close someone else’s poll; a member may not', async () => {
    const state = servePolls(pollFixture(), { senderId: 'u-p0' });
    const user = userEvent.setup();
    const { group } = await openGroupPoll(pollFixture(), 'admin');
    await user.click(screen.getByRole('button', { name: 'Close poll' }));
    const confirm = await screen.findByRole('dialog', { name: 'Close this poll?' });
    await user.click(within(confirm).getByRole('button', { name: 'Close poll' }));
    await waitFor(() => expect(state.closed).toBe(1));
    await waitFor(() => expect(group).toHaveTextContent('Poll closed'));
  });
});
