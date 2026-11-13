import type { ChatFolderDef } from '@zuvo/protocol';
import { chatInFolder, customFolder, isUnread } from '@/features/folders/rules';
import type { ChatFolder, ChatMessage, ChatSummary } from './types';

const DAY_MS = 86_400_000;
/** Consecutive messages from the same author within this window form one visual group. */
const GROUP_WINDOW_MS = 5 * 60_000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export type DayKind = 'today' | 'yesterday' | 'thisWeek' | 'older';

export function dayKind(date: Date, now: Date): DayKind {
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return 'thisWeek';
  return 'older';
}

export function formatClock(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date);
}

/**
 * Chat list timestamp: time today, "yesterday" label, weekday this week, short date otherwise.
 * `yesterdayLabel` comes from i18n.
 */
export function formatListTime(date: Date, now: Date, locale: string, yesterdayLabel: string) {
  switch (dayKind(date, now)) {
    case 'today':
      return formatClock(date, locale);
    case 'yesterday':
      return yesterdayLabel;
    case 'thisWeek':
      return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);
    default:
      return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(date);
  }
}

export type TimelineItem =
  | { type: 'date'; key: string; date: Date }
  | {
      type: 'message';
      key: string;
      message: ChatMessage;
      firstInGroup: boolean;
      lastInGroup: boolean;
    };

/**
 * Inserts date separators and marks the first/last message of each author group. `messages` stay in
 * the given order (their position in the chat), which a device's clock must not rearrange.
 */
export function buildTimeline(messages: ChatMessage[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  messages.forEach((message, index) => {
    const previous = messages[index - 1];
    const next = messages[index + 1];
    const newDay = !previous || startOfDay(previous.at) !== startOfDay(message.at);
    if (newDay) items.push({ type: 'date', key: `date-${message.id}`, date: message.at });

    const joinsPrevious =
      !newDay &&
      previous?.authorId === message.authorId &&
      message.at.getTime() - previous.at.getTime() <= GROUP_WINDOW_MS;
    const joinsNext =
      next !== undefined &&
      next.authorId === message.authorId &&
      startOfDay(next.at) === startOfDay(message.at) &&
      next.at.getTime() - message.at.getTime() <= GROUP_WINDOW_MS;

    items.push({
      type: 'message',
      key: message.id,
      message,
      firstInGroup: !joinsPrevious,
      lastInGroup: !joinsNext,
    });
  });
  return items;
}

/** Whether a chip shows a chat. Outside a search, archived chats only show in the archived list. */
function inChip(
  chat: ChatSummary,
  folder: ChatFolder,
  custom: ChatFolderDef | undefined,
  archivedList: boolean,
  searching: boolean,
): boolean {
  if (custom) {
    // A folder of my own decides about archived chats itself, picked ones included.
    if (!searching && archivedList && chat.archived !== true) return false;
    return chatInFolder(chat, custom);
  }
  if (!searching && (chat.archived === true) !== archivedList) return false;
  if (folder === 'unread') return isUnread(chat);
  if (folder === 'groups') return chat.kind === 'group';
  if (folder === 'personal') return chat.kind !== 'group';
  return true;
}

/**
 * Folder + name search. Saved Messages first, then pinned chats, then the latest activity. Archived
 * chats have their own list, and a search finds them anywhere. A folder of my own decides for itself
 * (`chatInFolder`): its picked archived chats show in it.
 */
export function filterChats(
  chats: ChatSummary[],
  folder: ChatFolder,
  query: string,
  archivedList = false,
  folders: readonly ChatFolderDef[] = [],
): ChatSummary[] {
  const needle = query.trim().toLocaleLowerCase();
  const custom = customFolder(folder, folders);
  return chats
    .filter(
      (chat) =>
        inChip(chat, folder, custom, archivedList, needle !== '') &&
        (!needle || chat.name.toLocaleLowerCase().includes(needle)),
    )
    .sort((a, b) => {
      if ((a.kind === 'saved') !== (b.kind === 'saved')) return a.kind === 'saved' ? -1 : 1;
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.activityAt.getTime() - a.activityAt.getTime();
    });
}

/** A chip's badge: its chats with something unread. Muted chats don't count. */
export function folderUnreadCount(
  chats: ChatSummary[],
  folder: ChatFolder,
  folders: readonly ChatFolderDef[] = [],
): number {
  return filterChats(chats, folder, '', false, folders).filter(
    (chat) => isUnread(chat) && !chat.muted,
  ).length;
}
