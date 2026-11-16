import type { PushPayload } from '@zuvo/protocol';
import type { SwStrings } from './strings';

/** The colour app icon (frontend/pwa/assets.ts MANIFEST_ICONS). */
export const NOTIFICATION_ICON = '/icons/icon-192.png';
/** Android shows the badge as a white silhouette: the monochrome glyph (BADGE_ICONS). */
export const NOTIFICATION_BADGE = '/icons/badge-96.png';

export const ACTION_READ = 'read';
export const ACTION_REPLY = 'reply';

/** Notification fields the DOM typings leave out but browsers support. */
export interface NotificationAction {
  action: string;
  title: string;
  /** 'text': an inline reply box (Chrome on Android and desktop). */
  type?: 'button' | 'text';
  placeholder?: string;
}
export interface RichNotificationOptions extends NotificationOptions {
  actions?: NotificationAction[];
  renotify?: boolean;
  timestamp?: number;
}

/** What a click needs: kept on the notification. */
export interface NotificationData {
  kind: 'message' | 'test' | 'unknown';
  url: string;
  chatId?: string;
  seq?: number;
  /** Unread chats when it arrived: "Mark as read" leaves one fewer. */
  badge?: number;
}

export interface WhatCanShow {
  /** Notification.maxActions; 0 where buttons are not shown. */
  maxActions: number;
  /** Inline text replies work here (feature-detected by the worker). */
  canReply: boolean;
  /** A notification with this tag is already on screen: a newer one replaces it. */
  replacing: boolean;
}

export const chatUrl = (chatId: string) => `/chats/${encodeURIComponent(chatId)}`;

function actionsFor(
  payload: Extract<PushPayload, { kind: 'message' }>,
  can: WhatCanShow,
  t: SwStrings,
): NotificationAction[] {
  const actions: NotificationAction[] = [{ action: ACTION_READ, title: t.markRead }];
  // Never a reply box under a notification that hides the chat (locked, app lock, preview off).
  if (can.canReply && !payload.hidden) {
    actions.push({
      action: ACTION_REPLY,
      title: t.reply,
      type: 'text',
      placeholder: t.replyPlaceholder,
    });
  }
  return actions.slice(0, can.maxActions);
}

/** The notification a push shows. Null payload: a plain "New message" that opens the app. */
export function notificationFor(
  payload: PushPayload | null,
  can: WhatCanShow,
  t: SwStrings,
): { title: string; options: RichNotificationOptions } {
  const base = { icon: NOTIFICATION_ICON, badge: NOTIFICATION_BADGE };
  if (!payload) {
    const data: NotificationData = { kind: 'unknown', url: '/chats' };
    return { title: t.newMessage, options: { ...base, tag: 'zuvo:unknown', data } };
  }
  const options: RichNotificationOptions = {
    ...base,
    body: payload.body,
    tag: payload.tag,
    timestamp: Date.parse(payload.sentAt),
    silent: payload.silent,
    // Alert again for a newer message in the same chat; a silent one must not (browsers refuse both).
    renotify: can.replacing && !payload.silent,
  };
  if (payload.kind === 'test') {
    const data: NotificationData = { kind: 'test', url: '/settings/notifications' };
    return { title: payload.title || t.newMessage, options: { ...options, data } };
  }
  const data: NotificationData = {
    kind: 'message',
    url: chatUrl(payload.chatId),
    chatId: payload.chatId,
    seq: payload.seq,
    badge: payload.badge,
  };
  const actions = actionsFor(payload, can, t);
  return {
    title: payload.title || t.newMessage,
    options: { ...options, data, ...(actions.length ? { actions } : {}) },
  };
}

/** A notification's data, checked (it may come from an older version of the worker). */
export function readNotificationData(raw: unknown): NotificationData {
  const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<NotificationData>;
  // Only a path in this app: never another site (`//host` is one too).
  const url =
    typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//')
      ? data.url
      : '/chats';
  return {
    kind: data.kind === 'message' || data.kind === 'test' ? data.kind : 'unknown',
    url,
    ...(typeof data.chatId === 'string' ? { chatId: data.chatId } : {}),
    ...(typeof data.seq === 'number' ? { seq: data.seq } : {}),
    ...(typeof data.badge === 'number' ? { badge: data.badge } : {}),
  };
}
