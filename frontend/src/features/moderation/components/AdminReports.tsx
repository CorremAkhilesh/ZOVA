import { useInfiniteQuery } from '@tanstack/react-query';
import type { ReportSummary } from '@zuvo/protocol';
import { ChevronRight, Flag } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsSection } from '@/features/settings/SettingsPage';
import { onRadioGroupKeyDown } from '@/lib/radio-keys';
import { cn } from '@/lib/utils';
import { adminReportsApi } from '../api';
import { ReportDetail } from './ReportDetail';

type Filter = 'open' | 'resolved' | 'all';
const FILTERS: Filter[] = ['open', 'resolved', 'all'];

function ReportRow({ report, onOpen }: { report: ReportSummary; onOpen: () => void }) {
  const { t, i18n } = useTranslation();
  const about = report.reported?.displayName ?? report.group?.name ?? '';
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 px-1 py-3 text-left hover:bg-background"
      >
        <Flag
          className={cn(
            'size-4 shrink-0',
            report.status === 'open' ? 'text-danger' : 'text-text-muted',
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">
            {t(`adminReports.kind.${report.kind}`, { name: about })}
          </span>
          <span className="block truncate text-sm text-text-muted">
            {t(`report.reasons.${report.reason}`)} ·{' '}
            {t('adminReports.by', { name: report.reporter.displayName })} ·{' '}
            {new Date(report.createdAt).toLocaleString(i18n.language)}
          </span>
        </span>
        <span className="text-xs text-text-muted">{t(`adminReports.status.${report.status}`)}</span>
        <ChevronRight className="size-4 text-text-muted" aria-hidden />
      </button>
    </li>
  );
}

/** Admin → Reports: newest first, open by default; each opens with its evidence. */
export default function AdminReports() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>('open');
  const [openId, setOpenId] = useState<string | null>(null);
  const query = useInfiniteQuery({
    queryKey: ['admin', 'reports', filter],
    queryFn: ({ pageParam }) =>
      adminReportsApi.list(filter === 'all' ? undefined : filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const reports = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <SettingsSection>
      <div
        role="radiogroup"
        onKeyDown={onRadioGroupKeyDown}
        aria-label={t('adminReports.filter')}
        className="flex gap-2"
      >
        {FILTERS.map((value) => (
          // biome-ignore lint/a11y/useSemanticElements: segmented control styled as buttons
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={filter === value}
            tabIndex={filter === value ? 0 : -1}
            onClick={() => setFilter(value)}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-sm font-medium',
              filter === value
                ? 'border-brand bg-brand-subtle text-brand-text'
                : 'text-text-muted hover:text-text',
            )}
          >
            {t(`adminReports.filters.${value}`)}
          </button>
        ))}
      </div>
      {query.isPending ? (
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : query.isError ? (
        <p role="alert" className="text-sm text-danger">
          {t('adminReports.loadFailed')}
        </p>
      ) : reports.length === 0 ? (
        <p className="text-sm text-text-muted">{t('adminReports.none')}</p>
      ) : (
        <ul aria-label={t('adminReports.title')} className="divide-y">
          {reports.map((report) => (
            <ReportRow key={report.id} report={report} onOpen={() => setOpenId(report.id)} />
          ))}
        </ul>
      )}
      {query.hasNextPage ? (
        <Button
          variant="outline"
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          {t('adminReports.more')}
        </Button>
      ) : null}
      {openId ? <ReportDetail id={openId} onClose={() => setOpenId(null)} /> : null}
    </SettingsSection>
  );
}
