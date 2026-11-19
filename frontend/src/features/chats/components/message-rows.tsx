import { useTranslation } from 'react-i18next';
import { dayKind, type TimelineItem } from '../chat-utils';
import { repeatsSystem } from '../system-collapse';
import type { ChatMessage } from '../types';

/** The day of the messages at the top stays on screen this long after scrolling stops. */
export const FLOATING_DAY_MS = 1500;

/** While scrolling: the day of the topmost message, pinned at the top (like a sticky separator). */
export function FloatingDay({ date }: { date: Date | null }) {
  const label = useDayLabel(date);
  if (!date) return null;
  return (
    <div
      aria-hidden
      data-testid="floating-day"
      className="pointer-events-none absolute top-2 left-1/2 z-10 -translate-x-1/2"
    >
      <span className="rounded-lg bg-surface px-3 py-1 text-xs font-medium text-text-muted shadow-sm">
        {label}
      </span>
    </div>
  );
}

/** "Today", "Yesterday" or "Monday, 3 November". */
function useDayLabel(date: Date | null): string {
  const { t, i18n } = useTranslation();
  if (!date) return '';
  const kind = dayKind(date, new Date());
  return kind === 'today'
    ? t('conversation.today')
    : kind === 'yesterday'
      ? t('conversation.yesterday')
      : new Intl.DateTimeFormat(i18n.language, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        }).format(date);
}

export function DateSeparator({ date }: { date: Date }) {
  const label = useDayLabel(date);
  return (
    <div className="flex justify-center py-1.5">
      <span className="rounded-lg bg-surface px-3 py-1 text-xs font-medium text-text-muted shadow-sm">
        {label}
      </span>
    </div>
  );
}

type MessageItem = Extract<TimelineItem, { type: 'message' }>;
export type Row = MessageItem & {
  date: Date | null;
  albumId: string | null;
  album: ChatMessage[] | null;
  /** A system line repeated this many times in a row ("You changed the group photo (3)"). */
  repeat: number;
};

/**
 * One list row per message, with its date separator inside. A separator as a row of its own would
 * lose its identity when older messages arrive, and the list could no longer hold the reader's place.
 */
export function toRows(timeline: TimelineItem[]): Row[] {
  let date: Date | null = null;
  const rows: Row[] = [];
  for (const item of timeline) {
    if (item.type === 'date') {
      date = item.date;
      continue;
    }
    const previous = rows.at(-1);
    const { albumId, authorId } = item.message;
    // The same system line again, on the same day: one line with a count.
    if (!date && repeatsSystem(previous?.message.system, item.message.system) && previous) {
      previous.repeat += 1;
      previous.message = item.message;
      continue;
    }
    // The same album, with no new day between: one row, one bubble.
    if (
      albumId &&
      !date &&
      previous?.albumId === albumId &&
      previous.message.authorId === authorId
    ) {
      previous.album = [...(previous.album ?? [previous.message]), item.message];
      previous.lastInGroup = item.lastInGroup;
      continue;
    }
    rows.push({ ...item, date, albumId: albumId ?? null, album: null, repeat: 1 });
    date = null;
  }
  return rows;
}
