import { describe, expect, it } from 'vitest';
import { filterChats } from '@/features/chats/chat-utils';
import { type ChatMessage, type ChatSummary, ME } from '@/features/chats/types';
import {
  canDeleteForEveryone,
  canEdit,
  copyLines,
  deletesAsAdmin,
  groupReactions,
  toQuote,
} from './rules';
import { useMessageUi } from './store';

const NOW = Date.UTC(2026, 10, 6, 12);
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000);
const message = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'k',
  chatId: 'c',
  authorId: ME,
  authorName: 'Me',
  text: 'hello',
  at: minutesAgo(1),
  serverId: 'm',
  seq: 3,
  ...overrides,
});
const adminIn = { group: { myRole: 'admin', active: true } } as Pick<ChatSummary, 'group'>;
const memberIn = { group: { myRole: 'member', active: true } } as Pick<ChatSummary, 'group'>;
const leftAdmin = { group: { myRole: 'admin', active: false } } as Pick<ChatSummary, 'group'>;
const direct = { group: null };

describe('edit is offered', () => {
  it('on my own message for 15 minutes', () => {
    expect(canEdit(message({ at: minutesAgo(14) }), NOW)).toBe(true);
    expect(canEdit(message({ at: minutesAgo(16) }), NOW)).toBe(false);
  });

  it('not on others, unsent, deleted, or voice notes', () => {
    expect(canEdit(message({ authorId: 'u2' }), NOW)).toBe(false);
    expect(canEdit(message({ serverId: null }), NOW)).toBe(false);
    expect(canEdit(message({ deleted: true }), NOW)).toBe(false);
    const voice = { kind: 'voice' } as NonNullable<ChatMessage['media']>;
    expect(canEdit(message({ media: voice }), NOW)).toBe(false);
  });
});

describe('delete for everyone is offered', () => {
  it('on my own message for 48 hours', () => {
    expect(canDeleteForEveryone(message({ at: minutesAgo(47 * 60) }), direct, NOW)).toBe(true);
    expect(canDeleteForEveryone(message({ at: minutesAgo(49 * 60) }), direct, NOW)).toBe(false);
  });

  it("on anyone's to a group admin who is still there, whenever", () => {
    const old = message({ authorId: 'u2', at: minutesAgo(100 * 60) });
    expect(canDeleteForEveryone(old, adminIn, NOW)).toBe(true);
    expect(deletesAsAdmin(old, adminIn)).toBe(true);
    expect(canDeleteForEveryone(old, memberIn, NOW)).toBe(false);
    expect(canDeleteForEveryone(old, leftAdmin, NOW)).toBe(false);
    expect(deletesAsAdmin(message(), adminIn)).toBe(false);
  });
});

describe('quotes', () => {
  it('carry who, where and what', () => {
    expect(toQuote(message(), 'u1', 'Kiran')).toMatchObject({
      id: 'm',
      chatId: 'c',
      seq: 3,
      senderId: 'u1',
      senderName: 'Kiran',
      text: 'hello',
    });
  });

  it('cannot be made of a message the server does not have yet', () => {
    expect(toQuote(message({ serverId: null }), 'u1', 'Kiran')).toBeUndefined();
  });
});

describe('copying several messages', () => {
  it('gives sender and time, oldest first, and skips what has no text', () => {
    const lines = copyLines(
      [
        message({ text: 'second', at: minutesAgo(1) }),
        message({ text: '', at: minutesAgo(2) }),
        message({ text: 'first', authorId: 'u2', authorName: 'Riya', at: minutesAgo(3) }),
      ],
      'You',
      'en-GB',
    ).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\[.+\] Riya: first$/);
    expect(lines[1]).toMatch(/^\[.+\] You: second$/);
  });
});

it('pills group by emoji, most used first', () => {
  const at = '2026-11-06T10:00:00.000Z';
  expect(
    groupReactions([
      { userId: 'a', emoji: '👍', at },
      { userId: 'b', emoji: '❤️', at },
      { userId: 'c', emoji: '❤️', at },
    ]),
  ).toEqual([
    { emoji: '❤️', userIds: ['b', 'c'] },
    { emoji: '👍', userIds: ['a'] },
  ]);
});

describe('the chat list', () => {
  const chat = (id: string, overrides: Partial<ChatSummary>): ChatSummary => ({
    id,
    name: id,
    kind: 'personal',
    pinned: false,
    muted: false,
    unread: 0,
    activityAt: new Date(NOW),
    lastMessage: null,
    ...overrides,
  });
  const ids = (chats: ChatSummary[]) => chats.map((item) => item.id);

  it('keeps archived chats in their own list, and a search finds them anywhere', () => {
    const chats = [chat('open', {}), chat('kept', { archived: true })];
    expect(ids(filterChats(chats, 'all', ''))).toEqual(['open']);
    expect(ids(filterChats(chats, 'all', '', true))).toEqual(['kept']);
    expect(ids(filterChats(chats, 'all', 'kept'))).toEqual(['kept']);
  });

  it('counts a chat marked unread as unread', () => {
    const chats = [chat('read', {}), chat('marked', { markedUnread: true })];
    expect(ids(filterChats(chats, 'unread', ''))).toEqual(['marked']);
  });
});

describe('Esc lets go of the nearest thing', () => {
  it('selection, then edit, then reply, then nothing', () => {
    const ui = useMessageUi.getState();
    const quote = toQuote(message(), 'u1', 'Kiran');
    ui.setReply('c', quote);
    ui.setEditing({ chatId: 'c', messageId: 'm', seq: 3, text: 'x' });
    // Editing takes the place of a reply.
    expect(useMessageUi.getState().replies.c).toBeUndefined();
    ui.startSelecting('c', message());
    expect(ui.cancelOne('c')).toBe(true);
    expect(useMessageUi.getState().selecting).toBeNull();
    ui.setEditing({ chatId: 'c', messageId: 'm', seq: 3, text: 'x' });
    expect(ui.cancelOne('c')).toBe(true);
    expect(useMessageUi.getState().editing).toBeNull();
    ui.setReply('c', quote);
    expect(ui.cancelOne('c')).toBe(true);
    expect(ui.cancelOne('c')).toBe(false);
  });

  it('deselecting the last message ends selecting', () => {
    const ui = useMessageUi.getState();
    ui.startSelecting('c', message());
    ui.toggleSelected(message());
    expect(useMessageUi.getState().selecting).toBeNull();
  });
});
