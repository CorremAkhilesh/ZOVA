import { Link, Outlet } from '@tanstack/react-router';
import {
  ArrowLeft,
  Bell,
  Flag,
  LayoutDashboard,
  Megaphone,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  UsersRound,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export const ADMIN_SECTIONS = [
  { to: '/admin', key: 'dashboard', icon: LayoutDashboard, exact: true },
  { to: '/admin/users', key: 'users', icon: Users, exact: false },
  { to: '/admin/groups', key: 'groups', icon: UsersRound, exact: false },
  { to: '/admin/reports', key: 'reports', icon: Flag, exact: false },
  { to: '/admin/announcements', key: 'announcements', icon: Megaphone, exact: false },
  { to: '/admin/notifications', key: 'notifications', icon: Bell, exact: false },
  { to: '/admin/security', key: 'security', icon: ShieldCheck, exact: false },
  { to: '/admin/settings', key: 'settings', icon: SlidersHorizontal, exact: false },
  { to: '/admin/audit', key: 'audit', icon: ScrollText, exact: false },
] as const;

const ITEM =
  'flex min-h-11 shrink-0 items-center gap-3 rounded-xl px-3 text-sm font-medium text-text-muted transition-colors hover:bg-background hover:text-text data-[status=active]:bg-brand-subtle data-[status=active]:text-brand-text';

function SectionLinks() {
  const { t } = useTranslation();
  return ADMIN_SECTIONS.map(({ to, key, icon: Icon, exact }) => (
    <Link key={to} to={to} activeOptions={{ exact }} className={ITEM}>
      <Icon className="size-4.5 shrink-0" aria-hidden />
      {t(`adminPanel.nav.${key}`)}
    </Link>
  ));
}

/**
 * The admin panel: a sidebar of sections on wide screens, a row of tabs under the title on phones.
 * Each section renders into the content column.
 */
export function AdminLayout() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <aside className="shrink-0 border-b bg-surface md:w-60 md:border-r md:border-b-0">
        <div className="flex items-center gap-2 px-4 pt-4 md:px-5 md:pt-6">
          <Link
            to="/settings"
            aria-label={t('adminPanel.backToApp')}
            className="tap-target -ml-1 inline-flex size-9 items-center justify-center rounded-lg text-text-muted hover:bg-background hover:text-text"
          >
            <ArrowLeft className="size-4.5" aria-hidden />
          </Link>
          <p className="text-base font-bold tracking-tight">{t('adminPanel.title')}</p>
        </div>
        <nav
          aria-label={t('adminPanel.sections')}
          className="flex gap-1 overflow-x-auto px-3 py-3 md:flex-col md:overflow-visible md:px-3 md:py-4"
        >
          <SectionLinks />
        </nav>
      </aside>
      {/* Focusable, so a keyboard can scroll the section even where it holds no control. */}
      <div
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must take focus (WCAG 2.1.1)
        tabIndex={0}
        className="min-h-0 min-w-0 flex-1 overflow-y-auto focus-visible:outline-none"
      >
        <Outlet />
      </div>
    </div>
  );
}

/** One admin section: its title, a line about it, and the content, up to a wide column. */
export function AdminPage({
  title,
  description,
  actions,
  back,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** A way back to the list this page belongs to, above the title. */
  back?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 md:p-8">
      {back}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description ? <p className="text-sm text-text-muted">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}
