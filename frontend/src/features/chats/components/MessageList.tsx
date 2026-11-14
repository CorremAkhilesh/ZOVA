import { useVirtualizer } from '@tanstack/react-virtual';
import {
  type Ref,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useMessageUi } from '@/features/messages/store';
import { buildTimeline, dayKind, type TimelineItem } from '../chat-utils';
import { estimateRowPx } from '../row-estimate';
import type { ChatMessage } from '../types';
import { useBottomPin } from '../use-bottom-pin';
import { MessageBubble } from './MessageBubble';

/** Within this distance from the end still counts as "at the bottom". */
const BOTTOM_SLOP_PX = 64;
/** Starts fetching older messages this far before the top, so scrolling rarely stops. */
const TOP_SLOP_PX = 600;
const HIGHLIGHT_MS = 2000;

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

const rowHasSeq = (row: Row, seq: number) =>
  row.message.seq === seq || row.album?.some((item) => item.seq === seq) === true;

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
  const content = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  const bottom = useBottomPin(viewport, content, stick);
  const rows = useMemo(() => toRows(buildTimeline(messages)), [messages]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewport.current,
    estimateSize: (index) => {
      const row = rows[index];
      return row ? estimateRowPx(row) : 0;
    },
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
      bottom.pin();
    },
  }));

  // Asked to show a message: read further back until it is there, then bring it into view.
  const jump = useMessageUi((state) => (state.jump?.chatId === chatId ? state.jump : null));
  const [highlight, setHighlight] = useState<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the virtualizer is a new object each render
  useEffect(() => {
    if (!jump) return;
    const index = rows.findIndex((row) => rowHasSeq(row, jump.seq));
    const oldest = rows[0]?.message.seq ?? 0;
    if (index >= 0) {
      stick.current = false;
      onAtBottomChange(false);
      virtualizer.scrollToIndex(index, { align: 'center' });
      setHighlight(jump.seq);
      useMessageUi.getState().set({ jump: null });
    } else if (onReachTop && oldest > jump.seq) {
      onReachTop();
    } else {
      useMessageUi.getState().set({ jump: null });
      toast.error(t('messages.notAvailable'));
    }
  }, [jump, rows, onReachTop]);
  useEffect(() => {
    if (highlight === null) return;
    const timer = setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlight]);

  // After every change in content, before the browser paints. Older messages arriving above need
  // nothing here: `anchorTo` keeps the row the reader is looking at in place. Sizes that change
  // later (rows measured, the viewport resized) are followed by useBottomPin.
  // biome-ignore lint/correctness/useExhaustiveDependencies: both change what the bottom is
  useLayoutEffect(() => {
    if (stick.current) bottom.pin();
  }, [messages, total]);

  function handleScroll() {
    const element = viewport.current;
    if (!element) return;
    const reader = bottom.byReader(element);
    const atBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_SLOP_PX;
    // Only the reader leaves the bottom: a scroll that layout caused is followed instead.
    if (atBottom || reader) setStick(atBottom);
    else if (stick.current) bottom.pin();
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
        ref={content}
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
                highlighted={highlight !== null && rowHasSeq(row, highlight)}
              />
            </li>
          );
        })}
      </ol>
    </ScrollArea>
  );
}
