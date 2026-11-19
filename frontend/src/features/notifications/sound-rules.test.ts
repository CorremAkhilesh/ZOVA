import { DEFAULT_PUSH_SETTINGS, type Message } from '@zuvo/protocol';
import { describe, expect, it } from 'vitest';
import type { ChatRow } from '@/features/sync/local-db';
import { chatFixture, messageFixture } from '@/test/chat-fixtures';
import {
  createSoundGate,
  incomingSound,
  SOUND_GAP_MS,
  type SoundContext,
  sentSound,
} from './sound-rules';

const NOW = Date.parse('2026-11-19T10:00:00Z');
const chat = chatFixture({ id: 'c1' }) as unknown as ChatRow;
const ctx = (overrides: Partial<SoundContext> = {}): SoundContext => ({
  me: 'u-me',
  chat,
  openChatId: null,
  visible: true,
  settings: DEFAULT_PUSH_SETTINGS,
  quietAllows: () => true,
  now: NOW,
  ...overrides,
});
const msg = (overrides: Partial<Message> = {}) =>
  messageFixture(5, { chatId: 'c1', senderId: 'u-ravi', ...overrides });

describe('which sound a new message makes', () => {
  it('my tone for another chat; a mention its own sound; the chat on screen a tick', () => {
    expect(incomingSound(msg(), ctx())).toBe('chime');
    expect(
      incomingSound(msg(), ctx({ settings: { ...DEFAULT_PUSH_SETTINGS, tone: 'glass' } })),
    ).toBe('glass');
    const mention = msg({ mentions: [{ userId: 'u-me', offset: 0, length: 3 }] });
    expect(incomingSound(mention, ctx())).toBe('mention');
    expect(incomingSound(msg(), ctx({ openChatId: 'c1' }))).toBe('tick');
  });

  it('nothing for my own, system or deleted messages, Saved Messages, or a hidden tab', () => {
    expect(incomingSound(msg({ senderId: 'u-me' }), ctx())).toBeNull();
    expect(incomingSound(msg({ senderId: null }), ctx())).toBeNull();
    expect(
      incomingSound(msg({ deletedForEveryoneAt: new Date(NOW).toISOString() }), ctx()),
    ).toBeNull();
    expect(incomingSound(msg(), ctx({ chat: { ...chat, type: 'self' } }))).toBeNull();
    expect(incomingSound(msg(), ctx({ visible: false }))).toBeNull();
  });

  it('a muted chat stays silent, even for a mention; so do quiet hours / DND', () => {
    const muted = { ...chat, mutedUntil: new Date(NOW + 60_000).toISOString() };
    const mention = msg({ mentions: [{ userId: 'u-me', offset: 0, length: 3 }] });
    expect(incomingSound(mention, ctx({ chat: muted }))).toBeNull();
    const expired = { ...chat, mutedUntil: new Date(NOW - 60_000).toISOString() };
    expect(incomingSound(msg(), ctx({ chat: expired }))).toBe('chime');
    expect(incomingSound(msg(), ctx({ quietAllows: () => false }))).toBeNull();
  });

  it('follows the settings: all off, or each kind off', () => {
    const off = (changes: object) => ctx({ settings: { ...DEFAULT_PUSH_SETTINGS, ...changes } });
    expect(incomingSound(msg(), off({ sound: false }))).toBeNull();
    expect(incomingSound(msg(), off({ soundMessages: false }))).toBeNull();
    const onScreen = ctx({
      openChatId: 'c1',
      settings: { ...DEFAULT_PUSH_SETTINGS, soundOpenChat: false },
    });
    expect(incomingSound(msg(), onScreen)).toBeNull();
    const mention = msg({ mentionsEveryone: true });
    expect(incomingSound(mention, off({ soundMentions: false }))).toBeNull();
    expect(sentSound(DEFAULT_PUSH_SETTINGS, false)).toBe('sent');
    expect(sentSound({ ...DEFAULT_PUSH_SETTINGS, soundSent: false }, false)).toBeNull();
    expect(sentSound(DEFAULT_PUSH_SETTINGS, true)).toBeNull();
  });
});

describe('a burst makes one sound', () => {
  it('one per gap; a mention still gets through right after a plain message', () => {
    const gate = createSoundGate(SOUND_GAP_MS);
    expect(gate('chime', 0)).toBe(true);
    expect(gate('chime', 300)).toBe(false);
    expect(gate('tick', 1000)).toBe(false);
    expect(gate('mention', 1200)).toBe(true);
    expect(gate('mention', 1300)).toBe(false);
    expect(gate('chime', 1200 + SOUND_GAP_MS)).toBe(true);
  });
});
