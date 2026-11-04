import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ProfileSettings } from '@/features/profile/components/ProfileSettings';
import { SettingsPage } from '@/features/settings/SettingsPage';

export const Route = createFileRoute('/_app/settings/profile')({
  component: function ProfileScreen() {
    const { t } = useTranslation();
    return (
      <SettingsPage title={t('profile.title')} description={t('profile.subtitle')}>
        <ProfileSettings />
      </SettingsPage>
    );
  },
});
