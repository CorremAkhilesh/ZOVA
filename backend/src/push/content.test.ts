import {
  DEFAULT_PUSH_SETTINGS,
  PUSH_BODY_MAX,
  type PushPayload,
  pushPayloadSchema,
} from '@zuvo/protocol';
import { describe, expect, it } from 'vitest';
import {
  buildMessagePayload,
  buildTestPayload,
  type MessageContentInput,
  truncate,
} from './content.ts';
import { describeMessage } from './strings.ts';

const CHAT = 'b'.repeat(24);
const NOW = new Date('2026-03-01T10:00:00Z');
const SECRET = 'the launch code is 4242';

function build(
  overrides: Partial<MessageContentInput> = {},
): Extract<PushPayload, { kind: 'message' }> {
  const payload = buildMessagePayload({
    chatId: CHAT,
    chatType: 'direct',
    groupName: null,
    senderName: 'Riya Sharma',
    newest: { text: SECRET, media: null, poll: null, viewOnce: false },
    seq: 7,
    count: 1,
    badge: 2,
    settings: DEFAULT_PUSH_SETTINGS,
    chatLocked: false,
    appLock: false,
    language: 'en',
    now: NOW,
    ...overrides,
  });
  // Every payload matches the protocol the service worker reads.
  pushPayloadSchema.parse(payload);
  if (payload.kind !== 'message') throw new Error('expected a message payload');
  return payload;
}

const media = (kind: 'image' | 'video' | 'voice' | 'audio' | 'document', extra = {}) => ({
  kind,
  name: 'report.pdf',
  duration: null,
  ...extra,
});

describe('buildMessagePayload', () => {
  it('shows the sender and the text in a 1:1 chat', () => {
    const payload = build();
    expect(payload).toMatchObject({
      kind: 'message',
      v: 1,
      chatId: CHAT,
      tag: `chat:${CHAT}`,
      title: 'Riya Sharma',
      body: SECRET,
      seq: 7,
      count: 1,
      badge: 2,
      hidden: false,
      silent: false,
      sentAt: NOW.toISOString(),
    });
  });

  it('shows the group name, and the sender before the text, in a group', () => {
    const payload = build({ chatType: 'group', groupName: 'Launch team' });
    expect(payload.title).toBe('Launch team');
    expect(payload.body).toBe(`Riya Sharma: ${SECRET}`);
  });

  it.each([
    ['preview off', { settings: { showPreview: false, sound: true } }],
    ['a locked chat', { chatLocked: true }],
    ['app lock', { appLock: true }],
  ])('never contains the text or who sent it with %s', (_, overrides) => {
    const payload = build({ chatType: 'group', groupName: 'Launch team', ...overrides });
    expect(payload).toMatchObject({ title: 'New message', body: '', hidden: true });
    const raw = JSON.stringify(payload);
    expect(raw).not.toContain('launch code');
    expect(raw).not.toContain('Riya');
    expect(raw).not.toContain('Launch team');
  });

  it('labels media, voice notes and polls', () => {
    const label = (overrides: Partial<MessageContentInput['newest']>) =>
      build({ newest: { text: null, media: null, poll: null, viewOnce: false, ...overrides } })
        .body;
    expect(label({ media: media('image') })).toBe('📷 Photo');
    expect(label({ media: media('image'), text: 'Sunset' })).toBe('📷 Sunset');
    expect(label({ media: media('video') })).toBe('🎥 Video');
    expect(label({ media: media('voice', { duration: 72 }) })).toBe('🎤 Voice message (1:12)');
    expect(label({ media: media('audio', { name: 'song.mp3' }) })).toBe('🎵 song.mp3');
    expect(label({ media: media('document') })).toBe('📄 report.pdf');
    expect(label({ media: media('document'), text: 'Q3' })).toBe('📄 report.pdf · Q3');
    expect(label({ poll: { question: 'Lunch?' } })).toBe('📊 Poll: Lunch?');
  });

  it('shows only the label of a view once photo or video, never its caption', () => {
    const viewOnce = (kind: 'image' | 'video') =>
      build({ newest: { text: SECRET, media: media(kind), poll: null, viewOnce: true } }).body;
    expect(viewOnce('image')).toBe('📷 View once photo');
    expect(viewOnce('video')).toBe('🎥 View once video');
  });

  it(`cuts long text at ${PUSH_BODY_MAX} characters with "…"`, () => {
    const body = build({
      newest: { text: 'x'.repeat(500), media: null, poll: null, viewOnce: false },
    }).body;
    expect(Array.from(body)).toHaveLength(PUSH_BODY_MAX);
    expect(body.endsWith('…')).toBe(true);
  });

  it('says how many more messages a coalesced notification holds', () => {
    expect(build({ count: 4 }).body).toBe(`${SECRET} (+3 more)`);
    expect(build({ count: 4, language: 'hi' }).body).toBe(`${SECRET} (+3 और)`);
    expect(build({ count: 4 }).count).toBe(4);
  });

  it('is silent when sound is off', () => {
    expect(build({ settings: { showPreview: true, sound: false } }).silent).toBe(true);
  });

  it('speaks Hindi to someone who chose it', () => {
    expect(build({ appLock: true, language: 'hi' }).title).toBe('नया संदेश');
    expect(
      describeMessage({ text: null, media: media('image'), poll: null, viewOnce: false }, 'hi'),
    ).toBe('📷 फ़ोटो');
  });

  it('stays well under the 3 KB a push service may carry', () => {
    const payload = build({
      chatType: 'group',
      groupName: 'g'.repeat(500),
      senderName: 'n'.repeat(500),
      newest: { text: '😀'.repeat(2000), media: null, poll: null, viewOnce: false },
      count: 99,
    });
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThan(1500);
  });
});

describe('buildTestPayload', () => {
  it('is a small test notification in the person’s language', () => {
    const payload = buildTestPayload({ showPreview: true, sound: false }, 'en', NOW);
    expect(pushPayloadSchema.parse(payload)).toEqual({
      kind: 'test',
      v: 1,
      tag: 'test',
      title: 'Test notification',
      body: 'Notifications work on this device.',
      silent: true,
      sentAt: NOW.toISOString(),
    });
    expect(buildTestPayload(DEFAULT_PUSH_SETTINGS, 'hi', NOW).title).toBe('टेस्ट सूचना');
  });
});

describe('truncate', () => {
  it('collapses whitespace and cuts at a whole character', () => {
    expect(truncate('  a \n b  ', 10)).toBe('a b');
    expect(truncate('😀😀😀', 2)).toBe('😀…');
  });
});
