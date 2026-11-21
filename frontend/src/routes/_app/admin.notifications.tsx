import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { AdminPage } from '@/features/admin/components/AdminLayout';
import { AdminNotifications } from '@/features/admin-notifications/components/AdminNotifications';

export const Route = createFileRoute('/_app/admin/notifications')({
  component: function AdminNotificationsScreen() {
    const { t } = useTranslation();
    return (
      <AdminPage title={t('adminPush.title')} description={t('adminPush.subtitle')}>
        <div className="max-w-3xl">
          <AdminNotifications />
        </div>
      </AdminPage>
    );
  },
});
