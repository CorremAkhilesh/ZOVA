import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type StarredItem, starsResponseSchema } from '@zuvo/protocol';
import { ArrowLeft, Star } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/features/auth/session';
import { formatClock } from '@/features/chats/chat-utils';
import { useChats, useLocalDb } from '@/features/chats/queries';
import { toChatSummary } from '@/features/chats/view';
import { useKnownPeople } from '@/features/groups/queries';
import { useSyncStore } from '@/features/sync/store';
import { useLive } from '@/features/sync/use-live';
import { apiGet, withQuery } from '@/lib/api-client';
import { useMessageUi } from '../store';

const starsKey = (chatId: string | undefined) => ['stars', chatId ?? 'all'];

export const starsApi = {
  list: (chatId: string | undefined, cursor: string | undefined) =>
    apiGet(withQuery('/v1/stars', { chatId, cursor }), starsResponseSchema),
};

function Row({ item, chatName }: { item: StarredItem; chatName: string }) {
  const { t, i18n } = useTranslation();
  const me = useSession()?.user.id;
  const people = useKnownPeople();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = item;
  const sender =
    message.senderId === me
      ? t('chats.you')
      : (people?.get(message.senderId ?? '')?.displayName ?? chatName);
  const open = async () => {
    useMessageUi.getState().set({ jump: { chatId: message.chatId, seq: message.seq } });
    await navigate({ to: '/chats/$chatId', params: { chatId: message.chatId } });
  };
  const unstar = async () => {
    await useSyncStore.getState().client?.act({
      type: 'star',
      chatId: message.chatId,
      messageId: message.id,
      seq: message.seq,
      starred: false,
    });
    await queryClient.invalidateQueries({ queryKey: ['stars'] });
  };
  return (
    <li className="flex items-start gap-2 rounded-xl p-2 hover:bg-background">
      <button
        type="button"
        onClick={() => void open()}
        className="min-w-0 flex-1 text-left"
        aria-label={t('messages.openStarred', { name: chatName })}
      >
        <span className="flex items-baseline justify-between gap-2 text-xs text-text-muted">
          <span className="truncate font-semibold">
            {sender} · {chatName}
          </span>
          <time dateTime={message.createdAt}>
            {formatClock(new Date(message.createdAt), i18n.language)}
          </time>
        </span>
        <span className="mt-0.5 line-clamp-3 block whitespace-pre-wrap text-sm">
          {message.text || message.media?.name}
        </span>
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('messages.unstar')}
        onClick={() => void unstar()}
      >
        <Star className="size-4 fill-current" aria-hidden />
      </Button>
    </li>
  );
}

/** My starred messages, in every chat or in one. */
export function StarredScreen({ chatId }: { chatId?: string | undefined }) {
  const { t } = useTranslation();
  const me = useSession()?.user.id ?? '';
  const rows = useChats();
  const stars = useInfiniteQuery({
    queryKey: starsKey(chatId),
    queryFn: ({ pageParam }) => starsApi.list(chatId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const labels = { saved: t('chats.saved'), unknown: t('chats.unknownPerson') };
  const names = new Map(
    (rows ?? []).map((row) => [row.id, toChatSummary(row, me, labels).name] as const),
  );
  const items = stars.data?.pages.flatMap((page) => page.items) ?? [];
  // A star is told to the server a moment after it shows. When the queue moves, ask again.
  const db = useLocalDb();
  const waiting = useLive(() => db?.actions.count() ?? 0, [db]);
  const { refetch } = stars;
  useEffect(() => {
    if (waiting === 0) void refetch();
  }, [refetch, waiting]);

  return (
    <section aria-labelledby="starred-title" className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 px-4 pt-4 pb-2">
        <Button asChild variant="ghost" size="icon-sm">
          <Link to="/chats" aria-label={t('messages.backToChats')}>
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
        </Button>
        <h1 id="starred-title" className="text-xl font-bold tracking-tight">
          {chatId
            ? t('messages.starredIn', { name: names.get(chatId) ?? '' })
            : t('messages.starredTitle')}
        </h1>
      </header>
      <ScrollArea className="min-h-0 flex-1 px-2 pb-3">
        {stars.isPending ? (
          <div role="status" aria-label={t('common.loading')} className="space-y-2 p-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : null}
        {stars.isError ? (
          <div role="alert" className="space-y-3 p-8 text-center">
            <p className="text-sm text-text-muted">{t('messages.starredFailed')}</p>
            <Button variant="outline" size="sm" onClick={() => void stars.refetch()}>
              {t('errors.retry')}
            </Button>
          </div>
        ) : null}
        {stars.isSuccess && items.length === 0 ? (
          <p className="p-8 text-center text-sm text-text-muted">{t('messages.starredEmpty')}</p>
        ) : null}
        {items.length > 0 ? (
          <ul aria-label={t('messages.starredTitle')} className="mx-auto max-w-3xl space-y-0.5">
            {items.map((item) => (
              <Row
                key={item.message.id}
                item={item}
                chatName={names.get(item.message.chatId) ?? t('chats.unknownPerson')}
              />
            ))}
          </ul>
        ) : null}
        {stars.hasNextPage ? (
          <div className="p-2 text-center">
            <Button variant="outline" size="sm" onClick={() => void stars.fetchNextPage()}>
              {t('common.loadMore')}
            </Button>
          </div>
        ) : null}
      </ScrollArea>
    </section>
  );
}
