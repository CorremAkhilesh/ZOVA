import { describe, expect, it } from 'vitest';
import { buildTimeline, dayKind, filterChats, formatListTime } from './chat-utils';
import { type ChatMessage, type ChatSummary, ME } from './types';

const now = new Date(2026, 10, 4, 15, 0);
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute);

describe('dayKind / formatListTime', () => {
  it.each([
    [at(4, 9), 'today'],
    [at(3, 23), 'yesterday'],
    [new Date(2026, 9, 20, 10), 'older'],
    [at(1, 10), 'thisWeek'],
  ] as const)('%s is %s', (date, expected) => {
    expect(dayKind(date, now)).toBe(expected);
  });

  it('formats each range differently', () => {
    expect(formatListTime(at(4, 9, 5), now, 'en-GB', 'Yesterday')).toBe('9:05');
    expect(formatListTime(at(3, 9), now, 'en-GB', 'Yesterday')).toBe('Yesterday');
    expect(formatListTime(at(1, 9), now, 'en-GB', 'Yesterday')).toBe('Sun');
    expect(formatListTime(new Date(2026, 9, 20), now, 'en-GB', 'Yesterday')).toBe('20 Oct');
  });
});

describe('buildTimeline', () => {
  const msg = (id: string, authorId: string, date: Date): ChatMessage => ({
    id,
    chatId: 'c',
    authorId,
    authorName: authorId,
    text: id,
    at: date,
  });

  it('adds a date separator per day and groups consecutive messages by author', () => {
    const items = buildTimeline([
      msg('a', 'Asha', at(3, 10, 0)),
      msg('b', ME, at(4, 10, 0)),
      msg('c', ME, at(4, 10, 3)),
      msg('d', ME, at(4, 10, 30)),
    ]);
    expect(items.map((item) => (item.type === 'date' ? 'date' : item.message.id))).toEqual([
      'date',
      'a',
      'date',
      'b',
      'c',
      'd',
    ]);
    const flags = items
      .filter((item) => item.type === 'message')
      .map((item) => (item.type === 'message' ? [item.firstInGroup, item.lastInGroup] : []));
    // a: alone · b+c: one group (3 min apart) · d: 27 min later → new group
    expect(flags).toEqual([
      [true, true],
      [true, false],
      [false, true],
      [true, true],
    ]);
  });

  it('keeps the chat order even when a clock disagrees', () => {
    const items = buildTimeline([msg('late clock', ME, at(4, 11)), msg('next', 'Asha', at(4, 10))]);
    expect(items.flatMap((item) => (item.type === 'message' ? [item.message.id] : []))).toEqual([
      'late clock',
      'next',
    ]);
  });

  it('gives every row its own key, even if a clock repeats a day', () => {
    const keys = buildTimeline([
      msg('a', ME, at(4, 10)),
      msg('b', ME, at(3, 10)),
      msg('c', ME, at(4, 10)),
    ]).map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('returns nothing for an empty chat', () => {
    expect(buildTimeline([])).toEqual([]);
  });
});

describe('filterChats', () => {
  const chat = (id: string, overrides: Partial<ChatSummary> = {}): ChatSummary => ({
    id,
    name: id,
    kind: 'personal',
    pinned: false,
    muted: false,
    unread: 0,
    activityAt: at(1, 9),
    lastMessage: null,
    ...overrides,
  });
  const CHATS = [
    chat('Asha Verma', { activityAt: at(2, 9), unread: 2 }),
    chat('Saved Messages', { kind: 'saved', activityAt: at(1, 9) }),
    chat('Rahul', { activityAt: at(3, 9) }),
    chat('Design team', { kind: 'group', activityAt: at(4, 9), pinned: true }),
  ];
  const names = (chats: ChatSummary[]) => chats.map((item) => item.name);

  it('puts Saved Messages first, then pinned chats, then the latest activity', () => {
    expect(names(filterChats(CHATS, 'all', ''))).toEqual([
      'Saved Messages',
      'Design team',
      'Rahul',
      'Asha Verma',
    ]);
  });

  it('filters by folder', () => {
    expect(names(filterChats(CHATS, 'unread', ''))).toEqual(['Asha Verma']);
    expect(names(filterChats(CHATS, 'groups', ''))).toEqual(['Design team']);
    expect(names(filterChats(CHATS, 'personal', ''))).toEqual([
      'Saved Messages',
      'Rahul',
      'Asha Verma',
    ]);
  });

  it('searches names case-insensitively, and not the message text', () => {
    const withText = chat('Rahul', {
      lastMessage: { authorId: 'x', authorName: 'x', text: 'q3 deck', at: at(1, 9) },
    });
    expect(names(filterChats(CHATS, 'all', 'ASHA'))).toEqual(['Asha Verma']);
    expect(filterChats([withText], 'all', 'deck')).toEqual([]);
    expect(filterChats(CHATS, 'all', 'nothing-matches')).toEqual([]);
  });
});
