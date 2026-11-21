import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminPage } from '@/features/admin/components/AdminLayout';

/** Admins only, so its code stays out of everyone else's download. */
const AdminReports = lazy(() => import('@/features/moderation/components/AdminReports'));

export const Route = createFileRoute('/_app/admin/reports')({
  component: function ReportsScreen() {
    const { t } = useTranslation();
    return (
      <AdminPage title={t('adminReports.title')} description={t('adminReports.subtitle')}>
        <div className="max-w-3xl">
          <Suspense fallback={<p className="text-sm text-text-muted">{t('common.loading')}</p>}>
            <AdminReports />
          </Suspense>
        </div>
      </AdminPage>
    );
  },
});
