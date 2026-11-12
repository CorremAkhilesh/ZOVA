import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import ChatLockSettings from '@/features/lock/components/ChatLockSettings';
import { BlockedContacts } from '@/features/moderation/components/BlockedContacts';
import { PrivacySettings } from '@/features/profile/components/PrivacySettings';
import { SettingsPage } from '@/features/settings/SettingsPage';

export const Route = createFileRoute('/_app/settings/privacy')({
  component: function PrivacyScreen() {
    const { t } = useTranslation();
    return (
      <SettingsPage title={t('privacy.title')} description={t('privacy.subtitle')}>
        <PrivacySettings />
        <ChatLockSettings />
        <BlockedContacts />
      </SettingsPage>
    );
  },
});
