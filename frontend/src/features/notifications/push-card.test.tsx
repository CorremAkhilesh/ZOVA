import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_PUSH_SETTINGS } from '@zuvo/protocol';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { resetPromoVisit } from '@/features/promo/PromoBar';
import { OPEN_URL_MESSAGE } from '@/sw/push/handlers';
import { chatFixture, messageFixture, personFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { lastSocket } from '@/test/socket-mock';
import { resetAudioForTests } from './sound';
import { installPushBrowser, restorePushBrowser, servePush } from './test-utils';

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 15_000 };

beforeAll(() => {
  // Sonner captures the pointer on a toast; jsdom has no pointer capture.
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});

afterEach(() => {
  // Unmount first: a bar that loses its reason while mounted closes for the visit.
  cleanup();
  resetPromoVisit();
  restorePushBrowser();
  vi.restoreAllMocks();
});

const asha = chatFixture({ id: 'c-asha', seq: 3 });

async function openChats() {
  serveNoMessages();
  await seedLocal([asha]);
  return renderApp('/chats', { width: DESKTOP_WIDTH });
}
/** Opening a chat loads its history: none here. */
const serveNoMessages = () =>
  server.use(
    http.get('*/v1/chats/:id/messages', () => HttpResponse.json({ items: [], hasMore: false })),
  );

describe('in-app toasts', () => {
  const ravi = chatFixture({
    id: 'c-ravi',
    seq: 1,
    otherUser: personFixture({ id: 'u-ravi', displayName: 'Ravi Shah', username: 'ravi' }),
  });
  /** The sounds played, by name (the fake decodes a file to the name it was served under). */
  const oscillators: string[] = [];
  class FakeAudioContext {
    state = 'running';
    currentTime = 0;
    destination = {};
    decodeAudioData(data: ArrayBuffer) {
      return Promise.resolve({ name: new TextDecoder().decode(data) });
    }
    createBufferSource() {
      const node = {
        buffer: null as { name: string } | null,
        connect: (n: unknown) => n,
        start() {
          oscillators.push(node.buffer?.name ?? '?');
        },
      };
      return node;
    }
    createGain() {
      return { gain: { value: 1 }, connect: (n: unknown) => n };
    }
  }

  async function chatOpen(path: string, settings = DEFAULT_PUSH_SETTINGS) {
    oscillators.length = 0;
    resetAudioForTests();
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    server.use(
      http.get('*/v1/me/push', () => HttpResponse.json({ publicKey: null, settings, devices: [] })),
      http.get('*/sounds/:name', ({ params }) =>
        HttpResponse.arrayBuffer(
          new TextEncoder().encode(String(params.name)).buffer as ArrayBuffer,
        ),
      ),
    );
    serveNoMessages();
    await seedLocal([asha, ravi]);
    const app = await renderApp(path, { width: DESKTOP_WIDTH });
    await screen.findAllByText('Ravi Shah', {}, SLOW);
    act(() => lastSocket().receive('connect'));
    return app;
  }
  const receive = (chatId: string, seq: number, extra = {}) =>
    act(() =>
      lastSocket().receive('message:new', {
        message: messageFixture(seq, {
          chatId,
          senderId: chatId === 'c-ravi' ? 'u-ravi' : 'u-asha',
          text: 'Lunch at 1?',
          ...extra,
        }),
        cursor: String(10 + seq),
      }),
    );

  it('shows sender and text for another chat, chimes, and opens the chat on click', async () => {
    const { router } = await chatOpen('/chats/c-asha');
    await receive('c-ravi', 2);
    const toast = await screen.findByRole('button', { name: /Ravi Shah\s*Lunch at 1\?/ }, SLOW);
    await waitFor(() => expect(oscillators).toContain('chime.wav'));
    await userEvent.setup().click(toast);
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats/c-ravi'));
  });

  it('nothing for the chat on screen, my own messages, or with sound off no chime', async () => {
    await chatOpen('/chats/c-ravi', { ...DEFAULT_PUSH_SETTINGS, sound: false });
    await receive('c-ravi', 2);
    await receive('c-asha', 4, { senderId: 'u-test' });
    await act(() => new Promise((resolve) => setTimeout(resolve, 700)));
    expect(screen.queryByRole('button', { name: /Lunch at 1\?/ })).toBeNull();
    await receive('c-asha', 5);
    await screen.findByRole('button', { name: /^Asha Verma/ }, SLOW);
    expect(oscillators).toHaveLength(0);
  });

  it('a locked chat says only "New message"', async () => {
    await chatOpen('/chats/c-asha');
    const db = (await import('@/features/sync/local-db')).getUserDb('u-test');
    await db.chats.update('c-ravi', { locked: true });
    await receive('c-ravi', 2);
    const toast = await screen.findByRole('button', { name: 'New message' }, SLOW);
    expect(toast).not.toHaveTextContent('Lunch');
  });

  it('a muted chat stays silent unless I am mentioned', async () => {
    await chatOpen('/chats/c-asha');
    const db = (await import('@/features/sync/local-db')).getUserDb('u-test');
    await db.chats.update('c-ravi', { mutedUntil: '2999-01-01T00:00:00.000Z' });
    await receive('c-ravi', 2);
    await act(() => new Promise((resolve) => setTimeout(resolve, 700)));
    expect(screen.queryByRole('button', { name: /^Ravi Shah/ })).toBeNull();
    await receive('c-ravi', 3, { mentions: [{ userId: 'u-test', offset: 0, length: 5 }] });
    expect(await screen.findByRole('button', { name: /^Ravi Shah/ }, SLOW)).toBeInTheDocument();
  });
});

describe('notification clicks and sign-out', () => {
  it("opens the chat a notification asks for, and closes that chat's notifications", async () => {
    const browser = installPushBrowser();
    const close = vi.fn();
    browser.shownNotifications.push({ close });
    const { router } = await openChats();
    act(() => {
      browser.container.dispatchEvent(
        new MessageEvent('message', { data: { type: OPEN_URL_MESSAGE, url: '/chats/c-asha' } }),
      );
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats/c-asha'));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(browser.registration.getNotifications).toHaveBeenCalledWith({ tag: 'chat:c-asha' });
  });

  it('signing out stops push here before the logout call', async () => {
    const api = servePush();
    const browser = installPushBrowser({ permission: 'granted', subscribed: true });
    const order: string[] = [];
    server.use(
      http.post('*/v1/auth/logout', () => {
        order.push(`logout after ${api.calls.filter((c) => c.method === 'DELETE').length} delete`);
        return HttpResponse.json({ status: 'signed_out' });
      }),
    );
    const { router } = await renderApp('/settings', { width: DESKTOP_WIDTH });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(order).toEqual(['logout after 1 delete']);
    expect(browser.subscription.unsubscribe).toHaveBeenCalled();
  });
});
