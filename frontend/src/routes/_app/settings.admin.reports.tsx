import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { requireAdmin } from '@/features/auth/guards';
import { SettingsPage } from '@/features/settings/SettingsPage';

/** Admins only, so its code stays out of everyone else's download. */
const AdminReports = lazy(() => import('@/features/moderation/components/AdminReports'));

export const Route = createFileRoute('/_app/settings/admin/reports')({
  beforeLoad: ({ context }) => requireAdmin(context.queryClient),
  component: function ReportsScreen() {
    const { t } = useTranslation();
    return (
      <SettingsPage title={t('adminReports.title')} description={t('adminReports.subtitle')}>
        <Suspense fallback={<p className="text-sm text-text-muted">{t('common.loading')}</p>}>
          <AdminReports />
        </Suspense>
      </SettingsPage>
    );
  },
});
