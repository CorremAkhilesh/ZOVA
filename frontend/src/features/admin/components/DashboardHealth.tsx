import type { AdminDashboard, CheckStatus } from '@zuvo/protocol';
import { CircleAlert, CircleCheck, CircleMinus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

const ICONS = {
  ok: <CircleCheck className="size-4 text-success" aria-hidden />,
  error: <CircleAlert className="size-4 text-danger" aria-hidden />,
  skipped: <CircleMinus className="size-4 text-text-muted" aria-hidden />,
} satisfies Record<CheckStatus, ReactNode>;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className="flex flex-wrap items-center justify-end gap-x-1.5 text-right text-sm font-medium">
        {children}
      </dd>
    </div>
  );
}

/** Each part of the service with an icon and a word (never colour alone), and the live build. */
export function DashboardHealth({ data }: { data: AdminDashboard }) {
  const { t, i18n } = useTranslation();
  const status = (value: CheckStatus) => (
    <>
      {ICONS[value]}
      {t(`adminPanel.dashboard.status.${value}`)}
    </>
  );
  const when = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );
  const { health, build } = data;
  return (
    <section
      aria-labelledby="admin-health"
      className="space-y-2 rounded-2xl border bg-surface p-5 shadow-sm"
    >
      <h2 id="admin-health" className="text-lg font-semibold">
        {t('adminPanel.dashboard.health')}
      </h2>
      <dl className="divide-y">
        <Row label={t('adminPanel.dashboard.api')}>{status('ok')}</Row>
        <Row label={t('adminPanel.dashboard.mongodb')}>{status(health.mongodb)}</Row>
        <Row label={t('adminPanel.dashboard.redis')}>{status(health.redis)}</Row>
        <Row label={t('adminPanel.dashboard.mediaStorage')}>{status(health.storage)}</Row>
        <Row label={t('adminPanel.dashboard.emailQueue')}>
          {health.emailQueue ? (
            <>
              {status(health.emailQueue.status)}
              <span className="w-full text-xs font-normal text-text-muted">
                {t('adminPanel.dashboard.emailQueueDetail', health.emailQueue)}
              </span>
            </>
          ) : (
            status('skipped')
          )}
        </Row>
        <Row label={t('adminPanel.dashboard.version')}>
          {t('adminPanel.dashboard.versionValue', build)}
        </Row>
        {build.builtAt ? (
          <Row label={t('adminPanel.dashboard.builtAt')}>{when(build.builtAt)}</Row>
        ) : null}
        <Row label={t('adminPanel.dashboard.lastBackup')}>
          {data.lastBackupAt
            ? when(data.lastBackupAt)
            : t('adminPanel.dashboard.lastBackupUnknown')}
        </Row>
      </dl>
    </section>
  );
}
