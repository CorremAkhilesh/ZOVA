import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

/** Admins only, so its code stays out of everyone else's download. */
const AdminDashboard = lazy(() => import('@/features/admin/components/AdminDashboard'));

export const Route = createFileRoute('/_app/admin/')({
  component: function DashboardScreen() {
    const { t } = useTranslation();
    return (
      <Suspense fallback={<p className="p-8 text-sm text-text-muted">{t('common.loading')}</p>}>
        <AdminDashboard />
      </Suspense>
    );
  },
});
