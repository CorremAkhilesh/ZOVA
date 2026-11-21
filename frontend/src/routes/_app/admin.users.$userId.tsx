import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

const AdminUserDetail = lazy(() => import('@/features/admin/users/AdminUserDetail'));

export const Route = createFileRoute('/_app/admin/users/$userId')({
  component: function AdminUserScreen() {
    const { t } = useTranslation();
    const { userId } = Route.useParams();
    return (
      <Suspense fallback={<p className="p-8 text-sm text-text-muted">{t('common.loading')}</p>}>
        <AdminUserDetail userId={userId} />
      </Suspense>
    );
  },
});
