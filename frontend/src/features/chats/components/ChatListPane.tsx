import { Link } from '@tanstack/react-router';
import type { LastReaction, SystemEvent } from '@zuvo/protocol';
import { Archive, ArrowLeft, MessageSquarePlus, Search, Star } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatListSkeleton } from '@/components/common/ChatListSkeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSession } from '@/features/auth/session';
import { ConnectionStatus } from '@/features/connection/ConnectionStatus';
import { useKnownPeople } from '@/features/groups/queries';
import { useNewGroup } from '@/features/groups/rules';
import { systemText } from '@/features/groups/wording';
import { ChatMenu } from '@/features/messages/components/ChatMenu';
import { useGlobalSearch } from '@/features/search/store';
import { useSyncStore } from '@/features/sync/store';
import { cn } from '@/lib/utils';
import { filterChats } from '../chat-utils';
import { useNewChat } from '../new-chat-store';
import { useChats, useUnsentByChat } from '../queries';
import type { ChatFolder, ChatSummary } from '../types';
import { toChatSummary } from '../view';
import { ChatListItem } from './ChatListItem';
import { NoChatsYet } from './NoChatsYet';

const FOLDERS: ChatFolder[] = ['all', 'unread', 'personal', 'groups'];

function EmptyFolder({ folder, searching }: { folder: ChatFolder; searching: boolean }) {
  const { t } = useTranslation();
  const openNewGroup = useNewGroup((state) => state.setOpen);
  if (folder === 'groups' && !searching) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <p className="text-sm text-text-muted">{t('chats.groupsEmpty')}</p>
        <Button onClick={() => openNewGroup(true)}>{t('groups.newTitle')}</Button>
      </div>
    );
  }
  const key = searching
    ? 'chats.noResults'
    : folder === 'unread'
      ? 'chats.unreadEmpty'
      : 'chats.noResults';
  return <p className="px-4 py-10 text-center text-sm text-text-muted">{t(key)}</p>;
}

/**
 * Scrolls sideways by touch, trackpad and Shift+wheel, with no scrollbar: the edges fade where there
 * is more to see. Keyboard focus brings a chip into view.
 */
function FolderChips(props: { folder: ChatFolder; onChange: (folder: ChatFolder) => void }) {
  const { t } = useTranslation();
  const row = useRef<HTMLDivElement>(null);
  const updateEdges = useCallback(() => {
    const element = row.current;
    if (!element) return;
    element.dataset.atStart = String(element.scrollLeft <= 1);
    element.dataset.atEnd = String(
      element.scrollLeft + element.clientWidth >= element.scrollWidth - 1,
    );
  }, []);
  useEffect(() => {
    updateEdges();
    const element = row.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateEdges);
    observer.observe(element);
    return () => observer.disconnect();
  }, [updateEdges]);

  return (
    <div
      ref={row}
      role="tablist"
      aria-label={t('chats.foldersLabel')}
      onScroll={updateEdges}
      className="chip-row -mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
    >
      {FOLDERS.map((name) => (
        <button
          key={name}
          type="button"
          role="tab"
          aria-selected={props.folder === name}
          onClick={() => props.onChange(name)}
          onFocus={(event) =>
            event.currentTarget.scrollIntoView({ inline: 'nearest', block: 'nearest' })
          }
          className={cn(
            'shrink-0 rounded-full border px-3.5 py-1 text-sm font-medium transition-colors',
            props.folder === name
              ? 'border-transparent bg-brand text-brand-foreground'
              : 'bg-surface text-text-muted hover:text-text',
          )}
        >
          {t(`chats.folders.${name}`)}
        </button>
      ))}
    </div>
  );
}

interface ListBodyProps {
  chats: ChatSummary[];
  folder: ChatFolder;
  searching: boolean;
  nothingStored: boolean;
  onlySaved: boolean;
  onStart: () => void;
}

/** Stored chats always show. Loading and failure only matter while there is nothing to show. */
function ListBody(props: ListBodyProps) {
  const { t } = useTranslation();
  const { chats, folder, searching, nothingStored, onlySaved, onStart } = props;
  const syncStatus = useSyncStore((state) => state.sync);
  const client = useSyncStore((state) => state.client);
  const now = new Date();

  if (nothingStored && syncStatus === 'syncing') return <ChatListSkeleton />;
  if (nothingStored && syncStatus === 'error') {
    return (
      <div role="alert" className="space-y-3 px-4 py-10 text-center">
        <p className="text-sm text-text-muted">{t('chats.loadFailed')}</p>
        <Button variant="outline" size="sm" onClick={() => void client?.syncNow()}>
          {t('errors.retry')}
        </Button>
      </div>
    );
  }
  const welcome = onlySaved && folder === 'all' && !searching;
  return (
    <>
      {chats.length > 0 ? (
        <ul className="space-y-0.5" data-testid="chat-rows">
          {chats.map((chat) => (
            <li key={chat.id} className="chat-row">
              <ChatListItem chat={chat} now={now} />
            </li>
          ))}
        </ul>
      ) : welcome ? null : (
        <EmptyFolder folder={folder} searching={searching} />
      )}
      {welcome ? <NoChatsYet onStart={onStart} /> : null}
    </>
  );
}

