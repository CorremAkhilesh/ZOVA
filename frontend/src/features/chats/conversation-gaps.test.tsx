import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { resetGapMemory } from '@/features/sync/gap-fill';
import { chatFixture, messageFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 10_000 };

describe('an open chat with a message the device missed', () => {
  it('the chat list says 3 messages, the device has 2: the third is fetched and shows', async () => {
    resetGapMemory();
    const asked: string[] = [];
    server.use(
      http.get('*/v1/chats/c1/messages', ({ request }) => {
        const url = new URL(request.url);
        asked.push(`${url.searchParams.get('after')}-${url.searchParams.get('before')}`);
        return HttpResponse.json({
          items: [messageFixture(3, { text: 'notes.txt is here' })],
          hasMore: false,
        });
      }),
    );
    // As the CI device was: the chat line (seq 3, "1 unread") without message 3 stored.
    await seedLocal(
      [chatFixture({ seq: 3, unreadCount: 1 })],
      [1, 2].map((seq) => messageFixture(seq)),
    );
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    expect(await screen.findByText('notes.txt is here', {}, SLOW)).toBeInTheDocument();
    expect(asked).toContain('2-4');
  });
});
