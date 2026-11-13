import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsSection } from '@/features/settings/SettingsPage';
import { adminApi } from '../api';

/** Admin → Audit log: who did what to whom, newest first. */
export function AdminAuditLog() {
  const { t, i18n } = useTranslation();
  const log = useInfiniteQuery({
    queryKey: ['admin', 'audit-log'],
    queryFn: ({ pageParam }) => adminApi.auditLog(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const entries = log.data?.pages.flatMap((page) => page.items) ?? [];
  const date = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );

  return (
    <SettingsSection>
      {log.isPending ? (
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : log.isError ? (
        <p role="alert" className="text-sm text-danger">
          {t('admin.loadFailed')}
        </p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-text-muted">{t('admin.auditEmpty')}</p>
      ) : (
        <ol className="divide-y">
          {entries.map((entry) => (
            <li key={entry.id} className="space-y-0.5 py-3 first:pt-0 last:pb-0">
              <p className="text-sm">
                {t(`admin.audit.${entry.action}`, {
                  actor: entry.actor.email,
                  target: entry.target.email,
                })}
              </p>
              <p className="text-xs text-text-muted">
                <time dateTime={entry.at}>{date(entry.at)}</time>
                {entry.ipAddress ? ` · ${entry.ipAddress}` : ''}
              </p>
            </li>
          ))}
        </ol>
      )}
      {log.hasNextPage ? (
        <Button
          variant="ghost"
          onClick={() => void log.fetchNextPage()}
          disabled={log.isFetchingNextPage}
        >
          {t('common.loadMore')}
        </Button>
      ) : null}
    </SettingsSection>
  );
}
