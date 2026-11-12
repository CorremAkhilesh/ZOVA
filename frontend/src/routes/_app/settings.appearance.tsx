import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsPage } from '@/features/settings/SettingsPage';

const AppearanceSettings = lazy(
  () => import('@/features/appearance/components/AppearanceSettings'),
);

export const Route = createFileRoute('/_app/settings/appearance')({
  component: function AppearanceScreen() {
    const { t } = useTranslation();
    return (
      <SettingsPage title={t('appearance.title')} description={t('appearance.subtitle')}>
        <Suspense fallback={null}>
          <AppearanceSettings />
        </Suspense>
      </SettingsPage>
    );
  },
});
