import { useInfiniteQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Message } from '@zuvo/protocol';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type ChatMessage, ME } from '@/features/chats/types';
import { cn } from '@/lib/utils';
import { mediaApi } from '../api';
import { DocumentCard } from './DocumentCard';
import { MediaVisual } from './MessageMedia';

const COLUMNS = 3;
const ROW_PX = 96;
const DOC_ROW_PX = 80;

type Tab = 'media' | 'docs';

/** A gallery item in the form the bubbles' media components take. */
function toItem(message: Message): ChatMessage {
  return {
    id: message.id,
    chatId: message.chatId,
    clientMsgId: message.clientMsgId,
    authorId: ME,
    authorName: '',
    text: message.text ?? '',
    at: new Date(message.createdAt),
    media: message.media,
    albumId: message.albumId,
  };
}

function GalleryList({
  chatId,
  tab,
  onOpen,
}: {
  chatId: string;
  tab: Tab;
  onOpen: (mediaId: string) => void;
}) {
  const { t } = useTranslation();
  const viewport = useRef<HTMLDivElement>(null);
  const query = useInfiniteQuery({
    queryKey: ['chat-gallery', chatId, tab],
    queryFn: ({ pageParam }) => mediaApi.gallery(chatId, tab, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (page) => (page.hasMore ? page.items.at(-1)?.seq : undefined),
  });
  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.items.map(toItem)) ?? [],
    [query.data],
  );
  const perRow = tab === 'media' ? COLUMNS : 1;
  const rowCount = Math.ceil(items.length / perRow);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => viewport.current,
    estimateSize: () => (tab === 'media' ? ROW_PX : DOC_ROW_PX),
    overscan: 4,
  });

  const lastRow = virtualizer.getVirtualItems().at(-1)?.index ?? 0;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    if (lastRow >= rowCount - 2 && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, lastRow, rowCount]);

  if (query.isError) {
    return (
      <p role="alert" className="p-4 text-center text-sm text-text-muted">
        {t('media.galleryFailed')}
      </p>
    );
  }
  if (query.isPending) return <p className="p-4 text-center text-sm text-text-muted">…</p>;
  if (items.length === 0) {
    return (
      <p className="p-4 text-center text-sm text-text-muted">
        {t(tab === 'media' ? 'media.noMedia' : 'media.noDocs')}
      </p>
    );
  }
  return (
    <ScrollArea viewportRef={viewport} tabIndex={0} className="min-h-0 flex-1 px-3">
      <ul className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => {
          const cells = items.slice(row.index * perRow, (row.index + 1) * perRow);
          return (
            <li
              key={row.key}
              className={cn(
                'absolute top-0 left-0 grid w-full gap-1',
                tab === 'media' && 'grid-cols-3',
              )}
              style={{ height: row.size, transform: `translateY(${row.start}px)` }}
            >
              {cells.map((item) =>
                tab === 'media' ? (
                  <div key={item.id} className="h-full">
                    <MediaVisual message={item} onOpen={onOpen} fill />
                  </div>
                ) : (
                  <DocumentCard key={item.id} message={item} />
                ),
              )}
            </li>
          );
        })}
      </ul>
    </ScrollArea>
  );
}

/** "Media" and "Docs" in chat info. Newest first. */
export function ChatGallery(props: { chatId: string; onOpen: (mediaId: string) => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('media');
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" aria-label={t('info.media')} className="flex gap-1 px-3 pb-2">
        {(['media', 'docs'] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={cn(
              'flex-1 rounded-lg py-1.5 text-sm font-medium',
              tab === name
                ? 'bg-brand-subtle text-brand-text'
                : 'text-text-muted hover:bg-background',
            )}
          >
            {t(name === 'media' ? 'media.tabMedia' : 'media.tabDocs')}
          </button>
        ))}
      </div>
      <GalleryList key={tab} chatId={props.chatId} tab={tab} onOpen={props.onOpen} />
    </div>
  );
}
