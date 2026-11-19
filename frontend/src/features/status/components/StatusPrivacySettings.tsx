import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PublicProfile, StatusPrivacy } from '@zuvo/protocol';
import { X } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Avatar } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { usersApi } from '@/features/profile/api';
import { SettingsSection } from '@/features/settings/SettingsPage';
import { statusApi } from '../feed';

const PRIVACY_KEY = ['me', 'status-privacy'] as const;
const MODES: StatusPrivacy['mode'][] = ['all', 'except', 'only'];

/** The names of the people a list names (it stores ids). */
function usePeople(ids: string[]) {
  return useQuery({
    queryKey: ['status-privacy-people', [...ids].sort()],
    queryFn: async () => Promise.all(ids.map(async (id) => (await usersApi.get(id)).user)),
    enabled: ids.length > 0,
  });
}

/** Find colleagues to add to the list. */
function PersonSearch({
  chosen,
  onAdd,
}: {
  chosen: string[];
  onAdd: (person: PublicProfile) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const term = query.trim();
  const results = useQuery({
    queryKey: ['status-privacy-search', term],
    queryFn: () => usersApi.search(term),
    enabled: term.length > 0,
  });
  const options = (results.data?.items ?? []).filter((person) => !chosen.includes(person.id));
  return (
    <div className="space-y-1">
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('updates.privacySearch')}
        aria-label={t('updates.privacySearch')}
        className="h-11 w-full rounded-xl border bg-surface px-3 text-[15px] outline-none focus-visible:border-brand-text focus-visible:ring-3 focus-visible:ring-brand/20"
      />
      {options.length > 0 ? (
        <ul
          aria-label={t('updates.privacyResults')}
          className="max-h-56 overflow-y-auto rounded-xl border"
        >
          {options.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                onClick={() => {
                  onAdd(person);
                  setQuery('');
                }}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-background focus-visible:bg-background focus-visible:outline-none"
              >
                <Avatar name={person.displayName} src={person.avatar?.small} className="size-8" />
                <span className="truncate">{person.displayName}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Settings → Privacy → Status: all colleagues, all except some, or only some. Each new status takes
 * the setting as it is when posted; earlier ones keep theirs.
 */
export function StatusPrivacySettings() {
  const { t } = useTranslation();
  const name = useId();
  const queryClient = useQueryClient();
  const current = useQuery({
    queryKey: PRIVACY_KEY,
    queryFn: async () => (await statusApi.privacy()).privacy,
  });
  const save = useMutation({
    mutationFn: (privacy: StatusPrivacy) => statusApi.setPrivacy(privacy),
    onMutate: (privacy) => queryClient.setQueryData(PRIVACY_KEY, privacy),
    onError: () => {
      toast.error(t('updates.privacyFailed'));
      void queryClient.invalidateQueries({ queryKey: PRIVACY_KEY });
    },
  });
  const privacy = current.data;
  const people = usePeople(privacy && privacy.mode !== 'all' ? privacy.userIds : []);
  const set = (next: StatusPrivacy) => save.mutate(next);

  return (
    <SettingsSection title={t('updates.privacyTitle')}>
      <p className="text-sm text-text-muted">{t('updates.privacyExplain')}</p>
      {!privacy ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <>
          <fieldset className="space-y-1">
            <legend className="sr-only">{t('updates.privacyTitle')}</legend>
            {MODES.map((mode) => (
              <label
                key={mode}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-1"
              >
                <input
                  type="radio"
                  name={name}
                  checked={privacy.mode === mode}
                  onChange={() =>
                    set({
                      mode,
                      userIds: mode === 'all' ? [] : privacy.mode === mode ? privacy.userIds : [],
                    })
                  }
                  className="size-4 accent-brand"
                />
                <span>{t(`updates.privacy.${mode}`)}</span>
              </label>
            ))}
          </fieldset>
          {privacy.mode !== 'all' ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {t(
                  privacy.mode === 'except'
                    ? 'updates.privacyHiddenFrom'
                    : 'updates.privacySharedWith',
                  {
                    count: privacy.userIds.length,
                  },
                )}
              </p>
              <ul aria-label={t('updates.privacyChosen')} className="flex flex-wrap gap-2">
                {(people.data ?? []).map((person) => (
                  <li
                    key={person.id}
                    className="flex items-center gap-1 rounded-full bg-background py-1 pr-1 pl-3 text-sm"
                  >
                    {person.displayName}
                    <button
                      type="button"
                      aria-label={t('updates.privacyRemove', { name: person.displayName })}
                      className="tap-target grid size-6 place-items-center rounded-full hover:bg-border"
                      onClick={() =>
                        set({
                          ...privacy,
                          userIds: privacy.userIds.filter((id) => id !== person.id),
                        })
                      }
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
              <PersonSearch
                chosen={privacy.userIds}
                onAdd={(person) => set({ ...privacy, userIds: [...privacy.userIds, person.id] })}
              />
            </div>
          ) : null}
        </>
      )}
    </SettingsSection>
  );
}
