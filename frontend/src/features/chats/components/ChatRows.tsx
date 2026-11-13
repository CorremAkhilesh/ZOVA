import { useVirtualizer } from '@tanstack/react-virtual';
import { type RefObject, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChatSummary } from '../types';
import { ChatListItem } from './ChatListItem';

/** A row: 48 px avatar + 20 px padding + 2 px gap. Rows are measured once shown. */
const ROW_ESTIMATE_PX = 70;
const OVERSCAN = 8;

interface ChatRowsProps {
  chats: ChatSummary[];
  /** The scrolling element the list sits in, below whatever comes before it. */
  scroller: RefObject<HTMLDivElement | null>;
}

/**
 * Only the rows near the viewport are in the page, so 500 chats open and scroll like 20. The
 * list shares its scroller with the entries above it (archived, locked chats): `scrollMargin` is
 * where the list starts inside it.
 */
export function ChatRows({ chats, scroller }: ChatRowsProps) {
  const list = useRef<HTMLUListElement>(null);
  const [margin, setMargin] = useState(0);
  // One clock for every row, so a row only re-renders when its chat changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new list is when the time may have moved on
  const now = useMemo(() => new Date(), [chats]);

  const virtualizer = useVirtualizer({
    count: chats.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    getItemKey: (index) => chats[index]?.id ?? index,
    overscan: OVERSCAN,
    scrollMargin: margin,
  });

  // The entries above the list come and go: keep the margin in step, before the browser paints.
  useLayoutEffect(() => {
    const element = list.current;
    const parent = scroller.current;
    if (!element || !parent) return;
    const top =
      element.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop;
    if (Math.abs(top - margin) >= 1) setMargin(top);
  });

  return (
    <ul
      ref={list}
      data-testid="chat-rows"
      className="relative"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((item) => {
        const chat = chats[item.index];
        if (!chat) return null;
        return (
          <li
            key={item.key}
            data-index={item.index}
            // Screen readers still hear "12 of 500" with only some rows in the page.
            aria-setsize={chats.length}
            aria-posinset={item.index + 1}
            ref={virtualizer.measureElement}
            className="chat-row absolute top-0 left-0 w-full pb-0.5"
            style={{ transform: `translateY(${item.start - margin}px)` }}
          >
            <ChatListItem chat={chat} now={now} />
          </li>
        );
      })}
    </ul>
  );
}
