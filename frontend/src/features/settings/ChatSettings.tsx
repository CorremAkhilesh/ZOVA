import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatSettings as Settings } from '@zuvo/protocol';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { authErrorMessage } from '@/features/auth/errors';
import { cn } from '@/lib/utils';
import { chatSettingsApi, chatSettingsQuery } from './chat-settings';
import { SettingsSection } from './SettingsPage';

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-4">
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{label}</span>
        <span className="block text-sm text-text-muted">{hint}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          'relative mt-1 inline-flex h-6 w-11 shrink-0 rounded-full transition-colors',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-brand-text peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface',
          checked ? 'bg-brand' : 'bg-border',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-5.5' : 'translate-x-0.5',
          )}
        />
      </span>
    </label>
  );
}

/** Settings → Chats. Saves at once (optimistic, rolled back on failure); my other devices follow. */
export function ChatSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data, isPending, isError } = useQuery(chatSettingsQuery);

  const save = useMutation({
    mutationFn: (changes: Partial<Settings>) => chatSettingsApi.update(changes),
    onMutate: (changes) => {
      const previous = queryClient.getQueryData(chatSettingsQuery.queryKey);
      if (previous)
        queryClient.setQueryData(chatSettingsQuery.queryKey, { ...previous, ...changes });
      return { previous };
    },
    onSuccess: ({ settings }) => queryClient.setQueryData(chatSettingsQuery.queryKey, settings),
    onError: (error, _changes, context) => {
      if (context?.previous) queryClient.setQueryData(chatSettingsQuery.queryKey, context.previous);
      toast.error(authErrorMessage(error, t));
    },
  });

  if (isPending) {
    return (
      <SettingsSection>
        <div role="status" aria-busy="true" aria-label={t('common.loading')}>
          <Skeleton className="h-10 w-full" />
        </div>
      </SettingsSection>
    );
  }
  if (isError) {
    return (
      <SettingsSection>
        <p role="alert" className="text-sm text-danger">
          {t('chatSettings.loadFailed')}
        </p>
      </SettingsSection>
    );
  }
  return (
    <SettingsSection>
      <Toggle
        label={t('chatSettings.keepArchived')}
        hint={t('chatSettings.keepArchivedHint')}
        checked={data.keepChatsArchived}
        onChange={(keepChatsArchived) => save.mutate({ keepChatsArchived })}
      />
    </SettingsSection>
  );
}
