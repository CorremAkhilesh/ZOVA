import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { AdminNotifications } from '@/features/admin-notifications/components/AdminNotifications';
import { requireAdmin } from '@/features/auth/guards';
import { SettingsPage } from '@/features/settings/SettingsPage';

export const Route = createFileRoute('/_app/settings/admin/notifications')({
  beforeLoad: ({ context }) => requireAdmin(context.queryClient),
  component: function AdminNotificationsScreen() {
    const { t } = useTranslation();
    return (
      <SettingsPage title={t('adminPush.title')} description={t('adminPush.subtitle')}>
        <AdminNotifications />
      </SettingsPage>
    );
  },
});
