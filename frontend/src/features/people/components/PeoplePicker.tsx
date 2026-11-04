import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { PublicProfile } from '@zuvo/protocol';
import { Search } from 'lucide-react';
import { type KeyboardEvent, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { chatsApi } from '@/features/chats/api';
import { useLocalDb } from '@/features/chats/queries';
import { usersApi } from '@/features/profile/api';
import { applyChats } from '@/features/sync/apply';
import { useDebouncedValue } from '@/lib/hooks';
import { recentPeople } from '../recent-people';
import { PeopleResults } from './PeopleResults';
import { ProfileCard } from './ProfileCard';

interface PeoplePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "New chat": find a colleague by name, @username or email. ↑/↓ to move, Enter to open the chat.
 * A deactivated person has no chat to open, so they get their profile card instead.
 */
export function PeoplePicker({ open, onOpenChange }: PeoplePickerProps) {
  const { t } = useTranslation();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<PublicProfile | null>(null);
  const q = useDebouncedValue(query.trim(), 250);
  const navigate = useNavigate();
  const db = useLocalDb();

  const openChat = useMutation({
    mutationFn: async (person: PublicProfile) => {
      // Already on this device: no need for the network.
      const known = await db?.chats.filter((chat) => chat.otherUser?.id === person.id).first();
      if (known) return known.id;
      const chat = await chatsApi.createDirect(person.id);
      if (db) await applyChats(db, [chat]);
      return chat.id;
    },
    onSuccess: (chatId) => {
      onOpenChange(false);
      void navigate({ to: '/chats/$chatId', params: { chatId } });
    },
  });

  const results = useQuery({
    queryKey: ['users', 'search', q],
    queryFn: async () => (await usersApi.search(q)).items,
    enabled: open,
    staleTime: 30_000,
    // Keep showing the last results while the next search loads (no empty flash under the cursor).
    placeholderData: keepPreviousData,
  });

  const recent = q ? [] : recentPeople.load();
  const recentIds = new Set(recent.map((p) => p.id));
  const options = [...recent, ...(results.data ?? []).filter((p) => !recentIds.has(p.id))];
  const heading = q
    ? t('people.results')
    : recent.length > 0
      ? t('people.recentAndSuggested')
      : t('people.suggested');

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new query resets the highlight
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    if (!open) {
      setQuery('');
      setSelected(null);
    }
  }, [open]);

  function choose(person: PublicProfile) {
    recentPeople.add(person);
    if (person.deactivated) setSelected(person);
    else openChat.mutate(person);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') setActive((i) => Math.min(i + 1, options.length - 1));
    else if (event.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0));
    else if (event.key === 'Enter' && options[active]) choose(options[active]);
    else return;
    event.preventDefault();
  }

  const optionId = (index: number) => `${listId}-option-${index}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('people.title')} className="max-w-lg">
        {selected ? (
          <ProfileCard person={selected} onBack={() => setSelected(null)} />
        ) : (
          <>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
                aria-hidden
              />
              <Input
                role="combobox"
                aria-expanded={options.length > 0}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={options[active] ? optionId(active) : undefined}
                aria-label={t('people.search')}
                placeholder={t('people.search')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onKeyDown}
                className="pl-9"
                autoFocus
              />
            </div>
            <div className="min-h-48 overflow-y-auto">
              <PeopleResults
                listId={listId}
                optionId={optionId}
                options={options}
                active={active}
                heading={heading}
                state={results.isError ? 'error' : results.isPending ? 'loading' : 'ready'}
                hasQuery={Boolean(q)}
                onActivate={setActive}
                onChoose={choose}
              />
            </div>
            {openChat.isError ? (
              <p role="alert" className="text-sm text-danger">
                {t('people.openFailed')}
              </p>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
