import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { StorageSettings } from '@/features/storage/StorageSettings';

export const Route = createFileRoute('/_app/settings/storage')({
  component: function StorageScreen() {
    const { t } = useTranslation();
    return (
      <SettingsPage title={t('storage.title')} description={t('storage.subtitle')}>
        <StorageSettings />
      </SettingsPage>
    );
  },
});
