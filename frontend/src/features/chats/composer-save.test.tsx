import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getUserDb } from '@/features/sync/local-db';
import { useSyncStore } from '@/features/sync/store';
import { chatFixture, ME_ID } from '@/test/chat-fixtures';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { lastSocket } from '@/test/socket-mock';

// Live bug (sync stress, Firefox): a message typed and sent was neither on the server nor in the
// outbox. The composer emptied the box at once and never looked at whether the message had been
// saved. Now the message is saved in the outbox first, and only then does the box empty; if saving
// fails, the words stay and the person is told.

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 15_000 };
afterEach(() => vi.restoreAllMocks());

async function open() {
  await seedLocal([chatFixture()]);
  await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
  const input = await screen.findByRole('textbox', { name: 'Write a message' }, SLOW);
  await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
  act(() => lastSocket().receive('connect'));
  return input;
}

/** My messages on this device: in the outbox, or already sent from it. */
const queued = async () =>
  (await getUserDb(ME_ID).messages.toArray())
    .filter((row) => row.senderId === ME_ID)
    .map((row) => row.text);

describe('send: saved first, then the box empties', () => {
  it('saving fails: the words stay in the box, an error says so, and nothing is lost', async () => {
    const user = userEvent.setup();
    const input = await open();
    const db = getUserDb(ME_ID);
    // The device's database refuses the write (full, closed, a browser bug).
    const add = vi.spyOn(db.outbox, 'add').mockRejectedValueOnce(new Error('QuotaExceededError'));
    input.focus();
    await user.keyboard('Quarterly numbers attached{Enter}');
    await waitFor(() => expect(add).toHaveBeenCalled());
    expect(await screen.findByText(/Couldn’t save your message/, {}, SLOW)).toBeInTheDocument();
    expect(input).toHaveValue('Quarterly numbers attached');
    expect(await queued()).toEqual([]);
    // Trying again works, and only then does the box empty.
    await user.keyboard('{Enter}');
    await waitFor(() => expect(input).toHaveValue(''), SLOW);
    expect(await queued()).toEqual(['Quarterly numbers attached']);
  });

  it('the box empties only once the message is in the outbox; words typed meanwhile are kept', async () => {
    const user = userEvent.setup();
    const input = await open();
    const client = useSyncStore.getState().client;
    if (!client) throw new Error('no client');
    let release: () => void = () => undefined;
    const real = client.sendText.bind(client);
    vi.spyOn(client, 'sendText').mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return real(...args);
    });
    input.focus();
    await user.keyboard('first{Enter}');
    // Still saving: the words are still there.
    expect(input).toHaveValue('first');
    await act(async () => release());
    await waitFor(() => expect(input).toHaveValue(''), SLOW);
    expect(await queued()).toEqual(['first']);

    // Typed while the save was running: not wiped by it.
    vi.spyOn(client, 'sendText').mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return real(...args);
    });
    await user.keyboard('second{Enter}');
    await user.keyboard(' and more');
    await act(async () => release());
    await waitFor(async () => expect(await queued()).toContain('second'), SLOW);
    expect(input).toHaveValue('second and more');
  });
});
