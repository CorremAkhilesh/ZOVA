import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type CallLogEntry, formatCallDuration } from '@zuvo/protocol';
import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { ChatAvatar } from '@/features/chats/components/ChatAvatar';
import type { ChatSummary } from '@/features/chats/types';
import { formatRelativeTime } from '@/lib/relative-time';
import { cn } from '@/lib/utils';
import { callsApi } from '../api';
import { useCallAccess, useCallState, useChatSummaries } from '../hooks';
import { inCall } from '../machine';
import { useCallStore } from '../store';

export const callHistoryKey = ['calls', 'history'] as const;

/** Missed in my eyes: a call for me that nobody picked up. */
const isMissed = (entry: CallLogEntry) =>
  entry.direction === 'incoming' && ['missed', 'cancelled', 'busy'].includes(entry.outcome);

function outcomeKey(entry: CallLogEntry): string {
  if (entry.outcome === 'answered') return entry.direction;
  if (isMissed(entry)) return 'missed';
  if (entry.outcome === 'declined') return 'declined';
  if (entry.outcome === 'busy') return 'busy';
  return 'noAnswer';
}

function CallRow({ entry, chat }: { entry: CallLogEntry; chat: ChatSummary | undefined }) {
  const { t, i18n } = useTranslation();
  const allowed = useCallAccess();
  const busy = inCall(useCallState());
  const actions = useCallStore((store) => store.actions);
  const name = chat?.name || t('calls.unknownPerson');
  const missed = isMissed(entry);
  const Icon = missed
    ? PhoneMissed
    : entry.direction === 'incoming'
      ? PhoneIncoming
      : PhoneOutgoing;
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <Link
        to="/chats/$chatId"
        params={{ chatId: entry.chatId }}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
      >
        {chat ? (
          <ChatAvatar chat={chat} className="size-12" />
        ) : (
          <span
            className="grid size-12 place-items-center rounded-full bg-surface-muted"
            aria-hidden
          >
            <Phone className="size-5" />
          </span>
        )}
        <span className="min-w-0">
          <span className={cn('block truncate font-medium', missed && 'text-danger-text')}>
            {name}
          </span>
          <span className="flex items-center gap-1.5 text-sm text-text-muted">
            <Icon className={cn('size-4', missed && 'text-danger-text')} aria-hidden />
            <span>{t(`calls.history.${outcomeKey(entry)}`)}</span>
            <span aria-hidden>·</span>
            <time dateTime={entry.startedAt}>
              {formatRelativeTime(entry.startedAt, i18n.language)}
            </time>
            {entry.durationSeconds > 0 ? (
              <span className="tabular-nums">· {formatCallDuration(entry.durationSeconds)}</span>
            ) : null}
          </span>
        </span>
      </Link>
      {allowed ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('calls.history.callBack', { name })}
          disabled={busy || !actions}
          onClick={() => void actions?.dial(entry.chatId)}
        >
          <Phone className="size-5" aria-hidden />
        </Button>
      ) : null}
    </li>
  );
}

/** The Calls tab: my call history, newest first, with a button to call back. */
export function CallsScreen() {
  const { t } = useTranslation();
  const byId = useChatSummaries();
  const history = useInfiniteQuery({
    queryKey: callHistoryKey,
    queryFn: ({ pageParam }) => callsApi.history(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const entries = history.data?.pages.flatMap((page) => page.items) ?? [];
  // A call just ended (on this device): it belongs at the top.
  const phase = useCallState().phase;
  const { refetch } = history;
  useEffect(() => {
    if (phase === 'ended') void refetch();
  }, [phase, refetch]);

  return (
    <section
      aria-labelledby="calls-title"
      className="flex h-full min-h-0 flex-col md:mx-auto md:w-full md:max-w-2xl"
    >
      <header className="flex items-center gap-2 px-4 pt-4 pb-2">
        <h1 id="calls-title" className="flex-1 text-xl font-bold tracking-tight">
          {t('calls.history.title')}
        </h1>
      </header>
      <ScrollArea className="min-h-0 flex-1 pb-4">
        {history.isPending ? (
          <div role="status" aria-label={t('common.loading')} className="space-y-2 p-4">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : null}
        {history.isError ? (
          <div className="mx-auto mt-10 max-w-xs space-y-3 px-6 text-center text-sm">
            <p role="alert">{t('calls.history.error')}</p>
            <Button variant="outline" onClick={() => void history.refetch()}>
              {t('errors.retry')}
            </Button>
          </div>
        ) : null}
        {history.isSuccess && entries.length === 0 ? (
          <div className="mx-auto mt-10 max-w-xs space-y-2 px-6 text-center text-sm text-text-muted">
            <Phone className="mx-auto size-9" aria-hidden />
            <p className="font-medium text-text">{t('calls.history.empty')}</p>
            <p>{t('calls.history.emptyBody')}</p>
          </div>
        ) : null}
        {entries.length > 0 ? (
          <ul aria-labelledby="calls-title">
            {entries.map((entry) => (
              <CallRow key={entry.id} entry={entry} chat={byId.get(entry.chatId)} />
            ))}
          </ul>
        ) : null}
        {history.hasNextPage ? (
          <div className="flex justify-center p-4">
            <Button
              variant="outline"
              disabled={history.isFetchingNextPage}
              onClick={() => void history.fetchNextPage()}
            >
              {t('calls.history.more')}
            </Button>
          </div>
        ) : null}
      </ScrollArea>
    </section>
  );
}
