import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PrivacySettings as Privacy } from '@zuvo/protocol';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { authErrorMessage } from '@/features/auth/errors';
import { SettingsSection } from '@/features/settings/SettingsPage';
import { cn } from '@/lib/utils';
import { profileApi } from '../api';
import { privacyQuery } from '../queries';

type Choice<V extends string | boolean> = { value: V; label: string };

function ChoiceGroup<V extends string | boolean>({
  label,
  hint,
  value,
  choices,
  onChange,
}: {
  label: string;
  hint: string;
  value: V;
  choices: Choice<V>[];
  onChange: (value: V) => void;
}) {
  return (
    <div className="space-y-2">
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-sm text-text-muted">{hint}</p>
      </div>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {choices.map((choice) => (
          // biome-ignore lint/a11y/useSemanticElements: segmented control styled as buttons
          <button
            key={String(choice.value)}
            type="button"
            role="radio"
            aria-checked={choice.value === value}
            onClick={() => onChange(choice.value)}
            className={cn(
              'rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
              choice.value === value
                ? 'border-brand bg-brand-subtle text-brand-text'
                : 'text-text-muted hover:text-text',
            )}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Settings → Privacy. Changes save immediately (optimistic, rolled back on failure). */
export function PrivacySettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data, isPending, isError } = useQuery(privacyQuery);

  const save = useMutation({
    mutationFn: (next: Privacy) => profileApi.setPrivacy(next),
    onMutate: (next) => {
      const previous = queryClient.getQueryData(privacyQuery.queryKey);
      queryClient.setQueryData(privacyQuery.queryKey, next);
      return { previous };
    },
    onError: (error, _next, context) => {
      if (context?.previous) queryClient.setQueryData(privacyQuery.queryKey, context.previous);
      toast.error(authErrorMessage(error, t));
    },
  });

  if (isPending) {
    return (
      <SettingsSection>
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </SettingsSection>
    );
  }
  if (isError) {
    return (
      <SettingsSection>
        <p role="alert" className="text-sm text-danger">
          {t('privacy.loadFailed')}
        </p>
      </SettingsSection>
    );
  }

  const audience: Choice<'everyone' | 'nobody'>[] = [
    { value: 'everyone', label: t('privacy.everyone') },
    { value: 'nobody', label: t('privacy.nobody') },
  ];
  const set = (changes: Partial<Privacy>) => save.mutate({ ...data, ...changes });

  return (
    <SettingsSection>
      <ChoiceGroup
        label={t('privacy.lastSeen')}
        hint={t('privacy.lastSeenHint')}
        value={data.lastSeen}
        choices={audience}
        onChange={(lastSeen) => set({ lastSeen })}
      />
      <ChoiceGroup
        label={t('privacy.profilePhoto')}
        hint={t('privacy.profilePhotoHint')}
        value={data.profilePhoto}
        choices={audience}
        onChange={(profilePhoto) => set({ profilePhoto })}
      />
      <ChoiceGroup
        label={t('privacy.about')}
        hint={t('privacy.aboutHint')}
        value={data.about}
        choices={audience}
        onChange={(about) => set({ about })}
      />
      <ChoiceGroup
        label={t('privacy.readReceipts')}
        hint={t('privacy.readReceiptsHint')}
        value={data.readReceipts}
        choices={[
          { value: true, label: t('privacy.on') },
          { value: false, label: t('privacy.off') },
        ]}
        onChange={(readReceipts) => set({ readReceipts })}
      />
    </SettingsSection>
  );
}
