import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { requireAdmin } from '@/features/auth/guards';
import { AdminAuditLog } from '@/features/security/components/AdminAuditLog';
import { SettingsPage } from '@/features/settings/SettingsPage';

export const Route = createFileRoute('/_app/settings/admin/audit')({
  beforeLoad: ({ context }) => requireAdmin(context.queryClient),
  component: function AuditScreen() {
    const { t } = useTranslation();
    return (
      <SettingsPage title={t('admin.auditTitle')} description={t('admin.auditSubtitle')}>
        <AdminAuditLog />
      </SettingsPage>
    );
  },
});
