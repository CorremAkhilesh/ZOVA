import { describe, expect, it } from 'vitest';
import { buildTimeline, dayKind, filterChats, formatListTime } from './chat-utils';
import { MOCK_CHATS } from './mock-data';
import { type ChatMessage, ME } from './types';

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
  const msg = (id: string, author: string, date: Date): ChatMessage => ({
    id,
    chatId: 'c',
    author,
    text: id,
    at: date,
  });

  it('adds a date separator per day and groups consecutive messages by author', () => {
    const items = buildTimeline([
      msg('c', ME, at(4, 10, 3)),
      msg('a', 'Asha', at(3, 10, 0)),
      msg('b', ME, at(4, 10, 0)),
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

  it('returns nothing for an empty chat', () => {
    expect(buildTimeline([])).toEqual([]);
  });
});

describe('filterChats', () => {
  it('puts pinned chats first, then newest first', () => {
    const result = filterChats(MOCK_CHATS, 'all', '');
    const firstUnpinned = result.findIndex((chat) => !chat.pinned);
    expect(result.slice(0, firstUnpinned).every((chat) => chat.pinned)).toBe(true);
    const rest = result.slice(firstUnpinned).map((chat) => chat.lastMessage.at.getTime());
    expect(rest).toEqual([...rest].sort((a, b) => b - a));
  });

  it.each([
    ['unread', (c: (typeof MOCK_CHATS)[number]) => c.unread > 0],
    ['groups', (c: (typeof MOCK_CHATS)[number]) => c.kind === 'group'],
    ['personal', (c: (typeof MOCK_CHATS)[number]) => c.kind === 'personal'],
  ] as const)('filters the %s folder', (folder, predicate) => {
    const result = filterChats(MOCK_CHATS, folder, '');
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(predicate)).toBe(true);
  });

  it('searches names and last messages case-insensitively', () => {
    expect(filterChats(MOCK_CHATS, 'all', 'ASHA').map((c) => c.id)).toEqual(['asha']);
    expect(filterChats(MOCK_CHATS, 'all', 'q3 deck').map((c) => c.id)).toEqual(['rahul']);
    expect(filterChats(MOCK_CHATS, 'all', 'nothing-matches')).toEqual([]);
  });
});
