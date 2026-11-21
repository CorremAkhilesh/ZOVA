import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

/** Admins only, so its code stays out of everyone else's download. */
const AdminAuditPage = lazy(() => import('@/features/admin/security/AdminAuditPage'));

export const Route = createFileRoute('/_app/admin/audit')({
  component: function AuditScreen() {
    const { t } = useTranslation();
    return (
      <Suspense fallback={<p className="p-8 text-sm text-text-muted">{t('common.loading')}</p>}>
        <AdminAuditPage />
      </Suspense>
    );
  },
});
