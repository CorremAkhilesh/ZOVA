import { act, screen, waitFor } from '@testing-library/react';
import type { PinnedMessage } from '@zuvo/protocol';
import { describe, expect, it, vi } from 'vitest';
import { useSyncStore } from '@/features/sync/store';
import { chatFixture, messageFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { lastSocket } from '@/test/socket-mock';

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 10_000 };
const pinOf = (seq: number): PinnedMessage => ({
  messageId: `m${seq}`,
  seq,
  pinnedBy: 'u-asha',
  pinnedAt: '2026-11-10T10:00:00.000Z',
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
});
const bar = () => screen.queryByRole('button', { name: /pinned message/ });

async function openChat(pins: PinnedMessage[], deleted: number[] = []) {
  const messages = [1, 2, 3].map((seq) =>
    messageFixture(seq, {
      text: deleted.includes(seq) ? null : `point ${seq}`,
      deletedForEveryoneAt: deleted.includes(seq) ? '2026-11-10T11:00:00.000Z' : null,
      createdAt: `2026-11-10T10:0${seq}:00.000Z`,
    }),
  );
  await seedLocal([chatFixture({ seq: 3, pins })], messages);
  return renderApp('/chats/c1', { width: DESKTOP_WIDTH });
}

describe('a pinned message that is deleted', () => {
  it('deleted for everyone here: its pin is skipped and the next pin shows', async () => {
    await openChat([pinOf(3), pinOf(1)], [3]);
    const shown = await screen.findByRole('button', { name: 'Go to pinned message 1 of 1' }, SLOW);
    await waitFor(() => expect(shown).toHaveTextContent('point 1'));
  });

  it('the only pinned one deleted: no pin bar at all', async () => {
    await openChat([pinOf(2)], [2]);
    await screen.findByText('point 1', {}, SLOW);
    expect(bar()).toBeNull();
  });

  it('the server’s new pins (chat:updated) replace the old: next pin, then none', async () => {
    // The server as it is after each change: a chat:updated with a last message leaves the cursor
    // to sync, which brings the chat with its pins.
    let now = { cursor: '5', pins: [pinOf(3), pinOf(1)] };
    server.use(
      http.get('*/v1/sync', ({ request }) => {
        const since = new URL(request.url).searchParams.get('since');
        const changed = Number(now.cursor) > Number(since);
        return HttpResponse.json({
          cursor: now.cursor,
          reset: false,
          hasMore: false,
          chats: changed ? [chatFixture({ seq: 3, pins: now.pins })] : [],
          messages: [],
        });
      }),
    );
    await openChat(now.pins);
    await screen.findByRole('button', { name: 'Go to pinned message 1 of 2' }, SLOW);
    await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
    const update = (pins: PinnedMessage[], cursor: string) => {
      now = { cursor, pins };
      return act(() =>
        lastSocket().receive('chat:updated', {
          chatId: 'c1',
          type: 'direct',
          seq: 3,
          lastMessage: null,
          lastReadSeq: 3,
          unreadCount: 0,
          lastActivityAt: null,
          pins,
          cursor,
        }),
      );
    };
    update([pinOf(1)], '6');
    const next = await screen.findByRole('button', { name: 'Go to pinned message 1 of 1' }, SLOW);
    await waitFor(() => expect(next).toHaveTextContent('point 1'));
    update([], '7');
    await waitFor(() => expect(bar()).toBeNull());
  });
});
