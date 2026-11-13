import { DEFAULT_QUIET_HOURS, type QuietHours } from '@zuvo/protocol';
import { describe, expect, it } from 'vitest';
import { decidePush, type PushDecisionInput } from './decide.ts';

const CHAT = 'a'.repeat(24);
// A Wednesday, 23:30 in London (quiet hours below are 22:00–07:00 there).
const NIGHT = new Date('2026-01-14T23:30:00Z');
const DAY = new Date('2026-01-14T12:00:00Z');

interface Overrides {
  now?: Date;
  isSender?: boolean;
  message?: Partial<PushDecisionInput['message']>;
  recipient?: Partial<PushDecisionInput['recipient']>;
  device?: Partial<PushDecisionInput['device']>;
}

function input(overrides: Overrides = {}): PushDecisionInput {
  return {
    now: overrides.now ?? DAY,
    isSender: overrides.isSender ?? false,
    message: {
      chatId: CHAT,
      seq: 10,
      system: false,
      deletedForEveryone: false,
      expiresAt: null,
      visible: true,
      hiddenForMe: false,
      mentionsMe: false,
      ...overrides.message,
    },
    recipient: {
      lastReadSeq: 9,
      blocked: false,
      mutedUntil: null,
      quietHours: DEFAULT_QUIET_HOURS,
      ...overrides.recipient,
    },
    device: { attended: false, ...overrides.device },
  };
}

const quiet = (changes: Partial<QuietHours> = {}): QuietHours => ({
  ...DEFAULT_QUIET_HOURS,
  mode: 'scheduled',
  start: '22:00',
  end: '07:00',
  timezone: 'Europe/London',
  ...changes,
});

const reasonOf = (overrides: Overrides) => {
  const decision = decidePush(input(overrides));
  return decision.send ? 'send' : decision.reason;
};

describe('decidePush', () => {
  it('sends an ordinary new message to a device nobody is looking at', () => {
    expect(decidePush(input())).toEqual({ send: true, quietException: false });
  });

  it('never pushes my own messages to my own devices', () => {
    expect(reasonOf({ isSender: true })).toBe('own_message');
  });

  it('skips a device whose tab is visible and focused, but not my other devices', () => {
    expect(reasonOf({ device: { attended: true } })).toBe('attended');
    expect(reasonOf({ device: { attended: false } })).toBe('send');
  });

  it('skips what is already read, deleted, expired, hidden or system', () => {
    expect(reasonOf({ recipient: { lastReadSeq: 10 } })).toBe('read');
    expect(reasonOf({ message: { deletedForEveryone: true } })).toBe('deleted');
    expect(reasonOf({ message: { expiresAt: new Date(DAY.getTime() - 1) } })).toBe('expired');
    expect(reasonOf({ message: { expiresAt: new Date(DAY.getTime() + 60_000) } })).toBe('send');
    expect(reasonOf({ message: { hiddenForMe: true } })).toBe('hidden');
    expect(reasonOf({ message: { system: true } })).toBe('system');
  });

  it('respects history limits: joined after it, removed before it, or cleared the chat', () => {
    expect(reasonOf({ message: { visible: false } })).toBe('not_visible');
  });

  it('skips a 1:1 chat blocked either way', () => {
    expect(reasonOf({ recipient: { blocked: true } })).toBe('blocked');
  });

  it('keeps muted chats quiet until the mute ends, except when I am mentioned', () => {
    const later = new Date(DAY.getTime() + 3_600_000);
    expect(reasonOf({ recipient: { mutedUntil: later } })).toBe('muted');
    expect(reasonOf({ recipient: { mutedUntil: later }, message: { mentionsMe: true } })).toBe(
      'send',
    );
    expect(reasonOf({ recipient: { mutedUntil: new Date(DAY.getTime() - 1) } })).toBe('send');
  });

  it('holds back pushes during quiet hours', () => {
    expect(reasonOf({ now: NIGHT, recipient: { quietHours: quiet() } })).toBe('quiet_hours');
    expect(reasonOf({ now: DAY, recipient: { quietHours: quiet() } })).toBe('send');
    expect(reasonOf({ now: DAY, recipient: { quietHours: quiet({ mode: 'on' }) } })).toBe(
      'quiet_hours',
    );
  });

  it('lets mentions through quiet hours only when allowMentions is on', () => {
    const mentioned = { mentionsMe: true };
    expect(
      decidePush(input({ now: NIGHT, message: mentioned, recipient: { quietHours: quiet() } })),
    ).toEqual({ send: true, quietException: true });
    expect(
      reasonOf({
        now: NIGHT,
        message: mentioned,
        recipient: { quietHours: quiet({ allowMentions: false }) },
      }),
    ).toBe('quiet_hours');
  });

  it('lets the chats I chose through quiet hours', () => {
    const allowed = quiet({ allowMentions: false, allowChatIds: [CHAT] });
    expect(decidePush(input({ now: NIGHT, recipient: { quietHours: allowed } }))).toEqual({
      send: true,
      quietException: true,
    });
  });

  it('still skips an attended device for a quiet-hours exception', () => {
    expect(
      reasonOf({
        now: NIGHT,
        message: { mentionsMe: true },
        recipient: { quietHours: quiet() },
        device: { attended: true },
      }),
    ).toBe('attended');
  });

  it('checks the message before the person, and the person before the device', () => {
    expect(
      reasonOf({ isSender: true, recipient: { blocked: true }, device: { attended: true } }),
    ).toBe('own_message');
    expect(
      reasonOf({
        recipient: { mutedUntil: new Date('9999-12-31T00:00:00Z') },
        device: { attended: true },
      }),
    ).toBe('muted');
  });
});
