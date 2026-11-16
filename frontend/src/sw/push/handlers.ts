import { applyAppBadge, type BadgeNavigator } from './badge';
import {
  ACTION_READ,
  ACTION_REPLY,
  chatUrl,
  type NotificationData,
  notificationFor,
  type RichNotificationOptions,
  readNotificationData,
} from './notification';
import { parsePushPayload } from './payload';
import type { SwStrings } from './strings';
import { vapidKeyBytes } from './vapid';

/** The message the worker posts to an open app window: it opens the chat with its own router. */
export const OPEN_URL_MESSAGE = 'zuvo:open-url';

export interface WindowLike {
  url: string;
  focused: boolean;
  focus(): Promise<unknown>;
  postMessage(message: unknown): void;
}

export interface SubscriptionLike {
  endpoint: string;
  options?: { applicationServerKey: ArrayBuffer | null };
  toJSON(): unknown;
}

/** Everything the handlers use from the worker, so they can be tested without one. */
export interface WorkerDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  showNotification: (title: string, options: RichNotificationOptions) => Promise<void>;
  /** Notifications on screen with this tag. */
  notificationsWithTag: (tag: string) => Promise<Array<{ close(): void }>>;
  badge: BadgeNavigator;
  windows: () => Promise<readonly WindowLike[]>;
  openWindow: (url: string) => Promise<unknown>;
  strings: () => Promise<SwStrings>;
  capabilities: () => { maxActions: number; canReply: boolean };
  randomUUID: () => string;
  subscribe: (options: PushSubscriptionOptionsInit) => Promise<SubscriptionLike>;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  credentials: 'include',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify(body),
});

/** `push`: always shows a notification (browsers require it), and updates the app badge. */
export async function handlePush(deps: WorkerDeps, raw: unknown): Promise<void> {
  const payload = parsePushPayload(raw);
  const [t, existing] = await Promise.all([
    deps.strings(),
    payload ? deps.notificationsWithTag(payload.tag) : Promise.resolve([]),
  ]);
  const { title, options } = notificationFor(
    payload,
    { ...deps.capabilities(), replacing: existing.length > 0 },
    t,
  );
  await deps.showNotification(title, options);
  if (payload?.kind === 'message') await applyAppBadge(deps.badge, payload.badge);
}

/** Brings an app window forward on `url`: one already open if there is one, else a new one. */
export async function openApp(deps: WorkerDeps, url: string): Promise<void> {
  const windows = await deps.windows();
  const target = windows.find((client) => client.focused) ?? windows[0];
  if (!target) {
    await deps.openWindow(url);
    return;
  }
  await target.focus().catch(() => undefined);
  target.postMessage({ type: OPEN_URL_MESSAGE, url });
}

async function markRead(deps: WorkerDeps, data: NotificationData): Promise<void> {
  if (!data.chatId || !data.seq) return;
  const response = await deps
    .fetch(`/v1/chats/${encodeURIComponent(data.chatId)}/read`, jsonInit('POST', { seq: data.seq }))
    .catch(() => null);
  if (!response?.ok) return;
  // The server says how many chats are still unread; failing that, one fewer than at push time.
  const body = (await response.json().catch(() => null)) as { badge?: unknown } | null;
  if (typeof body?.badge === 'number') await applyAppBadge(deps.badge, Math.max(0, body.badge));
  else if (data.badge !== undefined) await applyAppBadge(deps.badge, Math.max(0, data.badge - 1));
}

async function sendReply(deps: WorkerDeps, data: NotificationData, text: string): Promise<void> {
  if (!data.chatId) return;
  const response = await deps
    .fetch(
      `/v1/chats/${encodeURIComponent(data.chatId)}/reply`,
      jsonInit('POST', { clientMsgId: deps.randomUUID(), text }),
    )
    .catch(() => null);
  if (response?.ok) return;
  const t = await deps.strings();
  await deps.showNotification(t.replyFailed, {
    body: t.replyFailedBody,
    tag: `reply-failed:${data.chatId}`,
    data: { kind: 'message', url: chatUrl(data.chatId), chatId: data.chatId },
  });
}

export interface ClickEvent {
  action: string;
  /** The text typed into an inline reply; null or empty otherwise. */
  reply?: string | null;
  notification: { data: unknown; close(): void };
}

/** `notificationclick`: "Mark as read", an inline reply, or open the chat. */
export async function handleNotificationClick(deps: WorkerDeps, event: ClickEvent): Promise<void> {
  const data = readNotificationData(event.notification.data);
  event.notification.close();
  if (event.action === ACTION_READ) {
    await markRead(deps, data);
    return;
  }
  const text = event.reply?.trim();
  if (event.action === ACTION_REPLY && text) {
    await sendReply(deps, data, text);
    return;
  }
  // A click on the notification itself, or "Reply" where the browser cannot take text.
  await openApp(deps, data.url);
}

async function serverKey(deps: WorkerDeps): Promise<string | null> {
  const response = await deps
    .fetch('/v1/me/push', { credentials: 'include', headers: { accept: 'application/json' } })
    .catch(() => null);
  if (!response?.ok) return null;
  const body = (await response.json().catch(() => null)) as { publicKey?: unknown } | null;
  return typeof body?.publicKey === 'string' ? body.publicKey : null;
}

/**
 * `pushsubscriptionchange`: the push service replaced or dropped this browser's subscription. Uses
 * the new one, or subscribes again with the same key (the old one's, else the server's), and tells
 * the server. Signed out (401) or push off on the server: nothing to do.
 */
export async function handleSubscriptionChange(
  deps: WorkerDeps,
  change: { oldSubscription: SubscriptionLike | null; newSubscription: SubscriptionLike | null },
): Promise<void> {
  const { oldSubscription } = change;
  let next = change.newSubscription;
  if (!next) {
    const oldKey = oldSubscription?.options?.applicationServerKey;
    const key = oldKey ?? (await serverKey(deps).then((k) => (k ? vapidKeyBytes(k) : null)));
    if (!key) return;
    next = await deps.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }
  await deps.fetch('/v1/me/push/subscription', jsonInit('PUT', next.toJSON()));
  if (oldSubscription && oldSubscription.endpoint !== next.endpoint) {
    await deps
      .fetch('/v1/me/push/subscription', jsonInit('DELETE', { endpoint: oldSubscription.endpoint }))
      .catch(() => undefined);
  }
}
