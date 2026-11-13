import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsPage } from '@/features/settings/SettingsPage';

const PushSettings = lazy(() => import('@/features/notifications/components/PushSettings'));
const QuietHoursSettings = lazy(
  () => import('@/features/quiet-hours/components/QuietHoursSettings'),
);

export const Route = createFileRoute('/_app/settings/notifications')({
  component: function NotificationsScreen() {
    const { t } = useTranslation();
    return (
      <SettingsPage
        title={t('quietHours.screenTitle')}
        description={t('notifications.settings.screenSubtitle')}
      >
        <Suspense fallback={null}>
          <PushSettings />
          <QuietHoursSettings />
        </Suspense>
      </SettingsPage>
    );
  },
});
