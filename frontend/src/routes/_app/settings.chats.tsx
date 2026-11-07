import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ChatSettings } from '@/features/settings/ChatSettings';
import { SettingsPage } from '@/features/settings/SettingsPage';

export const Route = createFileRoute('/_app/settings/chats')({
  component: function ChatSettingsScreen() {
    const { t } = useTranslation();
    return (
      <SettingsPage title={t('chatSettings.title')} description={t('chatSettings.subtitle')}>
        <ChatSettings />
      </SettingsPage>
    );
  },
});
