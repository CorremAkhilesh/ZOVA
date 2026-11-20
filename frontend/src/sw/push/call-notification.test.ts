import { pushPayloadSchema } from '@zuvo/protocol';
import { describe, expect, it, vi } from 'vitest';
import { handleNotificationClick, handlePush, OPEN_URL_MESSAGE } from './handlers';
import {
  CALL_VIBRATE_PATTERN,
  notificationFor,
  readNotificationData,
  VIBRATE_PATTERN,
} from './notification';
import { parsePushPayload } from './payload';
import { swStrings } from './strings';
import { CALL, CHAT, callPush, deps, fakeWindow } from './test-fixtures';

// Calls when the app is closed: "Incoming call" rings like a call and stays until handled; "Missed
// call" replaces it (same tag). Either opens the chat.

const can = { maxActions: 2, canReply: true, replacing: false };
const t = swStrings('en');

describe('call push payload', () => {
  it('accepts what the protocol accepts, and nothing malformed', () => {
    for (const payload of [callPush(), callPush({ state: 'missed', silent: true })]) {
      expect(pushPayloadSchema.parse(payload)).toEqual(payload);
      expect(parsePushPayload(payload)).toEqual(payload);
    }
    expect(parsePushPayload({ ...callPush(), state: 'ringing' })).toBeNull();
    expect(parsePushPayload({ ...callPush(), callId: 7 })).toBeNull();
    expect(parsePushPayload({ ...callPush(), chatId: undefined })).toBeNull();
  });
});

describe('call notifications', () => {
  it('incoming: stays until handled, rings with long buzzes, opens the chat', () => {
    const { title, options } = notificationFor(callPush(), can, t);
    expect(title).toBe('Incoming voice call');
    expect(options).toMatchObject({
      body: 'Asha Verma is calling you',
      tag: `call:${CALL}`,
      requireInteraction: true,
      renotify: true,
      silent: false,
      vibrate: CALL_VIBRATE_PATTERN,
      data: { kind: 'call', url: `/chats/${CHAT}`, chatId: CHAT, callId: CALL },
    });
    expect(options.actions).toBeUndefined();
  });

  it('quiet hours: shown silently, without buzzing', () => {
    const { options } = notificationFor(callPush({ silent: true }), can, t);
    expect(options.silent).toBe(true);
    expect(options.vibrate).toBeUndefined();
    expect(options.renotify).toBe(false);
  });

  it('missed: replaces the incoming one (same tag), and does not stay on screen', () => {
    const { title, options } = notificationFor(
      callPush({ state: 'missed', title: 'Missed voice call', body: 'Asha Verma' }),
      can,
      t,
    );
    expect(title).toBe('Missed voice call');
    expect(options.tag).toBe(`call:${CALL}`);
    expect(options.requireInteraction).toBeUndefined();
    expect(options.vibrate).toEqual(VIBRATE_PATTERN);
  });

  it('keeps the call id when read back', () => {
    const { options } = notificationFor(callPush(), can, t);
    expect(readNotificationData(options.data)).toEqual({
      kind: 'call',
      url: `/chats/${CHAT}`,
      chatId: CHAT,
      callId: CALL,
    });
  });
});

describe('call push and click', () => {
  it('shows the notification and leaves the app badge alone', async () => {
    const { deps: d, shown } = deps();
    await handlePush(d, callPush());
    expect(shown[0]?.title).toBe('Incoming voice call');
    expect(d.badge.setAppBadge).not.toHaveBeenCalled();
    expect(d.badge.clearAppBadge).not.toHaveBeenCalled();
  });

  it('a tap opens the app on the chat', async () => {
    const focused = fakeWindow({ focused: true });
    const { deps: d } = deps({ windows: vi.fn(async () => [focused]) });
    const close = vi.fn();
    const data = notificationFor(callPush(), can, t).options.data;
    await handleNotificationClick(d, { action: '', reply: null, notification: { data, close } });
    expect(close).toHaveBeenCalled();
    expect(focused.postMessage).toHaveBeenCalledWith({
      type: OPEN_URL_MESSAGE,
      url: `/chats/${CHAT}`,
    });
    const { deps: none } = deps();
    await handleNotificationClick(none, { action: '', reply: null, notification: { data, close } });
    expect(none.openWindow).toHaveBeenCalledWith(`/chats/${CHAT}`);
  });
});
