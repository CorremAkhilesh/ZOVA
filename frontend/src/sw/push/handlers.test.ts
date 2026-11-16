import { describe, expect, it, vi } from 'vitest';
import {
  handleNotificationClick,
  handlePush,
  handleSubscriptionChange,
  OPEN_URL_MESSAGE,
  type SubscriptionLike,
} from './handlers';
import { notificationFor } from './notification';
import { swStrings } from './strings';
import { CHAT, deps, fakeWindow, fetchCalls, KEY, message, ok } from './test-fixtures';
import { sameKey, vapidKeyBytes } from './vapid';

describe('push event', () => {
  it('always shows a notification and sets the badge', async () => {
    const { deps: d, shown } = deps();
    await handlePush(d, message());
    expect(shown[0]?.title).toBe('Asha Verma');
    expect(d.badge.setAppBadge).toHaveBeenCalledWith(3);
    await handlePush(d, message({ badge: 0 }));
    expect(d.badge.clearAppBadge).toHaveBeenCalled();
    await handlePush(d, { garbage: true });
    expect(shown[2]?.title).toBe('New message');
  });

  it('renotifies when a notification for the chat is already showing', async () => {
    const { deps: d, shown } = deps({ notificationsWithTag: vi.fn(async () => [{ close() {} }]) });
    await handlePush(d, message());
    expect(d.notificationsWithTag).toHaveBeenCalledWith(`chat:${CHAT}`);
    expect(shown[0]?.options.renotify).toBe(true);
  });

  it('survives a browser without the Badging API', async () => {
    const { deps: d, shown } = deps({ badge: {} });
    await handlePush(d, message());
    expect(shown).toHaveLength(1);
  });
});

describe('notificationclick', () => {
  const clicked = (
    action: string,
    reply: string | null = null,
    data: unknown = notificationFor(
      message(),
      { maxActions: 2, canReply: true, replacing: false },
      swStrings('en'),
    ).options.data,
  ) => {
    const close = vi.fn();
    return { event: { action, reply, notification: { data, close } }, close };
  };

  it('focuses an open window and asks it to open the chat', async () => {
    const other = fakeWindow();
    const focused = fakeWindow({ focused: true });
    const { deps: d } = deps({ windows: vi.fn(async () => [other, focused]) });
    const { event, close } = clicked('');
    await handleNotificationClick(d, event);
    expect(close).toHaveBeenCalled();
    expect(focused.focus).toHaveBeenCalled();
    expect(focused.postMessage).toHaveBeenCalledWith({
      type: OPEN_URL_MESSAGE,
      url: `/chats/${CHAT}`,
    });
    expect(other.postMessage).not.toHaveBeenCalled();
    expect(d.openWindow).not.toHaveBeenCalled();
  });

  it('opens a new window when none is open', async () => {
    const { deps: d } = deps();
    await handleNotificationClick(d, clicked('').event);
    expect(d.openWindow).toHaveBeenCalledWith(`/chats/${CHAT}`);
  });

  it('"Mark as read" posts the seq, closes it and lowers the badge', async () => {
    const { deps: d } = deps();
    const { event, close } = clicked('read');
    await handleNotificationClick(d, event);
    expect(close).toHaveBeenCalled();
    expect(fetchCalls(d)).toEqual([
      { url: `/v1/chats/${CHAT}/read`, method: 'POST', body: { seq: 42 }, credentials: 'include' },
    ]);
    expect(d.badge.setAppBadge).toHaveBeenCalledWith(2);
    expect(d.openWindow).not.toHaveBeenCalled();
  });

  it('"Mark as read" takes the unread count the server sends back', async () => {
    const { deps: d } = deps({
      fetch: vi.fn(async () =>
        Response.json({ chatId: CHAT, lastReadSeq: 42, unreadCount: 0, badge: 0 }),
      ),
    });
    await handleNotificationClick(d, clicked('read').event);
    expect(d.badge.clearAppBadge).toHaveBeenCalled();
    expect(d.badge.setAppBadge).not.toHaveBeenCalled();
  });

  it('leaves the badge alone when marking read fails', async () => {
    const { deps: d } = deps({ fetch: vi.fn(async () => new Response('', { status: 401 })) });
    await handleNotificationClick(d, clicked('read').event);
    expect(d.badge.setAppBadge).not.toHaveBeenCalled();
  });

  it('an inline reply posts the text with a new clientMsgId', async () => {
    const { deps: d, shown } = deps();
    await handleNotificationClick(d, clicked('reply', '  On my way  ').event);
    expect(fetchCalls(d)).toEqual([
      {
        url: `/v1/chats/${CHAT}/reply`,
        method: 'POST',
        body: { clientMsgId: '0b0e6c1e-4a59-4a3c-9a1f-5d7f2e2c9a11', text: 'On my way' },
        credentials: 'include',
      },
    ]);
    expect(shown).toHaveLength(0);
  });

  it('says so when the reply could not be sent', async () => {
    const { deps: d, shown } = deps({
      fetch: vi.fn(async () => Promise.reject(new TypeError('offline'))),
    });
    await handleNotificationClick(d, clicked('reply', 'hi').event);
    expect(shown[0]).toMatchObject({
      title: 'Your reply wasn’t sent',
      options: { data: { url: `/chats/${CHAT}` } },
    });
  });

  it('"Reply" without text (no inline box here) opens the chat instead', async () => {
    const { deps: d } = deps();
    await handleNotificationClick(d, clicked('reply', '').event);
    expect(d.fetch).not.toHaveBeenCalled();
    expect(d.openWindow).toHaveBeenCalledWith(`/chats/${CHAT}`);
  });
});

