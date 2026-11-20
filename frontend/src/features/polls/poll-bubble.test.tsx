import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Poll } from '@zuvo/protocol';
import { describe, expect, it, vi } from 'vitest';
import { useSyncStore } from '@/features/sync/store';
import { axe } from '@/test/axe';
import { ME_ID } from '@/test/chat-fixtures';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { lastSocket } from '@/test/socket-mock';
import { pollChat, pollFixture, pollMessage, servePolls } from './test-server';

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 15_000 };

async function openPoll(poll: Poll, senderId = 'u-asha') {
  await seedLocal([pollChat()], [pollMessage(poll, { senderId })]);
  const result = await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
  const group = await screen.findByRole('group', { name: 'Lunch?' }, SLOW);
  await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull(), SLOW);
  act(() => lastSocket().receive('connect'));
  return { ...result, group };
}

const option = (group: HTMLElement, name: RegExp) => within(group).getByRole('radio', { name });

describe('poll bubble', () => {
  it('shows each option with its votes, percent and a bar, and my choice', async () => {
    const { group, container } = await openPoll(
      pollFixture({
        options: [
          { id: '0', text: 'Pizza', voterIds: ['u-asha', 'u-ravi', ME_ID] },
          { id: '1', text: 'Dosa', voterIds: ['u-dev'] },
          { id: '2', text: 'Salad', voterIds: [] },
        ],
      }),
    );
    expect(within(group).getByRole('radio', { name: 'Pizza, 3 votes, 75 percent' })).toBeChecked();
    expect(
      within(group).getByRole('radio', { name: 'Dosa, 1 vote, 25 percent' }),
    ).not.toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Salad, 0 votes, 0 percent' })).toBeEnabled();
    expect(group).toHaveTextContent('Select one');
    expect(screen.getByText('4 people voted')).toBeInTheDocument();
    const bars = within(group).getAllByTestId('poll-bar');
    expect(bars.map((bar) => bar.style.width)).toEqual(['75%', '25%', '0%']);
    // A track even at 0 votes: the bar sits in a visible (tinted) track.
    expect(bars[2]?.parentElement?.className).toMatch(/bg-text-muted\/25/);
    // Up to three faces per option, and my choice marked with a ✓.
    const faces = within(group).getAllByTestId('poll-faces');
    expect(faces.map((face) => face.children.length)).toEqual([3, 1]);
    const marks = within(group).getAllByTestId('poll-mark');
    expect(marks.map((mark) => mark.querySelector('svg') !== null)).toEqual([true, false, false]);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('votes, changes the vote, and taps the same option again to remove it', async () => {
    const state = servePolls(pollFixture());
    const user = userEvent.setup();
    const { group } = await openPoll(pollFixture());
    await user.click(option(group, /^Dosa/));
    await waitFor(() => expect(option(group, /^Dosa, 2 votes/)).toBeChecked(), SLOW);
    await waitFor(() => expect(state.votes).toEqual([['1']]), SLOW);
    await user.click(option(group, /^Pizza/));
    await waitFor(() => expect(option(group, /^Pizza, 4 votes/)).toBeChecked(), SLOW);
    expect(option(group, /^Dosa, 1 vote/)).not.toBeChecked();
    await user.click(option(group, /^Pizza/));
    await waitFor(() => expect(option(group, /^Pizza, 3 votes/)).not.toBeChecked(), SLOW);
    await waitFor(() => expect(state.votes).toEqual([['1'], ['0'], []]), SLOW);
  });

  it('"Remove vote" takes my vote back', async () => {
    const start = pollFixture({
      options: [
        { id: '0', text: 'Pizza', voterIds: [ME_ID] },
        { id: '1', text: 'Dosa', voterIds: [] },
      ],
    });
    const state = servePolls(start);
    const user = userEvent.setup();
    const { group } = await openPoll(start);
    await user.click(screen.getByRole('button', { name: 'Remove vote' }));
    await waitFor(() => expect(state.votes).toEqual([[]]), SLOW);
    await waitFor(() => expect(option(group, /^Pizza, 0 votes/)).not.toBeChecked(), SLOW);
  });

  it('several answers: checkboxes, each tap adds or removes one', async () => {
    const start = pollFixture({ multiple: true });
    const state = servePolls(start);
    const user = userEvent.setup();
    const { group } = await openPoll(start);
    expect(group).toHaveTextContent('Select one or more');
    await user.click(within(group).getByRole('checkbox', { name: /^Pizza/ }));
    await waitFor(() => expect(state.votes).toHaveLength(1), SLOW);
    await user.click(within(group).getByRole('checkbox', { name: /^Salad/ }));
    await waitFor(() => expect(state.votes).toEqual([['0'], ['0', '2']]), SLOW);
    await waitFor(() =>
      expect(within(group).getByRole('checkbox', { name: /^Salad, 1 vote/ })).toBeChecked(),
    );
    expect(within(group).getByRole('checkbox', { name: /^Pizza, 4 votes/ })).toBeChecked();
  });

  it('puts the vote back and says so when the server refuses it', async () => {
    const state = servePolls(pollFixture(), { refuseVotes: true });
    const user = userEvent.setup();
    const { group } = await openPoll(pollFixture());
    await user.click(option(group, /^Salad/));
    expect(await screen.findByText('This poll is closed.', {}, SLOW)).toBeInTheDocument();
    await waitFor(() => expect(option(group, /^Salad, 0 votes/)).not.toBeChecked(), SLOW);
    await waitFor(() => expect(state.votes).toEqual([['2']]), SLOW);
  });

  it('a closed poll shows its results but takes no votes', async () => {
    const { group } = await openPoll(pollFixture({ closedAt: '2026-11-10T10:00:00.000Z' }));
    expect(group).toHaveTextContent('Poll closed');
    for (const radio of within(group).getAllByRole('radio')) expect(radio).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Close poll' })).toBeNull();
  });

  it('its creator can close it, after confirming', async () => {
    const state = servePolls(pollFixture());
    const user = userEvent.setup();
    const { group } = await openPoll(pollFixture(), ME_ID);
    await user.click(screen.getByRole('button', { name: 'Close poll' }));
    const confirm = await screen.findByRole('dialog', { name: 'Close this poll?' });
    await user.click(within(confirm).getByRole('button', { name: 'Close poll' }));
    await waitFor(() => expect(state.closed).toBe(1), SLOW);
    await waitFor(() => expect(group).toHaveTextContent('Poll closed'), SLOW);
    expect(screen.queryByRole('button', { name: 'Close poll' })).toBeNull();
  });

  it('a member who did not send it is not offered "Close poll"', async () => {
    await openPoll(pollFixture());
    expect(screen.queryByRole('button', { name: 'Close poll' })).toBeNull();
  });
});

describe('poll menu and previews', () => {
  it('can be replied to and starred, but not forwarded or edited; the quote says it is a poll', async () => {
    await openPoll(pollFixture(), ME_ID);
    fireEvent.contextMenu(screen.getByRole('group', { name: 'Lunch?' }));
    const menu = await screen.findByRole('menu', { name: 'Message actions' });
    expect(within(menu).queryByRole('menuitem', { name: 'Forward' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Edit' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Star' })).toBeInTheDocument();
    // The chat list already says it; then the "Replying to" banner does too.
    expect(screen.getAllByText('📊 Poll: Lunch?')).toHaveLength(1);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Reply' }));
    await waitFor(() => expect(screen.getAllByText('📊 Poll: Lunch?')).toHaveLength(2), SLOW);
  });

  it('the chat list says "📊 Poll:" and the question, in my language', async () => {
    await seedLocal([pollChat()]);
    const { container } = await renderApp('/chats', { width: DESKTOP_WIDTH });
    expect(await screen.findByText('📊 Poll: Lunch?', {}, SLOW)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    const { i18n } = await import('@/lib/i18n');
    await act(() => i18n.changeLanguage('hi'));
    expect(await screen.findByText('📊 पोल: Lunch?')).toBeInTheDocument();
  });
});
