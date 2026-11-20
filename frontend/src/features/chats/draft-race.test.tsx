import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { getUserDb } from '@/features/sync/local-db';
import { useSyncStore } from '@/features/sync/store';
import { chatFixture, ME_ID } from '@/test/chat-fixtures';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { lastSocket } from '@/test/socket-mock';

// Live bug (sync stress, Firefox): 5 messages lost and 4 sent twice. The chat's row changes with
// every message, so its draft is read again and again; one such read could carry an OLDER draft (the
// previous message) right after a save, and the box took it. Send then sent the old words again and
// the new ones were gone. Only a draft newer than my own last save may replace what I am writing.

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 15_000 };

const sends = () =>
  lastSocket()
    .emitted.filter((entry) => entry.event === 'message:send')
    .map((entry) => (entry.payload as { text: string }).text);
const savedDraft = async () => (await getUserDb(ME_ID).chats.get('c1'))?.draft;

describe('drafts never put old words back into the box', () => {
  it('an older draft read late does not replace what I am writing, so nothing is lost or doubled', async () => {
    await seedLocal([chatFixture()]);
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    const input = await screen.findByRole('textbox', { name: 'Write a message' }, SLOW);
    await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
    act(() => lastSocket().receive('connect'));
    const user = userEvent.setup();
    input.focus();

    await user.keyboard('first');
    await waitFor(async () => expect((await savedDraft())?.text).toBe('first'), SLOW);
    const older = await savedDraft();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(input).toHaveValue(''), SLOW);

    await user.keyboard('second');
    await waitFor(async () => expect((await savedDraft())?.text).toBe('second'), SLOW);
    // The older draft comes back late (a stale read, or an old draft back from the server).
    await act(async () => {
      await getUserDb(ME_ID).chats.update('c1', { draft: older ?? null });
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(input).toHaveValue('second');

    await user.keyboard('{Enter}');
    await waitFor(() => expect(sends()).toEqual(['first', 'second']), SLOW);
  });

  it('a newer draft from another device still shows when I am not typing', async () => {
    await seedLocal([chatFixture()]);
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    const input = await screen.findByRole('textbox', { name: 'Write a message' }, SLOW);
    await act(async () => {
      await getUserDb(ME_ID).chats.update('c1', {
        draft: {
          text: 'from my laptop',
          replyTo: null,
          updatedAt: new Date(Date.now() + 1000).toISOString(),
        },
      });
    });
    await waitFor(() => expect(input).toHaveValue('from my laptop'), SLOW);
  });
});
