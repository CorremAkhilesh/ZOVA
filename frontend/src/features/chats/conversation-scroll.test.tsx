import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { getUserDb } from '@/features/sync/local-db';
import { useSyncStore } from '@/features/sync/store';
import { axe } from '@/test/axe';
import { chatFixture, ME_ID, messageFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { lastSocket } from '@/test/socket-mock';

const SEQ = 40;
const chat = chatFixture({ seq: SEQ, lastReadSeq: SEQ });
const history = Array.from({ length: SEQ }, (_, index) =>
  messageFixture(index + 1, { senderId: index % 3 === 0 ? ME_ID : 'u-asha' }),
);

/** jsdom has no layout: gives the message list real-looking scroll numbers. */
function scrollState(top: number, height = 5000, client = 800) {
  const viewport = screen.getByLabelText('Messages');
  Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: height });
  Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: client });
  viewport.scrollTop = top;
  fireEvent.scroll(viewport);
  return viewport;
}

async function ready() {
  await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
}

async function connectSocket() {
  await ready();
  act(() => lastSocket().receive('connect'));
}

const reads = () => lastSocket().emitted.filter((entry) => entry.event === 'read:update');

/** A pushed message goes socket → sync engine → Dexie → live query: slow on a busy CI runner. */
const ARRIVAL = { timeout: 15_000 };
// Room for those waits: the default 5 s per test would end them early.
vi.setConfig({ testTimeout: 30_000 });

function arrives(seq: number, cursor: string) {
  act(() => lastSocket().receive('message:new', { message: messageFixture(seq), cursor }));
}

describe('loading older messages', () => {
  const recent = history.slice(-35);
  const tail = chatFixture({ seq: SEQ, lastReadSeq: SEQ });

  it('asks for the page before the oldest message when scrolled near the top', async () => {
    await seedLocal([tail], recent);
    const before: Array<string | null> = [];
    server.use(
      http.get('*/v1/chats/c1/messages', async ({ request }) => {
        before.push(new URL(request.url).searchParams.get('before'));
        await delay(30);
        return HttpResponse.json({ items: history.slice(0, 5), hasMore: false });
      }),
    );
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    await screen.findByRole('list', { name: 'Asha Verma' });
    await ready();
    scrollState(100);
    expect(await screen.findByText('Loading older messages…')).toBeInTheDocument();
    await waitFor(() => expect(before).toEqual(['6']));
    await waitFor(async () => expect(await getUserDb(ME_ID).messages.count()).toBe(SEQ), ARRIVAL);
    await waitFor(
      () => expect(screen.queryByText('Loading older messages…')).not.toBeInTheDocument(),
      ARRIVAL,
    );

    // The start of the chat is known now: no more requests.
    scrollState(0);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(before).toHaveLength(1);
  });

  it('keeps the reader’s place when older messages arrive above', async () => {
    await seedLocal([tail], recent);
    server.use(
      http.get('*/v1/chats/c1/messages', () =>
        HttpResponse.json({ items: history.slice(0, 5), hasMore: false }),
      ),
    );
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    await screen.findByRole('list', { name: 'Asha Verma' });
    await ready();
    const viewport = scrollState(100);
    await waitFor(async () => expect(await getUserDb(ME_ID).messages.count()).toBe(SEQ), ARRIVAL);
    // Stays away from the bottom: it did not jump to the end. (Exact pixels: see e2e/chat.spec.ts.)
    await waitFor(() => expect(viewport.scrollTop).toBeGreaterThanOrEqual(100));
    expect(viewport.scrollTop).toBeLessThan(5000);
    expect(screen.getByRole('button', { name: /Jump to latest/ })).toBeInTheDocument();
  });

  it('offers a retry when older messages fail to load', async () => {
    await seedLocal([tail], recent);
    server.use(http.get('*/v1/chats/c1/messages', () => HttpResponse.error()));
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    await screen.findByRole('list', { name: 'Asha Verma' });
    await ready();
    scrollState(100);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load older messages.');
  });
});

describe('sticking to the bottom', () => {
  it('stays at the bottom when a message arrives there', async () => {
    await seedLocal([chat], history);
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    await screen.findByRole('list', { name: 'Asha Verma' });
    await ready();
    const viewport = screen.getByLabelText('Messages');
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 7777 });
    arrives(41, '6');
    await screen.findByText('message 41', undefined, ARRIVAL);
    await waitFor(() => expect(viewport.scrollTop).toBe(7777), ARRIVAL);
    expect(screen.queryByRole('button', { name: /Jump to latest/ })).not.toBeInTheDocument();
  });

  it('counts new messages on the jump button when scrolled up, and jumps', async () => {
    await seedLocal([chat], history);
    const user = userEvent.setup();
    const { container } = await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    await screen.findByRole('list', { name: 'Asha Verma' });
    await ready();
    const viewport = scrollState(2000);
    const jump = await screen.findByRole('button', { name: /Jump to latest/ });
    expect(jump).not.toHaveTextContent(/\d/);

    arrives(41, '6');
    arrives(42, '7');
    await waitFor(() => expect(jump).toHaveTextContent('2'), ARRIVAL);
    // The reader was not moved.
    expect(viewport.scrollTop).toBe(2000);
    expect(await axe(container)).toHaveNoViolations();

    await user.click(jump);
    expect(viewport.scrollTop).toBe(5000);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Jump to latest/ })).not.toBeInTheDocument(),
    );
  });
});

describe('read state', () => {
  const unread = chatFixture({ seq: SEQ, lastReadSeq: 30, unreadCount: 10 });

  it('sends read:update when open, visible and at the bottom', async () => {
    await seedLocal([unread], history);
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    await screen.findByRole('list', { name: 'Asha Verma' });
    await connectSocket();
    await waitFor(() => expect(reads()).toHaveLength(1), ARRIVAL);
    expect(reads()[0]?.payload).toEqual({ chatId: 'c1', seq: SEQ });
    await waitFor(() => expect(screen.queryByLabelText(/unread/)).not.toBeInTheDocument(), ARRIVAL);
  });

  it('waits for the connection', async () => {
    await seedLocal([unread], history);
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    await screen.findByRole('list', { name: 'Asha Verma' });
    await ready();
    expect(reads()).toEqual([]);
    expect(screen.getByLabelText('10 unread messages')).toBeInTheDocument();
  });

  it('does not mark read while scrolled up, then does on returning', async () => {
    await seedLocal([chat], history);
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    await screen.findByRole('list', { name: 'Asha Verma' });
    await connectSocket();
    scrollState(100);
    arrives(41, '6');
    act(() =>
      lastSocket().receive('chat:updated', {
        chatId: 'c1',
        type: 'direct',
        seq: 41,
        lastMessage: null,
        lastReadSeq: SEQ,
        unreadCount: 1,
        lastActivityAt: '2026-11-04T12:00:00.000Z',
        cursor: '6',
      }),
    );
    expect(
      await screen.findByLabelText('1 unread message', undefined, ARRIVAL),
    ).toBeInTheDocument();
    expect(reads()).toEqual([]);

    scrollState(4200);
    await waitFor(() => expect(reads()).toHaveLength(1));
    expect(reads()[0]?.payload).toEqual({ chatId: 'c1', seq: 41 });
  });

  it('does not mark read while the tab is hidden, then does when it returns', async () => {
    await seedLocal([unread], history);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    await screen.findByRole('list', { name: 'Asha Verma' });
    await connectSocket();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reads()).toEqual([]);

    visibility.mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(reads()).toHaveLength(1));
    visibility.mockRestore();
  });
});
