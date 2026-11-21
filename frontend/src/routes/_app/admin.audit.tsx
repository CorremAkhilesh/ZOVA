import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { AdminPage } from '@/features/admin/components/AdminLayout';
import { AdminAuditLog } from '@/features/security/components/AdminAuditLog';

export const Route = createFileRoute('/_app/admin/audit')({
  component: function AuditScreen() {
    const { t } = useTranslation();
    return (
      <AdminPage title={t('admin.auditTitle')} description={t('admin.auditSubtitle')}>
        <div className="max-w-3xl">
          <AdminAuditLog />
        </div>
      </AdminPage>
    );
  },
});
