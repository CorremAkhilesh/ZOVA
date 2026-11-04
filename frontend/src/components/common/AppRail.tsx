import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { Tooltip } from '@/components/ui/tooltip';
import { Logo } from './Logo';
import { NAV_ITEMS } from './nav-items';

/** Desktop navigation: a slim icon rail on the far left. */
export function AppRail() {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t('nav.main')}
      className="glass flex w-[72px] shrink-0 flex-col items-center gap-2 border-r py-4"
    >
      <Logo className="mb-4" />
      {NAV_ITEMS.map(({ to, labelKey, icon: Icon }) => (
        <Tooltip key={to} label={t(labelKey)}>
          <Link
            to={to}
            aria-label={t(labelKey)}
            className="relative flex size-11 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-background hover:text-text data-[status=active]:bg-brand-subtle data-[status=active]:text-brand-text"
          >
            <Icon className="size-5" aria-hidden />
          </Link>
        </Tooltip>
      ))}
      <div className="mt-auto">
        <Avatar name="You" className="size-10" />
      </div>
    </nav>
  );
}
