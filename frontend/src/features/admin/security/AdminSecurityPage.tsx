import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminSecurity } from '@zuvo/protocol';
import { LockKeyhole, MonitorSmartphone, UserCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { authErrorMessage } from '@/features/auth/errors';
import { AdminPage } from '../components/AdminLayout';
import { ReasonDialog } from '../users/ReasonDialog';
import { useWhen } from '../users/UserRows';
import { adminSecurityApi } from './api';

const KEY = ['admin', 'security'] as const;

function Tile({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  const { i18n } = useTranslation();
  return (
    <div className="flex items-center gap-3 rounded-2xl border bg-surface p-4 shadow-sm">
      <span className="flex size-10 items-center justify-center rounded-xl bg-brand-subtle text-brand-text">
        {icon}
      </span>
      <div>
        <p className="text-xs font-medium text-text-muted">{label}</p>
        <p className="text-2xl font-bold tabular-nums">
          {new Intl.NumberFormat(i18n.language).format(value)}
        </p>
      </div>
    </div>
  );
}

function Content({ data }: { data: AdminSecurity }) {
  const { t, i18n } = useTranslation();
  const when = useWhen();
  const queryClient = useQueryClient();
  const [unlocking, setUnlocking] = useState<AdminSecurity['locks'][number] | null>(null);
  const unlock = useMutation({
    mutationFn: (reason: string) => adminSecurityApi.unlock(unlocking?.id ?? '', reason),
    onSuccess: () => {
      toast.success(t('adminPanel.security.unlocked', { email: unlocking?.email ?? '' }));
      void queryClient.invalidateQueries({ queryKey: KEY });
      setUnlocking(null);
    },
    onError: (error) => toast.error(authErrorMessage(error, t)),
  });
  const time = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Tile
          icon={<MonitorSmartphone className="size-5" aria-hidden />}
          label={t('adminPanel.security.devices')}
          value={data.sessions.active}
        />
        <Tile
          icon={<UserCheck className="size-5" aria-hidden />}
          label={t('adminPanel.security.people')}
          value={data.sessions.people}
        />
      </div>
      <section
        aria-labelledby="security-locks"
        className="rounded-2xl border bg-surface p-5 shadow-sm"
      >
        <h2 id="security-locks" className="mb-1 text-lg font-semibold">
          {t('adminPanel.security.locksTitle')}
        </h2>
        <p className="mb-3 text-sm text-text-muted">{t('adminPanel.security.locksHint')}</p>
        {data.locks.length === 0 ? (
          <p className="text-sm text-text-muted">{t('adminPanel.security.noLocks')}</p>
        ) : (
          <ul className="divide-y">
            {data.locks.map((lock) => (
              <li key={lock.id} className="flex flex-wrap items-center gap-3 py-3">
                <LockKeyhole className="size-4 shrink-0 text-danger" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-all">{lock.email}</p>
                  <p className="text-xs text-text-muted">
                    {t('adminPanel.security.lockMeta', {
                      since: time(lock.lockedAt),
                      until: time(lock.until),
                      ip: lock.ip,
                    })}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setUnlocking(lock)}
                  className="pointer-coarse:h-11"
                >
                  {t('adminPanel.security.unlock')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section
        aria-labelledby="security-failures"
        className="rounded-2xl border bg-surface p-5 shadow-sm"
      >
        <h2 id="security-failures" className="mb-1 text-lg font-semibold">
          {t('adminPanel.security.failuresTitle')}
        </h2>
        <p className="mb-3 text-sm text-text-muted">{t('adminPanel.security.failuresHint')}</p>
        {data.failures.length === 0 ? (
          <p className="text-sm text-text-muted">{t('adminPanel.security.noFailures')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-sm">
              <thead className="text-left text-xs text-text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t('adminPanel.security.email')}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t('adminPanel.security.network')}
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    {t('adminPanel.security.when')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.failures.map((row) => (
                  <tr key={`${row.email}-${row.at}`}>
                    <td className="py-2 pr-3 break-all">{row.email}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{row.ip}</td>
                    <td className="py-2 text-text-muted">{when(row.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <ReasonDialog
        open={unlocking !== null}
        onClose={() => setUnlocking(null)}
        title={t('adminPanel.security.unlockTitle', { email: unlocking?.email ?? '' })}
        description={t('adminPanel.security.unlockBody')}
        confirmLabel={t('adminPanel.security.unlock')}
        pending={unlock.isPending}
        onConfirm={(reason) => unlock.mutate(reason)}
      />
    </div>
  );
}

/** Admin → Security: signed-in devices, emails locked for the day, and recent wrong codes. */
export default function AdminSecurityPage() {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: KEY,
    queryFn: adminSecurityApi.overview,
    refetchInterval: 60_000,
  });
  return (
    <AdminPage
      title={t('adminPanel.security.title')}
      description={t('adminPanel.security.subtitle')}
    >
      {query.isPending ? (
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="space-y-3">
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      ) : query.isError ? (
        <div role="alert" className="space-y-3 rounded-2xl border bg-surface p-5">
          <p className="text-sm">{t('admin.loadFailed')}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t('adminPanel.dashboard.retry')}
          </Button>
        </div>
      ) : (
        <div className="max-w-4xl [&>*]:min-w-0">
          <Content data={query.data} />
        </div>
      )}
    </AdminPage>
  );
}
