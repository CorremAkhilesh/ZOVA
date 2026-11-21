import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi, adminDashboardKey } from '../api';
import { AdminPage } from './AdminLayout';
import { DashboardActivity, DashboardTiles } from './DashboardActivity';
import { DashboardHealth } from './DashboardHealth';
import { DashboardStorage } from './DashboardStorage';

function Loading() {
  const { t } = useTranslation();
  return (
    <div role="status" aria-busy="true" aria-label={t('common.loading')} className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders that never reorder
          <Skeleton key={index} className="h-24 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-56 rounded-2xl" />
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  );
}

/** Admin → Dashboard: the numbers, activity, storage and health at a glance. */
export default function AdminDashboard() {
  const { t, i18n } = useTranslation();
  const query = useQuery({
    queryKey: adminDashboardKey,
    queryFn: adminApi.dashboard,
    // The server works it out at most once a minute.
    staleTime: 60_000,
  });
  const updated = query.data
    ? new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short' }).format(
        new Date(query.data.generatedAt),
      )
    : null;

  return (
    <AdminPage
      title={t('adminPanel.dashboard.title')}
      description={t('adminPanel.dashboard.subtitle')}
      actions={
        query.data ? (
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span>{t('adminPanel.dashboard.updated', { time: updated })}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCw className="size-3.5" aria-hidden />
              {t('adminPanel.dashboard.refresh')}
            </Button>
          </div>
        ) : null
      }
    >
      {query.isPending ? <Loading /> : null}
      {query.isError ? (
        <div role="alert" className="space-y-3 rounded-2xl border bg-surface p-5">
          <p className="text-sm">{t('adminPanel.dashboard.loadFailed')}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t('adminPanel.dashboard.retry')}
          </Button>
        </div>
      ) : null}
      {query.data ? (
        <div className="space-y-6">
          <DashboardTiles data={query.data} />
          <DashboardActivity series={query.data.series} />
          <div className="grid gap-4 xl:grid-cols-[2fr_1fr] [&>*]:min-w-0">
            <DashboardStorage storage={query.data.storage} />
            <DashboardHealth data={query.data} />
          </div>
        </div>
      ) : null}
    </AdminPage>
  );
}
