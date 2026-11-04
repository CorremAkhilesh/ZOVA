import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { requireAdmin } from '@/features/auth/guards';
import { AdminUsers } from '@/features/security/components/AdminUsers';
import { SettingsPage } from '@/features/settings/SettingsPage';

export const Route = createFileRoute('/_app/settings/admin/users')({
  beforeLoad: ({ context }) => requireAdmin(context.queryClient),
  component: function AdminUsersScreen() {
    const { t } = useTranslation();
    return (
      <SettingsPage title={t('admin.usersTitle')} description={t('admin.usersSubtitle')}>
        <AdminUsers />
      </SettingsPage>
    );
  },
});
