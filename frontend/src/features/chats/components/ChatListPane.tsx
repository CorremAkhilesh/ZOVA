import { Link } from '@tanstack/react-router';
import type { LastReaction, SystemEvent } from '@zuvo/protocol';
import { Archive, ArrowLeft, MessageSquarePlus, Search, Star } from 'lucide-react';
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatListSkeleton } from '@/components/common/ChatListSkeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSession } from '@/features/auth/session';
import { useChatListView } from '@/features/commands/chat-list-view';
import { ListStatus } from '@/features/connection/ListStatus';
import { useFolders } from '@/features/folders/api';
import { FolderChips } from '@/features/folders/components/FolderChips';
import { FolderEditorHost } from '@/features/folders/components/FolderEditorHost';
import { resolveFolder } from '@/features/folders/rules';
import { readSelectedFolder, saveSelectedFolder } from '@/features/folders/store';
import { useKnownPeople } from '@/features/groups/queries';
import { useNewGroup } from '@/features/groups/rules';
import { systemText } from '@/features/groups/wording';
import { useWithoutLocked } from '@/features/lock/chat-lock';
import { LockedChatsEntry } from '@/features/lock/components/LockedChatsEntry';
import { ChatMenu } from '@/features/messages/components/ChatMenu';
import { useChatListPromo } from '@/features/promo/use-chat-list-promo';
import { QuietIndicator } from '@/features/quiet-hours/components/QuietIndicator';
import { useGlobalSearch } from '@/features/search/store';
import { useSyncStore } from '@/features/sync/store';
import { filterChats } from '../chat-utils';
import { useNewChat } from '../new-chat-store';
import { useChats, useUnsentByChat } from '../queries';
import type { ChatFolder, ChatSummary } from '../types';
import { toChatSummary } from '../view';
import { ChatRows } from './ChatRows';
import { NoChatsYet } from './NoChatsYet';

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
      : folder.startsWith('folder:')
        ? 'folders.folderEmpty'
        : 'chats.noResults';
  return <p className="px-4 py-10 text-center text-sm text-text-muted">{t(key)}</p>;
}

interface ListBodyProps {
  chats: ChatSummary[];
  folder: ChatFolder;
  searching: boolean;
  nothingStored: boolean;
  onlySaved: boolean;
  onStart: () => void;
  scroller: RefObject<HTMLDivElement | null>;
}

/** Stored chats always show. Loading and failure only matter while there is nothing to show. */
function ListBody(props: ListBodyProps) {
  const { t } = useTranslation();
  const { chats, folder, searching, nothingStored, onlySaved, onStart, scroller } = props;
  const syncStatus = useSyncStore((state) => state.sync);
  const client = useSyncStore((state) => state.client);

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
        <ChatRows chats={chats} scroller={scroller} />
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
  const [chosen, setChosen] = useState<ChatFolder>(readSelectedFolder);
  const folders = useFolders().data;
  const archivedList = useChatListView((state) => state.archived);
  const { showArchived, showAll } = useChatListView.getState();
  // Leaving the list ends the archived view, as before; "Go to Archived" sets it before it mounts.
  const openedArchived = useRef(archivedList);
  useEffect(() => {
    if (openedArchived.current) useChatListView.getState().showArchived();
    return () => useChatListView.getState().showAll();
  }, []);
  // A deleted folder falls back to All. The archived list is All's.
  const remembered = resolveFolder(chosen, folders);
  const folder = archivedList ? 'all' : remembered;
  useEffect(() => {
    if (remembered === chosen) return;
    setChosen(remembered);
    saveSelectedFolder(remembered);
  }, [chosen, remembered]);
  const setFolder = (next: ChatFolder) => {
    setChosen(next);
    saveSelectedFolder(next);
    showAll();
  };
  const [query, setQuery] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const openPicker = useNewChat((state) => state.open);
  // Locked chats leave the list and folders: they show behind the "Locked chats" entry.
  const allRows = useChats();
  const rows = useWithoutLocked(allRows);
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
  const chats = useMemo(
    () => filterChats(all ?? [], folder, query, archivedList, folders),
    [all, archivedList, folder, folders, query],
  );
  const archivedCount = all?.filter((chat) => chat.archived).length ?? 0;
  const showArchivedRow = !archivedList && !query.trim() && folder === 'all' && archivedCount > 0;
  // "Get notified" / "Install the app": a bar over the list's bottom, once the rows have painted.
  const promo = useChatListPromo({
    rowsShown: chats.length > 0,
    pushAllowed: Boolean(rows?.some((r) => r.type !== 'self')),
    hidden: archivedList || Boolean(query.trim()),
  });

  return (
    <section aria-labelledby="chat-list-title" className="relative flex h-full min-h-0 flex-col">
      <header className="space-y-3 px-4 pt-4 pb-2">
        <div className="flex items-center justify-between gap-2">
          <h1 id="chat-list-title" className="text-2xl font-bold tracking-tight">
            {t('nav.chats')}
          </h1>
          <div className="flex items-center gap-1">
            <ListStatus />
            <QuietIndicator />
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
        <FolderChips
          folder={folder}
          onChange={setFolder}
          chats={all ?? []}
          folders={folders ?? []}
        />
      </header>

      <ChatMenu />
      <FolderEditorHost />
      <ScrollArea viewportRef={scroller} className="min-h-0 flex-1 px-2 pb-3">
        {archivedList ? (
          <button
            type="button"
            onClick={showAll}
            className="mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold hover:bg-background"
          >
            <ArrowLeft className="size-4" aria-hidden />
            {t('messages.archivedBack')}
          </button>
        ) : null}
        <LockedChatsEntry rows={allRows} hidden={archivedList || Boolean(query.trim())} />
        {showArchivedRow ? (
          <button
            type="button"
            onClick={showArchived}
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
          scroller={scroller}
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
        {promo.spacer}
      </ScrollArea>
      {promo.bar}
    </section>
  );
}
