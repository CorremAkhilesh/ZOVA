import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { AdminPage } from '@/features/admin/components/AdminLayout';
import { AdminUsers } from '@/features/security/components/AdminUsers';

export const Route = createFileRoute('/_app/admin/users')({
  component: function AdminUsersScreen() {
    const { t } = useTranslation();
    return (
      <AdminPage title={t('admin.usersTitle')} description={t('admin.usersSubtitle')}>
        <div className="max-w-3xl">
          <AdminUsers />
        </div>
      </AdminPage>
    );
  },
});
