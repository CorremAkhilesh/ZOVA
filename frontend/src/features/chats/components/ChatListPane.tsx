import { MessageSquarePlus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatListSkeleton } from '@/components/common/ChatListSkeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSession } from '@/features/auth/session';
import { ConnectionStatus } from '@/features/connection/ConnectionStatus';
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
  const key = searching
    ? 'chats.noResults'
    : folder === 'groups'
      ? 'chats.groupsEmpty'
      : folder === 'unread'
        ? 'chats.unreadEmpty'
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
  const saved = t('chats.saved');
  const unknown = t('chats.unknownPerson');
  const all = useMemo(
    () => rows?.map((row) => toChatSummary(row, me, { saved, unknown }, unsent?.get(row.id))),
    [me, rows, saved, unknown, unsent],
  );
  const chats = useMemo(() => filterChats(all ?? [], folder, query), [all, folder, query]);

  return (
    <section aria-labelledby="chat-list-title" className="flex h-full min-h-0 flex-col">
      <header className="space-y-3 px-4 pt-4 pb-2">
        <div className="flex items-center justify-between gap-2">
          <h1 id="chat-list-title" className="text-2xl font-bold tracking-tight">
            {t('nav.chats')}
          </h1>
          <div className="flex items-center gap-1">
            <ConnectionStatus />
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
        <div
          role="tablist"
          aria-label={t('chats.foldersLabel')}
          className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
        >
          {FOLDERS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={folder === name}
              onClick={() => setFolder(name)}
              className={cn(
                'shrink-0 rounded-full border px-3.5 py-1 text-sm font-medium transition-colors',
                folder === name
                  ? 'border-transparent bg-brand text-brand-foreground'
                  : 'bg-surface text-text-muted hover:text-text',
              )}
            >
              {t(`chats.folders.${name}`)}
            </button>
          ))}
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1 px-2 pb-3">
        <ListBody
          chats={chats}
          folder={folder}
          searching={Boolean(query.trim())}
          nothingStored={all === undefined || all.length === 0}
          onlySaved={all?.every((chat) => chat.kind === 'saved') ?? false}
          onStart={openPicker}
        />
      </ScrollArea>
    </section>
  );
}
