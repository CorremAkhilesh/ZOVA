import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { brand } from '@zuvo/config';
import { ABOUT_MAX, displayNameSchema, type MyProfile } from '@zuvo/protocol';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { authErrorMessage } from '@/features/auth/errors';
import { SettingsSection } from '@/features/settings/SettingsPage';
import { profileApi } from '../api';
import { applyProfile, myProfileQuery } from '../queries';
import { AvatarEditor } from './AvatarEditor';
import { EditableField } from './EditableField';
import { UsernameEditor } from './UsernameEditor';

type Changes = { displayName?: string; about?: string };

/** Settings → Profile: photo, name, @username and about, edited in place. */
export function ProfileSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: profile, isPending, isError, refetch } = useQuery(myProfileQuery);

  // Optimistic: the new value shows at once and is rolled back if the server refuses it.
  const update = useMutation({
    mutationFn: (changes: Changes) => profileApi.update(changes),
    onMutate: async (changes) => {
      await queryClient.cancelQueries(myProfileQuery);
      const previous = queryClient.getQueryData(myProfileQuery.queryKey);
      if (previous) applyProfile(queryClient, { ...previous, ...changes });
      return { previous };
    },
    onError: (error, _changes, context) => {
      if (context?.previous) applyProfile(queryClient, context.previous);
      toast.error(authErrorMessage(error, t));
    },
    onSuccess: ({ profile: saved }) => applyProfile(queryClient, saved),
  });

  if (isPending) {
    return (
      <SettingsSection>
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="space-y-4">
          <Skeleton className="size-24 rounded-full" />
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-6 w-2/3" />
        </div>
      </SettingsSection>
    );
  }
  if (isError) {
    return (
      <SettingsSection>
        <p role="alert" className="text-sm text-danger">
          {t('profile.loadFailed')}{' '}
          <button type="button" className="font-medium underline" onClick={() => void refetch()}>
            {t('common.retry')}
          </button>
        </p>
      </SettingsSection>
    );
  }

  return <ProfileForm profile={profile} onChange={(changes) => update.mutate(changes)} />;
}

function ProfileForm({
  profile,
  onChange,
}: {
  profile: MyProfile;
  onChange: (c: Changes) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <SettingsSection title={t('profile.photo.title')}>
        <AvatarEditor profile={profile} />
      </SettingsSection>
      <SettingsSection title={t('profile.details')}>
        <EditableField
          label={t('auth.nameLabel')}
          value={profile.displayName ?? ''}
          maxLength={50}
          validate={(value) =>
            displayNameSchema.safeParse(value).success ? null : t('auth.nameRequired')
          }
          onSave={(displayName) => onChange({ displayName })}
        />
        <UsernameEditor profile={profile} />
        <EditableField
          label={t('profile.about')}
          value={profile.about}
          placeholder={brand.defaultAbout}
          maxLength={ABOUT_MAX}
          multiline
          onSave={(about) => onChange({ about })}
        />
        <div>
          <p className="text-sm text-text-muted">{t('profile.email')}</p>
          <p className="font-medium wrap-anywhere">{profile.email}</p>
        </div>
      </SettingsSection>
    </>
  );
}
