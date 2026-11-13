import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { PublicProfile } from '@zuvo/protocol';
import { Check, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { useChats } from '@/features/chats/queries';
import { recentPeople } from '@/features/people/recent-people';
import { usersApi } from '@/features/profile/api';
import { useDebouncedValue } from '@/lib/hooks';
import { cn } from '@/lib/utils';

interface PeopleSelectProps {
  selected: PublicProfile[];
  onChange: (selected: PublicProfile[]) => void;
  /** Already in the group, so not offered. */
  excludeIds?: ReadonlySet<string>;
  max: number;
}

/** Search people and pick several: what is picked stays visible as chips above the results. */
export function PeopleSelect({ selected, onChange, excludeIds, max }: PeopleSelectProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const q = useDebouncedValue(query.trim(), 250);
  const results = useQuery({
    queryKey: ['people-select', q],
    queryFn: () => usersApi.search(q),
    placeholderData: keepPreviousData,
  });
  // Nothing typed: people from my chats first, then those I opened lately, then the rest.
  const chats = useChats();
  const recent = useMemo(
    () =>
      q
        ? []
        : [
            ...(chats ?? []).flatMap((chat) =>
              chat.type === 'direct' && chat.otherUser ? [chat.otherUser] : [],
            ),
            ...recentPeople.load(),
          ],
    [chats, q],
  );
  const chosen = new Set(selected.map((person) => person.id));
  const seen = new Set<string>();
  const options = [...recent, ...(results.data?.items ?? [])].filter((person) => {
    if (seen.has(person.id) || person.deactivated || excludeIds?.has(person.id)) return false;
    seen.add(person.id);
    return true;
  });
  const toggle = (person: PublicProfile) =>
    onChange(
      chosen.has(person.id)
        ? selected.filter((other) => other.id !== person.id)
        : [...selected, person],
    );

  return (
    <div className="space-y-2">
      {selected.length > 0 ? (
        <ul aria-label={t('groups.selected')} className="flex flex-wrap gap-1.5">
          {selected.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                onClick={() => toggle(person)}
                aria-label={t('groups.unselect', { name: person.displayName })}
                className="flex items-center gap-1 rounded-full bg-brand-subtle py-0.5 pr-1.5 pl-2.5 text-sm"
              >
                {person.displayName}
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('people.search')}
          aria-label={t('people.search')}
          className="pl-9"
          autoFocus
        />
      </div>
      <ul
        aria-label={t('groups.results')}
        className="max-h-64 min-h-24 space-y-0.5 overflow-y-auto"
      >
        {results.isError && options.length === 0 ? (
          <li role="alert" className="p-3 text-sm text-danger">
            {t('groups.searchFailed')}
          </li>
        ) : null}
        {results.isSuccess && options.length === 0 ? (
          <li className="p-3 text-center text-sm text-text-muted">{t('chats.noResults')}</li>
        ) : null}
        {options.map((person) => {
          const isChosen = chosen.has(person.id);
          return (
            <li key={person.id}>
              <button
                type="button"
                aria-pressed={isChosen}
                disabled={!isChosen && selected.length >= max}
                onClick={() => toggle(person)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-background',
                  isChosen && 'bg-brand-subtle',
                )}
              >
                <Avatar
                  name={person.displayName ?? ''}
                  src={person.avatar?.small}
                  className="size-9"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{person.displayName}</span>
                  {person.username ? (
                    <span className="block truncate text-xs text-text-muted">
                      @{person.username}
                    </span>
                  ) : null}
                </span>
                {isChosen ? <Check className="size-4 text-brand-text" aria-hidden /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
