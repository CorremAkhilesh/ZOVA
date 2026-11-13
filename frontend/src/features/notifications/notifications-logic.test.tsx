import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Message } from '@zuvo/protocol';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatRow } from '@/features/sync/local-db';
import { chatFixture, messageFixture } from '@/test/chat-fixtures';
import { type AlertContext, inAppAlert } from './alert-rules';
import { unreadChatCount, useAppBadge } from './badge';
import { PUSH_CARD_DISMISSED_KEY, PUSH_ENABLED_KEY, usePushPrefs } from './prefs';
import { pushStatus } from './status';
import { subscribeThisDevice, unsubscribeThisDevice } from './subscription';
import { browserFamily, pushSupport } from './support';
import {
  ENDPOINT,
  installPushBrowser,
  restorePushBrowser,
  servePush,
  VAPID_KEY,
} from './test-utils';
import { messagePreview } from './use-in-app-alerts';
import { usePushLifecycle } from './use-push-lifecycle';
import { trackWindowState } from './window-state';

afterEach(restorePushBrowser);

const row = (overrides: Partial<ChatRow> = {}): ChatRow => ({
  ...chatFixture(),
  sortAt: 0,
  ...overrides,
});

describe('in-app alert rules', () => {
  const ctx = (overrides: Partial<AlertContext> = {}): AlertContext => ({
    me: 'u-test',
    chat: row({ id: 'c1' }),
    senderName: 'Asha Verma',
    openChatId: 'c-other',
    windowActive: true,
    appLocked: false,
    showPreview: true,
    quietAllows: () => true,
    preview: (message) => message.text ?? '',
    newMessage: 'New message',
    ...overrides,
  });
  const msg = (overrides: Partial<Message> = {}) =>
    messageFixture(5, { text: 'Lunch?', ...overrides });

  it('shows sender and preview for another chat while the app is in front', () => {
    expect(inAppAlert(msg(), ctx())).toEqual({ chatId: 'c1', title: 'Asha Verma', body: 'Lunch?' });
  });

  it('stays quiet for the open chat, a background tab, my own and system messages', () => {
    expect(inAppAlert(msg(), ctx({ openChatId: 'c1' }))).toBeNull();
    expect(inAppAlert(msg(), ctx({ windowActive: false }))).toBeNull();
    expect(inAppAlert(msg({ senderId: 'u-test' }), ctx())).toBeNull();
    expect(inAppAlert(msg({ senderId: null }), ctx())).toBeNull();
    expect(inAppAlert(msg(), ctx({ chat: row({ type: 'self' }) }))).toBeNull();
  });

  it('muted chats only alert when I am mentioned', () => {
    const muted = row({ id: 'c1', mutedUntil: new Date(Date.now() + 60_000).toISOString() });
    expect(inAppAlert(msg(), ctx({ chat: muted }))).toBeNull();
    const mention = msg({ mentions: [{ userId: 'u-test', offset: 0, length: 5 }] });
    expect(inAppAlert(mention, ctx({ chat: muted }))).not.toBeNull();
    expect(inAppAlert(msg({ mentionsEveryone: true }), ctx({ chat: muted }))).not.toBeNull();
    const expired = row({ id: 'c1', mutedUntil: new Date(Date.now() - 1).toISOString() });
    expect(inAppAlert(msg(), ctx({ chat: expired }))).not.toBeNull();
  });

  it('locked chats and the app lock say "New message" only; preview off hides the text', () => {
    expect(inAppAlert(msg(), ctx({ chat: row({ id: 'c1', locked: true }) }))).toEqual({
      chatId: 'c1',
      title: 'New message',
      body: null,
    });
    expect(inAppAlert(msg(), ctx({ appLocked: true }))?.title).toBe('New message');
    expect(inAppAlert(msg(), ctx({ showPreview: false }))).toEqual({
      chatId: 'c1',
      title: 'Asha Verma',
      body: null,
    });
  });

  it('follows quiet hours, and names the group', () => {
    const quietAllows = vi.fn(() => false);
    expect(inAppAlert(msg(), ctx({ quietAllows }))).toBeNull();
    expect(quietAllows).toHaveBeenCalledWith({ chatId: 'c1', mentionsMe: false });
    const group = row({
      id: 'c1',
      type: 'group',
      otherUser: null,
      group: { name: 'Design' } as ChatRow['group'],
    });
    expect(inAppAlert(msg(), ctx({ chat: group }))?.title).toBe('Asha Verma · Design');
  });

  it('previews media and polls as one line', () => {
    expect(messagePreview(msg({ text: '**hi**  there' }))).toBe('hi there');
    expect(messagePreview(msg({ type: 'image', text: null }))).toBe('📷 Photo');
    expect(messagePreview(msg({ type: 'voice' }))).toMatch(/^🎤/);
  });
});

