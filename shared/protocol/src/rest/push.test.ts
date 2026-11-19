import { describe, expect, it } from 'vitest';
import { windowStatePayloadSchema } from '../realtime/chat.ts';
import {
  DEFAULT_PUSH_SETTINGS,
  pushPayloadSchema,
  pushSettingsSchema,
  pushSubscriptionBodySchema,
  pushTagFor,
  SENT_TONES,
  updatePushSettingsBodySchema,
} from './push.ts';

const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  expirationTime: null,
  keys: { p256dh: 'BOr5', auth: 'k3y' },
};

describe('push', () => {
  it('takes a browser subscription on an https push service only', () => {
    expect(pushSubscriptionBodySchema.parse(subscription)).toEqual(subscription);
    expect(
      pushSubscriptionBodySchema.safeParse({ ...subscription, endpoint: 'http://push.example/x' })
        .success,
    ).toBe(false);
    expect(pushSubscriptionBodySchema.safeParse({ ...subscription, keys: {} }).success).toBe(false);
  });

  it('defaults the settings, and changes only what was sent', () => {
    expect(pushSettingsSchema.parse({})).toEqual(DEFAULT_PUSH_SETTINGS);
    expect(Object.values(DEFAULT_PUSH_SETTINGS).includes(false)).toBe(false);
    expect(updatePushSettingsBodySchema.parse({ sound: false })).toEqual({ sound: false });
    expect(updatePushSettingsBodySchema.safeParse({ tone: 'horn' }).success).toBe(false);
    expect(updatePushSettingsBodySchema.safeParse({ soundVolume: 101 }).success).toBe(false);
    // Sending: Droplet C unless chosen otherwise; the soft versions are choices, never the default.
    expect(DEFAULT_PUSH_SETTINGS).toMatchObject({
      sentTone: 'droplet-c',
      tone: 'chime',
      mentionTone: 'mention',
      tickTone: 'tick',
    });
    expect(SENT_TONES).toEqual(['droplet-c', 'droplet-a', 'droplet-b', 'swoosh', 'off']);
    expect(updatePushSettingsBodySchema.safeParse({ sentTone: 'off' }).success).toBe(true);
    expect(updatePushSettingsBodySchema.safeParse({ sentTone: 'plop' }).success).toBe(false);
    expect(updatePushSettingsBodySchema.safeParse({ tone: 'chime-soft' }).success).toBe(true);
  });

  it('reads the payloads the service worker gets', () => {
    const message = {
      kind: 'message',
      v: 1,
      chatId: 'c1',
      tag: pushTagFor('c1'),
      title: 'Riya',
      body: 'Lunch? (+3 more)',
      seq: 9,
      count: 4,
      badge: 2,
      hidden: false,
      silent: false,
      sentAt: '2026-11-13T10:00:00.000Z',
    } as const;
    expect(pushPayloadSchema.parse(message)).toEqual(message);
    expect(pushTagFor('c1')).toBe('chat:c1');
    expect(pushPayloadSchema.safeParse({ ...message, kind: 'other' }).success).toBe(false);
  });

  it('says whether a tab is visible and focused', () => {
    expect(windowStatePayloadSchema.parse({ visible: true, focused: false })).toEqual({
      visible: true,
      focused: false,
    });
    expect(windowStatePayloadSchema.safeParse({ visible: 'yes' }).success).toBe(false);
  });
});
