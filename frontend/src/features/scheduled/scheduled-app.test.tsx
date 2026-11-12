import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useSyncStore } from '@/features/sync/store';
import { axe } from '@/test/axe';
import { chatFixture } from '@/test/chat-fixtures';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { lastSocket } from '@/test/socket-mock';
import { scheduledFixture, serveScheduled } from './test-server';

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 15_000 };

async function openChat() {
  await seedLocal([chatFixture()]);
  const result = await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
  const input = await screen.findByRole('textbox', { name: 'Write a message' }, SLOW);
  await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
  act(() => lastSocket().receive('connect'));
  return { ...result, input };
}

const sends = () => lastSocket().emitted.filter((entry) => entry.event === 'message:send');

describe('scheduling from a chat', () => {
  it('Send → right click → schedule: nothing is sent now, the box empties, the clock appears', async () => {
    const state = serveScheduled([]);
    const user = userEvent.setup();
    const { input, container } = await openChat();
    expect(screen.queryByRole('button', { name: /scheduled message/ })).toBeNull();
    input.focus();
    await user.keyboard('See you tomorrow');
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Send' }));
    await user.click(await screen.findByRole('button', { name: 'Schedule message' }));
    const dialog = await screen.findByRole('dialog', { name: 'Schedule message' });
    await user.click(within(dialog).getByRole('button', { name: /Tomorrow 9 AM/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Schedule' }));

    await waitFor(() => expect(state.requests).toHaveLength(1));
    expect(state.requests[0]).toMatchObject({
      method: 'POST',
      body: { chatId: 'c1', text: 'See you tomorrow' },
    });
    await waitFor(() => expect(input).toHaveValue(''));
    expect(sends()).toEqual([]);
    expect(
      await screen.findByRole('button', { name: '1 scheduled message' }, SLOW),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('the header clock follows scheduled:updated, and a failure is announced', async () => {
    const state = serveScheduled([scheduledFixture({ id: 's1' }), scheduledFixture({ id: 's2' })]);
    await openChat();
    expect(
      await screen.findByRole('button', { name: '2 scheduled messages' }, SLOW),
    ).toBeInTheDocument();
    state.items = [scheduledFixture({ id: 's1', status: 'failed', failure: 'not_member' })];
    act(() =>
      lastSocket().receive('scheduled:updated', {
        chatId: 'c1',
        failed: { id: 's1', reason: 'not_member' },
      }),
    );
    expect(await screen.findByText('A scheduled message couldn’t be sent')).toBeInTheDocument();
    expect(screen.getByText('You’re no longer a member of this chat.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '1 scheduled message' })).toBeInTheDocument();
  });
});
