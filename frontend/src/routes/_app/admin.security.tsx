import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

/** Admins only, so its code stays out of everyone else's download. */
const AdminSecurityPage = lazy(() => import('@/features/admin/security/AdminSecurityPage'));

export const Route = createFileRoute('/_app/admin/security')({
  component: function SecurityScreen() {
    const { t } = useTranslation();
    return (
      <Suspense fallback={<p className="p-8 text-sm text-text-muted">{t('common.loading')}</p>}>
        <AdminSecurityPage />
      </Suspense>
    );
  },
});
