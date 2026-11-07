import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type SearchFilter, searchFilterSchema } from '@zuvo/protocol';
import { Search } from 'lucide-react';
import { type KeyboardEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { chatsApi } from '@/features/chats/api';
import { useChats, useLocalDb } from '@/features/chats/queries';
import { useMessageUi } from '@/features/messages/store';
import { usersApi } from '@/features/profile/api';
import { applyChats } from '@/features/sync/apply';
import { useDebouncedValue } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { searchLocalChats } from '../local-search';
import { useGlobalSearch } from '../store';
import { useMessageSearch } from '../use-message-search';
import { optionId, ResultSection, type SearchOption } from './SearchResults';

const FILTERS = searchFilterSchema.options;
const LISTBOX_ID = 'global-search-results';

/** Everything that opens a result: a chat, a person (their chat), or a message in its chat. */
function useOpenResult(onDone: () => void) {
  const navigate = useNavigate();
  const db = useLocalDb();
  const person = useMutation({
    mutationFn: async (userId: string) => {
      const known = await db?.chats.filter((chat) => chat.otherUser?.id === userId).first();
      if (known) return known.id;
      const chat = await chatsApi.createDirect(userId);
      if (db) await applyChats(db, [chat]);
      return chat.id;
    },
    onSuccess: (chatId) => void navigate({ to: '/chats/$chatId', params: { chatId } }),
  });
  return (option: SearchOption) => {
    onDone();
    if (option.kind === 'chat') {
      void navigate({ to: '/chats/$chatId', params: { chatId: option.chat.id } });
    } else if (option.kind === 'person') {
      person.mutate(option.person.id);
    } else {
      const { chatId, seq } = option.hit;
      // The list scrolls there, loading older messages first if it has to.
      useMessageUi.getState().set({ jump: { chatId, seq } });
      void navigate({ to: '/chats/$chatId', params: { chatId } });
    }
  };
}

/** Ctrl/Cmd+K: chats, people and messages, with filters. This device first, then the server. */
export default function GlobalSearch() {
  const { t } = useTranslation();
  const { initial, hide } = useGlobalSearch();
  const [q, setQ] = useState(initial);
  const [filter, setFilter] = useState<SearchFilter | undefined>(undefined);
  const [activeId, setActiveId] = useState<string | null>(null);
  const chats = useChats();
  const typed = useDebouncedValue(q.trim(), 250);
  const people = useQuery({
    queryKey: ['users', 'search', typed],
    queryFn: async () => (await usersApi.search(typed)).items,
    enabled: typed.length > 0 && !filter,
    placeholderData: keepPreviousData,
  });
  const messages = useMessageSearch({ q, filter }, chats);
  const open = useOpenResult(hide);

  const sections = useMemo(() => {
    const chatOptions: SearchOption[] = filter
      ? []
      : searchLocalChats(chats ?? [], q, t('chats.saved'))
          .slice(0, 5)
          .map((chat) => ({ kind: 'chat', id: chat.id, chat }));
    const personOptions: SearchOption[] =
      filter || !typed
        ? []
        : (people.data ?? [])
            .slice(0, 5)
            .map((person) => ({ kind: 'person', id: person.id, person }));
    const messageOptions: SearchOption[] = messages.hits.map((hit) => ({
      kind: 'message',
      id: hit.key,
      hit,
    }));
    return { chatOptions, personOptions, messageOptions };
  }, [chats, filter, messages.hits, people.data, q, t, typed]);
  const all = [...sections.chatOptions, ...sections.personOptions, ...sections.messageOptions];
  const active = all.find((option) => optionId(option) === activeId) ?? all[0] ?? null;

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && active) {
      event.preventDefault();
      open(active);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const index = active ? all.indexOf(active) : -1;
    const next = all[(index + (event.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length];
    if (next) {
      setActiveId(optionId(next));
      document.getElementById(optionId(next))?.scrollIntoView({ block: 'nearest' });
    }
  }

  const searching = q.trim().length > 0 || filter !== undefined;
  const messageStatus = !searching ? null : messages.loading ? (
    <p role="status" className="px-2.5 py-2 text-sm text-text-muted">
      {t('search.searching')}
    </p>
  ) : messages.failed ? (
    <p role="alert" className="px-2.5 py-2 text-sm text-text-muted">
      {t('search.serverFailed')}
    </p>
  ) : messages.hits.length === 0 ? (
    <p className="px-2.5 py-2 text-sm text-text-muted">{t('search.noMessages')}</p>
  ) : messages.hasMore ? (
    <Button variant="ghost" size="sm" onClick={messages.loadMore} disabled={messages.loadingMore}>
      {t('search.more')}
    </Button>
  ) : null;

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : hide())}>
      <DialogContent title={t('search.title')} hideTitle className="max-w-xl gap-2 p-3">
        <div className="flex items-center gap-2 rounded-xl border bg-background px-3">
          <Search className="size-4 text-text-muted" aria-hidden />
          <input
            autoFocus
            type="search"
            role="combobox"
            aria-expanded={all.length > 0}
            aria-controls={LISTBOX_ID}
            aria-activedescendant={active ? optionId(active) : undefined}
            aria-label={t('search.placeholder')}
            placeholder={t('search.placeholder')}
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setActiveId(null);
            }}
            onKeyDown={onKeyDown}
            className="h-11 flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        <fieldset className="flex flex-wrap gap-1.5">
          <legend className="sr-only">{t('search.filters')}</legend>
          {FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(filter === value ? undefined : value)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium',
                filter === value
                  ? 'border-brand bg-brand-subtle text-brand-text'
                  : 'text-text-muted',
              )}
            >
              {t(`search.filter.${value}`)}
            </button>
          ))}
        </fieldset>
        <div className="max-h-[60vh] overflow-y-auto">
          <div id={LISTBOX_ID} role="listbox" aria-label={t('search.results')}>
            {(
              [
                ['chats', sections.chatOptions],
                ['people', sections.personOptions],
                ['messages', sections.messageOptions],
              ] as const
            ).map(([name, options]) => (
              <ResultSection
                key={name}
                title={t(`search.${name}`)}
                options={options}
                activeId={active ? optionId(active) : null}
                q={q}
                onPick={open}
                onHover={(option) => setActiveId(optionId(option))}
              />
            ))}
          </div>
          {messageStatus}
        </div>
        {searching ? null : (
          <p className="px-2.5 py-3 text-sm text-text-muted">{t('search.hint')}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