describe('pushsubscriptionchange', () => {
  const subscription = (endpoint: string, key: ArrayBuffer | null = null): SubscriptionLike => ({
    endpoint,
    options: { applicationServerKey: key },
    toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
  });

  it('resubscribes with the old key and replaces the server copy', async () => {
    const key = vapidKeyBytes(KEY).buffer;
    const subscribe = vi.fn(async () => subscription('https://push.example/new'));
    const { deps: d } = deps({ subscribe });
    await handleSubscriptionChange(d, {
      oldSubscription: subscription('https://push.example/old', key),
      newSubscription: null,
    });
    expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: key });
    expect(fetchCalls(d)).toEqual([
      {
        url: '/v1/me/push/subscription',
        method: 'PUT',
        body: { endpoint: 'https://push.example/new', keys: { p256dh: 'p', auth: 'a' } },
        credentials: 'include',
      },
      {
        url: '/v1/me/push/subscription',
        method: 'DELETE',
        body: { endpoint: 'https://push.example/old' },
        credentials: 'include',
      },
    ]);
  });

  it('asks the server for its key when the old subscription has none', async () => {
    const subscribe = vi.fn(async () => subscription('https://push.example/new'));
    const fetch = vi.fn(async (url: string) =>
      url === '/v1/me/push' ? ok({ publicKey: KEY }) : ok(),
    );
    const { deps: d } = deps({ subscribe, fetch });
    await handleSubscriptionChange(d, { oldSubscription: null, newSubscription: null });
    const [[options]] = subscribe.mock.calls as unknown as [[PushSubscriptionOptionsInit]];
    expect(sameKey((options.applicationServerKey as Uint8Array).buffer as ArrayBuffer, KEY)).toBe(
      true,
    );
    expect(fetch).toHaveBeenLastCalledWith(
      '/v1/me/push/subscription',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it("uses the browser's new subscription as it is, and does nothing signed out", async () => {
    const { deps: d } = deps();
    await handleSubscriptionChange(d, {
      oldSubscription: null,
      newSubscription: subscription('https://push.example/n'),
    });
    expect(d.subscribe).not.toHaveBeenCalled();
    expect(fetchCalls(d)[0]?.method).toBe('PUT');

    const signedOut = deps({ fetch: vi.fn(async () => new Response('', { status: 401 })) });
    await handleSubscriptionChange(signedOut.deps, {
      oldSubscription: null,
      newSubscription: null,
    });
    expect(signedOut.deps.subscribe).not.toHaveBeenCalled();
  });
});
