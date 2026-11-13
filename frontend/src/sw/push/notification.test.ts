import { pushPayloadSchema } from '@zuvo/protocol';
import { describe, expect, it } from 'vitest';
import { notificationFor, readNotificationData } from './notification';
import { parsePushPayload, readPushJson } from './payload';
import { swStrings } from './strings';
import { CHAT, KEY, message } from './test-fixtures';
import { sameKey, vapidKeyBytes } from './vapid';

describe('push payload', () => {
  it('accepts what the protocol accepts, and nothing malformed', () => {
    const good = message();
    expect(pushPayloadSchema.safeParse(good).success).toBe(true);
    expect(parsePushPayload(good)).toEqual(good);
    const test = {
      kind: 'test',
      v: 1,
      tag: 't',
      title: 'Test',
      body: 'Hi',
      silent: true,
      sentAt: good.sentAt,
    };
    expect(parsePushPayload(test)).toEqual(test);
    for (const bad of [
      null,
      'text',
      { ...good, v: 2 },
      { ...good, seq: 0 },
      { ...good, badge: -1 },
      { ...good, hidden: 'no' },
      { ...good, sentAt: 'yesterday' },
      { ...good, kind: 'other' },
    ]) {
      expect(parsePushPayload(bad)).toBeNull();
    }
  });

  it('reads JSON safely', () => {
    expect(readPushJson(null)).toBeNull();
    expect(readPushJson({ json: () => ({ a: 1 }) })).toEqual({ a: 1 });
    expect(
      readPushJson({
        json: () => {
          throw new SyntaxError('not json');
        },
      }),
    ).toBeNull();
  });
});

describe('notificationFor', () => {
  const can = { maxActions: 2, canReply: true, replacing: false };

  it('builds title, body, icon, tag, time, data and both actions', () => {
    const { title, options } = notificationFor(message(), can, swStrings('en'));
    expect(title).toBe('Asha Verma');
    expect(options).toMatchObject({
      body: 'See you at 5',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: `chat:${CHAT}`,
      timestamp: Date.parse('2026-11-13T10:00:00.000Z'),
      silent: false,
      renotify: false,
      data: { kind: 'message', chatId: CHAT, seq: 42, badge: 3, url: `/chats/${CHAT}` },
    });
    expect(options.actions).toEqual([
      { action: 'read', title: 'Mark as read' },
      { action: 'reply', title: 'Reply', type: 'text', placeholder: 'Write a reply…' },
    ]);
  });

  it('renotifies when replacing, but never for a silent one', () => {
    expect(
      notificationFor(message(), { ...can, replacing: true }, swStrings('en')).options.renotify,
    ).toBe(true);
    const silent = notificationFor(
      message({ silent: true }),
      { ...can, replacing: true },
      swStrings('en'),
    );
    expect(silent.options).toMatchObject({ silent: true, renotify: false });
  });

  it('offers Reply only where text replies work, and never for hidden chats', () => {
    const names = (n: ReturnType<typeof notificationFor>) =>
      n.options.actions?.map((a) => a.action);
    expect(names(notificationFor(message({ hidden: true }), can, swStrings('en')))).toEqual([
      'read',
    ]);
    expect(names(notificationFor(message(), { ...can, canReply: false }, swStrings('en')))).toEqual(
      ['read'],
    );
    expect(
      notificationFor(message(), { ...can, maxActions: 0 }, swStrings('en')).options.actions,
    ).toBeUndefined();
  });

  it('speaks Hindi when the app does', () => {
    const { options } = notificationFor(message(), can, swStrings('hi-IN'));
    expect(options.actions?.[0]?.title).toBe('पढ़ा हुआ मार्क करें');
    expect(swStrings(null).markRead).toBe('Mark as read');
  });

  it('shows a plain "New message" for an unreadable push, and the test kind opens settings', () => {
    const unknown = notificationFor(null, can, swStrings('en'));
    expect(unknown.title).toBe('New message');
    expect(unknown.options.data).toEqual({ kind: 'unknown', url: '/chats' });
    const test = notificationFor(
      {
        kind: 'test',
        v: 1,
        tag: 'test',
        title: 'It works',
        body: 'b',
        silent: false,
        sentAt: message().sentAt,
      },
      can,
      swStrings('en'),
    );
    expect(test.options.data).toEqual({ kind: 'test', url: '/settings/notifications' });
    expect(test.options.actions).toBeUndefined();
  });

  it('never trusts a stored URL that leaves the app', () => {
    expect(readNotificationData({ url: '//evil.example/x' }).url).toBe('/chats');
    expect(readNotificationData({ url: 'https://evil.example' }).url).toBe('/chats');
    expect(readNotificationData('junk')).toEqual({ kind: 'unknown', url: '/chats' });
  });
});

describe('VAPID key', () => {
  it('decodes base64url and compares keys', () => {
    const bytes = vapidKeyBytes(KEY);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
    expect(sameKey(bytes.buffer, KEY)).toBe(true);
    expect(sameKey(new Uint8Array(65).buffer, KEY)).toBe(false);
    expect(sameKey(null, KEY)).toBe(false);
  });
});
