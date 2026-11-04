import { useVirtualizer } from '@tanstack/react-virtual';
import { type Ref, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@/components/ui/scroll-area';
import { buildTimeline, dayKind } from '../chat-utils';
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

export interface MessageListHandle {
  scrollToBottom(): void;
}

interface MessageListProps {
  ref: Ref<MessageListHandle>;
  chatName: string;
  isGroup: boolean;
  messages: ChatMessage[];
  /** Undefined when there is nothing older to load. */
  onReachTop: (() => void) | undefined;
  onAtBottomChange: (atBottom: boolean) => void;
  onRetry: (clientMsgId: string) => void;
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
  messages,
  onReachTop,
  onAtBottomChange,
  onRetry,
}: MessageListProps) {
  const { t } = useTranslation();
  const viewport = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const timeline = useMemo(() => buildTimeline(messages), [messages]);

  const virtualizer = useVirtualizer({
    count: timeline.length,
    getScrollElement: () => viewport.current,
    estimateSize: (index) =>
      timeline[index]?.type === 'date' ? DATE_ESTIMATE_PX : ROW_ESTIMATE_PX,
    getItemKey: (index) => timeline[index]?.key ?? index,
    overscan: 10,
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

  // After every change in content, before the browser paints.
  const previous = useRef({ first: messages[0]?.id, last: messages.at(-1)?.id, total });
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const before = previous.current;
    const first = messages[0]?.id;
    const last = messages.at(-1)?.id;
    if (stick.current) {
      element.scrollTop = element.scrollHeight;
    } else if (first !== before.first && last === before.last) {
      // Older messages arrived above: keep what the reader is looking at in the same place.
      element.scrollTop += total - before.total;
    }
    previous.current = { first, last, total };
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
        {virtualizer.getVirtualItems().map((row) => {
          const item = timeline[row.index];
          if (!item) return null;
          return (
            <li
              key={row.key}
              data-index={row.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${row.start}px)` }}
            >
              {item.type === 'date' ? (
                <DateSeparator date={item.date} />
              ) : (
                <MessageBubble
                  message={item.message}
                  firstInGroup={item.firstInGroup}
                  lastInGroup={item.lastInGroup}
                  isGroup={isGroup}
                  onRetry={onRetry}
                />
              )}
            </li>
          );
        })}
      </ol>
    </ScrollArea>
  );
}
