import { useInfiniteQuery } from '@tanstack/react-query';
import { type AuditAction, type AuditFilter, auditActionSchema } from '@zuvo/protocol';
import { Download } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { authErrorMessage } from '@/features/auth/errors';
import { useDebouncedValue } from '@/lib/hooks';
import { AdminPage } from '../components/AdminLayout';
import { adminSecurityApi, downloadAuditCsv } from './api';

const FIELD =
  'h-10 rounded-lg border bg-surface px-3 text-sm shadow-sm outline-none focus-visible:border-brand-text focus-visible:ring-3 focus-visible:ring-brand/20 pointer-coarse:h-11';

/** A date input's day as the start (or end) of that day in the reader's time zone. */
const dayBound = (day: string, end: boolean) =>
  day ? new Date(`${day}T${end ? '23:59:59.999' : '00:00:00'}`).toISOString() : undefined;

/** Details as "key: value" pairs, readable without knowing the format. */
const detailText = (details: Record<string, string | number | null> | null) =>
  details
    ? Object.entries(details)
        .map(([key, value]) => `${key}: ${value ?? '—'}`)
        .join(' · ')
    : '';

/** Admin → Audit log: every admin action with its reason, filterable, and as CSV. */
export default function AdminAuditPage() {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [action, setAction] = useState<AuditAction | ''>('');
  const [actor, setActor] = useState('');
  const [target, setTarget] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [exporting, setExporting] = useState(false);
  const typedActor = useDebouncedValue(actor.trim(), 400);
  const typedTarget = useDebouncedValue(target.trim(), 400);
  const filter: AuditFilter = {
    ...(action ? { action } : {}),
    ...(typedActor ? { actor: typedActor } : {}),
    ...(typedTarget ? { target: typedTarget } : {}),
    ...(from ? { from: dayBound(from, false) } : {}),
    ...(to ? { to: dayBound(to, true) } : {}),
  };
  const log = useInfiniteQuery({
    queryKey: ['admin', 'audit-log', filter],
    queryFn: ({ pageParam }) => adminSecurityApi.audit(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const entries = log.data?.pages.flatMap((page) => page.items) ?? [];
  const date = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );

  async function exportCsv() {
    setExporting(true);
    try {
      await downloadAuditCsv(filter);
    } catch (error) {
      toast.error(authErrorMessage(error, t));
    } finally {
      setExporting(false);
    }
  }

  return (
    <AdminPage
      title={t('admin.auditTitle')}
      description={t('admin.auditSubtitle')}
      actions={
        <Button
          variant="outline"
          onClick={() => void exportCsv()}
          disabled={exporting}
          className="pointer-coarse:h-11"
        >
          <Download className="size-4" aria-hidden />
          {t('adminPanel.audit.export')}
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-action`} className="text-xs font-medium text-text-muted">
            {t('adminPanel.audit.action')}
          </label>
          <select
            id={`${id}-action`}
            value={action}
            onChange={(event) => setAction(event.target.value as AuditAction | '')}
            className={FIELD}
          >
            <option value="">{t('adminPanel.audit.anyAction')}</option>
            {auditActionSchema.options.map((value) => (
              <option key={value} value={value}>
                {t(`adminPanel.audit.actions.${value}`)}
              </option>
            ))}
          </select>
        </div>
        {(
          [
            ['actor', actor, setActor],
            ['target', target, setTarget],
          ] as const
        ).map(([key, value, set]) => (
          <div key={key} className="flex flex-col gap-1">
            <label htmlFor={`${id}-${key}`} className="text-xs font-medium text-text-muted">
              {t(`adminPanel.audit.${key}`)}
            </label>
            <Input
              id={`${id}-${key}`}
              type="email"
              value={value}
              onChange={(event) => set(event.target.value)}
              placeholder="name@corremadvisory.com"
              className="pointer-coarse:h-11"
            />
          </div>
        ))}
        {(
          [
            ['from', from, setFrom],
            ['to', to, setTo],
          ] as const
        ).map(([key, value, set]) => (
          <div key={key} className="flex flex-col gap-1">
            <label htmlFor={`${id}-${key}`} className="text-xs font-medium text-text-muted">
              {t(`adminPanel.audit.${key}`)}
            </label>
            <input
              id={`${id}-${key}`}
              type="date"
              value={value}
              onChange={(event) => set(event.target.value)}
              className={FIELD}
            />
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-2xl border bg-surface shadow-sm">
        {log.isPending ? (
          <div
            role="status"
            aria-busy="true"
            aria-label={t('common.loading')}
            className="space-y-3 p-5"
          >
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : log.isError ? (
          <div role="alert" className="space-y-3 p-5">
            <p className="text-sm text-danger">{t('admin.loadFailed')}</p>
            <Button variant="outline" onClick={() => void log.refetch()}>
              {t('adminPanel.dashboard.retry')}
            </Button>
          </div>
        ) : entries.length === 0 ? (
          <p className="p-5 text-sm text-text-muted">{t('admin.auditEmpty')}</p>
        ) : (
          <ol className="divide-y">
            {entries.map((entry) => (
              <li key={entry.id} className="space-y-0.5 px-5 py-3">
                <p className="text-sm break-words">
                  {t(`admin.audit.${entry.action}`, {
                    actor: entry.actor.email,
                    target: entry.target.email,
                  })}
                </p>
                {entry.reason ? (
                  <p className="text-sm break-words text-text-muted">
                    {t('admin.auditReason', { reason: entry.reason })}
                  </p>
                ) : null}
                {entry.details ? (
                  <p className="text-xs break-words text-text-muted">{detailText(entry.details)}</p>
                ) : null}
                <p className="text-xs text-text-muted">
                  <time dateTime={entry.at}>{date(entry.at)}</time>
                  {entry.ipAddress ? ` · ${entry.ipAddress}` : ''}
                </p>
              </li>
            ))}
          </ol>
        )}
        {log.hasNextPage ? (
          <div className="border-t p-3">
            <Button
              variant="ghost"
              onClick={() => void log.fetchNextPage()}
              disabled={log.isFetchingNextPage}
            >
              {t('common.loadMore')}
            </Button>
          </div>
        ) : null}
      </div>
    </AdminPage>
  );
}
