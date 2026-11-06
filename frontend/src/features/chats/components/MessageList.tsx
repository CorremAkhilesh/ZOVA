import { useVirtualizer } from '@tanstack/react-virtual';
import { type Ref, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@/components/ui/scroll-area';
import { buildTimeline, dayKind, type TimelineItem } from '../chat-utils';
import type { ChatMessage } from '../types';
import { MessageBubble } from './MessageBubble';

/** Within this distance from the end still counts as "at the bottom". */
const BOTTOM_SLOP_PX = 64;
/** Starts fetching older messages this far before the top, so scrolling rarely stops. */
const TOP_SLOP_PX = 600;
const ROW_ESTIMATE_PX = 52;
const DATE_ESTIMATE_PX = 44;

function DateSeparator({ date }: { date: Date }) {
  const { t, i18n } = useTranslation();
  const kind = dayKind(date, new Date());
  const label =
    kind === 'today'
      ? t('conversation.today')
      : kind === 'yesterday'
        ? t('conversation.yesterday')
        : new Intl.DateTimeFormat(i18n.language, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          }).format(date);
  return (
    <div className="flex justify-center py-2">
      <span className="glass rounded-full border px-3 py-1 text-xs font-medium text-text-muted shadow-sm">
        {label}
      </span>
    </div>
  );
}

type MessageItem = Extract<TimelineItem, { type: 'message' }>;
type Row = MessageItem & {
  date: Date | null;
  albumId: string | null;
  album: ChatMessage[] | null;
};

/**
 * One list row per message, with its date separator inside. A separator as a row of its own would
 * lose its identity when older messages arrive, and the list could no longer hold the reader's place.
 */
function toRows(timeline: TimelineItem[]): Row[] {
  let date: Date | null = null;
  const rows: Row[] = [];
  for (const item of timeline) {
    if (item.type === 'date') {
      date = item.date;
      continue;
    }
    const previous = rows.at(-1);
    const { albumId, authorId } = item.message;
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
    rows.push({ ...item, date, albumId: albumId ?? null, album: null });
    date = null;
  }
  return rows;
}

export interface MessageListHandle {
  scrollToBottom(): void;
}

interface MessageListProps {
  ref: Ref<MessageListHandle>;
  chatName: string;
  isGroup: boolean;
  chatId?: string;
  messages: ChatMessage[];
  /** Undefined when there is nothing older to load. */
  onReachTop: (() => void) | undefined;
  onAtBottomChange: (atBottom: boolean) => void;
  onRetry: (clientMsgId: string) => void;
  onOpenMedia?: (mediaId: string) => void;
}

/**
 * Only the rows near the viewport exist in the page, so a long chat scrolls as smoothly as a short
 * one. Stays at the bottom only while the reader is there, and holds its place when older messages
 * arrive above.
 */
export function MessageList({
  ref,
  chatName,
  isGroup,
  chatId,
  messages,
  onReachTop,
  onAtBottomChange,
  onRetry,
  onOpenMedia,
}: MessageListProps) {
  const { t } = useTranslation();
  const viewport = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const rows = useMemo(() => toRows(buildTimeline(messages)), [messages]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewport.current,
    estimateSize: (index) =>
      rows[index]?.date ? ROW_ESTIMATE_PX + DATE_ESTIMATE_PX : ROW_ESTIMATE_PX,
    getItemKey: (index) => {
      const row = rows[index];
      return row?.albumId ? `album-${row.albumId}` : (row?.key ?? index);
    },
    overscan: 10,
    anchorTo: 'end',
  });
  const total = virtualizer.getTotalSize();

  const setStick = (next: boolean) => {
    if (stick.current === next) return;
    stick.current = next;
    onAtBottomChange(next);
  };

  useImperativeHandle(ref, () => ({
    scrollToBottom() {
      setStick(true);
      const element = viewport.current;
      if (element) element.scrollTop = element.scrollHeight;
    },
  }));

  // After every change in content, before the browser paints. Older messages arriving above need
  // nothing here: `anchorTo` keeps the row the reader is looking at in place.
  // biome-ignore lint/correctness/useExhaustiveDependencies: both change what the bottom is
  useLayoutEffect(() => {
    const element = viewport.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  }, [messages, total]);

  function handleScroll() {
    const element = viewport.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    setStick(distance <= BOTTOM_SLOP_PX);
    if (element.scrollTop <= TOP_SLOP_PX) onReachTop?.();
  }

  return (
    <ScrollArea
      viewportRef={viewport}
      // Focusable so keyboard users can scroll the messages.
      tabIndex={0}
      aria-label={t('conversation.messages')}
      onScroll={handleScroll}
      className="h-full px-3 md:px-8"
    >
      <ol
        aria-label={chatName}
        className="relative mx-auto w-full max-w-3xl"
        style={{ height: total }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;
          return (
            <li
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              {row.date ? <DateSeparator date={row.date} /> : null}
              <MessageBubble
                message={row.message}
                firstInGroup={row.firstInGroup}
                lastInGroup={row.lastInGroup}
                isGroup={isGroup}
                chatId={chatId}
                onRetry={onRetry}
                onOpenMedia={onOpenMedia}
                album={row.album ?? undefined}
              />
            </li>
          );
        })}
      </ol>
    </ScrollArea>
  );
}
