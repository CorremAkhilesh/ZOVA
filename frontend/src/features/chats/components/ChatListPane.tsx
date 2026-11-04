import { MessageSquarePlus, Search } from 'lucide-react';
import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MockBadge } from '@/components/common/MockBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ConnectionStatus } from '@/features/connection/ConnectionStatus';
import { PeoplePicker } from '@/features/people/components/PeoplePicker';
import { cn } from '@/lib/utils';
import { filterChats } from '../chat-utils';
import { MOCK_CHATS } from '../mock-data';
import type { ChatFolder } from '../types';
import { ChatListItem } from './ChatListItem';

const FOLDERS: ChatFolder[] = ['all', 'unread', 'groups', 'personal'];

export function ChatListPane() {
  const { t } = useTranslation();
  const [folder, setFolder] = useState<ChatFolder>('all');
  const [query, setQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const chats = useMemo(() => filterChats(MOCK_CHATS, folder, query), [folder, query]);
  const now = new Date();

  return (
    <section aria-labelledby="chat-list-title" className="flex h-full min-h-0 flex-col">
      <header className="space-y-3 px-4 pt-4 pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 id="chat-list-title" className="text-2xl font-bold tracking-tight">
              {t('nav.chats')}
            </h1>
            <MockBadge />
          </div>
          <div className="flex items-center gap-1">
            <ConnectionStatus />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('chats.newChat')}
              onClick={() => setPickerOpen(true)}
            >
              <MessageSquarePlus className="size-5" />
            </Button>
            <PeoplePicker open={pickerOpen} onOpenChange={setPickerOpen} />
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
        {chats.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-text-muted">{t('chats.noResults')}</p>
        ) : (
          <ul className="space-y-0.5">
            {chats.map((chat, index) => (
              <motion.li
                key={chat.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, delay: Math.min(index, 8) * 0.02 }}
              >
                <ChatListItem chat={chat} now={now} />
              </motion.li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </section>
  );
}
