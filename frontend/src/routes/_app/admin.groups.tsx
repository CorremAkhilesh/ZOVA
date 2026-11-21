import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

/** Admins only, so its code stays out of everyone else's download. */
const AdminGroupsPage = lazy(() => import('@/features/admin/groups/AdminGroupsPage'));

export const Route = createFileRoute('/_app/admin/groups')({
  component: function AdminGroupsScreen() {
    const { t } = useTranslation();
    return (
      <Suspense fallback={<p className="p-8 text-sm text-text-muted">{t('common.loading')}</p>}>
        <AdminGroupsPage />
      </Suspense>
    );
  },
});
