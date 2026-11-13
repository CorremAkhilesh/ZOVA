import { describe, expect, it } from 'vitest';
import { sendMessagePayloadSchema } from '../realtime/chat.ts';
import { clientToServerEvents, serverToClientEvents } from '../realtime/events.ts';
import { MESSAGE_TEXT_MAX, markReadBodySchema } from './chats.ts';
import { renameSessionBodySchema } from './security.ts';
import { messageHistoryQuerySchema, syncQuerySchema } from './sync.ts';

const chatId = '6aea9e7492c525fa72210c66';
const clientMsgId = '0197f5a4-7c3e-7b1a-8d2f-1a2b3c4d5e6f';

describe('message:send payload', () => {
  const parse = (fields: object) =>
    sendMessagePayloadSchema.safeParse({ chatId, clientMsgId, text: 'hi', ...fields }).success;

  it('accepts a normal message, up to the limit', () => {
    expect(parse({})).toBe(true);
    expect(parse({ text: 'x'.repeat(MESSAGE_TEXT_MAX) })).toBe(true);
  });

  it('rejects empty, blank or oversized text, other UUID versions and bad chat ids', () => {
    expect(parse({ text: '' })).toBe(false);
    expect(parse({ text: ' \n ' })).toBe(false);
    expect(parse({ text: 'x'.repeat(MESSAGE_TEXT_MAX + 1) })).toBe(false);
    expect(parse({ clientMsgId: '6ba7b810-9dad-41d4-80b4-00c04fd430c8' })).toBe(false);
    expect(parse({ chatId: 'nope' })).toBe(false);
  });
});

describe('queries and bodies', () => {
  it('caps history pages at 100 and requires real positions', () => {
    expect(messageHistoryQuerySchema.parse({}).limit).toBe(50);
    expect(messageHistoryQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(messageHistoryQuerySchema.safeParse({ before: '0' }).success).toBe(false);
    expect(messageHistoryQuerySchema.parse({ after: '0' }).after).toBe(0);
  });

  it('accepts only numeric sync cursors', () => {
    expect(syncQuerySchema.parse({ since: '12' }).since).toBe('12');
    expect(syncQuerySchema.safeParse({ since: '12; drop' }).success).toBe(false);
    expect(syncQuerySchema.safeParse({ since: '-1' }).success).toBe(false);
  });

  it('never accepts a negative read position', () => {
    expect(markReadBodySchema.safeParse({ seq: -1 }).success).toBe(false);
    expect(markReadBodySchema.safeParse({ seq: 1.5 }).success).toBe(false);
  });

  it('trims device names and treats blank as no name', () => {
    expect(renameSessionBodySchema.parse({ name: '  Laptop ' }).name).toBe('Laptop');
    expect(renameSessionBodySchema.parse({ name: '   ' }).name).toBeNull();
    expect(renameSessionBodySchema.parse({ name: null }).name).toBeNull();
    expect(renameSessionBodySchema.safeParse({ name: 'x'.repeat(31) }).success).toBe(false);
  });
});

describe('event maps', () => {
  it('define every event named in the realtime contract', () => {
    expect(Object.keys(clientToServerEvents)).toEqual(
      expect.arrayContaining(['message:send', 'read:update', 'typing:start', 'typing:stop']),
    );
    expect(Object.keys(serverToClientEvents)).toEqual(
      expect.arrayContaining([
        'message:new',
        'chat:updated',
        'read:update',
        'session:revoked',
        'typing:update',
        'presence:update',
        'receipt:update',
      ]),
    );
  });
});