describe('app badge', () => {
  it('counts chats with unread messages or marked unread', () => {
    expect(unreadChatCount([row({ unreadCount: 2 }), row({ markedUnread: true }), row()])).toBe(2);
  });

  it('sets the badge as unread chats change, clears it at 0', () => {
    const { badge } = installPushBrowser();
    const { rerender } = renderHook(({ rows }) => useAppBadge(rows), {
      initialProps: { rows: [row({ unreadCount: 3 })] as ChatRow[] | undefined },
    });
    expect(badge.setAppBadge).toHaveBeenCalledWith(1);
    rerender({ rows: [row()] });
    expect(badge.clearAppBadge).toHaveBeenCalled();
  });

  it('does nothing where badges are unsupported', () => {
    expect(() => renderHook(() => useAppBadge([row({ unreadCount: 1 })]))).not.toThrow();
  });
});

describe('push status and support', () => {
  const base = {
    publicKey: VAPID_KEY,
    support: 'supported',
    permission: 'default',
    enabled: true,
  } as const;
  it('explains every case', () => {
    expect(pushStatus({ ...base, publicKey: null })).toBe('server-off');
    expect(pushStatus({ ...base, support: 'ios-install' })).toBe('ios-install');
    expect(pushStatus({ ...base, support: 'unsupported' })).toBe('unsupported');
    expect(pushStatus({ ...base, permission: 'denied' })).toBe('denied');
    expect(pushStatus(base)).toBe('ask');
    expect(pushStatus({ ...base, permission: 'granted' })).toBe('on');
    expect(pushStatus({ ...base, permission: 'granted', enabled: false })).toBe('off');
  });

  it('detects push, iPhone outside the installed app, and the browser family', () => {
    expect(pushSupport()).toBe('unsupported');
    installPushBrowser();
    expect(pushSupport()).toBe('supported');
    const iphone = {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
      maxTouchPoints: 5,
    };
    installPushBrowser({ userAgent: iphone.userAgent });
    expect(pushSupport()).toBe('ios-install');
    expect(browserFamily(iphone)).toBe('ios');
    expect(browserFamily({ userAgent: 'Mozilla/5.0 Firefox/140.0', maxTouchPoints: 0 })).toBe(
      'firefox',
    );
    expect(
      browserFamily({ userAgent: 'Macintosh Version/18.0 Safari/605.1.15', maxTouchPoints: 0 }),
    ).toBe('safari-mac');
    expect(
      browserFamily({ userAgent: 'Chrome/140.0 Safari/537.36 Edg/140.0', maxTouchPoints: 0 }),
    ).toBe('chromium');
  });

  it('remembers the per-device choices', () => {
    usePushPrefs.getState().setEnabled(false);
    usePushPrefs.getState().dismissCard();
    expect(localStorage.getItem(PUSH_ENABLED_KEY)).toBe('0');
    expect(localStorage.getItem(PUSH_CARD_DISMISSED_KEY)).toBe('1');
    localStorage.clear();
    usePushPrefs.getState().reload();
    expect(usePushPrefs.getState()).toMatchObject({ enabled: true, cardDismissed: false });
  });
});

