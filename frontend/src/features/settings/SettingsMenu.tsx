import { Link } from '@tanstack/react-router';
import {
  ChevronRight,
  Flag,
  MessagesSquare,
  MonitorSmartphone,
  Moon,
  Palette,
  ScrollText,
  Shield,
  Users,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { useSession } from '@/features/auth/session';

type Entry = {
  to:
    | '/settings/privacy'
    | '/settings/chats'
    | '/settings/appearance'
    | '/settings/notifications'
    | '/settings/devices'
    | '/settings/admin/users'
    | '/settings/admin/reports'
    | '/settings/admin/audit';
  label: string;
  hint: string;
  icon: ComponentType<{ className?: string }>;
};

function EntryList({ entries, label }: { entries: Entry[]; label: string }) {
  return (
    <nav aria-label={label} className="overflow-hidden rounded-2xl border bg-surface shadow-sm">
      <ul className="divide-y">
        {entries.map(({ to, label: title, hint, icon: Icon }) => (
          <li key={to}>
            <Link to={to} className="flex items-center gap-3 px-5 py-4 hover:bg-background">
              <Icon className="size-5 text-brand-text" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{title}</span>
                <span className="block text-sm text-text-muted">{hint}</span>
              </span>
              <ChevronRight className="size-4 text-text-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Top of Settings: the profile card, then privacy/devices and (for admins) the admin screens. */
export function SettingsMenu() {
  const { t } = useTranslation();
  const user = useSession()?.user;
  if (!user) return null;
  const name = user.displayName ?? user.email;

  return (
    <>
      <Link
        to="/settings/profile"
        aria-label={t('settings.openProfile', { name })}
        className="flex items-center gap-4 rounded-2xl border bg-surface p-5 shadow-sm hover:bg-background"
      >
        <Avatar name={name} src={user.avatar?.small} className="size-14" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-lg font-semibold">{name}</span>
          <span className="block truncate text-sm text-text-muted">
            {user.username ? `@${user.username}` : user.email}
          </span>
          <span className="block truncate text-sm text-text-muted">{user.about}</span>
        </span>
        <ChevronRight className="size-4 text-text-muted" aria-hidden />
      </Link>
      <EntryList
        label={t('settings.accountMenu')}
        entries={[
          {
            to: '/settings/privacy',
            label: t('privacy.title'),
            hint: t('privacy.subtitle'),
            icon: Shield,
          },
          {
            to: '/settings/chats',
            label: t('chatSettings.title'),
            hint: t('chatSettings.subtitle'),
            icon: MessagesSquare,
          },
          {
            to: '/settings/appearance',
            label: t('appearance.title'),
            hint: t('appearance.menuHint'),
            icon: Palette,
          },
          {
            to: '/settings/notifications',
            label: t('quietHours.screenTitle'),
            hint: t('quietHours.menuHint'),
            icon: Moon,
          },
          {
            to: '/settings/devices',
            label: t('devices.title'),
            hint: t('devices.subtitle'),
            icon: MonitorSmartphone,
          },
        ]}
      />
      {user.role === 'admin' ? (
        <EntryList
          label={t('admin.menu')}
          entries={[
            {
              to: '/settings/admin/users',
              label: t('admin.usersTitle'),
              hint: t('admin.usersSubtitle'),
              icon: Users,
            },
            {
              to: '/settings/admin/reports',
              label: t('adminReports.title'),
              hint: t('adminReports.subtitle'),
              icon: Flag,
            },
            {
              to: '/settings/admin/audit',
              label: t('admin.auditTitle'),
              hint: t('admin.auditSubtitle'),
              icon: ScrollText,
            },
          ]}
        />
      ) : null}
    </>
  );
}
