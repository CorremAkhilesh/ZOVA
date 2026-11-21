import type { AdminDashboard } from '@zuvo/protocol';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { BarChart } from './BarChart';

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-2xl border bg-surface p-4 shadow-sm">
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      {detail ? <p className="mt-1 text-xs text-text-muted">{detail}</p> : null}
    </div>
  );
}

/** The headline numbers: people, who was here, messages, calls and push. */
export function DashboardTiles({ data }: { data: AdminDashboard }) {
  const { t, i18n } = useTranslation();
  const number = (value: number) => new Intl.NumberFormat(i18n.language).format(value);
  const { users, today, notifications } = data;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6 [&>*]:min-w-0">
      <Tile
        label={t('adminPanel.dashboard.users')}
        value={number(users.total)}
        detail={t('adminPanel.dashboard.usersDetail', {
          active: number(users.active),
          deactivated: number(users.deactivated),
          admins: number(users.admins),
        })}
      />
      <Tile label={t('adminPanel.dashboard.activeToday')} value={number(users.activeToday)} />
      <Tile label={t('adminPanel.dashboard.active7d')} value={number(users.active7d)} />
      <Tile label={t('adminPanel.dashboard.messagesToday')} value={number(today.messages)} />
      <Tile label={t('adminPanel.dashboard.callsToday')} value={number(today.calls)} />
      <Tile
        label={t('adminPanel.dashboard.notificationsOn')}
        value={`${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(notifications.percent)}%`}
        detail={t('adminPanel.dashboard.notificationsDetail', {
          count: notifications.usersWithPush,
        })}
      />
    </div>
  );
}

const RANGES = [7, 30] as const;

/** Three small charts over the last 7 or 30 days. */
export function DashboardActivity({ series }: { series: AdminDashboard['series'] }) {
  const { t } = useTranslation();
  const [days, setDays] = useState<(typeof RANGES)[number]>(7);
  const shown = series.slice(-days);
  const points = (key: 'activeUsers' | 'messages' | 'calls') =>
    shown.map((day) => ({ date: day.date, value: day[key] }));
  return (
    <section aria-labelledby="admin-activity" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="admin-activity" className="text-lg font-semibold">
          {t('adminPanel.dashboard.activity')}
        </h2>
        <fieldset className="flex rounded-xl border bg-surface p-1">
          <legend className="sr-only">{t('adminPanel.dashboard.range')}</legend>
          {RANGES.map((range) => (
            <button
              key={range}
              type="button"
              aria-pressed={days === range}
              onClick={() => setDays(range)}
              className={cn(
                'tap-target rounded-lg px-3 py-1.5 text-sm font-medium text-text-muted',
                days === range && 'bg-brand-subtle text-brand-text',
              )}
            >
              {t('adminPanel.dashboard.days', { count: range })}
            </button>
          ))}
        </fieldset>
      </div>
      <div className="grid gap-3 lg:grid-cols-3 [&>*]:min-w-0">
        <BarChart title={t('adminPanel.dashboard.chartActive')} points={points('activeUsers')} />
        <BarChart title={t('adminPanel.dashboard.chartMessages')} points={points('messages')} />
        <BarChart title={t('adminPanel.dashboard.chartCalls')} points={points('calls')} />
      </div>
      <p className="text-xs text-text-muted">{t('adminPanel.dashboard.activityNote')}</p>
    </section>
  );
}
