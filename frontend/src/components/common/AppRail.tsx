import { Link } from '@tanstack/react-router';
import { LayoutDashboard } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { Tooltip } from '@/components/ui/tooltip';
import { useSession } from '@/features/auth/session';
import { Logo } from './Logo';
import { useNavItems } from './use-nav-items';

const RAIL_LINK =
  'relative flex size-11 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-background hover:text-text data-[status=active]:bg-brand-subtle data-[status=active]:text-brand-text';

/** Desktop navigation: a slim icon rail on the far left (and the admin panel, for admins). */
export function AppRail() {
  const { t } = useTranslation();
  const navItems = useNavItems();
  const user = useSession()?.user;
  const name = user?.displayName ?? user?.email ?? '';
  return (
    <nav
      aria-label={t('nav.main')}
      className="glass flex w-[72px] shrink-0 flex-col items-center gap-2 border-r py-4"
    >
      <Logo className="mb-4" />
      {navItems.map(({ to, labelKey, icon: Icon }) => (
        <Tooltip key={to} label={t(labelKey)}>
          <Link to={to} aria-label={t(labelKey)} className={RAIL_LINK}>
            <Icon className="size-5" aria-hidden />
          </Link>
        </Tooltip>
      ))}
      {user?.role === 'admin' ? (
        <Tooltip label={t('adminPanel.title')}>
          <Link to="/admin" aria-label={t('adminPanel.title')} className={RAIL_LINK}>
            <LayoutDashboard className="size-5" aria-hidden />
          </Link>
        </Tooltip>
      ) : null}
      <Tooltip label={name}>
        <Link to="/settings" className="mt-auto rounded-full">
          <Avatar name={name || '?'} src={user?.avatar?.small} className="size-10" />
          {/* Named in text, not aria-label: the avatar's initials are decoration (hidden). */}
          <span className="sr-only">{t('auth.account.open', { name })}</span>
        </Link>
      </Tooltip>
    </nav>
  );
}
