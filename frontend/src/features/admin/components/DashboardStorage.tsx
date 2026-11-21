import { brand } from '@zuvo/config';
import type { AdminDashboard } from '@zuvo/protocol';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '@/lib/format-bytes';
import { cn } from '@/lib/utils';

/** A themed bar for a share, 0–100. `danger` once it is past where it should be. */
function ShareBar({
  label,
  percent,
  text,
  danger,
  marker,
}: {
  label: string;
  percent: number;
  text: string;
  danger: boolean;
  marker?: number;
}) {
  const width = Math.min(100, Math.max(0, percent));
  return (
    // biome-ignore lint/a11y/useSemanticElements: a styled bar; <meter> cannot be themed alike in every browser
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(width)}
      aria-valuetext={text}
      className="relative h-2.5 rounded-full bg-background"
    >
      <div
        className={cn('h-full rounded-full', danger ? 'bg-danger' : 'bg-brand')}
        style={{ width: `${width}%` }}
      />
      {marker !== undefined ? (
        <div
          aria-hidden
          className="absolute -top-1 h-4.5 w-0.5 rounded-full bg-text"
          style={{ left: `${marker}%` }}
        />
      ) : null}
    </div>
  );
}

/** The server disk, how much the app's files take, and who stores the most. */
export function DashboardStorage({ storage }: { storage: AdminDashboard['storage'] }) {
  const { t, i18n } = useTranslation();
  const size = (bytes: number) => formatBytes(bytes, i18n.language);
  const { disk } = storage;
  return (
    <section
      aria-labelledby="admin-storage"
      className="space-y-4 rounded-2xl border bg-surface p-5 shadow-sm"
    >
      <h2 id="admin-storage" className="text-lg font-semibold">
        {t('adminPanel.dashboard.storage')}
      </h2>
      <div className="space-y-2">
        <p className="text-sm font-medium">{t('adminPanel.dashboard.disk')}</p>
        {disk ? (
          <>
            <ShareBar
              label={t('adminPanel.dashboard.disk')}
              percent={disk.percent}
              marker={disk.guardPercent}
              danger={disk.percent >= disk.guardPercent - 5}
              text={t('adminPanel.dashboard.diskUsed', {
                used: size(disk.usedBytes),
                total: size(disk.totalBytes),
                percent: disk.percent,
              })}
            />
            <p className="text-sm text-text-muted">
              {t('adminPanel.dashboard.diskUsed', {
                used: size(disk.usedBytes),
                total: size(disk.totalBytes),
                percent: disk.percent,
              })}{' '}
              · {t('adminPanel.dashboard.diskGuard', { percent: disk.guardPercent })}
            </p>
          </>
        ) : (
          <p className="text-sm text-text-muted">{t('adminPanel.dashboard.diskUnknown')}</p>
        )}
        <p className="text-sm">
          {t('adminPanel.dashboard.files', { brand: brand.name })}:{' '}
          <span className="font-semibold tabular-nums">{size(storage.filesBytes)}</span>
        </p>
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">{t('adminPanel.dashboard.topUsers')}</h3>
        {storage.topUsers.length === 0 ? (
          <p className="text-sm text-text-muted">{t('adminPanel.dashboard.topUsersEmpty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-sm">
              <thead className="text-left text-xs text-text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t('adminPanel.dashboard.person')}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t('adminPanel.dashboard.used')}
                  </th>
                  <th scope="col" className="w-1/3 py-2 font-medium">
                    {t('adminPanel.dashboard.limit')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {storage.topUsers.map((user) => {
                  const percent = (user.usedBytes / Math.max(1, user.quotaBytes)) * 100;
                  return (
                    <tr key={user.id}>
                      <td className="py-2 pr-3">
                        <p className="font-medium">{user.displayName ?? user.email}</p>
                        <p className="text-xs text-text-muted">{user.email}</p>
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{size(user.usedBytes)}</td>
                      <td className="space-y-1 py-2">
                        <ShareBar
                          label={user.displayName ?? user.email}
                          percent={percent}
                          danger={percent >= 90}
                          text={`${Math.round(percent)}%`}
                        />
                        <p className="text-xs text-text-muted tabular-nums">
                          {size(user.quotaBytes)}
                        </p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
