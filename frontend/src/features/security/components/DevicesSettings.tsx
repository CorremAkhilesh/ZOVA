import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type DeviceSession, SESSION_NAME_MAX } from '@zuvo/protocol';
import { LogOut, Monitor, Smartphone, Tablet } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { authErrorMessage } from '@/features/auth/errors';
import { EditableField } from '@/features/profile/components/EditableField';
import { SettingsSection } from '@/features/settings/SettingsPage';
import { formatRelativeTime } from '@/lib/relative-time';
import { securityApi } from '../api';

export const sessionsQueryKey = ['me', 'sessions'] as const;

const ICONS = { desktop: Monitor, mobile: Smartphone, tablet: Tablet, unknown: Monitor };

function DeviceRow({
  device,
  onRevoke,
  onRename,
}: {
  device: DeviceSession;
  onRevoke: () => void;
  onRename: (name: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const Icon = ICONS[device.deviceType];
  const date = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );
  const browserAndOs = `${device.browser} · ${device.os}`;
  const title = device.name ?? browserAndOs;
  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <span className="mt-0.5 rounded-lg bg-brand-subtle p-2 text-brand-text">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {title}
          {device.current ? <Badge variant="accent">{t('devices.thisDevice')}</Badge> : null}
        </p>
        {device.name ? <p className="text-sm text-text-muted">{browserAndOs}</p> : null}
        <p className="text-sm text-text-muted">
          {t('devices.signedInAgo', {
            when: formatRelativeTime(device.createdAt, i18n.language),
          })}
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-xs text-text-muted">
          <dt>{t('devices.ip')}</dt>
          <dd>{device.ipAddress ?? t('devices.unknown')}</dd>
          <dt>{t('devices.signedIn')}</dt>
          <dd>{date(device.createdAt)}</dd>
          <dt>{t('devices.lastActive')}</dt>
          <dd>{date(device.lastActiveAt)}</dd>
          <dt>{t('devices.expires')}</dt>
          <dd>{date(device.expiresAt)}</dd>
        </dl>
        <div className="pt-2">
          <EditableField
            label={t('devices.name')}
            value={device.name ?? ''}
            placeholder={t('devices.nameEmpty')}
            maxLength={SESSION_NAME_MAX}
            onSave={onRename}
          />
        </div>
      </div>
      {device.current ? null : (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRevoke}
          aria-label={t('devices.signOutDevice', { device: title })}
        >
          <LogOut className="size-4" aria-hidden />
          {t('devices.signOut')}
        </Button>
      )}
    </li>
  );
}

/** Settings → Devices: every active session, sign out one or all others. */
export function DevicesSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [confirmAll, setConfirmAll] = useState(false);
  const { data, isPending, isError } = useQuery({
    queryKey: sessionsQueryKey,
    queryFn: async () => (await securityApi.sessions()).sessions,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: sessionsQueryKey });

  const revoke = useMutation({
    mutationFn: securityApi.revoke,
    onSuccess: () => {
      toast.success(t('devices.signedOutOne'));
      void refresh();
    },
    onError: (error) => toast.error(authErrorMessage(error, t)),
  });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => securityApi.rename(id, name),
    onSuccess: () => void refresh(),
    onError: (error) => toast.error(authErrorMessage(error, t)),
  });
  const revokeOthers = useMutation({
    mutationFn: securityApi.revokeOthers,
    onSuccess: ({ revoked }) => {
      setConfirmAll(false);
      toast.success(t('devices.signedOutOthers', { count: revoked }));
      void refresh();
    },
    onError: (error) => toast.error(authErrorMessage(error, t)),
  });

  if (isPending) {
    return (
      <SettingsSection>
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </SettingsSection>
    );
  }
  if (isError) {
    return (
      <SettingsSection>
        <p role="alert" className="text-sm text-danger">
          {t('devices.loadFailed')}
        </p>
      </SettingsSection>
    );
  }

  const others = data.filter((device) => !device.current);
  return (
    <>
      <SettingsSection>
        <ul className="divide-y">
          {data.map((device) => (
            <DeviceRow
              key={device.id}
              device={device}
              onRevoke={() => revoke.mutate(device.id)}
              onRename={(name) => rename.mutate({ id: device.id, name })}
            />
          ))}
        </ul>
      </SettingsSection>
      {others.length > 0 ? (
        <Button variant="danger-outline" onClick={() => setConfirmAll(true)}>
          <LogOut className="size-4" aria-hidden />
          {t('devices.signOutOthers')}
        </Button>
      ) : (
        <p className="text-sm text-text-muted">{t('devices.onlyThis')}</p>
      )}
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title={t('devices.signOutOthers')}
        description={t('devices.signOutOthersBody', { count: others.length })}
        confirmLabel={t('devices.signOutOthers')}
        onConfirm={() => revokeOthers.mutate()}
        pending={revokeOthers.isPending}
        danger
      />
    </>
  );
}
