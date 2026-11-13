import { describe, expect, it } from 'vitest';
import { sendMessagePayloadSchema } from '../realtime/chat.ts';
import { appearanceSchema, chatWallpaperBodySchema } from './appearance.ts';
import { DISAPPEAR_MS, expiryFor } from './disappearing.ts';
import { pinSchema } from './lock.ts';
import { pollInputSchema, votePollBodySchema } from './polls.ts';
import {
  DEFAULT_QUIET_HOURS,
  isQuietAt,
  passesQuietHours,
  type QuietHours,
} from './quiet-hours.ts';
import { createScheduledBodySchema, updateScheduledBodySchema } from './scheduled.ts';

const chatId = '6aea9e7492c525fa72210c66';
const clientMsgId = '0197f5a4-7c3e-7b1a-8d2f-1a2b3c4d5e6f';
const base = { chatId, clientMsgId };

describe('message:send with polls and view once', () => {
  it('takes exactly one of text, media or a poll', () => {
    const poll = { question: 'Lunch?', options: ['Pizza', 'Dosa'], multiple: false };
    expect(sendMessagePayloadSchema.safeParse({ ...base, poll }).success).toBe(true);
    expect(sendMessagePayloadSchema.safeParse({ ...base, poll, text: 'hi' }).success).toBe(false);
    expect(sendMessagePayloadSchema.safeParse(base).success).toBe(false);
  });

  it('allows view once only on media', () => {
    expect(
      sendMessagePayloadSchema.safeParse({ ...base, mediaIds: [chatId], viewOnce: true }).success,
    ).toBe(true);
    expect(sendMessagePayloadSchema.safeParse({ ...base, text: 'x', viewOnce: true }).success).toBe(
      false,
    );
  });
});

describe('polls', () => {
  it('need 2 to 12 different options and a question', () => {
    const ok = { question: ' Where? ', options: ['A', 'B'], multiple: true };
    expect(pollInputSchema.parse(ok).question).toBe('Where?');
    expect(pollInputSchema.safeParse({ ...ok, options: ['A'] }).success).toBe(false);
    expect(
      pollInputSchema.safeParse({ ...ok, options: Array(13).fill(0).map(String) }).success,
    ).toBe(false);
    expect(pollInputSchema.safeParse({ ...ok, options: ['Yes', 'yes'] }).success).toBe(false);
    expect(pollInputSchema.safeParse({ ...ok, question: '  ' }).success).toBe(false);
    expect(votePollBodySchema.safeParse({ optionIds: [] }).success).toBe(true);
  });
});

describe('disappearing', () => {
  it('gives each timer its expiry, and none when off', () => {
    const at = new Date('2026-11-12T00:00:00.000Z');
    expect(expiryFor('off', at)).toBeNull();
    expect(expiryFor(undefined, at)).toBeNull();
    expect(expiryFor('24h', at)?.getTime()).toBe(at.getTime() + DISAPPEAR_MS['24h']);
    expect(expiryFor('90d', at)?.toISOString()).toBe('2027-02-10T00:00:00.000Z');
  });
});

describe('scheduled messages', () => {
  const sendAt = '2026-11-13T03:30:00.000Z';
  it('need text or a file', () => {
    expect(createScheduledBodySchema.safeParse({ chatId, sendAt, text: 'hi' }).success).toBe(true);
    expect(createScheduledBodySchema.safeParse({ chatId, sendAt, mediaId: chatId }).success).toBe(
      true,
    );
    expect(createScheduledBodySchema.safeParse({ chatId, sendAt, text: '  ' }).success).toBe(false);
    expect(updateScheduledBodySchema.safeParse({}).success).toBe(false);
  });
});

describe('PIN', () => {
  it('is 4 to 6 digits', () => {
    for (const pin of ['1234', '123456']) expect(pinSchema.safeParse(pin).success).toBe(true);
    for (const pin of ['123', '1234567', '12a4', ' 1234']) {
      expect(pinSchema.safeParse(pin).success).toBe(false);
    }
  });
});

describe('appearance', () => {
  it('knows its accents and wallpapers', () => {
    expect(
      appearanceSchema.safeParse({
        accent: 'teal',
        wallpaper: { kind: 'color', id: 'sage' },
        dim: 20,
      }).success,
    ).toBe(true);
    expect(
      appearanceSchema.safeParse({
        accent: 'green',
        wallpaper: { kind: 'color', id: 'sage' },
        dim: 20,
      }).success,
    ).toBe(false);
    expect(
      chatWallpaperBodySchema.safeParse({ wallpaper: { kind: 'image', id: '../etc' } }).success,
    ).toBe(false);
    expect(chatWallpaperBodySchema.safeParse({ wallpaper: null }).success).toBe(true);
  });
});

describe('quiet hours', () => {
  const night: QuietHours = { ...DEFAULT_QUIET_HOURS, mode: 'scheduled' };
  // 22:00–08:00 in India (UTC+5:30).
  const ist = (iso: string) => new Date(`${iso}+05:30`);

  it('follow the mode', () => {
    expect(isQuietAt({ ...night, mode: 'off' }, ist('2026-11-12T23:00:00'))).toBe(false);
    expect(isQuietAt({ ...night, mode: 'on' }, ist('2026-11-12T12:00:00'))).toBe(true);
  });

  it('run over midnight, in the person’s time zone', () => {
    expect(isQuietAt(night, ist('2026-11-12T21:59:00'))).toBe(false);
    expect(isQuietAt(night, ist('2026-11-12T22:00:00'))).toBe(true);
    expect(isQuietAt(night, ist('2026-11-13T07:59:00'))).toBe(true);
    expect(isQuietAt(night, ist('2026-11-13T08:00:00'))).toBe(false);
  });

  it('belong to the day they start on', () => {
    // Weekend nights only: Friday 22:00 to Saturday 08:00 counts, Sunday night does not.
    const weekends = { ...night, days: [5, 6] };
    expect(isQuietAt(weekends, ist('2026-11-14T02:00:00'))).toBe(true); // Saturday early
    expect(isQuietAt(weekends, ist('2026-11-16T02:00:00'))).toBe(false); // Monday early
    const daytime = { ...night, start: '09:00', end: '17:00', days: [1] };
    expect(isQuietAt(daytime, ist('2026-11-16T10:00:00'))).toBe(true); // Monday
    expect(isQuietAt(daytime, ist('2026-11-17T10:00:00'))).toBe(false); // Tuesday
  });

  it('fall back to India time for an unknown zone, and let exceptions through', () => {
    expect(isQuietAt({ ...night, timezone: 'Mars/Base' }, ist('2026-11-12T23:00:00'))).toBe(true);
    expect(passesQuietHours(night, { chatId, mentionsMe: true })).toBe(true);
    expect(passesQuietHours({ ...night, allowMentions: false }, { chatId, mentionsMe: true })).toBe(
      false,
    );
    expect(
      passesQuietHours({ ...night, allowChatIds: [chatId] }, { chatId, mentionsMe: false }),
    ).toBe(true);
  });
});
