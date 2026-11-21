import { Link } from '@tanstack/react-router';
import type { AdminUserRow } from '@zuvo/protocol';
import { BellOff, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { formatBytes } from '@/lib/format-bytes';
import { cn } from '@/lib/utils';

export const nameOf = (user: Pick<AdminUserRow, 'displayName' | 'email'>) =>
  user.displayName ?? user.email;

/** "2 hours ago", "3 Nov", or "Never" in the reader's language. */
export function useWhen() {
  const { t, i18n } = useTranslation();
  return (iso: string | null) => {
    if (!iso) return t('adminPanel.users.never');
    const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
    const relative = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' });
    if (minutes < 60) return relative.format(-Math.max(0, minutes), 'minute');
    if (minutes < 24 * 60) return relative.format(-Math.round(minutes / 60), 'hour');
    return new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' }).format(
      new Date(iso),
    );
  };
}

export function StatusBadges({ user }: { user: AdminUserRow }) {
  const { t, i18n } = useTranslation();
  return (
    <>
      {user.role === 'admin' ? <Badge>{t('admin.roleAdmin')}</Badge> : null}
      {user.suspendedUntil ? (
        <Badge variant="muted">
          {t('adminPanel.users.suspendedUntil', {
            date: new Intl.DateTimeFormat(i18n.language, {
              day: 'numeric',
              month: 'short',
              hour: 'numeric',
              minute: '2-digit',
            }).format(new Date(user.suspendedUntil)),
          })}
        </Badge>
      ) : null}
      {user.status === 'deactivated' ? (
        <Badge variant="muted">{t('admin.deactivated')}</Badge>
      ) : null}
    </>
  );
}

/** A themed share bar; red from 80% of the limit. */
export function StorageBar({ used, limit }: { used: number; limit: number }) {
  const { t, i18n } = useTranslation();
  const percent = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  const text = t('admin.storageUsedOf', {
    size: formatBytes(used, i18n.language),
    limit: formatBytes(limit, i18n.language),
  });
  return (
    <div className="min-w-0 space-y-1">
      {/* biome-ignore lint/a11y/useSemanticElements: a styled bar; <meter> cannot be themed alike in every browser */}
      <div
        role="meter"
        aria-label={t('adminPanel.users.storage')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={text}
        className="h-1.5 rounded-full bg-background"
      >
        <div
          className={cn('h-full rounded-full', percent >= 80 ? 'bg-danger' : 'bg-brand')}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-xs text-text-muted tabular-nums">{text}</p>
    </div>
  );
}

/**
 * One person in the list: a checkbox for bulk actions (not for yourself), who they are, when they
 * were last active, push and storage. The name opens their page.
 */
export function UserRowItem({
  user,
  self,
  selected,
  onSelect,
}: {
  user: AdminUserRow;
  self: boolean;
  selected: boolean;
  onSelect: (selected: boolean) => void;
}) {
  const { t } = useTranslation();
  const when = useWhen();
  const name = nameOf(user);
  return (
    <li
      className={cn(
        'grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 px-4 py-3 md:grid-cols-[auto_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]',
        selected && 'bg-brand-subtle/50',
      )}
    >
      <label className="tap-target flex size-6 items-center justify-center">
        <input
          type="checkbox"
          checked={selected}
          disabled={self}
          onChange={(event) => onSelect(event.target.checked)}
          aria-label={t('adminPanel.users.select', { name })}
          className="size-4 accent-[var(--color-brand)]"
        />
      </label>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          <Link
            to="/admin/users/$userId"
            params={{ userId: user.id }}
            className="tap-target min-w-0 break-words hover:underline"
          >
            {name}
          </Link>
          <StatusBadges user={user} />
          {self ? <span className="text-xs text-text-muted">{t('admin.you')}</span> : null}
        </p>
        <p className="truncate text-sm text-text-muted">{user.email}</p>
      </div>
      <div className="col-start-2 text-xs text-text-muted md:col-start-auto">
        <p>{t('adminPanel.users.lastActive', { when: when(user.lastActiveAt) })}</p>
        <p className="flex items-center gap-1">
          {user.pushOn ? null : <BellOff className="size-3.5" aria-hidden />}
          {t(user.pushOn ? 'adminPanel.users.pushOn' : 'adminPanel.users.pushOff', {
            count: user.deviceCount,
          })}
        </p>
      </div>
      <div className="col-span-2 col-start-2 md:col-span-1 md:col-start-auto">
        <StorageBar used={user.storageBytes} limit={user.quotaBytes} />
      </div>
      <Link
        to="/admin/users/$userId"
        params={{ userId: user.id }}
        aria-label={t('adminPanel.users.open', { name })}
        className="tap-target row-start-1 col-start-3 flex size-9 items-center justify-center rounded-lg text-text-muted hover:bg-background md:col-start-5"
      >
        <ChevronRight className="size-4" aria-hidden />
      </Link>
    </li>
  );
}
