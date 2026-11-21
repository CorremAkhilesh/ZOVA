import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { AdminUserDetail as Detail } from '@zuvo/protocol';
import { ArrowLeft, Bell, BellOff, MonitorSmartphone } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/features/auth/session';
import { useAppConfig } from '@/features/media/use-app-config';
import { formatBytes } from '@/lib/format-bytes';
import { AdminPage } from '../components/AdminLayout';
import { adminUsersApi, userKey } from './api';
import { type PendingAction, UserActionDialog, type UserActionKind } from './UserActionDialog';
import { nameOf, StatusBadges, StorageBar, useWhen } from './UserRows';

const GB = 1024 ** 3;
const KINDS = ['image', 'video', 'voice', 'audio', 'document'] as const;

function Facts({ detail }: { detail: Detail }) {
  const { t, i18n } = useTranslation();
  const when = useWhen();
  const date = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(iso))
      : t('adminPanel.users.never');
  const rows: Array<[string, string]> = [
    [t('adminPanel.users.joined'), date(detail.user.createdAt)],
    [t('adminPanel.users.lastSignIn'), date(detail.user.lastLoginAt)],
    [t('adminPanel.users.lastActiveLabel'), when(detail.user.lastActiveAt)],
  ];
  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-xl border bg-surface p-3">
          <dt className="text-xs text-text-muted">{label}</dt>
          <dd className="font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Storage({ detail, onChange }: { detail: Detail; onChange: () => void }) {
  const { t, i18n } = useTranslation();
  const { storage } = detail;
  return (
    <section
      aria-labelledby="user-storage"
      className="space-y-3 rounded-2xl border bg-surface p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="user-storage" className="text-lg font-semibold">
          {t('adminPanel.users.storage')}
        </h2>
        <Button variant="outline" size="sm" onClick={onChange} className="pointer-coarse:h-11">
          {t('adminPanel.users.actions.storageQuota.confirm')}
        </Button>
      </div>
      <StorageBar used={storage.usedBytes + storage.pendingBytes} limit={storage.quotaBytes} />
      <p className="text-xs text-text-muted">
        {storage.custom ? t('adminPanel.users.quotaOwn') : t('adminPanel.users.quotaDefault')}
      </p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {KINDS.map((kind) => (
          <li key={kind}>
            <span className="text-text-muted">{t(`adminPanel.users.kinds.${kind}`)}: </span>
            <span className="tabular-nums">{formatBytes(storage.byKind[kind], i18n.language)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Devices({ detail }: { detail: Detail }) {
  const { t } = useTranslation();
  const when = useWhen();
  return (
    <section
      aria-labelledby="user-devices"
      className="space-y-3 rounded-2xl border bg-surface p-5 shadow-sm"
    >
      <h2 id="user-devices" className="text-lg font-semibold">
        {t('adminPanel.users.devices', { count: detail.devices.length })}
      </h2>
      {detail.devices.length === 0 ? (
        <p className="text-sm text-text-muted">{t('adminPanel.users.noDevices')}</p>
      ) : (
        <ul className="divide-y">
          {detail.devices.map((device) => (
            <li key={device.id} className="flex items-center gap-3 py-2.5">
              <MonitorSmartphone className="size-5 shrink-0 text-text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{device.label}</p>
                <p className="text-xs text-text-muted">
                  {t('adminPanel.users.lastActive', { when: when(device.lastActiveAt) })}
                </p>
              </div>
              <span className="flex shrink-0 items-center gap-1 text-xs text-text-muted">
                {device.pushOn ? (
                  <Bell className="size-3.5 text-success" aria-hidden />
                ) : (
                  <BellOff className="size-3.5" aria-hidden />
                )}
                {t(
                  device.pushOn
                    ? 'adminPanel.users.devicePushOn'
                    : 'adminPanel.users.devicePushOff',
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Admin → Users → one person: facts, storage, devices and every action, each with a reason. */
export default function AdminUserDetail({ userId }: { userId: string }) {
  const { t, i18n } = useTranslation();
  const me = useSession()?.user;
  const defaultGb = Math.round((useAppConfig()?.media.userQuotaBytes ?? 3 * GB) / GB);
  const [action, setAction] = useState<PendingAction | null>(null);
  const query = useQuery({
    queryKey: userKey(userId),
    queryFn: () => adminUsersApi.detail(userId),
  });
  const detail = query.data;
  const self = userId === me?.id;
  const open = (kind: UserActionKind) =>
    detail && setAction({ kind, people: [{ id: userId, name: nameOf(detail.user) }] });

  const back = (
    <Link
      to="/admin/users"
      className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-medium text-text-muted hover:text-text"
    >
      <ArrowLeft className="size-4" aria-hidden />
      {t('admin.usersTitle')}
    </Link>
  );
  if (query.isPending) {
    return (
      <AdminPage title={t('adminPanel.users.loadingPerson')}>
        {back}
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="space-y-3">
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      </AdminPage>
    );
  }
  if (!detail) {
    return (
      <AdminPage title={t('adminPanel.users.notFound')}>
        {back}
        <p role="alert" className="text-sm text-text-muted">
          {t('admin.loadFailed')}
        </p>
      </AdminPage>
    );
  }
  const { user } = detail;
  const deactivated = user.status === 'deactivated';
  return (
    <AdminPage title={nameOf(user)}>
      {back}
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border bg-surface p-5 shadow-sm">
        <Avatar name={nameOf(user)} className="size-14" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <StatusBadges user={user} />
            {self ? <span className="text-xs text-text-muted">{t('admin.you')}</span> : null}
          </p>
          <p className="break-all text-sm text-text-muted">{user.email}</p>
          {user.username ? <p className="text-sm text-text-muted">@{user.username}</p> : null}
        </div>
      </div>
      {user.suspendedUntil ? (
        <div
          role="status"
          className="space-y-1 rounded-2xl border border-danger/40 bg-danger/5 p-4 text-sm"
        >
          <p className="font-medium">
            {t('adminPanel.users.suspendedNotice', {
              date: new Intl.DateTimeFormat(i18n.language, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(user.suspendedUntil)),
            })}
          </p>
          {user.suspendReason ? (
            <p className="break-words text-text-muted">
              {t('admin.auditReason', { reason: user.suspendReason })}
            </p>
          ) : null}
        </div>
      ) : null}
      <Facts detail={detail} />
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Storage detail={detail} onChange={() => open('storageQuota')} />
        <Devices detail={detail} />
      </div>
      {self ? (
        <p className="text-sm text-text-muted">{t('adminPanel.users.selfNote')}</p>
      ) : (
        <section aria-labelledby="user-actions" className="space-y-3">
          <h2 id="user-actions" className="text-lg font-semibold">
            {t('adminPanel.users.actionsTitle')}
          </h2>
          <div className="flex flex-wrap gap-2">
            {deactivated ? null : (
              <Button
                variant={user.suspendedUntil ? 'outline' : 'danger-outline'}
                onClick={() => open(user.suspendedUntil ? 'unsuspend' : 'suspend')}
                className="pointer-coarse:h-11"
              >
                {t(
                  `adminPanel.users.actions.${user.suspendedUntil ? 'unsuspend' : 'suspend'}.confirm`,
                )}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => open('signOut')}
              className="pointer-coarse:h-11"
            >
              {t('adminPanel.users.actions.signOut.confirm')}
            </Button>
            <Button
              variant="outline"
              onClick={() => open(user.role === 'admin' ? 'demote' : 'promote')}
              className="pointer-coarse:h-11"
            >
              {t(
                `adminPanel.users.actions.${user.role === 'admin' ? 'demote' : 'promote'}.confirm`,
              )}
            </Button>
            <Button
              variant={deactivated ? 'outline' : 'danger-outline'}
              onClick={() => open(deactivated ? 'reactivate' : 'deactivate')}
              className="pointer-coarse:h-11"
            >
              {t(`adminPanel.users.actions.${deactivated ? 'reactivate' : 'deactivate'}.confirm`)}
            </Button>
          </div>
        </section>
      )}
      <UserActionDialog action={action} defaultGb={defaultGb} onClose={() => setAction(null)} />
    </AdminPage>
  );
}
