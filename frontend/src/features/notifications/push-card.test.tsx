import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { brand } from '@zuvo/config';
import { DEFAULT_PUSH_SETTINGS } from '@zuvo/protocol';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { resetPromoVisit } from '@/features/promo/PromoBar';
import { PROMO_DELAY_MS } from '@/features/promo/ready';
import { OPEN_URL_MESSAGE } from '@/sw/push/handlers';
import { axe } from '@/test/axe';
import { chatFixture, messageFixture, personFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { lastSocket } from '@/test/socket-mock';
import { PUSH_CARD_DISMISSED_KEY } from './prefs';
import { installPushBrowser, restorePushBrowser, servePush } from './test-utils';

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 15_000 };
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

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
/** The promo bar comes a moment after the rows have painted. */
const card = () => screen.findByRole('complementary', { name: /notif|Home Screen/i }, SLOW);
/** Opening a chat loads its history: none here. */
const serveNoMessages = () =>
  server.use(
    http.get('*/v1/chats/:id/messages', () => HttpResponse.json({ items: [], hasMore: false })),
  );

describe('"Get notified" bar', () => {
  it('asks only after Enable, then subscribes and goes away; no axe violations', async () => {
    const api = servePush();
    const browser = installPushBrowser({ permission: 'default', answer: 'granted' });
    const { container } = await openChats();
    // The rows paint first; the bar waits for them, then for an idle moment.
    await screen.findByText('Asha Verma', {}, SLOW);
    expect(screen.queryByRole('complementary', { name: /notif/i })).toBeNull();
    expect(await card()).toHaveTextContent('Get notified about new messages');
    expect(browser.Notification.requestPermission).not.toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Enable' }));
    expect(browser.Notification.requestPermission).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.calls.some((c) => c.method === 'PUT')).toBe(true));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull());
  });

  it('names a block in the bar and explains how to unblock in a dialog', async () => {
    servePush();
    installPushBrowser({ permission: 'denied' });
    const { container } = await openChats();
    const shown = await card();
    expect(shown).toHaveTextContent('Notifications are blocked');
    expect(shown).not.toHaveTextContent('Site settings');
    await userEvent.setup().click(within(shown).getByRole('button', { name: 'What to do' }));
    const help = await screen.findByRole('dialog', { name: 'Notifications are blocked' });
    expect(help).toHaveTextContent('Site settings');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('on iPhone outside the installed app, explains Add to Home Screen', async () => {
    servePush();
    installPushBrowser({ userAgent: IPHONE });
    const { container } = await openChats();
    const shown = await card();
    expect(shown).toHaveTextContent(`Add ${brand.name} to your Home Screen first`);
    expect(within(shown).getByRole('button', { name: 'How to install' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('says so in a browser without push, and remembers "Not now"', async () => {
    servePush();
    await openChats();
    expect(await card()).toHaveTextContent('Notifications aren’t available here');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByText('Notifications aren’t available here')).toBeNull();
    expect(localStorage.getItem(PUSH_CARD_DISMISSED_KEY)).toBe('1');
  });

  it('stays hidden when the server has no push key', async () => {
    installPushBrowser({ permission: 'default' });
    await openChats();
    await screen.findByText('Asha Verma', {}, SLOW);
    await act(() => new Promise((resolve) => setTimeout(resolve, PROMO_DELAY_MS + 300)));
    expect(screen.queryByText('Get notified about new messages')).toBeNull();
  });

  it('stays hidden while already allowed and on', async () => {
    servePush();
    installPushBrowser({ permission: 'granted' });
    await openChats();
    await screen.findByText('Asha Verma', {}, SLOW);
    await act(() => new Promise((resolve) => setTimeout(resolve, PROMO_DELAY_MS + 300)));
    expect(screen.queryByRole('complementary', { name: /notif/i })).toBeNull();
  });
});

describe('in-app toasts', () => {
  const ravi = chatFixture({
    id: 'c-ravi',
    seq: 1,
    otherUser: personFixture({ id: 'u-ravi', displayName: 'Ravi Shah', username: 'ravi' }),
  });
  const oscillators: unknown[] = [];
  class FakeAudioContext {
    state = 'running';
    currentTime = 0;
    destination = {};
    createOscillator() {
      const node = {
        type: '',
        frequency: { value: 0 },
        connect: (n: unknown) => n,
        start() {},
        stop() {},
      };
      oscillators.push(node);
      return node;
    }
    createGain() {
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect: (n: unknown) => n,
      };
    }
  }

  async function chatOpen(path: string, settings = DEFAULT_PUSH_SETTINGS) {
    oscillators.length = 0;
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    server.use(
      http.get('*/v1/me/push', () => HttpResponse.json({ publicKey: null, settings, devices: [] })),
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
    expect(oscillators.length).toBeGreaterThan(0);
    await userEvent.setup().click(toast);
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats/c-ravi'));
  });

  it('nothing for the chat on screen, my own messages, or with sound off no chime', async () => {
    await chatOpen('/chats/c-ravi', { showPreview: true, sound: false });
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
