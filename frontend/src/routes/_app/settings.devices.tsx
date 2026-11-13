import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { DevicesSettings } from '@/features/security/components/DevicesSettings';
import { SettingsPage } from '@/features/settings/SettingsPage';

export const Route = createFileRoute('/_app/settings/devices')({
  component: function DevicesScreen() {
    const { t } = useTranslation();
    return (
      <SettingsPage title={t('devices.title')} description={t('devices.subtitle')}>
        <DevicesSettings />
      </SettingsPage>
    );
  },
});
