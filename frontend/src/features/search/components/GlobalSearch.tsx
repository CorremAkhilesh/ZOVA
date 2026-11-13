import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type SearchFilter, searchFilterSchema } from '@zuvo/protocol';
import { Search } from 'lucide-react';
import { type KeyboardEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { useCommandOptions } from '../use-command-options';
import { useMessageSearch } from '../use-message-search';
import { optionId, type ResultOption, ResultSection, type SearchOption } from './SearchResults';
import { MessageStatus, PaletteHint } from './SearchStatus';

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
  return (option: ResultOption) => {
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
  const commands = useCommandOptions(q, filter !== undefined, hide);
  const { commandMode } = commands;
  const typed = useDebouncedValue(commandMode ? '' : q.trim(), 250);
  const people = useQuery({
    queryKey: ['users', 'search', typed],
    queryFn: async () => (await usersApi.search(typed)).items,
    enabled: typed.length > 0 && !filter && !commandMode,
    placeholderData: keepPreviousData,
  });
  const messages = useMessageSearch(commandMode ? { q: '' } : { q, filter }, chats);
  const open = useOpenResult(hide);
  const pick = (option: SearchOption) =>
    option.kind === 'command' ? commands.run(option.command) : open(option);

  const sections = useMemo(() => {
    const onlyMessages = filter !== undefined || commandMode;
    const chatOptions: SearchOption[] = onlyMessages
      ? []
      : searchLocalChats(chats ?? [], q, t('chats.saved'))
          .slice(0, 5)
          .map((chat) => ({ kind: 'chat', id: chat.id, chat }));
    const personOptions: SearchOption[] =
      onlyMessages || !typed
        ? []
        : (people.data ?? [])
            .slice(0, 5)
            .map((person) => ({ kind: 'person', id: person.id, person }));
    const messageOptions: SearchOption[] = (commandMode ? [] : messages.hits).map((hit) => ({
      kind: 'message',
      id: hit.key,
      hit,
    }));
    return { chatOptions, personOptions, messageOptions };
  }, [chats, commandMode, filter, messages.hits, people.data, q, t, typed]);
  const all = [
    ...commands.options,
    ...sections.chatOptions,
    ...sections.personOptions,
    ...sections.messageOptions,
  ];
  const active = all.find((option) => optionId(option) === activeId) ?? all[0] ?? null;

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && active) {
      event.preventDefault();
      pick(active);
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

  const searching = !commandMode && (q.trim().length > 0 || filter !== undefined);

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
        <fieldset hidden={commandMode} className="flex flex-wrap gap-1.5">
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
                ['commands', commands.options],
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
                onPick={pick}
                onHover={(option) => setActiveId(optionId(option))}
              />
            ))}
          </div>
          {searching ? <MessageStatus messages={messages} /> : null}
        </div>
        {searching || (commandMode && commands.options.length > 0) ? null : (
          <PaletteHint commandMode={commandMode} />
        )}
      </DialogContent>
    </Dialog>
  );
}
