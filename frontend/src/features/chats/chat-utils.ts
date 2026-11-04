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

/** Inserts date separators and marks the first/last message of each author group. */
export function buildTimeline(messages: ChatMessage[]): TimelineItem[] {
  const sorted = [...messages].sort((a, b) => a.at.getTime() - b.at.getTime());
  const items: TimelineItem[] = [];
  sorted.forEach((message, index) => {
    const previous = sorted[index - 1];
    const next = sorted[index + 1];
    const newDay = !previous || startOfDay(previous.at) !== startOfDay(message.at);
    if (newDay)
      items.push({ type: 'date', key: `date-${startOfDay(message.at)}`, date: message.at });

    const joinsPrevious =
      !newDay &&
      previous?.author === message.author &&
      message.at.getTime() - previous.at.getTime() <= GROUP_WINDOW_MS;
    const joinsNext =
      next !== undefined &&
      next.author === message.author &&
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

/** Folder + search filter, pinned chats first, then newest first. */
export function filterChats(
  chats: ChatSummary[],
  folder: ChatFolder,
  query: string,
): ChatSummary[] {
  const needle = query.trim().toLocaleLowerCase();
  return chats
    .filter((chat) => {
      if (folder === 'unread' && chat.unread === 0) return false;
      if (folder === 'groups' && chat.kind !== 'group') return false;
      if (folder === 'personal' && chat.kind !== 'personal') return false;
      if (!needle) return true;
      return (
        chat.name.toLocaleLowerCase().includes(needle) ||
        chat.lastMessage.text.toLocaleLowerCase().includes(needle)
      );
    })
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.lastMessage.at.getTime() - a.lastMessage.at.getTime();
    });
}