export function ChatListPane() {
  const { t } = useTranslation();
  const me = useSession()?.user.id ?? '';
  const [folder, setFolder] = useState<ChatFolder>('all');
  const [query, setQuery] = useState('');
  const openPicker = useNewChat((state) => state.open);
  const rows = useChats();
  const unsent = useUnsentByChat();
  const people = useKnownPeople();
  const labels = useMemo(
    () => ({
      saved: t('chats.saved'),
      unknown: t('chats.unknownPerson'),
      photo: t('media.photo'),
      voice: t('voice.preview'),
      system: (event: SystemEvent) => systemText(event, me, t),
      deleted: t('messages.deleted'),
      reacted: (reaction: LastReaction) =>
        t('messages.reactedLine', {
          name: reaction.byName.split(' ')[0],
          emoji: reaction.emoji,
          text: reaction.text,
        }),
      video: t('media.video'),
    }),
    [me, t],
  );
  const all = useMemo(
    () => rows?.map((row) => toChatSummary(row, me, labels, unsent?.get(row.id), people)),
    [labels, me, people, rows, unsent],
  );
  const [archivedList, setArchivedList] = useState(false);
  const chats = useMemo(
    () => filterChats(all ?? [], folder, query, archivedList),
    [all, archivedList, folder, query],
  );
  const archivedCount = all?.filter((chat) => chat.archived).length ?? 0;
  const showArchivedRow = !archivedList && !query.trim() && folder === 'all' && archivedCount > 0;

  return (
    <section aria-labelledby="chat-list-title" className="flex h-full min-h-0 flex-col">
      <header className="space-y-3 px-4 pt-4 pb-2">
        <div className="flex items-center justify-between gap-2">
          <h1 id="chat-list-title" className="text-2xl font-bold tracking-tight">
            {t('nav.chats')}
          </h1>
          <div className="flex items-center gap-1">
            <ConnectionStatus />
            <Button asChild variant="ghost" size="icon-sm">
              <Link to="/starred" aria-label={t('messages.starredTitle')}>
                <Star className="size-5" aria-hidden />
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('chats.newChat')}
              onClick={openPicker}
            >
              <MessageSquarePlus className="size-5" />
            </Button>
          </div>
        </div>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('chats.searchPlaceholder')}
            aria-label={t('chats.searchPlaceholder')}
            className="rounded-full border-transparent bg-background pl-9 shadow-none"
          />
        </div>
        <FolderChips folder={folder} onChange={setFolder} />
      </header>

      <ChatMenu />
      <ScrollArea className="min-h-0 flex-1 px-2 pb-3">
        {archivedList ? (
          <button
            type="button"
            onClick={() => setArchivedList(false)}
            className="mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold hover:bg-background"
          >
            <ArrowLeft className="size-4" aria-hidden />
            {t('messages.archivedBack')}
          </button>
        ) : null}
        {showArchivedRow ? (
          <button
            type="button"
            onClick={() => setArchivedList(true)}
            className="mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold hover:bg-background"
          >
            <Archive className="size-4 text-text-muted" aria-hidden />
            <span className="flex-1 text-left">{t('messages.archived')}</span>
            <span className="text-xs font-normal text-text-muted">{archivedCount}</span>
          </button>
        ) : null}
        <ListBody
          chats={chats}
          folder={folder}
          searching={Boolean(query.trim())}
          nothingStored={all === undefined || all.length === 0}
          onlySaved={all?.every((chat) => chat.kind === 'saved') ?? false}
          onStart={openPicker}
        />
        {query.trim() ? (
          <button
            type="button"
            onClick={() => useGlobalSearch.getState().show(query.trim())}
            className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-brand-text hover:bg-background"
          >
            <Search className="size-4" aria-hidden />
            {t('search.inMessages', { q: query.trim() })}
          </button>
        ) : null}
      </ScrollArea>
    </section>
  );
}
