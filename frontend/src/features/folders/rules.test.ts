import { type ChatFolderDef, folderEmojiSchema, NO_FOLDER_RULES } from '@zuvo/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { filterChats, folderUnreadCount } from '@/features/chats/chat-utils';
import type { ChatSummary } from '@/features/chats/types';
import { FOLDER_EMOJI } from './components/FolderFields';
import { moveFolder } from './mutations';
import { chatInFolder, folderLabel, resolveFolder } from './rules';
import { readSelectedFolder, SELECTED_FOLDER_KEY, saveSelectedFolder } from './store';

const chat = (overrides: Partial<ChatSummary> = {}): ChatSummary => ({
  id: 'c',
  name: 'Chat',
  kind: 'personal',
  pinned: false,
  muted: false,
  unread: 0,
  activityAt: new Date('2026-11-01T10:00:00Z'),
  lastMessage: null,
  ...overrides,
});
const folder = (overrides: Partial<ChatFolderDef> = {}): ChatFolderDef => ({
  id: 'f1',
  name: 'Work',
  emoji: null,
  chatIds: [],
  rules: { ...NO_FOLDER_RULES, excludeArchived: false },
  ...overrides,
});
const rules = (on: Partial<ChatFolderDef['rules']>) => ({
  ...NO_FOLDER_RULES,
  excludeArchived: false,
  ...on,
});

describe('chatInFolder', () => {
  const group = chat({ id: 'g', kind: 'group' });
  const direct = chat({ id: 'd' });
  const saved = chat({ id: 's', kind: 'saved' });
  const unread = chat({ id: 'u', unread: 2 });
  const marked = chat({ id: 'm', markedUnread: true });

  it.each([
    ['nothing, with no rules and no picks', {}, direct, false],
    ['a group, by the groups rule', { groups: true }, group, true],
    ['not a 1:1 chat, by the groups rule', { groups: true }, direct, false],
    ['a 1:1 chat, by the direct rule', { direct: true }, direct, true],
    ['not a group, by the direct rule', { direct: true }, group, false],
    ['not Saved Messages, by the direct rule', { direct: true }, saved, false],
    ['an unread chat, by the unread rule', { unread: true }, unread, true],
    ['a chat marked unread, by the unread rule', { unread: true }, marked, true],
    ['not a read chat, by the unread rule', { unread: true }, direct, false],
  ])('takes in %s', (_name, on, item, expected) => {
    expect(chatInFolder(item, folder({ rules: rules(on) }))).toBe(expected);
  });

  it('leaves out muted or archived chats that only a rule took in', () => {
    const muted = chat({ id: 'x', kind: 'group', muted: true });
    const archived = chat({ id: 'y', kind: 'group', archived: true });
    expect(chatInFolder(muted, folder({ rules: rules({ groups: true }) }))).toBe(true);
    expect(
      chatInFolder(muted, folder({ rules: rules({ groups: true, excludeMuted: true }) })),
    ).toBe(false);
    expect(
      chatInFolder(archived, folder({ rules: rules({ groups: true, excludeArchived: true }) })),
    ).toBe(false);
  });

  it('always keeps picked chats, whatever the exclusions', () => {
    const picked = chat({ id: 'p', muted: true, archived: true });
    const strict = rules({ excludeMuted: true, excludeArchived: true });
    expect(chatInFolder(picked, folder({ chatIds: ['p'], rules: strict }))).toBe(true);
    expect(chatInFolder(saved, folder({ chatIds: ['s'] }))).toBe(true);
  });
});

describe('filtering by a folder of my own', () => {
  const chats = [
    chat({ id: 'a', name: 'Asha', unread: 1 }),
    chat({ id: 'b', name: 'Bharat', archived: true }),
    chat({ id: 'g', name: 'Team', kind: 'group', unread: 4, muted: true }),
    chat({ id: 'h', name: 'Hikers', kind: 'group', markedUnread: true }),
  ];
  const work = folder({ chatIds: ['b'], rules: rules({ groups: true }) });

  it('shows picked archived chats, which All leaves to the archived list', () => {
    expect(filterChats(chats, 'folder:f1', '', false, [work]).map((c) => c.id)).toEqual([
      'b',
      'g',
      'h',
    ]);
    expect(filterChats(chats, 'all', '').map((c) => c.id)).not.toContain('b');
    expect(filterChats(chats, 'folder:f1', 'tea', false, [work]).map((c) => c.id)).toEqual(['g']);
  });

  it('falls back to every chat when the folder is unknown', () => {
    expect(filterChats(chats, 'folder:gone', '', false, [work])).toHaveLength(3);
  });

  it('counts unread chats per chip, leaving out muted ones', () => {
    expect(folderUnreadCount(chats, 'all')).toBe(2);
    expect(folderUnreadCount(chats, 'groups')).toBe(1);
    expect(folderUnreadCount(chats, 'personal')).toBe(1);
    expect(folderUnreadCount(chats, 'folder:f1', [work])).toBe(1);
  });
});

describe('the selected chip', () => {
  afterEach(() => localStorage.clear());

  it('falls back to All once a deleted folder is known to be gone', () => {
    expect(resolveFolder('folder:f1', undefined)).toBe('folder:f1');
    expect(resolveFolder('folder:f1', [folder()])).toBe('folder:f1');
    expect(resolveFolder('folder:f1', [])).toBe('all');
    expect(resolveFolder('unread', [])).toBe('unread');
  });

  it('is remembered on this device, ignoring anything odd', () => {
    expect(readSelectedFolder()).toBe('all');
    saveSelectedFolder('folder:abc');
    expect(readSelectedFolder()).toBe('folder:abc');
    saveSelectedFolder('all');
    expect(localStorage.getItem(SELECTED_FOLDER_KEY)).toBeNull();
    localStorage.setItem(SELECTED_FOLDER_KEY, 'nonsense');
    expect(readSelectedFolder()).toBe('all');
  });
});

describe('helpers', () => {
  it('moves a folder up or down, not past either end', () => {
    expect(moveFolder(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveFolder(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveFolder(['a', 'b'], 'a', -1)).toBeNull();
    expect(moveFolder(['a', 'b'], 'b', 1)).toBeNull();
  });

  it('labels a chip with its emoji', () => {
    expect(folderLabel({ name: 'Work', emoji: '💼' })).toBe('💼 Work');
    expect(folderLabel({ name: 'Work', emoji: null })).toBe('Work');
  });

  it('offers only emoji the server accepts', () => {
    for (const emoji of FOLDER_EMOJI) expect(folderEmojiSchema.safeParse(emoji).success).toBe(true);
  });
});