describe('window:state', () => {
  function fakeSocket() {
    const handlers = new Map<string, () => void>();
    return {
      connected: true,
      emitted: [] as unknown[],
      on(event: string, handler: () => void) {
        handlers.set(event, handler);
      },
      off: vi.fn(),
      emit(event: string, payload: unknown) {
        this.emitted.push([event, payload]);
      },
      fire: (event: string) => handlers.get(event)?.(),
    };
  }

  it('reports on connect and on every visibility / focus change', () => {
    let visibility: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const socket = fakeSocket();
    const tracker = trackWindowState(socket as never);
    socket.fire('connect');
    expect(socket.emitted).toEqual([['window:state', { visible: true, focused: true }]]);
    focus.mockReturnValue(false);
    window.dispatchEvent(new Event('blur'));
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('blur'));
    expect(socket.emitted.slice(1)).toEqual([
      ['window:state', { visible: true, focused: false }],
      ['window:state', { visible: false, focused: false }],
    ]);
    // A reconnect says it again even though nothing changed.
    socket.fire('connect');
    expect(socket.emitted).toHaveLength(4);
    tracker.stop();
    window.dispatchEvent(new Event('focus'));
    expect(socket.emitted).toHaveLength(4);
    delete (document as unknown as Record<string, unknown>).visibilityState;
    focus.mockRestore();
  });
});

describe('subscription lifecycle', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {children}
    </QueryClientProvider>
  );

  it('subscribes after sign-in when allowed and on, and sends the subscription', async () => {
    const api = servePush();
    const browser = installPushBrowser({ permission: 'granted' });
    renderHook(() => usePushLifecycle(), { wrapper });
    await waitFor(() => expect(api.calls).toHaveLength(1));
    expect(browser.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: expect.any(Uint8Array),
    });
    expect(api.calls[0]).toEqual({
      method: 'PUT',
      path: '/v1/me/push/subscription',
      body: { endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: 'p256', auth: 'auth' } },
    });
    expect(browser.Notification.requestPermission).not.toHaveBeenCalled();
  });

  it('refreshes an existing subscription without making a new one', async () => {
    const api = servePush();
    const browser = installPushBrowser({ permission: 'granted', subscribed: true });
    await subscribeThisDevice(VAPID_KEY);
    expect(browser.pushManager.subscribe).not.toHaveBeenCalled();
    expect(api.calls.map((c) => c.method)).toEqual(['PUT']);
  });

  it('never asks or subscribes on load: not yet allowed, turned off here, or no server key', async () => {
    const api = servePush();
    const browser = installPushBrowser({ permission: 'default' });
    renderHook(() => usePushLifecycle(), { wrapper });
    usePushPrefs.getState().setEnabled(false);
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(browser.Notification.requestPermission).not.toHaveBeenCalled();
    expect(browser.pushManager.subscribe).not.toHaveBeenCalled();
    expect(api.calls).toEqual([]);
  });

  it('unsubscribing tells the server first, then drops the browser subscription', async () => {
    const api = servePush();
    const browser = installPushBrowser({ permission: 'granted', subscribed: true });
    browser.subscription.unsubscribe.mockImplementation(async () => {
      expect(api.calls).toHaveLength(1);
      return true;
    });
    await unsubscribeThisDevice({ tellServer: true });
    expect(api.calls).toEqual([
      { method: 'DELETE', path: '/v1/me/push/subscription', body: { endpoint: ENDPOINT } },
    ]);
    expect(browser.subscription.unsubscribe).toHaveBeenCalled();
  });

  it('an ended session only drops the browser copy; no worker means nothing to do', async () => {
    const api = servePush();
    const browser = installPushBrowser({ subscribed: true });
    await unsubscribeThisDevice({ tellServer: false });
    expect(api.calls).toEqual([]);
    expect(browser.subscription.unsubscribe).toHaveBeenCalled();
    restorePushBrowser();
    await expect(unsubscribeThisDevice({ tellServer: true })).resolves.toBeUndefined();
  });
});
